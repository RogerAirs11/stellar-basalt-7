import { useMemo, useState } from 'react';
import { Award, BadgeCheck, CalendarDays, Check, CircleCheck, CircleX, Crown, Database, FileUp, Gavel, Link2, MapPin, Medal, Plug, Search, Target, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react';
import { RIDERS as BASE_RIDERS, DISCIPLINE_L, HORSES, ageOf, horseById, perfFor, px, type Discipline, type Horse, ageText } from '../data';
import { ALL_RIDERS, type Rider } from '../people';
import { CALENDAR, MATCHES, entriesOf, eventResults, type CalEvent } from '../sport-data';
import { SOURCES } from '../admin-data';
import { conflictOf, resultMeta, resultsOf, statusOf } from '../records';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { Avatar, Card, Chip, CountUp, Img, Kpi, Meter, Notice, PanelHeader, Pill, Segmented, Select, Split, TrustBadge } from '../components/ui';
import { PerformanceChart, ResStatusPill, ResultRow } from '../components/Sport';
import { Page } from '../components/Shell';
import { getNav } from '../nav';
import { fetchRacingRaces, fetchCompetitions, useLiveFetch, type LiveRaceRow } from '../live';
import { cn } from '../utils/cn';

type Tab = 'results' | 'rankings' | 'events' | 'sources';

export function SportPage({ tab }: { tab: Tab }) {
  const { tx } = useI18n();
  const leaves = getNav(tx).find((g) => g.key === 'sport')!.leaves;
  return (
    <Page
      phase="sport"
      fill={tab === 'events'}
      title={tx('Competitions & performance', 'مسابقات و عملکرد')}
      subtitle={tx('Results are linked to the horse’s national ID — each one shows where it came from.', 'نتایج به شناسه ملی اسب متصل است — هر نتیجه منبع خود را نشان می‌دهد.')}
      tabs={[{ ...leaves[0] }, { ...leaves[1] }, { ...leaves[2], badge: String(CALENDAR.filter((e) => e.status !== 'completed').length) }, { ...leaves[3] }]}
    >
      {tab === 'results' && <Results />}
      {tab === 'rankings' && <Rankings />}
      {tab === 'events' && <Calendar />}
      {tab === 'sources' && <Sources />}
    </Page>
  );
}

/* ---------------- Results ---------------- */
function Results() {
  const { tx, tr, n } = useI18n();
  const horses = useMemo(() => HORSES.filter((h) => resultsOf(h).length > 0).slice(0, 80), []);
  const [horseId, setHorseId] = useState('persian-star');
  const [disc, setDisc] = useState<'all' | Discipline>('all');
  const [st, setSt] = useState<'all' | 'verified' | 'imported' | 'pending'>('all');
  const horse = horseById(horseId)!;
  const list = useMemo(() => resultsOf(horse).filter((r) => (disc === 'all' || r.discipline === disc) && (st === 'all' || resultMeta(r).status === st)), [horse, disc, st]);
  const perf = perfFor(horseId);
  const starts = perf.reduce((a, b) => a + b.starts, 0), pods = perf.reduce((a, b) => a + b.podiums, 0);
  const chips: { k: 'all' | Discipline; l: string }[] = [{ k: 'all', l: tx('All disciplines', 'همه رشته‌ها') }, { k: 'jumping', l: tr(DISCIPLINE_L.jumping) }, { k: 'dressage', l: tr(DISCIPLINE_L.dressage) }, { k: 'endurance', l: tr(DISCIPLINE_L.endurance) }];
  return (
    <div className="space-y-3">
      <LiveRacingStrip />
      <div className="panel flex flex-wrap items-center gap-3 p-2.5">
        <div className="w-full sm:w-60"><Select label={tx('Horse', 'اسب')} value={horseId} onChange={setHorseId} options={horses.map((h) => ({ v: h.id, l: `${tr(h.name)} · ${h.regId}` }))} /></div>
        <div className="hide-scroll flex gap-1.5 overflow-x-auto">{chips.map((c) => <Chip key={c.k} phase="sport" active={disc === c.k} onClick={() => setDisc(c.k)}>{c.l}</Chip>)}</div>
        <div className="ms-auto"><Segmented<string> label="Status" value={st} onChange={(v) => setSt(v as typeof st)} phase="sport" items={[{ v: 'all', l: tx('Any status', 'همه وضعیت‌ها') }, { v: 'verified', l: tx('Verified', 'تأییدشده') }, { v: 'imported', l: tx('Imported', 'دریافتی') }, { v: 'pending', l: tx('Pending', 'در انتظار') }]} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi phase="sport" icon={<Target />} label={tx('Starts', 'شرکت‌ها')} value={<CountUp value={starts} />} hint={tx('Last 4 seasons', '۴ فصل اخیر')} />
        <Kpi phase="sport" icon={<Medal />} label={tx('Podiums', 'سکوها')} value={<CountUp value={pods} />} hint={`${n(Math.round((pods / Math.max(1, starts)) * 100))}% ${tx('strike rate', 'نرخ موفقیت')}`} />
        <Kpi phase="sport" icon={<Trophy />} label={tx('Wins in view', 'قهرمانی در نما')} value={<CountUp value={list.filter((r) => r.place === 1).length} />} />
        <Kpi phase="sport" icon={<BadgeCheck />} label={tx('Source-verified', 'تأییدشده از منبع')} value={<CountUp value={list.filter((r) => resultMeta(r).status === 'verified').length} />} hint={tx(`of ${n(list.length)} shown`, `از ${n(list.length)} نمایش‌داده‌شده`)} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="p-3">
          <PanelHeader phase="sport" icon={<Trophy />} title={`${tx('Competition history', 'تاریخچه مسابقات')} · ${tr(horse.name)}`} sub={`${n(list.length)} ${tx('results', 'نتیجه')}`} action={<a href={`#/horses/${horse.id}`} className="text-xs font-semibold text-fg-sky-700 hover:underline">{tx('Open profile', 'پروفایل')}</a>} />
          {list.length ? <div>{list.map((r, i) => <ResultRow key={r.id} r={r} index={i} meta />)}</div> : <p className="py-10 text-center text-sm text-fg-navy-500">{tx('No results for this filter.', 'نتیجه‌ای برای این فیلتر وجود ندارد.')}</p>}
        </Card>
        <div className="space-y-3">
          <Card className="p-3"><PanelHeader phase="sport" icon={<Medal />} title={tx('Performance overview', 'نمای کلی عملکرد')} /><PerformanceChart key={horseId} data={perf} /></Card>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Rankings ---------------- */
const BASE_PTS = [100, 80, 65, 55, 45, 40];
const LVL_F = { international: 1.5, national: 1.25, regional: 1 } as const;
function breakdown(r: Rider) {
  const shares = [0.3, 0.22, 0.17, 0.13, 0.1];
  const lv: (keyof typeof LVL_F)[] = [r.level.en.startsWith('International') ? 'international' : 'national', 'national', 'national', 'regional', 'regional'];
  const lines = shares.map((s, i) => { const f = LVL_F[lv[i]]; const base = BASE_PTS[Math.min(i + (r.wins > 5 ? 0 : 1), 5)]; const ev = CALENDAR[(r.id.length + i * 2) % CALENDAR.length]; return { ev, place: BASE_PTS.indexOf(base) + 1, base, f, pts: Math.round(base * f), target: s * r.pts }; });
  const sum = lines.reduce((t, l) => t + l.pts, 0);
  return { lines, other: Math.max(0, r.pts - sum), sum };
}

function Rankings() {
  const { tx, tr, n } = useI18n();
  const [disc, setDisc] = useState<'all' | Discipline>('all');
  const [region, setRegion] = useState('all');
  const [age, setAge] = useState<'all' | 'junior' | 'senior'>('all');
  const [season, setSeason] = useState('2025');
  const [sel, setSel] = useState<string | null>(null);
  const regions = [...new Set(ALL_RIDERS.map((r) => r.from.en))];
  const list = useMemo(() => ALL_RIDERS.filter((r) => (disc === 'all' || r.discipline === disc) && (region === 'all' || r.from.en === region) && (age === 'all' || (age === 'junior' ? r.age < 21 : r.age >= 21))).map((r) => ({ r, pts: season === '2025' ? r.pts : Math.round(r.pts * 0.91) })).slice(0, 25), [disc, region, age, season]);
  const cur = list.find((x) => x.r.id === sel)?.r ?? list[0]?.r;
  const max = list[0]?.pts || 1;
  const bd = cur ? breakdown(cur) : null;
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="panel flex flex-wrap items-center gap-2 p-2.5">
          <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'jumping', 'dressage', 'endurance'] as const).map((d) => <Chip key={d} phase="sport" active={disc === d} onClick={() => setDisc(d)}>{d === 'all' ? tx('All disciplines', 'همه رشته‌ها') : tr(DISCIPLINE_L[d])}</Chip>)}</div>
          <Select label="Region" value={region} onChange={setRegion} className="w-36" options={[{ v: 'all', l: tx('All regions', 'همه مناطق') }, ...regions.map((r) => ({ v: r, l: tr(ALL_RIDERS.find((x) => x.from.en === r)!.from) }))]} />
          <Segmented<string> label="Age" value={age} onChange={(v) => setAge(v as typeof age)} phase="sport" items={[{ v: 'all', l: tx('All ages', 'همه سنین') }, { v: 'junior', l: tx('Junior', 'نوجوان') }, { v: 'senior', l: tx('Senior', 'بزرگسال') }]} />
          <Segmented<string> label="Season" value={season} onChange={setSeason} phase="sport" items={[{ v: '2025', l: '2025' }, { v: '2024', l: '2024' }]} />
        </div>
        <Card className="p-2">
          <ol>
            {list.map(({ r, pts }, i) => (
              <li key={r.id}>
                <button onClick={() => setSel(r.id)} aria-current={cur?.id === r.id} className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start transition', cur?.id === r.id ? 'bg-gold-100/70' : 'hover:bg-surface-2')} style={{ animation: `enter .35s ${Math.min(i, 12) * 25}ms both` }}>
                  <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold', i === 0 ? 'bg-gold-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-amber-700 text-white' : 'bg-surface-2 text-fg-navy-600 ring-1 ring-line')}>{n(i + 1)}</span>
                  <Avatar src={r.photo ? px(r.photo, 60, 60) : undefined} name={r.name.en} size={30} />
                  <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(r.name)}</span><span className="block truncate text-[11px] text-fg-navy-500">{tr(r.from)} · {tr(r.club)}</span></span>
                  <span className="hidden w-28 sm:block"><Meter value={(pts / max) * 100} color="bg-gold-500" /></span>
                  <span className="w-12 text-end text-[13px] font-bold tabular-nums">{n(pts)}</span>
                  <span className={cn('inline-flex w-9 items-center justify-end text-[10px] font-bold', r.trend >= 0 ? 'text-fg-emerald-600' : 'text-fg-red-600')}>{r.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{n(Math.abs(r.trend))}</span>
                </button>
              </li>
            ))}
            {!list.length && <li className="p-8 text-center text-sm text-fg-navy-500">{tx('No riders match.', 'سوارکاری یافت نشد.')}</li>}
          </ol>
        </Card>
      </div>
      <div className="min-w-0 space-y-3">
        {cur && bd && (
          <Card className="p-3" key={cur.id}>
            <PanelHeader phase="sport" icon={<Gavel />} title={tx('How this score is calculated', 'این امتیاز چگونه محاسبه شده')} sub={`${tr(cur.name)} · ${n(cur.pts)} ${tx('pts', 'امتیاز')}`} />
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-1.5 text-start font-semibold">{tx('Event', 'رویداد')}</th><th className="pb-1.5 font-semibold">{tx('Place', 'رتبه')}</th><th className="pb-1.5 font-semibold">{tx('Base × level', 'پایه × سطح')}</th><th className="pb-1.5 text-end font-semibold">{tx('Points', 'امتیاز')}</th></tr></thead>
              <tbody>
                {bd.lines.map((l, i) => <tr key={i} className="border-t border-line" style={{ animation: `enter .35s ${i * 50}ms both` }}><td className="max-w-[160px] truncate py-1.5 font-medium">{tr(l.ev.name)}</td><td className="text-center tabular-nums">{n(l.place)}</td><td className="text-center tabular-nums text-fg-navy-500">{n(l.base)} × {n(l.f, 2)}</td><td className="text-end font-bold tabular-nums">{n(l.pts)}</td></tr>)}
                <tr className="border-t border-line text-fg-navy-500"><td className="py-1.5" colSpan={3}>{tx('Other counted results (best 6 rule)', 'سایر نتایج محاسبه‌شده (قاعده ۶ نتیجه برتر)')}</td><td className="text-end font-semibold tabular-nums">{n(bd.other)}</td></tr>
                <tr className="border-t-2 border-navy-200 font-bold"><td className="py-1.5" colSpan={3}>{tx('Season total', 'جمع فصل')}</td><td className="text-end tabular-nums text-fg-gold-700">{n(cur.pts)}</td></tr>
              </tbody>
            </table>
          </Card>
        )}
        <Card className="p-3">
          <PanelHeader phase="sport" icon={<Award />} title={tx('Ranking method', 'روش رتبه‌بندی')} sub={tx('Transparent and auditable — per discipline', 'شفاف و قابل ممیزی — برای هر رشته')} />
          <ul className="space-y-1.5 text-xs text-fg-navy-700">
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-gold-600" />{tx('Placing points: 1st 100 · 2nd 80 · 3rd 65 · 4th 55 · 5th 45 · 6th 40', 'امتیاز رتبه: اول ۱۰۰ · دوم ۸۰ · سوم ۶۵ · چهارم ۵۵ · پنجم ۴۵ · ششم ۴۰')}</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-gold-600" />{tx('Level factor: international ×1.5 · national ×1.25 · regional ×1.0', 'ضریب سطح: بین‌المللی ۱٫۵ · ملی ۱٫۲۵ · منطقه‌ای ۱٫۰')}</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-gold-600" />{tx('Best 6 results of the season count', 'شش نتیجه برتر فصل محاسبه می‌شود')}</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-gold-600" />{tx('Only verified or organiser-confirmed results; pending ones are excluded', 'فقط نتایج تأییدشده یا تأیید برگزارکننده؛ موارد در انتظار حذف می‌شوند')}</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Calendar & entries ---------------- */
const LV = { international: ['bg-red-100 text-fg-red-800', 'International', 'بین‌المللی'], national: ['bg-indigo-100 text-fg-indigo-800', 'National', 'ملی'], regional: ['bg-slate-200 text-fg-slate-700', 'Regional', 'منطقه‌ای'] } as const;
function Calendar() {
  const { tx, tr, n, date } = useI18n();
  const [disc, setDisc] = useState<'all' | Discipline>('all');
  const [lvl, setLvl] = useState<'all' | CalEvent['level']>('all');
  const [sel, setSel] = useState<string>('e1');
  const [hasSel, setHasSel] = useState(false);
  const list = CALENDAR.filter((e) => (disc === 'all' || e.disc === disc) && (lvl === 'all' || e.level === lvl)).sort((a, b) => a.date.localeCompare(b.date));
  const cur = CALENDAR.find((e) => e.id === sel) ?? list[0];
  const stTone = { open: ['bg-emerald-100 text-fg-emerald-800', tx('Entries open', 'ثبت‌نام باز')], upcoming: ['bg-sky-100 text-fg-sky-800', tx('Upcoming', 'پیش رو')], completed: ['bg-slate-200 text-fg-slate-700', tx('Completed', 'برگزار شده')] } as const;
  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      <LiveCompetitionsStrip />
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
        <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'jumping', 'dressage', 'endurance'] as const).map((d) => <Chip key={d} phase="sport" active={disc === d} onClick={() => setDisc(d)}>{d === 'all' ? tx('All', 'همه') : tr(DISCIPLINE_L[d])}</Chip>)}</div>
        <Segmented<string> label="Level" value={lvl} onChange={(v) => setLvl(v as typeof lvl)} phase="sport" items={[{ v: 'all', l: tx('Any level', 'همه سطوح') }, { v: 'international', l: tx('International', 'بین‌المللی') }, { v: 'national', l: tx('National', 'ملی') }, { v: 'regional', l: tx('Regional', 'منطقه‌ای') }]} />
        <span className="ms-auto text-xs text-fg-navy-500"><b className="text-sm text-fg-navy-900">{n(list.length)}</b> {tx('events', 'رویداد')}</span>
      </div>
      <div className="min-h-0 lg:flex-1">
        <Split hasSel={hasSel} onBack={() => setHasSel(false)} listW="lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
          list={<ul className="space-y-1.5">{list.map((e, i) => (
            <li key={e.id}><button onClick={() => { setSel(e.id); setHasSel(true); }} aria-current={cur?.id === e.id} className={cn('flex w-full items-center gap-3 rounded-xl border p-2 text-start transition-all', cur?.id === e.id ? 'border-gold-400 bg-gold-50 shadow-sm' : 'border-transparent bg-surface/60 hover:border-line hover:bg-surface')} style={{ animation: `enter .35s ${i * 35}ms both` }}>
              <span className="stat-tile grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gold-100 text-center leading-none text-fg-gold-800"><span><span className="block text-lg font-bold">{date(e.date).split(' ')[0]}</span><span className="block text-[10px] font-bold uppercase">{date(e.date, 'month')}</span></span></span>
              <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(e.name)}</span><span className="flex items-center gap-1 truncate text-[11px] text-fg-navy-500"><MapPin className="h-3 w-3" />{tr(e.province)} · {tr(DISCIPLINE_L[e.disc])}</span><span className="mt-1 flex items-center gap-1.5"><span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', LV[e.level][0])}>{tx(LV[e.level][1], LV[e.level][2])}</span><span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', stTone[e.status][0])}>{stTone[e.status][1]}</span></span></span>
            </button></li>))}</ul>}
          detail={cur ? <EventDetail ev={cur} /> : null} />
      </div>
    </div>
  );
}

