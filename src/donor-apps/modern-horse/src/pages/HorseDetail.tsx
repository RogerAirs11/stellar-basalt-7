import {SourceNotes} from '../../../../frontend-kit/SourceNotes';
import {PublicEvidence} from '../components/PublicEvidence';
import { formatRegistryDate } from '../../../../registry/dates';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, Baby, BookOpen, Building2, CalendarDays, ChevronRight, Cpu, Dna, FileText, Heart, House, Link2, MapPin, Medal, Palette, Ruler, ShieldCheck, Sparkles, Stethoscope, Tag, Trophy, Users, X,
} from 'lucide-react';
import { DISCIPLINE_L, horseById, px, type Horse, ageText, coatLabel, coatSwatch, sexDisplay, shownSex } from '../data';
import { aliasesOf, birthEstimated, conflictOf, documentsOf, idsOf, markingsOf, offspringOf, primaryTrust, provenanceOf, resultsOf, statusOf, TRUST_L } from '../records';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { useHealthAccess } from '../platform-data';
import { Card, Img, Notice, PanelHeader, Pill, Segmented, TrustBadge, VisPill } from '../components/ui';
import { Pedigree } from '../components/Pedigree';
import { ResultRow } from '../components/Sport';
import { Page } from '../components/Shell';
import { buildPedigree, completeness, flatten, repeatedKeys } from '../genetics';
import { horseTabs } from '../nav';
import { useBreeding } from '../store';
import { go, useMedia } from '../lib';
import { useLiveHorse, useHydratedTick, useLineage, fetchDescendants, fetchHorseCompetitions, fetchHorseRacing, fetchCoefficients, liveExtraOf, useLiveFetch, type LiveCompetitions, type LiveRacing } from '../live';
import { CompetitionsTab, DocumentsTab, Empty, GeneticsTab, HealthTab, HistoryTab, OffspringTab, isLiveRecord } from './HorseTabs';
import { cn } from '../utils/cn';

const SUBTABS = ['pedigree', 'offspring', 'health', 'genetics', 'competitions', 'documents', 'history'];

