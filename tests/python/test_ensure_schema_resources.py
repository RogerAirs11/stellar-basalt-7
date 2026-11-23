"""NEXT-15 acceptance suite: deterministic SQLite resource closure in the migration tool.

CPython's sqlite3 does not emit ResourceWarning for leaked connections, so this
suite combines three kinds of evidence on the affected paths:

1. ResourceWarning is promoted to an error around every apply_migrations call,
   so any Python-level resource leak in the tool becomes a test failure.
2. On POSIX, /proc/self/fd is scanned for descriptors still open on the database
   file after apply_migrations returns or raises (with a positive control that
   proves the detector can actually see a live handle).
3. On every platform, an immediate os.replace() acts as the Windows-compatible
   "the file can be replaced" check: an open handle would block it on Windows.

Failure paths additionally prove the original exception is never masked, and a
simulated close() failure exercises the masking guard added in NEXT-15.
"""

import importlib.util
import os
import sqlite3
import tempfile
import types
import unittest
import warnings
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ensure_schema = load_module("ensure_schema_resources_module", ROOT / "tools" / "ensure_schema.py")


def open_fds_on(path: Path):
    """Return the set of descriptor names still open on *path* (POSIX only).

    Returns None when /proc/self/fd is unavailable (non-Linux platforms);
    callers then rely on the os.replace() replacement check instead.
    """
    fd_dir = Path("/proc/self/fd")
    if not fd_dir.is_dir():
        return None
    target = os.path.realpath(path)
    found = set()
    for entry in fd_dir.iterdir():
        try:
            if os.path.realpath(entry) == target:
                found.add(entry.name)
        except OSError:
            continue
    return found


def assert_file_fully_released(testcase: unittest.TestCase, db_path: Path) -> None:
    """No process descriptor may remain on db_path and the file must be replaceable."""
    fds = open_fds_on(db_path)
    if fds is not None:
        testcase.assertEqual(fds, set(), f"descriptors still open on {db_path}: {sorted(fds)}")
    replacement = db_path.with_name(db_path.name + ".replaced")
    os.replace(db_path, replacement)
    os.replace(replacement, db_path)


class _CloseFailureConnection:
    """Delegates to a real connection but fails on close(), to prove exception masking is impossible."""

    def __init__(self, inner: sqlite3.Connection):
        self._inner = inner

    def execute(self, *args, **kwargs):
        return self._inner.execute(*args, **kwargs)

    def commit(self):
        self._inner.commit()

    def close(self):
        raise sqlite3.OperationalError("simulated close failure")


def _fake_sqlite3_module(conn: _CloseFailureConnection) -> types.SimpleNamespace:
    """A stand-in sqlite3 module for ensure_schema that returns *conn* from connect()."""
    return types.SimpleNamespace(
        connect=lambda path: conn,
        Error=sqlite3.Error,
        complete_statement=sqlite3.complete_statement,
    )