function EventDetail({ ev }: { ev: CalEvent }) {
  const { tx, tr, n, date } = useI18n();
  const [sub, setSub] = useState<'info' | 'entries' | 'results' | 'enter'>(ev.status === 'completed' ? 'results' : 'info');
  const entries = useMemo(() => entriesOf(ev), [ev]);
  const res = useMemo(() => eventResults(ev), [ev]);
  const items = [{ v: 'info', l: tx('Overview', 'نمای کلی') }, { v: 'entries', l: `${tx('Entries', 'ثبت‌نام‌ها')} · ${n(ev.entries)}` }, ...(ev.status === 'completed' ? [{ v: 'results', l: tx('Results', 'نتایج') }] : [{ v: 'enter', l: tx('Enter', 'ثبت‌نام') }])];
  return (
    <div key={ev.id} className="panel animate-enter overflow-hidden">
      <div className="relative h-36 sm:h-44">
        <img src={px(ev.photo, 1000, 460)} alt="" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/20 to-transparent" />
        <div className="absolute inset-x-3 bottom-2.5 text-white"><div className="mb-1 flex flex-wrap items-center gap-1.5"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', LV[ev.level][0])}>{tx(LV[ev.level][1], LV[ev.level][2])}</span>{ev.sanctioned ? <Pill tone="green" icon={<BadgeCheck className="h-3 w-3" />}>{tx('Federation-sanctioned', 'مورد تأیید فدراسیون')}</Pill> : <Pill tone="amber">{tx('Not yet sanctioned', 'هنوز تأیید نشده')}</Pill>}</div><h2 className="font-display text-xl font-semibold leading-tight sm:text-2xl">{tr(ev.name)}</h2></div>
      </div>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([[<CalendarDays key="a" />, tx('Date', 'تاریخ'), date(ev.date, 'long')], [<MapPin key="b" />, tx('Venue', 'محل'), tr(ev.venue)], [<Users key="c" />, tx('Organiser', 'برگزارکننده'), tr(ev.organizer)], [<Trophy key="d" />, tx('Discipline', 'رشته'), tr(DISCIPLINE_L[ev.disc])]] as [React.ReactNode, string, string][]).map(([ic, k, v]) => <div key={k} className="rounded-xl bg-surface-2/70 p-2"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500 [&>svg]:h-3 [&>svg]:w-3">{ic}{k}</div><div className="truncate text-[13px] font-bold" title={v}>{v}</div></div>)}
        </div>
        <Segmented<string> label="Section" value={sub} onChange={(v) => setSub(v as typeof sub)} phase="sport" items={items} />
        {sub === 'info' && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2.5"><div><div className="mb-1 flex justify-between text-xs"><span className="font-semibold">{tx('Entries', 'ثبت‌نام‌ها')}</span><b>{n(ev.entries)} / {n(ev.capacity)}</b></div><Meter value={(ev.entries / ev.capacity) * 100} color="bg-gold-500" h="h-2" /></div>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">{[[tx('Opens', 'شروع'), ev.open], [tx('Closes', 'پایان'), ev.close], [tx('Event', 'رویداد'), ev.date]].map(([k, v]) => <div key={k} className="rounded-lg bg-surface-2/70 p-1.5"><div className="text-[10px] font-bold uppercase text-fg-navy-500">{k}</div><div className="font-semibold">{date(v)}</div></div>)}</div>
              <div className="text-xs text-fg-navy-600"><b>{tx('Entry fee', 'هزینه ثبت‌نام')}:</b> {n(ev.fee)} {tx('thousand Toman', 'هزار تومان')}</div>
              <div><div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500"><Gavel className="h-3 w-3" />{tx('Judges', 'داوران')}</div><div className="flex flex-wrap gap-1.5">{ev.judges.map((j, i) => <Pill key={i} tone="navy">{tr(j)}</Pill>)}</div></div></div>
            <div><div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Entry conditions', 'شرایط شرکت')}</div><ul className="space-y-1.5 text-xs">{ev.conditions.map((c, i) => <li key={i} className="flex items-start gap-2 rounded-lg bg-surface-2/60 p-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-emerald-600" />{tr(c)}</li>)}</ul></div>
          </div>
        )}
        {sub === 'entries' && (
          <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-1.5 text-start font-semibold">#</th><th className="pb-1.5 text-start font-semibold">{tx('Horse', 'اسب')}</th><th className="pb-1.5 text-start font-semibold">{tx('Rider', 'سوارکار')}</th><th className="pb-1.5 text-end font-semibold">{tx('Horse record', 'رکورد اسب')}</th></tr></thead>
            <tbody>{entries.map((e, i) => <tr key={e.horse.id} className="border-t border-line" style={{ animation: `enter .3s ${i * 30}ms both` }}><td className="py-1.5 font-mono text-xs text-fg-navy-500">{n(e.bib)}</td><td><a href={`#/horses/${e.horse.id}`} className="font-semibold text-fg-sky-700 hover:underline">{tr(e.horse.name)}</a></td><td>{tr(BASE_RIDERS.find((r) => r.id === e.rider)!.name)}</td><td className="text-end"><TrustBadge level={conflictOf(e.horse) ? 'conflict' : e.horse.verified.federation ? 'official' : e.horse.verified.passport ? 'reviewed' : 'self'} /></td></tr>)}</tbody></table></div>
        )}
        {sub === 'results' && (
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-1.5 text-start font-semibold">{tx('Rank', 'رتبه')}</th><th className="pb-1.5 text-start font-semibold">{tx('Horse · rider', 'اسب · سوارکار')}</th><th className="pb-1.5 text-start font-semibold">{ev.disc === 'jumping' ? tx('Faults · time', 'خطا · زمان') : ev.disc === 'dressage' ? tx('Score', 'امتیاز') : tx('Ride time', 'زمان سواری')}</th><th className="pb-1.5 text-end font-semibold">{tx('Status', 'وضعیت')}</th></tr></thead>
            <tbody>{res.map((r, i) => <tr key={r.horse.id} className="border-t border-line" style={{ animation: `enter .3s ${i * 30}ms both` }}><td className="py-1.5"><span className={cn('grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold', r.rank === 1 ? 'bg-gold-500 text-white' : r.rank === 2 ? 'bg-slate-400 text-white' : r.rank === 3 ? 'bg-amber-700 text-white' : 'bg-surface-2 ring-1 ring-line')}>{n(r.rank)}</span></td><td><a href={`#/horses/${r.horse.id}`} className="font-semibold text-fg-sky-700 hover:underline">{tr(r.horse.name)}</a><span className="block text-[11px] text-fg-navy-500">{tr(BASE_RIDERS.find((x) => x.id === r.rider)!.name)}</span></td><td className="tabular-nums text-fg-navy-700">{r.score}</td><td className="text-end">{r.status === 'protest' ? <Pill tone="red">{tx('Protest lodged', 'اعتراض ثبت شد')}</Pill> : <ResStatusPill status={r.status === 'verified' ? 'verified' : 'pending'} />}</td></tr>)}</tbody></table></div>
        )}
        {sub === 'enter' && <EntryChecker ev={ev} />}
      </div>
    </div>
  );
}

