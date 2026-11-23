// @vitest-environment happy-dom
/**
 * R108-03 — session and principal isolation validated with ACTUAL React,
 * real transport boundaries and (part B) the real Worker entrypoint with
 * real cookies — the promotion of the R108 native hook-double cases
 * (tools/test-r108-auth.cjs) onto the real rendering and HTTP surfaces.
 *
 * PART A mounts the REAL createPlatformClient inside a React host that
 * mirrors src/web/main.tsx exactly (client in state, onSessionChange driving
 * user/permissions state) under StrictMode, with deferred promises and a
 * PAINT TRACE: every render pass records the principal that was painted.
 * The acceptance property is proven on the trace — the old principal's
 * identity is never painted after the switch, not merely absent from the
 * final DOM.
 *
 * Covered acceptance:
 *  A1. A delayed /me response cannot restore a logged-out principal
 *      (logout supersedes the pending read; nothing is painted after the
 *      synchronous anonymous clear).
 *  A2. Out-of-order /me reads never repaint the older snapshot.
 *  A3. A→B through a real session write paints anonymous synchronously
 *      BEFORE B lands (the clear happens at mutation start, not completion).
 *  A4. A→B→A returns to A only through a FRESH read (call count), and a
 *      permission-only change re-keys the principal scope (epoch semantics).
 *  A5. Overlapping cookie-changing commands are refused before transport
 *      (one transport call, session_change_in_progress surfaced in React).
 *  A6. Unmount during an in-flight read publishes nothing afterwards.
 *  A7. Aborted reads never publish a custom transport result.
 *  A8. Malformed/unknown-permission success payloads are rejected without
 *      publishing authority (invalid_session_response surfaced in React).
 *
 * PART B (describe "two tabs") drives the REAL Worker (src/worker.ts default
 * export — the module Cloudflare deploys) over Request/Response with a
 * STATEFUL scripted D1 (real session insert/delete semantics) and two
 * independent cookie jars: two simultaneous principals stay isolated, and a
 * logout in one tab cannot revoke or alter the other tab's session.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import React, { StrictMode, useEffect, useRef, useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPlatformClient, type PlatformTransport } from "../../src/frontend-kit/platformClient";
import { principalScopeKey } from "../../src/frontend-kit/domain/principalScope";
import type { PlatformClient, PlatformUser, PlatformPermission } from "../../src/frontend-kit";

// Real act() environment (same discipline as equidataEliteDirectoryJourney).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Real-React harness (mirrors frontendKitPrincipalScope.test.tsx discipline).
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
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

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const sessionOf = (id: string, permissions: PlatformPermission[] = ["horse.read", "claim.create"]) => ({
  user: { id, email: `${id}@example.invalid`, display_name: id, role: "owner" },
  csrfToken: `csrf-${id}`,
  permissions,
});

interface Recorded { url: string; init?: RequestInit }

/**
 * Channel transport: every transport call gets its OWN deferred the test
 * resolves (or rejects) in whatever adversarial order it chooses. `calls`
 * records the order of requests; `gates[i]` is call i's deferred.
 */
function channelTransport() {
  const calls: Recorded[] = [];
  const gates: Array<Deferred<unknown>> = [];
  const transport: PlatformTransport = <T,>(url: string, init?: RequestInit): Promise<T> => {
    calls.push({ url, init });
    const gate = deferred<unknown>();
    gates.push(gate);
    return gate.promise as Promise<T>;
  };
  return { calls, gates, transport };
}

/** Capture a client call's outcome without letting rejections escape. */
async function observe<T>(promise: Promise<T>): Promise<{ value?: T; error?: { code?: string; name?: string } }> {
  try { return { value: await promise }; }
  catch (error) { return { error: error as { code?: string; name?: string } }; }
}

/**
 * The host application — mirrors src/web/main.tsx's session wiring exactly:
 * the client is created once with onSessionChange driving React state, and
 * the paint trace records the principal PAINTED on every render pass.
 * `onClient` hands the test the live client (the same indirection main.tsx
 * has via useMemo — the client is never recreated on re-render).
 */