class EnsureSchemaResourceClosureTests(unittest.TestCase):
    """Repeated migrations and every failure path must release the SQLite file deterministically."""

    def test_handle_detector_has_a_positive_control(self):
        """The /proc scan is real evidence only if it can see an actually-open handle."""
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "control.sqlite"
            conn = sqlite3.connect(db)
            try:
                fds = open_fds_on(db)
                if fds is None:
                    self.skipTest("/proc/self/fd unavailable on this platform")
                self.assertTrue(fds, "expected an open descriptor while a connection is live")
            finally:
                conn.close()
            self.assertEqual(open_fds_on(db), set())

    def test_repeated_successful_migrations_release_the_database_file(self):
        """Three full replays of the real migration set leave no handle and stay idempotent."""
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "released.sqlite"
            with warnings.catch_warnings():
                warnings.simplefilter("error", ResourceWarning)
                for _ in range(3):
                    ensure_schema.apply_migrations(db)
                    assert_file_fully_released(self, db)
            conn = sqlite3.connect(db)
            try:
                horse_columns = [row[1] for row in conn.execute("PRAGMA table_info(horses)")]
                self.assertEqual(horse_columns.count("last_mutation_id"), 1)
                self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
            finally:
                conn.close()
            assert_file_fully_released(self, db)

    def test_failing_migration_closes_connection_and_propagates_original_error(self):
        """A statement failure leaves no open connection and surfaces the sqlite error itself."""
        with tempfile.TemporaryDirectory() as td:
            migrations = Path(td) / "migrations"
            migrations.mkdir()
            (migrations / "0001_good.sql").write_text(
                "CREATE TABLE next15_good(id INTEGER PRIMARY KEY, value TEXT NOT NULL);\n",
                encoding="utf-8",
            )
            (migrations / "0002_bad.sql").write_text(
                "CREATE BOGUS SYNTAX HERE;\n", encoding="utf-8"
            )
            db = Path(td) / "failing.sqlite"
            with warnings.catch_warnings():
                warnings.simplefilter("error", ResourceWarning)
                with mock.patch.object(ensure_schema, "MIGRATIONS", migrations):
                    with self.assertRaises(sqlite3.OperationalError) as raised:
                        ensure_schema.apply_migrations(db)
            self.assertIn("syntax error", str(raised.exception).lower())
            self.assertNotIn("simulated close failure", str(raised.exception))
            assert_file_fully_released(self, db)

    def test_foreign_key_check_failure_closes_connection_and_propagates_original_error(self):
        """The post-commit foreign_key_check failure path also releases the file."""
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "fk.sqlite"
            conn = sqlite3.connect(db)
            try:
                conn.execute("PRAGMA foreign_keys=OFF")
                conn.execute("CREATE TABLE parent(id INTEGER PRIMARY KEY)")
                conn.execute(
                    "CREATE TABLE child(id INTEGER PRIMARY KEY,"
                    " parent_id INTEGER NOT NULL REFERENCES parent(id))"
                )
                conn.execute("INSERT INTO child(id, parent_id) VALUES(1, 999)")
                conn.commit()
            finally:
                conn.close()
            migrations = Path(td) / "empty-migrations"
            migrations.mkdir()
            with warnings.catch_warnings():
                warnings.simplefilter("error", ResourceWarning)
                with mock.patch.object(ensure_schema, "MIGRATIONS", migrations):
                    with self.assertRaises(RuntimeError) as raised:
                        ensure_schema.apply_migrations(db)
            self.assertIn("foreign_key_check", str(raised.exception))
            assert_file_fully_released(self, db)

    def test_close_failure_never_masks_the_original_migration_error(self):
        """When a migration fails AND close() fails, the migration error wins."""
        with tempfile.TemporaryDirectory() as td:
            migrations = Path(td) / "migrations"
            migrations.mkdir()
            (migrations / "0001_good.sql").write_text(
                "CREATE TABLE next15_mask(id INTEGER PRIMARY KEY);\n", encoding="utf-8"
            )
            (migrations / "0002_bad.sql").write_text(
                "CREATE BOGUS SYNTAX HERE;\n", encoding="utf-8"
            )
            inner = sqlite3.connect(":memory:")
            self.addCleanup(inner.close)
            conn = _CloseFailureConnection(inner)
            with mock.patch.object(ensure_schema, "sqlite3", _fake_sqlite3_module(conn)), \
                    mock.patch.object(ensure_schema, "MIGRATIONS", migrations):
                with self.assertRaises(sqlite3.OperationalError) as raised:
                    ensure_schema.apply_migrations(Path("unused.sqlite"))
            self.assertIn("syntax error", str(raised.exception).lower())
            self.assertNotIn("simulated close failure", str(raised.exception))

    def test_close_failure_on_success_path_surfaces_loudly(self):
        """A close() failure after a successful body is not silently swallowed."""
        inner = sqlite3.connect(":memory:")
        self.addCleanup(inner.close)
        conn = _CloseFailureConnection(inner)
        with mock.patch.object(ensure_schema, "sqlite3", _fake_sqlite3_module(conn)), \
                mock.patch.object(ensure_schema, "MIGRATIONS", Path("/nonexistent-next15")):
            with self.assertRaises(sqlite3.OperationalError) as raised:
                ensure_schema.apply_migrations(Path("unused.sqlite"))
        self.assertIn("simulated close failure", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
