import { describe, expect, it } from "vitest";
import { DomainResourceController, domainLoadKey } from "../../src/frontend-kit/domain/domainLoader";
import { PlatformClientError } from "../../src/frontend-kit/errors";

/**
 * R88 agent plan P20 acceptance evidence — the loader core guarantees:
 * 1. Navigating rapidly cannot show the prior horse's private data.
 * 2. Cancelled requests do not update unmounted state.
 * 3. Same-key reloads show honest staleness (reloading), never silent swaps.
 */

interface FakeRecord { horseId: number; secret: string }

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A fetcher that returns a controllable deferred per call and honors abort. */
function scriptedFetcher() {
  const calls: Array<{ signal: AbortSignal; deferred: Deferred<FakeRecord> }> = [];
  const load = (signal: AbortSignal): Promise<FakeRecord> => {
    const d = makeDeferred<FakeRecord>();
    calls.push({ signal, deferred: d });
    return d.promise;
  };
  return { calls, load };
}

function notified(controller: DomainResourceController<FakeRecord>): string[] {
  const events: string[] = [];
  controller.subscribe(() => events.push(controller.getState().phase));
  return events;
}

describe("P20 domain loader — race guard (rapid navigation)", () => {
  it("a slower OLDER identity can never overwrite a newer identity's state", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    const { calls, load } = scriptedFetcher();
    controller.load({ domain: "horse-record", identity: 101, load });
    controller.load({ domain: "horse-record", identity: 202, load });
    expect(controller.getState().phase).toBe("loading");
    expect(controller.getCurrentKey()).toBe(domainLoadKey("horse-record", 202));
    // The newer request resolves FIRST…
    calls[1]!.deferred.resolve({ horseId: 202, secret: "belongs-to-202" });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().phase).toBe("ready");
    const resolved = controller.getState();
    if (resolved.phase === "ready") expect(resolved.data.horseId).toBe(202);
    // …and then the stale 101 response arrives late. It MUST be dropped.
    calls[0]!.deferred.resolve({ horseId: 101, secret: "private-of-101" });
    await Promise.resolve();
    await Promise.resolve();
    const state = controller.getState();
    expect(state.phase).toBe("ready");
    if (state.phase === "ready") {
      expect(state.data.horseId).toBe(202);
      expect(state.data.secret).toBe("belongs-to-202");
    }
  });

  it("a rejected older identity is likewise dropped", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    const { calls, load } = scriptedFetcher();
    controller.load({ domain: "horse-record", identity: 101, load });
    controller.load({ domain: "horse-record", identity: 202, load });
    calls[1]!.deferred.resolve({ horseId: 202, secret: "new" });
    await Promise.resolve(); await Promise.resolve();
    calls[0]!.deferred.reject(new PlatformClientError(404, "not_found", "unavailable"));
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getState().phase).toBe("ready");
  });

  it("superseding a load aborts the in-flight fetcher's signal", () => {
    const { calls, load } = scriptedFetcher();
    const controller = new DomainResourceController<FakeRecord>();
    controller.load({ domain: "horse-record", identity: 1, load });
    controller.load({ domain: "horse-record", identity: 2, load });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
  });
});

