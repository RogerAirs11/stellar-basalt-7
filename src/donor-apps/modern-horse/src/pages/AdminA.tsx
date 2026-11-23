import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Check, CircleCheck, Clock, Copy, Database, FileText, GitMerge, History, Plus, Search, ShieldCheck, UserCheck, UserX, Users, FileUp, Scale } from 'lucide-react';
import { GENDER_L, HORSES, horseById, px, type Horse } from '../data';
import { QKIND, QUEUE, USERS, type QItem, type QKind, type UserRow } from '../admin-data';
import { BREEDS } from '../data';
import { idsOf, parentsOf, primaryTrust, strProfile, TRUST_L, type TrustLevel } from '../records';
import { L, useI18n } from '../i18n';
import { addRule, updateRule, useRules, type Rule, type Sev } from '../qc';
import { ROLES, useRole, type Cap } from '../role';
import { Card, Chip, Img, Meter, Notice, PanelHeader, Pill, Split, TrustBadge, inputCls, Field, Select } from '../components/ui';
import { Donut, HBar, Spark } from '../components/charts';
import { cn } from '../utils/cn';

const kc = (k: QKind) => ({ sky: 'bg-sky-100 text-fg-sky-800', indigo: 'bg-indigo-100 text-fg-indigo-800', amber: 'bg-amber-100 text-fg-amber-800', red: 'bg-red-100 text-fg-red-800', teal: 'bg-teal-100 text-fg-teal-800', violet: 'bg-violet-100 text-fg-violet-800', fuchsia: 'bg-fuchsia-100 text-fg-fuchsia-800' } as Record<string, string>)[QKIND[k].tone];

