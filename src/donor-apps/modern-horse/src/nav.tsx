import type { ReactNode } from 'react';
import {
  Baby, Building2, CalendarDays, ChartColumn, ClipboardPlus, Clock, Crown, Database, Dna, FileCheck2, FileText, FileUp, FlaskConical, GitBranch, HeartHandshake, Landmark, Layers,
  LayoutDashboard, LayoutGrid, ListChecks, Megaphone, Network, Newspaper, Scale, ScrollText, Search, ShieldCheck, Sparkles, Stethoscope, Store, Tractor, Trophy, UsersRound, Users, Workflow, ShieldAlert, type LucideIcon,
} from 'lucide-react';
import type { PhaseKey } from './theme';
import type { Cap } from './role';

export type GroupKey = Exclude<PhaseKey, 'home'>;
export interface NavLeaf { to: string; label: string; icon: ReactNode; need?: Cap }
export interface NavGroup { key: GroupKey; tag: string; label: string; icon: ReactNode; to: string; leaves: NavLeaf[] }
type Tx = (en: string, fa: string) => string;
const ic = (C: LucideIcon) => <C className="h-4 w-4" />;

export function getNav(tx: Tx): NavGroup[] {
  return [
    {
      key: 'registry', tag: tx('Phase 1', 'فاز ۱'), label: tx('Registry', 'ثبت و استعلام'), icon: ic(FileCheck2), to: '/horses',
      leaves: [
        { to: '/horses', label: tx('Explore horses', 'کاوش اسب‌ها'), icon: ic(Search) },
        { to: '/horses/register', label: tx('Register a horse', 'ثبت اسب جدید'), icon: ic(ClipboardPlus) },
      ],
    },
    {
      key: 'people', tag: tx('Phase 1', 'فاز ۱'), label: tx('People & Orgs', 'افراد و سازمان‌ها'), icon: ic(UsersRound), to: '/people',
      leaves: [
        { to: '/people', label: tx('Riders', 'سوارکاران'), icon: ic(Crown) },
        { to: '/people/breeders', label: tx('Breeders & studs', 'پرورش‌دهندگان'), icon: ic(Building2) },
        { to: '/people/orgs', label: tx('Vets, labs & clubs', 'دامپزشکان، آزمایشگاه‌ها، باشگاه‌ها'), icon: ic(Landmark) },
      ],
    },
    {
      key: 'breeding', tag: tx('Phase 2', 'فاز ۲'), label: tx('Breeding & Genetics', 'پرورش و ژنتیک'), icon: ic(Dna), to: '/breeding',
      leaves: [
        { to: '/breeding', label: tx('Mating advisor', 'مشاور جفت‌گیری'), icon: ic(HeartHandshake) },
        { to: '/breeding/ancestry', label: tx('Shared ancestry', 'نیاکان مشترک'), icon: ic(Network) },
        { to: '/breeding/matches', label: tx('Best matches', 'بهترین جفت‌ها'), icon: ic(Sparkles) },
        { to: '/breeding/genetics', label: tx('Genetic tests', 'آزمایش‌های ژنتیکی'), icon: ic(FlaskConical) },
      ],
    },
    {
      key: 'sport', tag: tx('Phase 3', 'فاز ۳'), label: tx('Competitions', 'مسابقات'), icon: ic(Trophy), to: '/sport',
      leaves: [
        { to: '/sport', label: tx('Results & performance', 'نتایج و عملکرد'), icon: ic(Trophy) },
        { to: '/sport/rankings', label: tx('Rankings', 'رتبه‌بندی'), icon: ic(Crown) },
        { to: '/sport/events', label: tx('Calendar & entries', 'تقویم و ثبت‌نام'), icon: ic(CalendarDays) },
        { to: '/sport/sources', label: tx('Data sources', 'منابع داده'), icon: ic(Database) },
      ],
    },
    {
      key: 'services', tag: tx('Phase 4', 'فاز ۴'), label: tx('Services & Market', 'خدمات و بازار'), icon: ic(Store), to: '/services',
      leaves: [
        { to: '/services', label: tx('Directory', 'فهرست خدمات'), icon: ic(LayoutGrid) },
        { to: '/services/market', label: tx('Marketplace', 'بازار'), icon: ic(Store) },
        { to: '/services/farm', label: tx('Farm tools', 'ابزار مزرعه'), icon: ic(Tractor) },
        { to: '/services/process', label: tx('Trust & process', 'اعتماد و روند'), icon: ic(Workflow) },
      ],
    },
    {
      key: 'news', tag: tx('Updates', 'به‌روزرسانی'), label: tx('News', 'اخبار'), icon: ic(Newspaper), to: '/news',
      leaves: [{ to: '/news', label: tx('Latest news', 'آخرین اخبار'), icon: ic(Megaphone) }],
    },
    {
      key: 'admin', tag: tx('Control', 'کنترل'), label: tx('Administration', 'پنل مدیریت'), icon: ic(ShieldCheck), to: '/admin',
      leaves: [
        { to: '/admin', label: tx('Overview', 'نمای کلی'), icon: ic(LayoutDashboard), need: 'reports' },
        { to: '/admin/queue', label: tx('Review queue', 'صف بررسی'), icon: ic(ListChecks), need: 'verify' },
        { to: '/admin/quality', label: tx('Quality queue', 'صف کیفیت داده'), icon: ic(ShieldAlert), need: 'verify' },
        { to: '/admin/rules', label: tx('Rules engine', 'موتور قوانین'), icon: ic(Scale), need: 'admin' },
        { to: '/admin/users', label: tx('Users & roles', 'کاربران و نقش‌ها'), icon: ic(Users), need: 'admin' },
        { to: '/admin/catalogue', label: tx('Breeds & metadata', 'نژادها و فراداده'), icon: ic(Layers), need: 'admin' },
        { to: '/admin/import', label: tx('Import & API', 'ورود داده و API'), icon: ic(FileUp), need: 'import' },
        { to: '/admin/audit', label: tx('Audit log', 'لاگ ممیزی'), icon: ic(ScrollText), need: 'admin' },
        { to: '/admin/reports', label: tx('National reports', 'گزارش‌های ملی'), icon: ic(ChartColumn), need: 'reports' },
      ],
    },
  ];
}

