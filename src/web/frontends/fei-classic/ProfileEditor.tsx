import { useEffect, useState } from "react";
import { useProfileEditorController, useDirectoryClaimFlow, useMyDirectoryClaims, usePrincipalScope, useScopedState, DIRECTORY_CLAIM_EXPLAINER, type ProfileEditorDraft, type PlatformClient, type PlatformUser, pick } from "../../../frontend-kit";
import { editorPublicationLabel, editorClaimStatusLabel } from "../../../frontend-kit";
import { EditorTarget, EditorField, EditorNotice, EditorConflict, EditorServices, EditorProvince, editorText, type EditorLocale } from "./editorUi";

type Props = { personId: number | null; platform: PlatformClient | null; user?: PlatformUser | null; locale?: EditorLocale };
export function FeiClassicProfileEditor({ personId, platform, user, locale = "en" }: Props) {
  const scope = usePrincipalScope(user, null);
  const [selectedId, setSelectedId] = useScopedState<number | null>(`${scope}:${personId ?? "select"}`, personId);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  return <section className="fc112-editor" aria-label={L("Professional profile editor", "ویرایشگر نمایه متخصص")}>
    <h2>{L("Professional profile", "نمایه متخصص")}</h2>
    <p>{L("Manage directory information, private contact preferences, and publication consent for an existing person.", "اطلاعات فهرست، روش تماس خصوصی و رضایت انتشار یک شخص موجود را مدیریت کنید.")}</p>
    {!user ? <EditorNotice locale={locale} title={L("Sign in to manage a profile", "برای مدیریت نمایه وارد شوید")}><a href="/f/fei-classic/auth">{L("Sign in", "ورود")}</a></EditorNotice> : <>
      <EditorTarget key={`${scope}:${personId ?? "select"}`} locale={locale} kind="person" initialId={personId} onSelect={setSelectedId}/>
      {selectedId ? <ManagedProfile key={`${scope}:${selectedId}`} personId={selectedId} platform={platform} user={user} locale={locale}/> : <EditorNotice locale={locale} title={L("Choose a person to begin", "برای شروع یک شخص انتخاب کنید")}/>}
      <ProfileClaims key={`${scope}:${selectedId ?? "none"}`} personId={selectedId} platform={platform} user={user} locale={locale}/>
    </>}
  </section>;
}

