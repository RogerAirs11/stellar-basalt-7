"""Actual read-only migration preflight, including pre-R95 duplicates."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('r95_preflight', ROOT / 'tools/r95-preflight.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class R95Preflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'restored.sqlite'
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        for file in sorted((ROOT / 'migrations').glob('[0-9]*.sql')):
            if int(file.name[:4]) <= 51:
                self.db.executescript(file.read_text())
        self.db.execute("INSERT INTO users(id,email,display_name,password_hash,role) VALUES('operator','test@example.invalid','Test','not-a-password','admin')")
        self.db.commit()

    def test_preflight_never_changes_database_bytes(self):
        before = self.path.read_bytes()
        self.assertTrue(MODULE.inspect(self.path)['ok'])
        self.assertEqual(before, self.path.read_bytes())

    def test_duplicate_prices_block_instead_of_silent_financial_repair(self):
        for version in (1, 2):
            self.db.execute("INSERT INTO billing_prices(sku,version,name_en,name_fa,price_minor,created_by_user_id) VALUES('farm',?,'Farm','Farm',10,'operator')", (version,))
        self.db.commit()
        report = MODULE.inspect(self.path)
        self.assertFalse(report['ok'])
        self.assertEqual(report['blockers']['duplicate_live_price_versions'], 1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM billing_prices').fetchone()[0], 2)

    def test_missing_file_is_not_created(self):
        path = self.path.with_name('missing.sqlite')
        with self.assertRaises(ValueError):
            MODULE.inspect(path)
        self.assertFalse(path.exists())

    def test_missing_financial_schema_is_a_blocker(self):
        path = self.path.with_name('empty.sqlite')
        sqlite3.connect(path).close()
        self.assertFalse(MODULE.inspect(path)['ok'])
