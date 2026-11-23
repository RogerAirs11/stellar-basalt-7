import { useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarDays, CheckCircle2, Crown, Dna, FileCheck2, Hourglass, MapPin, Medal, Newspaper, Search, ShieldAlert, ShieldCheck, Tag, Users,
} from 'lucide-react';
import { EVENTS, HORSES, IMG, REGISTRY_TOTAL, RESULTS, DISCIPLINE_L, px, type Horse } from '../data';
import { QUEUE } from '../admin-data';
import { useRole } from '../role';
import { primaryTrust, TRUST_L, type TrustLevel } from '../records';
import { ALL_RIDERS, NEWS, NEWS_CAT } from '../people';
import { useI18n } from '../i18n';
import { Avatar, CountUp, Img, PanelHeader, Pill, Chip, TrustBadge, trustBar } from '../components/ui';
import { Page } from '../components/Shell';
import { usePlatformMeta, useRegistryAnalytics } from '../live';
import { PHASE } from '../theme';
import { cn } from '../utils/cn';

export function Dashboard() {
  const { tx, tr, n, date } = useI18n();
  // R158: the hero numbers come from the platform's live /api/platform/meta —
  // the same registry-wide statistics the core frontend presents.
  const meta = usePlatformMeta();
  const { def } = useRole();
  const [tab, setTab] = useState<'recent' | 'sale' | 'top'>('recent');
  const podiums = (h: Horse) => RESULTS.filter((r) => r.horseId === h.id && r.place <= 3).length;
  const sales = HORSES.filter((h) => h.sale);
  const list = tab === 'recent' ? HORSES.slice(0, 7) : tab === 'sale' ? sales.slice(0, 7) : [...HORSES].sort((a, b) => podiums(b) - podiums(a)).slice(0, 7);
  const riders = ALL_RIDERS.slice(0, 6);

  type TTone = 'amber' | 'red' | 'green' | 'blue';
  const T = (tone: TTone, icon: ReactNode, title: string, text: string, to: string) => ({ tone, icon, title, text, to });
  const alerts: { tone: TTone; icon: ReactNode; title: string; text: string; to: string }[] = (() => {
    const ev = T('blue', <CalendarDays />, tx('Next event', 'رویداد بعدی'), `${tr(EVENTS[0].name)} · ${date(EVENTS[0].date)}`, '/sport/events');
    switch (def.key) {
      case 'federation': case 'admin': return [
        T('red', <ShieldAlert />, tx(`${n(QUEUE.filter((q2) => q2.prio === 'high').length)} high-priority cases`, `${n(QUEUE.filter((q2) => q2.prio === 'high').length)} پرونده با اولویت بالا`), tx('Duplicate, parentage mismatch, birth-date conflict', 'تکراری، ناسازگاری والدین، تعارض تاریخ تولد'), '/admin/queue'),
        T('amber', <AlertTriangle />, tx('Possible duplicate record', 'رکورد احتمالی تکراری'), tx('Persian Star matches an existing entry', 'ستاره پارسی با یک ثبت موجود مطابقت دارد'), '/horses/persian-star'),
        T('amber', <Hourglass />, tx('2 horses awaiting verification', '۲ اسب در انتظار تأیید'), tx('Mahtab and Yaas have missing checks', 'مهتاب و یاس بررسی‌های ناقص دارند'), '/horses'), ev,
        T('green', <CheckCircle2 />, tx('Backlog trending down', 'روند معوقات نزولی'), tx('Average handling time 2.4 days', 'میانگین زمان رسیدگی ۲٫۴ روز'), '/admin')];
      case 'owner': return [
        T('amber', <Hourglass />, tx('Mahtab: passport awaiting review', 'مهتاب: پاسپورت در انتظار بررسی'), tx('Uploaded 11 Apr · not yet reviewed', 'بارگذاری ۲۲ فروردین · بررسی نشده'), '/horses/mahtab/documents'),
        T('blue', <CalendarDays />, tx('Persian Star: vaccine due in 12 days', 'ستاره پارسی: واکسن ۱۲ روز دیگر'), tx('Influenza booster', 'یادآور آنفلوانزا'), '/services/farm'),
        T('red', <AlertTriangle />, tx('Persian Star: possible duplicate', 'ستاره پارسی: احتمال تکراری'), tx('Review before the record can be verified', 'پیش از تأیید رکورد بررسی کنید'), '/horses/persian-star'), ev,
        T('green', <CheckCircle2 />, tx('Nika: all checks passed', 'نیکا: همه بررسی‌ها موفق'), tx('Official · DNA parentage verified', 'رسمی · والدین با DNA تأیید'), '/horses/nika')];
      case 'breeder': return [
        T('blue', <CalendarDays />, tx('Nika: foaling due 17 May', 'نیکا: زایش ۲۷ اردیبهشت'), tx('Pregnancy scan completed', 'سونوگرافی انجام شد'), '/horses/nika/offspring'),
        T('red', <ShieldAlert />, tx('Ramin: HYPP carrier', 'رامین: ناقل HYPP'), tx('Review before any mating', 'پیش از هر جفت‌گیری بررسی شود'), '/breeding'),
        T('amber', <Hourglass />, tx('3 foals awaiting registration', '۳ کره در انتظار ثبت'), tx('Add DNA samples to confirm parentage', 'برای تأیید والدین نمونه DNA اضافه کنید'), '/horses/register'), ev];
      case 'vet': return [
        T('blue', <CalendarDays />, tx('3 vaccination records to enter', '۳ سابقه واکسن برای ثبت'), tx('Tehran Equine Clinic', 'کلینیک اسب تهران'), '/horses'),
        T('amber', <Hourglass />, tx('Health access is logged', 'دسترسی سلامت ثبت می‌شود'), tx('Every view appears in the audit trail', 'هر مشاهده در لاگ ممیزی ثبت می‌شود'), '/horses/persian-star/health'), ev];
      case 'lab': return [
        T('amber', <Hourglass />, tx('2 samples awaiting STR entry', '۲ نمونه در انتظار ثبت STR'), tx('Enter panel, method and result', 'پنل، روش و نتیجه را ثبت کنید'), '/horses/h33/genetics'),
        T('red', <ShieldAlert />, tx('Result incompatible with declared sire', 'نتیجه با پدر اعلام‌شده ناسازگار'), tx('Confirm before it reaches the review queue', 'پیش از ورود به صف بررسی تأیید کنید'), '/horses/h33/genetics')];
      case 'organizer': return [
        T('blue', <CalendarDays />, tx('Nowruz Grand Prix: 124 entries', 'گرندپری نوروز: ۱۲۴ ثبت‌نام'), tx('Entries close soon', 'ثبت‌نام به‌زودی بسته می‌شود'), '/sport/events'),
        T('amber', <Hourglass />, tx('Results awaiting confirmation', 'نتایج در انتظار تأیید'), tx('Confirm to mark them “Verified by organiser”', 'برای نشان «تأیید برگزارکننده» تأیید کنید'), '/sport/sources')];
      case 'ministry': return [
        T('green', <CheckCircle2 />, tx('Quarterly report ready', 'گزارش فصلی آماده است'), tx('Aggregated, no personal data', 'تجمیعی، بدون داده شخصی'), '/admin/reports'),
        T('amber', <AlertTriangle />, tx('Caspian: diversity watch', 'خزری: پایش تنوع'), tx('Effective population 48 · inbreeding rising', 'جمعیت مؤثر ۴۸ · هم‌خونی رو به افزایش'), '/admin/reports')];
      case 'rider': return [
        T('green', <CheckCircle2 />, tx('You are #1 in jumping', 'شما رتبه اول پرش هستید'), tx('1,245 points this season', '۱٬۲۴۵ امتیاز در این فصل'), '/sport/rankings'), ev];
      default: return [
        T('blue', <Search />, tx('Search verified horses', 'جستجوی اسب‌های تأییدشده'), tx('Trust level shown on every record', 'سطح اعتبار روی هر رکورد نمایش داده می‌شود'), '/horses'),
        T('green', <CheckCircle2 />, tx('Browse the marketplace', 'مرور بازار'), tx('Every listing links to a verified record', 'هر آگهی به یک رکورد تأییدشده پیوند دارد'), '/services/market'), ev];
    }
  })();
  const toneCls = { amber: 'bg-amber-100 text-fg-amber-700', red: 'bg-red-100 text-fg-red-700', green: 'bg-emerald-100 text-fg-emerald-700', blue: 'bg-blue-100 text-fg-blue-700' };
  const words: [string, string][] = [[tx('Register', 'ثبت'), 'text-od-sky-300'], [tx('Breed', 'پرورش'), 'text-od-fuchsia-300'], [tx('Compete', 'رقابت'), 'text-od-gold-300'], [tx('Preserve', 'حفظ'), 'text-od-teal-300']];

  return (
    <Page phase="home">
      <div className="space-y-3">
        {/* hero strip */}
        <section className="relative isolate overflow-hidden rounded-2xl bg-navy-950 text-white shadow-lg shadow-navy-900/20">
          <img src={px(IMG.hero, 1800, 500)} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/95 via-navy-900/80 to-navy-900/40 rtl:bg-gradient-to-l" />
          <div className="grid gap-3 p-3.5 sm:p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <h1 className="flex flex-wrap items-center gap-x-2.5 font-display text-2xl font-semibold leading-tight sm:text-3xl">
                {words.map(([w], i) => <span key={w} className="flex items-center gap-2.5" style={{ animation: `enter .6s ${i * 110}ms both` }}><span className={i === 3 ? 'text-od-gold-200' : 'text-white'}>{w}</span>{i < 3 && <span className="h-1.5 w-1.5 rotate-45 bg-od-gold-300" />}</span>)}
              </h1>
              <p className="mt-0.5 text-[13px] text-od-navy-200">{tx('Iran’s unified, trusted and intelligent equine system.', 'سامانه یکپارچه، قابل اعتماد و هوشمند اسب ایران.')}</p>
              <a href="#/horses" className="mt-2.5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-navy-950 shadow-md shadow-navy-900/30 transition hover:bg-od-gold-200">
                <Search className="h-4 w-4" strokeWidth={2.5} />
                {tx('Open the Registry Explorer', 'کاوشگر ثبت را باز کنید')}
                <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
              </a>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                [meta?.horses ?? REGISTRY_TOTAL, tx('Horses', 'اسب'), <FileCheck2 key="a" className="h-3.5 w-3.5" />, 'text-od-sky-300'],
                [meta?.people ?? 12450, tx('Registered people', 'افراد ثبت‌شده'), <BadgeCheck key="b" className="h-3.5 w-3.5" />, 'text-od-indigo-300'],
                [meta?.horsesWithDnaData ?? 9870, tx('DNA profiles', 'پروفایل DNA'), <Dna key="c" className="h-3.5 w-3.5" />, 'text-od-fuchsia-300'],
                [meta?.horsesWithBothParents ?? 1240, tx('Parents on record', 'والدین در پرونده'), <ShieldCheck key="d" className="h-3.5 w-3.5" />, 'text-od-teal-300'],
              ] as [number, string, ReactNode, string][]).map(([v, l, ic, c]) => (
                <div key={l} className="glass rounded-xl px-3 py-2"><div className={cn('flex items-center gap-1.5 text-[11px] font-semibold', c)}>{ic}<span className="text-od-navy-100">{l}</span></div><div className="font-display text-xl font-semibold leading-tight"><CountUp value={v} /></div></div>
              ))}
            </div>
          </div>
        </section>

        {/* main grid */}
        <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
          <div className="panel flex flex-col p-3">
            <PanelHeader phase="home" icon={<ShieldAlert />} title={tx('Your tasks', 'وظایف شما')} sub={tr(def.label)} />
            <ul className="space-y-0.5">
              {alerts.map((a, i) => (
                <li key={i} style={{ animation: `enter .4s ${i * 60}ms both` }}>
                  <a href={'#' + a.to} className="group flex items-center gap-2.5 rounded-lg p-1.5 transition hover:bg-surface-2">
                    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4', toneCls[a.tone])}>{a.icon}</span>
                    <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold text-fg-navy-900">{a.title}</span><span className="block truncate text-[11px] text-fg-navy-500">{a.text}</span></span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-od-navy-300 transition group-hover:text-fg-navy-700 rtl:rotate-180" />
                  </a>
                </li>
              ))}
            </ul>
            <Pipeline />
          </div>

          <div className="panel p-3">
            <PanelHeader phase="registry" icon={<FileCheck2 />} title={tx('Horses', 'اسب‌ها')} action={<a href="#/horses" className="inline-flex items-center gap-1 text-xs font-semibold text-fg-sky-700 hover:underline">{tx('Explore', 'کاوش')}<ArrowRight className="h-3 w-3 rtl:rotate-180" /></a>} />
            <div className="hide-scroll mb-2 flex gap-1.5 overflow-x-auto">
              <Chip active={tab === 'recent'} onClick={() => setTab('recent')}>{tx('Recent', 'اخیر')}</Chip>
              <Chip active={tab === 'sale'} onClick={() => setTab('sale')} icon={<Tag className="h-3 w-3" />}>{tx('For sale', 'فروشی')}</Chip>
              <Chip active={tab === 'top'} onClick={() => setTab('top')} icon={<Medal className="h-3 w-3" />}>{tx('Top', 'برتر')}</Chip>
            </div>
            <ul key={tab} className="space-y-0.5">
              {list.map((h, i) => (
                <li key={h.id} style={{ animation: `enter .35s ${i * 40}ms both` }}>
                  <a href={`#/horses/${h.id}`} className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-sky-50">
                    <Img src={px(h.photo, 80, 80)} alt="" pos={h.pos} className="h-8 w-8 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(h.name)}</span><span className="block truncate text-[11px] text-fg-navy-500">{tr(h.breed)} · {tr(h.location)}</span></span>
                    {tab === 'sale' ? <span className="text-[13px] font-bold text-fg-gold-700">{n(h.sale!.priceM)}<span className="ms-0.5 text-[10px] font-normal text-fg-navy-500">{tx('M', 'م')}</span></span>
                      : tab === 'top' ? <Pill tone="gold" icon={<Medal className="h-3 w-3" />}>{n(podiums(h))}</Pill>
                        : <TrustBadge level={primaryTrust(h)} compact />}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-3 lg:col-span-2 xl:col-span-1">
            <PanelHeader phase="sport" icon={<Crown />} title={tx('Top riders', 'سوارکاران برتر')} action={<a href="#/sport/rankings" className="inline-flex items-center gap-1 text-xs font-semibold text-fg-gold-700 hover:underline">{tx('Rankings', 'رتبه‌بندی')}<ArrowRight className="h-3 w-3 rtl:rotate-180" /></a>} />
            <ul className="grid gap-x-4 gap-y-1.5 md:grid-cols-2 xl:grid-cols-1">
              {riders.map((r, i) => (
                <li key={r.id}>
                  <a href={`#/people?r=${r.id}`} className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-indigo-50">
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', i === 0 ? 'bg-gold-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-amber-700 text-white' : 'bg-surface-2 text-fg-navy-600 ring-1 ring-line')}>{n(i + 1)}</span>
                    <Avatar src={r.photo ? px(r.photo, 60, 60) : undefined} name={r.name.en} size={28} />
                    <span className="min-w-0 flex-1 leading-tight"><span className="flex justify-between gap-2 text-[13px]"><span className="truncate font-bold">{tr(r.name)}</span><span className="font-bold tabular-nums text-fg-gold-700">{n(r.pts)}</span></span><span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-gold-500" style={{ width: `${(r.pts / riders[0].pts) * 100}%` }} /></span></span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* R161 LIVE PARITY — registry-wide analytics from GET /api/analytics/registry,
            the same analytical workspace the core frontend renders at /stats. */}
        <RegistryAnalyticsBlock />

        {/* events + news */}
        <section className="grid gap-3 lg:grid-cols-2">
          <div className="panel p-3">
            <PanelHeader phase="sport" icon={<CalendarDays />} title={tx('Upcoming events', 'رویدادهای پیش رو')} action={<a href="#/sport/events" className="text-xs font-semibold text-fg-gold-700 hover:underline">{tx('All', 'همه')}</a>} />
            <ul className="space-y-1.5">
              {EVENTS.map((e, i) => (
                <li key={e.id} style={{ animation: `enter .4s ${i * 70}ms both` }}>
                  <a href="#/sport/events" className="flex items-center gap-3 rounded-lg p-1 transition hover:bg-gold-50">
                    <span className="stat-tile grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gold-100 text-center leading-none text-fg-gold-800"><span><span className="block text-base font-bold">{date(e.date).split(' ')[0]}</span><span className="block text-[10px] font-bold uppercase">{date(e.date, 'month')}</span></span></span>
                    <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(e.name)}</span><span className="flex items-center gap-1 truncate text-[11px] text-fg-navy-500"><MapPin className="h-3 w-3" />{tr(e.venue)}</span></span>
                    <span className="hidden flex-col items-end gap-0.5 text-[11px] sm:flex"><Pill tone="gold">{tr(DISCIPLINE_L[e.discipline])}</Pill><span className="flex items-center gap-1 text-fg-navy-500"><Users className="h-3 w-3" />{n(e.entries)}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel p-3">
            <PanelHeader phase="news" icon={<Newspaper />} title={tx('Latest news', 'آخرین اخبار')} action={<a href="#/news" className="text-xs font-semibold text-fg-slate-700 hover:underline">{tx('All', 'همه')}</a>} />
            <ul className="space-y-1.5">
              {NEWS.slice(0, 3).map((x, i) => {
                const ph = PHASE[NEWS_CAT[x.cat].phase];
                return (
                  <li key={x.id} style={{ animation: `enter .4s ${i * 70}ms both` }}>
                    <a href={`#/news?n=${x.id}`} className="flex gap-3 rounded-lg p-1 transition hover:bg-slate-100">
                      <img src={px(x.photo, 160, 120)} alt="" loading="lazy" className="h-11 w-16 shrink-0 rounded-lg object-cover" />
                      <span className="min-w-0 flex-1 leading-tight"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"><span className={cn('h-1.5 w-1.5 rounded-full', ph.dot)} /><span className={ph.text}>{tr(NEWS_CAT[x.cat].l)}</span><span className="font-medium normal-case tracking-normal text-navy-400">· {date(x.date)}</span></span><span className="line-clamp-1 text-[13px] font-bold">{tr(x.title)}</span></span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </Page>
  );
}

function Pipeline() {
  const { tx, tr, n } = useI18n();
  const c: Record<string, number> = {};
  HORSES.forEach((h) => { const t = primaryTrust(h); c[t] = (c[t] || 0) + 1; });
  const total = HORSES.length;
  const seg: TrustLevel[] = ['official', 'reviewed', 'uploaded', 'self', 'conflict'];
  return (
    <div className="mt-auto border-t border-line pt-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-fg-navy-500"><span>{tx('Trust pipeline', 'خط اعتبار')}</span><span>{n(total)} {tx('records', 'رکورد')}</span></div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">{seg.map((t, i) => <span key={t} className={cn('h-full origin-left rtl:origin-right', trustBar(t))} style={{ width: `${((c[t] || 0) / total) * 100}%`, animation: `grow-x 1s ${i * 120}ms both` }} />)}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">{seg.map((t) => <div key={t} className="flex items-center gap-1.5 text-xs"><span className={cn('h-2.5 w-2.5 rounded-full', trustBar(t))} /><span className="truncate text-fg-navy-600">{tr(TRUST_L[t].short)}</span><b className="ms-auto tabular-nums">{n(c[t] || 0)}</b></div>)}</div>
    </div>
  );
}

/* ---------- R161 LIVE PARITY: registry analytics (core /stats equivalent) ---------- */
function RegistryAnalyticsBlock() {
  const { tx, n } = useI18n();
  const a = useRegistryAnalytics();
  if (!a) return null;
  const maxDecade = Math.max(1, ...a.birthDecades.map((d) => d.count));
  const maxBreed = Math.max(1, ...a.topBreeds.map((d) => d.count));
  const maxSex = Math.max(1, ...a.sexDistribution.map((d) => d.count));
  const pct = (v: number) => `${Math.round(v)}%`;
  const bar = 'h-2 overflow-hidden rounded-full bg-surface-2';
  const fill = 'block h-full origin-left rounded-full bg-gradient-to-r from-sky-600 to-cyan-400 rtl:origin-right';
  return (
    <section className="panel p-3">
      <PanelHeader phase="home" icon={<Crown />} title={tx('Registry analytics', 'تحلیل ثبت')}
        sub={tx(`Live analysis of ${n(a.horseCount)} records`, `تحلیل زنده ${n(a.horseCount)} رکورد`)} />
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Birth decades', 'دهه‌های تولد')}</h4>
          <div className="space-y-1">
            {a.birthDecades.slice(-8).map((d) => (
              <div key={d.decade} className="flex items-center gap-2 text-[11px]">
                <span className="w-9 shrink-0 tabular-nums text-fg-navy-500" dir="ltr">{n(d.decade)}s</span>
                <span className={cn('min-w-0 flex-1', bar)}><span className={fill} style={{ width: `${(d.count / maxDecade) * 100}%` }} /></span>
                <b className="w-12 shrink-0 text-end tabular-nums text-fg-navy-700">{n(d.count)}</b>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Top breeds', 'نژادهای برتر')}</h4>
          <div className="space-y-1">
            {a.topBreeds.slice(0, 8).map((d) => (
              <div key={d.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-24 shrink-0 truncate text-fg-navy-600">{d.label}</span>
                <span className={cn('min-w-0 flex-1', bar)}><span className={fill} style={{ width: `${(d.count / maxBreed) * 100}%` }} /></span>
                <b className="w-12 shrink-0 text-end tabular-nums text-fg-navy-700">{n(d.count)}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Sex distribution', 'توزیع جنس')}</h4>
            <div className="space-y-1">
              {a.sexDistribution.map((d) => (
                <div key={d.label} className="flex items-center gap-2 text-[11px]">
                  <span className="w-24 shrink-0 truncate text-fg-navy-600">{d.label}</span>
                  <span className={cn('min-w-0 flex-1', bar)}><span className={fill} style={{ width: `${(d.count / maxSex) * 100}%` }} /></span>
                  <b className="w-12 shrink-0 text-end tabular-nums text-fg-navy-700">{n(d.count)}</b>
                </div>
              ))}
            </div>
          </div>
          {a.parentage && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Parentage on record', 'والدین در پرونده')}</h4>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                <span className="h-full bg-emerald-500" style={{ width: pct(a.parentage.bothParentsPercent) }} />
                <span className="h-full bg-amber-400" style={{ width: pct(a.parentage.oneParentPercent) }} />
                <span className="h-full bg-slate-300" style={{ width: pct(a.parentage.noParentsPercent) }} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-navy-600">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{tx('Both', 'هر دو')} {pct(a.parentage.bothParentsPercent)}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{tx('One', 'یکی')} {pct(a.parentage.oneParentPercent)}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-300" />{tx('None', 'هیچ')} {pct(a.parentage.noParentsPercent)}</span>
              </div>
            </div>
          )}
          {a.activity?.active && <p className="text-[11px] text-fg-navy-500">{tx('Active', 'فعال')} {pct(a.activity.active.percent)}{a.activity.imported ? ` · ${tx('Imported', 'وارداتی')} ${pct(a.activity.imported.percent)}` : ''}</p>}
        </div>
      </div>
    </section>
  );
}
