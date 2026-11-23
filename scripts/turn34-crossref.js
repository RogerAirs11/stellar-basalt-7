// Check alias coverage for horses with missing names
const { withDb } = require('./db');

(async () => {
  await withDb(async (db) => {
    // aliases for missing-latin horses
    const a = await db.query(`
      SELECT COUNT(DISTINCT h.id) AS n
      FROM horses h JOIN horse_aliases ha ON ha.horse_id = h.id
      WHERE h.name_latin IS NULL OR trim(h.name_latin)=''
    `);
    console.log('missing-latin horses WITH aliases:', a.rows[0].n);

    const b = await db.query(`
      SELECT COUNT(DISTINCT h.id) AS n
      FROM horses h JOIN horse_aliases ha ON ha.horse_id = h.id
      WHERE h.name_native IS NULL OR trim(h.name_native)=''
    `);
    console.log('missing-native horses WITH aliases:', b.rows[0].n);

    // sample aliases on missing-native
    const c = await db.query(`
      SELECT h.id, h.name_latin, ha.alias, ha.language, ha.alias_type
      FROM horses h JOIN horse_aliases ha ON ha.horse_id = h.id
      WHERE (h.name_native IS NULL OR trim(h.name_native)='') AND ha.language IN ('fa','persian','native')
      LIMIT 10
    `);
    console.log('\nsample native aliases on missing-native:', c.rows.length);
    for (const r of c.rows) console.log(JSON.stringify(r));

    // racing stats join
    const d = await db.query(`
      SELECT COUNT(*) AS n FROM horses h
      JOIN horse_racing_stats rs ON rs.registry_horse_id::bigint = h.id
      WHERE h.name_latin IS NULL OR trim(h.name_latin)=''
    `);
    console.log('\nmissing-latin in racing stats:', d.rows[0].n);

    // how many horses have name_native set and latin set (training pairs)
    const e = await db.query(`SELECT COUNT(*) AS n FROM horses WHERE name_latin<>'' AND name_native<>'' AND name_latin IS NOT NULL AND name_native IS NOT NULL`);
    console.log('both-names pairs available:', e.rows[0].n);

    // distribution of data_origin among missing-native
    const f = await db.query(`
      SELECT data_origin, COUNT(*) AS n FROM horses
      WHERE name_native IS NULL OR trim(name_native)=''
      GROUP BY data_origin ORDER BY n DESC LIMIT 12
    `);
    console.log('\nmissing-native by origin:');
    for (const r of f.rows) console.log(JSON.stringify(r));
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
