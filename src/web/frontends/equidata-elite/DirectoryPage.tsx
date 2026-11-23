import React, { useMemo, useState } from "react";
import { useDomainResource, pick as pickText, RESOURCE_STATES, DIRECTORY, SERVICE_REQUESTS, IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel, formatDirectoryLanguages, type PlatformUser } from "../../../frontend-kit";
import type { EquiDataRuntime } from "./adapter";
import { EmptyPanel, Icon, LoadingPanel, Panel, SectionTitle } from "./components";
import { edxText } from "./i18n";
import { num } from "./format";
import type { GoLocal } from "./pages";
import { EquiDataServiceRequestComposer } from "./ServiceRequestsPage";

/**
 * R107 NEXT-06-elite (master-AI R106 PLAN Slice D): the public professional
 * directory in EquiData Elite's own language — consent-gated public reads
 * through the canonical headless loader. Published professionals only:
 * nothing appears without explicit publication consent, and contact is
 * platform-mediated (the public DTO carries no contact value and this page
 * never invents one). Loading / reloading / empty / forbidden / unavailable /
 * error are DISTINCT states; an empty result is never presented as "no
 * professionals exist".
 */

function directoryIdentity(params: { category: string; province: string; name: string; cursor: number }): string {
  return JSON.stringify(params);
}

