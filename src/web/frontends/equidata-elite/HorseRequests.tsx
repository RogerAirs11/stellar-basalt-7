import { useId } from "react";
import { editorFieldLabel, horseDbRoutes, horseWorkflowIssueText, useHorseWorkflows, usePrincipalScope, type HorseWorkflowModel, type ResourceState } from "../../../frontend-kit";
import type { EquiDataRuntime } from "./adapter";
import { Panel, SectionTitle } from "./components";
import { EditorField } from "./editorUi";
import { edxClaimStatusLabel, edxText } from "./i18n";
import { num } from "./format";

const accessFor = (view: EquiDataRuntime) => ({
  claimRead: Boolean(view.user) && view.capabilities.claims && view.permissions.includes("claim.read_own"),
  claimCreate: Boolean(view.user) && view.capabilities.claims && view.permissions.includes("claim.create"),
  changeRead: Boolean(view.user) && view.capabilities.changes && view.permissions.includes("change.read_own"),
  changeCreate: Boolean(view.user) && view.capabilities.changes && view.permissions.includes("change.create"),
});
const useModel = (view: EquiDataRuntime, horseId?: number) => useHorseWorkflows({
  platform: view.platform, scope: usePrincipalScope(view.user, view.permissions), horseId,
  access: horseId == null ? accessFor(view) : { ...accessFor(view), changeRead: false, changeCreate: false }, source: "equidata-elite",
});

