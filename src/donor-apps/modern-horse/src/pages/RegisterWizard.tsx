import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CircleCheck, CircleX, ClipboardPlus, Dna, FileText, History, Info, Loader2, MapPin, Save, Search, ShieldCheck, Trash2, Upload, UserRound, X,
} from 'lucide-react';
import { BREEDS, COLOUR_L, GENDER_L, HORSES, hash, horseById, px, type Colour, type Gender, type Horse } from '../data';
import { norm, TODAY } from '../records';
import { runChecks, useRules, type Draft } from '../qc';
import { asciiDigits } from '../platform-data';
import { useI18n } from '../i18n';
import { Field, Img, Notice, Segmented, Select, TrustBadge, inputCls } from '../components/ui';
import { go } from '../lib';
import { cn } from '../utils/cn';

/* ============================================================================================
   Resumable 4-step registration:  Identity → Parents → People & evidence → Review
   • per-step bilingual validation  • save-as-draft at every step  • review grid before submit
   • step position and work survive navigation (sessionStorage), including a trip to a parent's profile
   • after submit: a clean reset and a NEW idempotency key — horse B can never inherit horse A
   ============================================================================================ */
interface Wiz {
  name: string; nameFa: string; prev: string; sex: string; breed: string; subBreed: string;
  exact: boolean; birth: string; birthEnd: string; colour: string; markings: string; height: string; status: string; deathDate: string;
  sire: string; sireMode: 'registry' | 'manual'; sireNo: string; sireName: string;
  dam: string; damMode: 'registry' | 'manual'; damNo: string; damName: string;
  twin: boolean; embryo: boolean; recipient: string;
  owner: string; breeder: string; producer: string; location: string;
  chip: string; passport: string; regNo: string; studbook: string; foreign: string;
  files: Record<string, boolean>; consent: Record<string, boolean>; ack: boolean;
}
interface Work { id: string; key: string; step: number; d: Wiz }
interface Saved { id: string; at: string; step: number; d: Wiz }

const newKey = () => `idem-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const newId = () => `D-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const blank = (): Wiz => ({
  name: '', nameFa: '', prev: '', sex: 'stallion', breed: BREEDS[0].en, subBreed: '', exact: true, birth: '', birthEnd: '', colour: 'grey', markings: '', height: '', status: 'alive', deathDate: '',
  sire: '', sireMode: 'registry', sireNo: '', sireName: '', dam: '', damMode: 'registry', damNo: '', damName: '', twin: false, embryo: false, recipient: '',
  owner: '', breeder: '', producer: '', location: '', chip: '', passport: '', regNo: '', studbook: '', foreign: '',
  files: { passport: false, reg: false, photos: false, vet: false, dna: false }, consent: { profile: true, pedigree: true, owner: false, health: false }, ack: false,
});
const fresh = (): Work => ({ id: newId(), key: newKey(), step: 0, d: blank() });
const WORK = 'eq-reg-work', DRAFTS = 'eq-reg-drafts';
const loadWork = (): Work => { try { const r = sessionStorage.getItem(WORK); if (r) { const w = JSON.parse(r) as Work; if (w?.d && w.key) return { ...w, d: { ...blank(), ...w.d } }; } } catch { /* ignore */ } return fresh(); };
const loadDrafts = (): Saved[] => { try { return JSON.parse(localStorage.getItem(DRAFTS) || '[]') as Saved[]; } catch { return []; } };
const isBlank = (d: Wiz) => !d.name && !d.nameFa && !d.birth && !d.owner && !d.sire && !d.dam && !d.sireNo && !d.damNo;

