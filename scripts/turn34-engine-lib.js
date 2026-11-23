// Turn 34: shared transliteration engine (dictionary + fallback rules)
const fs = require('fs');
const FA_RE = /[\u0600-\u06FF]/;

// config flags (A/B testable)
const CFG = {
  dropMidEO: false,   // registry convention: drop short e/o mid-word
  romanToDigit: true, // II -> 2
};
const ROMAN = { I:'1', II:'2', III:'3', IV:'4', V:'5', VI:'6', VII:'7', VIII:'8', IX:'9', X:'10' };

// ---------- char-level Persian -> Latin (fallback) ----------
const FA2EN_CHARS = {
  'آ':'A','ا':'A','ب':'B','پ':'P','ت':'T','ث':'S','ج':'J','چ':'CH','ح':'H','خ':'KH',
  'د':'D','ذ':'Z','ر':'R','ز':'Z','ژ':'ZH','س':'S','ش':'SH','ص':'S','ض':'Z','ط':'T',
  'ظ':'Z','ع':'A','غ':'GH','ف':'F','ق':'GH','ک':'K','گ':'G','ل':'L','م':'M','ن':'N',
  'و':'V','ه':'H','ی':'I','ئ':'Y','ء':'','أ':'A','إ':'A','ة':'H'
};
function faCharLatin(w) {
  const s = w.replace(/\u200c/g, '').replace(/ك/g, 'ک').replace(/ي/g, 'ی');
  const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
  const isVowelCh = (ch) => 'اآئوینه'.includes(ch);
  // build phoneme units
  const units = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i], next = s[i + 1] || '';
    if (c === 'و') {
      const prevIsVowel = i === 0 ? false : isVowelCh(s[i - 1]);
      const nextIsVowel = next && isVowelCh(next);
      // و as consonant V when initial or between two vowel-ish letters (e.g. وریا, نوازنه)
      if (i === 0 || (nextIsVowel && !prevIsVowel && i > 0)) units.push('V');
      else units.push('OO'); // vowel: kabootar style
      continue;
    }
    if (c === 'ی') {
      if (i === 0) units.push('Y');
      else units.push('I');
      continue;
    }
    if (c === 'ه' && i === s.length - 1 && s.length > 1) { units.push('EH'); continue; }
    if (c === 'ه' && next === 'ا') { units.push('HA'); i++; continue; }
    if (c === 'ا' && i === 0) { units.push('A'); continue; }
    units.push(FA2EN_CHARS[c] !== undefined ? FA2EN_CHARS[c] : '');
  }
  let out = units.join('');
  // insert 'A' after the first consonant of each consonant run (vowelize clusters)
  let res = '';
  let inCluster = false;
  for (let i = 0; i < out.length; i++) {
    const two = out.slice(i, i + 2);
    const isDigraph = ['CH', 'KH', 'SH', 'GH', 'ZH'].includes(two);
    const cur = isDigraph ? (res += two, i += 1, two) : out[i];
    if (isDigraph) { inCluster = !inCluster ? true : inCluster; continue; }
    res += cur;
    const isCons = !VOWELS.has(cur);
    const nxt = out[i + 1] || '';
    const nxtIsCons = nxt && !VOWELS.has(nxt) && !['CH', 'KH', 'SH', 'GH', 'ZH'].includes(out.slice(i + 1, i + 3));
    if (isCons && nxtIsCons && !inCluster) {
      res += 'A'; inCluster = true; // one insertion per run
    } else if (!isCons) {
      inCluster = false;
    }
  }
  res = res.replace(/(.)\1{2,}/g, '$1$1');
  return res || w;
}

