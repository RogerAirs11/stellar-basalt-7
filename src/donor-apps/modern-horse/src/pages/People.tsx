import { useEffect, useRef, useState } from 'react';
import { Award, Building2, ChevronRight, Globe, MapPin, Search, ShieldCheck, Users, X } from 'lucide-react';
import { px } from '../data';
import { useI18n } from '../i18n';
import { Avatar, Card, Img, Kpi, PanelHeader, Pill, Select, SexDot, Split, inputCls } from '../components/ui';
import { Page } from '../components/Shell';
import { getNav } from '../nav';
import { go } from '../lib';
import {
  fetchPeople, fetchPersonProfile, fetchDirectoryPersons, fetchDirectoryPerson, usePlatformMeta, useLiveFetch,
  type LivePerson, type LivePersonProfile, type LiveDirectoryPerson, type LiveDirectoryCredential,
} from '../live';
import { cn } from '../utils/cn';

/**
 * R161 DATA PARITY — this page is now served by the same live endpoints the
 * core frontend uses: GET /api/people (registry people + their role counts),
 * GET /api/people/:id (a person's linked horses) and GET /api/directory/persons
 * (the consent-gated professional directory with credential verification
 * states). The demo sample directories of the mockup were retired: real
 * registry data with honest empty states instead.
 */

export function People({ tab, query }: { tab: 'riders' | 'breeders' | 'orgs'; query: URLSearchParams }) {
  const { tx, n } = useI18n();
  const leaves = getNav(tx)[1].leaves;
  const meta = usePlatformMeta();
  const peopleTotal = meta?.people;
  return (
    <Page
      phase="people"
      fill
      title={tab === 'riders' ? tx('People of the registry', 'افراد ثبت') : tab === 'breeders' ? tx('Breeders & studs', 'پرورش‌دهندگان و اصطبل‌ها') : tx('Professional directory', 'مرجع حرفه‌ای‌ها')}
      subtitle={tab === 'orgs'
        ? tx('Consent-gated professionals with verifiable credentials — the same directory the core interface serves.', 'حرفه‌ای‌های دارای رضایت با مدارک قابل راستی‌آزمایی — همان مرجعی که رابط اصلی ارائه می‌دهد.')
        : tx('People of the national registry with their real roles and linked horses.', 'افراد ثبت ملی با نقش‌های واقعی و اسب‌های مرتبط.')}
      tabs={[
        { ...leaves[0], badge: peopleTotal != null ? n(peopleTotal) : undefined },
        { ...leaves[1] },
        { ...leaves[2] },
      ]}
    >
      {tab === 'riders' ? <LivePeople mode="all" sel={query.get('r')} />
        : tab === 'breeders' ? <LivePeople mode="breeders" sel={query.get('b')} />
          : <LiveDirectory sel={query.get('o')} />}
    </Page>
  );
}

/* ---------------- shared toolbar shell ---------------- */
function Bar({ q, setQ, children, count, total, placeholder }: { q: string; setQ: (s: string) => void; children?: React.ReactNode; count: number | null; total: string; placeholder?: string }) {
  const { tx, n } = useI18n();
  return (
    <div className="panel mb-2.5 flex shrink-0 flex-wrap items-center gap-2 p-2">
      <div className="relative min-w-[170px] flex-1">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? tx('Search by name…', 'جستجوی نام…')} className={cn(inputCls, 'ps-9')} />
        {q && <button onClick={() => setQ('')} className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-navy-400 hover:bg-surface-2" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {children}
      <span className="ms-auto text-xs text-fg-navy-500">{count != null ? <><b className="text-sm text-fg-navy-900">{n(count)}</b> · </> : null}{total}</span>
    </div>
  );
}

const ROLE_L: Record<string, [string, string]> = {
  owner: ['Owner', 'مالک'], breeder: ['Breeder', 'پرورش‌دهنده'], importer: ['Importer', 'واردکننده'],
  passport_receiver: ['Passport receiver', 'گیرنده پاسپورت'],
};
const roleLabel = (role: string, tx: (en: string, fa: string) => string) => {
  const hit = ROLE_L[role];
  return hit ? tx(hit[0], hit[1]) : role;
};

