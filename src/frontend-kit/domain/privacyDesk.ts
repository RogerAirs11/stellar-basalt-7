import { useCallback } from "react";
import { useDomainResource } from "./useDomainResource";
import { usePlatformCommand } from "./commandStatus";
import type {
  AdminRedactionQueueResponse,
  AdminRedactionQueueRow,
  PlatformClient,
  RedactionDecisionInput,
} from "../../contracts/platform";

/**
 * R117-18 (Master AI R117 handoff D43) — the ONE headless privacy-redaction
 * OPERATOR controller shared by every frontend. Renderer-agnostic; nothing
 * here renders and nothing here ever claims a decision executes redaction.
 *
 * Pinned behaviors (from the reviewed ticket — the R114 executor stays the
 * server authority and is NOT recreated here):
 *  - The QUEUE read is admin-role scoped; the server surfaces decision state
 *    and the SEPARATE execution state per row, so a granted request never
 *    renders as completed.
 *  - DECIDE is the operator decision (grant/refuse with a substantive note).
 *    A grant under an active hold refuses (grant_blocked_by_hold); an
 *    untargeted request refuses (redaction_scope_unresolved); a decided row
 *    refuses (not_decidable). These honest refusals are surfaced, never
 *    masked as success.
 *  - FULFILL is the separate audited executor call. Only its operation
 *    receipt reports completion; a repeat (or a lost race) returns the stored
 *    receipt (already_fulfilled) and never claims a second completion.
 *    not_granted / redaction_scope_unresolved / execution_blocked_by_hold /
 *    execution_scope_unresolved / execution_conflict are honest refusals.
 *  - REFRESH equivalence: the queue reload after any command must reflect
 *    the server state (receipt-driven completed status) — the controller
 *    exposes one reload entry point every skin uses after each command.
 */

export interface PrivacyDeskPlatform {
  admin: Pick<PlatformClient["admin"], "privacy">;
}

export type RedactionQueueSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; rows: AdminRedactionQueueRow[]; counts: AdminRedactionQueueResponse["counts"]; note: string }
  | { phase: "empty"; counts: AdminRedactionQueueResponse["counts"] }
  | { phase: "forbidden" | "unavailable" | "error"; reason: string };

/** The admin operator queue. Principal-scoped identity so an A→B admin
 * switch re-keys and reloads (R107 NEXT-05 discipline). */
export function useAdminRedactionQueue(options: {
  platform: PrivacyDeskPlatform | null;
  scope?: string;
}): { queue: RedactionQueueSnapshot; retry: () => void } {
  const { platform, scope } = options;
  const identity = `${scope ?? "principal:unscoped"}|privacy-redaction-queue`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve(null);
    return platform.admin.privacy.redactionQueue();
  }, [platform]);
  const state = useDomainResource<AdminRedactionQueueResponse | null>(
    "privacy-redaction-queue", identity, load,
    { isEmpty: (data) => data === null || (data.requests?.length ?? 0) === 0, enabled: platform !== null });
  if (state.state.phase === "ready" || state.state.phase === "reloading") {
    const data = state.state.data as AdminRedactionQueueResponse;
    return {
      queue: { phase: state.state.phase, rows: data.requests ?? [], counts: data.counts, note: data.note ?? "" },
      retry: state.retry,
    };
  }
  if (state.state.phase === "empty")
    return { queue: { phase: "empty", counts: { received: 0, deferred_active_hold: 0, granted: 0, refused: 0, executed: 0 } }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { queue: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { queue: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** Command slots (decide + fulfill are separate commands by design). */
export function useRedactionCommands(scope: string | undefined) {
  const prefix = scope ?? "principal:unscoped";
  const decide = usePlatformCommand(`${prefix}|redaction-decide`);
  const fulfill = usePlatformCommand(`${prefix}|redaction-fulfill`);
  return { decide, fulfill };
}

export type RedactionCommandOutcome<T> =
  | { phase: "done"; response: T }
  | { phase: "refused"; code: string; reason: string };

/** Classify a refused command: surface the server's honest refusal code
 * (grant_blocked_by_hold / redaction_scope_unresolved / not_decidable /
 * not_granted / execution_blocked_by_hold / execution_scope_unresolved /
 * execution_conflict) instead of a generic error string. */
function classify(error: unknown): { code: string; reason: string } {
  const err = error as { code?: string; message?: string; payload?: { code?: string; error?: string; message?: string } } | null;
  const code = err?.code ?? err?.payload?.code ?? err?.payload?.error ?? "command_failed";
  const reason = err?.payload?.message ?? err?.message ?? "The command was refused.";
  return { code, reason };
}

/** The operator DECISION (grant/refuse). A grant is a decision, never an
 * execution — the response's fulfillment_status stays the honest indicator. */
export async function runRedactionDecision(
  platform: PrivacyDeskPlatform,
  id: number,
  input: RedactionDecisionInput,
): Promise<RedactionCommandOutcome<Awaited<ReturnType<PlatformClient["admin"]["privacy"]["decideRedaction"]>>>> {
  try {
    const response = await platform.admin.privacy.decideRedaction(id, input);
    return { phase: "done", response };
  } catch (error) {
    const { code, reason } = classify(error);
    return { phase: "refused", code, reason };
  }
}

/** The separate audited FULFILLMENT executor call. Only its receipt reports
 * completion; already_fulfilled returns the stored receipt. */
export async function runRedactionFulfillment(
  platform: PrivacyDeskPlatform,
  id: number,
  executionNote?: string | null,
): Promise<RedactionCommandOutcome<Awaited<ReturnType<PlatformClient["admin"]["privacy"]["fulfillRedaction"]>>>> {
  try {
    const response = await platform.admin.privacy.fulfillRedaction(id, executionNote ?? undefined);
    return { phase: "done", response };
  } catch (error) {
    const { code, reason } = classify(error);
    return { phase: "refused", code, reason };
  }
}

/** Honest copy for the per-row fulfillment indicator (EN/FA). A granted row
 * that is not executed says so; a hold-blocked grant says so; a completed row
 * points at the receipt, never at the decision. */
export function redactionFulfillmentLabel(row: AdminRedactionQueueRow): { en: string; fa: string; tone: "completed" | "blocked" | "pending" | "muted" } {
  if (row.execution_status === "completed") {
    return { en: "Executed — receipt recorded", fa: "اجرا شد — رسید ثبت شد", tone: "completed" };
  }
  if (row.status === "granted" && row.request_under_active_hold) {
    return { en: "Granted — execution blocked by active hold", fa: "مصوب — اجرا به‌دلیل توقیف فعال مسدود است", tone: "blocked" };
  }
  if (row.status === "granted") {
    return { en: "Granted — not yet executed", fa: "مصوب — هنوز اجرا نشده", tone: "pending" };
  }
  if (row.status === "refused") {
    return { en: "Refused — no execution applicable", fa: "رد شد — اجرا موضوعیت ندارد", tone: "muted" };
  }
  return { en: "Awaiting decision", fa: "در انتظار تصمیم", tone: "pending" };
}
