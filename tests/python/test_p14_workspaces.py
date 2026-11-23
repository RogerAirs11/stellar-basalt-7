"""P14 (R88 agent plan): farm workspace collections and delegated daily work
on a REAL in-memory SQLite database with ALL migrations applied.

Pins the acceptance criteria with real SQL:

  * a horse in two private collections changes NO ownership assertion —
    verified by FULL snapshot comparison of horse_people and
    horse_access_grants before/after membership writes (not just "no SQL
    matches the table name");
  * UNIQUE(collection_id, horse_id) + ON CONFLICT DO NOTHING: adding the
    same horse twice is one membership row; two collections are two rows;
  * staff assignments are action-scoped and live: the revocation UPDATE
    flips status and the live-grant query stops matching;
  * recurring occurrence creation is idempotent: the deterministic
    occurrence_key UNIQUE constraint makes a scheduler retry a no-op, and
    completing a recurring task materializes the next occurrence exactly
    once (same-transaction replay is a no-op);
  * collection delete soft-deletes the workspace and cascades nothing into
    canonical horses.

R95-N08: the production mutation SQL moved into
src/workspaces/mutationCommands.ts (row lock + mutation-time authority +
capacity + marker-gated audit). These tests verify the production markers in
THAT source and prove the schema-level invariants by executing equivalent
SQL against the real schema (the full atomic batches are proven by the
vitest integration suite on the same schema).

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import sqlite3
from r95_native_bridge import assert_native, assert_r97
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SOURCE = (ROOT / 'src' / 'api' / 'modules' / 'workspaces.ts').read_text()
MUTATIONS = (ROOT / 'src' / 'workspaces' / 'mutationCommands.ts').read_text()


def extract_backtick_block(source: str, marker: str) -> str:
    idx = source.index(marker)
    start = source.rindex('`', 0, idx)
    end = source.index('`', start + 1)
    return source[start + 1:end]


class P14Workspaces(unittest.TestCase):
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
        # Seed: two users, one horse, two collections owned by different users.
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('farm-a','a@example.invalid','A','x','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('farm-b','b@example.invalid','B','x','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('worker','w@example.invalid','W','x','user')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(101,'SHARED-HORSE')")
        self.db.execute("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Herd A','farm-a')")
        self.db.execute("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(2,'Herd B','farm-b')")

    def _snapshot_ownership(self):
        hp = self.db.execute("SELECT * FROM horse_people").fetchall()
        hg = self.db.execute("SELECT * FROM horse_access_grants").fetchall()
        return hp, hg

    # ------------------------------------------------------- ownership safety

    def test_horse_in_two_collections_changes_no_ownership_assertion(self):
        before = self._snapshot_ownership()
        # R95-N08: the production INSERT..SELECT carries the row lock, the
        # mutation-time authority and the capacity guard; its idempotency is
        # the same UNIQUE(collection_id, horse_id) + ON CONFLICT DO NOTHING.
        member_sql = extract_backtick_block(MUTATIONS, 'INSERT INTO workspace_collection_members(collection_id,horse_id,added_by_user_id,last_operation_id)')
        self.assertIn('ON CONFLICT(collection_id,horse_id) DO NOTHING', member_sql)
        self.assertIn('AND wc.deleted_at IS NULL', member_sql)  # archived workspaces accept no adds
        # Schema-level behavior with equivalent SQL on the real schema.
        equivalent = ("INSERT INTO workspace_collection_members(collection_id,horse_id,added_by_user_id,last_operation_id) "
                      "VALUES(?,?,?,?) ON CONFLICT(collection_id,horse_id) DO NOTHING")
        self.db.execute(equivalent, (1, 101, 'farm-a', 'op-1'))
        self.db.execute(equivalent, (2, 101, 'farm-b', 'op-2'))
        after = self._snapshot_ownership()
        self.assertEqual(before, after, 'membership writes must never touch ownership tables')
        rows = self.db.execute(
            "SELECT collection_id, COUNT(*) FROM workspace_collection_members WHERE horse_id=101 GROUP BY collection_id").fetchall()
        self.assertEqual(sorted(rows), [(1, 1), (2, 1)])

    def test_duplicate_membership_is_one_row(self):
        member_sql = extract_backtick_block(MUTATIONS, 'INSERT INTO workspace_collection_members(collection_id,horse_id,added_by_user_id,last_operation_id)')
        self.assertIn('NOT EXISTS(SELECT 1 FROM workspace_collection_members WHERE collection_id=? AND horse_id=?)', member_sql)
        equivalent = ("INSERT INTO workspace_collection_members(collection_id,horse_id,added_by_user_id,last_operation_id) "
                      "VALUES(?,?,?,?) ON CONFLICT(collection_id,horse_id) DO NOTHING")
        for _ in range(3):
            self.db.execute(equivalent, (1, 101, 'farm-a', 'op-dup'))
        count = self.db.execute("SELECT COUNT(*) FROM workspace_collection_members WHERE collection_id=1").fetchone()[0]
        self.assertEqual(count, 1)

    # --------------------------------------------------------- staff + revoke

    def test_staff_grant_is_action_scoped_and_revocation_is_live(self):
        # Execute the actual policy-interpolated TypeScript batch, including
        # authorized, unauthorized and replay cases; no copied weaker SQL.
        assert_r97(self,
            'authorized staff revoke is live, audited once and repeat safe',
            'unauthorized staff revocation does not proceed after a zero-row lock',
            'revoked staff reactivation counts as a new seat at capacity')

    # ------------------------------------------------- recurring task idempotency

    def test_occurrence_key_unique_makes_scheduler_retries_noops(self):
        insert = extract_backtick_block(MUTATIONS, 'INSERT INTO workspace_tasks(collection_id,horse_id,title,category,due_date,recurrence,recurrence_interval_days,created_by_user_id,assigned_to_user_id,occurrence_key,occurrence_index,last_operation_id,due_timezone,import_intent_key)')
        self.assertIn('ON CONFLICT(occurrence_key) DO NOTHING', insert)
        # R96-N09: the production insert carries the reminder timezone (the
        # due date is interpreted in the task's own IANA zone).
        self.assertIn('due_timezone', insert)
        # A scheduler retry of the exact same occurrence inserts nothing new.
        equivalent = ("INSERT INTO workspace_tasks(collection_id,horse_id,title,category,due_date,recurrence,recurrence_interval_days,"
                      "created_by_user_id,assigned_to_user_id,occurrence_key,occurrence_index,last_operation_id,due_timezone) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(occurrence_key) DO NOTHING")
        self.db.execute(equivalent, (1, 101, 'Farrier', 'farrier', '2026-11-01', 'custom_days', 30, 'farm-a', None, 'task:c1:Farrier:2026-11-01:i0', 'op-task', 'Asia/Tehran'))
        self.db.execute(equivalent, (1, 101, 'Farrier', 'farrier', '2026-11-01', 'custom_days', 30, 'farm-a', None, 'task:c1:Farrier:2026-11-01:i0', 'op-task-2', 'Asia/Tehran'))
        count = self.db.execute("SELECT COUNT(*) FROM workspace_tasks").fetchone()[0]
        self.assertEqual(count, 1)
        # The zone rides the row (default Asia/Tehran for pre-N09 semantics).
        tz = self.db.execute("SELECT due_timezone FROM workspace_tasks WHERE occurrence_key='task:c1:Farrier:2026-11-01:i0'").fetchone()[0]
        self.assertEqual(tz, 'Asia/Tehran')

    def test_complete_materializes_next_occurrence_once(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'successful task completion creates exactly one assigned recurrence', 'stale completion cannot enqueue a next recurrence')

    # ------------------------------------------------------------ delete rule

    def test_delete_soft_deletes_workspace_never_horses(self):
        assert_r97(self, 'authorized archive hides the workspace without deleting a canonical horse',
                   'unauthorized workspace archive does not proceed after a zero-row lock')

    # ------------------------------------------------- task category honesty

    def test_task_categories_are_reminders_only(self):
        # The CHECK constraint accepts only the four reminder categories; there
        # is no column for dosage/treatment/instruction anywhere.
        cols = [row[1] for row in self.db.execute("PRAGMA table_info(workspace_tasks)").fetchall()]
        for forbidden in ('dosage', 'treatment', 'instruction', 'medicine'):
            self.assertNotIn(forbidden, cols)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO workspace_tasks(collection_id,title,category,due_date,occurrence_key) "
                "VALUES(1,'X','vaccination_schedule','2026-11-01','k')")


if __name__ == '__main__':
    unittest.main()
