"""Execute the exported production grant query against the migrated SQLite schema.
This is not PostgreSQL equivalence, HTTP authorization, or a transaction-race test.
"""
import re
import sqlite3
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class R88GrantSql(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for p in sorted((ROOT/'migrations').glob('*.sql')):
            self.db.executescript(p.read_text())
        cols = self.db.execute('PRAGMA table_info(users)').fetchall()
        # Original user schema requires these fields, intentionally not a permissive fake table.
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('u','demo@example.invalid','DEMO','unused','user')")
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(1,'DEMO')")
        self.db.execute("INSERT INTO organizations(id,slug,name_latin) VALUES(1,'demo','DEMO')")
        self.db.execute("INSERT INTO organization_memberships(id,organization_id,user_id,valid_from) VALUES(1,1,'u','2026-01-01 00:00:00')")
        self.db.execute("INSERT INTO horse_access_grants(id,horse_id,grantee_organization_id,relationship,actions,valid_from) VALUES('g',1,1,'seller','create_listing','2026-01-01 00:00:00')")
        self.sql = re.search(r'HORSE_GRANT_LOOKUP_SQL = `([\s\S]*?)`', (ROOT/'src/access/horseAccess.ts').read_text()).group(1)
    def tearDown(self): self.db.close()
    def query(self):
        now = '2026-10-03T12:00:00.000Z'
        return self.db.execute(self.sql, (1,now,'u','u',now,now)).fetchall()
    def test_active_membership_resolves(self): self.assertEqual(len(self.query()), 1)
    def test_future_membership_is_not_effective(self):
        self.db.execute("UPDATE organization_memberships SET valid_from='2026-10-04T00:00:00Z'")
        self.assertEqual(self.query(), [])
    def test_suspended_organization_denies(self):
        self.db.execute("UPDATE organizations SET status='suspended'")
        self.assertEqual(self.query(), [])
    def test_closed_organization_denies(self):
        self.db.execute("UPDATE organizations SET status='closed'")
        self.assertEqual(self.query(), [])
    def test_revoked_membership_denies(self):
        self.db.execute("UPDATE organization_memberships SET revoked_at='2026-10-02 00:00:00'")
        self.assertEqual(self.query(), [])
    def test_malformed_expiry_denies(self):
        self.db.execute("UPDATE organization_memberships SET valid_until='garbage'")
        self.assertEqual(self.query(), [])
    def test_malformed_start_denies(self):
        self.db.execute("UPDATE organization_memberships SET valid_from='garbage'")
        self.assertEqual(self.query(), [])
    def test_sql_timestamp_expiry_is_compared_by_instant_not_lexical_format(self):
        self.db.execute("UPDATE organization_memberships SET valid_until='2026-10-03 13:00:00'")
        self.assertEqual(len(self.query()), 1)
    def test_exact_expiry_denies(self):
        self.db.execute("UPDATE organization_memberships SET valid_until='2026-10-03 12:00:00'")
        self.assertEqual(self.query(), [])
    def test_revoked_grant_denies(self):
        self.db.execute("UPDATE horse_access_grants SET revoked_at='2026-10-02 00:00:00'")
        self.assertEqual(self.query(), [])

if __name__ == '__main__': unittest.main()