export function horseTabs(id: string, tx: Tx): NavLeaf[] {
  return [
    { to: `/horses/${id}`, label: tx('Overview', 'نمای کلی'), icon: ic(LayoutDashboard) },
    { to: `/horses/${id}/pedigree`, label: tx('Pedigree', 'شجره‌نامه'), icon: ic(GitBranch) },
    { to: `/horses/${id}/offspring`, label: tx('Offspring', 'نتاج'), icon: ic(Baby) },
    { to: `/horses/${id}/health`, label: tx('Health', 'سلامت'), icon: ic(Stethoscope) },
    { to: `/horses/${id}/genetics`, label: tx('Genetics', 'ژنتیک'), icon: ic(Dna) },
    { to: `/horses/${id}/competitions`, label: tx('Competitions', 'مسابقات'), icon: ic(Trophy) },
    { to: `/horses/${id}/documents`, label: tx('Documents', 'مدارک'), icon: ic(FileText) },
    { to: `/horses/${id}/history`, label: tx('Trust', 'اعتبار'), icon: ic(Clock) },
  ];
}

export function groupOfPath(path: string): GroupKey | 'home' {
  if (path.startsWith('/horses')) return 'registry';
  if (path.startsWith('/people')) return 'people';
  if (path.startsWith('/breeding')) return 'breeding';
  if (path.startsWith('/sport')) return 'sport';
  if (path.startsWith('/services')) return 'services';
  if (path.startsWith('/news')) return 'news';
  if (path.startsWith('/admin')) return 'admin';
  return 'home';
}

export function horseFromPath(path: string): { id: string; tab: string } | null {
  const m = path.match(/^\/horses\/([^/]+)(?:\/([^/]+))?$/);
  if (!m || m[1] === 'register') return null;
  return { id: m[1], tab: m[2] || 'overview' };
}