export function EquiDataDirectoryPage({ view, goLocal }: { view: EquiDataRuntime; goLocal: GoLocal }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const [category, setCategory] = useState("");
  const [province, setProvince] = useState("");
  const [name, setName] = useState("");
  const [cursor, setCursor] = useState(0);
  const identity = directoryIdentity({ category, province, name, cursor });
  const { state, retry } = useDomainResource(
    "directory-persons",
    identity,
    (signal) => view.platform.modules.directory.persons({ category: category || undefined, province: province || undefined, name: name || undefined, cursor: cursor || undefined }, { signal }),
    { isEmpty: (data) => data.persons.length === 0 },
  );
  const page = useMemo(() => (state.phase === "ready" || state.phase === "reloading" ? (state.phase === "reloading" ? (state.data.persons.length ? state.data : null) : state.data) : null), [state]);
  const nextCursor = page?.next_cursor ?? null;
  const clearFilters = () => { setCategory(""); setProvince(""); setName(""); setCursor(0); };
  const applyFilters = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => { setter(event.target.value); setCursor(0); };

  return <main className="edx-content edx-page">
    <SectionTitle headingLevel={1} eyebrow={L("DIRECTORY", "فهرست متخصصان")} title={pickText(DIRECTORY.title, view.locale)} copy={L("Published professionals who gave explicit consent. Contact is mediated by the platform; nothing publishes without consent.", "متخصصانی که رضایت صریح داده‌اند. تماس از طریق سامانه برقرار می‌شود؛ بدون رضایت چیزی منتشر نمی‌شود.")} />
    <div className="edx-filterbar" role="search" aria-label={L("Find a professional", "یافتن متخصص")}>
      <label><span className="edx-filter-label">{pickText(DIRECTORY.category, view.locale)}</span>
        <select value={category} onChange={applyFilters(setCategory)}>
          <option value="">{L("All categories", "همه دسته‌ها")}</option>
          {SERVICE_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{view.locale === "fa" ? entry.fa : entry.en}</option>)}
        </select>
      </label>
      <label><span className="edx-filter-label">{pickText(DIRECTORY.province, view.locale)}</span>
        <select value={province} onChange={applyFilters(setProvince)}>
          <option value="">{L("All provinces", "همه استان‌ها")}</option>
          {IRAN_PROVINCES.map((entry) => <option key={entry.code} value={entry.code}>{view.locale === "fa" ? entry.fa : entry.en}</option>)}
        </select>
      </label>
      <label><span className="edx-filter-label">{L("Name", "نام")}</span>
        <div className="edx-searchbox"><Icon name="search" /><input dir="auto" value={name} onChange={applyFilters(setName)} maxLength={120} placeholder={L("Search by name…", "جست‌وجوی نام…")} /></div>
      </label>
      {(category || province || name || cursor > 0) && <button type="button" className="edx-button secondary" onClick={clearFilters}>{L("Clear filters", "پاک کردن فیلترها")}</button>}
    </div>
    <Panel aria-busy={state.phase === "loading" || state.phase === "reloading"}>
      {state.phase === "loading" || state.phase === "reloading" ? <LoadingPanel /> : null}
      {state.phase === "reloading" ? <p role="status" className="edx-state-note">{pickText(RESOURCE_STATES.reloading, view.locale)}</p> : null}
      {state.phase === "forbidden" || state.phase === "unavailable" || state.phase === "error" ? <Panel className="edx-state error"><Icon name="warn" /><strong>{pickText(state.phase === "forbidden" ? RESOURCE_STATES.forbidden : state.phase === "unavailable" ? RESOURCE_STATES.unavailable : RESOURCE_STATES.error, view.locale)}</strong><span dir="auto">{state.reason}</span><button className="edx-button secondary" onClick={retry}>{pickText(RESOURCE_STATES.retry, view.locale)}</button></Panel> : null}
      {state.phase === "empty" ? <EmptyPanel title={L("No published profiles match these filters.", "نمایه منتشرشده‌ای با این فیلترها نیست.")} copy={L("An empty result is not a claim that no professionals exist.", "نتیجه خالی به معنی نبودِ متخصص نیست.")} /> : null}
      {page ? <ul className="edx-directory-list">
        {page.persons.map((person) => <li key={person.person_id}><button type="button" className="edx-directory-card" onClick={() => goLocal(`/directory/${person.person_id}`)}>
          <strong dir="auto">{(view.locale === "fa" ? person.name_native || person.name_latin : person.name_latin || person.name_native) || `#${num(person.person_id, view.locale)}`}</strong>
          <span dir="auto">{person.service_categories.map((id) => serviceCategoryLabel(id, view.locale)).join(" · ") || "—"}</span>
          <small dir="auto">{person.province_needs_review ? L("Location needs confirmation", "محل نیازمند تأیید") : person.province_code ? provinceLabel(person.province_code, view.locale) : "—"}{person.city ? ` · ${person.city}` : ""}</small>
          <small>{person.contact_preference === "platform_message" ? L("Platform message", "پیام سامانه") : person.contact_preference}</small>
        </button></li>)}
      </ul> : null}
      {(nextCursor != null || cursor > 0) && page ? <div className="edx-pagination">
        <button className="edx-button ghost" disabled={cursor === 0} onClick={() => setCursor(0)}>{L("FIRST PAGE", "صفحه اول")}</button>
        <span>{L("Showing", "نمایش")} {num(page.persons.length, view.locale)}</span>
        <button className="edx-button ghost" disabled={nextCursor == null} onClick={() => setCursor(nextCursor ?? 0)}>{L("NEXT PAGE", "صفحه بعد")}</button>
      </div> : null}
      <p className="edx-state-note">{pickText(DIRECTORY.contactMediated, view.locale)}</p>
    </Panel>
  </main>;
}

