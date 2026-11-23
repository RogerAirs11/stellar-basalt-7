#!/usr/bin/env node
/** Offline renderer only: never connects to a database or applies a migration.
 * Render one reviewed pending migration at a time after comparing the actual
 * primary's migration ledger and schema. An already-applied ALTER is an error;
 * do not use this as an automatic repair or a substitute for release approval.
 * Usage: node tools/render-r148-postgres-migrations.mjs --migration=0117 --out=/absolute/reviewed/0117.sql
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements, ddlNormalize } from "../scripts/lib/pg-ddl.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map(value => { const at=value.indexOf("="); return [value.slice(0,at),value.slice(at+1)]; }));
const migration = args.get("--migration"), output = args.get("--out");
if (!migration || !/^01(?:1[0-9]|20)$/.test(migration) || !output || args.size !== 2) {
  throw new Error("Specify one migration0110–0120 and an explicit --out path; no database URL is accepted");
}
const names = (await readdir(resolve(root,"migrations"))).filter(name => name.startsWith(`${migration}_`) && name.endsWith(".sql"));
if (names.length !== 1) throw new Error("The selected migration must have exactly one source file");
const require=createRequire(import.meta.url); require("./lib/register-typescript.cjs");
const { sqliteSqlToPostgres } = require("../src/db/sqliteSqlToPostgres.ts");
const source = await readFile(resolve(root,"migrations",names[0]),"utf8");
const digest = createHash("sha256").update(source).digest("hex");
const statements = splitStatements(source).map(statement => sqliteSqlToPostgres(ddlNormalize(statement))).filter(statement => statement.trim());
const rendered = `-- OFFLINE R148 rendering of ${names[0]}\n-- Source SHA-256: ${digest}\n-- Apply only after exact-target backup, restore rehearsal, schema/ledger review and release approval.\n-- Preserve the migration ledger/checksum through the operator's selected migration system.\nBEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n${statements.map(statement => `${statement.replace(/;\s*$/,"")};`).join("\n\n")}\nCOMMIT;\n`;
const target = resolve(output); await mkdir(dirname(target),{recursive:true});
await writeFile(target,rendered,{flag:"wx"});
console.log(JSON.stringify({migration:names[0],source_sha256:digest,rendered_sha256:createHash("sha256").update(rendered).digest("hex"),statements:statements.length,applied:false,output:target}));
