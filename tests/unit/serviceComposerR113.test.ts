import { describe, expect, it, vi } from "vitest";
import type { ServiceRequestCreateInput, ServiceRequestCreateResponse } from "../../src/contracts/platform";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { ServiceRequestComposer, type ServiceComposerApi } from "../../src/frontend-kit/domain/serviceComposer";
import type { IntentStorage, MutationIntentRecord } from "../../src/frontend-kit/domain/mutationIntentStorage";
import { SERVICE_CATEGORIES } from "../../src/directory/vocabulary";

const input: ServiceRequestCreateInput = { provider_person_id: 3, category: SERVICE_CATEGORIES[0].id,
  note: "Private exact request content", share_contact: false };
const receipt = (patch: Partial<ServiceRequestCreateResponse> = {}): ServiceRequestCreateResponse => ({ created: true,
  request: { id: 4, provider_person_id: 3, category: input.category, status: "new", share_contact: false },
  request_digest: "original-payload-digest", note: "Lead only", ...patch });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function memory(): IntentStorage & { records: Map<string, MutationIntentRecord> } {
  const records = new Map<string, MutationIntentRecord>();
  const slot = (scope: string, workflow: string, resource: string) => JSON.stringify([scope, workflow, resource]);
  return { records, durable: true,
    load: (scope, workflow, resource) => records.get(slot(scope, workflow, resource)) ?? null,
    save(record) { records.set(slot(record.scope, record.workflow, record.resource), JSON.parse(JSON.stringify(record))); },
    clear(scope, workflow, resource, key) { const name = slot(scope, workflow, resource); if (key == null || records.get(name)?.key === key) records.delete(name); },
    sweepForeignScopes(scope) { for (const [key, record] of records) if (record.scope !== scope) records.delete(key); },
  };
}
function setup(storage = memory(), current = () => true, scope = "owner:1") {
  const api = { create: vi.fn(async () => receipt()), reconcileIntent: vi.fn(async () => ({ state: "unknown" as const, note: "No receipt yet" })) };
  const store = new ServiceRequestComposer(api as ServiceComposerApi, scope, 3, current, storage); store.start();
  return { store, api, storage };
}

