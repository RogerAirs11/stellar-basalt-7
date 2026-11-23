import { L } from './i18n';
import type { RoleKey } from './role';
import { horseById } from './data';
import { parentsOf } from './records';

const PS = parentsOf(horseById('persian-star')!);

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= review queue ================= */
export type QKind = 'registration' | 'correction' | 'duplicate' | 'conflict' | 'document' | 'transfer' | 'parentage';
export interface QItem {
  id: string; kind: QKind; horse: string; by: L; role: L; date: string; prio: 'high' | 'normal' | 'low'; title: L; note: L;
  diff?: { field: L; from: L; to: L }[]; reason?: L; evidence?: L;
  sources?: { src: string; value: string; date: string }[]; conflictField?: L;
  incoming?: Record<string, L>; score?: number; signals?: { l: L; hit: boolean }[]; scopes?: { k: string; l: L }[];
}
const OWN = L('Farah Equestrian Co.', 'شرکت سوارکاری فرح');
const SC = [
  { k: 'identity', l: L('Identity (name, sex, birth)', 'هویت (نام، جنس، تولد)') },
  { k: 'passport', l: L('Passport & microchip', 'پاسپورت و میکروچیپ') },
  { k: 'ownership', l: L('Ownership', 'مالکیت') },
  { k: 'parentage', l: L('Parentage (documents only)', 'والدین (فقط مدارک)') },
];
export const QUEUE: QItem[] = [
  { id: 'Q-2041', kind: 'duplicate', horse: 'persian-star', by: OWN, role: L('Owner', 'مالک'), date: '2025-04-14', prio: 'high', title: L('Possible duplicate: “Persian Star II”', 'احتمال تکراری: «ستاره پارسی ۲»'), note: L('A new submission matches an existing horse on name, birth date, breed and parents.', 'ثبت جدید از نظر نام، تاریخ تولد، نژاد و والدین با اسب موجود مطابقت دارد.'), score: 92,
    incoming: { name: L('Persian Star II', 'ستاره پارسی ۲'), birth: L('2020-04-12', '2020-04-12'), sex: L('Stallion', 'اسب نر'), breed: L('Persian Arabian', 'عرب ایرانی'), chip: L('981020000123465', '981020000123465'), passport: L('IRP-2020-40117', 'IRP-2020-40117'), sire: PS.sire!, dam: PS.dam!, location: L('Karaj', 'کرج'), owner: L('Farah Equestrian Co.', 'شرکت سوارکاری فرح') },
    signals: [{ l: L('Name similarity 94%', 'شباهت نام ۹۴٪'), hit: true }, { l: L('Same birth date', 'تاریخ تولد یکسان'), hit: true }, { l: L('Same breed & sex', 'نژاد و جنس یکسان'), hit: true }, { l: L('Same parents', 'والدین یکسان'), hit: true }, { l: L('Microchip differs by 1 digit', 'میکروچیپ در ۱ رقم اختلاف دارد'), hit: false }, { l: L('Location differs', 'محل متفاوت'), hit: false }] },
  { id: 'Q-2040', kind: 'correction', horse: 'nika', by: L('Pars Stud', 'اصطبل پارس'), role: L('Owner', 'مالک'), date: '2025-04-14', prio: 'normal', title: L('Correction: colour and markings', 'اصلاح: رنگ و علائم'), note: L('Owner requests a colour change after the mare greyed out.', 'مالک پس از خاکستری شدن مادیان تغییر رنگ را درخواست کرده است.'),
    diff: [{ field: L('Colour', 'رنگ'), from: L('Bay', 'کهر'), to: L('Grey', 'خاکستری') }, { field: L('Markings', 'علائم'), from: L('Star', 'ستاره'), to: L('Star · snip', 'ستاره · پوزه‌سفید') }], reason: L('Progressive greying with age, documented by photographs.', 'خاکستری شدن تدریجی با سن، با عکس مستند شده است.'), evidence: L('Photo set 2022–2025 (4 files)', 'مجموعه عکس ۲۰۲۲–۲۰۲۵ (۴ فایل)') },
  { id: 'Q-2039', kind: 'conflict', horse: 'h12', by: L('Rules engine', 'موتور قوانین'), role: L('System', 'سامانه'), date: '2025-04-13', prio: 'high', title: L('Birth date: two sources disagree', 'تاریخ تولد: دو منبع اختلاف دارند'), note: L('Federation DB and an imported studbook list different birth dates.', 'پایگاه فدراسیون و تبارنامه واردشده تاریخ تولد متفاوتی دارند.'), conflictField: L('Birth date', 'تاریخ تولد'),
    sources: [{ src: 'Federation DB', value: '2016-03-14', date: '2024-02-11' }, { src: 'Studbook import (xlsx)', value: '2015-03-14', date: '2025-01-19' }, { src: 'Owner declaration', value: '2016-03-14', date: '2023-09-02' }] },
  { id: 'Q-2038', kind: 'registration', horse: 'h5', by: L('Zagros Horse Club', 'باشگاه اسب زاگرس'), role: L('Owner', 'مالک'), date: '2025-04-13', prio: 'normal', title: L('New registration awaiting review', 'ثبت جدید در انتظار بررسی'), note: L('Passport and ownership certificate uploaded; DNA not provided.', 'پاسپورت و گواهی مالکیت بارگذاری شده؛ DNA ارائه نشده است.'), scopes: SC },
  { id: 'Q-2037', kind: 'parentage', horse: 'h33', by: L('National Equine Genetics Lab', 'آزمایشگاه ملی ژنتیک اسب'), role: L('Laboratory', 'آزمایشگاه'), date: '2025-04-12', prio: 'high', title: L('STR result incompatible with registered sire', 'نتیجه STR با پدر ثبت‌شده ناسازگار است'), note: L('4 of 17 markers do not match the declared sire. Human decision required.', '۴ مارکر از ۱۷ با پدر اعلام‌شده مطابقت ندارد. تصمیم انسانی لازم است.'), scopes: [SC[3]] },
  { id: 'Q-2036', kind: 'transfer', horse: 'h20', by: L('Gilan Green Valley Farm', 'مزرعه دره سبز گیلان'), role: L('Owner', 'مالک'), date: '2025-04-12', prio: 'normal', title: L('Ownership transfer', 'انتقال مالکیت'), note: L('Seller and buyer have both signed the transfer form.', 'فروشنده و خریدار هر دو فرم انتقال را امضا کرده‌اند.'), scopes: [SC[2]] },
  { id: 'Q-2035', kind: 'document', horse: 'mahtab', by: L('Pars Stud', 'اصطبل پارس'), role: L('Owner', 'مالک'), date: '2025-04-11', prio: 'low', title: L('Passport scan uploaded', 'اسکن پاسپورت بارگذاری شد'), note: L('Passport file awaits review.', 'فایل پاسپورت در انتظار بررسی است.'), scopes: [SC[1]] },
  { id: 'Q-2034', kind: 'correction', horse: 'h41', by: L('Kerman Horse Farm', 'مزرعه اسب کرمان'), role: L('Owner', 'مالک'), date: '2025-04-11', prio: 'normal', title: L('Correction: microchip number', 'اصلاح: شماره میکروچیپ'), note: L('Digits transposed during original data entry.', 'ارقام هنگام ورود اولیه جابه‌جا شده‌اند.'),
    diff: [{ field: L('Microchip', 'میکروچیپ'), from: L('981020451182907', '981020451182907'), to: L('981020451182097', '981020451182097') }], reason: L('Typing error — chip re-read by veterinarian.', 'اشتباه تایپی — چیپ توسط دامپزشک دوباره خوانده شد.'), evidence: L('Vet certificate #4471', 'گواهی دامپزشک ۴۴۷۱') },
  { id: 'Q-2033', kind: 'duplicate', horse: 'h60', by: L('Rules engine', 'موتور قوانین'), role: L('System', 'سامانه'), date: '2025-04-10', prio: 'normal', title: L('Possible duplicate on import', 'احتمال تکراری هنگام ورود داده'), note: L('Imported studbook row resembles an existing horse.', 'ردیف تبارنامه واردشده شبیه اسب موجود است.'), score: 71,
    incoming: { name: L('Shahbaz of Fars', 'شهباز فارس'), birth: L('2012-04-05', '2012-04-05'), sex: L('Stallion', 'اسب نر'), breed: L('Turkoman', 'ترکمن'), chip: L('—', '—'), passport: L('—', '—'), sire: L('Unknown', 'نامشخص'), dam: L('Unknown', 'نامشخص'), location: L('Gorgan', 'گرگان'), owner: L('Unknown', 'نامشخص') },
    signals: [{ l: L('Name similarity 100%', 'شباهت نام ۱۰۰٪'), hit: true }, { l: L('Birth year matches', 'سال تولد یکسان'), hit: true }, { l: L('No identifiers to compare', 'شناسه‌ای برای مقایسه نیست'), hit: false }, { l: L('Parents unknown', 'والدین نامشخص'), hit: false }] },
  { id: 'Q-2032', kind: 'registration', horse: 'h77', by: L('Hamadan Equine Co.', 'شرکت اسب همدان'), role: L('Owner', 'مالک'), date: '2025-04-09', prio: 'low', title: L('Embryo-transfer foal registration', 'ثبت کره انتقال جنین'), note: L('Genetic dam and recipient mare declared; documents attached.', 'مادر ژنتیکی و مادیان گیرنده اعلام شده؛ مدارک پیوست است.'), scopes: SC },
  { id: 'Q-2031', kind: 'conflict', horse: 'h30', by: L('Rules engine', 'موتور قوانین'), role: L('System', 'سامانه'), date: '2025-04-08', prio: 'normal', title: L('Colour differs from photographs', 'رنگ با عکس‌ها اختلاف دارد'), note: L('Registered “Bay” but latest photo set shows chestnut.', 'رنگ ثبت‌شده «کهر» اما عکس‌های جدید اشقر را نشان می‌دهد.'), conflictField: L('Colour', 'رنگ'),
    sources: [{ src: 'Registration form', value: 'Bay', date: '2019-05-03' }, { src: 'Photo review', value: 'Chestnut', date: '2025-04-05' }] },
  { id: 'Q-2030', kind: 'document', horse: 'yaas', by: L('Zagros Horse Club', 'باشگاه اسب زاگرس'), role: L('Owner', 'مالک'), date: '2025-04-07', prio: 'low', title: L('Ownership certificate uploaded', 'گواهی مالکیت بارگذاری شد'), note: L('Awaiting expert review.', 'در انتظار بررسی کارشناس.'), scopes: [SC[2]] },
];
export const QKIND: Record<QKind, { l: L; tone: string }> = {
  registration: { l: L('Registration', 'ثبت'), tone: 'sky' }, correction: { l: L('Correction', 'اصلاح'), tone: 'indigo' }, duplicate: { l: L('Duplicate', 'تکراری'), tone: 'amber' },
  conflict: { l: L('Conflict', 'تعارض'), tone: 'red' }, document: { l: L('Document', 'مدرک'), tone: 'teal' }, transfer: { l: L('Transfer', 'انتقال'), tone: 'violet' }, parentage: { l: L('Parentage', 'والدین'), tone: 'fuchsia' },
};