function ManagedProfile({ personId, platform, user, locale = "en" }: Props & { personId: number }) {
  const principalScope = usePrincipalScope(user, null);
  const { state, updateDraft, submit, reconsentPublication, takeServerValues, retryWithCurrentVersion, retry } = useProfileEditorController(personId, platform, principalScope);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  if (state.phase === "loading") return <EditorNotice locale={locale} title={L("Loading profile…", "بارگذاری نمایه…")}/>;
  if (state.phase === "denied") return <EditorNotice locale={locale} alert title={L("Your account cannot manage this profile yet", "حساب شما هنوز نمی‌تواند این نمایه را مدیریت کند")}><p dir="auto">{state.reason}</p><p>{L("You can request representation below. Approval is required before editing private information.", "می‌توانید در پایین درخواست نمایندگی بدهید. ویرایش اطلاعات خصوصی به تأیید نیاز دارد.")}</p></EditorNotice>;
  if (state.phase === "unavailable") return <EditorNotice locale={locale} alert title={L("The profile could not be loaded", "نمایه بارگذاری نشد")}><p dir="auto">{state.reason}</p><button type="button" onClick={retry}>{L("Try loading again", "تلاش دوباره برای بارگذاری")}</button></EditorNotice>;
  const { draft, permissions } = state;
  const setDraft = (mutate: (draft: ProfileEditorDraft) => ProfileEditorDraft) => updateDraft(mutate);
  const saving = state.phase === "saving";
  return <>
    <div className="fc112-editor-meta"><span>{L("Person", "شخص")} <bdi>#{personId}</bdi></span><span>{state.phase === "empty" ? L("New directory profile", "نمایه تازه در فهرست") : `${L("Revision", "نسخه")} ${state.stored?.row_version ?? 0}`}</span></div>
    {state.phase === "saved" && <EditorNotice locale={locale} title={L("Profile saved", "نمایه ذخیره شد")}><p>{editorPublicationLabel(state.publication, locale)}</p></EditorNotice>}
    {state.phase === "conflict" && <EditorConflict locale={locale} differences={state.differences} reconsentRequired={state.reconsentRequired} onReconsent={reconsentPublication} onRetry={retryWithCurrentVersion} onAdopt={takeServerValues}/>}
    <form className="fc112-editor-form" onSubmit={event => { event.preventDefault(); if (!saving && permissions.edit) void submit(); }}>
      <fieldset disabled={saving || !permissions.edit} className="fc112-editor-fields"><legend className="fc112-editor-legend">{L("Directory information", "اطلاعات فهرست")}</legend>
        <EditorServices locale={locale} value={draft.service_categories} onChange={service_categories => setDraft(d => ({ ...d, service_categories }))}/>
        <div className="fc112-editor-grid"><EditorProvince locale={locale} value={draft.province_code} onChange={province_code => setDraft(d => ({ ...d, province_code, province_scheme_confirmed: province_code !== "" }))}/><EditorField locale={locale} field="city"><input dir="auto" value={draft.city} onChange={event => setDraft(d => ({ ...d, city: event.target.value }))}/></EditorField></div>
        <EditorField locale={locale} field="contact_preference"><select value={draft.contact_preference} onChange={event => setDraft(d => ({ ...d, contact_preference: event.target.value as ProfileEditorDraft["contact_preference"] }))}><option value="platform_message">{L("Platform message", "پیام سامانه")}</option><option value="phone">{L("Telephone", "تلفن")}</option><option value="email">{L("Email", "ایمیل")}</option></select></EditorField>
        {permissions.private_contact ? <EditorField locale={locale} field="contact_value"><input dir="ltr" autoComplete="off" value={draft.contact_value} onChange={event => setDraft(d => ({ ...d, contact_value: event.target.value }))}/></EditorField> : <p className="fc112-editor-note">{L("Private contact details are available only to the authorized representative.", "اطلاعات تماس خصوصی فقط در دسترس نماینده مجاز است.")}</p>}
        <EditorField locale={locale} field="languages"><input dir="auto" value={draft.languages} onChange={event => setDraft(d => ({ ...d, languages: event.target.value }))}/></EditorField>
        <EditorField locale={locale} field="availability_text"><textarea rows={3} dir="auto" value={draft.availability_text} onChange={event => setDraft(d => ({ ...d, availability_text: event.target.value }))}/></EditorField>
        <label className="fc112-editor-check"><input type="checkbox" checked={draft.publication_consent} disabled={!permissions.initial_publication && !draft.publication_consent} onChange={event => setDraft(d => ({ ...d, publication_consent: event.target.checked }))}/><span>{L("I consent to publishing this profile in the professional directory. I can withdraw this consent later.", "با انتشار این نمایه در فهرست متخصصان موافقم. می‌توانم بعداً این رضایت را پس بگیرم.")}</span></label>
      </fieldset>
      <button type="submit" disabled={saving || !permissions.edit || (state.phase === "conflict" && state.reconsentRequired)}>{saving ? L("Saving…", "ذخیره…") : L("Save profile", "ذخیره نمایه")}</button>
    </form>
  </>;
}

