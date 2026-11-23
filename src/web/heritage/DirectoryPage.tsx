import { uiText, engineUiLocale} from "../../shared/uiLocale";
import "../styles/heritage.workbenches.css";
import React, { useMemo, useState } from "react";
import type { PlatformClient, PlatformUser } from "../../contracts/platform";
import { useI18n } from "../i18n";
import { IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel } from "../../directory/vocabulary";
import { useDomainResource, usePrincipalScope, useServiceRequestComposer, mutationIntentCopy, formatDirectoryLanguages, pick as pickText, RESOURCE_STATES, DIRECTORY } from "../../frontend-kit";
import { HeritageCommandNotice } from "./DomainFeedback";
import { PersonIcon } from "./icons";
import { localizedDigits } from "./presentationLocale";

/**
 * R88 agent plan P21 (step 3): the professional directory in Heritage's own
 * language — public consent-gated reads only. State comes from the canonical
 * P20 headless loader (useDomainResource): loading / reloading / empty /
 * forbidden / unavailable / error are DISTINCT states and a failed request is
 * never an empty record. Contact is platform-mediated; contact_value never
 * reaches this page. Credentials are honest: self-declared stays unverified,
 * expired credentials stay visible as history without an active state.
 */

function ResourceStateNotice({ phase, reason, retry }: { phase: string; reason?: string; retry?: () => void }) {
  const { locale } = useI18n();
  if (phase === "loading" || phase === "reloading") {
    return <p role="status" className="h-mod-state-note">{phase === "reloading" ? pickText(RESOURCE_STATES.reloading, locale) : pickText(RESOURCE_STATES.loading, locale)}</p>;
  }
  if (phase === "forbidden") {
    return <div role="alert" className="h-mod-state-note"><p>{pickText(RESOURCE_STATES.forbidden, locale)}</p><p dir="auto">{reason}</p>{retry && <button type="button" onClick={retry}>{uiText(locale, "Retry", "تلاش دوباره")}</button>}</div>;
  }
  if (phase === "unavailable") {
    return <div role="alert" className="h-mod-state-note"><p>{pickText(RESOURCE_STATES.unavailable, locale)}</p><p dir="auto">{reason}</p>{retry && <button type="button" onClick={retry}>{uiText(locale, "Retry", "تلاش دوباره")}</button>}</div>;
  }
  if (phase === "error") {
    return <div role="alert" className="h-mod-state-note"><p>{pickText(RESOURCE_STATES.error, locale)}</p><p dir="auto">{reason}</p>{retry && <button type="button" onClick={retry}>{uiText(locale, "Retry", "تلاش دوباره")}</button>}</div>;
  }
  return null;
}

function personsQuery(params: { category: string; province: string; name: string; cursor: number }): string {
  return JSON.stringify(params);
}