/* ================= users ================= */
export interface UserRow { id: string; name: L; role: RoleKey; org: L; status: 'active' | 'pending' | 'suspended'; mfa: boolean; last: string; email: string }
const FN: [string, string][] = [['Ali', 'علی'], ['Sara', 'سارا'], ['Reza', 'رضا'], ['Neda', 'ندا'], ['Kian', 'کیان'], ['Mina', 'مینا'], ['Omid', 'امید'], ['Leila', 'لیلا'], ['Hamed', 'حامد'], ['Tara', 'تارا'], ['Arash', 'آرش'], ['Roya', 'رویا']];
const LN: [string, string][] = [['Rezaei', 'رضایی'], ['Karimi', 'کریمی'], ['Najafi', 'نجفی'], ['Jafari', 'جعفری'], ['Sadeghi', 'صادقی'], ['Bagheri', 'باقری'], ['Zandi', 'زندی'], ['Mirzaei', 'میرزایی']];
const ORG: L[] = [L('Iran Equestrian Federation', 'فدراسیون سوارکاری ایران'), L('Pars Stud', 'اصطبل پارس'), L('Alborz Equine Group', 'گروه اسب البرز'), L('Azadi Equestrian Club', 'باشگاه سوارکاری آزادی'), L('Tehran Equine Clinic', 'کلینیک اسب تهران'), L('National Equine Genetics Lab', 'آزمایشگاه ملی ژنتیک اسب'), L('Veterinary Organisation', 'سازمان دامپزشکی')];
const rU = rng(4242);
const RK: RoleKey[] = ['owner', 'owner', 'owner', 'breeder', 'breeder', 'rider', 'rider', 'vet', 'vet', 'lab', 'organizer', 'federation', 'ministry', 'public', 'admin'];
export const USERS: UserRow[] = Array.from({ length: 36 }, (_, i) => {
  const f = FN[Math.floor(rU() * FN.length)], l = LN[Math.floor(rU() * LN.length)];
  const role = RK[Math.floor(rU() * RK.length)];
  const sens = ['federation', 'admin', 'vet', 'lab', 'ministry'].includes(role);
  return { id: `U-${1000 + i}`, name: L(`${f[0]} ${l[0]}`, `${f[1]} ${l[1]}`), role, org: ORG[Math.floor(rU() * ORG.length)], status: rU() < 0.12 ? 'pending' : rU() < 0.05 ? 'suspended' : 'active', mfa: sens ? rU() < 0.92 : rU() < 0.35, last: `2025-04-${String(1 + Math.floor(rU() * 14)).padStart(2, '0')}`, email: `${f[0].toLowerCase()}.${l[0].toLowerCase()}@mail.ir` };
});

