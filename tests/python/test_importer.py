from __future__ import annotations
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from datetime import time, timedelta
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("horse_importer", ROOT / "tools" / "import_xlsx.py")
assert spec and spec.loader
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImporterTests(unittest.TestCase):
    def test_small_workbook_normalizes_relationships_search_and_raw_fields(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            xlsx = td / "fixture.xlsx"
            db = td / "fixture.sqlite"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "horse-ALL"
            headers = [
                "HorseNo","HorseNameL","HorseNameF","FatherNo","MotherNo","BirthYear","BirthPlaceDesc","BreedTypeDesc",
                "OwnerNo","OwnerDesc","OwnerDescLatin","BreederNo","BreeDerDesc","BreeDerDescLatin","ShajF1","ShajNoF1",
                "MicroChipNo","FileNumber","UELNo","LifeNumber","PassportNo","LabNo","UnknownTime","UnknownDuration",
            ]
            ws.append(headers)
            ws.append([1,"NOVA STAR","چابک",2,3,2000,"Esfahan","Arabian",10,"مالک","Morgan Reed",11,"پرورش","Sara Breeder","X",99,"PRIVATE-CHIP","PRIVATE-FILE","PUBLIC-UEL","PUBLIC-LIFE","PRIVATE-PASSPORT","PRIVATE-LAB",time(7,30),timedelta(hours=2)])
            ws.append([2,"SIRE ONE","پدر یک",None,None,1990,"Tehran","Arabian",None,None,None,None,None,None,None,None,None,None,None,None,None,None,None,None])
            ws.append([3,"DAM ONE",None,None,None,1992,"Shiraz","Arabian",None,None,None,None,None,None,None,None,None,None,None,None,None,None,None,None])
            wb.save(xlsx)

            report = importer.import_workbook(xlsx, db)
            self.assertEqual(report["counts"]["horses"], 3)
            conn = sqlite3.connect(db)
            conn.row_factory = sqlite3.Row
            horse = conn.execute("SELECT * FROM horses WHERE id=1").fetchone()
            self.assertEqual(horse["father_id"], 2)
            self.assertEqual(horse["mother_id"], 3)
            raw = json.loads(horse["raw_json"])
            self.assertEqual(raw["UnknownTime"], "07:30:00")
            self.assertIn("2:00:00", str(raw["UnknownDuration"]))
            self.assertNotIn("ShajF1", raw)
            owners = conn.execute("SELECT p.name_latin FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=1 AND hp.role='owner'").fetchall()
            self.assertEqual([r[0] for r in owners], ["Morgan Reed"])
            fts = conn.execute("SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH 'owners:morgan' ").fetchall()
            self.assertIn(1, [r[0] for r in fts])
            sire_native = conn.execute("SELECT father_name FROM horse_search_source WHERE horse_id=1").fetchone()[0]
            self.assertIn("پدر", sire_native)
            searchable_ids = conn.execute("SELECT identifiers FROM horse_search_source WHERE horse_id=1").fetchone()[0]
            self.assertIn("public uel", searchable_ids)
            self.assertIn("public life", searchable_ids)
            for private_value in ("private chip", "private file", "private passport", "private lab"):
                self.assertNotIn(private_value, searchable_ids)

            shards = td / "shards"
            importer.write_d1_shards(db, shards)
            horse_sql = "\n".join(path.read_text(encoding="utf-8") for path in shards.glob("*_horses_*.sql"))
            self.assertNotIn("raw_json", horse_sql)
            self.assertNotIn("UnknownTime", horse_sql)
            # Horse rows are deliberately emitted without parent links; links are replayed
            # only after all horse rows exist so D1 chunk ordering cannot break foreign keys.
            self.assertIn("father_id", horse_sql)
            parent_sql = "\n".join(path.read_text(encoding="utf-8") for path in shards.glob("*_horse_parent_links_*.sql"))
            self.assertIn("father_id=CASE id WHEN 1 THEN 2 ELSE father_id END", parent_sql)
            self.assertIn("mother_id=CASE id WHEN 1 THEN 3 ELSE mother_id END", parent_sql)
            self.assertIn("WHERE id IN (1)", parent_sql)

            replay = sqlite3.connect(td / "replay.sqlite")
            replay.execute("PRAGMA foreign_keys=ON")
            importer.apply_migrations(replay)
            manifest = json.loads((shards / "manifest.json").read_text(encoding="utf-8"))["files"]
            for shard_name in manifest:
                replay.executescript((shards / shard_name).read_text(encoding="utf-8"))
            self.assertEqual(replay.execute("SELECT father_id,mother_id FROM horses WHERE id=1").fetchone(), (2,3))
            self.assertEqual(replay.execute("SELECT COUNT(*) FROM horse_search_fts").fetchone()[0], 3)
            self.assertEqual(replay.execute("PRAGMA foreign_key_check").fetchall(), [])
            replay.close()

            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
            conn.close()

    def test_d1_export_chunks_oversized_analytics_payload_and_is_retry_idempotent(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            db = td / "analytics.sqlite"
            conn = sqlite3.connect(db)
            importer.apply_migrations(conn)
            payload = json.dumps({
                "blob": ("x'یز" * 40000),
                "kind": "oversized-registry-overview",
            }, ensure_ascii=False, separators=(",", ":"))
            conn.execute(
                """INSERT OR REPLACE INTO analytics_snapshots(
                   key,schema_version,algorithm_version,source_revision,source_horse_count,generated_at,payload_json
                   ) VALUES(?,?,?,?,?,?,?)""",
                ("registry-overview", "1", "test", "sha256:test", 0, "2026-09-08T00:00:00Z", payload),
            )
            conn.commit(); conn.close()

            shards = td / "shards"
            importer.write_d1_shards(db, shards)
            manifest = json.loads((shards / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["safe_statement_bytes"], importer.D1_SAFE_SQL_STATEMENT_BYTES)

            # Every complete SQL statement must remain under the configured safety guard.
            for shard_name in manifest["files"]:
                sql = (shards / shard_name).read_text(encoding="utf-8")
                buffer = ""
                for line in sql.splitlines(keepends=True):
                    buffer += line
                    if sqlite3.complete_statement(buffer):
                        self.assertLessEqual(
                            len(buffer.encode("utf-8")), importer.D1_SAFE_SQL_STATEMENT_BYTES,
                            f"oversized SQL statement in {shard_name}",
                        )
                        buffer = ""
                self.assertFalse(buffer.strip(), f"incomplete statement in {shard_name}")

            replay = sqlite3.connect(td / "replay.sqlite")
            replay.execute("PRAGMA foreign_keys=ON")
            importer.apply_migrations(replay)
            # Replaying the full manifest twice proves the chunk sequence is safe to retry.
            for _ in range(2):
                for shard_name in manifest["files"]:
                    replay.executescript((shards / shard_name).read_text(encoding="utf-8"))
            actual = replay.execute(
                "SELECT payload_json FROM analytics_snapshots WHERE key='registry-overview'"
            ).fetchone()[0]
            self.assertEqual(actual, payload)

            # A genuinely newer rebuild with the same key must replace, not append
            # to or preserve, the prior oversized payload.
            conn = sqlite3.connect(db)
            replacement_payload = json.dumps({
                "blob": ("NEW' داده" * 30000),
                "kind": "replacement-registry-overview",
            }, ensure_ascii=False, separators=(",", ":"))
            conn.execute(
                "UPDATE analytics_snapshots SET generated_at=?,payload_json=? WHERE key='registry-overview'",
                ("2026-09-08T00:01:00Z", replacement_payload),
            )
            conn.commit(); conn.close()
            replacement_shards = td / "replacement-shards"
            importer.write_d1_shards(db, replacement_shards)
            replacement_manifest = json.loads((replacement_shards / "manifest.json").read_text(encoding="utf-8"))["files"]
            for shard_name in replacement_manifest:
                replay.executescript((replacement_shards / shard_name).read_text(encoding="utf-8"))
            actual_replacement = replay.execute(
                "SELECT payload_json FROM analytics_snapshots WHERE key='registry-overview'"
            ).fetchone()[0]
            self.assertEqual(actual_replacement, replacement_payload)

            self.assertEqual(replay.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(replay.execute("PRAGMA foreign_key_check").fetchall(), [])
            replay.close()

    def test_quality_detection_flags_self_parent_and_year_conflict(self):
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "q.sqlite"
            conn = sqlite3.connect(db)
            importer.apply_migrations(conn)
            conn.execute("INSERT INTO horses(id,name_latin,father_id,birth_year) VALUES(1,'SELF',1,2000)")
            conn.execute("INSERT INTO horses(id,name_latin,birth_year) VALUES(2,'PARENT',2010)")
            conn.execute("INSERT INTO horses(id,name_latin,father_id,birth_year) VALUES(3,'CHILD',2,2005)")
            importer.detect_quality(conn)
            codes = conn.execute("SELECT horse_id,issue_code FROM data_quality_issues ORDER BY horse_id,issue_code").fetchall()
            self.assertIn((1,"SELF_PARENT"), codes)
            self.assertIn((1,"PEDIGREE_CYCLE"), codes)
            self.assertIn((3,"PARENT_YEAR_CONFLICT"), codes)
            conn.close()

    def test_canonical_compare_reports_changed_fields_without_values(self):
        import importlib.util
        diff_spec = importlib.util.spec_from_file_location("canonical_diff", ROOT / "tools" / "compare_canonical.py")
        assert diff_spec and diff_spec.loader
        diff = importlib.util.module_from_spec(diff_spec); diff_spec.loader.exec_module(diff)
        with tempfile.TemporaryDirectory() as td:
            td = Path(td); oldp = td / "old.sqlite"; newp = td / "new.sqlite"
            for path in (oldp,newp):
                conn = sqlite3.connect(path); importer.apply_migrations(conn); conn.execute("INSERT INTO horses(id,name_latin,birth_year) VALUES(1,'NOVA STAR',2000)"); conn.commit(); conn.close()
            conn = sqlite3.connect(newp); conn.execute("UPDATE horses SET birth_year=2001 WHERE id=1"); conn.execute("INSERT INTO horses(id,name_latin) VALUES(2,'MOON ARC')"); conn.commit(); conn.close()
            report = diff.compare(oldp,newp)
            self.assertEqual(report["counts"]["changed"],1); self.assertEqual(report["counts"]["added"],1)
            self.assertEqual(report["field_change_counts"]["birth_year"],1)
            self.assertNotIn("2000", json.dumps(report)); self.assertNotIn("2001", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