export function HeritageDirectoryPage({ navigate, platform }: { navigate: (path: string) => void; platform: PlatformClient }) {
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [category, setCategory] = useState("");
  const [province, setProvince] = useState("");
  const [name, setName] = useState("");
  const [cursor, setCursor] = useState(0);
  const identity = personsQuery({ category, province, name, cursor });
  const { state, retry } = useDomainResource(
    "directory-persons",
    identity,
    (signal) => platform.modules.directory.persons({ category: category || undefined, province: province || undefined, name: name || undefined, cursor: cursor || undefined }, { signal }),
    { isEmpty: (data) => data.persons.length === 0 },
  );
  const page = useMemo(() => (state.phase === "ready" || state.phase === "reloading" ? (state.phase === "reloading" ? (state.data.persons.length ? state.data : null) : state.data) : null), [state]);
  const nextCursor = page?.next_cursor ?? null;

  const applyFilters = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setter(event.target.value);
    setCursor(0);
  };

  return <main className="page heritage-operations-page">
    <header className="section-title" data-h-surface-role="major">
      <div>
        <span>{L("DIRECTORY", "فهرست متخصصان")}</span>
        <h1>{pickText(DIRECTORY.title, locale)}</h1>
        <p>{L("Published professionals and organizations that gave explicit consent. Contact is mediated by the platform; nothing publishes without consent.", "متخصصان و سازمان‌هایی که رضایت صریح داده‌اند. تماس از طریق سامانه برقرار می‌شود؛ بدون رضایت چیزی منتشر نمی‌شود.")}</p>
      </div>
    </header>
    <div className="directory-toolbar" data-h-surface-role="panel" role="search">
      <label className="directory-field">
        <span>{pickText(DIRECTORY.category, locale)}</span>
        <select value={category} onChange={applyFilters(setCategory)}>
          <option value="">{L("All categories", "همه دسته‌ها")}</option>
          {SERVICE_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{locale === "fa" ? entry.fa : entry.en}</option>)}
        </select>
      </label>
      <label className="directory-field">
        <span>{pickText(DIRECTORY.province, locale)}</span>
        <select value={province} onChange={applyFilters(setProvince)}>
          <option value="">{L("All provinces", "همه استان‌ها")}</option>
          {IRAN_PROVINCES.map((entry) => <option key={entry.code} value={entry.code}>{locale === "fa" ? entry.fa : entry.en}</option>)}
        </select>
      </label>
      <label className="directory-field directory-field-name">
        <span>{L("Name", "نام")}</span>
        <input dir="auto" value={name} onChange={applyFilters(setName)} placeholder={L("Search by name…", "جست‌وجوی نام…")} />
      </label>
      {(category || province || name) && <button type="button" className="directory-clear" onClick={() => { setCategory(""); setProvince(""); setName(""); setCursor(0); }}>{L("Clear filters", "پاک کردن فیلترها")}</button>}
    </div>
    <section data-h-surface-role="panel" aria-busy={state.phase === "loading" || state.phase === "reloading"}>
      <ResourceStateNotice phase={state.phase} reason={state.phase === "forbidden" || state.phase === "unavailable" || state.phase === "error" ? state.reason : undefined} retry={retry} />
      {state.phase === "empty" ? <p className="h-mod-state-note">{L("No published profiles match these filters. An empty result is not a claim that no professionals exist.", "نمایه منتشرشده‌ای با این فیلترها نیست. نتیجه خالی به معنی نبودِ متخصص نیست.")}</p> : null}
      {page ? <div className="h-mod-table-wrap" role="region" tabIndex={0} aria-label={L("Directory results table — scrollable", "جدول نتایج فهرست — قابل پیمایش")}>
        <table className="h-mod-table">
          <thead><tr><th scope="col">{L("Professional", "متخصص")}</th><th scope="col">{pickText(DIRECTORY.category, locale)}</th><th scope="col">{pickText(DIRECTORY.province, locale)}</th><th scope="col">{pickText(DIRECTORY.city, locale)}</th><th scope="col">{pickText(DIRECTORY.contactPreference, locale)}</th></tr></thead>
          <tbody>
            {page.persons.map((person) => <tr key={person.person_id}>
              <td><button className="registry-row-clickable" dir="auto" onClick={() => navigate(`/directory/${person.person_id}`)}>{person.name_native || person.name_latin || `#${n(person.person_id)}`}</button></td>
              <td dir="auto">{person.service_categories.map((id) => uiText(locale, serviceCategoryLabel(id, "en"), serviceCategoryLabel(id, "fa"))).join(" · ") || "—"}</td>
              <td dir="auto">{person.province_needs_review ? L("Location needs confirmation", "محل نیازمند تأیید") : person.province_code ? provinceLabel(person.province_code, locale === "fa" ? "fa" : "en") : "—"}</td>
              <td dir="auto">{person.city || "—"}</td>
              <td dir="auto">{person.contact_preference === "platform_message" ? L("Platform message", "پیام سامانه") : person.contact_preference}</td>
            </tr>)}
          </tbody>
        </table>
      </div> : null}
      {(nextCursor != null || cursor > 0) && page ? <div className="table-actions">
        <button disabled={cursor === 0} onClick={() => setCursor(0)}>{L("First page", "صفحه اول")}</button>
        <span>{L("Showing", "نمایش")} {n(page.persons.length)}</span>
        <button disabled={nextCursor == null} onClick={() => setCursor(nextCursor ?? 0)}>{L("Next page", "صفحه بعد")}</button>
      </div> : null}
      <p className="h-mod-state-note">{pickText(DIRECTORY.contactMediated, locale)}</p>
      {state.phase === "error" || state.phase === "unavailable" ? <div className="table-actions"><button onClick={retry}>{pickText(RESOURCE_STATES.retry, locale)}</button></div> : null}
    </section>
  </main>;
}

