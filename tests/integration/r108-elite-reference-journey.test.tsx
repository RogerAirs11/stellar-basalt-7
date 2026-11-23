// @vitest-environment happy-dom
/**
 * R108-09: the Elite directory/service REFERENCE journey — the current-revision
 * J2 equivalent — on REAL React (createRoot + act) mounting the REAL EquiData
 * Elite surfaces (EquiDataDirectoryPage + EquiDataDirectoryPersonPage +
 * EquiDataServiceRequestsPage), each principal with a REAL createPlatformClient
 * wired to the REAL Worker router over a REAL migrated database (all repository
 * migrations). No handler is called directly; every action is a real DOM
 * interaction, and every outcome is cross-checked against exact database
 * state.
 *
 * Rehearsed (the ticket's sequence):
 *   anonymous discovery (published only, contact mediated, withheld profile
 *   never fabricated) -> requester's consented create through the REAL
 *   composer with the DURABLE intent protocol -> LOST-RESPONSE RECOVERY: the
 *   server accepts the create but the response is dropped; the composer
 *   freezes honestly, a reload checks the SAME persisted key and confirms
 *   exactly ONE lead -> a true-offline attempt checks the server, then retries
 *   the SAME payload/key -> provider inbox (two real principals) with allowed
 *   transitions only and no contact disclosure -> provider CAS acknowledge ->
 *   a stale CAS version is an honest conflict with zero mutation -> the
 *   requester's post-logout state is an honest refusal.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Request as NodeRequest } from "undici";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import workerDefault from "../../src/worker";
import { createPlatformClient } from "../../src/frontend-kit/platformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { PlatformClient, PlatformUser, PlatformPermission } from "../../src/contracts/platform";
import { adaptRuntime, type EquiDataRuntime } from "../../src/web/frontends/equidata-elite/adapter";
import { EquiDataDirectoryPage, EquiDataDirectoryPersonPage } from "../../src/web/frontends/equidata-elite/DirectoryPage";
import { EquiDataServiceRequestsPage } from "../../src/web/frontends/equidata-elite/ServiceRequestsPage";
import { openRealDatabase, seedUser, makeSession, type AuthedSession } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const worker = workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> };
const ORIGIN = "https://registry.example";
const limiter = { limit: async () => ({ success: true }) };

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", SESSION_COOKIE_NAME: "hr_session",
    DB: db, ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter, EXPENSIVE_RATE_LIMITER: limiter,
    WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  } as unknown as Env;
}

type DropMode = "response" | "request" | null;
/**
 * A real browser tab. The drop switch simulates the two honest uncertain-write
 * shapes: "response" — the request reaches the server and is processed, but
 * the CLIENT promise rejects (the dropped connection); "request" — the request
 * never leaves the device (true offline). Exactly one drop fires.
 */
function makeTab(db: D1Database, session: AuthedSession, user: PlatformUser, drop: () => DropMode = () => null) {
  const creates: Array<{ key: string | null; body: unknown }> = [];
  const reconciledKeys: string[] = [];
  const statusWrites: Array<{ id: number; status: string; expected_version: number }> = [];
  const client = createPlatformClient({
    transport: async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      headers.set("origin", ORIGIN);
      headers.set("cookie", session.cookie);
      if (url.startsWith("/api/service-requests/intents/")) reconciledKeys.push(decodeURIComponent(url.split("/").at(-1)!));
      const status = url.match(/^\/api\/service-requests\/(\d+)\/status$/);
      if (status && init?.method === "POST") statusWrites.push({ id: Number(status[1]), ...JSON.parse(String(init.body)) });
      if (url === "/api/service-requests" && (init?.method as string) === "POST") {
        creates.push({ key: headers.get("idempotency-key"), body: JSON.parse(String(init?.body)) });
        const mode = drop();
        if (mode === "request") throw new Error("simulated offline: the request never left the device");
        if (mode === "response") {
          await worker.fetch(new NodeRequest(`${ORIGIN}${url}`, { method: "POST", headers: headers as unknown as Record<string, string>, body: init?.body as string | undefined }) as unknown as Request, makeEnv(db));
          throw new Error("simulated connection drop: the response was lost");
        }
      }
      const response = await worker.fetch(new NodeRequest(`${ORIGIN}${url}`, { method: (init?.method as string) ?? "GET", headers: headers as unknown as Record<string, string>, body: init?.body as string | undefined }) as unknown as Request, makeEnv(db));
      const data = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
      if (!response.ok) throw new PlatformClientError(response.status, data?.error?.code ?? "invalid_error_response", data?.error?.message ?? "Request failed", data?.error?.details);
      return data as T;
    },
    csrfToken: () => session.csrfToken,
  });
  return { client, user, creates, reconciledKeys, statusWrites };
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  localStorage.clear();
  // happy-dom does not implement the browser's native confirmation dialog.
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  act(() => { root?.unmount(); });
  root = null; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function mount(element: React.ReactElement): void {
  if (!root) root = createRoot(container);
  act(() => { root!.render(element); });
}