/* =============================== Overview =============================== */
export function AdminOverview() {
  const { tx, tr, n } = useI18n();
  const rules = useRules();
  const trust = useMemo(() => { const c: Record<string, number> = {}; HORSES.forEach((h) => { const t = primaryTrust(h); c[t] = (c[t] || 0) + 1; }); return c; }, []);
  const tcol: Record<string, string> = { self: '#969fac', uploaded: '#daa566', reviewed: '#5c9fc8', official: '#61ac89', conflict: '#ca665f' };
  const byKind = (Object.keys(QKIND) as QKind[]).map((k) => ({ k, c: QUEUE.filter((q) => q.kind === k).length })).filter((x) => x.c);
  const roles = [['owner', 1520], ['breeder', 610], ['rider', 480], ['vet', 190], ['organizer', 74], ['lab', 12], ['federation', 46]] as const;
  const prov: [string, number][] = [[tx('Tehran', 'تهران'), 91], [tx('Isfahan', 'اصفهان'), 88], [tx('Fars', 'فارس'), 84], [tx('Golestan', 'گلستان'), 79], [tx('Khuzestan', 'خوزستان'), 76], [tx('Kurdistan', 'کردستان'), 63]];
  const kp: { i: ReactNode; l: string; v: string; h: string; s: number[]; c: string }[] = [
    { i: <Database />, l: tx('Records entered', 'رکوردهای واردشده'), v: n(48230), h: `+${n(312)} ${tx('this week', 'این هفته')}`, s: [30, 34, 33, 38, 41, 45, 48], c: '#4880a8' },
    { i: <ShieldCheck />, l: tx('With valid identifier', 'دارای شناسه معتبر'), v: `${n(94.2, 1)}%`, h: tx('microchip / passport / ID', 'میکروچیپ / پاسپورت / شناسه'), s: [88, 89, 91, 92, 93, 94, 94.2], c: '#61ac89' },
    { i: <FileText />, l: tx('Passport reviewed', 'پاسپورت بررسی‌شده'), v: `${n(71.4, 1)}%`, h: tx('or reviewed document', 'یا مدرک بررسی‌شده'), s: [58, 61, 63, 66, 68, 70, 71.4], c: '#5c9fc8' },
    { i: <GitMerge />, l: tx('Reliable pedigree', 'شجره قابل اتکا'), v: `${n(58.7, 1)}%`, h: tx('≥ 5 generations known', '≥ ۵ نسل شناخته‌شده'), s: [44, 47, 50, 52, 55, 57, 58.7], c: '#8b4592' },
    { i: <Copy />, l: tx('Duplicates found / resolved', 'تکراری یافت / رفع‌شده'), v: `${n(312)} / ${n(287)}`, h: `${n(92)}% ${tx('resolved', 'رفع‌شده')}`, s: [200, 220, 245, 262, 281, 300, 312], c: '#daa566' },
    { i: <Clock />, l: tx('Avg. handling time', 'میانگین زمان رسیدگی'), v: `${n(2.4, 1)} ${tx('days', 'روز')}`, h: tx('registration & correction', 'ثبت و اصلاح'), s: [4.1, 3.8, 3.4, 3.1, 2.8, 2.6, 2.4], c: '#7256bb' },
    { i: <Check />, l: tx('Results linked to ID', 'نتایج متصل به شناسه'), v: `${n(86.1, 1)}%`, h: tx('86% by microchip / passport', '۸۶٪ با میکروچیپ / پاسپورت'), s: [70, 74, 78, 81, 83, 85, 86.1], c: '#a78b61' },
    { i: <Users />, l: tx('Active users', 'کاربران فعال'), v: n(3412), h: tx('by role →', 'بر اساس نقش ←'), s: [2400, 2600, 2800, 3000, 3150, 3300, 3412], c: '#5157b3' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kp.map((k, i) => (
          <div key={k.l} className="panel overflow-hidden p-3" style={{ animation: `enter .4s ${i * 45}ms both` }}>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-fg-navy-500"><span className="grid h-6 w-6 place-items-center rounded-md bg-violet-100 text-fg-violet-700 [&>svg]:h-3.5 [&>svg]:w-3.5">{k.i}</span><span className="truncate">{k.l}</span></div>
            <div className="mt-1 font-display text-2xl font-semibold leading-tight">{k.v}</div>
            <div className="text-[11px] text-fg-navy-500">{k.h}</div>
            <Spark data={k.s} color={k.c} className="mt-1.5" h={30} />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<UserCheck />} title={tx('Trust level of records', 'سطح اعتبار رکوردها')} sub={tx('Sample of the registry', 'نمونه‌ای از ثبت ملی')} />
          <div className="flex items-center gap-3"><Donut size={96} label={`${n(Math.round((((trust.official || 0) + (trust.reviewed || 0)) / HORSES.length) * 100))}%`} parts={(['official', 'reviewed', 'uploaded', 'self', 'conflict'] as TrustLevel[]).map((t) => ({ v: trust[t] || 0, c: tcol[t] }))} />
            <ul className="min-w-0 flex-1 space-y-1 text-[11px]">{(['official', 'reviewed', 'uploaded', 'self', 'conflict'] as TrustLevel[]).map((t) => <li key={t} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: tcol[t] }} /><span className="flex-1 truncate text-fg-navy-600">{tr(TRUST_L[t].short)}</span><b className="tabular-nums">{n(trust[t] || 0)}</b></li>)}</ul></div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<Clock />} title={tx('Review backlog', 'پرونده‌های معوق')} action={<a href="#/admin/queue" className="text-xs font-semibold text-fg-violet-700 hover:underline">{tx('Open queue', 'باز کردن صف')}</a>} />
          <div className="space-y-2">{byKind.map((x) => <HBar key={x.k} label={tr(QKIND[x.k].l)} value={x.c} max={4} color={{ sky: 'bg-sky-500', indigo: 'bg-indigo-500', amber: 'bg-amber-500', red: 'bg-red-500', teal: 'bg-teal-500', violet: 'bg-violet-500', fuchsia: 'bg-fuchsia-500' }[QKIND[x.k].tone]} right={n(x.c * 38)} />)}</div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<Database />} title={tx('Data quality by province', 'کیفیت داده بر اساس استان')} />
          <div className="space-y-2">{prov.map(([l, v]) => <HBar key={l} label={l} value={v} max={100} color={v >= 80 ? 'bg-emerald-500' : v >= 70 ? 'bg-amber-500' : 'bg-red-500'} right={`${n(v)}%`} />)}</div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<Users />} title={tx('Active users by role', 'کاربران فعال بر اساس نقش')} />
          <div className="space-y-2">{roles.map(([k, v]) => <HBar key={k} label={tr(ROLES.find((r) => r.key === k)!.title)} value={v} max={1520} color="bg-indigo-500" right={n(v)} />)}</div>
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<Scale />} title={tx('Rules triggered · last 30 days', 'قوانین فعال‌شده · ۳۰ روز اخیر')} action={<a href="#/admin/rules" className="text-xs font-semibold text-fg-violet-700 hover:underline">{tx('Manage rules', 'مدیریت قوانین')}</a>} />
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">{[...rules].sort((a, b) => b.hits - a.hits).slice(0, 8).map((r) => <HBar key={r.id} label={tr(r.name)} value={r.hits} max={220} color={r.sev === 'block' ? 'bg-red-500' : r.sev === 'warn' ? 'bg-amber-500' : r.sev === 'info' ? 'bg-sky-500' : 'bg-od-slate-300'} right={n(r.hits)} />)}</div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<ArrowRight />} title={tx('Quick actions', 'اقدامات سریع')} />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">{[[tx('Review queue', 'صف بررسی'), '/admin/queue', `${n(QUEUE.length)} ${tx('open', 'باز')}`, <ShieldCheck key="a" />], [tx('Import legacy data', 'ورود داده قدیمی'), '/admin/import', tx('4 jobs', '۴ کار'), <FileUp key="b" />], [tx('National reports', 'گزارش‌های ملی'), '/admin/reports', tx('export CSV / PDF', 'خروجی'), <Database key="c" />]].map(([l, to, s, ic]) => <a key={String(l)} href={'#' + to} className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 p-2.5 transition hover:border-violet-300 hover:bg-violet-50"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-fg-violet-700 [&>svg]:h-4 [&>svg]:w-4">{ic}</span><span className="leading-tight"><b className="block text-[13px]">{l}</b><span className="text-[11px] text-fg-navy-500">{s}</span></span></a>)}</div>
        </Card>
      </div>
    </div>
  );
}

