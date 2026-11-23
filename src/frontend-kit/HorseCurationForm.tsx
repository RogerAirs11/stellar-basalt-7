import React, { useEffect, useRef, useState } from "react";
import type { AdminHorseRecord, HorseRecord, PlatformClient } from "../contracts/platform";
import { CURATION_DATE_KEYS, HORSE_CURATION_DATE_FIELDS, HORSE_CURATION_FIELD_SPECS, horseCurationChanges, horseCurationCreate, horseCurationDraft, type CurationDateField, type CurationFieldSpec } from "./horseCuration";
import { publicHorseDetailFields, staffHorseDetailFields } from "./horseFields";
import { uiText, type UiLocale } from "../shared/uiLocale";
import "./horse-curation.css";

type Props = { platform: PlatformClient; horse?: AdminHorseRecord; locale: UiLocale; scope: string; canEdit?: boolean; onSaved?: (horse: AdminHorseRecord) => void | Promise<void> };
/** Account and loaded-row keys discard private drafts before another scope is rendered. */
export function HorseCurationForm(props: Props) {
  return <CurationForm key={`${props.scope}:${props.horse?.id ?? "create"}:${props.horse?.row_version ?? 0}`} {...props} />;
}
function CurationForm({ platform, horse, locale, canEdit = true, onSaved }: Props) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [record, setRecord] = useState(horse); const [draft, setDraft] = useState(() => horseCurationDraft(horse));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const alive = useRef(true); const working = useRef(false); const controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const set = (key: string, value: string) => { setMessage(""); setDraft(previous => ({ ...previous, fields: { ...previous.fields, [key]: value } })); };
  const setDate = (key: CurationDateField, part: "value" | "precision" | "calendar", value: string) => { setMessage(""); setDraft(previous => ({ ...previous, dates: { ...previous.dates, [key]: { ...previous.dates[key], [part]: value } } })); };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canEdit || working.current) return;
    setError(""); setMessage("");
    let changes;
    try {
      changes = record ? horseCurationChanges(draft, record, L) : horseCurationCreate(draft, L);
      if (record && !Object.keys(changes).length) { setMessage(L("No fields have changed.", "هیچ فیلدی تغییر نکرده است.")); return; }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    working.current = true; setBusy(true); controller.current = new AbortController();
    try {
      const result = record
        ? await platform.admin.horses.update(record.id, record.row_version, changes, { signal: controller.current.signal })
        : await platform.admin.horses.create(changes as ReturnType<typeof horseCurationCreate>, { signal: controller.current.signal });
      if (!alive.current) return;
      if (record) { setRecord(result.horse); setDraft(horseCurationDraft(result.horse)); }
      else setDraft(horseCurationDraft());
      setMessage(record ? L("Changes saved with row-version validation.", "تغییرات با کنترل نسخه رکورد ذخیره شد.") : L(`Created horse #${result.horse.id}.`, `اسب #${result.horse.id} ایجاد شد.`));
      // The acknowledged mutation remains successful if a surrounding list fails to refresh.
      void Promise.resolve().then(() => onSaved?.(result.horse)).catch(() => { if (alive.current) setMessage(L("Record saved. Refresh the surrounding list to see its current state.", "رکورد ذخیره شد. برای مشاهده وضعیت فعلی، فهرست پیرامون را تازه کنید.")); });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : L("Save could not be confirmed. Check the record before submitting again.", "ذخیره تأیید نشد. پیش از ارسال دوباره، رکورد را بررسی کنید.")); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const groups = [
    ["identity", L("Identity, names & measurements", "هویت، نام‌ها و اندازه‌ها")],
    ["identifiers", L("Registration & issuing authorities", "ثبت و مراجع صادرکننده")],
    ["parents", L("Parents & strains", "والدین و تیره‌ها")],
    ["places", L("Places & private address", "مکان‌ها و نشانی خصوصی")],
    ["notes", L("Source notes", "یادداشت‌های منبع")],
  ] as const;
  const input = (spec: CurationFieldSpec) => {
    const label = L(spec.en, spec.fa); const value = draft.fields[spec.key] ?? "";
    if (spec.key === "father_id" || spec.key === "mother_id") return <CurationParent key={spec.key} platform={platform} name={spec.key} label={label} value={value} selfId={record?.id} onChange={next => set(spec.key, next)} L={L} />;
    return <label className={spec.kind === "multiline" || spec.kind === "names" ? "curation-wide" : ""} key={spec.key}><span>{label}</span>{spec.kind === "life_status"
      ? <select name={spec.key} value={value} onChange={event => set(spec.key, event.target.value)}>{[["unknown", "Unknown", "نامعلوم"], ["alive", "Alive", "زنده"], ["dead", "Deceased", "تلف‌شده"], ["missing", "Missing", "مفقود"]].map(([key, en, fa]) => <option key={key} value={key}>{L(en!, fa!)}</option>)}</select>
      : spec.kind === "multiline" || spec.kind === "names" ? <textarea name={spec.key} value={value} onChange={event => set(spec.key, event.target.value)} rows={spec.kind === "names" ? 3 : 4} maxLength={spec.maxLength} dir="auto" />
      : <input name={spec.key} value={value} onChange={event => set(spec.key, event.target.value)} required={spec.key === "name_latin"} maxLength={spec.maxLength} inputMode={spec.kind === "number" ? spec.key === "height_cm" ? "decimal" : "numeric" : undefined} dir={spec.kind === "number" || spec.key === "name_latin" ? "ltr" : "auto"} />}</label>;
  };
  return <div className="horse-curation-workspace"><form className="horse-curation-form" aria-label={record ? L("Edit canonical horse", "ویرایش اسب مرجع") : L("Create canonical horse", "ایجاد اسب مرجع")} onSubmit={save}>
    <header><h3>{record ? L("Edit canonical horse", "ویرایش اسب مرجع") : L("Create canonical horse", "ایجاد اسب مرجع")}</h3>{record && <p>#{record.id} · {L("row version", "نسخه رکورد")} {record.row_version}</p>}<p>{L("Authorized staff curation. Source assertions remain subject to the registry's validation and review rules. Save before leaving; private drafts are kept only in this form.", "ویرایش کارکنان مجاز. ادعاهای منبع تابع اعتبارسنجی و قواعد بررسی سامانه‌اند. پیش از خروج ذخیره کنید؛ پیش‌نویس خصوصی فقط در همین فرم نگهداری می‌شود.")}</p></header>
    <fieldset disabled={busy || !canEdit}>
      {groups.map(([group, label]) => <details open={group === "identity"} key={group} className="curation-group"><summary>{label}</summary><div className="curation-grid">{HORSE_CURATION_FIELD_SPECS.filter(spec => spec.group === group).map(input)}</div>{group === "identity" && record && (record.is_dead === 1 || record.life_status === "dead" || record.death_date_value) && <p className="curation-help">{L("A recorded death can be reversed only through the reviewed lifecycle-correction workflow.", "مرگ ثبت‌شده فقط از مسیر اصلاح بررسی‌شده رویداد حیات قابل بازگردانی است.")}</p>}</details>)}
      <details className="curation-group"><summary>{L("Dated source facts", "اطلاعات تاریخ‌دار منبع")}</summary><p className="curation-help">{L("Keep the source calendar and precision. A year-only or month-only fact is never expanded to a guessed day. Leave an unknown value blank; clearing an existing value is a deliberate correction.", "تقویم و دقت منبع را حفظ کنید. سال یا ماه به روز حدسی تبدیل نمی‌شود. مقدار نامعلوم را خالی بگذارید؛ پاک‌کردن مقدار قبلی یک اصلاح صریح است.")}</p>{CURATION_DATE_KEYS.map(key => <div className="curation-date" key={key}><h4>{L(HORSE_CURATION_DATE_FIELDS[key].en, HORSE_CURATION_DATE_FIELDS[key].fa)}</h4><div className="curation-grid"><label><span>{L("Source date value", "مقدار تاریخ منبع")}</span><input name={`${key}_value`} value={draft.dates[key].value} onChange={event => setDate(key, "value", event.target.value)} placeholder="YYYY / YYYY-MM / YYYY-MM-DD" maxLength={10} dir="ltr" /></label><label><span>{L("Precision", "دقت")}</span><select name={`${key}_precision`} value={draft.dates[key].precision} onChange={event => setDate(key, "precision", event.target.value)}><option value="">{L("Choose source precision", "انتخاب دقت منبع")}</option><option value="year">{L("Year only", "فقط سال")}</option><option value="month">{L("Month only", "فقط ماه")}</option><option value="day">{L("Exact day", "روز دقیق")}</option></select></label><label><span>{L("Calendar", "تقویم")}</span><select name={`${key}_calendar`} value={draft.dates[key].calendar} onChange={event => setDate(key, "calendar", event.target.value)}><option value="">{L("Choose source calendar", "انتخاب تقویم منبع")}</option><option value="gregorian">{L("Gregorian", "میلادی")}</option><option value="solar_hijri">{L("Solar Hijri", "هجری شمسی")}</option></select></label></div></div>)}</details>
    </fieldset>
    {error && <p role="alert" className="curation-error">{error}</p>}{message && <p role="status" className="curation-message">{message}</p>}
    {canEdit && <button type="submit" className="primary" disabled={busy}>{busy ? L("Saving…", "در حال ذخیره…") : record ? L("Save canonical changes", "ذخیره تغییرات مرجع") : L("Create record", "ایجاد رکورد")}</button>}
  </form>{record && <StaffHorseLedger horse={record} locale={locale} />}</div>;
}

function CurationParent({ platform, name, label, value, selfId, onChange, L }: { platform: PlatformClient; name: string; label: string; value: string; selfId?: number; onChange: (value: string) => void; L: (en: string, fa: string) => string }) {
  const [query, setQuery] = useState(""); const [rows, setRows] = useState<HorseRecord[]>([]); const [failed, setFailed] = useState(false);
  useEffect(() => { setRows([]); setFailed(false); if (query.trim().length < 2) return; const controller = new AbortController(); const timer = setTimeout(() => { platform.search.horses(query.trim(), { limit: 6, signal: controller.signal }).then(result => { if (!controller.signal.aborted) setRows(result.results.filter(row => row.id !== selfId)); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }); }, 200); return () => { clearTimeout(timer); controller.abort(); }; }, [platform, query, selfId]);
  return <div className="curation-parent"><label><span>{label}</span><input name={name} value={value} onChange={event => onChange(event.target.value)} inputMode="numeric" dir="ltr" /></label><label><span>{L("Find an existing parent", "یافتن والد موجود")}</span><input aria-label={`${label} — ${L("search", "جست‌وجو")}`} value={query} onChange={event => setQuery(event.target.value)} dir="auto" placeholder={L("Search name or registry number", "جست‌وجوی نام یا شماره ثبت")} /></label>{failed && <small role="alert">{L("Parent search failed. Enter a known registry ID or try again.", "جست‌وجوی والد ناموفق بود. شناسه ثبت معلوم را وارد کنید یا دوباره تلاش کنید.")}</small>}{rows.length > 0 && <ul>{rows.map(row => <li key={row.id}><button type="button" onClick={() => { onChange(String(row.id)); setQuery(""); }}>{row.name_latin || row.name_native} · #{row.id}</button></li>)}</ul>}</div>;
}

export function StaffHorseLedger({ horse, locale }: { horse: AdminHorseRecord; locale: UiLocale }) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const staff = staffHorseDetailFields(horse, { includeEmpty: true });
  const publicFields = publicHorseDetailFields(horse, { includeEmpty: true, locale });
  return <details className="horse-staff-ledger"><summary>{L("Complete canonical staff record", "رکورد کامل مرجع کارکنان")}</summary><dl><div><dt>{L("Horse ID / row version", "شناسه اسب / نسخه رکورد")}</dt><dd>#{horse.id} / {horse.row_version}</dd></div>{[...staff, ...publicFields].map(field => <div key={field.key}><dt>{L(field.label.en, field.label.fa)}</dt><dd dir="auto">{field.value === null ? "—" : field.kind === "boolean" ? Number(field.value) === 1 ? L("Yes", "بله") : L("No", "خیر") : String(field.value)}</dd></div>)}</dl></details>;
}
