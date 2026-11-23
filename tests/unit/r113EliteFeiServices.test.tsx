// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PlatformClientError, type PlatformClient, type ServiceRequestCreateResponse, type ServiceRequestRecord } from "../../src/frontend-kit";
import { EquiDataServiceRequestsPage, EquiDataServiceRequestComposer } from "../../src/web/frontends/equidata-elite/ServiceRequestsPage";
import { FeiServiceRequestsPage, FeiServiceRequestComposer } from "../../src/web/frontends/fei-classic/ServiceRequestsPage";
import { FeiDirectoryPage } from "../../src/web/frontends/fei-classic/DirectoryPage";
import type { EquiDataRuntime } from "../../src/web/frontends/equidata-elite/adapter";
import type { ClassicRuntime } from "../../src/web/frontends/fei-classic/adapter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); vi.stubGlobal("confirm", vi.fn(() => true)); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (requester = true): ServiceRequestRecord => ({ id: 71, provider_person_id: 41, category: "veterinarian", status: "new", row_version: 1, province_code: null, city: null, horse_id: null, created_at: "2026-10-17T12:00:00Z", updated_at: "2026-10-17T12:00:00Z", is_requester_view: requester, note: "Sensitive note visible only with current permission", contact: { display_name: "Private Person", email: "private@example.test", via: "consented" }, contact_note: "Contact is private", appointment_warning: "This is an inquiry." });
const receipt = (): ServiceRequestCreateResponse => ({ created: true, request: { id: 71, provider_person_id: 41, category: "veterinarian", status: "new", share_contact: false }, request_digest: "confirmed-digest", note: "Inquiry recorded" });
function serviceApi(requester = true) {
  const mine = vi.fn(async () => ({ requests: [row(requester)] }));
  const service = { mine, inbox: vi.fn(async () => ({ requests: [row(false)], inbox: "provider" as const })), detail: vi.fn(async () => ({ request: row(requester) })), create: vi.fn(async (..._args: unknown[]) => receipt()), reconcileIntent: vi.fn(async (..._args: unknown[]) => ({ state: "unknown" as "unknown" | "confirmed", note: "No receipt found", request_id: undefined as number | undefined })), setStatus: vi.fn(async (..._args: unknown[]) => ({ request: { ...row(requester), status: "closed", row_version: 2 }, notification: { recorded: true, outbox_status: "pending", note: "Queued" } })), withdrawConsent: vi.fn(async () => ({ withdrawn: true, request_id: 71, share_contact: false })), redactNote: vi.fn(async () => ({ redacted: true, request_id: 71 })), block: vi.fn(async () => ({ blocked: true, provider_person_id: 41, note: "Blocked" })), providerBlock: vi.fn(async () => ({ blocked: true, requester_account: "blocked", effects: {} })), report: vi.fn(async (..._args: unknown[]) => ({ reported: true, report_id: 7 })) };
  return { platform: { modules: { serviceRequests: service } } as unknown as PlatformClient, service };
}
function runtime(platform: PlatformClient, id = "owner") { return { platform, locale: "en", user: { id, email: `${id}@example.test`, role: "owner", display_name: id }, permissions: [], navigate: vi.fn(), capabilities: { authentication: true } }; }
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text)!;
function fill(control: HTMLTextAreaElement | HTMLInputElement, value: string) { act(() => { const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); }); }