/* ================= audit ================= */
export interface AuditRow { t: string; user: L; role: L; action: L; target: string; sens: boolean; ip: string }
const ACT: [L, boolean][] = [
  [L('Approved registration', 'ثبت را تأیید کرد'), false], [L('Updated parentage', 'والدین را به‌روز کرد'), true], [L('Viewed health record', 'سابقه سلامت را مشاهده کرد'), true], [L('Changed rule severity', 'شدت قاعده را تغییر داد'), true],
  [L('Exported report', 'گزارش را خروجی گرفت'), false], [L('Resolved duplicate', 'تکراری را رفع کرد'), true], [L('Uploaded document', 'مدرک بارگذاری کرد'), false], [L('Linked DNA result', 'نتیجه DNA را متصل کرد'), true],
  [L('Transferred ownership', 'مالکیت را منتقل کرد'), true], [L('Imported results (CSV)', 'نتایج را وارد کرد (CSV)'), false], [L('Signed in (MFA)', 'ورود (چندمرحله‌ای)'), false],
];
const rA = rng(777);
export const AUDIT: AuditRow[] = Array.from({ length: 80 }, (_, i) => {
  const a = ACT[Math.floor(rA() * ACT.length)];
  const u = USERS[Math.floor(rA() * USERS.length)];
  const m = Math.max(0, 14 * 24 * 60 - i * 97 - Math.floor(rA() * 60));
  const d = new Date(Date.UTC(2025, 3, 14, 17, 40) - (14 * 24 * 60 - m) * 60000);
  return { t: d.toISOString().slice(0, 16).replace('T', ' '), user: u.name, role: ORG[0], action: a[0], target: `H-${100 + Math.floor(rA() * 800)}`, sens: a[1], ip: `10.${Math.floor(rA() * 200)}.${Math.floor(rA() * 250)}.${Math.floor(rA() * 250)}` };
}).sort((a, b) => b.t.localeCompare(a.t));

