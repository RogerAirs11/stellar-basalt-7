import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Baby, Check, Dna, GalleryVertical, LayoutGrid, List, PanelLeft, Search, SearchX, ShieldCheck, SlidersHorizontal, Table2, Tag, X } from 'lucide-react';
import { shownSex, BREEDS, COLOUR_HEX, COLOUR_L, DISCIPLINE_L, GENDER_L, HORSES, REGISTRY_TOTAL, ageOf, type Colour, type Discipline, type Gender, type Horse } from '../data';
import { aliasesOf, idsOf, lev, norm, offspringOf, parentsOf, primaryTrust, resultsOf, statusOf, TRUST_L, TRUST_ORDER, type TrustLevel } from '../records';
import { completeness } from '../genetics';
import { useI18n } from '../i18n';
import { useAppearance } from '../appearance';
import { ExactLookup } from '../components/Trust';
import { hasPublicPhoto, hasVerifiedDoc, parentageKnown } from '../platform-data';
import { useRole } from '../role';
import { Pager, Segmented, Select, inputCls } from '../components/ui';
import { HorseCard } from '../components/HorseCard';
import { HorseGallery, HorseList, HorsePreviewPane, HorseTable, type SortKey } from '../components/HorseViews';
import { Page } from '../components/Shell';
import { getNav } from '../nav';
import { } from '../data';
import { go, useMedia } from '../lib';
import { useLiveSearch, useHydratedTick, useBrowseState, hydrateRegistry } from '../live';
import { cn } from '../utils/cn';

interface F { q: string; breed: string[]; sex: string[]; colour: string[]; trust: string[]; life: string[]; disc: string[]; age: string[]; rec: string[]; owner: string; breeder: string; sire: string; dam: string }
const init: F = { q: '', breed: [], sex: [], colour: [], trust: [], life: [], disc: [], age: [], rec: [], owner: '', breeder: '', sire: '', dam: '' };
type View = 'table' | 'list' | 'cards' | 'gallery';
const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
type ArrKey = 'breed' | 'sex' | 'colour' | 'trust' | 'life' | 'disc' | 'age' | 'rec';

const ageBucket = (h: Horse) => { const a = ageOf(h); return !Number.isFinite(a) ? 'unknown' : a <= 3 ? 'young' : a <= 7 ? 'mid' : 'senior'; };
const pedCache = new Map<string, number>();
const ped7 = (h: Horse) => { let v = pedCache.get(h.id); if (v === undefined) { v = completeness(h, 7).pct; pedCache.set(h.id, v); } return v; };
const kidsCache = new Map<string, number>();
const kids = (h: Horse) => { let v = kidsCache.get(h.id); if (v === undefined) { v = offspringOf(h).length; kidsCache.set(h.id, v); } return v; };
const recOk = (h: Horse, k: string) =>
  k === 'photo' ? hasPublicPhoto(h) : k === 'vdoc' ? hasVerifiedDoc(h) : k === 'pknown' ? parentageKnown(h) : k === 'results' ? resultsOf(h).length > 0 : k === 'ped7' ? ped7(h) >= 40 : k === 'gen' ? h.dna : k === 'health' ? h.verified.passport : k === 'kids' ? kids(h) > 0 : k === 'dnaPar' ? h.dna && primaryTrust(h) !== 'conflict' : k === 'sale' ? !!h.sale : true;

const VIA: Record<string, [string, string]> = {
  name: ['Name', 'نام'], previous: ['Previous name', 'نام قبلی'], regId: ['Registry no.', 'شماره ثبت'], chip: ['Microchip', 'میکروچیپ'], passport: ['Passport no.', 'شماره پاسپورت'], studbook: ['Studbook no.', 'شماره تبارنامه'],
  owner: ['Owner', 'مالک'], breeder: ['Breeder', 'پرورش‌دهنده'], location: ['Location', 'محل'], sire: ['Sire', 'پدر'], dam: ['Dam', 'مادر'], fuzzy: ['Similar spelling', 'املای مشابه'] };
