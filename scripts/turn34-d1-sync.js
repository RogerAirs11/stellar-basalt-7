// Turn 34: mirror name fills to Cloudflare D1 (12-concurrency batched)
// Token source: CLOUDFLARE_API_TOKEN env var (never hardcode credentials —
// the R141 source-export credential guard rejects hardcoded tokens).
const fs = require('fs');
const { withDb } = require('./db');

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd75bc9215eaa1c0fc53b7f716195fdfc';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!CF_TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN env var is required (see PROJECT-MEMORY.md).');
  process.exit(1);
}
const D1_ID = 'f527d88f-c274-4a11-8d17-37dc43ba9027';

async function d1Run(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('D1 error: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.result;
}
const esc = (s) => String(s).replace(/'/g, "''");

(async () => {
  // collect affected ids from all fill sources
  const fills = JSON.parse(fs.readFileSync(__dirname + '/turn34-fills-final.json', 'utf8'));
  const ids = [...new Set(fills.map(f => f.id))];
  console.log('affected ids:', ids.length);

  // pull authoritative values from Supabase
  await withDb(async (db) => {
    const BATCH = 2000;
    const rows = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH).map(Number);
      const r = await db.query('SELECT id, name_latin, name_native FROM horses WHERE id = ANY($1::bigint[])', [chunk]);
      rows.push(...r.rows);
    }
    console.log('rows fetched:', rows.length);

    // build multi-statement SQL chunks (literal SQL, escaped)
    const PER = 100;
    const chunks = [];
    for (let i = 0; i < rows.length; i += PER) {
      const segs = rows.slice(i, i + PER).map(r =>
        `UPDATE horses SET name_latin='${esc(r.name_latin || '')}', name_native='${esc(r.name_native || '')}', updated_at=datetime('now'), row_version=row_version+1 WHERE id=${Number(r.id)};`
      );
      chunks.push(segs.join('\n'));
    }
    console.log('chunks:', chunks.length);

    // 12 workers
    const CONC = 12;
    let idx = 0, done = 0;
    const errors = [];
    async function worker(w) {
      while (idx < chunks.length) {
        const my = chunks[idx++];
        try {
          await d1Run(my);
          done += PER;
          if (done % 4000 < PER) console.log(`worker ${w}: ~${Math.min(done, rows.length)}/${rows.length}`);
        } catch (e) {
          errors.push(e.message);
          if (errors.length > 5) throw e;
        }
      }
    }
    await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
    console.log('D1 chunk-updates sent:', done / PER * PER, ' errors:', errors.length);

    // verify
    const v = await d1Run("SELECT COUNT(*) AS n FROM horses WHERE name_latin IS NULL OR name_latin='' OR name_native IS NULL OR name_native=''");
    console.log('D1 remaining gaps:', v[0].results[0].n);
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