async function settle(ms = 30): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for: ${what}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

/** Poll the real database until a row satisfies the predicate. */
async function waitForDb<T>(query: () => Promise<T | null>, predicate: (row: T) => boolean, what: string, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const row = await query();
    if (row != null && predicate(row)) return row;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for: ${what}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

const text = (): string => container.textContent ?? "";
const findButton = (label: RegExp | string): HTMLButtonElement => {
  const button = [...container.querySelectorAll("button")].find((b) => typeof label === "string" ? b.textContent?.includes(label) : label.test((b.textContent ?? "").trim()));
  if (!button) throw new Error(`button not found: ${String(label)}`);
  return button as HTMLButtonElement;
};
const setNativeValue = (el: HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement, value: string, event: "input" | "change") => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
};

function makeView(platform: PlatformClient, user: PlatformUser | null): EquiDataRuntime {
  return adaptRuntime({
    route: "/", navigate: () => {}, locale: "en", setLocale: () => {},
    user, permissions: (user ? ["horse.read", "person.read"] : []) as readonly PlatformPermission[],
    health: null, platformMeta: null, platform, assets: {} as never,
  });
}

/** The real native list uses a genuine detail route. Keep the page mounted when
 * following it, as entry.tsx does, so per-request locks survive navigation. */
function ServiceDesk({ platform, user }: { platform: PlatformClient; user: PlatformUser | null }) {
  const [route, setRoute] = useState("/f/equidata-elite/services");
  const id = route.match(/\/services\/(\d+)$/)?.[1];
  return <EquiDataServiceRequestsPage view={{ ...makeView(platform, user), route, navigate: setRoute }} requestId={id ? Number(id) : null} />;
}

