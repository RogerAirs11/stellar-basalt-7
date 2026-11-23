#!/usr/bin/env node
/**
 * R83 Supabase pre-deploy step: translate migration 0034 (user_person_links,
 * organizations, organization_memberships, horse_access_grants) into the
 * repo-convention Postgres DDL using the SAME converter that generates the
 * production schema (tools/sqlite-to-postgres-schema.mjs), by feeding it a
 * synthetic sqlite_master dump of exactly the 0034 objects.
 * The generated DDL is applied additively (IF NOT EXISTS) to the Supabase
 * canonical database BEFORE the worker deploy (R81 lesson: no 500 window).
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const inputPath = join(root, "sandbox", "d1-0034-only-schema.json");
const schemaOut = join(root, "sandbox", "postgres-full-schema.sql");
const fksOut = join(root, "sandbox", "postgres-full-fks.sql");
const schemaBackup = schemaOut + ".r83bak";
const fksBackup = fksOut + ".r83bak";
const ddlOut = join(root, "sandbox", "postgres-0034-additive.sql");

const TABLES = {
  user_person_links: `CREATE TABLE user_person_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','revoked')),
  verification_method TEXT,
  verified_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  organizations: `CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name_native TEXT,
  name_latin TEXT,
  kind TEXT NOT NULL DEFAULT 'stable' CHECK (kind IN ('stable','breeder','club','association','service')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  organization_memberships: `CREATE TABLE organization_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','manager','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  horse_access_grants: `CREATE TABLE horse_access_grants (
  id TEXT PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  grantee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  grantee_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('owner','breeder','manager','seller')),
  actions TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'claim_approval' CHECK (basis IN ('claim_approval','admin_grant','organization_mandate')),
  basis_ref TEXT,
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (grantee_user_id IS NOT NULL OR grantee_organization_id IS NOT NULL)
)`,
};

const INDEXES = [
  ["idx_user_person_links_person", "user_person_links", "CREATE INDEX idx_user_person_links_person ON user_person_links(person_id, status)"],
  ["idx_organization_memberships_user", "organization_memberships", "CREATE INDEX idx_organization_memberships_user ON organization_memberships(user_id, status)"],
  ["idx_horse_access_grants_horse", "horse_access_grants", "CREATE INDEX idx_horse_access_grants_horse ON horse_access_grants(horse_id, relationship)"],
  ["idx_horse_access_grants_user", "horse_access_grants", "CREATE INDEX idx_horse_access_grants_user ON horse_access_grants(grantee_user_id, revoked_at)"],
  ["idx_horse_access_grants_org", "horse_access_grants", "CREATE INDEX idx_horse_access_grants_org ON horse_access_grants(grantee_organization_id, revoked_at)"],
];

const rows = [
  ...Object.entries(TABLES).map(([name, sql]) => ({ type: "table", name, tbl_name: name, sql })),
  ...INDEXES.map(([name, tbl, sql]) => ({ type: "index", name, tbl_name: tbl, sql })),
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