// ---------- char-level Latin -> Persian (phonetic fallback) ----------
function latinFa(word) {
  let s = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return word;
  const digraphs = [
    [/^tsch/, 'چ'], [/^sch/, 'ش'], [/^ch/, 'چ'], [/^sh/, 'ش'], [/^kh/, 'خ'],
    [/^gh/, 'غ'], [/^ph/, 'ف'], [/^th/, 'ت'], [/^ck/, 'ک'], [/^qu/, 'کو'],
    [/^kn/, 'ن'], [/^ee/, 'ی'], [/^ea/, 'ی'], [/^oo/, 'و'], [/^ou/, 'او'],
    [/^ei/, 'یی'], [/^au/, 'او'],
    [/^oa/, 'او'], [/^oe/, 'و'], [/^ue/, 'و'], [/^ui/, 'وی'],
    [/^eu/, 'یو'], [/^tz/, 'تس'], [/^ss/, 'س'], [/^ae/, 'ا']
  ];
  const singles = {
    a:'ا', b:'ب', c:'ک', d:'د', e:'ی', f:'ف', g:'گ', h:'ه', i:'ی', j:'ج',
    k:'ک', l:'ل', m:'م', n:'ن', o:'و', p:'پ', q:'ک', r:'ر', s:'س', t:'ت',
    u:'و', v:'و', w:'و', x:'کس', y:'ی', z:'ز'
  };
  let out = '';
  while (s.length) {
    // word-final 'eh' -> ه  (TESHNEH -> تشنه)
    if (/^eh$/.test(s) && out.length > 1) { out += 'ه'; s = ''; continue; }
    let matched = false;
    for (const [re, rep] of digraphs) {
      const m = s.match(re);
      if (m) { out += rep; s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;
    const c = s[0];
    if (c === 'a' && s === 'a' && out.length && /[هو]$/.test(out)) { s = ''; continue; } // trailing schwa
    if (c === 'c' && /^[eiy]/.test(s.slice(1))) { out += 'س'; s = s.slice(1); continue; }
    // mid-word short vowel drop (registry convention): BEHBOD->بهبد, TARLAN->ترلان
    if (CFG.dropMidEO && (c === 'e' || c === 'o') && out.length > 0 && s.length > 1
        && /[بپتثجچحخدذرزژسصضطظعغفقکگلمن]/.test(s[1])) { s = s.slice(1); continue; }
    if (c === 'e' && s.length === 1 && out.length > 1 && /[بپتثجچحخدذرزژسصضطظعغفقکگلمنو]$/.test(out)) {
      out += 'ه'; s = ''; continue; // final e -> ه (JELVE -> جلوه)
    }
    if (c === 'e' && s.length === 1) { s = ''; continue; }
    if (c === 'a' && out.length === 0) { out += 'آ'; s = s.slice(1); continue; } // initial A -> آ
    out += singles[c] !== undefined ? singles[c] : '';
    s = s.slice(1);
  }
  out = out.replace(/([ابپتثجچحخدذرزژسصضطظعغفقکگلمنوهی])\1+/g, '$1');
  return out || word;
}

// ---------- dictionaries ----------
const fa2en = new Map(Object.entries(JSON.parse(fs.readFileSync(__dirname + '/turn34-dict-fa2en.json', 'utf8'))));
const en2fa = new Map(Object.entries(JSON.parse(fs.readFileSync(__dirname + '/turn34-dict-en2fa.json', 'utf8'))));
// family-context dicts (sire/dam names) — tier 2
const famFa2En = JSON.parse(fs.readFileSync(__dirname + '/turn34-fam-fa2en.json', 'utf8'));
const famEn2Fa = JSON.parse(fs.readFileSync(__dirname + '/turn34-fam-en2fa.json', 'utf8'));

let LAST_SOURCE = null; // 'dict' | 'family' | 'fallback' | 'asis'

function best(ranked, minVotes, minDominance) {
  if (!ranked || !ranked.length) return null;
  const top = ranked[0][0], topN = ranked[0][1];
  const c2 = ranked[1] ? ranked[1][1] : 0;
  const dom = c2 ? topN / (topN + c2) : 1;
  if (topN < minVotes) return null;
  if (ranked.length > 1 && dom < minDominance) return null;
  return top;
}

function faTokenToLatin(tok) {
  const clean = tok.replace(/\u200c/g, ' ').trim();
  if (!FA_RE.test(clean)) { LAST_SOURCE = 'asis'; return clean.toUpperCase(); }
  const hit = best(fa2en.get(clean), 2, 0.7);
  if (hit) { LAST_SOURCE = 'dict'; return hit; }
  const fam = famFa2En[clean];
  if (fam && fam.length === 1) { LAST_SOURCE = 'family'; return fam[0]; }
  LAST_SOURCE = 'fallback';
  return clean.split(/\s+/).map(faCharLatin).join(' ');
}
function latinTokenToFa(tok) {
  if (!/^[A-Z][A-Z0-9.'-]*$/i.test(tok)) { LAST_SOURCE = 'asis'; return tok; } // digits, (IT) etc
  if (/^[A-Z]$/i.test(tok)) { LAST_SOURCE = 'asis'; return tok; } // single-letter suffix
  if (/^[A-Z]\.$/i.test(tok) || /^[A-Z]\.[A-Z]\.$/i.test(tok)) { LAST_SOURCE = 'asis'; return tok; } // E.T / initials
  if (CFG.romanToDigit && ROMAN[tok.toUpperCase()]) { LAST_SOURCE = 'roman'; return ROMAN[tok.toUpperCase()]; }
  const up = tok.toUpperCase();
  const hit = best(en2fa.get(up), 2, 0.7);
  if (hit) { LAST_SOURCE = 'dict'; return hit; }
  const fam = famEn2Fa[up];
  if (fam && fam.length === 1) { LAST_SOURCE = 'family'; return fam[0]; }
  LAST_SOURCE = 'fallback';
  return latinFa(tok);
}

function setCfg(o) { Object.assign(CFG, o); }
function getCfg() { return CFG; }
function lastSource() { return LAST_SOURCE; }
function faNameToLatin(name) {
  return name.trim().split(/\s+/).filter(Boolean).map(faTokenToLatin).join(' ').toUpperCase();
}
function latinNameToFa(name) {
  const toks = name.trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^NO$/i.test(t) && /^NAME$/i.test(toks[i + 1] || '')) { out.push('بی', 'نام'); i++; continue; }
    out.push(latinTokenToFa(t));
  }
  return out.join(' ').trim();
}

module.exports = { FA_RE, faCharLatin, latinFa, faTokenToLatin, latinTokenToFa, faNameToLatin, latinNameToFa, setCfg, getCfg, lastSource };
