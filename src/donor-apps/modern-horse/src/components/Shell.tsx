import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dna as DnaIcon, FileCheck2 as RegIcon, Trophy as CupIcon, Feather, LayoutGrid, Layers as LayersIcon } from 'lucide-react';
import {
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Home as HomeIcon, LayoutDashboard, Menu, SwatchBook, Sun, Moon, Monitor, House, Search, X, Newspaper, Building2, Map as MapIcon, CalendarDays, Check,
} from 'lucide-react';
import { HORSES, horseById, px } from '../data';
import { SCHEMES, swatch, useAppearance, type Mode, type Style } from '../appearance';
import { ALL_RIDERS, BREEDERS, NEWS } from '../people';
import { L, useI18n } from '../i18n';
import { getNav, groupOfPath, horseFromPath, horseTabs, type NavGroup } from '../nav';
import { PHASE, SEX, type PhaseKey } from '../theme';
import { ROLES, useRole } from '../role';
import { TRUST_L, TRUST_ORDER, aliasesOf, idsOf } from '../records';
import { TrustBadge } from './ui';
import { go, useMedia, useRoute } from '../lib';
import { Avatar, Emblem, Img, Logo } from './ui';
import { cn } from '../utils/cn';

/* =====================================================================
   Language switch
   ===================================================================== */
export function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div dir="ltr" className="relative grid grid-cols-2 rounded-full bg-surface-2 p-0.5 text-[11px] font-bold ring-1 ring-line">
      <span className={cn('absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full bg-navy-900 shadow transition-all duration-500', lang === 'en' ? 'left-0.5' : 'left-1/2')} />
      <button onClick={() => setLang('en')} className={cn('relative z-10 px-2.5 py-1 transition-colors max-sm:py-2', lang === 'en' ? 'text-white' : 'text-fg-navy-600 hover:text-fg-navy-900')}>EN</button>
      <button onClick={() => setLang('fa')} className={cn('relative z-10 px-2.5 py-1 font-[Vazirmatn] transition-colors', lang === 'fa' ? 'text-white' : 'text-fg-navy-600 hover:text-fg-navy-900')}>فارسی</button>
    </div>
  );
}

/* =====================================================================
   Sidebar — tree style navigation
   ===================================================================== */