/* ---------------- live people (all / breeders) ---------------- */
function LivePeople({ mode, sel }: { mode: 'all' | 'breeders'; sel: string | null }) {
  const { tx, tr, n } = useI18n();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LivePerson[]>([]);
  const [next, setNext] = useState<number|null>(null);
  const [failed,setFailed] = useState(false);
  const [attempt,retry] = useState(0);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const apply = (res: { people: LivePerson[]; nextOffset: number|null } | null, append: boolean) => {
    setFailed(!res);
    if (!res) { setLoading(false); return; }
    let list = res.people;
    if (mode === 'breeders') list = list.filter((p) => p.breederCount > 0);
    setRows((prev) => (append ? [...prev, ...list] : list));
    setNext(res.nextOffset);
    setLoading(false);
  };
  useEffect(() => {
    const id = ++seq.current;
    setRows([]);setNext(null);setFailed(false);setLoading(true);
    const timer = setTimeout(async () => {
      const res = await fetchPeople(q, 60, 0, mode === "breeders");
      if (seq.current !== id) return;
      apply(res, false);
    }, 250);
    return () => { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode,attempt]);
  const loadMore = async () => {
    if(next===null || loading)return;
    const id = ++seq.current;
    setLoading(true);
    const res = await fetchPeople(q, 60, next, mode === "breeders");
    if (seq.current !== id) return;
    apply(res, true);
  };

  const base = mode === 'breeders' ? '/people/breeders' : '/people';
  const countLabel = mode === 'breeders' ? tx('in this page of results', 'در این صفحه از نتایج') : tx('in this page', 'در این صفحه');

  return (
    <div className="flex min-h-0 flex-col lg:flex-1">
      <Bar q={q} setQ={setQ} count={rows.length} total={countLabel} placeholder={tx('Search the people registry…', 'جستجوی ثبت افراد…')}>
        {mode === 'breeders' && <span className="text-xs font-semibold">{tx('Breeders only', 'فقط پرورش‌دهندگان')}</span>}
      </Bar>
      <div className="min-h-0 lg:flex-1">
        <Split
          hasSel={!!sel}
          onBack={() => go(base)}
          list={
            <>
              <ul className="space-y-1">
                {rows.map((p, i) => (
                  <li key={p.id}>
                    <a href={`${base}?r=${p.id}`} aria-current={sel === String(p.id)} className={cn('flex items-center gap-2.5 rounded-xl border p-1.5 transition-all', sel === String(p.id) ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-transparent bg-surface/60 hover:border-line hover:bg-surface')} style={{ animation: `enter .3s ${Math.min(i, 12) * 14}ms both` }}>
                      <Avatar name={p.name.en} size={34} />
                      <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(p.name)}</span><span className="flex flex-wrap items-center gap-x-2 text-[11px] text-fg-navy-500">{p.ownerCount > 0 && <span>{tx('owns', 'مالک')} {n(p.ownerCount)}</span>}{p.breederCount > 0 && <span>{tx('bred', 'پرورش')} {n(p.breederCount)}</span>}{p.importerCount > 0 && <span>{tx('imported', 'وارد کرده')} {n(p.importerCount)}</span>}{p.passportCount > 0 && <span>{tx('passport', 'پاسپورت')} {n(p.passportCount)}</span>}</span></span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-fg-navy-300 rtl:rotate-180" />
                    </a>
                  </li>
                ))}
              </ul>
              {failed && !loading && <p role="alert">{tx("Directory unavailable.","فهرست در دسترس نیست.")} <button onClick={()=>next===null?retry(n=>n+1):void loadMore()}>{tx("Try again","تلاش دوباره")}</button></p>}
              {!failed && !loading && !rows.length && <p className="p-6 text-center text-[13px] text-fg-navy-500">{tx('No people match this search in the registry.', 'در ثبت، فردی با این جستجو یافت نشد.')}</p>}
              {loading && <p className="p-6 text-center text-[13px] text-fg-navy-500">…</p>}
              {next!==null && !failed && !loading && <button onClick={loadMore} className="mt-2 w-full rounded-xl border border-line bg-surface py-2 text-[13px] font-semibold text-fg-indigo-700 transition hover:bg-indigo-50">{tx('Show more', 'نمایش بیشتر')}</button>}
            </>
          }
          detail={sel ? <LivePersonProfileView id={sel} /> : !loading && rows[0] ? <LivePersonProfileView id={String(rows[0].id)} /> : null}
        />
      </div>
    </div>
  );
}

function LivePersonProfileView({ id }: { id: string }) {
  const { tx, tr, n } = useI18n();
  const { data, done } = useLiveFetch(id, k=>fetchPersonProfile(Number(k)));
  if (!done) return <div className="panel grid place-items-center p-8 text-sm text-fg-navy-500">…</div>;
  if (!data) return <div className="panel grid place-items-center p-8 text-center text-sm text-fg-navy-500">{tx('Person not found in the registry.', 'فرد در ثبت یافت نشد.')}</div>;
  const p: LivePersonProfile['person'] = data.person;
  const roles: Array<[number, string]> = [[p.ownerCount, 'owner'], [p.breederCount, 'breeder'], [p.importerCount, 'importer'], [p.passportCount, 'passport_receiver']];
  return (
    <div className="animate-enter space-y-3">
      <div className="panel overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-indigo-600 via-indigo-500 to-fuchsia-500" />
        <div className="flex flex-wrap items-end gap-3 px-3 pb-3">
          <div className="-mt-9 relative"><Avatar name={p.name.en} size={76} className="!ring-4" /></div>
          <div className="min-w-0 flex-1 pt-1"><h2 className="truncate font-display text-xl font-semibold leading-tight">{tr(p.name)}</h2>
            <div className="flex flex-wrap gap-1.5 pt-1">{roles.filter(([c]) => c > 0).map(([c, r]) => <Pill key={r} tone="indigo">{roleLabel(r, tx)} · {n(c)}</Pill>)}</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi phase="people" icon={<Users />} label={tx('Horses owned', 'اسب متعلق')} value={n(p.ownerCount)} />
        <Kpi phase="people" icon={<Award />} label={tx('Horses bred', 'اسب پرورش‌داده')} value={n(p.breederCount)} />
        <Kpi phase="people" icon={<Globe />} label={tx('Imported', 'واردات')} value={n(p.importerCount)} />
        <Kpi phase="people" icon={<ShieldCheck />} label={tx('Passports received', 'پاسپورت دریافتی')} value={n(p.passportCount)} />
      </div>
      <Card className="p-3">
        <PanelHeader phase="registry" icon={<Building2 />} title={tx('Linked horses', 'اسب‌های مرتبط')} sub={data.truncated ? tx('Showing the first records', 'نمایش رکوردهای نخست') : undefined} />
        {data.horses.length ? (
          <ul className="space-y-1">
            {data.horses.map(({ horse, role }) => (
              <li key={horse.id}>
                <a href={`#/horses/${horse.id}`} className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-sky-50">
                  <Img src={px(horse.photo, 80, 80)} alt="" pos={horse.pos} className="h-9 w-9 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(horse.name)}</span><span className="block truncate text-[11px] text-fg-navy-500">{horse.regId ? <span className="font-mono" dir="ltr">{horse.regId}</span> : tr(horse.breed)}</span></span>
                  {role && <Pill tone="indigo">{roleLabel(role, tx)}</Pill>}
                  <SexDot sex={horse.gender} />
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-fg-navy-500">{tx('No linked horses recorded for this person.', 'اسب مرتبطی برای این فرد ثبت نشده است.')}</p>}
      </Card>
    </div>
  );
}

/* ---------------- professional directory (live) ---------------- */

/* The reviewed directory vocabulary (same catalogue the core interface uses). */
const CATEGORIES: [string, string, string][] = [
  ['veterinarian', 'Veterinarian', 'دامپزشک'], ['trainer', 'Riding trainer', 'مربی سوارکاری'], ['club', 'Riding club', 'باشگاه سوارکاری'],
  ['breeder', 'Breeder', 'پرورش‌دهنده'], ['stud', 'Stud service', 'خدمات نریان'], ['rider', 'Rider', 'سوارکار'],
  ['judge', 'Judge', 'داور'], ['steward', 'Steward', 'کلانتر'], ['ringmaster', 'Ringmaster', 'رینگ‌مستر'],
  ['course_designer', 'Course designer', 'طراح مسیر'], ['transport', 'Horse transport', 'اسب‌کش'], ['farrier', 'Farrier', 'نعل‌بند'],
  ['equipment', 'Equipment shop', 'لوازم و تجهیزات'], ['feed', 'Feed supplier', 'خوراک و مکمل'], ['photographer', 'Equine photographer', 'عکاس اسب'],
  ['lab', 'Genetics laboratory', 'آزمایشگاه ژنتیک'], ['rehabilitation', 'Rehabilitation', 'توانبخشی'], ['groom', 'Groom', 'مهتر'],
  ['boarding', 'Boarding stable', 'پانسیون اسب'], ['saddle_fitter', 'Saddle fitter', 'متخصص زین'], ['event_organizer', 'Event organizer', 'برگزارکننده رویداد'],
  ['dc', 'Disciplinary Committee', 'کمیته انضباطی'],
];
const categoryLabel = (id: string, tx: (en: string, fa: string) => string) => {
  const hit = CATEGORIES.find((c) => c[0] === id);
  return hit ? tx(hit[1], hit[2]) : id;
};

function LiveDirectory({ sel }: { sel: string | null }) {
  const { tx, tr } = useI18n();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [rows, setRows] = useState<LiveDirectoryPerson[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const load = async (append: boolean, cursor?: number) => {
    const id = ++seq.current;
    setLoading(true);
    const res = await fetchDirectoryPersons({ category: cat === 'all' ? undefined : cat, name: q, cursor });
    if (seq.current !== id) return;
    const list = res?.persons ?? [];
    setRows((prev) => (append ? [...prev, ...list] : list));
    setNextCursor(res?.nextCursor ?? null);
    setLoading(false);
    setFailed(!res);
  };
  useEffect(() => {
    const timer = setTimeout(() => { void load(false); }, 250);
    return () => { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cat]);

  return (
    <div className="flex min-h-0 flex-col lg:flex-1">
      <Bar q={q} setQ={setQ} count={rows.length} total={tx('listed professionals', 'حرفه‌ای فهرست‌شده')} placeholder={tx('Search professionals…', 'جستجوی حرفه‌ای‌ها…')}>
        <Select label="Category" value={cat} onChange={setCat} className="w-48" options={[{ v: 'all', l: tx('All categories', 'همه دسته‌ها') }, ...CATEGORIES.map((c) => ({ v: c[0], l: tx(c[1], c[2]) }))]} />
      </Bar>
      <div className="min-h-0 lg:flex-1">
        <Split
          hasSel={!!sel}
          onBack={() => go('/people/orgs')}
          list={
            <>
              <ul className="space-y-1">
                {rows.map((p, i) => (
                  <li key={p.personId}>
                    <a href={`#/people/orgs?o=${p.personId}`} aria-current={sel === String(p.personId)} className={cn('flex items-center gap-2.5 rounded-xl border p-1.5 transition-all', sel === String(p.personId) ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-transparent bg-surface/60 hover:border-line hover:bg-surface')} style={{ animation: `enter .3s ${Math.min(i, 12) * 14}ms both` }}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-100 text-fg-indigo-700"><Building2 className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-bold">{tr(p.name)}</span><span className="block truncate text-[11px] text-fg-navy-500">{p.categories.slice(0, 2).map((c) => categoryLabel(c, tx)).join(' · ')}{p.city || p.province ? ` · ${p.city ?? p.province}` : ''}</span></span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-fg-navy-300 rtl:rotate-180" />
                    </a>
                  </li>
                ))}
              </ul>
              {failed && <p className="p-4 text-center text-[13px] text-fg-navy-500">{tx('The directory service is not reachable right now.', 'سرویس مرجع در حال حاضر در دسترس نیست.')}</p>}
              {!loading && !failed && !rows.length && <p className="p-6 text-center text-[13px] text-fg-navy-500">{tx('No professionals published under these filters yet — a listing here requires the person\u2019s own consent.', 'هنوز حرفه‌ای‌ای با این فیلترها منتشر نشده — درج در این فهرست نیازمند رضایت خود شخص است.')}</p>}
              {loading && <p className="p-6 text-center text-[13px] text-fg-navy-500">…</p>}
              {nextCursor != null && !loading && <button onClick={() => void load(true, nextCursor)} className="mt-2 w-full rounded-xl border border-line bg-surface py-2 text-[13px] font-semibold text-fg-indigo-700 transition hover:bg-indigo-50">{tx('Show more', 'نمایش بیشتر')}</button>}
            </>
          }
          detail={sel ? <LiveDirectoryProfile id={sel} /> : rows[0] ? <LiveDirectoryProfile id={String(rows[0].personId)} /> : null}
        />
      </div>
    </div>
  );
}

function LiveDirectoryProfile({ id }: { id: string }) {
  const { tx, tr } = useI18n();
  const { data, done } = useLiveFetch(id, k=>fetchDirectoryPerson(Number(k)));
  if (!done) return <div className="panel grid place-items-center p-8 text-sm text-fg-navy-500">…</div>;
  if (!data) return <div className="panel grid place-items-center p-8 text-center text-sm text-fg-navy-500">{tx('Profile not found.', 'پروفایل یافت نشد.')}</div>;
  const p = data.person;
  return (
    <div className="animate-enter space-y-3">
      <div className="panel overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-indigo-700 via-indigo-500 to-violet-500" />
        <div className="flex flex-wrap items-end gap-3 px-3 pb-3">
          <span className="-mt-8 grid h-[68px] w-[68px] shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg ring-4 ring-surface"><Building2 className="h-8 w-8" /></span>
          <div className="min-w-0 flex-1 pt-1"><h2 className="truncate font-display text-xl font-semibold leading-tight">{tr(p.name)}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-navy-500">{(p.city || p.province) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.city ?? ''}{p.city && p.province ? ' · ' : ''}{p.province ?? ''}{p.provinceNeedsReview ? ` (${tx('needs review', 'نیازمند بازبینی')})` : ''}</span>}{p.languages && <span>{p.languages}</span>}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">{p.categories.map((c) => <Pill key={c} tone="indigo">{categoryLabel(c, tx)}</Pill>)}</div>
        </div>
      </div>
      {p.availability && <Card className="p-3"><PanelHeader phase="people" icon={<Award />} title={tx('Availability', 'زمان دسترسی')} /><p className="text-[13px] text-fg-navy-700">{p.availability}</p></Card>}
      <Card className="p-3">
        <PanelHeader phase="people" icon={<ShieldCheck />} title={tx('Credentials', 'مدارک حرفه‌ای')} sub={tx('Date-window status only — not proof of qualification.', 'فقط وضعیت بازه زمانی — نه اثبات صلاحیت.')} />
        {data.credentials.length ? (
          <div className="divide-y divide-line">
            {data.credentials.map((c, i) => <CredentialRow key={i} c={c} />)}
          </div>
        ) : <p className="text-[13px] text-fg-navy-500">{tx('No credentials recorded for this profile.', 'مدارکی برای این پروفایل ثبت نشده است.')}</p>}
      </Card>
      <Card className="p-3">
        <PanelHeader phase="people" icon={<Globe />} title={tx('Contact', 'تماس')} />
        <p className="text-[13px] leading-snug text-fg-navy-700">{p.contactNote || tx('Contact runs through the platform\u2019s mediated service requests — the public record never carries private contact details.', 'تماس از طریق درخواست‌های خدمات واسط پلتفرم انجام می‌شود — رکورد عمومی هرگز اطلاعات تماس خصوصی را در بر نمی‌گیرد.')}</p>
        <p className="mt-2 text-[11px] text-fg-navy-500">{tx('Service-request messaging lives on the core interface (/services).', 'پیام‌رسانی درخواست خدمات در رابط اصلی است (/services).')}</p>
      </Card>
    </div>
  );
}

function CredentialRow({ c }: { c: LiveDirectoryCredential }) {
  const { tx, date } = useI18n();
  const state = c.verificationState || c.verificationLevel;
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold', c.isActive ? 'bg-emerald-100 text-fg-emerald-700' : 'bg-surface-2 text-fg-navy-500')}>✓</span>
      <span className="min-w-0 flex-1 leading-tight"><b className="block text-[13px] font-semibold">{c.role ? roleLabel(c.role, tx) : tx('Credential', 'مدرک')} — {c.issuerName}</b><span className="block text-[11px] text-fg-navy-500">{c.identifier}{c.issuedAt ? ` · ${date(c.issuedAt, 'short')}` : ''}{c.expiresAt ? ` → ${date(c.expiresAt, 'short')}` : ''}</span></span>
      {state && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-fg-navy-600">{state}</span>}
    </div>
  );
}
