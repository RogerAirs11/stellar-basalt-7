import React, { useEffect, useState } from "react";
import type {
  CareCapabilities, CareReceipt, CareRecord, CareStored, ClinicalEventInput, ClinicalAmendInput,
  ReproductiveEpisodeInput, ReproductiveAmendInput, ReproductiveOffspring, SampleInput, CustodyInput,
  LabReportInput, LabReportReviewInput, LabCalls, PlatformClient, PlatformUser,
} from "../../../contracts/platform";
import { useI18n } from "../../i18n";
import { CARE_OPTIONS, CareCommandForm, CareDate, CareDocumentUpload, CareField, CareHorsePicker, CareSelect, careLabel, idValue, nullableValue, textValue, useCareText, type CareAttachment } from "./CareControls";
import { ClinicalContextFields, clinicalContextInput, StoredMaterialFields, storedMaterialInput, type ClinicalContextKind, type StoredMaterialDraft } from "./CareLifecycleFields";

interface EditorProps { platform: PlatformClient; horseId: number; onSaved: (receipt: CareReceipt) => void; onCancel: () => void }
const sourceProps = { name: "source_ref", required: true, minLength: 3, maxLength: 240 } as const;
function SourceField({ value }: { value?: string }) { const L = useCareText(); return <CareField {...sourceProps} value={value} label={L("Source / clinician or institutional reference", "منبع / مرجع دامپزشک یا مؤسسه")} hint={L("Record an identifiable source, not a verification claim.", "مرجع قابل شناسایی را ثبت کنید؛ ثبت منبع به معنی تأیید نیست.")} />; }

export function ClinicalEditor({ platform, horseId, record, onSaved, onCancel }: EditorProps & { record?: CareRecord<CareStored<ClinicalEventInput>> }) {
  const L = useCareText(); const body = record?.body; const [attachment, setAttachment] = useState<CareAttachment | null>(null); const [uploading, setUploading] = useState(false);
  const [eventType, setEventType] = useState<ClinicalEventInput["event_type"]>(body?.event_type ?? "examination");
  const [contextKind, setContextKind] = useState<ClinicalContextKind>(body?.lifecycle_context?.kind ?? "ordinary");
  return <CareCommandForm<ClinicalEventInput | ClinicalAmendInput> title={record ? L("Amend clinical record", "اصلاح سابقه درمانی") : L("New clinical record", "سابقه درمانی جدید")} onSaved={onSaved} onCancel={onCancel} externallyBusy={uploading}
    build={data => ({ event_type: eventType, title: textValue(data, "title"), occurred_on: nullableValue(data, "occurred_on"), findings: textValue(data, "findings"), source_ref: textValue(data, "source_ref"), product_name: nullableValue(data, "product_name"), batch_ref: nullableValue(data, "batch_ref"), next_due_on: nullableValue(data, "next_due_on"), evidence_media_id: attachment?.id ?? body?.evidence_media_id ?? null, lifecycle_context: clinicalContextInput(data, eventType, contextKind, L), ...(record ? { expected_version: record.version, status: textValue(data, "status") as ClinicalAmendInput["status"] } : {}) })}
    execute={(input, signal) => record ? platform.care.clinical.amend(horseId, record.id, input as ClinicalAmendInput, { signal }) : platform.care.clinical.create(horseId, input, { signal })}>
    <CareSelect name="event_type" label={L("Event type", "نوع رویداد")} value={eventType} onChange={value => setEventType(value as typeof eventType)} options={CARE_OPTIONS.clinical} />
    <CareField name="title" label={L("Record title", "عنوان سابقه")} value={body?.title} required minLength={3} />
    <CareDate name="occurred_on" label={L("Observed event date", "تاریخ مشاهده رویداد")} value={body?.occurred_on} />
    <SourceField value={body?.source_ref} />
    <CareField name="findings" label={L("Findings / intervention as recorded", "یافته‌ها / اقدام ثبت‌شده")} value={body?.findings} required multiline maxLength={12000} />
    <CareField name="product_name" label={L("Medicine / vaccine product", "نام دارو / واکسن")} value={body?.product_name} />
    <CareField name="batch_ref" label={L("Batch / lot reference", "شماره سری ساخت")} value={body?.batch_ref} minLength={3} />
    <CareDate name="next_due_on" label={L("Next scheduled date", "تاریخ برنامه‌ریزی‌شده بعدی")} value={body?.next_due_on} future />
    <ClinicalContextFields event={eventType} kind={contextKind} onChange={setContextKind} initial={body?.lifecycle_context} />
    {record && <CareSelect name="status" label={L("Record status", "وضعیت سابقه")} defaultValue={record.status ?? "recorded"} options={[["recorded", "Recorded", "ثبت‌شده"], ["voided", "Void with reason (history retained)", "باطل با ذکر دلیل (حفظ تاریخچه)"]]} />}
    <CareDocumentUpload platform={platform} horseId={horseId} initialId={body?.evidence_media_id} onChange={setAttachment} onBusyChange={setUploading} />
  </CareCommandForm>;
}