/* ================= legacy import ================= */
export interface ImportJob { id: string; file: string; kind: L; rows: number; ok: number; review: number; err: number; date: string; status: 'done' | 'review' | 'failed' }
export const JOBS: ImportJob[] = [
  { id: 'J-12', file: 'arabian_studbook_1985-2005.xlsx', kind: L('Studbook (Excel)', 'تبارنامه (اکسل)'), rows: 6240, ok: 5412, review: 702, err: 126, date: '2025-04-09', status: 'review' },
  { id: 'J-11', file: 'str_reports_lab_A.pdf → csv', kind: L('STR reports', 'گزارش‌های STR'), rows: 1810, ok: 1743, review: 41, err: 26, date: '2025-04-02', status: 'done' },
  { id: 'J-10', file: 'turkoman_registry_scans.csv', kind: L('Registry list (CSV)', 'فهرست ثبت (CSV)'), rows: 3120, ok: 2204, review: 688, err: 228, date: '2025-03-21', status: 'review' },
  { id: 'J-09', file: 'results_2024_season.csv', kind: L('Competition results', 'نتایج مسابقات'), rows: 9420, ok: 8801, review: 512, err: 107, date: '2025-03-04', status: 'done' },
];
export const IMPORT_ERRORS: { row: number; field: L; issue: L; value: string; sev: 'error' | 'review' }[] = [
  { row: 118, field: L('Birth date', 'تاریخ تولد'), issue: L('Date is after the sire’s death date', 'تاریخ پس از فوت پدر است'), value: '1993-06-02', sev: 'error' },
  { row: 204, field: L('Microchip', 'میکروچیپ'), issue: L('Not 15 digits', 'پانزده رقمی نیست'), value: '98102004412', sev: 'error' },
  { row: 311, field: L('Name', 'نام'), issue: L('Possible duplicate of IR-1998-01207', 'احتمال تکراری با IR-1998-01207'), value: 'Shahbaz Ardalan', sev: 'review' },
  { row: 342, field: L('Sire', 'پدر'), issue: L('Sire not found in registry — kept as unregistered', 'پدر در ثبت یافت نشد — ثبت‌نشده نگه داشته شد'), value: 'Gol-e Sorkh', sev: 'review' },
  { row: 507, field: L('Sex', 'جنس'), issue: L('Dam recorded as stallion', 'مادر به‌عنوان اسب نر ثبت شده'), value: 'M', sev: 'error' },
  { row: 561, field: L('Colour', 'رنگ'), issue: L('Unknown colour term “Ghermez” — map to Chestnut?', 'اصطلاح رنگ ناشناخته «قرمز» — نگاشت به اشقر؟'), value: 'Ghermez', sev: 'review' },
  { row: 790, field: L('Birth date', 'تاریخ تولد'), issue: L('Two sources disagree (2008 vs 2009)', 'دو منبع اختلاف دارند (۲۰۰۸ در برابر ۲۰۰۹)'), value: '2008 / 2009', sev: 'review' },
  { row: 812, field: L('Owner', 'مالک'), issue: L('Owner name matches 3 people — choose one', 'نام مالک با ۳ نفر مطابقت دارد — یکی را انتخاب کنید'), value: 'M. Karimi', sev: 'review' },
];

