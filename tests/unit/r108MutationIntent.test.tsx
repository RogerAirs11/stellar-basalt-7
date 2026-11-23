// @vitest-environment happy-dom
/**
 * R108-05 — durable, privacy-scoped uncertain-write intent recovery, proven
 * on REAL React (createRoot + act) with the REAL localStorage behind the
 * storage protocol (happy-dom provides a genuine per-test localStorage; the
 * storage-denial cases stub it to throw).
 *
 * Covered acceptance:
 *  - begin() persists pending; markSubmitted() persists submitted; the record
 *    survives a full UNMOUNT + REMOUNT (the reload stand-in) and is
 *    reconciled with the server BEFORE a new intent is allowed.
 *  - Server confirms: one record, one receipt id, the record is cleared —
 *    never a duplicate, never a fabricated success.
 *  - Server says unknown / reconcile transport fails: an honest unknown
 *    state with the record RETAINED (recheck / discard), never auto-concluded.
 *  - A different payload under the same key conflicts server-side (pinned in
 *    the HTTP suite); a fresh explicit intent mints a NEW key.
 *  - Logout/account switch: another principal's pending state is swept from
 *    storage (cross-account deletion) and never leaks into the new session.
 *  - Storage denial: durable=false is surfaced honestly; the in-memory
 *    fallback still works within the session and nothing fabricates success.
 *  - Privacy: the persisted JSON contains ONLY non-sensitive metadata — the
 *    raw note text is never written to storage.
 *  - TTL: an expired intent is surfaced once and cleared.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useMutationIntent, openIntentStorage, MUTATION_INTENT_PREFIX, MUTATION_INTENT_TTL_MS,
  isIntentExpired, type MutationIntentRecord, type IntentReconciliationLookup,
} from "../../src/frontend-kit/domain/mutationIntent";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
});

function mount(element: React.ReactElement): void {
  if (!root) root = createRoot(container);
  act(() => { root!.render(element); });
}

/** Unmount AND drop the root so the next mount is a genuine fresh tree. */
function unmount(): void {
  act(() => { root?.unmount(); });
  root = null;
}

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Probe {
  phase: string;
  durable: boolean;
  hasRecord: boolean;
  key: string | null;
  requestId: number | null;
  unknownReason: string | null;
}

let probe: Probe = { phase: "idle", durable: true, hasRecord: false, key: null, requestId: null, unknownReason: null };
let api: ReturnType<typeof useMutationIntent> | null = null;
let reconcileCalls: string[] = [];
/** The gate the NEXT lookup call returns — reassigned per scenario so no
 * re-render is needed to hand the hook a fresh server answer. */
let activeGate: Deferred<{ state: "confirmed" | "unresolved" | "unknown"; request_id?: number }> | null = null;
let lookup: IntentReconciliationLookup | null = null;

function IntentHost({ scope, workflow = "service-request", resource = 42 }: { scope: string; workflow?: string; resource?: string | number }) {
  const intents = useMutationIntent(workflow, scope, resource, lookup);
  api = intents;
  probe = {
    phase: intents.snapshot.phase,
    durable: intents.snapshot.durable,
    hasRecord: intents.snapshot.record !== null,
    key: intents.snapshot.record?.key ?? null,
    requestId: intents.snapshot.requestId,
    unknownReason: intents.snapshot.unknownReason,
  };
  return <span data-testid="intent">{intents.snapshot.phase}</span>;
}

const textOf = (): string => container.querySelector('[data-testid="intent"]')?.textContent ?? "";

