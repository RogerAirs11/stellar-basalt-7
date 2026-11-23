#!/usr/bin/env python3
"""R155 — bug fixes + honest live-record gating + Welcome redesign for the donor app.
Reads CLEAN content from git blobs (worktree is untrustworthy in this sandbox),
applies exact replacements, writes files. Run then build IMMEDIATELY."""
import subprocess, sys

REPO = '/home/z/my-project'

def blob(path):
    return subprocess.run(['git', '-C', REPO, 'cat-file', '-p', f'HEAD:{path}'],
                          capture_output=True, text=True, check=True).stdout

def apply(path, edits, index_edits=()):
    s = blob(path)
    for old, new in edits:
        if s.count(old) != 1:
            print(f'FAIL [{path}]: match count {s.count(old)} for: {old[:90]!r}')
            sys.exit(1)
        s = s.replace(old, new)
    for start_marker, end_marker, new_block in index_edits:
        i = s.find(start_marker)
        j = s.find(end_marker, i + len(start_marker))
        if i < 0 or j < 0:
            print(f'FAIL [{path}]: index markers not found')
            sys.exit(1)
        s = s[:i] + new_block + s[j:]
    with open(f'{REPO}/{path}', 'w') as f:
        f.write(s)
    print(f'OK {path} ({len(s)} bytes)')

# ============ 1. data.ts — localize photos ============
apply('src/donor-apps/modern-horse/src/data.ts', [
    ("""export const px = (id: number, w = 800, h = 600) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;""",
     """/* LIVE WIRING (owner): the donor's photos now live in /f/modern-horse/img/ so
 * the static-asset CSP (img-src 'self') keeps working with zero external hosts.
 * The donor's crop sizes are honoured by CSS object-cover as before. */
export const px = (id: number, _w = 800, _h = 600) =>
  `/f/modern-horse/img/${id}.jpg`;"""),
])

# ============ 2. records.ts — null-safe date math ============
apply('src/donor-apps/modern-horse/src/records.ts', [
    ("""export const addDays = (iso: string, d: number) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
export const TODAY = '2025-04-15';""",
     """export const TODAY = '2025-04-15';
/* LIVE WIRING: date helpers are null-safe — real registry records carry no
 * veterinary dates, and an invalid date must never throw mid-render. */
export const dateAt = (iso: string) => { const d = new Date((iso || TODAY) + 'T12:00:00'); return isNaN(d.getTime()) ? new Date(TODAY + 'T12:00:00') : d; };
export const addDays = (iso: string, d: number) => { const t = new Date((iso || TODAY) + 'T12:00:00Z'); if (isNaN(t.getTime())) return addDays(TODAY, d); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };"""),
])

# ============ 3. i18n.tsx — honest date formatting ============
apply('src/donor-apps/modern-horse/src/i18n.tsx', [
    ("""      date: (iso, style = 'short') => {
        const d = new Date(iso + 'T12:00:00');
        const locale""",
     """      date: (iso, style = 'short') => {
        if (!iso) return '—';
        const d = new Date(iso + 'T12:00:00');
        if (isNaN(d.getTime())) return '—';
        const locale"""),
])

# ============ 4. SportPage.tsx — lastVet guard ============
apply('src/donor-apps/modern-horse/src/pages/SportPage.tsx', [
    ("const days = Math.round((new Date(ev.date).getTime() - new Date(h.lastVet + 'T12:00:00').getTime()) / 86400000);",
     "const days = Math.round((new Date(ev.date).getTime() - new Date((h.lastVet || '2025-04-15') + 'T12:00:00').getTime()) / 86400000);"),
])

# ============ 5. HorseTabs.tsx — crash guard + export Empty + live helper ============
apply('src/donor-apps/modern-horse/src/pages/HorseTabs.tsx', [
    ("const base = new Date(horse.lastVet + 'T12:00:00');",
     "const base = new Date((horse.lastVet || '2025-04-15') + 'T12:00:00'); // guarded: live records have no lastVet"),
    ("const Empty = ({ icon, title, sub, children }",
     "export const Empty = ({ icon, title, sub, children }"),
    ("const Toast = ({ msg }",
     "/** LIVE WIRING: real registry ids are numeric; the donor's demo ids are slugs. */\nexport const isLiveRecord = (id: string) => /^[0-9]+$/.test(id);\nconst Toast = ({ msg }"),
])

