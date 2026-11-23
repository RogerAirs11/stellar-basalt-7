// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeritageServiceRequestsPage } from "../../src/web/heritage/ServiceRequestsPage";
import { I18nProvider } from "../../src/web/i18n";
import { PlatformClientError, type PlatformClient, type PlatformUser, type ServiceRequestRecord } from "../../src/frontend-kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const user = (id: string): PlatformUser => ({ id, display_name: id, email: `${id}@example.test`, role: "owner" });
const row = (id = 71): ServiceRequestRecord => ({ id, provider_person_id: 41, category: "veterinarian", status: "new", row_version: 1,
  province_code: null, city: null, horse_id: null, created_at: "2026-10-17T12:00:00Z", updated_at: "2026-10-17T12:00:00Z",
  is_requester_view: false, note: "Private request evidence", contact: { display_name: "Requester", email: "requester@example.test", via: "consented" },
  contact_note: "Private", appointment_warning: "Inquiry only" });
function api() {
  const service = { mine: vi.fn(async () => ({ requests: [row(), row(72)] })), detail: vi.fn(async (id: number) => ({ request: row(id) })),
    report: vi.fn(async (_id: number, _input: { reason: string }) => ({ reported: true, report_id: 91 })) };
  return { service, platform: { modules: { serviceRequests: service } } as unknown as PlatformClient };
}
const render = async (platform: PlatformClient, id = 71, account = "A") => {
  await act(async () => { root.render(<I18nProvider locale="en"><HeritageServiceRequestsPage platform={platform} user={user(account)} route={`/services/${id}`} /></I18nProvider>); });
};
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
const reportInput = () => host.querySelector<HTMLTextAreaElement>("textarea[required]")!;
const blockInput = () => host.querySelector<HTMLTextAreaElement>("textarea:not([required])")!;
const fill = (input: HTMLTextAreaElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

it("keeps unsent safety reasons in memory across a refresh while hiding private details until authorized", async () => {
  const a = api(); await render(a.platform);
  fill(reportInput(), "Unsent private concern for this request."); fill(blockInput(), "Unsent private block reason.");
  const gate = deferred<{ requests: ServiceRequestRecord[] }>(); a.service.mine.mockImplementationOnce(() => gate.promise);
  act(() => button("Refresh").click());
  expect(reportInput()).toBeNull(); expect(host.textContent).not.toContain("requester@example.test");
  await act(async () => gate.resolve({ requests: [row(), row(72)] }));
  expect(reportInput().value).toBe("Unsent private concern for this request.");
  expect(blockInput().value).toBe("Unsent private block reason.");
  expect(JSON.stringify(localStorage)).not.toContain("Unsent private");
});

it("isolates drafts by request and clears them when the principal changes", async () => {
  const a = api(); await render(a.platform); fill(reportInput(), "Only request 71 should retain this concern.");
  await render(a.platform, 72); expect(reportInput().value).toBe("");
  await render(a.platform, 71); expect(reportInput().value).toContain("Only request 71");
  await render(a.platform, 71, "B"); expect(reportInput().value).toBe("");
  await render(a.platform, 71, "A"); expect(reportInput().value).toBe("");
});

it("retains a refused report draft and clears it only after a real accepted receipt", async () => {
  const a = api(); await render(a.platform); const reason = "This report needs an actual recorded receipt.";
  fill(reportInput(), reason); a.service.report.mockRejectedValueOnce(new PlatformClientError(400, "invalid", "Please correct the concern."));
  await act(async () => reportInput().closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(reportInput().value).toBe(reason);
  await act(async () => reportInput().closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(a.service.report).toHaveBeenLastCalledWith(71, { reason });
  expect(reportInput().value).toBe(""); expect(host.textContent).toContain("The change was recorded");
});