export function ReproductionEditor({ platform, horseId, horseName, record, onSaved, onCancel }: EditorProps & { horseName: string; record?: CareRecord<CareStored<ReproductiveEpisodeInput>> }) {
  const L = useCareText(); const { n } = useI18n(); const body = record?.body;
  const [method, setMethod] = useState<ReproductiveEpisodeInput["method"]>(body?.method ?? "unknown"); const [outcome, setOutcome] = useState<ReproductiveEpisodeInput["outcome"]>(body?.outcome ?? "planned");
  const [sire, setSire] = useState<number | null>(body?.sire_id ?? null); const [recipient, setRecipient] = useState<number | null>(body?.recipient_dam_id ?? null);
  const [offspring, setOffspring] = useState<Array<ReproductiveOffspring & { key: string }>>(() => (body?.offspring ?? []).map(row => ({ ...row, key: crypto.randomUUID() })));
  const [storedMaterial, setStoredMaterial] = useState<StoredMaterialDraft[]>(() => (body?.stored_material ?? []).map(row => ({ ...row, key: crypto.randomUUID() })));
  const [attachment, setAttachment] = useState<CareAttachment | null>(null); const [uploading, setUploading] = useState(false);
  const transfer = method === "embryo_transfer" || method === "icsi";
  const changeOffspring = (key: string, patch: Partial<ReproductiveOffspring>) => setOffspring(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
  return <CareCommandForm<ReproductiveEpisodeInput | ReproductiveAmendInput> title={record ? L("Amend reproductive episode", "اصلاح دوره تولیدمثل") : L("New reproductive episode", "دوره تولیدمثل جدید")} onSaved={onSaved} onCancel={onCancel} externallyBusy={uploading}
    build={data => {
      const children = outcome === "foaled" ? offspring.map(({ key, ...row }) => ({ ...row, notes: nullableValue(data, `offspring-notes-${key}`) })) : [];
      if (outcome === "foaled" && (!textValue(data, "outcome_on") || !children.length)) throw new Error(L("Foaling requires its observed date and at least one foal outcome.", "برای زایمان، تاریخ مشاهده و دست‌کم یک نتیجه کره لازم است."));
      return { sire_id: sire, recipient_dam_id: transfer ? recipient : null, method, covering_on: nullableValue(data, "covering_on"), transfer_on: transfer ? nullableValue(data, "transfer_on") : null, outcome_on: nullableValue(data, "outcome_on"), outcome, offspring: children, source_ref: textValue(data, "source_ref"), notes: nullableValue(data, "notes"), evidence_media_id: attachment?.id ?? body?.evidence_media_id ?? null, stored_material: storedMaterialInput(data, storedMaterial, horseId, sire, transfer ? recipient : null, method, L), ...(record ? { expected_version: record.version } : {}) };
    }} execute={(input, signal) => record ? platform.care.reproduction.amend(horseId, record.id, input as ReproductiveAmendInput, { signal }) : platform.care.reproduction.create(horseId, input, { signal })}>
    <p className="care-notice care-field-wide">{L("Genetic dam for this episode", "مادر ژنتیکی این دوره")}: <strong dir="auto">{horseName}</strong> (#{n(horseId)}). {L("Recording an episode does not change registered parentage.", "ثبت این دوره، تبار رسمی ثبت‌شده را تغییر نمی‌دهد.")}</p>
    <CareSelect name="method" label={L("Reproductive method", "روش تولیدمثل")} value={method} onChange={value => setMethod(value as typeof method)} options={CARE_OPTIONS.method} />
    <CareSelect name="outcome" label={L("Current observed outcome", "نتیجه مشاهده‌شده فعلی")} value={outcome} onChange={value => setOutcome(value as typeof outcome)} options={CARE_OPTIONS.outcome} />
    <CareHorsePicker platform={platform} name="sire_id" label={L("Genetic sire (if known)", "پدر ژنتیکی (اگر مشخص است)")} value={sire} onChange={setSire} excludeId={horseId} />
    {transfer && <CareHorsePicker platform={platform} name="recipient_dam_id" label={L("Recipient dam, distinct from genetic dam", "مادر گیرنده، جدا از مادر ژنتیکی")} value={recipient} onChange={setRecipient} excludeId={horseId} />}
    {transfer && <p className="care-field-wide care-help">{L("You need a current clinical writing grant for both the genetic dam and the recipient. An amendment also checks the previously recorded recipient.", "برای مادر ژنتیکی و مادر گیرنده، مجوز معتبر ثبت بالینی لازم است. در اصلاح، مجوز مادر گیرنده قبلی نیز بررسی می‌شود.")}</p>}
    <CareDate name="covering_on" label={L("Covering / insemination date", "تاریخ جفت‌گیری / تلقیح")} value={body?.covering_on} />
    {transfer && <CareDate name="transfer_on" label={L("Embryo transfer date", "تاریخ انتقال جنین")} value={body?.transfer_on} />}
    <CareDate name="outcome_on" label={L("Observed outcome date", "تاریخ مشاهده نتیجه")} value={body?.outcome_on} required={outcome === "foaled"} />
    <SourceField value={body?.source_ref} />
    {outcome === "foaled" && <section className="care-field-wide care-repeatable"><header><h4>{L("Foals in this episode", "کره‌های این دوره")}</h4><span>{n(offspring.length)} / {n(8)}</span></header><p>{L("Record every foal separately, including twins. Linking an existing horse is optional.", "هر کره از جمله دوقلوها را جدا ثبت کنید. پیوند به اسب ثبت‌شده اختیاری است.")}</p>{offspring.map((row, index) => <fieldset key={row.key} className="care-repeat-row"><legend>{L("Foal", "کره")} {n(index + 1)}</legend><div className="care-form-grid"><CareHorsePicker platform={platform} name={`offspring-id-${row.key}`} label={L("Registered foal (if available)", "کره ثبت‌شده (در صورت وجود)")} value={row.foal_horse_id ?? null} onChange={id => changeOffspring(row.key, { foal_horse_id: id })} excludeId={horseId} /><CareSelect name={`offspring-outcome-${row.key}`} label={L("Foal outcome", "نتیجه کره")} value={row.outcome} onChange={value => changeOffspring(row.key, { outcome: value as ReproductiveOffspring["outcome"] })} options={[["live", "Live", "زنده"], ["stillborn", "Stillborn", "مرده‌زایی"], ["died_after_birth", "Died after birth", "تلف پس از تولد"]]} /><CareSelect name={`offspring-sex-${row.key}`} label={L("Sex at birth", "جنسیت هنگام تولد")} value={row.sex_at_birth ?? "unknown"} onChange={value => changeOffspring(row.key, { sex_at_birth: value as ReproductiveOffspring["sex_at_birth"] })} options={[["unknown", "Unknown", "نامشخص"], ["male", "Male", "نر"], ["female", "Female", "ماده"]]} /><CareField name={`offspring-notes-${row.key}`} label={L("Foal notes", "یادداشت کره")} value={row.notes} maxLength={6000} /></div><button type="button" className="care-text-button" onClick={() => setOffspring(rows => rows.filter(item => item.key !== row.key))}>{L("Remove this unsaved foal entry", "حذف این ورودی ذخیره‌نشده کره")}</button></fieldset>)}<button type="button" disabled={offspring.length >= 8} onClick={() => setOffspring(rows => [...rows, { key: crypto.randomUUID(), outcome: "live", sex_at_birth: "unknown", foal_horse_id: null }])}>{L("Add foal outcome", "افزودن نتیجه کره")}</button></section>}
    <CareField name="notes" label={L("Episode notes", "یادداشت دوره")} value={body?.notes} multiline maxLength={6000} />
    <StoredMaterialFields rows={storedMaterial} onChange={setStoredMaterial} horseId={horseId} sireId={sire} />
    <CareDocumentUpload platform={platform} horseId={horseId} initialId={body?.evidence_media_id} onChange={setAttachment} onBusyChange={setUploading} />
  </CareCommandForm>;
}

export function SampleEditor({ platform, horseId, onSaved, onCancel }: EditorProps) {
  const L = useCareText(); const [identity, setIdentity] = useState<SampleInput["identity_check"]>("not_checked"); const [attachment, setAttachment] = useState<CareAttachment | null>(null); const [uploading, setUploading] = useState(false);
  return <CareCommandForm<SampleInput> title={L("Register collected sample", "ثبت نمونه جمع‌آوری‌شده")} onSaved={onSaved} onCancel={onCancel} externallyBusy={uploading}
    build={data => ({ sample_ref: textValue(data, "sample_ref"), specimen: textValue(data, "specimen") as SampleInput["specimen"], collected_on: nullableValue(data, "collected_on"), identity_check: identity, observed_microchip: nullableValue(data, "observed_microchip"), identity_evidence_ref: textValue(data, "identity_evidence_ref"), source_ref: textValue(data, "source_ref"), notes: nullableValue(data, "notes"), evidence_media_id: attachment?.id ?? null })}
    execute={(input, signal) => platform.care.samples.create(horseId, input, { signal })}>
    <CareField name="sample_ref" label={L("Sample reference / label", "شماره / برچسب نمونه")} required minLength={3} />
    <CareSelect name="specimen" label={L("Specimen", "نوع نمونه")} options={CARE_OPTIONS.specimen} />
    <CareDate name="collected_on" label={L("Collection date", "تاریخ جمع‌آوری")} />
    <CareSelect name="identity_check" label={L("Documented identity check", "بررسی هویت مستند")} value={identity} onChange={value => setIdentity(value as typeof identity)} options={CARE_OPTIONS.identity} />
    <CareField name="observed_microchip" label={L("Observed microchip", "ریزتراشه مشاهده‌شده")} maxLength={80} required={identity === "microchip_matched"} />
    <CareField name="identity_evidence_ref" label={L("Identity check evidence / explanation", "مرجع / توضیح بررسی هویت")} required minLength={3} hint={L("If not checked, state this clearly. Unchecked samples cannot support accepted laboratory evidence.", "اگر بررسی انجام نشده، صریح بنویسید. نمونه بدون بررسی هویت نمی‌تواند مبنای شواهد آزمایشگاهی پذیرفته‌شده باشد.")} />
    <SourceField />
    <CareField name="notes" label={L("Collection and handling notes", "یادداشت جمع‌آوری و نگهداری")} multiline maxLength={6000} />
    <CareDocumentUpload platform={platform} horseId={horseId} onChange={setAttachment} onBusyChange={setUploading} />
  </CareCommandForm>;
}

export function CustodyEditor({ platform, horseId, sample, onSaved, onCancel }: EditorProps & { sample: CareRecord<CareStored<SampleInput>> }) {
  const L = useCareText();
  return <CareCommandForm<CustodyInput> title={L("Add sample custody event", "افزودن رویداد زنجیره نگهداری نمونه")} onSaved={onSaved} onCancel={onCancel}
    build={data => ({ event_type: textValue(data, "event_type") as CustodyInput["event_type"], occurred_at: textValue(data, "occurred_at"), custodian_ref: textValue(data, "custodian_ref"), source_ref: textValue(data, "source_ref"), notes: nullableValue(data, "notes") })}
    execute={(input, signal) => platform.care.samples.addCustody(horseId, sample.id, input, { signal })}>
    <p className="care-field-wide care-notice"><strong dir="auto">{sample.body.sample_ref}</strong> · {L("Every event is retained; use a correction event for a mistake.", "همه رویدادها حفظ می‌شوند؛ برای اشتباه، رویداد اصلاح ثبت کنید.")}</p>
    <CareSelect name="event_type" label={L("Custody event", "رویداد نگهداری")} options={CARE_OPTIONS.custody} />
    <CareField name="occurred_at" label={L("Observed timestamp with time zone", "زمان مشاهده با منطقه زمانی")} required placeholder="2026-10-28T09:30:00+03:30" dir="ltr" hint={L("Include Z for UTC or an explicit offset such as +03:30. No time zone is inferred.", "برای UTC حرف Z یا اختلاف زمانی مثل ‎+03:30 بنویسید. منطقه زمانی حدس زده نمی‌شود.")} />
    <CareField name="custodian_ref" label={L("Custodian / receiving institution", "تحویل‌گیرنده / مؤسسه نگهدارنده")} required minLength={3} />
    <SourceField /><CareField name="notes" label={L("Custody notes", "یادداشت نگهداری")} multiline maxLength={6000} />
  </CareCommandForm>;
}

function SampleChoice({ platform, horseId, canRead }: { platform: PlatformClient; horseId: number; canRead: boolean }) {
  const L = useCareText(); const [rows, setRows] = useState<Array<CareRecord<CareStored<SampleInput>>>>([]); const [error, setError] = useState(false); const [next, setNext] = useState<number | null>(null); const [offset, setOffset] = useState(0); const [busy, setBusy] = useState(false); const [manual, setManual] = useState(!canRead);
  useEffect(() => { if (!canRead) return; const controller = new AbortController(); setBusy(true); setError(false); platform.care.samples.list(horseId, { offset }, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setRows(previous => offset ? [...previous, ...value.records.filter(row => !previous.some(item => item.id === row.id))] : value.records); setNext(value.next_offset); } }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setBusy(false); }); return () => controller.abort(); }, [platform, horseId, canRead, offset]);
  return <div className="care-field-wide care-sample-choice">{manual ? <CareField name="sample_id" label={L("Sample receipt ID", "شناسه رسید نمونه")} required dir="ltr" hint={L("Use a sample created for this same horse. A write grant does not grant permission to browse samples.", "شناسه نمونه همین اسب را وارد کنید. مجوز ثبت، به معنی مجوز مشاهده فهرست نمونه‌ها نیست.")} /> : <label className="care-field"><span>{L("Collected sample", "نمونه جمع‌آوری‌شده")}</span><select name="sample_id" required defaultValue=""><option value="">{busy ? L("Loading samples…", "در حال بارگذاری نمونه‌ها…") : L("Choose a sample", "انتخاب نمونه")}</option>{rows.map(row => <option key={row.id} value={row.id}>{row.body.sample_ref} · {careLabel(row.body.specimen, L)} · {careLabel(row.body.identity_check, L)}</option>)}</select></label>}{error && <p role="alert">{L("Samples could not be loaded. An error is not an empty sample list.", "نمونه‌ها بارگذاری نشدند. خطا به معنی خالی‌بودن فهرست نیست.")}</p>}{!manual && next !== null && <button type="button" disabled={busy} onClick={() => setOffset(next)}>{L("Load more samples", "نمونه‌های بیشتر")}</button>}{canRead && <button className="care-text-button" type="button" onClick={() => setManual(value => !value)}>{manual ? L("Choose from sample list", "انتخاب از فهرست نمونه‌ها") : L("Enter a known sample receipt ID", "ورود شناسه رسید نمونه معلوم")}</button>}</div>;
}