function ReadNotice({ state, reload, view }: { state: ResourceState<unknown>; reload: () => void; view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  if (state.phase === "ready" || state.phase === "empty" || state.phase === "idle") return null;
  const loading = state.phase === "loading" || state.phase === "reloading";
  return <div className="edx113-workflow-notice" role={loading ? "status" : "alert"}>
    <p>{loading ? state.phase === "reloading" ? L("Refreshing; the displayed requests may be out of date.", "در حال تازه‌سازی؛ درخواست‌های نمایش‌داده‌شده ممکن است قدیمی باشند.") : L("Loading your requests…", "در حال بارگذاری درخواست‌های شما…") : state.reason}</p>
    {!loading && <button type="button" className="secondary" onClick={reload}>{L("Try loading again", "تلاش دوباره برای بارگذاری")}</button>}
  </div>;
}

function RequestFeedback({ model, kind, view }: { model: HorseWorkflowModel; kind: "claim" | "change"; view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const claim = kind === "claim";
  const state = claim ? model.claimCommand : model.changeCommand;
  const receipt = claim ? model.claimReceipt : model.changeReceipt;
  const uncertain = claim ? model.claimUncertain : model.changeUncertain;
  const conflict = claim ? model.claimConflict : model.changeConflict;
  const canRead = claim ? model.access.claimRead : model.access.changeRead;
  const ready = claim ? model.claimRecoveryReady : model.changeRecoveryReady;
  const reload = claim ? model.reloadClaims : model.reloadChanges;
  if (receipt && state.phase === "accepted") return <div className="edx113-workflow-notice" role="status"><strong>{L("Request recorded", "درخواست ثبت شد")}</strong><span><bdi>{receipt.id}</bdi> · {edxClaimStatusLabel(view.locale, receipt.status)}</span></div>;
  if (state.phase === "submitting") return <p role="status">{L("Sending your request…", "در حال ارسال درخواست شما…")}</p>;
  if (uncertain || conflict) return <div className="edx113-workflow-notice is-warning" role="alert">
    <strong>{uncertain ? L("The outcome is unknown", "نتیجه نامشخص است") : L("This request changed", "این درخواست تغییر کرده است")}</strong>
    <p>{L("Your draft is preserved. Load your latest requests and inspect them before taking another action.", "پیش‌نویس شما حفظ شده است. پیش از اقدام دوباره، آخرین درخواست‌ها را بارگذاری و بررسی کنید.")}</p>
    {state.phase === "failed" || state.phase === "rejected" ? <small dir="auto">{state.message}</small> : null}
    {canRead ? <button type="button" className="secondary" onClick={reload}>{L("Reload my requests", "بارگذاری دوباره درخواست‌های من")}</button> : <p>{L("This account cannot read its requests. Ask a registry reviewer to check the result before creating another request.", "این حساب مجوز خواندن درخواست‌ها را ندارد. پیش از درخواست جدید، از بازبین سامانه بخواهید نتیجه را بررسی کند.")}</p>}
    {ready && <><p>{L("The fresh list is shown below. If your request appears there, continue with that record.", "فهرست تازه در زیر نمایش داده می‌شود. اگر درخواست شما در آن است، همان سابقه را دنبال کنید.")}</p><div className="edx112-editor-actions">
      {!claim && model.canRetryExactCorrection && <button type="button" onClick={() => void model.retryExactCorrection()}>{L("Recover this exact submission", "بازیابی همین درخواست")}</button>}
      <button type="button" className="secondary" onClick={claim ? model.acknowledgeClaim : model.acknowledgeCorrection}>{L("I checked the requests; return to editing", "درخواست‌ها را بررسی کردم؛ بازگشت به ویرایش")}</button>
    </div></>}
  </div>;
  return state.phase === "rejected" ? <div className="edx113-workflow-notice is-warning" role="alert"><strong>{L("The request was refused", "درخواست پذیرفته نشد")}</strong><p dir="auto">{state.message}</p></div> : null;
}

function OwnershipForm({ model, view }: { model: HorseWorkflowModel; view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const hint = useId();
  return <>
    {model.access.claimCreate ? <form className="edx112-editor-form edx113-claim-form" onSubmit={event => { event.preventDefault(); void model.submitClaim(); }}>
      <fieldset className="edx112-editor-fields" disabled={model.claimLocked}>
        {model.horseId == null ? <EditorField field="horse_id" locale={view.locale}><input name="horse_id" inputMode="numeric" autoComplete="off" maxLength={32} required value={model.claimDraft.horseId} onChange={event => model.setClaimDraft({ horseId: event.target.value })} /></EditorField> : <p>{L("Horse", "اسب")} <bdi>#{num(model.horseId, view.locale)}</bdi></p>}
        <EditorField field={L("Ownership evidence", "مدرک مالکیت")} locale={view.locale}><textarea name="evidence" required minLength={10} maxLength={2000} rows={4} value={model.claimDraft.evidence} onChange={event => model.setClaimDraft({ evidence: event.target.value })} dir="auto" aria-describedby={hint} /></EditorField>
        <small id={hint}>{L("Describe your connection to this horse and the records a reviewer can check. Submitting a claim does not itself change recorded ownership.", "ارتباط خود با این اسب و سوابقی را که بازبین می‌تواند بررسی کند شرح دهید. ثبت ادعا به‌خودی‌خود مالکیت ثبت‌شده را تغییر نمی‌دهد.")}</small>
        {(model.claimDraft.horseId || model.claimDraft.evidence) && model.claimIssues.length > 0 && <ul className="edx113-workflow-hints">{model.claimIssues.map(issue => <li key={issue}>{horseWorkflowIssueText(issue, view.locale)}</li>)}</ul>}
        <div className="edx112-editor-actions"><button type="submit" disabled={model.claimLocked || model.claimIssues.length > 0}>{L("Submit ownership evidence", "ثبت مدرک مالکیت")}</button></div>
      </fieldset>
    </form> : <p>{L("Your account cannot create ownership claims here.", "حساب شما در این بخش امکان ثبت ادعای مالکیت ندارد.")}</p>}
    <RequestFeedback view={view} model={model} kind="claim" />
  </>;
}

function OwnershipList({ model, view }: { model: HorseWorkflowModel; view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const rows = model.claims.phase === "ready" || model.claims.phase === "reloading" ? model.claims.data : [];
  return <><div className="edx112-editor-section-head"><h3>{L("My ownership claims", "ادعاهای مالکیت من")}</h3>{model.access.claimRead && <button className="secondary" type="button" disabled={model.claimCommand.phase === "submitting" || ["loading", "reloading"].includes(model.claims.phase)} onClick={model.reloadClaims}>{L("Refresh claims", "تازه‌سازی ادعاها")}</button>}</div>
    {!model.access.claimRead ? <p>{L("Reading ownership claims is not available to this account.", "خواندن ادعاهای مالکیت برای این حساب در دسترس نیست.")}</p> : <ReadNotice state={model.claims} reload={model.reloadClaims} view={view} />}
    {model.claims.phase === "ready" && !rows.length && <p>{L("No ownership claims have been recorded here.", "هنوز ادعای مالکیتی در این بخش ثبت نشده است.")}</p>}
    <ol className="edx113-request-history">{rows.map(row => <li key={row.id}><div><button type="button" className="edx113-record-link" onClick={() => view.navigate(horseDbRoutes.horse(row.horse_id))}>{(view.locale === "fa" ? row.name_native || row.name_latin : row.name_latin || row.name_native) || `${L("Horse", "اسب")} #${num(row.horse_id, view.locale)}`}</button><span>{edxClaimStatusLabel(view.locale, row.status)}</span></div><small><bdi>{row.id}</bdi> · <time dateTime={row.created_at}>{row.created_at}</time></small>{row.review_note && <p dir="auto"><strong>{L("Reviewer’s note", "یادداشت بازبین")}: </strong>{row.review_note}</p>}</li>)}</ol>
  </>;
}

function CorrectionComposer({ model, view }: { model: HorseWorkflowModel; view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const d = model.changeDraft;
  return <><h3>{model.editing ? L("Edit this draft", "ویرایش این پیش‌نویس") : L("Propose a correction", "پیشنهاد اصلاح")}</h3>
    {model.access.changeCreate ? <form id="edx-correction-form" className="edx112-editor-form edx113-correction-form" onSubmit={event => { event.preventDefault(); void model.saveCorrection(true); }}>
      <fieldset className="edx112-editor-fields" disabled={model.changeLocked}>
        <div className="edx112-editor-grid"><EditorField field={L("Request type", "نوع درخواست")} locale={view.locale}><select name="request_type" value={d.requestType} disabled={Boolean(model.editing)} onChange={event => model.setChangeDraft({ requestType: event.target.value as typeof d.requestType })}><option value="update_horse">{L("Horse record correction", "اصلاح سابقه اسب")}</option><option value="ownership">{L("Ownership record correction", "اصلاح سابقه مالکیت")}</option><option value="other">{L("Other registry correction", "سایر اصلاحات سامانه")}</option></select></EditorField><EditorField field={d.requestType === "other" ? L("Horse ID (optional)", "شناسه اسب (اختیاری)") : "horse_id"} locale={view.locale}><input name="horse_id" inputMode="numeric" autoComplete="off" maxLength={32} value={d.horseId} disabled={Boolean(model.editing)} onChange={event => model.setChangeDraft({ horseId: event.target.value })} /></EditorField></div>
        <EditorField field={L("Correction summary", "خلاصه اصلاح")} locale={view.locale}><textarea name="summary" required minLength={3} maxLength={2000} rows={4} value={d.summary} dir="auto" onChange={event => model.setChangeDraft({ summary: event.target.value })} /></EditorField>
        <EditorField field={L("Evidence note (optional)", "یادداشت مدرک (اختیاری)")} locale={view.locale}><textarea name="evidence" maxLength={2000} rows={3} value={d.evidence} dir="auto" onChange={event => model.setChangeDraft({ evidence: event.target.value })} /></EditorField>
        {!model.editing ? <details><summary>{L("Propose a specific field value (optional)", "پیشنهاد مقدار مشخص برای فیلد (اختیاری)")}</summary><div className="edx112-editor-fields"><EditorField field={L("Field name", "نام فیلد")} locale={view.locale}><input name="field_name" maxLength={120} value={d.fieldName} onChange={event => model.setChangeDraft({ fieldName: event.target.value })} /></EditorField><EditorField field={L("Current value", "مقدار فعلی")} locale={view.locale}><input name="old_value" maxLength={2000} value={d.oldValue} dir="auto" onChange={event => model.setChangeDraft({ oldValue: event.target.value })} /></EditorField><EditorField field={L("Proposed value", "مقدار پیشنهادی")} locale={view.locale}><input name="proposed_value" maxLength={2000} value={d.proposedValue} dir="auto" onChange={event => model.setChangeDraft({ proposedValue: event.target.value })} /></EditorField></div></details> : <p>{L("Existing field proposals are preserved. Save this draft before submitting it for review.", "پیشنهادهای فعلی فیلدها حفظ می‌شوند. پیش از ارسال برای بررسی، پیش‌نویس را ذخیره کنید.")}</p>}
        {(d.summary || d.horseId) && model.changeIssues.length > 0 && <ul className="edx113-workflow-hints">{model.changeIssues.map(issue => <li key={issue}>{horseWorkflowIssueText(issue, view.locale)}</li>)}</ul>}
        <div className="edx112-editor-actions"><button type="submit" disabled={model.changeLocked || model.changeIssues.length > 0}>{model.editing ? L("Save draft changes", "ذخیره تغییرات پیش‌نویس") : L("Submit correction", "ثبت اصلاح")}</button>{!model.editing && <button type="button" className="secondary" disabled={model.changeLocked || model.changeIssues.length > 0} onClick={() => void model.saveCorrection(false)}>{L("Save as draft", "ذخیره پیش‌نویس")}</button>}{model.editing && <button type="button" className="secondary" onClick={model.cancelEdit}>{L("Cancel editing", "لغو ویرایش")}</button>}</div>
      </fieldset>
    </form> : <p>{L("This account cannot submit corrections.", "این حساب امکان ثبت اصلاح ندارد.")}</p>}
    <RequestFeedback model={model} kind="change" view={view} />
  </>;
}

function CorrectionList({ model, view }: { model: HorseWorkflowModel; view: EquiDataRuntime }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const rows = model.changes.phase === "ready" || model.changes.phase === "reloading" ? model.changes.data : [];
  const disabled = model.changeLocked || model.changes.phase !== "ready";
  return <><div className="edx112-editor-section-head"><h3>{L("My correction requests", "درخواست‌های اصلاح من")}</h3>{model.access.changeRead && <button type="button" className="secondary" disabled={model.changeCommand.phase === "submitting" || ["loading", "reloading"].includes(model.changes.phase)} onClick={model.reloadChanges}>{L("Refresh corrections", "تازه‌سازی اصلاحات")}</button>}</div>
    {!model.access.changeRead ? <p>{L("Reading corrections is not available to this account.", "خواندن اصلاحات برای این حساب در دسترس نیست.")}</p> : <ReadNotice state={model.changes} reload={model.reloadChanges} view={view} />}
    {model.changes.phase === "ready" && !rows.length && <p>{L("No correction requests have been recorded here.", "هنوز درخواست اصلاحی در این بخش ثبت نشده است.")}</p>}
    <ol className="edx113-request-history">{rows.map(row => <li key={row.id}>
      <div><strong dir="auto">{row.summary || L("Registry correction", "اصلاح سامانه")}</strong><span>{row.review_status === "needs_changes" ? L("Changes requested", "نیازمند اصلاح") : edxClaimStatusLabel(view.locale, row.status)}</span></div>
      <small><bdi>{row.id}</bdi> · <time dateTime={row.created_at}>{row.created_at}</time></small>{row.horse_id && <button type="button" className="edx113-record-link" onClick={() => view.navigate(horseDbRoutes.horse(row.horse_id!))}>{L("Open horse", "باز کردن اسب")} #{num(row.horse_id, view.locale)}</button>}
      {row.review_note && <p dir="auto"><strong>{L("Reviewer’s note", "یادداشت بازبین")}: </strong>{row.review_note}</p>}
      {typeof row.evidence?.note === "string" && <p dir="auto"><strong>{L("Your evidence", "مدرک شما")}: </strong>{row.evidence.note}</p>}
      {row.items.length > 0 && <details><summary>{L("Field proposals", "پیشنهادهای فیلد")}</summary><dl className="edx113-field-proposals">{row.items.map((item, index) => <div key={index}><dt>{editorFieldLabel(item.field_name, view.locale)}</dt><dd><span>{L("Current", "فعلی")}: </span><bdi>{String(item.old_value ?? "—")}</bdi><br /><span>{L("Proposed", "پیشنهادی")}: </span><bdi>{String(item.proposed_value ?? "—")}</bdi></dd></div>)}</dl></details>}
      {model.access.changeCreate && <div className="edx112-editor-actions">{row.status === "draft" && <>{!row.submission && !row.parent_correction && row.request_type !== "create_horse" && <button type="button" className="secondary" disabled={disabled} onClick={() => { if (model.changeDraft.summary.trim() && !window.confirm(L("Replace the correction form with this saved draft?", "فرم اصلاح با این پیش‌نویس ذخیره‌شده جایگزین شود؟"))) return; if (model.editCorrection(row)) document.querySelector<HTMLTextAreaElement>('#edx-correction-form textarea[name="summary"]')?.focus(); }}>{L("Edit draft", "ویرایش پیش‌نویس")}</button>}<button type="button" disabled={disabled || model.editing?.id === row.id} onClick={() => void model.transitionCorrection(row.id, "submit")}>{L("Submit saved draft", "ارسال پیش‌نویس ذخیره‌شده")}</button></>}{(row.status === "draft" || row.status === "pending") && <button type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm(L("Withdraw this correction request? It will remain visible in your records.", "این درخواست اصلاح پس گرفته شود؟ سابقه آن همچنان قابل مشاهده می‌ماند."))) void model.transitionCorrection(row.id, "withdraw"); }}>{L("Withdraw request", "پس گرفتن درخواست")}</button>}</div>}
    </li>)}</ol>
  </>;
}

export function EliteHorseClaimPanel({ view, horseId }: { view: EquiDataRuntime; horseId: number }) {
  const model = useModel(view, horseId);
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  if (!model.access.claimRead && !model.access.claimCreate) return null;
  return <Panel id="edx-horse-claim-form" className="edx112-editor edx113-workflows"><h2>{L("Ownership review", "بررسی مالکیت")}</h2><div className="edx113-workflow-columns"><div><OwnershipForm model={model} view={view} /></div><div><OwnershipList model={model} view={view} /></div></div></Panel>;
}

export function EliteHorseRequestsPage({ view }: { view: EquiDataRuntime }) {
  const model = useModel(view);
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  return <main className="edx-content edx-page"><SectionTitle headingLevel={1} eyebrow={L("REGISTRY REVIEW", "بررسی سامانه ثبت")} title={L("Claims & corrections", "ادعاها و اصلاحات")} copy={L("Send evidence, follow review decisions, and manage your correction drafts.", "مدرک بفرستید، تصمیم‌های بازبینی را دنبال کنید و پیش‌نویس‌های اصلاح را مدیریت کنید.")} />
    {!view.user ? <Panel className="edx112-editor"><h2>{L("Sign in to continue", "برای ادامه وارد شوید")}</h2><p>{L("Your claims and correction requests belong to your account.", "ادعاها و درخواست‌های اصلاح به حساب شما تعلق دارند.")}</p><button type="button" onClick={() => view.navigate(horseDbRoutes.frontend("equidata-elite", "/governance"))}>{L("Open sign in", "باز کردن ورود")}</button></Panel> : <>
      <Panel className="edx112-editor edx113-workflows"><h2>{L("Ownership claims", "ادعاهای مالکیت")}</h2><div className="edx113-workflow-columns"><div><OwnershipForm model={model} view={view} /></div><div><OwnershipList model={model} view={view} /></div></div></Panel>
      <Panel className="edx112-editor edx113-workflows"><h2>{L("Record corrections", "اصلاح سوابق")}</h2><div className="edx113-workflow-columns"><div><CorrectionComposer model={model} view={view} /></div><div><CorrectionList model={model} view={view} /></div></div></Panel>
    </>}
  </main>;
}
