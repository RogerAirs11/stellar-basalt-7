#!/usr/bin/env node
/** R132 evidence: run the pedigree recursive CTEs (ancestors + descendants)
 * through the production SQLite→PG translator against the live Supabase
 * PostgreSQL (read-only). Env-var credentials only. */
import { sqliteSqlToPostgres } from "../src/db/sqliteSqlToPostgres.ts";
import postgres from "postgres";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, fetch_types: false });

const PEDIGREE_HORSE_FIELDS = ["id", "name_latin", "name_native", "father_id", "mother_id", "birth_year", "breed_desc", "sex_desc", "color_desc", "main_strain_desc"];
const COLS_H = PEDIGREE_HORSE_FIELDS.map((f) => `h.${f}`).join(",");

const ancestorsSql = `
    WITH RECURSIVE walk(id, depth) AS (
      SELECT h.id, 0 FROM horses h WHERE h.id = ? AND h.deleted_at IS NULL
      UNION
      SELECT par.id, a.depth + 1
      FROM walk a
      JOIN horses h ON h.id = a.id
      CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) side
      JOIN horses par ON par.id = CASE WHEN side.k = 0 THEN h.father_id ELSE h.mother_id END
      WHERE a.depth < ?
        AND CASE WHEN side.k = 0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
        AND par.deleted_at IS NULL
    )
    SELECT ${COLS_H}, MIN(walk.depth) AS discovered_depth
    FROM walk JOIN horses h ON h.id = walk.id
    GROUP BY h.id, h.father_id, h.mother_id
    ORDER BY discovered_depth, h.id
  `;

const descendantsSql = `
    WITH RECURSIVE walk(id, depth) AS (
      SELECT h.id, 0 FROM horses h WHERE h.id = ? AND h.deleted_at IS NULL
      UNION
      SELECT child.id, a.depth + 1
      FROM walk a
      JOIN horses child ON child.deleted_at IS NULL
        AND (child.father_id = a.id OR child.mother_id = a.id)
      WHERE a.depth < ?
    )
    SELECT ${COLS_H}, walk.depth AS discovered_depth
    FROM walk JOIN horses h ON h.id = walk.id
    ORDER BY walk.depth, h.id
    LIMIT ?
  `;

async function run(label, sqliteText, params) {
  const translated = sqliteSqlToPostgres(sqliteText);
  const t0 = Date.now();
  try {
    const rows = await sql.unsafe(translated, params);
    console.log(`${label}: SUCCESS ${rows.length} rows in ${Date.now() - t0}ms`);
    return rows;
  } catch (error) {
    console.error(`${label}: FAILED (${Date.now() - t0}ms) — ${error.message}`);
    return null;
  }
}

// Find a horse with a real pedigree (has both parents) for a meaningful walk.
const seeded = await sql`SELECT id FROM horses WHERE father_id IS NOT NULL AND mother_id IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1`;
const horseId = seeded[0]?.id ?? 1;
console.log("test horse id:", horseId);

const anc = await run("ancestors depth 4", ancestorsSql, [horseId, 4]);
if (anc) console.log("  sample:", JSON.stringify(anc.slice(0, 2)));
await run("ancestors depth 8", ancestorsSql, [horseId, 8]);
await run("ancestors depth 16", ancestorsSql, [horseId, 16]);
const desc = await run("descendants depth 3", descendantsSql, [horseId, 3, 480]);
if (desc) console.log("  sample:", JSON.stringify(desc.slice(0, 2)));
await run("descendants depth 6", descendantsSql, [horseId, 6, 480]);
// nonexistent horse -> empty result (the null path)
await run("ancestors of id 999999999", ancestorsSql, [999999999, 4]);

await sql.end({ timeout: 3 });
