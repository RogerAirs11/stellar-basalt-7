import { useState } from 'react';
import { ArrowUpRight, Check, CircleDashed, Flag, Library, Target } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card, Meter, PanelHeader, Pill } from '../components/ui';
import { Page } from '../components/Shell';
import { cn } from '../utils/cn';

interface Item { l: string; to?: string; later?: boolean }

export function Roadmap() {
  const { tx, n } = useI18n();
  const [dec, setDec] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const P: { id: string; k: string; dot: string; bar: string; soft: string; title: string; sub: string; accept: string; items: Item[] }[] = [
    { id: '0', k: tx('Phase 0', 'مرحله صفر'), dot: 'bg-slate-500', bar: 'bg-slate-400', soft: 'bg-slate-100', title: tx('Discovery & design', 'کشف و طراحی'), sub: tx('Audit data & sites, interview stakeholders, define data model and authority', 'ممیزی داده و سایت‌ها، مصاحبه، مدل داده و مرجع تأیید'), accept: tx('Requirements, data ownership, security plan and ID model approved', 'تأیید نیازمندی‌ها، مالکیت داده، طرح امنیت و مدل شناسه'),
      items: [{ l: tx('Audit existing sites and datasets', 'ممیزی سایت‌ها و داده‌های موجود'), later: true }, { l: tx('Stakeholder interviews', 'مصاحبه با ذی‌نفعان'), later: true }, { l: tx('Data model & identifier model', 'مدل داده و مدل شناسه'), later: true }, { l: tx('Define the confirming authority', 'تعریف مرجع تأیید'), later: true }] },
    { id: '1', k: tx('Phase 1', 'فاز ۱'), dot: 'bg-sky-500', bar: 'bg-sky-500', soft: 'bg-sky-50', title: tx('National registry', 'هسته ملی ثبت'), sub: tx('Register, identify and search horses and people', 'ثبت، شناسایی و جستجوی اسب و اشخاص'), accept: tx('Duplicate, parent-conflict, transfer and access scenarios pass', 'سناریوهای تکراری، تعارض والدین، انتقال و دسترسی با موفقیت آزمون شوند'),
      items: [{ l: tx('Comprehensive registration form', 'فرم جامع ثبت اسب'), to: '/horses/register' }, { l: tx('Profile: IDs, aliases, status, markings', 'پروفایل: شناسه‌ها، نام‌ها، وضعیت، علائم'), to: '/horses/persian-star' }, { l: tx('Six trust levels & scoped verification', 'شش سطح اعتبار و تأیید دامنه‌دار'), to: '/horses/persian-star/history' }, { l: tx('Spelling-tolerant search & record filters', 'جستجوی تحمل‌خطا و فیلتر سوابق'), to: '/horses' }, { l: tx('Rules engine: duplicates & consistency', 'موتور قوانین: تکراری و سازگاری'), to: '/admin/rules' }, { l: tx('Review queue & conflict handling', 'صف بررسی و رفع تعارض'), to: '/admin/queue' }, { l: tx('Roles, permissions & privacy levels', 'نقش‌ها، دسترسی‌ها و سطوح حریم'), to: '/admin/users' }, { l: tx('People & organisation profiles', 'پروفایل افراد و سازمان‌ها'), to: '/people/orgs' }, { l: tx('Legacy import & migration error report', 'ورود داده قدیمی و گزارش خطا'), to: '/admin/import' }, { l: tx('Data-quality dashboard', 'داشبورد کیفیت داده'), to: '/admin' }, { l: tx('Documented API & data export', 'API مستند و خروجی داده'), to: '/admin/import' }, { l: tx('Farsi / English, Shamsi / Gregorian, mobile', 'فارسی / انگلیسی، شمسی / میلادی، موبایل'), to: '/' }] },
    { id: '2', k: tx('Phase 2', 'فاز ۲'), dot: 'bg-fuchsia-500', bar: 'bg-fuchsia-500', soft: 'bg-fuchsia-50', title: tx('Breeding & genetics', 'آمیزش و ژنتیک'), sub: tx('Decision support — never a guarantee', 'تصمیم‌یار — نه تضمین'), accept: tx('Method verified by a geneticist; known-case tests; limits shown', 'تأیید روش توسط متخصص؛ آزمون نمونه‌های شناخته‌شده؛ نمایش محدودیت‌ها'),
      items: [{ l: tx('7-generation pedigree, 4 visual views', 'شجره ۷ نسل، ۴ نمای بصری'), to: '/horses/persian-star/pedigree' }, { l: tx('Inbreeding with completeness warnings', 'هم‌خونی با هشدار شجره ناقص'), to: '/breeding' }, { l: tx('Shared ancestors', 'نیاکان مشترک'), to: '/breeding/ancestry' }, { l: tx('Colour prediction from genotype only', 'پیش‌بینی رنگ فقط از ژنوتیپ'), to: '/breeding' }, { l: tx('Test records & STR profile', 'ثبت آزمایش‌ها و پروفایل STR'), to: '/horses/persian-star/genetics' }, { l: tx('Hereditary-condition risk per breed', 'ریسک بیماری ارثی بر اساس نژاد'), to: '/breeding' }, { l: tx('Offspring & reproduction records', 'نتاج و سوابق تولیدمثل'), to: '/horses/nika/offspring' }, { l: tx('Test catalogue & lab work package', 'فهرست آزمایش‌ها و بسته کاری آزمایشگاه'), to: '/breeding/genetics' }, { l: tx('Stallion-for-mare decision support', 'تصمیم‌یار نریان برای مادیان'), to: '/breeding/genetics', later: true }] },
    { id: '3', k: tx('Phase 3', 'فاز ۳'), dot: 'bg-gold-500', bar: 'bg-gold-500', soft: 'bg-gold-50', title: tx('Competitions & performance', 'مسابقات و عملکرد'), sub: tx('Results linked to the national horse ID', 'نتایج متصل به شناسه ملی اسب'), accept: tx('ID matching, source recorded, sample results confirmed', 'تطبیق شناسه، ثبت منبع، تأیید نتایج نمونه'),
      items: [{ l: tx('Calendar, organisers & entry rules', 'تقویم، برگزارکنندگان و شرایط ورود'), to: '/sport/events' }, { l: tx('Entry eligibility check', 'بررسی صلاحیت ثبت‌نام'), to: '/sport/events' }, { l: tx('Results with source status badges', 'نتایج با نشان وضعیت منبع'), to: '/sport' }, { l: tx('Connectors & microchip-first matching', 'اتصال‌ها و تطبیق مبتنی بر میکروچیپ'), to: '/sport/sources' }, { l: tx('Transparent, auditable rankings', 'رتبه‌بندی شفاف و قابل ممیزی'), to: '/sport/rankings' }] },
    { id: '4', k: tx('Phase 4', 'فاز ۴'), dot: 'bg-teal-500', bar: 'bg-teal-500', soft: 'bg-teal-50', title: tx('Services, market & analytics', 'خدمات، بازار و تحلیل ملی'), sub: tx('Professional tools and national dashboards', 'ابزار حرفه‌ای و داشبوردهای ملی'), accept: tx('Security & privacy tests, report accuracy, pilot-user acceptance', 'آزمون امنیت و حریم، صحت گزارش‌ها، پذیرش کاربران پایلوت'),
      items: [{ l: tx('Marketplace linked to verified profiles', 'بازار متصل به پروفایل‌های تأییدشده'), to: '/services/market' }, { l: tx('Directories: vets, labs, clubs, transport', 'فهرست‌ها: دامپزشک، آزمایشگاه، باشگاه، حمل'), to: '/people/orgs' }, { l: tx('Farm tools: calendar, reminders, expenses', 'ابزار مزرعه: تقویم، یادآور، هزینه'), to: '/services/farm' }, { l: tx('National dashboards & reports', 'داشبوردهای ملی و گزارش‌ها'), to: '/admin/reports' }, { l: tx('Genetic-diversity monitoring', 'پایش تنوع ژنتیکی'), to: '/admin/reports' }] },
  ];
  const kpis: [string, string][] = [[tx('Horses entered; % with valid identifiers', 'اسب‌های واردشده؛ درصد دارای شناسه معتبر'), '/admin'], [tx('% with reviewed passport; % reliable pedigree', 'درصد پاسپورت بررسی‌شده؛ درصد شجره قابل اتکا'), '/admin'], [tx('Duplicates found / resolved; residual error rate', 'تکراری‌های یافت / رفع‌شده؛ نرخ خطای باقی‌مانده'), '/admin'], [tx('Average handling time; backlog', 'میانگین زمان رسیدگی؛ پرونده‌های معوق'), '/admin/queue'], [tx('% of results linked to a horse ID', 'درصد نتایج متصل به شناسه اسب'), '/sport/sources'], [tx('Active users by role', 'کاربران فعال بر اساس نقش'), '/admin'], [tx('Matings analysed; pedigree / genotype completeness', 'آمیزش‌های تحلیل‌شده؛ کامل بودن شجره / ژنوتیپ'), '/breeding']];
  const decisions = [tx('Legal custodian of the database and the official confirming authority for each data type', 'متولی حقوقی پایگاه و مرجع تأیید رسمی هر نوع داده'), tx('Breeds and studbooks covered in Phase 1', 'نژادها و دفاتر تبارنامه‌ای که در فاز ۱ پوشش داده می‌شوند'), tx('Sample data: studbooks, Excel files, STR reports for quality assessment', 'نمونه داده: تبارنامه، اکسل، گزارش STR برای ارزیابی کیفیت'), tx('API availability and terms for racing / results systems', 'وضعیت API و شرایط سامانه‌های کورس و نتایج'), tx('Public vs confidential policy for health, ownership and documents', 'سیاست عمومی/محرمانه برای سلامت، مالکیت و مدارک'), tx('Expected users, data volume, hosting level and security needs', 'تعداد کاربران، حجم داده، سطح میزبانی و نیازهای امنیتی'), tx('Final budget from detailed design and contractor quotes', 'بودجه نهایی بر اساس طراحی تفصیلی و پیشنهاد پیمانکاران')];
  const refs = ['Irish Horse Register', 'WorldFengur', 'HorseTelex', 'IFCE / SIRE', 'UC Davis VGL', 'FEI Horse Search', 'Asb Davani', 'Sheyhe', 'Kasilor'];
  return (
    <Page phase="home" title={tx('Scope & roadmap', 'دامنه و نقشه راه')} subtitle={tx('How the proposal maps to this demo — every ✓ item opens the page that shows it.', 'نگاشت پیشنهاد به این نمونه — هر مورد ✓ صفحه مربوط را باز می‌کند.')}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {P.map((p, i) => {
            const demo = p.items.filter((x) => x.to && !x.later).length;
            return (
              <div key={p.id} className="panel flex flex-col overflow-hidden" style={{ animation: `enter .45s ${i * 70}ms both` }}>
                <div className={cn('h-1.5', p.bar)} />
                <div className={cn('p-3', p.soft)}>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-navy-600"><span className={cn('h-2 w-2 rounded-full', p.dot)} />{p.k}</span><Pill tone={p.id === '0' ? 'slate' : 'green'}>{p.id === '0' ? tx('Planned', 'برنامه‌ریزی') : `${n(demo)}/${n(p.items.length)} ${tx('in demo', 'در نمونه')}`}</Pill></div>
                  <h3 className="mt-1 font-display text-[17px] font-semibold leading-tight">{p.title}</h3><p className="mt-0.5 text-[11px] text-fg-navy-600">{p.sub}</p>
                  <div className="mt-2"><Meter value={p.id === '0' ? 0 : (demo / p.items.length) * 100} color={p.bar} /></div>
                </div>
                <ul className="flex-1 space-y-0.5 p-2">
                  {p.items.map((it) => it.to && !it.later ? (
                    <li key={it.l}><a href={'#' + it.to} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium transition hover:bg-surface-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-emerald-600" strokeWidth={3} /><span className="flex-1 leading-snug">{it.l}</span><ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-od-navy-300 transition group-hover:text-fg-sky-600 rtl:-scale-x-100" /></a></li>
                  ) : (
                    <li key={it.l} className="flex items-start gap-2 px-2 py-1.5 text-[13px] text-fg-navy-500"><CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="flex-1 leading-snug">{it.l}</span>{it.later && it.to && <a href={'#' + it.to} className="text-[10px] font-bold text-fg-gold-700 hover:underline">{tx('preview', 'پیش‌نمایش')}</a>}</li>
                  ))}
                </ul>
                <div className="border-t border-line bg-surface-2/60 p-2.5 text-[11px] leading-snug text-fg-navy-600"><b className="text-fg-navy-800">{tx('Acceptance', 'پذیرش')}:</b> {p.accept}</div>
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <Card className="p-3">
            <PanelHeader phase="home" icon={<Flag />} title={tx('Decisions needed before the final estimate', 'تصمیم‌های لازم پیش از برآورد نهایی')} sub={`${n(dec.filter(Boolean).length)}/${n(decisions.length)} ${tx('settled', 'قطعی')}`} />
            <ul className="space-y-1">{decisions.map((d, i) => <li key={i}><button onClick={() => setDec((x) => x.map((v, j) => (j === i ? !v : v)))} role="checkbox" aria-checked={dec[i]} className={cn('flex w-full items-start gap-2.5 rounded-xl p-2 text-start text-[13px] transition', dec[i] ? 'bg-emerald-50' : 'hover:bg-surface-2')}><span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border', dec[i] ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-navy-300 bg-field')}>{dec[i] && <Check className="h-3 w-3" strokeWidth={4} />}</span><span className={cn('flex-1 leading-snug', dec[i] && 'text-fg-navy-500 line-through')}>{d}</span></button></li>)}</ul>
          </Card>
          <div className="space-y-3">
            <Card className="p-3">
              <PanelHeader phase="home" icon={<Target />} title={tx('Success indicators — and where they show', 'شاخص‌های موفقیت — و محل نمایش')} />
              <ul className="space-y-1">{kpis.map(([l, to]) => <li key={l}><a href={'#' + to} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition hover:bg-surface-2"><Check className="h-3.5 w-3.5 shrink-0 text-fg-emerald-600" strokeWidth={3} /><span className="flex-1">{l}</span><ArrowUpRight className="h-3.5 w-3.5 text-od-navy-300 transition group-hover:text-fg-sky-600 rtl:-scale-x-100" /></a></li>)}</ul>
            </Card>
            <Card className="p-3">
              <PanelHeader phase="home" icon={<Library />} title={tx('Reference systems studied', 'سامانه‌های مرجع بررسی‌شده')} />
              <div className="flex flex-wrap gap-1.5">{refs.map((r) => <Pill key={r} tone="navy">{r}</Pill>)}</div>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
}