describe("P20 domain loader — honest states", () => {
  it("a same-key reload retains prior data as reloading (stale-visible), never silent", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    const first = makeDeferred<FakeRecord>();
    controller.load({ domain: "horse-record", identity: 7, load: () => first.promise });
    first.resolve({ horseId: 7, secret: "v1" });
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getState().phase).toBe("ready");
    const second = makeDeferred<FakeRecord>();
    controller.load({ domain: "horse-record", identity: 7, load: () => second.promise });
    const state = controller.getState();
    expect(state.phase).toBe("reloading");
    if (state.phase === "reloading") expect(state.data.secret).toBe("v1");
    second.resolve({ horseId: 7, secret: "v2" });
    await Promise.resolve(); await Promise.resolve();
    const after = controller.getState();
    expect(after.phase).toBe("ready");
    if (after.phase === "ready") expect(after.data.secret).toBe("v2");
  });

  it("empty is a domain decision — the isEmpty predicate drives it, errors never become empty", async () => {
    const controller = new DomainResourceController<FakeRecord[]>();
    const page = makeDeferred<FakeRecord[]>();
    controller.load({ domain: "directory-persons", identity: "page-0", load: () => page.promise, isEmpty: (rows) => rows.length === 0 });
    page.resolve([]);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getState().phase).toBe("empty");
    const failing = makeDeferred<FakeRecord[]>();
    controller.load({ domain: "directory-persons", identity: "page-0", load: () => failing.promise, isEmpty: (rows) => rows.length === 0 });
    failing.reject(new PlatformClientError(404, "not_found", "not there"));
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getState().phase).toBe("unavailable"); // NOT empty
  });

  it("classifies error phases exactly like the shared model", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    const d = makeDeferred<FakeRecord>();
    controller.load({ domain: "workspace", identity: 5, load: () => d.promise });
    d.reject(new PlatformClientError(403, "directory_claim_required", "no link"));
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getState().phase).toBe("forbidden");
  });

  it("retry re-runs the last request", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    let attempts = 0;
    const load = () => { attempts += 1; return attempts === 1 ? Promise.reject(new PlatformClientError(500, "internal", "boom")) : Promise.resolve({ horseId: 1, secret: "ok" }); };
    controller.load({ domain: "directory-person", identity: 3, load });
    await Promise.resolve(); await Promise.resolve();
    const errored = controller.getState();
    expect(errored.phase).toBe("error");
    controller.retry();
    await Promise.resolve(); await Promise.resolve();
    const recovered = controller.getState();
    expect(recovered.phase).toBe("ready");
    expect(attempts).toBe(2);
  });
});

describe("P20 domain loader — cancelled requests never update unmounted state", () => {
  it("dispose() aborts in-flight and drops every late resolution", async () => {
    const { calls, load } = scriptedFetcher();
    const controller = new DomainResourceController<FakeRecord>();
    const events = notified(controller);
    controller.load({ domain: "horse-record", identity: 101, load });
    controller.dispose();
    expect(calls[0]!.signal.aborted).toBe(true);
    // A late resolution arrives after dispose (the unmount case).
    calls[0]!.deferred.resolve({ horseId: 101, secret: "late" });
    await Promise.resolve(); await Promise.resolve();
    // No further notifications fired, state never became ready.
    expect(events).toEqual(["loading"]);
    expect(controller.getState().phase).toBe("loading");
    expect(() => controller.load({ domain: "horse-record", identity: 102, load })).toThrow(/disposed/);
  });

  it("a superseded load's AbortError is swallowed — races are normal, not errors", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    const { calls, load } = scriptedFetcher();
    controller.load({ domain: "horse-record", identity: 1, load });
    controller.load({ domain: "horse-record", identity: 2, load });
    calls[0]!.deferred.reject(new DOMException("aborted", "AbortError"));
    calls[1]!.deferred.resolve({ horseId: 2, secret: "winner" });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(controller.getState().phase).toBe("ready");
  });

  it("subscribers are notified on every state change and unsubscribe cleanly", async () => {
    const controller = new DomainResourceController<FakeRecord>();
    let notifications = 0;
    const unsubscribe = controller.subscribe(() => { notifications += 1; });
    const d = makeDeferred<FakeRecord>();
    controller.load({ domain: "workspace", identity: 9, load: () => d.promise });
    d.resolve({ horseId: 9, secret: "x" });
    await Promise.resolve(); await Promise.resolve();
    expect(notifications).toBe(2); // loading + ready
    unsubscribe();
    const e = makeDeferred<FakeRecord>();
    controller.load({ domain: "workspace", identity: 9, load: () => e.promise });
    e.resolve({ horseId: 9, secret: "y" });
    await Promise.resolve(); await Promise.resolve();
    expect(notifications).toBe(2); // unsubscribed — no more events
  });
});