/* ================= integrations / API ================= */
export interface Source { id: string; name: string; kind: L; status: 'active' | 'pilot' | 'evaluating' | 'planned' | 'manual'; note: L; last?: string; rows: number; linked: number; review: number }
export const SOURCES: Source[] = [
  { id: 'fed', name: 'Federation DB', kind: L('Official registry', 'ثبت رسمی'), status: 'active', note: L('Authoritative for identity, passport and licence', 'مرجع هویت، پاسپورت و مجوز'), last: '2025-04-15 06:00', rows: 31240, linked: 30890, review: 350 },
  { id: 'asb', name: 'Asb Davani', kind: L('Racing / performance results', 'نتایج کورس و عملکرد'), status: 'evaluating', note: L('API availability and terms under study; file import until then', 'امکان API و شرایط در حال بررسی؛ تا آن زمان ورود فایل'), last: '2025-04-11 21:30', rows: 12480, linked: 10790, review: 1690 },
  { id: 'fei', name: 'FEI Horse Search', kind: L('International sport horses', 'اسب‌های ورزشی بین‌المللی'), status: 'pilot', note: L('FEI passport numbers matched to national ID', 'شماره FEI به شناسه ملی تطبیق داده می‌شود'), last: '2025-04-13 03:15', rows: 642, linked: 611, review: 31 },
  { id: 'org', name: 'Organiser CSV / portal', kind: L('Event results', 'نتایج رویداد'), status: 'manual', note: L('Clubs upload start lists and results after each event', 'باشگاه‌ها پس از هر رویداد فهرست و نتایج را بارگذاری می‌کنند'), last: '2025-04-14 18:42', rows: 4120, linked: 3902, review: 218 },
  { id: 'she', name: 'Sheyhe', kind: L('Pedigree & results (Iran)', 'شجره و نتایج (ایران)'), status: 'evaluating', note: L('Audit of available features and data licence', 'ممیزی قابلیت‌ها و مجوز داده'), rows: 0, linked: 0, review: 0 },
  { id: 'kas', name: 'Kasilor', kind: L('Registration & search features', 'قابلیت‌های ثبت و جست‌وجو'), status: 'planned', note: L('Direct capability audit planned in Phase 0', 'ممیزی مستقیم در مرحله صفر'), rows: 0, linked: 0, review: 0 },
];
export const ENDPOINTS: { m: 'GET' | 'POST' | 'PATCH'; p: string; d: L; scope: string }[] = [
  { m: 'GET', p: '/v1/horses?q=&breed=&trust=', d: L('Advanced search', 'جست‌وجوی پیشرفته'), scope: 'public' },
  { m: 'GET', p: '/v1/horses/{id}', d: L('Horse profile (public fields)', 'پروفایل اسب (فیلدهای عمومی)'), scope: 'public' },
  { m: 'GET', p: '/v1/horses/{id}/pedigree?depth=7', d: L('Pedigree graph', 'گراف شجره'), scope: 'public' },
  { m: 'POST', p: '/v1/horses', d: L('Submit registration', 'ارسال ثبت'), scope: 'owner' },
  { m: 'PATCH', p: '/v1/horses/{id}/fields/{field}', d: L('Request correction (audited)', 'درخواست اصلاح (ممیزی‌شده)'), scope: 'owner' },
  { m: 'POST', p: '/v1/results/import', d: L('Import results with source & identifiers', 'ورود نتایج با منبع و شناسه'), scope: 'organizer' },
  { m: 'POST', p: '/v1/genetics/reports', d: L('Lab: submit DNA report', 'آزمایشگاه: ثبت گزارش DNA'), scope: 'lab' },
  { m: 'GET', p: '/v1/export?format=json|csv', d: L('Full data export (no vendor lock-in)', 'خروجی کامل داده (بدون وابستگی)'), scope: 'admin' },
];

