from __future__ import annotations

import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


snapshot = load_module("people_stats_snapshot_module", ROOT / "tools" / "build_analytics_snapshot.py")
schema = load_module("people_stats_schema_module", ROOT / "tools" / "ensure_schema.py")

DIRECTORY_EXACT_SQL = """
SELECT p.id,
  SUM(CASE WHEN hp.role='owner' THEN 1 ELSE 0 END) AS owner_count,
  SUM(CASE WHEN hp.role='breeder' THEN 1 ELSE 0 END) AS breeder_count,
  SUM(CASE WHEN hp.role='importer' THEN 1 ELSE 0 END) AS importer_count,
  SUM(CASE WHEN hp.role='passport_receiver' THEN 1 ELSE 0 END) AS passport_receiver_count,
  COUNT(DISTINCT hp.horse_id) AS horse_count
FROM people p LEFT JOIN horse_people hp ON hp.person_id=p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id
ORDER BY p.id
"""

PROFILE_EXACT_SQL = """
SELECT p.id,
  (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id
    WHERE hp.person_id=p.id AND hp.role='owner' AND h.deleted_at IS NULL) AS owner_count,
  (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id
    WHERE hp.person_id=p.id AND hp.role='breeder' AND h.deleted_at IS NULL) AS breeder_count,
  (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id
    WHERE hp.person_id=p.id AND hp.role='importer' AND h.deleted_at IS NULL) AS importer_count,
  (SELECT COUNT(*) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id
    WHERE hp.person_id=p.id AND hp.role='passport_receiver' AND h.deleted_at IS NULL) AS passport_receiver_count,
  (SELECT COUNT(DISTINCT hp.horse_id) FROM horse_people hp JOIN horses h ON h.id=hp.horse_id
    WHERE hp.person_id=p.id AND h.deleted_at IS NULL) AS horse_count
FROM people p WHERE p.deleted_at IS NULL
ORDER BY p.id
"""


def rows_as_counts(rows):
    return {
        int(row[0]): tuple(int(v or 0) for v in row[1:6])
        for row in rows
    }


def directory_materialized(conn: sqlite3.Connection):
    return rows_as_counts(conn.execute("""
      SELECT person_id,owner_count,breeder_count,importer_count,passport_receiver_count,horse_count
      FROM person_registry_stats ORDER BY person_id
    """).fetchall())


def profile_materialized(conn: sqlite3.Connection):
    return rows_as_counts(conn.execute("""
      SELECT person_id,profile_owner_count,profile_breeder_count,profile_importer_count,
             profile_passport_receiver_count,profile_horse_count
      FROM person_registry_stats ORDER BY person_id
    """).fetchall())


def exact_directory(conn: sqlite3.Connection):
    return rows_as_counts(conn.execute(DIRECTORY_EXACT_SQL).fetchall())


def exact_profile(conn: sqlite3.Connection):
    return rows_as_counts(conn.execute(PROFILE_EXACT_SQL).fetchall())


def derived_stats_fresh(conn: sqlite3.Connection) -> bool:
    row = conn.execute("""
      SELECT rs.analytics_stale,rs.analytics_source_revision,
             (SELECT COUNT(*) FROM person_registry_stats ps
               WHERE ps.source_revision=rs.analytics_source_revision) AS matching_rows
      FROM registry_state rs WHERE rs.id=1
    """).fetchone()
    return bool(row and int(row[0]) == 0 and row[1] and int(row[2]) > 0)