function matchVia(h: Horse, q: string, tr: (l: { en: string; fa: string }) => string): string | null {
  const s = q.trim();
  if (!s) return '';
  const ql = s.toLowerCase(), qn = norm(s);
  const ids = idsOf(h), p = parentsOf(h);
  const t = (l: { en: string; fa: string }) => l.en.toLowerCase().includes(ql) || l.fa.includes(s) || (qn.length > 2 && (norm(l.en).includes(qn) || norm(l.fa).includes(qn)));
  if (t(h.name)) return 'name';
  if (aliasesOf(h).previous.some(t)) return 'previous';
  if (h.regId.toLowerCase().includes(ql)) return 'regId';
  if (ids.chip.includes(ql)) return 'chip';
  if (ids.passport.toLowerCase().includes(ql)) return 'passport';
  if (ids.studbook.toLowerCase().includes(ql)) return 'studbook';
  if (t(h.owner)) return 'owner';
  if (t(h.breeder)) return 'breeder';
  if (tr(h.location).toLowerCase().includes(ql)) return 'location';
  if (p.sire && t(p.sire)) return 'sire';
  if (p.dam && t(p.dam)) return 'dam';
  if (qn.length >= 4 && (lev(norm(h.name.en), qn) <= 1 || lev(norm(h.name.en.split(' ')[0]), qn) <= 1)) return 'fuzzy';
  return null;
}

export function Registry({ tab, query }: { tab: 'search' | 'register'; query: URLSearchParams }) {
  const browseState = useBrowseState();
  useHydratedTick(); // the live total replaces the demo count once hydration lands
  const { tx, n } = useI18n();
  const leaves = getNav(tx)[0].leaves;
  const tabs = [{ ...leaves[0], badge: browseState === 'ready' ? n(REGISTRY_TOTAL) : undefined }, { ...leaves[1] }];
  return (
    <Page
      phase="registry"
      fill
      title={tx('Search, Register & Verify', 'جستجو، ثبت و تأیید')}
      subtitle={tx('One national identity per horse — every fact shows how far it can be trusted.', 'یک شناسه ملی برای هر اسب — هر اطلاعات سطح اعتبار خود را نشان می‌دهد.')}
      tabs={tabs}
    >
      {tab === 'search' ? (browseState === 'ready' ? <Explorer qParam={query.get('q') || ''} /> : <section className="panel p-4" role="status">{browseState === 'loading' ? tx('Loading registry records…','در حال بارگذاری پرونده‌ها…') : <><p>{tx('Registry records are unavailable.','پرونده‌های ثبت در دسترس نیستند.')}</p><button className="mt-2 min-h-11 rounded-lg border border-line px-3" onClick={() => void hydrateRegistry()}>{tx('Try again','تلاش دوباره')}</button></>}</section>) : <section className="panel p-4"><h2 className="font-display text-xl font-semibold">{tx('Official horse registration','ثبت رسمی اسب')}</h2><p className="my-2 text-sm">{tx('Continue to the registry desk to sign in and submit. No application has been sent from this page.', 'برای ورود و ارسال درخواست به میز ثبت بروید. از این صفحه درخواستی ارسال نشده است.')}</p><a className="btn-gold inline-flex min-h-11 items-center rounded-xl px-4" href="/f/heritage/desk/submit">{tx('Open registry desk','ورود به میز ثبت')}</a></section>}

    </Page>
  );
}

/* ---------- facets ---------- */
function Facet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="break-inside-avoid border-b border-line/80 pb-2.5 last:border-0 last:pb-0 max-xl:mb-2.5">
      <legend className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-fg-navy-500">{title}</legend>
      <div className="space-y-0.5">{children}</div>
    </fieldset>
  );
}
function Opt({ on, onClick, label, count, lead }: { on: boolean; onClick: () => void; label: string; count: number; lead?: ReactNode }) {
  const { n } = useI18n();
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-start text-[13px] transition', on ? 'bg-sky-100/80 font-semibold text-fg-sky-900' : 'text-fg-navy-700 hover:bg-surface-2')}>
      <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border transition', on ? 'border-sky-600 bg-sky-600 text-white' : 'border-navy-300 bg-field')}>{on && <Check className="h-3 w-3" strokeWidth={4} />}</span>
      {lead}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('shrink-0 text-[11px] tabular-nums', on ? 'text-fg-sky-700' : 'text-navy-400')}>{n(count)}</span>
    </button>
  );
}

