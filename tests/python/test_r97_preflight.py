"""Actual read-only SQLite preflight, no remote database and no fabricated data fixes."""
import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('r97_preflight',ROOT/'tools/r97-preflight.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'restored.sqlite'
        with sqlite3.connect(self.path) as db:
            for p in sorted((ROOT/'migrations').glob('*.sql')): db.executescript(p.read_text())
    def tearDown(self): self.tmp.cleanup()
    def test_empty_consistent_schema_passes_without_release_approval(self):
        result=module.inspect(self.path);self.assertTrue(result['ok']);self.assertFalse(result['release_approval'])
    def test_inspection_never_changes_database_bytes(self):
        before=hashlib.sha256(self.path.read_bytes()).hexdigest();module.inspect(self.path)
        self.assertEqual(before,hashlib.sha256(self.path.read_bytes()).hexdigest())
    def test_missing_file_is_not_created(self):
        absent=self.path.with_name('absent.sqlite')
        with self.assertRaises(ValueError):module.inspect(absent)
        self.assertFalse(absent.exists())
    def test_detects_unindexed_identity_without_printing_private_value(self):
        with sqlite3.connect(self.path) as db:db.execute("INSERT INTO horses(name_latin,register_no) VALUES('Secret real name','SECRET-IDENTIFIER')")
        result=module.inspect(self.path);self.assertEqual(result['warnings']['active_horses_with_unindexed_identifier_fields'],1)
        self.assertNotIn('SECRET',str(result));self.assertNotIn('Secret real',str(result))
    def test_r96_database_without_new_columns_can_be_inspected(self):
        path=self.path.with_name('r96.sqlite')
        with sqlite3.connect(path) as db:
            for p in sorted((ROOT/'migrations').glob('*.sql')):
                if p.name.startswith('0069'):continue
                db.executescript(p.read_text())
        self.assertTrue(module.inspect(path)['ok'])
