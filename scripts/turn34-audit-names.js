// Turn 34: audit missing Farsi / English names in the horses database
const { withDb } = require('./db');

(async () => {
  await withDb(async (db) => {
    // 1. Table + columns
    const cols = await db.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name LIKE '%horse%'
      ORDER BY table_name, ordinal_position
    `);
    const tables = {};
    for (const r of cols.rows) {
      (tables[r.table_name] = tables[r.table_name] || []).push(`${r.column_name}:${r.data_type}`);
    }
    for (const [t, cs] of Object.entries(tables)) {
      console.log(`TABLE ${t}\n  ${cs.join(', ')}\n`);
    }
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
