"""P17 (R88 agent plan): billing catalog, orders and unambiguous money on a
REAL in-memory SQLite database with ALL migrations applied.

Pins the acceptance criteria with real SQL:

  * a 1,900,000-toman plan is stored as 19,000,000 minor IRR with
    currency='IRR' — the CHECK constraint refuses any other currency, so the
    plan can never be charged as 1,900,000 rial;
  * repricing inserts a NEW version row and supersedes the old one — the
    existing order's total and price snapshot are byte-identical after the
    catalog change (frozen by construction: nothing rewrites orders);
  * UNIQUE(buyer_user_id, order_key): duplicate submission creates ONE order;
  * the CHECK constraints refuse invalid statuses, zero quantities and
    unsafe money shapes at the database layer too.

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import sqlite3
from r95_native_bridge import assert_native
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SOURCE = ' '.join((ROOT / 'src' / 'api' / 'modules' / 'billing.ts').read_text().split())


class P17Billing(unittest.TestCase):
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
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('admin','a@example.invalid','A','x','admin')")
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('buyer','b@example.invalid','B','x','user')")

    def _create_price_v1(self):
        self.db.execute(
            "INSERT INTO billing_prices(sku,version,name_en,name_fa,price_minor,currency,period_days,active,created_by_user_id) "
            "VALUES('farm_workspace_monthly',1,'Farm workspace','فضای کار مزرعه',19000000,'IRR',30,1,'admin')")

    def _create_order(self, key='order-key-1234', total=19_000_000):
        snapshot = '[{"sku":"farm_workspace_monthly","price_id":1,"version":1,"unit_minor":19000000,"quantity":1,"line_total_minor":19000000}]'
        self.db.execute(
            "INSERT INTO orders(order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json) "
            "VALUES(?,'buyer','pending',?,'IRR',?)", (key, total, snapshot))
        order_id = self.db.execute("SELECT id FROM orders WHERE order_key=?", (key,)).fetchone()[0]
        self.db.execute(
            "INSERT INTO order_lines(order_id,price_id,sku,title_en,title_fa,unit_minor,quantity,line_total_minor) "
            "VALUES(?,1,'farm_workspace_monthly','Farm workspace','فضای کار مزرعه',19000000,1,19000000)", (order_id,))
        return order_id

    # ------------------------------------------------------------ money units

    def test_toman_plan_is_stored_as_19m_irr_and_only_irr_passes(self):
        self._create_price_v1()
        row = self.db.execute("SELECT price_minor, currency FROM billing_prices WHERE sku='farm_workspace_monthly'").fetchone()
        self.assertEqual(row, (19_000_000, 'IRR'))
        # The CHECK constraint refuses a non-IRR currency outright.
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO billing_prices(sku,version,name_en,name_fa,price_minor,currency,active,created_by_user_id) "
                "VALUES('x_sku',1,'X','X',100,'TOMAN',1,'admin')")
        # And a 1,900,000 "minor" value (the rial-confusion bug) is a
        # DIFFERENT amount than the toman plan's stored minor value.
        self.assertNotEqual(row[0], 1_900_000)

    # ------------------------------------------------- immutable price versions

    def test_reprice_creates_a_new_version_and_supersedes_never_mutates(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'repricing supersedes a version without changing a frozen order', 'racing price version rolls back superseding the winning price')

    def test_catalog_change_never_mutates_an_existing_order(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'repricing supersedes a version without changing a frozen order')

    # ------------------------------------------------------- order idempotency

    def test_duplicate_order_key_creates_one_order(self):
        self._create_price_v1()
        self._create_order(key='order-key-1234')
        with self.assertRaises(sqlite3.IntegrityError):
            self._create_order(key='order-key-1234')
        count = self.db.execute("SELECT COUNT(*) FROM orders WHERE order_key='order-key-1234'").fetchone()[0]
        self.assertEqual(count, 1)

    # ---------------------------------------------------- database-layer guards

    def test_check_constraints_refuse_invalid_states(self):
        self._create_price_v1()
        order_id = self._create_order()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE orders SET status='shipped' WHERE id=?", (order_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE orders SET total_minor=-1 WHERE id=?", (order_id,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO order_lines(order_id,price_id,sku,title_en,title_fa,unit_minor,quantity,line_total_minor) "
                "VALUES(?,1,'x','X','X',100,0,0)", (order_id,))  # quantity 0

    def test_cancel_is_a_state_change_never_a_delete(self):
        # R95: execute the actual production command, not a copy of its SQL.
        assert_native(self, 'cancellation without attempt is atomic and replay safe', 'unresolved attempt blocks cancellation with no false audit event')


def insert_stmt():
    return ("INSERT INTO billing_prices(sku,version,name_en,name_fa,description,price_minor,currency,period_days,active,created_by_user_id) "
            "VALUES(?,?,?,?,?,?,?,NULLIF(?,''),1,?)")


if __name__ == '__main__':
    unittest.main()
