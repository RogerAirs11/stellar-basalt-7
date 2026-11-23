import { uiText, type UiLocale } from "../../shared/uiLocale";
import "../styles/heritage.workbenches.css";
import React, { useEffect, useState } from "react";
import {
  parseRouteId, serviceCategoryLabel, serviceRequestStatusLabel, serviceTransitionsFor, SERVICE_REQUESTS,
  usePrincipalScope, useServiceRequestWorkbench,
  type PlatformClient, type PlatformUser, type ServiceRequestRecord, type ServiceRequestWorkbench,
} from "../../frontend-kit";
import { useI18n } from "../i18n";
import { HeritageResourceNotice } from "./DomainFeedback";

type Props = { platform: PlatformClient; user: PlatformUser | null; permissions?: readonly string[];
  route?: string; navigate?: (path: string) => void };
type Copy = (en: string, fa: string) => string;
type SafetyDraft = { reportReason: string; blockReason: string };
const emptySafetyDraft: SafetyDraft = { reportReason: "", blockReason: "" };

/** Native Core presentation over the current-authority lifecycle used by every skin. */
export function HeritageServiceRequestsPage(props: Props) {
  const scope = usePrincipalScope(props.user, props.permissions);
  return <ServiceRequestsForAccount key={scope} {...props} scope={scope} />;
}
function ServiceRequestsForAccount({ platform, user, scope, route = "/services", navigate }: Props & { scope: string }) {
  const { locale } = useI18n();
  const L: Copy = (en, fa) => uiText(locale, en, fa);
  const { store, snapshot } = useServiceRequestWorkbench(platform, scope, !!user);
  // Keep unsent reasons through authority refreshes, in this principal's memory
  // only. Detail panels deliberately unmount while their access is rechecked.
  const [safetyDrafts, setSafetyDrafts] = useState<Record<number, SafetyDraft>>({});
  const updateSafetyDraft = (id: number, field: keyof SafetyDraft, value: string, submittedValue?: string) => {
    setSafetyDrafts(previous => {
      const current = previous[id] || emptySafetyDraft;
      if (submittedValue !== undefined && current[field] !== submittedValue) return previous;
      return { ...previous, [id]: { ...current, [field]: value } };
    });
  };
  const segment = route.match(/^\/services\/([^/]+)\/?$/)?.[1];
  const requestId = parseRouteId(segment);
  const go = (path: string) => navigate ? navigate(path) : location.assign(path);
  useEffect(() => { if (user) store.select(requestId); }, [store, requestId, user?.id]);
  const rows = snapshot.list.phase === "ready" || snapshot.list.phase === "reloading" ? snapshot.list.data : [];
  const selected = snapshot.detail.phase === "ready" ? snapshot.detail.data : null;
  const feedbackIds = Object.keys(snapshot.commands).map(Number).filter(id => store.commandFor(id).state.phase !== "idle");
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed) : L("Date unavailable", "تاریخ در دسترس نیست");
  };
  return <main className="page heritage-operations-page h-service-page">
    <header className="section-title" data-h-surface-role="major"><div>
      <span>{L("SERVICE REQUESTS", "درخواست خدمات")}</span><h1>{L("Your professional connections", "ارتباط با متخصصان")}</h1>
      <p>{uiText(locale, SERVICE_REQUESTS.notAppointment.en, SERVICE_REQUESTS.notAppointment.fa)} {L("Send and manage private requests with published professionals. Payment and message delivery are not confirmed.", "درخواست خصوصی برای متخصصان منتشرشده بفرستید و آن را مدیریت کنید. پرداخت و تحویل پیام تأیید نمی‌شود.")}</p>
    </div><a className="h-operations-link" href="/directory">{L("Find a professional", "یافتن متخصص")}</a></header>
    {!user ? <section data-h-surface-role="panel"><p>{L("Sign in to see your private requests.", "برای دیدن درخواست‌های خصوصی خود وارد شوید.")}</p><a className="h-operations-link" href="/login">{L("Sign in", "ورود")}</a></section> : <>
      <div className="table-toolbar" data-h-surface-role="panel" role="group" aria-label={L("Request inbox", "صندوق درخواست‌ها")}>
        {(["mine", "inbox"] as const).map(view => <button key={view} type="button" aria-pressed={snapshot.view === view} className={snapshot.view === view ? "active" : ""}
          onClick={() => { store.setView(view); go("/services"); }}>{view === "mine" ? L("My requests", "درخواست‌های من") : L("Provider inbox", "صندوق ارائه‌دهنده")}</button>)}
        <button type="button" disabled={snapshot.list.phase === "loading" || snapshot.list.phase === "reloading"} onClick={() => void store.reload()}>{L("Refresh", "تازه‌سازی")}</button>
      </div>
      {feedbackIds.length > 0 && <section className="h-service-feedback" aria-label={L("Request action results", "نتیجه اقدام درخواست")} data-h-surface-role="panel">
        {feedbackIds.map(id => <ServiceFeedback key={id} id={id} store={store} L={L} />)}
      </section>}
      <div className="h-mod-domain-grid h-service-grid">
        <section aria-label={snapshot.view === "mine" ? L("My requests", "درخواست‌های من") : L("Provider inbox", "صندوق ارائه‌دهنده")} aria-busy={snapshot.list.phase === "loading" || snapshot.list.phase === "reloading"}>
          <HeritageResourceNotice state={snapshot.list} retry={() => void store.reload()} />
          {snapshot.list.phase === "empty" && <><h2>{L("No requests here yet", "هنوز درخواستی نیست")}</h2><p>{snapshot.view === "mine" ? L("Choose a published professional to start a request.", "برای فرستادن درخواست، متخصص منتشرشده‌ای انتخاب کنید.") : L("Requests to the professionals you currently manage will appear here.", "درخواست‌های متخصصانی که اکنون مدیریت می‌کنید اینجا نمایش داده می‌شود.")}</p><a className="h-operations-link" href="/directory">{L("Browse the directory", "مشاهده فهرست متخصصان")}</a></>}
          <ul className="h-service-list">{rows.map(request => <li key={request.id}><button type="button" className="h-service-summary" aria-pressed={snapshot.selectedId === request.id}
            onClick={() => go(`/services/${request.id}`)}><strong>{uiText(locale, serviceCategoryLabel(request.category, "en"), serviceCategoryLabel(request.category, "fa"))}</strong>
            <span>{uiText(locale, serviceRequestStatusLabel(request.status, "en"), serviceRequestStatusLabel(request.status, "fa"))} · <bdi>#{request.id}</bdi></span>
            <small><time dateTime={request.updated_at}>{date(request.updated_at)}</time></small></button></li>)}</ul>
        </section>
        <section className="h-service-detail" aria-label={L("Request details", "جزئیات درخواست")}>
          {segment && requestId === null ? <p role="alert">{L("This request link is invalid.", "پیوند درخواست معتبر نیست.")}</p> : snapshot.selectedId === null ? <><h2>{L("Select a request", "انتخاب درخواست")}</h2><p>{L("Review the current status, private note and consent controls before taking action.", "پیش از اقدام، وضعیت فعلی، یادداشت خصوصی و تنظیمات رضایت را بررسی کنید.")}</p></> : <>
            <HeritageResourceNotice state={snapshot.detail} retry={() => store.select(snapshot.selectedId)} />
            {selected && <RequestDetails key={selected.id} request={selected} store={store} locale={locale} L={L} date={date}
              draft={safetyDrafts[selected.id] || emptySafetyDraft}
              updateDraft={(field, value, submittedValue) => updateSafetyDraft(selected.id, field, value, submittedValue)} />}
          </>}
        </section>
      </div>
    </>}
  </main>;
}

