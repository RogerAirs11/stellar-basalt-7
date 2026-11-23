import { uiText } from "../../shared/uiLocale";
import "../styles/heritage.workbenches.css";
import React from "react";
import { editorFieldLabel, editorPublicationLabel, editorWeekdayLabel, type PlatformUser } from "../../frontend-kit";
import {
  useOrganizationEditorController,
  ORGANIZATION_ONBOARDING_EXPLAINER,
  type OrganizationEditorDraft,
  type OrganizationEditorState,
} from "../../frontend-kit";
import { HeritageMyOrganizationInvitations, HeritageOrganizationStaffPanel } from "./OrganizationStaffPanel";
import type { PlatformClient } from "../../contracts/platform";
import { IRAN_PROVINCES, SERVICE_CATEGORIES, provinceLabel, PROVINCE_CODE_SCHEME } from "../../directory/vocabulary";
import { useI18n } from "../i18n";

/**
 * R98-N07 — Heritage's organization workbench: current staff edit the legal
 * organization's public profile (services, specialties, service areas,
 * accessibility, opening hours, contact preferences) over the ONE shared
 * headless controller (useOrganizationEditorController). Entity separation is
 * visible in the copy: an account is not the organization; officials are
 * persons, not staff roles. Every state is distinct; private contact renders
 * ONLY with current-staff permission; conflicts show field-level differences
 * and never auto-resubmit a withdrawn publication consent.
 */

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function StateNotice({ state, retry, L }: { state: OrganizationEditorState; retry: () => void; L: (en: string, fa: string) => string }) {
  if (state.phase === "loading") return <p role="status" className="h-mod-state-note">{L("Loading the manageable organization…", "در حال بارگذاری سازمان قابل مدیریت…")}</p>;
  if (state.phase === "denied") {
    return (
      <div role="alert" className="h-mod-state-note">
        <p>{L("This account cannot manage the organization.", "این حساب نمی‌تواند سازمان را مدیریت کند.")}</p>
        <p dir="auto">{state.reason}</p>
        <p>{L("Only CURRENT staff (or the editorial desk) may manage an organization. A former employee retains nothing.", "فقط کارکنان جاری (یا میز تحریریه) می‌توانند سازمان را مدیریت کنند. کارمند سابق هیچ دسترسی‌ای ندارد.")}</p>
      </div>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <div role="alert" className="h-mod-state-note">
        <p>{L("The organization editor is unavailable.", "ویرایشگر سازمان در دسترس نیست.")}</p>
        <p dir="auto">{state.reason}</p>
        <button type="button" className="h-mod-button" onClick={retry}>{L("Retry", "تلاش دوباره")}</button>
      </div>
    );
  }
  return null;
}