/* ------------------------------------------------------------------ in-place parent lookup */
function ParentLookup({ label, sex, id, mode, no, nm, onId, onMode, onNo, onNm, error }: {
  label: string; sex: 'stallion' | 'mare'; id: string; mode: 'registry' | 'manual'; no: string; nm: string; error?: string;
  onId: (v: string) => void; onMode: (m: 'registry' | 'manual') => void; onNo: (v: string) => void; onNm: (v: string) => void;
}) {
  const { tx, tr, n } = useI18n();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Horse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => clearTimeout(t)); timers.current = []; };
  useEffect(() => () => { seq.current++; clear(); }, []);
  const sel = id ? horseById(id) : undefined;

  const search = (v: string) => {
    setQ(v); clear();
    const my = ++seq.current; // every keystroke supersedes the previous request
    if (v.trim().length < 2) { setRes(null); setBusy(false); return; }
    setBusy(true);
    timers.current.push(window.setTimeout(() => { // debounce 250 ms, then a simulated network round-trip of 120–500 ms
      timers.current.push(window.setTimeout(() => {
        if (my !== seq.current) return; // stale response — dropped, never rendered
        const s = norm(v);
        const hit = HORSES.filter((h) => h.gender === sex && (norm(h.name.en).includes(s) || norm(h.name.fa).includes(s) || norm(h.regId).includes(s))).slice(0, 8);
        setRes(hit); setBusy(false);
      }, 120 + (hash(v) % 380)));
    }, 250));
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="whitespace-nowrap text-[13px] font-bold">{label}</span>
        <button type="button" onClick={() => { onMode(mode === 'registry' ? 'manual' : 'registry'); setRes(null); setQ(''); }} className="whitespace-nowrap text-[11px] font-semibold text-fg-sky-700 hover:underline" title={tx('Not in the registry? Enter its number as a source assertion', 'در ثبت نیست؟ شماره آن را به‌عنوان ادعای منبع وارد کنید')}>
          {mode === 'registry' ? tx('Enter a number instead', 'وارد کردن شماره') : tx('Search the registry', 'جستجو در ثبت ملی')}
        </button>
      </div>

      {mode === 'registry' ? (
        sel ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-surface p-2 ring-1 ring-line">
            <Img src={px(sel.photo, 80, 80)} alt="" pos={sel.pos} className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 leading-tight"><b className="block text-[13px]">{tr(sel.name)}</b><span className="font-mono text-[11px] text-fg-navy-500" dir="ltr">{sel.regId} · {sel.birth.slice(0, 4)}</span></div>
            <TrustBadge level="reviewed" compact />
            <a href={`#/horses/${sel.id}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-fg-sky-700 hover:bg-surface-2" title={tx('Your form is kept while you look', 'فرم شما هنگام مشاهده حفظ می‌شود')}>{tx('Open', 'باز کردن')}</a>
            <button type="button" onClick={() => onId('')} aria-label={tx('Clear', 'پاک کردن')} className="grid h-7 w-7 place-items-center rounded-full text-fg-navy-500 hover:bg-surface-2"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-navy-400" />
              <input value={q} onChange={(e) => search(e.target.value)} className={cn(inputCls, 'ps-9 pe-9')} placeholder={tx('Type a name or registry number…', 'نام یا شماره ثبت را بنویسید…')} aria-label={label} aria-busy={busy} />
              {busy && <Loader2 className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-fg-navy-400" />}
            </div>
            {res && (
              <ul className="mt-1.5 max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-1" data-results={res.length}>
                {res.map((h) => (
                  <li key={h.id}><button type="button" onClick={() => { onId(h.id); setRes(null); setQ(''); }} className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-start transition hover:bg-surface-2">
                    <Img src={px(h.photo, 60, 60)} alt="" pos={h.pos} className="h-8 w-8 shrink-0 rounded-md" /><span className="min-w-0 flex-1 leading-tight"><b className="block text-[13px]">{tr(h.name)}</b><span className="text-[11px] text-fg-navy-500">{tr(h.breed)}</span></span><span className="font-mono text-[11px] text-fg-navy-400" dir="ltr">{h.regId}</span>
                  </button></li>
                ))}
                {!res.length && <li className="px-2 py-2.5 text-xs text-fg-navy-500">{tx('No matching horse. You can enter a number instead.', 'اسبی یافت نشد. می‌توانید شماره وارد کنید.')}</li>}
                {res.length === 8 && <li className="px-2 pb-1 text-[11px] text-fg-navy-400">{tx('Showing the first 8 — keep typing to narrow', 'نمایش ۸ مورد اول — برای محدودتر شدن ادامه دهید')}</li>}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-fg-navy-500">{sex === 'stallion' ? tx('Stallions only.', 'فقط اسب نر.') : tx('Mares only.', 'فقط مادیان.')} {n(HORSES.filter((h) => h.gender === sex).length)} {tx('in this demo registry', 'در این ثبت نمونه')}</p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={tx('Register / life number', 'شماره ثبت / عمر')}><input dir="ltr" className={cn(inputCls, 'font-mono')} value={no} onChange={(e) => onNo(asciiDigits(e.target.value))} /></Field>
            <Field label={tx('Name (optional)', 'نام (اختیاری)')}><input className={inputCls} value={nm} onChange={(e) => onNm(e.target.value)} /></Field>
          </div>
          <Notice tone="amber" icon={<Info />}>{tx('Recorded as a source assertion only. It is not linked to a registry horse, and nothing canonical is created from it.', 'فقط به‌عنوان ادعای منبع ثبت می‌شود. به هیچ اسب ثبت‌شده‌ای وصل نمی‌شود و چیزی مرجع از آن ساخته نمی‌شود.')}</Notice>
        </div>
      )}
      {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-fg-red-700">{error}</p>}
    </div>
  );
}

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn('flex w-full items-center gap-3 rounded-xl border p-2.5 text-start transition', on ? 'border-sky-300 bg-sky-50' : 'border-line bg-field hover:bg-surface-2')}>
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-sky-600' : 'bg-navy-300')}><span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'start-[18px]' : 'start-0.5')} /></span>
      <span className="min-w-0 leading-tight"><span className="block text-[13px] font-semibold">{label}</span>{sub && <span className="block text-[11px] text-fg-navy-500">{sub}</span>}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ the wizard */
export function RegisterWizard() {
  const { tx, tr, n, date } = useI18n();
  const rules = useRules();
  const [work, setWork] = useState<Work>(loadWork);
  const [drafts, setDrafts] = useState<Saved[]>(loadDrafts);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ ref: string; key: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { d, step } = work;

  useEffect(() => { try { sessionStorage.setItem(WORK, JSON.stringify(work)); } catch { /* ignore */ } }, [work]);
  const saveDrafts = (next: Saved[]) => { setDrafts(next); try { localStorage.setItem(DRAFTS, JSON.stringify(next)); } catch { /* ignore */ } };
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2600); };
  const set = <K extends keyof Wiz>(k: K, v: Wiz[K]) => setWork((w) => ({ ...w, d: { ...w.d, [k]: v, ack: k === 'ack' ? (v as boolean) : false } }));
  const goStep = (s: number) => { setTried(false); setWork((w) => ({ ...w, step: s })); };

  const draft: Draft = useMemo(() => ({
    name: d.name, nameFa: d.nameFa, birth: d.birth, birthEnd: d.exact ? '' : d.birthEnd, sex: d.sex, breed: d.breed, colour: d.colour, chip: d.chip, passport: d.passport, regNo: d.regNo,
    sire: d.sireMode === 'manual' ? 'unregistered' : d.sire, dam: d.damMode === 'manual' ? 'unregistered' : d.dam, twin: d.twin, embryo: d.embryo, recipient: d.recipient, status: d.status, deathDate: d.deathDate,
  }), [d]);
  const checks = useMemo(() => runChecks(draft, rules), [draft, rules]);
  const blocks = checks.filter((c) => c.sev === 'block'), warns = checks.filter((c) => c.sev === 'warn'), infos = checks.filter((c) => c.sev === 'info'), passes = checks.filter((c) => c.sev === 'pass');

  /* ---- per-step bilingual validation ---- */
  const errors = (s: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (d.name.trim().length < 2 && d.nameFa.trim().length < 2) e.name = tx('Enter a name in English or Farsi (at least 2 letters).', 'نام را به انگلیسی یا فارسی وارد کنید (دست‌کم ۲ حرف).');
      if (!d.birth) e.birth = tx(d.exact ? 'Enter the birth date.' : 'Enter the start of the estimated range.', d.exact ? 'تاریخ تولد را وارد کنید.' : 'آغاز بازه تخمینی را وارد کنید.');
      else if (d.birth > TODAY) e.birth = tx('The birth date cannot be in the future.', 'تاریخ تولد نمی‌تواند در آینده باشد.');
      if (!d.exact && d.birth && (!d.birthEnd || d.birthEnd < d.birth)) e.birthEnd = tx('The end of the range must be on or after its start.', 'پایان بازه باید برابر یا پس از آغاز آن باشد.');
      if (d.status !== 'alive' && !d.deathDate) e.deathDate = tx('Enter the date of this status.', 'تاریخ این وضعیت را وارد کنید.');
      if (d.status !== 'alive' && d.deathDate && d.birth && d.deathDate < d.birth) e.deathDate = tx('That date is before the birth date.', 'این تاریخ پیش از تولد است.');
    }
    if (s === 1) {
      if (d.sireMode === 'manual' && asciiDigits(d.sireNo).trim().length < 3) e.sire = tx('Enter the sire’s register or life number (at least 3 characters).', 'شماره ثبت یا عمر پدر را وارد کنید (دست‌کم ۳ نویسه).');
      if (d.damMode === 'manual' && asciiDigits(d.damNo).trim().length < 3) e.dam = tx('Enter the dam’s register or life number (at least 3 characters).', 'شماره ثبت یا عمر مادر را وارد کنید (دست‌کم ۳ نویسه).');
      if (d.embryo && !d.recipient.trim()) e.recipient = tx('Name the recipient mare for an embryo transfer.', 'برای انتقال جنین، مادیان گیرنده را نام ببرید.');
    }
    if (s === 2) {
      if (d.owner.trim().length < 2) e.owner = tx('Enter the current owner.', 'مالک فعلی را وارد کنید.');
      if (d.chip && d.chip.length !== 15) e.chip = tx('A microchip number has exactly 15 digits.', 'شماره میکروچیپ دقیقاً ۱۵ رقم است.');
      if (d.height && (+d.height < 90 || +d.height > 200)) e.height = tx('Height should be between 90 and 200 cm.', 'قد باید بین ۹۰ تا ۲۰۰ سانتی‌متر باشد.');
    }
    return e;
  };
  const err = tried ? errors(step) : {};
  const next = () => { if (Object.keys(errors(step)).length) { setTried(true); return; } goStep(step + 1); };

  const saveDraft = () => {
    const entry: Saved = { id: work.id, at: `${TODAY} 10:42`, step, d: { ...d, ack: false } };
    saveDrafts([entry, ...drafts.filter((x) => x.id !== work.id)]);
    say(tx('Draft saved — resume it any time.', 'پیش‌نویس ذخیره شد — هر زمان ادامه دهید.'));
  };
  const resume = (s: Saved) => { setTried(false); setDone(null); setWork({ id: s.id, key: newKey(), step: s.step, d: { ...blank(), ...s.d } }); };
  const reset = () => { setTried(false); setDone(null); setWork(fresh()); };
  const submit = () => {
    const ref = `IR-2025-0${n(String(1000 + (hash(d.name + d.nameFa + work.key) % 8000)))}`;
    saveDrafts(drafts.filter((x) => x.id !== work.id));
    setDone({ ref, key: work.key, name: d.name || d.nameFa });
    try { sessionStorage.removeItem(WORK); } catch { /* ignore */ }
  };

  const steps = [
    { icon: <ClipboardPlus />, l: tx('Identity', 'مشخصات'), s: tx('Names, breed, birth, colour', 'نام، نژاد، تولد، رنگ') },
    { icon: <Dna />, l: tx('Parents', 'والدین'), s: tx('Sire, dam, twins, embryo', 'پدر، مادر، دوقلو، جنین') },
    { icon: <UserRound />, l: tx('People & evidence', 'افراد و مدارک'), s: tx('Owner, identifiers, files', 'مالک، شناسه‌ها، فایل‌ها') },
    { icon: <ShieldCheck />, l: tx('Review & submit', 'بازبینی و ارسال'), s: tx('Check everything, then send', 'همه‌چیز را بررسی و ارسال کنید') },
  ];
  const UP: [string, string][] = [['passport', tx('Passport scan', 'اسکن پاسپورت')], ['reg', tx('Registration certificate', 'گواهی ثبت')], ['photos', tx('Standard photos (both sides, head, markings)', 'عکس‌های استاندارد (دو طرف، سر، علائم)')], ['vet', tx('Vaccination / vet record', 'کارنامه واکسن / دامپزشک')], ['dna', tx('DNA report (optional)', 'گزارش DNA (اختیاری)')]];
  const FieldErr = ({ k }: { k: string }) => (err[k] ? <p role="alert" className="mt-1 text-xs font-semibold text-fg-red-700">{err[k]}</p> : null);
  const sire = d.sire ? horseById(d.sire) : undefined, dam = d.dam ? horseById(d.dam) : undefined;

  /* ------------------------------------------------ receipt */
  if (done)
    return (
      <div className="panel mx-auto grid max-w-2xl place-items-center px-6 py-10 text-center" data-idem="">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-fg-emerald-700"><CircleCheck className="h-8 w-8" /></span>
        <h2 className="mt-4 font-display text-2xl font-semibold">{tx('Application submitted for verification', 'درخواست برای تأیید ارسال شد')}</h2>
        <p className="mt-1 max-w-md text-sm text-fg-navy-500">{tx('Everything you entered is shown as “Self-declared” until an authorised reviewer checks it. Uploaded files appear as “Document uploaded · not reviewed”.', 'همه اطلاعات تا بررسی توسط مرجع مجاز با برچسب «خوداظهاری» نمایش داده می‌شود و فایل‌ها «ارائه شده؛ بررسی نشده» خواهند بود.')}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-xl bg-surface-2 px-4 py-2"><span className="font-mono text-sm" dir="ltr">{done.ref}</span><TrustBadge level="self" long /></div>
        <dl className="mt-3 grid w-full max-w-md grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-start text-xs"><dt className="font-semibold text-fg-navy-500">{tx('Horse', 'اسب')}</dt><dd className="font-semibold">{done.name}</dd><dt className="font-semibold text-fg-navy-500">{tx('Idempotency key', 'کلید یکتایی')}</dt><dd className="break-all font-mono" dir="ltr" data-receipt-key={done.key}>{done.key}</dd></dl>
        <p className="mt-1 max-w-md text-[11px] text-fg-navy-400">{tx('Retrying this exact submission with the same key replays this receipt; a different horse always gets a fresh key.', 'تلاش دوباره همین ارسال با همان کلید همین رسید را بازمی‌گرداند؛ اسب دیگر همیشه کلید تازه می‌گیرد.')}</p>
        <ol className="mt-5 grid w-full gap-2 text-start sm:grid-cols-4">{[tx('Submitted', 'ارسال شد'), tx('Document review', 'بررسی مدارک'), tx('Authority review', 'بررسی مرجع'), tx('Certified', 'صدور گواهی')].map((l, i) => <li key={l} className={cn('rounded-xl border p-2 text-xs font-semibold', i === 0 ? 'border-emerald-300 bg-emerald-100/60 text-fg-emerald-800' : 'border-line bg-surface-2 text-fg-navy-500')}><span className="block text-[10px] uppercase tracking-wider opacity-70">{tx('Step', 'گام')} {n(i + 1)}</span>{l}</li>)}</ol>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={reset} className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">{tx('Register another horse', 'ثبت اسب دیگر')}</button>
          <button onClick={() => go('/horses')} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-surface-2">{tx('Back to registry', 'بازگشت به ثبت')}</button>
        </div>
      </div>
    );

  const sevUi = { block: ['border-red-300 bg-red-100/60 text-fg-red-900', <CircleX key="x" className="h-4 w-4 text-red-600" />], warn: ['border-amber-300 bg-amber-100/60 text-fg-amber-900', <AlertTriangle key="w" className="h-4 w-4 text-amber-600" />], info: ['border-blue-300 bg-blue-100/50 text-fg-blue-900', <Info key="i" className="h-4 w-4 text-blue-600" />], pass: ['border-emerald-200 bg-emerald-50/70 text-fg-emerald-900', <CircleCheck key="p" className="h-4 w-4 text-emerald-600" />] } as const;
  const checkList = (all: boolean) => (
    <ul className="space-y-1.5">
      {(all ? checks : checks.filter((c) => c.sev !== 'pass')).map((c) => (
        <li key={c.id} className={cn('flex items-start gap-2 rounded-xl border p-2 text-xs', sevUi[c.sev][0])}>
          <span className="mt-0.5 shrink-0">{sevUi[c.sev][1]}</span>
          <span className="min-w-0 leading-snug"><b className="block text-[13px]">{tr(c.title)}</b>{c.detail && <span className="opacity-90">{tr(c.detail)}</span>}</span>
        </li>
      ))}
      {!all && !checks.some((c) => c.sev !== 'pass') && <li className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2 text-xs font-semibold text-fg-emerald-800"><CircleCheck className="h-4 w-4" />{tx('No issues so far', 'تاکنون مشکلی یافت نشد')}</li>}
    </ul>
  );
  const parentLabel = (h: Horse | undefined, mode: string, no: string, nm: string) => (mode === 'manual' ? `${nm || '—'} · ${no || '—'} (${tx('source assertion', 'ادعای منبع')})` : h ? `${tr(h.name)} · ${h.regId}` : tx('Not given', 'ثبت نشده'));
  const review: { title: string; to: number; rows: [string, ReactNode][] }[] = [
    { title: steps[0].l, to: 0, rows: [[tx('Name', 'نام'), [d.name, d.nameFa].filter(Boolean).join(' · ') || '—'], [tx('Sex · breed', 'جنس · نژاد'), `${tr(GENDER_L[d.sex as Gender])} · ${tr(BREEDS.find((b) => b.en === d.breed)!)}`], [tx('Born', 'تولد'), d.birth ? (d.exact ? date(d.birth, 'long') : `${date(d.birth)} → ${d.birthEnd ? date(d.birthEnd) : '—'} (${tx('estimated', 'تخمینی')})`) : '—'], [tx('Colour', 'رنگ'), `${tr(COLOUR_L[d.colour as Colour])}${d.markings ? ` · ${d.markings}` : ''}`], [tx('Status', 'وضعیت'), d.status === 'alive' ? tx('Alive', 'زنده') : d.status === 'deceased' ? `${tx('Deceased', 'فوت‌شده')} ${d.deathDate}` : `${tx('Missing', 'مفقود')} ${d.deathDate}`]] },
    { title: steps[1].l, to: 1, rows: [[tx('Sire', 'پدر'), parentLabel(sire, d.sireMode, d.sireNo, d.sireName)], [tx('Dam', 'مادر'), parentLabel(dam, d.damMode, d.damNo, d.damName)], [tx('Twin · embryo transfer', 'دوقلو · انتقال جنین'), `${d.twin ? tx('Twin', 'دوقلو') : tx('Single', 'تک‌زایی')} · ${d.embryo ? `${tx('ET, recipient', 'انتقال جنین، گیرنده')}: ${d.recipient || '—'}` : tx('No ET', 'بدون انتقال جنین')}`]] },
    { title: steps[2].l, to: 2, rows: [[tx('Owner', 'مالک'), d.owner || '—'], [tx('Breeder · place', 'پرورش‌دهنده · محل'), [d.breeder, d.location].filter(Boolean).join(' · ') || '—'], [tx('Microchip', 'میکروچیپ'), <span key="c" className="font-mono" dir="ltr">{d.chip || '—'}</span>], [tx('Passport · register no.', 'پاسپورت · شماره ثبت'), <span key="p" className="font-mono" dir="ltr">{[d.passport, d.regNo].filter(Boolean).join(' · ') || '—'}</span>], [tx('Files', 'فایل‌ها'), `${n(Object.values(d.files).filter(Boolean).length)} / ${n(5)}`], [tx('Public', 'عمومی'), Object.entries(d.consent).filter(([, v]) => v).map(([k]) => ({ profile: tx('profile', 'نمایه'), pedigree: tx('pedigree', 'شجره'), owner: tx('owner', 'مالک'), health: tx('health summary', 'خلاصه سلامت') } as Record<string, string>)[k]).join('، ') || '—']] },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_290px]" data-idem={work.key} data-step={step}>
      <div className="min-w-0 space-y-3 lg:self-start">
        <ol className="panel hide-scroll flex gap-1 p-2 max-lg:overflow-x-auto lg:flex-col lg:gap-0 lg:p-3">
          {steps.map((s, i) => (
            <li key={i} className="relative lg:pb-4 lg:last:pb-0">
              {i < steps.length - 1 && <span className={cn('absolute start-[19px] top-10 hidden h-[calc(100%-32px)] w-0.5 rounded lg:block', i < step ? 'bg-sky-500' : 'bg-line')} />}
              <button onClick={() => i < step && goStep(i)} disabled={i > step} aria-current={i === step ? 'step' : undefined} className={cn('relative flex w-full items-center gap-2.5 rounded-xl p-1.5 text-start transition', i === step ? 'bg-sky-100/70' : i < step ? 'hover:bg-surface-2' : 'opacity-60')}>
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors', i < step ? 'bg-sky-600 text-white' : i === step ? 'bg-navy-900 text-white' : 'bg-surface-2 text-fg-navy-500 ring-1 ring-line')}>{i < step ? <Check className="h-4 w-4" strokeWidth={3} /> : n(i + 1)}</span>
                <span className="min-w-0 leading-tight max-lg:whitespace-nowrap"><span className="block text-[13px] font-bold text-fg-navy-900">{s.l}</span><span className="hidden text-[11px] text-fg-navy-500 lg:block">{s.s}</span></span>
              </button>
            </li>
          ))}
        </ol>
        <div className="panel hidden p-3 lg:block">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-navy-500"><History className="h-3.5 w-3.5" />{tx('Drafts', 'پیش‌نویس‌ها')}</div>
          {drafts.length ? (
            <ul className="mt-2 space-y-1.5">{drafts.map((s) => (
              <li key={s.id} className={cn('flex items-center gap-1.5 rounded-lg border p-1.5 text-xs', s.id === work.id ? 'border-sky-300 bg-sky-50' : 'border-line bg-surface-2/50')}>
                <button onClick={() => resume(s)} className="min-w-0 flex-1 text-start leading-tight"><b className="block truncate text-[12px]">{s.d.name || s.d.nameFa || tx('Untitled horse', 'اسب بدون نام')}</b><span className="text-[10px] text-fg-navy-500">{tx('Step', 'گام')} {n(s.step + 1)} · {s.at.slice(5, 10)}</span></button>
                <button onClick={() => saveDrafts(drafts.filter((x) => x.id !== s.id))} aria-label={tx('Delete draft', 'حذف پیش‌نویس')} className="grid h-6 w-6 place-items-center rounded text-fg-navy-400 hover:bg-surface-2 hover:text-fg-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>))}</ul>
          ) : <p className="mt-1.5 text-[11px] leading-snug text-fg-navy-500">{tx('Nothing saved yet. Use “Save draft” at any step.', 'هنوز چیزی ذخیره نشده. در هر گام «ذخیره پیش‌نویس» را بزنید.')}</p>}
        </div>
      </div>

      <div className="panel flex min-w-0 flex-col p-3 sm:p-4">
        {drafts.length > 0 && isBlank(d) && step === 0 && (
          <Notice tone="blue" icon={<History />} className="mb-3">{tx(`You have ${drafts.length} saved draft(s).`, `${n(drafts.length)} پیش‌نویس ذخیره‌شده دارید.`)} <button onClick={() => resume(drafts[0])} className="ms-1 font-bold underline">{tx('Resume the latest', 'ادامه آخرین')}</button></Notice>
        )}
        <div key={step} className="flex-1 animate-enter">
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tx('Current name (English)', 'نام فعلی (انگلیسی)')} hint={tx('Try “Persian Star” — the duplicate check reacts at once', 'عبارت «Persian Star» را امتحان کنید — بررسی تکراری فوراً واکنش نشان می‌دهد')}><input className={inputCls} value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Shahbaz" /></Field>
              <Field label={tx('Current name (Farsi)', 'نام فعلی (فارسی)')}><input className={inputCls} dir="rtl" value={d.nameFa} onChange={(e) => set('nameFa', e.target.value)} placeholder="مثلاً شهباز" /></Field>
              <div className="sm:col-span-2"><FieldErr k="name" /></div>
              <Field label={tx('Name at birth / previous names', 'نام هنگام تولد / نام‌های قبلی')} hint={tx('Comma separated — all are searchable', 'با ویرگول جدا کنید — همه قابل جستجو هستند')}><input className={inputCls} value={d.prev} onChange={(e) => set('prev', e.target.value)} /></Field>
              <Field label={tx('Sex', 'جنس')}><Select label="sex" value={d.sex} onChange={(v) => set('sex', v)} options={(Object.keys(GENDER_L) as Gender[]).map((g) => ({ v: g, l: tr(GENDER_L[g]) }))} /></Field>
              <Field label={tx('Breed', 'نژاد')}><Select label="breed" value={d.breed} onChange={(v) => set('breed', v)} options={BREEDS.map((b) => ({ v: b.en, l: tr(b) }))} /></Field>
              <Field label={tx('Sub-breed / line', 'زیرنژاد / خط')}><input className={inputCls} value={d.subBreed} onChange={(e) => set('subBreed', e.target.value)} /></Field>
              <div className="sm:col-span-2">
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-fg-navy-600"><span>{tx('Birth date', 'تاریخ تولد')}</span>
                  <Segmented<string> label="mode" value={d.exact ? 'x' : 'r'} onChange={(v) => set('exact', v === 'x')} phase="registry" items={[{ v: 'x', l: tx('Exact date', 'تاریخ دقیق') }, { v: 'r', l: tx('Estimated range', 'بازه تخمینی') }]} /></div>
                <div className="grid gap-3 sm:grid-cols-2"><div><input type="date" className={inputCls} value={d.birth} onChange={(e) => set('birth', e.target.value)} aria-label={tx('From', 'از')} /><FieldErr k="birth" /></div>{!d.exact && <div><input type="date" className={inputCls} value={d.birthEnd} onChange={(e) => set('birthEnd', e.target.value)} aria-label={tx('To', 'تا')} /><FieldErr k="birthEnd" /></div>}</div>
              </div>
              <Field label={tx('Coat colour', 'رنگ پوشش')}><Select label="colour" value={d.colour} onChange={(v) => set('colour', v)} options={(Object.keys(COLOUR_L) as Colour[]).map((c) => ({ v: c, l: tr(COLOUR_L[c]) }))} /></Field>
              <Field label={tx('White markings', 'علائم سفید')}><input className={inputCls} value={d.markings} onChange={(e) => set('markings', e.target.value)} placeholder={tx('Star, left hind sock…', 'ستاره، جوراب پای عقب چپ…')} /></Field>
              <Field label={tx('Status', 'وضعیت')}><Select label="status" value={d.status} onChange={(v) => set('status', v)} options={[{ v: 'alive', l: tx('Alive', 'زنده') }, { v: 'deceased', l: tx('Deceased', 'فوت‌شده') }, { v: 'missing', l: tx('Missing', 'مفقود') }]} /></Field>
              {d.status !== 'alive' && <div><Field label={tx('Date of status', 'تاریخ وضعیت')}><input type="date" className={inputCls} value={d.deathDate} onChange={(e) => set('deathDate', e.target.value)} /></Field><FieldErr k="deathDate" /></div>}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <ParentLookup label={tx('Sire (father)', 'پدر')} sex="stallion" id={d.sire} mode={d.sireMode} no={d.sireNo} nm={d.sireName} error={err.sire} onId={(v) => set('sire', v)} onMode={(m) => set('sireMode', m)} onNo={(v) => set('sireNo', v)} onNm={(v) => set('sireName', v)} />
                <ParentLookup label={tx('Dam (mother)', 'مادر')} sex="mare" id={d.dam} mode={d.damMode} no={d.damNo} nm={d.damName} error={err.dam} onId={(v) => set('dam', v)} onMode={(m) => set('damMode', m)} onNo={(v) => set('damNo', v)} onNm={(v) => set('damName', v)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle on={d.twin} onChange={(v) => set('twin', v)} label={tx('Twin birth', 'دوقلوزایی')} sub={tx('Checked against the breed’s rule — not automatically a violation', 'مطابق قاعده نژاد بررسی می‌شود — لزوماً تخلف نیست')} />
                <Toggle on={d.embryo} onChange={(v) => set('embryo', v)} label={tx('Embryo transfer', 'انتقال جنین')} sub={tx('Genetic dam and recipient mare are recorded separately', 'مادر ژنتیکی و مادیان گیرنده جداگانه ثبت می‌شود')} />
              </div>
              {d.embryo && <div><Field label={tx('Recipient (surrogate) mare', 'مادیان گیرنده (جایگزین)')}><input className={inputCls} value={d.recipient} onChange={(e) => set('recipient', e.target.value)} /></Field><FieldErr k="recipient" /></div>}
              <Notice tone="blue" icon={<Info />}>{tx('A parent chosen here is linked into the pedigree at once, but stays “Self-declared” until a DNA parentage test or an authority confirms it. A parent entered as a number stays an explicit source assertion — nothing canonical is auto-created.', 'والدی که اینجا انتخاب می‌شود فوراً به شجره متصل می‌شود اما تا تأیید DNA یا مرجع «خوداظهاری» می‌ماند. والدی که با شماره وارد شود ادعای صریح منبع می‌ماند — هیچ رکورد مرجعی خودکار ساخته نمی‌شود.')}</Notice>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid content-start gap-3">
                <div><Field label={tx('Current owner', 'مالک فعلی')}><input className={inputCls} value={d.owner} onChange={(e) => set('owner', e.target.value)} placeholder={tx('Person or company', 'شخص یا شرکت')} /></Field><FieldErr k="owner" /></div>
                <Field label={tx('Breeder', 'پرورش‌دهنده')}><input className={inputCls} value={d.breeder} onChange={(e) => set('breeder', e.target.value)} /></Field>
                <Field label={tx('Stud farm / producer', 'مزرعه / تولیدکننده')}><input className={inputCls} value={d.producer} onChange={(e) => set('producer', e.target.value)} /></Field>
                <Field label={tx('Where the horse is kept', 'محل نگهداری')}><div className="relative"><MapPin className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-navy-400" /><input className={cn(inputCls, 'ps-9')} value={d.location} onChange={(e) => set('location', e.target.value)} /></div></Field>
                <div><Field label={tx('Microchip number', 'شماره میکروچیپ')} hint={tx('15 digits · Persian and Arabic digits are converted · try 981020000123456', '۱۵ رقم · ارقام فارسی و عربی تبدیل می‌شود · نمونه 981020000123456')}><input dir="ltr" inputMode="numeric" className={cn(inputCls, 'font-mono')} value={d.chip} onChange={(e) => set('chip', asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 15))} /></Field><FieldErr k="chip" /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tx('Passport number', 'شماره پاسپورت')}><input dir="ltr" className={cn(inputCls, 'font-mono')} value={d.passport} onChange={(e) => set('passport', asciiDigits(e.target.value))} placeholder="IRP-2020-00000" /></Field>
                  <Field label={tx('Registry number', 'شماره ثبت')}><input dir="ltr" className={cn(inputCls, 'font-mono')} value={d.regNo} onChange={(e) => set('regNo', asciiDigits(e.target.value))} /></Field>
                  <Field label={tx('Studbook number', 'شماره تبارنامه')}><input dir="ltr" className={cn(inputCls, 'font-mono')} value={d.studbook} onChange={(e) => set('studbook', asciiDigits(e.target.value))} /></Field>
                  <div><Field label={tx('Height (cm)', 'قد (سانتی‌متر)')}><input dir="ltr" inputMode="numeric" className={inputCls} value={d.height} onChange={(e) => set('height', asciiDigits(e.target.value).replace(/\D/g, '').slice(0, 3))} /></Field><FieldErr k="height" /></div>
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="text-xs font-bold uppercase tracking-wider text-fg-navy-500">{tx('Evidence', 'مدارک')}</div>
                {UP.map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setWork((w) => ({ ...w, d: { ...w.d, files: { ...w.d.files, [k]: !w.d.files[k] }, ack: false } }))} className={cn('flex w-full items-center gap-3 rounded-xl border-2 border-dashed p-2.5 text-start transition', d.files[k] ? 'border-amber-400 bg-amber-100/50' : 'border-line hover:border-sky-300 hover:bg-sky-50/50')}>
                    {d.files[k] ? <TrustBadge level="uploaded" compact className="!h-8 !w-8 !justify-center !rounded-full" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-sky-100 text-fg-sky-700"><Upload className="h-4 w-4" /></span>}
                    <span className="min-w-0 flex-1 leading-tight"><span className="block text-[13px] font-semibold">{l}</span><span className="block text-[11px] text-fg-navy-500">{d.files[k] ? tx('Uploaded · not reviewed (demo)', 'ارائه شده · بررسی نشده (نمایشی)') : tx('Click to attach · PDF, JPG, PNG', 'برای پیوست کلیک کنید · PDF, JPG, PNG')}</span></span>
                  </button>
                ))}
                <div className="pt-1 text-xs font-bold uppercase tracking-wider text-fg-navy-500">{tx('What may be public?', 'چه چیزی عمومی باشد؟')}</div>
                {([['profile', tx('Public profile & photo', 'نمایه و عکس عمومی'), tx('Name, breed, sex, birth year', 'نام، نژاد، جنس، سال تولد')], ['pedigree', tx('Pedigree & results', 'شجره و نتایج'), tx('Parents, ancestors, competitions', 'والدین، اجداد، مسابقات')], ['owner', tx('Owner name', 'نام مالک'), tx('Otherwise shown to authorised users only', 'در غیر این صورت فقط برای مجازان')], ['health', tx('Health summary', 'خلاصه سلامت'), tx('Only “documents reviewed” — never details', 'فقط «مدارک بررسی شد» — نه جزئیات')]] as [string, string, string][]).map(([k, l, s]) => <Toggle key={k} on={d.consent[k]} onChange={(v) => setWork((w) => ({ ...w, d: { ...w.d, consent: { ...w.d.consent, [k]: v }, ack: false } }))} label={l} sub={s} />)}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,.85fr)]">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between"><h3 className="text-[13px] font-bold">{tx('Review your application', 'درخواست خود را بازبینی کنید')}</h3><TrustBadge level="self" /></div>
                {review.map((g) => (
                  <section key={g.title} className="rounded-xl border border-line bg-surface-2/40 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-fg-navy-500">{g.title}</span><button onClick={() => goStep(g.to)} className="text-[11px] font-semibold text-fg-sky-700 hover:underline">{tx('Edit', 'ویرایش')}</button></div>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">{g.rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-xs text-fg-navy-500">{k}</dt><dd className="min-w-0 text-end font-medium" dir="auto">{v}</dd></div>)}</dl>
                  </section>
                ))}
              </div>
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold"><span className="rounded-full bg-red-100 px-2 py-0.5 text-fg-red-800">{n(blocks.length)} {tx('blocking', 'مسدودکننده')}</span><span className="rounded-full bg-amber-100 px-2 py-0.5 text-fg-amber-800">{n(warns.length)} {tx('warnings', 'هشدار')}</span><span className="rounded-full bg-blue-100 px-2 py-0.5 text-fg-blue-800">{n(infos.length)} {tx('notes', 'یادداشت')}</span><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-fg-emerald-800">{n(passes.length)} {tx('passed', 'موفق')}</span></div>
                {checkList(true)}
                {warns.length > 0 && !blocks.length && <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-100/50 p-2.5 text-xs font-semibold text-fg-amber-900"><input type="checkbox" checked={d.ack} onChange={(e) => set('ack', e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />{tx('I have reviewed the warnings; send the record for human review anyway.', 'هشدارها را بررسی کردم؛ رکورد به هر حال برای بازبینی انسانی ارسال شود.')}</label>}
                {blocks.length > 0 && <Notice tone="red" icon={<CircleX />}>{tx('Final registration is blocked. Fix the blocking items — or save a draft; a review case opens automatically if you submit one.', 'ثبت قطعی مسدود است. موارد مسدودکننده را رفع کنید — یا پیش‌نویس ذخیره کنید؛ در صورت ارسال، پرونده بررسی خودکار باز می‌شود.')}</Notice>}
                <p className="font-mono text-[10px] text-fg-navy-400" dir="ltr">{tx('Idempotency key', 'کلید یکتایی')}: {work.key}</p>
              </div>
            </div>
          )}
        </div>

        {tried && Object.keys(errors(step)).length > 0 && <Notice tone="red" icon={<AlertTriangle />} className="mt-3">{tx('Please fix the highlighted fields to continue.', 'برای ادامه، فیلدهای مشخص‌شده را اصلاح کنید.')}</Notice>}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button onClick={() => goStep(Math.max(0, step - 1))} disabled={step === 0} className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-fg-navy-700 transition hover:bg-surface-2 disabled:opacity-40"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{tx('Back', 'قبلی')}</button>
          <button onClick={saveDraft} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-field px-3.5 py-2 text-sm font-semibold text-fg-navy-800 transition hover:bg-surface-2"><Save className="h-4 w-4" />{tx('Save draft', 'ذخیره پیش‌نویس')}</button>
          <span className="ms-auto" />
          {step < 3 ? (
            <button onClick={next} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-sky-600/20 transition hover:bg-sky-700">{tx('Continue', 'ادامه')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button>
          ) : (
            <button onClick={submit} disabled={blocks.length > 0 || (warns.length > 0 && !d.ack)} className="btn-gold inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"><FileText className="h-4 w-4" />{blocks.length ? tx('Blocked', 'مسدود') : tx('Submit for verification', 'ارسال برای تأیید')}</button>
          )}
        </div>
      </div>

      {step < 3 && (
        <aside className="panel hidden h-fit p-3 xl:block" aria-live="polite">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[13px] font-bold">{tx('Live rule checks', 'بررسی زنده قوانین')}</h3><span className="text-[11px] font-semibold text-fg-navy-500">{n(passes.length)}/{n(checks.length)} ✓</span></div>
          {checkList(false)}
          <p className="mt-2 text-[11px] leading-relaxed text-fg-navy-500">{tx('Rules are set by administrators, versioned, and can differ by breed or studbook.', 'قوانین توسط مدیران تنظیم و نسخه‌بندی می‌شوند و می‌توانند برای هر نژاد یا دفتر متفاوت باشند.')}</p>
        </aside>
      )}
      {toast && <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 animate-enter rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-2xl rtl:translate-x-1/2">{toast}</div>}
    </div>
  );
}
