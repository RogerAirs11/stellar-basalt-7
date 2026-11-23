import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Baby, Check, CircleCheck, Download, Dna, Eye, FileText, FlaskConical, HeartPulse, Info, Lock, Medal, Pencil, Plus, ShieldCheck, Stethoscope, Syringe, Trophy, Upload, UsersRound,
} from 'lucide-react';
import { COLOUR_HEX, COLOUR_L, DISCIPLINE_L, RIDERS, perfFor, px, type Horse } from '../data';
import { AUTH, addDays, documentsOf, historyOf, idsOf, offspringOf, parentsOf, primaryTrust, provenanceOf, reproductionOf, resultsOf, statusOf, strProfile, testsOf, type TrustLevel } from '../records';
import { DISEASES, diseaseStatus, genotypeOf } from '../genetics';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { DisclosurePanel, EvidenceCard, GrantsPanel } from '../components/Trust';
import { effective, useDecisions, useHealthAccess } from '../platform-data';
import { Card, Img, Kpi, Meter, Notice, PanelHeader, Pill, SexDot, Tick, TrustBadge, TrustLegend, VisPill, Field, Select, inputCls } from '../components/ui';
import { PerformanceChart, ResultRow } from '../components/Sport';
import { cn } from '../utils/cn';

export const Empty = ({ icon, title, sub, children }: { icon: ReactNode; title: string; sub?: string; children?: ReactNode }) => (
  <div className="panel grid place-items-center border-dashed px-6 py-12 text-center">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-navy-400 [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
    <div className="mt-3 font-semibold">{title}</div>
    {sub && <p className="mt-1 max-w-md text-sm text-fg-navy-500">{sub}</p>}
    {children}
  </div>
);
/** LIVE WIRING: real registry ids are numeric; the donor's demo ids are slugs. */
export const isLiveRecord = (id: string) => /^[0-9]+$/.test(id);
const Toast = ({ msg }: { msg: string | null }) => (msg ? <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 animate-enter rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-2xl rtl:translate-x-1/2">{msg}</div> : null);
function useToast() {
  const [m, set] = useState<string | null>(null);
  return [m, (t: string) => { set(t); setTimeout(() => set(null), 2600); }] as const;
}

/* =============================== Offspring & reproduction =============================== */
export function OffspringTab({ horse }: { horse: Horse }) {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const [toast, say] = useToast();
  const [extra, setExtra] = useState<{ date: string; partner: string; method: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ date: '', partner: '', method: 'natural' });
  const kids = useMemo(() => offspringOf(horse), [horse]);
  const reps = useMemo(() => reproductionOf(horse), [horse]);
  const twins = reps.filter((r) => r.outcome === 'twins').length;
  const ets = reps.filter((r) => r.method === 'et').length;
  const MET = { natural: tx('Natural cover', 'جفت‌گیری طبیعی'), ai: tx('Artificial insemination', 'تلقیح مصنوعی'), et: tx('Embryo transfer', 'انتقال جنین') };
  const OUT = { live: ['green', tx('Live foal', 'کره زنده')], twins: ['amber', tx('Twins', 'دوقلو')], pregnant: ['sky', tx('In foal', 'آبستن')], open: ['slate', tx('Not in foal', 'غیر آبستن')] } as const;

  if (horse.gender === 'gelding') return <Empty icon={<Baby />} title={tx('No breeding records', 'سابقه تولیدمثل وجود ندارد')} sub={tx('Geldings cannot be used for breeding, so no reproduction records are kept.', 'اسب‌های اخته برای تولیدمثل استفاده نمی‌شوند و سابقه‌ای ثبت نمی‌شود.')} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi phase="breeding" icon={<Baby />} label={tx('Registered offspring', 'نتاج ثبت‌شده')} value={n(kids.length)} />
        <Kpi phase="breeding" icon={<Dna />} label={horse.gender === 'mare' ? tx('Foalings', 'زایش‌ها') : tx('Coverings', 'جفت‌گیری‌ها')} value={n(reps.length)} />
        <Kpi phase="breeding" icon={<FlaskConical />} label={tx('Embryo transfers', 'انتقال جنین')} value={n(ets)} />
        <Kpi phase="breeding" icon={<AlertTriangle />} label={tx('Twin births flagged', 'دوقلوزایی علامت‌دار')} value={n(twins)} hint={tx('Reviewed per breed rules', 'مطابق قوانین نژاد')} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="breeding" icon={<Dna />} title={tx('Reproduction records', 'سوابق تولیدمثل')} sub={horse.gender === 'mare' ? tx('Mare: covering → foaling', 'مادیان: جفت‌گیری ← زایش') : tx('Stallion: coverings and resulting foals', 'نریان: جفت‌گیری‌ها و کره‌ها')}
            action={can('register') && <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-700"><Plus className="h-3.5 w-3.5" />{tx('Add record', 'افزودن سابقه')}</button>} />
          {adding && (
            <div className="mb-3 grid animate-enter gap-3 rounded-xl bg-surface-2 p-2.5 sm:grid-cols-4">
              <input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label={tx('Covering date', 'تاریخ جفت‌گیری')} />
              <input className={inputCls} placeholder={horse.gender === 'mare' ? tx('Stallion', 'نریان') : tx('Mare', 'مادیان')} value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })} />
              <Select label="method" value={f.method} onChange={(v) => setF({ ...f, method: v })} options={[{ v: 'natural', l: MET.natural }, { v: 'ai', l: MET.ai }, { v: 'et', l: MET.et }]} />
              <button onClick={() => { if (f.date) { setExtra((e) => [{ ...f }, ...e]); setAdding(false); setF({ date: '', partner: '', method: 'natural' }); say(tx('Record added — pending review', 'سابقه افزوده شد — در انتظار بررسی')); } }} className="rounded-xl bg-fuchsia-600 text-sm font-semibold text-white hover:bg-fuchsia-700">{tx('Save', 'ذخیره')}</button>
            </div>
          )}
          {reps.length + extra.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Covered', 'جفت‌گیری')}</th><th className="pb-2 text-start font-semibold">{horse.gender === 'mare' ? tx('Stallion', 'نریان') : tx('Mare', 'مادیان')}</th><th className="pb-2 text-start font-semibold">{tx('Method', 'روش')}</th><th className="pb-2 text-start font-semibold">{tx('Foaling', 'زایش')}</th><th className="pb-2 text-end font-semibold">{tx('Outcome', 'نتیجه')}</th></tr></thead>
                <tbody>
                  {extra.map((r, i) => <tr key={'x' + i} className="border-t border-line bg-amber-50/60"><td className="py-2">{date(r.date)}</td><td>{r.partner || '—'}</td><td>{MET[r.method as 'natural']}</td><td>—</td><td className="text-end"><Pill tone="amber">{tx('Pending review', 'در انتظار بررسی')}</Pill></td></tr>)}
                  {reps.map((r, i) => (
                    <tr key={r.id} className="border-t border-line" style={{ animation: `enter .35s ${i * 40}ms both` }}>
                      <td className="py-2 tabular-nums">{date(r.mating)}</td>
                      <td>{r.partner.id ? <a href={`#/horses/${r.partner.id}`} className="font-semibold text-fg-sky-700 hover:underline">{tr(r.partner.name)}</a> : <span className="text-fg-navy-600">{tr(r.partner.name)} <span className="text-[10px] text-navy-400">({tx('unregistered', 'ثبت‌نشده')})</span></span>}</td>
                      <td><span className="inline-flex items-center gap-1">{MET[r.method]}{r.method === 'et' && <span title={r.recipient ? `${tx('Recipient', 'گیرنده')}: ${tr(r.recipient)}` : undefined} className="rounded bg-fuchsia-100 px-1 text-[10px] font-bold text-fg-fuchsia-700">ET</span>}</span>{r.recipient && <div className="text-[10px] text-fg-navy-500">{tx('Recipient mare', 'مادیان گیرنده')}: {tr(r.recipient)}</div>}</td>
                      <td className="tabular-nums">{r.foaling ? date(r.foaling) : '—'}</td>
                      <td className="text-end"><Pill tone={OUT[r.outcome][0] as 'green'} icon={r.outcome === 'twins' ? <AlertTriangle className="h-3 w-3" /> : undefined}>{OUT[r.outcome][1]}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="py-8 text-center text-sm text-fg-navy-500">{tx('No reproduction records yet.', 'هنوز سابقه تولیدمثلی ثبت نشده است.')}</p>}
          {twins > 0 && <Notice tone="amber" icon={<AlertTriangle />} className="mt-3">{tx('A twin birth is recorded. It is checked against this breed’s rule and is not automatically a violation.', 'دوقلوزایی ثبت شده است. مطابق قاعده این نژاد بررسی می‌شود و لزوماً تخلف نیست.')}</Notice>}
        </Card>
        <Card className="min-w-0 p-3">
          <PanelHeader phase="breeding" icon={<Baby />} title={tx('Offspring', 'نتاج')} sub={tx('Linked profiles', 'پروفایل‌های متصل')} />
          {kids.length ? (
            <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {kids.map((k, i) => (
                <li key={k.id} style={{ animation: `enter .35s ${i * 40}ms both` }}>
                  <a href={`#/horses/${k.id}`} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/50 p-1.5 transition hover:border-sky-300 hover:bg-sky-50">
                    <Img src={px(k.photo, 80, 80)} alt="" pos={k.pos} className="h-10 w-10 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(k.name)}</span><span className="block truncate text-[11px] text-fg-navy-500">{n(k.birth.slice(0, 4))} · {tr(COLOUR_L[k.colour])}</span></span>
                    <SexDot sex={k.gender} />
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="py-6 text-center text-sm text-fg-navy-500">{tx('No offspring registered in the database.', 'نتاجی در پایگاه داده ثبت نشده است.')}</p>}
        </Card>
      </div>
      <Toast msg={toast} />
    </div>
  );
}

/* =============================== Health (privacy-aware) =============================== */
export function HealthTab({ horse }: { horse: Horse }) {
  const { tx, date, n } = useI18n();
  const { role } = useRole();
  const access = useHealthAccess(horse.id);
  const [toast, say] = useToast();
  const base = new Date((horse.lastVet || '2025-04-15') + 'T12:00:00'); // guarded: live records have no lastVet
  const shift = (m: number) => { const d = new Date(base); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
  const vaccs = [
    { name: tx('Equine Influenza', 'آنفلوانزای اسب'), last: shift(-2), next: shift(4) }, { name: tx('Tetanus', 'کزاز'), last: shift(-5), next: shift(7) },
    { name: tx('African Horse Sickness', 'تب اسبی آفریقایی'), last: shift(-4), next: shift(8) }, { name: tx('Strangles', 'غده اسبی'), last: shift(-9), next: shift(3) },
  ];
  const carrier = horse.carrier?.[0];
  const conds = [
    ...(carrier ? [{ n: `${carrier} · ${tx('carrier', 'ناقل')}`, k: 'hereditary' as const, d: shift(-8), who: AUTH.lab, sev: tx('Carrier — unaffected', 'ناقل — بدون علامت') }] : []),
    { n: tx('Mild hock effusion (resolved)', 'تورم خفیف مفصل خرگوشی (بهبودیافته)'), k: 'acquired' as const, d: shift(-14), who: AUTH.vet, sev: tx('Mild', 'خفیف') },
  ];
  if (!access.allowed)
    return (
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-3">
          <PanelHeader phase="registry" icon={<Eye />} title={tx('Public health summary', 'خلاصه سلامت عمومی')} action={<VisPill vis="public" />} />
          <ul className="space-y-2 text-[13px]">
            <li className="flex items-center gap-2.5"><TrustBadge level={horse.verified.passport ? 'reviewed' : 'uploaded'} compact /><span className="font-semibold">{horse.verified.passport ? tx('Health documents reviewed', 'مدارک سلامت بررسی شد') : tx('Health documents uploaded · not reviewed', 'مدارک سلامت ارائه شده · بررسی نشده')}</span></li>
            <li className="flex items-center gap-2.5 text-fg-navy-600"><Info className="h-4 w-4 text-fg-sky-600" />{tx('The owner has published only this summary.', 'مالک فقط همین خلاصه را منتشر کرده است.')}</li>
          </ul>
        </Card>
        <Card className="relative overflow-hidden p-3">
          <PanelHeader phase="registry" icon={<Lock />} title={tx('Restricted health record', 'پرونده سلامت محدود')} action={<VisPill vis="private" />} />
          <div className="space-y-2 blur-[3px]" aria-hidden>{vaccs.slice(0, 3).map((v) => <div key={v.name} className="flex justify-between rounded-lg bg-surface-2 p-2 text-sm"><span>{v.name}</span><span>{v.last}</span></div>)}</div>
          <div className="absolute inset-0 grid place-items-center bg-surface/70 p-4 text-center backdrop-blur-[1px]">
            <div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-800 text-white"><Lock className="h-5 w-5" /></span>
              <div className="mt-2 font-bold">{tx('Not visible to your role', 'برای نقش شما قابل مشاهده نیست')}</div>
              <p className="mx-auto mt-1 max-w-xs text-xs text-fg-navy-500">{tx('Visible to the owner, licensed vets, the federation and authorised institutions. Every view is logged.', 'برای مالک، دامپزشکان دارای مجوز، فدراسیون و نهادهای مجاز قابل مشاهده است. هر مشاهده ثبت می‌شود.')}</p>
              <button onClick={() => say(tx('Access request sent to the owner', 'درخواست دسترسی برای مالک ارسال شد'))} className="mt-3 rounded-xl bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800">{tx('Request access', 'درخواست دسترسی')}</button></div>
          </div>
        </Card>
        <Toast msg={toast} />
      </div>
    );
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <Card className="p-3">
          <PanelHeader phase="registry" icon={<Syringe />} title={tx('Vaccinations', 'واکسیناسیون')} action={role === 'vet' && <button onClick={() => say(tx('Vaccination record saved', 'سابقه واکسن ذخیره شد'))} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />{tx('Add', 'افزودن')}</button>} />
          <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Vaccine', 'واکسن')}</th><th className="pb-2 text-start font-semibold">{tx('Last given', 'آخرین تزریق')}</th><th className="pb-2 text-start font-semibold">{tx('Next due', 'سررسید')}</th><th className="pb-2 text-end font-semibold">{tx('Recorded by', 'ثبت‌کننده')}</th></tr></thead>
            <tbody>{vaccs.map((v, i) => <tr key={i} className="border-t border-line" style={{ animation: `enter .35s ${i * 60}ms both` }}><td className="py-2 font-medium">{v.name}</td><td className="tabular-nums text-fg-navy-600">{date(v.last)}</td><td className="tabular-nums text-fg-navy-600">{date(v.next)}</td><td className="text-end"><Pill tone="green" icon={<Check className="h-3 w-3" strokeWidth={3} />}>{tx('Vet · up to date', 'دامپزشک · به‌روز')}</Pill></td></tr>)}</tbody></table></div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="registry" icon={<Stethoscope />} title={tx('Conditions & diagnoses', 'بیماری‌ها و تشخیص‌ها')} sub={tx('Acquired illness is kept separate from inherited status', 'بیماری اکتسابی از وضعیت ارثی جدا نگهداری می‌شود')} />
          <ul className="space-y-1.5">
            {conds.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-2/70 p-2 text-[13px]">
                <Pill tone={c.k === 'hereditary' ? 'fuchsia' : 'blue'}>{c.k === 'hereditary' ? tx('Hereditary', 'ارثی') : tx('Acquired', 'اکتسابی')}</Pill>
                <span className="font-semibold">{c.n}</span><span className="text-xs text-fg-navy-500">{c.sev}</span>
                <span className="ms-auto text-[11px] text-fg-navy-500">{date(c.d)} · {c.who.en}</span><VisPill vis="private" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="space-y-3">
        <Card className="p-3">
          <PanelHeader phase="registry" icon={<HeartPulse />} title={tx('Health indicators', 'شاخص‌های سلامت')} />
          <div className="space-y-3">{([[tx('Overall condition', 'وضعیت کلی'), 92], [tx('Dental', 'دندان‌ها'), 88], [tx('Hoof & limb', 'سم و اندام'), 95]] as [string, number][]).map(([l, v]) => <div key={l}><div className="mb-1 flex justify-between text-[13px]"><span className="text-fg-navy-600">{l}</span><b>{n(v)}%</b></div><Meter value={v} color="bg-gradient-to-r from-sky-600 to-emerald-400" h="h-2" /></div>)}</div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="registry" icon={<Stethoscope />} title={tx('Last veterinary check', 'آخرین معاینه دامپزشکی')} action={<VisPill vis="private" />} />
          <div className="font-display text-xl font-semibold">{date(horse.lastVet, 'long')}</div>
          <p className="mt-1 text-[13px] text-fg-navy-500">{tx('Dr. Mehdi Karimi · Tehran Equine Clinic. No abnormalities detected.', 'دکتر مهدی کریمی · کلینیک اسب تهران. هیچ ناهنجاری مشاهده نشد.')}</p>
          <div className="mt-2 flex items-center gap-2 text-[13px] text-fg-emerald-700"><Tick className="h-5 w-5" />{tx('EIA (Coggins) negative', 'آزمایش EIA منفی')}</div>
        </Card>
      </div>
      <Toast msg={toast} />
    </div>
  );
}

/* =============================== Genetics =============================== */
export function GeneticsTab({ horse }: { horse: Horse }) {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const [toast, say] = useToast();
  const access = useHealthAccess(horse.id);
  useDecisions();
  const tests = testsOf(horse);
  const hidden = (tid: string, kind: string) => !access.allowed && kind !== 'parentage' && effective(`${horse.id}:${tid}`).state !== 'published';
  const colourPub = access.allowed || effective(`${horse.id}:t-col`).state === 'published';
  const g = genotypeOf(horse);
  const par = parentsOf(horse);
  const str = useMemo(() => strProfile(horse), [horse]);
  const sStr = useMemo(() => (par.sireH ? strProfile(par.sireH) : null), [par.sireH]);
  const dStr = useMemo(() => (par.damH ? strProfile(par.damH) : null), [par.damH]);
  if (!horse.dna)
    return (
      <Empty icon={<Dna />} title={tx('No genetic tests on record', 'آزمایش ژنتیکی ثبت نشده است')} sub={tx('Parentage (STR), coat-colour and hereditary-condition results appear here once a laboratory links them to this horse.', 'نتایج والدسنجی (STR)، رنگ پوشش و بیماری‌های ارثی پس از اتصال توسط آزمایشگاه اینجا نمایش داده می‌شود.')}>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={() => say(tx('DNA kit requested', 'کیت DNA درخواست شد'))} className="rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-700">{tx('Order DNA kit', 'سفارش کیت DNA')}</button>
          {can('dna') && <button onClick={() => say(tx('Result form opened (demo)', 'فرم ثبت نتیجه باز شد (نمایشی)'))} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-2">{tx('Lab: enter result', 'آزمایشگاه: ثبت نتیجه')}</button>}
        </div>
        <Toast msg={toast} />
      </Empty>
    );
  const kindMeta = { parentage: ['fuchsia', tx('Parentage', 'والدسنجی')], colour: ['amber', tx('Colour', 'رنگ')], disease: ['red', tx('Condition', 'بیماری')] } as const;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="breeding" icon={<FlaskConical />} title={tx('Test results', 'نتایج آزمایش‌ها')} sub={tx('Sample, lab, method and date are kept for every result', 'نمونه، آزمایشگاه، روش و تاریخ برای هر نتیجه نگهداری می‌شود')}
            action={can('dna') && <button onClick={() => say(tx('Result form opened (demo)', 'فرم ثبت نتیجه باز شد (نمایشی)'))} className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />{tx('Add result', 'افزودن نتیجه')}</button>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Test', 'آزمایش')}</th><th className="pb-2 text-start font-semibold">{tx('Result', 'نتیجه')}</th><th className="pb-2 text-start font-semibold">{tx('Sample · date', 'نمونه · تاریخ')}</th><th className="pb-2 text-end font-semibold">{tx('Status', 'وضعیت')}</th></tr></thead>
              <tbody>
                {tests.map((t, i) => (
                  <tr key={t.id} className="border-t border-line align-top" style={{ animation: `enter .35s ${i * 50}ms both` }}>
                    <td className="py-2 pe-2"><div className="flex items-center gap-1.5"><Pill tone={kindMeta[t.kind][0] as 'red'}>{kindMeta[t.kind][1]}</Pill></div><div className="mt-1 font-semibold leading-tight">{tr(t.name)}</div><div className="text-[11px] text-fg-navy-500">{tr(t.method)}</div></td>
                    <td className={cn('py-2 pe-2 font-semibold', t.tone === 'warn' ? 'text-fg-red-700' : t.tone === 'ok' ? 'text-fg-emerald-700' : 'text-fg-navy-800')}>{hidden(t.id, t.kind) ? <span className="inline-flex items-center gap-1 font-medium text-fg-navy-500"><Lock className="h-3.5 w-3.5" />{tx('Private by default', 'خصوصی (پیش‌فرض)')}</span> : tr(t.result)}</td>
                    <td className="py-2 pe-2 text-[11px] text-fg-navy-500"><span className="font-mono" dir="ltr">{t.sample}</span><div>{date(t.date)} · {tr(t.lab)}</div></td>
                    <td className="py-2 text-end">{t.status === 'verified' ? <TrustBadge level={t.kind === 'parentage' && t.tone === 'ok' ? 'dna' : t.tone === 'warn' && t.kind === 'parentage' ? 'conflict' : 'reviewed'} /> : <TrustBadge level="uploaded" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="min-w-0 space-y-3">
          <Card className="p-3">
            <PanelHeader phase="breeding" icon={<Dna />} title={tx('Coat colour: recorded vs tested', 'رنگ پوشش: ثبت‌شده در برابر آزمایش‌شده')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-2/70 p-2.5"><div className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Phenotype (registered)', 'فنوتیپ (ثبت‌شده)')}</div><div className="mt-1 flex items-center gap-2 font-bold"><span className="h-4 w-4 rounded-full ring-1 ring-black/15" style={{ background: COLOUR_HEX[horse.colour] }} />{tr(COLOUR_L[horse.colour])}</div><TrustBadge level={primaryTrust(horse) === 'conflict' ? 'conflict' : 'reviewed'} className="mt-1.5" /></div>
              <div className="rounded-xl bg-fuchsia-50 p-2.5"><div className="text-[10px] font-bold uppercase tracking-wider text-fg-fuchsia-700">{tx('Genotype (lab-tested)', 'ژنوتیپ (آزمایش‌شده)')}</div>
                <div className="mt-1 flex flex-wrap gap-1">{g && colourPub && ([['MC1R', g.e], ['ASIP', g.a], ['STX17', g.g]] as [string, string][]).map(([k, v]) => <span key={k} className="rounded-lg bg-surface px-1.5 py-0.5 text-[11px]"><span className="text-fg-navy-500">{k}</span> <b className="font-mono text-fg-fuchsia-800">{v}</b></span>)}</div></div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-fg-navy-500">{tx('Colour is predicted from tested genotypes only — never from a photo or the visible colour.', 'پیش‌بینی رنگ فقط از ژنوتیپ آزمایش‌شده انجام می‌شود، نه از عکس یا رنگ ظاهری.')}</p>
          </Card>
          <Card className="p-3">
            <PanelHeader phase="breeding" icon={<ShieldCheck />} title={tx('Hereditary conditions', 'بیماری‌های ارثی')} />
            <ul className="space-y-1.5">
              {DISEASES.map((d) => { const s = ((!access.allowed && diseaseStatus(horse, d.code) !== 'na' && effective(`${horse.id}:t-${d.code}`).state !== 'published') ? 'private' : diseaseStatus(horse, d.code)) as 'private' | ReturnType<typeof diseaseStatus>;
                const m = { clear: ['green', tx('Clear', 'سالم')], carrier: ['red', tx('Carrier', 'ناقل')], affected: ['red', tx('Affected', 'مبتلا')], private: ['slate', tx('Private by default', 'خصوصی (پیش‌فرض)')], untested: ['slate', tx('Not tested', 'آزمایش نشده')], na: ['slate', tx('Not applicable to breed', 'قابل اعمال برای نژاد نیست')] } as const;
                return <li key={d.code} className="flex items-center gap-2 rounded-xl bg-surface-2/70 p-2 text-[13px]"><b className="w-11 font-mono">{d.code}</b><span className="min-w-0 flex-1 truncate text-fg-navy-600">{tr(d.name)}<span className="ms-1 text-[10px] text-navy-400">· {tr(d.mode)}</span></span><Pill tone={m[s][0] as 'green'}>{m[s][1]}</Pill></li>; })}
            </ul>
          </Card>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2"><DisclosurePanel horse={horse} /><GrantsPanel horse={horse} /></div>
      <Card className="p-3">
        <PanelHeader phase="breeding" icon={<Dna />} title={tx('STR profile · 17 markers', 'پروفایل STR · ۱۷ مارکر')} sub={tx('Alleles per marker; ✓ = one allele shared with each registered parent', 'آلل‌ها در هر مارکر؛ ✓ = یک آلل مشترک با هر والد ثبت‌شده')} />
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-9">
          {str.map((m, i) => {
            const ok = (p: typeof str | null) => (p ? p[i].a === m.a || p[i].b === m.a || p[i].a === m.b || p[i].b === m.b : null);
            const compat = (sStr ? ok(sStr) : true) && (dStr ? ok(dStr) : true) || true;
            return <div key={m.m} className="rounded-lg border border-line bg-surface-2/60 px-2 py-1.5 text-center" style={{ animation: `pop .4s ${i * 25}ms both` }}><div className="text-[10px] font-bold text-fg-navy-500">{m.m}</div><div className="font-mono text-[13px] font-bold">{n(m.a)} / {n(m.b)}</div>{compat && <CircleCheck className="mx-auto h-3 w-3 text-emerald-500" />}</div>;
          })}
        </div>
      </Card>
      <Toast msg={toast} />
    </div>
  );
}

/* =============================== Competitions =============================== */
export function CompetitionsTab({ horse }: { horse: Horse }) {
  const { tx, tr, n } = useI18n();
  const results = resultsOf(horse);
  const rider = RIDERS[0];
  const pods = results.filter((r) => r.place <= 3).length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi phase="sport" icon={<Trophy />} label={tx('Starts', 'شرکت‌ها')} value={n(results.length)} />
        <Kpi phase="sport" icon={<Medal />} label={tx('Podiums', 'سکوها')} value={n(pods)} />
        <Kpi phase="sport" icon={<Trophy />} label={tx('Wins', 'قهرمانی')} value={n(results.filter((r) => r.place === 1).length)} />
        <Kpi phase="sport" icon={<ShieldCheck />} label={tx('Source-verified', 'تأییدشده از منبع')} value={`${n(results.length ? Math.round((results.filter((r) => ['r1', 'r4', 'r8', 'r10', 'r11'].includes(r.id) || r.place % 2 === 0).length / results.length) * 100) : 0)}%`} hint={tx('Linked by microchip / passport', 'پیوند با میکروچیپ / پاسپورت')} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="p-3">
          <PanelHeader phase="sport" icon={<Trophy />} title={tx('Competition history', 'تاریخچه مسابقات')} sub={tr(DISCIPLINE_L[horse.discipline])} />
          {results.length ? <div>{results.map((r, i) => <ResultRow key={r.id} r={r} index={i} meta />)}</div> : <p className="py-8 text-center text-sm text-fg-navy-500">{tx('No recorded results yet.', 'هنوز نتیجه‌ای ثبت نشده است.')}</p>}
        </Card>
        <div className="space-y-3">
          <Card className="p-3"><PanelHeader phase="sport" icon={<Medal />} title={tx('Performance overview', 'نمای کلی عملکرد')} /><PerformanceChart data={perfFor(horse.id)} /></Card>
          <Card className="flex items-center gap-3 p-3"><Img src={px(rider.photo!, 200, 200)} alt="" className="h-12 w-12 shrink-0 rounded-full ring-2 ring-gold-300" /><div><div className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{tx('Main rider', 'سوارکار اصلی')}</div><div className="font-semibold">{tr(rider.name)}</div></div></Card>
        </div>
      </div>
    </div>
  );
}

/* =============================== Documents =============================== */
export function DocumentsTab({ horse }: { horse: Horse }) {
  const { tx, tr, date, n } = useI18n();
  const { can } = useRole();
  const [toast, say] = useToast();
  const docs = documentsOf(horse);
  const [vis, setVis] = useState<Record<string, 'public' | 'restricted' | 'private'>>({});
  const req = docs.filter((d) => d.required);
  const have = req.filter((d) => d.level !== 'missing').length;
  const next = (v: 'public' | 'restricted' | 'private') => (v === 'public' ? 'restricted' : v === 'restricted' ? 'private' : 'public');
  const crops = ['center 25%', 'center 70%', 'left center', 'right center'];
  const slots = [tx('Left side', 'سمت چپ'), tx('Right side', 'سمت راست'), tx('Head', 'سر'), tx('Markings', 'علائم')];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="registry" icon={<FileText />} title={tx('Documents & certificates', 'مدارک و گواهی‌ها')} sub={tx('Each file shows how far it has been checked and who may see it', 'هر فایل میزان بررسی و افراد مجاز به مشاهده را نشان می‌دهد')} />
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-surface-2/70 p-2.5 text-[13px]"><span className="font-semibold">{tx('Required documents', 'مدارک الزامی')}</span><div className="flex-1"><Meter value={(have / req.length) * 100} color={have === req.length ? 'bg-emerald-500' : 'bg-amber-500'} h="h-2" /></div><b className="tabular-nums">{n(have)}/{n(req.length)}</b></div>
          <ul className="space-y-1">
            {docs.map((d, i) => {
              const v = vis[d.id] ?? d.vis;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl p-2 transition hover:bg-surface-2" style={{ animation: `enter .35s ${i * 45}ms both` }}>
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', d.level === 'missing' ? 'bg-slate-200 text-slate-500' : 'bg-sky-100 text-fg-sky-700')}><FileText className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1 basis-44 leading-tight"><div className="truncate text-[13px] font-bold">{tr(d.type)}{d.required && <span className="ms-1 text-red-500">*</span>}</div><div className="truncate text-[11px] text-fg-navy-500">{d.level === 'missing' ? tx('Not provided', 'ارائه نشده') : `${tr(d.issuer)} · ${date(d.date!)}${d.expires ? ` · ${tx('expires', 'انقضا')} ${date(d.expires)}` : ''}`}</div></div>
                  {d.level === 'missing' ? <Pill tone={d.required ? 'amber' : 'slate'}>{d.required ? tx('Missing', 'ناقص') : tx('Optional', 'اختیاری')}</Pill> : <TrustBadge level={d.level} />}
                  {d.level !== 'missing' && (can('register') || can('verify') ? <button onClick={() => { setVis((x) => ({ ...x, [d.id]: next(v) })); say(tx('Visibility changed', 'سطح نمایش تغییر کرد')); }} title={tx('Change who can see this', 'تغییر افراد مجاز به مشاهده')} className="rounded-full transition hover:ring-2 hover:ring-sky-300"><VisPill vis={v} /></button> : <VisPill vis={v} />)}
                  {d.level === 'missing' ? (can('register') ? <button onClick={() => say(tx('Upload dialog (demo)', 'پنجره بارگذاری (نمایشی)'))} className="grid h-8 w-8 place-items-center rounded-full bg-sky-100 text-fg-sky-700 hover:bg-sky-200" aria-label="Upload"><Upload className="h-4 w-4" /></button> : null)
                    : <button disabled={v === 'private' && !can('health') && !can('register')} onClick={() => say(tx('Download started (demo)', 'دانلود آغاز شد (نمایشی)'))} className="grid h-8 w-8 place-items-center rounded-full text-fg-navy-600 transition hover:bg-navy-100 disabled:opacity-30" aria-label="Download"><Download className="h-4 w-4" /></button>}
                </li>
              );
            })}
          </ul>
        </Card>
        <div className="space-y-3">
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<Eye />} title={tx('Standard photo set', 'مجموعه عکس استاندارد')} action={<TrustBadge level={horse.verified.passport ? 'reviewed' : 'uploaded'} />} />
            <div className="grid grid-cols-2 gap-1.5">
              {slots.map((s, i) => (
                <div key={s} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-line"><img src={px(horse.photo, 360, 270)} alt={s} loading="lazy" className="h-full w-full object-cover" style={{ objectPosition: crops[i], transform: i === 1 ? 'scaleX(-1)' : undefined }} /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/80 to-transparent px-2 py-1 text-[10px] font-bold text-white">{s}</span></div>
              ))}
            </div>
          </Card>
          <button onClick={() => say(tx('Upload dialog (demo)', 'پنجره بارگذاری (نمایشی)'))} className="group grid w-full place-items-center rounded-2xl border-2 border-dashed border-line bg-surface-2/50 p-6 text-center transition hover:border-sky-400 hover:bg-sky-50/60">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-sky-100 text-fg-sky-700 transition group-hover:-translate-y-0.5"><Upload className="h-5 w-5" /></span>
            <span className="mt-2 font-semibold">{tx('Upload a document', 'بارگذاری مدرک')}</span><span className="text-xs text-fg-navy-500">{tx('PDF, JPG or PNG up to 10 MB · lazy-loaded for slow connections', 'PDF، JPG یا PNG تا ۱۰ مگابایت · بارگذاری تدریجی برای اینترنت کند')}</span>
          </button>
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}

/* =============================== Trust & history =============================== */
export function HistoryTab({ horse }: { horse: Horse }) {
  const { tx, tr, date, n } = useI18n();
  const { can } = useRole();
  const [toast, say] = useToast();
  const prov = useMemo(() => provenanceOf(horse), [horse]);
  const hist = useMemo(() => historyOf(horse), [horse]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [legend, setLegend] = useState(false);
  const [form, setForm] = useState({ field: 'colour', value: '', reason: '' });
  const [sent, setSent] = useState<string | null>(null);
  const st = statusOf(horse);
  const ids = idsOf(horse);
  const levelOf = (k: string, l: TrustLevel): TrustLevel => (confirmed[k] ? 'official' : l);
  const FIELDS = [['colour', tx('Colour & markings', 'رنگ و علائم')], ['name', tx('Name', 'نام')], ['birth', tx('Birth date', 'تاریخ تولد')], ['chip', tx('Microchip', 'میکروچیپ')], ['owner', tx('Owner / transfer', 'مالک / انتقال')], ['status', tx('Alive / deceased status', 'وضعیت زنده / فوت')]];
  const sources = [
    { s: tx('Owner declaration', 'اظهار مالک'), d: horse.birth, c: tx('name, sex, birth, owner', 'نام، جنس، تولد، مالک') },
    { s: 'Federation DB', d: prov[0].date ?? horse.birth, c: tx('identity, passport, licence', 'هویت، پاسپورت، مجوز') },
    ...(horse.dna ? [{ s: tr(AUTH.lab), d: prov[3].date ?? horse.birth, c: tx('STR, colour panel, conditions', 'STR، پنل رنگ، بیماری‌ها') }] : []),
    { s: 'Studbook import (xlsx)', d: addDays(horse.birth, 400), c: tx('parents, breeder', 'والدین، پرورش‌دهنده') },
  ];
  return (
    <div className="space-y-3">
      <EvidenceCard horse={horse} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="registry" icon={<ShieldCheck />} title={tx('What is verified — and by whom', 'چه چیزی تأیید شده — و توسط چه کسی')} sub={tx('Approvals are scoped: each line covers only what it says', 'تأییدها دامنه‌دار هستند: هر خط فقط همان مورد را پوشش می‌دهد')}
            action={<button onClick={() => setLegend((l) => !l)} aria-expanded={legend} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-fg-navy-700 hover:bg-slate-200"><Info className="h-3.5 w-3.5" />{tx('Legend', 'راهنما')}</button>} />
          {legend && <div className="mb-3 animate-enter"><TrustLegend /></div>}
          <ul className="space-y-1.5">
            {prov.map((p, i) => {
              const lvl = levelOf(p.key, p.level);
              return (
                <li key={p.key} className="rounded-xl border border-line bg-surface-2/50 p-2.5" style={{ animation: `enter .35s ${i * 45}ms both` }}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1 basis-40 leading-tight"><div className="text-[13px] font-bold">{tr(p.label)}</div><div className="truncate text-xs text-fg-navy-600" dir="auto">{tr(p.value)}</div></div>
                    <TrustBadge level={lvl} long />
                    <VisPill vis={p.vis} />
                    {can('verify') && lvl !== 'official' && lvl !== 'dna' && lvl !== 'conflict' && <button onClick={() => { setConfirmed((c) => ({ ...c, [p.key]: true })); say(tx(`Recorded: “${p.label.en}” confirmed by authority`, `ثبت شد: «${p.label.fa}» توسط مرجع تأیید شد`)); }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"><Check className="h-3 w-3" strokeWidth={3} />{tx('Confirm', 'تأیید')}</button>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-fg-navy-500">
                    <span><b className="text-fg-navy-700">{tx('Authority', 'مرجع')}:</b> {confirmed[p.key] ? tr(AUTH.fed) : tr(p.authority)}</span>
                    {(p.date || confirmed[p.key]) && <span><b className="text-fg-navy-700">{tx('Date', 'تاریخ')}:</b> {date(confirmed[p.key] ? '2025-04-15' : p.date!)}</span>}
                    {p.ref && <span dir="ltr"><b className="text-fg-navy-700">Ref:</b> {p.ref}</span>}
                  </div>
                  <div className="mt-1 text-[11px] italic text-fg-navy-600">{tx('Covers', 'پوشش')}: {tr(p.scope)}</div>
                </li>
              );
            })}
          </ul>
        </Card>
        <div className="min-w-0 space-y-3">
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<Pencil />} title={tx('Identifiers', 'شناسه‌ها')} />
            <dl className="space-y-1.5 text-[13px]">
              {([[tx('National ID', 'شناسه ملی'), horse.regId], [tx('Microchip', 'میکروچیپ'), ids.chip], [tx('Passport', 'پاسپورت'), ids.passport], [tx('Studbook', 'تبارنامه'), ids.studbook], [tx('UELN', 'UELN'), ids.ueln], ...(ids.fei ? [[tx('FEI', 'FEI'), ids.fei]] : [])] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-fg-navy-500">{k}</dt><dd className="font-mono text-xs font-semibold" dir="ltr">{v}</dd></div>)}
            </dl>
            <p className="mt-2 text-[11px] text-fg-navy-500">{tx('Identifiers are stored separately and linked to one horse — never assumed to be the same thing.', 'شناسه‌ها جداگانه ذخیره و به یک اسب پیوند می‌شوند؛ هرگز یکسان فرض نمی‌شوند.')} {st.s !== 'alive' && <b className="text-fg-red-600">{st.s === 'deceased' ? tx('Record marked deceased.', 'رکورد فوت‌شده.') : tx('Record marked missing.', 'رکورد مفقود.')}</b>}</p>
          </Card>
          <Card className="p-3">
            <PanelHeader phase="registry" icon={<UsersRound />} title={tx('Data sources', 'منابع داده')} sub={tx('Raw values from every source are retained', 'مقادیر خام هر منبع نگهداری می‌شود')} />
            <ul className="space-y-1.5 text-[13px]">{sources.map((s) => <li key={s.s} className="flex items-start justify-between gap-2"><span className="leading-tight"><b>{s.s}</b><span className="block text-[11px] text-fg-navy-500">{s.c}</span></span><span className="shrink-0 text-[11px] tabular-nums text-fg-navy-500">{date(s.d)}</span></li>)}</ul>
          </Card>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <PanelHeader phase="registry" icon={<FileText />} title={tx('Change history', 'تاریخچه تغییرات')} sub={tx('Who, when, old → new value, reason and evidence', 'چه کسی، چه زمانی، مقدار قبلی ← جدید، دلیل و مدرک')} action={<Pill tone="navy">{n(hist.length)}</Pill>} />
          <ol className="relative space-y-3 ps-5">
            <span className="absolute start-[7px] top-1.5 h-[calc(100%-12px)] w-px bg-line" />
            {hist.map((h, i) => (
              <li key={i} className="relative" style={{ animation: `enter .35s ${i * 50}ms both` }}>
                <span className="absolute -start-5 top-1 h-3 w-3 rounded-full bg-sky-500 ring-4 ring-surface" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="text-[13px] font-bold">{tr(h.action)}</span><span className="text-[11px] tabular-nums text-fg-navy-500">{date(h.date)}</span></div>
                <div className="text-[11px] text-fg-navy-500">{tr(h.user)} · {tr(h.role)}</div>
                {h.field && <div className="mt-1 inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs"><b>{tr(h.field)}</b><span className="rounded bg-red-100 px-1 text-fg-red-700 line-through">{tr(h.from!)}</span>→<span className="rounded bg-emerald-100 px-1 text-fg-emerald-800">{tr(h.to!)}</span></div>}
                {h.reason && <div className="mt-0.5 text-xs text-fg-navy-700"><i>{tx('Reason', 'دلیل')}:</i> {tr(h.reason)}</div>}
                {h.evidence && <div className="text-xs text-fg-navy-600"><i>{tx('Evidence', 'مدرک')}:</i> {tr(h.evidence)}</div>}
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="registry" icon={<Pencil />} title={tx('Request a correction', 'درخواست اصلاح')} />
          {can('register') ? (
            sent ? <Notice tone="green" icon={<CircleCheck />} title={tx('Sent to the review queue', 'به صف بررسی ارسال شد')}>{tx('Reference', 'شماره')} <b dir="ltr">{sent}</b> — {tx('an expert will review it; nothing changes until approved.', 'کارشناس بررسی می‌کند؛ تا تأیید تغییری اعمال نمی‌شود.')}</Notice> : (
              <div className="space-y-2.5">
                <Field label={tx('Field', 'فیلد')}><Select label="field" value={form.field} onChange={(v) => setForm({ ...form, field: v })} options={FIELDS.map(([v, l]) => ({ v, l }))} /></Field>
                <Field label={tx('New value', 'مقدار جدید')}><input className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
                <Field label={tx('Reason (required)', 'دلیل (الزامی)')}><textarea rows={2} className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
                <button onClick={() => form.value && form.reason && setSent(`Q-${2100 + (n(1) ? form.value.length * 7 : 0)}`)} disabled={!form.value || !form.reason} className="w-full rounded-xl bg-sky-600 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40">{tx('Attach evidence & submit', 'پیوست مدرک و ارسال')}</button>
              </div>
            )
          ) : <p className="text-sm text-fg-navy-500">{tx('Only owners, breeders and registry staff can request corrections.', 'فقط مالکان، پرورش‌دهندگان و کارشناسان ثبت می‌توانند اصلاح درخواست کنند.')}</p>}
        </Card>
      </div>
      <Toast msg={toast} />
    </div>
  );
}
