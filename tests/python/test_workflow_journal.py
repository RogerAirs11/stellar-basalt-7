import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


class WorkflowJournalTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8"))
        self.db.execute(
            "INSERT INTO users(id,email,display_name,password_hash,role) VALUES(?,?,?,?,?)",
            ("owner-1", "owner@example.test", "Owner", "pbkdf2:test", "owner"),
        )
        self.db.execute(
            "INSERT INTO users(id,email,display_name,password_hash,role) VALUES(?,?,?,?,?)",
            ("admin-1", "admin@example.test", "Admin", "pbkdf2:test", "admin"),
        )
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(?,?)", (1, "Journal Horse"))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _intent(self, mutation_id, action, entity_type, entity_id, actor="owner-1"):
        self.db.execute(
            """
            INSERT INTO canonical_mutation_log(
              id,actor_user_id,action,entity_type,entity_id,request_id,search_status
            ) VALUES(?,?,?,?,?,?,'not_applicable')
            """,
            (mutation_id, actor, action, entity_type, entity_id, f"req-{mutation_id}"),
        )

    def test_committed_claim_survives_missing_audit_and_is_reconcilable(self):
        with self.db:
            self._intent("m-claim-create", "claim.create", "horse_claim", "claim-1")
            self.db.execute(
                "INSERT INTO horse_claims(id,horse_id,claimant_user_id,status) VALUES(?,?,?,'pending')",
                ("claim-1", 1, "owner-1"),
            )

        journal = self.db.execute(
            "SELECT status,audit_status,search_status,entity_id FROM canonical_mutation_log WHERE id='m-claim-create'"
        ).fetchone()
        self.assertEqual(journal["status"], "intent")
        self.assertEqual(journal["audit_status"], "pending")
        self.assertEqual(journal["search_status"], "not_applicable")
        self.assertEqual(journal["entity_id"], "claim-1")
        self.assertEqual(
            self.db.execute("SELECT status FROM horse_claims WHERE id='claim-1'").fetchone()[0],
            "pending",
        )

        # Simulate the later reconciliation path after the user-facing audit write failed.
        with self.db:
            self.db.execute(
                """
                INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,request_id,mutation_log_id)
                VALUES(?,?,?,?,?,?)
                """,
                ("owner-1", "claim.create", "horse_claim", "claim-1", "req-m-claim-create", "m-claim-create"),
            )
            self.db.execute(
                """
                UPDATE canonical_mutation_log
                SET status='committed',audit_status='complete',finalized_at=CURRENT_TIMESTAMP
                WHERE id='m-claim-create'
                """
            )
        self.assertEqual(
            self.db.execute("SELECT audit_status FROM canonical_mutation_log WHERE id='m-claim-create'").fetchone()[0],
            "complete",
        )
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM audit_events WHERE mutation_log_id='m-claim-create'").fetchone()[0],
            1,
        )

    def test_claim_review_is_single_winner_and_second_attempt_can_abort_journal(self):
        self.db.execute(
            "INSERT INTO horse_claims(id,horse_id,claimant_user_id,status) VALUES(?,?,?,'pending')",
            ("claim-review", 1, "owner-1"),
        )
        self.db.commit()

        with self.db:
            self._intent("m-review-1", "claim.approved", "horse_claim", "claim-review", actor="admin-1")
            first = self.db.execute(
                "UPDATE horse_claims SET status='approved',reviewed_by_user_id='admin-1' WHERE id=? AND status='pending'",
                ("claim-review",),
            )
        self.assertEqual(first.rowcount, 1)

        with self.db:
            self._intent("m-review-2", "claim.rejected", "horse_claim", "claim-review", actor="admin-1")
            second = self.db.execute(
                "UPDATE horse_claims SET status='rejected',reviewed_by_user_id='admin-1' WHERE id=? AND status='pending'",
                ("claim-review",),
            )
            self.assertEqual(second.rowcount, 0)
            self.db.execute(
                """
                UPDATE canonical_mutation_log
                SET status='aborted',audit_status='not_applicable',search_status='not_applicable'
                WHERE id='m-review-2'
                """
            )

        self.assertEqual(
            self.db.execute("SELECT status FROM horse_claims WHERE id='claim-review'").fetchone()[0],
            "approved",
        )
        self.assertEqual(
            self.db.execute("SELECT status FROM canonical_mutation_log WHERE id='m-review-2'").fetchone()[0],
            "aborted",
        )

    def test_change_request_journal_accepts_non_horse_entities(self):
        with self.db:
            self._intent("m-change", "change_request.create", "change_request", "change-1")
            self.db.execute(
                """
                INSERT INTO change_requests(id,submitted_by_user_id,horse_id,request_type,status,summary,submitted_at)
                VALUES(?,?,?,'update_horse','pending','Correct recorded color',CURRENT_TIMESTAMP)
                """,
                ("change-1", "owner-1", 1),
            )
            self.db.execute(
                "INSERT INTO change_request_items(change_request_id,field_name,proposed_value_json) VALUES(?,?,?)",
                ("change-1", "color_desc", '"Bay"'),
            )

        row = self.db.execute(
            "SELECT entity_type,entity_id,audit_status,search_status FROM canonical_mutation_log WHERE id='m-change'"
        ).fetchone()
        self.assertEqual(row["entity_type"], "change_request")
        self.assertEqual(row["entity_id"], "change-1")
        self.assertEqual(row["audit_status"], "pending")
        self.assertEqual(row["search_status"], "not_applicable")
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM change_request_items WHERE change_request_id='change-1'").fetchone()[0],
            1,
        )

    def test_atomic_parent_guard_rejects_opposite_edge_race(self):
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(?,?)", (2, "Second Horse"))
        self.db.commit()

        # R120: the portable single-branch recursive form (PostgreSQL requires
        # the CTE self-reference in exactly one recursive term; the old
        # father-UNION-mother two-branch form failed to parse on PG).
        guarded_update = """
        UPDATE horses SET father_id=?, row_version=row_version+1
        WHERE id=? AND row_version=?
          AND NOT EXISTS (
            WITH RECURSIVE ancestor_ids(id) AS (
              SELECT id FROM horses WHERE deleted_at IS NULL AND (id=? OR id=?)
              UNION
              SELECT CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END
                FROM horses h JOIN ancestor_ids a ON h.id=a.id,
                     (SELECT 0 AS k UNION ALL SELECT 1) side
                WHERE CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
            )
            SELECT 1 FROM ancestor_ids WHERE id=?
          )
        """
        first = self.db.execute(guarded_update, (2, 1, 1, 2, None, 1))
        self.assertEqual(first.rowcount, 1)
        # A second editor who validated against the old graph now tries the opposite edge.
        # At write time horse 1 already has horse 2 as a parent, so the recursive guard sees
        # horse 2 in proposed parent horse 1's ancestry and rejects the cycle.
        second = self.db.execute(guarded_update, (1, 2, 1, 1, None, 2))
        self.assertEqual(second.rowcount, 0)
        self.assertIsNone(self.db.execute("SELECT father_id FROM horses WHERE id=2").fetchone()[0])



if __name__ == "__main__":
    unittest.main()
