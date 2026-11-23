import { editorFieldLabel, horseDbRoutes, useHorseReviewQueue, usePrincipalScope, type FrontendRuntimeProps, type HorseReviewKind } from "../../../frontend-kit";
import { EditorField } from "./editorUi";
import { edxClaimStatusLabel, edxText } from "./i18n";

/** Elite keeps its own review cards; shared state owns authority and recovery. */
export function EliteReviewQueue({ runtime, kind }: { runtime: FrontendRuntimeProps; kind: HorseReviewKind }) {
  const L = (en: string, fa: string) => edxText(runtime.locale, en, fa);
  const flow = useHorseReviewQueue({ platform: runtime.platform, scope: usePrincipalScope(runtime.user, runtime.permissions), kind, enabled: Boolean(runtime.user) && runtime.permissions.includes(kind === "claim" ? "claim.review" : "change.review") });
  const loading = flow.rows.phase === "loading" || flow.rows.phase === "reloading";
  const rows = flow.rows.phase === "ready" ? flow.rows.data : [];
  const textValue = (value: unknown) => value == null ? "—" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <section className="hdb-gov-panel edx113-review-queue">
    <header><h2>{kind === "claim" ? L("Ownership review", "بررسی مالکیت") : L("Correction review", "بررسی اصلاحات")}</h2><button type="button" onClick={flow.reload} disabled={flow.pending || loading}>{L("Refresh queue", "تازه‌سازی صف")}</button></header>
    <div className="edx113-review-body">
      {loading && <p role="status">{L("Loading the current review queue…", "در حال بارگذاری صف فعلی بررسی…")}</p>}
      {"reason" in flow.rows && <div className="edx113-workflow-notice is-warning" role="alert"><strong>{L("Review queue unavailable", "صف بررسی در دسترس نیست")}</strong><p dir="auto">{flow.rows.reason}</p><button type="button" onClick={flow.reload}>{L("Retry queue", "تلاش دوباره برای صف")}</button></div>}
      {flow.pending && <p role="status">{L("Recording your review…", "در حال ثبت بررسی شما…")}</p>}
      {(flow.uncertain || flow.conflict) && <div className="edx113-workflow-notice is-warning" role="alert"><strong>{flow.conflict ? L("The review record changed", "سابقه بررسی تغییر کرده است") : L("Review outcome unknown", "نتیجه بررسی نامشخص است")}</strong><p>{L("Sending is paused. Reload the queue and inspect its current status before making another decision. Your reason remains in this page.", "ارسال متوقف است. پیش از تصمیم دیگر، صف را دوباره بارگذاری و وضعیت فعلی آن را بررسی کنید. دلیل شما در این صفحه حفظ شده است.")}</p>{(flow.command.phase === "failed" || flow.command.phase === "rejected") && <small dir="auto">{flow.command.message}</small>}<div className="edx112-editor-actions"><button type="button" disabled={loading} onClick={flow.reload}>{L("Reload review queue", "بارگذاری دوباره صف بررسی")}</button><button type="button" className="secondary" disabled={!flow.recoveryReady} onClick={flow.acknowledge}>{L("I inspected the current queue", "صف فعلی را بررسی کردم")}</button></div></div>}
      {!flow.uncertain && !flow.conflict && flow.command.phase === "rejected" && <p className="edx113-workflow-notice is-warning" role="alert" dir="auto">{flow.command.message}</p>}
      {flow.receipt && flow.command.phase === "accepted" && <div className="edx113-workflow-notice" role="status"><strong>{L("Review recorded", "بررسی ثبت شد")}</strong><p><bdi>{flow.receipt.id}</bdi> · {edxClaimStatusLabel(runtime.locale, flow.receipt.status)}</p>{flow.receipt.canonicalApplied && <p>{L("The server confirmed a canonical registry change.", "سرور تغییر در سابقه مرجع سامانه را تأیید کرد.")}</p>}{flow.receipt.accessGranted && <p>{L("Horse-scoped access was granted to the claimant.", "دسترسی مختص این اسب به مدعی اعطا شد.")}</p>}{flow.receipt.canonicalHorseId && <button type="button" onClick={() => runtime.navigate(horseDbRoutes.horse(flow.receipt!.canonicalHorseId!))}>{L("Open the registered horse", "باز کردن اسب ثبت‌شده")}</button>}</div>}
      {flow.rows.phase === "ready" && !rows.length && <p>{L("No requests were returned in this queue.", "درخواستی در این صف بازگردانده نشد.")}</p>}
      <div className="edx113-review-cards">{rows.map(row => {
        const change = "request_type" in row;
        const actionable = row.status === "pending" || (change && row.status === "draft");
        const title = change ? row.summary || row.request_type : (runtime.locale === "fa" ? row.name_native || row.name_latin : row.name_latin || row.name_native) || `#${row.horse_id}`;
        return <article key={row.id} className="edx113-review-card">
          <header><h3 dir="auto">{title}</h3><span>{edxClaimStatusLabel(runtime.locale, row.status)}</span></header>
          <p className="edx113-review-meta"><bdi>{row.id}</bdi> · <span dir="auto">{change ? row.submitted_by : row.claimant}</span> · <time dateTime={row.created_at}>{row.created_at}</time></p>
          {row.horse_id && <button type="button" className="edx113-record-link" onClick={() => runtime.navigate(horseDbRoutes.horse(row.horse_id!))}>{L("Inspect horse", "بررسی اسب")} #{row.horse_id}</button>}
          {!change && row.person_id && <p>{L("Linked person", "شخص مرتبط")}: <bdi>#{row.person_id}</bdi></p>}
          <details className="edx113-review-evidence" open><summary>{L("Submitted evidence", "مدرک ارائه‌شده")}</summary>{row.evidence && Object.keys(row.evidence).length ? <dl>{Object.entries(row.evidence).map(([key, value]) => <div key={key}><dt>{editorFieldLabel(key, runtime.locale)}</dt><dd dir="auto">{textValue(value)}</dd></div>)}</dl> : <p>{L("No evidence was supplied in this record.", "مدرکی در این سابقه ارائه نشده است.")}</p>}</details>
          {change && row.items.length > 0 && <dl className="edx113-field-proposals">{row.items.map((item, index) => <div key={index}><dt>{editorFieldLabel(item.field_name, runtime.locale)}</dt><dd><span>{L("Submitted base value", "مقدار پایه ارسالی")}: </span><bdi>{textValue(item.old_value)}</bdi><br/><span>{L("Proposed", "پیشنهادی")}: </span><bdi>{textValue(item.proposed_value)}</bdi></dd></div>)}</dl>}
          {change && (row.submission || row.parent_correction) && <details className="edx113-review-evidence"><summary>{L("Structured proposal", "پیشنهاد ساختاریافته")}</summary><dl>{Object.entries(row.parent_correction || row.submission || {}).map(([key, value]) => <div key={key}><dt>{editorFieldLabel(key, runtime.locale)}</dt><dd dir="auto">{textValue(value)}</dd></div>)}</dl></details>}
          {row.review_note && <p dir="auto"><b>{L("Latest reviewer note", "آخرین یادداشت بازبین")}: </b>{row.review_note}</p>}
          {actionable && <form className="edx112-editor-form" onSubmit={event => event.preventDefault()}><fieldset className="edx112-editor-fields" disabled={flow.locked}><EditorField field={L("Review reason", "دلیل بررسی")} locale={runtime.locale}><textarea name="review_reason" rows={3} minLength={3} maxLength={2000} required dir="auto" value={flow.notes[row.id] ?? ""} onChange={event => flow.setNote(row.id, event.target.value)} /></EditorField><p>{L("Explain the evidence and your decision. Approval can change the registry or grant access to this horse.", "مدرک و تصمیم خود را توضیح دهید. تأیید می‌تواند سابقه سامانه را تغییر دهد یا دسترسی به این اسب اعطا کند.")}</p><div className="edx112-editor-actions"><button type="button" disabled={!flow.canReview(row.id)} onClick={() => void flow.review(row.id, "approved")}>{L("Approve request", "تأیید درخواست")}</button><button type="button" className="danger" disabled={!flow.canReview(row.id, "rejected")} onClick={() => void flow.review(row.id, "rejected")}>{L("Reject request", "رد درخواست")}</button>{change && <button type="button" className="secondary" disabled={!flow.canReview(row.id, "needs_changes")} onClick={() => void flow.review(row.id, "needs_changes")}>{L("Request changes", "درخواست اصلاح")}</button>}</div></fieldset></form>}
        </article>;
      })}</div>
    </div>
  </section>;
}
