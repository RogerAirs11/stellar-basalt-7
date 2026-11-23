import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, Check, FileCheck2, Globe, History, Lock, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import type { Horse } from '../data';
import { idsOf, testsOf } from '../records';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import {
  PERMS, PERM_L, PRO_KINDS, PRO_L, asciiDigits, decide, decisionsOf, defaultGrantDates, effective, evidenceOf, grantActive, grants, useDecisions, useGrants, type Basis, type Perm, type ProKind,
} from '../platform-data';
import { HORSES } from '../data';
import { Card, Field, Meter, Notice, PanelHeader, Pill, Select, inputCls } from './ui';
import { cn } from '../utils/cn';

const BASIS: Record<Basis, [string, string]> = { owner_consent: ['Owner consent', 'رضایت مالک'], staff_publication: ['Staff publication', 'انتشار توسط کارشناس'], official_basis: ['Official basis', 'مبنای رسمی'] };

/* =====================================================================
   Genetic results — private by default; publishing is a versioned, append-only decision
   ===================================================================== */
export function DisclosurePanel({ horse }: { horse: Horse }) {
  const { tx, tr, date } = useI18n();
  const { can } = useRole();
  useDecisions();
  const staff = can('verify');
  const manage = staff || can('register');
  const tests = useMemo(() => testsOf(horse).filter((t) => t.kind !== 'parentage'), [horse]);
  const [open, setOpen] = useState<{ id: string; action: 'publish' | 'withdraw'; v: number } | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const [form, setForm] = useState({ basis: (staff ? 'staff_publication' : 'owner_consent') as Basis, purpose: '', evidence: '', reason: '' });
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; t: string; id: string } | null>(null);
  const bas = (b: Basis) => tx(...BASIS[b]);

  const submit = (testId: string) => {
    if (!open) return;
    if (!form.purpose.trim() || !form.reason.trim()) { setMsg({ tone: 'amber', t: tx('Purpose and reason are required.', 'هدف و دلیل الزامی است.'), id: testId }); return; }
    const r = decide.apply(`${horse.id}:${testId}`, open.v, { action: open.action, basis: form.basis, purpose: form.purpose, evidence: form.evidence || '—', reason: form.reason });
    if (!r.ok) setMsg({ tone: 'red', t: tx(`409 — this record changed meanwhile (now version ${r.current}). Reload to continue; nothing was overwritten.`, `۴۰۹ — این رکورد در این میان تغییر کرده است (اکنون نسخه ${r.current}). برای ادامه بازخوانی کنید؛ چیزی بازنویسی نشد.`), id: testId });
    else if (r.noop) { setMsg({ tone: 'amber', t: tx('No change — the record is already in that state.', 'تغییری نشد — رکورد از قبل در همین وضعیت است.'), id: testId }); setOpen(null); }
    else { setMsg({ tone: 'green', t: tx(`Recorded as decision version ${r.version}.`, `به‌عنوان نسخه ${r.version} تصمیم ثبت شد.`), id: testId }); setOpen(null); setForm((f) => ({ ...f, purpose: '', evidence: '', reason: '' })); }
  };

  return (
    <Card className="p-3">
      <PanelHeader phase="breeding" icon={<Globe />} title={tx('Publication of genetic results', 'انتشار نتایج ژنتیکی')} sub={tx('Private by default — publishing is a versioned decision', 'خصوصی به‌طور پیش‌فرض — انتشار یک تصمیم نسخه‌دار است')} />
      <ul className="space-y-2">
        {tests.map((t) => {
          const key = `${horse.id}:${t.id}`;
          const eff = effective(key);
          const verified = t.status === 'verified';
          const state = eff.state === 'published' ? ['green', tx('Public', 'عمومی')] : eff.state === 'withdrawn' ? ['amber', tx('Withdrawn', 'پس‌گرفته')] : ['slate', tx('Private by default', 'خصوصی (پیش‌فرض)')];
          return (
            <li key={t.id} className="rounded-xl border border-line bg-surface-2/50 p-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1 basis-44 leading-tight"><div className="text-[13px] font-bold">{tr(t.name)}</div><div className="text-[11px] text-fg-navy-500">{eff.version ? tx(`Decision version ${eff.version}`, `نسخه تصمیم ${eff.version}`) : tx('No decision yet', 'هنوز تصمیمی نیست')}</div></div>
                <Pill tone={state[0] as 'green'} icon={eff.state === 'published' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}>{state[1]}</Pill>
                {!verified ? <Pill tone="slate">{tx('Unverified — never published', 'تأیید‌نشده — هرگز منتشر نمی‌شود')}</Pill> : manage && (
                  <button onClick={() => { setOpen({ id: t.id, action: eff.state === 'published' ? 'withdraw' : 'publish', v: eff.version }); setMsg(null); }} className="rounded-lg border border-line bg-field px-2.5 py-1 text-xs font-semibold text-fg-navy-800 transition hover:bg-surface-2">{eff.state === 'published' ? tx('Withdraw…', 'پس‌گرفتن…') : tx('Publish…', 'انتشار…')}</button>
                )}
                {manage && decisionsOf(key).length > 0 && <button onClick={() => setHist(hist === t.id ? null : t.id)} aria-expanded={hist === t.id} className="inline-flex items-center gap-1 text-xs font-semibold text-fg-sky-700 hover:underline"><History className="h-3.5 w-3.5" />{tx('History', 'تاریخچه')}</button>}
              </div>

              {open?.id === t.id && (
                <div className="mt-2.5 animate-enter space-y-2 rounded-lg bg-surface p-2.5">
                  <div className="text-xs font-bold">{open.action === 'publish' ? tx('Publish this result', 'انتشار این نتیجه') : tx('Withdraw this result', 'پس‌گرفتن این نتیجه')} · <span className="font-medium text-fg-navy-500">{tx(`based on version ${open.v}`, `بر پایه نسخه ${open.v}`)}</span></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={tx('Basis', 'مبنا')}><Select label="basis" value={form.basis} onChange={(v) => setForm({ ...form, basis: v as Basis })} options={(staff ? (['owner_consent', 'staff_publication', 'official_basis'] as Basis[]) : (['owner_consent'] as Basis[])).map((b) => ({ v: b, l: bas(b) }))} /></Field>
                    <Field label={tx('Purpose', 'هدف')}><input className={inputCls} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder={tx('e.g. Sale listing', 'مثلاً آگهی فروش')} /></Field>
                    <Field label={tx('Evidence reference', 'مرجع مدرک')}><input className={cn(inputCls, 'font-mono')} dir="ltr" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="CONS-0000" /></Field>
                    <Field label={tx('Reason (required)', 'دلیل (الزامی)')}><input className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => submit(t.id)} className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700">{tx('Record decision', 'ثبت تصمیم')}</button>
                    <button onClick={() => setOpen(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-fg-navy-600 hover:bg-surface-2">{tx('Cancel', 'انصراف')}</button>
                    <button onClick={() => { decide.simulateOther(key); setMsg(null); }} className="ms-auto text-[11px] font-semibold text-fg-navy-500 underline-offset-2 hover:underline" title={tx('Demo: another reviewer changes this record while your form is open', 'نمایشی: بازبین دیگری هم‌زمان این رکورد را تغییر می‌دهد')}>{tx('Simulate another reviewer', 'شبیه‌سازی بازبین دیگر')}</button>
                  </div>
                </div>
              )}
              {msg?.id === t.id && <Notice tone={msg.tone === 'red' ? 'red' : msg.tone === 'green' ? 'green' : 'amber'} icon={msg.tone === 'green' ? <Check /> : <AlertTriangle />} className="mt-2">{msg.t}{msg.tone === 'red' && <button onClick={() => { setOpen(null); setMsg(null); }} className="ms-2 font-bold underline">{tx('Reload', 'بازخوانی')}</button>}</Notice>}

              {hist === t.id && (
                <ol className="mt-2.5 animate-enter space-y-1.5 border-s-2 border-line ps-3">
                  {decisionsOf(key).map((d) => (
                    <li key={d.version} className="text-xs leading-snug"><b>v{d.version} · {d.action === 'publish' ? tx('Published', 'منتشر شد') : tx('Withdrawn', 'پس گرفته شد')}</b> <span className="text-fg-navy-500">· {bas(d.basis)} · {d.actor} · {date(d.at.slice(0, 10))}</span><div className="text-fg-navy-600">{d.purpose} — {d.reason} <span className="font-mono text-[11px] text-fg-navy-400" dir="ltr">{d.evidence}</span></div></li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
        {!tests.length && <li className="text-[13px] text-fg-navy-500">{tx('No colour or condition results on record.', 'نتیجه رنگ یا بیماری ثبت نشده است.')}</li>}
      </ul>
      <p className="mt-2.5 text-[11px] leading-relaxed text-fg-navy-500">{tx('Withdrawing unpublishes instantly. Unverified results can never be published, and publishing a verdict never reveals lab accession numbers or notes.', 'پس‌گرفتن فوراً انتشار را برمی‌دارد. نتایج تأیید‌نشده هرگز منتشر نمی‌شوند و انتشار نتیجه شماره آزمایشگاهی یا یادداشت‌ها را فاش نمی‌کند.')}</p>
    </Card>
  );
}

/* =====================================================================
   Professional access grants — the only non-staff route to private health results
   ===================================================================== */
export function GrantsPanel({ horse }: { horse: Horse }) {
  const { tx, tr, date } = useI18n();
  const { can } = useRole();
  const all = useGrants().filter((g) => g.horse === horse.id);
  const manage = can('verify') || can('register');
  const [adding, setAdding] = useState(false);
  const [rev, setRev] = useState<{ id: string; reason: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [f, setF] = useState({ kind: 'veterinarian' as ProKind, grantee: '', perms: ['private_health_read'] as Perm[], authority: '', assignment: '', ...defaultGrantDates() });
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3200); };
  const togglePerm = (p: Perm) => setF((x) => ({ ...x, perms: x.perms.includes(p) ? x.perms.filter((y) => y !== p) : [...x.perms, p] }));
  const ok = f.grantee.trim() && f.authority.trim() && f.perms.length > 0 && f.to > f.from;
  if (!manage) return null; // who holds access to private health data is not public information

  return (
    <Card className="p-3">
      <PanelHeader phase="breeding" icon={<ShieldCheck />} title={tx('Professional access', 'دسترسی حرفه‌ای')} sub={tx('Horse-scoped grants to private health results', 'مجوزهای مخصوص این اسب برای نتایج سلامت خصوصی')}
        action={manage ? <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"><UserPlus className="h-3.5 w-3.5" />{tx('Grant access', 'اعطای دسترسی')}</button> : undefined} />
      {adding && manage && (
        <div className="mb-3 animate-enter space-y-2 rounded-xl bg-surface-2/60 p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={tx('Professional kind', 'نوع حرفه')}><Select label="kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v as ProKind })} options={PRO_KINDS.map((k) => ({ v: k, l: tr(PRO_L[k]) }))} /></Field>
            <Field label={tx('Grantee (person or institution)', 'دریافت‌کننده (فرد یا نهاد)')}><input className={inputCls} value={f.grantee} onChange={(e) => setF({ ...f, grantee: e.target.value })} /></Field>
            <Field label={tx('Authority reference (licence / accreditation)', 'مرجع صلاحیت (پروانه / اعتبار)')}><input className={cn(inputCls, 'font-mono')} dir="ltr" value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} placeholder="IVMO-0000" /></Field>
            <Field label={tx('Assignment reference', 'مرجع ارجاع')}><input className={cn(inputCls, 'font-mono')} dir="ltr" value={f.assignment} onChange={(e) => setF({ ...f, assignment: e.target.value })} placeholder="ASG-0000" /></Field>
            <Field label={tx('Valid from', 'معتبر از')}><input type="date" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label={tx('Valid until', 'معتبر تا')}><input type="date" className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </div>
          <fieldset><legend className="mb-1 text-xs font-semibold text-fg-navy-600">{tx('Permissions — each one is separate', 'دسترسی‌ها — هر کدام جداگانه')}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">{PERMS.map((p) => { const on = f.perms.includes(p); return (
              <button key={p} type="button" role="checkbox" aria-checked={on} onClick={() => togglePerm(p)} className={cn('flex items-start gap-2 rounded-lg border p-2 text-start text-xs transition', on ? 'border-sky-400 bg-sky-100/60' : 'border-line bg-field hover:bg-surface-2')}>
                <span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border', on ? 'border-sky-600 bg-sky-600 text-white' : 'border-navy-300 bg-field')}>{on && <Check className="h-3 w-3" strokeWidth={4} />}</span>
                <span className="leading-tight"><b className="block text-[12.5px]">{tr(PERM_L[p].l)}</b><span className="text-fg-navy-500">{tr(PERM_L[p].d)}</span></span>
              </button>); })}</div>
          </fieldset>
          <div className="flex gap-2"><button disabled={!ok} onClick={() => { grants.create({ horse: horse.id, kind: f.kind, grantee: { en: f.grantee, fa: f.grantee }, perms: f.perms, authority: f.authority, assignment: f.assignment || '—', from: f.from, to: f.to }); setAdding(false); say(tx('Grant recorded and audited.', 'مجوز ثبت و ممیزی شد.')); }} className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40">{tx('Record grant', 'ثبت مجوز')}</button><button onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-fg-navy-600 hover:bg-surface-2">{tx('Cancel', 'انصراف')}</button></div>
        </div>
      )}
      <ul className="space-y-2">
        {all.map((g) => {
          const live = grantActive(g);
          return (
            <li key={g.id} className={cn('rounded-xl border p-2.5', live ? 'border-line bg-surface-2/50' : 'border-line/70 bg-surface-2/30 opacity-80')}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-44 leading-tight"><div className="text-[13px] font-bold">{tr(g.grantee)}</div><div className="text-[11px] text-fg-navy-500">{tr(PRO_L[g.kind])} · <span className="font-mono" dir="ltr">{g.authority}</span> · <span className="font-mono" dir="ltr">{g.assignment}</span></div></div>
                <Pill tone={g.revoked ? 'red' : live ? 'green' : 'slate'}>{g.revoked ? tx('Revoked', 'لغو شده') : live ? tx('Active', 'فعال') : tx('Expired / not yet valid', 'منقضی / هنوز معتبر نیست')}</Pill>
                {manage && live && <button onClick={() => setRev({ id: g.id, reason: '' })} className="rounded-lg border border-line bg-field px-2.5 py-1 text-xs font-semibold text-fg-red-700 transition hover:bg-surface-2">{tx('Revoke', 'لغو')}</button>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">{g.perms.map((p) => <span key={p} className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-fg-sky-800">{tr(PERM_L[p].l)}</span>)}</div>
              <div className="mt-1 text-[11px] text-fg-navy-500">{date(g.from)} → {date(g.to)}{g.revoked && <> · {tx('revoked', 'لغو')} {g.revoked.at.slice(0, 10)} — {g.revoked.reason}</>}</div>
              {rev?.id === g.id && (
                <div className="mt-2 flex animate-enter flex-wrap items-end gap-2"><div className="min-w-[180px] flex-1"><Field label={tx('Reason for revoking', 'دلیل لغو')}><input className={inputCls} value={rev.reason} onChange={(e) => setRev({ id: g.id, reason: e.target.value })} /></Field></div>
                  <button disabled={rev.reason.trim().length < 3} onClick={() => { grants.revoke(g.id, rev.reason.trim()); setRev(null); say(tx('Revoked — effective on the very next request.', 'لغو شد — از همین درخواست بعدی اعمال می‌شود.')); }} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{tx('Revoke now', 'لغو فوری')}</button>
                  <button onClick={() => setRev(null)} className="rounded-lg px-3 py-2 text-xs font-semibold text-fg-navy-600 hover:bg-surface-2"><X className="h-4 w-4" /></button></div>
              )}
            </li>
          );
        })}
        {!all.length && <li className="text-[13px] text-fg-navy-500">{tx('No professional has access to this horse’s private health results.', 'هیچ متخصصی به نتایج سلامت خصوصی این اسب دسترسی ندارد.')}</li>}
      </ul>
      <p className="mt-2.5 text-[11px] leading-relaxed text-fg-navy-500">{tx('A granted professional reads health results on this horse only — never lab accession, notes or editorial interpretation, and never on other horses. A generic edit right never implies health access.', 'متخصص دارای مجوز فقط نتایج سلامت همین اسب را می‌بیند — نه شماره آزمایشگاه، یادداشت یا تفسیر ویراستاری، و نه اسب‌های دیگر. حق ویرایش عمومی هرگز به‌معنی دسترسی سلامت نیست.')}</p>
      {toast && <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 animate-enter rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-2xl rtl:translate-x-1/2">{toast}</div>}
    </Card>
  );
}

/* =====================================================================
   Public evidence summary — what is on file, and exactly how far it has been checked
   ===================================================================== */
export function EvidenceCard({ horse }: { horse: Horse }) {
  const { tx, n } = useI18n();
  useDecisions();
  const e = evidenceOf(horse);
  const pct = e.photos.uploaded ? (e.photos.reviewed / e.photos.uploaded) * 100 : 0;
  const att = e.attestations;
  return (
    <Card className="p-3">
      <PanelHeader phase="registry" icon={<FileCheck2 />} title={tx('Evidence on file', 'مدارک موجود')} sub={tx('A public summary — counts only, nothing private', 'خلاصه عمومی — فقط شمارش، بدون اطلاعات خصوصی')} />
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-navy-500"><Camera className="h-3.5 w-3.5" />{tx('Public photographs', 'عکس‌های عمومی')}</div>
          <div className="font-display text-xl font-semibold leading-none">{n(e.photos.uploaded)}<span className="ms-1.5 text-xs font-normal text-fg-navy-500">{tx('uploaded', 'بارگذاری‌شده')}</span></div>
          <div className="mt-2"><Meter value={pct} color="bg-blue-500" /></div>
          <div className="mt-1 text-xs text-fg-navy-600"><b>{n(e.photos.reviewed)}</b> {tx('reviewed by the platform', 'بررسی‌شده توسط پلتفرم')}</div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-navy-500"><ShieldCheck className="h-3.5 w-3.5" />{tx('Attestations', 'گواهی‌ها')}</div>
          <div className="flex flex-wrap gap-1.5"><Pill tone={att.active ? 'green' : 'slate'}>{n(att.active)} {tx('active', 'فعال')}</Pill><Pill tone={att.revoked ? 'red' : 'slate'}>{n(att.revoked)} {tx('revoked', 'لغو شده')}</Pill><Pill tone={att.superseded ? 'amber' : 'slate'}>{n(att.superseded)} {tx('superseded', 'جایگزین‌شده')}</Pill></div>
          <p className="mt-1.5 text-[11px] leading-snug text-fg-navy-500">{tx('Each is limited to the scope its issuer recorded.', 'هر کدام محدود به دامنه ثبت‌شده صادرکننده است.')}</p>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-navy-500"><Globe className="h-3.5 w-3.5" />{tx('Genetic results', 'نتایج ژنتیکی')}</div>
          <div className="font-display text-xl font-semibold leading-none">{n(e.genetics.decided)}<span className="ms-1.5 text-xs font-normal text-fg-navy-500">{tx(`of ${n(e.genetics.total)} publicly decided`, `از ${n(e.genetics.total)} منتشرشده`)}</span></div>
          <p className="mt-1.5 text-[11px] leading-snug text-fg-navy-500">{tx('The rest are private by default.', 'بقیه به‌طور پیش‌فرض خصوصی هستند.')}</p>
        </div>
      </div>
      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-fg-navy-500"><b className="text-fg-navy-700">{tx('Reviewed is not attested.', 'بررسی‌شده یعنی گواهی‌شده نیست.')}</b> {tx(`Documents, veterinary files, non-consented and quarantined items (${n(e.private)} on file) are never counted here.`, `اسناد، پرونده‌های دامپزشکی، موارد بدون رضایت و قرنطینه (${n(e.private)} مورد) هرگز اینجا شمرده نمی‌شوند.`)}</p>
    </Card>
  );
}

/* =====================================================================
   Exact identifier lookup (editors and above): minimal projection, at most 10 rows,
   and a miss looks identical to a concealed record
   ===================================================================== */
export function ExactLookup() {
  const { tx, tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Horse[] | null>(null);
  const run = () => {
    const s = asciiDigits(q).trim().toLowerCase();
    if (!s) { setRes(null); return; }
    setRes(HORSES.filter((h) => { const i = idsOf(h); return [i.chip, i.passport, i.studbook, i.ueln, h.regId].some((x) => x.toLowerCase() === s); }).slice(0, 10));
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition', open ? 'border-sky-400 bg-sky-100 text-fg-sky-800' : 'border-line bg-field text-fg-navy-700 hover:bg-surface-2')}>
        <Search className="h-4 w-4" /><span className="max-sm:hidden">{tx('Exact ID', 'شناسه دقیق')}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-full z-40 mt-2 w-[min(360px,92vw)] animate-enter rounded-2xl border border-line bg-surface p-3 shadow-2xl shadow-black/25 max-sm:fixed max-sm:start-2 max-sm:end-2 max-sm:top-2 max-sm:z-50 max-sm:mt-0 max-sm:w-auto max-sm:max-h-[80dvh] max-sm:overflow-y-auto">
            <div className="text-[13px] font-bold">{tx('Which horse owns this identifier?', 'این شناسه به کدام اسب تعلق دارد؟')}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-fg-navy-500">{tx('Chip, passport, life, UELN or register number. Exact match only — Persian and Arabic digits are normalised.', 'میکروچیپ، پاسپورت، شماره عمر، UELN یا شماره ثبت. فقط تطبیق دقیق — ارقام فارسی و عربی یکسان‌سازی می‌شود.')}</p>
            <form onSubmit={(e) => { e.preventDefault(); run(); }} className="mt-2 flex gap-1.5">
              <input autoFocus dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} className={cn(inputCls, 'font-mono')} placeholder="981020000123456" aria-label={tx('Identifier', 'شناسه')} />
              <button className="rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700">{tx('Look up', 'جستجو')}</button>
            </form>
            {res && (res.length ? (
              <ul className="mt-2 space-y-1">{res.map((h) => <li key={h.id}><a href={`#/horses/${h.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs transition hover:bg-line"><span className="font-bold">{tr(h.name)}</span><span className="font-mono text-fg-navy-500" dir="ltr">{h.regId} · {h.birth.slice(0, 4)}</span></a></li>)}</ul>
            ) : <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs text-fg-navy-600">{tx('No record matches. (A miss is indistinguishable from a concealed record.)', 'رکوردی مطابقت ندارد. (عدم یافتن با رکورد پنهان تفاوتی ندارد.)')}</p>)}
            <p className="mt-2 text-[10px] text-fg-navy-400">{tx('Minimal projection · at most 10 rows · audited', 'نمایش حداقلی · حداکثر ۱۰ ردیف · ممیزی‌شده')}</p>
          </div>
        </>
      )}
    </div>
  );
}