export function EquiDataDirectoryPersonPage({ view, goLocal, personId }: { view: EquiDataRuntime; goLocal: GoLocal; personId: number }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const user = view.user as PlatformUser | null;
  const { state, retry } = useDomainResource(
    "directory-person",
    personId,
    (signal) => view.platform.modules.directory.person(personId, { signal }),
    { isEmpty: () => false },
  );
  const detail = state.phase === "ready" ? state.data : null;
  const person = detail?.person ?? null;
  return <main className="edx-content edx-page">
    <SectionTitle headingLevel={1} eyebrow={L("DIRECTORY PROFILE", "نمایه فهرست")} action={<button className="edx-button secondary" onClick={() => goLocal("/directory")}>{L("All professionals", "همه متخصصان")}</button>} title={person ? (view.locale === "fa" ? person.name_native || person.name_latin || `#${num(personId, view.locale)}` : person.name_latin || person.name_native || `#${num(personId, view.locale)}`) : L("Professional profile", "نمایه متخصص")} />
    <Panel aria-busy={state.phase === "loading"}>
      {state.phase === "loading" || state.phase === "reloading" ? <LoadingPanel /> : null}
      {state.phase === "forbidden" || state.phase === "unavailable" || state.phase === "error" ? <Panel className="edx-state error"><Icon name="warn" /><strong>{pickText(state.phase === "forbidden" ? RESOURCE_STATES.forbidden : state.phase === "unavailable" ? RESOURCE_STATES.unavailable : RESOURCE_STATES.error, view.locale)}</strong><span dir="auto">{state.reason}</span><button className="edx-button secondary" onClick={retry}>{pickText(RESOURCE_STATES.retry, view.locale)}</button></Panel> : null}
      {person ? <>
        <dl className="edx-data-grid">
          <div><dt>{pickText(DIRECTORY.category, view.locale)}</dt><dd dir="auto">{person.service_categories.map((id) => serviceCategoryLabel(id, view.locale)).join(" · ") || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.province, view.locale)}</dt><dd dir="auto">{person.province_needs_review ? L("Location awaiting reference review", "محل در انتظار بررسی") : person.province_code ? provinceLabel(person.province_code, view.locale) : "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.city, view.locale)}</dt><dd dir="auto">{person.city || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.languages, view.locale)}</dt><dd dir="auto">{formatDirectoryLanguages(person.languages, view.locale) || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.availability, view.locale)}</dt><dd dir="auto">{person.availability_text || "—"}</dd></div>
          <div><dt>{pickText(DIRECTORY.contactPreference, view.locale)}</dt><dd>{person.contact_note || pickText(DIRECTORY.contactMediated, view.locale)}</dd></div>
        </dl>
        <h2>{pickText(DIRECTORY.credentials, view.locale)}</h2>
        {detail && detail.credentials.length ? <dl className="edx-data-grid">
          {detail.credentials.map((credential) => <React.Fragment key={credential.id}>
            <div><dt>{serviceCategoryLabel(credential.role, view.locale)} · {credential.issuer_name}</dt><dd dir="auto">{credential.recorded_period_status === "within_recorded_dates" ? L("Within recorded dates", "در بازه ثبت‌شده")
              : credential.recorded_period_status === "dates_not_recorded" ? L("Dates not recorded", "تاریخ‌ها ثبت نشده‌اند")
              : credential.recorded_period_status === "expired" ? L("Expired", "منقضی")
              : credential.recorded_period_status === "not_yet_valid" ? L("Not yet in date", "هنوز شروع نشده")
              : credential.recorded_period_status === "revoked" ? L("Revoked", "لغوشده")
              : L("Date review needed", "نیازمند بررسی تاریخ")}{credential.expires_at ? ` · ${L("expires", "انقضا")} ${credential.expires_at}` : ""}<br />{credential.verification_state === "unverified" ? pickText(DIRECTORY.unverified, view.locale) : `${credential.verification_level} (${credential.verification_state})`}</dd></div>
          </React.Fragment>)}
        </dl> : <p className="edx-state-note">{L("No credentials are recorded for this profile. Absence of a credential row is not evidence about qualification.", "مدرکی برای این نمایه ثبت نشده است. نبود ردیف مدرک، دلیل نبود صلاحیت نیست.")}</p>}
        <p className="edx-state-note">{detail?.credentials_note || pickText(DIRECTORY.credentialsNote, view.locale)}</p>
        {user ? <EquiDataServiceRequestComposer key={`${user.id}:${personId}`} view={view} personId={personId} categories={person.service_categories} /> : <Panel className="edx-state"><strong>{L("Sign in to send a private inquiry", "برای ارسال درخواست خصوصی وارد شوید")}</strong><button className="edx-button primary" onClick={() => goLocal("/governance")}>{L("OPEN SIGN IN", "باز کردن ورود")}</button></Panel>}
        <div className="edx-request-actions">
          <button className="edx-button secondary" onClick={() => goLocal("/services")}><Icon name="check" /> {pickText(SERVICE_REQUESTS.title, view.locale)}</button>
          <button className="edx-button secondary" onClick={() => goLocal("/directory")}>{L("All professionals", "همه متخصصان")}</button>
        </div>
      </> : null}
    </Panel>
  </main>;
}
