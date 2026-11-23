/** A server Retry-After is a minimum, not a value to clamp downwards. */
export function boundedProviderRetryDelay(providerDelayMs: unknown, maxDelayMs: number, fallbackMs: number): number | null {
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) return null;
  const explicit = typeof providerDelayMs === "number" && Number.isFinite(providerDelayMs) && providerDelayMs >= 0;
  const desired = Math.ceil(explicit ? providerDelayMs : fallbackMs);
  return Number.isFinite(desired) && desired >= 0 && desired <= maxDelayMs ? desired : null;
}

export async function abortableRetryDelay(signal?: AbortSignal, requestedMs = 250 + Math.floor(Math.random() * 251)): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const delay = Number.isFinite(requestedMs) ? Math.max(0, Math.ceil(requestedMs)) : 0;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", aborted);
    const aborted = () => { clearTimeout(timer); cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
    signal?.addEventListener("abort", aborted, { once: true });
    // Protect against a signal that changed between the initial check/listener.
    if (signal?.aborted) aborted();
  });
}
