import { uiText } from "../../shared/uiLocale";
import React, { useState } from "react";
import type {
  ChangeRequestType,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../../contracts/platform";
import { hasPlatformPermission, supportsPlatformFeature, useDomainResource, usePlatformCommand, principalScopeKey } from "../../frontend-kit";
import { HeritageResourceNotice, HeritageCommandNotice } from "./DomainFeedback";
import { useI18n } from "../i18n";
import { PeopleRegistryPanel } from "./PeopleRegistryPanel";
import { MetadataWorkbench } from "./MetadataWorkbench";

export function RegistryDeskPage({
  platform,
  platformMeta,
  user,
  permissions,
  navigate,
}:{
  platform: PlatformClient;
  platformMeta: PlatformMetaResponse | null;
  user: PlatformUser | null;
  permissions: PlatformPermission[];
  navigate: (path: string) => void;
}) {
  const { t, n, locale } = useI18n();
  const [changeHorse, setChangeHorse] = useState("");
  const [changeType, setChangeType] = useState<ChangeRequestType>("update_horse");
  const [changeSummary, setChangeSummary] = useState("");
  const [validationError, setValidationError] = useState("");
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const scope = principalScopeKey(user, permissions);
  const peopleAvailable = supportsPlatformFeature(platformMeta, "people");
  const qualityAvailable = supportsPlatformFeature(platformMeta, "quality_summary");
  const claimsAvailable = supportsPlatformFeature(platformMeta, "owner_claims");
  const changesAvailable = supportsPlatformFeature(platformMeta, "change_requests");
  const canReadClaims = Boolean(user && hasPlatformPermission(permissions, "claim.read_own"));
  const canReadChanges = Boolean(user && hasPlatformPermission(permissions, "change.read_own"));
  const canCreateChanges = Boolean(user && hasPlatformPermission(permissions, "change.create"));
  const qualityResource = useDomainResource("core-desk-quality", scope, signal => platform.quality.summary({ signal }), { enabled: qualityAvailable });
  const claimsResource = useDomainResource("core-desk-claims", scope, signal => platform.claims.mine({ signal }), { enabled: claimsAvailable && canReadClaims, isEmpty: data => data.claims.length === 0 });
  const changesResource = useDomainResource("core-desk-changes", scope, signal => platform.changes.mine({ signal }), { enabled: changesAvailable && canReadChanges, isEmpty: data => data.requests.length === 0 });
  const quality = qualityResource.state.phase === "ready" || qualityResource.state.phase === "reloading" ? qualityResource.state.data : null;
  const claims = claimsResource.state.phase === "ready" || claimsResource.state.phase === "reloading" ? claimsResource.state.data.claims : [];
  const changes = changesResource.state.phase === "ready" || changesResource.state.phase === "reloading" ? changesResource.state.data.requests : [];
  const changeCommand = usePlatformCommand(scope);
  const changeBusy = changeCommand.state.phase === "submitting" || changeCommand.state.phase === "failed";
  const recoveryReady = recoveryRequested && (changesResource.state.phase === "ready" || changesResource.state.phase === "empty");
  const refreshChanges = () => {
    // A reread is not acknowledgement. An unknown write stays locked while the
    // read is pending or failed, and until the user has inspected its result.
    if (changeCommand.state.phase === "failed") setRecoveryRequested(true);
    else changeCommand.reset();
    changesResource.retry();
  };
  const submitChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateChanges || changeBusy || !changeSummary.trim()) return;
    setValidationError("");
    setRecoveryRequested(false);
    const horseId = changeHorse.trim() ? Number(changeHorse) : null;
    if (horseId !== null && (!Number.isSafeInteger(horseId) || horseId <= 0)) {
      setValidationError(uiText(locale, "Horse number must be a positive integer.", "شماره اسب باید یک عدد صحیح مثبت باشد."));
      return;
    }
    const accepted = await changeCommand.run(() => platform.changes.create({ horse_id: horseId, request_type: changeType, summary: changeSummary.trim() }), { successMessage: uiText(locale, "Request submitted for review.", "درخواست برای بررسی ثبت شد.") });
    if (accepted) { setChangeSummary(""); setChangeHorse(""); changesResource.retry(); }
  };

  return <main className="page heritage-desk-page">
    <section className="premium-page-head heritage-desk-head" data-h-surface-role="major">
      <div><div className="eyebrow"><span className="eyebrow-rule" />{t("desk.eyebrow")}</div><h1>{t("desk.title")}</h1><p>{t("desk.lede")}</p></div>
      <div className="heritage-desk-meta"><div className="desk-capability-key"><span className="live">● {t("desk.live")}</span><span className="auth">◆ {t("desk.auth")}</span><span className="dormant">○ {t("desk.dormant")}</span></div>{platformMeta?.source&&<details className="desk-source-details"><summary>{uiText(locale, "Data source details", "اطلاعات منبع داده")}</summary><dl className="desk-source-proof"><div><dt>{uiText(locale, "Source", "منبع")}</dt><dd>{platformMeta.source.filename} · {platformMeta.source.sheet}</dd></div><div><dt>{uiText(locale, "Rows", "ردیف")}</dt><dd>{n(platformMeta.source.rowCount)} · {platformMeta.source.status}</dd></div><div><dt>SHA-256</dt><dd title={platformMeta.source.sha256}>{platformMeta.source.sha256}</dd></div>{platformMeta.source.completedAt&&<div><dt>{uiText(locale, "Completed", "تکمیل")}</dt><dd>{platformMeta.source.completedAt}</dd></div>}</dl></details>}</div>
    </section>

    <section className="heritage-desk-grid">
      <article data-h-surface-role="panel" className="desk-panel desk-people h-glass-1">
        <header><span><small>{t("desk.peopleKicker")}</small><h2>{t("desk.peopleTitle")}</h2></span>{peopleAvailable?<b className="capability-state live">{t("desk.live")}</b>:<b className="capability-state dormant">{t("desk.dormant")}</b>}</header>
        <p>{t("desk.peopleBody")}</p>
        {peopleAvailable
          ? <PeopleRegistryPanel platform={platform} platformMeta={platformMeta} navigate={navigate} variant="desk"/>
          : <div className="desk-dormant-note">{t("desk.unsupported")}</div>}
      </article>

      <article data-h-surface-role="panel" className="desk-panel desk-quality h-glass-1">
        <header><span><small>{t("desk.qualityKicker")}</small><h2>{t("desk.qualityTitle")}</h2></span>{qualityAvailable?<b className="capability-state live">{t("desk.live")}</b>:<b className="capability-state dormant">{t("desk.dormant")}</b>}</header>
        <p>{t("desk.qualityBody")}</p>
        <HeritageResourceNotice state={qualityResource.state} retry={qualityResource.retry}/>{quality&&<><div className="quality-orb"><strong>{n(quality.openIssues)}</strong><span>{t("desk.openIssues")}</span></div><div className="desk-quality-severity">{quality.severities.map((item)=><div key={item.value} className={`severity-${item.value.toLowerCase()}`}><span>{item.value}</span><strong>{n(item.count)}</strong></div>)}</div><div className="desk-issue-codes">{quality.topIssueCodes.slice(0,8).map((item)=><span key={item.value}><b dir="auto">{item.value.replaceAll("_"," ")}</b><em>{n(item.count)}</em></span>)}</div></>}
      </article>

      <article data-h-surface-role="panel" className="desk-panel desk-changes h-glass-1">
        <header><span><small>{uiText(locale, "Change workflow", "گردش اصلاحات")}</small><h2>{uiText(locale, "Change requests", "درخواست‌های تغییر")}</h2></span>{changesAvailable?<b className={`capability-state ${user?"auth":"live"}`}>{user?t("desk.auth"):t("desk.live")}</b>:<b className="capability-state dormant">{t("desk.dormant")}</b>}</header>
        <p>{uiText(locale, "Submit registry corrections through the versioned platform workflow; proposals remain reviewable and audit-safe.", "اصلاحات و پیشنهادهای داده از مسیر نسخه‌بندی‌شده پلتفرم ثبت و برای بررسی نگه‌داری می‌شوند.")}</p>
        {changesAvailable && user && <div className="desk-submission-entry"><button onClick={() => navigate("/f/heritage/desk/submit")}>{uiText(locale, "Register a new horse →", "ثبت اسب جدید →")}</button></div>}
        {!changesAvailable?<div className="desk-dormant-note">{t("desk.unsupported")}</div>:!user?<div className="desk-auth-note"><span>{t("desk.signInBody")}</span><button onClick={()=>navigate("/login")}>{t("desk.signIn")}</button></div>:!canReadChanges?<div className="desk-dormant-note">{t("desk.noPermission")}</div>:<>
          {canCreateChanges&&<form className="desk-change-form" onSubmit={submitChange}><div><select aria-label={uiText(locale, "Request type", "نوع درخواست")} disabled={changeBusy} value={changeType} onChange={e=>setChangeType(e.target.value as ChangeRequestType)}><option value="update_horse">{uiText(locale, "Horse correction", "اصلاح اسب")}</option><option value="ownership">{uiText(locale, "Ownership", "مالکیت")}</option><option value="other">{uiText(locale, "Other", "سایر")}</option></select><input aria-label={uiText(locale, "Horse number (optional)", "شماره اسب (اختیاری)")} disabled={changeBusy} inputMode="numeric" value={changeHorse} onChange={e=>setChangeHorse(e.target.value.replace(/[^0-9]/g,""))} placeholder={uiText(locale, "HorseNo (optional)", "شماره اسب (اختیاری)")}/></div><textarea aria-label={uiText(locale, "Proposed correction", "شرح تغییر پیشنهادی")} disabled={changeBusy} maxLength={2000} dir="auto" value={changeSummary} onChange={e=>setChangeSummary(e.target.value)} placeholder={uiText(locale, "Describe the proposed correction…", "شرح دقیق تغییر پیشنهادی…")} required/><button type="submit" disabled={changeBusy}>{changeBusy?(uiText(locale, "Submitting…", "در حال ارسال…")):(uiText(locale, "Submit request", "ثبت درخواست"))}</button></form>}
          <HeritageResourceNotice state={changesResource.state} retry={changesResource.retry}/><HeritageCommandNotice state={changeCommand.state} reload={refreshChanges}/>
          {changeCommand.state.phase === "failed" && recoveryReady && <button type="button" className="desk-recovery-confirm" onClick={() => { setRecoveryRequested(false); changeCommand.reset(); }}>{uiText(locale, "I checked my requests; allow another submission", "درخواست‌ها را بررسی کردم؛ اجازه ارسال دوباره")}</button>}
          {validationError&&<div role="alert" className="desk-error">{validationError}</div>}
          <div className="desk-claim-list">{changes.length?changes.slice(0,8).map(request=><button key={request.id} onClick={()=>request.canonical_horse_id!=null?navigate(`/horse/${request.canonical_horse_id}`):(request.horse_id?navigate(`/horse/${request.horse_id}`):undefined)}><span><strong dir="auto">{request.summary||request.request_type}</strong><small>{request.horse_id?`#${n(request.horse_id)} · `:""}{request.request_type.replaceAll("_"," ")}{request.canonical_horse_id!=null?(locale==="fa"?` · اسب ثبت‌شده #${n(request.canonical_horse_id)}`:` · created horse #${request.canonical_horse_id}`):""}</small></span><b className={`claim-status status-${request.status}`}>{request.review_status??request.status}</b></button>):changesResource.state.phase === "empty" ? <div className="desk-empty">{uiText(locale, "No change requests submitted yet.", "هنوز درخواستی ثبت نشده است.")}</div> : null}</div>
        </>}
      </article>

      <article data-h-surface-role="panel" className="desk-panel desk-claims h-glass-1">
        <header><span><small>{t("desk.claimsKicker")}</small><h2>{t("desk.claimsTitle")}</h2></span>{claimsAvailable?<b className={`capability-state ${user?"auth":"live"}`}>{user?t("desk.auth"):t("desk.live")}</b>:<b className="capability-state dormant">{t("desk.dormant")}</b>}</header>
        <p>{t("desk.claimsBody")}</p>
        {!claimsAvailable?<div className="desk-dormant-note">{t("desk.unsupported")}</div>:!user?<div className="desk-auth-note"><span>{t("desk.signInBody")}</span><button onClick={()=>navigate("/login")}>{t("desk.signIn")}</button></div>:!canReadClaims?<div className="desk-dormant-note">{t("desk.noPermission")}</div>:<><HeritageResourceNotice state={claimsResource.state} retry={claimsResource.retry}/><div className="desk-claim-list">{claims.length?claims.map((claim)=><button key={claim.id} onClick={()=>navigate(`/horse/${claim.horse_id}`)}><span><strong dir="auto">{locale==="fa"?(claim.name_native||claim.name_latin||`#${claim.horse_id}`):(claim.name_latin||claim.name_native||`#${claim.horse_id}`)}</strong><small>#{n(claim.horse_id)}</small></span><b className={`claim-status status-${claim.status.toLowerCase()}`}>{claim.status}</b></button>):claimsResource.state.phase === "empty" ? <div className="desk-empty">{t("desk.noClaims")}</div> : null}</div></>}
      </article>
    </section>
    {user && ["admin", "super_admin"].includes(user.role) && <MetadataWorkbench key={scope} platform={platform} scope={scope}/>}
  </main>;
}
