import React, { useEffect, useRef, useState } from "react";
import { FileText, LockKeyhole, Search, Upload } from "lucide-react";
import type { CareCommand, CareReceipt, HorseRecord, PlatformClient } from "../../../contracts/platform";
import { PlatformClientError } from "../../../frontend-kit/errors";
import { toAsciiDigits } from "../../../shared/numerals";
import { uiText } from "../../../shared/uiLocale";
import { useI18n } from "../../i18n";

export const CARE_OPTIONS = {
  clinical: [["examination", "Examination", "معاینه"], ["vaccination", "Vaccination", "واکسیناسیون"], ["diagnosis", "Diagnosis", "تشخیص"], ["procedure", "Procedure", "اقدام درمانی"], ["medication", "Medication", "دارو"], ["allergy", "Allergy", "حساسیت"], ["other", "Other", "سایر"]],
  method: [["natural_cover", "Natural cover", "جفت‌گیری طبیعی"], ["artificial_insemination", "Artificial insemination", "تلقیح مصنوعی"], ["embryo_transfer", "Embryo transfer", "انتقال جنین"], ["icsi", "ICSI", "ICSI"], ["unknown", "Unknown", "نامشخص"]],
  outcome: [["planned", "Planned", "برنامه‌ریزی‌شده"], ["covered", "Covered / inseminated", "جفت‌گیری / تلقیح انجام‌شده"], ["pregnant", "Pregnant", "آبستن"], ["not_pregnant", "Not pregnant", "غیرآبستن"], ["pregnancy_loss", "Pregnancy loss", "از دست رفتن آبستنی"], ["foaled", "Foaled", "زایمان انجام‌شده"], ["cancelled", "Cancelled", "لغوشده"]],
  specimen: [["hair_root", "Hair roots", "ریشه مو"], ["blood", "Blood", "خون"], ["buccal", "Buccal swab", "سواب دهانی"], ["semen", "Semen", "اسپرم"], ["tissue", "Tissue", "بافت"], ["other", "Other", "سایر"]],
  identity: [["not_checked", "Not checked", "بررسی نشده"], ["microchip_matched", "Microchip matched", "تطبیق ریزتراشه"], ["document_checked", "Identity document checked", "بررسی مدرک هویتی"]],
  custody: [["received", "Received", "دریافت"], ["transferred", "Transferred", "تحویل"], ["stored", "Stored", "نگهداری"], ["discarded", "Discarded", "امحا"], ["correction", "Correction", "اصلاح"]],
  report: [["other", "Other laboratory report", "سایر گزارش‌های آزمایشگاه"], ["base_color", "Base pigment: MC1R / ASIP", "رنگدانه پایه: MC1R / ASIP"], ["str_parentage", "STR parentage markers", "نشانگرهای STR تبار"], ["disease", "Disease assay", "آزمایش بیماری"]],
  review: [["pending", "Awaiting independent review", "در انتظار بررسی مستقل"], ["accepted", "Internally accepted", "پذیرفته‌شده در بررسی داخلی"], ["rejected", "Rejected in review", "ردشده در بررسی"], ["withdrawn", "Withdrawn", "پس‌گرفته‌شده"]],
} as const;
export type CareOption = readonly [string, string, string];
export function useCareText() { const { locale } = useI18n(); return (en: string, fa: string) => uiText(locale, en, fa); }
export function careLabel(value: string | null | undefined, L: (en: string, fa: string) => string): string {
  if (!value) return "—";
  for (const options of Object.values(CARE_OPTIONS)) { const option = options.find(row => row[0] === value); if (option) return L(option[1], option[2]); }
  return value;
}
export function CareSelect({ name, label, options, value, defaultValue, onChange, required = true }: { name: string; label: string; options: readonly CareOption[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; required?: boolean }) {
  const L = useCareText();
  return <label className="care-field"><span>{label}</span><select name={name} value={value} defaultValue={defaultValue} required={required} onChange={event => onChange?.(event.target.value)}>{options.map(([id, en, fa]) => <option key={id} value={id}>{L(en, fa)}</option>)}</select></label>;
}
export function CareField({ name, label, value, required = false, minLength, maxLength = 240, multiline = false, hint, placeholder, dir }: { name: string; label: string; value?: string | null; required?: boolean; minLength?: number; maxLength?: number; multiline?: boolean; hint?: string; placeholder?: string; dir?: "ltr" | "auto" }) {
  return <label className={`care-field${multiline ? " care-field-wide" : ""}`}><span>{label}{!required && <small> · <Optional /></small>}</span>{multiline
    ? <textarea name={name} defaultValue={value ?? ""} required={required} minLength={minLength} maxLength={maxLength} rows={4} placeholder={placeholder} dir={dir ?? "auto"} />
    : <input name={name} defaultValue={value ?? ""} required={required} minLength={minLength} maxLength={maxLength} placeholder={placeholder} dir={dir ?? "auto"} />}{hint && <small>{hint}</small>}</label>;
}
function Optional() { return <>{useCareText()("optional", "اختیاری")}</>; }
export function CareDate({ name, label, value, required = false, future = false }: { name: string; label: string; value?: string | null; required?: boolean; future?: boolean }) {
  const L = useCareText();
  return <label className="care-field"><span>{label}{!required && <small> · {L("optional", "اختیاری")}</small>}</span><input name={name} type="date" defaultValue={value ?? ""} max={future ? undefined : new Date().toISOString().slice(0, 10)} required={required} dir="ltr" /><small>{L("Exact Gregorian date; leave blank when unknown.", "تاریخ دقیق میلادی؛ اگر نامعلوم است خالی بگذارید.")}</small></label>;
}
export function textValue(data: FormData, name: string): string { return String(data.get(name) ?? "").trim(); }
export function nullableValue(data: FormData, name: string): string | null { return textValue(data, name) || null; }
export function idValue(data: FormData, name: string): number | null {
  const raw = toAsciiDigits(textValue(data, name));
  if (!raw) return null;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) throw new Error("Choose a valid registered horse.");
  return value;
}

