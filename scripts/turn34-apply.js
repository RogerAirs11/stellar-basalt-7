// Turn 34: apply name fills to Supabase horses + horse_search_source
const fs = require('fs');
const { withDb } = require('./db');

(async () => {
  const fills = JSON.parse(fs.readFileSync(__dirname + '/turn34-fills-final.json', 'utf8'));
  const latin = fills.filter(f => f.col === 'name_latin');
  const native = fills.filter(f => f.col === 'name_native');
  console.log('applying latin:', latin.length, ' native:', native.length);

  await withDb(async (db) => {
    const applyBatch = async (rows, col) => {
      const BATCH = 300;
      let done = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = [];
        const params = [];
        let p = 1;
        for (const r of chunk) {
          values.push(`($${p++}::bigint, $${p++}::text)`);
          params.push(r.id, r.val);
        }
        const q = `
          UPDATE horses h SET ${col} = v.val, updated_at = now(), row_version = h.row_version + 1
          FROM (VALUES ${values.join(',')}) AS v(id, val)
          WHERE h.id = v.id::bigint
            AND ((${col} IS NULL OR trim(${col}) = ''))
        `;
        const r = await db.query(q, params);
        done += r.rowCount;
      }
      return done;
    };

    const n1 = await applyBatch(latin, 'name_latin');
    console.log('latin rows updated:', n1);
    const n2 = await applyBatch(native, 'name_native');
    console.log('native rows updated:', n2);

    // sync search index
    const allIds = fills.map(f => f.id);
    const syncBatch = 300;
    let sdone = 0;
    for (let i = 0; i < allIds.length; i += syncBatch) {
      const chunk = allIds.slice(i, i + syncBatch);
      const r = await db.query(`
        UPDATE horse_search_source s
        SET name_latin = h.name_latin, name_native = h.name_native,
            all_text = concat_ws(' ', h.name_latin, h.name_native, s.identifiers, s.owners, s.breeders, s.father_name, s.mother_name, s.places, s.breed),
            updated_at = now()
        FROM horses h
        WHERE s.horse_id = h.id AND s.horse_id = ANY($1::bigint[])
      `, [chunk]);
      sdone += r.rowCount;
    }
    console.log('search_source synced:', sdone);

    // reindex queue
    const rq = await db.query(`
      INSERT INTO horse_search_reindex_queue (horse_id, reason, queued_at, attempts)
      SELECT id, 'name_fill_turn34', now(), 0
      FROM horses WHERE id = ANY($1::bigint[])
      ON CONFLICT DO NOTHING
    `, [allIds]);
    console.log('reindex queued:', rq.rowCount);

    // verification
    const v = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE name_latin IS NULL OR trim(name_latin)='') AS missing_latin,
        COUNT(*) FILTER (WHERE name_native IS NULL OR trim(name_native)='') AS missing_native,
        COUNT(*) AS total
      FROM horses
    `);
    console.log('post-apply gaps:', v.rows[0]);
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
