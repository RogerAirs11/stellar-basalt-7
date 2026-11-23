import { classifyResourceError, isAbortError, type ResourceState } from "./resourceState";

/**
 * R88 agent plan P20: the canonical domain loader core. Pure, headless,
 * renderer-agnostic — React binds to it through useDomainResource, and the
 * race/abort guarantees are testable without any DOM.
 *
 * Three guarantees, pinned by tests:
 * 1. RACE — a slower response for an OLDER key can never overwrite the state
 *    of a newer load. Navigating rapidly from horse A to horse B can never
 *    show A's private data under B's identity (the load key includes the
 *    identity; only the newest generation may apply).
 * 2. ABORT — a cancelled request never applies: AbortError resolutions are
 *    swallowed for superseded loads, and dispose() drops every late
 *    resolution (the unmount case).
 * 3. NO CACHE — the loader fetches through on every load. The platform's
 *    no-store response policy IS the privacy policy; nothing here hides it
 *    behind a client cache.
 */

export interface DomainLoadRequest<T> {
  /** Stable domain name, e.g. "directory-persons", "horse-record", "workspace". */
  domain: string;
  /** The identity being loaded (person id, horse id, filter+cursor string, …). */
  identity: string | number;
  /** The fetcher. MUST honor the signal; MUST throw AbortError when aborted. */
  load: (signal: AbortSignal) => Promise<T>;
  /** Empty is a DOMAIN decision, never a guess: supply the predicate. */
  isEmpty?: (data: T) => boolean;
}

export interface DomainLoad {
  key: string;
  generation: number;
}

export function domainLoadKey(domain: string, identity: string | number): string {
  return `${domain}:${identity}`;
}

type Listener = () => void;

export class DomainResourceController<T> {
  private state: ResourceState<T> = { phase: "idle" };
  private stateKey: string | null = null;
  private generation = 0;
  private disposed = false;
  private controller: AbortController | null = null;
  private readonly listeners = new Set<Listener>();
  private lastRequest: DomainLoadRequest<T> | null = null;

  /** Current state together with the key it belongs to. */
  getSnapshot(): { key: string | null; state: ResourceState<T> } {
    return { key: this.stateKey, state: this.state };
  }

  getState(): ResourceState<T> {
    return this.state;
  }

  /** The key of the load currently owning the state (null before the first load). */
  getCurrentKey(): string | null {
    return this.stateKey;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Start a load. Calling this again supersedes any in-flight load: the old
   * fetcher's abort signal fires and its late resolution is dropped by the
   * generation guard.
   */
  load(request: DomainLoadRequest<T>): DomainLoad {
    if (this.disposed) throw new Error("DomainResourceController is disposed");
    const key = domainLoadKey(request.domain, request.identity);
    this.lastRequest = request;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    // Same identity reloading keeps the prior data visible as "reloading"
    // (honest staleness); a new identity starts from a clean "loading".
    this.state = this.stateKey === key && (this.state.phase === "ready" || this.state.phase === "reloading")
      ? { phase: "reloading", data: (this.state as { data: T }).data }
      : { phase: "loading" };
    this.stateKey = key;
    this.notify();
    try {
      void Promise.resolve(request.load(controller.signal)).then(
        (data) => {
          try { this.apply(generation, key, request, data); }
          catch (error) { this.fail(generation, key, error); }
        },
        (error) => { this.fail(generation, key, error); },
      );
    } catch (error) { this.fail(generation, key, error); }
    return { key, generation };
  }

  /** Re-run the last request (manual retry after an error). */
  retry(): void {
    if (this.lastRequest) this.load(this.lastRequest);
  }

  /**
   * Permanently stop: abort the in-flight request and drop every future
   * resolution. The unmount path — a cancelled request can never update
   * unmounted state because nothing applies after dispose.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.controller = null;
    this.listeners.clear();
  }

  private apply(generation: number, key: string, request: DomainLoadRequest<T>, data: T): void {
    if (this.disposed || generation !== this.generation) return;
    this.state = request.isEmpty?.(data) ? { phase: "empty" } : { phase: "ready", data };
    this.stateKey = key;
    this.notify();
  }

  private fail(generation: number, key: string, error: unknown): void {
    if (this.disposed || generation !== this.generation) return;
    // A superseded load aborting is the NORMAL race outcome — not an error.
    if (isAbortError(error)) return;
    this.state = classifyResourceError(error);
    this.stateKey = key;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