# ============ 6. HorseDetail.tsx — gate demo tabs + honest Overview ============
apply('src/donor-apps/modern-horse/src/pages/HorseDetail.tsx', [
    ("import { CompetitionsTab, DocumentsTab, GeneticsTab, HealthTab, HistoryTab, OffspringTab } from './HorseTabs';",
     "import { CompetitionsTab, DocumentsTab, Empty, GeneticsTab, HealthTab, HistoryTab, OffspringTab, isLiveRecord } from './HorseTabs';"),
    ("""        : tab === 'offspring' ? <OffspringTab horse={horse} />
          : tab === 'health' ? <HealthTab horse={horse} />
            : tab === 'genetics' ? <GeneticsTab horse={horse} />
              : tab === 'competitions' ? <CompetitionsTab horse={horse} />
                : tab === 'documents' ? <DocumentsTab horse={horse} />
                  : tab === 'history' ? <HistoryTab horse={horse} />""",
     """        : tab === 'offspring' ? (isLiveRecord(horse.id) ? <Empty icon={<Baby />} title={tx('No offspring on record yet', 'هنوز نتاجی ثبت نشده است')} sub={tx('Offspring recorded in the national registry will appear here.', 'نتاج ثبت‌شده در ثبت ملی اینجا نمایش داده می‌شود.')} /> : <OffspringTab horse={horse} />)
          : tab === 'health' ? (isLiveRecord(horse.id) ? <Empty icon={<Stethoscope />} title={tx('No veterinary history on file', 'سابقه دامپزشکی ثبت نشده است')} sub={tx('Health entries appear here once the owner or a licensed vet records them. Nothing is invented.', 'سابقه سلامت پس از ثبت توسط مالک یا دامپزشک دارای مجوز اینجا نمایش داده می‌شود؛ چیزی جعل نمی‌شود.')} /> : <HealthTab horse={horse} />)
            : tab === 'genetics' ? (isLiveRecord(horse.id) ? <Empty icon={<Dna />} title={tx('No genetic tests on record', 'آزمایش ژنتیکی ثبت نشده است')} sub={tx('DNA or genotype results will appear here when a valid test is linked to this record.', 'نتایج DNA یا ژنوتیپ پس از اتصال آزمایش معتبر به این رکورد نمایش داده می‌شود.')} /> : <GeneticsTab horse={horse} />)
              : tab === 'competitions' ? (isLiveRecord(horse.id) ? <Empty icon={<Trophy />} title={tx('No competition records linked yet', 'هنوز رکورد مسابقه‌ای متصل نشده است')} sub={tx('Race and sport results will be linked to this horse by the registry.', 'نتایج مسابقه و ورزش توسط ثبت ملی به این اسب متصل خواهد شد.')} /> : <CompetitionsTab horse={horse} />)
                : tab === 'documents' ? (isLiveRecord(horse.id) ? <Empty icon={<FileText />} title={tx('No documents linked yet', 'هنوز مدرکی متصل نشده است')} sub={tx('Passport and registration documents will appear here once verified.', 'پاسپورت و اسناد ثبت پس از تأیید اینجا نمایش داده می‌شوند.')} /> : <DocumentsTab horse={horse} />)
                  : tab === 'history' ? (isLiveRecord(horse.id) ? <Empty icon={<CalendarDays />} title={tx('No history entries yet', 'هنوز سابقه‌ای ثبت نشده است')} sub={tx('Every future change to this record will be logged here.', 'هر تغییر آینده این رکورد اینجا ثبت خواهد شد.')} /> : <HistoryTab horse={horse} />)"""),
    ("""  const results = resultsOf(horse);
  const ids = idsOf(horse);""",
     """  /* LIVE WIRING: a real registry record shows only what the platform truly
   * holds. Hash-derived sample facts (markings, identifiers, sport results,
   * provenance) stay demo-only so nothing is invented about a live animal. */
  const live = /^[0-9]+$/.test(horse.id);
  const results = live ? [] : resultsOf(horse);
  const ids = live ? null : idsOf(horse);"""),
    ("""  const prov = useMemo(() => provenanceOf(horse), [horse]);
  const kids = useMemo(() => offspringOf(horse), [horse]);
  const docs = useMemo(() => documentsOf(horse), [horse]);""",
     """  const provAll = useMemo(() => provenanceOf(horse), [horse]);
  const kidsAll = useMemo(() => offspringOf(horse), [horse]);
  const docsAll = useMemo(() => documentsOf(horse), [horse]);
  const prov = live ? [] : provAll;
  const kids = live ? [] : kidsAll;
  const docs = live ? [] : docsAll;"""),
    ("""      [<Sparkles key="e" />, tx('Markings', 'علائم'), tr(markingsOf(horse))],
      [<Ruler key="f" />, tx('Height', 'قد'), `${n(horse.height)} ${tx('cm', 'سانتی‌متر')}`],""",
     """      ...(live ? [] : [[<Sparkles key="e" />, tx('Markings', 'علائم'), tr(markingsOf(horse))]] as Row[]),
      ...(live ? [] : [[<Ruler key="f" />, tx('Height', 'قد'), `${n(horse.height)} ${tx('cm', 'سانتی‌متر')}`]] as Row[]),"""),
    ("""      [<Trophy key="g" />, tx('Discipline', 'رشته'), pill(DISC[horse.discipline], tr(DISCIPLINE_L[horse.discipline]))],""",
     """      ...(live ? [] : [[<Trophy key="g" />, tx('Discipline', 'رشته'), pill(DISC[horse.discipline], tr(DISCIPLINE_L[horse.discipline]))]] as Row[]),"""),
    ("""  const idRows: [string, string][] = [[tx('Microchip', 'میکروچیپ'), ids.chip], [tx('Passport', 'پاسپورت'), ids.passport], [tx('Studbook', 'تبارنامه'), ids.studbook], ['UELN', ids.ueln], ...(ids.fei ? ([['FEI', ids.fei]] as [string, string][]) : [])];""",
     """  const idRows: [string, string][] = live
    ? [[tx('Registration No.', 'شماره ثبت'), horse.regId || horse.id]]
    : [[tx('Microchip', 'میکروچیپ'), ids!.chip], [tx('Passport', 'پاسپورت'), ids!.passport], [tx('Studbook', 'تبارنامه'), ids!.studbook], ['UELN', ids!.ueln], ...(ids!.fei ? ([['FEI', ids!.fei]] as [string, string][]) : [])];"""),
    ("""<p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-fg-navy-500"><BookOpen className="mt-0.5 h-3 w-3 shrink-0" />{tr(ids.book)}</p>""",
     """{!live && <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-fg-navy-500"><BookOpen className="mt-0.5 h-3 w-3 shrink-0" />{tr(ids!.book)}</p>}"""),
    ("""    { to: 'health', tile: 'bg-sky-100 text-fg-sky-700', icon: <Stethoscope />, label: tx('Health', 'سلامت'), body: access.allowed
      ? <span className="text-fg-navy-700">{horse.carrier ? <b className="text-fg-red-800">{tx(`Carrier: ${horse.carrier.join(', ')}`, `ناقل: ${horse.carrier.join('، ')}`)}</b> : tx('Vaccinations up to date', 'واکسن به‌روز')} · {date(horse.lastVet)}</span>
      : <span className="text-fg-navy-700">{horse.verified.passport ? tx('Documents reviewed', 'مدارک بررسی شد') : tx('Not reviewed', 'بررسی نشده')} <VisPill vis="private" /></span> },""",
     """    { to: 'health', tile: 'bg-sky-100 text-fg-sky-700', icon: <Stethoscope />, label: tx('Health', 'سلامت'), body: live
      ? <span className="text-fg-navy-500">{tx('No health entries yet', 'هنوز سابقه سلامتی ثبت نشده')}</span>
      : access.allowed
        ? <span className="text-fg-navy-700">{horse.carrier ? <b className="text-fg-red-800">{tx(`Carrier: ${horse.carrier.join(', ')}`, `ناقل: ${horse.carrier.join('، ')}`)}</b> : tx('Vaccinations up to date', 'واکسن به‌روز')} · {date(horse.lastVet)}</span>
        : <span className="text-fg-navy-700">{horse.verified.passport ? tx('Documents reviewed', 'مدارک بررسی شد') : tx('Not reviewed', 'بررسی نشده')} <VisPill vis="private" /></span> },"""),
    ("""    { to: 'documents', tile: 'bg-sky-100 text-fg-sky-700', icon: <FileText />, label: tx('Documents', 'مدارک'), body: <span className="text-fg-navy-700"><b>{n(docsHave)}</b> / {n(docs.length)} {tx('on file', 'موجود')}</span> },""",
     """    { to: 'documents', tile: 'bg-sky-100 text-fg-sky-700', icon: <FileText />, label: tx('Documents', 'مدارک'), body: live ? <span className="text-fg-navy-500">{tx('Not linked yet', 'هنوز متصل نشده')}</span> : <span className="text-fg-navy-700"><b>{n(docsHave)}</b> / {n(docs.length)} {tx('on file', 'موجود')}</span> },"""),
])

print('ALL CORE EDITS APPLIED')