/** A failed ambiguous write keeps one immutable command and UUID for retry. */
export function CareCommandForm<T extends CareCommand>({ title, children, build, execute, onSaved, onCancel, saveLabel, externallyBusy = false }: {
  title: string; children: React.ReactNode; build: (data: FormData) => Omit<T, "operation_id" | "reason">;
  execute: (input: T, signal: AbortSignal) => Promise<{ receipt: CareReceipt }>;
  onSaved: (receipt: CareReceipt) => void; onCancel: () => void; saveLabel?: string; externallyBusy?: boolean;
}) {
  const L = useCareText();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [retry, setRetry] = useState(false);
  const pending = useRef<T | null>(null); const working = useRef(false); const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const send = async (input: T) => {
    if (working.current || externallyBusy) return;
    working.current = true; setBusy(true); setError(""); controller.current = new AbortController();
    try {
      const { receipt } = await execute(input, controller.current.signal);
      if (!alive.current) return;
      pending.current = null; setRetry(false);
      // A successful receipt is authoritative even when this actor cannot read.
      onSaved(receipt);
    } catch (cause) {
      if (!alive.current) return;
      const definitelyRejected = cause instanceof PlatformClientError && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 429;
      if (definitelyRejected) pending.current = null;
      setRetry(!definitelyRejected);
      setError(cause instanceof Error ? cause.message : L("The save could not be confirmed.", "نتیجه ذخیره تأیید نشد."));
    } finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return <form className="care-editor" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (working.current || externallyBusy || pending.current) return;
    try {
      const data = new FormData(event.currentTarget); const reason = textValue(data, "reason");
      if (reason.length < 8) throw new Error(L("Describe the reason in at least 8 characters.", "دلیل ثبت یا اصلاح را با حداقل ۸ نویسه توضیح دهید."));
      const input = { ...build(data), operation_id: crypto.randomUUID(), reason } as T;
      pending.current = input; void send(input);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }}>
    <header><h3>{title}</h3><p>{L("Private institutional record. Save before leaving this workspace; unsaved care entries are kept only in this form.", "رکورد خصوصی مؤسسه. پیش از خروج ذخیره کنید؛ ورودی ذخیره‌نشده فقط در همین فرم نگهداری می‌شود.")}</p></header>
    <fieldset disabled={busy || retry}><div className="care-form-grid">{children}<CareField name="reason" label={L("Reason for this entry or correction", "دلیل این ثبت یا اصلاح")} required minLength={8} maxLength={1000} multiline /></div></fieldset>
    {error && <div role="alert" className="care-notice care-notice-error"><p dir="auto">{error}</p>{retry && <p>{L("The server may have saved this command. Retry the identical command to recover its receipt, or close this form and check the records before creating another entry.", "ممکن است فرمان در سرور ذخیره شده باشد. همان فرمان را دوباره ارسال کنید تا رسید بازیابی شود، یا پیش از ثبت دوباره فرم را ببندید و سوابق را بررسی کنید.")}</p>}</div>}
    <div className="care-actions">{retry ? <button type="button" className="care-primary" disabled={busy || externallyBusy} onClick={() => pending.current && void send(pending.current)}>{busy ? L("Confirming…", "در حال تأیید…") : L("Retry the same command", "تلاش دوباره برای همان فرمان")}</button> : <button className="care-primary" type="submit" disabled={busy || externallyBusy}>{busy ? L("Saving…", "در حال ذخیره…") : saveLabel ?? L("Save private record", "ذخیره رکورد خصوصی")}</button>}<button type="button" disabled={busy || externallyBusy} onClick={onCancel}>{retry ? L("Close and check records", "بستن و بررسی سوابق") : L("Cancel", "انصراف")}</button></div>
  </form>;
}

