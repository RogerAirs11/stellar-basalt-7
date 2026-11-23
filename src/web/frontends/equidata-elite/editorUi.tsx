import { Children, cloneElement, isValidElement, useId, useState, type ReactNode } from "react";
import { kitText } from "../../../frontend-kit";
import { isRegistryId, IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel } from "../../../frontend-kit";
import { editorFieldLabel } from "../../../frontend-kit";
export type EditorLocale = "en" | "fa" | "ar";
export const editorText = (locale: EditorLocale, en: string, fa: string) => locale === "fa" ? fa : locale === "ar" ? kitText(locale, en, fa) : en;
export function EditorField({ field, locale, children }: { field: string; locale: EditorLocale; children: ReactNode }) {
  const labelId = useId();
  // A textarea's edited text must never become part of its accessible name.
  // Keep the native label click target and name each control from the stable caption.
  const controls = Children.map(children, child => isValidElement<{ "aria-labelledby"?: string }>(child)
    && typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type)
    ? cloneElement(child, { "aria-labelledby": labelId }) : child);
  return <label className="edx112-editor-field"><span id={labelId}>{editorFieldLabel(field, locale)}</span>{controls}</label>;
}
export function EditorNotice({ locale, title, children, alert = false }: { locale: EditorLocale; title: string; children?: ReactNode; alert?: boolean }) {
  return <div className={`edx112-editor-notice${alert ? " is-alert" : ""}`} role={alert ? "alert" : "status"} lang={locale}><strong>{title}</strong>{children}</div>;
}
export function EditorTarget({ locale, kind, initialId, onSelect }: { locale: EditorLocale; kind: "person" | "organization"; initialId: number | null; onSelect: (id: number) => void }) {
  const id = useId();
  const [value, setValue] = useState(initialId ? String(initialId) : "");
  const parse = () => Number(value.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)));
  const valid = isRegistryId(parse());
  return <form className="edx112-editor-target" onSubmit={event => { event.preventDefault(); if (valid) onSelect(parse()); }}>
    <label htmlFor={id}>{editorFieldLabel(kind === "person" ? "person_id" : "organization_id", locale)}</label>
    <div><input id={id} type="text" inputMode="numeric" autoComplete="off" required maxLength={16} value={value} onChange={event => setValue(event.target.value)} aria-describedby={`${id}-help`} /><button type="submit" disabled={!valid}>{editorText(locale, "Open record", "باز کردن سابقه")}</button></div>
    <small id={`${id}-help`}>{editorText(locale, "Choose the existing registry record you want to manage. Access is checked for your account.", "سابقه موجودی را که می‌خواهید مدیریت کنید انتخاب کنید. دسترسی حساب شما بررسی می‌شود.")}</small>
  </form>;
}
export function EditorServices({ locale, value, onChange }: { locale: EditorLocale; value: string[]; onChange: (value: string[]) => void }) {
  return <fieldset className="edx112-editor-choice-group"><legend>{editorFieldLabel("service_categories", locale)}</legend><div className="edx112-editor-checks">{SERVICE_CATEGORIES.map(category => <label key={category.id}><input type="checkbox" checked={value.includes(category.id)} onChange={event => onChange(event.target.checked ? [...value, category.id] : value.filter(id => id !== category.id))} /><span>{serviceCategoryLabel(category.id, locale)}</span></label>)}</div></fieldset>;
}
export function EditorProvince({ locale, value, onChange }: { locale: EditorLocale; value: string; onChange: (value: string) => void }) {
  return <EditorField field="province_code" locale={locale}><select value={value} onChange={event => onChange(event.target.value)}><option value="">{editorText(locale, "Not recorded", "ثبت نشده")}</option>{IRAN_PROVINCES.map(province => <option value={province.code} key={province.code}>{provinceLabel(province.code, locale)}</option>)}</select></EditorField>;
}
export function EditorConflict({ locale, differences, reconsentRequired, onReconsent, onRetry, onAdopt }: {
  locale: EditorLocale; differences: Array<{ field: string; local: string; server: string }>; reconsentRequired: boolean;
  onReconsent: () => void; onRetry: () => void; onAdopt: () => void;
}) {
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  return <div className="edx112-editor-conflict" role="alert"><h3>{L("This record changed while you were editing", "این سابقه هنگام ویرایش شما تغییر کرده است")}</h3><p>{L("Your draft is preserved. Review the differences before saving against the current revision.", "پیش‌نویس شما حفظ شده است. پیش از ذخیره با نسخه فعلی، تفاوت‌ها را بررسی کنید.")}</p>
    <dl>{differences.map(difference => <div key={difference.field}><dt>{editorFieldLabel(difference.field, locale)}</dt><dd><span>{L("Your draft", "پیش‌نویس شما")}</span><p dir="auto">{difference.local || "—"}</p><span>{L("Current record", "سابقه فعلی")}</span><p dir="auto">{difference.server || "—"}</p></dd></div>)}</dl>
    {reconsentRequired ? <><p>{L("Publication consent was withdrawn. It will only be renewed with your explicit agreement.", "رضایت انتشار پس گرفته شده است. تمدید آن فقط با موافقت صریح شما انجام می‌شود.")}</p><button type="button" onClick={onReconsent}>{L("Renew my publication consent", "تمدید رضایت انتشار من")}</button></> : <div className="edx112-editor-actions"><button type="button" onClick={onRetry}>{L("Save my draft against this revision", "ذخیره پیش‌نویس با این نسخه")}</button><button type="button" className="secondary" onClick={onAdopt}>{L("Use current record values", "استفاده از مقادیر سابقه فعلی")}</button></div>}
  </div>;
}
