#!/usr/bin/env node
/* Rehearsal for the R117-15/17/19 Supabase migration round on a LOCAL
 * disposable PostgreSQL: build the 88-migration (R114-03) state, then run the
 * exact live path — apply-0089 entrypoint, then the 0090-0092 range — and
 * prove idempotency by re-running apply-0089.
 * Usage: node scripts/rehearse-r117-supabase-round.mjs
 * (PG_CONNECTION_STRING + PG_PARITY_DISPOSABLE=yes point at the local
 * hr_test_* database; the approval lib's disposable-local mode gates it.) */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTsRuntime } from "../tools/ts-runtime-loader.mjs";
import { splitStatements, ddlNormalize } from "./lib/pg-ddl.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.PG_CONNECTION_STRING;
if (!url) { console.error("Need PG_CONNECTION_STRING"); process.exit(2); }
const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
const { sqliteSqlToPostgres, stripLeadingComments } = rt.load("src/db/sqliteSqlToPostgres.ts");
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

const files = readdirSync(join(root, "migrations")).filter(f => f.endsWith(".sql")).sort();
const upTo88 = files.filter(f => f.slice(0, 4) <= "0088");
console.log(`rehearsal: applying migrations 0001-0088 (${upTo88.length} files) to the disposable database`);
try {
  for (const file of upTo88) {
    const statements = splitStatements(readFileSync(join(root, "migrations", file), "utf8"));
    const translated = [];
    for (const statement of statements) {
      const bare = stripLeadingComments(statement);
      if (/^\s*PRAGMA\b/i.test(bare)) continue;
      if (/^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(bare)) continue;
      translated.push(sqliteSqlToPostgres(ddlNormalize(statement)));
    }
    await sql.begin(async (tx) => {
      for (const statement of translated) await tx.unsafe(statement);
    });
  }
  console.log("rehearsal: 88-migration state built (the R114-03 live baseline)");
  const checks = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'command_receipts'::regclass AND contype = 'c'`;
  console.log("baseline command_receipts CHECK:", checks.map(c => c.def).join(" | ").slice(0, 200));
  console.log("rehearsal: baseline ready — now run, in order:");
  console.log("  1) PG_PARITY_DISPOSABLE=yes node scripts/apply-0089-to-supabase.mjs   (with SUPABASE_DATABASE_URL=this db)");
  console.log("  2) SUPABASE_DATABASE_URL=this db node scripts/apply-range-to-supabase.mjs --from 0090 --to 0092");
  console.log("  3) re-run 1) — must exit 0 idempotent");
} finally {
  await sql.end({ timeout: 5 });
}