export interface CareAttachment { id: string; sha256: string; file_name: string }
/** Hash only the exact sanitized bytes returned by the media service. */
export function CareDocumentUpload({ platform, horseId, initialId, onChange, onBusyChange }: { platform: PlatformClient; horseId: number; initialId?: string | null; onChange: (value: CareAttachment | null) => void; onBusyChange: (busy: boolean) => void }) {
  const L = useCareText(); const [attachment, setAttachment] = useState<CareAttachment | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const working = useRef(false); const alive = useRef(true); const input = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const upload = async (file: File) => {
    if (working.current) return;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) || file.size <= 0 || file.size > 3 * 1024 * 1024) { setError(L("Choose a non-empty JPEG, PNG or PDF up to 3 MiB.", "یک فایل غیرخالی JPEG، PNG یا PDF با حجم حداکثر ۳ مگابایت انتخاب کنید.")); return; }
    working.current = true; setBusy(true); onBusyChange(true); setError(""); controller.current = new AbortController();
    try {
      const bytes = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(reader.error ?? new Error("File read failed")); reader.readAsDataURL(file); });
      if (!alive.current) return;
      const { media } = await platform.modules.media.upload(horseId, { media_type: "document", role: "veterinary", file_name: file.name.slice(0, 200), mime_type: file.type, data_base64: bytes }, { signal: controller.current.signal });
      if (!alive.current) return;
      if (!media.sha256 || !/^[a-f0-9]{64}$/.test(media.sha256)) throw new Error(L("The file was received but its stored checksum was not returned. Ask the service administrator to check it before submitting a report.", "فایل دریافت شد اما هش نسخه ذخیره‌شده برگردانده نشد. پیش از ثبت گزارش از مدیر سامانه بخواهید آن را بررسی کند."));
      const value = { id: media.id, sha256: media.sha256, file_name: file.name };
      setAttachment(value); onChange(value);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : L("Upload could not be confirmed.", "نتیجه بارگذاری تأیید نشد.")); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); if (input.current) input.current.value = ""; } }
  };
  return <section className="care-document care-field-wide"><header><LockKeyhole size={18} /><div><strong>{L("Private supporting document", "مدرک پشتیبان خصوصی")}</strong><p>{L("Veterinary documents stay private and await review. Uploading does not publish or certify them.", "مدارک دامپزشکی خصوصی و در انتظار بررسی می‌مانند. بارگذاری به معنی انتشار یا صدور گواهی نیست.")}</p></div></header>
    {attachment ? <div className="care-file-receipt"><FileText size={17} /><span dir="auto">{attachment.file_name}<small>{L("Stored checksum received", "هش نسخه ذخیره‌شده دریافت شد")}</small></span><a href={platform.modules.media.fileUrl(attachment.id)} target="_blank" rel="noopener noreferrer">{L("Open file", "باز کردن فایل")}</a></div> : initialId ? <p>{L("The existing private attachment will remain linked unless you upload a replacement.", "اگر مدرک جایگزین بارگذاری نکنید، پیوست خصوصی موجود حفظ می‌شود.")}</p> : null}
    <label className="care-upload-choice"><Upload size={17} /><span>{busy ? L("Uploading…", "در حال بارگذاری…") : attachment || initialId ? L("Upload replacement", "بارگذاری جایگزین") : L("Choose document", "انتخاب مدرک")}</span><input ref={input} aria-label={L("Upload private veterinary document", "بارگذاری مدرک خصوصی دامپزشکی")} type="file" accept=".jpg,.jpeg,.png,.pdf" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label><small>{L("JPEG, PNG or PDF · up to 3 MiB · original upload is sanitized before storage", "JPEG، PNG یا PDF · حداکثر ۳ مگابایت · فایل پیش از ذخیره پاک‌سازی می‌شود")}</small>
    {error && <p role="alert" className="care-notice-error" dir="auto">{error}</p>}
  </section>;
}