for (const skin of ["elite", "fei"]) describe(`R113 ${skin} native service adapters`, () => {
  const composer = (platform: PlatformClient, user = "owner", personId = 41) => skin === "elite" ? <EquiDataServiceRequestComposer view={runtime(platform, user) as unknown as EquiDataRuntime} personId={personId} categories={["veterinarian"]} /> : <FeiServiceRequestComposer view={runtime(platform, user) as unknown as ClassicRuntime} personId={personId} categories={["veterinarian"]} goLocal={() => {}} />;
  const desk = (platform: PlatformClient, requestId: number | null = 71, user = "owner") => skin === "elite" ? <EquiDataServiceRequestsPage view={runtime(platform, user) as unknown as EquiDataRuntime} requestId={requestId} /> : <FeiServiceRequestsPage view={runtime(platform, user) as unknown as ClassicRuntime} requestId={requestId} goLocal={() => {}} />;

  it("requires explicit lead consent and creates once with the real provider, note, and default-private contact", async () => {
    const a = serviceApi(), gate = deferred<ServiceRequestCreateResponse>(); a.service.create.mockImplementationOnce(() => gate.promise);
    await render(composer(a.platform));
    const note = host.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!;
    expect(note.maxLength).toBe(500);
    fill(note, "Please discuss a veterinary consultation for my horse.");
    expect(button("Send inquiry").disabled).toBe(true);
    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const form = note.closest("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(a.service.create).toHaveBeenCalledOnce();
    expect(a.service.create.mock.calls[0]).toEqual([{ provider_person_id: 41, category: "veterinarian", note: "Please discuss a veterinary consultation for my horse.", share_contact: false, city: null }, { idempotencyKey: expect.any(String) }]);
    await act(async () => gate.resolve(receipt()));
    expect(host.textContent).toContain("Inquiry recorded"); expect(note.value).toBe(""); expect(button("Open my request")).toBeTruthy();
  });
  it("retains unknown intent and exact payload until successful lookup enables same-key replay", async () => {
    const a = serviceApi(); a.service.create.mockRejectedValueOnce(new PlatformClientError(502, "gateway", "Response lost"));
    await render(composer(a.platform));
    const note = host.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!;
    fill(note, "This veterinary inquiry must not become two leads."); act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("Send inquiry").click());
    const original = a.service.create.mock.calls[0];
    expect(button("Send inquiry").disabled).toBe(true); expect(button("Retry the same inquiry")).toBeUndefined();
    a.service.reconcileIntent.mockRejectedValueOnce(new Error("Read unavailable"));
    await act(async () => button("Check this request with the server").click());
    expect(button("Retry the same inquiry")).toBeUndefined(); expect(note.value).toContain("two leads");
    await act(async () => button("Check this request with the server").click());
    expect(button("Retry the same inquiry")).toBeTruthy();
    await act(async () => button("Retry the same inquiry").click());
    expect(a.service.create.mock.calls[1]).toEqual(original); expect(note.value).toBe("");
  });
  it("does not show old private drafts or late receipts after account/provider changes", async () => {
    const a = serviceApi(), gate = deferred<ServiceRequestCreateResponse>(); a.service.create.mockImplementationOnce(() => gate.promise);
    await render(composer(a.platform));
    fill(host.querySelector('textarea[name="note"]')!, "Old private account’s service inquiry."); act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    act(() => button("Send inquiry").click());
    await render(composer(a.platform, "another", 42));
    await act(async () => gate.resolve(receipt()));
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!.value).toBe(""); expect(host.textContent).not.toContain("Inquiry recorded");
  });
  it("keeps unknown commands visible when a failed authority reread removes the row, and requires explicit inspected recovery", async () => {
    const a = serviceApi(); a.service.setStatus.mockRejectedValueOnce(new PlatformClientError(502, "gateway", "Status response lost"));
    await render(desk(a.platform));
    await act(async () => button("Close request").click()); expect(button("Close request").disabled).toBe(true);
    a.service.detail.mockRejectedValueOnce(new PlatformClientError(403, "forbidden", "Authority unavailable"));
    await act(async () => button("Reload this request").click());
    expect(host.textContent).toContain("Authority unavailable"); expect(host.textContent).not.toContain("private@example.test"); expect(host.textContent).not.toContain("Sensitive note");
    expect(button("Reload this request")).toBeTruthy(); expect(button("I reviewed the current request").disabled).toBe(true);
    await act(async () => button("Reload this request").click());
    expect(host.textContent).toContain("private@example.test"); expect(button("Close request").disabled).toBe(true);
    await act(async () => button("I reviewed the current request").click()); expect(button("Close request").disabled).toBe(false);
  });
  it("masks contact and note while consent withdrawal is pending, then shows the fresh consent result", async () => {
    const a = serviceApi(), gate = deferred<{ withdrawn: true; request_id: number; share_contact: false }>(); a.service.withdrawConsent.mockImplementationOnce(() => gate.promise);
    await render(desk(a.platform));
    act(() => button("Withdraw contact sharing").click());
    expect(host.textContent).not.toContain("private@example.test"); expect(host.textContent).not.toContain("Sensitive note");
    a.service.mine.mockResolvedValue({ requests: [{ ...row(), contact: null }] }); a.service.detail.mockResolvedValue({ request: { ...row(), contact: null } });
    await act(async () => gate.resolve({ withdrawn: true, request_id: 71, share_contact: false }));
    expect(host.textContent).not.toContain("private@example.test"); expect(host.textContent).toContain("Change recorded");
  });
  it("provider view exposes its permitted status/report actions and no requester consent withdrawal", async () => {
    const a = serviceApi(false); await render(desk(a.platform));
    expect(button("Acknowledge inquiry")).toBeTruthy(); expect(button("Withdraw contact sharing")).toBeUndefined();
    fill(host.querySelector('textarea')!, "A concern requiring moderator review.");
    await act(async () => button("Send report").click());
    expect(a.service.report).toHaveBeenCalledWith(71, { reason: "A concern requiring moderator review." });
  });
});

describe("FEI native professional discovery", () => {
  it("submits explicit filters, handles failure as unavailable, and exposes real profile links", async () => {
    const persons = vi.fn(async (..._args: unknown[]) => ({ persons: [{ person_id: 41, name_latin: "Veterinary professional", name_native: null, service_categories: ["veterinarian"], province_code: null, city: null, contact_preference: "platform_message", languages: null, availability_text: null, contact_note: "Mediated" }], next_cursor: null, page_size: 20, filters: {} }));
    const platform = { modules: { directory: { persons } } } as unknown as PlatformClient;
    const go = vi.fn(); await render(<FeiDirectoryPage view={runtime(platform) as unknown as ClassicRuntime} goLocal={go} />);
    expect(host.querySelector('a[href="/f/fei-classic/directory/41"]')).toBeTruthy();
    fill(host.querySelector('input[type="search"]')!, "  Veterinary  ");
    expect(persons).toHaveBeenCalledOnce();
    await act(async () => button("Search directory").click());
    expect(persons.mock.calls[1]).toEqual([{ name: "Veterinary", category: undefined, province: undefined, cursor: undefined }, { signal: expect.any(AbortSignal) }]);
    persons.mockRejectedValueOnce(new Error("Directory read failed"));
    await act(async () => button("Clear filters").click());
    expect(host.textContent).toContain("Directory read failed"); expect(host.textContent).not.toContain("No published profiles match");
  });
});
