import { isPlatformClientError } from "../errors";

/**
 * R88 agent plan P20: the canonical async resource state model shared by every
 * frontend. Shared SEMANTICS only — presentation stays in each skin. A failed
 * request is never shown as an empty record, and "unavailable" is kept
 * distinct from "forbidden" so the UI never leaks which one it was (the
 * platform's anti-enumeration posture: private and absent both answer 404).
 */
export type ResourcePhase = "idle" | "loading" | "reloading" | "ready" | "empty" | "forbidden" | "unavailable" | "error";

export type ResourceState<T> =
  | { phase: "idle" }
  | { phase: "loading" }
  /** Prior data retained while a newer load for the same identity runs. Renderers MUST show it as possibly stale. */
  | { phase: "reloading"; data: T }
  | { phase: "ready"; data: T }
  | { phase: "empty" }
  | { phase: "forbidden"; reason: string }
  | { phase: "unavailable"; reason: string }
  | { phase: "error"; reason: string; retryAfterSeconds?: number };

export function idleResource<T>(): ResourceState<T> {
  return { phase: "idle" };
}

/**
 * Map a platform error onto the canonical phases. 404 is "unavailable" — NOT
 * an error and NOT empty — because the platform deliberately answers 404 for
 * both absent and private resources. 501 (feature off / demo adapter) and 503
 * (fail-closed deployment) are likewise "unavailable" with the server's own
 * honest reason. 403 is "forbidden". 429 is "error" with a retry hint.
 */
export function classifyResourceError(error: unknown): ResourceState<never> {
  if (isPlatformClientError(error)) {
    if (error.status === 403) return { phase: "forbidden", reason: error.message };
    if (error.status === 404 || error.status === 501 || error.status === 503) return { phase: "unavailable", reason: error.message };
    if (error.status === 429) return { phase: "error", reason: error.message, retryAfterSeconds: retryAfterSecondsOf(error.details) };
    return { phase: "error", reason: error.message };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return { phase: "error", reason };
}

/** The platform's 429 envelopes may carry a retry hint in details; parse it defensively. */
export function retryAfterSecondsOf(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>).retry_after_seconds ?? (details as Record<string, unknown>).retryAfterSeconds;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.ceil(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) return Math.ceil(Number(value));
  return undefined;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** True when the state carries data a renderer may show (ready, or reloading with the honest stale marker). */
export function hasRenderableData<T>(state: ResourceState<T>): boolean {
  return state.phase === "ready" || state.phase === "reloading";
}
