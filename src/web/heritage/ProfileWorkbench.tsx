import { uiText, type UiLocale } from "../../shared/uiLocale";
import "../styles/heritage.workbenches.css";
import React from "react";
import { editorFieldLabel, editorPublicationLabel, editorClaimStatusLabel } from "../../frontend-kit";
import {
  useProfileEditorController,
  useDirectoryClaimFlow,
  useMyDirectoryClaims,
  DIRECTORY_CLAIM_EXPLAINER,
  type ProfileEditorDraft,
  type ProfileEditorState,
} from "../../frontend-kit";
import type { PlatformClient } from "../../contracts/platform";
import { IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel, PROVINCE_CODE_SCHEME } from "../../directory/vocabulary";
import { useI18n } from "../i18n";

/**
 * R98-N06 — Heritage's person-profile workbench: the representative's editor
 * and the claim center, in Heritage's own visual language over the ONE shared
 * headless controller (useProfileEditorController). Every state is distinct:
 * loading / denied / unavailable / empty (first creation) / ready / saving /
 * saved / conflict. Private contact renders ONLY with private-contact
 * permission; a conflict shows field-level differences and never auto-
 * resubmits a publication choice withdrawn on the server.
 */

function StateNotice({ state, retry, L }: { state: ProfileEditorState; retry: () => void; L: (en: string, fa: string) => string }) {
  if (state.phase === "loading") return <p role="status" className="h-mod-state-note">{L("Loading the manageable profile…", "در حال بارگذاری نمایه قابل مدیریت…")}</p>;
  if (state.phase === "denied") {
    return (
      <div role="alert" className="h-mod-state-note">
        <p>{L("This account cannot manage the profile.", "این حساب نمی‌تواند نمایه را مدیریت کند.")}</p>
        <p dir="auto">{state.reason}</p>
        <p>{L("An approved directory claim (verified person link) is required. Claims are moderated.", "نیاز به درخواست تأییدشده فهرست متخصصان (پیوند شخصی تأییدشده) است. درخواست‌ها بازبینی می‌شوند.")}</p>
      </div>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <div role="alert" className="h-mod-state-note">
        <p>{L("The profile cannot be loaded right now.", "نمایه در حال حاضر قابل بارگذاری نیست.")}</p>
        <p dir="auto">{state.reason}</p>
        <button className="h-mod-btn" onClick={retry}>{L("Retry", "تلاش دوباره")}</button>
      </div>
    );
  }
  return null;
}

