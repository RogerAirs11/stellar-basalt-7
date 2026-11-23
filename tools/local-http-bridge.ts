import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/** Keep request bodies streaming so the production size guard can reject early. */
export async function nodeRequest(req: IncomingMessage, signal?: AbortSignal): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const url = `http://${req.headers.host || "127.0.0.1:3000"}${req.url || "/"}`;
  const method = req.method || "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers, signal });
  const body = Readable.toWeb(req) as unknown as BodyInit;
  // Node's Fetch API requires duplex when the body is a ReadableStream.
  return new Request(url, { method, headers, body, signal, duplex: "half" } as RequestInit & { duplex: "half" });
}

function drainOrClose(res: ServerResponse): Promise<void> {
  if (res.destroyed || res.writableFinished) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { res.off("drain", done); res.off("close", done); res.off("error", fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = (cause: Error) => { cleanup(); reject(cause); };
    res.once("drain", done); res.once("close", done); res.once("error", fail);
  });
}

/** Stream SSE progressively, respect Node backpressure, and cancel on disconnect. */
export async function sendNodeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (cookies?.length) res.setHeader("set-cookie", cookies);
  if (!response.body) { res.end(); return; }
  const reader = response.body.getReader();
  let disconnected = res.destroyed;
  let cancellation: Promise<void> | undefined;
  const cancel = (reason?: unknown) => cancellation ??= reader.cancel(reason).catch(() => undefined);
  const onClose = () => {
    if (!res.writableFinished) { disconnected = true; void cancel("local_client_disconnected"); }
  };
  res.once("close", onClose);
  try {
    if (disconnected) { await cancel(); return; }
    res.flushHeaders();
    while (!disconnected && !res.destroyed) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && !res.write(Buffer.from(value))) await drainOrClose(res);
    }
    if (!disconnected && !res.destroyed) res.end();
    else await cancel();
  } catch (cause) {
    await cancel(cause);
    if (!disconnected) throw cause;
  } finally {
    res.off("close", onClose);
    if (cancellation) await cancellation;
    reader.releaseLock();
  }
}
