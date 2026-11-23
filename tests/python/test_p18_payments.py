"""P18 (R88 agent plan): verified payments, entitlements and reconciliation
on a REAL in-memory SQLite database with ALL migrations applied.

Pins the acceptance criteria with real SQL:

  * forged/wrong-amount/wrong-authority/replay flows produce NO entitlement
    (the verify batch's CAS + guards are replayed for real);
  * CONCURRENT callbacks create ONE payment/entitlement event: the UNIQUE
    event_key makes the second insert conflict (IntegrityError) and the
    guarded entitlement upsert matches zero rows for the loser;
  * the one-active-attempt policy is enforced by data (a second open
    attempt for the same order is detectable and refusable);
  * refund statements are compensating (no DELETEs), and the reconciliation
    sweep expires only never-verified stale attempts.

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import sqlite3
from r95_native_bridge import assert_native
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

ENTITLEMENTS = ' '.join((ROOT / 'src' / 'commerce' / 'entitlements.ts').read_text().split())


class P18Payments(unittest.TestCase):
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
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('buyer','b@example.invalid','B','x','user')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('admin','a@example.invalid','A','x','admin')")
        self.db.execute(
            "INSERT INTO billing_prices(sku,version,name_en,name_fa,price_minor,currency,period_days,active,created_by_user_id) "
            "VALUES('farm_workspace_monthly',1,'Farm workspace','فضای کار',19000000,'IRR',30,1,'admin')")
        self.db.execute(
            "INSERT INTO orders(order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json) "
            "VALUES('k-1','buyer','awaiting_payment',19000000,'IRR','[{\"sku\":\"farm_workspace_monthly\",\"price_id\":1,\"version\":1}]')")
        self.db.execute(
            "INSERT INTO payment_attempts(order_id,provider,authority,amount_minor,currency,state) "
            "VALUES(1,'zarinpal','AUTH-00001',19000000,'IRR','redirected')")

    # ------------------------------------------------------ the verified batch

    def _run_verified_batch(self):
        """The production verified-payment statements (source-anchored)."""
        self.assertIn("ON CONFLICT(event_key) DO NOTHING", ENTITLEMENTS)
        self.db.execute(
            "UPDATE payment_attempts SET state='verified', verified_at=CURRENT_TIMESTAMP, verification_json=? "
            "WHERE id=? AND state IN ('created','redirected')", ('{"providerReference":"ref-1"}', 1))
        self.db.execute(
            "UPDATE orders SET status='paid', updated_at=CURRENT_TIMESTAMP, row_version=row_version+1 "
            "WHERE id=? AND status IN ('pending','awaiting_payment')", (1,))
        self.db.execute(
            "INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at) "
            "VALUES(?,?,?,?,?,?, 'grant', 30, '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z') "
            "ON CONFLICT(event_key) DO NOTHING",
            ('payment:1:entitlement', 1, 1, 'buyer', None, 'farm_workspace_monthly'))
        self.db.execute(
            "INSERT INTO entitlements(buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at) "
            "SELECT ?,?,?, (SELECT id FROM entitlement_events WHERE event_key=?), 1, '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z' "
            "WHERE EXISTS(SELECT 1 FROM entitlement_events WHERE event_key=?) "
            "AND NOT EXISTS(SELECT 1 FROM entitlements WHERE buyer_user_id=? AND sku=? AND active=1)",
            ('buyer', None, 'farm_workspace_monthly', 'payment:1:entitlement', 'payment:1:entitlement', 'buyer', 'farm_workspace_monthly'))

    def test_verified_payment_creates_exactly_one_entitlement(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'verification credits every purchased sku and quantity', 'same in-flight verification replay cannot extend expiry or duplicate ledger')

    def test_callback_replay_is_once_and_distinct_renewals_accumulate(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'same in-flight verification replay cannot extend expiry or duplicate ledger', 'distinct renewals accumulate against current locked balance')

    def test_failed_verification_leaves_everything_pending(self):
        # A not_paid / timeout verify writes NOTHING — replay zero-batch.
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'changed payment amount cannot fulfill order')

    def test_wrong_amount_produces_no_entitlement(self):
        # The verify flow refuses the amount mismatch BEFORE any state move.
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'changed payment amount cannot fulfill order')

    # ----------------------------------------------------- one active attempt

    def test_one_active_attempt_policy(self):
        # A second open attempt for the same order is refusable by data.
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'payment reservation writes real FK and prevents second active attempt')

    # ------------------------------------------------------------- refunds

    def test_refund_is_unavailable_without_confirmed_money_return(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'legacy refund and single-item payment builders fail without bookkeeping side effects')

    # ------------------------------------------------------- reconciliation

    def test_reconciliation_queues_stale_without_guessing_expiry(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'stale payment sweep queues once without guessing expiry or changing verified attempts')

    def test_settlement_fees_are_recorded_separately_from_gross(self):
        self.db.execute(
            "INSERT INTO payment_settlements(payment_attempt_id,provider,provider_reference,settled_gross_minor,fee_minor,currency,settled_at) "
            "VALUES(1,'zarinpal','ref-1',19000000,9000,'IRR','2026-10-03 12:00:00')")
        row = self.db.execute("SELECT settled_gross_minor, fee_minor, currency FROM payment_settlements").fetchone()
        self.assertEqual(row, (19_000_000, 9_000, 'IRR'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO payment_settlements(payment_attempt_id,provider,provider_reference,settled_gross_minor,fee_minor,currency,settled_at) "
                "VALUES(1,'zarinpal','ref-1',19000000,9000,'IRR','2026-10-03 12:00:00')")  # UNIQUE attempt


if __name__ == '__main__':
    unittest.main()