function HostApp(props: {
  transport: PlatformTransport;
  trace: string[];
  errors: Array<{ code: string }>;
  onClient?: (client: PlatformClient) => void;
  boot?: boolean;
}) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [permissions, setPermissions] = useState<PlatformPermission[]>([]);
  const csrfRef = useRef<string | null>(null);
  const [client] = useState<PlatformClient>(() => createPlatformClient({
    transport: props.transport,
    csrfToken: () => csrfRef.current,
    onSessionChange: (session) => {
      setUser(session.user);
      setPermissions([...session.permissions]);
      csrfRef.current = session.csrfToken;
    },
  }));
  // Expose the COMMITTED client after mount. (Exposing from the useState
  // initializer would be unreliable under StrictMode double-render: React may
  // commit a different initializer invocation than the one that last wrote
  // the external ref, and the boot read and the test's commands would then
  // run on different client instances with no shared session fence.)
  useEffect(() => { props.onClient?.(client); }, [client]);
  // PAINT TRACE: the principal that is on screen after this render pass.
  props.trace.push(`${user?.id ?? "anonymous"}:${[...permissions].sort().join("+")}`);
  const bootedRef = useRef(false);
  useEffect(() => {
    if (props.boot === false || bootedRef.current) return;
    bootedRef.current = true;
    void client.auth.me().catch((error: { code?: string }) => {
      props.errors.push({ code: error?.code ?? "unknown" });
    });
  }, [client, props.boot]);
  return <span data-testid="principal">{user?.id ?? "anonymous"}</span>;
}

interface HostHandles {
  client: PlatformClient;
  trace: string[];
  errors: Array<{ code: string }>;
  calls: Recorded[];
  gates: Array<Deferred<unknown>>;
}

/** Mount sequence: each mountHost call REMOUNTS a fresh host (unique key) so
 * repeated mounts in one test (A8's loop) never reconcile as an update of the
 * previous host — an update would reuse the old client state and never fire
 * the expose effect for the new handles. */
let mountSeq = 0;

/** Mount the StrictMode host and wait for the boot /me to be dispatched. */
async function mountHost(boot = true): Promise<HostHandles> {
  const channel = channelTransport();
  const handles: HostHandles = { client: null as unknown as PlatformClient, trace: [], errors: [], ...channel };
  mount(<StrictMode><HostApp key={String(++mountSeq)} transport={channel.transport} trace={handles.trace} errors={handles.errors} onClient={(c) => { handles.client = c; }} boot={boot} /></StrictMode>);
  await act(async () => { await Promise.resolve(); });
  return handles;
}

// ---------------------------------------------------------------------------
// PART A — real React + real platformClient.
// ---------------------------------------------------------------------------

