import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "migrations"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ensure_schema = load_module("migration_smoke_ensure_schema", ROOT / "tools" / "ensure_schema.py")

# Expected post-migration structures (D05 canonical/derived inventory mirrors this set).
EXPECTED_ORDINARY_TABLES = {
    "source_imports", "horses", "people", "horse_people", "horse_aliases",
    "data_quality_issues", "users", "sessions", "audit_events",
    "change_requests", "change_request_items",
    "horse_search_source", "horse_search_reindex_queue",
    "horse_claims", "analytics_snapshots", "horse_reference_intelligence",
    "registry_state", "canonical_mutation_log", "registry_runtime_counters", "person_registry_stats", "horse_registry_people_summary",
    "registry_filter_counts",
    "command_receipts",
    "rate_limit_counters",
}
EXPECTED_VIRTUAL_TABLES = {"horse_search_fts", "horse_search_trigram", "horse_role_search_trigram"}

JOURNAL_REQUIRED_COLUMNS = {
    "id", "actor_user_id", "action", "entity_type", "entity_id",
    "before_json", "requested_json", "after_json", "request_id",
    "status", "audit_status", "search_status", "last_error",
    "created_at", "finalized_at", "updated_at",
}


def apply_migrations(db: sqlite3.Connection) -> list:
    """Apply every current migration, in filename order, to the given database."""
    applied = []
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(migration.read_text(encoding="utf-8"))
        applied.append(migration.name)
    return applied