/** Search the real registry without navigating away from an unsaved form. */
export function CareHorsePicker({ platform, name, label, value, onChange, excludeId }: { platform: PlatformClient; name: string; label: string; value: number | null; onChange: (id: number | null) => void; excludeId?: number }) {
  const L = useCareText(); const { locale, n } = useI18n(); const [query, setQuery] = useState(""); const [rows, setRows] = useState<HorseRecord[]>([]); const [failed, setFailed] = useState(false); const [loading, setLoading] = useState(false); const [selected, setSelected] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setRows([]); setFailed(false); setLoading(false);
    if (query.trim().length < 2 || value) return () => controller.abort();
    const timer = setTimeout(() => { setLoading(true); platform.search.horses(query.trim(), { limit: 6, signal: controller.signal }).then(response => { if (!controller.signal.aborted) setRows(response.results.filter(row => row.id !== excludeId)); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [platform, query, value, excludeId]);
  return <div className="care-horse-picker care-field"><label><span>{label}</span><input type="hidden" name={name} value={value ?? ""} />{value ? <span className="care-selected"><strong dir="auto">{selected || `#${n(value)}`}</strong><button type="button" onClick={() => { onChange(null); setSelected(""); setQuery(""); }}>{L("Change", "تغییر")}</button></span> : <span className="care-search-input"><Search size={16} /><input aria-label={label} value={query} onChange={event => setQuery(event.target.value)} placeholder={L("Search name or registry number", "جست‌وجوی نام یا شماره ثبت")} autoComplete="off" dir="auto" /></span>}</label>
    {!value && loading && <small role="status">{L("Searching…", "در حال جست‌وجو…")}</small>}{!value && failed && <small role="alert">{L("Search failed. Edit the query to try again.", "جست‌وجو ناموفق بود. برای تلاش دوباره عبارت را تغییر دهید.")}</small>}
    {!value && rows.length > 0 && <ul>{rows.map(row => { const title = locale === "fa" ? row.name_native || row.name_latin : row.name_latin || row.name_native; return <li key={row.id}><button type="button" onClick={() => { onChange(row.id); setSelected(title || `#${n(row.id)}`); setRows([]); }}><span dir="auto">{title}</span><small>#{n(row.id)}{row.register_no ? ` · ${row.register_no}` : ""}</small></button></li>; })}</ul>}
    {!value && !loading && !failed && query.trim().length >= 2 && !rows.length && <small>{L("No loaded matches. You can leave this unknown.", "نتیجه‌ای بارگذاری نشده است. می‌توانید این مورد را نامعلوم بگذارید.")}</small>}
  </div>;
}