/* =============================== Review queue =============================== */
const FIELD_L: Record<string, L> = { name: L('Name', 'نام'), birth: L('Birth date', 'تاریخ تولد'), sex: L('Sex', 'جنس'), breed: L('Breed', 'نژاد'), chip: L('Microchip', 'میکروچیپ'), passport: L('Passport', 'پاسپورت'), sire: L('Sire', 'پدر'), dam: L('Dam', 'مادر'), location: L('Location', 'محل'), owner: L('Owner', 'مالک') };
const fieldsOf = (h: Horse): Record<string, L> => { const i = idsOf(h), p = parentsOf(h); const u = L('Unknown', 'نامشخص'); return { name: h.name, birth: L(h.birth, h.birth), sex: GENDER_L[h.gender], breed: h.breed, chip: L(i.chip, i.chip), passport: L(i.passport, i.passport), sire: p.sire ?? u, dam: p.dam ?? u, location: h.location, owner: h.owner }; };

export function AdminQueue() {
  const { tx, tr, n, date } = useI18n();
  const [kind, setKind] = useState<'all' | QKind>('all');
  const [sel, setSel] = useState<string | undefined>();
  const [done, setDone] = useState<Record<string, string>>({});
  const list = QUEUE.filter((q) => kind === 'all' || q.kind === kind);
  const cur = QUEUE.find((q) => q.id === sel) ?? list[0];
  const open = QUEUE.filter((q) => !done[q.id]).length;
  const prioDot = { high: 'bg-red-500', normal: 'bg-amber-500', low: 'bg-slate-400' };
  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
        <Chip phase="admin" active={kind === 'all'} onClick={() => setKind('all')}>{tx('All', 'همه')} · {n(QUEUE.length)}</Chip>
        {(Object.keys(QKIND) as QKind[]).map((k) => <Chip key={k} phase="admin" active={kind === k} onClick={() => setKind(k)}>{tr(QKIND[k].l)} · {n(QUEUE.filter((q) => q.kind === k).length)}</Chip>)}
        <span className="ms-auto text-xs text-fg-navy-500"><b className="text-sm text-fg-navy-900">{n(open)}</b> {tx('open', 'باز')}</span>
      </div>
      <div className="min-h-0 lg:flex-1">
        <Split hasSel={!!sel} onBack={() => setSel(undefined)} listW="lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
          list={<ul className="space-y-1.5">{list.map((q, i) => { const h = horseById(q.horse); return (
            <li key={q.id}><button onClick={() => setSel(q.id)} aria-current={cur?.id === q.id} className={cn('flex w-full items-start gap-2.5 rounded-xl border p-2 text-start transition-all', cur?.id === q.id ? 'border-violet-400 bg-violet-50 shadow-sm' : 'border-transparent bg-surface/60 hover:border-line hover:bg-surface', done[q.id] && 'opacity-55')} style={{ animation: `enter .3s ${i * 30}ms both` }}>
              {h && <Img src={px(h.photo, 80, 80)} alt="" pos={h.pos} className="h-10 w-10 shrink-0 rounded-lg" />}
              <span className="min-w-0 flex-1 leading-tight"><span className="flex items-center gap-1.5"><span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', kc(q.kind))}>{tr(QKIND[q.kind].l)}</span><span className="font-mono text-[10px] text-navy-400">{q.id}</span><span className={cn('ms-auto h-2 w-2 rounded-full', prioDot[q.prio])} title={q.prio} /></span><span className="mt-0.5 block line-clamp-2 text-[13px] font-bold">{tr(q.title)}</span><span className="text-[11px] text-fg-navy-500">{h ? tr(h.name) : ''} · {date(q.date)}</span></span>
              {done[q.id] && <Check className="h-4 w-4 shrink-0 text-fg-emerald-600" />}
            </button></li>); })}</ul>}
          detail={cur ? <QueueDetail key={cur.id} it={cur} result={done[cur.id]} onDone={(r) => setDone((d) => ({ ...d, [cur.id]: r }))} /> : null} />
      </div>
    </div>
  );
}

