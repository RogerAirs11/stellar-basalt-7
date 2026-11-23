import React, { useEffect, useMemo, useState } from "react";
import {
  hasPlatformPermission,
  horseDbRoutes,
  principalScopeKey,
  redactionFulfillmentLabel,
  runRedactionDecision,
  runRedactionFulfillment,
  useAdminRedactionQueue,
  usePrincipalScope,
  useScopedState,
  type AdminDashboardResponse,
  type AdminHorseRecord,
  type AdminQualityIssue,
  type AdminRedactionQueueRow,
  type AuditEventSummary,
  type FrontendRuntimeProps,
  type HorseRecord,
  type QualityQueueCounts,
} from "../../../frontend-kit";
import { EliteReviewQueue } from "./ReviewQueue";
import { HorseCurationForm } from "../../../frontend-kit";
import { ProfessionalGrantWorkbench } from "../../../frontend-kit";
import { AccountSecurityPanel, AccountSecuritySessionNotice } from "../../../frontend-kit";
import "./governance.css";

export type GovernanceSkin = "q8" | "equidata" | "prism";

type Props = {
  runtime: FrontendRuntimeProps;
  skin: GovernanceSkin;
  className?: string;
};

type LoadState = {
  dashboard: AdminDashboardResponse | null;
  audit: AuditEventSummary[];
  issues: AdminQualityIssue[];
  qualityCounts: QualityQueueCounts | null;
};

const EMPTY: LoadState = { dashboard:null, audit:[], issues:[], qualityCounts:null };
export function GovernanceConsole(props: Props) {
  // R148: include unfinished inputs and search results in principal invalidation,
  // not only dashboard/curation resources. Old account continuations are unmounted.
  const [authNotice, setAuthNotice] = useState<"pending" | "unconfirmed" | null>(null);
  return <><AccountSecuritySessionNotice platform={props.runtime.platform} locale={props.runtime.locale}/><GovernanceConsoleForPrincipal key={principalScopeKey(props.runtime.user, props.runtime.permissions)} {...props} authNotice={authNotice} setAuthNotice={setAuthNotice}/></>;
}

