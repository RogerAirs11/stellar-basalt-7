// Rebuild horse_search_source rows for the 13 asbdavani delta horses (2026-10-29).
// Same recipe as scripts/turn35-search-rebuild.js (normalizeText + all_text).
const { Client } = require('pg');
const DB_URL = 'postgresql://postgres.gqzglbknkodyasqfrqfv:G1RSQJRHMH6qKxSKqF5gQlnCiMaC@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
async function withDb(fn) {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000, query_timeout: 60000 });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const ARABIC_TO_PERSIAN = { "ي": "ی", "ى": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه" };
function normalizeText(input) {
  if (input == null) return "";
  let v = String(input).normalize("NFKC").trim().toLowerCase();
  v = v.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  v = v.replace(/[يكىةۀ]/g, (c) => ARABIC_TO_PERSIAN[c] ?? c);
  v = v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  v = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  v = v.replace(/[-‐‑‒–—―_./\\|,:;()[\]{}'"`~!@#$%^&*+=<>?]+/g, " ");
  v = v.replace(/\s+/g, " ").trim();
  return v;
}
const j = (parts) => normalizeText(parts.filter(x => x !== null && x !== undefined && x !== "").join(" "));

(async () => {
  const ids = [10121582, 10121583, 10121584, 10121585, 10121586, 10121587, 10121588,
               10121589, 10121590, 10121591, 10121592, 10121593, 10121594];
  console.log('rebuilding search rows for', ids.length, 'delta horses');

  await withDb(async (db) => {
    const r = await db.query(`
      SELECT h.id, h.name_latin, h.name_native, h.register_no, h.uel_no, h.life_number,
             h.birth_place_desc, h.imported_from_desc, h.birth_year, h.sex_desc, h.color_desc,
             h.breed_desc, h.main_strain_desc, h.sub_strain_desc,
             trim(COALESCE(f.name_latin,'') || ' ' || COALESCE(f.name_native,'')) AS father_name,
             trim(COALESCE(m.name_latin,'') || ' ' || COALESCE(m.name_native,'')) AS mother_name,
             COALESCE(ps.owner_name,'') AS owner_latin, COALESCE(ps.owner_name_native,'') AS owner_native,
             COALESCE(ps.breeder_name,'') AS breeder_latin, COALESCE(ps.breeder_name_native,'') AS breeder_native,
             COALESCE(ps.importer_name,'') AS importer_latin, COALESCE(ps.passport_receiver_name,'') AS pr_latin,
             (SELECT string_agg(a.alias, ' ') FROM horse_aliases a WHERE a.horse_id = h.id) AS aliases
      FROM horses h
      LEFT JOIN horses f ON f.id = h.father_id
      LEFT JOIN horses m ON m.id = h.mother_id
      LEFT JOIN horse_registry_people_summary ps ON ps.horse_id = h.id
      WHERE h.id = ANY($1::bigint[]) AND h.deleted_at IS NULL
    `, [ids]);

    for (const row of r.rows) {
      const nameLatin = normalizeText(row.name_latin);
      const nameNative = normalizeText(row.name_native);
      const identifiers = normalizeText([row.register_no, row.uel_no, row.life_number].filter(Boolean).join(" "));
      const owners = j([row.owner_latin, row.owner_native]);
      const breeders = j([row.breeder_latin, row.breeder_native]);
      const importers = normalizeText(row.importer_latin);
      const prs = normalizeText(row.pr_latin);
      const aliases = normalizeText(row.aliases);
      const fatherName = normalizeText(row.father_name);
      const motherName = normalizeText(row.mother_name);
      const places = normalizeText([row.birth_place_desc, row.imported_from_desc].filter(Boolean).join(" "));
      const breed = normalizeText([row.breed_desc, row.main_strain_desc, row.sub_strain_desc].filter(Boolean).join(" "));
      const allText = j([row.id, nameLatin, nameNative, identifiers, owners, breeders, importers, prs, aliases, fatherName, motherName, places, breed, row.birth_year, row.sex_desc, row.color_desc]);
      await db.query(`
        INSERT INTO horse_search_source (horse_id, name_latin, name_native, identifiers, owners, breeders, father_name, mother_name, places, breed, all_text)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (horse_id) DO UPDATE SET
          name_latin = EXCLUDED.name_latin, name_native = EXCLUDED.name_native,
          identifiers = EXCLUDED.identifiers, owners = EXCLUDED.owners, breeders = EXCLUDED.breeders,
          father_name = EXCLUDED.father_name, mother_name = EXCLUDED.mother_name,
          places = EXCLUDED.places, breed = EXCLUDED.breed, all_text = EXCLUDED.all_text,
          updated_at = now()
      `, [row.id, nameLatin, nameNative, identifiers, owners, breeders, fatherName, motherName, places, breed, allText]);
      console.log('rebuilt search row:', row.id, '|', row.name_native);
    }

    const v = await db.query("SELECT horse_id, name_native FROM horse_search_source WHERE horse_id BETWEEN 10121582 AND 10121594");
    console.log('verify:', JSON.stringify(v.rows));
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
