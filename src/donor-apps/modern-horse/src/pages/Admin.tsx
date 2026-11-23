import { Lock } from 'lucide-react';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { getNav } from '../nav';
import { QUEUE } from '../admin-data';
import { Page } from '../components/Shell';
import { AdminOverview, AdminQueue, AdminRules, AdminUsers } from './AdminA';
import { AdminQuality } from './AdminQuality';
import { QCODES, useQuality } from '../platform-data';
import { AdminAudit, AdminCatalogue, AdminImport, AdminReports } from './AdminB';

type Tab = 'overview' | 'queue' | 'quality' | 'rules' | 'users' | 'catalogue' | 'import' | 'audit' | 'reports';
const PATH: Record<Tab, string> = { overview: '/admin', queue: '/admin/queue', quality: '/admin/quality', rules: '/admin/rules', users: '/admin/users', catalogue: '/admin/catalogue', import: '/admin/import', audit: '/admin/audit', reports: '/admin/reports' };

export function Admin({ tab }: { tab: Tab }) {
  const { tx, n } = useI18n();
  const { can } = useRole();
  const qOpen = useQuality().filter((i) => i.status !== 'resolved').length;
  void QCODES;
  const leaves = getNav(tx).find((g) => g.key === 'admin')!.leaves;
  const allowed = leaves.filter((l) => !l.need || can(l.need));
  const tabs = allowed.map((l) => (l.to === '/admin/queue' ? { ...l, badge: n(QUEUE.length) } : l.to === '/admin/quality' ? { ...l, badge: n(qOpen) } : { ...l }));
  const ok = allowed.some((l) => l.to === PATH[tab]);
  const sub: Record<Tab, string> = {
    overview: tx('Quality of the national data at a glance.', 'کیفیت داده ملی در یک نگاه.'),
    quality: tx('Data-integrity issues with a full reviewer loop: assign, resolve, reopen, note.', 'مشکلات یکپارچگی داده با چرخه کامل بازبینی: ارجاع، رفع، بازگشایی، یادداشت.'),
    queue: tx('Registrations, corrections, duplicates and conflicts waiting for a human decision.', 'ثبت‌ها، اصلاح‌ها، تکراری‌ها و تعارض‌های منتظر تصمیم انسانی.'),
    rules: tx('Configurable, versioned validation rules per breed and studbook.', 'قوانین اعتبارسنجی قابل پیکربندی و نسخه‌بندی‌شده برای هر نژاد و دفتر.'),
    users: tx('Who can do what — roles, MFA and permissions.', 'چه کسی چه کاری می‌تواند — نقش‌ها، MFA و دسترسی‌ها.'),
    catalogue: tx('Breeds, categories and metadata fields without code changes.', 'نژادها، دسته‌ها و فیلدهای فراداده بدون تغییر کد.'),
    import: tx('Bring legacy data in safely; connect systems through a documented API.', 'ورود امن داده قدیمی؛ اتصال سامانه‌ها با API مستند.'),
    audit: tx('A complete trail of sensitive actions.', 'ردپای کامل اقدامات حساس.'),
    reports: tx('Aggregated national analytics for decision-making.', 'تحلیل‌های تجمیعی ملی برای تصمیم‌گیری.'),
  };
  return (
    <Page phase="admin" fill={tab === 'queue' || tab === 'quality'} title={tx('Administration', 'پنل مدیریت')} subtitle={sub[tab]} tabs={tabs}>
      {!ok ? (
        <div className="panel grid place-items-center p-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-slate-200 text-fg-slate-600"><Lock className="h-5 w-5" /></span><div className="mt-3 font-bold">{tx('Your role cannot open this page', 'نقش شما امکان باز کردن این صفحه را ندارد')}</div><p className="mt-1 max-w-sm text-sm text-fg-navy-500">{tx('Use the role menu in the top bar to preview this page as a federation officer or administrator.', 'از منوی نقش در نوار بالا برای پیش‌نمایش این صفحه به‌عنوان کارشناس فدراسیون یا مدیر استفاده کنید.')}</p></div>
      ) : tab === 'queue' ? <AdminQueue /> : tab === 'quality' ? <AdminQuality /> : tab === 'rules' ? <AdminRules /> : tab === 'users' ? <AdminUsers /> : tab === 'catalogue' ? <AdminCatalogue /> : tab === 'import' ? <AdminImport /> : tab === 'audit' ? <AdminAudit /> : tab === 'reports' ? <AdminReports /> : <AdminOverview />}
    </Page>
  );
}
