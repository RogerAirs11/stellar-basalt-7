#!/usr/bin/env node
/* Regenerate audit/r95/expected-schema.json from the canonical migration
 * chain (local SQLite, every migration applied — the same source of truth the
 * PG parity gate proves). Used after schema-adding migrations; the probe file
 * is what verify-r95-primary-schema.mjs checks production against.
 * Usage: node tools/regen-expected-schema.mjs [--check] */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const target = join(root, "audit", "r95", "expected-schema.json");

// Apply the full chain to a fresh scratch SQLite via the repo's own runner,
// then introspect with python (sqlite3 is in the stdlib).
// FTS5 virtual tables (and their _data/_idx/_content/_docsize/_config shadow
// tables) are EXCLUDED: the PG parity gate (scripts/pg-parity-gate.mjs)
// deliberately skips CREATE VIRTUAL TABLE — production Postgres serves search
// via horse_search_source — so the probe's expectation must match what a
// correct PostgreSQL deployment can actually have.
const script = `
import sqlite3, json, sys, re
db = sqlite3.connect(":memory:")
migrations = sorted(__import__("os").listdir(sys.argv[1]))
for name in migrations:
    if not name.endswith(".sql"): continue
    sql = open(sys.argv[1] + "/" + name, encoding="utf-8").read()
    # R125: D1's SQLite fork accepts PostgreSQL's ADD COLUMN IF NOT EXISTS
    # (0098); stock python sqlite3 does not — normalize the dialect.
    sql = re.sub(r"ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+", "ADD COLUMN ", sql, flags=re.IGNORECASE)
    db.executescript(sql)
virtual = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL%'")]
def is_fts(name):
    return any(name == v or name.startswith(v + "_") for v in virtual)
columns = []
for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
    if is_fts(table): continue
    for row in db.execute(f"PRAGMA table_info({table})"):
        columns.append(table + "." + row[1])
indexes = sorted(r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND sql LIKE '%UNIQUE%'"))
print(json.dumps({"migrations": len(migrations), "columns": sorted(columns), "unique_indexes": indexes}))
`;
const tmp = join(tmpdir(), "regen-expected-schema.py");
writeFileSync(tmp, script);
const out = execFileSync("python3", [tmp, join(root, "migrations")], { encoding: "utf8" });
const parsed = JSON.parse(out);

// required_unique_indexes: keep the previously curated list (the probe's
// contract) — a column/migration refresh never silently changes it.
const previous = JSON.parse(readFileSync(target, "utf8"));
const next = {
  migrations: parsed.migrations,
  columns: parsed.columns,
  required_unique_indexes: previous.required_unique_indexes,
};
if (check) {
  const same = JSON.stringify(previous) === JSON.stringify(next);
  console.log(`expected-schema ${same ? "unchanged" : "OUT OF DATE"}: migrations ${previous.migrations} -> ${next.migrations}, columns ${previous.columns.length} -> ${next.columns.length}`);
  process.exit(same ? 0 : 1);
}
writeFileSync(target, JSON.stringify(next, null, 2) + "\n");
console.log(`expected-schema.json regenerated: migrations=${next.migrations}, columns=${next.columns.length} (unique indexes found in chain: ${parsed.unique_indexes.length}; curated required list kept: ${next.required_unique_indexes.length})`);