function ProfileClaims({ personId, platform, user, locale = "en" }: Props) {
  const scope = usePrincipalScope(user, null);
  const claims = useMyDirectoryClaims(platform, scope);
  const flow = useDirectoryClaimFlow(platform, scope);
  const [evidence, setEvidence] = useState("");
  const [appealId, setAppealId] = useState<number | null>(null);
  const [checkedUnknown, setCheckedUnknown] = useState(false);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  useEffect(() => { if (flow.state.phase === "submitted") { setEvidence(""); claims.retry(); } }, [flow.state.phase, claims.retry]);
  const appeal = appealId === null ? null : claims.claims.find(claim => claim.id === appealId) ?? null;
  const targetId = appeal ? appeal.person_id : personId;
  const alreadyPending = !appeal && claims.claims.some(claim => claim.claim_type === "person" && claim.person_id === targetId && claim.status === "pending");
  const locked = flow.state.phase === "submitting" || flow.state.phase === "failed" || flow.state.phase === "submitted";
  const canSubmit = !!targetId && evidence.trim().length >= 10 && !locked && !alreadyPending && !claims.loading && !claims.unavailable;
  return <section className="fc112-editor-claims" aria-label={L("Representation requests", "درخواست‌های نمایندگی")}>
    <h3>{L("Representation and claims", "نمایندگی و درخواست‌ها")}</h3>
    <details><summary>{L("What representation means", "نمایندگی چه معنایی دارد")}</summary><ul>{DIRECTORY_CLAIM_EXPLAINER.map(entry => <li key={entry.concept}>{pick(entry, locale)}</li>)}</ul></details>
    {personId || appeal ? <form onSubmit={event => { event.preventDefault(); if (!canSubmit) return; flow.submitClaim({ claim_type: "person", person_id: targetId, evidence_note: evidence.trim(), ...(appeal ? { appeal_for_claim_id: appeal.id } : {}) }); }}>
      <h4>{appeal ? `${L("Appeal claim", "اعتراض به درخواست")} #${appeal.id}` : `${L("Request representation for person", "درخواست نمایندگی شخص")} #${personId}`}</h4>
      <EditorField locale={locale} field="evidence_note"><textarea rows={4} dir="auto" required minLength={10} maxLength={2000} disabled={locked} value={evidence} onChange={event => setEvidence(event.target.value)}/><small>{L("Explain your connection to this person in 10–2,000 characters. An appeal needs your own additional evidence.", "پیوند خود با این شخص را در ۱۰ تا ۲۰۰۰ نویسه توضیح دهید. اعتراض به شواهد تکمیلی خود شما نیاز دارد.")}</small></EditorField>
      {alreadyPending && <p role="status">{L("A request for this person is already awaiting review.", "درخواست این شخص از پیش در انتظار بررسی است.")}</p>}
      <div className="fc112-editor-actions"><button type="submit" disabled={!canSubmit}>{flow.state.phase === "submitting" ? L("Submitting…", "ارسال…") : appeal ? L("Submit appeal", "ارسال اعتراض") : L("Submit representation request", "ارسال درخواست نمایندگی")}</button>{appeal && !locked && <button type="button" className="secondary" onClick={() => { setAppealId(null); setEvidence(""); }}>{L("Cancel appeal draft", "لغو پیش‌نویس اعتراض")}</button>}</div>
    </form> : <p>{L("Open a person record above to request representation.", "برای درخواست نمایندگی، سابقه شخص را در بالا باز کنید.")}</p>}
    {flow.state.phase === "submitted" && <EditorNotice locale={locale} title={L("Request recorded", "درخواست ثبت شد")}><p dir="auto">{flow.state.note}</p><button type="button" className="secondary" onClick={() => { flow.reset(); setAppealId(null); }}>{L("Finish reviewing this request", "پایان بررسی این درخواست")}</button></EditorNotice>}
    {flow.state.phase === "rejected" && <EditorNotice locale={locale} alert title={L("The request was not accepted", "درخواست پذیرفته نشد")}><p dir="auto">{flow.state.message}</p></EditorNotice>}
    {flow.state.phase === "failed" && <EditorNotice locale={locale} alert title={L("The result is not yet known", "نتیجه هنوز مشخص نیست")}><p dir="auto">{flow.state.message}</p><p>{L("Check your claims before starting another submission. A delayed request may still appear.", "پیش از ارسال دوباره، درخواست‌های خود را بررسی کنید. ممکن است درخواست با تأخیر نمایش داده شود.")}</p><div className="fc112-editor-actions"><button type="button" onClick={() => { setCheckedUnknown(true); claims.retry(); }}>{L("Read my claims again", "خواندن دوباره درخواست‌های من")}</button><button type="button" className="secondary" disabled={!checkedUnknown || claims.loading || !!claims.unavailable} onClick={() => { flow.reset(); setCheckedUnknown(false); }}>{L("Clear this attempt after checking", "پاک کردن این تلاش پس از بررسی")}</button></div></EditorNotice>}
    <div className="fc112-editor-section-head"><h4>{L("My claims", "درخواست‌های من")}</h4><button type="button" className="secondary" disabled={claims.loading} onClick={claims.retry}>{L("Refresh", "تازه‌سازی")}</button></div>
    {claims.loading ? <p role="status">{L("Loading claims…", "بارگذاری درخواست‌ها…")}</p> : claims.unavailable ? <p role="alert" dir="auto">{claims.unavailable}</p> : claims.claims.length === 0 ? <p>{L("You have not submitted a representation request.", "هنوز درخواست نمایندگی نفرستاده‌اید.")}</p> : <ul className="fc112-editor-claim-list">{claims.claims.map(claim => <li key={claim.id}>
      <strong><bdi>#{claim.id}</bdi> · {editorClaimStatusLabel(claim.status, locale)}</strong><p>{claim.claim_type === "organization" ? L("Organization", "سازمان") : L("Person", "شخص")} <bdi>#{(claim.claim_type === "organization" ? claim.organization_id : claim.person_id) ?? "—"}</bdi></p>{claim.review_note && <p dir="auto">{claim.review_note}</p>}
      {claim.appealable && claim.claim_type === "person" && claim.person_id && !claims.claims.some(other => other.appeal_for_claim_id === claim.id) && <button type="button" className="secondary" disabled={locked} onClick={() => { setAppealId(claim.id); setEvidence(""); flow.reset(); }}>{L("Write appeal evidence", "نوشتن شواهد اعتراض")}</button>}
    </li>)}</ul>}
  </section>;
}