/* ================= catalogue ================= */
export interface BreedCfg { en: string; fa: string; book: L; sub: number; twins: 'allowed' | 'review' | 'block'; et: boolean; ai: boolean; minAge: number; docs: number; count: number }
export const BREED_CFG: BreedCfg[] = [
  { en: 'Persian Arabian', fa: 'عرب ایرانی', book: L('Persian Arabian Stud Book', 'دفتر تبارنامه عرب ایرانی'), sub: 4, twins: 'review', et: true, ai: true, minAge: 0, docs: 5, count: 18400 },
  { en: 'Turkoman', fa: 'ترکمن', book: L('Turkoman Stud Book', 'دفتر تبارنامه ترکمن'), sub: 3, twins: 'review', et: false, ai: true, minAge: 0, docs: 5, count: 9300 },
  { en: 'Darashouri', fa: 'داراشوری', book: L('Darashouri Stud Book', 'دفتر تبارنامه داراشوری'), sub: 2, twins: 'review', et: false, ai: false, minAge: 0, docs: 4, count: 8100 },
  { en: 'Kurdish', fa: 'کُرد', book: L('Kurdish Horse Registry', 'ثبت اسب کُرد'), sub: 2, twins: 'allowed', et: false, ai: false, minAge: 0, docs: 3, count: 7200 },
  { en: 'Caspian', fa: 'خزری', book: L('Caspian Stud Book', 'دفتر تبارنامه خزری'), sub: 1, twins: 'block', et: false, ai: false, minAge: 0, docs: 4, count: 5230 },
];
export interface FieldDef { key: string; label: L; type: L; vis: 'public' | 'restricted' | 'private'; required: boolean; filter: boolean; search: boolean; core: boolean }
export const FIELDS: FieldDef[] = [
  { key: 'name', label: L('Name (current & birth)', 'نام (فعلی و هنگام تولد)'), type: L('Text · bilingual', 'متن · دوزبانه'), vis: 'public', required: true, filter: false, search: true, core: true },
  { key: 'microchip', label: L('Microchip number', 'شماره میکروچیپ'), type: L('Identifier · 15 digits', 'شناسه · ۱۵ رقم'), vis: 'public', required: true, filter: false, search: true, core: true },
  { key: 'passport', label: L('Passport number', 'شماره پاسپورت'), type: L('Identifier', 'شناسه'), vis: 'public', required: true, filter: false, search: true, core: true },
  { key: 'studbook', label: L('Studbook number', 'شماره دفتر تبارنامه'), type: L('Identifier · per studbook', 'شناسه · هر دفتر'), vis: 'public', required: true, filter: false, search: true, core: true },
  { key: 'breed', label: L('Breed & sub-breed', 'نژاد و زیرنژاد'), type: L('Choice · from catalogue', 'انتخاب · از فهرست'), vis: 'public', required: true, filter: true, search: false, core: true },
  { key: 'colour', label: L('Colour & markings', 'رنگ و علائم'), type: L('Choice + free text', 'انتخاب + متن'), vis: 'public', required: true, filter: true, search: false, core: true },
  { key: 'height', label: L('Height at withers', 'قد'), type: L('Number · cm', 'عدد · سانتی‌متر'), vis: 'public', required: false, filter: true, search: false, core: false },
  { key: 'health', label: L('Health records', 'سوابق سلامت'), type: L('Structured · confidential', 'ساختاریافته · محرمانه'), vis: 'private', required: false, filter: false, search: false, core: true },
  { key: 'dna', label: L('DNA & genetic tests', 'DNA و آزمایش‌های ژنتیکی'), type: L('Structured · lab-entered', 'ساختاریافته · ثبت آزمایشگاه'), vis: 'restricted', required: false, filter: true, search: false, core: true },
  { key: 'temperament', label: L('Temperament (custom)', 'خلق‌وخو (سفارشی)'), type: L('Choice', 'انتخاب'), vis: 'public', required: false, filter: true, search: false, core: false },
];

