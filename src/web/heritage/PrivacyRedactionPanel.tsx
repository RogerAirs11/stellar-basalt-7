import { uiText } from "../../shared/uiLocale";
import "../styles/heritage.workbenches.css";
import React, { useState } from "react";
import {
  redactionFulfillmentLabel,
  runRedactionDecision,
  runRedactionFulfillment,
  useAdminRedactionQueue,
  useRedactionCommands,
  principalScopeKey,
  type AdminRedactionQueueRow,
  type PlatformClient,
  type PlatformUser,
} from "../../frontend-kit";
import { useI18n } from "../i18n";

/**
 * R117-18 (Master AI R117 handoff D43) — Heritage's native privacy-redaction
 * OPERATOR surface over the retained R114 executor. The core honesty pins:
 *
 *  - A GRANT is a decision; only the executor's operation receipt reports
 *    completion. The per-row indicator is driven by execution_status, never
 *    by the decision.
 *  - A grant under an ACTIVE hold refuses honestly (grant_blocked_by_hold)
 *    and execution never bypasses a hold.
 *  - An untargeted request (no exact subject service request) refuses
 *    (redaction_scope_unresolved) — no account-wide erasure is implied.
 *  - A repeat fulfillment returns the stored receipt (already_fulfilled)
 *    without claiming a second completion.
 *  - After every command the queue reloads so the native view matches the
 *    server state — receipt-driven status survives refresh.
 */
