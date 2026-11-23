import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight, Bell, Calendar as CalIcon, Check, CircleCheck, ClipboardCheck, Dna, FileCheck2, FileDown, GraduationCap, Heart, MapPin, ShieldCheck, Stethoscope, Store, Syringe, Truck, Wallet, Baby, Lock, Plus,
} from 'lucide-react';
import { COLOUR_L, HORSES, SERVICES, hash, px } from '../data';
import { conflictOf, primaryTrust, statusOf } from '../records';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { useBreeding } from '../store';
import { Card, Chip, CountUp, Img, Kpi, Notice, PanelHeader, Pill, Segmented, Tick, TrustBadge, TrustLegend, inputCls } from '../components/ui';
import { Page } from '../components/Shell';
import { getNav } from '../nav';
import { go } from '../lib';
import { fetchMarketListings, useLiveFetch, type LiveListing } from '../live';
import { cn } from '../utils/cn';

const icons: Record<string, ReactNode> = {
  registry: <ClipboardCheck />, passport: <FileCheck2 />, dna: <Dna />, vet: <Stethoscope />, market: <Store />, transport: <Truck />, insurance: <ShieldCheck />, training: <GraduationCap />,
};

export function Services({ tab }: { tab: 'directory' | 'market' | 'farm' | 'process' }) {
  const { tx } = useI18n();
  const leaves = getNav(tx).find((g) => g.key === 'services')!.leaves;
  return (
    <Page
      phase="services"
      fill={tab === 'market'}
      title={tx('Services, market & farm tools', 'خدمات، بازار و ابزار مزرعه')}
      subtitle={tx('Professional services and a marketplace where every listing links to a verified record.', 'خدمات حرفه‌ای و بازاری که هر آگهی به یک رکورد تأییدشده پیوند دارد.')}
      tabs={[{ ...leaves[0] }, { ...leaves[1] }, { ...leaves[2] }, { ...leaves[3] }]}
    >
      {tab === 'directory' && <Directory />}
      {tab === 'market' && <LiveMarket />}
      {tab === 'farm' && <Farm />}
      {tab === 'process' && <Process />}
    </Page>
  );
}