/* ================= national reports ================= */
export const PROVINCES: { n: L; horses: number; quality: number; official: number; foals: number }[] = [
  { n: L('Tehran', 'تهران'), horses: 9120, quality: 91, official: 78, foals: 840 },
  { n: L('Isfahan', 'اصفهان'), horses: 5310, quality: 88, official: 72, foals: 490 },
  { n: L('Fars', 'فارس'), horses: 6240, quality: 84, official: 66, foals: 610 },
  { n: L('Golestan', 'گلستان'), horses: 5020, quality: 79, official: 58, foals: 570 },
  { n: L('Khorasan Razavi', 'خراسان رضوی'), horses: 4380, quality: 74, official: 52, foals: 402 },
  { n: L('Khuzestan', 'خوزستان'), horses: 3910, quality: 76, official: 55, foals: 388 },
  { n: L('Kurdistan', 'کردستان'), horses: 3150, quality: 63, official: 41, foals: 301 },
  { n: L('East Azerbaijan', 'آذربایجان شرقی'), horses: 2870, quality: 69, official: 46, foals: 244 },
  { n: L('Mazandaran', 'مازندران'), horses: 2610, quality: 72, official: 49, foals: 233 },
  { n: L('Kerman', 'کرمان'), horses: 2480, quality: 66, official: 43, foals: 211 },
];
export const FOALS_YEAR = [[2018, 3120], [2019, 3340], [2020, 2980], [2021, 3510], [2022, 3890], [2023, 4210], [2024, 4660], [2025, 1310]] as const;
export const AGE_BUCKETS: { l: L; m: number; f: number }[] = [
  { l: L('0–3', '۰–۳'), m: 3120, f: 3260 }, { l: L('4–7', '۴–۷'), m: 5410, f: 7820 }, { l: L('8–12', '۸–۱۲'), m: 4980, f: 8250 }, { l: L('13–18', '۱۳–۱۸'), m: 3020, f: 5440 }, { l: L('19+', '۱۹+'), m: 2290, f: 3640 },
];
export const DIVERSITY: { breed: L; ne: number; f: number; kin: number; trend: number; risk: 'ok' | 'watch' | 'critical'; coverage: number }[] = [
  { breed: L('Persian Arabian', 'عرب ایرانی'), ne: 410, f: 2.1, kin: 1.8, trend: -0.1, risk: 'ok', coverage: 71 },
  { breed: L('Turkoman', 'ترکمن'), ne: 220, f: 3.4, kin: 2.9, trend: 0.2, risk: 'ok', coverage: 64 },
  { breed: L('Darashouri', 'داراشوری'), ne: 160, f: 4.7, kin: 4.1, trend: 0.4, risk: 'watch', coverage: 58 },
  { breed: L('Kurdish', 'کُرد'), ne: 95, f: 5.9, kin: 5.2, trend: 0.6, risk: 'watch', coverage: 49 },
  { breed: L('Caspian', 'خزری'), ne: 48, f: 8.6, kin: 7.9, trend: 1.1, risk: 'critical', coverage: 62 },
];
