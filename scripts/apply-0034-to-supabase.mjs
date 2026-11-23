#!/usr/bin/env node
/**
 * R83: apply the additive 0034 Postgres DDL (user_person_links, organizations,
 * organization_memberships, horse_access_grants) to the Supabase canonical
 * database. Runs BEFORE the worker deploy so production never writes to a
 * missing table. Usage: SUPABASE_DATABASE_URL=... node scripts/apply-0034-to-supabase.mjs
 */
import { requireCanonicalMigrationApproval } from "./lib/migration-approval.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) {
  console.error("Need SUPABASE_DATABASE_URL");
  process.exit(2);
}
requireCanonicalMigrationApproval(url, "0034");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const ddl = readFileSync(join(process.cwd(), "sandbox", "postgres-0034-additive.sql"), "utf8");

const EXPECTED_TABLES = ["horse_access_grants", "organization_memberships", "organizations", "user_person_links"];
const EXPECTED_INDEXES = ["idx_horse_access_grants_horse", "idx_horse_access_grants_org", "idx_horse_access_grants_user", "idx_organization_memberships_user", "idx_user_person_links_person"];

try {
  await sql.unsafe(ddl);
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name::text IN ('horse_access_grants','organization_memberships','organizations','user_person_links')
    ORDER BY table_name`;
  const indexes = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND indexname IN ('idx_horse_access_grants_horse','idx_horse_access_grants_org','idx_horse_access_grants_user','idx_organization_memberships_user','idx_user_person_links_person')
    ORDER BY indexname`;
  console.log("tables:", tables.map((row) => row.table_name).join(", "));
  console.log("indexes:", indexes.map((row) => row.indexname).join(", "));
  if (tables.length !== 4 || indexes.length !== 5) {
    console.error(`EXPECTED 4 tables + 5 indexes (got ${tables.length} + ${indexes.length})`);
    process.exit(1);
  }
  // The CHECK constraints ride along with the tables; verify the critical ones.
  const checks = await sql`
    SELECT ccu.constraint_name FROM information_schema.check_constraints ccu
    WHERE ccu.constraint_schema='public' AND ccu.constraint_name::text LIKE '%horse_access_grants%'`;
  console.log("grant check constraints:", checks.length);
  // The inline SQLite UNIQUE constraints are appended by hand in the DDL.
  const uniques = await sql`
    SELECT conname FROM pg_constraint
    WHERE connamespace='public'::regnamespace AND contype='u'
      AND conname IN ('uq_user_person_links_user_person','uq_organization_memberships_org_user')
    ORDER BY conname`;
  console.log("unique constraints:", uniques.map((row) => row.conname).join(", "));
  if (uniques.length !== 2) {
    console.error("EXPECTED the 2 inline UNIQUE constraints");
    process.exit(1);
  }
  console.log("0034 additive DDL applied to Supabase: OK");
} finally {
  await sql.end({ timeout: 5 });
}