/** A stored record exactly as the protocol writes it (for reload seeding). */
function seedRecord(overrides: Partial<MutationIntentRecord> = {}): MutationIntentRecord {
  return {
    key: "seed-key-12345678", scope: "user:a", workflow: "service-request", resource: "42",
    summary: { category: "farrier", share_contact: false, note_length: 24 },
    phase: "submitted", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("R108-05 mutation intent protocol (real React + real localStorage)", () => {
  it("begin persists pending, markSubmitted persists submitted, and the record survives a full remount (the reload stand-in)", () => {
    lookup = null;
    mount(<IntentHost scope="user:a" />);
    expect(probe.phase).toBe("idle");
    let key = "";
    act(() => { key = api!.begin({ category: "farrier", share_contact: false, note_length: 24 }); });
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(probe.phase).toBe("pending");
    expect(probe.hasRecord).toBe(true);
    act(() => { api!.markSubmitted(); });
    expect(probe.phase).toBe("submitted");
    // The record is REALLY in storage — with non-sensitive metadata only.
    const raw = localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`);
    expect(raw).toBeTruthy();
    expect(raw!).not.toContain("farrier note text"); // the raw note never persists
    const stored = JSON.parse(raw!) as MutationIntentRecord;
    expect(stored.key).toBe(key);
    expect(stored.phase).toBe("submitted");
    expect(stored.summary.note_length).toBe(24);

    // Full unmount + remount = the reload: the record is loaded again and
    // (submitted) reconciliation fires automatically.
    reconcileCalls = [];
    activeGate = deferred();
    lookup = (k) => { reconcileCalls.push(k); return activeGate!.promise; };
    unmount();
    mount(<IntentHost scope="user:a" />);
    expect(probe.phase).toBe("submitted"); // the durable record is back
    expect(reconcileCalls).toEqual([key]);
  });

  it("server CONFIRMS: one record, one receipt id, record cleared — never a duplicate", async () => {
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord()));
    activeGate = deferred();
    const calls: string[] = [];
    lookup = (k) => { calls.push(k); return activeGate!.promise; };
    mount(<IntentHost scope="user:a" />);
    expect(calls).toEqual(["seed-key-12345678"]);
    await act(async () => { activeGate!.resolve({ state: "confirmed", request_id: 77 }); });
    expect(probe.phase).toBe("confirmed");
    expect(probe.requestId).toBe(77);
    expect(probe.hasRecord).toBe(false);
    expect(localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`)).toBeNull();
  });

  it("server says UNKNOWN: the record is retained with an honest state; the user rechecks or discards — nothing is auto-concluded", async () => {
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord()));
    activeGate = deferred();
    lookup = () => activeGate!.promise;
    mount(<IntentHost scope="user:a" />);
    await act(async () => { activeGate!.resolve({ state: "unknown" }); });
    expect(probe.phase).toBe("unknown");
    expect(probe.unknownReason).toBe("no_receipt_on_server");
    expect(probe.hasRecord).toBe(true); // retained for the next recheck
    // The user rechecks; the server has the receipt now.
    activeGate = deferred();
    await act(async () => {
      activeGate!.resolve({ state: "confirmed", request_id: 91 });
      await api!.reconcileNow();
    });
    expect(probe.phase).toBe("confirmed");
    expect(probe.requestId).toBe(91);

    // A discarded unknown clears the record and returns to idle.
    act(() => { api!.begin({ category: "other" }); });
    act(() => { api!.markSubmitted(); });
    expect(probe.phase).toBe("submitted");
    act(() => { api!.discard(); });
    expect(probe.phase).toBe("idle");
    expect(probe.hasRecord).toBe(false);
    expect(localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`)).toBeNull();
  });

  it("reconcile transport FAILURE keeps an honest unknown (reconcile_failed); a legacy unresolved receipt is surfaced, not retried", async () => {
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord()));
    activeGate = deferred();
    lookup = () => activeGate!.promise;
    mount(<IntentHost scope="user:a" />);
    await act(async () => { activeGate!.reject(new Error("offline")); });
    expect(probe.phase).toBe("unknown");
    expect(probe.unknownReason).toBe("reconcile_failed");
    expect(probe.hasRecord).toBe(true);

    act(() => { root!.unmount(); });
    root = null;
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord()));
    activeGate = deferred();
    lookup = () => activeGate!.promise;
    mount(<IntentHost scope="user:a" />);
    await act(async () => { activeGate!.resolve({ state: "unresolved" }); });
    expect(probe.phase).toBe("unknown");
    expect(probe.unknownReason).toBe("legacy_receipt_unresolved");
    expect(probe.hasRecord).toBe(true); // kept until the user discards
  });

  it("account switch and logout sweep the other principal's pending state (cross-account deletion)", () => {
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord()));
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|43`, JSON.stringify(seedRecord({ resource: "43" })));
    lookup = null;
    // Account B mounts: every user:a record is deleted, B starts clean.
    mount(<IntentHost scope="user:b" resource={42} />);
    expect(probe.phase).toBe("idle");
    expect(probe.hasRecord).toBe(false);
    expect(localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`)).toBeNull();
    expect(localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|43`)).toBeNull();

    // A returns later: their own record stays scoped to them (seeded fresh).
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord()));
    activeGate = deferred(); // reconciliation in flight while asserted
    lookup = () => activeGate!.promise;
    unmount();
    mount(<IntentHost scope="user:a" resource={42} />);
    expect(probe.phase).toBe("submitted");

    // Logout (anonymous) clears EVERY intent record.
    unmount();
    mount(<IntentHost scope="anonymous" resource={42} />);
    expect(probe.phase).toBe("idle");
    expect(localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`)).toBeNull();
  });

  it("storage denial is honest: durable=false, in-memory fallback within the session, no fabricated success", () => {
    const throwing = {
      length: 0,
      clear: () => {},
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
      key: () => null,
    } as unknown as Storage;
    vi.stubGlobal("localStorage", throwing);
    try {
      const storage = openIntentStorage();
      expect(storage.durable).toBe(false);
      lookup = null;
      mount(<IntentHost scope="user:a" />);
      expect(probe.durable).toBe(false); // surfaced to the UI honestly
      act(() => { api!.begin({ category: "farrier", note_length: 10 }); });
      act(() => { api!.markSubmitted(); });
      expect(probe.phase).toBe("submitted"); // still works in-memory this session
      expect(probe.hasRecord).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("TTL: an expired intent is surfaced once as expired and cleared; a fresh intent mints a NEW key", () => {
    const stale = new Date(Date.now() - (MUTATION_INTENT_TTL_MS + 60_000)).toISOString();
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord({ createdAt: stale })));
    expect(isIntentExpired(seedRecord({ createdAt: stale }))).toBe(true);
    lookup = null;
    mount(<IntentHost scope="user:a" />);
    expect(probe.phase).toBe("expired");
    expect(probe.hasRecord).toBe(false);
    expect(localStorage.getItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`)).toBeNull();
    // Composing again after expiry: a NEW key (never the expired one).
    let freshKey = "";
    act(() => { freshKey = api!.begin({ category: "farrier" }); });
    expect(freshKey).not.toBe("seed-key-12345678");
    expect(probe.phase).toBe("pending");
  });

  it("a pending record whose dispatch outcome is unknown surfaces as unknown(dispatch_unknown), not a silent reset", () => {
    // R109 truthful wording: a device-side pending record cannot prove the
    // request never left — a crash may occur after sending — so the honest
    // reason is dispatch_unknown, never a claim of never_dispatched.
    localStorage.setItem(`${MUTATION_INTENT_PREFIX}${encodeURIComponent("user:a")}|service-request|42`, JSON.stringify(seedRecord({ phase: "pending" })));
    lookup = null;
    mount(<IntentHost scope="user:a" />);
    expect(probe.phase).toBe("unknown");
    expect(probe.unknownReason).toBe("dispatch_unknown");
    expect(probe.hasRecord).toBe(true);
  });
});

describe("R108-05 durable recovery remains canonical after R113 native adoption", () => {
  const read = (relative: string): string => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    return readFileSync(join(__dirname, "../..", relative), "utf8");
  };
  it("Core and Elite use the shared composer, with coarse-only intent storage in its domain layer", () => {
    for (const file of ["src/web/frontends/equidata-elite/ServiceRequestsPage.tsx", "src/web/heritage/DirectoryPage.tsx"]) {
      const source=read(file);
      expect(source).toContain("useServiceRequestComposer");
      expect(source).not.toContain("localStorage.setItem");
    }
    const domain=read("src/frontend-kit/domain/serviceComposer.ts");
    expect(domain).toContain("openIntentStorage");
    expect(domain).toContain("reconcileIntent(record.key)");
    expect(domain).toContain("note_length: payload.note.length");
    expect(domain).not.toContain("JSON.stringify(payload)");
    // Behavioral key/payload/privacy assertions live in serviceComposerR113.test.ts.
  });
});
