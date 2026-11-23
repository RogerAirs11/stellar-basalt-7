import React, { useEffect, useRef, useState } from "react";
import { ClipboardList, FileCheck2, FlaskConical, HeartPulse, History, LockKeyhole, Plus, RefreshCw } from "lucide-react";
import type { CareCapabilities, CareCustodyRecord, CareHistory, CareList, CareReceipt, CareRecord, CareStored, ClinicalEventInput, ReproductiveEpisodeInput, SampleInput, LabReportInput, PlatformClient, PlatformPermission, PlatformUser } from "../../contracts/platform";
import { usePrincipalScope } from "../../frontend-kit/domain/principalScope";
import { useI18n } from "../i18n";
import { ClinicalEditor, CustodyEditor, ReportEditor, ReportReviewEditor, ReproductionEditor, SampleEditor } from "./care/CareEditors";
import { careLabel, useCareText } from "./care/CareControls";
import "../styles/heritage.care.css";

type Resource = "clinical" | "reproduction" | "samples" | "reports";
type Stored = CareStored<ClinicalEventInput> | CareStored<ReproductiveEpisodeInput> | CareStored<SampleInput> | CareStored<LabReportInput>;
type RecordRow = CareRecord<Stored>;
type Editor = { action: "create" } | { action: "amend" | "custody" | "review"; record: RecordRow };
interface PanelProps { platform: PlatformClient; horseId: number; horseName: string; user: PlatformUser | null; permissions: PlatformPermission[]; navigate: (path: string) => void }
const TABS = [
  { id: "clinical", en: "Clinical", fa: "درمانی", icon: HeartPulse },
  { id: "reproduction", en: "Reproduction", fa: "تولیدمثل", icon: ClipboardList },
  { id: "samples", en: "Samples & custody", fa: "نمونه و نگهداری", icon: FlaskConical },
  { id: "reports", en: "Laboratory reports", fa: "گزارش آزمایشگاه", icon: FileCheck2 },
] as const;

/** Principal and horse changes remount every private snapshot before it can paint. */
export function HorseCarePanel(props: PanelProps) {
  const scope = usePrincipalScope(props.user, props.permissions);
  return <HorseCareScope key={`${props.horseId}:${scope}`} {...props} />;
}

