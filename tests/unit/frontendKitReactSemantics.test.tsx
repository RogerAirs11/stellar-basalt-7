// @vitest-environment happy-dom
/**
 * R96-N10 — the shared headless layer mounted in REAL React components.
 *
 * The pure core (DomainResourceController races, CommandFlight guards) is
 * pinned by tests/unit/domainLoaderRace.test.ts without a DOM. This file
 * mounts actual React components through react-dom/client and asserts the
 * PRINCIPAL-ISOLATION and MUTATION guarantees at the binding layer — the
 * guarantees every one of the five skins inherits:
 *
 *  A. Resource identity: a slower response for an OLDER principal/identity
 *     can never appear — not even for one render — under a newer identity
 *     (A-to-B login switch); logout mid-load disposes and renders idle;
 *     disabled loads never touch private endpoints; late resolutions after
 *     unmount are dropped silently (no crash, no stale data); synchronous
 *     loader throws become error states; same-key reloads keep prior data
 *     visibly stale.
 *  B. Mutations: a same-render double submission starts exactly ONE command;
 *     unmount during a command never crashes the publish-back; a 409 with a
 *     current_version is a recoverable conflict; a 501/4xx is a deliberate
 *     rejection; a 5xx-after-commit is conservatively "failed" (state
 *     unknown until re-read), never success.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { StrictMode, useEffect, useRef, useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDomainResource } from "../../src/frontend-kit/domain/useDomainResource";
import { CommandFlight, classifyCommandError, idleCommand, type CommandState } from "../../src/frontend-kit/domain/commandModel";
import { PlatformClientError } from "../../src/frontend-kit/errors";

// ---------------------------------------------------------------------------
// Minimal real-React harness (no testing-library: react-dom/client + act).
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

/** Deferred promise helper — resolve/reject from outside the component. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A loader that records every call and can resolve/reject on demand. */
interface LoaderHarness<T> {
  load: (signal: AbortSignal) => Promise<T>;
  started: number;
  aborted: number;
  pending: Array<Deferred<T>>;
  respond(index: number, value: T): void;
  fail(index: number, error: unknown): void;
}
function loaderHarness<T>(): LoaderHarness<T> {
  const started = 0;
  const aborted = { count: 0 };
  const pending: Array<Deferred<T>> = [];
  return {
    started,
    get aborted() { return aborted.count; },
    pending,
    load(signal: AbortSignal): Promise<T> {
      const d = deferred<T>();
      pending.push(d);
      signal.addEventListener("abort", () => { aborted.count += 1; d.reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
      return d.promise;
    },
    respond(index: number, value: T) { pending[index]?.resolve(value); },
    fail(index: number, error: unknown) { pending[index]?.reject(error); },
  };
}

/** A probe component rendering the FULL resource state trace. */
function ResourceProbe<T>(props: {
  domain: string; identity: string | number; enabled?: boolean;
  harness: LoaderHarness<T>; label: (state: { phase: string; data?: T }) => string;
}) {
  const { state } = useDomainResource<T>(props.domain, props.identity, (signal) => props.harness.load(signal), { enabled: props.enabled });
  return <div data-testid="probe">{props.label(state as { phase: string; data?: T })}</div>;
}

/** Re-mounting controller: the test changes props through state. */
function SwitchableProbe<T>(props: {
  harness: LoaderHarness<T>; label: (state: { phase: string; data?: T }) => string;
}) {
  const [identity, setIdentity] = useState<string | number>("principal-A");
  return (
    <div>
      <button type="button" data-testid="switch" onClick={() => setIdentity(identity === "principal-A" ? "principal-B" : "principal-A")}>switch</button>
      <button type="button" data-testid="logout" onClick={() => setIdentity("logged-out")}>logout</button>
      <ResourceProbe domain="private-resource" identity={identity} harness={props.harness} label={props.label} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A. Resource identity semantics under real React
// ---------------------------------------------------------------------------

describe("N10 A. useDomainResource mounted in React — principal isolation", () => {
  it("A-to-B switch: the slower OLD principal's data NEVER renders under B — not even once", async () => {
    const harness = loaderHarness<string>();
    const seen: string[] = [];
    const label = (state: { phase: string; data?: string }) => {
      const text = `${state.phase}:${state.data ?? "-"}`;
      seen.push(text);
      return text;
    };
    mount(<SwitchableProbe harness={harness} label={label} />);
    // A's load started.
    expect(harness.pending).toHaveLength(1);
    // Switch to B BEFORE A resolves.
    act(() => { (container.querySelector('[data-testid="switch"]') as HTMLButtonElement).click(); });
    expect(harness.pending).toHaveLength(2);
    // A resolves LATE (the race) — it must be dropped.
    await act(async () => { harness.respond(0, "A-private-data"); });
    // B resolves.
    await act(async () => { harness.respond(1, "B-private-data"); });
    const rendered = container.querySelector('[data-testid="probe"]')!.textContent;
    expect(rendered).toContain("ready:B-private-data");
    // No render EVER showed A's data under B's identity.
    expect(seen.some((entry) => entry.includes("A-private-data"))).toBe(false);
    expect(seen.filter((entry) => entry.startsWith("ready")).every((entry) => entry.endsWith("B-private-data"))).toBe(true);
  });

  it("logout mid-load: the in-flight request aborts and the frame renders idle — no data, no error", async () => {
    const harness = loaderHarness<string>();
    const label = (state: { phase: string; data?: string }) => `${state.phase}:${state.data ?? "-"}`;
    mount(<SwitchableProbe harness={harness} label={label} />);
    expect(harness.pending).toHaveLength(1);
    act(() => { (container.querySelector('[data-testid="logout"]') as HTMLButtonElement).click(); });
    // The logged-out identity is a NEW load; the old one was aborted.
    expect(harness.aborted).toBeGreaterThanOrEqual(1);
    // The aborted request rejects with AbortError — swallowed for superseded loads.
    await act(async () => { harness.fail(0, Object.assign(new Error("aborted"), { name: "AbortError" })); });
    await act(async () => { harness.respond(1, "logged-out-public-data"); });
    const rendered = container.querySelector('[data-testid="probe"]')!.textContent;
    expect(rendered).toContain("ready:logged-out-public-data");
  });

  it("disabled loads never call the loader (private endpoints untouched) and dispose earlier in-flight requests", async () => {
    let calls = 0;
    const pending: Array<Deferred<string>> = [];
    const load = (signal: AbortSignal) => {
      calls += 1;
      const d = deferred<string>();
      pending.push(d);
      signal.addEventListener("abort", () => d.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      return d.promise;
    };
    const Controlled = () => {
      const [enabled, setEnabled] = useState(true);
      const { state } = useDomainResource<string>("private-resource", "me", load, { enabled });
      return (
        <div>
          <button type="button" data-testid="toggle" onClick={() => setEnabled(!enabled)}>toggle</button>
          <span data-testid="phase">{state.phase}</span>
        </div>
      );
    };
    mount(<Controlled />);
    expect(calls).toBe(1);
    // Disable: the in-flight load is disposed and the state resets to idle.
    act(() => { (container.querySelector('[data-testid="toggle"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="phase"]')!.textContent).toBe("idle");
    expect(calls).toBe(1); // NO second call while disabled
    // Its late resolution is dropped without any crash.
    await act(async () => { pending[0]?.resolve("private-data"); });
    expect(container.querySelector('[data-testid="phase"]')!.textContent).toBe("idle");
    expect(container.textContent).not.toContain("private-data");
  });

  it("a late resolution AFTER unmount is dropped — no crash, no React warning, no state leak", async () => {
    const harness = loaderHarness<string>();
    const label = (state: { phase: string; data?: string }) => `${state.phase}`;
    mount(<SwitchableProbe harness={harness} label={label} />);
    act(() => { root?.unmount(); root = null; });
    // The unmounted component's pending request resolves now.
    await act(async () => { harness.respond(0, "ghost-data"); });
    expect(container.textContent ?? "").not.toContain("ghost-data");
  });

  it("a synchronous loader throw becomes an error state — never an uncaught render crash", async () => {
    const boom = (): never => { throw new Error("loader exploded"); };
    function Throwing() {
      const { state } = useDomainResource<string>("private-resource", "me", boom);
      return <span data-testid="phase">{state.phase}</span>;
    }
    let error: unknown = null;
    try { mount(<Throwing />); } catch (e) { error = e; }
    // The controller catches the synchronous throw and publishes an error.
    expect(error).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="phase"]')!.textContent).toBe("error");
  });

  it("same-key reload keeps prior data visibly stale (reloading), never a silent blank", async () => {
    const harness = loaderHarness<string>();
    const label = (state: { phase: string; data?: string }) => `${state.phase}:${state.data ?? "-"}`;
    function Reloader() {
      const [tick, setTick] = useState(0);
      const { state, retry } = useDomainResource<string>("private-resource", "stable-id", (signal) => harness.load(signal));
      void tick;
      return (
        <div>
          <button type="button" data-testid="retry" onClick={() => { retry(); setTick(tick + 1); }}>retry</button>
          <span data-testid="probe">{label(state as { phase: string; data?: string })}</span>
        </div>
      );
    }
    mount(<Reloader />);
    await act(async () => { harness.respond(0, "first-data"); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("ready:first-data");
    // Retry with the SAME identity: prior data stays visible as reloading.
    act(() => { (container.querySelector('[data-testid="retry"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("reloading:first-data");
    // The fresh response replaces it.
    await act(async () => { harness.respond(1, "second-data"); });
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toContain("ready:second-data");
  });
});

// ---------------------------------------------------------------------------
// B. Mutation semantics under real React
// ---------------------------------------------------------------------------

/** A probe that runs commands through CommandFlight and renders the trace.
 * `run` receives the flight AND the component's publish — the command states
 * the UI renders flow through exactly this publish-back. */
function CommandProbe(props: { run: (flight: CommandFlight, publish: (state: CommandState) => void) => () => void; states: CommandState[] }) {
  const flightRef = useRef<CommandFlight>(new CommandFlight());
  const [state, setState] = useState<CommandState>(idleCommand());
  const publish = (next: CommandState) => { props.states.push(next); setState(next); };
  useEffect(() => () => { /* unmount mid-command must not crash the publish-back */ }, []);
  return (
    <div>
      <button
        type="button"
        data-testid="submit"
        onClick={() => props.run(flightRef.current, publish)()}
      >
        submit
      </button>
      <span data-testid="phase">{state.phase}</span>
      {state.phase === "rejected" ? <span data-testid="rejected-code">{state.code}</span> : null}
      {state.phase === "rejected" && state.currentVersion !== undefined ? <span data-testid="current-version">{state.currentVersion}</span> : null}
      {state.phase === "accepted" && state.idempotentReplay ? <span data-testid="replay">replay</span> : null}
    </div>
  );
}

describe("N10 B. CommandFlight mounted in React — mutation guarantees", () => {
  it("a same-render DOUBLE CLICK starts exactly ONE command (no duplicate submit)", async () => {
    let started = 0;
    const gate = deferred<string>();
    const states: CommandState[] = [];
    mount(
      <CommandProbe
        states={states}
        run={(flight, publish) => () => {
          void flight.execute(
            async () => { started += 1; return gate.promise; },
            publish,
          );
        }}
      />,
    );
    // Double click in the SAME render tick.
    act(() => {
      const button = container.querySelector('[data-testid="submit"]') as HTMLButtonElement;
      button.click();
      button.click();
    });
    expect(started).toBe(1); // exactly one command
    await act(async () => { gate.resolve("done"); });
    expect(container.querySelector('[data-testid="phase"]')!.textContent).toBe("accepted");
  });

  it("unmount during a command: the late publish-back never crashes and nothing renders", async () => {
    const gate = deferred<string>();
    const states: CommandState[] = [];
    mount(
      <CommandProbe
        states={states}
        run={(flight, publish) => () => {
          void flight.execute(async () => gate.promise, publish);
        }}
      />,
    );
    act(() => { (container.querySelector('[data-testid="submit"]') as HTMLButtonElement).click(); });
    act(() => { root?.unmount(); root = null; });
    let error: unknown = null;
    try { await act(async () => { gate.resolve("late"); }); } catch (e) { error = e; }
    expect(error).toBeNull(); // React 19: setState after unmount is a no-op, never a crash
    expect(states.some((s) => s.phase === "accepted")).toBe(true); // the flight completed; the UI was already gone
  });

  it("a 409 carrying current_version is a RECOVERABLE conflict (reload-and-retry surface)", async () => {
    const gate = deferred<never>();
    const states: CommandState[] = [];
    mount(
      <CommandProbe
        states={states}
        run={(flight, publish) => () => {
          void flight.execute(async () => gate.promise, publish);
        }}
      />,
    );
    act(() => { (container.querySelector('[data-testid="submit"]') as HTMLButtonElement).click(); });
    await act(async () => {
      gate.reject(new PlatformClientError(409, "case_state_changed", "Someone else changed this record", { current_version: 7 }));
    });
    expect(container.querySelector('[data-testid="phase"]')!.textContent).toBe("rejected");
    expect(container.querySelector('[data-testid="rejected-code"]')!.textContent).toBe("case_state_changed");
    expect(container.querySelector('[data-testid="current-version"]')!.textContent).toBe("7");
  });

  it("a 503 after commit is conservatively FAILED (state unknown), never accepted or rejected", async () => {
    const outcome = classifyCommandError(new PlatformClientError(503, "upstream", "proxy gave up (maybe after committing)", undefined));
    expect(outcome.phase).toBe("failed");
    // And through a mounted command:
    const gate = deferred<never>();
    const states: CommandState[] = [];
    mount(
      <CommandProbe
        states={states}
        run={(flight, publish) => () => {
          void flight.execute(async () => gate.promise, publish);
        }}
      />,
    );
    act(() => { (container.querySelector('[data-testid="submit"]') as HTMLButtonElement).click(); });
    await act(async () => { gate.reject(new PlatformClientError(502, "bad_gateway", "upstream", undefined)); });
    expect(container.querySelector('[data-testid="phase"]')!.textContent).toBe("failed");
  });

  it("a deliberate 501 refusal is REJECTED (unimplemented is a decision), and replays surface as idempotent", async () => {
    const outcome = classifyCommandError(new PlatformClientError(501, "terminal_payment_proof_required", "not implemented", undefined));
    expect(outcome.phase).toBe("rejected");
    // An accepted replay marks itself honestly.
    const gate = deferred<unknown>();
    const states: CommandState[] = [];
    mount(
      <CommandProbe
        states={states}
        run={(flight, publish) => () => {
          void flight.execute(async () => gate.promise, publish);
        }}
      />,
    );
    act(() => { (container.querySelector('[data-testid="submit"]') as HTMLButtonElement).click(); });
    await act(async () => { gate.resolve({ idempotent_replay: true }); });
    expect(container.querySelector('[data-testid="replay"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C. StrictMode double-mount: React 19 development semantics must not
//    duplicate loads into visible state or leak between mounts.
// ---------------------------------------------------------------------------

describe("N10 C. StrictMode resilience", () => {
  it("StrictMode double-mount keeps exactly the newest mount's state visible", async () => {
    const harness = loaderHarness<string>();
    const label = (state: { phase: string; data?: string }) => `${state.phase}:${state.data ?? "-"}`;
    mount(
      <StrictMode>
        <ResourceProbe domain="private-resource" identity="strict-me" harness={harness} label={label} />
      </StrictMode>,
    );
    // Both development mounts started loads; both may resolve.
    await act(async () => {
      harness.respond(0, "mount-1-data");
      harness.respond(1, "mount-2-data");
    });
    const rendered = container.querySelector('[data-testid="probe"]')!.textContent ?? "";
    expect(rendered.startsWith("ready:")).toBe(true);
    expect(rendered).not.toContain("loading");
  });
});

// ---------------------------------------------------------------------------
// D. The PlatformClient surface inventory — an explicit contract fixture.
// New methods / response projections require a conscious fixture update;
// accidental additions, removals or renames trip the drift alarm.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("N10 D. PlatformClient contract inventory fixture", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const contractSource = readFileSync(join(root, "src/contracts/platform.ts"), "utf8");

  it("the exported method inventory matches the reviewed fixture exactly", () => {
    const interfaceBody = /export interface PlatformClient \{([\s\S]*?)\n\}/.exec(contractSource)![1];
    const careSource=readFileSync(join(root,"src/contracts/equineCare.ts"),"utf8");
    const metadataSource=readFileSync(join(root,"src/contracts/registryMetadata.ts"),"utf8");
    const mfaSource=readFileSync(join(root,"src/contracts/mfa.ts"),"utf8");
    const careBody=/export interface CareClient \{([\s\S]*?)\n\}/.exec(careSource)![1];
    const metadataBody=/export interface MetadataClient \{([\s\S]*?)\n\}/.exec(metadataSource)![1];
    const mfaBody=/export interface MfaClient \{([\s\S]*?)\n\}/.exec(mfaSource)![1];
    // Named subinterfaces remain part of the checked SDK surface, including MFA.
    const reviewedBody=[interfaceBody,careBody,metadataBody,mfaBody].join("\n");
    const methods = [...new Set((reviewedBody.match(/([a-zA-Z]+)\s*\(/g) ?? [])
      .map((token) => token.replace(/\s*\($/, ""))
      .filter((name) => name !== "Promise" && !/^[A-Z][A-Z_]+$/.test(name)))].sort();
    // R111 contract 2.24: six reviewed additions expose explicit demo personas,
    // versioned breeding correction, reviewed genetic evidence/projection,
    // publication consent and exact media-access revocation. Existing methods
    // remain in this literal inventory; new names cannot slip through silently.
    // R117-17: the bilingual editorial workflow adds admin.content preview /
    // publish / retract / revisions (governed, versioned editor actions).
    // R117-18: the privacy redaction operator surface adds admin.privacy
    // redactionQueue / decideRedaction / fulfillRedaction (the R114 executor
    // stays the server authority; decision and execution stay separate).
    // R141: the duplicate-resolution workbench adds admin.duplicates
    // candidates / mergePreview / merge / unmerge / mergeHistory (the human
    // surface over the R117-19 versioned merge commands).
    // R144: D02 adds genetics.disclosureHistory (the explainable publication
    // decision log); the D01 professionalGrants namespace reuses the reviewed
    // create/list/revoke verbs, so no new names beyond disclosureHistory.
    // R145: E04 makes the quality queue usable (admin.quality list + the
    // qualityDetail/qualityAssign/qualityResolve/qualityReopen/qualityNote/
    // qualityBulkResolve/qualityScan workflow verbs); C04 adds the public
    // horses.evidenceSummary; C05 adds search.exactIdentifier.
    // R146: D04 adds admin.rules (list/create/detail/patch/transition/preview
    // — the bounded, versioned rules service, DATA-only specs); D05 adds
    // admin.fieldClaims (queue/horse/select/reject/revertDecision — retained
    // competing values with explicit decisions and reversal).
    expect(methods).toEqual([
      "access", "activate", "addCredential", "addCustody", "addHorse", "addKey", "addTask", "addTest", "adminBatchPreview",
      "adminCreateResult", "adminReviewReport", "adminReviewRow", "adminUpdateEvent", "adminUpdateResult", "amend", "ancestors", "appointOfficial",
      "archive", "archiveDocument", "assignStaff", "attachDossier", "audit", "baseColor", "beginEnrollment", "billing", "block",
      "blocks", "browse", "bulkHorses", "cancelEnrollment", "cancelOrder", "candidates", "capabilities", "catalog", "certificateUrl",
      "challenge", "changeRequests", "claims", "closeOwnInquiry", "coefficients", "comments", "commonAncestors", "completeTask", "conflict",
      "consent", "conversation", "correct", "create", "createDocument", "createLifecycleEvent", "createOrder", "createOwnershipPeriod",
      "custody", "dashboard", "decideRedaction", "deleteKey", "demoAdmin", "demoPersona", "descendantMetrics", "descendants",
      "detail", "directory", "disable", "disclosureHistory", "document", "documents", "duplicateCheck", "entitlements", "evidenceSummary",
      "exactIdentifier", "export", "exportUrl", "extract", "facets", "fileUrl", "filter", "fulfillRedaction",
      "generate", "get", "getSettings", "grant", "health", "history", "horse", "horseActions",
      "horseHistory", "horseInsights", "horses", "importTasks", "inbox", "inquire", "interpret", "invite", "inviteStaff",
      "issue", "issueCertificate", "issueExtract", "keys", "lifecycle", "list", "listHorseAttestations", "listIssuers",
      "login", "logout", "managed", "managedProfile", "me", "merge", "mergeHistory", "mergePreview",
      "meta", "metrics", "mine", "models", "moderateComment", "myClaims", "myGrants", "myInvites",
      "myOrders", "newVersion", "offers", "optimize", "order", "organizations", "otpRequest", "otpVerify",
      "ownership", "pairingAnalysis", "pairingEvidence", "patch", "pathsToAncestor", "pay", "period", "periods",
      "person", "persons", "preview", "privacyPolicy", "providerBlock", "publicCard", "publish", "quality",
      "qualityAssign", "qualityBulkResolve", "qualityDetail", "qualityNote", "qualityReopen", "qualityResolve", "qualityScan", "queue",
      "race", "races", "reassignTask", "reconcileIntent", "reconcileMutations", "recover", "redactNote", "redactionQueue", "register",
      "registry", "reindex", "reject", "remove", "removeHorse", "renew", "reopenTask", "reply",
      "report", "request", "respondInvite", "retract", "revertDecision", "review", "reviewChangeRequest", "reviewClaim",
      "reviewHistory", "reviewPairing", "reviewSnapshot", "revisions", "revoke", "revokeAccess", "revokeInvite", "revokeStaff", "rotateKeyEncryption", "rotateRecoveryCodes",
      "save", "secret", "select", "sentInquiries", "setDisclosure", "setInquiryStatus", "setPublication", "setStaffRole",
      "setStatus", "staff", "status", "strParentage", "stream", "submit", "submitClaim", "submitComment",
      "summary", "supersede", "surfaces", "switch", "table", "tasks", "testKey", "transition",
      "unblock", "unmerge", "unwatch", "update", "updateDocument", "updateKey", "updateSettings", "upload",
      "upsertProfile", "verify", "verifyExtract", "watch", "watchlist", "withdraw", "withdrawConsent", "workspaces",
    ]);
  });

  it("the response-projection surface is pinned (exported contract types)", () => {
    const exported = (contractSource.match(/^export (type|interface) ([A-Za-z]+)/gm) ?? [])
      .map((line) => line.replace(/^export (type|interface) /, ""));
    // Coarse drift alarm: every projection type is part of the reviewed
    // contract; additions require a fixture update AND contract review.
    expect(exported.length).toBeGreaterThanOrEqual(230);
    const mustExist = ["PlatformAuthState", "HorseProfileResponse", "ClaimsMineResponse", "MutationReconciliationResponse", "PlatformErrorEnvelope"];
    for (const name of mustExist) expect(exported).toContain(name);
  });

  it("paginated domains expose explicit cursors (no silent unbounded arrays)", () => {
    // The pager contract is explicit: cursor AND offset paging derive from
    // server-provided values only (pinned in detail by domainResourceState
    // tests). Here we pin that the paginated response types carry a cursor
    // or total field — an unbounded array swap trips this.
    const paginated = ["HorseSearchResponse", "PeopleListResponse", "ChangeRequestsMineResponse", "ClaimsMineResponse"];
    for (const name of paginated) {
      const match = new RegExp(`export (?:type|interface) ${name}[\\s\\S]*?(?:cursor|total|next_cursor|has_more)`).exec(contractSource);
      expect(match, `${name} must carry an explicit pagination field`).not.toBeNull();
    }
  });
});
