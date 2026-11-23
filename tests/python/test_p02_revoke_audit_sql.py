"""P02 (R88 agent plan): prove the marker-conditioned revocation audit semantics
on a real in-memory SQLite database with ALL migrations applied.

These tests execute the ACTUAL production SQL statements (regex-extracted from
the TypeScript source) — not stubs — and pin the P02 acceptance rules:
  * a successful revoke lands exactly one matching audit event;
  * a repeated revoke with a fresh operation id changes nothing and mints NO
    second successful-revocation audit row (the INSERT ... SELECT is gated on
    THIS call's marker, so the no-op batch is honest);
  * a racing second writer's marker can never mint an audit event for a
    revocation it did not perform;
  * myGrants applies the same effective-now policy as authorization
    (future-start and deleted-horse grants are hidden).

This is SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import json
import re
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class P02RevokeAuditSql(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for p in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(p.read_text())
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('u','demo@example.invalid','DEMO','unused','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('a','admin@example.invalid','ADMIN','unused','admin')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'DEMO')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(2,'GONE')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) VALUES('g',1,'u','owner','manage_profile','2026-01-01 00:00:00')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) VALUES('future',1,'u','owner','manage_profile','2027-01-01 00:00:00')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from) VALUES('gone',2,'u','owner','manage_profile','2026-01-01 00:00:00')")
        self.db.execute("UPDATE horses SET deleted_at='2026-10-01 00:00:00' WHERE id=2")
        self.db.execute("INSERT INTO organizations(id,slug,name_latin) VALUES(1,'demo','DEMO')")
        self.db.execute("INSERT INTO organization_memberships(id,organization_id,user_id,valid_from) VALUES(1,1,'u','2026-01-01 00:00:00')")
        src = (ROOT / 'src/access/horseAccess.ts').read_text()
        self.revoke_grant_sql = re.search(r'REVOKE_GRANT_SQL = `([\s\S]*?)`', src).group(1)
        self.grant_audit_sql = re.search(r'GRANT_REVOKE_AUDIT_SQL = `([\s\S]*?)`', src).group(1)
        self.revoke_membership_sql = re.search(r'ORGANIZATION_MEMBERSHIP_REVOKE_SQL = `([\s\S]*?)`', src).group(1)
        self.membership_audit_sql = re.search(r'MEMBERSHIP_REVOKE_AUDIT_SQL = `([\s\S]*?)`', src).group(1)
        # R117-20: myGrants moved to src/api/modules/claims.ts.
        routes = (ROOT / 'src/api/modules/claims.ts').read_text()
        anchor = routes.index('async function myGrants')
        self.mygrants_sql = re.search(r'`([\s\S]*?)`', routes[anchor:]).group(1)

    def tearDown(self):
        self.db.close()

    def audit_count(self, entity_id):
        return self.db.execute(
            "SELECT COUNT(*) FROM audit_events WHERE action='grant.revoke' AND entity_id=?", (entity_id,)
        ).fetchone()[0]

    def run_revoke(self, marker, grant_id='g'):
        """Execute the production statements, then commit — equivalent to one
        db.batch transaction (sqlite3 opens the transaction on first DML)."""
        cur = self.db.cursor()
        changed = cur.execute(self.revoke_grant_sql, ('a', 'reason', marker, grant_id)).rowcount
        cur.execute(self.grant_audit_sql, ('a', 'grant.revoke', 'horse_access_grant', grant_id,
                                           json.dumps({'prior_state': 'active'}), 'reason', grant_id, marker))
        self.db.commit()
        return changed

    def test_successful_revoke_lands_exactly_one_audit_event(self):
        changed = self.run_revoke('op-1')
        self.assertEqual(changed, 1)
        self.assertEqual(self.audit_count('g'), 1)
        row = self.db.execute("SELECT last_operation_id, revoked_by_user_id FROM horse_access_grants WHERE id='g'").fetchone()
        self.assertEqual(row[0], 'op-1')
        self.assertEqual(row[1], 'a')

    def test_repeated_revoke_is_a_noop_and_mints_no_second_audit_event(self):
        self.run_revoke('op-1')
        changed = self.run_revoke('op-2')  # fresh operation id, like a network retry
        self.assertEqual(changed, 0)
        self.assertEqual(self.audit_count('g'), 1)  # still exactly one event

    def test_racing_second_marker_cannot_mint_an_audit_event(self):
        """First writer wins; the loser's audit INSERT matches zero rows even
        though its UPDATE had not yet observed the win (the marker gate, not
        changes(), decides audit truth)."""
        self.run_revoke('op-1')
        # Simulate the racing loser: its UPDATE matched nothing, so the row's
        # marker is still op-1; its gated INSERT must not fire.
        cur = self.db.cursor()
        cur.execute(self.grant_audit_sql, ('a', 'grant.revoke', 'horse_access_grant', 'g',
                                           json.dumps({}), 'reason', 'g', 'op-racer'))
        self.assertEqual(self.audit_count('g'), 1)

    def test_nonexistent_grant_revoke_mints_no_audit_event(self):
        changed = self.run_revoke('op-x', grant_id='does-not-exist')
        self.assertEqual(changed, 0)
        self.assertEqual(self.audit_count('does-not-exist'), 0)

    def test_membership_revoke_audit_is_marker_conditioned(self):
        cur = self.db.cursor()
        changed = cur.execute(self.revoke_membership_sql, ('a', 'reason', 'op-m1', 1)).rowcount
        cur.execute(self.membership_audit_sql, ('a', 'organization.membership_revoke', 'organization_membership', '1',
                                                json.dumps({}), 'reason', 1, 'op-m1'))
        self.db.commit()
        self.assertEqual(changed, 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM audit_events WHERE action='organization.membership_revoke'").fetchone()[0], 1)
        # Repeat with a fresh marker: no state change, no second audit row.
        changed2 = cur.execute(self.revoke_membership_sql, ('a', 'reason', 'op-m2', 1)).rowcount
        cur.execute(self.membership_audit_sql, ('a', 'organization.membership_revoke', 'organization_membership', '1',
                                                json.dumps({}), 'reason', 1, 'op-m2'))
        self.db.commit()
        self.assertEqual(changed2, 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM audit_events WHERE action='organization.membership_revoke'").fetchone()[0], 1)

    def test_mygrants_hides_future_and_deleted_horse_grants(self):
        now = '2026-10-03T12:00:00.000Z'
        rows = self.db.execute(self.mygrants_sql, ('u', now, now)).fetchall()
        ids = {row[0] for row in rows}
        self.assertIn('g', ids)          # effective direct grant stays visible
        self.assertNotIn('future', ids)  # future-start grant is not yet effective
        self.assertNotIn('gone', ids)    # deleted horse hides its grant

    def test_mygrants_drops_grant_after_revoke(self):
        self.run_revoke('op-1')
        now = '2026-10-03T12:00:00.000Z'
        rows = self.db.execute(self.mygrants_sql, ('u', now, now)).fetchall()
        ids = {row[0] for row in rows}
        self.assertNotIn('g', ids)


if __name__ == '__main__':
    unittest.main()

# --- P02 acceptance completion: myGrants edge parity with authorization ---

class P02MyGrantsEdgeParity(unittest.TestCase):
    """Future-start, malformed-date and exact-expiry grants must match the
    authorization policy: fail closed (hidden), never advertised."""

    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for p in sorted((ROOT / 'migrations').glob('*.sql')):
            self.db.executescript(p.read_text())
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('u','demo@example.invalid','DEMO','unused','user')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'DEMO')")
        # R117-20: myGrants moved to src/api/modules/claims.ts.
        routes = (ROOT / 'src/api/modules/claims.ts').read_text()
        anchor = routes.index('async function myGrants')
        self.mygrants_sql = re.search(r'`([\s\S]*?)`', routes[anchor:]).group(1)
        self.now = '2026-10-03T12:00:00.000Z'

    def tearDown(self):
        self.db.close()

    def seed_grant(self, gid, valid_from, valid_until=None):
        self.db.execute(
            "INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,valid_from,valid_until)"
            " VALUES(?,1,'u','owner','manage_profile',?,?)", (gid, valid_from, valid_until))

    def visible(self):
        return {row[0] for row in self.db.execute(self.mygrants_sql, ('u', self.now, self.now)).fetchall()}

    def test_malformed_valid_from_fails_closed(self):
        self.seed_grant('bad', 'garbage')
        self.assertNotIn('bad', self.visible())

    def test_malformed_valid_until_fails_closed(self):
        self.seed_grant('badu', '2026-01-01 00:00:00', 'not-a-date')
        self.assertNotIn('badu', self.visible())

    def test_exact_expiry_is_hidden(self):
        self.seed_grant('edge', '2026-01-01 00:00:00', '2026-10-03 12:00:00')
        self.assertNotIn('edge', self.visible())

    def test_effective_grant_stays_visible(self):
        self.seed_grant('ok', '2026-01-01 00:00:00', '2027-01-01 00:00:00')
        self.assertIn('ok', self.visible())