function HorseCareScope({ platform, horseId, horseName, user, navigate }: PanelProps) {
  const L = useCareText(); const [capabilities, setCapabilities] = useState<CareCapabilities | null>(null); const [failed, setFailed] = useState(""); const [attempt, setAttempt] = useState(0); const [tab, setTab] = useState<Resource>("clinical"); const [editing, setEditing] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setCapabilities(null); setFailed("");
    if (!user) return () => controller.abort();
    platform.care.capabilities(horseId, { signal: controller.signal }).then(value => { if (controller.signal.aborted) return; if (value.horse_id !== horseId) throw new Error(L("The service returned access for a different horse. Refresh access before continuing.", "سرویس دسترسی اسب دیگری را برگرداند. پیش از ادامه دسترسی را تازه کنید.")); setCapabilities(value); }).catch(cause => { if (!controller.signal.aborted) setFailed(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [platform, horseId, user?.id, attempt]);
  return <section className="care-workspace" data-h-surface-role="panel" aria-label={L("Private care workspace", "فضای مراقبت خصوصی")}>
    <header className="care-header"><div className="care-title-icon"><LockKeyhole size={24} /></div><div><span className="care-eyebrow">{L("PRIVATE HORSE RECORDS", "سوابق خصوصی اسب")}</span><h2>{L("Care & laboratory evidence", "مراقبت و شواهد آزمایشگاهی")}</h2><p>{L("Clinical history, reproductive episodes, sample custody and reviewed laboratory reports.", "تاریخچه درمانی، دوره‌های تولیدمثل، زنجیره نگهداری نمونه و گزارش‌های بررسی‌شده آزمایشگاه.")}</p></div>{user && <button type="button" className="care-refresh" disabled={editing} onClick={() => setAttempt(value => value + 1)} aria-label={L("Refresh care access", "تازه‌سازی دسترسی مراقبت")}><RefreshCw size={17} /><span>{L("Refresh access", "تازه‌سازی دسترسی")}</span></button>}</header>
    {!user ? <div className="care-empty"><LockKeyhole size={28} /><h3>{L("Sign in to check your authorized access", "برای بررسی دسترسی مجاز وارد شوید")}</h3><p>{L("Private care records are restricted to current horse-scoped institutional permissions.", "سوابق مراقبت خصوصی به مجوز معتبر مؤسسه برای همین اسب محدود است.")}</p><button className="care-primary" onClick={() => navigate("/login")}>{L("Sign in", "ورود")}</button></div>
      : failed ? <div className="care-notice care-notice-error" role="alert"><strong>{L("Care access could not be checked", "دسترسی مراقبت بررسی نشد")}</strong><p>{L("No private records have been loaded. This error does not mean the horse has no records.", "هیچ سابقه خصوصی بارگذاری نشده است. این خطا به معنی نبود سابقه برای اسب نیست.")}</p><p dir="auto">{failed}</p></div>
      : !capabilities ? <p role="status" className="care-loading">{L("Checking care configuration and your permissions…", "در حال بررسی پیکربندی مراقبت و مجوز شما…")}</p>
      : !capabilities.enabled ? <div className="care-empty"><LockKeyhole size={28} /><h3>{L("Private care is not enabled for this institution", "مراقبت خصوصی برای این مؤسسه فعال نشده است")}</h3><p>{L("An administrator must configure the institutional workflow, professional permissions and evidence review responsibilities before these records can be used.", "مدیر باید پیش از استفاده، گردش‌کار مؤسسه، مجوزهای حرفه‌ای و مسئولیت بررسی شواهد را پیکربندی کند.")}</p><Limitations capabilities={capabilities} /></div>
      : <>
        <div className="care-context"><span className={`care-mode care-mode-${capabilities.mode}`}>{capabilities.mode === "local_review" ? L("Local review environment", "محیط بررسی محلی") : L("Configured institutional service", "سرویس پیکربندی‌شده مؤسسه")}</span><p>{L("These records remain private. Internal review does not establish official laboratory or registry certification.", "این سوابق خصوصی می‌مانند. بررسی داخلی، گواهی رسمی آزمایشگاه یا سامانه ثبت ایجاد نمی‌کند.")}</p></div>
        <Limitations capabilities={capabilities} />
        {!capabilities.permissions.length ? <div className="care-empty"><h3>{L("No current care permission for this horse", "برای این اسب مجوز فعلی مراقبت ندارید")}</h3><p>{L("Ask the institution responsible for this horse to grant the specific professional access you need.", "از مؤسسه مسئول این اسب بخواهید دسترسی حرفه‌ای موردنیاز را مشخص و اعطا کند.")}</p></div> : <>
          <nav className="care-tabs" aria-label={L("Private care sections", "بخش‌های مراقبت خصوصی")}>{TABS.map(({ id, en, fa, icon: Icon }) => <button key={id} type="button" className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} disabled={editing && tab !== id} onClick={() => setTab(id)}><Icon size={17} /><span>{L(en, fa)}</span></button>)}</nav>
          <CareResource key={`${tab}:${attempt}`} resource={tab} platform={platform} horseId={horseId} horseName={horseName} capabilities={capabilities} user={user} onEditing={setEditing} />
        </>}
      </>}
  </section>;
}
function Limitations({ capabilities }: { capabilities: CareCapabilities }) {
  const L = useCareText();
  return capabilities.limitations.length ? <details className="care-limitations"><summary>{L("Institutional scope and limitations", "دامنه و محدودیت‌های مؤسسه")}</summary><ul>{capabilities.limitations.map((item, index) => <li key={index} dir="auto">{item}</li>)}</ul></details> : null;
}

function CareResource({ resource, platform, horseId, horseName, capabilities, user, onEditing }: { resource: Resource; platform: PlatformClient; horseId: number; horseName: string; capabilities: CareCapabilities; user: PlatformUser; onEditing: (value: boolean) => void }) {
  const L = useCareText(); const { n } = useI18n(); const [rows, setRows] = useState<RecordRow[]>([]); const [offset, setOffset] = useState(0); const [next, setNext] = useState<number | null>(null); const [reload, setReload] = useState(0); const [loading, setLoading] = useState(false); const [failed, setFailed] = useState(""); const [editor, setEditor] = useState<Editor | null>(null); const [receipt, setReceipt] = useState<CareReceipt | null>(null);
  const canRead = capabilities.permissions.includes("private_health_read"); const canWrite = capabilities.permissions.includes(resource === "clinical" || resource === "reproduction" ? "clinical_write" : "sample_submit"); const canReview = capabilities.permissions.includes("evidence_review"); const loadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++loadGeneration.current; const controller = new AbortController();
    if (!canRead) { setRows([]); setNext(null); return () => controller.abort(); }
    setLoading(true); setFailed(""); if (!offset) setRows([]);
    const request: Promise<CareList<Stored>> = platform.care[resource].list(horseId, { offset }, { signal: controller.signal });
    request.then(value => {
      if (controller.signal.aborted || loadGeneration.current !== generation) return;
      const safe = value.records.filter(row => row.horse_id === horseId);
      setRows(previous => offset ? [...previous, ...safe.filter(row => !previous.some(item => item.id === row.id))] : safe); setNext(value.next_offset);
    }).catch(cause => { if (!controller.signal.aborted && loadGeneration.current === generation) { setRows([]); setNext(null); setFailed(cause instanceof Error ? cause.message : String(cause)); } }).finally(() => { if (!controller.signal.aborted && loadGeneration.current === generation) setLoading(false); });
    return () => controller.abort();
  }, [resource, platform, horseId, canRead, offset, reload]);
  const refresh = () => { setOffset(0); setReload(value => value + 1); };
  const open = (value: Editor | null) => { setEditor(value); onEditing(Boolean(value)); };
  const saved = (value: CareReceipt) => { setReceipt(value); open(null); refresh(); };
  const cancel = () => { open(null); refresh(); };
  const shared = { platform, horseId, onSaved: saved, onCancel: cancel };
  const titles: Record<Resource, [string, string]> = { clinical: ["Clinical records", "سوابق درمانی"], reproduction: ["Reproductive episodes", "دوره‌های تولیدمثل"], samples: ["Collected samples", "نمونه‌های جمع‌آوری‌شده"], reports: ["Laboratory evidence", "شواهد آزمایشگاهی"] };
  return <div className="care-resource">
    {receipt && <div className="care-notice care-receipt" role="status"><strong>{L("Saved. The service returned a receipt.", "ذخیره شد. رسید از سرویس دریافت شد.")}</strong><p>{L("Record ID", "شناسه رکورد")}: <code dir="ltr">{receipt.id}</code> · {L("version", "نسخه")} {n(receipt.version)}</p>{!canRead && <p>{L("Your permission allows this submission, but does not allow reading the private record list. Keep the receipt ID for the responsible reviewer.", "مجوز شما اجازه ثبت می‌دهد اما اجازه مشاهده فهرست خصوصی را نمی‌دهد. شناسه رسید را برای مسئول بررسی نگه دارید.")}</p>}<button type="button" className="care-text-button" onClick={() => setReceipt(null)}>{L("Dismiss receipt", "بستن رسید")}</button></div>}
    {editor ? <>
      {resource === "clinical" && <ClinicalEditor {...shared} record={editor.action === "amend" ? editor.record as CareRecord<CareStored<ClinicalEventInput>> : undefined} />}
      {resource === "reproduction" && <ReproductionEditor {...shared} horseName={horseName} record={editor.action === "amend" ? editor.record as CareRecord<CareStored<ReproductiveEpisodeInput>> : undefined} />}
      {resource === "samples" && (editor.action === "custody" ? <CustodyEditor {...shared} sample={editor.record as CareRecord<CareStored<SampleInput>>} /> : <SampleEditor {...shared} />)}
      {resource === "reports" && (editor.action === "review" ? <ReportReviewEditor {...shared} report={editor.record as CareRecord<CareStored<LabReportInput>>} capabilities={capabilities} user={user} /> : <ReportEditor {...shared} capabilities={capabilities} />)}
    </> : <>
      <header className="care-resource-heading"><div><h3>{L(...titles[resource])}</h3><p>{resource === "reports" ? L("Source files, explicit panel versions and separate review decisions.", "فایل منبع، نسخه مشخص پنل و تصمیم‌های مستقل بررسی.") : resource === "reproduction" ? L("The profile horse is the genetic dam. Recipient dams and every foal are recorded separately.", "اسب این پروفایل، مادر ژنتیکی است. مادر گیرنده و هر کره جدا ثبت می‌شوند.") : resource === "samples" ? L("Document collection, identity checks and each handover.", "جمع‌آوری، بررسی هویت و هر تحویل را مستند کنید.") : L("Dated observations and amendments with retained history.", "مشاهدات تاریخ‌دار و اصلاحات همراه با تاریخچه حفظ‌شده.")}</p></div><div className="care-actions">{canRead && <button type="button" disabled={loading} onClick={refresh}><RefreshCw size={15} />{L("Refresh records", "تازه‌سازی سوابق")}</button>}{canWrite && <button type="button" className="care-primary" onClick={() => open({ action: "create" })}><Plus size={16} />{L("New record", "رکورد جدید")}</button>}</div></header>
      {!canRead ? <div className="care-notice"><LockKeyhole size={18} /><p>{L("You do not have permission to read private care records for this horse. Submission controls appear only for the writing permissions you hold.", "مجوز مشاهده سوابق خصوصی این اسب را ندارید. کنترل ثبت فقط برای مجوزهای ثبت شما نمایش داده می‌شود.")}</p></div>
        : failed ? <div role="alert" className="care-notice care-notice-error"><strong>{L("Records could not be loaded", "سوابق بارگذاری نشدند")}</strong><p>{L("This is not evidence that the record list is empty. Your access may have changed.", "این پیام به معنی خالی بودن فهرست نیست. ممکن است دسترسی شما تغییر کرده باشد.")}</p><p dir="auto">{failed}</p><button type="button" onClick={refresh}>{L("Try again", "تلاش دوباره")}</button></div>
        : <>{rows.length ? <ul className="care-record-list">{rows.map(row => <li key={row.id}><article className="care-record"><header><div><strong dir="auto">{recordTitle(resource, row, L)}</strong><small>{recordDate(resource, row) || L("Observation date not recorded", "تاریخ مشاهده ثبت نشده")} · {L("version", "نسخه")} {n(row.version)}</small></div><span className={`care-state care-state-${row.review_state ?? row.status ?? "recorded"}`}>{row.review_state ? careLabel(row.review_state, L) : row.status === "voided" ? L("Voided; history retained", "باطل؛ تاریخچه محفوظ") : L("Private record", "رکورد خصوصی")}</span></header><RecordDetails resource={resource} record={row} platform={platform} canOpenFile={capabilities.permissions.includes("private_file_export") || row.created_by_user_id === user.id} />
          <div className="care-record-actions">{(resource === "reproduction" || resource === "clinical" && row.status !== "voided") && canWrite && <button type="button" onClick={() => open({ action: "amend", record: row })}>{L("Amend with reason", "اصلاح با ذکر دلیل")}</button>}{resource === "samples" && canWrite && <button type="button" onClick={() => open({ action: "custody", record: row })}>{L("Add custody event", "افزودن رویداد نگهداری")}</button>}{resource === "reports" && canReview && ["pending", "accepted"].includes(row.review_state ?? "") && <button type="button" onClick={() => open({ action: "review", record: row })}>{row.created_by_user_id === user.id || row.review_state === "accepted" ? L("Withdraw report", "پس‌گرفتن گزارش") : L("Review evidence", "بررسی شواهد")}</button>}</div>
          <CareHistoryView resource={resource} recordId={row.id} platform={platform} horseId={horseId} />{resource === "samples" && <CustodyHistory platform={platform} horseId={horseId} sampleId={row.id} />}
        </article></li>)}</ul> : !loading && <div className="care-empty care-empty-compact"><ClipboardList size={27} /><h4>{L("No accessible records returned", "رکورد قابل دسترسی برگردانده نشد")}</h4><p>{L("This view includes only records your current permission allows you to read.", "این نما فقط شامل رکوردهایی است که مجوز فعلی اجازه مشاهده آن‌ها را می‌دهد.")}</p></div>}{loading && <p role="status" className="care-loading">{L("Loading private records…", "در حال بارگذاری سوابق خصوصی…")}</p>}{next !== null && !loading && <button className="care-load-more" type="button" onClick={() => setOffset(next)}>{L("Load more records", "سوابق بیشتر")}</button>}</>}
    </>}
  </div>;
}

