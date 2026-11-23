#!/usr/bin/env node
/**
 * R82 Supabase pre-deploy step: translate migration 0033 (horse_identifiers +
 * identifier_conflicts) into the repo-convention Postgres DDL using the SAME
 * converter that generates the production schema (tools/sqlite-to-postgres-schema.mjs),
 * by feeding it a synthetic sqlite_master dump of exactly the 0033 objects.
 * The generated DDL is then applied additively (IF NOT EXISTS) to the Supabase
 * canonical database BEFORE the worker deploy, so there is no window where
 * production code writes to a missing table (the R81 lesson).
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const inputPath = join(root, "sandbox", "d1-0033-only-schema.json");
const schemaOut = join(root, "sandbox", "postgres-full-schema.sql");
const fksOut = join(root, "sandbox", "postgres-full-fks.sql");
const schemaBackup = schemaOut + ".r82bak";
const fksBackup = fksOut + ".r82bak";
const ddlOut = join(root, "sandbox", "postgres-0033-additive.sql");

const HORSE_IDENTIFIERS_SQL = `CREATE TABLE horse_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  issuer_namespace TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  horse_id INTEGER NOT NULL REFERENCES horses(id),
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','superseded','conflict','archived')),
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
const IDENTIFIER_CONFLICTS_SQL = `CREATE TABLE identifier_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  issuer_namespace TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  kept_horse_id INTEGER NOT NULL,
  conflicting_horse_id INTEGER NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolution_note TEXT
)`;

const rows = [
  { type: "table", name: "horse_identifiers", tbl_name: "horse_identifiers", sql: HORSE_IDENTIFIERS_SQL },
  { type: "index", name: "idx_horse_identifiers_horse", tbl_name: "horse_identifiers", sql: "CREATE INDEX idx_horse_identifiers_horse ON horse_identifiers(horse_id,kind,status)" },
  { type: "index", name: "idx_horse_identifiers_lookup", tbl_name: "horse_identifiers", sql: "CREATE INDEX idx_horse_identifiers_lookup ON horse_identifiers(kind,issuer_namespace,normalized_value) WHERE status='live'" },
  { type: "index", name: "uq_horse_identifiers_live", tbl_name: "horse_identifiers", sql: "CREATE UNIQUE INDEX uq_horse_identifiers_live ON horse_identifiers(kind,issuer_namespace,normalized_value) WHERE status='live'" },
  { type: "table", name: "identifier_conflicts", tbl_name: "identifier_conflicts", sql: IDENTIFIER_CONFLICTS_SQL },
  { type: "index", name: "idx_identifier_conflicts_open", tbl_name: "identifier_conflicts", sql: "CREATE INDEX idx_identifier_conflicts_open ON identifier_conflicts(kind,issuer_namespace,normalized_value) WHERE resolved_at IS NULL" },
];
writeFileSync(inputPath, JSON.stringify(rows, null, 2));

// Back up the R81b reference outputs, run the converter, restore.
copyFileSync(schemaOut, schemaBackup);
copyFileSync(fksOut, fksBackup);
try {
  execFileSync("node", ["tools/sqlite-to-postgres-schema.mjs", inputPath], { stdio: "inherit" });
  const generated = readFileSync(schemaOut, "utf8");
  const fks = readFileSync(fksOut, "utf8");
  writeFileSync(ddlOut, generated + "\n-- foreign keys (if any)\n" + fks);
  console.log(`\ngenerated additive DDL -> ${ddlOut}`);
} finally {
  copyFileSync(schemaBackup, schemaOut);
  copyFileSync(fksBackup, fksOut);
  console.log("restored sandbox/postgres-full-schema.sql + postgres-full-fks.sql");
}
