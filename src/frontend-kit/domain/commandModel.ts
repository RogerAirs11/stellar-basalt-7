import { isPlatformClientError } from "../errors";
import { retryAfterSecondsOf } from "./resourceState";

export type CommandState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "accepted"; message: string; idempotentReplay?: boolean }
  /** The platform refused the command (4xx) — validation, conflict, auth or rate limit. */
  | { phase: "rejected"; code: string; message: string; status: number; currentVersion?: number; retryAfterSeconds?: number }
  /** The command could not complete (5xx / network) — state is unknown until re-read. */
  | { phase: "failed"; message: string; status?: number; code?: string };

export function idleCommand(): CommandState {
  return { phase: "idle" };
}

/**
 * Normalize a thrown command error. A 4xx refusal or an unimplemented 501 is "rejected". Other server errors,
 * including 502/503, are conservatively "failed": a proxy or upstream may
 * fail AFTER committing a write. HTTP status alone cannot prove no effect; the caller must re-read before assuming anything.
 * 409 keeps the optimistic-concurrency story intact: when the envelope
 * carries the current version (P03 discipline — details.current_version), it
 * is surfaced so the UI can offer an honest "reload and retry".
 */
export function classifyCommandError(error: unknown): CommandState {
  if (isPlatformClientError(error)) {
    const deliberateRefusal = (error.status >= 400 && error.status < 500) || error.status === 501;
    if (deliberateRefusal) {
      return {
        phase: "rejected",
        code: error.code,
        message: error.message,
        status: error.status,
        currentVersion: currentVersionOf(error.details),
        retryAfterSeconds: error.status === 429 ? retryAfterSecondsOf(error.details) : undefined,
      };
    }
    return { phase: "failed", message: error.message, status: error.status, code: error.code };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { phase: "failed", message };
}

function currentVersionOf(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  const value = record.current_version ?? record.row_version;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return undefined;
}

/** Does the response shape report an idempotent replay? (market commands, service requests, orders, tasks) */
export function idempotentReplayOf(result: unknown): boolean {
  if (result != null && typeof result === "object") {
    const value = (result as Record<string, unknown>).idempotent_replay;
    return value === true;
  }
  return false;
}

/** Synchronous guard: two events in one render cannot start two commands.
 * This is a UI guard, NOT server idempotency or a transactional guarantee. */
export class CommandFlight {
  private active = false;
  get busy(): boolean { return this.active; }
  async execute(run: () => Promise<unknown>, publish: (state: CommandState) => void,
    successMessage = "Command recorded."): Promise<boolean> {
    if (this.active) return false;
    this.active = true;
    publish({ phase: "submitting" });
    try {
      const result = await run();
      publish({ phase: "accepted", message: successMessage, idempotentReplay: idempotentReplayOf(result) });
      return true;
    } catch (error) {
      publish(classifyCommandError(error));
      return false;
    } finally { this.active = false; }
  }
}
