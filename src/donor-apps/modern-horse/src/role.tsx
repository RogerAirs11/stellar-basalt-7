import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { L } from './i18n';

export type RoleKey = 'public' | 'owner' | 'breeder' | 'rider' | 'vet' | 'lab' | 'organizer' | 'federation' | 'ministry' | 'admin';
export type Cap = 'register' | 'verify' | 'admin' | 'health' | 'dna' | 'results' | 'sell' | 'reports' | 'import';

export interface RoleDef { key: RoleKey; label: L; does: L; access: L; caps: Cap[]; person: L; title: L; dot: string }

/** Roles & access levels follow the proposal's user-group table. */
export const ROLES: RoleDef[] = [
  { key: 'federation', label: L('Federation / registry authority', 'فدراسیون / مرجع ثبت'), does: L('Review requests, confirm identity & passport, resolve conflicts, manage rules', 'بررسی درخواست‌ها، تأیید هویت و پاسپورت، رفع تعارض، مدیریت قواعد'), access: L('Administrative access by role and jurisdiction', 'دسترسی اداری بر اساس نقش و حوزه اختیار'), caps: ['register', 'verify', 'admin', 'health', 'import', 'reports', 'results'], person: L('Ali Rezaei', 'علی رضایی'), title: L('Registry officer', 'کارشناس ثبت'), dot: 'bg-violet-500' },
  { key: 'admin', label: L('System administrator', 'مدیر سیستم'), does: L('Manage users, rules, catalogues, integrations and audit', 'مدیریت کاربران، قواعد، فهرست‌ها، اتصال‌ها و ممیزی'), access: L('Full system access; every action audited', 'دسترسی کامل؛ همه اقدامات ممیزی می‌شود'), caps: ['register', 'verify', 'admin', 'health', 'dna', 'results', 'sell', 'reports', 'import'], person: L('Sara Kamali', 'سارا کمالی'), title: L('System administrator', 'مدیر سیستم'), dot: 'bg-violet-700' },
  { key: 'owner', label: L('Horse owner / legal representative', 'مالک / نماینده قانونی'), does: L('Register horses, upload passports, request corrections, manage transfers and documents', 'ثبت اسب، بارگذاری پاسپورت، درخواست اصلاح، مدیریت انتقال مالکیت و اسناد'), access: L('Own horses; private records only for authorised people', 'اسب‌های خود؛ سوابق خصوصی فقط برای افراد مجاز'), caps: ['register', 'sell', 'health'], person: L('Farah Equestrian Co.', 'شرکت سوارکاری فرح'), title: L('Owner', 'مالک'), dot: 'bg-sky-500' },
  { key: 'breeder', label: L('Producer / breeder', 'تولیدکننده / پرورش‌دهنده'), does: L('Record coverings, foalings and offspring; analyse matings', 'ثبت جفت‌گیری، زایش، کره‌ها و تحلیل آمیزش'), access: L('Data on own and authorised mares/stallions', 'داده‌های اسب‌های خود و اسب‌های مجاز'), caps: ['register', 'sell', 'health'], person: L('Tehran Stud Farm', 'اصطبل پرورش تهران'), title: L('Breeder', 'پرورش‌دهنده'), dot: 'bg-fuchsia-500' },
  { key: 'rider', label: L('Rider / trainer', 'سوارکار / مربی'), does: L('Professional profile, results, horses in training', 'پروفایل حرفه‌ای، سوابق مسابقه، اسب‌های تحت تمرین'), access: L('Public records and what they are allowed to manage', 'سوابق عمومی و اطلاعات مجاز'), caps: [], person: L('Sara Rahimi', 'سارا رحیمی'), title: L('Rider', 'سوارکار'), dot: 'bg-indigo-500' },
  { key: 'vet', label: L('Veterinarian', 'دامپزشک'), does: L('Enter vaccinations, exams, treatments and confirm documents', 'ثبت واکسن، معاینه، درمان و تأیید اسناد'), access: L('Authenticated; health access by licence', 'احراز هویت؛ دسترسی سلامت بر مبنای مجوز'), caps: ['health'], person: L('Dr. Mehdi Karimi', 'دکتر مهدی کریمی'), title: L('Veterinarian', 'دامپزشک'), dot: 'bg-emerald-500' },
  { key: 'lab', label: L('Genetics laboratory', 'آزمایشگاه ژنتیک'), does: L('Enter DNA reports: panel, sample, method, result, date', 'ثبت گزارش DNA: پنل، نمونه، روش، نتیجه، تاریخ'), access: L('Enter / confirm lab results only — no unrestricted data access', 'ورود/تأیید نتایج آزمایشگاهی؛ بدون دسترسی نامحدود'), caps: ['dna'], person: L('National Equine Genetics Lab', 'آزمایشگاه ملی ژنتیک اسب'), title: L('Laboratory', 'آزمایشگاه'), dot: 'bg-fuchsia-600' },
  { key: 'organizer', label: L('Club / event organiser', 'باشگاه / برگزارکننده'), does: L('Create events, manage entries, enter and confirm results', 'ثبت رویداد، ورود شرکت‌کنندگان، نتایج و تأیید داوری'), access: L('Data for own events and permitted records', 'داده‌های رویداد خود و سوابق مجاز'), caps: ['results', 'import'], person: L('Azadi Equestrian Club', 'باشگاه سوارکاری آزادی'), title: L('Organiser', 'برگزارکننده'), dot: 'bg-amber-500' },
  { key: 'ministry', label: L('Ministry of Agriculture / veterinary authority', 'وزارت جهاد کشاورزی / مرجع دامپزشکی'), does: L('Statutory data and reports within agreed limits', 'داده‌ها و گزارش‌های قانونی در حدود توافق و مجوز'), access: L('Limited institutional access, fully logged', 'دسترسی نهادی محدود و ثبت‌شده'), caps: ['reports', 'health'], person: L('Veterinary Organisation', 'سازمان دامپزشکی'), title: L('Institution', 'نهاد'), dot: 'bg-teal-600' },
  { key: 'public', label: L('Buyer / general public', 'خریدار / عموم'), does: L('Search, public profile, pedigree and publishable verified records', 'جست‌وجو، پروفایل عمومی، شجره و سوابق تأییدشده قابل انتشار'), access: L('Public information only — no personal or confidential medical data', 'فقط اطلاعات عمومی؛ بدون اطلاعات شخصی یا پزشکی محرمانه'), caps: [], person: L('Guest visitor', 'بازدیدکننده'), title: L('Public', 'عمومی'), dot: 'bg-slate-400' },
];

interface Ctx { role: RoleKey; def: RoleDef; setRole: (r: RoleKey) => void; can: (c: Cap) => boolean }
const C = createContext<Ctx | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setR] = useState<RoleKey>(() => (localStorage.getItem('role') as RoleKey) || 'federation');
  const v = useMemo<Ctx>(() => {
    const def = ROLES.find((r) => r.key === role) || ROLES[0];
    return { role, def, setRole: (r) => { localStorage.setItem('role', r); setR(r); }, can: (c) => def.caps.includes(c) };
  }, [role]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

export function useRole() {
  const c = useContext(C);
  if (!c) throw new Error('RoleProvider missing');
  return c;
}