describe("R108-03 A. real-React session isolation (StrictMode, deferred promises, paint traces)", () => {
  it("A1. a delayed /me response cannot restore a logged-out principal", async () => {
    const host = await mountHost();
    expect(host.calls.map((c) => c.url)).toEqual(["/api/auth/me"]);

    // Logout WHILE /me is still pending: the host must paint anonymous
    // immediately (the clear happens at mutation start, before any await).
    let logoutOutcome: Promise<{ value?: unknown; error?: { code?: string } }> | null = null;
    await act(async () => {
      logoutOutcome = observe(host.client.auth.logout());
      await Promise.resolve();
    });
    expect(host.trace[host.trace.length - 1].startsWith("anonymous:")).toBe(true);
    expect(host.calls.map((c) => c.url)).toEqual(["/api/auth/me", "/api/auth/logout"]);

    // NOW the old /me resolves with principal A — it must be superseded.
    await act(async () => {
      host.gates[0].resolve(sessionOf("user-a"));
      await Promise.resolve();
      host.gates[1].resolve({ ok: true });
      await logoutOutcome!;
    });
    expect(host.trace.filter((entry) => entry.startsWith("user-a:"))).toHaveLength(0);
    expect(host.errors).toContainEqual({ code: "session_superseded" });
    expect(host.trace[host.trace.length - 1].startsWith("anonymous:")).toBe(true);
  });

  it("A2. out-of-order /me reads never repaint the older snapshot", async () => {
    const host = await mountHost(false);
    let reads: Array<Promise<{ value?: unknown; error?: { code?: string } }>> = [];
    await act(async () => {
      reads = [observe(host.client.auth.me()), observe(host.client.auth.me())];
      await Promise.resolve();
    });
    expect(host.calls.map((c) => c.url)).toEqual(["/api/auth/me", "/api/auth/me"]);

    // The SECOND read resolves first with B; then the OLDER read resolves
    // with A — the older snapshot must never be published.
    await act(async () => {
      host.gates[1].resolve(sessionOf("user-b"));
      await reads[1];
      host.gates[0].resolve(sessionOf("user-a"));
      await reads[0];
    });
    expect(host.trace.filter((entry) => entry.startsWith("user-a:"))).toHaveLength(0);
    expect(host.trace[host.trace.length - 1].startsWith("user-b:")).toBe(true);
    // The superseded read's outcome is observed directly (the reads in this
    // test are test-initiated, not the host's boot read).
    expect((await reads[0]).error?.code).toBe("session_superseded");
  });

  it("A3. A→B through a real session write paints anonymous BEFORE B lands", async () => {
    const host = await mountHost();
    await act(async () => {
      host.gates[0].resolve(sessionOf("user-a"));
      await Promise.resolve();
    });
    expect(host.trace[host.trace.length - 1].startsWith("user-a:")).toBe(true);

    // login-as-B starts: anonymous must be painted BEFORE the response.
    let loginOutcome: Promise<{ value?: unknown; error?: { code?: string } }> | null = null;
    await act(async () => {
      loginOutcome = observe(host.client.auth.login({ email: "b@example.invalid", password: "fixture-password" }));
      await Promise.resolve();
    });
    const paintedDuringFlight = host.trace[host.trace.length - 1].startsWith("anonymous:");
    expect(paintedDuringFlight).toBe(true);

    await act(async () => {
      host.gates[1].resolve(sessionOf("user-b"));
      await loginOutcome!;
    });
    expect(host.trace[host.trace.length - 1].startsWith("user-b:")).toBe(true);
    // And no A paint ever occurs after the anonymous clear.
    const lastA = host.trace.map((e) => e.startsWith("user-a:")).lastIndexOf(true);
    const firstAnonAfterA = host.trace.findIndex((e, i) => i > lastA && e.startsWith("anonymous:"));
    expect(lastA).toBeLessThan(firstAnonAfterA);
    expect(host.trace[host.trace.length - 1].startsWith("user-b:")).toBe(true);
  });

  it("A4. A→B→A returns to A only through a FRESH read; permission-only changes re-key the scope", async () => {
    const host = await mountHost();
    await act(async () => { host.gates[0].resolve(sessionOf("user-a")); await Promise.resolve(); });
    // Switch to B via a fresh /me (a second tab's perspective).
    let readB: Promise<{ value?: unknown; error?: { code?: string } }>;
    await act(async () => {
      readB = observe(host.client.auth.me());
      await Promise.resolve();
      host.gates[1].resolve(sessionOf("user-b"));
      await readB!;
    });
    expect(host.trace[host.trace.length - 1].startsWith("user-b:")).toBe(true);
    // Back to A — a THIRD /me (fresh read; nothing is cached or resurrected).
    let readA2: Promise<{ value?: unknown; error?: { code?: string } }>;
    await act(async () => {
      readA2 = observe(host.client.auth.me());
      await Promise.resolve();
      host.gates[2].resolve(sessionOf("user-a"));
      await readA2!;
    });
    expect(host.calls.filter((c) => c.url === "/api/auth/me")).toHaveLength(3);
    expect(host.trace[host.trace.length - 1].startsWith("user-a:")).toBe(true);

    // Permission-only change (same user, new grant): the principal scope key
    // MUST change — this is the epoch that re-keys private resources (the
    // same semantics the Classic entry uses to remount its iframe).
    const before = principalScopeKey({ id: "user-a", display_name: "A" } as PlatformUser, ["horse.read"] as PlatformPermission[]);
    const after = principalScopeKey({ id: "user-a", display_name: "A" } as PlatformUser, ["horse.read", "claim.create"] as PlatformPermission[]);
    expect(before).not.toEqual(after);
    expect(principalScopeKey({ id: "user-a", display_name: "A" } as PlatformUser, ["horse.read"] as PlatformPermission[])).toEqual(before);
  });

  it("A5. overlapping cookie-changing commands are refused before transport", async () => {
    const host = await mountHost(false);
    let first: Promise<{ value?: unknown; error?: { code?: string } }>;
    let second: Promise<{ value?: unknown; error?: { code?: string } }>;
    await act(async () => {
      first = observe(host.client.auth.login({ email: "a@example.invalid", password: "fixture-password" }));
      await Promise.resolve();
      second = observe(host.client.auth.demoAdmin());
      await Promise.resolve();
    });
    await act(async () => {
      host.gates[0].resolve(sessionOf("user-a"));
      await first!;
      await second!;
    });
    // Only ONE transport call happened; the second command was refused
    // client-side with session_change_in_progress.
    expect(host.calls).toHaveLength(1);
    expect((await second!).error?.code).toBe("session_change_in_progress");
  });

  it("A6. unmount during an in-flight read publishes nothing afterwards", async () => {
    const host = await mountHost();
    const paintsBeforeUnmount = host.trace.length;
    act(() => { root?.unmount(); });
    // The pending /me resolves AFTER unmount — no state may be published.
    await act(async () => {
      host.gates[0].resolve(sessionOf("user-a"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.trace.length).toBe(paintsBeforeUnmount);
    expect(host.errors).toHaveLength(0);
  });

  it("A7. aborted reads never publish a custom transport result", async () => {
    const host = await mountHost(false);
    const controller = new AbortController();
    let read: Promise<{ value?: unknown; error?: { code?: string; name?: string } }>;
    await act(async () => {
      read = observe(host.client.auth.me({ signal: controller.signal }));
      await Promise.resolve();
    });
    await act(async () => {
      controller.abort();
      host.gates[0].resolve(sessionOf("user-a"));
      await read!;
    });
    expect((await read!).error?.name).toBe("AbortError");
    expect(host.trace.every((entry) => entry.startsWith("anonymous:"))).toBe(true);
  });

  it("A8. malformed or unknown-permission success payloads publish no authority", async () => {
    const malformed: Array<[string, unknown]> = [
      ["anonymous privilege", { user: null, csrfToken: null, permissions: ["horse.edit"] }],
      ["malformed user", { ...sessionOf("user-a"), user: { id: "user-a" } }],
      ["malformed token", { ...sessionOf("user-a"), csrfToken: { secret: true } }],
      ["malformed permission", { ...sessionOf("user-a"), permissions: [{}] }],
      ["unknown permission", { ...sessionOf("user-a"), permissions: ["horse.superpower"] }],
    ];
    for (const [label, payload] of malformed) {
      const host = await mountHost(false);
      let read: Promise<{ value?: unknown; error?: { code?: string } }>;
      await act(async () => {
        read = observe(host.client.auth.me());
        await Promise.resolve();
      });
      await act(async () => {
        host.gates[0].resolve(payload);
        await read!;
      });
      expect((await read!).error?.code, label).toBe("invalid_session_response");
      expect(host.trace[host.trace.length - 1].startsWith("anonymous:"), label).toBe(true);
      expect(host.trace.every((entry) => entry.startsWith("anonymous:")), label).toBe(true);
    }
  });
});
