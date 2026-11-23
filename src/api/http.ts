export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  // R96-N07: every API JSON response is user/resource-scoped — shared caches
  // must never hold it, and referrers must never leak the URL origin-side.
  if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store");
  if (!headers.has("referrer-policy")) headers.set("referrer-policy", "no-referrer");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, code: string, message: string, details?: unknown): Response {
  // Central D09 policy: every 429 response carries Retry-After: 60. Attached here so no
  // route or limiter has to duplicate the header logic.
  const headers = status === 429 ? new Headers({ "retry-after": "60" }) : undefined;
  return json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status, ...(headers ? { headers } : {}) });
}

/** Read at most maxBytes, including when Content-Length is absent or dishonest. */
export async function readTextBody(request: Request, maxBytes = 256 * 1024): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "body_too_large", `Request body exceeds ${maxBytes} bytes`, { maxBytes });
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Do not await cancellation of a tee branch: the other branch may not
        // be consumed until this probe returns (e.g. the account limiter).
        void reader.cancel("body_too_large").catch(() => undefined);
        throw new HttpError(413, "body_too_large", `Request body exceeds ${maxBytes} bytes`, { maxBytes });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new HttpError(400, "invalid_body", "Request body must be valid UTF-8"); }
}

export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Expected application/json request body");
  }
  try { return JSON.parse(await readTextBody(request, maxBytes)) as T; }
  catch (cause) {
    if (cause instanceof HttpError && cause.code !== "invalid_body") throw cause;
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

export function requestId(request: Request): string {
  const incoming = request.headers.get("cf-ray") || request.headers.get("x-request-id");
  return incoming?.slice(0, 128) || crypto.randomUUID();
}