export function HorseDetail({ id, tab }: { id: string; tab: string }) {
  const { tx, tr, n } = useI18n();
  const { setS, setM } = useBreeding();
  useHydratedTick(); // the live slice may carry this horse after boot
  const known = horseById(id);
  // real registry ids are numeric; demo mockup ids are slugs. A numeric id
  // missing from (or unregistered inside) the live map fetches its profile.
  const live = useLiveHorse(/^[0-9]+$/.test(id) ? id : null);
  const horse = live?.id===id ? live : known;
  // LIVE WIRING: pull the platform's real ancestor tree (same pedigree endpoint
  // the core frontend uses) so parents and grandparents resolve from the DB.
  const lineTick = useLineage(horse);
  const stats = useStats(horse, lineTick);
  // R161 LIVE PARITY: the platform's own pedigree coefficients (COI +
  // completeness) for live records — same endpoint the core frontend uses.
  const coeffs = useLiveFetch(horse && /^[0-9]+$/.test(horse.id) ? horse.id : null, fetchCoefficients);

  if (!horse)
    return (
      <Page phase="registry">
        <div className="panel grid min-h-[50vh] place-items-center p-8 text-center">
          <div>
            <div className="font-display text-2xl">{tx('Horse not found', 'اسب یافت نشد')}</div>
            <a href="#/horses" className="mt-3 inline-block font-semibold text-fg-sky-700 underline">{tx('Back to registry', 'بازگشت به ثبت اسب‌ها')}</a>
          </div>
        </div>
      </Page>
    );

  const st = statusOf(horse);
  const al = aliasesOf(horse);
  const isOverview = !SUBTABS.includes(tab);
  const plan = () => { if (horse.gender === 'mare') setM(horse.id); else setS(horse.id); go('/breeding'); };
  const sep = (c = '') => <span className={c} aria-hidden>·</span>;

  return (
    <Page
      phase="registry"
      fill={tab === 'pedigree' || isOverview}
      leading={<Img src={px(horse.photo, 160, 160)} alt="" pos={horse.pos} className="h-12 w-12 shrink-0 rounded-2xl ring-2 ring-surface sm:h-14 sm:w-14" />}
      title={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{tr(horse.name)}{!horse.registryFacts && <TrustBadge level={primaryTrust(horse)} />}{st.s !== 'alive' && <Pill tone={st.s === 'deceased' ? 'slate' : 'red'}>{st.s === 'deceased' ? tx('Deceased', 'فوت‌شده') : tx('Missing', 'مفقود')}</Pill>}{st.s === 'alive' && liveExtraOf(horse.id)?.deceased && <Pill tone="slate">{tx('Deceased', 'فوت‌شده')}</Pill>}{horse.sale && <Pill tone="gold" icon={<Tag className="h-3 w-3" />}>{tx('For sale', 'فروشی')}</Pill>}</span>}
      subtitle={<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-mono text-fg-navy-800" dir="ltr">{horse.regId}</span>{sep()}{tr(horse.breed)}{sep('max-sm:hidden')}<span className="max-sm:hidden">{tr(sexDisplay(horse))}</span>{sep('max-sm:hidden')}<span className="max-sm:hidden">{ageText(horse)==='—' ? tx('Age not recorded','سن ثبت نشده') : `${n(ageText(horse))} ${tx('years','ساله')}`} </span>{al.previous[0] && <>{sep('max-sm:hidden')}<span className="max-sm:hidden">{tx('formerly', 'پیشتر')} {tr(al.previous[0])}</span></>}</span>}
      actions={(horse.registryFacts ? horse.registryFacts.breedingSex && !liveExtraOf(horse.id)?.deceased : horse.gender !== 'gelding') && st.s === 'alive' ? <button onClick={plan} aria-label={tx('Plan a mating', 'برنامه‌ریزی جفت‌گیری')} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-md shadow-fuchsia-600/20 transition hover:bg-fuchsia-700 max-sm:h-10 max-sm:w-10 max-sm:justify-center max-sm:px-0"><Heart className="h-4 w-4" /><span className="max-sm:hidden">{tx('Plan a mating', 'برنامه‌ریزی جفت‌گیری')}</span></button> : undefined}
      tabs={horseTabs(horse.id, tx)}
    >
      {tab === 'pedigree' ? <Pedigree horse={horse} depth={4} controls fill meta={<>
        <MiniStat label={tx('Known · 5 gen', 'شناخته‌شده · ۵ نسل')} value={`${n(stats.known)}/${n(stats.total)}`} />
        <MiniStat label={tx('Complete · 7 gen', 'کامل · ۷ نسل')} value={`${n(stats.c7)}%`} warn={stats.c7 < 60} />
        <MiniStat label={tx('Linebred', 'خط‌پرورشی')} value={n(stats.rep)} gold />
        {coeffs.data && <MiniStat label={tx('COI · platform', 'ضریب هم‌خونی · پلتفرم')} gold value={coeffs.data.inbreedingPercent != null ? `${n(coeffs.data.inbreedingPercent)}%` : coeffs.data.zeroWithinIncomplete ? tx('0% (incomplete)', '۰٪ (ناقص)') : '—'} warn={coeffs.data.completenessPercent < 60} />}
      </>} />
        : tab === 'offspring' ? (isLiveRecord(horse.id) ? <LiveOffspring horse={horse} /> : <OffspringTab horse={horse} />)
          : tab === 'health' ? (isLiveRecord(horse.id) ? <Empty icon={<Stethoscope />} title={tx('Veterinary history is not shown here','سوابق دامپزشکی اینجا نمایش داده نمی‌شود')} sub={tx('Health entries appear here once the owner or a licensed vet records them. Nothing is invented.', 'سابقه سلامت پس از ثبت توسط مالک یا دامپزشک دارای مجوز اینجا نمایش داده می‌شود؛ چیزی جعل نمی‌شود.')} /> : <HealthTab horse={horse} />)
            : tab === 'genetics' ? (isLiveRecord(horse.id) ? <PublicEvidence key={horse.id} id={horse.id} kind="genetics" /> : <GeneticsTab horse={horse} />)
              : tab === 'competitions' ? (isLiveRecord(horse.id) ? <LiveCompetitionsTab horse={horse} /> : <CompetitionsTab horse={horse} />)
                : tab === 'documents' ? (isLiveRecord(horse.id) ? <Empty icon={<FileText />} title={tx('Documents not displayed here','مدارک اینجا نمایش داده نمی‌شود')} sub={tx('Passport and registration documents will appear here once verified.', 'پاسپورت و اسناد ثبت پس از تأیید اینجا نمایش داده می‌شوند.')} /> : <DocumentsTab horse={horse} />)
                  : tab === 'history' ? (isLiveRecord(horse.id) ? <PublicEvidence key={horse.id} id={horse.id} kind="attestations" /> : <HistoryTab horse={horse} />)
                    : <Overview horse={horse} />}
    </Page>
  );
}

function useStats(horse: Horse | undefined, lineTick = 0) {
  return useMemo(() => {
    if (!horse) return { known: 0, total: 0, rep: 0, c7: 0 };
    const root = buildPedigree(horse, 5);
    const all = flatten(root).filter((x) => !x.isRoot);
    return { known: all.filter((x) => x.name).length, total: Math.pow(2, 6) - 2, rep: repeatedKeys(root).size, c7: completeness(horse, 7).pct };
  }, [horse, lineTick]);
}

/* ---------- R161 LIVE PARITY — real registry panes for live records ----------
 * Offspring from GET /api/horses/:id/descendants, competition history from
 * GET /api/horses/:id/competitions, the federation racing record from
 * GET /api/horses/:id/racing and the platform's own pedigree coefficients —
 * the same endpoints the core frontend serves. Honest empty states when the
 * platform holds nothing; nothing is invented. */

function LiveOffspring({ horse }: { horse: Horse }) {
  const { tx, tr, n, date } = useI18n();
  const { data, done } = useLiveFetch(horse.id, (k) => fetchDescendants(k, 1));
  if (!done) return <div className="panel grid place-items-center p-8 text-sm text-fg-navy-500">…</div>;
  if(!data) return <p role="status">{tx('Offspring data unavailable','داده‌های نتاج در دسترس نیست')}</p>;
  const kids = data.kids;
  if (!kids.length) return <Empty icon={<Baby />} title={tx('No offspring on record yet', 'هنوز نتاجی ثبت نشده است')} sub={tx('Offspring recorded in the national registry will appear here.', 'نتاج ثبت‌شده در ثبت ملی اینجا نمایش داده می‌شود.')} />;
  return (
    <div className="panel divide-y divide-line">
      <div className="flex items-center justify-between px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-fg-navy-900"><Baby className="h-4 w-4 text-fg-fuchsia-600" />{tx('Registered offspring', 'نتاج ثبت‌شده')}</h3>
        <span className="text-xs font-semibold text-fg-navy-500">{n(kids.length)}{data?.truncated ? '+' : ''}</span>
      </div>
      {kids.map((k) => (
        <a key={k.id} href={`#/horses/${k.id}`} className="flex items-center gap-2.5 px-3 py-2 transition hover:bg-surface-2">
          <Img src={px(k.photo, 60, 60)} alt="" pos={k.pos} className="h-8 w-8 shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13px] font-semibold text-fg-navy-900">{tr(k.name)}</b><span className="text-[11px] text-fg-navy-500">{k.regId ? <span className="font-mono" dir="ltr">{k.regId}</span> : null}{k.regId ? ' · ' : ''}{tr(k.breed)} · {date(k.birth, 'year')}</span></span>
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-navy-300 rtl:rotate-180" />
        </a>
      ))}
    </div>
  );
}

/** Compact live competition summary for the Overview activity card. */
function LiveCompetitionMini({ horseId }: { horseId: string }) {
  const { tx, n, date } = useI18n();
  const { data, done } = useLiveFetch(horseId, fetchHorseCompetitions);
  const racing = useLiveFetch(horseId, fetchHorseRacing);
  if (!done || !racing.done) return <p className="py-2 text-[13px] text-fg-navy-500">…</p>;
  const c = data; const r = racing.data;
  if (!c && !r) return <p className="flex items-center gap-2 text-[13px] text-fg-navy-500"><Medal className="h-4 w-4" />{tx('No recorded results yet.', 'هنوز نتیجه‌ای ثبت نشده است.')}</p>;
  const tiles: [number, string][] = [];
  if (c) tiles.push([c.starts, tx('Starts', 'شرکت')], [c.wins, tx('Wins', 'قهرمانی')], [c.podium, tx('Podiums', 'سکو')]);
  if (r) tiles.push([r.starts, tx('Races', 'مسابقه')]);
  const last = c?.results?.[0];
  return (
    <div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">{tiles.slice(0, 3).map(([v, l]) => <div key={l} className="stat-tile rounded-lg bg-gold-100/70 py-1"><div className="stat-num font-display text-base font-semibold leading-none text-fg-gold-700">{n(v)}</div><div className="mt-0.5 text-[10px] font-semibold text-fg-navy-500">{l}</div></div>)}</div>
      {last && <p className="text-[12px] leading-snug text-fg-navy-600"><b>{last.placement != null ? `#${n(last.placement)}` : '—'}</b> {last.event}{last.date ? ` · ${date(last.date, 'short')}` : ''}</p>}
      {!last && r && r.lastRace && <p className="text-[12px] text-fg-navy-600">{tx('Last race', 'آخرین مسابقه')}: {date(r.lastRace, 'short')}</p>}
    </div>
  );
}

/** Live registered-offspring count for the Overview glance row. */
function LiveKidCount({ horseId }: { horseId: string }) {
  const { tx, n } = useI18n();
  const { data, done } = useLiveFetch(horseId, (k) => fetchDescendants(k, 1));
  if (!done) return <span className="text-fg-navy-500">…</span>;
  if(!data) return <span>{tx('Unavailable','در دسترس نیست')}</span>;
  const count=data.kids.length;
  if (!count) return <span className="text-fg-navy-500">{tx('None registered yet', 'هنوز ثبت نشده')}</span>;
  return <span className="flex items-center gap-1.5"><b className="text-fg-navy-800">{n(count)}</b> <span className="text-fg-navy-600">{tx('registered', 'ثبت‌شده')}</span></span>;
}

function LiveCompetitionsTab({ horse }: { horse: Horse }) {
  const { tx, n, date } = useI18n();
  const comps = useLiveFetch(horse.id, fetchHorseCompetitions);
  const racing = useLiveFetch(horse.id, fetchHorseRacing);
  if (!comps.done || !racing.done) return <div className="panel grid place-items-center p-8 text-sm text-fg-navy-500">…</div>;
  const c: LiveCompetitions | null = comps.data;
  const r: LiveRacing | null = racing.data;
  if (!c && !r) return <Empty icon={<Trophy />} title={tx('No competition records linked yet', 'هنوز رکورد مسابقه‌ای متصل نشده است')} sub={tx('Race and sport results will be linked to this horse by the registry.', 'نتایج مسابقه و ورزش توسط ثبت ملی به این اسب متصل خواهد شد.')} />;
  const chip = (v: number, l: string) => <div className="stat-tile rounded-lg bg-gold-100/70 py-1.5"><div className="stat-num font-display text-lg font-semibold leading-none text-fg-gold-700">{n(v)}</div><div className="mt-0.5 text-[10px] font-semibold text-fg-navy-500">{l}</div></div>;
  return (
    <div className="space-y-3">
      {c && (
        <div className="panel p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-fg-navy-900"><Trophy className="h-4 w-4 text-fg-gold-600" />{tx('Competition record', 'رکورد مسابقات')}</h3>
          <div className="mb-3 grid grid-cols-4 gap-2 text-center">{[chip(c.starts, tx('Starts', 'شرکت')), chip(c.wins, tx('Wins', 'قهرمانی')), chip(c.podium, tx('Podiums', 'سکو')), chip(c.eliminations, tx('Eliminated', 'حذف'))].map((x, i) => <Fragment key={i}>{x}</Fragment>)}</div>
          {c.results.length ? (
            <div className="divide-y divide-line">
              {c.results.slice(0, 25).map((res, i) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5 text-[13px]">
                  <span className={cn('grid h-6 w-8 shrink-0 place-items-center rounded-md text-[11px] font-bold', res.placement === 1 ? 'bg-gold-100 text-fg-gold-800' : res.placement != null && res.placement <= 3 ? 'bg-slate-200 text-fg-navy-800' : 'bg-surface-2 text-fg-navy-500')}>{res.eliminated ? 'E' : res.placement != null ? n(res.placement) : '—'}</span>
                  <span className="min-w-0 flex-1 leading-tight"><b className="block truncate font-semibold text-fg-navy-900">{res.event}</b><span className="text-[11px] text-fg-navy-500">{res.date ? date(res.date, 'long') : ''}{res.className ? ` · ${res.className}` : ''}{res.rider ? ` · ${res.rider}` : ''}</span></span>
                  {res.score && <span className="shrink-0 font-mono text-xs text-fg-navy-600" dir="ltr">{res.score}</span>}
                </div>
              ))}
              {c.hasMore && <p className="py-1.5 text-[11px] text-fg-navy-500">{tx('Showing the most recent results — the full history is on the core interface.', 'جدیدترین نتایج نمایش داده می‌شود — تاریخچه کامل در رابط اصلی است.')}</p>}
            </div>
          ) : <p className="text-[13px] text-fg-navy-500">{tx('No competition results linked yet.', 'هنوز نتیجه مسابقه‌ای متصل نشده است.')}</p>}
        </div>
      )}
      {r && (
        <div className="panel p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-fg-navy-900"><Medal className="h-4 w-4 text-fg-gold-600" />{tx('Federation racing record', 'رکورد مسابقات سرویس فدراسیون')}</h3>
          <p className="mb-2 text-[11px] text-fg-navy-500">{tx('Source: asbdavani racing archive — imported, unverified tier.', 'منبع: آرشیو مسابقات اسب‌دوانی — سطح وارداتی/تأییدنشده.')}</p>
          <div className="mb-3 grid grid-cols-4 gap-2 text-center">{[chip(r.starts, tx('Starts', 'شرکت')), chip(r.wins, tx('Wins', 'اول')), chip(r.seconds, tx('Second', 'دوم')), chip(r.thirds, tx('Third', 'سوم'))].map((x, i) => <Fragment key={i}>{x}</Fragment>)}</div>
          {r.results.length ? (
            <div className="divide-y divide-line">
              {r.results.slice(0, 25).map((res, i) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5 text-[13px]">
                  <span className={cn('grid h-6 w-8 shrink-0 place-items-center rounded-md text-[11px] font-bold', res.rank === 1 ? 'bg-gold-100 text-fg-gold-800' : res.rank != null && res.rank <= 3 ? 'bg-slate-200 text-fg-navy-800' : 'bg-surface-2 text-fg-navy-500')}>{res.rank != null ? n(res.rank) : '—'}</span>
                  <span className="min-w-0 flex-1 leading-tight"><b className="block truncate font-semibold text-fg-navy-900">{res.raceName ?? res.plan ?? '—'}</b><span className="text-[11px] text-fg-navy-500">{res.date ? date(res.date, 'long') : res.season ?? ''}{res.location ? ` · ${res.location}` : ''}{res.distanceM ? ` · ${n(res.distanceM)}m` : ''}</span></span>
                  {res.timeS != null && <span className="shrink-0 font-mono text-xs text-fg-navy-600" dir="ltr">{res.timeS}s</span>}
                </div>
              ))}
            </div>
          ) : <p className="text-[13px] text-fg-navy-500">{tx('No racing results for this horse in the archive.', 'در آرشیو، نتیجه مسابقه‌ای برای این اسب ثبت نشده است.')}</p>}
        </div>
      )}
    </div>
  );
}

