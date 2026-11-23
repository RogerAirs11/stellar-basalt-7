// Turn 34: build fa<->en name dictionaries from verified registry pairs
const fs = require('fs');
const { withDb } = require('./db');

const FA_RE = /[\u0600-\u06FF]/;

(async () => {
  await withDb(async (db) => {
    const r = await db.query(`
      SELECT name_latin, name_native FROM horses
      WHERE name_latin IS NOT NULL AND name_native IS NOT NULL
        AND trim(name_latin)<>'' AND trim(name_native)<>'' AND is_active=1
    `);
    console.log('pairs:', r.rows.length);

    const fa2en = new Map(); // fa word -> Map(latin word -> count)
    const en2fa = new Map(); // latin word -> Map(fa word -> count)

    for (const { name_latin, name_native } of r.rows) {
      const en = name_latin.trim().toUpperCase();
      const fa = name_native.trim();
      const enT = en.split(/\s+/).filter(Boolean);
      const faT = fa.split(/\s+/).filter(Boolean);
      if (enT.length !== faT.length) continue;
      let ok = true;
      for (let i = 0; i < enT.length; i++) {
        const e = enT[i], f = faT[i];
        const eIsLatin = /^[A-Z][A-Z0-9.'-]*$/.test(e);
        const fIsFa = FA_RE.test(f);
        if (eIsLatin && fIsFa) {
          if (!en2fa.has(e)) en2fa.set(e, new Map());
          const m = en2fa.get(e);
          m.set(f, (m.get(f) || 0) + 1);
          if (!fa2en.has(f)) fa2en.set(f, new Map());
          const m2 = fa2en.get(f);
          m2.set(e, (m2.get(e) || 0) + 1);
        } else if (!eIsLatin && !fIsFa) {
          // both non-persian/non-latin (digits etc) - skip
        } else {
          ok = false;
        }
      }
    }

    const dump = (map) => {
      const out = {};
      for (const [k, m] of map) {
        const best = [...m.entries()].sort((a, b) => b[1] - a[1]);
        out[k] = best; // keep ranked list
      }
      return out;
    };
    fs.writeFileSync('/home/z/my-project/scripts/turn34-dict-fa2en.json', JSON.stringify(dump(fa2en)));
    fs.writeFileSync('/home/z/my-project/scripts/turn34-dict-en2fa.json', JSON.stringify(dump(en2fa)));

    console.log('fa2en words:', fa2en.size, ' en2fa words:', en2fa.size);
    // sanity samples
    for (const w of ['شاداب', 'آرامهر', 'چاوش', 'هایلند', 'پرستو']) {
      const m = fa2en.get(w);
      console.log('fa2en', w, '=>', m ? [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3) : 'NONE');
    }
    for (const w of ['HEIDAR', 'HEYDAR', 'PARASTOO', 'SHADAB', 'KONTI']) {
      const m = en2fa.get(w);
      console.log('en2fa', w, '=>', m ? [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3) : 'NONE');
    }
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
