import { useEffect, useState } from 'react';
import { HORSES, horseById } from './data';
import { L } from './i18n';
import { idsOf, lev, norm, TODAY } from './records';

export type Sev = 'block' | 'warn' | 'info' | 'off';
export interface Rule { id: string; name: L; desc: L; sev: Sev; scope: L; version: number; updated: string; hits: number; history: { v: number; date: string; by: L; note: L }[] }

const h0 = (note: L, date = '2024-09-01') => [{ v: 1, date, by: L('System administrator', 'مدیر سیستم'), note }];
const INIT: Rule[] = [
  { id: 'dup-ids', name: L('Duplicate identifiers', 'شناسه تکراری'), desc: L('Exact match on microchip, passport number or registry number → block final registration and open a review case.', 'تطبیق دقیق میکروچیپ، پاسپورت یا شماره ثبت ← جلوگیری از ثبت قطعی و ایجاد پرونده بررسی.'), sev: 'block', scope: L('All breeds & studbooks', 'همه نژادها و دفاتر'), version: 3, updated: '2025-02-11', hits: 14, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'dup-probable', name: L('Probable duplicate horse', 'احتمال اسب تکراری'), desc: L('Compare similar names, birth date, sex, breed, parents, photos and location. Warn — never delete automatically.', 'مقایسه نام مشابه، تاریخ تولد، جنس، نژاد، والدین، عکس و محل. هشدار؛ هرگز حذف خودکار.'), sev: 'warn', scope: L('All breeds & studbooks', 'همه نژادها و دفاتر'), version: 2, updated: '2025-01-20', hits: 83, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'parent-invalid', name: L('Invalid or inconsistent parent', 'والد نامعتبر یا ناسازگار'), desc: L('Parent wrong sex, impossible birth dates (sire/dam too young, born after foal) or DNA-incompatible.', 'جنس نادرست والد، تاریخ تولد ناممکن (والد خیلی جوان یا متولد پس از کره) یا ناسازگاری DNA.'), sev: 'block', scope: L('All breeds & studbooks', 'همه نژادها و دفاتر'), version: 2, updated: '2025-03-02', hits: 41, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'parent-unregistered', name: L('Unregistered parent', 'والد ثبت‌نشده'), desc: L('Parent not in the registry: allowed, but the pedigree link stays unverified and is shown as incomplete.', 'والد در ثبت ملی نیست: مجاز است، اما پیوند شجره تأیید‌نشده و ناقص نمایش داده می‌شود.'), sev: 'info', scope: L('All breeds & studbooks', 'همه نژادها و دفاتر'), version: 1, updated: '2024-09-01', hits: 212, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'dates', name: L('Illogical dates', 'تاریخ‌های غیرمنطقی'), desc: L('Foaling before covering, impossible parent age, death before an event, birth in the future.', 'زایش پیش از جفت‌گیری، سن ناممکن والد، مرگ پیش از رویداد، تولد در آینده.'), sev: 'block', scope: L('All', 'همه'), version: 1, updated: '2024-09-01', hits: 9, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'twins', name: L('Twin births', 'دوقلوزایی'), desc: L('Configurable per breed and regulation. Twins alone are not automatically a violation in every breed.', 'قابل تنظیم برای هر نژاد و مقررات؛ دوقلو بودن به‌تنهایی همیشه تخلف نیست.'), sev: 'warn', scope: L('Per breed (Thoroughbred: strict · Arabian: review)', 'برای هر نژاد'), version: 4, updated: '2025-03-18', hits: 5, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'embryo', name: L('Embryo transfer', 'انتقال جنین'), desc: L('Record genetic dam, recipient mare and documents separately; permission depends on studbook / breed rules.', 'ثبت جداگانه مادر ژنتیکی، مادیان گیرنده و مستندات؛ مجاز بودن بر اساس دفتر تبارنامه/نژاد.'), sev: 'warn', scope: L('Per studbook', 'برای هر دفتر تبارنامه'), version: 2, updated: '2025-02-02', hits: 27, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'colour-genetics', name: L('Colour inconsistent with parents', 'رنگ ناسازگار با والدین'), desc: L('E.g. a grey foal requires at least one grey parent. Warns when registered parents cannot produce the colour.', 'مثلاً کره خاکستری نیازمند حداقل یک والد خاکستری است. هشدار اگر والدین نتوانند آن رنگ را بدهند.'), sev: 'warn', scope: L('All', 'همه'), version: 1, updated: '2024-11-14', hits: 19, history: h0(L('Initial rule', 'قاعده اولیه'), '2024-11-14') },
  { id: 'colour', name: L('Colour & markings mismatch', 'اختلاف رنگ و علائم'), desc: L('Large difference between registered colour, photo and earlier records; final decision by an expert.', 'اختلاف شدید بین رنگ ثبت‌شده، عکس و سوابق قبلی؛ تصمیم نهایی با کارشناس.'), sev: 'warn', scope: L('All', 'همه'), version: 1, updated: '2024-09-01', hits: 33, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'deceased', name: L('Deceased record', 'رکورد فوت‌شده'), desc: L('Block future events on a deceased horse until the status is officially corrected.', 'جلوگیری از ثبت رویدادهای آینده برای اسب فوت‌شده تا اصلاح رسمی وضعیت.'), sev: 'block', scope: L('All', 'همه'), version: 1, updated: '2024-09-01', hits: 3, history: h0(L('Initial rule', 'قاعده اولیه')) },
  { id: 'multi-source', name: L('Multi-source conflict', 'تعارض چند منبع'), desc: L('Keep every value with its source; open a review item and record the final decision and reason.', 'حفظ همه مقادیر و منبع؛ ایجاد صف بررسی و ثبت تصمیم نهایی و دلیل.'), sev: 'warn', scope: L('All sources', 'همه منابع'), version: 2, updated: '2025-01-09', hits: 58, history: h0(L('Initial rule', 'قاعده اولیه')) },
];

