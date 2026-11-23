// R159: token frequency audit for Farsi transliteration QA
import postgres from "postgres";
import { toFarsi } from "./r158-transliterator.mjs";

const sql = postgres(
  `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  { max: 3, prepare: false },
);

// All Latin tokens appearing in people.name_latin (the transliteration source)
const rows = await sql`
  SELECT lower(t.token) AS tok, count(*)::int AS n
  FROM people p, LATERAL unnest(string_to_array(regexp_replace(p.name_latin, '[^A-Za-z ]', ' ', 'g'), ' ')) AS t(token)
  WHERE p.deleted_at IS NULL AND p.name_latin IS NOT NULL AND t.token <> ''
  GROUP BY 1 ORDER BY n DESC LIMIT 400`;
console.log("=== TOP 400 Latin tokens: latin -> current farsi ===");
for (const r of rows) {
  console.log(`${r.n}\t${r.tok}\t->\t${toFarsi(r.tok)}`);
}

// Names containing 'shah' or 'shahr' specifically (user's example)
console.log("\n=== shahr/shahzad family names ===");
const sh = await sql`
  SELECT DISTINCT name_latin, name_native FROM people
  WHERE deleted_at IS NULL AND name_latin ~* 'shah?r' AND name_latin ~ '[A-Za-z]'
    AND (name_native IS NULL OR name_native = '' OR name_native = name_latin OR name_native !~ '[\u0600-\u06FF]')
  LIMIT 40`;
for (const r of sh) console.log(`${r.name_latin}\t->\t${toFarsi(r.name_latin)}`);

await sql.end();
