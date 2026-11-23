#!/usr/bin/env node
/**
 * R81 helper: prove migrations 0031/0032 translate cleanly through the
 * production SQLite->Postgres translator (the parity gate's first stage).
 * Full pg-parity-gate runs in CI/locally with a live PostgreSQL connection;
 * this script validates translation-only, no DB required.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTsRuntime } from "../tools/ts-runtime-loader.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rt = compileTsRuntime(["src/db/sqliteSqlToPostgres.ts"]);
const { sqliteSqlToPostgres } = rt.load("src/db/sqliteSqlToPostgres.ts");

const files = process.argv.slice(2);
let failed = 0;
for (const file of files) {
  const sql = readFileSync(join(root, file), "utf8");
  const out = sqliteSqlToPostgres(sql);
  const sqliteTokens = /SERIAL|AUTOINCREMENT|strftime|julianday|group_concat\s*\(/i.exec(out);
  if (sqliteTokens) {
    console.error(`FAIL ${file}: sqlite-specific token '${sqliteTokens[0]}' survived translation`);
    failed += 1;
  } else {
    console.log(`OK   ${file} translated (${out.length} chars)`);
  }
}
process.exit(failed ? 1 : 0);
