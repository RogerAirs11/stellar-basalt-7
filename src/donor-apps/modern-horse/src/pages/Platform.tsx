import { useState } from 'react';
import { ArrowUpRight, Check, CircleDashed, Hourglass } from 'lucide-react';
import { CAPS, PLATFORM, SNAPSHOT, type Access, type Cover, type Stab } from '../platform-data';
import { useI18n } from '../i18n';
import { Card, Chip, Meter, Notice, PanelHeader, Pill } from '../components/ui';
import { Page } from '../components/Shell';
import { cn } from '../utils/cn';

const STAB_TONE: Record<Stab, 'blue' | 'green' | 'amber' | 'slate'> = { core: 'blue', stable: 'green', experimental: 'amber', reserved: 'slate' };

export function Platform() {
  const { tx, tr, n, lang } = useI18n();
  const [stab, setStab] = useState<'all' | Stab>('all');
  const [acc, setAcc] = useState<'all' | Access>('all');
  const [cov, setCov] = useState<'all' | Cover>('all');
  const list = CAPS.filter((c) => (stab === 'all' || c.stab === stab) && (acc === 'all' || c.access === acc) && (cov === 'all' || c.fe === cov));
  const count = (f: Cover) => CAPS.filter((c) => c.fe === f).length;
  const live = count('live'), partial = count('partial'), next = count('next');
  const pct = (v: number) => (v / CAPS.length) * 100;
  const coverPill = (c: (typeof CAPS)[number]) => c.fe === 'live' ? <Pill tone="green" icon={<Check className="h-3 w-3" strokeWidth={3} />}>{tx('Live here', 'فعال')}</Pill> : c.fe === 'partial' ? <Pill tone="amber" icon={<Hourglass className="h-3 w-3" />}>{tx('Partly', 'بخشی')}{c.inc ? ` · ${tx('inc.', 'گام')} ${n(c.inc)}` : ''}</Pill> : <Pill tone="slate" icon={<CircleDashed className="h-3 w-3" />}>{c.inc ? `${tx('Increment', 'گام')} ${n(c.inc)}` : tx('Reserved', 'رزرو')}</Pill>;
  const incs = [
    { k: '1', done: true, t: tx('Trust & privacy core', 'هسته اعتماد و حریم خصوصی'), d: tx('Data-quality queue · genetic publication decisions · professional grants · evidence summary · evidence facets · exact-ID lookup · this map', 'صف کیفیت داده · تصمیم‌های انتشار ژنتیک · مجوزهای حرفه‌ای · خلاصه مدارک · فیلترهای مدارک · جستجوی شناسه دقیق · همین نقشه') },
    { k: '2a', done: true, t: tx('Registration', 'ثبت'), d: tx('Resumable 4-step registration · drafts at every step · in-place parent lookup with stale-response protection · bilingual per-step validation · clean reset with a fresh idempotency key', 'ثبت چهارمرحله‌ای قابل ادامه · پیش‌نویس در هر گام · جستجوی والد درجا با محافظت از پاسخ کهنه · اعتبارسنجی دوزبانه هر گام · بازنشانی تمیز با کلید یکتایی تازه') },
    { k: '2b', done: false, t: tx('Registry workflows', 'روندهای ثبت'), d: tx('Duplicate merge & unmerge workbench · owner claims & change requests · disclosure-gated pairing evidence · racing tab', 'میز ادغام و بازگردانی تکراری · ادعای مالکیت و درخواست تغییر · شواهد جفت‌گیری وابسته به افشا · تب کورس') },
    { k: '3', done: false, t: tx('Commerce & collaboration', 'تجارت و همکاری'), d: tx('Marketplace inquiries, watchlist & blocks · dossiers · workspaces & tasks · organization workbench · service requests · moderation · billing (demo)', 'پرس‌وجو، پیگیری و مسدودسازی بازار · پرونده‌های اشتراکی · فضاهای کاری · میز سازمان · درخواست خدمات · نظارت · صورتحساب (نمایشی)') },
    { k: '4', done: false, t: tx('Platform services', 'خدمات پلتفرم'), d: tx('Issuers & attestations · AI research assistant with honest quota refusal · notifications & preferences · privacy & redaction requests · media publication · admin AI settings', 'صادرکنندگان و گواهی‌ها · دستیار پژوهشی با رد صادقانه سهمیه · اعلان‌ها · درخواست‌های حریم خصوصی · انتشار رسانه · تنظیمات هوش مصنوعی') },
  ];

  return (
    <Page phase="home" title={tx('Platform & capabilities', 'پلتفرم و قابلیت‌ها')} subtitle={tx('What the registry backend provides, and how much of it this front end already covers', 'آنچه بک‌اند ثبت ارائه می‌دهد و میزان پوشش آن در این رابط')}>
      <div className="mx-auto max-w-6xl space-y-3 pb-6">
        <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          {([[tx('App', 'برنامه'), PLATFORM.app], [tx('Contract', 'قرارداد'), PLATFORM.contract], [tx('Round', 'دور'), `${PLATFORM.round} · ${PLATFORM.date}`], [tx('Migrations', 'مهاجرت‌ها'), `0${PLATFORM.migrations}`], [tx('API routes', 'مسیرهای API'), n(PLATFORM.routes)], [tx('Data structures', 'ساختارهای داده'), n(PLATFORM.structures)], [tx('Frontends', 'رابط‌ها'), n(PLATFORM.frontends)]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{k}</div><div className="font-mono text-[13px] font-semibold text-fg-navy-900" dir="ltr">{v}</div></div>
          ))}
          <div className="ms-auto flex flex-wrap gap-1.5"><Pill tone="green">{tx('Worker live', 'در دسترس')}</Pill><Pill tone="amber">{tx('Payments: demo only', 'پرداخت: نمایشی')}</Pill><Pill tone="slate">iraho.ir · DNS pending</Pill></div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<Check />} title={tx('Canonical corpus', 'پایگاه مرجع')} sub={tx('Measured R143-E01', 'اندازه‌گیری R143-E01')} />
            <div className="font-display text-3xl font-semibold leading-none">{n(SNAPSHOT.horses)}</div>
            <div className="mt-1 text-xs text-fg-navy-500">{n(SNAPSHOT.active)} {tx('active', 'فعال')} · {n(SNAPSHOT.inactive)} {tx('inactive', 'غیرفعال')}</div>
            <div className="mt-3 space-y-2">{SNAPSHOT.ids.map(([k, v]) => <div key={k}><div className="mb-1 flex justify-between text-xs"><span className="text-fg-navy-600">{k === 'register' ? tx('Register number', 'شماره ثبت') : k === 'microchip' ? tx('Microchip', 'میکروچیپ') : tx('Passport', 'پاسپورت')}</span><b className="tabular-nums">{n(v, 2)}%</b></div><Meter value={v} color={v > 60 ? 'bg-emerald-500' : 'bg-amber-500'} /></div>)}</div>
            <div className="mt-3 border-t border-line pt-2.5 text-xs text-fg-navy-600">{tx('Racing results linked to a registry horse', 'نتایج کورس متصل به اسب ثبت‌شده')}: <b>{n(SNAPSHOT.racing.linked)}</b> / {n(SNAPSHOT.racing.total)}</div>
          </Card>
          <Card className="p-3">
            <PanelHeader phase="breeding" icon={<Check />} title={tx('Pedigree completeness', 'کامل بودن شجره')} sub={tx('By generation · zero ancestry cycles', 'به تفکیک نسل · بدون چرخه نیاکان')} />
            <div className="flex h-32 items-end gap-2">{SNAPSHOT.pedigree.map((v, i) => <div key={i} className="flex flex-1 flex-col items-center gap-1"><b className="text-[10px] tabular-nums text-fg-navy-600">{n(v, 1)}</b><span className="w-full origin-bottom rounded-t bg-gradient-to-t from-fuchsia-700 to-fuchsia-400" style={{ height: `${v}%`, animation: `grow-y .9s ${i * 70}ms both` }} /><span className="text-[10px] font-semibold text-fg-navy-500">{tx('G', 'نسل ')}{n(i + 1)}</span></div>)}</div>
            <p className="mt-2 text-[11px] leading-snug text-fg-navy-500">{tx('Below 20% projected completeness a pairing is excluded — and the weaker side is named.', 'زیر ۲۰٪ کامل بودن پیش‌بینی‌شده، جفت‌گیری حذف می‌شود و سمت ضعیف‌تر نام برده می‌شود.')}</p>
          </Card>
          <Card className="p-3">
            <PanelHeader phase="admin" icon={<Hourglass />} title={tx('Known data debt', 'بدهی داده شناخته‌شده')} sub={tx('Tracked and seeded into the quality queue', 'ردیابی‌شده و واردشده به صف کیفیت')} action={<a href="#/admin/quality" className="text-xs font-semibold text-fg-violet-700 hover:underline">{tx('Open queue', 'صف')} →</a>} />
            <ul className="space-y-2">{SNAPSHOT.debt.map((d) => <li key={d.k} className="rounded-lg bg-surface-2/70 px-2.5 py-2 text-xs leading-snug text-fg-navy-700">{lang === 'fa' ? d.fa : d.en}</li>)}</ul>
          </Card>
        </div>

        <Card className="p-3">
          <PanelHeader phase="home" icon={<ArrowUpRight />} title={tx('Capability catalogue', 'فهرست قابلیت‌ها')} sub={tx(`${n(CAPS.length)} platform feature keys — each with a version, stability and access class`, `${n(CAPS.length)} کلید قابلیت — هر یک با نسخه، پایداری و سطح دسترسی`)} />
          <div className="mb-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="bg-emerald-500" style={{ width: `${pct(live)}%` }} /><span className="bg-amber-500" style={{ width: `${pct(partial)}%` }} /><span className="bg-slate-300" style={{ width: `${pct(next)}%` }} /></div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-navy-600"><span><b className="text-fg-emerald-700">{n(live)}</b> {tx('live in this front end', 'فعال در این رابط')}</span><span><b className="text-fg-amber-700">{n(partial)}</b> {tx('partly covered', 'پوشش بخشی')}</span><span><b>{n(next)}</b> {tx('still to build', 'در انتظار ساخت')}</span></div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'core', 'stable', 'experimental', 'reserved'] as const).map((s) => <Chip key={s} phase="home" active={stab === s} onClick={() => setStab(s)}>{s === 'all' ? tx('Any stability', 'هر پایداری') : s}</Chip>)}</div>
            <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'public', 'authenticated', 'privileged'] as const).map((s) => <Chip key={s} phase="home" active={acc === s} onClick={() => setAcc(s)}>{s === 'all' ? tx('Any access', 'هر دسترسی') : s}</Chip>)}</div>
            <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'live', 'partial', 'next'] as const).map((s) => <Chip key={s} phase="home" active={cov === s} onClick={() => setCov(s)}>{s === 'all' ? tx('Any coverage', 'هر پوشش') : s === 'live' ? tx('Live', 'فعال') : s === 'partial' ? tx('Partly', 'بخشی') : tx('To build', 'در انتظار')}</Chip>)}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Capability', 'قابلیت')}</th><th className="pb-2 text-start font-semibold">{tx('Version', 'نسخه')}</th><th className="pb-2 text-start font-semibold">{tx('Stability', 'پایداری')}</th><th className="pb-2 text-start font-semibold">{tx('Access', 'دسترسی')}</th><th className="pb-2 text-end font-semibold">{tx('In this front end', 'در این رابط')}</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.key} className="border-t border-line">
                    <td className="py-1.5 pe-2"><div className="font-semibold leading-tight">{c.to ? <a href={'#' + c.to} className="hover:text-fg-sky-700 hover:underline">{tr(c.name)}</a> : tr(c.name)}</div><div className="font-mono text-[10.5px] text-fg-navy-400" dir="ltr">{c.key}</div></td>
                    <td className="pe-2 font-mono text-xs text-fg-navy-600" dir="ltr">{c.version}</td>
                    <td className="pe-2"><Pill tone={STAB_TONE[c.stab]}>{c.stab}</Pill></td>
                    <td className="pe-2 text-xs text-fg-navy-600">{c.access}</td>
                    <td className="text-end">{coverPill(c)}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={5} className="py-8 text-center text-sm text-fg-navy-500">{tx('No capability matches these filters.', 'قابلیتی با این فیلترها نیست.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {incs.map((i) => (
            <div key={i.k} className={cn('panel p-3', i.done && 'border-emerald-300')}>
              <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-navy-500">{tx('Increment', 'گام')} {n(i.k)}</span>{i.done ? <Pill tone="green" icon={<Check className="h-3 w-3" strokeWidth={3} />}>{tx('Built', 'ساخته شد')}</Pill> : <Pill tone={i.k === '2b' ? 'amber' : 'slate'}>{i.k === '2b' ? tx('Next', 'بعدی') : tx('Planned', 'برنامه‌ریزی')}</Pill>}</div>
              <h3 className="mt-1.5 font-display text-lg font-semibold leading-tight">{i.t}</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-navy-600">{i.d}</p>
            </div>
          ))}
        </div>
        <Notice tone="slate">{tx('Not yet real, by the platform’s own account: payments are demo-only, the Turso failover leg is untested in production, and iraho.ir awaits its DNS switch. Health-module expansion waits on federation and veterinary agreement.', 'به گفته خود پلتفرم هنوز واقعی نیست: پرداخت‌ها نمایشی است، مسیر جایگزین Turso در تولید آزمون نشده و iraho.ir منتظر تغییر DNS است. گسترش ماژول سلامت منتظر توافق فدراسیون و دامپزشکی است.')}</Notice>
      </div>
    </Page>
  );
}