export function Sidebar({ path, collapsed, onCollapse, open, onClose }: { path: string; collapsed: boolean; onCollapse: () => void; open: boolean; onClose: () => void }) {
  const { tx, tr, rtl } = useI18n();
  const wide = useMedia('(min-width:1024px)');
  const rail = collapsed && wide;
  const closeRef = useRef<HTMLButtonElement>(null);
  const dismiss = useRef(onClose); dismiss.current = onClose;
  useEffect(() => {
    if (!open || wide) return;
    const btn = document.getElementById('modern-more');
    closeRef.current?.focus({preventScroll:true});
    const escape = (e:KeyboardEvent) => { if(e.key==='Escape'){e.preventDefault();dismiss.current();} };
    document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('keydown',escape); btn?.focus({preventScroll:true}); };
  },[open,wide]);
  const { can, def } = useRole();
  const groups = getNav(tx).filter((g) => g.key !== 'admin' || can('admin') || can('reports')).map((g) => ({ ...g, leaves: g.leaves.filter((l) => !l.need || can(l.need)) }));
  const active = groupOfPath(path);
  const horse = horseFromPath(path);
  const horseRec = horse ? horseById(horse.id) : null;
  const [openG, setOpenG] = useState<Record<string, boolean>>({ [active]: true });
  useEffect(() => setOpenG({ [active]: true }), [active]);

  return (
    <>
      <div onClick={onClose} className={cn('sb-scrim fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-sm transition-opacity duration-500 lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside
        id="modern-navigation" inert={!wide && !open} role={!wide && open ? 'dialog' : undefined} aria-modal={!wide && open || undefined}
        aria-label={tx('Navigation','پیمایش')} onClick={e=>{if(!wide && (e.target as Element).closest('a[href]'))onClose()}}
        data-rail={rail ? '1' : '0'}
        className={cn(
          'sb z-50 flex shrink-0 flex-col sidebar-bg sb-fg2 shadow-2xl shadow-black/25 transition-all duration-500 max-lg:fixed max-lg:inset-y-0 max-lg:start-0 max-lg:w-[272px]',
          open ? 'max-lg:translate-x-0' : rtl ? 'max-lg:translate-x-full' : 'max-lg:-translate-x-full',
          rail ? 'lg:w-[68px]' : 'lg:w-[236px]',
        )}
      >
        <div className="relative flex h-12 shrink-0 items-center justify-between px-3">
          <a href="#/" aria-label="Home"><Logo compact={rail} /></a>
          <button ref={closeRef} onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full sb-fg2 sb-hv lg:hidden" aria-label={tx('Close navigation','بستن پیمایش')}><X className="h-4 w-4" /></button>
          <span className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent" />
        </div>

        <nav className="thin-scroll flex-1 space-y-0.5 overflow-y-auto px-2 py-2" aria-label={tx('Main','اصلی')}>
          {([['/', tx('Home', 'خانه'), <House key="h" className="h-3.5 w-3.5" />], ['/dashboard', tx('Dashboard', 'داشبورد'), <LayoutDashboard key="d" className="h-3.5 w-3.5" />]] as [string, string, React.ReactNode][]).map(([to, label, ic]) => (
            <a key={to} href={'#' + to} title={label} className={cn('sb-label flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition', path === to ? 'sb-act' : 'sb-fg2 sb-hv', rail && 'justify-center')}>
              <span className={'sb-chip sb-ico grid h-7 w-7 shrink-0 place-items-center rounded-md'}>{ic}</span>
              {!rail && label}
            </a>
          ))}
          <a href="#/roadmap" title={tx('Scope & roadmap', 'دامنه و نقشه راه')} className={cn('sb-label flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition', path === '/roadmap' ? 'sb-act' : 'sb-fg2 sb-hv', rail && 'justify-center')}>
            <span className={'sb-chip sb-ico grid h-7 w-7 shrink-0 place-items-center rounded-md'}><MapIcon className="h-3.5 w-3.5" /></span>
            {!rail && tx('Scope & roadmap', 'دامنه و نقشه راه')}
          </a>
          <a href="#/platform" title={tx('Platform & capabilities', 'پلتفرم و قابلیت‌ها')} className={cn('sb-label flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition', path === '/platform' ? 'sb-act' : 'sb-fg2 sb-hv', rail && 'justify-center')}>
            <span className={'sb-chip sb-ico grid h-7 w-7 shrink-0 place-items-center rounded-md'}><LayersIcon className="h-3.5 w-3.5" /></span>
            {!rail && tx('Platform & capabilities', 'پلتفرم و قابلیت‌ها')}
          </a>
          {rail ? <div className="sb-rule mx-auto my-2 h-px w-8" /> : <div className="px-2 pb-0.5 pt-3 text-[10px] font-bold uppercase tracking-[0.24em] sb-fg3">{tx('Modules', 'بخش‌ها')}</div>}

          {groups.map((g) => (
            <Group key={g.key} g={g} rail={rail} isOpen={!!openG[g.key]} isCurrent={active === g.key} toggle={() => setOpenG((o) => ({ ...o, [g.key]: !o[g.key] }))}>
              {g.leaves.map((l) => {
                const here = path === l.to;
                const isExplore = l.to === '/horses';
                return (
                  <li key={l.to} className="relative">
                    <Connector />
                    <Leaf to={l.to} label={l.label} icon={l.icon} active={here || (isExplore && !!horse)} phase={g.key} exact={here} />
                    {isExplore && horse && horseRec && (
                      <ul className="relative ms-2.5 mt-0.5 animate-enter space-y-0.5 border-s sb-bd ps-2.5">
                        <li className="flex items-start gap-2 px-1.5 py-1">
                          <Img src={px(horseRec.photo, 60, 60)} alt="" pos={horseRec.pos} className="mt-0.5 h-5 w-5 shrink-0 rounded-md" />
                          <span className="text-xs font-bold leading-tight sb-accent">{tr(horseRec.name)}</span>
                        </li>
                        {horseTabs(horse.id, tx).map((t) => (
                          <li key={t.to} className="relative"><Connector /><Leaf to={t.to} label={t.label} icon={t.icon} active={path === t.to} phase="registry" exact={path === t.to} small /></li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </Group>
          ))}
        </nav>

        <div className="shrink-0 border-t sb-bd p-2">
          <div className={cn('flex items-center gap-2.5 rounded-lg sb-card p-1.5', rail && 'justify-center')}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-od-gold-300 to-gold-500 text-[11px] font-bold text-black/80">{tr(def.person).split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
            {!rail && <div className="min-w-0 leading-tight"><div className="truncate text-[13px] font-semibold sb-fg">{tr(def.person)}</div><div className="truncate text-[10px] sb-fg3">{tr(def.title)}</div></div>}
          </div>
          <button onClick={onCollapse} className="mt-1 hidden w-full items-center justify-center gap-2 rounded-lg py-1.5 text-[11px] sb-fg3 sb-hv transition lg:flex">
            {rail ? (rtl ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />) : (rtl ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />)}
            {!rail && tx('Collapse', 'جمع کردن')}
          </button>
        </div>
      </aside>
    </>
  );
}

const Connector = () => <span className="absolute -start-2.5 top-[15px] h-px w-2.5 sb-rule" />;

function Group({ g, rail, isOpen, isCurrent, toggle, children }: { g: NavGroup; rail: boolean; isOpen: boolean; isCurrent: boolean; toggle: () => void; children: ReactNode }) {
  if (rail)
    return (
      <a href={'#' + g.to} title={g.label} className={cn('mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition', isCurrent ? 'sb-act' : 'sb-hv')}>
        <span className={'sb-chip sb-ico grid h-7 w-7 shrink-0 place-items-center rounded-md'}>{g.icon}</span>
      </a>
    );
  return (
    <div>
      <button onClick={toggle} aria-expanded={isOpen} className={cn('relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition', isCurrent ? 'sb-act' : 'sb-fg2 sb-hv')}>
        {isCurrent && <span className={'absolute inset-y-1.5 -start-0.5 w-[3px] rounded-full sb-bar'} />}
        <span className={'sb-chip sb-ico grid h-7 w-7 shrink-0 place-items-center rounded-md'}>{g.icon}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="sb-label block text-[13px] font-semibold">{g.label}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 sb-fg3 transition-transform duration-300', isOpen && 'rotate-180')} />
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-500 ease-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden"><ul className="relative ms-[22px] mt-0.5 space-y-0.5 border-s sb-bd ps-2.5 pb-1">{children}</ul></div>
      </div>
    </div>
  );
}

function Leaf({ to, label, icon, active, small, exact }: { to: string; label: string; icon: ReactNode; active: boolean; phase: PhaseKey; small?: boolean; exact?: boolean }) {
  return (
    <a href={'#' + to} aria-current={exact ? 'page' : undefined} className={cn('flex items-center gap-2 rounded-md px-2 transition', small ? 'py-0.5 text-[11px] max-lg:py-2.5' : 'py-1 text-[13px] max-lg:py-2.5', exact ? 'sb-act font-semibold' : active ? 'sb-fg font-semibold' : 'sb-fg3 sb-hv')}>
      <span className={cn('sb-ico shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5', active ? 'sb-accent' : 'sb-fg3')}>{icon}</span>
      <span className="leading-tight">{label}</span>
      {exact && <span className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full sb-bar" />}
    </a>
  );
}

/* =====================================================================
   Topbar — breadcrumbs, global search, colour key
   ===================================================================== */
function Breadcrumbs({ path }: { path: string }) {
  const { tx, tr } = useI18n();
  const groups = getNav(tx);
  const g = groupOfPath(path);
  const items: { label: string; to?: string; phase?: PhaseKey }[] = [];
  if (g === 'home') items.push({ label: path === '/roadmap' ? tx('Scope & roadmap', 'دامنه و نقشه راه') : path === '/platform' ? tx('Platform & capabilities', 'پلتفرم و قابلیت‌ها') : path === '/dashboard' ? tx('Dashboard', 'داشبورد') : tx('Home', 'خانه') });
  else {
    const grp = groups.find((x) => x.key === g)!;
    items.push({ label: grp.label, to: grp.to, phase: g });
    const horse = horseFromPath(path);
    if (horse) {
      const h = horseById(horse.id);
      const tab = horseTabs(horse.id, tx).find((t) => t.to === path);
      items.push({ label: tx('Horses', 'اسب‌ها'), to: '/horses' });
      items.push({ label: h ? tr(h.name) : horse.id, to: tab && horse.tab !== 'overview' ? `/horses/${horse.id}` : undefined });
      if (tab && horse.tab !== 'overview') items.push({ label: tab.label });
    } else {
      const leaf = grp.leaves.find((l) => l.to === path);
      if (leaf && grp.leaves.length > 1) items.push({ label: leaf.label });
    }
  }
  const phone = useMedia('(max-width:639px)');
  const xl = useMedia('(min-width:1280px)');
  const isHorse = !!horseFromPath(path);
  const keep = (i: number) => (xl ? true : phone ? i === (isHorse ? items.length - 1 : 0) : i === items.length - 1);
  const SHORT: Record<string, string> = { registry: tx('Registry', 'ثبت'), people: tx('People', 'افراد'), breeding: tx('Breeding', 'پرورش'), sport: tx('Compete', 'مسابقات'), services: tx('Services', 'خدمات'), news: tx('News', 'اخبار'), admin: tx('Admin', 'مدیریت') };
  const shown = items.map((it, i) => ({ it: phone && it.phase && SHORT[it.phase] ? { ...it, label: SHORT[it.phase] } : it, i })).filter(({ i }) => keep(i));
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <a href="#/" className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-navy-500 transition hover:bg-surface-2 hover:text-fg-navy-900 sm:grid" aria-label="Home"><HomeIcon className="h-4 w-4" /></a>
      {shown.map(({ it, i }, k) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {(k > 0 || (!phone && g !== 'home')) && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-navy-300 rtl:rotate-180" />}
            {it.phase && <span className={cn('h-2 w-2 shrink-0 rounded-full', PHASE[it.phase].dot)} />}
            {it.to && !last ? <a href={'#' + it.to} className="whitespace-nowrap text-fg-navy-500 transition hover:text-fg-navy-900">{it.label}</a> : <span className={cn('whitespace-nowrap', last ? 'font-bold text-fg-navy-900' : 'text-fg-navy-500')}>{it.label}</span>}
          </span>
        );
      })}
    </nav>
  );
}

function QuickSearch() {
  const { tx, tr, n } = useI18n();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'Escape') ref.current?.blur();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const s = q.trim().toLowerCase();
  const m = (l: { en: string; fa: string }) => l.en.toLowerCase().includes(s) || l.fa.includes(s);
  const horses = s ? HORSES.filter((h) => m(h.name) || h.regId.toLowerCase().includes(s) || idsOf(h).chip.includes(s) || idsOf(h).passport.toLowerCase().includes(s) || aliasesOf(h).previous.some(m)) : [];
  const riders = s ? ALL_RIDERS.filter((r) => m(r.name)) : [];
  const breeders = s ? BREEDERS.filter((b) => m(b.name)) : [];
  const news = s ? NEWS.filter((x) => m(x.title)) : [];
  const total = horses.length + riders.length + breeders.length + news.length;
  const Row = ({ href, icon, title, sub, tint }: { href: string; icon: ReactNode; title: string; sub: string; tint: string }) => (
    <a href={href} className="flex items-center gap-2.5 rounded-lg p-1.5 transition hover:bg-surface-2">{icon}<div className="min-w-0 flex-1"><div className="text-[13px] font-semibold leading-tight">{title}</div><div className="text-[11px] leading-tight text-fg-navy-500">{sub}</div></div><span className={cn('h-1.5 w-1.5 rounded-full', tint)} /></a>
  );
  const Head = ({ l, c, tint }: { l: string; c: number; tint: string }) => c ? <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500"><span className={cn('h-1.5 w-1.5 rounded-full', tint)} />{l}<span className="ms-auto font-semibold">{n(c)}</span></div> : null;
  return (
    <div className="relative hidden md:block">
      <form onSubmit={(e) => { e.preventDefault(); go('/horses' + (q ? `?q=${encodeURIComponent(q)}` : '')); setFocus(false); ref.current?.blur(); }}>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
        <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 160)}
          placeholder={tx('Search horses, people, news…', 'جستجوی اسب، افراد، اخبار…')}
          className="w-52 rounded-full border border-line bg-surface py-1.5 pe-8 ps-9 text-[13px] outline-none transition-all duration-300 placeholder:text-navy-400 focus:w-80 focus:border-gold-400 focus:ring-4 focus:ring-gold-400/15 xl:w-72 xl:focus:w-96" />
        <kbd className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-navy-400">/</kbd>
      </form>
      {focus && s && (
        <div className="thin-scroll absolute end-0 top-full z-50 mt-2 max-h-[70vh] w-96 animate-enter overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-2xl shadow-navy-900/25">
          {!total && <div className="p-4 text-center text-sm text-fg-navy-500">{tx('No results', 'نتیجه‌ای یافت نشد')}</div>}
          <Head l={tx('Horses', 'اسب‌ها')} c={horses.length} tint="bg-sky-500" />
          {horses.slice(0, 4).map((h) => <Row key={h.id} href={`#/horses/${h.id}`} tint="bg-sky-500" icon={<Img src={px(h.photo, 60, 60)} alt="" pos={h.pos} className="h-8 w-8 shrink-0 rounded-lg" />} title={tr(h.name)} sub={`${h.regId} · ${tr(h.breed)}`} />)}
          <Head l={tx('Riders', 'سوارکاران')} c={riders.length} tint="bg-indigo-500" />
          {riders.slice(0, 3).map((r) => <Row key={r.id} href={`#/people?r=${r.id}`} tint="bg-indigo-500" icon={<Avatar src={r.photo ? px(r.photo, 60, 60) : undefined} name={r.name.en} size={32} />} title={tr(r.name)} sub={`${tr(r.from)} · ${n(r.pts)} ${tx('pts', 'امتیاز')}`} />)}
          <Head l={tx('Breeders & studs', 'پرورش‌دهندگان')} c={breeders.length} tint="bg-indigo-500" />
          {breeders.slice(0, 3).map((b) => <Row key={b.id} href={`#/people/breeders?b=${b.id}`} tint="bg-indigo-500" icon={<span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-100 text-fg-indigo-700"><Building2 className="h-4 w-4" /></span>} title={tr(b.name)} sub={`${tr(b.location)} · ${n(b.horses)} ${tx('horses', 'اسب')}`} />)}
          <Head l={tx('News', 'اخبار')} c={news.length} tint="bg-slate-500" />
          {news.slice(0, 3).map((x) => <Row key={x.id} href={`#/news?n=${x.id}`} tint="bg-slate-500" icon={<span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-200 text-fg-slate-700"><Newspaper className="h-4 w-4" /></span>} title={tr(x.title)} sub={tr(x.author)} />)}
        </div>
      )}
    </div>
  );
}

function KeyContent() {
  const { tx, tr } = useI18n();
  const mods: [PhaseKey, string][] = [['registry', tx('Registry · identity & records', 'ثبت · هویت و سوابق')], ['people', tx('People & studs', 'افراد و اصطبل‌ها')], ['breeding', tx('Breeding & genetics', 'پرورش و ژنتیک')], ['sport', tx('Competitions · accent colour', 'مسابقات · رنگ تأکید')], ['services', tx('Services & market', 'خدمات و بازار')], ['news', tx('News & editorial', 'اخبار و تحریریه')], ['admin', tx('Administration', 'مدیریت')]];
  const status: [string, string][] = [['bg-emerald-500', tx('Verified · safe · healthy', 'تأیید شده · امن · سالم')], ['bg-amber-500', tx('Pending · caution · review', 'در انتظار · احتیاط · بررسی')], ['bg-red-500', tx('Risk · carrier · critical', 'خطر · ناقل · بحرانی')], ['bg-blue-500', tx('Information', 'اطلاعات')]];
  const h = 'mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500';
  return (
    <div className="space-y-3 text-xs font-medium">
      <div><div className={h}>{tx('Areas', 'بخش‌ها')}</div><ul className="grid grid-cols-2 gap-x-3 gap-y-1">{mods.map(([k, l]) => <li key={k} className="flex items-center gap-2"><span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', PHASE[k].dot)} />{l}</li>)}</ul></div>
      <div><div className={h}>{tx('Trust level of a record', 'سطح اعتبار رکورد')}</div><ul className="space-y-1">{TRUST_ORDER.map((l) => <li key={l} className="flex items-center gap-2"><TrustBadge level={l} compact /><span>{tr(TRUST_L[l].l)}</span></li>)}</ul></div>
      <div><div className={h}>{tx('Status', 'وضعیت')}</div><ul className="grid grid-cols-2 gap-x-3 gap-y-1">{status.map(([c, l]) => <li key={l} className="flex items-center gap-2"><span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', c)} />{l}</li>)}</ul></div>
      <div><div className={h}>{tx('Sex & bloodline', 'جنس و خط خونی')}</div><ul className="space-y-1"><li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEX.stallion.hex }} />{tx('Stallion · sire line', 'اسب نر · خط پدری')}</li><li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEX.mare.hex }} />{tx('Mare · dam line', 'مادیان · خط مادری')}</li></ul></div>
    </div>
  );
}

function AppearanceMenu() {
  const { tx, tr, cal, toggleCal } = useI18n();
  const { scheme, setScheme, mode, setMode, style, setStyle, density, setDensity, zoom } = useAppearance();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(false);
  const cur = SCHEMES.find((x) => x.key === scheme)!;
  const modes: { v: Mode; l: string; ic: React.ReactNode }[] = [{ v: 'light', l: tx('Light', 'روشن'), ic: <Sun className="h-4 w-4" /> }, { v: 'dark', l: tx('Dark', 'تیره'), ic: <Moon className="h-4 w-4" /> }, { v: 'system', l: tx('Auto', 'خودکار'), ic: <Monitor className="h-4 w-4" /> }];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={tx('Appearance', 'ظاهر')} title={tx('Appearance — colour scheme and dark mode', 'ظاهر — طرح رنگ و حالت تیره')} className={cn('grid h-8 w-8 place-items-center rounded-full text-fg-navy-600 transition hover:bg-surface-2', open && 'bg-surface-2')}><SwatchBook className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="thin-scroll absolute end-0 top-full z-50 mt-2 max-h-[82vh] w-[min(340px,92vw)] animate-enter overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-black/25 max-sm:fixed max-sm:start-2 max-sm:end-2 max-sm:top-14 max-sm:mt-0 max-sm:w-auto">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Interface style', 'سبک رابط')}</div>
            <div role="radiogroup" aria-label={tx('Interface style', 'سبک رابط')} className="grid grid-cols-2 gap-1.5">
              {([['modern', tx('Modern', 'مدرن'), tx('Data-rich, app-like', 'پرجزئیات و شبیه اپلیکیشن')], ['classic', tx('Classic', 'کلاسیک'), tx('Quiet, editorial, hand-set', 'آرام، ادبی و سنتی')]] as [Style, string, string][]).map(([k, l, d]) => (
                <button key={k} role="radio" aria-checked={style === k} onClick={() => setStyle(k)} className={cn('overflow-hidden rounded-xl border text-start transition', style === k ? 'border-od-gold-400 ring-2 ring-od-gold-300/50' : 'border-line hover:bg-surface-2')}>
                  <StylePreview kind={k} />
                  <span className="block px-2.5 pb-2 pt-1.5"><span className="block text-[13px] font-bold text-fg-navy-900">{l}</span><span className="block text-[11px] leading-snug text-fg-navy-500">{d}</span></span>
                </button>
              ))}
            </div>
            {style === 'classic' && scheme !== 'rosewood' && (
              <button onClick={() => setScheme('rosewood')} className="mt-1.5 w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-start text-[11px] font-semibold leading-snug text-fg-navy-700 transition hover:bg-line">{tx('A softer, warmer palette suits this style: Rosewood & Sage →', 'پالت نرم‌تر و گرم‌تر برای این سبک: رز‌وود و مریم‌گلی ←')}</button>
            )}
            <div className="mb-1.5 mt-3.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Mode', 'حالت')}</div>
            <div role="radiogroup" aria-label={tx('Mode', 'حالت')} className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
              {modes.map((m) => <button key={m.v} role="radio" aria-checked={mode === m.v} onClick={() => setMode(m.v)} className={cn('flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition', mode === m.v ? 'bg-surface text-fg-navy-900 shadow-sm ring-1 ring-line' : 'text-fg-navy-500 hover:text-fg-navy-800')}>{m.ic}{m.l}</button>)}
            </div>
            <div className="mb-1.5 mt-3.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Colour scheme', 'طرح رنگ')}</div>
            <div role="radiogroup" aria-label={tx('Colour scheme', 'طرح رنگ')} className="grid grid-cols-2 gap-1.5">
              {SCHEMES.map((sc) => { const w = swatch(sc); const on = sc.key === scheme; return (
                <button key={sc.key} role="radio" aria-checked={on} onClick={() => setScheme(sc.key)} title={tr(sc.theory)} className={cn('flex flex-col items-start gap-2 rounded-xl border p-2.5 text-start transition', on ? 'border-od-gold-300 bg-surface-2 ring-2 ring-od-gold-300/50' : 'border-line hover:bg-surface-2')}>
                  <span className="flex items-center"><span className="h-6 w-6 rounded-full ring-2 ring-surface" style={{ background: `linear-gradient(135deg, ${w.brand}, ${w.brand2})` }} /><span className="-ms-1.5 h-6 w-6 rounded-full ring-2 ring-surface" style={{ background: w.accent }} /><span className="-ms-1.5 h-6 w-6 rounded-full ring-2 ring-surface" style={{ background: w.comp }} /></span>
                  <span className="text-[13px] font-bold leading-tight text-fg-navy-900">{tr(sc.name)}</span>
                </button>); })}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-fg-navy-500">{tr(cur.theory)}</p>
            <div className="mb-1.5 mt-3.5 flex items-baseline justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Display size', 'اندازه نمایش')}</span><span className="hidden text-[11px] font-semibold text-fg-navy-500 lg:inline">{Math.round(zoom * 100)}%</span></div>
            <div role="radiogroup" aria-label={tx('Display size', 'اندازه نمایش')} className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
              {([['auto', tx('Auto-fit', 'خودکار')], ['compact', tx('Compact', 'فشرده')], ['comfort', tx('Roomy', 'راحت')]] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={density === v} onClick={() => setDensity(v)} className={cn('rounded-lg py-1.5 text-xs font-semibold transition', density === v ? 'bg-field text-fg-navy-900 shadow-sm ring-1 ring-line' : 'text-fg-navy-500 hover:text-fg-navy-800')}>{l}</button>)}
            </div>
            <p className="mt-1.5 hidden text-[11px] leading-snug text-fg-navy-500 lg:block">{tx('Auto-fit scales the interface to your window so common laptop screens show more without scrolling.', 'خودکار، رابط را با اندازه پنجره تنظیم می‌کند تا در لپ‌تاپ‌های رایج بدون اسکرول بیشتر دیده شود.')}</p>
            <div className="mb-1.5 mt-3.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Calendar', 'تقویم')}</div>
            <div role="radiogroup" aria-label={tx('Calendar', 'تقویم')} className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {([['jalali', tx('Shamsi', 'شمسی')], ['greg', tx('Gregorian', 'میلادی')]] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={cal === v} onClick={() => { if (cal !== v) toggleCal(); }} className={cn('rounded-lg py-1.5 text-xs font-semibold transition', cal === v ? 'bg-field text-fg-navy-900 shadow-sm ring-1 ring-line' : 'text-fg-navy-500 hover:text-fg-navy-800')}>{l}</button>)}
            </div>
            <button onClick={() => setKey((k) => !k)} aria-expanded={key} className="mt-3 flex w-full items-center justify-between border-t border-line pt-2.5 text-xs font-semibold text-fg-navy-700"><span>{tx('What do the colours mean?', 'معنی رنگ‌ها چیست؟')}</span><ChevronDown className={cn('h-4 w-4 transition-transform', key && 'rotate-180')} /></button>
            {key && <div className="mt-2.5 animate-enter"><KeyContent /></div>}
          </div>
        </>
      )}
    </div>
  );
}

function StylePreview({ kind }: { kind: Style }) {
  return kind === 'modern' ? (
    <span className="flex h-14 w-full" aria-hidden style={{ background: '#dde2e4' }}>
      <span className="w-[26%] p-1.5" style={{ background: '#17343b' }}><span className="block h-1 rounded-full" style={{ background: '#d89a5b' }} /><span className="mt-1 block h-1 rounded-full bg-white/25" /><span className="mt-1 block h-1 rounded-full bg-white/25" /></span>
      <span className="flex flex-1 flex-col gap-1 p-1.5"><span className="h-1.5 w-1/2 rounded-sm" style={{ background: '#17343b', opacity: 0.7 }} /><span className="flex flex-1 gap-1"><span className="flex-1 rounded-md bg-white shadow-sm" /><span className="flex-1 rounded-md bg-white shadow-sm" /></span></span>
    </span>
  ) : (
    <span className="flex h-14 w-full flex-col items-center justify-center" aria-hidden style={{ background: '#f1ebdf' }}>
      <span className="text-[24px] italic leading-none" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', color: '#2b2a28', fontWeight: 600 }}>Aa</span>
      <span className="mt-1 flex items-center gap-1"><span className="h-px w-9" style={{ background: '#b9a98f' }} /><span className="h-1 w-1 rotate-45" style={{ background: '#b9894a' }} /><span className="h-px w-9" style={{ background: '#b9a98f' }} /></span>
    </span>
  );
}

function StyleToggle() {
  const { tx } = useI18n();
  const { style, setStyle } = useAppearance();
  const to: Style = style === 'modern' ? 'classic' : 'modern';
  const label = to === 'classic' ? tx('Switch to the Classic style', 'تغییر به سبک کلاسیک') : tx('Switch to the Modern style', 'تغییر به سبک مدرن');
  return (
    <button onClick={() => setStyle(to)} title={label} aria-label={label} className="grid h-8 w-8 place-items-center rounded-full text-fg-navy-600 transition hover:bg-surface-2 max-sm:hidden">
      {to === 'classic' ? <Feather className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
    </button>
  );
}

function RoleMenu() {
  const { tx, tr } = useI18n();
  const { def, role, setRole } = useRole();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title={tx('Viewing as — switch role to preview permissions', 'مشاهده به عنوان — برای پیش‌نمایش دسترسی‌ها نقش را تغییر دهید')} className={cn('flex h-8 items-center gap-1.5 rounded-full border border-line bg-field ps-2.5 pe-2 text-xs font-semibold text-fg-navy-800 transition hover:bg-surface-2', open && 'bg-surface-2')}>
        <span className={cn('h-2.5 w-2.5 rounded-full', def.dot)} />
        <span className="hidden max-w-[130px] truncate lg:block">{tr(def.title)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-navy-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-full z-50 mt-2 w-[min(350px,92vw)] animate-enter rounded-2xl border border-line bg-surface p-1.5 shadow-2xl shadow-navy-900/25 max-sm:fixed max-sm:start-2 max-sm:end-2 max-sm:top-14 max-sm:mt-0 max-sm:w-auto max-sm:max-h-[76dvh] max-sm:overflow-y-auto">
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Preview the platform as…', 'پیش‌نمایش پلتفرم به عنوان…')}</div>
            <ul className="thin-scroll max-h-[70vh] overflow-y-auto">
              {ROLES.map((r) => (
                <li key={r.key}>
                  <button onClick={() => { setRole(r.key); setOpen(false); }} className={cn('flex w-full items-start gap-2.5 rounded-xl p-2 text-start transition hover:bg-surface-2', r.key === role && 'bg-violet-50')}>
                    <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', r.dot)} />
                    <span className="min-w-0 flex-1 leading-tight"><span className="block text-[13px] font-bold">{tr(r.label)}</span><span className="block text-[11px] text-fg-navy-500">{tr(r.access)}</span></span>
                    {r.key === role && <Check className="mt-0.5 h-4 w-4 text-fg-violet-600" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function CalToggle() {
  const { cal, toggleCal, tx } = useI18n();
  return (
    <button onClick={toggleCal} title={tx('Switch between Shamsi (Jalali) and Gregorian dates', 'تغییر بین تقویم شمسی و میلادی')} className="cal-toggle hidden h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-fg-navy-600 transition hover:bg-surface-2 xl:flex">
      <CalendarDays className="h-4 w-4" />{cal === 'jalali' ? tx('Shamsi', 'شمسی') : tx('Gregorian', 'میلادی')}
    </button>
  );
}

/* LIVE WIRING — interface switcher. The donor app runs on the same platform as
 * the other registered interfaces; this menu hands over to any of them with a
 * full page load. The core app reads the same "registry-frontend" preference
 * and shows its own switcher there, so the round trip works both ways. */
const INTERFACES: { id: string; name: string; fa: string; desc: string; faDesc: string }[] = [
  { id: 'modern-horse', name: 'Modern Pedigree', fa: 'شجره مدرن', desc: 'This interface — calm pedigree explorer', faDesc: 'همین رابط — کاوشگر آرام شجره‌نامه' },
  { id: 'heritage', name: 'Heritage Registry', fa: 'ثبت میراث', desc: 'The core national registry interface', faDesc: 'رابط اصلی سامانه ملی ثبت' },
  { id: 'classic-registry', name: 'Classic Registry', fa: 'ثبت کلاسیک', desc: 'Compact bilingual registry', faDesc: 'ثبت دوزبانه و فشرده' },
  { id: 'fei-classic', name: 'Federation Classic', fa: 'فدراسیون کلاسیک', desc: 'FEI-inspired institutional design', faDesc: 'طراحی نهادی الهام‌گرفته از فدراسیون' },
  { id: 'equidata-elite', name: 'EquiData Elite', fa: 'اکوی‌دیتا الیت', desc: 'Intelligence-console styling', faDesc: 'سبک کنسول داده و تحلیل' },
  { id: 'retro-astra', name: 'Retro Astra · Reference Desk', fa: 'رترو آسترا', desc: 'Retro reference-desk look', faDesc: 'نمای کتابخانه مرجع و خاطره‌انگیز' },
];

function InterfaceMenu() {
  const { tx, tr } = useI18n();
  const [open, setOpen] = useState(false);
  const pick = (fid: string) => {
    try { localStorage.setItem('registry-frontend', fid); } catch { /* persistence is optional */ }
    window.location.assign(fid === 'modern-horse' ? '/f/modern-horse/' : '/');
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={tx('Change interface', 'تغییر رابط کاربری')} title={tx('Change interface — same data, different look', 'تغییر رابط کاربری — همان داده‌ها، ظاهری متفاوت')} className={cn('grid h-8 w-8 place-items-center rounded-full text-fg-navy-600 transition hover:bg-surface-2', open && 'bg-surface-2')}><LayersIcon className="h-4 w-4" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="thin-scroll absolute end-0 top-full z-50 mt-2 max-h-[82vh] w-[min(330px,92vw)] animate-enter overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-2xl shadow-navy-900/25 max-sm:fixed max-sm:start-2 max-sm:end-2 max-sm:top-14 max-sm:mt-0 max-sm:w-auto">
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Choose an interface', 'انتخاب رابط کاربری')}</div>
            <div className="px-2.5 pb-2 text-[11px] leading-snug text-fg-navy-500">{tx('Your records and permissions stay the same — only the look changes.', 'پرونده‌ها و دسترسی‌های شما تغییری نمی‌کنند — فقط ظاهر عوض می‌شود.')}</div>
            <ul>
              {INTERFACES.map((f) => {
                const on = f.id === 'modern-horse';
                return (
                  <li key={f.id}>
                    <button onClick={() => { setOpen(false); if (!on) pick(f.id); }} aria-pressed={on} className={cn('flex w-full items-start gap-2.5 rounded-xl p-2 text-start transition', on ? 'bg-violet-50' : 'hover:bg-surface-2')}>
                      <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md', on ? 'bg-violet-100 text-fg-violet-700' : 'bg-surface-2 text-fg-navy-500')}><LayersIcon className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1 leading-tight"><span className="block text-[13px] font-bold">{tr(L(f.name, f.fa))}</span><span className="block text-[11px] text-fg-navy-500">{tr(L(f.desc, f.faDesc))}</span></span>
                      {on && <Check className="mt-1 h-4 w-4 shrink-0 text-fg-violet-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function Topbar({ path }: { path: string }) {
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-2 bg-canvas/80 px-3 backdrop-blur-xl sm:px-4">
      <a href="#/" aria-label="Home" className="grid h-9 w-9 shrink-0 place-items-center lg:hidden"><Emblem size={30} /></a>
      <Breadcrumbs path={path} />
      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <QuickSearch />
        <a href="#/horses" className="grid h-8 w-8 place-items-center rounded-full text-fg-navy-600 hover:bg-surface-2 md:hidden" aria-label="Search"><Search className="h-4 w-4" /></a>
        <RoleMenu />
        <InterfaceMenu />
        <StyleToggle />
        <AppearanceMenu />
        <CalToggle />
        <LangSwitch />
      </div>
      <span className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
    </header>
  );
}

/** Phone / small-tablet primary navigation — thumb-reachable, replaces the hamburger menu */
export function BottomNav({ path, open, onMore }: { path: string; open:boolean; onMore: () => void }) {
  const { tx } = useI18n();
  const g = groupOfPath(path);
  const items: { to: string; on: boolean; label: string; icon: ReactNode; phase: PhaseKey }[] = [
    { to: '/', on: path === '/' || path === '/dashboard', label: tx('Home', 'خانه'), icon: <House className="h-5 w-5" />, phase: 'home' },
    { to: '/horses', on: g === 'registry', label: tx('Horses', 'اسب‌ها'), icon: <RegIcon className="h-5 w-5" />, phase: 'registry' },
    { to: '/breeding', on: g === 'breeding', label: tx('Breeding', 'پرورش'), icon: <DnaIcon className="h-5 w-5" />, phase: 'breeding' },
    { to: '/sport', on: g === 'sport', label: tx('Compete', 'مسابقات'), icon: <CupIcon className="h-5 w-5" />, phase: 'sport' },
  ];
  const moreOn = ['people', 'services', 'news', 'admin'].includes(g) || path === '/roadmap' || path === '/platform';
  const cell = 'flex flex-1 flex-col items-center gap-0.5 px-1 pb-1 pt-1.5 text-[10px] font-semibold transition-colors';
  const pill = (on: boolean, p: PhaseKey) => cn('grid h-7 w-14 place-items-center rounded-full transition-all duration-300', on ? cn(PHASE[p].soft, PHASE[p].text) : 'text-fg-navy-500');
  return (
    <nav aria-label={tx('Primary navigation','پیمایش اصلی')} className="bn safe-b relative z-30 flex shrink-0 border-t border-line bg-surface/95 backdrop-blur-xl lg:hidden">
      {items.map((i) => (
        <a key={i.to} href={'#' + i.to} aria-current={i.on ? 'page' : undefined} className={cn(cell, i.on ? 'text-fg-navy-900' : 'text-fg-navy-500')}>
          <span className={pill(i.on, i.phase)}>{i.icon}</span><span className="bn-label">{i.label}</span>
        </a>
      ))}
      <button id="modern-more" aria-expanded={open} aria-controls="modern-navigation" aria-haspopup="dialog" onClick={onMore} className={cn(cell, moreOn ? 'text-fg-navy-900' : 'text-fg-navy-500')}>
        <span className={pill(moreOn, 'people')}><Menu className="h-5 w-5" /></span><span className="bn-label">{tx('More', 'بیشتر')}</span>
      </button>
    </nav>
  );
}

/* =====================================================================
   Page frame — one compact header row (title · tabs · actions) + body
   ===================================================================== */
export interface TabItem { to: string; label: string; icon?: ReactNode; badge?: string }

/** Underline tabs: calmer than boxed pills, saves a row of padding, and scrolls with the active tab centred on phones */
export function TabPills({ tabs, phase, className }: { tabs: TabItem[]; phase: PhaseKey; className?: string }) {
  const path = useRoute().split('?')[0];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    (el.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [path]);
  return (
    <div ref={ref} role="tablist" className={cn('hide-scroll fade-x flex shrink-0 gap-0.5 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t) => {
        const on = path === t.to;
        return (
          <a key={t.to} role="tab" aria-selected={on} href={'#' + t.to}
            className={cn('group relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[13px] font-semibold transition-colors max-sm:px-2.5 max-sm:py-1.5 max-sm:text-xs', on ? PHASE[phase].text : 'text-fg-navy-500 hover:text-fg-navy-800')}>
            {t.icon && <span className={cn('[&>svg]:h-3.5 [&>svg]:w-3.5', on ? '' : 'text-fg-navy-400 group-hover:text-fg-navy-600')}>{t.icon}</span>}
            {t.label}
            {t.badge && <span className={cn('rounded-full px-1.5 text-[10px] font-bold leading-4', on ? cn(PHASE[phase].soft, PHASE[phase].text) : 'bg-surface-2 text-fg-navy-500')}>{t.badge}</span>}
            <span className={cn('absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full transition-transform duration-300', PHASE[phase].bar, on ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-50')} />
          </a>
        );
      })}
    </div>
  );
}

export function Page({ phase, title, subtitle, leading, actions, tabs, toolbar, fill, children }: {
  phase: PhaseKey; title?: ReactNode; subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode; tabs?: TabItem[]; toolbar?: ReactNode; fill?: boolean; children: ReactNode;
}) {
  const path = useRoute().split('?')[0];
  return (
    <div className="flex flex-col gap-3 px-3 pb-3 pt-1 max-sm:gap-2 max-sm:px-2.5 sm:px-4 lg:h-full lg:min-h-0">
      {title && (
        <header className="page-head flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 max-lg:sticky max-lg:top-0 max-lg:z-30 max-lg:bg-canvas/90 max-lg:pt-1 max-lg:backdrop-blur-xl max-sm:max-lg:-mx-3 max-sm:max-lg:px-3 sm:max-lg:-mx-4 sm:max-lg:px-4">
          {leading}
          <div className={cn('min-w-0 flex-1 basis-40', !leading && 'title-bar border-s-[3px] border-od-gold-300 ps-3')}>
            <h1 className="page-title font-display text-xl font-semibold leading-tight tracking-tight text-fg-navy-900 max-sm:text-[19px]">{title}</h1>
            {subtitle && leading && <div className="mt-0.5 text-xs text-fg-navy-500">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          {tabs && <TabPills tabs={tabs} phase={phase} className="order-last -mb-px w-full" />}
        </header>
      )}
      {toolbar && <div className="relative z-20 shrink-0">{toolbar}</div>}
      <div key={path} className={cn('min-h-0 animate-enter lg:flex-1', fill ? 'lg:flex lg:flex-col lg:overflow-hidden' : 'thin-scroll lg:-me-2 lg:overflow-y-auto lg:pe-2')}>
        {children}
      </div>
    </div>
  );
}
