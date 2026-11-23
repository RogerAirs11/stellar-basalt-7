import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ChartColumn as BarChart3Icon, CircleCheck, Download, FileSpreadsheet, FileUp, KeyRound, Layers, Plus, ScrollText, Search, ShieldCheck, Upload } from 'lucide-react';
import { AGE_BUCKETS, AUDIT, BREED_CFG, DIVERSITY, ENDPOINTS, FIELDS, FOALS_YEAR, IMPORT_ERRORS, JOBS, PROVINCES } from '../admin-data';
import { useI18n } from '../i18n';
import { useRole } from '../role';
import { Card, Chip, Meter, Notice, PanelHeader, Pager, Pill, Select, VisPill, inputCls } from '../components/ui';
import { Donut, HBar } from '../components/charts';
import { cn } from '../utils/cn';

/* =============================== Catalogue & metadata =============================== */
export function AdminCatalogue() {
  const { tx, tr, n } = useI18n();
  const { can } = useRole();
  const edit = can('admin');
  const [cfg, setCfg] = useState(BREED_CFG);
  const [fields, setFields] = useState(FIELDS);
  const [cats, setCats] = useState(['Show jumping', 'Dressage', 'Endurance', 'Racing', 'Breed show']);
  const [nc, setNc] = useState('');
  const set = (i: number, patch: Partial<(typeof BREED_CFG)[number]>) => setCfg((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const vis = (v: 'public' | 'restricted' | 'private') => (v === 'public' ? 'restricted' : v === 'restricted' ? 'private' : 'public');
  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto p-3">
        <PanelHeader phase="admin" icon={<Layers />} title={tx('Breeds & studbooks', 'نژادها و دفاتر تبارنامه')} sub={tx('Breed-specific rules feed the rules engine', 'قوانین ویژه نژاد به موتور قوانین می‌رود')} />
        <table className="w-full min-w-[720px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Breed', 'نژاد')}</th><th className="pb-2 text-start font-semibold">{tx('Studbook', 'دفتر تبارنامه')}</th><th className="pb-2 text-center font-semibold">{tx('Sub-breeds', 'زیرنژاد')}</th><th className="pb-2 text-start font-semibold">{tx('Twins', 'دوقلو')}</th><th className="pb-2 text-center font-semibold">{tx('Embryo transfer', 'انتقال جنین')}</th><th className="pb-2 text-center font-semibold">AI</th><th className="pb-2 text-center font-semibold">{tx('Docs required', 'مدارک الزامی')}</th><th className="pb-2 text-end font-semibold">{tx('Horses', 'اسب‌ها')}</th></tr></thead>
          <tbody>{cfg.map((b, i) => (
            <tr key={b.en} className="border-t border-line" style={{ animation: `enter .3s ${i * 40}ms both` }}>
              <td className="py-2 font-bold">{tx(b.en, b.fa)}</td><td className="text-xs text-fg-navy-600">{tr(b.book)}</td><td className="text-center tabular-nums">{n(b.sub)}</td>
              <td><select disabled={!edit} value={b.twins} onChange={(e) => set(i, { twins: e.target.value as 'allowed' })} className={cn('rounded-lg border px-2 py-1 text-xs font-semibold outline-none', b.twins === 'block' ? 'border-red-300 bg-red-50 text-fg-red-800' : b.twins === 'review' ? 'border-amber-300 bg-amber-50 text-fg-amber-800' : 'border-emerald-300 bg-emerald-50 text-fg-emerald-800')}><option value="allowed">{tx('Allowed', 'مجاز')}</option><option value="review">{tx('Review', 'بررسی')}</option><option value="block">{tx('Block', 'مسدود')}</option></select></td>
              {(['et', 'ai'] as const).map((k) => <td key={k} className="text-center"><button disabled={!edit} onClick={() => set(i, { [k]: !b[k] })} role="switch" aria-checked={b[k]} className={cn('relative h-5 w-9 rounded-full transition-colors', b[k] ? 'bg-emerald-500' : 'bg-navy-400')}><span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all', b[k] ? 'start-[18px]' : 'start-0.5')} /></button></td>)}
              <td className="text-center tabular-nums">{n(b.docs)}</td><td className="text-end font-semibold tabular-nums">{n(b.count)}</td>
            </tr>))}</tbody></table>
      </Card>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0 overflow-x-auto p-3">
          <PanelHeader phase="admin" icon={<FileSpreadsheet />} title={tx('Metadata fields', 'فیلدهای فراداده')} sub={tx('Define fields, visibility, filters and search without code', 'تعریف فیلد، سطح نمایش، فیلتر و جستجو بدون کد')} action={edit && <button onClick={() => setFields((f) => [...f, { key: 'custom' + f.length, label: { en: 'New field', fa: 'فیلد جدید' }, type: { en: 'Text', fa: 'متن' }, vis: 'restricted', required: false, filter: false, search: false, core: false }])} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />{tx('Add field', 'افزودن فیلد')}</button>} />
          <table className="w-full min-w-[560px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Field', 'فیلد')}</th><th className="pb-2 text-start font-semibold">{tx('Type', 'نوع')}</th><th className="pb-2 text-start font-semibold">{tx('Visibility', 'نمایش')}</th><th className="pb-2 text-center font-semibold">{tx('Required', 'الزامی')}</th><th className="pb-2 text-center font-semibold">{tx('Filter', 'فیلتر')}</th><th className="pb-2 text-center font-semibold">{tx('Search', 'جستجو')}</th></tr></thead>
            <tbody>{fields.map((f, i) => (
              <tr key={f.key + i} className="border-t border-line">
                <td className="py-1.5 font-semibold">{tr(f.label)}{f.core && <span className="ms-1.5 rounded bg-slate-200 px-1 text-[10px] font-bold text-fg-slate-600">CORE</span>}</td><td className="text-xs text-fg-navy-600">{tr(f.type)}</td>
                <td><button disabled={!edit} onClick={() => setFields((x) => x.map((y, j) => (j === i ? { ...y, vis: vis(y.vis) } : y)))}><VisPill vis={f.vis} /></button></td>
                {(['required', 'filter', 'search'] as const).map((k) => <td key={k} className="text-center"><button disabled={!edit} onClick={() => setFields((x) => x.map((y, j) => (j === i ? { ...y, [k]: !y[k] } : y)))} className={cn('mx-auto grid h-5 w-5 place-items-center rounded border transition', f[k] ? 'border-violet-600 bg-violet-600 text-white' : 'border-navy-300 bg-field')}>{f[k] && <Check className="h-3 w-3" strokeWidth={4} />}</button></td>)}
              </tr>))}</tbody></table>
        </Card>
        <div className="min-w-0 space-y-3">
          <Card className="p-3">
            <PanelHeader phase="admin" icon={<Layers />} title={tx('Disciplines & categories', 'رشته‌ها و دسته‌بندی‌ها')} />
            <div className="flex flex-wrap gap-1.5">{cats.map((c) => <Chip key={c} phase="admin" active onClick={() => edit && setCats((x) => x.filter((y) => y !== c))}>{c} {edit && '×'}</Chip>)}</div>
            {edit && <div className="mt-2.5 flex gap-1.5"><input value={nc} onChange={(e) => setNc(e.target.value)} placeholder={tx('New category…', 'دسته جدید…')} className={cn(inputCls, '!py-1.5 !text-[13px]')} /><button onClick={() => { if (nc) { setCats((x) => [...x, nc]); setNc(''); } }} className="grid w-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white" aria-label="Add"><Plus className="h-4 w-4" /></button></div>}
          </Card>
          <Card className="p-3">
            <PanelHeader phase="admin" icon={<FileSpreadsheet />} title={tx('Document types', 'انواع مدرک')} />
            <ul className="space-y-1 text-xs">{[[tx('Passport', 'پاسپورت'), tx('all breeds', 'همه نژادها')], [tx('Registration certificate', 'گواهی ثبت'), tx('all breeds', 'همه نژادها')], [tx('DNA parentage report', 'گزارش DNA'), tx('optional', 'اختیاری')], [tx('Embryo-transfer consent', 'رضایت انتقال جنین'), tx('where ET allowed', 'در صورت مجاز بودن')]].map(([a, b]) => <li key={a} className="flex justify-between rounded-lg bg-surface-2/60 px-2.5 py-1.5"><b>{a}</b><span className="text-fg-navy-500">{b}</span></li>)}</ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* =============================== Import & API =============================== */
export function AdminImport() {
  const { tx, tr, n, date } = useI18n();
  const { can } = useRole();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState('arabian_studbook_1985-2005.xlsx');
  const [map, setMap] = useState<Record<string, string>>({ Name: 'name', 'Sire name': 'sire', 'Dam name': 'dam', DOB: 'birth', Colour: 'colour', Chip: 'chip', Owner: 'owner' });
  const targets = ['name', 'sire', 'dam', 'birth', 'colour', 'chip', 'owner', 'breed', 'ignore'];
  const samples: Record<string, string> = { Name: 'Shahbaz Ardalan', 'Sire name': 'Gol-e Sorkh', 'Dam name': 'Parisa', DOB: '1998/04/12', Colour: 'Ghermez', Chip: '98102004412', Owner: 'M. Karimi' };
  const steps = [tx('Upload', 'بارگذاری'), tx('Map columns', 'نگاشت ستون‌ها'), tx('Validate', 'اعتبارسنجی'), tx('Review queue', 'صف بازبینی')];
  const total = 6240, ok = 5412, rev = 702, err = 126;
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<FileUp />} title={tx('Legacy data import', 'ورود داده قدیمی')} sub={tx('Studbooks, Excel sheets, STR reports — imported data is never “official” by default', 'تبارنامه، اکسل، گزارش STR — داده واردشده به‌طور پیش‌فرض هرگز «رسمی» نیست')} />
          <ol className="mb-3 flex gap-1 overflow-x-auto">{steps.map((s, i) => <li key={s} className="flex flex-1 items-center gap-2"><button onClick={() => i <= step && setStep(i)} className={cn('flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition', i === step ? 'bg-violet-600 text-white' : i < step ? 'bg-violet-100 text-fg-violet-800' : 'bg-surface-2 text-fg-navy-500')}><span className="grid h-4 w-4 place-items-center rounded-full bg-white/30 text-[10px]">{i < step ? '✓' : n(i + 1)}</span>{s}</button>{i < steps.length - 1 && <span className="h-px flex-1 bg-line" />}</li>)}</ol>
          <div key={step} className="animate-enter">
            {step === 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid place-items-center rounded-2xl border-2 border-dashed border-line bg-surface-2/50 p-6 text-center"><Upload className="h-7 w-7 text-fg-violet-600" /><div className="mt-2 text-sm font-semibold">{tx('Drop a file or choose a sample', 'فایل را رها کنید یا نمونه انتخاب کنید')}</div><div className="text-xs text-fg-navy-500">xlsx · csv · pdf-table</div></div>
                <div className="space-y-1.5">{['arabian_studbook_1985-2005.xlsx', 'turkoman_registry_scans.csv', 'str_reports_lab_A.csv'].map((f) => <button key={f} onClick={() => setFile(f)} className={cn('flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-start text-[13px] transition', file === f ? 'border-violet-400 bg-violet-50' : 'border-line bg-surface-2/50 hover:bg-surface-2')}><FileSpreadsheet className="h-4 w-4 text-fg-violet-600" /><span className="flex-1 truncate font-mono text-xs">{f}</span>{file === f && <Check className="h-4 w-4 text-fg-violet-600" />}</button>)}</div>
              </div>
            )}
            {step === 1 && (
              <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Source column', 'ستون مبدأ')}</th><th className="pb-2 text-start font-semibold">{tx('Sample', 'نمونه')}</th><th className="pb-2 text-start font-semibold">{tx('Maps to', 'نگاشت به')}</th></tr></thead>
                <tbody>{Object.keys(map).map((c) => <tr key={c} className="border-t border-line"><td className="py-1.5 font-mono text-xs font-semibold">{c}</td><td className="text-xs text-fg-navy-600">{samples[c]}</td><td><Select label={c} value={map[c]} onChange={(v) => setMap((m) => ({ ...m, [c]: v }))} className="w-40" options={targets.map((t) => ({ v: t, l: t }))} /></td></tr>)}</tbody></table></div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <div className="flex items-center gap-4"><Donut size={96} label={`${n(Math.round((ok / total) * 100))}%`} parts={[{ v: ok, c: '#61ac89' }, { v: rev, c: '#daa566' }, { v: err, c: '#ca665f' }]} />
                  <ul className="space-y-1 text-sm"><li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><b className="tabular-nums">{n(ok)}</b> {tx('rows passed all rules', 'ردیف بدون مشکل')}</li><li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /><b className="tabular-nums">{n(rev)}</b> {tx('need human review', 'نیازمند بازبینی انسانی')}</li><li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /><b className="tabular-nums">{n(err)}</b> {tx('errors (kept out)', 'خطا (خارج می‌شود)')}</li></ul></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-1.5 text-start font-semibold">{tx('Row', 'ردیف')}</th><th className="pb-1.5 text-start font-semibold">{tx('Field', 'فیلد')}</th><th className="pb-1.5 text-start font-semibold">{tx('Issue', 'مشکل')}</th><th className="pb-1.5 text-start font-semibold">{tx('Value', 'مقدار')}</th></tr></thead>
                  <tbody>{IMPORT_ERRORS.map((e) => <tr key={e.row} className="border-t border-line"><td className="py-1.5 font-mono text-xs">{n(e.row)}</td><td className="font-semibold">{tr(e.field)}</td><td><span className={cn('me-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold', e.sev === 'error' ? 'bg-red-100 text-fg-red-800' : 'bg-amber-100 text-fg-amber-800')}>{e.sev === 'error' ? tx('error', 'خطا') : tx('review', 'بازبینی')}</span>{tr(e.issue)}</td><td className="font-mono text-xs text-fg-navy-600" dir="ltr">{e.value}</td></tr>)}</tbody></table></div>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-2.5"><Notice tone="green" icon={<CircleCheck />} title={tx('Ready to import', 'آماده ورود')}>{tx(`${n(ok)} rows enter the registry as “Self-declared · imported from ${file}” with a quality score. ${n(rev)} go to the review queue. Import does not mean official verification.`, `${n(ok)} ردیف با برچسب «خوداظهاری · واردشده از ${file}» و امتیاز کیفیت وارد ثبت می‌شود. ${n(rev)} مورد به صف بازبینی می‌رود. ورود به معنی تأیید رسمی نیست.`)}</Notice>
                <div className="grid gap-3 sm:grid-cols-3">{[[tx('Source recorded', 'منبع ثبت شد'), file], [tx('Quality score', 'امتیاز کیفیت'), `${n(86.7, 1)} / 100`], [tx('Migration report', 'گزارش مهاجرت'), 'error_report.csv']].map(([a, b]) => <div key={a} className="rounded-xl bg-surface-2/70 p-2.5 text-xs"><div className="font-bold text-fg-navy-500">{a}</div><div className="mt-0.5 truncate font-mono text-[11px]">{b}</div></div>)}</div></div>
            )}
          </div>
          <div className="mt-3 flex justify-between border-t border-line pt-3"><button disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="rounded-xl border border-line px-4 py-2 text-[13px] font-semibold hover:bg-surface-2 disabled:opacity-40">{tx('Back', 'قبلی')}</button><button disabled={!can('import')} onClick={() => setStep((s) => Math.min(3, s + 1))} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40">{step === 3 ? tx('Start import', 'شروع ورود') : tx('Continue', 'ادامه')}<ArrowRight className="h-4 w-4 rtl:rotate-180" /></button></div>
        </Card>
        <Card className="overflow-x-auto p-3">
          <PanelHeader phase="admin" icon={<ScrollText />} title={tx('Import history', 'تاریخچه ورود داده')} />
          <table className="w-full min-w-[560px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('File', 'فایل')}</th><th className="pb-2 text-end font-semibold">{tx('Rows', 'ردیف')}</th><th className="pb-2 text-end font-semibold">OK</th><th className="pb-2 text-end font-semibold">{tx('Review', 'بازبینی')}</th><th className="pb-2 text-end font-semibold">{tx('Errors', 'خطا')}</th><th className="pb-2 text-end font-semibold">{tx('Date', 'تاریخ')}</th></tr></thead>
            <tbody>{JOBS.map((j) => <tr key={j.id} className="border-t border-line"><td className="py-2"><b className="font-mono text-xs">{j.file}</b><div className="text-[11px] text-fg-navy-500">{tr(j.kind)}</div></td><td className="text-end tabular-nums">{n(j.rows)}</td><td className="text-end tabular-nums text-fg-emerald-700">{n(j.ok)}</td><td className="text-end tabular-nums text-fg-amber-700">{n(j.review)}</td><td className="text-end tabular-nums text-fg-red-700">{n(j.err)}</td><td className="text-end text-xs tabular-nums text-fg-navy-500">{date(j.date)}</td></tr>)}</tbody></table>
        </Card>
      </div>
      <div className="min-w-0 space-y-3">
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<KeyRound />} title={tx('API & integrations', 'API و اتصال‌ها')} sub={tx('Documented REST API · sandbox environment', 'REST API مستند · محیط آزمایشی')} />
          <ul className="space-y-1">{ENDPOINTS.map((e) => <li key={e.p} className="flex items-start gap-2 rounded-lg bg-surface-2/60 p-1.5 text-xs"><span className={cn('mt-0.5 w-11 shrink-0 rounded text-center text-[10px] font-bold text-white', e.m === 'GET' ? 'bg-emerald-600' : e.m === 'POST' ? 'bg-sky-600' : 'bg-amber-600')}>{e.m}</span><span className="min-w-0 flex-1 leading-tight"><code className="block truncate font-mono text-[11px] font-semibold" dir="ltr">{e.p}</code><span className="text-[11px] text-fg-navy-500">{tr(e.d)}</span></span><Pill tone="violet">{e.scope}</Pill></li>)}</ul>
          <div className="mt-2.5 flex flex-wrap gap-2"><button className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2"><KeyRound className="h-3.5 w-3.5" />{tx('Create sandbox key', 'ساخت کلید آزمایشی')}</button><button className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2"><ScrollText className="h-3.5 w-3.5" />{tx('Open API docs', 'مستندات API')}</button></div>
        </Card>
        <Card className="p-3">
          <PanelHeader phase="admin" icon={<Download />} title={tx('Data portability', 'قابلیت انتقال داده')} />
          <p className="text-xs leading-relaxed text-fg-navy-600">{tx('Full export (JSON / CSV) and versioned database migrations keep the data free of contractor lock-in.', 'خروجی کامل (JSON / CSV) و مهاجرت‌های نسخه‌بندی‌شده پایگاه داده، داده را از وابستگی به پیمانکار آزاد نگه می‌دارد.')}</p>
          <button className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-700"><Download className="h-3.5 w-3.5" />{tx('Export everything', 'خروجی کامل')}</button>
        </Card>
      </div>
    </div>
  );
}

/* =============================== Audit log =============================== */
export function AdminAudit() {
  const { tx, tr, n } = useI18n();
  const [q, setQ] = useState('');
  const [sens, setSens] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(15);
  const list = AUDIT.filter((a) => (!sens || a.sens) && (!q || tr(a.user).toLowerCase().includes(q.toLowerCase()) || tr(a.action).toLowerCase().includes(q.toLowerCase()) || a.target.toLowerCase().includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(list.length / size));
  return (
    <div className="space-y-2.5">
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[170px] flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={tx('Search user, action or record…', 'جستجوی کاربر، اقدام یا رکورد…')} className={cn(inputCls, 'ps-9')} /></div>
        <Chip phase="admin" active={sens} onClick={() => { setSens((s) => !s); setPage(0); }} icon={<ShieldCheck className="h-3.5 w-3.5" />}>{tx('Sensitive only', 'فقط حساس')}</Chip>
        <button className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold hover:bg-surface-2"><Download className="h-3.5 w-3.5" />{tx('Export', 'خروجی')}</button>
      </div>
      <Card className="overflow-x-auto p-1">
        <table className="w-full min-w-[620px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="px-3 py-2 text-start font-semibold">{tx('Time', 'زمان')}</th><th className="px-2 text-start font-semibold">{tx('User', 'کاربر')}</th><th className="px-2 text-start font-semibold">{tx('Action', 'اقدام')}</th><th className="px-2 text-start font-semibold">{tx('Record', 'رکورد')}</th><th className="hidden px-2 text-start font-semibold md:table-cell">IP</th></tr></thead>
          <tbody>{list.slice(page * size, (page + 1) * size).map((a, i) => <tr key={a.t + i} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-fg-navy-500" dir="ltr">{a.t}</td><td className="px-2 font-semibold">{tr(a.user)}</td><td className="px-2"><span className="flex items-center gap-1.5">{a.sens && <span className="h-2 w-2 rounded-full bg-red-500" title={tx('Sensitive', 'حساس')} />}{tr(a.action)}</span></td><td className="px-2 font-mono text-xs" dir="ltr">{a.target}</td><td className="hidden px-2 font-mono text-[11px] text-navy-400 md:table-cell" dir="ltr">{a.ip}</td></tr>)}</tbody></table>
      </Card>
      <Pager page={page} pages={pages} total={list.length} size={size} sizes={[15, 30, 60]} onPage={setPage} onSize={(s) => { setSize(s); setPage(0); }} phase="admin" />
      <p className="px-1 text-[11px] text-fg-navy-500">{n(list.length)} {tx('entries · every sensitive view, edit, export and rule change is recorded with user, time and reason.', 'مورد · هر مشاهده حساس، ویرایش، خروجی و تغییر قاعده با کاربر، زمان و دلیل ثبت می‌شود.')}</p>
    </div>
  );
}

/* =============================== National reports =============================== */
export function AdminReports() {
  const { tx, tr, n } = useI18n();
  const [rep, setRep] = useState('overview');
  const maxP = PROVINCES[0].horses;
  const maxF = Math.max(...FOALS_YEAR.map((f) => f[1]));
  const maxA = Math.max(...AGE_BUCKETS.map((a) => Math.max(a.m, a.f)));
  const reps: [string, string][] = [['overview', tx('National overview', 'نمای کلی ملی')], ['breeding', tx('Foals & breeding', 'کره‌ها و تولیدمثل')], ['quality', tx('Documents & quality', 'مدارک و کیفیت')], ['diversity', tx('Genetic diversity', 'تنوع ژنتیکی')]];
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="hide-scroll flex gap-1.5 overflow-x-auto">{reps.map(([k, l]) => <Chip key={k} phase="admin" active={rep === k} onClick={() => setRep(k)}>{l}</Chip>)}</div>
        <div className="ms-auto flex gap-1.5"><button className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2"><Download className="h-3.5 w-3.5" />CSV</button><button className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface-2"><Download className="h-3.5 w-3.5" />PDF</button></div>
      </div>
      <div key={rep} className="grid animate-enter gap-3 lg:grid-cols-2">
        {rep === 'overview' && (<>
          <Card className="p-3"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Horses by province', 'اسب‌ها بر اساس استان')} /><div className="space-y-2">{PROVINCES.map((p) => <HBar key={p.n.en} label={tr(p.n)} value={p.horses} max={maxP} color="bg-sky-500" right={n(p.horses)} />)}</div></Card>
          <Card className="p-3"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Breed share', 'سهم نژادها')} /><div className="flex items-center gap-4"><Donut size={120} label={tx('48,230', '۴۸٬۲۳۰')} parts={[{ v: 18400, c: '#5c9fc8' }, { v: 9300, c: '#8b4592' }, { v: 8100, c: '#daa566' }, { v: 7200, c: '#61ac89' }, { v: 5230, c: '#67717f' }]} /><ul className="flex-1 space-y-1.5 text-xs">{[['عرب ایرانی', 'Persian Arabian', 18400, '#5c9fc8'], ['ترکمن', 'Turkoman', 9300, '#8b4592'], ['داراشوری', 'Darashouri', 8100, '#daa566'], ['کُرد', 'Kurdish', 7200, '#61ac89'], ['خزری', 'Caspian', 5230, '#67717f']].map(([fa, en, v, c]) => <li key={en as string} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c as string }} /><span className="flex-1">{tx(en as string, fa as string)}</span><b className="tabular-nums">{n(v as number)}</b></li>)}</ul></div></Card>
          <Card className="p-3 lg:col-span-2"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Age & sex structure', 'ساختار سنی و جنسی')} /><div className="grid grid-cols-5 gap-3">{AGE_BUCKETS.map((a) => <div key={a.l.en} className="text-center"><div className="flex h-28 items-end justify-center gap-1.5"><span className="w-5 origin-bottom rounded-t bg-blue-500" style={{ height: `${(a.m / maxA) * 100}%`, animation: 'grow-y 1s both' }} title={`♂ ${a.m}`} /><span className="w-5 origin-bottom rounded-t bg-rose-500" style={{ height: `${(a.f / maxA) * 100}%`, animation: 'grow-y 1s .1s both' }} title={`♀ ${a.f}`} /></div><div className="mt-1 text-xs font-bold">{tr(a.l)}</div></div>)}</div><div className="mt-2 flex justify-center gap-4 text-[11px]"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />{tx('Stallions / geldings', 'نر / اخته')}</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />{tx('Mares', 'مادیان')}</span></div></Card>
        </>)}
        {rep === 'breeding' && (<>
          <Card className="p-3"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Foal registrations per year', 'ثبت کره در هر سال')} sub={tx('2025: year to date', '۲۰۲۵: تا به امروز')} /><div className="flex h-44 items-end justify-around gap-2">{FOALS_YEAR.map(([y, v], i) => <div key={y} className="flex flex-1 flex-col items-center gap-1"><b className="text-[11px] tabular-nums">{n(v)}</b><span className="w-full max-w-[34px] origin-bottom rounded-t-lg bg-gradient-to-t from-fuchsia-700 to-fuchsia-400" style={{ height: `${(v / maxF) * 100}%`, animation: `grow-y 1s ${i * 80}ms both` }} /><span className="text-[11px] font-semibold text-fg-navy-500">{n(String(y))}</span></div>)}</div></Card>
          <Card className="p-3"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Foals by province (2024)', 'کره‌ها بر اساس استان (۲۰۲۴)')} /><div className="space-y-2">{[...PROVINCES].sort((a, b) => b.foals - a.foals).map((p) => <HBar key={p.n.en} label={tr(p.n)} value={p.foals} max={840} color="bg-fuchsia-500" right={n(p.foals)} />)}</div></Card>
        </>)}
        {rep === 'quality' && (<>
          <Card className="p-3"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Data quality score by province', 'امتیاز کیفیت داده بر اساس استان')} /><div className="space-y-2">{PROVINCES.map((p) => <HBar key={p.n.en} label={tr(p.n)} value={p.quality} max={100} color={p.quality >= 80 ? 'bg-emerald-500' : p.quality >= 70 ? 'bg-amber-500' : 'bg-red-500'} right={`${n(p.quality)}%`} />)}</div></Card>
          <Card className="p-3"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Official verification coverage', 'پوشش تأیید رسمی')} /><div className="space-y-2">{PROVINCES.map((p) => <HBar key={p.n.en} label={tr(p.n)} value={p.official} max={100} color="bg-emerald-500" right={`${n(p.official)}%`} />)}</div></Card>
        </>)}
        {rep === 'diversity' && (
          <Card className="overflow-x-auto p-3 lg:col-span-2"><PanelHeader phase="admin" icon={<BarChart3Icon />} title={tx('Genetic diversity & conservation of native breeds', 'تنوع ژنتیکی و حفاظت از نژادهای بومی')} sub={tx('Only where pedigree/genotype data is sufficient — reviewed by a population geneticist', 'فقط با داده کافی شجره/ژنوتیپ — با بازبینی متخصص ژنتیک جمعیت')} />
            <table className="w-full min-w-[640px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-fg-navy-500"><th className="pb-2 text-start font-semibold">{tx('Breed', 'نژاد')}</th><th className="pb-2 text-end font-semibold">{tx('Eff. pop. (Ne)', 'جمعیت مؤثر (Ne)')}</th><th className="pb-2 text-end font-semibold">{tx('Mean inbreeding', 'میانگین هم‌خونی')}</th><th className="pb-2 text-end font-semibold">{tx('Mean kinship', 'میانگین خویشاوندی')}</th><th className="pb-2 text-end font-semibold">{tx('Trend / yr', 'روند / سال')}</th><th className="pb-2 text-start font-semibold ps-4">{tx('Pedigree coverage', 'پوشش شجره')}</th><th className="pb-2 text-end font-semibold">{tx('Status', 'وضعیت')}</th></tr></thead>
              <tbody>{DIVERSITY.map((d) => <tr key={d.breed.en} className="border-t border-line"><td className="py-2 font-bold">{tr(d.breed)}</td><td className="text-end tabular-nums">{n(d.ne)}</td><td className="text-end tabular-nums">{n(d.f, 1)}%</td><td className="text-end tabular-nums">{n(d.kin, 1)}%</td><td className={cn('text-end tabular-nums font-semibold', d.trend > 0.5 ? 'text-fg-red-600' : d.trend > 0 ? 'text-fg-amber-600' : 'text-fg-emerald-600')}>{d.trend > 0 ? '+' : ''}{n(d.trend, 1)}</td><td className="ps-4"><div className="flex items-center gap-2"><div className="w-24"><Meter value={d.coverage} color="bg-sky-500" /></div><b className="text-xs">{n(d.coverage)}%</b></div></td><td className="text-end"><Pill tone={d.risk === 'critical' ? 'red' : d.risk === 'watch' ? 'amber' : 'green'}>{d.risk === 'critical' ? tx('Critical', 'بحرانی') : d.risk === 'watch' ? tx('Watch', 'تحت نظر') : tx('Stable', 'پایدار')}</Pill></td></tr>)}</tbody></table>
            <Notice tone="amber" icon={<AlertTriangle />} className="mt-3">{tx('Caspian and Kurdish populations are small; rising inbreeding should trigger a conservation breeding plan with expert input.', 'جمعیت خزری و کُرد کوچک است؛ افزایش هم‌خونی باید برنامه پرورش حفاظتی با نظر کارشناس را فعال کند.')}</Notice>
          </Card>
        )}
      </div>
    </div>
  );
}