let state: Rule[] = INIT.map((r) => ({ ...r }));
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const getRules = () => state;
export function updateRule(id: string, patch: Partial<Rule>, note?: L) {
  state = state.map((r) => (r.id === id ? { ...r, ...patch, version: r.version + 1, updated: TODAY, history: [{ v: r.version + 1, date: TODAY, by: L('Registry officer', 'کارشناس ثبت'), note: note ?? L('Rule updated', 'قاعده به‌روز شد') }, ...r.history] } : r));
  emit();
}
export function addRule(r: Rule) { state = [r, ...state]; emit(); }
export function useRules() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return state;
}

export interface Draft { name: string; nameFa: string; birth: string; birthEnd: string; sex: string; breed: string; colour: string; chip: string; passport: string; regNo: string; sire: string; dam: string; twin: boolean; embryo: boolean; recipient: string; status: string; deathDate: string }
export interface Check { id: string; sev: 'block' | 'warn' | 'info' | 'pass'; title: L; detail?: L }

export function runChecks(d: Draft, rules: Rule[]): Check[] {
  const out: Check[] = [];
  const by = (id: string) => rules.find((r) => r.id === id);
  const add = (id: string, hit: boolean, detail?: L, passDetail?: L) => {
    const r = by(id);
    if (!r || r.sev === 'off') return;
    out.push({ id, sev: hit ? r.sev : 'pass', title: r.name, detail: hit ? detail : passDetail });
  };
  const n1 = norm(d.name), n2 = norm(d.nameFa);
  const idHit = HORSES.find((h) => { const i = idsOf(h); return (d.chip && i.chip === d.chip) || (d.passport && i.passport.toLowerCase() === d.passport.trim().toLowerCase()) || (d.regNo && h.regId.toLowerCase() === d.regNo.trim().toLowerCase()); });
  add('dup-ids', !!idHit, idHit && L(`An identifier is already assigned to ${idHit.name.en} (${idHit.regId}). Final registration is blocked; a review case will be opened.`, `یکی از شناسه‌ها قبلاً به ${idHit.name.fa} (${idHit.regId}) اختصاص یافته است. ثبت قطعی مسدود و پرونده بررسی ایجاد می‌شود.`), L('No identifier collisions found', 'تداخلی در شناسه‌ها یافت نشد'));
  const sim = n1.length > 2 || n2.length > 2 ? HORSES.filter((h) => ((n1.length > 2 && (norm(h.name.en) === n1 || lev(norm(h.name.en), n1) <= 1)) || (n2.length > 2 && norm(h.name.fa) === n2)) && (!d.birth || h.birth.slice(0, 4) === d.birth.slice(0, 4) || norm(h.name.en) === n1)).slice(0, 3) : [];
  add('dup-probable', sim.length > 0, L(`Similar record(s): ${sim.map((h) => `${h.name.en} (${h.regId})`).join(', ')}. Please review before submission.`, `رکورد(های) مشابه: ${sim.map((h) => `${h.name.fa} (${h.regId})`).join('، ')}. لطفاً پیش از ارسال بررسی کنید.`), L('No similar horses found', 'اسب مشابهی یافت نشد'));

  const fy = d.birth ? +d.birth.slice(0, 4) : 0;
  const sh = d.sire && d.sire !== 'unregistered' ? horseById(d.sire) : undefined;
  const dh = d.dam && d.dam !== 'unregistered' ? horseById(d.dam) : undefined;
  const probs: { en: string; fa: string }[] = [];
  if (sh && sh.gender !== 'stallion') probs.push({ en: `${sh.name.en} is not a stallion`, fa: `${sh.name.fa} اسب نر نیست` });
  if (dh && dh.gender !== 'mare') probs.push({ en: `${dh.name.en} is not a mare`, fa: `${dh.name.fa} مادیان نیست` });
  if (fy && sh && +sh.birth.slice(0, 4) > fy - 2) probs.push({ en: `Sire ${sh.name.en} (b. ${sh.birth.slice(0, 4)}) is too young to have sired a ${fy} foal`, fa: `پدر ${sh.name.fa} (${sh.birth.slice(0, 4)}) برای کره ${fy} بسیار جوان است` });
  if (fy && dh && +dh.birth.slice(0, 4) > fy - 3) probs.push({ en: `Dam ${dh.name.en} (b. ${dh.birth.slice(0, 4)}) is under 3 years at foaling`, fa: `مادر ${dh.name.fa} (${dh.birth.slice(0, 4)}) هنگام زایش زیر ۳ سال است` });
  add('parent-invalid', probs.length > 0, L(probs.map((p) => p.en).join('; '), probs.map((p) => p.fa).join('؛ ')), L('Parent sex and ages are consistent', 'جنس و سن والدین سازگار است'));
  const unreg = d.sire === 'unregistered' || d.dam === 'unregistered' || !d.sire || !d.dam;
  add('parent-unregistered', unreg, L('A parent is not in the registry — the pedigree link will remain unverified.', 'یکی از والدین در ثبت ملی نیست؛ پیوند شجره تأیید‌نشده می‌ماند.'), L('Both parents are registered', 'هر دو والد ثبت شده‌اند'));

  const dateProbs: { en: string; fa: string }[] = [];
  if (d.birth && d.birth > TODAY) dateProbs.push({ en: 'Birth date is in the future', fa: 'تاریخ تولد در آینده است' });
  if (d.status === 'deceased' && d.deathDate && d.birth && d.deathDate < d.birth) dateProbs.push({ en: 'Death date is before birth date', fa: 'تاریخ فوت پیش از تولد است' });
  if (d.birthEnd && d.birth && d.birthEnd < d.birth) dateProbs.push({ en: 'Estimated range ends before it starts', fa: 'پایان بازه تخمینی پیش از آغاز آن است' });
  add('dates', dateProbs.length > 0, L(dateProbs.map((p) => p.en).join('; '), dateProbs.map((p) => p.fa).join('؛ ')), L('Dates are in a logical order', 'تاریخ‌ها منطقی هستند'));
  add('twins', d.twin, L('Twin birth declared — checked against the rules of this breed; not automatically a violation.', 'دوقلوزایی اعلام شده؛ مطابق مقررات این نژاد بررسی می‌شود و لزوماً تخلف نیست.'), L('Single birth', 'تک‌زایی'));
  add('embryo', d.embryo, d.recipient ? L('Embryo transfer: genetic dam and recipient mare recorded; supporting documents required.', 'انتقال جنین: مادر ژنتیکی و مادیان گیرنده ثبت شد؛ مستندات لازم است.') : L('Embryo transfer declared but no recipient mare recorded.', 'انتقال جنین اعلام شده اما مادیان گیرنده ثبت نشده است.'), L('Natural or AI foaling', 'زایش طبیعی یا تلقیح'));
  add('colour-genetics', d.colour === 'grey' && !!sh && !!dh && sh.colour !== 'grey' && dh.colour !== 'grey', L('A grey foal needs at least one grey parent, but neither registered parent is grey.', 'کره خاکستری حداقل یک والد خاکستری لازم دارد اما هیچ‌یک از والدین ثبت‌شده خاکستری نیست.'), L('Colour is plausible for the registered parents', 'رنگ برای والدین ثبت‌شده محتمل است'));
  add('deceased', d.status === 'deceased', L('Deceased record: future events (entries, covering, sale) will be blocked.', 'رکورد فوت‌شده: رویدادهای آینده (ثبت‌نام، جفت‌گیری، فروش) مسدود می‌شود.'), L('Horse is alive', 'اسب زنده است'));
  return out;
}