const MiniStat = ({ label, value, gold, warn }: { label: string; value: string; gold?: boolean; warn?: boolean }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{label}</span>
    <span className={cn('font-display text-lg font-semibold leading-none', gold ? 'text-fg-gold-700' : warn ? 'text-amber-600' : 'text-fg-navy-900')}>{value}</span>
  </div>
);

type Sec = 'details' | 'pedigree' | 'activity' | 'trust';

/* ---------- Overview: a fixed-height app screen on laptops, a section switcher on phones ---------- */
function Overview({ horse }: { horse: Horse }) {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const access = useHealthAccess(horse.id);
  const wide = useMedia('(min-width:768px)');
  const short = useMedia('(max-height:739px)');
  const [sec, setSec] = useState<Sec>('details');
  const [dismissed, setDismissed] = useState(false);
  /* LIVE WIRING: a real registry record shows only what the platform truly
   * holds. Hash-derived sample facts (markings, identifiers, sport results,
   * provenance) stay demo-only so nothing is invented about a live animal. */
  const live = /^[0-9]+$/.test(horse.id);
  const results = live ? [] : resultsOf(horse);
  const ids = live ? null : idsOf(horse);
  const st = statusOf(horse);
  const conflict = conflictOf(horse);
  const provAll = useMemo(() => provenanceOf(horse), [horse]);
  const kidsAll = useMemo(() => offspringOf(horse), [horse]);
  const docsAll = useMemo(() => documentsOf(horse), [horse]);
  const prov = live ? [] : provAll;
  const kids = live ? [] : kidsAll;
  const docs = live ? [] : docsAll;
  const y0 = +horse.birth.slice(0, 4);
  const vis = (k: Sec) => (sec === k ? '' : 'max-md:hidden');

  const SEXC = { stallion: 'bg-blue-100 text-fg-blue-800', mare: 'bg-rose-100 text-fg-rose-800', gelding: 'bg-slate-200 text-fg-slate-700' } as const;
  const DISC = { jumping: 'bg-gold-100 text-fg-gold-800', dressage: 'bg-fuchsia-100 text-fg-fuchsia-800', endurance: 'bg-teal-100 text-fg-teal-800' } as const;
  const SEXBAR = { stallion: 'bg-blue-500', mare: 'bg-rose-500', gelding: 'bg-slate-500' } as const;
  const {lang,cal}=useI18n();
  const born = horse.registryFacts ? horse.registryFacts.birth ? formatRegistryDate(horse.registryFacts.birth,cal==='jalali'?'solar_hijri':'gregorian',lang).text : '—' : birthEstimated(horse) ? tx(`c. ${y0} (est. ${y0 - 1}–${y0 + 1})`, `حدود ${n(String(y0))} (تخمین ${n(String(y0 - 1))}–${n(String(y0 + 1))})`) : date(horse.birth, 'long');
  const pill = (cls: string, t: string) => <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-bold', cls)}>{t}</span>;
  type Row = [ReactNode, string, ReactNode];
  const groups: { title: string; dot: string; head: string; tile: string; rows: Row[] }[] = [
    { title: tx('Identity', 'هویت'), dot: 'bg-sky-500', head: 'text-fg-sky-700', tile: 'bg-sky-100 text-fg-sky-700', rows: [
      [<BadgeCheck key="a" />, tx('Breed', 'نژاد'), tr(horse.breed)],
      [<Users key="b" />, tx('Sex', 'جنس'), pill((shownSex(horse)?SEXC[horse.gender]:'bg-slate-100'), tr(sexDisplay(horse)))],
      [<CalendarDays key="c" />, tx('Born', 'تولد'), born],
    ] },
    { title: tx('Appearance', 'ظاهر'), dot: 'bg-amber-500', head: 'text-fg-amber-700', tile: 'bg-amber-100 text-fg-amber-700', rows: [
      [<Palette key="d" />, tx('Colour', 'رنگ'), <span key="d2" className="flex items-start gap-1.5"><span className="mt-[3px] h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: coatSwatch(horse) }} />{tr(coatLabel(horse))}</span>],
      ...(live ? [] : [[<Sparkles key="e" />, tx('Markings', 'علائم'), tr(markingsOf(horse))]] as Row[]),
      ...(live ? [] : [[<Ruler key="f" />, tx('Height', 'قد'), `${n(horse.height)} ${tx('cm', 'سانتی‌متر')}`]] as Row[]),
    ] },
    { title: tx('Role & place', 'نقش و محل'), dot: 'bg-indigo-500', head: 'text-fg-indigo-700', tile: 'bg-indigo-100 text-fg-indigo-700', rows: [
      ...(live ? [] : [[<Trophy key="g" />, tx('Discipline', 'رشته'), pill(DISC[horse.discipline], tr(DISCIPLINE_L[horse.discipline]))]] as Row[]),
      [<MapPin key="h" />, live ? tx('Birthplace','محل تولد') : tx('Kept at','محل نگهداری'), tr(horse.location)],
      [<Building2 key="i" />, tx('Owner', 'مالک'), tr(horse.owner)],
      [<House key="j" />, tx('Breeder', 'پرورش‌دهنده'), tr(horse.breeder)],
    ] },
  ];
  const idRows: [string, string][] = live
    ? [[tx('Registration No.', 'شماره ثبت'), horse.regId || '—'], ...(liveExtraOf(horse.id)?.microchip ? ([[tx('Microchip', 'میکروچیپ'), liveExtraOf(horse.id)!.microchip!]] as [string, string][]) : [])]
    : [[tx('Microchip', 'میکروچیپ'), ids!.chip], [tx('Passport', 'پاسپورت'), ids!.passport], [tx('Studbook', 'تبارنامه'), ids!.studbook], ['UELN', ids!.ueln], ...(ids!.fei ? ([['FEI', ids!.fei]] as [string, string][]) : [])];
  const stat = [[results.length, tx('Starts', 'شرکت')], [results.filter((r) => r.place <= 3).length, tx('Podiums', 'سکو')], [results.filter((r) => r.place === 1).length, tx('Wins', 'قهرمانی')]];
  const docsHave = docs.filter((d) => d.level !== 'missing').length;

  const glance: { to: string; tile: string; icon: ReactNode; label: string; body: ReactNode }[] = [
    { to: 'health', tile: 'bg-sky-100 text-fg-sky-700', icon: <Stethoscope />, label: tx('Health', 'سلامت'), body: live
      ? <span className="text-fg-navy-500">{tx('Not displayed here','اینجا نمایش داده نمی‌شود')}</span>
      : access.allowed
        ? <span className="text-fg-navy-700">{horse.carrier ? <b className="text-fg-red-800">{tx(`Carrier: ${horse.carrier.join(', ')}`, `ناقل: ${horse.carrier.join('، ')}`)}</b> : tx('Vaccinations up to date', 'واکسن به‌روز')} · {date(horse.lastVet)}</span>
        : <span className="text-fg-navy-700">{horse.verified.passport ? tx('Documents reviewed', 'مدارک بررسی شد') : tx('Not reviewed', 'بررسی نشده')} <VisPill vis="private" /></span> },
    { to: 'offspring', tile: 'bg-fuchsia-100 text-fg-fuchsia-700', icon: <Baby />, label: tx('Offspring', 'نتاج'), body: horse.gender === 'gelding' && !live ? <span className="text-fg-navy-500">{tx('Not applicable', 'قابل اعمال نیست')}</span> : live ? <LiveKidCount horseId={horse.id} /> : kids.length ? (
      <span className="flex items-center gap-1.5"><span className="flex -space-x-2 rtl:space-x-reverse">{kids.slice(0, 3).map((k) => <Img key={k.id} src={px(k.photo, 40, 40)} alt="" pos={k.pos} className="h-5 w-5 rounded-full ring-2 ring-surface" />)}</span><b className="text-fg-navy-800">{n(kids.length)}</b> <span className="text-fg-navy-600">{tx('registered', 'ثبت‌شده')}</span></span>
    ) : <span className="text-fg-navy-500">{tx('None registered yet', 'هنوز ثبت نشده')}</span> },
    { to: 'genetics', tile: 'bg-fuchsia-100 text-fg-fuchsia-700', icon: <Dna />, label: tx('Genetics', 'ژنتیک'), body: horse.dna ? <span className="flex items-center gap-1.5"><TrustBadge level="dna" /></span> : <span className="text-fg-navy-500">{tx('View public tests','مشاهده آزمایش‌های عمومی')}</span> },
    { to: 'documents', tile: 'bg-sky-100 text-fg-sky-700', icon: <FileText />, label: tx('Documents', 'مدارک'), body: live ? <span className="text-fg-navy-500">{tx('Not displayed here','اینجا نمایش داده نمی‌شود')}</span> : <span className="text-fg-navy-700"><b>{n(docsHave)}</b> / {n(docs.length)} {tx('on file', 'موجود')}</span> },
  ];

  const card = 'min-w-0';
  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      {/* phone only: one section at a time */}
      <div className="md:hidden">
        <Segmented<Sec> label="Section" value={sec} onChange={setSec} phase="registry" items={[
          { v: 'details', l: tx('Details', 'جزئیات') }, { v: 'pedigree', l: tx('Pedigree', 'شجره') }, { v: 'activity', l: tx('Activity', 'فعالیت') }, { v: 'trust', l: tx('Trust', 'اعتبار') },
        ]} />
      </div>

      <div className="thin-scroll grid min-h-0 gap-3 md:grid-cols-[250px_minmax(0,1fr)] lg:flex-1 lg:overflow-y-auto xl:grid-cols-[250px_minmax(0,1fr)_262px] xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-hidden">
        {/* A — who: photo + colour-coded facts */}
        <div className={cn(card, vis('details'), 'md:row-span-2 xl:col-start-1 xl:row-start-1 xl:min-h-0 xl:overflow-y-auto thin-scroll')}>
          <div className="panel overflow-hidden">
            <div className="relative">
              <Img src={px(horse.photo, 640, 400)} alt={tr(horse.name)} pos={horse.pos} className={cn('h-36 w-full md:h-auto md:aspect-[16/10]', st.s === 'deceased' && 'grayscale')} />
              {horse.sale && <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-bold text-white shadow"><Tag className="h-3 w-3" />{n(horse.sale.priceM)} {tx('M', 'م')}</span>}
            </div>
            <div className={cn('h-1', (shownSex(horse)?SEXBAR[horse.gender]:'bg-slate-300'))} />
            {wide ? (
              <div className="divide-y divide-line">
                {groups.map((g) => (
                  <section key={g.title} className="px-3 py-2.5">
                    <h3 data-gh="" className={cn('mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em]', g.head)}><span data-dot="" className={cn('h-2 w-2 rounded-full', g.dot)} />{g.title}</h3>
                    <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
                      {g.rows.map(([ic, k, v]) => (
                        <Fragment key={k}>
                          <dt className="flex items-center gap-1.5 text-xs font-semibold text-fg-navy-500"><span data-ico="" className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md [&>svg]:h-3 [&>svg]:w-3', g.tile)}>{ic}</span>{k}</dt>
                          <dd className="min-w-0 pt-px text-[13px] font-semibold leading-snug text-fg-navy-900">{v}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 p-3">
                {groups.flatMap((g) => g.rows.map(([ic, k, v]) => (
                  <div key={k} className="flex min-w-0 items-start gap-2">
                    <span data-ico="" className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5', g.tile)}>{ic}</span>
                    <div className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{k}</dt><dd className="text-[13px] font-semibold leading-snug text-fg-navy-900">{v}</dd></div>
                  </div>
                )))}
              </dl>
            )}
          </div>
          {live && <SourceNotes id={horse.id} fa={lang==='fa'}/>}
        </div>

        {/* B — lineage */}
        <div className={cn(card, vis('pedigree'), 'space-y-3 xl:col-start-2 xl:row-start-1')}>
          {st.s !== 'alive' && <Notice tone={st.s === 'deceased' ? 'slate' : 'red'} icon={<AlertTriangle />} title={st.s === 'deceased' ? tx(`Deceased on ${date(st.date!)}`, `فوت‌شده در ${date(st.date!)}`) : tx(`Reported missing on ${date(st.date!)}`, `مفقود شده در ${date(st.date!)}`)}>{tx('Future events are blocked until the status is officially corrected.', 'رویدادهای آینده تا اصلاح رسمی وضعیت مسدود است.')}</Notice>}
          {conflict && !dismissed && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-300 bg-red-100/60 px-3 py-2 text-fg-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <div className="min-w-0 flex-1 text-xs leading-snug">{tr(conflict.msg)}</div>
              {can('verify') && <a href="#/admin/queue" className="shrink-0 rounded-lg bg-field px-2.5 py-1 text-xs font-semibold shadow-sm">{tx('Open case', 'باز کردن پرونده')}</a>}
              <button onClick={() => setDismissed(true)} className="shrink-0 text-red-500 hover:text-red-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          )}
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<Link2 />} title={tx('Pedigree', 'شجره‌نامه')} sub={<span className="max-sm:hidden">{tx('Tap an ancestor to open their profile', 'برای باز کردن پروفایل روی نیا بزنید')}</span>}
              action={<a href={`#/horses/${horse.id}/pedigree`} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700">{tx('Full view', 'نمای کامل')}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /></a>} />
            <Pedigree horse={horse} depth={3} compact dense={short} />
          </Card>
        </div>

        {/* C — activity: results + a one-line summary of every other tab */}
        <div className={cn(card, vis('activity'), 'grid content-start gap-3 sm:grid-cols-2 xl:col-start-2 xl:row-start-2 xl:min-h-0 xl:overflow-y-auto thin-scroll')}>
          <Card className="p-3">
            <PanelHeader phase="sport" icon={<Trophy />} title={tx('Competitions', 'مسابقات')} action={<a href={`#/horses/${horse.id}/competitions`} className="text-xs font-semibold text-fg-gold-700 hover:underline">{tx('All', 'همه')} →</a>} />
            {live ? <LiveCompetitionMini horseId={horse.id} /> : <>
              <div className="mb-2 grid grid-cols-3 gap-2 text-center">{stat.map(([v, l]) => <div key={String(l)} className="stat-tile rounded-lg bg-gold-100/70 py-1"><div className="stat-num font-display text-base font-semibold leading-none text-fg-gold-700">{n(v as number)}</div><div className="mt-0.5 text-[10px] font-semibold text-fg-navy-500">{l}</div></div>)}</div>
              {results.length ? <div className="-mx-1">{results.slice(0, 2).map((r) => <ResultRow key={r.id} r={r} compact />)}</div> : <p className="flex items-center gap-2 text-[13px] text-fg-navy-500"><Medal className="h-4 w-4" />{tx('No recorded results yet.', 'هنوز نتیجه‌ای ثبت نشده است.')}</p>}
            </>}
          </Card>
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<Sparkles />} title={tx('At a glance', 'در یک نگاه')} />
            <ul className="-mx-1">
              {glance.map((g) => (
                <li key={g.to}>
                  <a href={`#/horses/${horse.id}/${g.to}`} className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition hover:bg-surface-2">
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5', g.tile)}>{g.icon}</span>
                    <span className="min-w-0 flex-1 leading-tight"><b className="block text-xs text-fg-navy-500">{g.label}</b><span className="text-[13px] font-semibold">{g.body}</span></span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-navy-300 transition group-hover:text-fg-navy-600 rtl:rotate-180" />
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* D — how far it can be trusted */}
        <div className={cn(card, vis('trust'), 'grid content-start gap-3 sm:grid-cols-2 md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:grid-cols-1 xl:min-h-0 xl:overflow-y-auto thin-scroll')}>
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<ShieldCheck />} title={tx('Trust', 'اعتبار')} sub={tx('Each line covers only itself', 'هر خط فقط خودش را پوشش می‌دهد')} />
            <ul className="space-y-2">
              {live && <li>{tx('Open public attestations for source-specific evidence.','برای مشاهده شواهد صادرکننده، گواهی‌های عمومی را باز کنید.')}</li>}
              {prov.slice(0, 6).map((p) => (
                <li key={p.key} className="flex items-start gap-2.5">
                  <TrustBadge level={p.level} compact className="mt-0.5 !h-6 !w-6 shrink-0 !justify-center !rounded-full" />
                  <span className="min-w-0 flex-1 leading-tight"><b className="block text-[13px]">{tr(p.label)}</b><span className="block text-[11px] text-fg-navy-500">{tr(TRUST_L[p.level].short)} · {tr(p.authority)}</span></span>
                </li>
              ))}
            </ul>
            <a href={`#/horses/${horse.id}/history`} className="mt-3 inline-block text-xs font-semibold text-fg-sky-700 hover:underline">{tx('Provenance & history', 'منشأ و تاریخچه')} →</a>
          </Card>
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<Cpu />} title={tx('Identifiers', 'شناسه‌ها')} />
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">{idRows.map(([k, v]) => <Fragment key={k}><dt className="text-xs font-semibold text-fg-navy-500">{k}</dt><dd className="break-all text-end font-mono text-xs font-semibold" dir="ltr">{v}</dd></Fragment>)}</dl>
            {!live && <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-fg-navy-500"><BookOpen className="mt-0.5 h-3 w-3 shrink-0" />{tr(ids!.book)}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
