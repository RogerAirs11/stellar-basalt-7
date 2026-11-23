// Turn 34: generate final name fills with token-source audit
const fs = require('fs');
const { withDb } = require('./db');
const eng = require('./turn34-engine-lib.js');

(async () => {
  await withDb(async (db) => {
    const a = await db.query(`
      SELECT id, name_native FROM horses
      WHERE (name_latin IS NULL OR trim(name_latin)='') AND name_native IS NOT NULL AND trim(name_native)<>''
      ORDER BY id
    `);
    const b = await db.query(`
      SELECT id, name_latin FROM horses
      WHERE (name_native IS NULL OR trim(name_native)='') AND name_latin IS NOT NULL AND trim(name_latin)<>''
        AND deleted_at IS NULL
      ORDER BY id
    `);
    const stats = { dict: 0, family: 0, fallback: 0, asis: 0, roman: 0 };
    const fills = [];

    for (const r of a.rows) {
      const toks = r.name_native.trim().split(/\s+/).filter(Boolean);
      const out = toks.map(t => { const v = eng.faTokenToLatin(t); stats[eng.lastSource()]++; return v; });
      const latin = out.join(' ').replace(/\u060C/g, ',').trim().toUpperCase();
      // must be pure latin/digit/punct, and not garbage (long same-letter repeats)
      if (latin && !eng.FA_RE.test(latin) && /[A-Z0-9]/.test(latin) && !/(.)\1{5,}/.test(latin.replace(/\s/g, ''))) {
        fills.push({ id: r.id, col: 'name_latin', val: latin });
      }
    }
    for (const r of b.rows) {
      const toks = r.name_latin.trim().split(/\s+/).filter(Boolean);
      const out = toks.map(t => { const v = eng.latinTokenToFa(t); stats[eng.lastSource()]++; return v; });
      const native = out.join(' ').trim();
      if (native && eng.FA_RE.test(native)) {
        fills.push({ id: r.id, col: 'name_native', val: native });
      }
    }
    console.log('token sources:', stats);
    console.log('latin fills:', fills.filter(f => f.col === 'name_latin').length, '/', a.rows.length);
    console.log('native fills:', fills.filter(f => f.col === 'name_native').length, '/', b.rows.length);

    fs.writeFileSync('/home/z/my-project/scripts/turn34-fills-final.json', JSON.stringify(fills));
    // samples for manual review
    const la = fills.filter(f => f.col === 'name_latin');
    console.log('\n--- LATIN SAMPLES ---');
    for (const f of la.slice(0, 25)) console.log(f.id, '=>', f.val);
    const na = fills.filter(f => f.col === 'name_native');
    console.log('\n--- NATIVE SAMPLES (random) ---');
    for (const f of na.filter((_, i) => i % 800 === 0).slice(0, 20)) console.log(f.id, '=>', f.val);
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
