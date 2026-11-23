import { PlatformClientError } from "./errors";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** HTTP Retry-After supports a nonnegative integer or an HTTP-date. No retry is scheduled here. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return undefined;
  const instant = Date.parse(text);
  return Number.isFinite(instant) && Number.isFinite(now) ? Math.max(0, Math.ceil((instant - now) / 1000)) : undefined;
}

/** Preserve a typed server refusal and its retry hint across every frontend. */
export function platformResponseError(response: Response, data: unknown, fallbackCode = "request_failed"): PlatformClientError {
  const envelope = record(record(data)?.error);
  const code = typeof envelope?.code === "string" && envelope.code ? envelope.code : fallbackCode;
  const message = typeof envelope?.message === "string" && envelope.message
    ? envelope.message : `Request failed (${response.status})`;
  let details = envelope?.details;
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  if (retryAfter !== undefined) {
    details = { ...(record(details) ?? (details === undefined ? {} : { response_details: details })), retry_after_seconds: retryAfter };
  }
  return new PlatformClientError(response.status, code, message, details);
}

export function throwIfRequestAborted(signal: AbortSignal | null | undefined, cause?: unknown): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Request aborted", "AbortError");
  if (cause instanceof Error && cause.name === "AbortError") throw cause;
}