export function ReportEditor({ platform, horseId, capabilities, onSaved, onCancel }: EditorProps & { capabilities: CareCapabilities }) {
  const L = useCareText(); const { n } = useI18n(); const [kind, setKind] = useState<LabCalls["kind"]>("other"); const [rows, setRows] = useState([0]); const [nextRow, setNextRow] = useState(1);
  const [attachment, setAttachment] = useState<CareAttachment | null>(null); const [uploading, setUploading] = useState(false);
  return <CareCommandForm<LabReportInput> title={L("Submit laboratory report for review", "ارسال گزارش آزمایشگاه برای بررسی")} onSaved={onSaved} onCancel={onCancel} externallyBusy={uploading}
    build={data => {
      if (!attachment) throw new Error(L("Upload the private report document and wait for its stored checksum before saving.", "مدرک گزارش را خصوصی بارگذاری کنید و پیش از ذخیره منتظر هش نسخه ذخیره‌شده بمانید."));
      let result: LabCalls;
      if (kind === "base_color") result = { kind, calls: { MC1R: textValue(data, "MC1R") as "E/E" | "E/e" | "e/e", ASIP: textValue(data, "ASIP") as "A/A" | "A/a" | "a/a" } };
      else if (kind === "str_parentage") result = { kind, nomenclature: textValue(data, "nomenclature"), calls: rows.map(row => ({ marker: textValue(data, `marker-${row}`), alleles: [textValue(data, `allele-a-${row}`), textValue(data, `allele-b-${row}`)], quality: textValue(data, `quality-${row}`) as "pass" | "uncertain" | "failed" })) };
      else if (kind === "disease") result = { kind, calls: rows.map(row => ({ variant: textValue(data, `variant-${row}`), assay: textValue(data, `assay-${row}`), result: textValue(data, `result-${row}`) })) };
      else result = { kind, result_text: textValue(data, "result_text") };
      return { sample_id: textValue(data, "sample_id"), laboratory_ref: textValue(data, "laboratory_ref"), accession_ref: textValue(data, "accession_ref"), report_revision: textValue(data, "report_revision"), issued_on: textValue(data, "issued_on"), panel_version: textValue(data, "panel_version"), method: textValue(data, "method"), evidence_media_id: attachment.id, evidence_sha256: attachment.sha256, result, supersedes_report_id: nullableValue(data, "supersedes_report_id") };
    }} execute={(input, signal) => platform.care.reports.create(horseId, input, { signal })}>
    <p className="care-notice care-field-wide">{L("Transcribe the laboratory's report exactly, including uncertain or failed calls. A separate authorized reviewer must assess it. This workflow does not confer laboratory accreditation or official registry certification.", "گزارش آزمایشگاه را دقیقاً با موارد نامطمئن یا ناموفق وارد کنید. بررسی باید به دست شخص مجاز دیگری انجام شود. این گردش‌کار اعتباربخشی آزمایشگاه یا گواهی رسمی ثبت ایجاد نمی‌کند.")}</p>
    <SampleChoice platform={platform} horseId={horseId} canRead={capabilities.permissions.includes("private_health_read")} />
    <CareField name="laboratory_ref" label={L("Laboratory name / reference", "نام / مرجع آزمایشگاه")} required minLength={3} />
    <CareField name="accession_ref" label={L("Laboratory accession number", "شماره پذیرش آزمایشگاه")} required minLength={3} />
    <CareDate name="issued_on" label={L("Report issue date", "تاریخ صدور گزارش")} required />
    <CareField name="report_revision" label={L("Report revision", "ویرایش گزارش")} required value="original" maxLength={80} hint={L("Use the laboratory's revision identifier for a correction.", "برای اصلاح، شناسه ویرایش آزمایشگاه را وارد کنید.")} />
    <CareField name="panel_version" label={L("Assay / panel version", "نسخه آزمون / پنل")} required minLength={3} />
    <CareField name="method" label={L("Laboratory method", "روش آزمایشگاه")} required minLength={3} />
    <CareField name="supersedes_report_id" label={L("Prior report ID being corrected", "شناسه گزارش قبلی مورد اصلاح")} dir="ltr" hint={L("Creating a correction does not withdraw the prior report. Conflicting accepted reports block calculations until explicitly resolved.", "ثبت اصلاحیه، گزارش قبلی را پس نمی‌گیرد. گزارش‌های پذیرفته‌شده متعارض تا حل صریح تعارض، محاسبه را متوقف می‌کنند.")} />
    <CareSelect name="kind" label={L("Reported panel", "پنل گزارش‌شده")} value={kind} onChange={value => { setKind(value as typeof kind); setRows([0]); setNextRow(1); }} options={CARE_OPTIONS.report} />
    {kind === "other" && <CareField name="result_text" label={L("Reported result", "نتیجه گزارش‌شده")} required multiline maxLength={12000} />}
    {kind === "base_color" && <><p className="care-field-wide care-help">{L("MC1R / ASIP describe base pigment only. They do not predict the complete visible coat, greying, spotting or dilution.", "MC1R / ASIP فقط رنگدانه پایه را توصیف می‌کنند؛ پوشش کامل ظاهری، خاکستری‌شدن، لکه‌داری یا رقیق‌شدن رنگ را پیش‌بینی نمی‌کنند.")}</p><CareSelect name="MC1R" label="MC1R" options={[["", "Choose the reported genotype", "ژنوتیپ گزارش‌شده را انتخاب کنید"], ["E/E", "E/E", "E/E"], ["E/e", "E/e", "E/e"], ["e/e", "e/e", "e/e"]]} /><CareSelect name="ASIP" label="ASIP" options={[["", "Choose the reported genotype", "ژنوتیپ گزارش‌شده را انتخاب کنید"], ["A/A", "A/A", "A/A"], ["A/a", "A/a", "A/a"], ["a/a", "a/a", "a/a"]]} /></>}
    {kind === "str_parentage" && <CareField name="nomenclature" label={L("Allele nomenclature / reporting standard", "نام‌گذاری آلل / استاندارد گزارش")} required minLength={3} />}
    {(kind === "str_parentage" || kind === "disease") && <section className="care-field-wide care-repeatable"><header><h4>{L("Reported calls", "نتایج گزارش‌شده")}</h4><span>{n(rows.length)} / {n(64)}</span></header>{rows.map((row, index) => <fieldset className="care-repeat-row" key={`${kind}:${row}`}><legend>{L("Call", "نتیجه")} {n(index + 1)}</legend><div className="care-form-grid">{kind === "str_parentage" ? <><CareField name={`marker-${row}`} label={L("STR marker", "نشانگر STR")} required minLength={2} maxLength={30} dir="ltr" /><CareField name={`allele-a-${row}`} label={L("First allele", "آلل اول")} required maxLength={24} dir="ltr" /><CareField name={`allele-b-${row}`} label={L("Second allele", "آلل دوم")} required maxLength={24} dir="ltr" /><CareSelect name={`quality-${row}`} label={L("Reported call quality", "کیفیت نتیجه گزارش‌شده")} options={[["", "Choose reported quality", "کیفیت گزارش‌شده را انتخاب کنید"], ["pass", "Pass", "معتبر"], ["uncertain", "Uncertain", "نامطمئن"], ["failed", "Failed", "ناموفق"]]} /></> : <><CareField name={`variant-${row}`} label={L("Variant / disease marker", "واریانت / نشانگر بیماری")} required minLength={3} /><CareField name={`assay-${row}`} label={L("Assay identifier", "شناسه آزمون")} required minLength={3} /><CareField name={`result-${row}`} label={L("Exact reported result", "نتیجه دقیق گزارش‌شده")} required /></>}</div><button className="care-text-button" type="button" disabled={rows.length <= 1} onClick={() => setRows(values => values.filter(value => value !== row))}>{L("Remove call", "حذف نتیجه")}</button></fieldset>)}<button type="button" disabled={rows.length >= 64} onClick={() => { setRows(values => [...values, nextRow]); setNextRow(value => value + 1); }}>{L("Add reported call", "افزودن نتیجه گزارش‌شده")}</button></section>}
    <CareDocumentUpload platform={platform} horseId={horseId} onChange={setAttachment} onBusyChange={setUploading} />
  </CareCommandForm>;
}

