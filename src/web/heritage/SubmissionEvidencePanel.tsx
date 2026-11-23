import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileText, LockKeyhole, Upload } from "lucide-react";
import type { PlatformClient, RegistrationEvidenceListResponse, RegistrationEvidenceRole, RegistrationEvidenceUploadInput } from "../../contracts/platform";
import { uiText } from "../../shared/uiLocale";
import { useI18n } from "../i18n";

const ROLES: Array<{ value: RegistrationEvidenceRole; en: string; fa: string }> = [
  { value: "passport", en: "Passport", fa: "گذرنامه" },
  { value: "identity_photo", en: "Identity photograph", fa: "عکس شناسایی" },
  { value: "registration", en: "Registration document", fa: "مدرک ثبت" },
  { value: "laboratory", en: "Laboratory report", fa: "گزارش آزمایشگاه" },
  { value: "other", en: "Other supporting evidence", fa: "سایر شواهد" },
];
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
type UploadIntent = { file: File; input: Omit<RegistrationEvidenceUploadInput, "data_base64">; bytes?: string; requestId: string };

export function SubmissionEvidencePanel({ platform, requestId, onBusyChange, disabled = false, readOnly = false }: {
  platform: PlatformClient; requestId: string; onBusyChange?: (busy: boolean) => void; disabled?: boolean; readOnly?: boolean;
}) {
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [list, setList] = useState<RegistrationEvidenceListResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [role, setRole] = useState<RegistrationEvidenceRole>("passport");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const intent = useRef<UploadIntent | null>(null);
  const lifetime = useMemo(() => ({ controller: new AbortController(), busy: false }), [platform, requestId]);
  const current = useRef(lifetime); current.current = lifetime;
  const isCurrent = () => current.current === lifetime && !lifetime.controller.signal.aborted;
  useEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => { lifetime.controller.abort(); onBusyChange?.(false); };
  }, [lifetime, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    setList(null); setLoadError(false); setMessage(""); setError(""); setRetryAvailable(false); intent.current = null;
    platform.changes.evidence.list(requestId, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted && value.request_id === requestId) setList(value); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [platform, requestId, attempt]);
  const refresh = async () => {
    const value = await platform.changes.evidence.list(requestId, { signal: lifetime.controller.signal });
    if (isCurrent() && value.request_id === requestId) { setList(value); setLoadError(false); }
  };
  const begin = () => {
    if (!isCurrent() || lifetime.busy || disabled || readOnly || !list?.can_edit) return false;
    lifetime.busy = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage(""); return true;
  };
  const end = () => { lifetime.busy = false; if (isCurrent()) { setBusy(false); onBusyChange?.(false); } };
  const upload = async (file?: File) => {
    if (!begin()) return;
    try {
      if (file) {
        if (!ALLOWED.has(file.type)) throw new Error(L("Choose a JPEG, PNG, WebP image or PDF document.", "یک تصویر JPEG، PNG، WebP یا مدرک PDF انتخاب کنید."));
        if (!file.size || file.size > Math.min(list!.limits.max_file_bytes, 8 * 1024 * 1024)) throw new Error(L("Choose a non-empty file up to 8 MiB.", "یک فایل غیرخالی با حجم حداکثر ۸ مگابایت انتخاب کنید."));
        if (list!.evidence.length >= list!.limits.max_files) throw new Error(L("This draft has reached its file limit. Remove an unnecessary attachment first.", "تعداد فایل‌های این پیش‌نویس به حد مجاز رسیده است. ابتدا یک پیوست غیرضروری را حذف کنید."));
        if (list!.evidence.reduce((sum, item) => sum + item.size_bytes, 0) + file.size > list!.limits.max_total_bytes) throw new Error(L("This file would exceed the draft's total attachment size limit.", "این فایل از سقف حجم کل پیوست‌های پیش‌نویس بیشتر می‌شود."));
        intent.current = { file, requestId, input: { role, file_name: file.name.slice(0, 200), mime_type: file.type, operation_id: crypto.randomUUID() } };
      }
      const pending = intent.current;
      if (!pending || pending.requestId !== requestId) return;
      if (!pending.bytes) pending.bytes = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error ?? new Error("File could not be read"));
        reader.readAsDataURL(pending.file);
      });
      if (!isCurrent()) return;
      await platform.changes.evidence.upload(requestId, { ...pending.input, data_base64: pending.bytes }, { signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      intent.current = null; setRetryAvailable(false);
      setMessage(L("Attachment saved privately to this request. It is awaiting review.", "پیوست به‌صورت خصوصی در این درخواست ذخیره شد و در انتظار بررسی است."));
      await refresh();
    } catch (cause) {
      if (!isCurrent()) return;
      setError(cause instanceof Error ? cause.message : L("The upload could not be confirmed. Retry the same file below.", "بارگذاری تأیید نشد. همان فایل را در پایین دوباره ارسال کنید."));
      setRetryAvailable(Boolean(intent.current));
    } finally { if (inputRef.current) inputRef.current.value = ""; end(); }
  };
  const remove = async (id: string) => {
    if (!begin()) return;
    try {
      await platform.changes.evidence.remove(requestId, id, { signal: lifetime.controller.signal });
      if (!isCurrent()) return;
      setMessage(L("Attachment removed from this draft.", "پیوست از این پیش‌نویس حذف شد."));
      await refresh();
    } catch { if (isCurrent()) setError(L("Removal could not be confirmed. Refresh the attachment list before retrying.", "حذف تأیید نشد. پیش از تلاش دوباره، فهرست پیوست‌ها را تازه کنید.")); }
    finally { end(); }
  };
  return <section className="submission-evidence" aria-label={L("Private supporting documents", "مدارک پشتیبان خصوصی")} aria-busy={busy}>
    <header><LockKeyhole size={18} /><div><h3>{L("Private supporting documents", "مدارک پشتیبان خصوصی")}</h3><p>{L("Only you and authorized reviewers can open these files. Uploading is not verification or publication.", "فقط شما و بررسی‌کنندگان مجاز می‌توانید این فایل‌ها را باز کنید. بارگذاری به معنی تأیید یا انتشار نیست.")}</p></div></header>
    {loadError ? <div className="submission-evidence-error" role="alert"><p>{L("Attachments could not be loaded. This is not an empty list.", "پیوست‌ها بارگذاری نشدند. این پیام به معنی خالی‌بودن فهرست نیست.")}</p><button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{L("Try again", "تلاش دوباره")}</button></div>
      : !list ? <p role="status">{L("Loading attachments…", "در حال بارگذاری پیوست‌ها…")}</p>
      : <>
        {list.evidence.length ? <ul className="submission-evidence-list">{list.evidence.map(item => <li key={item.id}><FileText size={18} /><div><a href={platform.changes.evidence.fileUrl(requestId, item.id)} target="_blank" rel="noopener noreferrer" download={item.file_name} dir="auto">{item.file_name}</a><small>{L(ROLES.find(value => value.value === item.role)?.en ?? "Supporting evidence", ROLES.find(value => value.value === item.role)?.fa ?? "شواهد")} · {n(Math.ceil(item.size_bytes / 1024))} KB · {L("Private · unreviewed", "خصوصی · بررسی‌نشده")}</small></div>{list.can_edit && !readOnly && <button type="button" disabled={busy || disabled} onClick={() => void remove(item.id)}>{L("Remove", "حذف")}</button>}</li>)}</ul> : <p className="submission-evidence-empty">{L("No attachments yet.", "هنوز پیوستی ثبت نشده است.")}</p>}
        {list.can_edit && !readOnly ? <div className="submission-evidence-upload"><label>{L("Document purpose", "نوع مدرک")}<select value={role} disabled={busy || disabled} onChange={event => setRole(event.target.value as RegistrationEvidenceRole)}>{ROLES.map(value => <option value={value.value} key={value.value}>{L(value.en, value.fa)}</option>)}</select></label><label className="submission-file-choice"><Upload size={18} /><span>{L("Choose a file", "انتخاب فایل")}</span><input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" disabled={busy || disabled} aria-label={L("Choose a private supporting document", "انتخاب مدرک پشتیبان خصوصی")} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label><small>{L("JPEG, PNG, WebP or PDF · up to 8 MiB per file", "JPEG، PNG، WebP یا PDF · حداکثر ۸ مگابایت برای هر فایل")}<br />{n(list.evidence.length)} / {n(list.limits.max_files)} {L("attachments", "پیوست")}</small></div> : <p className="submission-step-hint">{list.can_edit ? L("Edit attachments in the People & evidence step.", "پیوست‌ها را در مرحله افراد و شواهد ویرایش کنید.") : L("This request is read-only while it is outside draft status.", "تا زمانی که درخواست پیش‌نویس نیست، پیوست‌ها فقط قابل مشاهده‌اند.")}</p>}
      </>}
    {busy && <p role="status">{L("Saving attachment…", "در حال ذخیره پیوست…")}</p>}
    {message && <p className="submission-message" role="status">{message}</p>}
    {error && <div role="alert" className="submission-evidence-error"><p>{error}</p>{retryAvailable && list?.can_edit && <button type="button" disabled={busy || disabled} onClick={() => void upload()}>{L("Retry the same upload", "تلاش دوباره برای همین فایل")}</button>}</div>}
  </section>;
}
