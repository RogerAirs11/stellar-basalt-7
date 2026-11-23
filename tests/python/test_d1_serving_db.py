from __future__ import annotations

import importlib.util
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


importer = load_module("horse_importer_serving_test", ROOT / "tools" / "import_xlsx.py")
serving = load_module("horse_serving_builder_test", ROOT / "tools" / "build_d1_serving_db.py")


class D1ServingDatabaseTests(unittest.TestCase):
    def build_fixture(self, path: Path) -> None:
        conn = sqlite3.connect(path)
        importer.apply_migrations(conn)
        conn.execute("INSERT INTO horses(id,name_latin,raw_json) VALUES(1,'AURORA TEST','{\"private\":1}')")
        conn.execute("INSERT INTO horses(id,name_latin,raw_json) VALUES(2,'SIRE TEST','{\"private\":2}')")
        conn.execute("INSERT INTO horses(id,name_latin,raw_json) VALUES(3,'EMPTY ROLE','{\"private\":3}')")
        conn.execute("INSERT INTO people(id,name_latin) VALUES(10,'Alice Owner')")
        conn.execute("INSERT INTO people(id,name_latin) VALUES(11,'Bob Breeder')")
        conn.execute("INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES(1,10,'owner',1)")
        conn.execute("INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES(1,11,'breeder',1)")
        source_rows = [
            (1,'aurora test','','reg1','alice owner','bob breeder','','','','arabian','1 aurora test reg1 alice owner bob breeder arabian'),
            (2,'sire test','','reg2','','','','','','arabian','2 sire test reg2 arabian'),
            (3,'empty role','','reg3','','','','','','arabian','3 empty role reg3 arabian'),
        ]
        conn.executemany(
            """INSERT INTO horse_search_source(
               horse_id,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            source_rows,
        )
        conn.executemany(
            """INSERT INTO horse_search_fts(
               rowid,name_latin,name_native,identifiers,owners,breeders,father_name,mother_name,places,breed,all_text
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            source_rows,
        )
        conn.executemany(
            "INSERT INTO horse_search_trigram(rowid,all_text) VALUES(?,?)",
            [(r[0], r[-1]) for r in source_rows],
        )
        conn.execute(
            """INSERT INTO horse_registry_people_summary(
               horse_id,owner_name,breeder_name,source_revision,generated_at
               ) VALUES(1,'Alice Owner','Bob Breeder','test','2026-09-08T00:00:00Z')"""
        )
        conn.execute(
            """INSERT INTO horse_registry_people_summary(
               horse_id,source_revision,generated_at
               ) VALUES(3,'test','2026-09-08T00:00:00Z')"""
        )
        conn.execute("INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver) VALUES(1,'alice owner','bob breeder','','')")
        conn.execute("INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver) VALUES(2,'','','','')")
        conn.execute("INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver) VALUES(3,'','','','')")
        conn.commit()
        conn.close()

    def test_serving_transform_preserves_search_and_sparsifies_only_empty_accelerators(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "fixture.sqlite"
            self.build_fixture(db)
            conn = sqlite3.connect(db)
            result = serving.optimize_working_copy(conn)
            self.assertEqual(result["integrity"], "ok")
            self.assertEqual(result["foreign_key_violations"], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM horses WHERE raw_json IS NOT NULL").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM horse_registry_people_summary").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM horse_role_search_trigram").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM horse_search_fts").fetchone()[0], 3)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM horse_search_trigram").fetchone()[0], 3)
            self.assertEqual(conn.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'aurora'").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH 'aurora'").fetchone()[0], 1)
            schemas = dict(conn.execute("SELECT name,sql FROM sqlite_master WHERE name IN ('horse_search_fts','horse_search_trigram')"))
            self.assertIn("content='horse_search_source'", schemas["horse_search_fts"])
            self.assertIn("content='horse_search_source'", schemas["horse_search_trigram"])
            indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
            for index in serving.RUNTIME_UNUSED_SERVING_INDEXES:
                self.assertNotIn(index, indexes)
            conn.close()

    def test_external_search_export_replays_into_fresh_migrated_database(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            db = td / "fixture.sqlite"
            self.build_fixture(db)
            conn = sqlite3.connect(db)
            serving.optimize_working_copy(conn)
            conn.close()

            shards = td / "shards"
            importer.write_d1_shards(db, shards, external_search_fts=True)
            manifest = json.loads((shards / "manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(manifest["external_search_fts"])
            self.assertEqual(manifest["format_version"], 4)
            self.assertTrue(any("serving_schema" in name for name in manifest["files"]))
            self.assertFalse(any("search_external_rebuild" in name for name in manifest["files"]))
            self.assertTrue(any("_horse_search_fts_" in name for name in manifest["files"]))
            self.assertTrue(any("_horse_search_trigram_" in name for name in manifest["files"]))

            replay = sqlite3.connect(td / "replay.sqlite")
            replay.execute("PRAGMA foreign_keys=ON")
            importer.apply_migrations(replay)
            for name in manifest["files"]:
                replay.executescript((shards / name).read_text(encoding="utf-8"))
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horses").fetchone()[0], 3)
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horse_search_source").fetchone()[0], 3)
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horse_search_fts").fetchone()[0], 3)
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horse_search_trigram").fetchone()[0], 3)
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horse_role_search_trigram").fetchone()[0], 1)
            self.assertEqual(replay.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'aurora'").fetchone()[0], 1)
            self.assertEqual(replay.execute("SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH 'aurora'").fetchone()[0], 1)
            self.assertEqual(replay.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(replay.execute("PRAGMA foreign_key_check").fetchall(), [])
            first_search = replay.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'aurora'").fetchall()
            first_trigram = replay.execute("SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH 'aurora'").fetchall()
            for name in manifest["files"]:
                replay.executescript((shards / name).read_text(encoding="utf-8"))
            self.assertEqual(replay.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'aurora'").fetchall(), first_search)
            self.assertEqual(replay.execute("SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH 'aurora'").fetchall(), first_trigram)
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horses").fetchone()[0], 3)
            self.assertEqual(replay.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(replay.execute("PRAGMA foreign_key_check").fetchall(), [])
            replay.close()

    def test_external_content_delete_order_prevents_stale_search_postings(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "fixture.sqlite"
            self.build_fixture(db)
            conn = sqlite3.connect(db)
            serving.optimize_working_copy(conn)
            # This is the same order now used by src/search/refresh.ts.
            conn.execute("DELETE FROM horse_search_fts WHERE rowid=1")
            conn.execute("DELETE FROM horse_search_trigram WHERE rowid=1")
            conn.execute("DELETE FROM horse_search_source WHERE horse_id=1")
            conn.commit()
            self.assertEqual(conn.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'aurora'").fetchall(), [])
            self.assertEqual(conn.execute("SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH 'aurora'").fetchall(), [])
            conn.close()


if __name__ == "__main__":
    unittest.main()
