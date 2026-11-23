// @vitest-environment happy-dom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformClient, ServiceRequestCreateResponse, ServiceRequestRecord } from "../../src/contracts/platform";
import { useServiceRequestWorkbench } from "../../src/frontend-kit/useServiceWorkbench";
import { useServiceRequestComposer } from "../../src/frontend-kit/domain/useServiceComposer";
import { MUTATION_INTENT_PREFIX } from "../../src/frontend-kit/domain/mutationIntentStorage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const row = (id = 1): ServiceRequestRecord => ({ id, provider_person_id: 3, category: "veterinarian",
  province_code: null, city: null, horse_id: null, status: "new", row_version: 1,
  created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z", is_requester_view: true,
  contact: { display_name: `Private person ${id}`, email: `private-${id}@example.test`, via: "consented" },
  note: `Private note ${id}`, contact_note: "Shared by consent", appointment_warning: "Inquiry only" });
const receipt = (): ServiceRequestCreateResponse => ({ created: true, request_digest: "receipt-digest",
  request: { id: 7, provider_person_id: 3, category: "veterinarian", share_contact: false, status: "new" }, note: "Recorded inquiry" });
function apiFixture() {
  const api = {
    mine: vi.fn(async () => ({ requests: [row()] })),
    inbox: vi.fn(async () => ({ requests: [], inbox: "provider" as const })),
    detail: vi.fn(async () => ({ request: row() })),
    setStatus: vi.fn(), withdrawConsent: vi.fn(), redactNote: vi.fn(), block: vi.fn(), providerBlock: vi.fn(), report: vi.fn(),
    create: vi.fn(async () => receipt()),
    reconcileIntent: vi.fn(async () => ({ state: "confirmed" as const, request_id: 7, response: receipt(), note: "Recorded inquiry" })),
  };
  return { api, platform: { modules: { serviceRequests: api } } as unknown as PlatformClient };
}
let desk: ReturnType<typeof useServiceRequestWorkbench>;
let composer: ReturnType<typeof useServiceRequestComposer>;
function Desk({ platform, scope, enabled = true }: { platform: PlatformClient; scope: string; enabled?: boolean }) {
  desk = useServiceRequestWorkbench(platform, scope, enabled);
  return <pre>{JSON.stringify(desk.snapshot)}</pre>;
}
function Composer({ platform, provider = 3 }: { platform: PlatformClient; provider?: number }) {
  composer = useServiceRequestComposer(platform, "requester:one", provider);
  return <pre>{JSON.stringify(composer.snapshot)}</pre>;
}

describe("R113 service React lifetime adapters", () => {
  it("masks the old principal before late private responses can enter the new tree", async () => {
    const { api, platform } = apiFixture();
    await render(<Desk platform={platform} scope="requester:A" />);
    expect(host.textContent).toContain("private-1@example.test");
    const oldDetail = deferred<unknown>(); api.detail.mockImplementationOnce(() => oldDetail.promise as never);
    const prior = desk.store; act(() => prior.select(1));
    api.mine.mockResolvedValue({ requests: [row(2)] });
    await render(<Desk platform={platform} scope="requester:B" />);
    await act(async () => oldDetail.resolve({ request: row() }));
    expect(host.textContent).toContain("private-2@example.test");
    expect(host.textContent).not.toContain("private-1@example.test");
    expect(host.textContent).not.toContain("Private note 1");
    expect(await prior.transition(1, "withdrawn")).toBe(false);
    expect(api.setStatus).not.toHaveBeenCalled();
  });

  it("keeps a pending privacy write masked when the actual window focus listener reloads", async () => {
    const { api, platform } = apiFixture();
    await render(<Desk platform={platform} scope="requester:A" />);
    const gate = deferred<unknown>(); api.withdrawConsent.mockReturnValueOnce(gate.promise);
    let change!: Promise<boolean>;
    act(() => { change = desk.store.withdrawConsent(1); });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(api.mine).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("private-1@example.test");
    expect(host.textContent).not.toContain("Private note 1");
    await act(async () => { gate.reject(new Error("Outcome not delivered")); await change; });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(desk.store.commandFor(1).state.phase).toBe("failed");
    expect(host.textContent).not.toContain("private-1@example.test");
  });

  it("fences StrictMode cleanup reads and removes refresh listeners when disabled", async () => {
    const { api, platform } = apiFixture();
    const old = deferred<unknown>(); api.mine.mockImplementationOnce(() => old.promise as never);
    await render(<StrictMode><Desk platform={platform} scope="requester:A" /></StrictMode>);
    expect(api.mine).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve({ requests: [row(99)] }));
    expect(host.textContent).toContain("private-1@example.test");
    expect(host.textContent).not.toContain("private-99@example.test");
    await render(<StrictMode><Desk platform={platform} scope="requester:A" enabled={false} /></StrictMode>);
    const calls = api.mine.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(api.mine).toHaveBeenCalledTimes(calls);
    expect(host.textContent).not.toContain("private-");
    expect(desk.store.canAct(1)).toBe(false);
  });

  it("recovers a provider's original persisted key after remount without replaying its private payload", async () => {
    const { api, platform } = apiFixture();
    const gate = deferred<ServiceRequestCreateResponse>(); api.create.mockImplementationOnce(() => gate.promise);
    await render(<Composer platform={platform} />);
    let change!: Promise<boolean>;
    act(() => { change = composer.store.create({ provider_person_id: 3, category: "veterinarian", note: "Private provider inquiry text", share_contact: false }); });
    const key = composer.snapshot.intent.record!.key;
    const persisted = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .filter(name => name.startsWith(MUTATION_INTENT_PREFIX)).map(name => localStorage.getItem(name)).join();
    expect(persisted).not.toContain("Private provider inquiry text");
    await render(<Composer platform={platform} provider={4} />);
    await act(async () => { gate.resolve(receipt()); expect(await change).toBe(false); });
    expect(composer.snapshot.intent.requestId).toBeNull();
    expect(api.reconcileIntent).not.toHaveBeenCalled();
    await render(<Composer platform={platform} provider={3} />);
    expect(api.reconcileIntent).toHaveBeenCalledWith(key);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(composer.snapshot.intent.requestId).toBe(7);
    expect(composer.snapshot.intent.phase).toBe("confirmed");
  });
});
