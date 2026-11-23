import { useState } from "react";
import {
  principalScopeKey,
  redactionFulfillmentLabel,
  runRedactionDecision,
  runRedactionFulfillment,
  useAdminRedactionQueue,
  type AdminRedactionQueueRow,
} from "../../../frontend-kit";
import type { ClassicRuntime } from "./adapter";
import { Badge, Section, StatePanel } from "./components";
import { t } from "./i18n";

/**
 * R117-18 (Master AI R117 handoff D43) — FEI Classic's native privacy
 * redaction operator surface over the retained R114 executor. The decision
 * (grant/refuse) and the audited execution are SEPARATE actions; the per-row
 * indicator is driven by the execution receipt, never by the grant. Honest
 * refusals (hold-blocked grant, unresolved scope, already-completed repeat)
 * are surfaced with their server codes; after every command the queue
 * reloads so the view matches the server state after refresh.
 */
export function FeiPrivacyRedaction({ view }: { view: ClassicRuntime }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const scope = principalScopeKey(view.user, view.permissions);
  const { queue, retry } = useAdminRedactionQueue({ platform: view.platform, scope });
  const [note, setNote] = useState("");
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [outcome, setOutcome] = useState("");

  const decide = async (row: AdminRedactionQueueRow, decision: "grant" | "refuse") => {
    if (note.trim().length < 10) {
      setOutcome(L("A substantive decision note (at least 10 characters) is required.", "یادداشت تصمیم معتبر (حداقل ۱۰ نویسه) الزامی است."));
      return;
    }
    setBusyRow(row.id);
    setOutcome("");
    const result = await runRedactionDecision(view.platform, row.id, { decision, decision_note: note.trim() });
    setOutcome(result.phase === "done" ? result.response.note : `${L("Refused", "رد شد")} — ${result.code}: ${result.reason}`);
    if (result.phase === "done") setNote("");
    retry();
    setBusyRow(null);
  };

  const fulfill = async (row: AdminRedactionQueueRow) => {
    setBusyRow(row.id);
    setOutcome("");
    const result = await runRedactionFulfillment(view.platform, row.id, note.trim().length >= 10 ? note.trim() : null);
    setOutcome(result.phase === "done" ? result.response.note : `${L("Refused", "رد شد")} — ${result.code}: ${result.reason}`);
    if (result.phase === "done") setNote("");
    retry();
    setBusyRow(null);
  };

  const categoryLabel = (row: AdminRedactionQueueRow) =>
    row.data_category === "service_request_notes"
      ? L("Service-request notes", "یادداشت‌های درخواست خدمت")
      : L("Service-request contact & location", "تماس و موقعیت درخواست خدمت");
  const rows = queue.phase === "ready" || queue.phase === "reloading" ? queue.rows : [];
  const counts = queue.phase === "ready" || queue.phase === "reloading" ? queue.counts : null;

  return <Section title={L("Privacy redaction queue", "صف حذف اطلاعات حریم خصوصی")} tone="purple">
    <p className="fc-muted">{L("Subject redaction requests: the operator decision and the audited execution are separate steps. Only the executor's receipt reports completion.", "درخواست‌های حذف داده: تصمیم اپراتور و اجرای ممیزی‌شده دو گام جدا هستند. فقط رسید مجری، انجام را گزارش می‌کند.")}</p>
    {queue.phase === "loading" || queue.phase === "idle" ? <StatePanel status="loading" locale={view.locale}/>
      : queue.phase === "forbidden" ? <StatePanel status="ready" empty={L("This account cannot read the privacy operator queue.", "این حساب اجازه خواندن صف حریم خصوصی را ندارد.")} locale={view.locale}/>
      : queue.phase === "unavailable" || queue.phase === "error" ? <StatePanel status="error" error={queue.reason} locale={view.locale}/>
      : queue.phase === "empty" ? <StatePanel status="ready" empty={L("No redaction requests have been filed.", "هیچ درخواست حذفی ثبت نشده است.")} locale={view.locale}/>
      : <div className="fc-table-wrap" data-surface="privacy-redaction-rows"><table className="fc-table fc-table-compact">
        <thead><tr><th>#</th><th>{L("Subject", "متقاضی")}</th><th>{L("Category", "دسته")}</th><th>{L("Status", "وضعیت")}</th><th>{L("Fulfillment", "اجرا")}</th><th>{L("Actions", "اقدام‌ها")}</th></tr></thead>
        <tbody>{rows.map(row => {
          const indicator = redactionFulfillmentLabel(row);
          const decidable = row.status === "received" || row.status === "deferred_active_hold";
          const fulfillable = row.status === "granted" && row.execution_status !== "completed";
          return <tr key={row.id} data-request-id={row.id}>
            <td>{row.id}</td>
            <td dir="auto">{row.subject_name ?? row.subject_user_id}{row.service_request_id != null ? <small><br/>SR #{row.service_request_id}</small> : <small><br/>{L("untargeted", "بدون هدف مشخص")}</small>}</td>
            <td>{categoryLabel(row)}{row.request_under_active_hold ? <Badge tone="warning">{L("active hold", "توقیف فعال")}</Badge> : null}</td>
            <td><span className={`fc-status status-${row.status}`}>{row.status.replaceAll("_", " ")}</span>{row.decision_note ? <small dir="auto"><br/>{row.decision_note.slice(0, 80)}</small> : null}</td>
            <td data-surface="privacy-fulfillment-indicator"><span className={`privacy-fulfillment fulfillment-${indicator.tone}`}>{view.locale === "fa" ? indicator.fa : indicator.en}</span>
              {row.execution_status === "completed" ? <details data-surface="privacy-execution-receipt"><summary>{L("Receipt", "رسید")}</summary><pre dir="ltr">{row.execution_receipt_json ?? "—"}</pre></details> : null}</td>
            <td>{(decidable || fulfillable) ? <span className="fc-inline-actions">
              {decidable && <><button type="button" className="fc-btn fc-btn-gray" disabled={busyRow != null} onClick={() => void decide(row, "grant")}>{L("Grant decision", "تصمیم به تأیید")}</button>
              <button type="button" className="fc-btn fc-btn-gray" disabled={busyRow != null} onClick={() => void decide(row, "refuse")}>{L("Refuse", "رد")}</button></>}
              {fulfillable && <button type="button" className="fc-btn fc-btn-orange" disabled={busyRow != null} onClick={() => void fulfill(row)}>{L("Execute redaction", "اجرای حذف")}</button>}
            </span> : <span className="fc-muted">—</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    {(counts != null) && rows.some(row => row.status === "received" || row.status === "granted") ? <label className="fc-note-input"><span>{L("Operator note (required for decisions, optional for execution)", "یادداشت اپراتور (برای تصمیم الزامی، برای اجرا اختیاری)")}</span><input dir="auto" aria-label={L("Operator note", "یادداشت اپراتور")} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} disabled={busyRow != null}/></label> : null}
    {outcome ? <div className="fc-alert" role="status" dir="auto" data-surface="privacy-command-outcome">{outcome}</div> : null}
  </Section>;
}