export function HeritageDirectoryPersonPage({ navigate, platform, personId, user, permissions }: { navigate: (path: string) => void; platform: PlatformClient; personId: number; user: PlatformUser | null; permissions?: readonly string[] }) {
  const scope = usePrincipalScope(user, permissions);
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const { state, retry } = useDomainResource(
    "directory-person",
    personId,
    (signal) => platform.modules.directory.person(personId, { signal }),
    { isEmpty: (data) => false },
  );
  const detail = (state.phase === "ready" || state.phase === "reloading") ? state.data : null;
  return <main className="page heritage-operations-page">
    <header className="section-title" data-h-surface-role="major">
      <div>
        <span>{L("DIRECTORY PROFILE", "نمایه فهرست")}</span>
        <h1 dir="auto">{detail ? (locale === "fa" ? detail.person.name_native || detail.person.name_latin : detail.person.name_latin || detail.person.name_native) || `#${n(personId)}` : L("Professional profile", "نمایه متخصص")}</h1>
      </div>
    </header>
    <section data-h-surface-role="panel" aria-busy={state.phase === "loading"}>
      <ResourceStateNotice phase={state.phase} reason={state.phase === "forbidden" || state.phase === "unavailable" || state.phase === "error" ? state.reason : undefined} retry={retry} />
      {detail ? <>
        <dl className="details-grid">
          <div><dt>{pickText(DIRECTORY.category, locale)}</dt><dd dir="auto">{detail.person.service_categories.map((id) => uiText(locale, serviceCategoryLabel(id, "en"), serviceCategoryLabel(id, "fa"))).join(" · ") || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.province, locale)}</dt><dd dir="auto">{detail.person.province_needs_review ? L("Location awaiting reference review", "محل در انتظار بررسی") : detail.person.province_code ? provinceLabel(detail.person.province_code, locale === "fa" ? "fa" : "en") : "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.city, locale)}</dt><dd dir="auto">{detail.person.city || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.languages, locale)}</dt><dd dir="auto">{formatDirectoryLanguages(detail.person.languages, engineUiLocale(locale))}</dd></div>
          <div><dt>{pickText(DIRECTORY.availability, locale)}</dt><dd dir="auto">{detail.person.availability_text || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.contactPreference, locale)}</dt><dd>{pickText(DIRECTORY.contactMediated, locale)}</dd></div>
        </dl>
        <h2 className="h-mod-section-title">{pickText(DIRECTORY.credentials, locale)}</h2>
        {detail.credentials.length ? <div className="h-mod-table-wrap" role="region" tabIndex={0} aria-label={L("Credentials table — scrollable", "جدول مدارک — قابل پیمایش")}>
          <table className="h-mod-table">
            <thead><tr><th scope="col">{L("Role", "نقش")}</th><th scope="col">{L("Issuer", "صادرکننده")}</th><th scope="col">{L("Recorded date window", "بازه زمانی ثبت‌شده")}</th><th scope="col">{pickText(DIRECTORY.verification, locale)}</th></tr></thead>
            <tbody>
              {detail.credentials.map((credential) => <tr key={credential.id}>
                <td dir="auto">{uiText(locale, serviceCategoryLabel(credential.role, "en"), serviceCategoryLabel(credential.role, "fa"))}</td>
                <td dir="auto">{credential.issuer_name}</td>
                <td dir="auto">{credential.recorded_period_status === "within_recorded_dates" ? L("Within recorded dates", "در بازه ثبت‌شده")
                  : credential.recorded_period_status === "dates_not_recorded" ? L("Dates not recorded", "تاریخ‌ها ثبت نشده‌اند")
                  : credential.recorded_period_status === "expired" ? L("Expired", "منقضی")
                  : credential.recorded_period_status === "not_yet_valid" ? L("Not yet in date", "هنوز شروع نشده")
                  : credential.recorded_period_status === "revoked" ? L("Revoked", "لغوشده")
                  : L("Date review needed", "نیازمند بررسی تاریخ")}{credential.expires_at ? ` · ${localizedDigits(credential.expires_at, locale)}` : ""}</td>
                <td dir="auto">{credential.verification_state === "unverified" ? pickText(DIRECTORY.unverified, locale) : credential.verification_level}</td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p className="h-mod-state-note">{L("No credentials are recorded for this profile. Absence of a credential row is not evidence about qualification.", "مدرکی برای این نمایه ثبت نشده است. نبود ردیف مدرک، دلیل نبود صلاحیت نیست.")}</p>}
        <p className="h-mod-state-note">{detail.credentials_note}</p>
        {user ? <ServiceRequestComposer key={`${scope}:${personId}`} scope={scope} platform={platform} personId={personId} categories={detail.person.service_categories} navigate={navigate} /> : <p><button type="button" onClick={() => navigate("/login")}>{L("Sign in to send a private inquiry", "برای ارسال درخواست وارد شوید")}</button></p>}
        <div className="table-actions">
          <button onClick={() => navigate("/services")}><PersonIcon size={14} /> {L("Service requests", "درخواست خدمات")}</button>
          <button onClick={() => navigate("/directory")}>{L("All professionals", "همه متخصصان")}</button>
        </div>
      </> : null}
    </section>
  </main>;
}

function ServiceRequestComposer({ scope, platform, personId, categories, navigate }: { scope: string; platform: PlatformClient; personId:number; categories:string[]; navigate:(path:string)=>void }) {
  const {locale}=useI18n(); const fa=locale === "fa";
  const [category,setCategory]=useState(categories[0] ?? ""); const [note,setNote]=useState(""); const [share,setShare]=useState(false);
  const [confirmDiscard,setConfirmDiscard]=useState(false);
  const {store,snapshot}=useServiceRequestComposer(platform,scope,personId);
  const {intent,command}=snapshot;
  const accepted=()=>{setNote("");setShare(false);};
  return <details><summary>{fa ? "ارسال درخواست خصوصی" : "Send a private service inquiry"}</summary>
    <p>{fa ? "این درخواست، تأیید نوبت یا تضمین خدمت نیست. اطلاعات پزشکی حساس نفرستید." : "This is an initial lead, not a confirmed appointment or guarantee. Do not include sensitive medical records or urgent care requests."}</p>
    {intent.phase==="confirmed" && <p role="status"><strong>{mutationIntentCopy("confirmed", engineUiLocale(locale))} {intent.requestId}</strong> <button type="button" onClick={()=>navigate(`/services/${intent.requestId}`)}>{fa?"دیدن درخواست":"View request"}</button></p>}
    {intent.phase==="expired" && <p className="h-mod-state-note">{mutationIntentCopy("expired", engineUiLocale(locale))}</p>}
    {intent.record && command.phase!=="submitting" && <div className="h-mod-state-note" role="alert">
      <strong>{fa ? "نتیجه تلاش قبلی نامشخص است." : "The previous attempt has an unknown result."}</strong>
      <p>{mutationIntentCopy(intent.unknownReason, engineUiLocale(locale))}</p>
      <div className="table-actions">
        <button type="button" disabled={intent.reconciling} onClick={()=>void store.reconcile()}>{intent.reconciling?(fa?"بررسی…":"Checking…"):(fa?"بررسی با سرور":"Recheck with server")}</button>
        {snapshot.canReplay && <button type="button" onClick={async()=>{if(await store.retryExact())accepted();}}>{fa?"ارسال دوباره همان درخواست":"Retry the exact request"}</button>}
        <button type="button" disabled={intent.reconciling} onClick={()=>setConfirmDiscard(true)}>{mutationIntentCopy("clear", engineUiLocale(locale))}</button>
      </div>
      {confirmDiscard && <div><p>{mutationIntentCopy("clearWarning", engineUiLocale(locale))}</p><button type="button" disabled={intent.reconciling} onClick={()=>{if(store.discard())setConfirmDiscard(false);}}>{fa?"تأیید کنار گذاشتن بازیابی":"Confirm forgetting local recovery"}</button><button type="button" onClick={()=>setConfirmDiscard(false)}>{fa?"انصراف":"Cancel"}</button></div>}
    </div>}
    {!intent.durable && <p className="h-mod-state-note">{fa ? "ذخیره بازیابی روی این دستگاه ممکن نیست. پیش از فرستادن درخواست دیگری، بخش درخواست‌های من را بررسی کنید." : "This device cannot persist recovery. Check My requests before another attempt after leaving this page."}</p>}
    <form onSubmit={async(event)=>{event.preventDefault();if(await store.create({provider_person_id:personId,category,note,share_contact:share}))accepted();}}>
      <fieldset disabled={!snapshot.canSubmit}><legend>{fa ? "درخواست" : "Inquiry details"}</legend>
        <label>{fa ? "خدمت" : "Service"}<select required value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(id=><option key={id} value={id}>{uiText(locale, serviceCategoryLabel(id, "en"), serviceCategoryLabel(id, "fa"))}</option>)}</select></label>
        <label>{fa ? "یادداشت خصوصی (۱۰ تا ۵۰۰ نویسه)" : "Private note (10–500 characters)"}<textarea required minLength={10} maxLength={500} rows={4} dir="auto" value={note} onChange={event=>setNote(event.target.value)} /></label>
        <label><input type="checkbox" checked={share} onChange={event=>setShare(event.target.checked)} />{fa ? "اجازه می‌دهم نام و ایمیلم با مدیر مجاز این متخصص به اشتراک گذاشته شود (اختیاری)." : "Share my account name and email with this professional’s currently authorized manager (optional)."}</label>
      </fieldset>
      <button type="submit" disabled={!snapshot.canSubmit || !category}>{command.phase==="submitting"?(fa?"در حال ارسال…":"Sending…"):(fa ? "ارسال درخواست" : "Send inquiry")}</button>
    </form>
    {(command.phase==="failed"||command.phase==="rejected") && <HeritageCommandNotice state={command} />}
  </details>;
}
