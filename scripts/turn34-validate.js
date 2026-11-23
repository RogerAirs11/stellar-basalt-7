// Turn 34: holdout validation — re-derive one side from the other on known pairs
const fs = require('fs');
const { withDb } = require('./db');

const FA_RE = /[\u0600-\u06FF]/;
const engine = require('./turn34-engine-lib.js');

(async () => {
  await withDb(async (db) => {
    const r = await db.query(`
      SELECT id, name_latin, name_native FROM horses
      WHERE name_latin IS NOT NULL AND name_native IS NOT NULL
        AND trim(name_latin)<>'' AND trim(name_native)<>'' AND is_active=1
      ORDER BY random() LIMIT 2000
    `);
    let nTok = 0, tokOk = 0, nFull = 0, fullOk = 0;
    const bad = [];
    for (const row of r.rows) {
      const enT = row.name_latin.trim().split(/\s+/);
      const faT = row.name_native.trim().split(/\s+/);
      if (enT.length !== faT.length) continue;
      nFull++;
      let allOk = true;
      for (let i = 0; i < enT.length; i++) {
        nTok++;
        const guess = engine.latinTokenToFa(enT[i]);
        const truth = faT[i];
        if (guess === truth || guess.replace(/[يك]/g,c=>c==='ك'?'ک':'ی') === truth.replace(/[يك]/g,c=>c==='ك'?'ک':'ی')) tokOk++;
        else { allOk = false; if (bad.length < 40) bad.push({ id: row.id, en: enT[i], got: guess, want: truth }); }
      }
      if (allOk) fullOk++;
    }
    console.log(`pairs tested: ${nFull}  tokens: ${nTok}`);
    console.log(`token accuracy: ${(100*tokOk/nTok).toFixed(1)}%`);
    console.log(`full-name accuracy: ${(100*fullOk/nFull).toFixed(1)}%`);
    console.log('\nmismatches:');
    for (const b of bad) console.log(JSON.stringify(b));
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
