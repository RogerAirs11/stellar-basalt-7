import { type UiLocale, uiText } from "../../shared/uiLocale";
import React, { useRef, useState } from "react";
import type { BreedingRecordRow, PlatformClient } from "../../contracts/platform";
import { isPlatformClientError } from "../../frontend-kit/errors";
import "./BreedingCorrectionEditor.css";

export function BreedingCorrectionEditor({ record, horseId, platform, locale, saved }: {
  record: BreedingRecordRow; horseId: number; platform: PlatformClient; locale: UiLocale; saved: () => void;
}) {
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [date,setDate] = useState(record.covering_date ?? "");
  const [season,setSeason] = useState(String(record.season ?? ""));
  const [reason,setReason] = useState("");
  const [version,setVersion] = useState(record.row_version);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [conflict,setConflict] = useState(false);
  const [current,setCurrent] = useState<BreedingRecordRow | null>(null);
  const operation = useRef(crypto.randomUUID());
  const edit = () => { operation.current = crypto.randomUUID(); setMessage(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || conflict) return;
    setBusy(true);setMessage("");
    try {
      await platform.modules.breedings.correct(record.id,{ expected_version: version, operation_id: operation.current,
        covering_date: date || null, season: season ? Number(season) : null, reason });
      saved();
    } catch (error) {
      if (isPlatformClientError(error) && (error.status === 409 || error.status === 428)) {
        setConflict(true); setMessage(L("This record changed. Your edits are preserved; review the current record before trying again.", "این رکورد تغییر کرده است. ویرایش شما حفظ شده؛ پیش از تلاش دوباره، رکورد فعلی را بررسی کنید."));
      } else if (isPlatformClientError(error) && error.status === 400) {
        setMessage(L("Check the Gregorian date, matching Solar Hijri season and correction reason. Your entries are preserved.", "تاریخ میلادی، سال هجری خورشیدیِ منطبق با آن و دلیل اصلاح را بررسی کنید. اطلاعات واردشده حفظ شده است."));
      } else if (isPlatformClientError(error) && (error.status === 401 || error.status === 403)) {
        setMessage(L("Your current account cannot save this correction. Your draft is preserved; check your sign-in and review access.", "حساب فعلی اجازهٔ ذخیرهٔ این اصلاح را ندارد. پیش‌نویس حفظ شده است؛ وضعیت ورود و دسترسی بررسی را کنترل کنید."));
      } else if (isPlatformClientError(error) && error.status === 404) {
        setMessage(L("This record is no longer available. Your draft is preserved.", "این رکورد دیگر در دسترس نیست. پیش‌نویس شما حفظ شده است."));
      } else setMessage(L("The correction could not be confirmed. Your entries are kept; try again to check the same request.", "ثبت اصلاح تأیید نشد. اطلاعات واردشده حفظ شده است؛ با تلاش دوباره همین درخواست بررسی می‌شود."));
    } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { const response=await platform.modules.breedings.horse(horseId); const row=[...response.as_sire,...response.as_dam,...(response.birth_record?[response.birth_record]:[])].find(item=>item.id===record.id);
      if(row)setCurrent(row);else setMessage(L("This record is no longer available.", "این رکورد دیگر در دسترس نیست."));
    } catch { setMessage(L("The current record could not be loaded. Your draft is preserved.", "دریافت رکورد فعلی ناموفق بود. پیش‌نویس شما حفظ شده است.")); }
    finally {setBusy(false);}
  };
  return <details className="breeding-correction-editor"><summary>{L("Correct covering date or season", "اصلاح تاریخ یا فصل جفت‌گیری")}</summary>
    <form onSubmit={submit}>
      <p>{L("A reviewed correction changes these dates only and keeps an audit history.", "این اصلاح پس از بررسی، فقط تاریخ و فصل را تغییر می‌دهد و در سابقهٔ تغییرات ثبت می‌شود.")}</p>
      <div className="breeding-correction-fields"><label>{L("Covering date (Gregorian)", "تاریخ جفت‌گیری (میلادی)")}<input type="date" value={date} onChange={event=>{edit();setDate(event.target.value);}} disabled={busy}/></label><label>{L("Season (Solar Hijri)", "فصل (سال هجری خورشیدی)")}<input type="number" min={1380} max={1500} value={season} onChange={event=>{edit();setSeason(event.target.value);}} disabled={busy} inputMode="numeric"/></label></div>
      <label>{L("Reason and evidence for correction", "دلیل و شواهد اصلاح")}<textarea minLength={10} maxLength={500} required value={reason} onChange={event=>{edit();setReason(event.target.value);}} disabled={busy} rows={3}/></label>
      {message && <p role="alert">{message}</p>}
      {conflict && !current && <button type="button" disabled={busy} onClick={refresh}>{L("Load current record", "دریافت رکورد فعلی")}</button>}
      {conflict && current && <div className="breeding-correction-current"><p>{L("Current record", "رکورد فعلی")}: <bdi>{current.covering_date || "—"} · {current.season || "—"}</bdi></p><button type="button" onClick={()=>{setVersion(current.row_version);operation.current=crypto.randomUUID();setConflict(false);setCurrent(null);setMessage(L("Current version selected. Check your retained edits before saving.", "نسخهٔ فعلی انتخاب شد. ویرایش حفظ‌شده را پیش از ذخیره بررسی کنید."));}}>{L("Keep my edits against this version", "حفظ ویرایش من بر پایهٔ این نسخه")}</button></div>}
      <button type="submit" disabled={busy || conflict || reason.trim().length<10 || (!date&&!season)}>{busy ? L("Saving…", "در حال ذخیره…") : L("Save reviewed correction", "ذخیرهٔ اصلاح بررسی‌شده")}</button>
    </form>
  </details>;
}