class MigrationSmokeTests(unittest.TestCase):
    """D12 all-migrations smoke suite: structures, integrity, seeds, journal, FTS, trigram."""

    @classmethod
    def setUpClass(cls):
        cls.db = sqlite3.connect(":memory:")
        cls.db.row_factory = sqlite3.Row
        cls.db.execute("PRAGMA foreign_keys=ON")
        apply_migrations(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def _ordinary_tables(self):
        rows = self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'"
        ).fetchall()
        return {row["name"] for row in rows}

    def _virtual_tables(self):
        rows = self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL TABLE%'"
        ).fetchall()
        return {row["name"] for row in rows}

    def test_ensure_schema_is_idempotent_on_already_prepared_database(self):
        with tempfile.TemporaryDirectory() as td:
            db_path = Path(td) / "prepared.sqlite"
            # First preparation creates the schema; the second must safely replay
            # historical migrations 0008/0012 without duplicate-column failures.
            ensure_schema.apply_migrations(db_path)
            ensure_schema.apply_migrations(db_path)
            conn = sqlite3.connect(db_path)
            try:
                horse_columns = [row[1] for row in conn.execute("PRAGMA table_info(horses)")]
                audit_columns = [row[1] for row in conn.execute("PRAGMA table_info(audit_events)")]
                person_columns = [row[1] for row in conn.execute("PRAGMA table_info(person_registry_stats)")]
                self.assertEqual(horse_columns.count("last_mutation_id"), 1)
                self.assertEqual(audit_columns.count("mutation_log_id"), 1)
                for column in (
                    "profile_owner_count", "profile_breeder_count", "profile_importer_count",
                    "profile_passport_receiver_count", "profile_horse_count",
                ):
                    self.assertEqual(person_columns.count(column), 1)
                self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
            finally:
                conn.close()

    def test_all_migrations_apply_in_order_on_empty_database(self):
        db = sqlite3.connect(":memory:")
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            applied = apply_migrations(db)
            self.assertEqual(applied, sorted(applied), "migrations must apply in filename order")
            self.assertGreaterEqual(len(applied), 13, "expected at least migrations 0001-0013")
            horse_indexes = {row[1] for row in db.execute("PRAGMA index_list(horses)").fetchall()}
            self.assertTrue({
                "idx_horses_active_breed_sort",
                "idx_horses_active_sex_sort",
                "idx_horses_active_place_sort",
                "idx_horses_active_color_filter",
                "idx_horses_active_strain_filter",
                "idx_horses_active_lifecycle",
            }.issubset(horse_indexes))
            runtime = db.execute("SELECT active_horse_count FROM registry_runtime_counters WHERE id=1").fetchone()
            self.assertIsNotNone(runtime)
            self.assertEqual(runtime[0], 0)
            person_stats_columns = {row[1] for row in db.execute("PRAGMA table_info(person_registry_stats)").fetchall()}
            self.assertTrue({
                "profile_owner_count", "profile_breeder_count", "profile_importer_count",
                "profile_passport_receiver_count", "profile_horse_count",
            }.issubset(person_stats_columns))
            names = {r["name"] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for required in ("horses", "registry_state", "canonical_mutation_log",
                             "horse_search_fts", "horse_search_trigram", "horse_role_search_trigram"):
                self.assertIn(required, names)
        finally:
            db.close()

    def test_expected_canonical_operational_and_derived_structures_exist(self):
        self.assertTrue(EXPECTED_ORDINARY_TABLES.issubset(self._ordinary_tables()),
                        f"missing ordinary tables: {EXPECTED_ORDINARY_TABLES - self._ordinary_tables()}")
        self.assertTrue(EXPECTED_VIRTUAL_TABLES.issubset(self._virtual_tables()),
                        f"missing virtual tables: {EXPECTED_VIRTUAL_TABLES - self._virtual_tables()}")

    def test_pragma_integrity_check_is_ok(self):
        rows = self.db.execute("PRAGMA integrity_check").fetchall()
        messages = [row[0] for row in rows]
        self.assertEqual(messages, ["ok"])

    def test_pragma_foreign_key_check_is_clean(self):
        rows = self.db.execute("PRAGMA foreign_key_check").fetchall()
        self.assertEqual(rows, [])

    def test_registry_state_seed_and_invariants_hold(self):
        row = self.db.execute("SELECT * FROM registry_state WHERE id=1").fetchone()
        self.assertIsNotNone(row, "registry_state singleton row must be seeded")
        self.assertEqual(row["canonical_revision"], 0)
        self.assertEqual(row["analytics_stale"], 1, "fresh database must start analytics-stale")
        # The singleton + boolean invariants are enforced, not merely documented.
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO registry_state(id,canonical_revision,analytics_stale) VALUES(2,0,1)")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE registry_state SET analytics_stale=5 WHERE id=1")

    def test_canonical_mutation_journal_columns_and_constraints_match_runtime(self):
        columns = {row["name"] for row in self.db.execute("PRAGMA table_info(canonical_mutation_log)")}
        self.assertTrue(JOURNAL_REQUIRED_COLUMNS.issubset(columns),
                        f"journal missing columns: {JOURNAL_REQUIRED_COLUMNS - columns}")
        # Runtime defaults: durable intent with pending audit/search settlement.
        self.db.execute(
            "INSERT INTO canonical_mutation_log(id,action,entity_type,entity_id) VALUES('smoke-j1','test.action','horse','1')"
        )
        row = self.db.execute("SELECT * FROM canonical_mutation_log WHERE id='smoke-j1'").fetchone()
        self.assertEqual(row["status"], "intent")
        self.assertEqual(row["audit_status"], "pending")
        self.assertEqual(row["search_status"], "pending")
        # CHECK constraints reject statuses the runtime never writes.
        for column, bad in (("status", "bogus"), ("audit_status", "bogus"), ("search_status", "bogus")):
            with self.assertRaises(sqlite3.IntegrityError, msg=f"{column} must be CHECK-constrained"):
                self.db.execute(
                    f"INSERT INTO canonical_mutation_log(id,action,entity_type,{column}) VALUES('smoke-bad-{column}','t','horse','1')"
                )

    def test_functional_fts_insert_and_search(self):
        self.db.execute(
            "INSERT INTO horses(id,name_latin,name_native) VALUES(424242,'Smoke FTS Mare','老烟熏')"
        )
        self.db.execute(
            """INSERT INTO horse_search_source(horse_id,name_latin,name_native,identifiers,owners,breeders,
               father_name,mother_name,places,breed,all_text)
               VALUES(424242,'Smoke FTS Mare','老烟熏','REG-42','Owner A','Breeder B',
               'Sire C','Dam D','Place E','Breed F','Smoke FTS Mare 老烟熏 REG-42 Owner A Breeder B')"""
        )
        self.db.execute(
            """INSERT INTO horse_search_fts(rowid,name_latin,name_native,identifiers,owners,breeders,
               father_name,mother_name,places,breed,all_text)
               VALUES(424242,'Smoke FTS Mare','老烟熏','REG-42','Owner A','Breeder B',
               'Sire C','Dam D','Place E','Breed F','Smoke FTS Mare 老烟熏 REG-42 Owner A Breeder B')"""
        )
        hits = self.db.execute(
            "SELECT rowid FROM horse_search_fts WHERE horse_search_fts MATCH ? ORDER BY rank LIMIT 10",
            ('name_latin : "Smoke"',),
        ).fetchall()
        self.assertIn(424242, [row["rowid"] for row in hits], "FTS unicode61 search must find inserted row")

    def test_functional_trigram_insert_and_search(self):
        self.db.execute(
            "INSERT INTO horses(id,name_latin) VALUES(424243,'Zephyrion Trigram')"
        )
        self.db.execute(
            "INSERT INTO horse_search_trigram(rowid,all_text) VALUES(424243,'Zephyrion Trigram REG-43')"
        )
        # Trigram tokenizer supports substring (infix) matching beyond word boundaries.
        hits = self.db.execute(
            "SELECT rowid FROM horse_search_trigram WHERE horse_search_trigram MATCH ?",
            ('"hyrio"',),
        ).fetchall()
        self.assertIn(424243, [row["rowid"] for row in hits], "trigram search must match infix substring")

    def test_functional_role_trigram_insert_and_search(self):
        self.db.execute("INSERT INTO horses(id,name_latin) VALUES(424244,'Role Search Mare')")
        self.db.execute(
            "INSERT INTO horse_role_search_trigram(rowid,owner,breeder,importer,passport_receiver) VALUES(424244,?,?,?,?)",
            ("Morgan Reed", "Breeder Alpha", "", ""),
        )
        hits = self.db.execute(
            "SELECT rowid FROM horse_role_search_trigram WHERE owner MATCH ?",
            ('"gan re"',),
        ).fetchall()
        self.assertIn(424244, [row["rowid"] for row in hits], "role trigram must match owner substring")

    def test_showcase_filter_count_migration_is_portable_ordinary_sql(self):
        raw = (MIGRATIONS / "0013_showcase_filter_counts.sql").read_text(encoding="utf-8")
        sql = "\n".join(line.split("--", 1)[0] for line in raw.splitlines()).upper()
        for sqlite_only in ("VIRTUAL TABLE", "FTS5", "WITHOUT ROWID", "PRAGMA", "COLLATE NOCASE", "INSERT OR IGNORE"):
            self.assertNotIn(sqlite_only, sql)


if __name__ == "__main__":
    unittest.main()