describe("R108-09 Elite reference journey (real React, two real principals, real Worker, real DB)", () => {
  it("discovery -> withheld honesty -> consented create with a LOST-RESPONSE same-key retry -> provider inbox -> CAS transitions -> stale conflict -> post-logout refusal", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "req-1", "user");
    await seedUser(db, "prov-1", "user");
    await db.exec(`
      INSERT INTO people(id,name_latin) VALUES (1,'Published Trainer'),(2,'Withheld Farrier');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent,contact_preference,contact_value)
        VALUES (1,'["trainer"]',1,'platform_message','private@example.test');
      INSERT INTO directory_profiles(person_id,service_categories,publication_consent)
        VALUES (2,'["farrier"]',0);
      INSERT INTO user_person_links(user_id,person_id,status,verified_at) VALUES ('prov-1',1,'verified','2026-01-01 00:00:00');
    `);
    const requesterSession = await makeSession(db, "req-1");
    const providerSession = await makeSession(db, "prov-1");
    const requesterUser: PlatformUser = { id: "req-1", email: "req@example.test", display_name: "Journey Requester Person", role: "user", is_active: true } as PlatformUser;
    const providerUser: PlatformUser = { id: "prov-1", email: "prov@example.test", display_name: "Provider", role: "user", is_active: true } as PlatformUser;

    // The drop plan: the FIRST create loses its response (server processed);
    // the SECOND create never leaves the device (true offline).
    const drops: DropMode[] = ["response", "request"];
    const dropPlan = (): DropMode => drops.shift() ?? null;
    const requesterTab = makeTab(db, requesterSession, requesterUser, dropPlan);
    const providerTab = makeTab(db, providerSession, providerUser);

    // A. Anonymous discovery: published only; the withheld professional is
    //    never fabricated; contact is platform-mediated.
    mount(<EquiDataDirectoryPage view={makeView(requesterTab.client, null)} goLocal={() => {}} />);
    await waitFor(() => text().includes("Published Trainer"), "published provider visible");
    expect(text()).not.toContain("Withheld Farrier");
    expect(text()).not.toContain("private@example.test");
    expect(text()).toContain("mediated by the platform");

    // B. The requester signs in and opens the published professional.
    mount(<EquiDataDirectoryPersonPage view={makeView(requesterTab.client, requesterUser)} goLocal={() => {}} personId={1} />);
    await waitFor(() => text().includes("Published Trainer"), "provider profile visible");

    // C. Consented create through the REAL composer — the response is LOST
    //    (the server still processed it). In THIS session the composer freezes
    //    honestly; replay stays unavailable until the server was checked.
    act(() => setNativeValue(container.querySelector("textarea") as HTMLTextAreaElement, "R108-09 reference journey inquiry note", "input"));
    act(() => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); }); // consent
    act(() => { findButton(/^Send inquiry$/).click(); });
    await waitFor(() => text().includes("The previous attempt needs checking"), "the lost response froze the composer");
    expect(findButton(/^Send inquiry$/).disabled).toBe(true);
    expect(text()).not.toContain("Retry the same inquiry");
    // The server accepted the create — exactly one lead exists right now.
    let leads = await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>().then((r) => Number(r?.n));
    expect(leads).toBe(1);
    expect(requesterTab.creates).toHaveLength(1);
    expect(requesterTab.creates[0]!.key).toBeTruthy();

    // C2. The RELOAD stand-in: a fresh mount sweeps the durable submitted
    //     record and AUTO-RECONCILES with the server receipt — the honest
    //     R109 confirmed state (recorded, acceptance not guaranteed), still
    //     exactly one lead. No-duplicate is proven at the DB level below.
    act(() => { root?.unmount(); }); root = null;
    mount(<EquiDataDirectoryPersonPage view={makeView(requesterTab.client, requesterUser)} goLocal={() => {}} personId={1} />);
    await waitFor(() => text().includes("Inquiry recorded"), "reload-time auto-reconciliation confirmed the lost-response create");
    expect(text()).toContain("Provider acceptance and notification delivery are not guaranteed.");
    expect(requesterTab.reconciledKeys).toEqual([requesterTab.creates[0]!.key]);
    expect(requesterTab.creates).toHaveLength(1); // a confirmed receipt needs no repeated write
    leads = await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>().then((r) => Number(r?.n));
    expect(leads).toBe(1);

    // D. The never-delivered shape: a second inquiry goes offline BEFORE
    //    dispatch. An actual no-receipt server read enables the dedicated
    //    SAME-KEY retry; it lands the exact payload — two leads, no drift.
    act(() => setNativeValue(container.querySelector("textarea") as HTMLTextAreaElement, "R108-09 second inquiry after a true offline attempt", "input"));
    act(() => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    act(() => { findButton(/^Send inquiry$/).click(); });
    await waitFor(() => text().includes("The previous attempt needs checking"), "the offline attempt froze the composer");
    expect(requesterTab.creates).toHaveLength(2);
    expect(text()).not.toContain("Retry the same inquiry");
    act(() => { findButton("Check this request with the server").click(); });
    await waitFor(() => text().includes("Retry the same inquiry"), "the actual no-receipt read enabled exact replay");
    expect(requesterTab.reconciledKeys.at(-1)).toBe(requesterTab.creates[1]!.key);
    expect(requesterTab.creates[1]!.key).not.toBe(requesterTab.creates[0]!.key);
    act(() => { findButton("Retry the same inquiry").click(); });
    await waitFor(() => text().includes("Inquiry recorded"), "the same-key retry landed");
    expect(requesterTab.creates).toHaveLength(3);
    expect(requesterTab.creates[2]).toEqual(requesterTab.creates[1]);
    leads = await db.prepare("SELECT COUNT(*) AS n FROM service_requests").first<{ n: number }>().then((r) => Number(r?.n));
    expect(leads).toBe(2);
    const lead = (await db.prepare("SELECT id, row_version, status FROM service_requests ORDER BY id LIMIT 1").first<{ id: number; row_version: number; status: string }>())!;
    expect(lead.status).toBe("new");

    // E. The PROVIDER principal (second real tab): inbox shows the lead, the
    //    requester identity is NOT disclosed, and only allowed transitions appear.
    mount(<ServiceDesk platform={providerTab.client} user={providerUser} />);
    act(() => { findButton("Provider inbox").click(); });
    await waitFor(() => !!container.querySelector(`a[href="/f/equidata-elite/services/${lead.id}"]`), "provider inbox shows the actual lead link");
    expect(text()).not.toContain("req@example.test");
    act(() => container.querySelector<HTMLAnchorElement>(`a[href="/f/equidata-elite/services/${lead.id}"]`)!.click());
    await waitFor(() => text().includes("Acknowledge inquiry"), "provider detail and role-allowed actions loaded");
    expect(text()).toContain("Contact is not shared with this reader.");
    expect(text()).not.toContain("req@example.test");
    expect(text()).not.toContain("Journey Requester Person"); // the account identity is never disclosed without consent

    // F. Provider acknowledge (CAS): the allowed transition lands on THE FIRST
    //    lead and advances its version exactly once.
    const leadRow = container.querySelector("article.edx113-service-detail") as HTMLElement;
    expect(leadRow).toBeTruthy();
    expect(leadRow.textContent).toContain(`#${lead.id}`);
    expect(text()).not.toContain("Withdraw request");
    act(() => { findButton("Acknowledge inquiry").click(); });
    // The command lands and the list refreshes; the durable evidence is the
    // database state plus the reloaded row's new status (the transient
    // accepted notice is batched away with the refresh in the act environment).
    const afterAck = await waitForDb(
      () => db.prepare("SELECT row_version, status FROM service_requests WHERE id=?").bind(lead.id).first<{ row_version: number; status: string }>(),
      (row) => Number(row.row_version) === Number(lead.row_version) + 1 && row.status !== "new",
      "db transition");
    expect(afterAck.status).toBe("acknowledged");
    expect(providerTab.statusWrites).toEqual([{ id: lead.id, status: "acknowledged", expected_version: lead.row_version }]);
    await waitFor(() => text().includes("Acknowledged") && text().includes("Mark as discussing") && !findButton("Mark as discussing").disabled, "the reloaded detail shows the new status and permits the next transition");

    // G. Stale CAS: the row advances server-side, then a transition captured at
    //    the old version is an honest conflict with ZERO mutation.
    await db.prepare("UPDATE service_requests SET row_version=row_version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(lead.id).run();
    act(() => { findButton("Mark as discussing").click(); });
    // The recoverable-conflict panel: the honest refusal with the re-read affordance.
    await waitFor(() => text().includes("Reload this request"), "stale-version conflict surfaced honestly");
    expect(findButton("Mark as discussing").disabled).toBe(true);
    expect(findButton("I reviewed the current request").disabled).toBe(true);
    expect(providerTab.statusWrites.at(-1)).toEqual({ id: lead.id, status: "discussing", expected_version: afterAck.row_version });
    const afterStale = (await db.prepare("SELECT row_version, status FROM service_requests WHERE id=?").bind(lead.id).first<{ row_version: number; status: string }>())!;
    expect(Number(afterStale.row_version)).toBe(Number(afterAck.row_version) + 1); // only the server-side bump — the refused write changed nothing
    expect(afterStale.status).toBe(afterAck.status);
    // Recovery is an actual protected detail read followed by a separate
    // acknowledgement. It does not repeat the rejected status command.
    act(() => { findButton("Reload this request").click(); });
    await waitFor(() => !findButton("I reviewed the current request").disabled, "current detail reread permits explicit acknowledgement");
    expect(findButton("Mark as discussing").disabled).toBe(true);
    act(() => { findButton("I reviewed the current request").click(); });
    expect(findButton("Mark as discussing").disabled).toBe(false);
    expect(providerTab.statusWrites).toHaveLength(2);

    // H. Post-logout: the requester's session is gone; their next private read
    //    is an honest refusal, and the anonymous surface shows sign-in instead.
    await db.prepare("DELETE FROM sessions").run();
    let refused: unknown = null;
    try { await requesterTab.client.modules.serviceRequests.mine(); } catch (error) { refused = error; }
    expect((refused as { status?: number })?.status).toBe(401);
    mount(<ServiceDesk platform={requesterTab.client} user={null} />);
    await waitFor(() => text().includes("Sign in to view service requests"), "anonymous surface shows the honest sign-in panel");
    expect(container.querySelector(".edx113-service-detail")).toBeNull();
    expect(text()).not.toContain("R108-09 reference journey inquiry note");
  }, 60000);
});
