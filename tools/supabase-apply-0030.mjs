// tools/supabase-apply-0030.mjs — apply the R59 integrity migration (0030) to the
// canonical Supabase Postgres database (the SQLite file targets D1; this is the
// equivalent for Postgres). D1 gets 0030 via the normal migrations path (CI /
// self-heal) once its daily row-read quota resets.
import postgres from "postgres";

const SUPA_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPA_URL) { console.error("Need SUPABASE_DATABASE_URL"); process.exit(1); }
const sql = postgres(SUPA_URL, { prepare: false, max: 1 });

async function main() {
  // 1. media blobs composite PK (table is empty; recreate directly)
  await sql.unsafe(`DROP TABLE IF EXISTS horse_media_blobs CASCADE`);
  await sql.unsafe(`CREATE TABLE horse_media_blobs (
    media_id text NOT NULL,
    chunk bigint NOT NULL DEFAULT 0,
    data bytea NOT NULL,
    created_at text NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
    PRIMARY KEY(media_id, chunk))`);
  await sql.unsafe(`ALTER TABLE horse_media_blobs ADD CONSTRAINT fk_horse_media_blobs_media_id
    FOREIGN KEY (media_id) REFERENCES horse_media(id) ON DELETE CASCADE`);
  console.log("✓ horse_media_blobs composite PK");

  // 2. unique phone
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_identities_phone ON phone_identities(phone_e164)`);
  console.log("✓ phone unique");

  // 3. competition entry unique per class
  await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_results_entry
    ON competition_results(competition_id, horse_id, COALESCE(class_name, ''))`);
  console.log("✓ competition entry unique");

  // 4. genetic tests: drop UNIQUE(horse_id, test_type)
  await sql.unsafe(`ALTER TABLE genetic_tests DROP CONSTRAINT IF EXISTS genetic_tests_horse_id_test_type_key`);
  console.log("✓ genetic retests allowed");

  // 5. breeding: drop UNIQUE(sire_id, dam_id, season)
  await sql.unsafe(`ALTER TABLE breeding_records DROP CONSTRAINT IF EXISTS breeding_records_sire_id_dam_id_season_key`);
  console.log("✓ breeding re-covering allowed");

  // 6. horse_claims person_id
  await sql.unsafe(`ALTER TABLE horse_claims ADD COLUMN IF NOT EXISTS person_id bigint`);
  await sql.unsafe(`ALTER TABLE horse_claims DROP CONSTRAINT IF EXISTS fk_horse_claims_person_id`);
  await sql.unsafe(`ALTER TABLE horse_claims ADD CONSTRAINT fk_horse_claims_person_id
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL`);
  console.log("✓ horse_claims.person_id");

  // verify
  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND indexname IN ('uq_phone_identities_phone','uq_competition_results_entry')`;
  console.log("unique indexes present:", idx.map((r) => r.indexname).join(", "));
  const pk = await sql`
    SELECT constraint_type, column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    WHERE tc.table_name='horse_media_blobs' AND tc.constraint_type='PRIMARY KEY'`;
  console.log("media_blobs PK columns:", pk.map((r) => r.column_name).join(", "));
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); }).finally(async () => {
  await sql.end({ timeout: 2 });
});
