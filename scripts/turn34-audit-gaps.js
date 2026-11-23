// Turn 34: name gap audit on horses table
const { withDb } = require('./db');

(async () => {
  await withDb(async (db) => {
    const q = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_active = 1) AS active,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
        COUNT(*) FILTER (WHERE name_latin IS NULL OR trim(name_latin) = '') AS missing_latin,
        COUNT(*) FILTER (WHERE name_native IS NULL OR trim(name_native) = '') AS missing_native,
        COUNT(*) FILTER (WHERE (name_latin IS NULL OR trim(name_latin)='') AND (name_native IS NULL OR trim(name_native)='')) AS missing_both
      FROM horses
    `);
    console.log('=== HORSES NAME GAPS ===');
    console.log(q.rows[0]);

    // Missing latin: by breed, sex, importance signals
    const breakdown = await db.query(`
      SELECT breed_desc, sex_desc,
             COUNT(*) AS n,
             COUNT(*) FILTER (WHERE birth_year IS NOT NULL) AS with_year,
             COUNT(*) FILTER (WHERE microchip_no IS NOT NULL) AS with_chip,
             COUNT(*) FILTER (WHERE father_id IS NOT NULL) AS with_sire
      FROM horses
      WHERE name_latin IS NULL OR trim(name_latin)=''
      GROUP BY breed_desc, sex_desc ORDER BY n DESC LIMIT 25
    `);
    console.log('\n=== MISSING LATIN by breed/sex ===');
    for (const r of breakdown.rows) console.log(JSON.stringify(r));

    const breakdown2 = await db.query(`
      SELECT breed_desc, sex_desc, COUNT(*) AS n
      FROM horses
      WHERE name_native IS NULL OR trim(name_native)=''
      GROUP BY breed_desc, sex_desc ORDER BY n DESC LIMIT 25
    `);
    console.log('\n=== MISSING NATIVE by breed/sex ===');
    for (const r of breakdown2.rows) console.log(JSON.stringify(r));

    // sample missing-latin rows that have native names (transliterable)
    const samp = await db.query(`
      SELECT id, name_native, breed_desc, sex_desc, birth_year, color_desc, data_origin
      FROM horses WHERE (name_latin IS NULL OR trim(name_latin)='') AND name_native IS NOT NULL AND trim(name_native)<>''
      LIMIT 12
    `);
    console.log('\n=== SAMPLE missing-latin but has native ===');
    for (const r of samp.rows) console.log(JSON.stringify(r));

    const samp2 = await db.query(`
      SELECT id, name_latin, breed_desc, sex_desc, birth_year, color_desc, data_origin
      FROM horses WHERE (name_native IS NULL OR trim(name_native)='') AND name_latin IS NOT NULL AND trim(name_latin)<>''
      LIMIT 12
    `);
    console.log('\n=== SAMPLE missing-native but has latin ===');
    for (const r of samp2.rows) console.log(JSON.stringify(r));
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