function TextField({ label, value, onChange, dir, disabled }: { label: string; value: string; onChange: (v: string) => void; dir?: "ltr" | "rtl"; disabled?: boolean }) {
  return (
    <label className="h-mod-field">
      <span>{label}</span>
      <input dir={dir ?? "auto"} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function HeritageProfileWorkbench({ personId, platform }: { personId: number | null; platform: PlatformClient | null }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const { state, updateDraft, submit, reconsentPublication, takeServerValues, retryWithCurrentVersion, retry } = useProfileEditorController(personId, platform);
  const claimFlow = useDirectoryClaimFlow(platform);
  const myClaims = useMyDirectoryClaims(platform);

  const draftOf = (state: ProfileEditorState): ProfileEditorDraft | null =>
    state.phase === "empty" || state.phase === "ready" || state.phase === "saving" || state.phase === "saved" || state.phase === "conflict" ? state.draft : null;
  const draft = draftOf(state);
  const permissions = state.phase === "loading" || state.phase === "denied" || state.phase === "unavailable" ? null : state.permissions;
  const setDraft = (mutate: (d: ProfileEditorDraft) => ProfileEditorDraft) => updateDraft(mutate);

  return (
    <section className="h-mod-workbench" aria-labelledby="profile-workbench-title">
      <h2 id="profile-workbench-title">{personId == null ? L("Representation & claims", "نمایندگی و درخواست‌ها") : L("Profile workbench", "میز کار نمایه")}</h2>
      <p className="h-mod-note">
        {L("Publication needs your explicit consent and is one-way withdrawable. The stored version protects every edit against silent overwrites.",
           "انتشار نیازمند رضایت صریح شماست و بازپس‌گیری آن یک‌طرفه است. نسخه ذخیره‌شده هر ویرایش را در برابر بازنویسی بی‌صدا محافظت می‌کند.")}
      </p>

      {personId != null && <StateNotice state={state} retry={retry} L={L} />}

      {permissions && permissions.edit && draft ? (
        <>
          {state.phase === "empty" ? (
            <p role="status" className="h-mod-state-note">{L("No published profile exists yet — you are creating it for the first time.", "هنوز نمایه منتشرشده‌ای وجود ندارد — برای نخستین بار آن را می‌سازید.")}</p>
          ) : null}
          {state.phase === "saved" ? (
            <p role="status" className="h-mod-state-note h-mod-saved">{L("Saved. ", "ذخیره شد. ")}{uiText(locale, editorPublicationLabel(state.publication, "en"), editorPublicationLabel(state.publication, "fa"))}</p>
          ) : null}
          {state.phase === "conflict" ? (
            <div role="alert" className="h-mod-conflict">
              <p>{L("The profile changed elsewhere. Your draft is kept; review the differences field by field.", "نمایه در جای دیگری تغییر کرده است. پیش‌نویس شما نگه داشته شد؛ تفاوت‌ها را فیلد به فیلد بررسی کنید.")}</p>
              <ul>
                {state.differences.map((difference) => (
                  <li key={difference.field}>
                    <strong>{uiText(locale, editorFieldLabel(difference.field, "en"), editorFieldLabel(difference.field, "fa"))}</strong>: <span dir="auto">{L("your draft", "پیش‌نویس شما")}: {difference.local}</span> / <span dir="auto">{L("current", "فعلی")}: {difference.server}</span>
                  </li>
                ))}
              </ul>
              {state.reconsentRequired ? (
                <div className="h-mod-reconsent">
                  <p>{L("Publication consent was WITHDRAWN on the server. Your old choice is never resubmitted automatically.", "رضایت انتشار در سرور بازپس‌گیری شده است. انتخاب قبلی شما هرگز به‌طور خودکار ارسال نمی‌شود.")}</p>
                  <button className="h-mod-btn" onClick={reconsentPublication}>{L("I re-consent to publication", "بار دیگر با انتشار موافقم")}</button>
                </div>
              ) : (
                <div className="h-mod-conflict-actions">
                  <button className="h-mod-btn" onClick={retryWithCurrentVersion}>{L("Keep my draft and retry with the current version", "پیش‌نویس من را نگه دار و با نسخه فعلی دوباره تلاش کن")}</button>
                  <button className="h-mod-btn" onClick={takeServerValues}>{L("Take the current values instead", "به‌جای آن مقادیر فعلی را بپذیر")}</button>
                </div>
              )}
            </div>
          ) : null}

          <fieldset className="h-mod-fieldset" disabled={state.phase === "saving"}>
            <legend>{L("Services & reach", "خدمات و دسترس‌پذیری")}</legend>
            <div className="h-mod-field" role="group" aria-label={L("Service categories", "دسته‌های خدمت")}>
              <span>{L("Service categories", "دسته‌های خدمت")}</span>
              <div className="h-mod-categories">
                {SERVICE_CATEGORIES.map((category) => (
                  <label key={category.id} className="h-mod-check">
                    <input type="checkbox" checked={draft.service_categories.includes(category.id)}
                      onChange={(e) => setDraft((d) => ({ ...d, service_categories: e.target.checked ? [...d.service_categories, category.id] : d.service_categories.filter((c) => c !== category.id) }))} />
                    <span>{uiText(locale, serviceCategoryLabel(category.id, "en"), serviceCategoryLabel(category.id, "fa"))}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="h-mod-field">
              <span>{L("Province", "استان")}</span>
              <select value={draft.province_code} onChange={(e) => setDraft((d) => ({ ...d, province_code: e.target.value, province_scheme_confirmed: e.target.value !== "" }))}>
                <option value="">{L("(not specified)", "(نامشخص)")}</option>
                {IRAN_PROVINCES.map((province) => (
                  <option key={province.code} value={province.code}>{provinceLabel(province.code, locale === "fa" ? "fa" : "en")}</option>
                ))}
              </select>
              {draft.province_code ? (
                <small>{L(`Confirmed under the current reference dataset (${PROVINCE_CODE_SCHEME}).`, `تأییدشده بر پایه مجموعه‌داده مرجع فعلی (${PROVINCE_CODE_SCHEME}).`)}</small>
              ) : null}
            </label>
            <TextField label={L("City", "شهر")} value={draft.city} onChange={(city) => setDraft((d) => ({ ...d, city }))} />
            <label className="h-mod-field">
              <span>{L("Contact preference", "ترجیح تماس")}</span>
              <select value={draft.contact_preference} onChange={(e) => setDraft((d) => ({ ...d, contact_preference: e.target.value as ProfileEditorDraft["contact_preference"] }))}>
                <option value="platform_message">{L("Platform message (mediated)", "پیام سامانه‌ای (میانجی‌شده)")}</option>
                <option value="phone">{L("Phone", "تلفن")}</option>
                <option value="email">{L("Email", "ایمیل")}</option>
              </select>
            </label>
            {permissions.private_contact ? (
              <TextField label={L("Private contact (visible to you only until you publish it)", "تماس خصوصی (تا پیش از انتشار فقط برای شما)")} value={draft.contact_value}
                onChange={(contact_value) => setDraft((d) => ({ ...d, contact_value }))} dir="ltr" />
            ) : (
              <p className="h-mod-note">{L("You are curating this profile. The private contact route belongs to the verified representative and is not shown or editable here.", "شما این نمایه را ویرایش می‌کنید. مسیر تماس خصوصی متعلق به نماینده تأییدشده است و اینجا نمایش یا ویرایش نمی‌شود.")}</p>
            )}
            <TextField label={L("Languages", "زبان‌ها")} value={draft.languages} onChange={(languages) => setDraft((d) => ({ ...d, languages }))} />
            <TextField label={L("Availability / biography", "دسترس‌پذیری / زندگی‌نامه")} value={draft.availability_text} onChange={(availability_text) => setDraft((d) => ({ ...d, availability_text }))} />
            <label className="h-mod-check">
              <input type="checkbox" checked={draft.publication_consent} onChange={(e) => setDraft((d) => ({ ...d, publication_consent: e.target.checked }))} />
              <span>{L("I consent to publishing this profile in the public directory (withdrawable at any time)", "با انتشار این نمایه در فهرست عمومی موافقم (قابل بازپس‌گیری در هر زمان)")}</span>
            </label>
          </fieldset>
          <div className="h-mod-actions">
            <button className="h-mod-btn h-mod-primary" onClick={submit} disabled={state.phase === "saving" || (state.phase === "conflict" && state.reconsentRequired)}>
              {state.phase === "saving" ? L("Saving…", "در حال ذخیره…") : L("Save profile", "ذخیره نمایه")}
            </button>
          </div>
        </>
      ) : null}

      <hr className="h-mod-rule" />
      <h3>{L("Representation & claims", "نمایندگی و درخواست‌ها")}</h3>
      <ul className="h-mod-explainer">
        {DIRECTORY_CLAIM_EXPLAINER.map((entry) => (
          <li key={entry.concept}><span dir="auto">{locale === "fa" ? entry.fa : entry.en}</span></li>
        ))}
      </ul>
      <ClaimForm key={personId ?? "claim-center"} personId={personId} claimFlow={claimFlow} myClaims={myClaims} L={L} locale={locale} />
    </section>
  );
}

function ClaimForm({ personId, claimFlow, myClaims, L, locale }: {
  personId: number | null;
  locale: UiLocale;
  claimFlow: ReturnType<typeof useDirectoryClaimFlow>;
  myClaims: ReturnType<typeof useMyDirectoryClaims>;
  L: (en: string, fa: string) => string;
}) {
  const [evidence, setEvidence] = React.useState("");
  const [recoveryRequested, setRecoveryRequested] = React.useState(false);
  const [personInput, setPersonInput] = React.useState(personId == null ? "" : String(personId));
  const targetPerson = personId ?? Number(personInput);
  const validPerson = Number.isSafeInteger(targetPerson) && targetPerson > 0;
  const blocked = claimFlow.state.phase === "submitting" || claimFlow.state.phase === "failed";
  const submittedId = claimFlow.state.phase === "submitted" ? claimFlow.state.claim.id : null;
  React.useEffect(() => { if (submittedId != null) myClaims.retry(); }, [submittedId]);
  return (
    <div className="h-mod-claim-flow">
      <fieldset className="h-mod-fieldset">
        <legend>{L("File a directory claim", "ثبت درخواست فهرست متخصصان")}</legend>
        <label className="h-mod-field"><span>{L("Person registry ID", "شناسه شخص در سامانه")}</span><input type="number" min="1" step="1" inputMode="numeric" required readOnly={personId != null} disabled={blocked} value={personInput} onChange={event => setPersonInput(event.target.value)} /></label>
        <p className="h-mod-note">{L("Use the person’s registry ID and explain your connection. Staff review the evidence before granting representation.", "شناسه شخص را وارد کرده و پیوند خود با او را توضیح دهید. کارکنان پیش از اعطای نمایندگی شواهد را بررسی می‌کنند.")}</p>
        <label className="h-mod-field">
          <span>{L("Evidence note (how you are linked to this person; staff reviews it)", "یادداشت مدرک (پیوند شما با این شخص چگونه است؛ کارکنان بازبینی می‌کنند)")}</span>
          <textarea disabled={blocked} dir="auto" value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={3} maxLength={2000} />
        </label>
        <button className="h-mod-btn" disabled={blocked || !validPerson || evidence.trim().length < 10}
          onClick={() => claimFlow.submitClaim({ claim_type: "person", person_id: targetPerson, evidence_note: evidence.trim() })}>
          {claimFlow.state.phase === "submitting" ? L("Submitting…", "در حال ارسال…") : L("Submit claim for moderation", "ارسال درخواست برای بازبینی")}
        </button>
        {claimFlow.state.phase === "submitted" ? (
          <p role="status" className="h-mod-state-note">{claimFlow.state.note}</p>
        ) : null}
        {claimFlow.state.phase === "rejected" ? (
          <p role="alert" className="h-mod-state-note">{L("Refused", "رد شد")}: {claimFlow.state.message}</p>
        ) : null}
        {claimFlow.state.phase === "failed" ? (
          <div role="alert" className="h-mod-state-note"><p>{L("The result is unknown. Your evidence is preserved. Reload your claims and check for this request before starting another submission.", "نتیجه نامشخص است. شواهد شما حفظ شده است. پیش از ارسال دوباره، درخواست‌ها را بازخوانی کرده و این درخواست را بررسی کنید.")}</p><button type="button" onClick={() => { setRecoveryRequested(true); myClaims.retry(); }}>{L("Reload my claims", "بازخوانی درخواست‌های من")}</button>{recoveryRequested && !myClaims.loading && !myClaims.unavailable && <button type="button" onClick={() => { setRecoveryRequested(false); claimFlow.reset(); }}>{L("I checked my claims; allow another submission", "درخواست‌ها را بررسی کردم؛ اجازه ارسال دوباره")}</button>}</div>
        ) : null}
      </fieldset>
      <div className="h-mod-my-claims">
        <h4>{L("My claims", "درخواست‌های من")}</h4>
        {myClaims.loading ? <p role="status" className="h-mod-state-note">{L("Loading…", "در حال بارگذاری…")}</p> : null}
        {myClaims.unavailable ? <p role="alert" className="h-mod-state-note">{myClaims.unavailable} <button className="h-mod-btn" onClick={myClaims.retry}>{L("Retry", "تلاش دوباره")}</button></p> : null}
        {!myClaims.loading && !myClaims.unavailable && myClaims.claims.length === 0 ? (
          <p className="h-mod-note">{L("No claims filed yet.", "هنوز درخواستی ثبت نشده است.")}</p>
        ) : null}
        <ul>
          {myClaims.claims.map((claim) => (
            <li key={claim.id}>
              <span>#{claim.id} — {uiText(locale, editorClaimStatusLabel(claim.status, "en"), editorClaimStatusLabel(claim.status, "fa"))}</span>
              {claim.review_note ? <small dir="auto">{claim.review_note}</small> : null}
              {claim.appealable ? (
                <button className="h-mod-btn" disabled={blocked || evidence.trim().length < 10} onClick={() => claimFlow.submitClaim({
                  claim_type: claim.claim_type === "organization" ? "organization" : "person",
                  person_id: claim.person_id, organization_id: claim.organization_id,
                  evidence_note: evidence.trim(),
                  appeal_for_claim_id: claim.id,
                })}>{L("Appeal once", "تجدیدنظر یک‌باره")}</button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
