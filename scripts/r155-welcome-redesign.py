#!/usr/bin/env python3
"""R155 part 2 — Welcome redesign: minimal, logo, no scroll fest (both variants)."""
import subprocess, sys

REPO = '/home/z/my-project'
P = 'src/donor-apps/modern-horse/src/pages/Welcome.tsx'

s = subprocess.run(['git', '-C', REPO, 'cat-file', '-p', f'HEAD:{P}'],
                   capture_output=True, text=True, check=True).stdout

def swap(old, new, expect=1):
    global s
    n = s.count(old)
    if n != expect:
        print(f'FAIL: match count {n} (want {expect}) for: {old[:80]!r}')
        sys.exit(1)
    s = s.replace(old, new)

# ---- imports ----
swap("""import { useState } from 'react';
import { ArrowRight, Download, FileCheck2, GitBranch, Globe, HeartHandshake, Dna, Search, Trophy } from 'lucide-react';
import { horseById, px , REGISTRY_TOTAL} from '../data';
import { TRUST_L, TRUST_ORDER, primaryTrust } from '../records';
import { useI18n } from '../i18n';
import { CountUp, Ornament, TrustBadge, trustBar } from '../components/ui';
import { useAppearance } from '../appearance';
import { HorseCard } from '../components/HorseCard';
import { Page } from '../components/Shell';
import { go } from '../lib';
import { cn } from '../utils/cn';""",
"""import { useState } from 'react';
import { ArrowRight, FileCheck2, GitBranch, HeartHandshake, Search, Trophy } from 'lucide-react';
import { HORSES, horseById, px , REGISTRY_TOTAL} from '../data';
import { primaryTrust } from '../records';
import { useI18n } from '../i18n';
import { CountUp, Ornament, TrustBadge } from '../components/ui';
import { useAppearance } from '../appearance';
import { Page } from '../components/Shell';
import { go } from '../lib';
import { isHydrated, useHydratedTick } from '../live';
import { cn } from '../utils/cn';""")

# ---- replace the whole WelcomeModern component ----
MODERN = """function WelcomeModern() {
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

"""
i = s.find('function WelcomeModern() {')
j = s.find('/* =====================================================================')
if i < 0 or j < 0 or j <= i:
    print('FAIL: WelcomeModern boundaries not found'); sys.exit(1)
s = s[:i] + MODERN + s[j:]

# ---- classic: honest stats ----
swap("""  const stats: [number, string][] = [[REGISTRY_TOTAL, tx('registered horses', 'اسب ثبت‌شده')], [9870, tx('DNA profiles', 'پروفایل DNA')], [1240, tx('licensed breeders', 'پرورش‌دهنده مجاز')]];""",
"""  const stats: [number, string][] = [[REGISTRY_TOTAL, tx('registered horses', 'اسب ثبت‌شده')], [7, tx('generations of pedigree', 'نسل شجره')], [2, tx('languages · RTL ready', 'زبان · چیدمان راست‌به‌چپ')]];""")

# ---- classic: drop now-unused vars ----
swap("  const featured = ['nika', 'simorgh', 'arash', 'shabrang'].map((id) => horseById(id)!).filter(Boolean);\n", "")
swap("  const ladder = TRUST_ORDER.filter((l) => l !== 'conflict');\n", "")

# ---- classic: delete the trust + horses sections (keep masthead/plate/sentence/columns/footer) ----
a = s.find('        {/* ---- trust, set quietly ---- */}')
b = s.find('        <footer className="mt-14 text-center">')
if a < 0 or b < 0 or b <= a:
    print('FAIL: classic section boundaries not found'); sys.exit(1)
s = s[:a] + s[b:]

# ---- classic footer: honest title ----
swap("""© 2025 {tx('Iran National Equine Platform — design demo with sample data', 'پلتفرم ملی اسب ایران — نمونه طراحی با داده‌های نمونه')}""",
"""© 2025 {tx('Iran National Equine Platform', 'پلتفرم ملی اسب ایران')}""")

with open(f'{REPO}/{P}', 'w') as f:
    f.write(s)
print(f'OK {P} ({len(s)} bytes)')
