import type { AiProviderId } from "./types";

export type AiErrorCategory =
  | "configuration"
  | "quota"
  | "rate_limit"
  | "context_limit"
  | "invalid_request"
  | "protocol"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "cost_limit"
  | "tool_error"
  | "storage"
  | "unknown";

export class AiRuntimeError extends Error {
  constructor(
    public readonly category: AiErrorCategory,
    public readonly code: string,
    message: string,
    public readonly provider?: AiProviderId,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AiRuntimeError";
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}
