import { useSyncExternalStore } from 'react';
import { HORSES, hash, horseById, type Horse } from './data';
import { L } from './i18n';
import { addDays, documentsOf, testsOf, TODAY } from './records';
import { useRole } from './role';

/* ------------------------------------------------------------------ tiny external store */
function createStore<T>(init: T) {
  let s = init;
  const subs = new Set<() => void>();
  return {
    get: () => s,
    set: (f: (x: T) => T) => { s = f(s); subs.forEach((x) => x()); },
    sub: (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}
const useStore = <T,>(st: ReturnType<typeof createStore<T>>) => useSyncExternalStore(st.sub, st.get);

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits are normalised in every numeric field */
export const asciiDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/* ================================================================== DATA-QUALITY QUEUE */
export type Sev = 'high' | 'medium' | 'info';
export type QStatus = 'open' | 'assigned' | 'resolved';
export interface QEvent { kind: 'detected' | 'assigned' | 'resolved' | 'reopened' | 'note'; by: string; at: string; note?: string }
export interface QIssue { id: string; code: string; sev: Sev; status: QStatus; horse: string; detail: L; source: string; rule: string; assignee?: string; events: QEvent[] }

export const QCODES: Record<string, { l: L; sev: Sev; lowRisk: boolean; rule: string }> = {
  SIRE_FEMALE: { l: L('Sire recorded female', 'پدر ثبت‌شده ماده است'), sev: 'high', lowRisk: false, rule: 'sex-role v3' },
  DAM_MALE: { l: L('Dam recorded male', 'مادر ثبت‌شده نر است'), sev: 'high', lowRisk: false, rule: 'sex-role v3' },
  REGISTER_NO_DUP: { l: L('Duplicate register number', 'شماره ثبت تکراری'), sev: 'high', lowRisk: false, rule: 'identifier-dup v2' },
  PARENT_BOTH_SIDES: { l: L('Same horse is sire and dam', 'یک اسب هم پدر و هم مادر است'), sev: 'high', lowRisk: false, rule: 'pedigree-cycle v1' },
  BIRTH_DATE_CONTRADICTION: { l: L('Birth dates contradict', 'تاریخ‌های تولد متناقض'), sev: 'medium', lowRisk: false, rule: 'dates v2' },
  PARENT_BIRTH_YEAR: { l: L('Parent born after foal', 'والد پس از کره متولد شده'), sev: 'medium', lowRisk: false, rule: 'dates v2' },
  NAME_NORMALISED: { l: L('Name needs normalising', 'نام نیازمند یکسان‌سازی'), sev: 'info', lowRisk: true, rule: 'names v1' },
  DIGITS_NORMALISED: { l: L('Digits to normalise', 'ارقام نیازمند یکسان‌سازی'), sev: 'info', lowRisk: true, rule: 'digits v1' },
  MISSING_PHOTO_CREDIT: { l: L('Photo credit missing', 'اعتبار عکس ثبت نشده'), sev: 'info', lowRisk: true, rule: 'media v1' },
  ALIAS_UNSOURCED: { l: L('Alias without a source', 'نام مستعار بدون منبع'), sev: 'info', lowRisk: false, rule: 'aliases v1' },
};
const detailOf = (code: string, h: Horse): L => {
  const m: Record<string, L> = {
    SIRE_FEMALE: L(`The sire recorded for ${h.name.en} is a female horse.`, `پدر ثبت‌شده برای ${h.name.fa} یک اسب ماده است.`),
    DAM_MALE: L(`The dam recorded for ${h.name.en} is a male horse.`, `مادر ثبت‌شده برای ${h.name.fa} یک اسب نر است.`),
    REGISTER_NO_DUP: L(`${h.name.en} shares a register number with another record.`, `${h.name.fa} شماره ثبت مشترکی با رکورد دیگر دارد.`),
    PARENT_BOTH_SIDES: L(`A parent of ${h.name.en} appears on both sides of the pedigree.`, `یکی از والدین ${h.name.fa} در هر دو سمت شجره دیده می‌شود.`),
    BIRTH_DATE_CONTRADICTION: L(`Two sources give different birth dates for ${h.name.en}.`, `دو منبع برای ${h.name.fa} تاریخ تولد متفاوتی دارند.`),
    PARENT_BIRTH_YEAR: L(`A parent of ${h.name.en} has a birth year later than the foal.`, `سال تولد یکی از والدین ${h.name.fa} پس از خود اسب است.`),
    NAME_NORMALISED: L(`The name of ${h.name.en} mixes Arabic and Persian letter forms.`, `نام ${h.name.fa} شکل‌های حروف عربی و فارسی را ترکیب کرده است.`),
    DIGITS_NORMALISED: L(`An identifier of ${h.name.en} was entered with Persian digits.`, `یک شناسه از ${h.name.fa} با ارقام فارسی وارد شده است.`),
    MISSING_PHOTO_CREDIT: L(`The profile photo of ${h.name.en} has no visible credit.`, `عکس نمایه ${h.name.fa} اعتبار نمایان ندارد.`),
    ALIAS_UNSOURCED: L(`An alias of ${h.name.en} has no recorded source.`, `یک نام مستعار ${h.name.fa} منبع ثبت‌شده ندارد.`),
  };
  return m[code];
};
export const ASSIGNEES = ['Ali Rezaei', 'Mina Karimi', 'Reza Najafi', 'Sara Kamali'];
const CODE_KEYS = Object.keys(QCODES);
const WEIGHTED = ['SIRE_FEMALE', 'SIRE_FEMALE', 'DAM_MALE', 'DAM_MALE', 'REGISTER_NO_DUP', 'PARENT_BOTH_SIDES', 'BIRTH_DATE_CONTRADICTION', 'BIRTH_DATE_CONTRADICTION', 'PARENT_BIRTH_YEAR', 'PARENT_BIRTH_YEAR', 'PARENT_BIRTH_YEAR', 'NAME_NORMALISED', 'NAME_NORMALISED', 'DIGITS_NORMALISED', 'DIGITS_NORMALISED', 'MISSING_PHOTO_CREDIT', 'MISSING_PHOTO_CREDIT', 'ALIAS_UNSOURCED'];
const seedIssue = (k: number): QIssue => {
  const code = WEIGHTED[hash('qc' + k) % WEIGHTED.length];
  const h = HORSES[hash('qh' + k) % HORSES.length];
  const r = hash('qs' + k) % 100;
  const status: QStatus = r < 64 ? 'open' : r < 80 ? 'assigned' : 'resolved';
  const who = ASSIGNEES[hash('qa' + k) % ASSIGNEES.length];
  const day = String(2 + (hash('qd' + k) % 12)).padStart(2, '0');
  const at = `2025-04-${day} 08:${String(10 + (k % 40))}`;
  const events: QEvent[] = [{ kind: 'detected', by: 'corpus-scan', at, note: QCODES[code].rule }];
  if (status !== 'open') events.push({ kind: 'assigned', by: 'Ali Rezaei', at: `2025-04-${day} 11:05`, note: who });
  if (status === 'resolved') events.push({ kind: 'resolved', by: who, at: `2025-04-${String(+day + 1).padStart(2, '0')} 09:30`, note: code.endsWith('FEMALE') || code.endsWith('MALE') ? 'Parent corrected after studbook check' : 'Normalised and confirmed' });
  return { id: `DQ-${1000 + k}`, code, sev: QCODES[code].sev, status, horse: h.id, detail: detailOf(code, h), source: 'corpus-scan', rule: QCODES[code].rule, assignee: status === 'open' ? undefined : who, events };
};
const qStore = createStore<QIssue[]>(Array.from({ length: 64 }, (_, k) => seedIssue(k)));
let scanned = false;
export const useQuality = () => useStore(qStore);
const stamp = () => `${TODAY} 10:42`;
const patchIssue = (id: string, f: (i: QIssue) => QIssue) => qStore.set((a) => a.map((i) => (i.id === id ? f(i) : i)));
export const quality = {
  assign(id: string, who: string) {
    if (!who) return { ok: false as const, err: 'assignee_required' };
    patchIssue(id, (i) => ({ ...i, status: i.status === 'resolved' ? i.status : 'assigned', assignee: who, events: [...i.events, { kind: 'assigned', by: 'You', at: stamp(), note: who }] }));
    return { ok: true as const };
  },
  resolve(id: string, note: string) {
    if (note.trim().length < 3) return { ok: false as const, err: 'note_required' };
    patchIssue(id, (i) => ({ ...i, status: 'resolved', events: [...i.events, { kind: 'resolved', by: 'You', at: stamp(), note: note.trim() }] }));
    return { ok: true as const };
  },
  reopen(id: string) {
    patchIssue(id, (i) => ({ ...i, status: i.assignee ? 'assigned' : 'open', events: [...i.events, { kind: 'reopened', by: 'You', at: stamp() }] }));
  },
  note(id: string, text: string) {
    if (!text.trim()) return { ok: false as const };
    patchIssue(id, (i) => ({ ...i, events: [...i.events, { kind: 'note', by: 'You', at: stamp(), note: text.trim() }] }));
    return { ok: true as const };
  },
  /** low-risk only: explicit code allowlist AND severity 'info'. One high-risk row refuses the whole batch. */
  bulkResolve(ids: string[], note: string) {
    const rows = qStore.get().filter((i) => ids.includes(i.id));
    const blocked = rows.filter((i) => !(i.sev === 'info' && QCODES[i.code]?.lowRisk));
    if (!rows.length) return { ok: false as const, refused: 0, err: 'empty' };
    if (blocked.length) return { ok: false as const, refused: blocked.length, err: 'high_risk' };
    if (note.trim().length < 3) return { ok: false as const, refused: 0, err: 'note_required' };
    qStore.set((a) => a.map((i) => (ids.includes(i.id) ? { ...i, status: 'resolved' as QStatus, events: [...i.events, { kind: 'resolved' as const, by: 'You', at: stamp(), note: note.trim() }] } : i)));
    return { ok: true as const, count: rows.length };
  },
  /** idempotent: per child-link dedupe, a re-run creates nothing new */
  scan() {
    const have = new Set(qStore.get().map((i) => `${i.code}:${i.horse}`));
    const found: QIssue[] = [];
    ['SIRE_FEMALE', 'DAM_MALE', 'REGISTER_NO_DUP', 'PARENT_BOTH_SIDES', 'BIRTH_DATE_CONTRADICTION', 'PARENT_BIRTH_YEAR'].forEach((code, k) => {
      const h = HORSES[120 + k * 3];
      if (have.has(`${code}:${h.id}`)) return;
      found.push({ id: `DQ-S${k + 1}`, code, sev: QCODES[code].sev, status: 'open', horse: h.id, detail: detailOf(code, h), source: 'corpus-scan', rule: QCODES[code].rule, events: [{ kind: 'detected', by: 'corpus-scan', at: stamp(), note: QCODES[code].rule }] });
    });
    if (found.length) qStore.set((a) => [...found, ...a]);
    scanned = true;
    return { created: found.length };
  },
};
export const scanDone = () => scanned;
export const qCodeKeys = CODE_KEYS;

/* ================================================================== PROFESSIONAL ACCESS GRANTS */
export const PERMS = ['private_health_read', 'clinical_write', 'sample_submit', 'evidence_review', 'official_attestation', 'private_file_export'] as const;
export type Perm = (typeof PERMS)[number];
export const PERM_L: Record<Perm, { l: L; d: L }> = {
  private_health_read: { l: L('Read private health results', 'خواندن نتایج سلامت خصوصی'), d: L('Results on this horse only', 'فقط نتایج همین اسب') },
  clinical_write: { l: L('Write clinical records', 'ثبت سوابق بالینی'), d: L('Add examinations and treatments', 'افزودن معاینه و درمان') },
  sample_submit: { l: L('Submit samples', 'ارسال نمونه'), d: L('Link a lab sample to the horse', 'اتصال نمونه آزمایشگاهی به اسب') },
  evidence_review: { l: L('Review evidence', 'بررسی مدارک'), d: L('Review uploaded evidence', 'بررسی مدارک بارگذاری‌شده') },
  official_attestation: { l: L('Official attestation', 'گواهی رسمی'), d: L('Inside an approved scope only', 'فقط در دامنه تأییدشده') },
  private_file_export: { l: L('Export private files', 'خروجی پرونده خصوصی'), d: L('Audited file export', 'خروجی ممیزی‌شده') },
};
export const PRO_KINDS = ['veterinarian', 'laboratory', 'farrier', 'physiotherapist', 'dentist', 'nutritionist', 'federation_official'] as const;
export type ProKind = (typeof PRO_KINDS)[number];
export const PRO_L: Record<ProKind, L> = {
  veterinarian: L('Veterinarian', 'دامپزشک'), laboratory: L('Laboratory', 'آزمایشگاه'), farrier: L('Farrier', 'نعل‌بند'), physiotherapist: L('Physiotherapist', 'فیزیوتراپیست'),
  dentist: L('Equine dentist', 'دندانپزشک اسب'), nutritionist: L('Nutritionist', 'متخصص تغذیه'), federation_official: L('Federation official', 'مسئول فدراسیون'),
};
export interface Grant { id: string; horse: string; kind: ProKind; grantee: L; perms: Perm[]; authority: string; assignment: string; from: string; to: string; revoked?: { at: string; reason: string } }
const VET = L('Dr. Mehdi Karimi', 'دکتر مهدی کریمی'), LAB = L('National Equine Genetics Lab', 'آزمایشگاه ملی ژنتیک اسب');
const gStore = createStore<Grant[]>([
  { id: 'G-301', horse: 'persian-star', kind: 'veterinarian', grantee: VET, perms: ['private_health_read', 'clinical_write'], authority: 'IVMO-4471', assignment: 'ASG-2025-118', from: '2025-01-10', to: '2026-01-10' },
  { id: 'G-302', horse: 'persian-star', kind: 'laboratory', grantee: LAB, perms: ['private_health_read', 'sample_submit', 'evidence_review'], authority: 'LAB-ACC-009', assignment: 'ASG-2025-119', from: '2025-02-01', to: '2025-12-31' },
  { id: 'G-303', horse: 'nika', kind: 'veterinarian', grantee: VET, perms: ['private_health_read'], authority: 'IVMO-4471', assignment: 'ASG-2025-077', from: '2025-03-01', to: '2025-09-01' },
  { id: 'G-304', horse: 'ramin', kind: 'farrier', grantee: L('Reza Mirzaei', 'رضا میرزایی'), perms: ['clinical_write'], authority: 'FAR-220', assignment: 'ASG-2025-090', from: '2025-02-10', to: '2025-08-10' },
  { id: 'G-305', horse: 'nika', kind: 'veterinarian', grantee: L('Dr. Leila Bagheri', 'دکتر لیلا باقری'), perms: ['private_health_read', 'private_file_export'], authority: 'IVMO-5120', assignment: 'ASG-2024-301', from: '2024-05-01', to: '2025-05-01', revoked: { at: '2025-02-20 09:12', reason: 'Care transferred to another clinic' } },
]);
export const useGrants = () => useStore(gStore);
export const grantActive = (g: Grant) => !g.revoked && g.from <= TODAY && g.to >= TODAY;
export const grants = {
  create(g: Omit<Grant, 'id'>) { gStore.set((a) => [{ ...g, id: `G-${400 + a.length}` }, ...a]); },
  /** effective on the very next request — nothing is cached */
  revoke(id: string, reason: string) { gStore.set((a) => a.map((g) => (g.id === id ? { ...g, revoked: { at: `${TODAY} 10:42`, reason } } : g))); },
};
export const defaultGrantDates = () => ({ from: TODAY, to: addDays(TODAY, 365) });

/** Who may read PRIVATE health results on a horse. A generic edit capability never implies it. */
export function useHealthAccess(horseId: string): { allowed: boolean; via: 'staff' | 'owner' | 'grant' | 'none'; grant?: Grant } {
  const { role, def } = useRole();
  const all = useGrants();
  if (role === 'federation' || role === 'admin' || role === 'ministry') return { allowed: true, via: 'staff' };
  if (role === 'owner' || role === 'breeder') return { allowed: true, via: 'owner' };
  if (role === 'vet' || role === 'lab') {
    const g = all.find((x) => x.horse === horseId && x.grantee.en === def.person.en && grantActive(x) && x.perms.includes('private_health_read'));
    return g ? { allowed: true, via: 'grant', grant: g } : { allowed: false, via: 'none' };
  }
  return { allowed: false, via: 'none' };
}

/* ================================================================== GENETIC PUBLICATION DECISIONS (append-only, versioned) */
export type Basis = 'owner_consent' | 'staff_publication' | 'official_basis';
export interface Decision { version: number; action: 'publish' | 'withdraw'; basis: Basis; purpose: string; evidence: string; actor: string; reason: string; at: string }
const dStore = createStore<Record<string, Decision[]>>({});
export const useDecisions = () => useStore(dStore);
const seeded = (key: string): Decision[] => {
  const [hid, tid] = key.split(':');
  const h = horseById(hid);
  const t = h ? testsOf(h).find((x) => x.id === tid) : undefined;
  if (!h || !t || t.status !== 'verified') return [];
  const r = hash(key) % 10;
  const pub: Decision = { version: 1, action: 'publish', basis: 'owner_consent', purpose: 'Sale listing', evidence: `CONS-${1000 + (hash(key) % 8000)}`, actor: h.owner.en, reason: 'Owner chose to publish', at: '2025-02-12 10:00' };
  if (r < 2) return [pub];
  if (r === 2) return [pub, { version: 2, action: 'withdraw', basis: 'owner_consent', purpose: 'Sale withdrawn', evidence: `CONS-${1000 + (hash(key) % 8000)}`, actor: h.owner.en, reason: 'Horse taken off the market', at: '2025-03-20 14:30' }];
  return [];
};
export const decisionsOf = (key: string): Decision[] => dStore.get()[key] ?? seeded(key);
export function effective(key: string): { state: 'private' | 'published' | 'withdrawn'; version: number } {
  const d = decisionsOf(key);
  if (!d.length) return { state: 'private', version: 0 };
  return { state: d[d.length - 1].action === 'publish' ? 'published' : 'withdrawn', version: d.length };
}
export const decide = {
  /** stale expectedVersion → 409; a repeat of the current state is a clean no-op */
  apply(key: string, expectedVersion: number, d: Omit<Decision, 'version' | 'at' | 'actor'>) {
    const cur = decisionsOf(key);
    if (cur.length !== expectedVersion) return { ok: false as const, code: 409, current: cur.length };
    const state = effective(key).state;
    if ((d.action === 'publish' && state === 'published') || (d.action === 'withdraw' && state !== 'published')) return { ok: true as const, noop: true as const, version: cur.length };
    const next: Decision = { ...d, version: cur.length + 1, actor: 'You', at: `${TODAY} 10:42` };
    dStore.set((s) => ({ ...s, [key]: [...cur, next] }));
    return { ok: true as const, noop: false as const, version: next.version };
  },
  /** demo helper: another reviewer changes the record behind your back */
  simulateOther(key: string) {
    const cur = decisionsOf(key);
    const action: Decision['action'] = effective(key).state === 'published' ? 'withdraw' : 'publish';
    dStore.set((s) => ({ ...s, [key]: [...cur, { version: cur.length + 1, action, basis: 'staff_publication', purpose: 'Registry review', evidence: 'REV-9921', actor: 'Another reviewer', reason: 'Changed in parallel', at: `${TODAY} 10:41` }] }));
  },
};

/* ================================================================== EVIDENCE SUMMARY + SEARCH FACETS */
export const hasPublicPhoto = (h: Horse) => hash(h.id + 'photo') % 10 !== 0;
/** platform-verified DOCUMENTS only — a verified photo can never satisfy this */
export const hasVerifiedDoc = (h: Horse) => documentsOf(h).some((d) => d.id !== 'photos' && (d.level === 'reviewed' || d.level === 'official' || d.level === 'dna'));
export const parentageKnown = (h: Horse) => !!((h.sireId || h.sire) && (h.damId || h.dam));
export function evidenceOf(h: Horse) {
  const s = hash(h.id + 'ev');
  const uploaded = hasPublicPhoto(h) ? 1 + (s % 4) : 0;
  const reviewed = uploaded ? Math.min(uploaded, h.verified.passport ? 1 + (s % uploaded) : 0) : 0;
  const tests = testsOf(h).filter((t) => t.kind !== 'parentage');
  return {
    photos: { uploaded, reviewed },
    attestations: { active: h.verified.federation ? 1 : 0, revoked: s % 13 === 0 ? 1 : 0, superseded: h.verified.federation && s % 7 === 0 ? 1 : 0 },
    genetics: { decided: tests.filter((t) => effective(`${h.id}:${t.id}`).state === 'published').length, total: tests.length },
    private: documentsOf(h).filter((d) => d.level !== 'missing').length,
  };
}

/* ================================================================== PLATFORM FACTS (as supplied by the owner, R145) */
export const PLATFORM = { app: '0.87.0', contract: '2.30.0', round: 'R145', date: '2026-10-28', migrations: 107, routes: 304, structures: 142, frontends: 5, tests: 1959 };
export const SNAPSHOT = {
  horses: 95639, active: 91498, inactive: 4141,
  ids: [['register', 74.85], ['microchip', 69.68], ['passport', 38.82]] as [string, number][],
  racing: { linked: 121799, total: 122063 },
  pedigree: [72.5, 62.1, 52.4, 44.0, 37.2, 31.9, 27.9],
  debt: [
    { k: 'sex', en: '106 sire-rows recorded female · 161 dam-rows recorded male', fa: '۱۰۶ ردیف پدر ثبت‌شده ماده · ۱۶۱ ردیف مادر ثبت‌شده نر' },
    { k: 'year', en: '4,628 parent-birth-year conflicts queued for triage', fa: '۴٬۶۲۸ تعارض سال تولد والدین در صف بررسی' },
    { k: 'stale', en: 'Analytics precompute stale at 93,896 — refresh pending', fa: 'پیش‌محاسبه آمار روی ۹۳٬۸۹۶ مانده — به‌روزرسانی در انتظار' },
  ],
};
export type Stab = 'core' | 'stable' | 'experimental' | 'reserved';
export type Access = 'public' | 'authenticated' | 'privileged';
export type Cover = 'live' | 'partial' | 'next';
export interface Cap { key: string; name: L; version: string; stab: Stab; access: Access; fe: Cover; inc?: 2 | 3 | 4; to?: string }
const C = (key: string, en: string, fa: string, version: string, stab: Stab, access: Access, fe: Cover, inc?: 2 | 3 | 4, to?: string): Cap => ({ key, name: L(en, fa), version, stab, access, fe, inc, to });
export const CAPS: Cap[] = [
  C('registry_search', 'Search & discovery', 'جستجو و کاوش', '2.4.0', 'core', 'public', 'live', undefined, '/horses'),
  C('horse_profile', 'Horse profiles', 'پروفایل اسب', '2.6.0', 'core', 'public', 'live', undefined, '/horses/nika'),
  C('registration', 'Registration workflow', 'روند ثبت', '1.5.0', 'stable', 'authenticated', 'live', undefined, '/horses/register'),
  C('duplicate_merge', 'Duplicate merge workbench', 'میز ادغام تکراری', '1.2.0', 'stable', 'privileged', 'partial', 2, '/admin/queue'),
  C('claims_changes', 'Owner claims & change requests', 'ادعای مالکیت و درخواست تغییر', '1.3.0', 'stable', 'authenticated', 'partial', 2, '/horses/nika/history'),
  C('import_staging', 'Import staging', 'مرحله‌بندی ورود داده', '1.4.0', 'stable', 'privileged', 'partial', undefined, '/admin/import'),
  C('pedigree', 'Pedigree & coefficients', 'شجره و ضرایب', '2.1.0', 'core', 'public', 'live', undefined, '/horses/nika/pedigree'),
  C('breeding_optimizer', 'Breeding optimizer', 'بهینه‌ساز جفت‌گیری', '1.3.0', 'experimental', 'public', 'live', undefined, '/breeding/matches'),
  C('pairing_evidence', 'Pairing evidence (disclosure-gated)', 'شواهد جفت‌گیری (وابسته به افشا)', '1.1.0', 'experimental', 'public', 'partial', 2, '/breeding'),
  C('genetic_assays', 'Genetic assays (CA, LFS, SCID, OAAM)', 'آزمون‌های ژنتیکی', '1.2.0', 'stable', 'public', 'live', undefined, '/horses/persian-star/genetics'),
  C('genetic_disclosure', 'Genetic publication decisions', 'تصمیم‌های انتشار ژنتیک', '1.0.0', 'stable', 'authenticated', 'live', undefined, '/horses/persian-star/genetics'),
  C('professional_grants', 'Professional access grants', 'مجوزهای دسترسی حرفه‌ای', '1.0.0', 'stable', 'authenticated', 'live', undefined, '/horses/persian-star/genetics'),
  C('competitions', 'Competitions & performance', 'مسابقات و عملکرد', '1.6.0', 'stable', 'public', 'live', undefined, '/sport'),
  C('racing', 'Racing dataset (read-only)', 'داده کورس (فقط‌خواندنی)', '1.0.0', 'stable', 'public', 'partial', 2, '/sport/sources'),
  C('marketplace', 'Marketplace & inquiries', 'بازار و پرس‌وجو', '1.8.0', 'stable', 'public', 'partial', 3, '/services/market'),
  C('commerce', 'Billing, orders & refunds', 'صورتحساب، سفارش و بازپرداخت', '1.2.0', 'experimental', 'authenticated', 'next', 3),
  C('workspaces', 'Workspaces & tasks', 'فضاهای کاری و وظایف', '1.1.0', 'stable', 'authenticated', 'next', 3),
  C('organizations', 'Organizations', 'سازمان‌ها', '1.4.0', 'stable', 'authenticated', 'partial', 3, '/people/orgs'),
  C('dossiers', 'Dossiers', 'پرونده‌های اشتراکی', '1.0.0', 'stable', 'authenticated', 'next', 3),
  C('issuers', 'Issuer registry', 'ثبت صادرکنندگان', '1.0.0', 'stable', 'privileged', 'next', 4),
  C('attestations', 'Attestations & credentials', 'گواهی‌ها و اعتبارنامه‌ها', '1.1.0', 'stable', 'public', 'partial', 4, '/horses/nika/history'),
  C('evidence_summary', 'Public evidence summary', 'خلاصه عمومی مدارک', '1.0.0', 'stable', 'public', 'live', undefined, '/horses/nika/history'),
  C('directory', 'People & organization directory', 'فهرست افراد و سازمان‌ها', '1.3.0', 'stable', 'public', 'live', undefined, '/people'),
  C('data_quality', 'Data-quality queue', 'صف کیفیت داده', '1.0.0', 'stable', 'privileged', 'live', undefined, '/admin/quality'),
  C('privacy', 'Privacy & redaction', 'حریم خصوصی و حذف', '1.2.0', 'stable', 'authenticated', 'partial', 4, '/horses/nika/documents'),
  C('moderation', 'Moderation & appeals', 'نظارت و تجدیدنظر', '1.1.0', 'stable', 'privileged', 'next', 3),
  C('service_requests', 'Service requests & blocks', 'درخواست خدمات و مسدودسازی', '1.2.0', 'stable', 'authenticated', 'next', 3),
  C('newsroom', 'Newsroom & editorial', 'اخبار و تحریریه', '1.4.0', 'stable', 'public', 'live', undefined, '/news'),
  C('ai_assistant', 'AI research assistant', 'دستیار پژوهشی هوشمند', '1.0.0', 'experimental', 'authenticated', 'next', 4),
  C('notifications', 'Notifications & preferences', 'اعلان‌ها و ترجیحات', '1.1.0', 'stable', 'authenticated', 'next', 4),
  C('media', 'Media & publication controls', 'رسانه و کنترل انتشار', '1.5.0', 'stable', 'public', 'partial', 4, '/horses/nika/documents'),
  C('verification', 'Verification (reserved)', 'تأیید (رزرو)', '0.1.0', 'reserved', 'privileged', 'next'),
  C('inspections', 'Inspections (reserved)', 'بازرسی (رزرو)', '0.1.0', 'reserved', 'privileged', 'next'),
  C('breed_standards', 'Breed standards (reserved)', 'استانداردهای نژاد (رزرو)', '0.1.0', 'reserved', 'public', 'next'),
  C('genomics', 'Genomics (reserved)', 'ژنومیکس (رزرو)', '0.1.0', 'reserved', 'privileged', 'next'),
];
export { horseById };
