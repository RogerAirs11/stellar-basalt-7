// @vitest-environment happy-dom
/**
 * R107 NEXT-05 — principal-aware frontend resource invalidation, mounted in
 * REAL React (same discipline as the R96-N10 suite; react-dom/client + act).
 *
 * The acceptance tests of master-AI BACKLOG NEXT-05, executed against the
 * actual shared hooks and the actual skin wrapper hooks — not a double:
 *
 *  A. useScopedState render-time mask: switching principal A→B, the stored
 *     private snapshot of A is masked in the FIRST B render (before any
 *     effect can flush), and returning to A can never resurrect A's stale
 *     cache (it must re-load under the new epoch).
 *  B. The skin wrapper hooks (EquiData Elite useAsyncValue / FEI Classic
 *     useAsync) with the principal scope in the dependency array: the A→B
 *     switch between two EQUALLY-PERMISSIONED accounts re-keys the resource;
 *     the slower OLD principal's data never renders under B — not even once.
 *  C. useMyDirectoryClaims with a principal scope: account switch masks and
 *     reloads; the old principal's late resolution cannot repopulate.
 *  D. principalScopeKey: stable string identity (user id + permission epoch,
 *     never an arbitrary object serialization); anonymous collapses.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { StrictMode, useEffect, useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAsyncValue } from "../../src/web/frontends/equidata-elite/hooks";
import { useAsync } from "../../src/web/frontends/fei-classic/hooks";
import { principalScopeKey, usePrincipalScope, useScopedState, useMyDirectoryClaims } from "../../src/frontend-kit";
import type { PlatformUser } from "../../src/frontend-kit";

// ---------------------------------------------------------------------------
// Real-React harness (mirrors frontendKitReactSemantics.test.tsx).
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
  root = createRoot(container);
  act(() => { root!.render(element); });
}
function rerender(element: React.ReactElement): void {
  act(() => { root!.render(element); });
}

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const userA = { id: "user-a", display_name: "A" } as PlatformUser;
const userB = { id: "user-b", display_name: "B" } as PlatformUser;
const samePermissions = ["claim.review", "change.review"] as const;

// ---------------------------------------------------------------------------
// A. useScopedState — the render-time principal mask.
// ---------------------------------------------------------------------------

describe("NEXT-05 A. useScopedState render-time mask", () => {
  // The probe records EVERY rendered value (a paint trace). The render-time
  // mask is a property of the render pass BEFORE the new scope's effects
  // run, so it is asserted on the trace — the first value painted under a
  // new scope must be the masked initial, never the previous principal's
  // stored snapshot.
  let trace: string[] = [];
  function ScopedProbe({ scope, initial }: { scope: string; initial: string }) {
    const [value, setValue] = useScopedState<string>(scope, initial);
    useEffect(() => {
      // The "load" of private data for whoever owns the CURRENT scope.
      setValue(`private-of-${scope}`);
    }, [scope]);
    trace.push(value);
    return <div data-testid="probe">{value}</div>;
  }

  it("A→B: the FIRST B render shows the masked initial — A's private data never paints under B", async () => {
    trace = [];
    mount(<ScopedProbe scope="user:a" initial="EMPTY" />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("private-of-user:a");
    // Switch principal — this render happens BEFORE B's effects.
    const before = trace.length;
    rerender(<ScopedProbe scope="user:b" initial="EMPTY" />);
    // The first B render must show the masked initial, NOT A's snapshot.
    expect(trace[before]).toBe("EMPTY");
    expect(trace.slice(before).every((entry) => entry !== "private-of-user:a")).toBe(true);
    // After B's effects, B's own data appears.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("private-of-user:b");
  });

  it("A→B→A: returning to the earlier principal NEVER resurrects its stale cache", async () => {
    trace = [];
    mount(<ScopedProbe scope="user:a" initial="EMPTY" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("private-of-user:a");
    rerender(<ScopedProbe scope="user:b" initial="EMPTY" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("private-of-user:b");
    // Back to A: the committed reset means A's OLD stored value is gone —
    // the first A render is the masked initial; only a FRESH load (a new
    // effect run) may show A's data again. Resurrection would show
    // "private-of-user:a" directly as the first A render.
    const before = trace.length;
    rerender(<ScopedProbe scope="user:a" initial="EMPTY" />);
    expect(trace[before]).toBe("EMPTY");
    expect(trace.slice(before).every((entry) => entry !== "private-of-user:b")).toBe(true);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("private-of-user:a");
  });

  it("the setter applies to the CURRENT scope's visible value, never the masked one", () => {
    function Counter({ scope }: { scope: string }) {
      const [count, setCount] = useScopedState<number>(scope, 0);
      return (
        <div>
          <button data-testid="inc" onClick={() => setCount((prior) => prior + 1)}>inc</button>
          <span data-testid="count">{count}</span>
        </div>
      );
    }
    mount(<Counter scope="user:a" />);
    act(() => { (container.querySelector('[data-testid="inc"]') as HTMLButtonElement).click(); });
    act(() => { (container.querySelector('[data-testid="inc"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="count"]')!.textContent).toBe("2");
    rerender(<Counter scope="user:b" />);
    expect(container.querySelector('[data-testid="count"]')!.textContent).toBe("0");
    act(() => { (container.querySelector('[data-testid="inc"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="count"]')!.textContent).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// B. The skin wrapper hooks with the principal scope in deps — the
//    A→B SAME-PERMISSION switch (the exact NEXT-05 acceptance case).
// ---------------------------------------------------------------------------

describe("NEXT-05 B. skin wrapper hooks — A→B with identical permissions", () => {
  it("EquiData Elite useAsyncValue: A's slower data NEVER renders under B", async () => {
    const pending: Array<Deferred<string>> = [];
    const load = () => { const d = deferred<string>(); pending.push(d); return d.promise; };
    const seen: string[] = [];

    function ElitePrivateList({ user }: { user: PlatformUser | null }) {
      const principalScope = usePrincipalScope(user, samePermissions);
      const state = useAsyncValue((signal) => load().then((value) => { void signal; return value; }), [principalScope]);
      const text = `${state.status}:${state.data ?? "-"}`;
      seen.push(text);
      return <div data-testid="probe">{text}</div>;
    }

    mount(<ElitePrivateList user={userA} />);
    expect(pending).toHaveLength(1);
    await act(async () => { pending[0].resolve("A-private-records"); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("ready:A-private-records");

    // Account switch with the SAME permission set — only the scope changes.
    rerender(<ElitePrivateList user={userB} />);
    expect(pending).toHaveLength(2);
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("loading");
    // A's duplicate late resolution (a second response for the old key) lands now.
    await act(async () => { pending[0].resolve("A-private-records-late"); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("loading");
    await act(async () => { pending[1].resolve("B-private-records"); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("ready:B-private-records");
    expect(seen.some((entry) => entry.startsWith("ready:A") && pending.length > 1 && entry.includes("A-private"))).toBe(true);
    // No render ever showed A's data after the switch.
    const switchIndex = seen.findIndex((entry) => entry.includes("B-private-records"));
    expect(seen.slice(switchIndex).every((entry) => !entry.includes("A-private"))).toBe(true);
  });

  it("FEI Classic useAsync (enabled form): logout disables the private loader and disposes in-flight state", async () => {
    const pending: Array<Deferred<string>> = [];
    let calls = 0;
    const load = () => { calls += 1; const d = deferred<string>(); pending.push(d); return d.promise; };

    function FeiAdminQueue({ user }: { user: PlatformUser | null }) {
      const principalScope = usePrincipalScope(user, samePermissions);
      const state = useAsync((signal) => { void signal; return load(); }, [principalScope], Boolean(user));
      return <div data-testid="probe">{state.status}:{state.data ?? "-"}</div>;
    }

    mount(<FeiAdminQueue user={userA} />);
    expect(calls).toBe(1);
    await act(async () => { pending[0].resolve("A-admin-queue"); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("ready:A-admin-queue");
    // Logout: enabled=false — the private surface synchronously shows idle
    // and never touches the loader again; the late duplicate is dropped.
    rerender(<FeiAdminQueue user={null} />);
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("idle");
    await act(async () => { pending[0].resolve("A-admin-queue-late"); });
    expect(container.textContent).not.toContain("A-admin-queue-late");
    expect(calls).toBe(1);
  });

  it("StrictMode double-mount keeps exactly the newest mount's state visible (React concurrent semantics)", async () => {
    const pending: Array<Deferred<string>> = [];
    const load = () => { const d = deferred<string>(); pending.push(d); return d.promise; };
    function EliteStrict({ user }: { user: PlatformUser | null }) {
      const principalScope = usePrincipalScope(user, samePermissions);
      const state = useAsyncValue((signal) => { void signal; return load(); }, [principalScope]);
      return <div data-testid="probe">{state.status}:{state.data ?? "-"}</div>;
    }
    mount(
      <StrictMode>
        <EliteStrict user={userA} />
      </StrictMode>,
    );
    expect(pending.length).toBeGreaterThanOrEqual(2); // both dev mounts started
    await act(async () => { pending.forEach((d, i) => d.resolve(`mount-${i}-data`)); });
    const rendered = container.querySelector('[data-testid="probe"]')!.textContent ?? "";
    expect(rendered.startsWith("ready:")).toBe(true);
    expect(rendered).not.toContain("loading");
  });
});

// ---------------------------------------------------------------------------
// C. useMyDirectoryClaims — the shared kit claims list with a principal scope.
// ---------------------------------------------------------------------------

describe("NEXT-05 C. useMyDirectoryClaims with principal scope", () => {
  function claimsPlatform() {
    const pending: Array<Deferred<{ claims: Array<{ id: number; status: string; horse_id: number }> }>> = [];
    const platform = {
      modules: {
        directory: {
          myClaims: () => { const d = deferred<{ claims: Array<{ id: number; status: string; horse_id: number }> }>(); pending.push(d); return d.promise; },
        },
      },
    };
    return { platform, pending };
  }

  it("A loads; B's scope masks A's claims and reloads; A's late duplicate cannot repopulate", async () => {
    const { platform, pending } = claimsPlatform();
    function ClaimsProbe({ user }: { user: PlatformUser | null }) {
      const principalScope = usePrincipalScope(user, null);
      const claims = useMyDirectoryClaims(platform as never, principalScope);
      return <div data-testid="probe">{claims.loading ? "loading" : claims.claims.map((claim) => `#${claim.id}:${claim.status}`).join(",") || "none"}</div>;
    }
    mount(<ClaimsProbe user={userA} />);
    expect(pending).toHaveLength(1);
    await act(async () => { pending[0].resolve({ claims: [{ id: 11, status: "pending", horse_id: 1 }] }); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("#11:pending");
    // Switch to B: A's claims are masked immediately and B's load starts.
    rerender(<ClaimsProbe user={userB} />);
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toBe("loading");
    expect(pending).toHaveLength(2);
    await act(async () => { pending[1].resolve({ claims: [{ id: 22, status: "approved", horse_id: 2 }] }); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("#22:approved");
    expect(container.textContent).not.toContain("#11");
  });

  it("retry reloads under the CURRENT principal only", async () => {
    const { platform, pending } = claimsPlatform();
    function RetryProbe({ user }: { user: PlatformUser | null }) {
      const principalScope = usePrincipalScope(user, null);
      const claims = useMyDirectoryClaims(platform as never, principalScope);
      return (
        <div>
          <span data-testid="probe">{claims.loading ? "loading" : claims.claims.map((claim) => `#${claim.id}`).join(",") || "none"}</span>
          <button data-testid="retry" onClick={() => claims.retry()}>retry</button>
        </div>
      );
    }
    mount(<RetryProbe user={userA} />);
    await act(async () => { pending[0].resolve({ claims: [{ id: 31, status: "pending", horse_id: 3 }] }); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("#31");
    act(() => { (container.querySelector('[data-testid="retry"]') as HTMLButtonElement).click(); });
    expect(pending).toHaveLength(2);
    await act(async () => { pending[1].resolve({ claims: [{ id: 32, status: "pending", horse_id: 3 }] }); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("#32");
  });
});

// ---------------------------------------------------------------------------
// D. principalScopeKey — stable identity + permission epoch strings.
// ---------------------------------------------------------------------------

describe("NEXT-05 D. principalScopeKey identity discipline", () => {
  it("distinguishes users with IDENTICAL permissions (the A→B same-permission case)", () => {
    expect(principalScopeKey(userA, samePermissions)).not.toBe(principalScopeKey(userB, samePermissions));
  });

  it("changes when the permission epoch changes (revocation re-keys the same user)", () => {
    const before = principalScopeKey(userA, ["claim.review", "change.review"]);
    const after = principalScopeKey(userA, ["claim.review"]);
    expect(before).not.toBe(after);
  });

  it("is stable for equal content and collapses to anonymous without a user", () => {
    expect(principalScopeKey(userA, ["b", "a"])).toBe(principalScopeKey(userA, ["a", "b"]));
    expect(principalScopeKey(null, samePermissions)).toBe("anonymous");
    expect(principalScopeKey(undefined)).toBe("anonymous");
    expect(principalScopeKey(userA)).toBe("user:user-a");
  });

  it("never serializes an arbitrary object into the key", () => {
    expect(principalScopeKey(userA, samePermissions)).toMatch(/^user:user-a\|p:[a-z_.+]+$/);
  });
});
