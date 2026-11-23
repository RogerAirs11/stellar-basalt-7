// Turn 34: transliteration engine + preview for missing names
const fs = require('fs');
const { withDb } = require('./db');

const FA_RE = /[\u0600-\u06FF]/;

// ---------- char-level Persian -> Latin (fallback) ----------
const FA2EN_CHARS = {
  'آ':'AA','ا':'A','ب':'B','پ':'P','ت':'T','ث':'S','ج':'J','چ':'CH','ح':'H','خ':'KH',
  'د':'D','ذ':'Z','ر':'R','ز':'Z','ژ':'ZH','س':'S','ش':'SH','ص':'S','ض':'Z','ط':'T',
  'ظ':'Z','ع':'A','غ':'GH','ف':'F','ق':'GH','ک':'K','گ':'G','ل':'L','م':'M','ن':'N',
  'و':'V','ه':'H','ی':'I','ي':'I','ئ':'Y','ك':'K','ء':'','أ':'A','إ':'A','ة':'H'
};
function faCharLatin(w) {
  let out = '';
  const s = w.replace(/\u200c/g, '').replace(/[يك]/g, c => (c === 'ك' ? 'ک' : 'ی'));
  for (let i = 0; i < s.length; i++) {
    const c = s[i], next = s[i + 1] || '', prev = s[i - 1] || '';
    if (c === 'و') {
      if (i === 0) out += 'O';
      else if ('AAEIOU'.includes(out.slice(-1))) { /* vowel-ish context */ out += 'V'; }
      else out += 'V';
      continue;
    }
    if (c === 'ی') {
      if (i === 0) { out += 'Y'; continue; }
      if (i === s.length - 1) { out += 'I'; continue; }
      out += 'A';
      continue;
    }
    if (c === 'ه' && i === s.length - 1 && s.length > 1) { out += 'EH'; continue; }
    if (c === 'ا' && i === s.length - 1) { out += 'A'; continue; }
    if (c === 'ن' && next === 'ه' && i === s.length - 2) { out += 'N'; continue; } // -انه
    out += FA2EN_CHARS[c] !== undefined ? FA2EN_CHARS[c] : '';
  }
  return out.replace(/(.)\1{2,}/g, '$1$1') || w;
}