export function OrganizationWorkbench({ organizationId, platform, user, scope }: { organizationId: number | null; platform: PlatformClient | null; user?: PlatformUser | null; scope?: string }) {
  const { state, updateDraft, submit, reconsentPublication, adoptAllServerValues, retryWithCurrentVersion, retry } = useOrganizationEditorController(organizationId, platform);
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const setDraft = (mutate: (d: OrganizationEditorDraft) => OrganizationEditorDraft) => updateDraft(mutate);
  const draftOf = (state: OrganizationEditorState): OrganizationEditorDraft | null =>
    state.phase === "empty" || state.phase === "ready" || state.phase === "saving" || state.phase === "saved" || state.phase === "conflict" ? state.draft : null;
  const permissions = state.phase === "loading" || state.phase === "denied" || state.phase === "unavailable" ? null : state.permissions;
  const storedVersion = (state: OrganizationEditorState): number =>
    state.phase === "ready" || state.phase === "saving" || state.phase === "saved" || state.phase === "conflict" ? state.stored?.row_version ?? 0 : 0;
  const editable = permissions !== null && permissions.edit && draftOf(state) !== null;
  const saving = state.phase === "saving";
  const conflictBlocked = state.phase === "conflict" && state.reconsentRequired;

  return (
    <section className="h-mod-workbench" aria-labelledby="organization-workbench-title">
      <h2 id="organization-workbench-title">{L("Organization workbench", "میز کار سازمان")}</h2>
      <p className="h-mod-note">
        {L("Only CURRENT staff may edit the organization; a former employee retains nothing. Judge, steward, ringmaster and disciplinary committee are person-level officiating roles, never staff roles.",
           "فقط کارکنان جاری می‌توانند سازمان را ویرایش کنند؛ کارمند سابق هیچ دسترسی‌ای ندارد. داور، سرپاست، رینگ‌مستر و کمیته انضباطی نقش‌های داوری شخص‌محورند، نه نقش کارمندان.")}
      </p>
      <StateNotice state={state} retry={retry} L={L} />
      {editable ? (() => { const draft = draftOf(state)!; return (
        <>
      <h3 className="h-mod-title">
        {state.phase === "empty"
          ? L("Organization profile — first creation", "نمایه سازمان — ایجاد اولیه")
          : L("Organization profile", "نمایه سازمان") + ` (v${storedVersion(state)})`}
      </h3>
      {state.phase === "saved" ? <p role="status" className="h-mod-state-note">{L("Saved — ", "ذخیره شد — ")}{uiText(locale, editorPublicationLabel(state.publication, "en"), editorPublicationLabel(state.publication, "fa"))}</p> : null}
      {state.phase === "conflict" ? (
        <div role="alert" className="h-mod-conflict">
          <p>{L("The organization changed elsewhere; your draft is kept. Reconcile field by field:", "سازمان در جای دیگری تغییر کرده؛ پیش‌نویس شما حفظ شده. فیلد به فیلد تطبیق دهید:")}</p>
          <ul>{state.differences.map((d) => <li key={d.field}><strong>{uiText(locale, editorFieldLabel(d.field, "en"), editorFieldLabel(d.field, "fa"))}</strong>: {L("draft", "پیش‌نویس")} “{d.local}” / {L("current", "فعلی")} “{d.server}”</li>)}</ul>
          {state.reconsentRequired ? (
            <>
              <p>{L("Publication consent was withdrawn on the server. Nothing is resubmitted automatically.", "رضایت انتشار در سرور پس گرفته شده. هیچ چیز خودکار دوباره ارسال نمی‌شود.")}</p>
              <button type="button" className="h-mod-button" onClick={reconsentPublication}>{L("Re-consent to publication", "رضایت دوباره انتشار")}</button>
            </>
          ) : (
            <>
              <button type="button" className="h-mod-button" onClick={retryWithCurrentVersion}>{L("Retry draft at current version", "تلاش پیش‌نویس با نسخه فعلی")}</button>{" "}
              <button type="button" className="h-mod-button" onClick={adoptAllServerValues}>{L("Adopt current values", "پذیرش مقادیر فعلی")}</button>
            </>
          )}
        </div>
      ) : null}

      <fieldset className="h-mod-editor-fields" disabled={saving}>
      <legend className="sr-only">{L("Organization profile fields", "فیلدهای نمایه سازمان")}</legend>
      <label className="h-mod-field"><span>{L("Description", "توضیحات")}</span>
        <textarea rows={3} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
      </label>
      <fieldset className="h-mod-fieldset h-mod-choice-grid"><legend>{L("Service categories", "دسته‌های خدمات")}</legend>
        {SERVICE_CATEGORIES.map((c) => (
          <label key={c.id} className="h-mod-check"><input type="checkbox" checked={draft.service_categories.includes(c.id)}
            onChange={(e) => setDraft((d) => ({ ...d, service_categories: e.target.checked ? [...d.service_categories, c.id] : d.service_categories.filter((x) => x !== c.id) }))} />{L(c.en, c.fa)}</label>
        ))}
      </fieldset>
      <label className="h-mod-field"><span>{L("Specialties (comma separated)", "تخصص‌ها (با ویرگول)")}</span>
        <input value={draft.specialties.join(", ")} onChange={(e) => setDraft((d) => ({ ...d, specialties: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))} />
      </label>
      <fieldset className="h-mod-fieldset h-mod-choice-grid"><legend>{L("Service areas (provinces)", "مناطق خدمت (استان‌ها)")}</legend>
        {IRAN_PROVINCES.map((p) => (
          <label key={p.code} className="h-mod-check"><input type="checkbox" checked={draft.service_areas.includes(p.code)}
            onChange={(e) => setDraft((d) => ({ ...d, service_areas: e.target.checked ? [...d.service_areas, p.code] : d.service_areas.filter((x) => x !== p.code) }))} />{L(provinceLabel(p.code, "en"), provinceLabel(p.code, "fa"))}</label>
        ))}
      </fieldset>
      <label className="h-mod-field"><span>{L("Accessibility information", "اطلاعات دسترس‌پذیری")}</span>
        <input value={draft.accessibility_notes} onChange={(e) => setDraft((d) => ({ ...d, accessibility_notes: e.target.value }))} />
      </label>
      <fieldset className="h-mod-fieldset"><legend>{L("Opening hours", "ساعات کاری")}</legend>
        {WEEKDAYS.map((day) => (
          <label key={day} className="h-mod-field"><span>{uiText(locale, editorWeekdayLabel(day, "en"), editorWeekdayLabel(day, "fa"))}</span>
            <input value={draft.opening_hours[day] ?? ""} placeholder={L("e.g. 08:00-14:00 or closed", "مثلاً ۰۸:۰۰-۱۴:۰۰ یا تعطیل")}
              onChange={(e) => setDraft((d) => ({ ...d, opening_hours: { ...d.opening_hours, [day]: e.target.value } }))} />
          </label>
        ))}
      </fieldset>
      <label className="h-mod-field"><span>{L("Province", "استان")} [{PROVINCE_CODE_SCHEME}]</span>
        <select value={draft.province_code} onChange={(e) => setDraft((d) => ({ ...d, province_code: e.target.value, province_scheme_confirmed: e.target.value !== "" }))}>
          <option value="">{L("(not set)", "(تعیین نشده)")}</option>
          {IRAN_PROVINCES.map((p) => <option key={p.code} value={p.code}>{p.code} — {L(provinceLabel(p.code, "en"), provinceLabel(p.code, "fa"))}</option>)}
        </select>
      </label>
      <label className="h-mod-field"><span>{L("City", "شهر")}</span>
        <input value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} />
      </label>
      <label className="h-mod-field"><span>{L("Contact preference", "ترجیح تماس")}</span>
        <select value={draft.contact_preference} onChange={(e) => setDraft((d) => ({ ...d, contact_preference: e.target.value as OrganizationEditorDraft["contact_preference"] }))}>
          <option value="platform_message">{L("Platform message", "پیام سامانه")}</option>
          <option value="phone">{L("Phone", "تلفن")}</option>
          <option value="email">{L("Email", "ایمیل")}</option>
        </select>
      </label>
      {permissions.private_contact ? (
        <label className="h-mod-field"><span>{L("Contact value (private, current staff only)", "مقدار تماس (خصوصی، فقط کارکنان جاری)")}</span>
          <input dir="ltr" value={draft.contact_value} onChange={(e) => setDraft((d) => ({ ...d, contact_value: e.target.value }))} />
        </label>
      ) : (
        <p className="h-mod-state-note">{L("Curator mode: the contact route is the organization's private field — not loaded, not rendered, not submitted.", "حالت سرپرستی: مسیر تماس فیلد خصوصی سازمان است — بارگذاری، نمایش یا ارسال نمی‌شود.")}</p>
      )}
      <label className="h-mod-check"><input type="checkbox" checked={draft.publication_consent} onChange={(e) => setDraft((d) => ({ ...d, publication_consent: e.target.checked }))} />
        {L("Publication consent (withdrawable at any time)", "رضایت انتشار (هر زمان قابل پس‌گیری)")}
      </label>
      </fieldset>
      <button type="button" className="h-mod-button primary" onClick={submit} disabled={saving || conflictBlocked}>
        {state.phase === "saving" ? L("Saving…", "در حال ذخیره…") : L("Save organization profile", "ذخیره نمایه سازمان")}
      </button>

      <h4 className="h-mod-subtitle">{L("Who is who", "هر کدام کیست")}</h4>
      <ul className="h-mod-explainer">
        {ORGANIZATION_ONBOARDING_EXPLAINER.map((entry) => <li key={entry.concept} dir="auto">{L(entry.en, entry.fa)}</li>)}
      </ul>
      <p className="h-mod-state-note">{L("Judge, steward, ringmaster and disciplinary committee are person-level officiating roles recorded through current credentials — never organization staff roles.", "داور، سرپاست، رینگ‌مستر و کمیته انضباطی نقش‌های داوری شخص‌محورند که با مدرک جاری ثبت می‌شوند — نه نقش کارمندان سازمان.")}</p>
        </>
      ); })() : null}
      {organizationId !== null ? <HeritageOrganizationStaffPanel organizationId={organizationId} platform={platform} user={user} scope={scope} /> : null}
      <HeritageMyOrganizationInvitations platform={platform} user={user} scope={scope} />
    </section>
  );
}
