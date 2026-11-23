// Turn 34: second pass for remaining active gaps (edge cases)
const { withDb } = require('./db');
const eng = require('./turn34-engine-lib.js');

const PERSIAN_DIGITS = { '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
const LETTER_FA = { A:'آ', B:'بی', C:'سی', D:'دی', E:'ای', F:'اف', G:'جی', H:'اچ', I:'آی', J:'جی', K:'کی', L:'ال', M:'ام', N:'ان', O:'او', P:'پی', Q:'کیو', R:'آر', S:'اس', T:'تی', U:'یو', V:'وی', W:'دبلیو', X:'اکس', Y:'وای', Z:'زد' };
const stripDiacritics = (s) => s.replace(/[\u064B-\u0652\u0670]/g, '').replace(/[۰-۹]/g, d => PERSIAN_DIGITS[d]);

(async () => {
  await withDb(async (db) => {
    // missing latin active
    const a = await db.query(`SELECT id, name_native FROM horses WHERE (name_latin IS NULL OR trim(name_latin)='') AND deleted_at IS NULL`);
    let n1 = 0;
    for (const r of a.rows) {
      const cleaned = stripDiacritics(r.name_native || '').trim();
      if (!cleaned || !/[A-Z0-9a-z\u0600-\u06FF]/.test(cleaned)) continue;
      if (/^[A-Z]{5,}$/.test(cleaned.replace(/\s/g, ''))) continue; // garbage like CCCCCC
      if (!eng.FA_RE.test(cleaned)) { // pure latin already
        const u = cleaned.toUpperCase();
        if (/[A-Z0-9]/.test(u) && !/(.)\1{5,}/.test(u)) {
          await db.query(`UPDATE horses SET name_latin=$2, updated_at=now(), row_version=row_version+1 WHERE id=$1::bigint AND (name_latin IS NULL OR trim(name_latin)='')`, [r.id, u]);
          n1++;
        }
        continue;
      }
      const toks = cleaned.split(/\s+/).filter(Boolean).map(t => eng.faTokenToLatin(t));
      const out = toks.join(' ').replace(/\u060C/g, ',').toUpperCase();
      if (out && !eng.FA_RE.test(out) && /[A-Z0-9]/.test(out) && !/(.)\1{5,}/.test(out.replace(/\s/g, ''))) {
        await db.query(`UPDATE horses SET name_latin=$2, updated_at=now(), row_version=row_version+1 WHERE id=$1::bigint AND (name_latin IS NULL OR trim(name_latin)='')`, [r.id, out]);
        n1++;
      }
    }
    console.log('second-pass latin filled:', n1);

    // missing native active
    const b = await db.query(`SELECT id, name_latin FROM horses WHERE (name_native IS NULL OR trim(name_native)='') AND deleted_at IS NULL`);
    let n2 = 0;
    for (const r of b.rows) {
      const toks = (r.name_latin || '').trim().split(/\s+/).filter(Boolean);
      const outToks = toks.map(t => {
        // split on separators, keep separators
        const parts = t.split(/([*+_()".-])/).filter(Boolean);
        return parts.map(p => {
          if (/^[A-Z]$/.test(p)) return LETTER_FA[p] || p;
          if (/[*+_()".-]/.test(p)) return p === '.' || p === '"' ? '' : p;
          return eng.latinTokenToFa(p);
        }).join('');
      });
      const out = outToks.join(' ').trim().replace(/\s+/g, ' ');
      if (out && eng.FA_RE.test(out)) {
        await db.query(`UPDATE horses SET name_native=$2, updated_at=now(), row_version=row_version+1 WHERE id=$1::bigint AND (name_native IS NULL OR trim(name_native)='')`, [r.id, out]);
        n2++;
      }
    }
    console.log('second-pass native filled:', n2);

    // resync search index for all touched
    const s = await db.query(`
      UPDATE horse_search_source s
      SET name_latin = h.name_latin, name_native = h.name_native, updated_at = now()
      FROM horses h
      WHERE s.horse_id = h.id AND h.updated_at::timestamptz > now() - interval '30 minutes'
    `);
    console.log('search resynced:', s.rowCount);

    const v = await db.query(`
      SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL AND (name_latin IS NULL OR trim(name_latin)='')) AS act_missing_latin,
             COUNT(*) FILTER (WHERE deleted_at IS NULL AND (name_native IS NULL OR trim(name_native)='')) AS act_missing_native
      FROM horses`);
    console.log('active gaps now:', v.rows[0]);
  });
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
