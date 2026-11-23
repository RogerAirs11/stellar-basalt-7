import { useId } from "react";
import { editorFieldLabel, horseDbRoutes, horseWorkflowIssueText, useHorseWorkflows, usePrincipalScope, type HorseWorkflowModel, type ResourceState } from "../../../frontend-kit";
import type { ClassicRuntime } from "./adapter";
import { Badge, PageTitle, Section } from "./components";
import { DonorField } from "./donorUi";
import { code, num, t } from "./i18n";

function useWorkflow(view: ClassicRuntime, horseId?: number) {
  const scope = usePrincipalScope(view.user, view.permissions);
  const signedIn = Boolean(view.user);
  return useHorseWorkflows({ platform: view.platform, scope, horseId, source: "federation-classic", access: {
    claimRead: signedIn && view.capabilities.claims && view.permissions.includes("claim.read_own"),
    claimCreate: signedIn && view.capabilities.claims && view.permissions.includes("claim.create"),
    changeRead: horseId == null && signedIn && view.capabilities.changes && view.permissions.includes("change.read_own"),
    changeCreate: horseId == null && signedIn && view.capabilities.changes && view.permissions.includes("change.create"),
  } });
}

function ResourceMessage({ state, retry, locale }: { state: ResourceState<unknown>; retry: () => void; locale: "en" | "fa" | "ar" }) {
  const L = (en: string, fa: string) => t(locale, en, fa);
  if (state.phase === "loading" || state.phase === "reloading") return <p className="fc113-notice" role="status">{state.phase === "reloading" ? L("Refreshing requests. The current display may be stale.", "در حال تازه‌سازی درخواست‌ها. داده‌های فعلی ممکن است قدیمی باشند.") : L("Loading your requests…", "در حال بارگذاری درخواست‌های شما…")}</p>;
  return "reason" in state ? <div className="fc113-notice fc113-notice-error" role="alert"><strong>{L("The request list is unavailable", "فهرست درخواست‌ها در دسترس نیست")}</strong><p dir="auto">{state.reason}</p><button type="button" className="fc-btn fc-btn-gray" onClick={retry}>{L("Retry this list", "تلاش دوباره برای این فهرست")}</button></div> : null;
}

function CommandMessage({ flow, area, view }: { flow: HorseWorkflowModel; area: "claim" | "change"; view: ClassicRuntime }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const isClaim = area === "claim";
  const command = isClaim ? flow.claimCommand : flow.changeCommand;
  const unknown = isClaim ? flow.claimUncertain : flow.changeUncertain;
  const recovery = isClaim ? flow.claimRecoveryReady : flow.changeRecoveryReady;
  const receipt = isClaim ? flow.claimReceipt : flow.changeReceipt;
  const readable = isClaim ? flow.access.claimRead : flow.access.changeRead;
  if (command.phase === "submitting") return <p role="status">{L("Submitting…", "در حال ثبت…")}</p>;
  if (command.phase === "accepted" && receipt) return <div className="fc113-notice" role="status"><strong>{L("Saved to your account", "در حساب شما ذخیره شد")}</strong><p><bdi>{receipt.id}</bdi> · {code(receipt.status, view.locale)}</p></div>;
  if (unknown || (isClaim ? flow.claimConflict : flow.changeConflict)) return <div className="fc113-notice fc113-notice-error" role="alert"><strong>{unknown ? L("The outcome is unknown", "نتیجه نامشخص است") : L("Reload the changed request", "درخواست تغییرکرده را دوباره بارگذاری کنید")}</strong><p>{L("Your form is preserved and sending is paused. Check your latest requests before continuing.", "فرم شما حفظ شده و ارسال متوقف است. پیش از ادامه، آخرین درخواست‌های خود را بررسی کنید.")}</p>
    {(command.phase === "failed" || command.phase === "rejected") && <small dir="auto">{command.message}</small>}
    {readable ? <button type="button" className="fc-btn fc-btn-purple" onClick={isClaim ? flow.reloadClaims : flow.reloadChanges}>{L("Reload my requests", "بارگذاری دوباره درخواست‌های من")}</button> : <p>{L("A registry reviewer must verify the result because this account cannot read its requests.", "این حساب مجوز خواندن درخواست‌ها را ندارد؛ بازبین سامانه باید نتیجه را بررسی کند.")}</p>}
    {recovery && <div className="fc113-recovery-actions"><p>{L("The fresh list is available below. Follow the existing record if the request has already arrived.", "فهرست تازه در زیر در دسترس است. اگر درخواست رسیده است، همان سابقه را دنبال کنید.")}</p>{!isClaim && flow.canRetryExactCorrection && <button type="button" className="fc-btn fc-btn-purple" onClick={() => void flow.retryExactCorrection()}>{L("Recover this exact submission", "بازیابی همین درخواست")}</button>}<button type="button" className="fc-btn fc-btn-gray" onClick={isClaim ? flow.acknowledgeClaim : flow.acknowledgeCorrection}>{L("I checked the requests; return to editing", "درخواست‌ها را بررسی کردم؛ بازگشت به ویرایش")}</button></div>}
  </div>;
  return command.phase === "rejected" ? <div className="fc113-notice fc113-notice-error" role="alert"><strong>{L("Action refused", "اقدام پذیرفته نشد")}</strong><p dir="auto">{command.message}</p></div> : null;
}