export function ReportReviewEditor({ platform, horseId, report, capabilities, user, onSaved, onCancel }: EditorProps & { report: CareRecord<CareStored<LabReportInput>>; capabilities: CareCapabilities; user: PlatformUser }) {
  const L = useCareText(); const independent = Boolean(report.created_by_user_id && report.created_by_user_id !== user.id);
  const [sample, setSample] = useState<CareRecord<CareStored<SampleInput>> | null>(null); const [sampleFailed, setSampleFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setSample(null); setSampleFailed(false);
    platform.care.samples.get(horseId, report.body.sample_id, { signal: controller.signal }).then(value => { if (!controller.signal.aborted && value.record.horse_id === horseId && value.record.id === report.body.sample_id) setSample(value.record); }).catch(() => { if (!controller.signal.aborted) setSampleFailed(true); });
    return () => controller.abort();
  }, [platform, horseId, report.body.sample_id]);
  const canAccept = independent && capabilities.permissions.includes("private_file_export") && report.review_state === "pending" && Boolean(sample && sample.body.identity_check !== "not_checked");
  const choices: Array<readonly [string, string, string]> = [["withdrawn", "Withdraw from use", "پس‌گرفتن از استفاده"]];
  if (independent && report.review_state === "pending") choices.unshift(["rejected", "Reject in internal review", "رد در بررسی داخلی"]);
  if (canAccept) choices.unshift(["accepted", "Accept for internal use", "پذیرش برای استفاده داخلی"]);
  const [decision, setDecision] = useState<LabReportReviewInput["decision"]>(choices[0][0] as LabReportReviewInput["decision"]);
  return <CareCommandForm<LabReportReviewInput> title={L("Independent evidence review", "بررسی مستقل شواهد")} onSaved={onSaved} onCancel={onCancel} saveLabel={L("Record review decision", "ثبت تصمیم بررسی")}
    build={data => { if (decision === "accepted" && !canAccept) throw new Error(L("Acceptance needs an independent reviewer, private file access and the identity-checked sample record.", "پذیرش به بررسی‌کننده مستقل، دسترسی فایل خصوصی و سابقه نمونه با هویت بررسی‌شده نیاز دارد.")); return { expected_version: report.version, decision, review_ref: textValue(data, "review_ref"), identity_checked: data.get("identity_checked") === "on", report_authenticity_checked: data.get("report_authenticity_checked") === "on", scope_checked: data.get("scope_checked") === "on" }; }}
    execute={(input, signal) => platform.care.reports.review(horseId, report.id, input, { signal })}>
    <p className="care-notice care-field-wide"><strong dir="auto">{report.body.laboratory_ref} · {report.body.accession_ref}</strong><br />{L("Internal acceptance is not an official laboratory or registry certificate. Review the source document and the sample's identity evidence before deciding.", "پذیرش داخلی، گواهی رسمی آزمایشگاه یا سامانه ثبت نیست. پیش از تصمیم، مدرک منبع و شواهد هویت نمونه را بررسی کنید.")}</p>
    {!independent && <p className="care-field-wide care-help">{L("You cannot accept or reject a report you submitted. Withdrawal remains available with review permission.", "نمی‌توانید گزارش ارسالی خود را بپذیرید یا رد کنید. با مجوز بررسی می‌توانید آن را پس بگیرید.")}</p>}
    {independent && !capabilities.permissions.includes("private_file_export") && <p className="care-field-wide care-help">{L("Acceptance also needs permission to open the private source document.", "پذیرش، به مجوز باز کردن مدرک خصوصی منبع نیز نیاز دارد.")}</p>}
    <div className="care-field-wide care-notice">{sampleFailed ? <p role="alert">{L("The sample record could not be loaded. Acceptance is unavailable until its identity evidence can be checked.", "سابقه نمونه بارگذاری نشد. تا بررسی شواهد هویت، پذیرش در دسترس نیست.")}</p> : !sample ? <p role="status">{L("Loading the report's sample identity evidence…", "در حال بارگذاری شواهد هویت نمونه گزارش…")}</p> : <><strong dir="auto">{sample.body.sample_ref}</strong><p>{careLabel(sample.body.identity_check, L)} · <span dir="auto">{sample.body.identity_evidence_ref}</span></p><small dir="auto">{sample.body.source_ref}</small>{sample.body.identity_check === "not_checked" && <p>{L("This sample has no documented identity check and cannot support accepted evidence.", "بررسی هویت برای این نمونه مستند نشده و نمی‌تواند مبنای شواهد پذیرفته‌شده باشد.")}</p>}</>}</div>
    <CareSelect name="decision" label={L("Decision", "تصمیم")} value={decision} onChange={value => setDecision(value as typeof decision)} options={choices} />
    <CareField name="review_ref" label={L("Review reference / case number", "مرجع بررسی / شماره پرونده")} required minLength={3} />
    <div className="care-review-checks care-field-wide">{[["identity_checked", L("I checked the sample identity and its supporting record.", "هویت نمونه و سابقه پشتیبان آن را بررسی کردم.")], ["report_authenticity_checked", L("I checked the original stored report and its authenticity.", "گزارش ذخیره‌شده و اصالت آن را بررسی کردم.")], ["scope_checked", L("I checked the assay, panel version, method and permitted interpretation.", "آزمون، نسخه پنل، روش و دامنه مجاز تفسیر را بررسی کردم.")]].map(([name, label]) => <label key={name}><input type="checkbox" name={name} required={decision === "accepted"} /><span>{label}</span></label>)}</div>
    {capabilities.permissions.includes("private_file_export") && <a className="care-source-link care-field-wide" href={platform.modules.media.fileUrl(report.body.evidence_media_id)} target="_blank" rel="noopener noreferrer">{L("Open private source document", "باز کردن مدرک خصوصی منبع")} ↗</a>}
  </CareCommandForm>;
}
