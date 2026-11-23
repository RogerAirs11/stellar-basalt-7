"""P13 (R88 agent plan): the transactional notification outbox on a REAL
in-memory SQLite database with ALL migrations applied.

Pins the guarantees the vitest structural locks can only assert shape-wise:

  * the migration chain applies cleanly through 0045 and the CHECK
    constraints actually reject invalid statuses / out-of-range quiet hours;
  * the same-batch doctrine: an outbox INSERT that shares a transaction with
    a business mutation disappears on ROLLBACK — a rolled-back mutation can
    never emit a message;
  * ON CONFLICT(event_key) DO NOTHING: replaying the same logical event
    enqueues exactly one row (idempotent enqueue);
  * the drain claim + CAS update moves queued -> provider_accepted on real
    SQL and NEVER touches `delivered` (delivery only via callback);
  * a verified callback is exactly-once: the CAS UPDATE lands once and the
    UNIQUE(event_key) delivery record rejects a replayed callback — billing
    counts can never double;
  * suppression is preference-driven and only ever marks non-essential rows.

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import sqlite3
from r95_native_bridge import assert_native
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The exact production statements (regex-extracted from src/notifications/outbox.ts
# so the replay suite stays source-anchored).
import re

SOURCE = (ROOT / 'src' / 'notifications' / 'outbox.ts').read_text()


def extract_backtick_block(marker: str) -> str:
    """Extract the SQL template that CONTAINS the marker (opening backtick is
    the last one BEFORE the marker text)."""
    idx = SOURCE.index(marker)
    start = SOURCE.rindex('`', 0, idx)
    end = SOURCE.index('`', start + 1)
    return SOURCE[start + 1:end]


class P13NotificationOutbox(unittest.TestCase):
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

    # ------------------------------------------------------------------ chain

    def test_migration_chain_applies_and_tables_exist(self):
        for table in ('notification_outbox', 'notification_deliveries',
                      'notification_callbacks', 'notification_preferences'):
            row = self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
            self.assertIsNotNone(row, table)

    def test_check_constraints_reject_invalid_states(self):
        self.db.execute(
            "INSERT INTO notification_outbox(event_key,channel,purpose,recipient_masked) "
            "VALUES('k1','email','service_request_notice','r***@x.co')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO notification_outbox(event_key,channel,purpose,recipient_masked) "
                "VALUES('k2','fax','service_request_notice','r***@x.co')")  # invalid channel
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE notification_outbox SET status='sent' WHERE event_key='k1'")  # ambiguous word is not a state
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO notification_preferences(user_id,quiet_hour_start,quiet_hour_end) "
                "VALUES('u1',24,NULL)")  # hour out of range

    # ------------------------------------------------------ same-batch (tx)

    def test_rollback_emits_no_message(self):
        self.db.execute('BEGIN')
        self.db.execute(
            "INSERT INTO notification_outbox(event_key,channel,purpose,recipient_masked) "
            "VALUES('tx:1','email','service_request_notice','r***@x.co')")
        self.db.execute('ROLLBACK')
        count = self.db.execute("SELECT COUNT(*) FROM notification_outbox").fetchone()[0]
        self.assertEqual(count, 0, 'a rolled-back mutation must leave no outbox row')

    def test_idempotent_enqueue_same_logical_event(self):
        stmt = ("INSERT INTO notification_outbox(event_key,channel,purpose,recipient_masked) "
                "VALUES(?,?,?,?) ON CONFLICT(event_key) DO NOTHING")
        self.db.execute(stmt, ('service_request:42:v3', 'email', 'service_request_notice', 'r***@x.co'))
        self.db.execute(stmt, ('service_request:42:v3', 'email', 'service_request_notice', 'r***@x.co'))
        count = self.db.execute("SELECT COUNT(*) FROM notification_outbox").fetchone()[0]
        self.assertEqual(count, 1, 'replayed logical event must not enqueue twice')

    # -------------------------------------------------------------- the drain

    def test_claim_and_accept_never_sets_delivered(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'concurrent outbox drains cannot dispatch an actively leased row twice')

    def test_not_due_rows_are_not_claimed(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'outbox future schedule is not dispatched and delivered retries remain refused')

    # ----------------------------------------------------- callback exactly-once

    def _deliver_via_callback(self):
        """Run the two production statements of recordDeliveryCallback."""
        move_sql = extract_backtick_block("SET status='delivered', delivered_at=CURRENT_TIMESTAMP")
        record_sql = extract_backtick_block('INSERT INTO notification_deliveries(event_key,provider,provider_message_id)')
        self.db.execute(move_sql, (None, 'k'))
        self.db.execute(record_sql, ('k', 'resend', 'm-1'))

    def test_verified_callback_is_exactly_once(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'correlated delivery callback is idempotent and forged signature changes no delivery state')

    def test_callback_on_unknown_event_key_creates_no_delivery_record(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'a valid callback for an unknown notification cannot create a phantom delivery')

    # ------------------------------------------------------------ suppression

    def test_suppression_marks_only_non_essential_rows(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'unsubscribed nonessential notifications suppress but essential security messages bypass', 'an essential OTP bypasses marketing unsubscribe and quiet preferences')

    # ------------------------------------------------------ operator retry

    def test_operator_retry_never_rewinds_delivered(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'notification retry never audits losing or unauthorized updates', 'outbox future schedule is not dispatched and delivered retries remain refused')


if __name__ == '__main__':
    unittest.main()