function ClaimForm({ flow, view }: { flow: HorseWorkflowModel; view: ClassicRuntime }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const hint = useId();
  return <>{flow.access.claimCreate ? <form className="fc-workflow-form fc113-claim-form" onSubmit={event => { event.preventDefault(); void flow.submitClaim(); }}>
    <fieldset disabled={flow.claimLocked}>
      {flow.horseId == null ? <DonorField label={L("Horse ID", "شناسه اسب")}><input name="horse_id" required inputMode="numeric" maxLength={32} autoComplete="off" value={flow.claimDraft.horseId} onChange={event => flow.setClaimDraft({ horseId: event.target.value })} /></DonorField> : <p className="fc-muted">{L("For horse", "برای اسب")} <bdi>#{num(flow.horseId, view.locale)}</bdi></p>}
      <DonorField label={L("Ownership evidence", "مدرک مالکیت")}><textarea name="evidence" required minLength={10} maxLength={2000} rows={4} value={flow.claimDraft.evidence} dir="auto" aria-describedby={hint} onChange={event => flow.setClaimDraft({ evidence: event.target.value })} /></DonorField>
      <p className="fc-muted" id={hint}>{L("Explain your connection to this horse and identify records that support it. Submission starts a review; it does not itself change the recorded owner.", "ارتباط خود با این اسب و سوابق پشتیبان آن را توضیح دهید. ثبت درخواست، بررسی را آغاز می‌کند و به‌خودی‌خود مالک ثبت‌شده را تغییر نمی‌دهد.")}</p>
      {(flow.claimDraft.horseId || flow.claimDraft.evidence) && flow.claimIssues.length > 0 && <ul className="fc113-form-hints">{flow.claimIssues.map(issue => <li key={issue}>{horseWorkflowIssueText(issue, view.locale)}</li>)}</ul>}
      <button className="fc-btn fc-btn-orange" type="submit" disabled={flow.claimLocked || flow.claimIssues.length > 0}>{L("Submit ownership evidence", "ثبت مدرک مالکیت")}</button>
    </fieldset>
  </form> : <p className="fc-muted">{L("This account cannot submit ownership claims.", "این حساب امکان ثبت ادعای مالکیت ندارد.")}</p>}<CommandMessage flow={flow} area="claim" view={view} /></>;
}

function ClaimRegister({ flow, view }: { flow: HorseWorkflowModel; view: ClassicRuntime }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const rows = flow.claims.phase === "ready" || flow.claims.phase === "reloading" ? flow.claims.data : [];
  return <>{flow.access.claimRead ? <><ResourceMessage state={flow.claims} retry={flow.reloadClaims} locale={view.locale} />{flow.claims.phase === "ready" && rows.length === 0 && <p className="fc-muted">{L("No ownership claims recorded.", "ادعای مالکیتی ثبت نشده است.")}</p>}
    <div className="fc113-request-register">{rows.map(row => <article key={row.id}><header><button type="button" className="fc113-record-title" onClick={() => view.navigate(horseDbRoutes.horse(row.horse_id))}>{(view.locale === "fa" ? row.name_native || row.name_latin : row.name_latin || row.name_native) || `${L("Horse", "اسب")} #${num(row.horse_id, view.locale)}`}</button><Badge tone={row.status === "approved" ? "active" : row.status === "rejected" ? "danger" : "warning"}>{code(row.status, view.locale)}</Badge></header><div className="fc113-record-meta"><bdi>{row.id}</bdi><time dateTime={row.created_at}>{row.created_at}</time></div>{row.review_note && <p dir="auto"><b>{L("Reviewer’s note", "یادداشت بازبین")}: </b>{row.review_note}</p>}</article>)}</div>
  </> : <p className="fc-muted">{L("This account cannot read ownership claims.", "این حساب مجوز خواندن ادعاهای مالکیت را ندارد.")}</p>}</>;
}

function CorrectionForm({ flow, view }: { flow: HorseWorkflowModel; view: ClassicRuntime }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const draft = flow.changeDraft;
  return <>{flow.access.changeCreate ? <form id="fc-correction-form" className="fc-workflow-form fc113-correction-form" onSubmit={event => { event.preventDefault(); void flow.saveCorrection(true); }}>
    <fieldset disabled={flow.changeLocked}>
      {flow.editing && <p className="fc113-notice">{L("Editing saved draft", "ویرایش پیش‌نویس ذخیره‌شده")}: <bdi>{flow.editing.id}</bdi></p>}
      <div className="fc-two-col-fields"><DonorField label={L("Correction type", "نوع اصلاح")}><select name="request_type" value={draft.requestType} disabled={Boolean(flow.editing)} onChange={event => flow.setChangeDraft({ requestType: event.target.value as typeof draft.requestType })}><option value="update_horse">{L("Horse record", "سابقه اسب")}</option><option value="ownership">{L("Ownership record", "سابقه مالکیت")}</option><option value="other">{L("Other registry information", "سایر اطلاعات سامانه")}</option></select></DonorField><DonorField label={draft.requestType === "other" ? L("Horse ID (optional)", "شناسه اسب (اختیاری)") : L("Horse ID", "شناسه اسب")}><input name="horse_id" inputMode="numeric" maxLength={32} autoComplete="off" disabled={Boolean(flow.editing)} value={draft.horseId} onChange={event => flow.setChangeDraft({ horseId: event.target.value })} /></DonorField></div>
      <DonorField label={L("Correction summary", "خلاصه اصلاح")}><textarea name="summary" required minLength={3} maxLength={2000} rows={3} dir="auto" value={draft.summary} onChange={event => flow.setChangeDraft({ summary: event.target.value })} /></DonorField>
      <DonorField label={L("Evidence note (optional)", "یادداشت مدرک (اختیاری)")}><textarea name="evidence" maxLength={2000} rows={3} dir="auto" value={draft.evidence} onChange={event => flow.setChangeDraft({ evidence: event.target.value })} /></DonorField>
      {flow.editing ? <p className="fc-muted">{L("Saved field proposals stay unchanged. Save your edits, then submit the saved draft for review.", "پیشنهادهای ذخیره‌شده فیلدها حفظ می‌شوند. ویرایش را ذخیره کنید و سپس پیش‌نویس را برای بررسی بفرستید.")}</p> : <details className="fc113-field-proposal"><summary>{L("Optional field proposal", "پیشنهاد اختیاری فیلد")}</summary><DonorField label={L("Field name", "نام فیلد")}><input name="field_name" maxLength={120} value={draft.fieldName} onChange={event => flow.setChangeDraft({ fieldName: event.target.value })} /></DonorField><div className="fc-two-col-fields"><DonorField label={L("Current value", "مقدار فعلی")}><input name="old_value" maxLength={2000} dir="auto" value={draft.oldValue} onChange={event => flow.setChangeDraft({ oldValue: event.target.value })} /></DonorField><DonorField label={L("Proposed value", "مقدار پیشنهادی")}><input name="proposed_value" maxLength={2000} dir="auto" value={draft.proposedValue} onChange={event => flow.setChangeDraft({ proposedValue: event.target.value })} /></DonorField></div></details>}
      {(draft.summary || draft.horseId) && flow.changeIssues.length > 0 && <ul className="fc113-form-hints">{flow.changeIssues.map(issue => <li key={issue}>{horseWorkflowIssueText(issue, view.locale)}</li>)}</ul>}
      <div className="fc-inline-actions"><button type="submit" className="fc-btn fc-btn-orange" disabled={flow.changeLocked || flow.changeIssues.length > 0}>{flow.editing ? L("Save draft changes", "ذخیره تغییرات پیش‌نویس") : L("Submit correction", "ثبت اصلاح")}</button>{flow.editing ? <button type="button" className="fc-btn fc-btn-gray" onClick={flow.cancelEdit}>{L("Cancel editing", "لغو ویرایش")}</button> : <button type="button" className="fc-btn fc-btn-gray" disabled={flow.changeLocked || flow.changeIssues.length > 0} onClick={() => void flow.saveCorrection(false)}>{L("Save as draft", "ذخیره پیش‌نویس")}</button>}</div>
    </fieldset>
  </form> : <p className="fc-muted">{L("This account cannot create correction requests.", "این حساب امکان ثبت درخواست اصلاح ندارد.")}</p>}<CommandMessage flow={flow} area="change" view={view} /></>;
}

function CorrectionRegister({ flow, view }: { flow: HorseWorkflowModel; view: ClassicRuntime }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const rows = flow.changes.phase === "ready" || flow.changes.phase === "reloading" ? flow.changes.data : [];
  const disabled = flow.changeLocked || flow.changes.phase !== "ready";
  return <>{flow.access.changeRead ? <><ResourceMessage state={flow.changes} retry={flow.reloadChanges} locale={view.locale} />{flow.changes.phase === "ready" && !rows.length && <p className="fc-muted">{L("No correction requests recorded.", "درخواست اصلاحی ثبت نشده است.")}</p>}
    <div className="fc113-request-register">{rows.map(row => <article key={row.id}><header><h3 dir="auto">{row.summary || code(row.request_type, view.locale)}</h3><Badge tone={row.status === "approved" ? "active" : row.status === "rejected" ? "danger" : "warning"}>{row.review_status === "needs_changes" ? L("Changes requested", "نیازمند اصلاح") : code(row.status, view.locale)}</Badge></header>
      <div className="fc113-record-meta"><bdi>{row.id}</bdi><time dateTime={row.created_at}>{row.created_at}</time>{row.horse_id && <button type="button" className="fc113-record-title" onClick={() => view.navigate(horseDbRoutes.horse(row.horse_id!))}>{L("Horse", "اسب")} #{num(row.horse_id, view.locale)}</button>}</div>
      {row.review_note && <p dir="auto"><b>{L("Reviewer’s note", "یادداشت بازبین")}: </b>{row.review_note}</p>}{typeof row.evidence?.note === "string" && <p dir="auto"><b>{L("Your evidence", "مدرک شما")}: </b>{row.evidence.note}</p>}
      {row.items.length > 0 && <details><summary>{L("Review proposed fields", "مشاهده فیلدهای پیشنهادی")}</summary><dl className="fc113-proposal-list">{row.items.map((item, index) => <div key={index}><dt>{editorFieldLabel(item.field_name, view.locale)}</dt><dd><span>{L("Current", "فعلی")}: </span><bdi>{String(item.old_value ?? "—")}</bdi></dd><dd><span>{L("Proposed", "پیشنهادی")}: </span><bdi>{String(item.proposed_value ?? "—")}</bdi></dd></div>)}</dl></details>}
      {flow.access.changeCreate && <footer className="fc-inline-actions">{row.status === "draft" && <>{!row.submission && !row.parent_correction && row.request_type !== "create_horse" && <button type="button" className="fc-btn fc-btn-gray" disabled={disabled} onClick={() => { if (flow.changeDraft.summary.trim() && !window.confirm(L("Replace the form with this saved draft?", "فرم با این پیش‌نویس ذخیره‌شده جایگزین شود؟"))) return; if (flow.editCorrection(row)) document.querySelector<HTMLTextAreaElement>('#fc-correction-form textarea[name="summary"]')?.focus(); }}>{L("Edit draft", "ویرایش پیش‌نویس")}</button>}<button type="button" className="fc-btn fc-btn-purple" disabled={disabled || flow.editing?.id === row.id} onClick={() => void flow.transitionCorrection(row.id, "submit")}>{L("Submit saved draft", "ارسال پیش‌نویس ذخیره‌شده")}</button></>}{["draft", "pending"].includes(row.status) && <button type="button" className="fc-btn fc-btn-gray" disabled={disabled} onClick={() => { if (window.confirm(L("Withdraw this correction and keep its record?", "این اصلاح پس گرفته شود و سابقه آن باقی بماند؟"))) void flow.transitionCorrection(row.id, "withdraw"); }}>{L("Withdraw request", "پس گرفتن درخواست")}</button>}</footer>}
    </article>)}</div>
  </> : <p className="fc-muted">{L("This account cannot read correction requests.", "این حساب مجوز خواندن درخواست‌های اصلاح را ندارد.")}</p>}</>;
}

export function FeiHorseClaimPanel({ view, horseId }: { view: ClassicRuntime; horseId: number }) {
  const flow = useWorkflow(view, horseId);
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  if (!flow.access.claimRead && !flow.access.claimCreate) return null;
  return <div id="fc-horse-claim-form" className="fc113-workflows"><Section title={L("Ownership review", "بررسی مالکیت")}><div className="fc113-workflow-grid"><div><ClaimForm flow={flow} view={view} /></div><div><h3>{L("My claims for this horse", "ادعاهای من برای این اسب")}</h3><ClaimRegister flow={flow} view={view} />{flow.access.claimRead && <button type="button" className="fc-btn fc-btn-gray" disabled={flow.claimCommand.phase === "submitting"} onClick={flow.reloadClaims}>{L("Refresh claims", "تازه‌سازی ادعاها")}</button>}</div></div></Section></div>;
}

export function WorkflowPage({ view, goLocal }: { view: ClassicRuntime; goLocal: (path: string) => void }) {
  const flow = useWorkflow(view);
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  return <main className="fc-main fc-workflow-page fc113-workflows"><PageTitle title={L("Claims & corrections", "ادعاها و اصلاحات")} subtitle={L("Submit evidence, manage correction drafts, and follow review decisions.", "مدرک ثبت کنید، پیش‌نویس اصلاح را مدیریت کنید و تصمیم‌های بازبینی را دنبال کنید.")} />
    {!view.user ? <Section title={L("Sign in to continue", "برای ادامه وارد شوید")}><p>{L("Your claims and corrections are private to your account.", "ادعاها و اصلاحات شما به حساب شما تعلق دارند.")}</p>{view.capabilities.authentication && <button className="fc-btn fc-btn-orange" onClick={() => goLocal("/auth")}>{L("Sign in", "ورود")}</button>}</Section> : <>
      <div className="fc113-workflow-grid"><Section title={L("Ownership evidence", "مدرک مالکیت")}><ClaimForm flow={flow} view={view} /></Section><Section title={flow.editing ? L("Edit correction draft", "ویرایش پیش‌نویس اصلاح") : L("Propose a correction", "پیشنهاد اصلاح")}><CorrectionForm flow={flow} view={view} /></Section></div>
      <Section title={L("My ownership claims", "ادعاهای مالکیت من")} action={flow.access.claimRead && <button type="button" className="fc-btn fc-btn-gray" disabled={flow.claimCommand.phase === "submitting" || ["loading", "reloading"].includes(flow.claims.phase)} onClick={flow.reloadClaims}>{L("Refresh claims", "تازه‌سازی ادعاها")}</button>}><ClaimRegister flow={flow} view={view} /></Section>
      <Section title={L("My correction requests", "درخواست‌های اصلاح من")} action={flow.access.changeRead && <button type="button" className="fc-btn fc-btn-gray" disabled={flow.changeCommand.phase === "submitting" || ["loading", "reloading"].includes(flow.changes.phase)} onClick={flow.reloadChanges}>{L("Refresh corrections", "تازه‌سازی اصلاحات")}</button>}><CorrectionRegister flow={flow} view={view} /></Section>
    </>}
  </main>;
}
