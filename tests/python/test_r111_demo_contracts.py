"""Real-schema synthetic fixture, route, calendar and reset safety contracts."""
import importlib.util
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"tools"))


def module(name, file):
    spec=importlib.util.spec_from_file_location(name,ROOT/"tools"/file)
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


demo=module("r111_demo_builder","create-demo-database.py")
reset=module("r111_demo_reset","reset-showcase.py")


class DemoContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.path=Path(cls.temp.name)/"fixture.sqlite"
        cls.manifest=demo.create(cls.path,date(2026,10,17))

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_all_listing_ids_match_every_exact_production_route(self):
        source=(ROOT/"src/api/routes.ts").read_text()
        for name,suffix in [("marketDetailMatch",""),("marketStatusMatch","/status"),("marketRenewMatch","/renew"),("marketInquiryMatch","/inquiries")]:
            pattern=re.search(r"const "+name+r" = path\.match\(/(.+?)/\);",source).group(1).replace(r"\/","/")
            for listing in self.manifest["stories"]["listings"]:
                self.assertRegex(listing["detail_path"]+suffix,pattern)
        self.assertEqual(len(self.manifest["stories"]["listings"]),10)

    def test_seasons_and_chronology_use_canonical_conversion(self):
        with closing(sqlite3.connect(self.path)) as db:
            rows=db.execute("SELECT covering_date,season FROM breeding_records ORDER BY id").fetchall()
            self.assertEqual([s for _,s in rows],demo.canonical_seasons([date.fromisoformat(d) for d,_ in rows]))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM breeding_records b JOIN horses h ON h.id=b.foal_id WHERE h.father_id<>b.sire_id OR h.mother_id<>b.dam_id").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM breeding_records b JOIN horses s ON s.id=b.sire_id JOIN horses d ON d.id=b.dam_id WHERE CAST(substr(b.covering_date,1,4) AS INTEGER)<s.birth_year+3 OR CAST(substr(b.covering_date,1,4) AS INTEGER)<d.birth_year+3").fetchone()[0],0)
        self.assertEqual((date(2021,4,17)-date(2020,5,12)).days,340)
        self.assertEqual(demo.canonical_seasons([date(2026,3,20),date(2026,3,21)]),[1404,1405])

    def test_fixed_as_of_rebuild_has_identical_logical_database_and_manifest(self):
        path=Path(self.temp.name)/"same-baseline.sqlite"
        other=demo.create(path,date(2026,10,17))
        self.assertEqual({k:v for k,v in self.manifest.items() if k!='path'},{k:v for k,v in other.items() if k!='path'})
        with closing(sqlite3.connect(self.path)) as a, closing(sqlite3.connect(path)) as b:
            self.assertEqual(list(a.iterdump()),list(b.iterdump()))
            from build_analytics_snapshot import source_revision
            revision=source_revision(a)[0]
            self.assertEqual(a.execute("SELECT DISTINCT source_revision FROM analytics_snapshots").fetchall(),[(revision,)])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),hashlib.sha256(path.read_bytes()).hexdigest())

    def test_symlinked_parent_and_direct_create_are_rejected(self):
        link=Path(self.temp.name)/"linked"
        try:link.symlink_to(Path(self.temp.name),target_is_directory=True)
        except OSError:self.skipTest('symlinks unavailable')
        with self.assertRaises(ValueError):demo.create(link/"unsafe.sqlite",date(2026,10,17))
        with self.assertRaises(ValueError):demo.inspect(link/"fixture.sqlite")
        self.assertFalse((Path(self.temp.name)/"unsafe.sqlite").exists())

    def test_real_media_bytes_and_review_states_are_complete(self):
        import hashlib
        with closing(sqlite3.connect(self.path)) as db:
            for item in self.manifest['stories']['media']['items']:
                data=b''.join(row[0] for row in db.execute("SELECT data FROM horse_media_blobs WHERE media_id=? ORDER BY chunk",(item['id'],)))
                self.assertEqual(len(data),item['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(),item['sha256'])
            self.assertEqual(db.execute("SELECT count(*) FROM genetic_tests WHERE verified=1 AND provenance='demo' AND lab_name LIKE 'DEMO FICTIONAL%'").fetchone()[0],2)
            self.assertEqual(db.execute("SELECT count(*) FROM genetic_tests WHERE verified=0").fetchone()[0],7)
            self.assertEqual(db.execute("SELECT count(*) FROM sessions").fetchone()[0],0)

    def test_service_fixture_states_are_private_synthetic_and_have_no_fabricated_receipts(self):
        story=self.manifest['stories']['service_requests']
        self.assertEqual(len(story['items']),3)
        self.assertTrue(all(row['is_demo'] and row['authority']=='none' for row in story['items']))
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM service_request_receipts").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT share_contact FROM service_requests WHERE id=980002001").fetchone()[0],1)
            closed=db.execute("SELECT status,share_contact,note,note_digest,note_redacted_at FROM service_requests WHERE id=980002003").fetchone()
            self.assertEqual(closed[:2],('closed',0))
            self.assertIn('SYNTHETIC NOTE REDACTED',closed[2])
            self.assertEqual(len(closed[3]),64)
            self.assertIsNotNone(closed[4])


class ResetContractTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old_root=reset.ROOT
        reset.ROOT=Path(self.temp.name)

    def tearDown(self):
        reset.ROOT=self.old_root
        self.temp.cleanup()

    def test_arbitrary_names_and_non_synthetic_target_refused(self):
        for name in ['../live','/absolute','reference.sqlite','x/y','UPPER','https://host']:
            with self.assertRaises(ValueError):reset.instance_path(name)
        path=reset.instance_path('client-demo');path.parent.mkdir(parents=True)
        path.write_bytes(b'NOT A SYNTHETIC DATABASE')
        before=path.read_bytes()
        with self.assertRaises(sqlite3.DatabaseError):reset.perform('reset','client-demo',date(2026,10,17))
        self.assertEqual(path.read_bytes(),before)

    def test_reset_backup_restore_preserves_completed_work_and_blob_bytes(self):
        first=reset.perform('reset','client-demo',date(2026,10,17))
        path=reset.instance_path('client-demo')
        with closing(sqlite3.connect(path)) as db:
            db.execute("UPDATE workspace_tasks SET status='done' WHERE id=970002001")
            db.commit()
            blob=db.execute('SELECT data FROM horse_media_blobs ORDER BY media_id,chunk LIMIT 1').fetchone()[0]
        backup=reset.perform('backup','client-demo',date(2026,10,17))['backup']['name']
        fresh=reset.perform('reset','client-demo',date(2026,10,17))
        self.assertIsNotNone(fresh['backup'])
        with closing(sqlite3.connect(path)) as db:self.assertEqual(db.execute('SELECT status FROM workspace_tasks WHERE id=970002001').fetchone()[0],'open')
        restored=reset.perform('restore','client-demo',date(2026,10,17),backup)
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute('SELECT status FROM workspace_tasks WHERE id=970002001').fetchone()[0],'done')
            self.assertEqual(db.execute('SELECT data FROM horse_media_blobs ORDER BY media_id,chunk LIMIT 1').fetchone()[0],blob)
        self.assertEqual(first['manifest']['namespace'],restored['manifest']['namespace'])

    def test_running_lock_and_other_instance_backup_refused(self):
        reset.perform('reset','client-demo',date(2026,10,17))
        path=reset.instance_path('client-demo')
        lock=Path(str(path)+'.lock');lock.write_text(json.dumps({'pid':os.getpid(),'database':str(path)}))
        with self.assertRaises(FileExistsError):reset.perform('reset','client-demo',date(2026,10,17))
        with self.assertRaises(ValueError):reset.perform('reset','client-demo',date(2026,10,17),recover_stale=True)
        lock.unlink()
        with self.assertRaises(ValueError):reset.perform('restore','client-demo',date(2026,10,17),'other-demo-checkpoint.sqlite')


if __name__=='__main__':unittest.main()
