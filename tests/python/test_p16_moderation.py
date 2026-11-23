"""P16 (R88 agent plan): moderation, reporting and marketplace trust on a
REAL in-memory SQLite database with ALL migrations applied.

Pins the acceptance criteria with real SQL:

  * hiding a reported listing suspends the LISTING overlay — the horses
    table is proven untouched by FULL snapshot comparison;
  * the decision trail is append-only: hide -> appeal -> overturn keeps
    every event row (nothing is updated or deleted);
  * an expired seller mandate blocks NEW inquiries: the seller-authority
    guard query returns no active grant, mirroring the 410 branch;
  * availability confirmation is a guarded UPDATE on live listings only;
  * the queue ordering SQL ranks severity then age.

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

MARKETPLACE = (ROOT / 'src' / 'api' / 'modules' / 'marketplace.ts').read_text()
MODERATION = (ROOT / 'src' / 'api' / 'modules' / 'moderation.ts').read_text()


class P16Moderation(unittest.TestCase):
    def _close_db(self):
        # R109-31: deterministic close — never leave the connection to GC
        # (ResourceWarning source in GC-sensitive environments).
        try:
            self.db.close()
        except Exception:
            pass

    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self._close_db)
        self.db.execute('PRAGMA foreign_keys=ON')
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(path.read_text())
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('reporter','r@example.invalid','R','x','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('seller','s@example.invalid','S','x','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('admin','a@example.invalid','A','x','admin')")
        self.db.execute("INSERT INTO horses(id,name_latin,updated_at) VALUES(9,'STAR','2026-10-01 00:00:00')")
        self.db.execute(
            "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) "
            "VALUES('g1',9,'seller','owner','manage_profile,upload_media,create_listing,manage_inquiries','2026-01-01 00:00:00')")
        self.db.execute(
            "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
            "VALUES('listing-1',9,'seller','S','active','user')")

    def _horses_snapshot(self):
        return self.db.execute("SELECT * FROM horses ORDER BY id").fetchall()

    # ------------------------------------------------------- hide vs horse

    def test_hide_suspends_the_listing_never_the_horse(self):
        self.db.execute(
            "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason) "
            "VALUES('sales_listings','listing-1','reporter','fraud_suspected')")
        case_id = self.db.execute("SELECT id FROM moderation_cases").fetchone()[0]
        before = self._horses_snapshot()
        # The production hide decision: case UPDATE + suspension INSERT.
        self.db.execute(
            "UPDATE moderation_cases SET status='resolved_hidden', resolution_note='counterfeit documents', "
            "resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT LIKE 'resolved%'", (case_id,))
        self.db.execute(
            "INSERT INTO listing_suspensions(listing_id,case_id,suspended_by_user_id,reason) "
            "VALUES('listing-1',?, 'admin','counterfeit documents')", (case_id,))
        after = self._horses_snapshot()
        self.assertEqual(before, after, 'a moderation hide must never touch the horse record')
        suspended = self.db.execute(
            "SELECT COUNT(*) FROM listing_suspensions WHERE listing_id='listing-1' AND reinstated_at IS NULL").fetchone()[0]
        self.assertEqual(suspended, 1)
        # The public list filter (source-extracted fragment) excludes it.
        self.assertIn("NOT EXISTS(SELECT 1 FROM listing_suspensions ls WHERE ls.listing_id=l.id AND ls.reinstated_at IS NULL)", MARKETPLACE)

    # ------------------------------------------------- append-only trail

    def test_appeal_and_overturn_keep_the_full_decision_trail(self):
        self.db.execute(
            "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,status) "
            "VALUES('sales_listings','listing-1','reporter','fraud_suspected','resolved_hidden')")
        case_id = self.db.execute("SELECT id FROM moderation_cases").fetchone()[0]
        self.db.execute("INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json) "
                        "VALUES(?,'admin','decision',?)", (case_id, json.dumps({"decision": "hide"})))
        self.db.execute("INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json) "
                        "VALUES(?,'seller','appeal',?)", (case_id, json.dumps({"statement": "documents are authentic"})))
        self.db.execute("INSERT INTO moderation_appeals(case_id,appellant_user_id,statement) "
                        "VALUES(?,'seller','Documents verified in registry evidence.')", (case_id,))
        appeal_id = self.db.execute("SELECT id FROM moderation_appeals").fetchone()[0]
        # Overturn: appeal decided + case reinstated + suspension lifted.
        self.db.execute("UPDATE moderation_appeals SET status='overturned', decided_by_user_id='admin', "
                        "decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'", (appeal_id,))
        self.db.execute("UPDATE moderation_cases SET status='resolved_reinstated' WHERE id=? AND status='resolved_hidden'", (case_id,))
        self.db.execute("UPDATE listing_suspensions SET reinstated_at=CURRENT_TIMESTAMP, reinstated_by_user_id='admin' "
                        "WHERE listing_id='listing-1' AND reinstated_at IS NULL")
        self.db.execute("INSERT INTO moderation_case_events(case_id,actor_user_id,event_type,event_json) "
                        "VALUES(?,'admin','reversal',?)", (case_id, json.dumps({"outcome": "overturned"})))
        events = self.db.execute("SELECT event_type FROM moderation_case_events WHERE case_id=? ORDER BY id", (case_id,)).fetchall()
        self.assertEqual([row[0] for row in events], ["decision", "appeal", "reversal"],
                         'the previous decisions survive the reversal')
        still_suspended = self.db.execute(
            "SELECT COUNT(*) FROM listing_suspensions WHERE listing_id='listing-1' AND reinstated_at IS NULL").fetchone()[0]
        self.assertEqual(still_suspended, 0)

    # ------------------------------------------- expired seller mandate

    def test_expired_seller_mandate_blocks_new_inquiries(self):
        # The guard (source-extracted): the seller must still hold an active
        # create_listing grant, else inquiries get the 410.
        self.assertIn('authorizeHorseAction(env.DB, { userId: listing.seller_user_id, role: "user" }', MARKETPLACE)
        # Simulate mandate expiry: revoke the grant.
        self.db.execute("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='g1'")
        grants = self.db.execute("""
            SELECT g.id FROM horse_access_grants g
            WHERE g.horse_id=? AND g.revoked_at IS NULL
              AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
              AND g.grantee_user_id=?
        """, (9, '2026-10-03 12:00:00', 'seller')).fetchall()
        self.assertEqual(len(grants), 0, 'the expired mandate must yield zero active grants')
        # With a live grant the same query finds it (the happy path).
        self.db.execute("UPDATE horse_access_grants SET revoked_at=NULL WHERE id='g1'")
        grants_live = self.db.execute("""
            SELECT g.id FROM horse_access_grants g
            WHERE g.horse_id=? AND g.revoked_at IS NULL
              AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
              AND g.grantee_user_id=?
        """, (9, '2026-10-03 12:00:00', 'seller')).fetchall()
        self.assertEqual(len(grants_live), 1)

    def test_availability_confirmation_is_guarded_to_live_listings(self):
        update = "UPDATE sales_listings SET availability_confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('active','pending_sale')"
        self.assertIn(update, MARKETPLACE)
        cur = self.db.execute(update, ('listing-1',))
        self.assertEqual(cur.rowcount, 1)
        confirmed = self.db.execute("SELECT availability_confirmed_at FROM sales_listings WHERE id='listing-1'").fetchone()[0]
        self.assertIsNotNone(confirmed)
        # A sold listing cannot carry a fresh confirmation.
        self.db.execute("UPDATE sales_listings SET status='sold' WHERE id='listing-1'")
        self.db.execute("UPDATE sales_listings SET availability_confirmed_at=NULL WHERE id='listing-1'")
        cur2 = self.db.execute(update, ('listing-1',))
        self.assertEqual(cur2.rowcount, 0)

    # ------------------------------------------------------ queue ordering

    def test_queue_orders_severity_then_age(self):
        # Three DIFFERENT reporters (one open case per reporter per target).
        for index, (reason, severity, created) in enumerate([('spam', 'low', '2026-09-01 00:00:00'),
                                                             ('fraud_suspected', 'urgent', '2026-10-02 00:00:00'),
                                                             ('offensive_content', 'high', '2026-09-15 00:00:00')]):
            self.db.execute(
                "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,severity,created_at,updated_at) "
                "VALUES('sales_listings','listing-1',?,?,?,?,?)", (f'reporter-{index}', reason, severity, created, created))
        rows = self.db.execute("""
            SELECT severity FROM moderation_cases
            ORDER BY CASE severity WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC, created_at ASC
        """).fetchall()
        self.assertEqual([row[0] for row in rows], ['urgent', 'high', 'low'])
        self.assertIn("ORDER BY CASE c.severity", MODERATION)

    # ------------------------------------------------- honesty constraints

    def test_no_synthetic_rating_or_gmv_column_exists(self):
        for table in ('moderation_cases', 'moderation_appeals', 'listing_suspensions'):
            cols = [row[1] for row in self.db.execute(f"PRAGMA table_info({table})").fetchall()]
            for forbidden in ('rating', 'stars', 'gmv', 'sold_amount', 'sales_value'):
                self.assertNotIn(forbidden, cols, f'{table} must not carry {forbidden}')

    def test_one_open_case_per_reporter_per_target(self):
        insert = ("INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason) "
                  "VALUES('sales_listings','listing-1','reporter','spam')")
        self.db.execute(insert)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(insert)  # same reporter + target + status='new' conflicts

    # --------------------------------------------- R95-N14: dedup + lifecycle

    def test_duplicate_active_report_refused_under_cross_status_pairs(self):
        """The old UNIQUE only blocked same-STATUS duplicates: one 'new' +
        one 'triaged' could coexist. The 0061 partial index refuses ANY pair
        of active statuses for the same reporter + target."""
        self.db.execute(
            "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,status) "
            "VALUES('sales_listings','listing-1','reporter','spam','new')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,status) "
                "VALUES('sales_listings','listing-1','reporter','spam','triaged')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,status) "
                "VALUES('sales_listings','listing-1','reporter','spam','action_pending')")

    def test_second_report_after_close_lands_the_same_resolved_status(self):
        """The F27 defect: under the old 4-column UNIQUE, dismissing a later
        case to a resolved status an earlier case already had FAILED. Under
        0061, closed history is outside the key: any number of same-status
        closures coexist, and a new incident can always be filed."""
        for _ in range(3):
            self.db.execute(
                "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason) "
                "VALUES('sales_listings','listing-1','reporter','fraud_suspected')")
            self.db.execute(
                "UPDATE moderation_cases SET status='resolved_dismissed', resolved_at=CURRENT_TIMESTAMP "
                "WHERE status='new'")
        rows = self.db.execute(
            "SELECT COUNT(*) FROM moderation_cases "
            "WHERE status='resolved_dismissed' AND reporter_user_id='reporter' AND target_id='listing-1'").fetchone()
        self.assertEqual(rows[0], 3)

    def test_merged_status_and_link_columns_exist(self):
        cols = [row[1] for row in self.db.execute("PRAGMA table_info(moderation_cases)").fetchall()]
        self.assertIn('merged_into_case_id', cols)
        # resolved_merged is CHECK-legal (the INSERT below succeeds) and is
        # OUTSIDE the partial index key: a merged case never blocks a new
        # report for a later incident.
        self.db.execute(
            "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,status,merged_into_case_id) "
            "VALUES('sales_listings','listing-1','reporter','spam','resolved_merged',1)")
        self.db.execute(
            "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason) "
            "VALUES('sales_listings','listing-1','reporter','counterfeit_documents')")
        rows = self.db.execute(
            "SELECT status FROM moderation_cases WHERE reporter_user_id='reporter' AND target_id='listing-1' "
            "ORDER BY id").fetchall()
        self.assertEqual([r[0] for r in rows], ['resolved_merged', 'new'])

    def test_one_open_appeal_per_case_is_structural(self):
        self.db.execute(
            "INSERT INTO moderation_cases(target_table,target_id,reporter_user_id,reason,status) "
            "VALUES('sales_listings','listing-1','reporter','spam','resolved_hidden')")
        self.db.execute(
            "INSERT INTO moderation_appeals(case_id,appellant_user_id,statement) "
            "VALUES((SELECT id FROM moderation_cases WHERE status='resolved_hidden'),"
            "'seller','please reconsider the evidence')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO moderation_appeals(case_id,appellant_user_id,statement) "
                "VALUES((SELECT id FROM moderation_cases WHERE status='resolved_hidden'),"
                "'seller','a racing second appeal')")


if __name__ == '__main__':
    unittest.main()
