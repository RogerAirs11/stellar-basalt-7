import { useState } from 'react';
import { AlertTriangle, Check, History, RefreshCw, ShieldAlert } from 'lucide-react';
import { horseById, px } from '../data';
import { ASSIGNEES, QCODES, quality, qCodeKeys, scanDone, useQuality, type QIssue, type QStatus, type Sev } from '../platform-data';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { Card, Chip, Field, Img, Notice, Pill, Select, Split, inputCls } from '../components/ui';
import { cn } from '../utils/cn';

const SEV_TONE: Record<Sev, 'red' | 'amber' | 'blue'> = { high: 'red', medium: 'amber', info: 'blue' };
const ST_TONE: Record<QStatus, 'slate' | 'sky' | 'green'> = { open: 'slate', assigned: 'sky', resolved: 'green' };

export function AdminQuality() {
  const { tx, tr, n } = useI18n();
  const issues = useQuality();
  const [st, setSt] = useState<'all' | QStatus>('all');
  const [sev, setSev] = useState<'all' | Sev>('all');
  const [code, setCode] = useState('all');
  const [sel, setSel] = useState<string | undefined>();
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkNote, setBulkNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'green' | 'red' | 'amber' | 'blue'; t: string } | null>(null);

  // every number comes from the same table, so the dashboard can never drift from the list
  const total = issues.length;
  const by = (s: QStatus) => issues.filter((i) => i.status === s).length;
  const open = by('open'), assigned = by('assigned'), resolved = by('resolved');
  const high = issues.filter((i) => i.sev === 'high' && i.status !== 'resolved').length;
  const list = issues.filter((i) => (st === 'all' || i.status === st) && (sev === 'all' || i.sev === sev) && (code === 'all' || i.code === code)).slice(0, 200);
  const cur = issues.find((i) => i.id === sel) ?? list[0];
  const toggle = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const bulk = () => {
    const r = quality.bulkResolve(checked, bulkNote);
    if (r.ok) { setMsg({ tone: 'green', t: tx(`${r.count} low-risk issues resolved.`, `${n(r.count)} مورد کم‌خطر رفع شد.`) }); setChecked([]); setBulkNote(''); }
    else if (r.err === 'high_risk') setMsg({ tone: 'red', t: tx(`Refused: ${r.refused} selected row(s) are not low-risk (info severity on the allowlist). The whole batch was rejected.`, `رد شد: ${n(r.refused)} ردیف انتخاب‌شده کم‌خطر نیست (شدت اطلاع در فهرست مجاز). کل دسته رد شد.`) });
    else if (r.err === 'note_required') setMsg({ tone: 'amber', t: tx('Add a resolution note (at least 3 characters).', 'یادداشت رفع را بنویسید (دست‌کم ۳ نویسه).') });
  };
  const scan = () => {
    const r = quality.scan();
    setMsg({ tone: r.created ? 'blue' : 'green', t: r.created ? tx(`Scan finished: ${r.created} new issues seeded.`, `اسکن پایان یافت: ${n(r.created)} مورد جدید ثبت شد.`) : tx('Scan finished: nothing new — re-runs never duplicate an issue.', 'اسکن پایان یافت: مورد جدیدی نیست — اجرای دوباره هرگز مورد تکراری نمی‌سازد.') });
  };

  return (
    <div className="flex min-h-0 flex-col gap-2.5 lg:flex-1">
      <div className="grid shrink-0 grid-cols-2 gap-2.5 md:grid-cols-5">
        {([[total, tx('Total', 'کل'), 'text-fg-navy-900'], [open, tx('Open', 'باز'), 'text-fg-navy-900'], [assigned, tx('Assigned', 'ارجاع‌شده'), 'text-fg-sky-700'], [resolved, tx('Resolved', 'رفع‌شده'), 'text-fg-emerald-700'], [high, tx('High-risk open', 'پرخطر باز'), 'text-fg-red-700']] as [number, string, string][]).map(([v, l, c]) => (
          <div key={l} className="panel px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{l}</div><div className={cn('kpi-value font-display text-xl font-semibold leading-tight', c)}>{n(v)}</div></div>
        ))}
        <div className="panel col-span-2 flex items-center gap-2 px-3 py-2 md:col-span-5 md:py-1.5">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" /><span className="text-[11px] text-fg-navy-600">{tx(`Reconciled: ${n(open)} open + ${n(assigned)} assigned + ${n(resolved)} resolved = ${n(open + assigned + resolved)} of ${n(total)} — all counts come from the same table.`, `همخوان: ${n(open)} باز + ${n(assigned)} ارجاع + ${n(resolved)} رفع = ${n(open + assigned + resolved)} از ${n(total)} — همه شمارش‌ها از یک جدول است.`)}</span>
          <button onClick={scan} className="ms-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-field px-2.5 py-1 text-xs font-semibold text-fg-navy-800 transition hover:bg-surface-2"><RefreshCw className="h-3.5 w-3.5" />{scanDone() ? tx('Re-run scan', 'اجرای دوباره اسکن') : tx('Run corpus scan', 'اجرای اسکن پایگاه')}</button>
        </div>
      </div>

      <div className="panel flex shrink-0 flex-wrap items-center gap-2 p-2">
        <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'open', 'assigned', 'resolved'] as const).map((s) => <Chip key={s} phase="admin" active={st === s} onClick={() => setSt(s)}>{s === 'all' ? tx('All', 'همه') : s === 'open' ? tx('Open', 'باز') : s === 'assigned' ? tx('Assigned', 'ارجاع‌شده') : tx('Resolved', 'رفع‌شده')}</Chip>)}</div>
        <div className="hide-scroll flex gap-1.5 overflow-x-auto">{(['all', 'high', 'medium', 'info'] as const).map((s) => <Chip key={s} phase="admin" active={sev === s} onClick={() => setSev(s)}>{s === 'all' ? tx('Any severity', 'هر شدت') : s === 'high' ? tx('High', 'بالا') : s === 'medium' ? tx('Medium', 'متوسط') : tx('Info', 'اطلاع')}</Chip>)}</div>
        <Select label={tx('Code', 'کد')} value={code} onChange={setCode} className="w-52" options={[{ v: 'all', l: tx('Any code', 'هر کد') }, ...qCodeKeys.map((k) => ({ v: k, l: tr(QCODES[k].l) }))]} />
        <span className="ms-auto text-xs text-fg-navy-500"><b className="text-sm text-fg-navy-900">{n(list.length)}</b> {tx('shown', 'نمایش')}</span>
      </div>

      {checked.length > 0 && (
        <div className="panel flex shrink-0 flex-wrap items-center gap-2 border-sky-300 p-2">
          <b className="text-xs">{tx(`${checked.length} selected`, `${n(checked.length)} انتخاب‌شده`)}</b>
          <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder={tx('Resolution note (required)', 'یادداشت رفع (الزامی)')} className={cn(inputCls, 'min-w-[200px] flex-1 !py-1.5')} />
          <button onClick={bulk} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">{tx('Bulk resolve', 'رفع گروهی')}</button>
          <button onClick={() => setChecked([])} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-fg-navy-600 hover:bg-surface-2">{tx('Clear', 'پاک کردن')}</button>
          <span className="basis-full text-[11px] text-fg-navy-500">{tx('Bulk resolve is for low-risk rows only. One high-risk row refuses the entire batch.', 'رفع گروهی فقط برای ردیف‌های کم‌خطر است. یک ردیف پرخطر کل دسته را رد می‌کند.')}</span>
        </div>
      )}
      {msg && <Notice tone={msg.tone} icon={msg.tone === 'green' ? <Check /> : <AlertTriangle />} className="shrink-0">{msg.t}</Notice>}

      <div className="min-h-0 lg:flex-1">
        <Split hasSel={!!sel} onBack={() => setSel(undefined)} listW="lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]"
          list={
            <ul className="space-y-1.5">
              {list.map((i) => { const h = horseById(i.horse); return (
                <li key={i.id} className={cn('flex items-start gap-2 rounded-xl border p-2 transition', cur?.id === i.id ? 'border-violet-400 bg-violet-50 shadow-sm' : 'border-line bg-surface hover:border-violet-300', i.status === 'resolved' && 'opacity-65')}>
                  <input type="checkbox" checked={checked.includes(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.id}`} className="mt-1 h-4 w-4 shrink-0 accent-sky-600" />
                  <button onClick={() => setSel(i.id)} aria-current={cur?.id === i.id} className="min-w-0 flex-1 text-start">
                    <span className="flex flex-wrap items-center gap-1.5"><Pill tone={SEV_TONE[i.sev]}>{i.sev === 'high' ? tx('High', 'بالا') : i.sev === 'medium' ? tx('Medium', 'متوسط') : tx('Info', 'اطلاع')}</Pill><span className="font-mono text-[10px] text-fg-navy-400">{i.id}</span><Pill tone={ST_TONE[i.status] === 'sky' ? 'sky' : ST_TONE[i.status] === 'green' ? 'green' : 'slate'} className="ms-auto">{i.status === 'open' ? tx('Open', 'باز') : i.status === 'assigned' ? tx('Assigned', 'ارجاع') : tx('Resolved', 'رفع‌شده')}</Pill></span>
                    <span className="mt-1 block text-[13px] font-bold leading-snug">{tr(QCODES[i.code].l)}</span>
                    <span className="block text-[11px] text-fg-navy-500">{h ? tr(h.name) : i.horse}{i.assignee ? ` · ${i.assignee}` : ''}</span>
                  </button>
                </li>); })}
              {!list.length && <li className="panel p-8 text-center text-sm text-fg-navy-500">{tx('No issues match these filters.', 'موردی با این فیلترها نیست.')}</li>}
            </ul>}
          detail={cur ? <IssueDetail key={cur.id} i={cur} /> : null} />
      </div>
    </div>
  );
}

function IssueDetail({ i }: { i: QIssue }) {
  const { tx, tr } = useI18n();
  const { can } = useRole();
  const h = horseById(i.horse);
  const act = can('verify');
  const [who, setWho] = useState(i.assignee ?? ASSIGNEES[0]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const kindL = { detected: tx('Detected', 'شناسایی شد'), assigned: tx('Assigned', 'ارجاع شد'), resolved: tx('Resolved', 'رفع شد'), reopened: tx('Reopened', 'بازگشایی شد'), note: tx('Note', 'یادداشت') };
  const dot = { detected: 'bg-slate-400', assigned: 'bg-sky-500', resolved: 'bg-emerald-500', reopened: 'bg-amber-500', note: 'bg-navy-400' };
  return (
    <Card className="animate-enter overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 p-3">
        <Pill tone={SEV_TONE[i.sev]} icon={<ShieldAlert className="h-3 w-3" />}>{i.sev === 'high' ? tx('High risk', 'پرخطر') : i.sev === 'medium' ? tx('Medium', 'متوسط') : tx('Info · low risk', 'اطلاع · کم‌خطر')}</Pill>
        <span className="font-mono text-xs text-fg-navy-500">{i.id}</span>
        <span className="ms-auto text-[11px] text-fg-navy-500">{tx('Rule', 'قاعده')} <span className="font-mono">{i.rule}</span> · {i.source}</span>
      </div>
      <div className="space-y-3 p-3">
        <div><h2 className="font-display text-xl font-semibold leading-tight">{tr(QCODES[i.code].l)}</h2><p className="mt-1 text-sm text-fg-navy-600">{tr(i.detail)}</p></div>
        {h && <a href={`#/horses/${h.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-2 transition hover:border-sky-300"><Img src={px(h.photo, 100, 100)} alt="" pos={h.pos} className="h-10 w-10 rounded-lg" /><span className="min-w-0 flex-1 leading-tight"><b className="block text-[13px]">{tr(h.name)}</b><span className="font-mono text-[11px] text-fg-navy-500" dir="ltr">{h.regId}</span></span></a>}

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-navy-500"><History className="h-3.5 w-3.5" />{tx('History — append-only', 'تاریخچه — فقط افزودنی')}</div>
          <ol className="space-y-2 border-s-2 border-line ps-3.5">
            {i.events.map((e, k) => (
              <li key={k} className="relative text-xs leading-snug"><span className={cn('absolute -start-[19px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface', dot[e.kind])} /><b>{kindL[e.kind]}</b> <span className="text-fg-navy-500">· {e.by} · {e.at}</span>{e.note && <div className="text-fg-navy-700">{e.note}</div>}</li>
            ))}
          </ol>
        </div>

        {act ? (
          <div className="space-y-2.5 border-t border-line pt-3">
            {i.status !== 'resolved' && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[170px] flex-1"><Field label={tx('Assignee', 'مسئول')}><Select label="assignee" value={who} onChange={setWho} options={ASSIGNEES.map((a) => ({ v: a, l: a }))} /></Field></div>
                <button onClick={() => { quality.assign(i.id, who); setErr(null); }} className="rounded-lg border border-line bg-field px-3 py-2 text-xs font-semibold text-fg-navy-800 hover:bg-surface-2">{i.assignee ? tx('Reassign', 'ارجاع دوباره') : tx('Assign', 'ارجاع')}</button>
              </div>
            )}
            <Field label={i.status === 'resolved' ? tx('Add a note', 'افزودن یادداشت') : tx('Resolution note (required, at least 3 characters)', 'یادداشت رفع (الزامی، دست‌کم ۳ نویسه)')}>
              <textarea rows={2} className={inputCls} value={note} onChange={(e) => { setNote(e.target.value); setErr(null); }} />
            </Field>
            {err && <p role="alert" className="text-xs font-semibold text-fg-red-700">{err}</p>}
            <div className="flex flex-wrap gap-2">
              {i.status !== 'resolved' ? (
                <button onClick={() => { const r = quality.resolve(i.id, note); if (!r.ok) setErr(tx('A resolution note of at least 3 characters is required.', 'یادداشت رفع با دست‌کم ۳ نویسه الزامی است.')); else setNote(''); }} className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700">{tx('Resolve', 'رفع')}</button>
              ) : (
                <button onClick={() => quality.reopen(i.id)} className="rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700">{tx('Reopen (history is kept)', 'بازگشایی (تاریخچه حفظ می‌شود)')}</button>
              )}
              <button onClick={() => { const r = quality.note(i.id, note); if (r.ok) setNote(''); }} className="rounded-lg border border-line bg-field px-3.5 py-2 text-xs font-semibold text-fg-navy-800 hover:bg-surface-2">{tx('Add note', 'افزودن یادداشت')}</button>
            </div>
          </div>
        ) : <Notice tone="slate">{tx('View only — your role cannot assign or resolve.', 'فقط مشاهده — نقش شما امکان ارجاع یا رفع ندارد.')}</Notice>}
      </div>
    </Card>
  );
}