describe("R113 shared service composer exact-key recovery", () => {
  it("persists only coarse metadata and suppresses duplicate dispatch", async () => {
    const { store, api, storage } = setup(); const pending = deferred<ServiceRequestCreateResponse>();
    api.create.mockImplementationOnce(() => pending.promise);
    const first = store.create(input); expect(await store.create(input)).toBe(false); expect(api.create).toHaveBeenCalledTimes(1);
    const persisted = JSON.stringify([...storage.records.values()]);
    expect(persisted).not.toContain(input.note); expect([...storage.records.values()][0].summary.note_length).toBe(input.note.length);
    pending.resolve(receipt()); expect(await first).toBe(true); expect(storage.records.size).toBe(0);
    expect(store.getSnapshot().intent.requestId).toBe(4);
  });
  it("does not clear an uncertain intent or enable a new payload before reconciliation", async () => {
    const { store, api, storage } = setup(); api.create.mockRejectedValueOnce(new Error("lost after commit"));
    expect(await store.create(input)).toBe(false); expect(storage.records.size).toBe(1);
    expect(store.getSnapshot().canSubmit).toBe(false); expect(store.getSnapshot().canReplay).toBe(false);
    expect(await store.create({ ...input, note: "Different new payload" })).toBe(false);
  });
  it("reconciles an exact persisted key after reload without repeating a write", async () => {
    const { store, api, storage } = setup(); api.create.mockRejectedValueOnce(new Error("lost")); await store.create(input);
    const key = store.getSnapshot().intent.record!.key; store.dispose();
    const nextApi = { create: vi.fn(async () => receipt()), reconcileIntent: vi.fn(async () => ({ state: "confirmed" as const, request_id: 4, note: "Recorded" })) };
    const next = new ServiceRequestComposer(nextApi, "owner:1", 3, () => true, storage); next.start();
    await vi.waitFor(() => expect(next.getSnapshot().intent.phase).toBe("confirmed"));
    expect(nextApi.reconcileIntent).toHaveBeenCalledWith(key); expect(nextApi.create).not.toHaveBeenCalled(); expect(storage.records.size).toBe(0);
  });
  it("replays the exact original payload and key only after a successful lookup", async () => {
    const { store, api } = setup(); const draft = { ...input };
    api.create.mockRejectedValueOnce(new Error("lost")); await store.create(draft);
    const key = store.getSnapshot().intent.record!.key; draft.note = "Edited content is not the original";
    expect(await store.retryExact()).toBe(false); await store.reconcile(); expect(store.getSnapshot().canReplay).toBe(true);
    expect(await store.retryExact()).toBe(true);
    const call = api.create.mock.calls[1] as unknown as [ServiceRequestCreateInput, { idempotencyKey: string }];
    expect(call[0].note).toBe(input.note); expect(call[1].idempotencyKey).toBe(key);
  });
  it("does not enable replay after lookup transport failure or unresolved legacy receipt", async () => {
    const { store, api } = setup(); api.create.mockRejectedValueOnce(new Error("lost")); await store.create(input);
    api.reconcileIntent.mockRejectedValueOnce(new Error("offline")); await store.reconcile(); expect(store.getSnapshot().canReplay).toBe(false);
    api.reconcileIntent.mockResolvedValueOnce({ state: "unresolved", note: "Legacy" } as never); await store.reconcile();
    expect(store.getSnapshot().canReplay).toBe(false); expect(store.getSnapshot().intent.unknownReason).toBe("legacy_receipt_unresolved");
  });
  it("does not invent the private payload after reload", async () => {
    const { store, api, storage } = setup(); api.create.mockRejectedValueOnce(new Error("lost")); await store.create(input); store.dispose();
    const next = setup(storage); await vi.waitFor(() => expect(next.store.getSnapshot().intent.reconciling).toBe(false));
    expect(next.store.getSnapshot().canReplay).toBe(false); expect(await next.store.retryExact()).toBe(false); expect(next.api.create).not.toHaveBeenCalled();
  });
  it("rejects malformed create receipts without clearing recovery", async () => {
    const { store, api, storage } = setup(); api.create.mockResolvedValueOnce(receipt({ request: { ...receipt().request, id: 0 } }));
    expect(await store.create(input)).toBe(false); expect(store.getSnapshot().intent.phase).toBe("unknown"); expect(storage.records.size).toBe(1);
  });
  it("refuses invalid bounded input without sending or persisting private data", async () => {
    const { store, api, storage } = setup(); expect(await store.create({ ...input, note: "short" })).toBe(false);
    expect(await store.create({ ...input, provider_person_id: 88 })).toBe(false);
    expect(await store.create({ ...input, note: "x".repeat(501) })).toBe(false);
    expect(api.create).not.toHaveBeenCalled(); expect(storage.records.size).toBe(0); expect(store.getSnapshot().command.phase).toBe("rejected");
  });
  it("retains earlier uncertainty when an explicit replay loses permission", async () => {
    const { store, api, storage } = setup(); api.create.mockRejectedValueOnce(new Error("lost")); await store.create(input); await store.reconcile();
    api.create.mockRejectedValueOnce(new PlatformClientError(403, "forbidden", "Permission changed")); await store.retryExact();
    expect(storage.records.size).toBe(1); expect(store.getSnapshot().canSubmit).toBe(false);
  });
  it("fences principal A to B to A responses without clearing a newer intent", async () => {
    let current = true; const { store, api, storage } = setup(undefined, () => current);
    const pending = deferred<ServiceRequestCreateResponse>(); api.create.mockImplementationOnce(() => pending.promise);
    const write = store.create(input); current = false; store.dispose();
    const b = setup(storage, () => true, "owner:2"); expect(storage.records.size).toBe(0); b.store.dispose();
    current = true; const newer = setup(storage); newer.api.create.mockRejectedValueOnce(new Error("new uncertain request")); await newer.store.create(input);
    const newerKey = newer.store.getSnapshot().intent.record!.key;
    pending.resolve(receipt()); expect(await write).toBe(false);
    expect(storage.load("owner:1", "service-request", "3")?.key).toBe(newerKey);
  });
  it("cannot discard while dispatch or key lookup is in flight", async () => {
    const { store, api } = setup(); const write = deferred<ServiceRequestCreateResponse>(); api.create.mockImplementationOnce(() => write.promise);
    const pending = store.create(input); expect(store.discard()).toBe(false); write.reject(new Error("lost")); await pending;
    const read = deferred<never>(); api.reconcileIntent.mockImplementationOnce(() => read.promise); const lookup = store.reconcile();
    expect(store.discard()).toBe(false); read.reject(new Error("offline")); await lookup;
    expect(store.discard()).toBe(true); expect(store.getSnapshot().canSubmit).toBe(true);
  });
  it("does not delete another tab's newer key from a stale discard", async () => {
    const { store, api, storage } = setup(); api.create.mockRejectedValueOnce(new Error("lost")); await store.create(input);
    const original = store.getSnapshot().intent.record!; storage.save({ ...original, key: "newer-tab-key" });
    expect(store.discard()).toBe(false); expect(storage.load("owner:1", "service-request", "3")?.key).toBe("newer-tab-key");
  });
});