function EntryChecker({ ev }: { ev: CalEvent }) {
  const { tx, tr, n } = useI18n();
  const { can } = useRole();
  const pool = useMemo(() => HORSES.filter((h) => h.discipline === ev.disc).slice(0, 24), [ev]);
  const [hid, setHid] = useState(pool[0]?.id ?? 'persian-star');
  const [rid, setRid] = useState('sara');
  const [done, setDone] = useState(false);
  const h = (horseById(hid) || pool[0]) as Horse;
  const rider = ALL_RIDERS.find((r) => r.id === rid) as Rider;
  const days = Math.round((new Date(ev.date).getTime() - new Date((h.lastVet || '2025-04-15') + 'T12:00:00').getTime()) / 86400000);
  const checks: [boolean, string][] = [
    [h.verified.federation, tx('Registered with the federation', 'ثبت‌شده در فدراسیون')], [h.verified.passport, tx('Passport reviewed', 'پاسپورت بررسی شده')],
    [days <= 180, tx(`Vaccination valid on event day (${n(days)} days since last)`, `واکسن در روز مسابقه معتبر (${n(days)} روز از آخرین)`)], [ageOf(h) >= ev.minAge, tx(`Horse age ${n(ageText(h))} ≥ minimum ${n(ev.minAge)}`, `سن اسب ${n(ageText(h))} ≥ حداقل ${n(ev.minAge)}`)],
    [statusOf(h).s === 'alive', tx('Horse record is active (not deceased / missing)', 'رکورد اسب فعال است (نه فوت‌شده / مفقود)')], [!conflictOf(h), tx('No open conflict or duplicate flag', 'پرچم تعارض یا تکراری باز وجود ندارد')],
    [!(ev.level === 'international' && rider.level.en.startsWith('Junior')), tx('Rider licence level is sufficient', 'سطح مجوز سوارکار کافی است')],
  ];
  const ok = checks.every((c) => c[0]);
  if (!can('register') && !can('results')) return <Notice tone="slate">{tx('Only owners, riders’ teams and organisers can enter. Switch role to preview.', 'فقط مالکان و برگزارکنندگان می‌توانند ثبت‌نام کنند. برای پیش‌نمایش نقش را تغییر دهید.')}</Notice>;
  if (done) return <Notice tone="green" icon={<CircleCheck />} title={tx('Entry submitted', 'ثبت‌نام ارسال شد')}>{tx(`${h.name.en} with ${rider.name.en} is entered in ${ev.name.en}.`, `${h.name.fa} با ${rider.name.fa} در ${ev.name.fa} ثبت‌نام شد.`)}</Notice>;
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-2.5">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-fg-navy-600">{tx('Horse', 'اسب')}</span><Select label="horse" value={hid} onChange={setHid} options={pool.map((x) => ({ v: x.id, l: `${tr(x.name)} · ${x.regId}` }))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-fg-navy-600">{tx('Rider', 'سوارکار')}</span><Select label="rider" value={rid} onChange={setRid} options={ALL_RIDERS.slice(0, 20).map((x) => ({ v: x.id, l: `${tr(x.name)} · ${tr(x.level)}` }))} /></label>
        <button disabled={!ok} onClick={() => setDone(true)} className="btn-gold w-full rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40">{ok ? tx('Submit entry', 'ارسال ثبت‌نام') : tx('Not eligible — fix the red items', 'مجاز نیست — موارد قرمز را برطرف کنید')}</button>
      </div>
      <ul className="space-y-1.5">{checks.map(([pass, l], i) => <li key={i} className={cn('flex items-start gap-2 rounded-xl border p-2 text-xs font-medium', pass ? 'border-emerald-200 bg-emerald-50/70 text-fg-emerald-900' : 'border-red-300 bg-red-100/60 text-fg-red-900')}>{pass ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-fg-emerald-600" /> : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-fg-red-600" />}{l}</li>)}</ul>
    </div>
  );
}