function recordTitle(resource: Resource, record: RecordRow, L: (en: string, fa: string) => string) {
  if (resource === "clinical") return (record.body as CareStored<ClinicalEventInput>).title;
  if (resource === "reproduction") { const body = record.body as CareStored<ReproductiveEpisodeInput>; return `${careLabel(body.method, L)} · ${careLabel(body.outcome, L)}`; }
  if (resource === "samples") return (record.body as CareStored<SampleInput>).sample_ref;
  const body = record.body as CareStored<LabReportInput>; return `${body.laboratory_ref} · ${body.accession_ref}`;
}
function recordDate(resource: Resource, record: RecordRow): string | null | undefined {
  if (resource === "clinical") return (record.body as CareStored<ClinicalEventInput>).occurred_on;
  if (resource === "reproduction") { const body = record.body as CareStored<ReproductiveEpisodeInput>; return body.outcome_on || body.transfer_on || body.covering_on; }
  if (resource === "samples") return (record.body as CareStored<SampleInput>).collected_on;
  return (record.body as CareStored<LabReportInput>).issued_on;
}
function RecordDetails({ resource, record, platform, canOpenFile }: { resource: Resource; record: RecordRow; platform: PlatformClient; canOpenFile: boolean }) {
  const L = useCareText(); const { n } = useI18n(); const facts: Array<[string, React.ReactNode]> = [];
  if (resource === "clinical") { const b = record.body as CareStored<ClinicalEventInput>; facts.push([L("Event", "رویداد"), careLabel(b.event_type, L)], [L("Findings", "یافته‌ها"), b.findings], [L("Product", "محصول"), b.product_name], [L("Batch", "سری ساخت"), b.batch_ref], [L("Next due", "موعد بعدی"), b.next_due_on], [L("Source", "منبع"), b.source_ref]); }
  if (resource === "clinical") { const context = (record.body as CareStored<ClinicalEventInput>).lifecycle_context; if (context) facts.push([L("Attributed lifecycle context", "زمینه حیات منتسب به متخصص"), <><strong>{context.kind === "postmortem" ? L("Postmortem examination / procedure", "معاینه / اقدام پس از مرگ") : L("Review of existing records", "بررسی سوابق موجود")}</strong><p dir="auto">{context.evidence_ref}</p><p dir="auto">{context.justification}</p><small>{L("Source statement; not verification.", "اظهار مستند؛ به معنی تأیید نیست.")}</small></>]); }
  if (resource === "reproduction") { const b = record.body as CareStored<ReproductiveEpisodeInput>; facts.push([L("Genetic dam", "مادر ژنتیکی"), `#${n(record.horse_id)}`], [L("Sire", "پدر"), b.sire_id ? `#${n(b.sire_id)}` : null], [L("Recipient dam", "مادر گیرنده"), b.recipient_dam_id ? `#${n(b.recipient_dam_id)}` : null], [L("Cover / insemination", "جفت‌گیری / تلقیح"), b.covering_on], [L("Transfer", "انتقال"), b.transfer_on], [L("Observed outcome", "نتیجه مشاهده‌شده"), b.outcome_on], [L("Source", "منبع"), b.source_ref], [L("Notes", "یادداشت"), b.notes]); if (b.offspring.length) facts.push([L("Foals", "کره‌ها"), <ul>{b.offspring.map((foal, index) => <li key={index}>{foal.foal_horse_id ? `#${n(foal.foal_horse_id)}` : L("Unlinked foal", "کره بدون پیوند")} · {foal.outcome === "live" ? L("Live", "زنده") : foal.outcome === "stillborn" ? L("Stillborn", "مرده‌زایی") : L("Died after birth", "تلف پس از تولد")}{foal.notes && <p dir="auto">{foal.notes}</p>}</li>)}</ul>]); }
  if (resource === "samples") { const b = record.body as CareStored<SampleInput>; facts.push([L("Specimen", "نمونه"), careLabel(b.specimen, L)], [L("Identity check", "بررسی هویت"), careLabel(b.identity_check, L)], [L("Identity evidence", "شواهد هویت"), b.identity_evidence_ref], [L("Observed microchip", "ریزتراشه مشاهده‌شده"), b.observed_microchip], [L("Source", "منبع"), b.source_ref], [L("Notes", "یادداشت"), b.notes]); }
  if (resource === "reproduction") { const material = (record.body as CareStored<ReproductiveEpisodeInput>).stored_material; if (material?.length) facts.push([L("Documented stored material", "ماده ذخیره‌شده مستند"), <ul>{material.map(row => <li key={`${row.donor_horse_id}:${row.material}`}><strong>{row.material === "semen" ? L("Semen", "اسپرم") : row.material === "embryo" ? L("Embryo", "جنین") : L("Oocyte", "اووسیت")} · {L("Donor", "اهداکننده")} #{n(row.donor_horse_id)}</strong><p>{L("Collection date", "تاریخ جمع‌آوری")}: {row.collected_on ?? L("Unknown", "نامعلوم")}</p><p dir="auto">{row.evidence_ref}</p><p dir="auto">{row.justification}</p><small>{L("Professional source statement; not certification.", "اظهار مستند متخصص؛ به معنی صدور گواهی نیست.")}</small></li>)}</ul>]); }
  if (resource === "reports") { const b = record.body as CareStored<LabReportInput>; facts.push([L("Sample ID", "شناسه نمونه"), b.sample_id], [L("Panel", "پنل"), careLabel(b.result.kind, L)], [L("Panel version", "نسخه پنل"), b.panel_version], [L("Method", "روش"), b.method], [L("Revision", "ویرایش"), b.report_revision ?? "original"], [L("Corrects report", "گزارش مورد اصلاح"), b.supersedes_report_id], [L("Stored document SHA-256", "SHA-256 مدرک ذخیره‌شده"), <code dir="ltr">{b.evidence_sha256}</code>]);
    if (b.result.kind === "base_color") facts.push([L("Recorded genotypes", "ژنوتیپ‌های ثبت‌شده"), `MC1R: ${b.result.calls.MC1R} · ASIP: ${b.result.calls.ASIP}`]);
    if (b.result.kind === "other") facts.push([L("Reported result", "نتیجه گزارش‌شده"), b.result.result_text]);
    if (b.result.kind === "disease") facts.push([L("Reported calls", "نتایج گزارش‌شده"), <ul>{b.result.calls.map((call, index) => <li key={index} dir="auto">{call.variant} · {call.assay} · {call.result}</li>)}</ul>]);
    if (b.result.kind === "str_parentage") { facts.push([L("Nomenclature", "نام‌گذاری"), b.result.nomenclature], [L("STR calls", "نتایج STR"), <ul>{b.result.calls.map(call => <li key={call.marker} dir="ltr">{call.marker}: {call.alleles.join(" / ")} · {call.quality}</li>)}</ul>]); }
  }
  return <details className="care-record-details"><summary>{L("View record details", "مشاهده جزئیات سابقه")}</summary><dl><div><dt>{L("Record ID", "شناسه رکورد")}</dt><dd dir="ltr">{record.id}</dd></div>{facts.filter(([, value]) => value !== null && value !== undefined && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>{record.body.evidence_media_id && (canOpenFile ? <a href={platform.modules.media.fileUrl(record.body.evidence_media_id)} target="_blank" rel="noopener noreferrer">{L("Open private evidence file", "باز کردن فایل شواهد خصوصی")} ↗</a> : <p>{L("An evidence file is linked. Opening it requires a separate private-file permission.", "فایل شواهد پیوند خورده است. باز کردن آن به مجوز جداگانه فایل خصوصی نیاز دارد.")}</p>)}</details>;
}

function CareHistoryView({ resource, recordId, platform, horseId }: { resource: Resource; recordId: string; platform: PlatformClient; horseId: number }) {
  const L = useCareText(); const { n } = useI18n(); const [open, setOpen] = useState(false); const [data, setData] = useState<CareHistory | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { if (!open) return; const controller = new AbortController(); setData(null); setFailed(false); platform.care[resource].history(horseId, recordId, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }); return () => controller.abort(); }, [resource, recordId, platform, horseId, open]);
  return <section className="care-history"><button type="button" className="care-text-button" aria-expanded={open} onClick={() => setOpen(value => !value)}><History size={15} />{open ? L("Hide amendment history", "پنهان کردن تاریخچه اصلاح") : L("View amendment history", "مشاهده تاریخچه اصلاح")}</button>{open && (failed ? <p role="alert">{L("History could not be loaded. Close and reopen to retry.", "تاریخچه بارگذاری نشد. برای تلاش دوباره آن را ببندید و باز کنید.")}</p> : !data ? <p role="status">{L("Loading history…", "در حال بارگذاری تاریخچه…")}</p> : <><ol>{data.history.map(entry => <li key={`${entry.version}:${entry.action}`}><strong>{L("Version", "نسخه")} {n(entry.version)} · {entry.action}</strong><time>{entry.created_at}</time><p dir="auto">{entry.reason}</p><small>{L("Actor", "عامل")}: {entry.actor_user_id}</small></li>)}</ol>{data.truncated && <p>{L("This history view reached its service limit; older versions are not shown.", "این نما به سقف سرویس رسیده است؛ نسخه‌های قدیمی‌تر نمایش داده نمی‌شوند.")}</p>}</>)}</section>;
}
function CustodyHistory({ platform, horseId, sampleId }: { platform: PlatformClient; horseId: number; sampleId: string }) {
  const L = useCareText(); const [open, setOpen] = useState(false); const [data, setData] = useState<{ events: CareCustodyRecord[]; truncated: boolean } | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { if (!open) return; const controller = new AbortController(); setData(null); setFailed(false); platform.care.samples.custody(horseId, sampleId, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }); return () => controller.abort(); }, [platform, horseId, sampleId, open]);
  return <section className="care-history"><button type="button" className="care-text-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? L("Hide custody chain", "پنهان کردن زنجیره نگهداری") : L("View custody chain", "مشاهده زنجیره نگهداری")}</button>{open && (failed ? <p role="alert">{L("Custody history could not be loaded.", "تاریخچه نگهداری بارگذاری نشد.")}</p> : !data ? <p role="status">{L("Loading custody…", "در حال بارگذاری نگهداری…")}</p> : <>{data.events.length ? <ol>{data.events.map(event => <li key={event.id}><strong>{careLabel(event.event_type, L)} · <span dir="auto">{event.custodian_ref}</span></strong><time>{event.occurred_at}</time><p dir="auto">{event.body.source_ref}</p>{event.body.notes && <p dir="auto">{event.body.notes}</p>}</li>)}</ol> : <p>{L("No custody events returned.", "رویداد نگهداری برگردانده نشد.")}</p>}{data.truncated && <p>{L("Older custody events are outside this service page.", "رویدادهای قدیمی‌تر خارج از این صفحه سرویس هستند.")}</p>}</>)}</section>;
}
