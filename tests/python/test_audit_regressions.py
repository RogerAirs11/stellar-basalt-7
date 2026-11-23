"""Offline SQLite regression coverage using production SQL and all migrations.

These tests do NOT certify the PostgreSQL provider or HTTP routing.
"""
import re
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


class AuditSqlRegressions(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            _sql = migration.read_text(encoding="utf-8")
            # R125: normalize PostgreSQL's ADD COLUMN IF NOT EXISTS (D1 accepts it;
            # stock sqlite3 does not) — see src/db/localSqlite.ts exec().
            _sql = re.sub(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+", "ADD COLUMN ", _sql, flags=re.IGNORECASE)
            self.db.executescript(_sql)
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'Audit horse')")
        self.db.execute("INSERT INTO competitions(id,name_native,discipline,event_date,venue,season) VALUES(1,'Audit','racing','2026-10-01','Test',1405)")
        self.db.commit()
        text = source("src/api/modules/competitions.ts")
        self.result_sql = re.search(r"INSERT INTO competition_results[\s\S]+?`\)\.bind", text).group(0).split("`).bind")[0]
        text = source("src/auth/publicAuthPolicy.ts")
        self.otp_sql = re.search(r"CLAIM_OTP_ATTEMPT_SQL = `([\s\S]+?)`", text).group(1)
        text = source("src/api/modules/marketplace.ts")
        columns = re.search(r"const LISTING_COLUMNS = `([\s\S]*?)`", text).group(1)
        # R111: the public media rule is shared with metadata and file delivery.
        # Resolve the literal alias in that exact production template; never
        # replay a separate, weaker copy of the visibility condition here.
        media_policy = source("src/api/modules/mediaPolicy.ts")
        media_template = re.search(r"export function publicMediaPredicate\([\s\S]*?return `([^`]+)`;", media_policy).group(1)
        columns = columns.replace("${publicMediaPredicate('hm')}", media_template.replace("${p}", "hm."))
        self.assertNotIn("${", columns, "SQL replay must resolve every production interpolation")
        self.public_price = re.search(r'PUBLIC_LISTING_PRICE_SQL = "([^"]+)"', text).group(1)
        self.public_columns = columns.replace("l.asking_price_toman", f"{self.public_price} AS asking_price_toman")

    def tearDown(self):
        self.db.close()

    def upsert_result(self, class_name, placement=1, notes="first"):
        self.db.execute(self.result_sql, (1,1,None,None,class_name,placement,None,None,0,0,notes))

    # R114-02: the production statement extracted above is now CREATE-ONLY
    # (the R113 silent natural-key upsert was removed). At the raw-SQL level
    # the uq_competition_results_entry index refuses EVERY repeat of a
    # natural key — identical or not; the HTTP handler classifies identical
    # replays as idempotent no-ops before issuing any INSERT (covered by
    # tests/integration/competitionsVersionedR114.test.ts through the real
    # handlers). These SQL-level checks keep proving the identity contract.
    def test_null_class_repeat_is_refused_not_upserted(self):
        self.upsert_result(None)
        with self.assertRaises(sqlite3.IntegrityError):
            self.upsert_result(None,2,"amended")
        self.assertEqual(self.db.execute("SELECT placement,notes FROM competition_results").fetchall(), [(1,"first")])

    def test_empty_and_null_class_share_one_bucket(self):
        self.upsert_result(None)
        with self.assertRaises(sqlite3.IntegrityError):
            self.upsert_result("",3,"empty alias")
        self.assertEqual(self.db.execute("SELECT placement,notes FROM competition_results").fetchall(), [(1,"first")])

    def test_distinct_classes_stay_distinct_and_repeats_refuse(self):
        self.upsert_result("A")
        self.upsert_result("B",5)
        with self.assertRaises(sqlite3.IntegrityError):
            self.upsert_result("A",4)
        self.assertEqual(self.db.execute("SELECT class_name,placement FROM competition_results ORDER BY class_name").fetchall(), [("A",1),("B",5)])

    def add_otp(self, expires=None):
        expires = expires or (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        self.db.execute("INSERT INTO sms_otp_challenges(id,phone_e164,code_hash,purpose,expires_at) VALUES('otp','+989121234567','correct','login',?)", (expires,))

    def claim_otp(self, candidate):
        return self.db.execute(self.otp_sql,(candidate,"otp")).fetchone()

    def test_correct_otp_consumed_once(self):
        self.add_otp()
        self.assertEqual(self.claim_otp("correct"),("correct",))
        self.assertIsNone(self.claim_otp("correct"))
        self.assertEqual(self.db.execute("SELECT attempts FROM sms_otp_challenges").fetchone()[0],1)

    def test_four_bad_attempts_then_fifth_correct_is_valid(self):
        self.add_otp()
        for _ in range(4):
            self.assertEqual(self.claim_otp("wrong"),("correct",))
        self.assertEqual(self.claim_otp("correct"),("correct",))
        self.assertIsNone(self.claim_otp("correct"))
        self.assertEqual(self.db.execute("SELECT attempts FROM sms_otp_challenges").fetchone()[0],5)

    def test_five_bad_attempts_block_correct_sixth(self):
        self.add_otp()
        for _ in range(5): self.claim_otp("wrong")
        self.assertIsNone(self.claim_otp("correct"))
        self.assertEqual(self.db.execute("SELECT attempts,consumed_at FROM sms_otp_challenges").fetchone(),(5,None))

    def test_expired_iso_timestamp_is_not_accepted(self):
        self.add_otp((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat())
        self.assertIsNone(self.claim_otp("correct"))
        self.assertEqual(self.db.execute("SELECT attempts FROM sms_otp_challenges").fetchone()[0],0)

    def test_same_day_timestamp_comparison_regression(self):
        row = self.db.execute("SELECT '2026-10-02T08:00:00.000Z' > '2026-10-02 12:00:00', datetime('2026-10-02T08:00:00.000Z') > datetime('2026-10-02 12:00:00')").fetchone()
        self.assertEqual(row,(1,0))

    def add_listing(self, ident, price, visible):
        horse_id = self.db.execute("INSERT INTO horses(name_latin) VALUES(?)",(ident,)).lastrowid
        self.db.execute("INSERT INTO sales_listings(id,horse_id,seller_contact_name,asking_price_toman,price_visible,status) VALUES(?,?,'Audit',?,?,'active')",(ident,horse_id,price,visible))

    def listing_rows(self, direction="ASC"):
        assert direction in ("ASC","DESC")
        cursor = self.db.execute(f"SELECT {self.public_columns} FROM sales_listings l JOIN horses h ON h.id=l.horse_id ORDER BY ({self.public_price}) IS NULL ASC, ({self.public_price}) {direction}, l.id ASC")
        names=[entry[0] for entry in cursor.description]
        return [dict(zip(names,row)) for row in cursor.fetchall()]

    def test_hidden_price_never_serialized_in_public_projection(self):
        self.add_listing("hidden",123456789,0)
        self.add_listing("visible",1200,1)
        rows={r["id"]:r for r in self.listing_rows()}
        self.assertIsNone(rows["hidden"]["asking_price_toman"])
        self.assertEqual(rows["visible"]["asking_price_toman"],1200)

    def test_hidden_price_does_not_change_order_or_public_values(self):
        self.add_listing("hidden",1,0)
        self.add_listing("visible-low",100,1)
        self.add_listing("visible-high",1000,1)
        before=[self.listing_rows(d) for d in ("ASC","DESC")]
        self.db.execute("UPDATE sales_listings SET asking_price_toman=999999999 WHERE id='hidden'")
        after=[self.listing_rows(d) for d in ("ASC","DESC")]
        self.assertEqual(before,after)
        for rows in after: self.assertEqual(rows[-1]["id"],"hidden")

    def test_migrations_remain_foreign_key_clean_after_new_workflows(self):
        self.upsert_result(None)
        self.add_listing("hidden",1,0)
        self.add_otp()
        self.claim_otp("correct")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0],"ok")


class ReviewRaceSemantics(unittest.TestCase):
    """R74 (audit REV-01/REV-02): a review decision and its canonical effects
    commit together or not at all. These scenarios replay the exact SQL from
    src/api/routes.ts against all migrations, modeling the two-reviewer
    schedule from the A1 reproducer (A commits, then B's already-built batch
    executes)."""

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            _sql = migration.read_text(encoding="utf-8")
            # R125: normalize PostgreSQL's ADD COLUMN IF NOT EXISTS (D1 accepts it;
            # stock sqlite3 does not) — see src/db/localSqlite.ts exec().
            _sql = re.sub(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+", "ADD COLUMN ", _sql, flags=re.IGNORECASE)
            self.db.executescript(_sql)
        self.db.execute("INSERT INTO horses(id,name_latin,row_version) VALUES(1,'Original Name',1)")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('rev-a','a@t','A','h','admin')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('rev-b','b@t','B','h','admin')")
        self.db.execute("INSERT INTO people(id,name_latin) VALUES(7,'Linked Person')")
        self.db.commit()
        # R117-20: the claims/change-request families moved to src/api/modules/.
        claims_text = source("src/api/modules/claims.ts")
        text = source("src/api/modules/changeRequests.ts")
        self.claim_decision = re.search(r"CLAIM_DECISION_SQL = `([\s\S]+?)`", claims_text).group(1)
        self.claim_link = re.search(r"CLAIM_OWNER_LINK_SQL = `([\s\S]+?)`", claims_text).group(1)
        self.claim_reindex = re.search(r"CLAIM_REINDEX_SQL = `([\s\S]+?)`", claims_text).group(1)
        self.change_decision_cas = re.search(r"CHANGE_DECISION_CAS_SQL = `([\s\S]+?)`", text).group(1)
        self.change_decision_after = re.search(r"CHANGE_DECISION_AFTER_UPDATE_SQL = `([\s\S]+?)`", text).group(1)
        # T07: the horse-update/reindex/revision statements moved to the shared
        # mutation builder in src/registry/mutations.ts — replay those exact
        # templates (change-request guard included, as the review path emits it).
        mut = source("src/registry/mutationStatements.ts")
        apply_tmpl = re.search(r"export const HORSE_UPDATE_SQL_TEMPLATE = \(setSql: string\) => `([\s\S]+?)`", mut).group(1)
        change_guard = re.search(r"export const HORSE_UPDATE_CHANGE_REQUEST_GUARD_SQL = `([\s\S]+?)`", mut).group(1)
        self.change_update = apply_tmpl.replace("${setSql}", "name_latin=?") + change_guard
        self.change_reindex = re.search(r"export const REINDEX_SELF_SQL = `([\s\S]+?)`", mut).group(1)
        self.change_bump = re.search(r"export const REGISTRY_REVISION_BUMP_SQL = `([\s\S]+?)`", mut).group(1)
        self.children_reindex = re.search(r"export const REINDEX_CHILDREN_ON_NAME_SQL = `([\s\S]+?)`", mut).group(1)

    def tearDown(self):
        self.db.close()

    def owner_links(self, horse_id=1):
        return self.db.execute(
            "SELECT COUNT(*) FROM horse_people WHERE horse_id=? AND role='owner' AND is_current=1", (horse_id,)
        ).fetchone()[0]

    def test_source_uses_conditioned_effects(self):
        # The guards themselves are source-anchored: losing batches must be no-ops.
        # R117-20: the decision SQL + review handlers moved to the modules.
        self.assertIn("AND reviewed_by_user_id=?)", source("src/api/modules/claims.ts"))
        self.assertIn("AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)", source("src/api/modules/changeRequests.ts"))
        self.assertIn("stale_horse_version", source("src/api/modules/changeRequests.ts"))

    def test_losing_claim_review_cannot_create_owner_link(self):
        self.db.execute(
            "INSERT INTO horse_claims(id,horse_id,claimant_user_id,status,person_id) VALUES('c1',1,'rev-a','pending',7)"
        )
        self.db.commit()
        # Reviewer A decides FIRST (rejected). Reviewer B's approve batch runs after.
        self.db.execute(self.claim_decision, ("rejected", "rev-a", None, "c1"))
        self.db.execute(self.claim_decision, ("approved", "rev-b", None, "c1"))
        self.db.execute(self.claim_link, (1, 7, "c1", "rev-b"))
        self.db.execute(self.claim_reindex, (1, "c1", "rev-b"))
        self.db.commit()
        status, reviewer = self.db.execute("SELECT status,reviewed_by_user_id FROM horse_claims WHERE id='c1'").fetchone()
        self.assertEqual((status, reviewer), ("rejected", "rev-a"))
        self.assertEqual(self.owner_links(), 0, "a rejected claim must never create a canonical owner link")
        queued = self.db.execute("SELECT COUNT(*) FROM horse_search_reindex_queue WHERE reason='claim_approved_owner'").fetchone()[0]
        self.assertEqual(queued, 0, "a losing review must not enqueue reindex work")

    def test_winning_claim_approval_creates_owner_link(self):
        self.db.execute(
            "INSERT INTO horse_claims(id,horse_id,claimant_user_id,status,person_id) VALUES('c2',1,'rev-a','pending',7)"
        )
        self.db.commit()
        self.db.execute(self.claim_decision, ("approved", "rev-a", None, "c2"))
        self.db.execute(self.claim_link, (1, 7, "c2", "rev-a"))
        self.db.execute(self.claim_reindex, (1, "c2", "rev-a"))
        self.db.commit()
        self.assertEqual(self.owner_links(), 1)
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM horse_search_reindex_queue WHERE horse_id=1").fetchone()[0], 1
        )

    def _insert_change_request(self, request_id):
        self.db.execute(
            "INSERT INTO change_requests(id,submitted_by_user_id,horse_id,request_type,status) VALUES(?,'rev-a',1,'update_horse','pending')",
            (request_id,),
        )
        self.db.execute(
            "INSERT INTO change_request_items(change_request_id,field_name,proposed_value_json) VALUES(?,'name_latin',?)",
            (request_id, '"Winner Name"'),
        )
        self.db.commit()

    def _run_approve_batch(self, request_id, reviewer, mutation_id, expected_version):
        self.db.execute(self.change_update, ("Winner Name", mutation_id, 1, expected_version, request_id))
        self.db.execute(self.change_decision_after, ("approved", reviewer, None, request_id, 1, mutation_id))
        self.db.execute(self.change_reindex, (1, "change_request_applied", 1, mutation_id))
        self.db.execute(self.children_reindex, (1, 1, 1, mutation_id))
        self.db.execute(self.change_bump, (1, mutation_id))
        self.db.commit()

    def test_losing_change_review_cannot_overwrite_horse(self):
        self._insert_change_request("r1")
        # Reviewer A approves first (reads row_version=1, her batch lands).
        self._run_approve_batch("r1", "rev-a", "mut-a", 1)
        # Reviewer B built her batch against the SAME row_version=1; it runs after.
        self._run_approve_batch("r1", "rev-b", "mut-b", 1)
        name, version, last_mut = self.db.execute("SELECT name_latin,row_version,last_mutation_id FROM horses WHERE id=1").fetchone()
        self.assertEqual(name, "Winner Name", "only the winning review may write the horse row")
        self.assertEqual(version, 2, "one canonical update, not two")
        self.assertEqual(last_mut, "mut-a")
        status, reviewer = self.db.execute("SELECT status,reviewed_by_user_id FROM change_requests WHERE id='r1'").fetchone()
        self.assertEqual((status, reviewer), ("approved", "rev-a"))

    def test_stale_horse_version_leaves_request_pending(self):
        self._insert_change_request("r2")
        # A direct edit bumps the horse version while the reviewer is reading.
        self.db.execute("UPDATE horses SET name_latin='Edited Concurrently',row_version=row_version+1,last_mutation_id='direct-1' WHERE id=1")
        self.db.commit()
        # The reviewer's batch was built against row_version=1: every statement no-ops.
        self._run_approve_batch("r2", "rev-a", "mut-a", 1)
        status = self.db.execute("SELECT status FROM change_requests WHERE id='r2'").fetchone()[0]
        self.assertEqual(status, "pending", "a stale apply must not record an approved-but-not-applied decision")
        name = self.db.execute("SELECT name_latin FROM horses WHERE id=1").fetchone()[0]
        self.assertEqual(name, "Edited Concurrently")
        revision = self.db.execute("SELECT canonical_revision FROM registry_state WHERE id=1").fetchone()[0]
        self.assertEqual(revision, 0, "no canonical revision bump without a landed update")

    def test_rejection_uses_plain_cas_and_never_touches_the_horse(self):
        self._insert_change_request("r3")
        self.db.execute(self.change_decision_cas, ("rejected", "rev-a", "no evidence", "r3"))
        self.db.commit()
        status = self.db.execute("SELECT status FROM change_requests WHERE id='r3'").fetchone()[0]
        self.assertEqual(status, "rejected")
        name, version = self.db.execute("SELECT name_latin,row_version FROM horses WHERE id=1").fetchone()
        self.assertEqual((name, version), ("Original Name", 1))

    def test_reviewed_parent_rename_queues_direct_children_for_search_reindex(self):
        # T09 acceptance: before the shared mutation builder, the reviewed path
        # only queued the edited horse — a reviewed parent rename left every
        # child's denormalized father_name/mother_name search text stale.
        self.db.execute("INSERT INTO horses(id,name_latin,father_id,row_version) VALUES(2,'Child Of One',1,1)")
        self.db.commit()
        self._insert_change_request("r4")
        self._run_approve_batch("r4", "rev-a", "mut-child", 1)
        reasons = {
            row[0]
            for row in self.db.execute(
                "SELECT reason FROM horse_search_reindex_queue WHERE horse_id IN (1,2)"
            ).fetchall()
        }
        self.assertIn("change_request_applied", reasons, "the edited horse reindexes")
        self.assertIn(
            "parent_name_changed",
            reasons,
            "direct children must be queued when a reviewed change renames their parent",
        )




class MergeInvariantRegressions(unittest.TestCase):
    """R122/T01 — replay the transaction-aborting merge/unmerge invariant
    assertion (the EXACT SQL the TypeScript builder emits) against a real
    SQLite database: a failed invariant must be a CHECK-constraint violation
    that aborts the whole transaction, and the ancestry cycle guard must
    detect self-parents and ancestor collapse. Source-synced: the templates
    are extracted from src/registry/mergeInvariants.ts, never re-typed."""

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted((ROOT / "migrations").glob("*.sql")):
            _sql = migration.read_text(encoding="utf-8")
            # R125: normalize PostgreSQL's ADD COLUMN IF NOT EXISTS (D1 accepts it;
            # stock sqlite3 does not) — see src/db/localSqlite.ts exec().
            _sql = re.sub(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+", "ADD COLUMN ", _sql, flags=re.IGNORECASE)
            self.db.executescript(_sql)
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role,is_active) VALUES('op','op@x.invalid','R122 Replay','h','admin',1)")
        self.db.commit()
        text = source("src/registry/mergeInvariants.ts")
        self.constraint_name = re.search(r'MERGE_INVARIANT_CONSTRAINT_NAME = "(\w+)"', text).group(1)
        closure = re.search(r"SUBJECT_ANCESTRY_CLOSURE_SQL = `([\s\S]*?)`;", text).group(1)
        self.cycle_guard = re.search(r"MERGE_ANCESTRY_CYCLE_GUARD_SQL = `([\s\S]*?)`;", text).group(1).replace("${SUBJECT_ANCESTRY_CLOSURE_SQL}", closure)
        self.assertNotIn("${", self.cycle_guard, "SQL replay must resolve every production interpolation")
        # The builder's exact INSERT shape (template + CASE WHEN ok).
        self.assertion_prefix = re.search(
            r'INSERT INTO merge_invariant_assertions\(command,operation_id,kept_horse_id,merged_horse_id,ok\)\s*\n\s*SELECT \?,\?,\?,\?,CASE WHEN \$\{allPredicates\.join\(" AND "\)\} THEN 1 ELSE 0 END',
            text)
        self.assertIsNotNone(self.assertion_prefix, "the assertion builder's SQL shape must stay extractable")

    def tearDown(self):
        self.db.close()

    def _assertion_sql(self, predicates):
        return (
            "INSERT INTO merge_invariant_assertions(command,operation_id,kept_horse_id,merged_horse_id,ok) "
            "SELECT ?,?,?,?,CASE WHEN " + " AND ".join(predicates) + " THEN 1 ELSE 0 END"
        )

    def test_violated_invariant_is_a_named_check_violation_that_rolls_back(self):
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'Replay subject')")
        self.db.commit()
        self.db.execute("BEGIN")
        self.db.execute("UPDATE horses SET father_id=1 WHERE id=1")  # a stray write inside the transaction
        with self.assertRaises(sqlite3.IntegrityError) as caught:
            self.db.execute(
                self._assertion_sql(["EXISTS(SELECT 1 FROM horses kh WHERE kh.id=? AND kh.deleted_at IS NULL AND father_id IS NULL)"]),
                ("merge", "r122-py-0001", 1, 2, 1),
            )
        self.assertIn(self.constraint_name, str(caught.exception))
        self.db.execute("ROLLBACK")
        # The stray write rolled back with the assertion: nothing persisted.
        row = self.db.execute("SELECT father_id FROM horses WHERE id=1").fetchone()
        self.assertIsNone(row[0])

    def test_passing_invariant_inserts_durable_ok_evidence(self):
        self.db.execute(self._assertion_sql(["1=1"]), ("merge", "r122-py-0002", 1, 2))
        row = self.db.execute("SELECT command,ok FROM merge_invariant_assertions WHERE operation_id='r122-py-0002'").fetchone()
        self.assertEqual(row, ("merge", 1))

    def test_cycle_guard_detects_direct_self_parent(self):
        self.db.execute("INSERT INTO horses(id,name_latin,father_id) VALUES(10,'Self',10)")
        self.db.commit()
        # The guard's two binds are the subject horse (seed + target).
        violation = self.db.execute(
            "SELECT 1 WHERE NOT (" + self.cycle_guard.replace("?", "10") + ")",
        ).fetchone()
        self.assertIsNotNone(violation, "a horse that is its own father must violate the guard")

    def test_cycle_guard_detects_ancestor_collapse(self):
        # kept(1) is a child of merged(2): merging 2 into 1 would repoint
        # kept.father_id from 2 to 1 — the R122-A02 reproduction.
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'Kept'),(2,'Merged')")
        self.db.execute("UPDATE horses SET father_id=2 WHERE id=1")
        self.db.execute("UPDATE horses SET father_id=1 WHERE id=1")  # the post-move state the guard must catch
        self.db.commit()
        violation = self.db.execute(
            "SELECT 1 WHERE NOT (" + self.cycle_guard.replace("?", "1") + ")",
        ).fetchone()
        self.assertIsNotNone(violation, "the post-merge self-parent must violate the guard")

    def test_cycle_guard_passes_on_a_healthy_chain(self):
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'A'),(2,'B'),(3,'C')")
        self.db.execute("UPDATE horses SET father_id=2 WHERE id=1")
        self.db.execute("UPDATE horses SET father_id=3 WHERE id=2")
        self.db.commit()
        clean = self.db.execute(
            "SELECT 1 WHERE NOT (" + self.cycle_guard.replace("?", "1") + ")",
        ).fetchone()
        self.assertIsNone(clean, "a healthy three-generation chain must satisfy the guard")



if __name__ == "__main__": unittest.main()