export function HeritagePrivacyRedactionPanel({ platform, user }: { platform: PlatformClient; user: PlatformUser }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const scope = principalScopeKey(user, []);
  const { queue, retry } = useAdminRedactionQueue({ platform, scope });
  const commands = useRedactionCommands(scope);
  const [note, setNote] = useState("");
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [outcome, setOutcome] = useState("");

  const decide = async (row: AdminRedactionQueueRow, decision: "grant" | "refuse") => {
    const decisionNote = note.trim();
    if (decisionNote.length < 10) {
      setOutcome(L("A substantive decision note (at least 10 characters) is required.", "یادداشت تصمیم معتبر (حداقل ۱۰ نویسه) الزامی است."));
      return;
    }
    setBusyRow(row.id);
    setOutcome("");
    const result = await runRedactionDecision(platform, row.id, { decision, decision_note: decisionNote });
    if (result.phase === "done") {
      setNote("");
      setOutcome(result.response.note);
    } else {
      setOutcome(`${L("Refused", "رد شد")} — ${result.code}: ${result.reason}`);
    }
    retry();
    setBusyRow(null);
  };

  const fulfill = async (row: AdminRedactionQueueRow) => {
    setBusyRow(row.id);
    setOutcome("");
    const result = await runRedactionFulfillment(platform, row.id, note.trim().length >= 10 ? note.trim() : null);
    if (result.phase === "done") {
      setNote("");
      setOutcome(result.response.note);
    } else {
      setOutcome(`${L("Refused", "رد شد")} — ${result.code}: ${result.reason}`);
    }
    retry();
    setBusyRow(null);
  };

  const categoryLabel = (row: AdminRedactionQueueRow) =>
    row.data_category === "service_request_notes"
      ? L("Service-request notes", "یادداشت‌های درخواست خدمت")
      : L("Service-request contact & location", "تماس و موقعیت درخواست خدمت");
  const rows = queue.phase === "ready" || queue.phase === "reloading" ? queue.rows : [];
  const counts = queue.phase === "ready" || queue.phase === "reloading" ? queue.counts : null;

  return <section className="panel governance-panel privacy-redaction-panel" data-h-surface-role="panel" data-surface="privacy-redaction-desk">
    <div className="panel-head"><div><h2>{L("Privacy redaction queue", "صف حذف اطلاعات حریم خصوصی")}</h2><p>{L("Subject redaction requests: the operator decision and the audited execution are separate steps. Only the executor's receipt reports completion.", "درخواست‌های حذف داده: تصمیم اپراتور و اجرای ممیزی‌شده دو گام جدا هستند. فقط رسید مجری، انجام را گزارش می‌کند.")}</p></div>{counts != null ? <span className="issue-count">{L(`${counts.received + counts.deferred_active_hold} open · ${counts.executed} executed`, `${counts.received + counts.deferred_active_hold} باز · ${counts.executed} اجراشده`)}</span> : null}</div>
    {commands.decide.state.phase === "submitting" || commands.fulfill.state.phase === "submitting" ? <p role="status" className="form-msg">{L("Working…", "در حال انجام…")}</p> : null}
    {queue.phase === "loading" || queue.phase === "idle" ? <p className="form-msg">{L("Loading the redaction queue…", "در حال بارگذاری صف حذف…")}</p>
      : queue.phase === "forbidden" ? <div className="desk-auth-note"><span>{L("This account cannot read the privacy operator queue.", "این حساب اجازه خواندن صف حریم خصوصی را ندارد.")}</span></div>
      : queue.phase === "unavailable" || queue.phase === "error" ? <div className="admin-load-state" role="status"><strong>{L("The redaction queue could not be loaded.", "صف حذف بارگذاری نشد.")}</strong><span>{queue.reason}</span><button className="ghost" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div>
      : queue.phase === "empty" ? <div className="desk-empty">{L("No redaction requests have been filed.", "هیچ درخواست حذفی ثبت نشده است.")}</div>
      : <div className="privacy-redaction-list" data-surface="privacy-redaction-rows">
        {rows.map(row => {
          const indicator = redactionFulfillmentLabel(row);
          const decidable = row.status === "received" || row.status === "deferred_active_hold";
          const fulfillable = row.status === "granted" && row.execution_status !== "completed";
          return <article key={row.id} data-request-id={row.id} className={`privacy-redaction-row tone-${indicator.tone}`}>
            <header>
              <strong dir="auto">#{row.id} · {row.subject_name ?? row.subject_user_id}</strong>
              <small>{categoryLabel(row)}{row.service_request_id != null ? ` · ${L("service request", "درخواست خدمت")} #${row.service_request_id}` : ` · ${L("untargeted", "بدون هدف مشخص")}`}</small>
            </header>
            <p dir="auto" className="privacy-request-note">“{row.request_note}”</p>
            <div className="privacy-redaction-states">
              <span className={`privacy-status status-${row.status}`}>{row.status.replaceAll("_", " ")}</span>
              <span className={`privacy-fulfillment fulfillment-${indicator.tone}`} data-surface="privacy-fulfillment-indicator">{locale === "fa" ? indicator.fa : indicator.en}</span>
              {row.request_under_active_hold ? <span className="privacy-hold-flag">{L("active hold", "توقیف فعال")}</span> : null}
              {row.decision_note ? <small dir="auto" className="privacy-decision-note">{L("Decision", "تصمیم")}: {row.decision_note}</small> : null}
              {row.execution_status === "completed" ? <details className="privacy-receipt" data-surface="privacy-execution-receipt"><summary>{L("Execution receipt", "رسید اجرا")}</summary><pre dir="ltr">{row.execution_receipt_json ?? "—"}</pre><small>{row.executed_at ?? ""}</small></details> : null}
            </div>
            {decidable || fulfillable ? <div className="privacy-redaction-actions">
              <input dir="auto" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder={L("Operator note (required for decisions, optional for execution)", "یادداشت اپراتور (برای تصمیم الزامی، برای اجرا اختیاری)")} aria-label={L("Operator note", "یادداشت اپراتور")} disabled={busyRow != null} />
              {decidable && <span>
                <button className="ghost" disabled={busyRow != null} onClick={() => void decide(row, "grant")}>{L("Grant decision", "تصمیم به تأیید")}</button>
                <button className="ghost reject" disabled={busyRow != null} onClick={() => void decide(row, "refuse")}>{L("Refuse", "رد")}</button>
              </span>}
              {fulfillable && <button className="primary" disabled={busyRow != null} onClick={() => void fulfill(row)}>{L("Execute redaction", "اجرای حذف")}</button>}
            </div> : null}
          </article>;
        })}
      </div>}
    {outcome ? <div className="admin-action-message" role="status" data-surface="privacy-command-outcome" dir="auto">{outcome}</div> : null}
  </section>;
}
