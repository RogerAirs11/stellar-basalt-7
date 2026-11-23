// @vitest-environment happy-dom
/**
 * R108-04 — claims controllers are independently principal- and
 * request-generation-safe. The hooks are mounted on REAL React (createRoot +
 * act, the same discipline as r108PrincipalBrowser.test.tsx) inside an
 * UNKEYED host: no host-level `key` ever remounts the component, so every
 * isolation property below is proven by the HOOKS THEMSELVES, not by a
 * keyed remount.
 *
 * Covered acceptance:
 *  A. useMyDirectoryClaims: A→B→A never resurrects the earlier principal's
 *     claims (a late A response after B's paint publishes nothing; returning
 *     to A loads FRESH data, never the stale A cache); overlapping reloads
 *     within one scope are generation-fenced (only the newest commits).
 *  B. useDirectoryClaimFlow: a stale command completion after a principal
 *     change can never publish the earlier principal's claim under the new
 *     one; reset() retires a still-pending completion; the new principal's
 *     own flow still works.
 *  C. ProfileEditorController through the real hook: a submit completion
 *     cannot clear a NEWER draft (edits typed while the command was in
 *     flight survive both the success reload and the 409 conflict path),
 *     and the authoritative reload still lands (row_version adopted).
 *  D. A→B→A on the editor: the earlier principal's controller is disposed
 *     and its late loads/patches publish nothing; the return to A mounts a
 *     FRESH controller.
 *  E. Source locks: every host editor (Core/heritage, Elite, FEI, Retro and
 *     the standalone Classic donor) passes the shared cases by wiring the
 *     principal scope (or, for heritage/Classic, by the keyed host /
 *     stateless re-render + session channel the R107 review certified).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useMyDirectoryClaims, useDirectoryClaimFlow, useProfileEditorController,
  type ProfileEditorPlatform,
} from "../../src/frontend-kit/domain/profileEditor";
import type { DirectoryManagedProfileResponse, DirectoryProfileInput } from "../../src/frontend-kit";

import { PlatformClientError} from "../../src/frontend-kit/errors";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type FlowSubmit = ReturnType<typeof useDirectoryClaimFlow>["submitClaim"];

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

// ---------------------------------------------------------------------------
// Scripted platform: every directory call returns a per-call deferred the
// test resolves in adversarial order; `calls` records the request order.
// ---------------------------------------------------------------------------

interface DirectoryCalls {
  myClaims: Array<{ args: unknown[] }>;
  managedProfile: Array<{ personId: number }>;
  upsertProfile: Array<{ personId: number; submission: Record<string, unknown> }>;
  submitClaim: Array<{ input: Record<string, unknown> }>;
}

function makePlatform(): {
  platform: ProfileEditorPlatform;
  calls: DirectoryCalls;
  gates: {
    myClaims: Array<Deferred<{ claims: Array<Record<string, unknown>> }>>;
    managedProfile: Array<Deferred<DirectoryManagedProfileResponse>>;
    upsertProfile: Array<Deferred<{ profile: Record<string, unknown>; publication?: string }>>;
    submitClaim: Array<Deferred<{ claim: Record<string, unknown>; note: string }>>;
  };
} {
  const calls: DirectoryCalls = { myClaims: [], managedProfile: [], upsertProfile: [], submitClaim: [] };
  const gates = {
    myClaims: [] as Array<Deferred<{ claims: Array<Record<string, unknown>> }>>,
    managedProfile: [] as Array<Deferred<DirectoryManagedProfileResponse>>,
    upsertProfile: [] as Array<Deferred<{ profile: Record<string, unknown>; publication?: string }>>,
    submitClaim: [] as Array<Deferred<{ claim: Record<string, unknown>; note: string }>>,
  };
  const platform = {
    modules: {
      directory: {
        myClaims: (...args: unknown[]) => { calls.myClaims.push({ args }); const gate = deferred<{ claims: Array<Record<string, unknown>> }>(); gates.myClaims.push(gate); return gate.promise; },
        managedProfile: (personId: number) => { calls.managedProfile.push({ personId }); const gate = deferred<DirectoryManagedProfileResponse>(); gates.managedProfile.push(gate); return gate.promise; },
        upsertProfile: (personId: number, submission: DirectoryProfileInput) => { calls.upsertProfile.push({ personId, submission: submission as unknown as Record<string, unknown> }); const gate = deferred<{ profile: Record<string, unknown>; publication?: string }>(); gates.upsertProfile.push(gate); return gate.promise; },
        submitClaim: (input: unknown) => { calls.submitClaim.push({ input: input as unknown as Record<string, unknown> }); const gate = deferred<{ claim: Record<string, unknown>; note: string }>(); gates.submitClaim.push(gate); return gate.promise; },
      },
    },
  } as unknown as ProfileEditorPlatform;
  return { platform, calls, gates };
}

const claim = (id: number, status = "pending"): Record<string, unknown> => ({
  id, claim_type: "person", person_id: 7, organization_id: null, status, review_note: null,
  created_at: "2026-10-01T00:00:00Z", appeal_for_claim_id: null,
});

const profileView = (rowVersion: number, overrides: Record<string, unknown> = {}): DirectoryManagedProfileResponse => ({
  permissions: { edit: true, initial_publication: true, private_contact: true },
  current_province_scheme: "IR-3166-2:2024",
  profile: {
    row_version: rowVersion,
    service_categories: ["farrier"], province_code: "IR-07", city: "Tehran",
    contact_preference: "platform_message", contact_value: "secret-contact",
    languages: "fa", availability_text: "Weekdays", publication_consent: true,
    ...overrides,
  },
} as unknown as DirectoryManagedProfileResponse);

// ---------------------------------------------------------------------------
// The UNKEYED host: scope/platform swap NEVER remounts it (no key anywhere).
// ---------------------------------------------------------------------------

interface HostProbe {
  scope: string;
  claimIds: number[];
  claimsLoading: boolean;
  claimsUnavailable: string | null;
  flowPhase: string;
  flowClaimId: number | null;
  editorPhase: string;
  editorCity: string;
}

const paintLog: HostProbe[] = [];
let retryClaims: () => void = () => {};

function ClaimsHost({ platform, scope, personId }: { platform: ProfileEditorPlatform | null; scope: string; personId: number | null }) {
  const claims = useMyDirectoryClaims(platform, scope);
  retryClaims = claims.retry;
  const flow = useDirectoryClaimFlow(platform, scope);
  const editor = useProfileEditorController(personId, platform, scope);
  const editorDraft = editor.state.phase === "ready" || editor.state.phase === "saving"
    || editor.state.phase === "saved" || editor.state.phase === "conflict" || editor.state.phase === "empty"
    ? editor.state.draft : null;
  const probe: HostProbe = {
    scope,
    claimIds: claims.claims.map((c) => c.id),
    claimsLoading: claims.loading,
    claimsUnavailable: claims.unavailable,
    flowPhase: flow.state.phase,
    flowClaimId: flow.state.phase === "submitted" ? flow.state.claim.id : null,
    editorPhase: editor.state.phase,
    editorCity: editorDraft?.city ?? "",
  };
  paintLog.push(probe);
  return (
    <div data-testid="host">
      <span data-testid="claims">{JSON.stringify(probe.claimIds)}</span>
      <span data-testid="flow">{probe.flowPhase}</span>
      <span data-testid="editor">{probe.editorPhase}:{probe.editorCity}</span>
    </div>
  );
}

const lastProbe = (): HostProbe => paintLog[paintLog.length - 1];
const probesFor = (scope: string): HostProbe[] => paintLog.filter((p) => p.scope === scope);
const textOf = (testid: string): string => container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";

// ---------------------------------------------------------------------------
// A. useMyDirectoryClaims isolation + generation fencing
// ---------------------------------------------------------------------------

describe("R108-04 A. useMyDirectoryClaims (unkeyed host)", () => {
  it("A to B to A never resurrects the earlier principal's claims; a late A response publishes nothing under B", async () => {
    const a1 = makePlatform();
    const b = makePlatform();
    const a2 = makePlatform();
    mount(<ClaimsHost platform={a1.platform} scope="user:a" personId={null} />);

    // A's claims load: one pending claim owned by A.
    await act(async () => { a1.gates.myClaims[0].resolve({ claims: [claim(501)] }); });
    expect(textOf("claims")).toBe("[501]");

    // A refreshes right before the principal switches; that in-flight A
    // response will land LATE — under B.
    act(() => { retryClaims(); });
    expect(a1.calls.myClaims).toHaveLength(2);

    // Switch to B WITHOUT unmounting or keying: B's load starts.
    act(() => { root!.render(<ClaimsHost platform={b.platform} scope="user:b" personId={null} />); });
    // B has not resolved yet — the masked snapshot must show B's INITIAL
    // (loading, no claims), never A's claim.
    expect(textOf("claims")).toBe("[]");
    expect(lastProbe().claimsLoading).toBe(true);

    await act(async () => { b.gates.myClaims[0].resolve({ claims: [claim(901), claim(902)] }); });
    expect(textOf("claims")).toBe("[901,902]");
    expect(probesFor("user:b").every((p) => !p.claimIds.includes(501))).toBe(true);

    // A's LATE refresh response lands now — under B it must publish nothing.
    await act(async () => { a1.gates.myClaims[1].resolve({ claims: [claim(501), claim(503)] }); });
    expect(textOf("claims")).toBe("[901,902]");
    expect(probesFor("user:b").every((p) => !p.claimIds.includes(501) && !p.claimIds.includes(503))).toBe(true);

    // Returning to A loads FRESH data (a2's response), never A's stale cache.
    const probesBeforeReturn = paintLog.length;
    act(() => { root!.render(<ClaimsHost platform={a2.platform} scope="user:a" personId={null} />); });
    expect(textOf("claims")).toBe("[]"); // masked to loading, stale 501 is gone
    await act(async () => { a2.gates.myClaims[0].resolve({ claims: [claim(502, "rejected")] }); });
    expect(textOf("claims")).toBe("[502]");
    // From the return to A onward, NOTHING shows the stale A cache (501).
    expect(paintLog.slice(probesBeforeReturn).every((p) => !p.claimIds.includes(501))).toBe(true);
  });

  it("overlapping reloads within ONE scope are generation-fenced: only the newest response may commit", async () => {
    const a = makePlatform();
    let retry: () => void = () => {};
    function RetryHost() {
      const claims = useMyDirectoryClaims(a.platform, "user:a");
      retry = claims.retry;
      return <span data-testid="claims">{JSON.stringify(claims.claims.map((c) => c.id))}</span>;
    }
    mount(<RetryHost />);
    // Load 1 in flight; the user hits retry before it lands (load 2).
    act(() => { retry(); });
    expect(a.calls.myClaims).toHaveLength(2);
    // The NEWER response lands first; the older one resolves late.
    await act(async () => { a.gates.myClaims[1].resolve({ claims: [claim(701), claim(702)] }); });
    await act(async () => { a.gates.myClaims[0].resolve({ claims: [claim(601)] }); });
    expect(textOf("claims")).toBe("[701,702]"); // the stale 601 never paints
    await expect(a.gates.myClaims[0].promise).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// B. useDirectoryClaimFlow completion fencing
// ---------------------------------------------------------------------------

describe("R108-04 B. useDirectoryClaimFlow (unkeyed host)", () => {
  it("a stale claim completion after a principal change publishes nothing; the new principal's own flow works", async () => {
    const a = makePlatform();
    const b = makePlatform();
    let submitA: FlowSubmit = () => {};
    let submitB: FlowSubmit = () => {};
    function FlowHost({ platform, scope }: { platform: ProfileEditorPlatform; scope: string }) {
      const flow = useDirectoryClaimFlow(platform, scope);
      if (scope === "user:a") submitA = flow.submitClaim; else submitB = flow.submitClaim;
      return <span data-testid="flow">{flow.state.phase}{flow.state.phase === "submitted" ? `:${flow.state.claim.id}` : ""}</span>;
    }
    mount(<FlowHost platform={a.platform} scope="user:a" />);
    act(() => { submitA({ claim_type: "person", person_id: 7, evidence_note: "A's evidence" }); });
    expect(textOf("flow")).toBe("submitting");

    // Principal switch mid-command: the submitting feedback is masked.
    act(() => { root!.render(<FlowHost platform={b.platform} scope="user:b" />); });
    expect(textOf("flow")).toBe("idle");

    // A's claim ACCEPTS on the server — its completion must never publish B.
    await act(async () => { a.gates.submitClaim[0].resolve({ claim: claim(501, "pending"), note: "A filed" }); });
    expect(textOf("flow")).toBe("idle");

    // B files its OWN claim and the flow works normally.
    act(() => { submitB({ claim_type: "person", person_id: 9, evidence_note: "B's evidence" }); });
    expect(textOf("flow")).toBe("submitting");
    await act(async () => { b.gates.submitClaim[0].resolve({ claim: claim(901, "pending"), note: "B filed" }); });
    expect(textOf("flow")).toBe("submitted:901");
  });

  it("reset() cannot disguise a pending server write as idle or unlock a duplicate submission", async () => {
    const a = makePlatform();
    let submit: FlowSubmit = () => {};
    let reset: () => void = () => {};
    function FlowHost() {
      const flow = useDirectoryClaimFlow(a.platform, "user:a");
      submit = flow.submitClaim; reset = flow.reset;
      return <span data-testid="flow">{flow.state.phase}</span>;
    }
    mount(<FlowHost />);
    act(() => { submit({ claim_type: "person", person_id: 7, evidence_note: "evidence" }); });
    expect(textOf("flow")).toBe("submitting");
    act(() => { reset(); });
    expect(textOf("flow")).toBe("submitting");
    act(() => { submit({ claim_type: "person", person_id: 7, evidence_note: "duplicate" }); });
    expect(a.gates.submitClaim).toHaveLength(1);
    await act(async () => { a.gates.submitClaim[0].resolve({ claim: claim(501, "pending"), note: "late" }); });
    expect(textOf("flow")).toBe("submitted");
    act(() => { reset(); });
    expect(textOf("flow")).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// C. The profile editor controller through the real hook
// ---------------------------------------------------------------------------

describe("R108-04 C. editor: a stale submit completion cannot clear a newer draft", () => {
  async function editorWorld() {
    const a = makePlatform();
    let api: ReturnType<typeof useProfileEditorController> | null = null;
    function EditorHost() {
      api = useProfileEditorController(7, a.platform, "user:a");
      return <span data-testid="editor">{api.state.phase}:{api.state.phase === "saving" || api.state.phase === "saved" || api.state.phase === "conflict" || api.state.phase === "ready" ? api.state.draft.city : ""}</span>;
    }
    mount(<EditorHost />);
    await act(async () => { a.gates.managedProfile[0].resolve(profileView(3, { city: "Karaj" })); });
    return { a, getApi: () => api! };
  }

  it("SUCCESS path: edits typed while the command was in flight survive the authoritative reload", async () => {
    const { a, getApi } = await editorWorld();
    expect(textOf("editor")).toBe("ready:Karaj");

    // The representative edits the city and submits; while the command is in
    // flight they type AGAIN (the newest draft).
    await act(async () => { getApi().updateDraft((d) => ({ ...d, city: "Qazvin" })); });
    act(() => { void getApi().submit(); });
    expect(textOf("editor")).toBe("saving:Qazvin");
    await act(async () => { getApi().updateDraft((d) => ({ ...d, city: "Tabriz-typed-during-save" })); });
    expect(a.calls.upsertProfile).toHaveLength(1);
    expect(a.calls.upsertProfile[0].submission.city).toBe("Qazvin"); // the SUBMITTED value is the one captured at submit

    // The save lands; the controller reloads the authoritative view.
    await act(async () => { a.gates.upsertProfile[0].resolve({ profile: { row_version: 4 }, publication: "published" }); });
    await act(async () => { a.gates.managedProfile[1].resolve(profileView(4, { city: "Qazvin" })); });
    // The NEWER draft is retained (never clobbered by the submit-time
    // snapshot), and the authoritative row_version was adopted.
    expect(textOf("editor")).toBe("saved:Tabriz-typed-during-save");
    const saved = getApi();
    expect(saved.state.phase).toBe("saved");
    if (saved.state.phase === "saved") {
      expect(saved.state.stored?.row_version).toBe(4);
      expect(saved.state.draft.city).toBe("Tabriz-typed-during-save");
    }
  });

  it("CONFLICT path (409): during-flight edits are carried into the reconciliation view", async () => {
    const { a, getApi } = await editorWorld();
    await act(async () => { getApi().updateDraft((d) => ({ ...d, city: "Qazvin" })); });
    act(() => { void getApi().submit(); });
    await act(async () => { getApi().updateDraft((d) => ({ ...d, city: "Tabriz-typed-during-save" })); });

    // The server refuses with 409 — another representative saved first.
    await act(async () => { a.gates.upsertProfile[0].reject(new PlatformClientError(409, "profile_conflict", "The profile changed; reconcile field by field.")); });
    await act(async () => { a.gates.managedProfile[1].resolve(profileView(9, { city: "Server-changed" })); });

    const conflicted = getApi();
    expect(conflicted.state.phase).toBe("conflict");
    if (conflicted.state.phase === "conflict") {
      expect(conflicted.state.draft.city).toBe("Tabriz-typed-during-save"); // retained, not clobbered
      expect(conflicted.state.current.row_version).toBe(9);
      expect(conflicted.state.differences.some((d) => d.field === "city")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D. A to B to A on the editor: the old controller is disposed, never revived
// ---------------------------------------------------------------------------

describe("R108-04 D. editor principal isolation (unkeyed host)", () => {
  it("a late load from the earlier principal's controller publishes nothing; returning mounts a FRESH controller", async () => {
    const a1 = makePlatform();
    const b = makePlatform();
    const a2 = makePlatform();
    mount(<ClaimsHost platform={a1.platform} scope="user:a" personId={7} />);

    // A's editor is loading; the principal switches to B before it lands.
    act(() => { root!.render(<ClaimsHost platform={b.platform} scope="user:b" personId={7} />); });
    expect(lastProbe().editorPhase).toBe("loading");

    // A's LATE load resolves — it must publish nothing (controller disposed).
    await act(async () => { a1.gates.managedProfile[0].resolve(profileView(1, { city: "A-city" })); });
    expect(probesFor("user:b").every((p) => p.editorCity !== "A-city")).toBe(true);

    // B's editor loads normally.
    await act(async () => { b.gates.managedProfile[0].resolve(profileView(2, { city: "B-city" })); });
    expect(lastProbe().editorPhase).toBe("ready");
    expect(lastProbe().editorCity).toBe("B-city");

    // Back to A: a FRESH controller mounts and loads (call #1 on a2).
    act(() => { root!.render(<ClaimsHost platform={a2.platform} scope="user:a" personId={7} />); });
    expect(lastProbe().editorPhase).toBe("loading"); // masked, no B-city, no stale A cache
    await act(async () => { a2.gates.managedProfile[0].resolve(profileView(5, { city: "A-city-fresh" })); });
    expect(lastProbe().editorCity).toBe("A-city-fresh");
    // The FIRST A controller (a1) is dead: even another late resolution
    // changes nothing on screen.
    await act(async () => { a1.gates.managedProfile[0].resolve(profileView(99, { city: "A-city-STALE" })); });
    expect(textOf("editor")).toBe("ready:A-city-fresh");
  });
});

// ---------------------------------------------------------------------------
// E. Source locks: every host editor passes the shared cases
// ---------------------------------------------------------------------------

describe("R108-04 E. all five host editors pass the shared cases (source locks)", () => {
  const read = (relative: string): string => readFileSync(join(__dirname, "../..", relative), "utf8");

  it("Retro Astra wires the principal scope into the controllers, claims list and claim flow", () => {
    const profile = read("src/web/frontends/retro-astra/ProfileEditor.tsx");
    expect(profile).toContain("useProfileEditorController(personId, platform, scope)");
    expect(profile).toMatch(/<DirectoryClaimPanel[^>]+kind="person"[^>]+targetId=\{personId\}[^>]+platform=\{platform\}[^>]+scope=\{scope\}/);
    const organization = read("src/web/frontends/retro-astra/OrganizationEditor.tsx");
    expect(organization).toContain("useOrganizationEditorController(organizationId, platform, scope)");
    expect(organization).toMatch(/<DirectoryClaimPanel[^>]+kind="organization"[^>]+targetId=\{organizationId\}[^>]+platform=\{platform\}[^>]+scope=\{scope\}/);
    // R113 keeps representation independent of edit permission. Follow the
    // real native child: scope + entity identity reaches BOTH shared hooks.
    const representation = read("src/web/frontends/retro-astra/DirectoryClaimPanel.tsx");
    expect(representation).toContain('const identity = `${scope}|${kind}:${targetId}`');
    expect(representation).toContain("useMyDirectoryClaims(signedIn ? platform : null, identity)");
    expect(representation).toContain("useDirectoryClaimFlow(signedIn ? platform : null, identity)");
    expect(representation).toContain("useScopedState(identity, '')");
    // The host now enters the native workspace, which computes the runtime
    // principal and passes that scope into both actual editor instances.
    const entry = read("src/web/frontends/retro-astra/entry.tsx");
    expect(entry).toMatch(/<RetroAstraDonorTransplant\s+runtime=\{runtime\}/);
    const workspace = read("src/web/frontends/retro-astra/transplant/App.tsx");
    expect(workspace).toContain("usePrincipalScope(runtime.user, runtime.permissions)");
    expect(workspace).toMatch(/<RetroAstraProfileEditor[^>]+scope=\{scope\}/);
    expect(workspace).toMatch(/<RetroAstraOrganizationEditor[^>]+scope=\{scope\}/);
  });

  it("EquiData Elite and FEI Classic compute usePrincipalScope and key every claims surface on it", () => {
    for (const skin of ["equidata-elite", "fei-classic"]) {
      const profile = read(`src/web/frontends/${skin}/ProfileEditor.tsx`);
      expect(profile).toContain("usePrincipalScope(user, null)");
      expect(profile).toContain("useProfileEditorController(personId, platform, principalScope)");
      // R112 keeps claims in a keyed native child. Both the remount boundary
      // and that child's headless hooks must still follow the current user.
      expect(profile).toContain('<ProfileClaims key={`${scope}:${selectedId ?? "none"}`}');
      expect(profile).toMatch(/<ProfileClaims[^>]+user=\{user\}/);
      const claims = profile.slice(profile.indexOf("function ProfileClaims("));
      expect(claims).toContain("const scope = usePrincipalScope(user, null)");
      expect(claims).toContain("useMyDirectoryClaims(platform, scope)");
      expect(claims).toContain("useDirectoryClaimFlow(platform, scope)");
      const organization = read(`src/web/frontends/${skin}/OrganizationEditor.tsx`);
      expect(organization).toContain('<ManagedOrganization key={`${scope}:${selectedId}`}');
      expect(organization).toMatch(/<ManagedOrganization[^>]+user=\{user\}/);
      const managedOrganization = organization.slice(organization.indexOf("function ManagedOrganization("));
      expect(managedOrganization).toContain("const scope = usePrincipalScope(user, null)");
      expect(managedOrganization).toContain("useOrganizationEditorController(organizationId, platform, scope)");
    }
  });

  it("Core (heritage) hosts the editors inside the principal-keyed content container", () => {
    const main = read("src/web/main.tsx");
    expect(main).toContain('key={principalScope} className="h102-content"');
    // The workbenches themselves are remounted by that key on every
    // principal change (the documented heritage pattern).
    const workbench = read("src/web/heritage/ProfileWorkbench.tsx");
    expect(workbench).toContain("useProfileEditorController(personId, platform)");
    expect(workbench).toContain("useMyDirectoryClaims(platform)");
  });

  it("standalone Classic renders claims statelessly per view and re-reads the session on host principal change", () => {
    const account = read("standalone-frontends/classic-v1.4/public/ui/views/account.js");
    // The claim list is fetched INSIDE the account view render (no cached
    // cross-principal state) through the platform transport.
    expect(account).toContain('api("/api/claims/mine")');
    const bridge = read("standalone-frontends/classic-v1.4/public/ui/hostBridge.js");
    // R107 NEXT-05: a host principal change forces the session (and every
    // derived view, including claims) to be re-read under the new principal.
    expect(bridge).toContain("horse-db-classic-session");
    expect(bridge).toContain("handlers.session()");
  });
});
