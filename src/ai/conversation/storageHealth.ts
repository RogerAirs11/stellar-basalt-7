/**
 * Storage exhaustion may degrade transcript persistence to a clearly labelled
 * isolate-local overlay. Public registry reads remain independent of AI.
 * External provider calls still require durable usage/cost reservations and
 * must pause when accounting is unavailable. Never promise unlimited answers
 * or imply that an ephemeral transcript has been saved durably.
 */

const EPHEMERAL_PREFIX = "ephemeral:";

/** True when the D1 error is the daily ROW WRITE limit (never the read limit). */
export function isD1WriteQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /daily row write limit/i.test(message);
}

/** Conversations created while writes are unavailable use this id namespace. */
export function isEphemeralConversationId(id: string): boolean {
  return id.startsWith(EPHEMERAL_PREFIX);
}

export function newEphemeralConversationId(): string {
  return `${EPHEMERAL_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Isolate-scoped degradation flag. Set for a short window whenever a write is
 * refused by the quota so the orchestrator can tell the browser what happened
 * without probing D1 first. Writes are always re-attempted on later turns, so
 * this is purely informational and self-healing.
 */
const DEGRADED_WINDOW_MS = 10 * 60_000;
let degradedUntil = 0;

export function markWritesDegraded(): void {
  degradedUntil = Date.now() + DEGRADED_WINDOW_MS;
}

export function aiWritesDegraded(): boolean {
  return Date.now() < degradedUntil;
}