function useCounts(revision:number) {
  return useMemo(() => {
    const c = { sex: {} as Record<string, number>, breed: {} as Record<string, number>, colour: {} as Record<string, number>, trust: {} as Record<string, number>, life: {} as Record<string, number>, disc: {} as Record<string, number>, age: {} as Record<string, number>, rec: {} as Record<string, number> };
    const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] || 0) + 1; };
    HORSES.forEach((h) => {
      if(shownSex(h)) inc(c.sex,h.gender); inc(c.breed, h.breed.en); if(h.registryFacts?.simpleCoat!==false) inc(c.colour, h.colour); if(!h.registryFacts){inc(c.trust,primaryTrust(h));inc(c.disc,h.discipline);} inc(c.life,h.registryFacts?(h.registryFacts.deceased===true?'deceased':h.registryFacts.deceased===false?'alive':'unknown'):statusOf(h).s); inc(c.age, ageBucket(h));
      ['photo', 'vdoc', 'pknown', 'results', 'ped7', 'gen', 'health', 'kids', 'dnaPar', 'sale'].forEach((k) => recOk(h, k) && inc(c.rec, k));
    });
    return c;
  }, [revision]);
}

function Facets({ f, setF, counts }: { f: F; setF: (fn: (p: F) => F) => void; counts: ReturnType<typeof useCounts> }) {
  const { tx, tr } = useI18n();
  const tog = (k: ArrKey, v: string) => setF((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));
  const txt = (k: 'owner' | 'breeder' | 'sire' | 'dam', label: string) => (
    <label className="block"><span className="sr-only">{label}</span><input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={label} className={cn(inputCls, '!py-1.5 !text-[13px]')} /></label>
  );
  const trustCols: Record<string, string> = { self: 'bg-slate-400', uploaded: 'bg-amber-500', reviewed: 'bg-blue-500', official: 'bg-emerald-500', conflict: 'bg-red-500' };
  return (
    <div className="space-y-2.5 max-xl:space-y-0 max-xl:gap-x-5 max-xl:sm:columns-2 max-xl:md:columns-3">
      <Facet title={tx('Verification level', 'سطح اعتبار')}>
        {(TRUST_ORDER.filter((l) => l !== 'dna') as TrustLevel[]).map((l) => <Opt key={l} on={f.trust.includes(l)} onClick={() => tog('trust', l)} label={tr(TRUST_L[l].short)} count={counts.trust[l] || 0} lead={<span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', trustCols[l])} />} />)}
      </Facet>
      <Facet title={tx('Records on file', 'سوابق موجود')}>
        {([['photo', tx('Public photo', 'عکس عمومی'), <Check key="p1" className="h-3.5 w-3.5 text-fg-sky-600" />], ['vdoc', tx('Verified document', 'مدرک تأییدشده'), <Check key="p2" className="h-3.5 w-3.5 text-fg-emerald-600" />], ['pknown', tx('Parentage known', 'والدین شناخته‌شده'), <Check key="p3" className="h-3.5 w-3.5 text-fg-sky-600" />], ['dnaPar', tx('DNA parentage verified', 'والدین با DNA تأیید'), <Dna key="a" className="h-3.5 w-3.5 text-fg-fuchsia-600" />], ['results', tx('Has competition results', 'دارای نتایج مسابقه'), <Check key="b" className="h-3.5 w-3.5 text-fg-gold-600" />], ['ped7', tx('Deep pedigree (7 gen.)', 'شجره عمیق (۷ نسل)'), <Check key="c" className="h-3.5 w-3.5 text-fg-sky-600" />], ['gen', tx('Genetic report', 'گزارش ژنتیکی'), <Dna key="d" className="h-3.5 w-3.5 text-fg-fuchsia-600" />], ['health', tx('Publishable health docs', 'مدارک سلامت قابل انتشار'), <ShieldCheck key="e" className="h-3.5 w-3.5 text-fg-emerald-600" />], ['kids', tx('Registered offspring', 'نتاج ثبت‌شده'), <Baby key="f" className="h-3.5 w-3.5 text-fg-indigo-600" />], ['sale', tx('For sale', 'فروشی'), <Tag key="g" className="h-3.5 w-3.5 text-fg-gold-600" />]] as [string, string, ReactNode][]).map(([k, l, ic]) => <Opt key={k} on={f.rec.includes(k)} onClick={() => tog('rec', k)} label={l} count={counts.rec[k] || 0} lead={ic} />)}
      </Facet>
      <Facet title={tx('Sex', 'جنس')}>
        {(Object.keys(GENDER_L) as Gender[]).map((g) => <Opt key={g} on={f.sex.includes(g)} onClick={() => tog('sex', g)} label={tr(GENDER_L[g])} count={counts.sex[g] || 0} lead={<span className={cn('text-[13px] font-bold leading-none', g === 'stallion' ? 'text-fg-blue-600' : g === 'mare' ? 'text-fg-rose-600' : 'text-slate-500')}>{g === 'stallion' ? '♂' : g === 'mare' ? '♀' : '⚲'}</span>} />)}
      </Facet>
      <Facet title={tx('Breed', 'نژاد')}>
        {BREEDS.map((b) => <Opt key={b.en} on={f.breed.includes(b.en)} onClick={() => tog('breed', b.en)} label={tr(b)} count={counts.breed[b.en] || 0} />)}
      </Facet>
      <Facet title={tx('Coat colour', 'رنگ پوشش')}>
        {(Object.keys(COLOUR_L) as Colour[]).map((c) => <Opt key={c} on={f.colour.includes(c)} onClick={() => tog('colour', c)} label={tr(COLOUR_L[c])} count={counts.colour[c] || 0} lead={<span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/15" style={{ background: COLOUR_HEX[c] }} />} />)}
      </Facet>
      <Facet title={tx('Status & age', 'وضعیت و سن')}>
        {([['alive', tx('Alive', 'زنده')], ['deceased', tx('Deceased', 'فوت‌شده')], ['missing', tx('Missing', 'مفقود')]] as const).map(([k, l]) => <Opt key={k} on={f.life.includes(k)} onClick={() => tog('life', k)} label={l} count={counts.life[k] || 0} />)}
        {([['young', tx('Up to 3 yrs', 'تا ۳ سال')], ['mid', tx('4 – 7 yrs', '۴ تا ۷ سال')], ['senior', tx('8+ yrs', '۸ سال و بالاتر')]] as const).map(([k, l]) => <Opt key={k} on={f.age.includes(k)} onClick={() => tog('age', k)} label={l} count={counts.age[k] || 0} />)}
      </Facet>
      <Facet title={tx('Discipline', 'رشته')}>
        {(Object.keys(DISCIPLINE_L) as Discipline[]).map((d) => <Opt key={d} on={f.disc.includes(d)} onClick={() => tog('disc', d)} label={tr(DISCIPLINE_L[d])} count={counts.disc[d] || 0} />)}
      </Facet>
      <Facet title={tx('People & lineage', 'افراد و تبار')}>
        <div className="space-y-1.5">{txt('owner', tx('Owner…', 'مالک…'))}{txt('breeder', tx('Breeder…', 'پرورش‌دهنده…'))}{txt('sire', tx('Sire (father)…', 'پدر…'))}{txt('dam', tx('Dam (mother)…', 'مادر…'))}</div>
      </Facet>
    </div>
  );
}

/* ---------- explorer ---------- */
function Explorer({ qParam }: { qParam: string }) {
  const { tx, tr, n, rtl } = useI18n();
  const dirAttr = rtl ? 'rtl' : 'ltr';
  const { can } = useRole();
  const rail = useMedia('(min-width:1280px)');
  const lg = useMedia('(min-width:1024px)');
  const [f, setF] = useState<F>({ ...init, q: qParam });
  // R158: the owner/breeder/sire/dam rail fields now reach the platform's
  // server-backed forgiving search as field queries (owner:"..."), so owners
  // are findable across the WHOLE registry, not just the locally loaded slice.
  const liveFieldQuery = [f.owner && `owner:"${f.owner.replace(/"/g, '')}"`, f.breeder && `breeder:"${f.breeder.replace(/"/g, '')}"`, f.sire && `sire:"${f.sire.replace(/"/g, '')}"`, f.dam && `dam:"${f.dam.replace(/"/g, '')}"`].filter(Boolean).join(' ');
  const live = useLiveSearch([f.q.trim(), liveFieldQuery].filter(Boolean).join(' '));
  const hydrated = useHydratedTick(); // re-render when the live registry replaces the demo slice
  const { style } = useAppearance();
  const [view, setView] = useState<View>(() => (window.innerWidth < 640 ? 'list' : style === 'classic' ? 'cards' : 'table'));
  const [sort, setSort] = useState<SortKey>('recent');
  const [dir, setDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(24);
  const [showF, setShowF] = useState(false);
  const [showPrev, setShowPrev] = useState(() => lsGet('eq-preview', window.innerWidth >= 1280 && style !== 'classic' ? '1' : '0') === '1');
  // switching style resets to that style's natural defaults: Classic = visual cards, no side preview; Modern = table + preview
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) { firstStyle.current = false; return; }
    if (style === 'classic') { setView((v) => (v === 'table' ? 'cards' : v)); setShowPrev(false); } else { setView((v) => (v === 'cards' && window.innerWidth >= 640 ? 'table' : v)); setShowPrev(window.innerWidth >= 1280); }
  }, [style]);
  const [picked, setPicked] = useState<string | undefined>();
  const counts = useCounts(hydrated);
  useEffect(() => setF((p) => ({ ...p, q: qParam })), [qParam]);
  useEffect(() => setPage(0), [f, sort, dir, size, view]);

  const { results, via, searching } = useMemo(() => {
    const via = new Map<string, string>();
    const has = (l: { en: string; fa: string }, q: string) => !q.trim() || l.en.toLowerCase().includes(q.trim().toLowerCase()) || l.fa.includes(q.trim());
    const facetOk = (h: Horse) => {
      if (f.breed.length && !f.breed.includes(h.breed.en)) return false;
      if (f.sex.length && (!shownSex(h) || !f.sex.includes(h.gender))) return false;
      if (f.colour.length && (h.registryFacts?.simpleCoat===false || !f.colour.includes(h.colour))) return false;
      if (f.trust.length && (!!h.registryFacts || !f.trust.includes(primaryTrust(h)))) return false;
      if (f.life.length && !f.life.includes(h.registryFacts?(h.registryFacts.deceased===true?'deceased':h.registryFacts.deceased===false?'alive':'unknown'):statusOf(h).s)) return false;
      if (f.disc.length && (!!h.registryFacts || !f.disc.includes(h.discipline))) return false;
      if (f.age.length && !f.age.includes(ageBucket(h))) return false;
      if (f.owner && !has(h.owner, f.owner)) return false;
      if (f.breeder && !has(h.breeder, f.breeder)) return false;
      const p = (f.sire || f.dam) ? parentsOf(h) : null;
      if (f.sire && !(p!.sire && has(p!.sire, f.sire))) return false;
      if (f.dam && !(p!.dam && has(p!.dam, f.dam))) return false;
      for (const k of f.rec) if (!recOk(h, k)) return false;
      return true;
    };
    const list = HORSES.filter((h) => {
      if (f.q.trim()) { const v = matchVia(h, f.q, tr); if (!v) return false; via.set(h.id, v); }
      return facetOk(h);
    });
    // LIVE WIRING: the platform's forgiving search runs on the full national
    // registry, so its answers join the local matches (deduped, same facets).
    if (live.rows) {
      const seen = new Set(list.map((h) => h.id));
      for (const h of live.rows) {
        if (seen.has(h.id)) continue;
        if (!facetOk(h)) continue;
        seen.add(h.id);
        via.set(h.id, matchVia(h, f.q, tr) ?? 'name');
        list.push(h);
      }
    }
    const rank: Record<TrustLevel, number> = { conflict: 0, self: 1, uploaded: 2, reviewed: 3, official: 4, dna: 5 };
    const val: Record<SortKey, (h: Horse) => string | number> = {
      recent: () => 0, name: (h) => tr(h.name), age: (h) => ageOf(h), height: (h) => h.height, breed: (h) => tr(h.breed), location: (h) => tr(h.location), status: (h) => rank[primaryTrust(h)] };
    if (sort !== 'recent') list.sort((a, b) => { const x = val[sort](a), y = val[sort](b); return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir; });
    return { results: list, via, searching: live.loading };
  }, [f, sort, dir, tr, live, hydrated]);

  const pages = Math.max(1, Math.ceil(results.length / size));
  const rows = results.slice(page * size, (page + 1) * size);
  const viaL = (id: string) => { const v = via.get(id); return v ? tx(...(VIA[v] as [string, string])) : undefined; };
  const active = (f.q ? 1 : 0) + f.breed.length + f.sex.length + f.colour.length + f.trust.length + f.life.length + f.disc.length + f.age.length + f.rec.length + [f.owner, f.breeder, f.sire, f.dam].filter(Boolean).length;
  const previewOn = lg && showPrev;
  const railOn = rail && showF;
  const panelOn = !rail && showF;
  const selected = previewOn ? ((picked && results.find((h) => h.id === picked)) || rows[0]) : undefined;
  // one click previews; clicking the already-previewed horse again opens the full profile
  const pick = (id: string) => { if (!previewOn || picked === id) go('/horses/' + id); else setPicked(id); };
  const togglePrev = () => setShowPrev((p) => { lsSet('eq-preview', p ? '0' : '1'); return !p; });
  const cols = [previewOn ? '284px' : '', railOn ? '224px' : '', 'minmax(0,1fr)'].filter(Boolean).join(' ');
  const onSort = (k: SortKey) => { if (k === sort) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(1); } };

  const chips: { k: string; l: string; clear: () => void }[] = [];
  const arr = (k: ArrKey, label: (v: string) => string) => f[k].forEach((v) => chips.push({ k: k + v, l: label(v), clear: () => setF((p) => ({ ...p, [k]: p[k].filter((x) => x !== v) })) }));
  arr('trust', (v) => tr(TRUST_L[v as TrustLevel].short)); arr('rec', (v) => ({ dnaPar: 'DNA ✓', photo: tx('Photo', 'عکس'), vdoc: tx('Verified doc', 'مدرک تأییدشده'), pknown: tx('Parents known', 'والدین معلوم'), results: tx('Results', 'نتایج'), ped7: tx('7 gen.', '۷ نسل'), gen: tx('Genetic report', 'گزارش ژنتیک'), health: tx('Health docs', 'مدارک سلامت'), kids: tx('Offspring', 'نتاج'), sale: tx('For sale', 'فروشی') } as Record<string, string>)[v]);
  arr('breed', (v) => tr(BREEDS.find((x) => x.en === v)!)); arr('sex', (v) => tr(GENDER_L[v as Gender])); arr('colour', (v) => tr(COLOUR_L[v as Colour]));
  arr('life', (v) => ({ alive: tx('Alive', 'زنده'), deceased: tx('Deceased', 'فوت‌شده'), missing: tx('Missing', 'مفقود') } as Record<string, string>)[v]); arr('disc', (v) => tr(DISCIPLINE_L[v as Discipline]));
  arr('age', (v) => ({ young: tx('≤3 yrs', '≤۳ سال'), mid: tx('4–7 yrs', '۴–۷ سال'), senior: tx('8+ yrs', '۸+ سال') } as Record<string, string>)[v]);
  (['owner', 'breeder', 'sire', 'dam'] as const).forEach((k) => f[k] && chips.push({ k, l: `${({ owner: tx('Owner', 'مالک'), breeder: tx('Breeder', 'پرورش‌دهنده'), sire: tx('Sire', 'پدر'), dam: tx('Dam', 'مادر') })[k]}: ${f[k]}`, clear: () => setF((p) => ({ ...p, [k]: '' })) }));

  const body = live.failed && !results.length ? <div className="panel p-4" role="status">{tx('National search unavailable. No matches in the loaded records.', 'جستجوی سراسری در دسترس نیست. در پرونده‌های بارگذاری‌شده نتیجه‌ای پیدا نشد.')}</div> : searching && !results.length ? (
    <div className="panel grid place-items-center border-dashed px-6 py-16 text-center"><Search className="h-9 w-9 animate-pulse text-od-navy-300" /><div className="mt-3 font-semibold">{tx('Searching the national registry…', 'در حال جستجوی ثبت ملی…')}</div></div>
  ) : !results.length ? (
    <div className="panel grid place-items-center border-dashed px-6 py-16 text-center"><SearchX className="h-9 w-9 text-od-navy-300" /><div className="mt-3 font-semibold">{tx('No horses match your search', 'اسبی با این جستجو یافت نشد')}</div><button onClick={() => setF(init)} className="mt-2 text-sm font-semibold text-fg-sky-700 hover:underline">{tx('Clear all filters', 'پاک کردن همه فیلترها')}</button></div>
  ) : view === 'cards' ? (
    <div className="auto-grid" style={{ '--min': '208px' } as React.CSSProperties}>{rows.map((h, i) => <HorseCard key={h.id} horse={h} index={i} via={viaL(h.id)} />)}</div>
  ) : view === 'table' ? (
    <HorseTable rows={rows} sort={sort} dir={dir} onSort={onSort} via={viaL} selId={selected?.id} onPick={previewOn ? pick : undefined} />
  ) : view === 'gallery' ? (
    <HorseGallery rows={rows} selId={selected?.id} onPick={previewOn ? pick : undefined} />
  ) : (
    <HorseList rows={rows} selId={selected?.id} onPick={pick} via={viaL} />
  );

  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      {live.failed && results.length > 0 && <p role="status" className="text-sm">{tx('National search unavailable. Showing matches from loaded records only.', 'جستجوی سراسری در دسترس نیست. فقط نتایج پرونده‌های بارگذاری‌شده نمایش داده می‌شود.')}</p>}
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
        <div className="relative basis-full sm:min-w-[190px] sm:flex-1 sm:basis-auto">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
          <input value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} placeholder={tx('Search name, ID, microchip, owner…', 'جستجوی نام، شناسه، میکروچیپ، مالک…')} className={cn(inputCls, 'ps-9')} aria-label={tx('Search', 'جستجو')} />
          {f.q && <button onClick={() => setF((p) => ({ ...p, q: '' }))} className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-navy-400 hover:bg-surface-2" aria-label={tx('Clear search','پاک کردن جستجو')}><X className="h-3.5 w-3.5" /></button>}
        </div>
        <button aria-label={tx('Filters','فیلترها')} onClick={() => setShowF((x) => !x)} aria-pressed={showF} className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition', showF ? 'border-sky-400 bg-sky-100 text-fg-sky-800' : 'border-line bg-field text-fg-navy-700 hover:bg-surface-2')}>
          <SlidersHorizontal className="h-4 w-4" /><span className="max-sm:hidden">{tx('Filters', 'فیلترها')}</span>{active > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-sky-600 px-1 text-[11px] font-bold text-white">{n(active)}</span>}
        </button>
        {lg && (
          <button onClick={togglePrev} aria-pressed={showPrev} title={tx('Show a quick preview of the selected horse beside the list', 'پیش‌نمایش سریع اسب انتخاب‌شده کنار فهرست')} className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition', showPrev ? 'border-sky-400 bg-sky-100 text-fg-sky-800' : 'border-line bg-field text-fg-navy-700 hover:bg-surface-2')}>
            <PanelLeft className="h-4 w-4" />{tx('Preview', 'پیش‌نمایش')}
          </button>
        )}
        {can('verify') && <ExactLookup />}
        <Select label={tx('Sort', 'مرتب‌سازی')} value={sort} onChange={(v) => { setSort(v as SortKey); setDir(1); }} className="min-w-0 flex-1 sm:w-36 sm:flex-none" options={[{ v: 'recent', l: tx('Recent', 'جدیدترین') }, { v: 'name', l: tx('Name', 'نام') }, { v: 'age', l: tx('Age', 'سن') }, { v: 'height', l: tx('Height', 'قد') }, { v: 'breed', l: tx('Breed', 'نژاد') }, { v: 'location', l: tx('Location', 'محل') }, { v: 'status', l: tx('Trust level', 'سطح اعتبار') }]} />
        <Segmented<View> label="View" value={view} onChange={setView} phase="registry" items={[
          { v: 'table', l: tx('Table', 'جدول'), icon: <Table2 /> }, { v: 'list', l: tx('List', 'فهرست'), icon: <List /> },
          { v: 'cards', l: tx('Cards', 'کارت'), icon: <LayoutGrid /> }, { v: 'gallery', l: tx('Gallery', 'گالری'), icon: <GalleryVertical /> },
        ]} />
      </div>

      {/* the grid is laid out physically left → right in both languages so the preview is always on the left */}
      <div className="grid min-h-0 gap-3 lg:flex-1" style={lg ? { gridTemplateColumns: cols, direction: 'ltr' } : undefined}>
        {previewOn && (
          <div dir={dirAttr} className="thin-scroll min-h-0 overflow-y-auto" aria-label={tx('Preview', 'پیش‌نمایش')}>
            {selected ? <HorsePreviewPane horse={selected} /> : <div className="panel grid place-items-center p-8 text-center text-sm text-fg-navy-500">{tx('Select a horse to preview it here.', 'برای پیش‌نمایش یک اسب را انتخاب کنید.')}</div>}
          </div>
        )}
        {railOn && <aside dir={dirAttr} aria-label="Filters" className="thin-scroll panel min-h-0 overflow-y-auto p-3"><Facets f={f} setF={setF} counts={counts} /></aside>}
        <div dir={dirAttr} className="flex min-h-0 min-w-0 flex-col">
          {panelOn && <div className="panel mb-2.5 animate-enter p-3"><Facets f={f} setF={setF} counts={counts} /></div>}
          <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 px-0.5 text-[13px] text-fg-navy-600">
            {/* R159 phone: the pager's "1–24 of 89,872" already carries the total — the duplicate count row collapses on phones, leaving only filter chips when they exist */}
            <span className="max-sm:hidden"><b className="text-base text-fg-navy-900">{n(results.length)}</b> {tx('horses', 'اسب')}</span>
            {!railOn && chips.map((c) => <button key={c.k} onClick={c.clear} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-fg-sky-800 transition hover:bg-sky-200">{c.l}<X className="h-3 w-3" /></button>)}
            {active > 0 && <button onClick={() => setF(init)} className="ms-1 text-[11px] font-semibold text-fg-sky-700 underline-offset-2 hover:underline">{tx('Clear all', 'پاک کردن همه')}</button>}
            {previewOn && <span className="ms-auto hidden text-[11px] text-fg-navy-400 xl:inline">{tx('Click once to preview · click again to open', 'یک‌بار کلیک: پیش‌نمایش · دوباره: باز کردن')}</span>}
          </div>
          <div key={view} className="thin-scroll min-h-0 animate-enter lg:flex-1 lg:overflow-y-auto lg:pe-1">{body}</div>
          {results.length > 0 && <div className="shrink-0"><Pager page={page} pages={pages} total={results.length} size={size} sizes={[12, 24, 48, 96]} onPage={setPage} onSize={setSize} /></div>}
        </div>
      </div>
    </div>
  );
}
