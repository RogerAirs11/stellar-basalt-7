"""Actual SQLite migration/preflight tests; no production data or write repair."""
import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("r98_preflight", ROOT / "tools/r98-preflight.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PreflightTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "restored.sqlite"
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("PRAGMA foreign_keys=ON")
            for path in sorted((ROOT / "migrations").glob("[0-9]*.sql")):
                if int(path.name[:4]) <= 69:
                    db.executescript(path.read_text())
            db.executescript("""INSERT INTO users(id,email,display_name,password_hash,role) VALUES('owner','owner@example.test','SYNTHETIC PRIVATE NAME','none','user');
              INSERT INTO issuers(id,slug,name) VALUES('issuer','synthetic','Synthetic issuer');
              INSERT INTO people(id,name_latin) VALUES(1,'SYNTHETIC PRIVATE PERSON');""")

    def mutate(self, sql):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript(sql)

    def rules(self):
        return {r['id']: r for r in MODULE.inspect(self.path)['rules']}

    def test_no_write_and_no_private_content(self):
        before = MODULE.digest(self.path)
        report = MODULE.inspect(self.path)
        self.assertEqual(report['blockers'], 0)
        self.assertEqual(before, MODULE.digest(self.path))
        self.assertNotIn('SYNTHETIC PRIVATE', json.dumps(report))
        self.assertNotIn('owner@example.test', json.dumps(report))

    def test_active_duplicate_blocks_migration(self):
        self.mutate("INSERT INTO issuer_memberships(id,issuer_id,user_id,role) VALUES('m1','issuer','owner','owner'),('m2','issuer','owner','attester')")
        self.assertEqual(self.rules()['issuer.duplicate_active']['severity'], 'blocker')
        with closing(sqlite3.connect(self.path)) as db, db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript((ROOT/'migrations/0071_r98_issuer_integrity.sql').read_text())

    def test_legacy_location_and_corrupt_publication_not_remapped(self):
        self.mutate("INSERT INTO directory_profiles(person_id,service_categories,province_code,publication_consent,published_at) VALUES(1,'[]','IR-01',1,'owner')")
        rules = self.rules()
        self.assertIn('directory.corrupt_publication', rules)
        self.assertIn('directory.unknown_creator', rules)
        self.assertIn('directory_profiles.location_unconfirmed', rules)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript((ROOT/'migrations/0070_r98_directory_integrity.sql').read_text())
            db.executescript((ROOT/'migrations/0071_r98_issuer_integrity.sql').read_text())
            row = db.execute('SELECT province_code,province_code_scheme,published_at FROM directory_profiles').fetchone()
        self.assertEqual(row, ('IR-01','legacy_r97_unconfirmed','owner'))
        self.assertIn('directory_profiles.location_unconfirmed', self.rules())

    def test_impossible_membership_dates_are_reviewed(self):
        self.mutate("INSERT INTO issuer_memberships(id,issuer_id,user_id,role,valid_from) VALUES('m','issuer','owner','owner','2026-02-30 00:00:00')")
        self.assertIn('issuer.invalid_dates', self.rules())

    def test_credential_dates_and_unsupported_authority(self):
        self.mutate("INSERT INTO person_credentials(person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state) VALUES(1,'coach','Synthetic','c1','2026-02-30','2020-01-01','issuer_attested')")
        self.assertIn('credentials.invalid_dates', self.rules())
        self.assertIn('credentials.unbound_authority', self.rules())

    def test_missing_database_is_not_created(self):
        missing = self.path.with_name('missing.sqlite')
        with self.assertRaises(FileNotFoundError):
            MODULE.inspect(missing)
        self.assertFalse(missing.exists())

    def test_live_wal_is_refused(self):
        Path(str(self.path)+'-wal').touch()
        with self.assertRaisesRegex(ValueError, 'quiescent'):
            MODULE.inspect(self.path)

    def test_cli_blocker_exit_and_json(self):
        self.mutate("INSERT INTO issuer_memberships(id,issuer_id,user_id,role) VALUES('m1','issuer','owner','owner'),('m2','issuer','owner','attester')")
        result = subprocess.run([sys.executable,str(ROOT/'tools/r98-preflight.py'),'--db',str(self.path)],capture_output=True,text=True)
        self.assertEqual(result.returncode,1,result.stderr)
        self.assertGreater(json.loads(result.stdout)['blockers'],0)

    def test_strict_review_exit(self):
        self.mutate("INSERT INTO directory_profiles(person_id,service_categories,province_code) VALUES(1,'[]','IR-01')")
        result = subprocess.run([sys.executable,str(ROOT/'tools/r98-preflight.py'),'--db',str(self.path),'--strict'],capture_output=True,text=True)
        self.assertEqual(result.returncode,3,result.stderr)

    def test_calendar_parser_rejects_normalized_dates(self):
        self.assertIsNone(MODULE.instant('2026-02-30 00:00:00'))
        self.assertIsNone(MODULE.instant('2026-10-05T25:00:00Z'))
        self.assertIsNone(MODULE.day('2027-02-29'))
        self.assertIsNotNone(MODULE.day('2028-02-29'))
