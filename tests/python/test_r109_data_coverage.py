import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

spec=importlib.util.spec_from_file_location('coverage_audit',Path(__file__).resolve().parents[2]/'tools/audit-data-coverage.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CoverageAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name)/'test.sqlite'
    def create(self,sql):
        with closing(sqlite3.connect(self.path)) as db:
            db.executescript(sql);db.commit()
    def test_readonly_and_no_private_values(self):
        self.create("CREATE TABLE horses(id INTEGER, name_native TEXT, father_id INTEGER, mother_id INTEGER, deleted_at TEXT);INSERT INTO horses VALUES(1,'PRIVATE_SENTINEL',2,NULL,NULL),(2,'PRIVATE_SENTINEL',NULL,NULL,NULL);")
        before=hashlib.sha256(self.path.read_bytes()).hexdigest();report=module.audit(self.path)
        self.assertEqual(report['active_horses'],2)
        self.assertEqual(report['horse_fields']['name_native']['recorded'],2)
        self.assertNotIn('PRIVATE_SENTINEL',json.dumps(report))
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),before)
    def test_adapts_missing_schema_without_fabricated_zeros(self):
        self.create('CREATE TABLE unrelated(id INTEGER);');report=module.audit(self.path)
        self.assertIsNone(report['tables']['genetic_tests']['rows']);self.assertFalse(report['tables']['horses']['available'])
    def test_explicit_synthetic_marker(self):
        self.create("CREATE TABLE local_demo_manifest(id INTEGER, namespace TEXT);INSERT INTO local_demo_manifest VALUES(1,'synthetic:r106');")
        self.assertIn('synthetic',module.audit(self.path)['classification'])
    def test_parent_quality_counts_no_invented_ancestors(self):
        self.create('CREATE TABLE horses(id INTEGER, father_id INTEGER, mother_id INTEGER);INSERT INTO horses VALUES(1,1,99),(2,1,1);')
        p=module.audit(self.path)['pedigree'];self.assertEqual(p['self_parent_rows'],1);self.assertEqual(p['same_parent_both_roles'],1);self.assertEqual(p['dangling_dam_references'],1)
    def test_retests_not_automatically_verified_or_resolved(self):
        self.create("CREATE TABLE genetic_tests(horse_id INTEGER,test_type TEXT,verified INTEGER);INSERT INTO genetic_tests VALUES(1,'CA',0),(1,'CA',1);")
        g=module.audit(self.path)['genetics'];self.assertEqual(g['rows_marked_verified'],1);self.assertEqual(g['horse_assay_groups_with_multiple_records'],1);self.assertIn('NOT independently',g['warning'])
    def test_nonexistent_snapshot_is_never_created(self):
        with self.assertRaises(ValueError):module.audit(self.path)
        self.assertFalse(self.path.exists())
    def test_symlink_is_refused(self):
        self.create('CREATE TABLE test(id INTEGER);');link=self.path.with_name('link.sqlite');link.symlink_to(self.path)
        with self.assertRaises(ValueError):module.audit(link)
    def test_invalid_time_budgets_are_refused(self):
        self.create('CREATE TABLE test(id INTEGER);')
        for value in (0,-1,float('nan'),float('inf'),301):
            with self.subTest(value=value),self.assertRaises(ValueError):module.audit(self.path,value)
    def test_quoted_identifier_is_escaped(self):
        self.assertEqual(module.identifier('a"b'),'"a""b"')
