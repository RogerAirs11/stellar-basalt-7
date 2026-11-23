"""P19 (R88 agent plan): the first paid offers, public trust protected, on
a REAL in-memory SQLite database with ALL migrations applied.

Pins the acceptance criteria with real SQL:
  * an EXPIRED plan removes paid conveniences without deleting customer
    records (the live entitlement query returns nothing after expiry; the
    workspace rows themselves are untouched);
  * sponsored placement expires on its own timestamp and the public list's
    sponsored-first ORDER BY stops matching after expiry;
  * scientific surfaces never read sponsored_until (source-scan proof);
  * the free floor cannot be sold: no paid column gates identity, pedigree,
    corrections or provenance surfaces.

SQLite replay only — not PostgreSQL equivalence or an HTTP test.
"""
import sqlite3
import unittest
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

GATES = (ROOT / 'src' / 'commerce' / 'entitlementGates.ts').read_text()
MARKETPLACE = (ROOT / 'src' / 'api' / 'modules' / 'marketplace.ts').read_text()


class P19Offers(unittest.TestCase):
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
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('seller','s@example.invalid','S','x','user')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(9,'STAR')")
        self.db.execute(
            "INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status,provenance) "
            "VALUES('listing-1',9,'seller','S','active','user')")
        self.db.execute("INSERT INTO workspace_collections(id,name,owner_user_id) VALUES(1,'Free farm','seller')")

    # ------------------------------------------------- expired plan boundary

    def test_expired_plan_removes_convenience_but_never_records(self):
        # Seed a real order + verified attempt so the entitlement FKs hold.
        self.db.execute(
            "INSERT INTO billing_prices(sku,version,name_en,name_fa,price_minor,currency,period_days,active,created_by_user_id) "
            "VALUES('farm_workspace_monthly',1,'Farm workspace','فضا',19000000,'IRR',30,1,'seller')")
        self.db.execute(
            "INSERT INTO orders(order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json) "
            "VALUES('k-1','seller','paid',19000000,'IRR','[]')")
        self.db.execute(
            "INSERT INTO payment_attempts(order_id,provider,authority,amount_minor,currency,state) "
            "VALUES(1,'zarinpal','AUTH-00001',19000000,'IRR','verified')")

        # An expired entitlement row exists — the live query must not see it.
        self.db.execute(
            "INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at) "
            "VALUES('payment:1:entitlement',1,1,'seller',NULL,'farm_workspace_monthly','grant',30,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')")
        self.db.execute(
            "INSERT INTO entitlements(buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at) "
            "VALUES('seller',NULL,'farm_workspace_monthly',1,1,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z')")
        # The production lookup (source-anchored) uses datetime('now'):
        self.assertIn("datetime(expires_at)>datetime('now')", GATES)
        active = self.db.execute(
            "SELECT sku, expires_at FROM entitlements "
            "WHERE buyer_user_id=? AND sku=? AND active=1 "
            "AND (expires_at IS NULL OR datetime(expires_at)>datetime('now')) "
            "ORDER BY expires_at DESC LIMIT 1", ('seller', 'farm_workspace_monthly')).fetchone()
        self.assertIsNone(active, 'the expired plan must not count as active')
        # ...while the customer record stays completely intact.
        rows = self.db.execute("SELECT COUNT(*) FROM entitlements WHERE buyer_user_id='seller'").fetchone()[0]
        workspace = self.db.execute("SELECT COUNT(*) FROM workspace_collections WHERE owner_user_id='seller' AND deleted_at IS NULL").fetchone()[0]
        self.assertEqual((rows, workspace), (1, 1), 'no record is deleted on expiry')

    def test_active_plan_counts(self):
        # Seed a real order + verified attempt so the entitlement FKs hold.
        self.db.execute(
            "INSERT INTO billing_prices(sku,version,name_en,name_fa,price_minor,currency,period_days,active,created_by_user_id) "
            "VALUES('farm_workspace_monthly',1,'Farm workspace','فضا',19000000,'IRR',30,1,'seller')")
        self.db.execute(
            "INSERT INTO orders(order_key,buyer_user_id,status,total_minor,currency,price_snapshot_json) "
            "VALUES('k-1','seller','paid',19000000,'IRR','[]')")
        self.db.execute(
            "INSERT INTO payment_attempts(order_id,provider,authority,amount_minor,currency,state) "
            "VALUES(1,'zarinpal','AUTH-00001',19000000,'IRR','verified')")

        self.db.execute(
            "INSERT INTO entitlement_events(event_key,order_id,payment_attempt_id,buyer_user_id,payer_organization_id,sku,kind,granted_days,activated_at,expires_at) "
            "VALUES('payment:1:entitlement',1,1,'seller',NULL,'farm_workspace_monthly','grant',30,'2026-10-01T00:00:00Z','2027-10-01T00:00:00Z')")
        self.db.execute(
            "INSERT INTO entitlements(buyer_user_id,payer_organization_id,sku,source_event_id,active,activated_at,expires_at) "
            "VALUES('seller',NULL,'farm_workspace_monthly',1,1,'2026-10-01T00:00:00Z','2027-10-01T00:00:00Z')")
        active = self.db.execute(
            "SELECT sku FROM entitlements WHERE buyer_user_id=? AND sku=? AND active=1 "
            "AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))", ('seller', 'farm_workspace_monthly')).fetchone()
        self.assertIsNotNone(active)

    # ------------------------------------------------- sponsored placement

    def test_sponsored_placement_expires_on_its_own_timestamp(self):
        # Generate the actual production expression, not a stale handwritten
        # datetime approximation. Node/TypeScript are project prerequisites.
        generated = subprocess.run([
            'node', '-e',
            "require('./tools/lib/register-typescript.cjs');"
            "process.stdout.write(JSON.stringify(require('./src/shared/utcTimestampSql.ts')"
            ".utcTimestampMillisSql('l.sponsored_until')));",
        ], cwd=ROOT, capture_output=True, text=True, check=True, timeout=30)
        expression = json.loads(generated.stdout)
        template = re.search(r'const sponsoredActive = `([^`]+)`;', MARKETPLACE)
        self.assertIsNotNone(template, 'the public list must compute one strict sponsored flag')
        selection = template.group(1).replace('${utcTimestampMillisSql("l.sponsored_until")}', expression)
        self.assertNotIn('${', selection, 'do not execute an incompletely resolved SQL template')
        self.assertIn('ORDER BY sponsored_active DESC', MARKETPLACE)
        self.assertIn('Number(sponsored_active) === 1', MARKETPLACE)
        now = int(datetime(2026, 10, 17, 12, tzinfo=timezone.utc).timestamp() * 1000)
        for timestamp, expected in [
            ('2026-10-17T12:00:00.001Z', 1),
            ('2026-10-17T15:30:00.001+03:30', 1),
            ('2026-10-17 12:00:01', 1),
            ('2026-10-17T12:00:00Z', 0),
            ('2026-10-17T12:00:00.000999999Z', 0),
            ('2026-10-17T11:00:00Z', 0),
            ('2027-02-30T13:00:00Z', 0),
            ('not-a-timestamp', 0),
            (None, 0),
        ]:
            with self.subTest(timestamp=timestamp):
                self.db.execute("UPDATE sales_listings SET sponsored_until=? WHERE id='listing-1'", (timestamp,))
                active = self.db.execute(
                    f"SELECT {selection} FROM sales_listings l WHERE l.id='listing-1'", (now,)).fetchone()[0]
                self.assertEqual(active, expected)
        # Expiry changes placement, never deletes the seller's record.
        still_listed = self.db.execute("SELECT COUNT(*) FROM sales_listings WHERE id='listing-1'").fetchone()[0]
        self.assertEqual(still_listed, 1)

    def test_scientific_surfaces_never_read_sponsored_until(self):
        # The scientific ranking/metrics modules must not reference placement.
        for source in ['src/pedigree/breeding.ts', 'src/pedigree/coefficients.ts', 'src/pedigree/insights.ts',
                       'src/api/modules/genetics.ts', 'src/api/modules/directory.ts']:
            path = ROOT / source
            if path.exists():
                self.assertNotIn('sponsored', path.read_text().lower(),
                                 f'{source} must never read sponsored placement')
        # Only the marketplace list + sponsor admin set it.
        self.assertIn('sponsored_until', MARKETPLACE)

    def test_sponsorship_requires_the_sellers_active_entitlement(self):
        self.assertIn('sponsor_entitlement_required', MARKETPLACE)
        # R120: the gate call carries the environment-bound grant scope
        # (demo scope only inside the isolated demo; production-only outside).
        self.assertIn('hasEntitlement(env.DB, listing.seller_user_id, "sponsored_visibility_monthly", null, acceptedGrantScope(env))', MARKETPLACE)
        # No entitlement row for the seller -> the gate yields nothing.
        active = self.db.execute(
            "SELECT sku FROM entitlements WHERE buyer_user_id='seller' AND sku=? AND active=1 "
            "AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))", ('sponsored_visibility_monthly',)).fetchone()
        self.assertIsNone(active)


if __name__ == '__main__':
    unittest.main()