/* ---------------- Data sources & matching ---------------- */
function Sources() {
  const { tx, tr, n } = useI18n();
  const { can } = useRole();
  const [st, setSt] = useState<Record<string, 'linked' | 'rejected'>>({});
  const tone = { active: ['green', tx('Connected', 'متصل')], pilot: ['blue', tx('Pilot', 'آزمایشی')], evaluating: ['amber', tx('Evaluating', 'در حال ارزیابی')], planned: ['slate', tx('Planned', 'برنامه‌ریزی')], manual: ['indigo', tx('Manual import', 'ورود دستی')] } as const;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SOURCES.map((s, i) => (
          <Card key={s.id} className="p-3" >
            <div className="flex items-start gap-2.5" style={{ animation: `enter .4s ${i * 50}ms both` }}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-100 text-fg-gold-700">{s.status === 'manual' ? <FileUp className="h-4 w-4" /> : s.status === 'active' ? <Database className="h-4 w-4" /> : <Plug className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1 leading-tight"><div className="flex items-center gap-2"><h3 className="truncate text-[13px] font-bold">{s.name}</h3><Pill tone={tone[s.status][0] as 'green'}>{tone[s.status][1]}</Pill></div><div className="text-[11px] text-fg-navy-500">{tr(s.kind)}</div></div></div>
            <p className="mt-2 text-xs text-fg-navy-600">{tr(s.note)}</p>
            {s.rows > 0 ? <div className="mt-2.5 space-y-1.5"><div className="flex justify-between text-[11px]"><span className="text-fg-navy-500">{tx('Linked to a horse ID', 'متصل به شناسه اسب')}</span><b>{n(Math.round((s.linked / s.rows) * 100))}%</b></div><Meter value={(s.linked / s.rows) * 100} color="bg-emerald-500" /><div className="flex justify-between text-[11px] text-fg-navy-500"><span>{n(s.rows)} {tx('rows', 'ردیف')}</span><span className={s.review ? 'font-semibold text-fg-amber-700' : ''}>{n(s.review)} {tx('need review', 'نیازمند بررسی')}</span><span>{s.last}</span></div></div> : <div className="mt-2.5 text-[11px] font-semibold text-navy-400">{tx('No data yet', 'هنوز داده‌ای نیست')}</div>}
          </Card>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="sport" icon={<Link2 />} title={tx('Match review', 'بازبینی تطبیق‌ها')} sub={tx('Imported result rows that could not be linked with a strong identifier', 'ردیف‌های نتیجه‌ای که با شناسه قوی متصل نشدند')} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Imported row', 'ردیف واردشده')}</th><th className="pb-2 text-start font-semibold">{tx('Matched horse', 'اسب تطبیق‌یافته')}</th><th className="pb-2 text-start font-semibold">{tx('By', 'با')}</th><th className="pb-2 text-end font-semibold">{tx('Decision', 'تصمیم')}</th></tr></thead>
              <tbody>
                {MATCHES.map((m, i) => {
                  const h = m.horse ? horseById(m.horse) : undefined;
                  const state = st[m.id] ?? (m.status === 'review' ? undefined : m.status);
                  const strong = m.by !== 'name';
                  return (
                    <tr key={m.id} className="border-t border-line align-top" style={{ animation: `enter .3s ${i * 40}ms both` }}>
                      <td className="py-2 pe-2"><div className="font-semibold leading-tight">{m.raw}</div><div className="text-[11px] text-fg-navy-500">{m.src} · {tr(m.sub)}</div></td>
                      <td className="py-2 pe-2">{h ? <a href={`#/horses/${h.id}`} className="flex items-center gap-2 hover:underline"><Img src={px(h.photo, 60, 60)} alt="" pos={h.pos} className="h-7 w-7 shrink-0 rounded-md" /><span className="font-semibold text-fg-sky-700">{tr(h.name)}</span></a> : <span className="text-navy-400">{tx('No candidate', 'بدون کاندید')}</span>}</td>
                      <td className="py-2 pe-2"><Pill tone={strong ? 'green' : 'amber'}>{m.by === 'microchip' ? tx('Microchip', 'میکروچیپ') : m.by === 'passport' ? tx('Passport', 'پاسپورت') : m.by === 'registry' ? tx('Registry no.', 'شماره ثبت') : tx('Name only', 'فقط نام')}</Pill><div className="mt-0.5 text-[10px] text-fg-navy-500">{n(m.conf)}%</div></td>
                      <td className="py-2 text-end">
                        {state === 'linked' ? <Pill tone="green" icon={<Check className="h-3 w-3" />}>{tx('Linked', 'متصل')}</Pill> : state === 'rejected' ? <Pill tone="slate">{tx('Rejected', 'رد شد')}</Pill> : can('verify') && h ? (
                          <div className="flex justify-end gap-1"><button onClick={() => setSt((s) => ({ ...s, [m.id]: 'linked' }))} className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">{tx('Link', 'اتصال')}</button><button onClick={() => setSt((s) => ({ ...s, [m.id]: 'rejected' }))} className="rounded-lg bg-surface-2 px-2 py-1 text-[11px] font-semibold hover:bg-slate-200">{tx('Reject', 'رد')}</button></div>
                        ) : <Pill tone="amber">{tx('Needs review', 'نیازمند بررسی')}</Pill>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="min-w-0 space-y-3">
          <Card className="p-3">
            <PanelHeader phase="sport" icon={<Search />} title={tx('Matching policy', 'سیاست تطبیق')} />
            <ol className="space-y-1.5 text-xs">{[[tx('Microchip', 'میکروچیپ'), 'green'], [tx('Passport / FEI number', 'پاسپورت / شماره FEI'), 'green'], [tx('Registry number', 'شماره ثبت'), 'green'], [tx('Name only → never merged automatically', 'فقط نام ← هرگز خودکار ادغام نمی‌شود'), 'amber']].map(([l, t], i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-surface-2/70 p-2"><span className={cn('grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white', t === 'green' ? 'bg-emerald-500' : 'bg-amber-500')}>{n(i + 1)}</span>{l}</li>)}</ol>
          </Card>
          
          {(can('import') || can('results')) && <button className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface-2/50 p-4 text-sm font-semibold text-fg-navy-700 transition hover:border-gold-400 hover:bg-gold-50/60"><FileUp className="h-4 w-4" />{tx('Import results file (CSV / Excel)', 'ورود فایل نتایج (CSV / Excel)')}</button>}
          <span className="sr-only"><Crown /></span>
        </div>
      </div>
    </div>
  );
}

/* ---------- R161 LIVE PARITY: real sport archives ----------
 * Federation racing races (GET /api/racing/races) and the competition
 * calendar (GET /api/competitions) — the same live archives the core
 * interface serves, shown above the demo-sample tooling with honest
 * provenance labels. */
function LiveRacingStrip() {
  const { tx, n, date } = useI18n();
  const { data, done } = useLiveFetch('races', () => fetchRacingRaces(8, 0));
  if (!done || !data || !data.races.length) return null;
  return (
    <Card className="p-3">
      <PanelHeader phase="sport" icon={<Database />} title={tx('Federation racing archive', 'آرشیو مسابقات فدراسیون')}
        sub={tx(`Live from the asbdavani racing archive · ${n(data.total)} races on record`, `زنده از آرشیو مسابقات اسب‌دوانی · ${n(data.total)} مسابقه ثبت‌شده`)} />
      <div className="grid gap-1.5 sm:grid-cols-2">
        {data.races.map((r: LiveRaceRow) => (
          <div key={r.raceId} className="flex items-center gap-2.5 rounded-lg bg-surface-2/60 px-2.5 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-100 text-fg-gold-800"><Trophy className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[13px] font-semibold">{r.name ?? tx('Race', 'مسابقه')}{r.distanceM ? ` · ${n(r.distanceM)}m` : ''}</b>
              <span className="block truncate text-[11px] text-fg-navy-500">{r.date ? date(r.date, 'short') : ''}{r.location ? ` · ${r.location}` : ''}{r.ageClass ? ` · ${r.ageClass}` : ''}{r.starters != null ? ` · ${n(r.starters)} ${tx('starters', 'شرکت‌کننده')}` : ''}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LiveCompetitionsStrip() {
  const { tx, tr, n, date } = useI18n();
  const { data, done } = useLiveFetch('competitions', () => fetchCompetitions(8, 0));
  if (!done || !data || !data.rows.length) return null;
  return (
    <Card className="p-3">
      <PanelHeader phase="sport" icon={<CalendarDays />} title={tx('Competition calendar — live', 'تقویم مسابقات — زنده')}
        sub={tx(`Recorded competitions in the national archive · ${n(data.total)}`, 'مسابقات ثبت‌شده در آرشیو ملی', )} />
      <div className="grid gap-1.5 sm:grid-cols-2">
        {data.rows.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 rounded-lg bg-surface-2/60 px-2.5 py-1.5">
            <span className="stat-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-100 text-center leading-none text-fg-gold-800"><span><span className="block text-[13px] font-bold">{c.date ? date(c.date).split(' ')[0] : '—'}</span><span className="block text-[9px] font-bold uppercase">{c.date ? date(c.date, 'month') : ''}</span></span></span>
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block truncate text-[13px] font-semibold">{tr(c.name)}</b>
              <span className="block truncate text-[11px] text-fg-navy-500">{c.venue}{c.discipline ? ` · ${c.discipline}` : ''}{c.tier ? ` · ${c.tier}` : ''}{c.resultCount != null ? ` · ${n(c.resultCount)} ${tx('results', 'نتیجه')}` : ''}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
