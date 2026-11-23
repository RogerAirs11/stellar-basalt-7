#!/usr/bin/env node
/**
 * turn-27: recreate the 8 missing canonical search indexes on live Supabase
 * (lost during the turn-26 data-quality refresh of horse_search_source).
 * Uses CREATE INDEX CONCURRENTLY so production reads/writes never block.
 * Idempotent: skips indexes that already exist.
 */
import postgres from "postgres";

// R131 SECURITY SCRUB: no inline fallback credentials — SUPABASE_URL is required
// (canonical store: vault TOKENS.md).
const CS = process.env.SUPABASE_URL;
if (!CS) throw new Error("Set SUPABASE_URL (vault TOKENS.md)");
const sql = postgres(CS, { ssl: { rejectUnauthorized: false }, connect_timeout: 10, max: 1, idle_timeout: 5, prepare: false });

const INDEXES = [
  ["idx_horses_name_latin_lower", "CREATE INDEX CONCURRENTLY idx_horses_name_latin_lower ON horses(lower(name_latin))"],
  ["idx_horses_register_no_lower", "CREATE INDEX CONCURRENTLY idx_horses_register_no_lower ON horses(lower(register_no))"],
  ["idx_horse_search_all_fts_simple", "CREATE INDEX CONCURRENTLY idx_horse_search_all_fts_simple ON horse_search_source USING gin (to_tsvector('simple', all_text))"],
  ["idx_horse_search_name_latin_trgm", "CREATE INDEX CONCURRENTLY idx_horse_search_name_latin_trgm ON horse_search_source USING gin (name_latin gin_trgm_ops)"],
  ["idx_horse_search_name_native_trgm", "CREATE INDEX CONCURRENTLY idx_horse_search_name_native_trgm ON horse_search_source USING gin (name_native gin_trgm_ops)"],
  // R151: owner/breeder/place typo tolerance for forgiving search. Applied live
  // on 2026-10-29 (owner directive); listed here so rebuilds reproduce them.
  ["idx_horse_search_owners_trgm", "CREATE INDEX CONCURRENTLY idx_horse_search_owners_trgm ON horse_search_source USING gin (owners gin_trgm_ops)"],
  ["idx_horse_search_breeders_places_trgm", "CREATE INDEX CONCURRENTLY idx_horse_search_breeders_places_trgm ON horse_search_source USING gin ((breeders || ' ' || places) gin_trgm_ops)"],
  ["idx_people_name_latin_trgm", "CREATE INDEX CONCURRENTLY idx_people_name_latin_trgm ON people USING gin (name_latin gin_trgm_ops) WHERE deleted_at IS NULL"],
  ["idx_people_name_native_trgm", "CREATE INDEX CONCURRENTLY idx_people_name_native_trgm ON people USING gin (name_native gin_trgm_ops) WHERE deleted_at IS NULL"],
  ["idx_horse_people_person_role_horse", "CREATE INDEX CONCURRENTLY idx_horse_people_person_role_horse ON horse_people(person_id,role,horse_id)"],
];

const existing = new Set((await sql.unsafe("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).map(r => r.indexname));
for (const [name, ddl] of INDEXES) {
  if (existing.has(name)) { console.log("SKIP (exists):", name); continue; }
  const t0 = Date.now();
  try {
    await sql.unsafe(ddl);
    console.log("CREATED:", name, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (error) {
    // CONCURRENTLY failures leave an INVALID index — drop it so a re-run can retry.
    console.log("FAILED:", name, "-", String(error.message).slice(0, 120));
    try { await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`); console.log("  (cleaned up invalid index)"); } catch { }
  }
}
await sql.end({ timeout: 5 });
console.log("DONE");