function ServiceFeedback({ id, store, L }: { id: number; store: ServiceRequestWorkbench; L: Copy }) {
  const command = store.commandFor(id), state = command.state;
  const uncertain = state.phase === "failed" || (state.phase === "rejected" && state.status === 409);
  return <div className="h-service-result" role={state.phase === "failed" || state.phase === "rejected" ? "alert" : "status"}>
    <strong>{L("Request", "درخواست")} <bdi>#{id}</bdi></strong>
    {state.phase === "submitting" ? <p>{L("Recording your change…", "در حال ثبت تغییر…")}</p> : state.phase === "accepted" ? <p>{L("The change was recorded. Notification delivery is not confirmed.", "تغییر ثبت شد. تحویل اعلان تأیید نشده است.")}</p> : "message" in state ? <p dir="auto">{state.message}</p> : null}
    {uncertain && <>
      <p>{L("Review the current request before another action. A failed response does not prove the earlier action failed.", "پیش از اقدام دیگر، درخواست فعلی را بررسی کنید. خطای پاسخ به معنی ناموفق بودن اقدام قبلی نیست.")}</p>
      <button type="button" disabled={command.recovery === "reading"} onClick={() => void store.reconcile(id)}>{command.recovery === "reading" ? L("Checking…", "در حال بررسی…") : L("Recheck current request", "بررسی دوباره درخواست فعلی")}</button>
      {command.recovery === "failed" && <p dir="auto">{command.recoveryReason || L("The reread failed. Recovery remains locked.", "بازخوانی ناموفق بود. اقدام دوباره همچنان قفل است.")}</p>}
      {command.recovery === "ready" && <><p>{L("The current request was read successfully. This does not independently confirm an earlier report or notification.", "درخواست فعلی با موفقیت بازخوانی شد. این کار به‌تنهایی گزارش یا اعلان قبلی را تأیید نمی‌کند.")}</p><button type="button" onClick={() => store.acknowledge(id)}>{L("I reviewed the current request", "درخواست فعلی را بررسی کردم")}</button></>}
    </>}
  </div>;
}

