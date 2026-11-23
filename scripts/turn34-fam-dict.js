// Turn 34: family-context token dictionary (sire/dam names) for fill tokens
const { withDb } = require('./db');
const { FA_RE } = require('./turn34-engine-lib.js');

(async () => {
  await withDb(async (db) => {
    // horses with missing names that have parents who have both names
    const r = await db.query(`
      SELECT h.id, h.name_native, h.name_latin,
             s.id AS sid, s.name_native AS s_fa, s.name_latin AS s_en,
             m.id AS mid, m.name_native AS m_fa, m.name_latin AS m_en
      FROM horses h
      LEFT JOIN horses s ON s.id = h.father_id
      LEFT JOIN horses m ON m.id = h.mother_id
      WHERE ((h.name_latin IS NULL OR trim(h.name_latin)='') AND h.name_native IS NOT NULL AND trim(h.name_native)<>'')
         OR ((h.name_native IS NULL OR trim(h.name_native)='') AND h.name_latin IS NOT NULL AND trim(h.name_latin)<>'' AND h.deleted_at IS NULL)
    `);
    console.log('missing-name horses with parents resolved:', r.rows.length);
    const famFa2En = {}, famEn2Fa = {};
    for (const row of r.rows) {
      for (const p of [ { fa: row.s_fa, en: row.s_en }, { fa: row.m_fa, en: row.m_en } ]) {
        if (!p.fa || !p.en) continue;
        const faT = p.fa.trim().split(/\s+/), enT = p.en.trim().toUpperCase().split(/\s+/);
        if (faT.length !== enT.length) continue;
        for (let i = 0; i < faT.length; i++) {
          if (FA_RE.test(faT[i]) && /^[A-Z][A-Z0-9'-]*$/.test(enT[i])) {
            (famFa2En[faT[i]] = famFa2En[faT[i]] || new Set()).add(enT[i]);
            (famEn2Fa[enT[i]] = famEn2Fa[enT[i]] || new Set()).add(faT[i]);
          }
        }
      }
    }
    const toObj = (o) => { const x = {}; for (const k of Object.keys(o)) x[k] = [...o[k]]; return x; };
    require('fs').writeFileSync('/home/z/my-project/scripts/turn34-fam-fa2en.json', JSON.stringify(toObj(famFa2En)));
    require('fs').writeFileSync('/home/z/my-project/scripts/turn34-fam-en2fa.json', JSON.stringify(toObj(famEn2Fa)));
    console.log('family fa2en tokens:', Object.keys(famFa2En).length, ' en2fa:', Object.keys(famEn2Fa).length);
    // coverage check: how many fill tokens hit family dict
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
