import { BREEDS, HORSES, RESULTS, RIDERS, ancestor, hash, horseById, type Discipline, type Horse, type Result } from './data';
import { L } from './i18n';
import { DISEASES, diseaseStatus, genotypeOf } from './genetics';

const pad = (n: number) => String(n).padStart(2, '0');
const isGen = (h: Horse) => /^h\d+$/.test(h.id);
export const TODAY = '2025-04-15';
/* LIVE WIRING: date helpers are null-safe — real registry records carry no
 * veterinary dates, and an invalid date must never throw mid-render. */
export const dateAt = (iso: string) => { const d = new Date((iso || TODAY) + 'T12:00:00'); return isNaN(d.getTime()) ? new Date(TODAY + 'T12:00:00') : d; };
export const addDays = (iso: string, d: number): string => { const t = new Date((iso || TODAY) + 'T12:00:00Z'); if (isNaN(t.getTime())) return addDays(TODAY, d); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

/* ======================= search helpers ======================= */
export const norm = (s: string) => s.toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا').replace(/[\u064B-\u065F\u200c\s]/g, '').replace(/[^a-z0-9\u0600-\u06ff]/g, '');
export function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/* ======================= trust model ======================= */
export type TrustLevel = 'self' | 'uploaded' | 'reviewed' | 'official' | 'dna' | 'conflict';
export const TRUST_ORDER: TrustLevel[] = ['self', 'uploaded', 'reviewed', 'official', 'dna', 'conflict'];
export const TRUST_L: Record<TrustLevel, { l: L; short: L; hint: L }> = {
  self: { l: L('Self-declared', 'خوداظهاری مالک'), short: L('Self-declared', 'خوداظهاری'), hint: L('Entered by the user; not independently verified yet', 'توسط کاربر وارد شده و هنوز مستقلاً تأیید نشده است') },
  uploaded: { l: L('Document uploaded · not reviewed', 'مدرک ارائه شده؛ بررسی نشده'), short: L('Uploaded', 'ارائه‌شده'), hint: L('File uploaded but issuer / content not yet checked', 'فایل بارگذاری شده اما اعتبار صادرکننده/محتوا هنوز بررسی نشده') },
  reviewed: { l: L('Document reviewed', 'مدرک بررسی‌شده'), short: L('Reviewed', 'بررسی‌شده'), hint: L('An authorised expert reviewed the document and recorded the result', 'کارشناس مجاز سند را بررسی و نتیجه را ثبت کرده است') },
  official: { l: L('Official authority confirmed', 'تأیید مرجع رسمی'), short: L('Official', 'تأیید رسمی'), hint: L('The competent authority confirmed this specific item', 'مرجع دارای اختیار، مورد مشخصی را تأیید کرده است') },
  dna: { l: L('Parentage DNA-verified', 'تأیید والدین با DNA'), short: L('DNA parentage', 'والدین با DNA'), hint: L('A valid test confirmed parent compatibility — not colour, breed or health', 'آزمایش معتبر سازگاری والدین را بررسی کرده است؛ نه رنگ، نژاد یا سلامت') },
  conflict: { l: L('Conflict · needs review', 'تعارض / نیازمند بازبینی'), short: L('Needs review', 'نیازمند بازبینی'), hint: L('Contradictory data or a possible duplicate — automatic approval stopped', 'اطلاعات متناقض یا احتمال تکراری؛ تأیید خودکار متوقف شده') },
};
export const AUTH = {
  fed: L('Iran Equestrian Federation', 'فدراسیون سوارکاری ایران'), lab: L('National Equine Genetics Lab', 'آزمایشگاه ملی ژنتیک اسب'),
  reg: L('Registry officer', 'کارشناس ثبت'), vet: L('Licensed veterinarian', 'دامپزشک دارای مجوز'), owner: L('Owner', 'مالک'),
};

export function dateFor(h: Horse, k: number) {
  const s = hash(h.id) + k * 7;
  const y0 = +h.birth.slice(0, 4);
  const y = Math.min(2025, y0 + 1 + (s % 2));
  const m = y === 2025 ? 1 + (s % 3) : 1 + (s % 12);
  return `${y}-${pad(m)}-${pad(5 + (s % 20))}`;
}

export function conflictOf(h: Horse): { rule: string; msg: L } | null {
  if (h.duplicateWarning) return { rule: 'dup', msg: L('Possible duplicate of another registered record (name, birth date and parents match).', 'احتمال تکراری بودن با رکورد دیگر (نام، تاریخ تولد و والدین مطابق است).') };
  if (!isGen(h)) return null;
  const k = hash(h.id) % 23;
  if (k === 0) return { rule: 'colour', msg: L('Registered colour differs from photographs and a previous record.', 'رنگ ثبت‌شده با عکس‌ها و سابقه قبلی اختلاف دارد.') };
  if (k === 1) return { rule: 'parent-date', msg: L('Registered sire’s birth date makes the parentage impossible.', 'تاریخ تولد پدر ثبت‌شده، والدیت را ناممکن می‌کند.') };
  if (k === 2) return { rule: 'multi-source', msg: L('Two sources disagree on the birth date; both values retained.', 'دو منبع در تاریخ تولد اختلاف دارند؛ هر دو مقدار نگهداری شده است.') };
  return null;
}

export function primaryTrust(h: Horse): TrustLevel {
  if (conflictOf(h)) return 'conflict';
  if (h.verified.federation) return 'official';
  if (h.verified.passport) return 'reviewed';
  if (h.verified.owner) return hash(h.id) % 2 === 0 ? 'uploaded' : 'self';
  return 'self';
}

export function parentsOf(h: Horse) {
  const sireH = h.sireId ? horseById(h.sireId) : undefined;
  const damH = h.damId ? horseById(h.damId) : undefined;
  const sire = sireH ? sireH.name : h.sire ? ancestor('S', h.sire.i).name : null;
  const dam = damH ? damH.name : h.dam ? ancestor('D', h.dam.i).name : null;
  return { sire, dam, sireH, damH };
}

/* ======================= identifiers ======================= */
export interface Ids { chip: string; passport: string; studbook: string; book: L; ueln: string; fei?: string }
const idCache = new Map<string, Ids>();
const BOOKS: L[] = [L('Persian Arabian Stud Book', 'دفتر تبارنامه عرب ایرانی'), L('Turkoman Stud Book', 'دفتر تبارنامه ترکمن'), L('Darashouri Stud Book', 'دفتر تبارنامه داراشوری'), L('Kurdish Horse Registry', 'ثبت اسب کُرد'), L('Caspian Stud Book', 'دفتر تبارنامه خزری')];
export function idsOf(h: Horse): Ids {
  if (/^\d+$/.test(h.id)) return {chip:'',passport:'',studbook:'',book:L('—','—'),ueln:''};
  const hit = idCache.get(h.id);
  if (hit) return hit;
  const s = hash(h.id + h.regId);
  const bi = Math.max(0, BREEDS.findIndex((b) => b.en === h.breed.en));
  const chip = h.id === 'persian-star' ? '981020000123456' : '981020' + String(100000000 + (s % 900000000));
  const v: Ids = {
    chip, passport: `IRP-${h.birth.slice(0, 4)}-${10000 + (s % 89999)}`, studbook: `${['PA', 'TK', 'DR', 'KU', 'CS'][bi]}-${1000 + (s % 8999)}`, book: BOOKS[bi],
    ueln: '364001' + chip.slice(6), fei: h.discipline !== 'endurance' && s % 3 === 0 ? `FEI 10${10000 + (s % 89999)}` : undefined,
  };
  idCache.set(h.id, v);
  return v;
}

export function aliasesOf(h: Horse): { birthName?: L; previous: L[] } {
  if (h.id === 'persian-star') return { birthName: L('Shahzadeh', 'شاهزاده'), previous: [L('Shahzadeh', 'شاهزاده')] };
  if (!isGen(h) || hash(h.id + 'al') % 4 !== 0) return { previous: [] };
  const a = ancestor(h.gender === 'mare' ? 'D' : 'S', 10 + (hash(h.id) % 400)).name;
  return { birthName: a, previous: [a] };
}
const MARK: L[] = [L('Star', 'ستاره'), L('Blaze', 'پیشانی‌سفید'), L('Snip', 'پوزه‌سفید'), L('Left hind sock', 'جوراب پای عقب چپ'), L('Right fore coronet', 'تاج سم جلوی راست'), L('No white markings', 'بدون خال سفید'), L('Star and snip', 'ستاره و پوزه‌سفید')];
export const markingsOf = (h: Horse) => (h.id === 'persian-star' ? L('Star · left hind sock', 'ستاره · جوراب پای عقب چپ') : MARK[hash(h.id + 'mk') % MARK.length]);

export function statusOf(h: Horse): { s: 'alive' | 'deceased' | 'missing'; date?: string } {
  if (!isGen(h)) return { s: 'alive' };
  const k = hash(h.id + 'st');
  const y = +h.birth.slice(0, 4);
  if ((y < 2012 && k % 3 === 0) || k % 31 === 0) return { s: 'deceased', date: `${Math.min(2025, y + 8 + (k % 9))}-0${1 + (k % 3)}-1${k % 9}` };
  if (k % 59 === 1) return { s: 'missing', date: `2024-11-0${1 + (k % 8)}` };
  return { s: 'alive' };
}
export const birthEstimated = (h: Horse) => isGen(h) && hash(h.id + 'be') % 10 === 0;

/* ======================= provenance ======================= */
export interface Prov { key: string; label: L; value: L; level: TrustLevel; authority: L; date?: string; ref?: string; scope: L; vis: 'public' | 'restricted' | 'private' }
export function provenanceOf(h: Horse): Prov[] {
  const c = conflictOf(h);
  const official = h.verified.federation, reviewed = h.verified.passport;
  const ids = idsOf(h);
  const ref = (p: string) => `${p}-${dateFor(h, 1).slice(0, 4)}-${(hash(h.id + p) % 9000) + 1000}`;
  const base: TrustLevel = official ? 'official' : reviewed ? 'reviewed' : h.verified.owner ? (hash(h.id) % 2 === 0 ? 'uploaded' : 'self') : 'self';
  const who = official ? AUTH.fed : reviewed ? AUTH.reg : AUTH.owner;
  const par = parentsOf(h);
  const parentage: TrustLevel = c?.rule === 'parent-date' ? 'conflict' : h.dna ? 'dna' : official ? 'official' : 'self';
  return [
    { key: 'identity', label: L('Name, sex & birth date', 'نام، جنس و تاریخ تولد'), value: h.name, level: c && (c.rule === 'dup' || c.rule === 'multi-source') ? 'conflict' : base, authority: who, date: base === 'self' ? undefined : dateFor(h, 1), ref: official ? ref('FED') : undefined, scope: L('Identity details checked against registration documents', 'مشخصات هویتی با مدارک ثبت تطبیق داده شده'), vis: 'public' },
    { key: 'microchip', label: L('Microchip', 'میکروچیپ'), value: L(ids.chip, ids.chip), level: official ? 'official' : reviewed ? 'reviewed' : 'uploaded', authority: official ? AUTH.fed : reviewed ? AUTH.reg : AUTH.owner, date: dateFor(h, 2), ref: official ? ref('CHP') : undefined, scope: L('Chip number read and matched to the passport', 'شماره چیپ خوانده و با پاسپورت تطبیق داده شد'), vis: 'public' },
    { key: 'passport', label: L('Passport', 'پاسپورت'), value: L(ids.passport, ids.passport), level: official ? 'official' : reviewed ? 'reviewed' : h.verified.owner ? 'uploaded' : 'self', authority: official ? AUTH.fed : AUTH.reg, date: reviewed ? dateFor(h, 3) : undefined, ref: official ? ref('PSP') : undefined, scope: L('Passport authenticity and issuer; does not confirm parentage', 'اصالت و صادرکننده پاسپورت؛ والدین را تأیید نمی‌کند'), vis: 'public' },
    { key: 'parentage', label: L('Parentage (sire × dam)', 'والدین (پدر × مادر)'), value: L(`${par.sire?.en ?? '—'} × ${par.dam?.en ?? '—'}`, `${par.sire?.fa ?? '—'} × ${par.dam?.fa ?? '—'}`), level: parentage, authority: h.dna ? AUTH.lab : official ? AUTH.fed : AUTH.owner, date: h.dna ? dateFor(h, 4) : undefined, ref: h.dna ? ref('STR') : undefined, scope: h.dna ? L('Parent–offspring compatibility on the STR panel. Not colour, breed or health.', 'سازگاری والد–فرزند در پنل STR. نه رنگ، نژاد یا سلامت.') : L('Parents as declared; no DNA confirmation on record', 'والدین طبق اظهار؛ تأیید DNA ثبت نشده'), vis: 'public' },
    { key: 'ownership', label: L('Ownership', 'مالکیت'), value: h.owner, level: official ? 'official' : 'self', authority: official ? AUTH.fed : AUTH.owner, date: official ? dateFor(h, 5) : undefined, ref: official ? ref('OWN') : undefined, scope: L('Current legal owner and transfer chain', 'مالک قانونی فعلی و زنجیره انتقال'), vis: 'restricted' },
    { key: 'colour', label: L('Colour & markings', 'رنگ و علائم'), value: markingsOf(h), level: c?.rule === 'colour' ? 'conflict' : reviewed ? 'reviewed' : 'self', authority: reviewed ? AUTH.reg : AUTH.owner, date: reviewed ? dateFor(h, 6) : undefined, scope: L('Registered phenotype from photographs — not a genetic test', 'فنوتیپ ثبت‌شده از روی عکس؛ آزمایش ژنتیکی نیست'), vis: 'public' },
    { key: 'health', label: L('Health documents', 'مدارک سلامت'), value: L('Vaccination & examinations', 'واکسن و معاینه‌ها'), level: reviewed ? 'reviewed' : 'uploaded', authority: AUTH.vet, date: h.lastVet, scope: L('Reviewed by a licensed vet; detail stays confidential unless the owner publishes it', 'بررسی توسط دامپزشک؛ جزئیات محرمانه می‌ماند مگر مالک منتشر کند'), vis: 'private' },
  ];
}

/* ======================= documents ======================= */
export interface Doc { id: string; type: L; level: TrustLevel | 'missing'; issuer: L; date?: string; expires?: string; vis: 'public' | 'restricted' | 'private'; kind: 'pdf' | 'img'; required: boolean }
export function documentsOf(h: Horse): Doc[] {
  const official = h.verified.federation, reviewed = h.verified.passport;
  const lv = (ok: boolean, strong: TrustLevel): Doc['level'] => (ok ? strong : h.verified.owner ? 'uploaded' : 'missing');
  const d = (k: number) => dateFor(h, k);
  return [
    { id: 'passport', type: L('Digital passport', 'گذرنامه دیجیتال'), level: official ? 'official' : lv(reviewed, 'reviewed'), issuer: AUTH.fed, date: d(1), vis: 'public', kind: 'pdf', required: true },
    { id: 'reg', type: L('Registration certificate', 'گواهی ثبت'), level: official ? 'official' : h.verified.owner ? 'uploaded' : 'missing', issuer: AUTH.fed, date: d(2), vis: 'public', kind: 'pdf', required: true },
    { id: 'own', type: L('Ownership certificate', 'گواهی مالکیت'), level: official ? 'official' : h.verified.owner ? 'uploaded' : 'missing', issuer: AUTH.owner, date: d(3), vis: 'restricted', kind: 'pdf', required: true },
    { id: 'dna', type: L('DNA parentage report', 'گزارش DNA والدین'), level: h.dna ? 'dna' : 'missing', issuer: AUTH.lab, date: d(4), vis: 'public', kind: 'pdf', required: false },
    { id: 'lic', type: L('Federation licence', 'مجوز فدراسیون'), level: official ? 'official' : 'missing', issuer: AUTH.fed, date: d(5), expires: addDays(d(5), 365), vis: 'public', kind: 'pdf', required: false },
    { id: 'vac', type: L('Vaccination record', 'کارنامه واکسیناسیون'), level: reviewed ? 'reviewed' : 'uploaded', issuer: AUTH.vet, date: h.lastVet, expires: addDays(h.lastVet, 180), vis: 'private', kind: 'pdf', required: true },
    { id: 'photos', type: L('Standard photo set (both sides, head, markings)', 'عکس‌های استاندارد (دو طرف، سر، علائم)'), level: reviewed ? 'reviewed' : 'uploaded', issuer: AUTH.owner, date: d(6), vis: 'public', kind: 'img', required: true },
  ];
}

/* ======================= audit history ======================= */
export interface Hist { date: string; user: L; role: L; action: L; field?: L; from?: L; to?: L; reason?: L; evidence?: L }
export function historyOf(h: Horse): Hist[] {
  const c = conflictOf(h);
  const out: Hist[] = [
    { date: dateFor(h, 0), user: h.owner, role: AUTH.owner, action: L('Registration submitted', 'درخواست ثبت ارسال شد') },
  ];
  if (h.verified.passport) out.push({ date: dateFor(h, 3), user: L('Ali Rezaei', 'علی رضایی'), role: AUTH.reg, action: L('Passport reviewed', 'پاسپورت بررسی شد'), evidence: L('Passport scan · microchip read', 'اسکن پاسپورت · خواندن چیپ') });
  if (hash(h.id + 'c') % 3 === 0) out.push({ date: dateFor(h, 4), user: L('Ali Rezaei', 'علی رضایی'), role: AUTH.reg, action: L('Field corrected', 'فیلد اصلاح شد'), field: L('Colour', 'رنگ'), from: L('Bay', 'کهر'), to: L('Dark bay', 'کهر تیره'), reason: L('Owner request after review of photographs', 'درخواست مالک پس از بررسی عکس‌ها'), evidence: L('Photographs 2024', 'عکس‌های ۲۰۲۴') });
  if (h.dna) out.push({ date: dateFor(h, 5), user: AUTH.lab, role: L('Laboratory', 'آزمایشگاه'), action: L('DNA parentage result linked', 'نتیجه DNA والدین متصل شد'), evidence: L('Lab report · STR panel', 'گزارش آزمایشگاه · پنل STR') });
  if (h.verified.federation) out.push({ date: dateFor(h, 6), user: L('Ali Rezaei', 'علی رضایی'), role: AUTH.fed, action: L('Identity confirmed by authority', 'هویت توسط مرجع تأیید شد'), reason: L('Documents and microchip match', 'مدارک و چیپ مطابقت دارند') });
  if (h.sale) out.push({ date: dateFor(h, 7), user: h.owner, role: AUTH.owner, action: L('Listed for sale', 'برای فروش ثبت شد') });
  if (c) out.push({ date: TODAY, user: L('Rules engine', 'موتور قوانین'), role: L('System', 'سامانه'), action: L('Flagged for human review', 'برای بازبینی انسانی علامت خورد'), reason: c.msg });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ======================= genetic tests ======================= */
export interface GTest { id: string; kind: 'parentage' | 'colour' | 'disease'; name: L; lab: L; sample: string; date: string; method: L; result: L; status: 'verified' | 'uploaded'; tone: 'ok' | 'warn' | 'info' }
export function testsOf(h: Horse): GTest[] {
  if (!h.dna) return [];
  const g = genotypeOf(h)!;
  const sample = `S-${100000 + (hash(h.id) % 899999)}`;
  const st = (k: string): 'verified' | 'uploaded' => (hash(h.id + k) % 6 === 0 ? 'uploaded' : 'verified');
  const bad = conflictOf(h)?.rule === 'parent-date';
  const list: GTest[] = [
    { id: 't-str', kind: 'parentage', name: L('Parentage · STR panel (17 markers)', 'والدسنجی · پنل STR (۱۷ مارکر)'), lab: AUTH.lab, sample, date: dateFor(h, 4), method: L('Microsatellite (STR), capillary electrophoresis', 'میکروساتلایت (STR) – الکتروفورز مویینه'), result: bad ? L('Incompatible with registered sire', 'ناسازگار با پدر ثبت‌شده') : L('Compatible with registered parents', 'سازگار با والدین ثبت‌شده'), status: 'verified', tone: bad ? 'warn' : 'ok' },
    { id: 't-col', kind: 'colour', name: L('Coat colour panel · MC1R · ASIP · STX17', 'پنل رنگ پوشش · MC1R · ASIP · STX17'), lab: AUTH.lab, sample, date: dateFor(h, 5), method: L('Targeted genotyping', 'ژنوتایپینگ هدفمند'), result: L(`${g.e} · ${g.a} · ${g.g}`, `${g.e} · ${g.a} · ${g.g}`), status: st('c'), tone: 'info' },
  ];
  DISEASES.forEach((d) => {
    const s = diseaseStatus(h, d.code);
    if (s === 'na') return;
    list.push({ id: 't-' + d.code, kind: 'disease', name: L(`${d.code} · ${d.name.en}`, `${d.code} · ${d.name.fa}`), lab: AUTH.lab, sample, date: dateFor(h, 5), method: L('Single-gene DNA test', 'آزمون DNA تک‌ژنی'), result: s === 'carrier' ? L('Carrier (one copy)', 'ناقل (یک نسخه)') : L('Clear (no copies)', 'سالم (بدون نسخه)'), status: st(d.code), tone: s === 'carrier' ? 'warn' : 'ok' });
  });
  return list;
}
export const STR_MARKERS = ['AHT4', 'AHT5', 'ASB2', 'HMS2', 'HMS3', 'HMS6', 'HMS7', 'HTG4', 'HTG6', 'HTG7', 'HTG10', 'VHL20', 'ASB17', 'ASB23', 'CA425', 'HMS1', 'LEX3'];
export const strProfile = (h: Horse) => STR_MARKERS.map((m) => { const s = hash(h.id + m); return { m, a: 100 + (s % 14) * 2, b: 100 + ((s >> 5) % 14) * 2 }; });

/* ======================= competitions ======================= */
const EV: { name: L; venue: L; d: Discipline }[] = [
  { name: L('National Show Jumping Championship', 'مسابقات قهرمانی ملی پرش با اسب'), venue: L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), d: 'jumping' },
  { name: L('Alborz Cup Grand Prix', 'جام بزرگ البرز'), venue: L('Karaj Riding Club', 'باشگاه سوارکاری کرج'), d: 'jumping' },
  { name: L('Autumn Open Jumping', 'پرش آزاد پاییزه'), venue: L('Shiraz Equestrian Park', 'پارک سوارکاری شیراز'), d: 'jumping' },
  { name: L('Isfahan Dressage Festival', 'جشنواره درساژ اصفهان'), venue: L('Isfahan Hippodrome', 'هیپودروم اصفهان'), d: 'dressage' },
  { name: L('Tehran Dressage Open', 'درساژ آزاد تهران'), venue: L('Azadi Arena', 'میدان آزادی'), d: 'dressage' },
  { name: L('Spring Dressage Classic', 'کلاسیک بهاره درساژ'), venue: L('Isfahan Hippodrome', 'هیپودروم اصفهان'), d: 'dressage' },
  { name: L('Turkoman Heritage Cup', 'جام میراث ترکمن'), venue: L('Gorgan Plains', 'دشت گرگان'), d: 'endurance' },
  { name: L('Fars 80 km Endurance', 'استقامت ۸۰ کیلومتر فارس'), venue: L('Persepolis Trail', 'مسیر تخت‌جمشید'), d: 'endurance' },
  { name: L('Endurance Ride – 120 km', 'سواری استقامت – ۱۲۰ کیلومتر'), venue: L('Qom Desert Track', 'مسیر کویر قم'), d: 'endurance' },
];
const resCache = new Map<string, Result[]>();
export function resultsOf(h: Horse): Result[] {
  const hit = resCache.get(h.id);
  if (hit) return hit;
  let out: Result[];
  if (!isGen(h)) out = RESULTS.filter((r) => r.horseId === h.id);
  else {
    const s = hash(h.id + 'res');
    const n = +h.birth.slice(0, 4) > 2021 ? 0 : s % 6;
    const pool = EV.filter((e) => e.d === h.discipline);
    out = Array.from({ length: n }, (_, i) => {
      const e = pool[(s + i) % pool.length];
      const w = hash(h.id + i) % 10;
      return { id: `${h.id}-r${i}`, horseId: h.id, date: `${2025 - Math.floor(i / 3)}-${pad(3 - (i % 3))}-${pad(8 + i * 2)}`, name: e.name, venue: e.venue, discipline: e.d, place: w < 2 ? 1 : w < 4 ? 2 : w < 5 ? 3 : 4 + (w % 4), rider: RIDERS[(s + i) % RIDERS.length].id };
    });
  }
  resCache.set(h.id, out);
  return out;
}
export type ResStatus = 'verified' | 'imported' | 'pending';
export function resultMeta(r: Result): { source: string; status: ResStatus; matchedBy: 'microchip' | 'passport' | 'name' } {
  const s = hash(r.id);
  if (['r1', 'r4', 'r8', 'r10', 'r11'].includes(r.id)) return { source: 'Federation DB', status: 'verified', matchedBy: 'microchip' };
  const matchedBy = s % 9 === 0 ? 'name' : s % 2 ? 'passport' : 'microchip';
  const status: ResStatus = matchedBy === 'name' ? 'pending' : s % 3 === 0 ? 'imported' : s % 3 === 1 ? 'verified' : 'pending';
  return { source: ['Federation DB', 'Asb Davani', 'FEI', 'Organiser'][s % 4], status, matchedBy };
}

/* ======================= reproduction ======================= */
export const offspringOf = (h: Horse) => HORSES.filter((o) => o.sireId === h.id || o.damId === h.id).sort((a, b) => b.birth.localeCompare(a.birth));
export interface Repro { id: string; mating: string; partner: { name: L; id?: string }; method: 'natural' | 'ai' | 'et'; foaling?: string; outcome: 'live' | 'twins' | 'pregnant' | 'open'; foalId?: string; recipient?: L }
export function reproductionOf(h: Horse): Repro[] {
  if (h.gender === 'gelding') return [];
  const out: Repro[] = offspringOf(h).map((o) => {
    const k = hash(o.id);
    const partnerH = horseById(h.gender === 'mare' ? o.sireId ?? '' : o.damId ?? '');
    const p = parentsOf(o);
    const pn = h.gender === 'mare' ? p.sire : p.dam;
    return {
      id: 'rp-' + o.id, mating: addDays(o.birth, -340), partner: { name: partnerH?.name ?? pn ?? L('Unregistered', 'ثبت‌نشده'), id: partnerH?.id },
      method: k % 7 === 0 ? 'et' : k % 3 === 0 ? 'ai' : 'natural', foaling: o.birth, outcome: k % 31 === 0 ? 'twins' : 'live', foalId: o.id,
      recipient: k % 7 === 0 ? ancestor('D', 40 + (k % 100)).name : undefined,
    };
  });
  const y = +h.birth.slice(0, 4);
  if (h.gender === 'mare' && y <= 2021 && hash(h.id + 'pg') % 2 === 0) out.unshift({ id: 'rp-now', mating: '2024-06-12', partner: { name: ancestor('S', 120 + (hash(h.id) % 200)).name }, method: 'natural', outcome: 'pregnant', foaling: '2025-05-17' });
  if (h.gender === 'mare' && y <= 2021 && hash(h.id + 'op') % 3 === 0) out.push({ id: 'rp-open', mating: '2023-05-20', partner: { name: ancestor('S', 100 + (hash(h.id) % 200)).name }, method: 'ai', outcome: 'open' });
  return out;
}