/* ---------------- Directory ---------------- */
function Directory() {
  const { tx, tr, n } = useI18n();
  const { setS } = useBreeding();
  const [cat, setCat] = useState('all');
  const cats = [
    { k: 'all', l: tx('All services', 'همه خدمات'), keys: [] as string[] }, { k: 'id', l: tx('Identity & records', 'هویت و سوابق'), keys: ['registry', 'passport', 'dna'] },
    { k: 'care', l: tx('Health & protection', 'سلامت و حمایت'), keys: ['vet', 'insurance'] }, { k: 'trade', l: tx('Trade & transport', 'تجارت و حمل'), keys: ['market', 'transport'] }, { k: 'learn', l: tx('Training', 'آموزش'), keys: ['training'] },
  ];
  const sel = cats.find((c) => c.k === cat)!;
  const list = SERVICES.filter((s) => cat === 'all' || sel.keys.includes(s.key));
  const studs = useMemo(() => HORSES.filter((h) => h.gender === 'stallion' && statusOf(h).s === 'alive' && h.verified.passport && +h.birth.slice(0, 4) <= 2019 && !conflictOf(h)).slice(0, 8), []);
  return (
    <div className="space-y-3">
      <div className="hide-scroll flex gap-2 overflow-x-auto">{cats.map((c) => <Chip key={c.k} phase="services" active={cat === c.k} onClick={() => setCat(c.k)}>{c.l}</Chip>)}</div>
      <div key={cat} className="auto-grid" style={{ '--min': '240px' } as React.CSSProperties}>
        {list.map((s, i) => (
          <div key={s.key} className="panel group relative overflow-hidden p-3 transition-all duration-500 hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md" style={{ animation: `enter .5s ${i * 60}ms both` }}>
            <span className="absolute inset-x-0 top-0 h-1 bg-teal-500 opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-100 text-fg-teal-700 transition-all duration-500 group-hover:rotate-6 group-hover:bg-teal-600 group-hover:text-white [&>svg]:h-5 [&>svg]:w-5">{icons[s.key]}</span>
            <h3 className="mt-2.5 text-[14px] font-bold text-fg-navy-900">{tr(s.title)}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-navy-500">{tr(s.desc)}</p>
            <div className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg-teal-700">{tx('Learn more', 'اطلاعات بیشتر')}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" /></div>
          </div>
        ))}
      </div>
      <Card className="p-3">
        <PanelHeader phase="services" icon={<Heart />} title={tx('Stallions at stud', 'نریان‌های آماده جفت‌گیری')} sub={tx('Only passport-reviewed stallions with no open conflict', 'فقط نریان‌های با پاسپورت بررسی‌شده و بدون تعارض')} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {studs.map((h) => (
            <div key={h.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/50 p-2">
              <Img src={px(h.photo, 100, 100)} alt="" pos={h.pos} className="h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 leading-tight"><a href={`#/horses/${h.id}`} className="block truncate text-[13px] font-bold hover:text-fg-sky-700">{tr(h.name)}</a><div className="truncate text-[11px] text-fg-navy-500">{tr(h.breed)} · {tr(COLOUR_L[h.colour])}</div><div className="mt-0.5 flex items-center gap-1.5"><TrustBadge level={primaryTrust(h)} compact />{h.dna && <TrustBadge level="dna" compact />}<span className="text-[11px] font-bold text-fg-teal-700">{n(20 + (hash(h.id) % 60))}M</span></div></div>
              <button onClick={() => { setS(h.id); go('/breeding'); }} title={tx('Check a mating', 'بررسی جفت‌گیری')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fuchsia-100 text-fg-fuchsia-700 transition hover:bg-fuchsia-600 hover:text-white"><Heart className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Marketplace (R161 LIVE PARITY) ----------------
 * Real marketplace listings from GET /api/market/listings — the same
 * introduction-surface marketplace the core interface serves (versioned
 * status, seller-mandate framing, honest disclosures). The mockup's demo
 * sale horses were retired: nothing is invented for sale. */
function LiveMarket() {
  const { tx, tr, n, date } = useI18n();
  const [sort, setSort] = useState<'new' | 'low' | 'high'>('new');
  const { data, done } = useLiveFetch('listings', () => fetchMarketListings(24, 0));
  if (!done) return <div className="panel grid min-h-[40vh] place-items-center text-sm text-fg-navy-500">…</div>;
  const listings = (data?.listings ?? []).filter((l) => l.status === 'active' || l.status === 'reserved' || l.status === 'sold');
  const sorted = [...listings].sort((a, b) => (sort === 'low' ? (a.priceToman ?? Infinity) - (b.priceToman ?? Infinity) : sort === 'high' ? (b.priceToman ?? -1) - (a.priceToman ?? -1) : b.listedAt.localeCompare(a.listedAt)));
  const money = (v: number | null) => (v == null ? '—' : n(Math.round(v / 1_000_000)));
  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
        <Notice tone="blue" icon={<Store />} title={tx('Marketplace — introduction surface only', 'بازار — فقط سطح معرفی')} />
        <div className="ms-auto flex items-center gap-2"><span className="text-xs text-fg-navy-500"><b className="text-sm text-fg-navy-900">{n(sorted.length)}</b> {tx('listings', 'آگهی')}</span><Segmented<string> label="Sort" value={sort} onChange={(v) => setSort(v as 'new')} phase="services" items={[{ v: 'new', l: tx('Newest', 'جدیدترین') }, { v: 'low', l: tx('Price ↑', 'قیمت ↑') }, { v: 'high', l: tx('Price ↓', 'قیمت ↓') }]} /></div>
      </div>
      {!sorted.length ? (
        <div className="panel grid min-h-[40vh] place-items-center p-8 text-center">
          <div>
            <Store className="mx-auto h-8 w-8 text-fg-navy-300" />
            <p className="mt-2 text-[15px] font-semibold text-fg-navy-800">{data ? tx('No active listings right now', 'در حال حاضر آگهی فعالی وجود ندارد') : tx('Marketplace service is not reachable right now.', 'سرویس بازار در حال حاضر در دسترس نیست.')}</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] leading-snug text-fg-navy-500">{tx('Sellers publish listings from the core interface; every listing is tied to a real registry record with a seller mandate.', 'فروشندگان از رابط اصلی آگهی منتشر می‌کنند؛ هر آگهی به یک رکورد واقعی ثبت با نمایندگی فروشنده گره خورده است.')}</p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-2 xl:grid-cols-3 lg:overflow-y-auto thin-scroll">
          {sorted.map((l: LiveListing, i) => (
            <a key={l.id} href={l.horseId ? `#/horses/${l.horseId}` : '#/services/market'} className={cn('panel flex flex-col p-3 transition hover:shadow-md', l.status !== 'active' && 'opacity-80')} style={{ animation: `enter .35s ${Math.min(i, 10) * 35}ms both` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="truncate font-display text-[16px] font-semibold text-fg-navy-900">{l.title ?? tr(l.horseName)}</h3><p className="truncate text-[11px] text-fg-navy-500">{tr(l.horseName)}{l.breed ? ` · ${tr(l.breed)}` : ''}{l.sex ? ` · ${l.sex}` : ''}{l.birthYear ? ` · ${l.birthYear}` : ''}</p></div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', l.status === 'active' ? 'bg-emerald-100 text-fg-emerald-700' : l.status === 'reserved' ? 'bg-amber-100 text-fg-amber-700' : 'bg-slate-200 text-fg-navy-600')}>{l.status === 'active' ? tx('Active', 'فعال') : l.status === 'reserved' ? tx('Reserved', 'رزرو شده') : tx('Sold', 'فروخته شده')}</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div><div className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Asking price', 'قیمت پیشنهادی')}</div><div className="font-display text-lg font-semibold text-fg-gold-700">
                  {l.priceVisible && l.priceToman != null ? (
                    <>
                      {money(l.priceToman)} <span className="text-[10px] font-normal text-fg-navy-500">{tx('M Toman', 'م. تومان')}</span>
                      {l.negotiable && <span className="ms-1 text-[10px] text-fg-navy-500">({tx('negotiable', 'قابل مذاکره')})</span>}
                    </>
                  ) : (
                    <span className="text-[13px] text-fg-navy-500">{tx('Price on request', 'قیمت با تماس')}</span>
                  )}
                </div></div>
                <div className="text-end text-[11px] text-fg-navy-500">{l.city && <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{l.city}</div>}{l.starts != null && l.starts > 0 && <div>{n(l.starts)} {tx('competition starts', 'شروع مسابقه')}</div>}{l.listedAt && <div>{date(l.listedAt, 'short')}</div>}</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Farm tools ---------------- */
function Farm() {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const stable = useMemo(() => HORSES.filter((h) => h.owner.en === 'Farah Equestrian Co.' && statusOf(h).s === 'alive').slice(0, 8), []);
  const [exp, setExp] = useState<{ l: string; v: number }[]>([]);
  const [fv, setFv] = useState({ l: '', v: '' });
  const [toast, setToast] = useState<string | null>(null);
  const cats: [string, number, string][] = [[tx('Feed & bedding', 'خوراک و بستر'), 46, 'bg-emerald-500'], [tx('Veterinary', 'دامپزشکی'), 21, 'bg-sky-500'], [tx('Farrier', 'نعل‌بندی'), 9, 'bg-amber-500'], [tx('Training', 'آموزش'), 14, 'bg-indigo-500'], [tx('Transport & entries', 'حمل و ثبت‌نام'), 10, 'bg-teal-500']];
  const events = useMemo(() => {
    const ev: { d: number; l: string; c: string }[] = [];
    stable.slice(0, 6).forEach((h, i) => { const k = hash(h.id); ev.push({ d: 3 + ((k + i) % 26), l: `${tr(h.name)} · ${[tx('Vaccination', 'واکسن'), tx('Farrier', 'نعل‌بند'), tx('Vet check', 'معاینه'), tx('Dental', 'دندان')][k % 4]}`, c: ['bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-indigo-500'][k % 4] }); });
    stable.filter((h) => h.gender === 'mare').slice(0, 3).forEach((h, i) => { ev.push({ d: 8 + i * 9, l: `${tr(h.name)} · ${i === 0 ? tx('Foaling due', 'موعد زایش') : i === 1 ? tx('Pregnancy scan', 'سونوگرافی') : tx('Covering', 'جفت‌گیری')}`, c: 'bg-fuchsia-500' }); });
    return ev;
  }, [stable, tr, tx]);
  const reminders = stable.slice(0, 6).map((h, i) => ({ h, d: [4, 11, 19, 27, 38, 52][i], k: i % 2 === 0 ? 'v' : 'd' }));
  const total = 18400;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi phase="services" icon={<Store />} label={tx('Horses in stable', 'اسب‌های اصطبل')} value={<CountUp value={stable.length} />} />
        <Kpi phase="breeding" icon={<Baby />} label={tx('Mares in foal', 'مادیان آبستن')} value={<CountUp value={stable.filter((h) => h.gender === 'mare' && hash(h.id) % 2 === 0).length} />} />
        <Kpi phase="registry" icon={<Syringe />} label={tx('Vaccines due ≤ 30 days', 'واکسن تا ۳۰ روز')} value={<CountUp value={reminders.filter((r) => r.k === 'v' && r.d <= 30).length} />} />
        <Kpi phase="sport" icon={<FileCheck2 />} label={tx('Documents expiring', 'مدارک در شرف انقضا')} value={<CountUp value={reminders.filter((r) => r.k === 'd').length} />} />
        <Kpi phase="services" icon={<Wallet />} label={tx('This month', 'این ماه')} value={<span className="text-lg">{n(total + exp.reduce((t, e) => t + e.v, 0))}<span className="ms-1 text-[10px] font-normal text-fg-navy-500">{tx('k Toman', 'هزار تومان')}</span></span>} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="services" icon={<CalIcon />} title={tx('Breeding & care calendar · May', 'تقویم تولیدمثل و مراقبت · اردیبهشت/خرداد')} sub={tx('Coverings, scans, foalings, vaccines, farrier', 'جفت‌گیری، سونوگرافی، زایش، واکسن، نعل')} />
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-navy-400">{[tx('Mon', 'د'), tx('Tue', 'س'), tx('Wed', 'چ'), tx('Thu', 'پ'), tx('Fri', 'ج'), tx('Sat', 'ش'), tx('Sun', 'ی')].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, i) => { const day = i - 3; const ok = day >= 1 && day <= 31; const e = events.filter((x) => x.d === day); return (
              <div key={i} className={cn('min-h-[52px] rounded-lg border p-1 text-[11px]', ok ? 'border-line bg-surface-2/50' : 'border-transparent opacity-30')}>
                <span className={cn('font-semibold tabular-nums', day === 15 && ok && 'rounded bg-navy-900 px-1 text-white')}>{ok ? n(day) : ''}</span>
                {e.map((x, j) => <span key={j} title={x.l} className={cn('mt-0.5 block truncate rounded px-1 text-[10px] font-semibold text-white', x.c)}>{x.l.split('·')[1]?.trim() ?? x.l}</span>)}
              </div>); })}
          </div>
        </Card>
        <div className="min-w-0 space-y-3">
          <Card className="p-3">
            <PanelHeader phase="services" icon={<Bell />} title={tx('Reminders', 'یادآورها')} />
            <ul className="space-y-1.5">{reminders.map(({ h, d, k }) => <li key={h.id} className="flex items-center gap-2.5 rounded-xl bg-surface-2/60 p-2 text-[13px]"><span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', k === 'v' ? 'bg-sky-100 text-fg-sky-700' : 'bg-amber-100 text-fg-amber-700')}>{k === 'v' ? <Syringe className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}</span><span className="min-w-0 flex-1 leading-tight"><b className="block truncate">{tr(h.name)}</b><span className="text-[11px] text-fg-navy-500">{k === 'v' ? tx('Influenza booster', 'یادآور آنفلوانزا') : tx('Passport renewal', 'تمدید پاسپورت')}</span></span><Pill tone={d <= 14 ? 'red' : d <= 30 ? 'amber' : 'slate'}>{n(d)} {tx('days', 'روز')}</Pill></li>)}</ul>
          </Card>
          <Card className="p-3">
            <PanelHeader phase="services" icon={<Wallet />} title={tx('Expenses', 'هزینه‌ها')} />
            <div className="flex h-3 overflow-hidden rounded-full">{cats.map(([l, v, c]) => <span key={l} className={cn('h-full', c)} style={{ width: `${v}%` }} title={l} />)}</div>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">{cats.map(([l, v, c]) => <li key={l} className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', c)} /><span className="flex-1 truncate text-fg-navy-600">{l}</span><b>{n(v)}%</b></li>)}</ul>
            {can('register') && (
              <div className="mt-2.5 flex gap-1.5"><input className={cn(inputCls, '!py-1.5 !text-[13px]')} placeholder={tx('Expense…', 'هزینه…')} value={fv.l} onChange={(e) => setFv({ ...fv, l: e.target.value })} /><input className={cn(inputCls, 'w-20 !py-1.5 !text-[13px]')} placeholder="k" inputMode="numeric" value={fv.v} onChange={(e) => setFv({ ...fv, v: e.target.value.replace(/\D/g, '') })} /><button onClick={() => { if (fv.l && fv.v) { setExp((x) => [{ l: fv.l, v: +fv.v }, ...x]); setFv({ l: '', v: '' }); } }} className="grid w-9 shrink-0 place-items-center rounded-xl bg-teal-600 text-white hover:bg-teal-700" aria-label="Add"><Plus className="h-4 w-4" /></button></div>
            )}
            {exp.slice(0, 3).map((e, i) => <div key={i} className="mt-1 flex justify-between rounded-lg bg-teal-50 px-2 py-1 text-xs"><span>{e.l}</span><b>+{n(e.v)}</b></div>)}
            <button onClick={() => { setToast(tx('Operations report exported (demo)', 'گزارش عملیاتی خروجی گرفته شد (نمایشی)')); setTimeout(() => setToast(null), 2200); }} className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-xs font-semibold text-fg-navy-700 hover:bg-surface-2"><FileDown className="h-3.5 w-3.5" />{tx('Export operations report', 'خروجی گزارش عملیاتی')}</button>
          </Card>
        </div>
      </div>
      <Card className="p-3">
        <PanelHeader phase="services" icon={<Store />} title={tx('My horses', 'اسب‌های من')} />
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Horse', 'اسب')}</th><th className="pb-2 text-start font-semibold">{tx('Record', 'رکورد')}</th><th className="pb-2 text-start font-semibold">{tx('Last vet check', 'آخرین معاینه')}</th><th className="pb-2 text-start font-semibold">{tx('Status', 'وضعیت')}</th></tr></thead>
          <tbody>{stable.map((h) => <tr key={h.id} className="border-t border-line"><td className="py-1.5"><a href={`#/horses/${h.id}`} className="flex items-center gap-2 font-semibold hover:text-fg-sky-700"><Img src={px(h.photo, 60, 60)} alt="" pos={h.pos} className="h-7 w-7 rounded-md" />{tr(h.name)}</a></td><td><TrustBadge level={primaryTrust(h)} /></td><td className="tabular-nums text-fg-navy-600">{date(h.lastVet)}</td><td>{h.gender === 'mare' && hash(h.id) % 2 === 0 ? <Pill tone="fuchsia">{tx('In foal', 'آبستن')}</Pill> : <Pill tone="green" icon={<Tick className="h-3 w-3" />}>{tx('Fit', 'سالم')}</Pill>}</td></tr>)}</tbody></table></div>
      </Card>
      {toast && <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 animate-enter rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-2xl rtl:translate-x-1/2">{toast}</div>}
    </div>
  );
}

/* ---------------- Trust & process ---------------- */
function Process() {
  const { tx, n } = useI18n();
  const steps = [
    { t: tx('Submit', 'ثبت درخواست'), d: tx('The owner enters horse details and uploads documents. The rules engine checks for duplicates and inconsistencies instantly.', 'مالک مشخصات را وارد و مدارک را بارگذاری می‌کند. موتور قوانین فوراً تکراری و ناسازگاری را بررسی می‌کند.'), pts: [tx('Identity & identifiers', 'هویت و شناسه‌ها'), tx('Duplicate detection', 'تشخیص تکراری'), tx('Self-declared label', 'برچسب خوداظهاری')] },
    { t: tx('Document review', 'بررسی مدارک'), d: tx('A registry expert reviews passport, microchip and certificates, and records what was checked.', 'کارشناس ثبت پاسپورت، میکروچیپ و گواهی‌ها را بررسی و موارد بررسی‌شده را ثبت می‌کند.'), pts: [tx('Passport authenticity', 'اصالت پاسپورت'), tx('Microchip read', 'خواندن چیپ'), tx('“Reviewed” label', 'برچسب «بررسی‌شده»')] },
    { t: tx('DNA & vet', 'DNA و دامپزشک'), d: tx('Accredited labs confirm parentage; vets add health records with confidentiality levels.', 'آزمایشگاه‌های معتبر والدین را تأیید می‌کنند؛ دامپزشکان سوابق سلامت را با سطح محرمانگی ثبت می‌کنند.'), pts: [tx('STR parentage', 'والدسنجی STR'), tx('Vaccination record', 'کارنامه واکسن'), tx('Privacy level set', 'تعیین سطح حریم')] },
    { t: tx('Authority sign-off', 'تأیید مرجع'), d: tx('The competent authority confirms specific items — each approval names what exactly it covers.', 'مرجع صالح موارد مشخصی را تأیید می‌کند — هر تأیید دقیقاً دامنه خود را نام می‌برد.'), pts: [tx('Scoped approval', 'تأیید دامنه‌دار'), tx('Reference number', 'شماره مرجع'), tx('“Official” label', 'برچسب «رسمی»')] },
  ];
  const [a, setA] = useState(0);
  const rows: [string, string, string, string, string][] = [
    [tx('Name, breed, sex, birth year', 'نام، نژاد، جنس، سال تولد'), 'full', 'full', 'full', 'full'], [tx('Pedigree & results', 'شجره و نتایج'), 'full', 'full', 'full', 'full'], [tx('Owner details', 'اطلاعات مالک'), 'part', 'full', 'part', 'full'],
    [tx('Health records', 'سوابق سلامت'), 'sum', 'full', 'full', 'full'], [tx('DNA & genetic reports', 'DNA و گزارش ژنتیکی'), 'sum', 'full', 'part', 'full'], [tx('Passport & ID images', 'پاسپورت و تصاویر هویتی'), 'none', 'full', 'none', 'full'],
  ];
  const cell = (v: string) => v === 'full' ? <CircleCheck className="mx-auto h-4 w-4 text-fg-emerald-600" /> : v === 'sum' ? <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-fg-sky-800">{tx('Summary', 'خلاصه')}</span> : v === 'part' ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-fg-amber-800">{tx('If allowed', 'در صورت مجوز')}</span> : <Lock className="mx-auto h-3.5 w-3.5 text-slate-400" />;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
        <ol className="panel flex gap-1 p-2.5 max-xl:overflow-x-auto xl:flex-col xl:p-3">
          {steps.map((s, i) => (
            <li key={i} className="relative xl:pb-3 xl:last:pb-0">
              {i < steps.length - 1 && <span className={cn('absolute start-[19px] top-10 hidden h-[calc(100%-32px)] w-0.5 rounded xl:block', i < a ? 'bg-teal-500' : 'bg-line')} />}
              <button onClick={() => setA(i)} className={cn('relative flex w-full items-center gap-3 rounded-xl p-1.5 text-start transition', i === a ? 'bg-teal-100/70' : 'hover:bg-surface-2')}>
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors', i < a ? 'bg-teal-600 text-white' : i === a ? 'bg-navy-900 text-white' : 'bg-surface-2 text-fg-navy-500 ring-1 ring-line')}>{i < a ? <Check className="h-4 w-4" strokeWidth={3} /> : n(i + 1)}</span>
                <span className="font-semibold text-fg-navy-900 max-xl:whitespace-nowrap">{s.t}</span>
              </button>
            </li>
          ))}
        </ol>
        <div key={a} className="panel flex animate-enter flex-col justify-between p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg-teal-700">{tx('Step', 'گام')} {n(a + 1)} / {n(steps.length)}</div>
            <h3 className="mt-1 font-display text-xl font-semibold">{steps[a].t}</h3>
            <p className="mt-1.5 max-w-xl text-sm text-fg-navy-600">{steps[a].d}</p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">{steps[a].pts.map((p) => <li key={p} className="flex items-center gap-2 rounded-xl bg-surface-2 p-2.5 text-[13px] font-medium"><Tick className="h-5 w-5" />{p}</li>)}</ul>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <button onClick={() => setA((x) => Math.max(0, x - 1))} disabled={a === 0} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold transition hover:bg-surface-2 disabled:opacity-40">{tx('Previous', 'قبلی')}</button>
            {a < steps.length - 1 ? <button onClick={() => setA((x) => x + 1)} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700">{tx('Next step', 'گام بعدی')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
              : <a href="#/horses/register" className="btn-gold inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white">{tx('Start registration', 'شروع ثبت')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></a>}
          </div>
        </div>
      </div>
      <Card className="p-3">
        <PanelHeader phase="services" icon={<ShieldCheck />} title={tx('Six levels of trust', 'شش سطح اعتبار')} sub={tx('Approvals are scoped: “passport reviewed” never means “parentage DNA-verified”', 'تأییدها دامنه‌دار هستند: «پاسپورت بررسی شد» هرگز به معنی «والدین با DNA تأیید شد» نیست')} />
        <TrustLegend />
      </Card>
      <Card className="p-3">
        <PanelHeader phase="services" icon={<Lock />} title={tx('Who can see what', 'چه کسی چه چیزی می‌بیند')} sub={tx('Verification by a vet or lab does not make details public', 'تأیید توسط دامپزشک یا آزمایشگاه جزئیات را عمومی نمی‌کند')} />
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Information', 'اطلاعات')}</th><th className="pb-2 font-semibold">{tx('Public', 'عموم')}</th><th className="pb-2 font-semibold">{tx('Owner', 'مالک')}</th><th className="pb-2 font-semibold">{tx('Vet / lab', 'دامپزشک / آزمایشگاه')}</th><th className="pb-2 font-semibold">{tx('Federation', 'فدراسیون')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-line text-center"><td className="py-2 text-start font-medium">{r[0]}</td>{r.slice(1).map((v, i) => <td key={i}>{cell(v)}</td>)}</tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