// ---------- char-level Latin -> Persian (phonetic fallback) ----------
function latinFa(w) {
  let s = w.toLowerCase();
  const digraphs = [
    [/^ch/, 'چ'], [/^sh/, 'ش'], [/^kh/, 'خ'], [/^gh/, 'غ'], [/^ph/, 'ف'],
    [/^th/, 'ت'], [/^ck/, 'ک'], [/^qu/, 'کو'], [/^kn/, 'ن'], [/^wr/, 'ر'],
    [/^ee/, 'ی'], [/^ea/, 'ی'], [/^oo/, 'و'], [/^ou/, 'او'], [/^ai/, 'ای'],
    [/^ay/, 'ای'], [/^ei/, 'ای'], [/^ey/, 'ای'], [/^au/, 'او'], [/^oa/, 'او'],
    [/^ie/, 'ی'], [/^oe/, 'و'], [/^ue/, 'و'], [/^ui/, 'وی'], [/^eu/, 'یو'],
    [/^sch/, 'ش'], [/^tsch/, 'چ'], [/^tz/, 'تس'], [/^ss/, 'س'], [/^ae/, 'ه'], [/^oe2/, 'و'],
  ];
  const singles = {
    a:'ا', b:'ب', c:'ک', d:'د', e:'ی', f:'ف', g:'گ', h:'ه', i:'ای', j:'ج',
    k:'ک', l:'ل', m:'م', n:'ن', o:'و', p:'پ', q:'ک', r:'ر', s:'س', t:'ت',
    u:'و', v:'و', w:'و', x:'کس', y:'ای', z:'ز'
  };
  // soft c -> س before e/i/y
  let out = '';
  while (s.length) {
    let matched = false;
    for (const [re, rep] of digraphs) {
      const m = s.match(re);
      if (m) { out += rep; s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;
    const c = s[0];
    if (c === 'c' && /^[ei y]/.test(s.slice(1))) { out += 'س'; s = s.slice(1); continue; }
    if (c === 'g' && /^[ei y]/.test(s.slice(1))) { out += 'ج'; s = s.slice(1); continue; }
    if (s.length === 1 && c === 'e') { /* silent final e */ s = ''; continue; }
    if (c === 'e' && s.length === 2 && !/[aeiou]/.test(s[1])) { out += ''; s = s.slice(1); continue; }
    out += singles[c] !== undefined ? singles[c] : c;
    s = s.slice(1);
  }
  // collapse doubled persian letters (not digraphs)
  out = out.replace(/([بپتثجچحخدذرزژسصضطظعغفقکگلمنوه])\1+/g, '$1');
  return out;
}

// ---------- load dictionaries ----------
const fa2enRaw = JSON.parse(fs.readFileSync('/home/z/my-project/scripts/turn34-dict-fa2en.json', 'utf8'));
const en2faRaw = JSON.parse(fs.readFileSync('/home/z/my-project/scripts/turn34-dict-en2fa.json', 'utf8'));

function best(mapKey, ranked, minVotes, minDominance) {
  if (!ranked || !ranked.length) return null;
  const top = ranked[0][0], topN = ranked[0][1];
  const c2 = ranked[1] ? ranked[1][1] : 0;
  const dom = c2 ? topN / (topN + c2) : 1;
  if (topN < minVotes) return null;
  if (ranked.length > 1 && dom < minDominance) return null;
  return top;
}
// fa2en/en2fa json saved as [k, [ [word, n], ... ] ] arrays -> convert
const fa2en = new Map(Object.entries(fa2enRaw).map(([k, v]) => [k, v]));
const en2fa = new Map(Object.entries(en2faRaw).map(([k, v]) => [k, v]));

function faTokenToLatin(tok) {
  const clean = tok.replace(/\u200c/g, ' ').trim();
  if (!FA_RE.test(clean)) return clean.toUpperCase(); // already latin/digit
  const hit = best('fa', fa2en.get(clean), 2, 0.7);
  if (hit) return hit;
  return clean.split(/\s+/).map(faCharLatin).join(' ');
}
function latinTokenToFa(tok) {
  if (!/^[A-Z][A-Z0-9.'-]*$/i.test(tok)) return tok; // digits etc
  if (/^[A-Z]$/i.test(tok)) return tok; // single-letter suffix kept
  const up = tok.toUpperCase();
  const hit = best('en', en2fa.get(up), 2, 0.7);
  if (hit) return hit;
  return latinFa(tok);
}

(async () => {
  await withDb(async (db) => {
    // A) missing latin, has native
    const a = await db.query(`
      SELECT id, name_native FROM horses
      WHERE (name_latin IS NULL OR trim(name_latin)='') AND name_native IS NOT NULL AND trim(name_native)<>''
      ORDER BY id
    `);
    // B) missing native, has latin
    const b = await db.query(`
      SELECT id, name_latin FROM horses
      WHERE (name_native IS NULL OR trim(name_native)='') AND name_latin IS NOT NULL AND trim(name_latin)<>''
        AND (deleted_at IS NULL)
      ORDER BY id
    `);
    console.log('A rows:', a.rows.length, ' B rows:', b.rows.length);

    const fills = [];
    for (const r of a.rows) {
      const toks = r.name_native.trim().split(/\s+/).filter(Boolean);
      const latin = toks.map(faTokenToLatin).join(' ').trim().toUpperCase();
      if (latin && FA_RE.test(latin) === false) fills.push({ id: r.id, col: 'name_latin', val: latin });
    }
    for (const r of b.rows) {
      const toks = r.name_latin.trim().split(/\s+/).filter(Boolean);
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        let t = toks[i];
        if (/^NO$/i.test(t) && /^NAME$/i.test(toks[i+1] || '')) { out.push('بی'); out.push('نام'); i++; continue; }
        out.push(latinTokenToFa(t));
      }
      const native = out.join(' ').trim();
      if (native && FA_RE.test(native)) fills.push({ id: r.id, col: 'name_native', val: native });
    }
    console.log('total fills computed:', fills.length);

    // stats: how many via dictionary vs phonetic fallback
    const sample = (n) => fills.filter(f => f.col === n);
    const la = sample('name_latin'), na = sample('name_native');
    console.log('latin fills:', la.length, ' native fills:', na.length);
    console.log('\n--- LATIN FILL SAMPLES ---');
    for (const f of la.slice(0, 15)) console.log(f.id, '=>', f.val);
    console.log('\n--- NATIVE FILL SAMPLES ---');
    for (const f of na.slice(0, 20)) console.log(f.id, '=>', f.val);

    fs.writeFileSync('/home/z/my-project/scripts/turn34-fills-preview.json', JSON.stringify(fills));
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
