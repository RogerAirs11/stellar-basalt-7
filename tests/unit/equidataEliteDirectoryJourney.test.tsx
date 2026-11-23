// @vitest-environment happy-dom
/**
 * R107 NEXT-06-elite acceptance (master-AI R106 PLAN Slice D / BACKLOG
 * NEXT-06-elite): the native EquiData Elite directory → consented-service
 * journey mounted in REAL React components (react-dom/client + act, the same
 * harness pattern as frontendKitReactSemantics) against a scripted platform
 * client that projects the same shapes the canonical API projects.
 *
 * Acceptance coverage (client boundary — the J2 browser rehearsal over real
 * HTTP is tracked separately):
 *  - anonymous discovery shows only what the API projects (unpublished/
 *    unconsented never reach the page; no contact value is ever rendered);
 *  - honest empty state (an empty result is not "no professionals exist");
 *  - EN and FA both render natively;
 *  - explicit consent gates lead submission (disabled until accepted);
 *  - an uncertain failure retries the SAME idempotency key — a double
 *    submission never creates a second lead;
 *  - a stale CAS version surfaces as a recoverable 409 conflict with the
 *    current version and a re-read affordance;
 *  - withdrawal takes effect on the canonical re-read;
 *  - role-aware transitions only (requester cannot see provider transitions);
 *  - interactive rows/controls are real buttons (keyboard reachable).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PlatformClient, PlatformUser, ServiceRequestRecord, ServiceRequestStatus } from "../../src/contracts/platform";
import type { EquiDataRuntime } from "../../src/web/frontends/equidata-elite/adapter";
import { EquiDataDirectoryPage, EquiDataDirectoryPersonPage } from "../../src/web/frontends/equidata-elite/DirectoryPage";
import { EquiDataServiceRequestsPage } from "../../src/web/frontends/equidata-elite/ServiceRequestsPage";
import { PlatformClientError } from "../../src/frontend-kit";

let container: HTMLDivElement;
let root: Root | null = null;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { localStorage.clear(); navigated.length = 0; container = document.createElement("div"); document.body.appendChild(container); document.documentElement.lang = "en"; });
afterEach(() => { act(() => { root?.unmount(); }); root = null; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(element: React.ReactElement): void { root = createRoot(container); act(() => { root!.render(element); }); }

// --- scripted platform client (records calls; fixtures match the public DTOs) ---
type CreateCall = { input: Record<string, unknown>; idempotencyKey: string };
function makePlatform(fixtures: {
  persons?: object[];
  personDetail?: object;
  mine?: ServiceRequestRecord[];
  inbox?: ServiceRequestRecord[];
  createOutcome?: (calls: CreateCall[]) => Promise<never> | Promise<object>;
}) {
  const calls: { persons: object[]; person: number[]; create: CreateCall[]; setStatus: Array<{ id: number; status: string; expectedVersion?: number }>; withdrawConsent: number[]; mine: number[]; inbox: number[]; detail: number[]; reconcile: string[]; providerBlock: number[] } = { persons: [], person: [], create: [], setStatus: [], withdrawConsent: [], mine: [], inbox: [], detail: [], reconcile: [], providerBlock: [] };
  const records = new Map([...fixtures.mine ?? [], ...fixtures.inbox ?? []].map(row => [row.id, { ...row }]));
  const platform = {
    contractVersion: "2.23.0",
    modules: {
      directory: {
        persons: async (params: object) => { calls.persons.push(params); return { persons: fixtures.persons ?? [], next_cursor: null, page_size: 50, filters: { category: null, province: null, city: null, name: null } }; },
        person: async (id: number) => { calls.person.push(id); return fixtures.personDetail ?? { person: {}, credentials: [], active_credentials: [], credentials_note: "" }; },
      },
      serviceRequests: {
        create: async (input: object, options: { idempotencyKey: string }) => {
          const call = { input: input as Record<string, unknown>, idempotencyKey: options.idempotencyKey };
          calls.create.push(call);
          return fixtures.createOutcome ? fixtures.createOutcome(calls.create) : { created: true as const, request: { id: 901, provider_person_id: call.input.provider_person_id, category: call.input.category, status: "new", share_contact: call.input.share_contact }, request_digest: "d", note: "n" };
        },
        reconcileIntent: async (key: string) => { calls.reconcile.push(key); return { state: "unknown", note: "No matching receipt is visible yet." }; },
        mine: async () => { calls.mine.push(1); return { requests: (fixtures.mine ?? []).map(r => ({ ...records.get(r.id)! })) }; },
        inbox: async () => { calls.inbox.push(1); return { requests: (fixtures.inbox ?? []).map(r => ({ ...records.get(r.id)! })) }; },
        detail: async (id: number) => { calls.detail.push(id); return { request: { ...records.get(id)! } }; },
        setStatus: async (id: number, status: ServiceRequestStatus, options: { expectedVersion?: number }) => { calls.setStatus.push({ id, status, expectedVersion: options.expectedVersion }); const request = { ...records.get(id)!, status, row_version: records.get(id)!.row_version + 1 }; records.set(id, request); return { request }; },
        withdrawConsent: async (id: number) => { calls.withdrawConsent.push(id); const row = records.get(id)!; records.set(id, { ...row, contact: null, contact_note: "Contact is not shared with this reader." }); return { withdrawn: true as const, request_id: id, share_contact: false, consent_updated_at: "now" }; },
        providerBlock: async (id: number) => { calls.providerBlock.push(id); return { blocked: true, requester_account: "blocked", effects: {} }; },
      },
    },
  } as unknown as PlatformClient;
  return { platform, calls, records };
}
const PUBLISHED = {
  person_id: 501, name_latin: "Published Farrier", name_native: "نعل‌بند منتشرشده",
  service_categories: ["farrier"], province_code: "IR-08", city: "Tehran",
  contact_preference: "platform_message", languages: "fa, en", availability_text: "Weekdays",
  contact_note: "Contact is mediated by the platform.",
};
const USER: PlatformUser = { id: "u1", email: "e@example.com", display_name: "E", role: "user" };
function makeView(platform: PlatformClient, locale: "en" | "fa", user: PlatformUser | null): EquiDataRuntime {
  return { platform, locale, user, permissions: [], navigate: vi.fn(), route: "/", platformMeta: null, capabilities: {}, health: null } as unknown as EquiDataRuntime;
}
const goLocal = (path: string) => { navigated.push(path); };
const navigated: string[] = [];

// --- helpers ---
function text(): string { return container.textContent ?? ""; }
function button(labels: RegExp): HTMLButtonElement | null {
  return [...container.querySelectorAll("button")].find((b) => labels.test((b.textContent ?? "").trim())) ?? null;
}
function submitButton(): HTMLButtonElement | null { return button(/^Send inquiry$|^ارسال درخواست$/); }
function setNativeValue(el: HTMLTextAreaElement | HTMLSelectElement, value: string, event: "input" | "change") {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}
function checkConsent() {
  const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  act(() => { box!.click(); });
}

describe("NEXT-06-elite: EquiData Elite native directory journey", () => {
  it("anonymous discovery renders only API-projected published professionals and never a contact value", async () => {
    const { platform } = makePlatform({ persons: [PUBLISHED] });
    mount(<EquiDataDirectoryPage view={makeView(platform, "en", null)} goLocal={goLocal} />);
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Published Farrier");
    expect(text()).toContain("Contact is mediated by the platform");
    // The public DTO carries no contact value and the page never invents one.
    expect(container.innerHTML).not.toMatch(/contact_value/);
    expect(text()).not.toMatch(/\+98|0912|@mail/);
    // Keyboard-reachable: interactive result rows are buttons.
    const card = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Published Farrier"));
    expect(card).toBeTruthy();
    act(() => { (card as HTMLButtonElement).click(); });
    expect(navigated).toContain("/directory/501");
  });

  it("an empty result is honest in EN, and the surface renders natively in FA too", async () => {
    const en = makePlatform({ persons: [] });
    mount(<EquiDataDirectoryPage view={makeView(en.platform, "en", null)} goLocal={goLocal} />);
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("No published profiles match these filters.");
    expect(text()).toContain("An empty result is not a claim that no professionals exist.");
    act(() => { root!.render(<EquiDataDirectoryPage view={makeView(en.platform, "fa", null)} goLocal={goLocal} />); });
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("فهرست متخصصان");
    expect(text()).toContain("نتیجه خالی به معنی نبودِ متخصص نیست.");
  });

  it("anonymous profile view offers sign-in instead of the composer; credentials stay honest", async () => {
    const { platform } = makePlatform({
      personDetail: {
        person: PUBLISHED, credentials: [
          { id: 1, role: "farrier", issuer_name: "Self", identifier: "x", issued_at: null, expires_at: "2020-01-01", is_active: false, recorded_period_status: "expired", verification_state: "unverified", verification_level: "none" },
          { id: 2, role: "veterinarian", issuer_name: "Union", identifier: "y", issued_at: "2026-01-01", expires_at: null, is_active: true, recorded_period_status: "dates_not_recorded", verification_state: "unverified", verification_level: "none" },
        ], active_credentials: [], credentials_note: "Credentials are self-declared until reviewed.",
      },
    });
    mount(<EquiDataDirectoryPersonPage view={makeView(platform, "en", null)} goLocal={goLocal} personId={501} />);
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Sign in to send a private inquiry");
    expect(container.querySelector("form")).toBeNull();
    expect(text()).toContain("Expired");
    expect(text()).toContain("Dates not recorded");
    expect(text()).toContain("Self-declared (unverified)");
  });

  it("explicit consent gates submission; an uncertain failure retries the SAME idempotency key (no duplicate lead)", async () => {
    let attempts = 0;
    const { platform, calls } = makePlatform({
      personDetail: { person: PUBLISHED, credentials: [], active_credentials: [], credentials_note: "" },
      createOutcome: () => { attempts += 1; if (attempts === 1) return Promise.reject(new PlatformClientError(503, "unavailable", "uncertain")); return Promise.resolve({ created: true, request: { id: 902, provider_person_id: 501, category: "farrier", share_contact: false, status: "new" }, request_digest: "d", note: "n" }); },
    });
    mount(<EquiDataDirectoryPersonPage view={makeView(platform, "en", USER)} goLocal={goLocal} personId={501} />);
    await act(async () => { await Promise.resolve(); });
    // Composer present; submit disabled before consent + note.
    expect(container.querySelector("form")).toBeTruthy();
    expect(submitButton()!.disabled).toBe(true);
    act(() => setNativeValue(container.querySelector("textarea")!, "Hello, my horse needs a farrier visit next week.", "input"));
    expect(submitButton()!.disabled).toBe(true);
    checkConsent();
    expect(submitButton()!.disabled).toBe(false);
    await act(async () => { submitButton()!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls.create.length).toBe(1);
    // Uncertain 5xx: conservative failure — retry must reuse the SAME intent.
    expect(text()).toContain("The previous attempt needs checking");
    expect(submitButton()!.disabled).toBe(true);
    // R113: unknown results require an actual successful key lookup first.
    // A failed read must not expose replay or create a fresh intent.
    expect(button(/^Retry the same inquiry$/)).toBeNull();
    const reconcile = platform.modules.serviceRequests.reconcileIntent;
    platform.modules.serviceRequests.reconcileIntent = async () => { throw new Error("Lookup unavailable"); };
    await act(async () => { button(/^Check this request with the server$/)!.click(); });
    expect(button(/^Retry the same inquiry$/)).toBeNull();
    expect(calls.create).toHaveLength(1);
    platform.modules.serviceRequests.reconcileIntent = reconcile;
    await act(async () => { button(/^Check this request with the server$/)!.click(); });
    expect(calls.reconcile).toEqual([calls.create[0]!.idempotencyKey]);
    expect(button(/^Retry the same inquiry$/)).toBeTruthy();
    await act(async () => { button(/^Retry the same inquiry$/)!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls.create.length).toBe(2);
    expect(calls.create[0]!.idempotencyKey).toBe(calls.create[1]!.idempotencyKey);
    expect(calls.create[0]!.input).toEqual(calls.create[1]!.input);
    expect(text()).toContain("Inquiry recorded");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(attempts).toBe(2);
  });
});

describe("NEXT-06-elite: EquiData Elite native service requests journey", () => {
  const MINE_REQUEST: ServiceRequestRecord = {
    id: 801, provider_person_id: 501, category: "farrier", province_code: "IR-08", city: "Tehran", horse_id: null,
    status: "new", row_version: 3, created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z",
    is_requester_view: true, contact: { display_name: "E", email: "e@example.com", via: "consented" as const },
    contact_note: "shared", note: "Please call me.", appointment_warning: "A service request is not a confirmed appointment.",
  };

  it("anonymous users get the honest sign-in panel, never private data", async () => {
    const { platform, calls } = makePlatform({});
    mount(<EquiDataServiceRequestsPage view={makeView(platform, "en", null)} />);
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Sign in to view service requests");
    expect(calls.mine.length).toBe(0);
    expect(calls.inbox.length).toBe(0);
  });

  it("requester sees role-allowed transitions only, with CAS version attached", async () => {
    const { platform, calls } = makePlatform({ mine: [MINE_REQUEST] });
    mount(<EquiDataServiceRequestsPage view={makeView(platform, "en", USER)} requestId={801} />);
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("#801");
    expect(text()).toContain("Contact shared with current consent");
    expect(calls.detail).toContain(801);
    // requester transitions from 'new': closed + withdrawn only.
    expect(button(/^Close request$/)).toBeTruthy();
    expect(button(/^Withdraw request$/)).toBeTruthy();
    expect(button(/^Acknowledge inquiry$/)).toBeNull();
    expect(button(/^Mark as discussing$/)).toBeNull();
    await act(async () => { button(/^Close request$/)!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls.setStatus).toEqual([{ id: 801, status: "closed", expectedVersion: 3 }]);
  });

  it("stale CAS version requires reread and acknowledgement before retrying with the current version", async () => {
    const { platform, calls, records } = makePlatform({
      mine: [MINE_REQUEST],
      createOutcome: () => Promise.resolve({}),
    });
    (platform.modules.serviceRequests as { setStatus: (id: number, status: string, options: { expectedVersion?: number }) => Promise<object> }).setStatus = async (id: number, status: string, options: { expectedVersion?: number }) => {
      calls.setStatus.push({ id, status, expectedVersion: options.expectedVersion });
      if (calls.setStatus.length === 1) {
        records.set(id, { ...records.get(id)!, row_version: 7 });
        throw new PlatformClientError(409, "stale_version", "The record changed.", { current_version: 7 });
      }
      const request = { ...records.get(id)!, status: status as ServiceRequestStatus, row_version: 8 };
      records.set(id, request);
      return { request };
    };
    mount(<EquiDataServiceRequestsPage view={makeView(platform, "en", USER)} requestId={801} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { button(/^Close request$/)!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls.setStatus.length).toBe(1);
    expect(text()).toContain("The record changed.");
    expect(button(/^Reload this request$/)).toBeTruthy();
    expect(button(/^Close request$/)!.disabled).toBe(true);
    expect(button(/^I reviewed the current request$/)!.disabled).toBe(true);
    await act(async () => { button(/^Reload this request$/)!.click(); });
    expect(button(/^Close request$/)!.disabled).toBe(true);
    expect(button(/^I reviewed the current request$/)!.disabled).toBe(false);
    await act(async () => { button(/^I reviewed the current request$/)!.click(); });
    await act(async () => { button(/^Close request$/)!.click(); });
    expect(calls.setStatus).toEqual([{ id: 801, status: "closed", expectedVersion: 3 }, { id: 801, status: "closed", expectedVersion: 7 }]);
    expect(text()).toContain("Change recorded");
  });

  it("contact withdrawal takes effect on the canonical re-read", async () => {
    const { platform, calls } = makePlatform({
      mine: [MINE_REQUEST],
      createOutcome: () => Promise.resolve({}),
    });
    // Supply the browser dialog absent from happy-dom and keep its call assertion.
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    mount(<EquiDataServiceRequestsPage view={makeView(platform, "en", USER)} requestId={801} />);
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Contact shared with current consent");
    const privacy = [...container.querySelectorAll("details")].find((d) => (d.textContent ?? "").includes("Privacy and provider controls"))!;
    act(() => { privacy.querySelector("summary")!.click(); });
    const withdraw = [...privacy.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Withdraw contact sharing"))!;
    await act(async () => { withdraw.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls.withdrawConsent).toEqual([801]);
    // The refresh re-read the canonical state: contact no longer shared.
    expect(text()).toContain("Contact is not shared with this reader.");
    expect(text()).not.toContain("e@example.com");
    expect(calls.detail.length).toBeGreaterThan(1);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("provider inbox renders provider transitions and the neutral block affordance", async () => {
    const providerView: ServiceRequestRecord = { ...MINE_REQUEST, is_requester_view: false, contact: null, contact_note: "Requester identity is not disclosed without consent." };
    const { platform, calls } = makePlatform({ inbox: [providerView] });
    const view = makeView(platform, "en", USER);
    mount(<EquiDataServiceRequestsPage view={view} />);
    await act(async () => { await Promise.resolve(); });
    act(() => { button(/Provider inbox/)!.click(); });
    await act(async () => { await Promise.resolve(); });
    const link = container.querySelector<HTMLAnchorElement>('a[href="/f/equidata-elite/services/801"]')!;
    expect(link).toBeTruthy();
    act(() => { link.click(); });
    expect(view.navigate).toHaveBeenCalledWith("/f/equidata-elite/services/801");
    await act(async () => root!.render(<EquiDataServiceRequestsPage view={view} requestId={801} />));
    // provider transitions from 'new': acknowledged, closed, spam — no withdraw.
    expect(button(/^Acknowledge inquiry$/)).toBeTruthy();
    expect(button(/^Mark as spam$/)).toBeTruthy();
    expect(button(/^Withdraw request$/)).toBeNull();
    expect(button(/^Withdraw contact sharing$/)).toBeNull();
    expect(text()).toContain("not disclosed");
    const controls = [...container.querySelectorAll("details")].find((d) => (d.textContent ?? "").includes("Provider controls"))!;
    expect((controls.textContent ?? "")).toContain("Block requester");
    vi.stubGlobal("confirm", vi.fn(() => true));
    await act(async () => button(/^Block requester$/)!.click());
    expect(calls.providerBlock).toEqual([801]);
    expect(text()).toContain("Change recorded");
    expect(text()).not.toContain("e@example.com");
  });
});
