/** Producer cleanup must finish before the Worker releases its request-scoped DB.
 * Cancelling a ReadableStream otherwise resolves immediately while an eager
 * async producer may still be writing usage/lease records in its finally block. */
export function createAiEventStream<T extends { type: string }>(
  produce: (signal: AbortSignal) => AsyncIterable<T>,
  normalizeError: (error: unknown) => { code: string; message: string; details?: unknown },
  requestSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(requestSignal?.reason);
  if (requestSignal?.aborted) forwardAbort();
  else requestSignal?.addEventListener("abort", forwardAbort, { once: true });
  let cancelled = false;
  let producerTask: Promise<void> = Promise.resolve();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: { type: string }) => {
        if (!cancelled) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      producerTask = (async () => {
        try {
          if (abort.signal.aborted) return;
          for await (const event of produce(abort.signal)) {
            if (cancelled || abort.signal.aborted) break;
            emit(event);
          }
        } catch (error) {
          if (!cancelled && !abort.signal.aborted) emit({ type: "error", ...normalizeError(error) });
        } finally {
          requestSignal?.removeEventListener("abort", forwardAbort);
          if (!cancelled) controller.close();
        }
      })();
    },
    async cancel(reason) {
      cancelled = true;
      abort.abort(reason);
      // Await the producer's iterator/finally, including lease release. This is
      // not an automatic turn retry and never starts a second provider call.
      await producerTask;
    },
  });
}
