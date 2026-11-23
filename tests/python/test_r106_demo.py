"""Exercise the real fresh SQLite builder, never a production adapter."""
import hashlib
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('r106_demo', ROOT / 'tools/create-demo-database.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)

class R106DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.path = Path(cls.directory.name) / 'new-demo.sqlite'
        cls.manifest = demo.create(cls.path, date(2026,10,14))

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def connect(self):
        return closing(sqlite3.connect(self.path.as_uri()+'?mode=ro', uri=True))

    def test_fixture_counts_and_real_migrations(self):
        self.assertEqual(self.manifest['migration_count'], len(list((ROOT/'migrations').glob('*.sql'))))
        expected = {'horses':28,'people':8,'directory_profiles':8,'competitions':4,'competition_results':16,
                    'sales_listings':10,'workspace_collections':3,'workspace_tasks':7,'workspace_documents':3,
                    'horse_search_source':28,'analytics_snapshots':2}
        for table, count in expected.items():
            with self.subTest(table=table): self.assertEqual(self.manifest['counts'][table],count)

    def test_integrity_and_foreign_keys(self):
        with self.connect() as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_existing_demo_is_never_overwritten(self):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with self.assertRaises(FileExistsError): demo.create(self.path, date(2026,10,15))
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)

    def test_unrelated_database_is_never_modified(self):
        path = Path(self.directory.name)/'unrelated.sqlite'
        path.write_bytes(b'PRODUCTION MUST NOT BE OPENED')
        with self.assertRaises(FileExistsError): demo.create(path, date(2026,10,14))
        self.assertEqual(path.read_bytes(), b'PRODUCTION MUST NOT BE OPENED')
        with self.assertRaises(sqlite3.DatabaseError): demo.inspect(path)

    def test_unsafe_paths_rejected(self):
        for path in ['https://live.example/db.sqlite','libsql://live/db.sqlite','file:/live.sqlite',':memory:','live.db']:
            with self.subTest(path=path), self.assertRaises(ValueError): demo.target_path(path)

    def test_symlink_rejected(self):
        path = Path(self.directory.name)/'link.sqlite'
        try: path.symlink_to(self.path)
        except OSError: self.skipTest('symlink unavailable on this platform')
        with self.assertRaises(ValueError): demo.target_path(str(path))

    def test_marker_check_is_read_only(self):
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        result = demo.inspect(self.path)
        self.assertEqual(result['namespace'],'synthetic:r111')
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),before)

    def test_missing_check_does_not_create_database(self):
        path=Path(self.directory.name)/'absent.sqlite'
        with self.assertRaises(sqlite3.OperationalError): demo.inspect(path)
        self.assertFalse(path.exists())

    def test_no_contacts_payments_sessions_or_delivery_seeded(self):
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM sales_listings WHERE seller_contact_phone IS NOT NULL OR seller_contact_email IS NOT NULL').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM directory_profiles WHERE contact_value IS NOT NULL').fetchone()[0],0)
            for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%outbox%' OR name='billing_invoices' OR name='billing_payments')"):
                with self.subTest(table=table): self.assertEqual(db.execute(f'SELECT count(*) FROM {table}').fetchone()[0],0)

    def test_explicit_synthetic_names_and_disabled_password(self):
        with self.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM horses WHERE name_latin NOT LIKE 'DEMO %' OR description NOT LIKE 'SYNTHETIC %'").fetchone()[0],0)
            self.assertEqual(db.execute('SELECT DISTINCT password_hash FROM users').fetchall(),[('demo-route-only',)])
            self.assertEqual(db.execute('SELECT count(*) FROM horses WHERE id < 900000001 OR id > 900000028').fetchone()[0],0)

    def test_demo_includes_consent_negative_case(self):
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT publication_consent,count(*) FROM directory_profiles GROUP BY publication_consent ORDER BY 1').fetchall(),[(0,1),(1,7)])

    def test_overdue_current_future_and_completed_tasks(self):
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT due_date,status FROM workspace_tasks WHERE collection_id=970000001 ORDER BY id').fetchall(),[
                ('2026-10-12','open'),('2026-10-14','open'),('2026-10-17','open'),('2026-10-21','open'),('2026-10-13','done')])

    def test_indexes_and_analytics_are_ready(self):
        with self.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM horse_search_fts WHERE horse_search_fts MATCH 'DEMO'").fetchone()[0],28)
            self.assertEqual(db.execute('SELECT source_horse_count FROM analytics_snapshots ORDER BY key').fetchall(),[(28,),(28,)])
            self.assertGreater(db.execute('SELECT count(*) FROM registry_runtime_counters').fetchone()[0],0)

    def test_r108_genetic_placeholders_are_never_verified_laboratory_claims(self):
        with self.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM genetic_tests").fetchone()[0],9)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM genetic_tests WHERE id<=980000007 AND (verified<>0 OR provenance<>'demo' OR lab_name NOT LIKE 'DEMO %' OR certificate_media_id IS NOT NULL)").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT result FROM genetic_tests WHERE id<=980000007 AND horse_id=900000017 AND test_type='CA' ORDER BY id").fetchall(),[('N/CA',),('inconclusive',)])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM genetic_pairing_reviews r JOIN genetic_tests g ON g.id=r.test_id WHERE g.provenance='demo' AND r.assay_key='CA' AND r.result_snapshot=g.result AND r.test_type_snapshot=g.test_type AND r.review_state='accepted'").fetchone()[0],2)
            self.assertEqual(self.manifest['builder_revision'],'r113')

    def test_r108_breeding_placeholders_preserve_pedigree_and_planned_is_not_pregnant(self):
        with self.connect() as db:
            self.assertEqual(db.execute("SELECT outcome FROM breeding_records ORDER BY id").fetchall(),[('foaled',),('planned',)])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM breeding_records b JOIN horses h ON h.id=b.foal_id WHERE h.father_id<>b.sire_id OR h.mother_id<>b.dam_id").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM breeding_records WHERE provenance<>'demo' OR notes NOT LIKE 'SYNTHETIC %'").fetchone()[0],0)

if __name__ == '__main__': unittest.main()