function RequestDetails({ request, store, locale, L, date, draft, updateDraft }: { request: ServiceRequestRecord; store: ServiceRequestWorkbench;
  locale: UiLocale; L: Copy; date: (value: string) => string; draft: SafetyDraft;
  updateDraft: (field: keyof SafetyDraft, value: string, submittedValue?: string) => void }) {
  const [confirmation, setConfirmation] = useState<"consent" | "redact" | "block" | "providerBlock" | null>(null);
  const { reportReason, blockReason } = draft;
  const disabled = !store.canAct(request.id);
  const transitions = serviceTransitionsFor(request.status, request.is_requester_view ? "requester" : "provider");
  const confirm = async () => {
    const action = confirmation; setConfirmation(null);
    if (action === "consent") await store.withdrawConsent(request.id);
    else if (action === "redact") await store.redactNote(request.id);
    else if (action === "block") await store.block(request.id);
    else if (action === "providerBlock") { if (await store.providerBlock(request.id, blockReason)) updateDraft("blockReason", "", blockReason); }
  };
  return <article className="h-mod-request-row">
    <header><h2>{uiText(locale, serviceCategoryLabel(request.category, "en"), serviceCategoryLabel(request.category, "fa"))}</h2><span>{uiText(locale, serviceRequestStatusLabel(request.status, "en"), serviceRequestStatusLabel(request.status, "fa"))}</span></header>
    <dl className="h-service-meta"><div><dt>{L("Request", "درخواست")}</dt><dd><bdi>#{request.id}</bdi></dd></div>
      <div><dt>{L("Provider", "ارائه‌دهنده")}</dt><dd><a href={`/directory/${request.provider_person_id}`}><bdi>#{request.provider_person_id}</bdi></a></dd></div>
      {request.city && <div><dt>{L("City", "شهر")}</dt><dd dir="auto">{request.city}</dd></div>}
      <div><dt>{L("Last updated", "آخرین به‌روزرسانی")}</dt><dd><time dateTime={request.updated_at}>{date(request.updated_at)}</time></dd></div>
    </dl>
    {request.note != null && <section className="h-service-note" aria-label={L("Private request note", "یادداشت خصوصی درخواست")}><h3>{L("Private note", "یادداشت خصوصی")}</h3><p className="h-mod-state-note">{uiText(locale, SERVICE_REQUESTS.notePrivate.en, SERVICE_REQUESTS.notePrivate.fa)}</p><p dir="auto">{request.note}</p></section>}
    {request.contact ? <p>{L("Contact shared with consent:", "تماس با رضایت به اشتراک گذاشته شده:")} <span dir="auto">{request.contact.display_name}</span> · <bdi>{request.contact.email}</bdi></p> : <p className="h-mod-state-note">{uiText(locale, SERVICE_REQUESTS.contactNotShared.en, SERVICE_REQUESTS.contactNotShared.fa)}</p>}
    <div className="table-actions">{transitions.map(status => <button type="button" key={status} disabled={disabled} onClick={() => void store.transition(request.id, status)}>{uiText(locale, serviceRequestStatusLabel(status, "en"), serviceRequestStatusLabel(status, "fa"))}</button>)}</div>
    {!transitions.length && <p className="h-mod-state-note">{L("No further status changes are available to your role.", "تغییر وضعیت دیگری برای نقش شما در دسترس نیست.")}</p>}
    <details><summary>{L("Privacy and safety controls", "حریم خصوصی و ایمنی")}</summary>
      <p>{L("Contact withdrawal and note redaction are one-way. Previously delivered messages cannot be recalled. Blocking prevents new requests; it does not close this one.", "لغو رضایت تماس و حذف یادداشت برگشت‌ناپذیر است. پیام تحویل‌شده پس گرفته نمی‌شود. مسدودسازی جلوی درخواست جدید را می‌گیرد و این درخواست را نمی‌بندد.")}</p>
      <div className="table-actions">{request.is_requester_view ? <>
        <button type="button" disabled={disabled || !request.contact} onClick={() => setConfirmation("consent")}>{L("Withdraw contact sharing", "لغو اشتراک تماس")}</button>
        <button type="button" disabled={disabled || !request.note} onClick={() => setConfirmation("redact")}>{L("Redact private note", "حذف یادداشت خصوصی")}</button>
        <button type="button" disabled={disabled} onClick={() => setConfirmation("block")}>{L("Block this provider", "مسدودسازی ارائه‌دهنده")}</button>
      </> : <form onSubmit={event => { event.preventDefault(); setConfirmation("providerBlock"); }}>
        <label>{L("Private block reason (optional)", "دلیل خصوصی مسدودسازی (اختیاری)")}<textarea value={blockReason} onChange={event => updateDraft("blockReason", event.target.value)} minLength={5} maxLength={500} disabled={disabled} /></label>
        <button type="submit" disabled={disabled}>{L("Block requester", "مسدودسازی درخواست‌کننده")}</button>
      </form>}</div>
      {confirmation && <div className="h-service-confirm" role="group" aria-label={L("Confirm privacy change", "تأیید تغییر حریم خصوصی")}><p>{L("Apply the selected privacy change to this request?", "تغییر انتخاب‌شده حریم خصوصی برای این درخواست اعمال شود؟")}</p>
        <button type="button" disabled={disabled} onClick={() => void confirm()}>{L("Confirm change", "تأیید تغییر")}</button><button type="button" onClick={() => setConfirmation(null)}>{L("Cancel", "انصراف")}</button></div>}
      <form onSubmit={async event => { event.preventDefault(); if (await store.report(request.id, reportReason)) updateDraft("reportReason", "", reportReason); }}>
        <label>{L("Report a concern (5–500 characters)", "گزارش مشکل (۵ تا ۵۰۰ نویسه)")}<textarea value={reportReason} onChange={event => updateDraft("reportReason", event.target.value)} minLength={5} maxLength={500} required disabled={disabled} /></label>
        <button type="submit" disabled={disabled}>{L("Submit private report", "ثبت گزارش خصوصی")}</button>
      </form>
    </details>
  </article>;
}
