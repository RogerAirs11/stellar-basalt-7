#!/usr/bin/env node
/* R95-N13 ad-hoc verification: the single-statement dossier snapshot SQL
 * (correlated scalar subqueries + json_group_array/json_object aggregation)
 * must translate through the PRODUCTION translator and execute identically
 * on real PostgreSQL and SQLite. The JSON aggregate TEXT formatting differs
 * by design (jsonb key order); this script compares the PARSED structure and
 * the engine-identical scalars. Run after `node scripts/r95-n02-pg-parity.mjs`
 * has proven the migration chain (embedded PG at /tmp/pgembedded).
 * Evidence: audit/r95/evidence/pg-parity-n13.txt */
require("../tools/lib/register-typescript.cjs");
const { openLocalSqlite } = require("../src/db/localSqlite.ts");
const { sqliteSqlToPostgres } = require("../src/db/sqliteSqlToPostgres.ts");
const { DOSSIER_SNAPSHOT_SELECT_SQL } = require("../src/dossiers/snapshot.ts");
const { readFileSync, readdirSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const ROOT = join(__dirname, "..");

async function main() {
const { default: EmbeddedPostgres } = await import("/tmp/pgembedded/node_modules/embedded-postgres/dist/index.js");
const { default: postgres } = await import("postgres");
const { applyMigrationChain } = await import("./lib/pg-ddl.mjs");

// Build the full-inclusion statement exactly like production does.
const sections = {
  "{{pedigree}}": `,(SELECT json_group_array(json_object('sire_id',sire.id,'sire_name',sire.name_latin,'dam_id',dam.id,'dam_name',dam.name_latin))
      FROM horses h2
      LEFT JOIN horses sire ON sire.id=h2.father_id AND sire.deleted_at IS NULL
      LEFT JOIN horses dam ON dam.id=h2.mother_id AND dam.deleted_at IS NULL
      WHERE h2.id=h.id) AS pedigree_rows`,
  "{{results}}": `,(SELECT json_group_array(json_object('id',t.id,'placement',t.placement,'placement_text',t.placement_text,'score',t.score,'is_eliminated',t.is_eliminated,'is_withdrawn',t.is_withdrawn,'provenance',t.provenance,'competition',t.competition,'event_date',t.event_date,'discipline',t.discipline))
      FROM (SELECT cr.id, cr.placement, cr.placement_text, cr.score, cr.is_eliminated, cr.is_withdrawn, cr.provenance,
                   c.name_native AS competition, c.event_date, c.discipline
            FROM competition_results cr JOIN competitions c ON c.id=cr.competition_id
            WHERE cr.horse_id=h.id ORDER BY c.event_date DESC, cr.id DESC LIMIT 20) t) AS results_rows
  ,(SELECT COUNT(*) FROM competition_results WHERE horse_id=h.id) AS results_total`,
  "{{genetics}}": `,(SELECT json_group_array(json_object('id',t.id,'test_type',t.test_type,'test_category',t.test_category,'result',t.result,'result_interpretation',t.result_interpretation,'lab_name',t.lab_name,'lab_accession',t.lab_accession,'tested_at',t.tested_at,'verified',t.verified,'provenance',t.provenance,'notes',t.notes))
      FROM (SELECT id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,provenance,notes
            FROM genetic_tests WHERE horse_id=h.id AND verified=1 ORDER BY tested_at DESC, id DESC LIMIT 30) t) AS genetics_rows`,
  "{{contact}}": `,(SELECT json_object('display_name',u.display_name,'email',u.email) FROM users u WHERE u.id=?) AS contact_row`,
};
let sqliteSql = DOSSIER_SNAPSHOT_SELECT_SQL;
for (const [placeholder, subquery] of Object.entries(sections)) sqliteSql = sqliteSql.replace(placeholder, subquery);
const contactIdx = sqliteSql.indexOf("WHERE u.id=?"); // contact bind precedes the horse bind
const sqliteBinds = [ "seller-1", 9 ];

const pg = new EmbeddedPostgres({
  databaseDir: "/tmp/pgembedded/data", user: "postgres", password: "postgres",
  port: 5433, persistent: false,
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=/tmp"],
});

function parseTransport(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") { try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
function parseObjectTransport(value) {
  if (value == null) return null;
  if (typeof value === "string") { try { const p = JSON.parse(value); return p && typeof p === "object" ? p : null; } catch { return null; } }
  return value && typeof value === "object" ? value : null;
}
const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
};
function normalizeRow(row) {
  return {
    horse_id: Number(row.horse_id),
    name_latin: row.name_latin,
    source_updated_at: row.source_updated_at,
    pedigree: sortKeys(parseTransport(row.pedigree_rows)),
    results: sortKeys(parseTransport(row.results_rows)),
    results_total: Number(row.results_total),
    genetics: sortKeys(parseTransport(row.genetics_rows)),
    contact: sortKeys(parseObjectTransport(row.contact_row)),
  };
}

const SEED = [
  ["INSERT INTO users(id,email,display_name,password_hash,role) VALUES('seller-1','s@x.test','SELLER','unused','user')", []],
  ["INSERT INTO horses(id,name_latin,name_native,sex_desc,birth_year,color_desc,breed_desc,is_active) VALUES(1,'SIRE','p','stallion',2010,'bay','A',1),(2,'DAM','m','mare',2012,'grey','A',1),(9,'STAR','s','stallion',2018,'bay','A',1)", []],
  ["UPDATE horses SET father_id=1, mother_id=2, updated_at='2026-01-01 00:00:00' WHERE id=9", []],
  ["INSERT INTO competitions(id,name_native,event_date,discipline,venue,season) VALUES(5,'JAM','2026-06-01','show_jumping','Tehran',2026)", []],
  ["INSERT INTO competition_results(competition_id,horse_id,placement,provenance) VALUES(5,9,1,'federation')", []],
  ["INSERT INTO genetic_tests(horse_id,test_type,test_category,result,lab_name,verified,tested_at) VALUES(9,'panel','coat_color','Ee','Lab A',1,'2026-01-01')", []],
];

const out = [];
const log = (line) => { out.push(line); console.log(line); };

try {
  // SQLite reference (production localSqlite adapter, all migrations).
  const sqlite = openLocalSqlite(":memory:");
  const files = readdirSync(join(ROOT, "migrations")).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  for (const f of files) await sqlite.exec(readFileSync(join(ROOT, "migrations", f), "utf8"));
  for (const [sql, args] of SEED) await sqlite.prepare(sql).bind(...args).run();
  const sqliteRow = (await sqlite.prepare(sqliteSql).bind(...sqliteBinds).first());
  const sqliteNormalized = normalizeRow(sqliteRow);

  // PostgreSQL through the PRODUCTION translator.
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("n13");
  const sql = postgres("postgres://postgres:postgres@127.0.0.1:5433/n13", { max: 1 });
  await sql.unsafe("CREATE SCHEMA n13");
  await sql.unsafe("SET search_path TO n13");
  const migrationsInfo = await applyMigrationChain(sql);
  for (const [statement, args] of SEED) await sql.unsafe(statement, args);
  const pgSql = sqliteSqlToPostgres(sqliteSql);
  log(`translated statement length: sqlite=${sqliteSql.length} pg=${pgSql.length}`);
  log(`json_group_array translated: ${pgSql.includes("jsonb_agg")}`);
  log(`json_object translated: ${pgSql.includes("jsonb_build_object")}`);
  const pgRows = await sql.unsafe(pgSql, sqliteBinds);
  const pgNormalized = normalizeRow(pgRows[0]);
  await sql.unsafe("DROP SCHEMA n13 CASCADE");
  await sql.end({ timeout: 5 });

  const differences = [];
  for (const key of Object.keys(sqliteNormalized)) {
    if (JSON.stringify(sqliteNormalized[key]) !== JSON.stringify(pgNormalized[key])) {
      differences.push(`  DIFF ${key}:\n    sqlite=${JSON.stringify(sqliteNormalized[key])}\n    pg=${JSON.stringify(pgNormalized[key])}`);
    }
  }
  log("");
  log(`migrations applied: ${migrationsInfo.applied}`);
  log(`snapshot single-statement parity: ${differences.length === 0 ? "PROVEN (parsed structure + scalars identical)" : "FAILED"}`);
  for (const difference of differences) log(difference);
  process.exitCode = differences.length === 0 ? 0 : 1;
} catch (error) {
  log(`RUNNER FAILURE: ${error && error.stack ? error.stack : String(error)}`);
  process.exitCode = 1;
} finally {
  try { await pg.stop(); } catch { /* already down */ }
  mkdirSync(join(ROOT, "audit/r95/evidence"), { recursive: true });
  writeFileSync(join(ROOT, "audit/r95/evidence/pg-parity-n13.txt"), `${out.join("\n")}\n\nR95-N13 single-statement dossier snapshot — SQLite vs PostgreSQL (production translator, parsed-structure comparison)\nGenerated ${new Date().toISOString()}\n`);
}
}

main().catch((error) => { console.error(error && error.stack ? error.stack : String(error)); process.exit(1); });
