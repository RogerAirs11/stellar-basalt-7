import { useState } from 'react';
import { ArrowRight, FileCheck2, GitBranch, HeartHandshake, Search, Trophy } from 'lucide-react';
import { HORSES, horseById, px , REGISTRY_TOTAL} from '../data';
import { primaryTrust } from '../records';
import { useI18n } from '../i18n';
import { CountUp, Ornament, TrustBadge } from '../components/ui';
import { useAppearance } from '../appearance';
import { Page } from '../components/Shell';
import { go } from '../lib';
import { isHydrated, useHydratedTick } from '../live';
import { cn } from '../utils/cn';

/** A quiet eight-point star lattice — the geometry of Persian tilework, drawn as hairlines */
function GeoPattern() {
  return (
    <svg className="geo-fade pointer-events-none absolute inset-0 h-full w-full text-fg-navy-500 opacity-[.085]" aria-hidden>
      <defs>
        <pattern id="geo" width="64" height="64" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="14" y="14" width="36" height="36" />
            <rect x="14" y="14" width="36" height="36" transform="rotate(45 32 32)" />
            <circle cx="32" cy="32" r="6" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo)" />
    </svg>
  );
}

function WelcomeModern() {
  const { tx, tr, lang, n, rtl } = useI18n();
  const [q, setQ] = useState('');
  useHydratedTick(); // once live data lands, the hero features the registry's leading horse
  const hero = (isHydrated() && HORSES[0]) || horseById('nika')!;
  const search = (v: string) => go('/horses' + (v ? `?q=${encodeURIComponent(v)}` : ''));
  const nast = lang === 'fa' ? 'font-nastaliq' : '';
  // the photo sits on the end side and melts toward the text side
  const fade = `linear-gradient(to ${rtl ? 'right' : 'left'}, #000 52%, transparent 100%)`;
  const nastStyle = lang === 'fa' ? { fontSize: '0.84em', lineHeight: 1.45, marginTop: '-0.12em', paddingBottom: '0.22em' } : undefined;

  const doors = [
    { to: '/horses', icon: <FileCheck2 />, verb: tx('Register', 'ثبت'), line: tx('One national identity for every horse, with each fact marked by how far it can be trusted.', 'یک شناسه ملی برای هر اسب و هر اطلاعات با سطح اعتبار مشخص.') },
    { to: '/breeding', icon: <HeartHandshake />, verb: tx('Breed', 'پرورش'), line: tx('Compare pedigrees, see shared ancestors and plan matings with clear limits.', 'شجره‌ها را مقایسه کنید، نیاکان مشترک را ببینید و جفت‌گیری را برنامه‌ریزی کنید.') },
    { to: '/sport', icon: <Trophy />, verb: tx('Compete', 'رقابت'), line: tx('Results linked to the horse’s ID, with the source of every placing shown.', 'نتایج متصل به شناسه اسب، با نمایش منبع هر رتبه.') },
    { to: '/horses/persian-star/pedigree', icon: <GitBranch />, verb: tx('Preserve', 'حفظ'), line: tx('Lineages and records kept safe — and open to inspection for future generations.', 'تبارها و سوابق ایمن و قابل بررسی برای نسل‌های آینده.') },
  ];
  const stats: [number, string][] = [[REGISTRY_TOTAL, tx('registered horses', 'اسب ثبت‌شده')], [7, tx('generations of pedigree', 'نسل شجره')], [2, tx('languages · RTL ready', 'زبان · چیدمان راست‌به‌چپ')]];

  return (
    <Page phase="home">
      <div className="mx-auto max-w-6xl space-y-6 pb-8 pt-1">
        {/* ============ hero ============ */}
        <section className="relative isolate overflow-hidden rounded-[18px] border border-line bg-surface">
          <GeoPattern />

          {/* photograph: full height, flush with the card edge, dissolving into the page colour */}
          <div className="pointer-events-none absolute inset-y-0 end-0 hidden w-[46%] md:block lg:w-[44%]" aria-hidden>
            <img src={px(hero.photo, 1000, 1000)} alt="" className="h-full w-full object-cover" style={{ objectPosition: 'center 28%', WebkitMaskImage: fade, maskImage: fade }} />
          </div>
          <a href={`#/horses/${hero.id}`} className="absolute bottom-4 end-4 hidden items-center gap-3 rounded-lg border border-line bg-surface/95 py-2 pe-3.5 ps-2.5 shadow-md shadow-black/10 backdrop-blur transition hover:border-od-gold-300 md:flex">
            <span className="h-9 w-[3px] rounded-full bg-od-gold-400" />
            <span className="leading-tight">
              <span className="block text-[13px] font-bold text-fg-navy-900">{tr(hero.name)}</span>
              <span className="mt-0.5 block text-[11px] text-fg-navy-500">{tr(hero.breed)}{hero.regId ? <> · <span className="font-mono" dir="ltr">{hero.regId}</span></> : null}</span>
            </span>
          </a>

          <div className="relative px-5 py-7 sm:px-10 sm:py-9 md:pe-[47%] lg:pe-[45%]">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <img src="/f/modern-horse/logo.webp" alt="" className="h-12 w-12 rounded-full object-contain ring-1 ring-od-gold-300/50" />
                <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.3em] text-fg-gold-700">
                  <span className="h-px w-8 bg-od-gold-400" />{tx('National Equine Registry', 'ثبت ملی اسب')}
                </div>
              </div>
              <h1 className="mt-3.5 text-balance font-display text-[2.1rem] font-semibold leading-[1.1] text-fg-navy-900 sm:text-[2.2rem] lg:text-[2.6rem] xl:text-[2.9rem]">
                {tx('The national home of', 'خانه ملی')}
                <span className={cn('block text-fg-gold-700', nast)} style={nastStyle}>{tx('Iran’s horses', 'اسب‌های ایران')}</span>
              </h1>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fg-navy-600">{tx('Find any horse, trace its bloodline and trust what you see — registered, verified and preserved in one place.', 'هر اسبی را بیابید، تبار آن را دنبال کنید و به آنچه می‌بینید اعتماد کنید — ثبت، تأیید و نگهداری در یک‌جا.')}</p>
              <form onSubmit={(e) => { e.preventDefault(); search(q.trim()); }} className="mt-5 flex w-full max-w-xl items-center gap-1.5 rounded-xl border border-line bg-field p-1.5 shadow-sm focus-within:border-od-gold-300 focus-within:ring-4 focus-within:ring-od-gold-300/25">
                <Search className="ms-2.5 h-5 w-5 shrink-0 text-fg-navy-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('Search horses', 'جستجوی اسب')} placeholder={tx('Search by name or ID', 'جستجو با نام یا شناسه')} className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-fg-navy-900 outline-none placeholder:text-fg-navy-400" />
                <button className="btn-gold inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition active:scale-95 sm:px-5">{tx('Search', 'جستجو')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
              </form>
              <dl className="mt-6 grid max-w-xl grid-cols-3 gap-4 border-t border-line pt-4" aria-label={tx('The registry in numbers', 'ثبت ملی در یک نگاه')}>
                {stats.map(([v, l], i) => (
                  <div key={l} className={cn('min-w-0', i > 0 && 'border-s border-line ps-4')}>
                    <dd className="font-display text-2xl font-semibold leading-none text-fg-navy-900 sm:text-[1.65rem]"><CountUp value={v} /></dd>
                    <dt className="mt-1.5 text-[11px] font-medium leading-tight text-fg-navy-500">{l}</dt>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ============ four doors — one ledger, hairline-divided ============ */}
        <section aria-labelledby="start">
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
            {doors.map((d, i) => (
              <a key={d.verb} href={'#' + d.to} className="group relative flex flex-col gap-2.5 bg-surface p-5 transition-colors duration-300 hover:bg-surface-2" style={{ animation: `enter .5s ${i * 70}ms both` }}>
                <span className="absolute inset-x-0 top-0 h-0.5 origin-center scale-x-0 bg-od-gold-400 transition-transform duration-300 group-hover:scale-x-100" />
                <div className="flex items-center justify-between">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy-100 text-fg-navy-700 [&>svg]:h-[18px] [&>svg]:w-[18px]">{d.icon}</span>
                  <span className="font-display text-sm font-semibold text-fg-navy-400">{n('0' + (i + 1))}</span>
                </div>
                <div className="font-display text-xl font-semibold text-fg-navy-900">{d.verb}</div>
                <p className="flex-1 text-sm leading-relaxed text-fg-navy-600">{d.line}</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-gold-700">{tx('Open', 'باز کردن')}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" /></span>
              </a>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-xs text-fg-navy-500">
          <span className="flex items-center gap-2"><img src="/f/modern-horse/logo.webp" alt="" className="h-5 w-5 rounded-full object-contain" />© 2025 {tx('Iran National Equine Platform', 'پلتفرم ملی اسب ایران')}</span>
          <span className="flex items-center gap-4 font-semibold"><a href="#/horses" className="hover:text-fg-navy-900">{tx('Registry', 'ثبت اسب‌ها')}</a><a href="#/breeding" className="hover:text-fg-navy-900">{tx('Breeding', 'پرورش')}</a><a href="#/dashboard" className="hover:text-fg-navy-900">{tx('Dashboard', 'داشبورد')}</a></span>
        </footer>
      </div>
    </Page>
  );
}

/* =====================================================================
   CLASSIC home — a masthead, a framed plate, four numbered columns.
   Nothing here is boxed: hairlines, serif type, and one photograph given room to breathe.
   ===================================================================== */
function WelcomeClassic() {
  const { tx, tr, lang, n } = useI18n();
  const [q, setQ] = useState('');
  const fa = lang === 'fa';
  const hero = horseById('nika')!;
  const search = (v: string) => go('/horses' + (v ? `?q=${encodeURIComponent(v)}` : ''));
  const roman = ['I', 'II', 'III', 'IV'];
  const tries = [tr(horseById('persian-star')!.name), tr(hero.name), tr(hero.breed)];

  const doors = [
    { to: '/horses', verb: tx('Register', 'ثبت'), line: tx('One national identity for every horse, with each fact marked by how far it can be trusted.', 'یک شناسه ملی برای هر اسب و هر اطلاعات با سطح اعتبار مشخص.') },
    { to: '/breeding', verb: tx('Breed', 'پرورش'), line: tx('Compare pedigrees, see shared ancestors and plan matings with clear limits.', 'شجره‌ها را مقایسه کنید، نیاکان مشترک را ببینید و جفت‌گیری را برنامه‌ریزی کنید.') },
    { to: '/sport', verb: tx('Compete', 'رقابت'), line: tx('Results linked to the horse’s ID, with the source of every placing shown.', 'نتایج متصل به شناسه اسب، با نمایش منبع هر رتبه.') },
    { to: '/horses/persian-star/pedigree', verb: tx('Preserve', 'حفظ'), line: tx('Lineages, DNA and records kept safe — and open to inspection for future generations.', 'تبارها، DNA و سوابق ایمن و قابل بررسی برای نسل‌های آینده.') },
  ];
  const stats: [number, string][] = [[REGISTRY_TOTAL, tx('registered horses', 'اسب ثبت‌شده')], [7, tx('generations of pedigree', 'نسل شجره')], [2, tx('languages · RTL ready', 'زبان · چیدمان راست‌به‌چپ')]];

  return (
    <Page phase="home">
      <div className="mx-auto max-w-5xl pb-10 pt-2">
        {/* ---- masthead ---- */}
        <header className="px-2 pt-4 text-center sm:pt-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.36em] text-fg-gold-700">{tx('National Equine Registry', 'ثبت ملی اسب')}</div>
          <Ornament className="mx-auto mt-3" />
          <h1 className="mt-5 text-balance font-display text-[2.5rem] font-medium leading-[1.04] text-fg-navy-900 sm:text-[3.7rem]">
            {tx('The national home of', 'خانه ملی')}
            <span className={cn('block text-fg-gold-700', fa ? 'font-nastaliq' : 'italic')} style={fa ? { fontSize: '0.8em', lineHeight: 1.5, paddingBottom: '.15em' } : undefined}>{tx('Iran’s horses', 'اسب‌های ایران')}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-[16px] italic leading-relaxed text-fg-navy-600">{tx('Find any horse, trace its bloodline and trust what you see — registered, verified and preserved in one place.', 'هر اسبی را بیابید، تبار آن را دنبال کنید و به آنچه می‌بینید اعتماد کنید — ثبت، تأیید و نگهداری در یک‌جا.')}</p>
          <form onSubmit={(e) => { e.preventDefault(); search(q.trim()); }} className="mx-auto mt-7 flex max-w-md items-end gap-3 border-b border-fg-navy-400/60 pb-1.5 focus-within:border-od-gold-400">
            <Search className="mb-1 h-4 w-4 shrink-0 text-fg-navy-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('Search horses', 'جستجوی اسب')} placeholder={tx('Search by name or ID', 'جستجو با نام یا شناسه')} className="min-w-0 flex-1 bg-transparent text-[16px] text-fg-navy-900 outline-none placeholder:italic placeholder:text-fg-navy-400" />
            <button className="mb-0.5 inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-fg-gold-700 transition hover:text-fg-gold-800">{tx('Search', 'جستجو')}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></button>
          </form>
          <div className="mt-3 text-[13px] italic text-fg-navy-500">
            {tx('Try', 'امتحان کنید')}{' '}
            {tries.map((x, i) => <span key={x}>{i > 0 && ' · '}<button onClick={() => search(x)} className="not-italic text-fg-navy-700 underline decoration-od-gold-400/70 decoration-1 underline-offset-4 transition hover:text-fg-gold-700">{x}</button></span>)}
          </div>
        </header>

        {/* ---- the plate ---- */}
        <figure className="mx-2 mt-9 sm:mx-6">
          <div className="plate">
            <div className="relative aspect-[4/3] overflow-hidden sm:aspect-[16/8]">
              <img src={px(hero.photo, 1600, 900)} alt={tr(hero.name)} className="h-full w-full object-cover" style={{ objectPosition: 'center 6%' }} />
            </div>
          </div>
          <figcaption className="mt-5 text-center">
            <div className="font-display text-[1.05rem] italic text-fg-navy-600">
              {tx('Plate I', 'تصویر ۱')} — <a href={`#/horses/${hero.id}`} className="not-italic font-semibold text-fg-navy-900 underline decoration-od-gold-400/70 underline-offset-4 hover:text-fg-gold-700">{tr(hero.name)}</a>, {tr(hero.breed)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-fg-navy-500"><span className="font-mono" dir="ltr">{hero.regId}</span><TrustBadge level={primaryTrust(hero)} long /></div>
          </figcaption>
        </figure>

        {/* ---- the registry in a sentence ---- */}
        <p className="mx-auto mt-9 max-w-2xl px-2 text-center font-display text-[1.15rem] italic leading-relaxed text-fg-navy-600">
          {stats.map(([v, l], i) => <span key={l}>{i > 0 && <span className="mx-2 text-fg-gold-500" aria-hidden>◆</span>}<b className="stat-num not-italic font-semibold text-fg-navy-900"><CountUp value={v} /></b> {l}</span>)}
        </p>

        {/* ---- four columns ---- */}
        <section className="mt-12" aria-labelledby="start">
          <div className="mb-5 flex items-center gap-4"><span className="h-px flex-1 bg-line" /><h2 id="start" className="font-display text-[1.45rem] font-semibold text-fg-navy-900">{tx('Where would you like to begin?', 'از کجا شروع می‌کنید؟')}</h2><span className="h-px flex-1 bg-line" /></div>
          <div className="grid gap-px overflow-hidden bg-line sm:grid-cols-2 lg:grid-cols-4">
            {doors.map((d, i) => (
              <a key={d.verb} href={'#' + d.to} className="group flex flex-col bg-canvas px-5 py-6 transition-colors duration-300 hover:bg-surface" style={{ animation: `enter .5s ${i * 70}ms both` }}>
                <span className="font-display text-[1.7rem] italic leading-none text-fg-gold-600">{fa ? n(i + 1) : roman[i]}</span>
                <span className="mt-3 font-display text-[1.6rem] font-semibold leading-none text-fg-navy-900">{d.verb}</span>
                <span className="mt-2.5 flex-1 text-[14px] leading-relaxed text-fg-navy-600">{d.line}</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-fg-gold-700">{tx('Open', 'باز کردن')}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" /></span>
              </a>
            ))}
          </div>
        </section>

        <footer className="mt-14 text-center">
          <Ornament className="mx-auto" />
          <p className="mt-3 text-[12px] italic text-fg-navy-500">© 2025 {tx('Iran National Equine Platform', 'پلتفرم ملی اسب ایران')}</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-navy-500"><a href="#/dashboard" className="hover:text-fg-navy-900">{tx('Dashboard', 'داشبورد')}</a><span className="mx-2.5 text-fg-gold-500">·</span><a href="#/roadmap" className="hover:text-fg-navy-900">{tx('Scope & roadmap', 'دامنه و نقشه راه')}</a><span className="mx-2.5 text-fg-gold-500">·</span><a href="#/news" className="hover:text-fg-navy-900">{tx('News', 'اخبار')}</a></p>
        </footer>
      </div>
    </Page>
  );
}

export function Welcome() {
  const { style } = useAppearance();
  return style === 'classic' ? <WelcomeClassic /> : <WelcomeModern />;
}