function QueueDetail({ it, result, onDone }: { it: QItem; result?: string; onDone: (r: string) => void }) {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const h = horseById(it.horse);
  const [reason, setReason] = useState('');
  const [scopes, setScopes] = useState<string[]>(it.scopes?.slice(0, 2).map((s) => s.k) ?? []);
  const [pick, setPick] = useState(0);
  const act = (label: string, need = false) => { if (!need || reason.trim()) onDone(label); };
  const verify = can('verify');
  const btn = (l: string, tone: 'ok' | 'bad' | 'neutral', on: () => void, disabled = false) => (
    <button key={l} onClick={on} disabled={!verify || disabled} className={cn('rounded-xl px-3.5 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40', tone === 'ok' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : tone === 'bad' ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-line bg-surface text-fg-navy-700 hover:bg-surface-2')}>{l}</button>
  );
  const needReason = !reason.trim();
  const cmp = it.incoming && h ? (() => { const a = fieldsOf(h); return Object.keys(FIELD_L).map((k) => ({ k, a: a[k], b: it.incoming![k], same: tr(a[k]).toLowerCase() === tr(it.incoming![k]).toLowerCase() })); })() : [];
  return (
    <div className="panel animate-enter overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 p-3">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', kc(it.kind))}>{tr(QKIND[it.kind].l)}</span><span className="font-mono text-xs text-fg-navy-500">{it.id}</span>
        <Pill tone={it.prio === 'high' ? 'red' : it.prio === 'normal' ? 'amber' : 'slate'}>{it.prio === 'high' ? tx('High priority', 'اولویت بالا') : it.prio === 'normal' ? tx('Normal', 'عادی') : tx('Low', 'کم')}</Pill>
        <span className="ms-auto text-xs text-fg-navy-500">{tr(it.by)} · {tr(it.role)} · {date(it.date)}</span>
      </div>
      <div className="space-y-3 p-3">
        <div><h2 className="font-display text-xl font-semibold leading-tight">{tr(it.title)}</h2><p className="mt-1 text-sm text-fg-navy-600">{tr(it.note)}</p></div>
        {h && <a href={`#/horses/${h.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-2 transition hover:border-sky-300"><Img src={px(h.photo, 100, 100)} alt="" pos={h.pos} className="h-11 w-11 rounded-lg" /><span className="min-w-0 flex-1 leading-tight"><b className="block">{tr(h.name)}</b><span className="text-[11px] text-fg-navy-500" dir="ltr">{h.regId}</span></span><TrustBadge level={primaryTrust(h)} /><ArrowRight className="h-4 w-4 text-od-navy-300 rtl:rotate-180" /></a>}

        {it.kind === 'duplicate' && it.incoming && (
          <>
            <div className="flex items-center gap-3 rounded-xl bg-amber-100/60 p-2.5"><span className="font-display text-3xl font-semibold text-fg-amber-800">{n(it.score!)}%</span><div className="flex-1"><div className="text-[13px] font-bold text-fg-amber-900">{tx('Match score — human review required', 'امتیاز تطابق — نیازمند بازبینی انسانی')}</div><Meter value={it.score!} color="bg-amber-500" h="h-2" /></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-1.5 text-start font-semibold">{tx('Field', 'فیلد')}</th><th className="pb-1.5 text-start font-semibold">{tx('Existing record', 'رکورد موجود')}</th><th className="pb-1.5 text-start font-semibold">{tx('Incoming submission', 'ثبت جدید')}</th></tr></thead>
              <tbody>{cmp.map((r) => <tr key={r.k} className="border-t border-line"><td className="py-1.5 font-semibold text-fg-navy-600">{tr(FIELD_L[r.k])}</td><td className={cn('py-1.5', r.same && 'text-fg-emerald-700')} dir="auto">{tr(r.a)}</td><td className={cn('py-1.5 font-semibold', r.same ? 'text-fg-emerald-700' : 'rounded bg-amber-100/70 text-fg-amber-900')} dir="auto">{r.same && <Check className="me-1 inline h-3 w-3" strokeWidth={3} />}{tr(r.b)}</td></tr>)}</tbody></table></div>
            <ul className="flex flex-wrap gap-1.5">{it.signals!.map((s, i) => <li key={i}><Pill tone={s.hit ? 'amber' : 'slate'}>{tr(s.l)}</Pill></li>)}</ul>
          </>
        )}
        {it.kind === 'correction' && it.diff && (
          <div className="space-y-2">
            {it.diff.map((d, i) => <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2/70 p-2.5 text-[13px]"><b className="w-24">{tr(d.field)}</b><span className="rounded bg-red-100 px-2 py-0.5 text-fg-red-700 line-through" dir="auto">{tr(d.from)}</span><ArrowRight className="h-3.5 w-3.5 text-navy-400 rtl:rotate-180" /><span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-fg-emerald-800" dir="auto">{tr(d.to)}</span></div>)}
            <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-surface-2/70 p-2.5 text-xs"><b className="text-fg-navy-500">{tx('Reason', 'دلیل')}</b><div className="mt-0.5 text-fg-navy-800">{tr(it.reason!)}</div></div><div className="flex items-center gap-2 rounded-xl bg-sky-100/60 p-2.5 text-xs"><FileText className="h-4 w-4 text-fg-sky-700" /><div><b className="text-fg-sky-900">{tx('Evidence', 'مدرک')}</b><div className="text-fg-sky-800">{tr(it.evidence!)}</div></div></div></div>
          </div>
        )}
        {it.kind === 'conflict' && it.sources && (
          <div className="space-y-1.5"><div className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tr(it.conflictField!)} — {tx('all values are kept; choose the final one', 'همه مقادیر نگهداری می‌شود؛ مقدار نهایی را انتخاب کنید')}</div>
            {it.sources.map((s, i) => <label key={i} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-[13px] transition', pick === i ? 'border-violet-400 bg-violet-50' : 'border-line bg-surface-2/50 hover:bg-surface-2')}><input type="radio" name={'p' + it.id} checked={pick === i} onChange={() => setPick(i)} className="accent-violet-600" /><span className="flex-1"><b>{s.value}</b><span className="block text-[11px] text-fg-navy-500">{s.src} · {date(s.date)}</span></span></label>)}</div>
        )}
        {it.kind === 'parentage' && h && (
          <div><div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('STR markers — 4 of 17 incompatible with declared sire', 'مارکرهای STR — ۴ از ۱۷ با پدر اعلام‌شده ناسازگار')}</div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">{strProfile(h).map((m, i) => { const bad = [2, 5, 9, 13].includes(i); return <div key={m.m} className={cn('rounded-lg border px-1.5 py-1 text-center', bad ? 'border-red-300 bg-red-100/70' : 'border-line bg-surface-2/60')}><div className="text-[10px] font-bold text-fg-navy-500">{m.m}</div><div className={cn('font-mono text-xs font-bold', bad && 'text-fg-red-700')}>{m.a}/{m.b}</div></div>; })}</div></div>
        )}
        {it.scopes && (
          <div><div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Approve only what you actually checked', 'فقط آنچه واقعاً بررسی کرده‌اید را تأیید کنید')}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">{it.scopes.map((s) => { const on = scopes.includes(s.k); return <button key={s.k} onClick={() => setScopes((x) => (on ? x.filter((y) => y !== s.k) : [...x, s.k]))} className={cn('flex items-center gap-2 rounded-xl border p-2 text-start text-[13px] transition', on ? 'border-emerald-400 bg-emerald-50' : 'border-line bg-surface-2/50 hover:bg-surface-2')}><span className={cn('grid h-4 w-4 place-items-center rounded border', on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-navy-300 bg-field')}>{on && <Check className="h-3 w-3" strokeWidth={4} />}</span>{tr(s.l)}</button>; })}</div></div>
        )}

        {result ? <Notice tone="green" icon={<CircleCheck />} title={tx('Decision recorded', 'تصمیم ثبت شد')}>{result}{reason && <> — <i>{reason}</i></>} · {tx('written to the audit log with your name and time.', 'با نام و زمان شما در لاگ ممیزی ثبت شد.')}</Notice> : (
          <>
            {!verify && <Notice tone="slate">{tx('View only — your role cannot decide on cases.', 'فقط مشاهده — نقش شما امکان تصمیم‌گیری ندارد.')}</Notice>}
            {verify && ['duplicate', 'correction', 'conflict', 'parentage'].includes(it.kind) && <Field label={tx('Decision reason (required)', 'دلیل تصمیم (الزامی)')}><textarea rows={2} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
            <div className="flex flex-wrap gap-2">
              {it.kind === 'duplicate' && <>{btn(tx('Not a duplicate', 'تکراری نیست'), 'ok', () => act(tx('Marked not a duplicate', 'تکراری نیست ثبت شد'), true), needReason)}{btn(tx('Merge (human-confirmed)', 'ادغام (با تأیید انسانی)'), 'bad', () => act(tx('Records merged after human review', 'رکوردها پس از بررسی انسانی ادغام شد'), true), needReason)}{btn(tx('Request info', 'درخواست اطلاعات'), 'neutral', () => act(tx('Information requested from submitter', 'اطلاعات از ثبت‌کننده درخواست شد')))}</>}
              {it.kind === 'correction' && <>{btn(tx('Approve change', 'تأیید تغییر'), 'ok', () => act(tx('Correction approved and versioned', 'اصلاح تأیید و نسخه‌بندی شد'), true), needReason)}{btn(tx('Reject', 'رد'), 'bad', () => act(tx('Correction rejected', 'اصلاح رد شد'), true), needReason)}{btn(tx('Ask for evidence', 'درخواست مدرک'), 'neutral', () => act(tx('More evidence requested', 'مدرک بیشتر درخواست شد')))}</>}
              {it.kind === 'conflict' && <>{btn(tx('Resolve with selected value', 'رفع با مقدار انتخاب‌شده'), 'ok', () => act(`${tx('Resolved: kept', 'رفع شد: نگه داشته شد')} “${it.sources![pick].value}”`, true), needReason)}{btn(tx('Escalate', 'ارجاع'), 'neutral', () => act(tx('Escalated to senior reviewer', 'به کارشناس ارشد ارجاع شد')))}</>}
              {it.kind === 'parentage' && <>{btn(tx('Mark parentage conflicted', 'علامت‌گذاری تعارض والدین'), 'bad', () => act(tx('Parentage marked as conflicted', 'والدین به‌عنوان متعارض علامت خورد'), true), needReason)}{btn(tx('Request re-test', 'درخواست آزمایش مجدد'), 'neutral', () => act(tx('Re-test requested from laboratory', 'آزمایش مجدد از آزمایشگاه درخواست شد')))}</>}
              {it.scopes && <>{btn(tx(`Approve ${n(scopes.length)} scope(s)`, `تأیید ${n(scopes.length)} دامنه`), 'ok', () => act(tx(`Approved scopes: ${scopes.join(', ')} — “Official” for those items only`, `دامنه‌های تأییدشده: ${scopes.join('، ')} — فقط برای همین موارد «رسمی»`)), !scopes.length)}{btn(tx('Request more info', 'درخواست اطلاعات بیشتر'), 'neutral', () => act(tx('More information requested', 'اطلاعات بیشتر درخواست شد')))}{btn(tx('Reject', 'رد'), 'bad', () => act(tx('Rejected', 'رد شد')))}</>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* =============================== Rules engine =============================== */
export function AdminRules() {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const rules = useRules();
  const [open, setOpen] = useState<string | null>('dup-ids');
  const [adding, setAdding] = useState(false);
  const [nr, setNr] = useState({ name: '', breed: 'all', sev: 'warn' as Sev, tpl: 'age' });
  const edit = can('admin');
  const SEV: { v: Sev; l: string; c: string }[] = [{ v: 'block', l: tx('Block', 'مسدود'), c: 'bg-red-600' }, { v: 'warn', l: tx('Warn', 'هشدار'), c: 'bg-amber-500' }, { v: 'info', l: tx('Info', 'اطلاع'), c: 'bg-sky-500' }, { v: 'off', l: tx('Off', 'خاموش'), c: 'bg-slate-400' }];
  const tpls: Record<string, [string, string]> = { age: ['Minimum age at registration', 'حداقل سن هنگام ثبت'], docs: ['Required documents by breed', 'مدارک الزامی بر اساس نژاد'], gap: ['Minimum gap between foalings', 'حداقل فاصله بین زایش‌ها'], et: ['Embryo-transfer permission', 'مجوز انتقال جنین'] };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><span className="text-sm text-fg-navy-600"><b className="text-fg-navy-900">{n(rules.length)}</b> {tx('rules', 'قاعده')}</span>{edit && <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-violet-700"><Plus className="h-4 w-4" />{tx('New rule', 'قاعده جدید')}</button>}</div>
      {adding && (
        <Card className="animate-enter p-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={tx('Rule name', 'نام قاعده')}><input className={inputCls} value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} /></Field>
            <Field label={tx('Condition template', 'الگوی شرط')}><Select label="tpl" value={nr.tpl} onChange={(v) => setNr({ ...nr, tpl: v })} options={Object.entries(tpls).map(([v, l]) => ({ v, l: tx(l[0], l[1]) }))} /></Field>
            <Field label={tx('Scope', 'دامنه')}><Select label="scope" value={nr.breed} onChange={(v) => setNr({ ...nr, breed: v })} options={[{ v: 'all', l: tx('All breeds', 'همه نژادها') }, ...BREEDS.map((b) => ({ v: b.en, l: tr(b) }))]} /></Field>
            <Field label={tx('Severity', 'شدت')}><Select label="sev" value={nr.sev} onChange={(v) => setNr({ ...nr, sev: v as Sev })} options={SEV.slice(0, 3).map((s) => ({ v: s.v, l: s.l }))} /></Field>
          </div>
          <div className="mt-2.5 flex justify-end gap-2"><button onClick={() => setAdding(false)} className="rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold hover:bg-surface-2">{tx('Cancel', 'انصراف')}</button>
            <button disabled={!nr.name} onClick={() => { const t = tpls[nr.tpl]; addRule({ id: 'custom-' + nr.name.length + nr.tpl, name: L(nr.name, nr.name), desc: L(t[0], t[1]), sev: nr.sev, scope: nr.breed === 'all' ? L('All breeds', 'همه نژادها') : L(nr.breed, BREEDS.find((b) => b.en === nr.breed)!.fa), version: 1, updated: '2025-04-15', hits: 0, history: [{ v: 1, date: '2025-04-15', by: L('Registry officer', 'کارشناس ثبت'), note: L('Rule created', 'قاعده ایجاد شد') }] }); setAdding(false); setNr({ name: '', breed: 'all', sev: 'warn', tpl: 'age' }); }} className="rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40">{tx('Create rule (v1)', 'ایجاد قاعده (نسخه ۱)')}</button></div>
        </Card>
      )}
      <ul className="space-y-1.5">
        {rules.map((r: Rule, i) => (
          <li key={r.id} className="panel overflow-hidden" style={{ animation: `enter .35s ${Math.min(i, 10) * 30}ms both` }}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2.5">
              <span className={cn('h-9 w-1 shrink-0 rounded-full', { block: 'bg-red-500', warn: 'bg-amber-500', info: 'bg-sky-500', off: 'bg-od-slate-300' }[r.sev])} />
              <div className="min-w-0 flex-1 basis-60 leading-tight"><div className="flex items-center gap-2"><h3 className="text-[14px] font-bold">{tr(r.name)}</h3><span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-fg-violet-700">v{n(r.version)}</span></div><p className="mt-0.5 line-clamp-2 text-xs text-fg-navy-600">{tr(r.desc)}</p></div>
              <div className="text-xs"><div className="text-[10px] font-bold uppercase tracking-wider text-navy-400">{tx('Scope', 'دامنه')}</div><div className="max-w-[170px] truncate font-medium">{tr(r.scope)}</div></div>
              <div className="text-center text-xs"><div className="text-[10px] font-bold uppercase tracking-wider text-navy-400">{tx('30 days', '۳۰ روز')}</div><b className="tabular-nums">{n(r.hits)}</b></div>
              <div role="group" aria-label="Severity" className="inline-flex rounded-xl border border-line bg-surface-2 p-0.5">{SEV.map((s) => <button key={s.v} disabled={!edit} onClick={() => updateRule(r.id, { sev: s.v }, L(`Severity changed to ${s.v}`, `شدت به ${s.l} تغییر کرد`))} aria-pressed={r.sev === s.v} className={cn('rounded-[9px] px-2.5 py-1 text-[11px] font-bold transition disabled:cursor-not-allowed', r.sev === s.v ? cn(s.c, 'text-white shadow') : 'text-fg-navy-500 hover:text-fg-navy-800')}>{s.l}</button>)}</div>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="grid h-8 w-8 place-items-center rounded-full text-fg-navy-500 transition hover:bg-surface-2" title={tx('Version history', 'تاریخچه نسخه‌ها')}><History className="h-4 w-4" /></button>
            </div>
            {open === r.id && <div className="animate-enter border-t border-line bg-surface-2/50 px-4 py-2.5"><ol className="space-y-1.5 text-xs">{r.history.map((h) => <li key={h.v} className="flex items-center gap-2.5"><span className="rounded bg-violet-100 px-1.5 font-mono font-bold text-fg-violet-700">v{n(h.v)}</span><span className="tabular-nums text-fg-navy-500">{date(h.date)}</span><span className="text-fg-navy-600">{tr(h.by)}</span><span className="font-medium">{tr(h.note)}</span></li>)}</ol></div>}
          </li>
        ))}
      </ul>
      {!edit && <Notice tone="slate">{tx('View only — only administrators can change rules.', 'فقط مشاهده — تنها مدیران می‌توانند قوانین را تغییر دهند.')}</Notice>}
    </div>
  );
}

/* =============================== Users & roles =============================== */
export function AdminUsers() {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const [role, setRole] = useState('all');
  const [q, setQ] = useState('');
  const [st, setSt] = useState<Record<string, 'active' | 'suspended'>>({});
  const list = USERS.filter((u) => (role === 'all' || u.role === role) && (!q || u.name.en.toLowerCase().includes(q.toLowerCase()) || u.name.fa.includes(q) || u.email.includes(q.toLowerCase())));
  const caps: [Cap, string][] = [['register', tx('Register', 'ثبت')], ['verify', tx('Verify', 'تأیید')], ['health', tx('Health data', 'سلامت')], ['dna', tx('Enter DNA', 'ثبت DNA')], ['results', tx('Enter results', 'ثبت نتایج')], ['admin', tx('Admin panel', 'پنل مدیریت')], ['reports', tx('Reports', 'گزارش‌ها')]];
  const sens = ['federation', 'admin', 'vet', 'lab', 'ministry'];
  return (
    <div className="space-y-3">
      <Card className="p-3">
        <PanelHeader phase="admin" icon={<ShieldCheck />} title={tx('Roles & permissions', 'نقش‌ها و دسترسی‌ها')} sub={tx('Role-based, with record- and field-level limits for sensitive data', 'مبتنی بر نقش، با محدودیت سطح رکورد و فیلد برای داده حساس')} />
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Role', 'نقش')}</th>{caps.map(([, l]) => <th key={l} className="pb-2 text-center font-semibold">{l}</th>)}<th className="pb-2 text-start font-semibold">{tx('Access level', 'سطح دسترسی')}</th></tr></thead>
          <tbody>{ROLES.map((r) => <tr key={r.key} className="border-t border-line"><td className="py-1.5 pe-2"><span className="flex items-center gap-2 font-semibold"><span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', r.dot)} />{tr(r.title)}</span></td>{caps.map(([c]) => <td key={c} className="text-center">{r.caps.includes(c) ? <Check className="mx-auto h-4 w-4 text-fg-emerald-600" strokeWidth={3} /> : <span className="text-od-navy-200">–</span>}</td>)}<td className="py-1.5 text-[11px] text-fg-navy-500">{tr(r.access)}</td></tr>)}</tbody></table></div>
      </Card>
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[170px] flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Search users…', 'جستجوی کاربران…')} className={cn(inputCls, 'ps-9')} /></div>
        <Select label="Role" value={role} onChange={setRole} className="w-56" options={[{ v: 'all', l: tx('All roles', 'همه نقش‌ها') }, ...ROLES.map((r) => ({ v: r.key, l: tr(r.title) }))]} />
        {can('admin') && <button className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-violet-700"><Plus className="h-4 w-4" />{tx('Invite user', 'دعوت کاربر')}</button>}
      </div>
      <Card className="overflow-x-auto p-1">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="px-3 py-2 text-start font-semibold">{tx('User', 'کاربر')}</th><th className="px-2 text-start font-semibold">{tx('Role', 'نقش')}</th><th className="hidden px-2 text-start font-semibold md:table-cell">{tx('Organisation', 'سازمان')}</th><th className="px-2 text-start font-semibold">{tx('Status', 'وضعیت')}</th><th className="px-2 text-start font-semibold">MFA</th><th className="hidden px-2 text-start font-semibold lg:table-cell">{tx('Last active', 'آخرین فعالیت')}</th><th className="px-2" /></tr></thead>
          <tbody>{list.slice(0, 18).map((u, i) => { const s = (st[u.id] ?? u.status) as UserRow['status']; const r = ROLES.find((x) => x.key === u.role)!; return (
            <tr key={u.id} className="border-t border-line" style={{ animation: `enter .3s ${i * 20}ms both` }}>
              <td className="px-3 py-1.5"><div className="font-semibold leading-tight">{tr(u.name)}</div><div className="text-[11px] text-navy-400" dir="ltr">{u.email}</div></td>
              <td className="px-2"><span className="flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', r.dot)} />{tr(r.title)}</span></td>
              <td className="hidden max-w-[200px] truncate px-2 text-fg-navy-600 md:table-cell">{tr(u.org)}</td>
              <td className="px-2"><Pill tone={s === 'active' ? 'green' : s === 'pending' ? 'amber' : 'red'}>{s === 'active' ? tx('Active', 'فعال') : s === 'pending' ? tx('Pending', 'در انتظار') : tx('Suspended', 'معلق')}</Pill></td>
              <td className="px-2">{u.mfa ? <Pill tone="green" icon={<Check className="h-3 w-3" strokeWidth={3} />}>{tx('On', 'روشن')}</Pill> : sens.includes(u.role) ? <Pill tone="red" icon={<AlertTriangle className="h-3 w-3" />}>{tx('Required', 'الزامی')}</Pill> : <Pill tone="slate">{tx('Off', 'خاموش')}</Pill>}</td>
              <td className="hidden px-2 tabular-nums text-fg-navy-500 lg:table-cell">{date(u.last)}</td>
              <td className="px-2 text-end">{can('admin') && (s === 'suspended' ? <button onClick={() => setSt((x) => ({ ...x, [u.id]: 'active' }))} className="rounded-lg p-1.5 text-fg-emerald-700 hover:bg-emerald-50" title="Reactivate"><UserCheck className="h-4 w-4" /></button> : <button onClick={() => setSt((x) => ({ ...x, [u.id]: 'suspended' }))} className="rounded-lg p-1.5 text-fg-red-600 hover:bg-red-50" title="Suspend"><UserX className="h-4 w-4" /></button>)}</td>
            </tr>); })}</tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-fg-navy-500">{tx(`Showing ${n(Math.min(18, list.length))} of ${n(list.length)} (sample of 3,412)`, `نمایش ${n(Math.min(18, list.length))} از ${n(list.length)} (نمونه‌ای از ۳٬۴۱۲)`)}</div>
      </Card>
    </div>
  );
}