function GovernanceConsoleForPrincipal({ runtime, skin, className="", authNotice, setAuthNotice }: Props & { authNotice: "pending" | "unconfirmed" | null; setAuthNotice: (value: "pending" | "unconfirmed" | null) => void }) {
  const fa=runtime.locale==="fa";
  const T=(en:string,faText:string)=>fa?faText:en;
  const [email,setEmail]=useState(import.meta.env.DEV?"admin@local.test":"");
  const [password,setPassword]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  // R107 NEXT-05: the admin console state and the loaded curation record are
  // PRINCIPAL-SCOPED — a scope change (account switch, logout, permission
  // revocation) masks them during render, before any effect can flush.
  const principalScope=usePrincipalScope(runtime.user,runtime.permissions);
  const [state,setState]=useScopedState<LoadState>(principalScope,EMPTY);
  const [horseQuery,setHorseQuery]=useState("");
  const [horseResults,setHorseResults]=useState<HorseRecord[]>([]);
  const [horse,setHorse]=useScopedState<AdminHorseRecord|null>(principalScope,null);
  // R145-C05: the authorized exact chip/passport lookup (staff diagnostic).
  const [exactKind,setExactKind]=useState<"microchip"|"passport"|"life_number"|"uel"|"register">("microchip");
  const [exactValue,setExactValue]=useState("");
  const [exactResults,setExactResults]=useState<Array<{ id: number; name_latin: string | null }>>([]);

  const can=(permission:Parameters<typeof hasPlatformPermission>[1])=>hasPlatformPermission(runtime.permissions,permission);
  const privileged=useMemo(()=>runtime.permissions.some(p=>["horse.create","horse.edit","horse.archive","claim.review","change.review","quality.read","audit.read","maintenance.run"].includes(p)),[runtime.permissions]);

  useEffect(()=>{
    let live=true;
    if(!runtime.user){setState(EMPTY);setHorse(null);return()=>{live=false}};
    const load=async()=>{
      const next:LoadState={...EMPTY};
      const jobs:Promise<void>[]=[];
      if(privileged)jobs.push(runtime.platform.admin.dashboard().then(v=>{next.dashboard=v}).catch(e=>console.warn("[registry]",e)));
      if(can("audit.read"))jobs.push(runtime.platform.admin.audit().then(v=>{next.audit=v.events}).catch(e=>console.warn("[registry]",e)));
      if(can("quality.read"))jobs.push(runtime.platform.admin.quality().then(v=>{next.issues=v.issues;next.qualityCounts=v.counts}).catch(e=>console.warn("[registry]",e)));
      await Promise.all(jobs);if(live)setState(next);
    };
    void load();return()=>{live=false};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[runtime.user,runtime.platform,runtime.permissions,principalScope,revision,privileged]);

  useEffect(()=>{
    if(horseQuery.trim().length<2){setHorseResults([]);return}
    const c=new AbortController();const timer=setTimeout(()=>runtime.platform.search.horses(horseQuery,{limit:8,signal:c.signal}).then(v=>{if(!c.signal.aborted)setHorseResults(v.results)}).catch(e=>{if(!c.signal.aborted)console.warn("[registry]",e)}),180);
    return()=>{clearTimeout(timer);c.abort()};
  },[horseQuery,runtime.platform]);

  const login=async(e:React.FormEvent)=>{e.preventDefault();if(authNotice==="pending")return;setMessage("");setBusy(true);try{await runtime.platform.auth.login({email:email.trim(),password});setAuthNotice(null);setPassword("");setMessage(T("Signed in. Governance capabilities are now permission-scoped.","ورود انجام شد؛ قابلیت‌های حکمرانی بر اساس مجوز فعال شدند."))}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
  const logout=async()=>{setBusy(true);setAuthNotice("pending");try{await runtime.platform.auth.logout();setAuthNotice(null);setState(EMPTY);setHorse(null);setMessage("")}catch(e){setAuthNotice("unconfirmed");setMessage((e as Error).message)}finally{setBusy(false)}};
  const refresh=()=>setRevision(v=>v+1);
  const loadHorse=async(id:number)=>{setBusy(true);setMessage("");try{const v=await runtime.platform.admin.horses.get(id);setHorse(v.horse);setHorseResults([]);setHorseQuery(v.horse.name_latin||v.horse.name_native||`#${id}`)}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
  const archiveHorse=async()=>{if(!horse||!can("horse.archive"))return;if(!window.confirm(T(`Archive horse #${horse.id}?`,`اسب #${horse.id} بایگانی شود؟`)))return;setBusy(true);try{await runtime.platform.admin.horses.archive(horse.id);setMessage(T(`Horse #${horse.id} archived.`,`اسب #${horse.id} بایگانی شد.`));setHorse(null);refresh()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
  const reindex=async()=>{if(!can("maintenance.run"))return;setBusy(true);try{const v=await runtime.platform.admin.maintenance.reindex();setMessage(T(`Reindex processed ${v.processed}; ${v.remaining} remaining.`,`بازفهرست‌سازی ${v.processed} مورد را پردازش کرد؛ ${v.remaining} باقی مانده.`));refresh()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
  // R145-E04: the quality queue workflow rides the same versioned verbs as
  // Core — scan seeds the measured conflicts; resolve demands a reason.
  const qualityScan=async()=>{if(!can("quality.read"))return;setBusy(true);try{let v=await runtime.platform.admin.qualityScan();let passes=1;while(!v.completed&&passes<80){v=await runtime.platform.admin.qualityScan({resume_after:v.resume_after??undefined});passes++}setMessage(T(`Quality scan (${passes} pass${passes===1?"":"es"}): ${v.created} new finding(s) this pass; ${v.open_issues} open${v.completed?"":" · more passes needed"}.`,`اسکن کیفیت (${passes} گذر): ${v.created} یافته جدید در این گذر؛ ${v.open_issues} باز${v.completed?"":" · گذرهای بیشتری لازم است"}.`));refresh()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
  const qualityResolve=async(id:number)=>{if(!can("quality.read"))return;const note=(window.prompt(T(`Resolution note for issue #${id} (required):`,`یادداشت حل مورد #${id} (الزامی):`))??"").trim();if(note.length<3)return;setBusy(true);try{await runtime.platform.admin.qualityResolve(id,note);setMessage(T(`Issue #${id} resolved.`,`مورد #${id} حل شد.`));refresh()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
  const exactLookup=async()=>{if(!can("quality.read")||!exactValue.trim())return;setBusy(true);try{const v=await runtime.platform.search.exactIdentifier(exactKind,exactValue.trim());setExactResults(v.results);setMessage(T(`${v.matched} exact match(es).`,`${v.matched} تطابق دقیق.`))}catch(e){setMessage((e as Error).message);setExactResults([])}finally{setBusy(false)}};

  if(!runtime.user)return <section className={`hdb-gov hdb-gov-${skin} ${className}`} data-governance-skin={skin}>
    <header className="hdb-gov-hero"><div><small>{T("SECURE REGISTRY CONTROL","کنترل امن سامانه ثبت")}</small><h1>{T("Authentication & governance","احراز هویت و حکمرانی")}</h1><p>{T("This frontend now exposes the same canonical login boundary as Core. Authorization still comes only from backend-issued permissions.","این رابط اکنون همان مرز ورود مرجع Core را ارائه می‌کند؛ مجوزدهی فقط از مجوزهای صادرشده توسط سرویس می‌آید.")}</p></div><span className="hdb-gov-status">{T("SIGNED OUT","خارج")}</span></header>
    {authNotice==="pending"&&<p role="status">{T("Signing out… Please wait before signing in again.","در حال خروج… پیش از ورود دوباره منتظر بمانید.")}</p>}
    {authNotice==="unconfirmed"&&<div role="alert"><p>{T("Sign-out could not be confirmed. Check account status before continuing.","خروج تأیید نشد. پیش از ادامه وضعیت حساب را بررسی کنید.")}</p><button type="button" disabled={busy} onClick={()=>{setBusy(true);void runtime.platform.auth.me().then(()=>setAuthNotice(null)).catch(error=>setMessage((error as Error).message)).finally(()=>setBusy(false))}}>{T("Check account status","بررسی وضعیت حساب")}</button></div>}
    <form className="hdb-gov-login" onSubmit={login}><label><span>{T("Email","ایمیل")}</span><input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label><span>{T("Password","گذرواژه")}</span><input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy||authNotice==="pending"}>{busy||authNotice==="pending"?T("SIGNING IN…","در حال ورود…"):T("SIGN IN","ورود")}</button>{message&&<p className="hdb-gov-message">{message}</p>}</form>
  </section>;

  return <section className={`hdb-gov hdb-gov-${skin} ${className}`} data-governance-skin={skin}>
    <header className="hdb-gov-hero"><div><small>{T("SECURE REGISTRY CONTROL","کنترل امن سامانه ثبت")}</small><h1>{T("Governance console","کنسول حکمرانی")}</h1><p>{T("Audit, review, curation and maintenance are live PlatformClient capabilities—not a redirect to another frontend.","ممیزی، بررسی، ویرایش و نگهداری قابلیت‌های زنده PlatformClient هستند؛ نه هدایت به رابط دیگر.")}</p></div><div className="hdb-gov-account"><span className="hdb-gov-status live">{T("AUTHENTICATED","وارد شده")}</span><b>{runtime.user.display_name}</b><small>{runtime.user.email}</small><button onClick={logout} disabled={busy}>{T("Sign out","خروج")}</button></div></header>
    <AccountSecurityPanel platform={runtime.platform} locale={runtime.locale} scope={principalScope}/>
    <div className="hdb-gov-permissions" role="region" aria-label={T("Assigned permissions","مجوزهای اختصاص‌یافته")} tabIndex={0}><b>{T("Permission matrix","ماتریس مجوز")}</b>{runtime.permissions.map(p=><span key={p}>{p}</span>)}</div>
    {message&&<p className="hdb-gov-message">{message}</p>}
    {!privileged?<div className="hdb-gov-empty"><strong>{T("Authenticated workflow access only","فقط دسترسی گردش‌کار احرازشده")}</strong><p>{T("This account has no privileged governance permissions. Ownership claims and personal change requests remain available in this frontend's workflow area.","این حساب مجوز حکمرانی ممتاز ندارد. ادعاهای مالکیت و درخواست‌های تغییر شخصی در بخش گردش‌کار همین رابط در دسترس‌اند.")}</p></div>:<>
      <div className="hdb-gov-kpis"><GovKpi label={T("Horses","اسب‌ها")} value={state.dashboard?.horses}/><GovKpi label={T("People","افراد")} value={state.dashboard?.people}/><GovKpi label={T("Open issues","مسائل باز")} value={state.dashboard?.openIssues}/><GovKpi label={T("7-day changes","تغییرات ۷ روز")} value={state.dashboard?.changesLast7Days}/><GovKpi label={T("Reindex jobs","کارهای بازفهرست") } value={state.dashboard?.reindexJobs}/></div>
      <div className="hdb-gov-grid">
        {can("claim.review")&&<EliteReviewQueue runtime={runtime} kind="claim"/>}
        {can("change.review")&&<EliteReviewQueue runtime={runtime} kind="change"/>}
        {can("quality.read")&&<GovPanel title={T("Quality findings","یافته‌های کیفیت")} badge={state.issues.length}>
          {state.qualityCounts&&<p className="hdb-gov-message">{T(`open ${state.qualityCounts.open} · assigned ${state.qualityCounts.assigned} · resolved ${state.qualityCounts.resolved}`,`باز ${state.qualityCounts.open} · واگذارشده ${state.qualityCounts.assigned} · حل‌شده ${state.qualityCounts.resolved}`)}</p>}
          <div className="hdb-gov-list compact">{state.issues.map(x=><div key={x.id} style={{display:"flex",gap:"6px",alignItems:"center",borderBottom:"1px solid rgba(128,128,128,.15)",padding:"2px 0"}}><button className="issue" style={{flex:"1"}} onClick={()=>x.horse_id&&runtime.navigate(horseDbRoutes.horse(x.horse_id))}><span data-severity={x.severity}>{x.severity}</span><b dir="auto">{x.name_latin||`#${x.horse_id??"—"}`}</b><small>{x.issue_code} · {x.message}</small></button>{x.status!=="resolved"&&<button onClick={()=>void qualityResolve(x.id)}>{T("Resolve","حل")}</button>}</div>)}</div>
          <button onClick={()=>void qualityScan()} disabled={busy}>{T("Scan corpus","اسکن داده‌ها")}</button>
        </GovPanel>}
        {can("audit.read")&&<GovPanel title={T("Audit trail","ردپای ممیزی")} badge={state.audit.length}><div className="hdb-gov-list compact" role="region" aria-label={T("Audit events","رویدادهای ممیزی")} tabIndex={0}>{state.audit.map(x=><article key={x.id}><b>{x.action}</b><small>{x.entity_type} #{x.entity_id} · {x.actor||"system"}</small><time>{x.created_at}</time></article>)}</div></GovPanel>}
      </div>
      {(can("horse.create")||can("horse.edit")||can("horse.archive"))&&<GovPanel title={T("Canonical record curation","ویرایش رکورد مرجع")} className="hdb-gov-curation">
        <div className="hdb-gov-curation-tools">{can("horse.create")&&<HorseCurationForm platform={runtime.platform} locale={runtime.locale} scope={principalScope} onSaved={async horse=>{setMessage(T(`Created horse #${horse.id}.`,`اسب #${horse.id} ایجاد شد.`));await loadHorse(horse.id);refresh()}}/>}<div className="hdb-gov-search"><input value={horseQuery} onChange={e=>setHorseQuery(e.target.value)} placeholder={T("Find horse to curate…","جست‌وجوی اسب برای ویرایش…")}/>{horseResults.length>0&&<div>{horseResults.map(x=><button key={x.id} onClick={()=>loadHorse(x.id)}><b dir="auto">{x.name_latin||x.name_native||`#${x.id}`}</b><small>#{x.id} · {x.register_no||"—"}</small></button>)}</div>}</div>
        {/* R145-C05: authorized exact chip/passport lookup — resolves "which horse owns this identifier?" deterministically; miss is indistinguishable from a concealed record. */}
        {can("quality.read")&&<div className="hdb-gov-search">
          <select value={exactKind} onChange={e=>setExactKind(e.target.value as typeof exactKind)} aria-label={T("Identifier kind","نوع شناسه")}>
            <option value="microchip">{T("Microchip","میکروچیپ")}</option>
            <option value="passport">{T("Passport","گذرنامه")}</option>
            <option value="life_number">{T("Life number","شماره زندگی")}</option>
            <option value="uel">{T("UEL","UEL")}</option>
            <option value="register">{T("Registry no.","شماره سامانه ثبت")}</option>
          </select>
          <input dir="ltr" value={exactValue} onChange={e=>setExactValue(e.target.value)} placeholder={T("Exact identifier value…","مقدار دقیق شناسه…")}/>
          <button disabled={busy||!exactValue.trim()} onClick={()=>void exactLookup()}>{T("Exact lookup","جست‌وجوی دقیق")}</button>
          {exactResults.length>0&&<div>{exactResults.map(x=><button key={x.id} onClick={()=>void loadHorse(x.id)}><b dir="auto">{x.name_latin||`#${x.id}`}</b><small>#{x.id}</small></button>)}</div>}
        </div>}</div>
        {horse&&<div className="hdb-gov-editor"><header><div><small>#{horse.id} · row v{horse.row_version}</small><h3 dir="auto">{horse.name_latin||horse.name_native}</h3></div><button onClick={()=>runtime.navigate(horseDbRoutes.horse(horse.id))}>{T("Public profile ↗","پروفایل عمومی ↗")}</button></header><HorseCurationForm platform={runtime.platform} horse={horse} locale={runtime.locale} scope={principalScope} canEdit={can("horse.edit")} onSaved={saved=>{setHorse(saved);setMessage(T("Record saved with optimistic row-version validation.","رکورد با کنترل نسخه ذخیره شد."));refresh()}}/><footer>{can("horse.archive")&&<button className="danger" disabled={busy} onClick={archiveHorse}>{T("Archive record","بایگانی رکورد")}</button>}</footer></div>}
      </GovPanel>}
      {/* R117-18: the privacy redaction operator queue — gated on the
       * admin-tier maintenance.run permission (held only by admin and
       * super_admin); the server stays the authority and a 403 renders the
       * honest forbidden state if permissions ever diverge from the role. */}
      {can("maintenance.run")&&<ElitePrivacyRedaction runtime={runtime}/>}
      <ProfessionalGrantWorkbench platform={runtime.platform} locale={runtime.locale} scope={principalScope} canRead={can("audit.read")} canManage={can("maintenance.run")} />
      <div className="hdb-gov-maintenance"><button onClick={refresh} disabled={busy}>{T("Refresh console","تازه‌سازی کنسول")}</button>{can("maintenance.run")&&<button onClick={reindex} disabled={busy}>{T("Run search reindex","اجرای بازفهرست جست‌وجو")}</button>}</div>
    </>}
  </section>;
}

function GovKpi({label,value}:{label:string;value:number|undefined}){return <div className="hdb-gov-kpi"><small>{label}</small><strong>{value==null?"—":new Intl.NumberFormat().format(value)}</strong></div>}

/** R117-18 — EquiData Elite's native privacy-redaction operator surface.
 * The decision (grant/refuse) and the audited execution are separate
 * actions; the per-row indicator is driven by the execution receipt, never
 * by the grant. Honest refusals carry their server codes; after every
 * command the queue reloads so the view matches the server after refresh. */
function ElitePrivacyRedaction({runtime}:{runtime:FrontendRuntimeProps}){
  const fa=runtime.locale==="fa";
  const T=(en:string,faText:string)=>fa?faText:en;
  const scope=principalScopeKey(runtime.user,runtime.permissions);
  const {queue,retry}=useAdminRedactionQueue({platform:runtime.platform,scope});
  const [note,setNote]=useState("");
  const [busyRow,setBusyRow]=useState<number|null>(null);
  const [outcome,setOutcome]=useState("");
  const decide=async(row:AdminRedactionQueueRow,decision:"grant"|"refuse")=>{
    if(note.trim().length<10){setOutcome(T("A substantive decision note (at least 10 characters) is required.","یادداشت تصمیم معتبر (حداقل ۱۰ نویسه) الزامی است."));return;}
    setBusyRow(row.id);setOutcome("");
    const result=await runRedactionDecision(runtime.platform,row.id,{decision,decision_note:note.trim()});
    setOutcome(result.phase==="done"?result.response.note:`${T("Refused","رد شد")} — ${result.code}: ${result.reason}`);
    if(result.phase==="done")setNote("");
    retry();setBusyRow(null);
  };
  const fulfill=async(row:AdminRedactionQueueRow)=>{
    setBusyRow(row.id);setOutcome("");
    const result=await runRedactionFulfillment(runtime.platform,row.id,note.trim().length>=10?note.trim():null);
    setOutcome(result.phase==="done"?result.response.note:`${T("Refused","رد شد")} — ${result.code}: ${result.reason}`);
    if(result.phase==="done")setNote("");
    retry();setBusyRow(null);
  };
  const categoryLabel=(row:AdminRedactionQueueRow)=>row.data_category==="service_request_notes"?T("Service-request notes","یادداشت‌های درخواست خدمت"):T("Service-request contact & location","تماس و موقعیت درخواست خدمت");
  const rows=queue.phase==="ready"||queue.phase==="reloading"?queue.rows:[];
  return <GovPanel title={T("Privacy redaction queue","صف حذف اطلاعات حریم خصوصی")} className="hdb-gov-privacy">
    <p className="hdb-gov-note">{T("Subject redaction requests: the operator decision and the audited execution are separate steps. Only the executor's receipt reports completion.","درخواست‌های حذف داده: تصمیم اپراتور و اجرای ممیزی‌شده دو گام جدا هستند. فقط رسید مجری، انجام را گزارش می‌کند.")}</p>
    {queue.phase==="loading"||queue.phase==="idle"?<p className="hdb-gov-note">{T("Loading the redaction queue…","در حال بارگذاری صف حذف…")}</p>
      :queue.phase==="forbidden"?<p className="hdb-gov-note">{T("This account cannot read the privacy operator queue.","این حساب اجازه خواندن صف حریم خصوصی را ندارد.")}</p>
      :queue.phase==="unavailable"||queue.phase==="error"?<div className="hdb-gov-error"><span>{queue.reason}</span><button onClick={retry}>{T("Retry","تلاش دوباره")}</button></div>
      :queue.phase==="empty"?<p className="hdb-gov-note">{T("No redaction requests have been filed.","هیچ درخواست حذفی ثبت نشده است.")}</p>
      :<div className="hdb-gov-list compact" data-surface="privacy-redaction-rows">{rows.map(row=>{
        const indicator=redactionFulfillmentLabel(row);
        const decidable=row.status==="received"||row.status==="deferred_active_hold";
        const fulfillable=row.status==="granted"&&row.execution_status!=="completed";
        return <article key={row.id} data-request-id={row.id} className={`hdb-gov-privacy-row tone-${indicator.tone}`}>
          <header><b>#{row.id} · {row.subject_name??row.subject_user_id}</b><small>{categoryLabel(row)}{row.service_request_id!=null?` · SR #${row.service_request_id}`:` · ${T("untargeted","بدون هدف مشخص")}`}{row.request_under_active_hold?` · ${T("active hold","توقیف فعال")}`:""}</small></header>
          <p dir="auto">“{row.request_note}”</p>
          <div className="hdb-gov-privacy-states">
            <span className={`status-${row.status}`}>{row.status.replaceAll("_"," ")}</span>
            <span className={`privacy-fulfillment fulfillment-${indicator.tone}`} data-surface="privacy-fulfillment-indicator">{fa?indicator.fa:indicator.en}</span>
            {row.execution_status==="completed"?<details data-surface="privacy-execution-receipt"><summary>{T("Execution receipt","رسید اجرا")}</summary><pre dir="ltr">{row.execution_receipt_json??"—"}</pre></details>:null}
          </div>
          {(decidable||fulfillable)&&<div className="hdb-gov-privacy-actions">
            <input dir="auto" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} placeholder={T("Operator note (required for decisions, optional for execution)","یادداشت اپراتور (برای تصمیم الزامی، برای اجرا اختیاری)")} aria-label={T("Operator note","یادداشت اپراتور")} disabled={busyRow!=null}/>
            {decidable&&<span><button disabled={busyRow!=null} onClick={()=>void decide(row,"grant")}>{T("Grant decision","تصمیم به تأیید")}</button><button className="danger" disabled={busyRow!=null} onClick={()=>void decide(row,"refuse")}>{T("Refuse","رد")}</button></span>}
            {fulfillable&&<button className="primary" disabled={busyRow!=null} onClick={()=>void fulfill(row)}>{T("Execute redaction","اجرای حذف")}</button>}
          </div>}
        </article>;})}</div>}
    {outcome?<div className="hdb-gov-message" role="status" dir="auto" data-surface="privacy-command-outcome">{outcome}</div>:null}
  </GovPanel>;
}
function GovPanel({title,badge,children,className=""}:{title:string;badge?:number;children:React.ReactNode;className?:string}){return <section className={`hdb-gov-panel ${className}`}><header><h2>{title}</h2>{badge!=null&&<span>{badge}</span>}</header>{children}</section>}