class PeopleStatsArchivedSemanticsTests(unittest.TestCase):
    def make_db(self, *, archived_horse_3: bool) -> Path:
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        db = Path(td.name) / "people-semantics.sqlite"
        sqlite3.connect(db).close()
        schema.apply_migrations(db)
        conn = sqlite3.connect(db)
        conn.executemany(
            "INSERT INTO people(id,name_latin,name_native) VALUES(?,?,?)",
            [(1, "ALICE", "آلیس"), (2, "BOB", "باب"), (3, "EMPTY", None)],
        )
        horses = [
            (1, "ACTIVE ONE", None),
            (2, "ACTIVE TWO", None),
            (3, "ARCHIVE EDGE", "2026-09-07T00:00:00Z" if archived_horse_3 else None),
        ]
        conn.executemany("INSERT INTO horses(id,name_latin,deleted_at) VALUES(?,?,?)", horses)
        conn.executemany(
            "INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES(?,?,?,1)",
            [
                (1, 1, "owner"), (1, 1, "breeder"),
                (2, 1, "owner"), (2, 1, "importer"), (2, 1, "passport_receiver"),
                (3, 1, "owner"), (3, 1, "breeder"), (3, 1, "passport_receiver"),
                (3, 2, "owner"), (3, 2, "importer"),
            ],
        )
        conn.commit()
        conn.close()
        return db

    def assert_materialized_matches_both_legacy_semantics(self, db: Path):
        snapshot.ensure_snapshot(db, if_stale=False)
        conn = sqlite3.connect(db)
        try:
            self.assertTrue(derived_stats_fresh(conn))
            self.assertEqual(directory_materialized(conn), exact_directory(conn))
            self.assertEqual(profile_materialized(conn), exact_profile(conn))
        finally:
            conn.close()

    def test_no_archived_horses_has_identical_directory_and_profile_counts(self):
        db = self.make_db(archived_horse_3=False)
        self.assert_materialized_matches_both_legacy_semantics(db)
        conn = sqlite3.connect(db)
        try:
            self.assertEqual(exact_directory(conn), exact_profile(conn))
            # Multiple roles on one horse count per-role, while horse_count stays DISTINCT.
            self.assertEqual(exact_directory(conn)[1], (3, 2, 1, 2, 3))
            self.assertEqual(exact_directory(conn)[3], (0, 0, 0, 0, 0))
        finally:
            conn.close()

    def test_archived_mixed_and_multiple_role_semantics_are_preserved_separately(self):
        db = self.make_db(archived_horse_3=True)
        self.assert_materialized_matches_both_legacy_semantics(db)
        conn = sqlite3.connect(db)
        try:
            directory = exact_directory(conn)
            profile = exact_profile(conn)
            # Directory legacy behavior includes archived-horse links.
            self.assertEqual(directory[1], (3, 2, 1, 2, 3))
            self.assertEqual(directory[2], (1, 0, 1, 0, 1))
            # Person profile legacy behavior excludes archived horses entirely.
            self.assertEqual(profile[1], (2, 1, 1, 1, 2))
            self.assertEqual(profile[2], (0, 0, 0, 0, 0))
        finally:
            conn.close()

    def test_archive_restore_and_role_changes_force_exact_fallback_until_rebuild(self):
        db = self.make_db(archived_horse_3=False)
        snapshot.ensure_snapshot(db, if_stale=False)
        conn = sqlite3.connect(db)
        try:
            before_profile = profile_materialized(conn)
            # Simulate the archive route's canonical mutation boundary.
            conn.execute("UPDATE horses SET deleted_at='2026-09-07T00:00:00Z',row_version=row_version+1 WHERE id=3")
            conn.execute("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1 WHERE id=1")
            conn.commit()
            self.assertFalse(derived_stats_fresh(conn))
            self.assertNotEqual(before_profile, exact_profile(conn))
            # Directory semantics happen to remain stable across archive because links remain canonical.
            self.assertEqual(directory_materialized(conn), exact_directory(conn))
        finally:
            conn.close()

        # Rebuild refreshes both semantic views and makes the derived layer admissible again.
        snapshot.ensure_snapshot(db, if_stale=True)
        conn = sqlite3.connect(db)
        try:
            self.assertTrue(derived_stats_fresh(conn))
            self.assertEqual(profile_materialized(conn), exact_profile(conn))
            # Simulate a future role/link mutation; the documented contract requires stale marking.
            conn.execute("INSERT INTO horse_people(horse_id,person_id,role,is_current) VALUES(1,2,'breeder',1)")
            conn.execute("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1 WHERE id=1")
            conn.commit()
            self.assertFalse(derived_stats_fresh(conn))
            self.assertNotEqual(directory_materialized(conn), exact_directory(conn))
            self.assertNotEqual(profile_materialized(conn), exact_profile(conn))
        finally:
            conn.close()

        snapshot.ensure_snapshot(db, if_stale=True)
        conn = sqlite3.connect(db)
        try:
            self.assertEqual(directory_materialized(conn), exact_directory(conn))
            self.assertEqual(profile_materialized(conn), exact_profile(conn))
            # Simulate restore; again the live exact profile changes while directory counts do not.
            conn.execute("UPDATE horses SET deleted_at=NULL,row_version=row_version+1 WHERE id=3")
            conn.execute("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1 WHERE id=1")
            conn.commit()
            self.assertFalse(derived_stats_fresh(conn))
            self.assertNotEqual(profile_materialized(conn), exact_profile(conn))
        finally:
            conn.close()

    def test_failed_rebuild_leaves_stale_gate_closed(self):
        db = self.make_db(archived_horse_3=False)
        snapshot.ensure_snapshot(db, if_stale=False)
        conn = sqlite3.connect(db)
        conn.execute("UPDATE horses SET deleted_at='2026-09-07T00:00:00Z',row_version=row_version+1 WHERE id=3")
        conn.execute("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1 WHERE id=1")
        conn.commit(); conn.close()

        original = snapshot._rebuild_hot_read_models
        def fail_rebuild(*_args, **_kwargs):
            raise RuntimeError("synthetic hot-model rebuild failure")
        snapshot._rebuild_hot_read_models = fail_rebuild
        try:
            with self.assertRaisesRegex(RuntimeError, "synthetic hot-model rebuild failure"):
                snapshot.ensure_snapshot(db, if_stale=True)
        finally:
            snapshot._rebuild_hot_read_models = original

        conn = sqlite3.connect(db)
        try:
            self.assertFalse(derived_stats_fresh(conn))
            self.assertEqual(conn.execute("SELECT analytics_stale FROM registry_state WHERE id=1").fetchone()[0], 1)
            # Old materialization may remain physically present, but it cannot be trusted while stale.
            self.assertNotEqual(profile_materialized(conn), exact_profile(conn))
        finally:
            conn.close()

    def test_runtime_source_contains_both_semantic_fast_paths_and_exact_stale_fallbacks(self):
        routes = (ROOT / "src" / "api" / "routes.ts").read_text(encoding="utf-8")
        self.assertIn("ps.profile_owner_count AS owner_count", routes)
        self.assertIn("ps.profile_horse_count AS horse_count", routes)
        self.assertIn("JOIN registry_state rs ON rs.id=1 AND rs.analytics_stale=0 AND ps.source_revision=rs.analytics_source_revision", routes)
        self.assertIn("hp.role='owner' AND h.deleted_at IS NULL", routes)
        self.assertIn("runtime.summary && !runtime.stale", routes)
        self.assertIn("rs_people.analytics_stale=0 AND ps.source_revision=rs_people.analytics_source_revision", routes)
        self.assertIn("registryPersonDisplayFallbackSql", routes)


if __name__ == "__main__":
    unittest.main()
