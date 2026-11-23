import { describe, expect, it, vi } from "vitest";
import type { ServiceRequestRecord, ServiceRequestStatus } from "../../src/contracts/platform";
import { PlatformClientError, ServiceRequestWorkbench, type ServiceRequestApi } from "../../src/frontend-kit/domain/serviceWorkbench";

const row = (patch: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord => ({
  id: 1, provider_person_id: 3, category: "veterinary", province_code: null, city: null, horse_id: null,
  status: "new", row_version: 1, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
  is_requester_view: true, contact: { display_name: "Private name", email: "private@example.test", via: "consented" },
  note: "Private note", contact_note: "Consented", appointment_warning: "A lead only", ...patch,
});
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup(patch: Partial<ServiceRequestRecord> = {}, current = () => true) {
  let record = row(patch);
  const api = {
    mine: vi.fn(async () => ({ requests: [record] })), inbox: vi.fn(async () => ({ requests: [record], inbox: "provider" as const })),
    detail: vi.fn(async () => ({ request: record })),
    setStatus: vi.fn(async (_id: number, status: ServiceRequestStatus) => { record = { ...record, status, row_version: record.row_version + 1 }; return { request: record }; }),
    withdrawConsent: vi.fn(async () => { record = { ...record, contact: null }; return { withdrawn: true, request_id: 1, share_contact: false }; }),
    redactNote: vi.fn(async () => { record = { ...record, note: "[redacted]" }; return { redacted: true, request_id: 1 }; }),
    block: vi.fn(async () => ({ blocked: true, provider_person_id: 3 })),
    providerBlock: vi.fn(async () => ({ blocked: true, requester_account: "blocked" })),
    report: vi.fn(async () => ({ reported: true, report_id: 7 })),
  } satisfies Record<keyof ServiceRequestApi, unknown>;
  const store = new ServiceRequestWorkbench(api as unknown as ServiceRequestApi, current);
  store.start();
  return { store, api, setRecord: (next: ServiceRequestRecord) => { record = next; } };
}
const ready = async (store: ServiceRequestWorkbench) => vi.waitFor(() => expect(store.getSnapshot().list.phase).toBe("ready"));

describe("R113 service workbench authority, concurrency and uncertainty", () => {
  it("uses the current row version and allows only role-specific transitions", async () => {
    const { store, api } = setup(); await ready(store);
    expect(await store.transition(1, "acknowledged")).toBe(false);
    expect(api.setStatus).not.toHaveBeenCalled();
    expect(await store.transition(1, "withdrawn")).toBe(true);
    expect(api.setStatus).toHaveBeenCalledWith(1, "withdrawn", { expectedVersion: 1 });
    expect(store.commandFor(1).state.phase).toBe("accepted");
  });
  it("suppresses two same-turn clicks before a disabled button paints", async () => {
    const { store, api } = setup(); await ready(store);
    const pending = deferred<unknown>(); api.setStatus.mockImplementationOnce(() => pending.promise as never);
    const first = store.transition(1, "withdrawn"), second = store.transition(1, "withdrawn");
    expect(await second).toBe(false); expect(api.setStatus).toHaveBeenCalledTimes(1);
    pending.resolve({ request: row({ status: "withdrawn", row_version: 2 }) }); await first;
  });
  it("does not confirm a malformed or wrong-version receipt", async () => {
    const { store, api } = setup(); await ready(store);
    api.setStatus.mockResolvedValueOnce({ request: row({ status: "withdrawn" }) });
    expect(await store.transition(1, "withdrawn")).toBe(false);
    expect(store.commandFor(1).state.phase).toBe("failed"); expect(store.canAct(1)).toBe(false);
  });
  it("keeps unknown state through ordinary reload and view changes", async () => {
    const { store, api } = setup(); await ready(store);
    api.setStatus.mockRejectedValueOnce(new Error("connection lost after dispatch"));
    await store.transition(1, "withdrawn"); await store.reload(); store.setView("inbox"); await ready(store);
    expect(store.commandFor(1).state.phase).toBe("failed"); expect(store.canAct(1)).toBe(false);
    expect(store.acknowledge(1)).toBe(false);
  });
  it("requires an authoritative reread AND explicit acknowledgement to unlock", async () => {
    const { store, api, setRecord } = setup(); await ready(store);
    api.setStatus.mockRejectedValueOnce(new Error("lost response")); await store.transition(1, "withdrawn");
    const pending = deferred<unknown>(); api.detail.mockImplementationOnce(() => pending.promise as never);
    const read = store.reconcile(1);
    expect(store.acknowledge(1)).toBe(false); expect(store.canAct(1)).toBe(false);
    const after = row({ status: "withdrawn", row_version: 2 }); setRecord(after); pending.resolve({ request: after }); await read;
    expect(store.commandFor(1).recovery).toBe("ready"); expect(store.canAct(1)).toBe(false);
    expect(store.acknowledge(1)).toBe(true); expect(store.canAct(1)).toBe(true);
    expect(await store.transition(1, "acknowledged")).toBe(false);
  });
  it("treats 409 as a conflict lock, not a validation retry", async () => {
    const { store, api } = setup(); await ready(store);
    api.setStatus.mockRejectedValueOnce(new PlatformClientError(409, "stale_version", "Reload", { current_version: 2 }));
    await store.transition(1, "withdrawn"); expect(store.canAct(1)).toBe(false);
    await store.reconcile(1); expect(store.commandFor(1).recovery).toBe("ready");
  });
  it("failed permission reread removes private data without erasing the recovery lock", async () => {
    const { store, api } = setup(); await ready(store);
    api.setStatus.mockRejectedValueOnce(new Error("lost")); await store.transition(1, "withdrawn");
    api.detail.mockRejectedValueOnce(new PlatformClientError(404, "not_found", "Unavailable")); await store.reconcile(1);
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private@example.test");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("Private note");
    expect(store.commandFor(1).recovery).toBe("failed"); expect(store.acknowledge(1)).toBe(false);
  });
  it("does not recover from a malformed detail response", async () => {
    const { store, api } = setup(); await ready(store);
    api.setStatus.mockRejectedValueOnce(new Error("lost")); await store.transition(1, "withdrawn");
    api.detail.mockResolvedValueOnce({ request: row({ id: 999 }) }); await store.reconcile(1);
    expect(store.commandFor(1).recovery).toBe("failed"); expect(store.acknowledge(1)).toBe(false);
  });
  it("masks contact and notes while a private read is re-authorized", async () => {
    const { store, api } = setup(); await ready(store);
    const pending = deferred<unknown>(); api.mine.mockImplementationOnce(() => pending.promise as never);
    const read = store.reload(); expect(store.getSnapshot().list.phase).toBe("reloading");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private@example.test");
    pending.reject(new PlatformClientError(403, "forbidden", "No access")); await read;
    expect(store.getSnapshot().list.phase).toBe("forbidden"); expect(store.canAct(1)).toBe(false);
  });
  it("ignores old view reads even when the transport ignores cancellation", async () => {
    const { store, api } = setup(); await ready(store);
    const pending = deferred<unknown>(); api.mine.mockImplementationOnce(() => pending.promise as never);
    const old = store.reload(); store.setView("inbox"); await ready(store);
    pending.resolve({ requests: [row({ id: 888 })] }); await old;
    expect(store.getSnapshot().view).toBe("inbox"); expect(JSON.stringify(store.getSnapshot())).not.toContain('"id":888');
  });
  it("invalidates old principal writes immediately and after dispose/start", async () => {
    let current = true; const { store, api } = setup({}, () => current); await ready(store);
    const pending = deferred<unknown>(); api.setStatus.mockImplementationOnce(() => pending.promise as never);
    const old = store.transition(1, "withdrawn"); current = false; expect(store.canAct(1)).toBe(false);
    store.dispose(); current = true; store.start(); await ready(store);
    pending.resolve({ request: row({ status: "withdrawn", row_version: 2 }) }); expect(await old).toBe(false);
    expect(store.commandFor(1).state.phase).toBe("idle");
  });
  it("guards privacy and block actions by role and validates their receipts", async () => {
    const { store, api } = setup({ is_requester_view: false }); await ready(store);
    expect(await store.withdrawConsent(1)).toBe(false); expect(await store.redactNote(1)).toBe(false); expect(await store.block(1)).toBe(false);
    expect(api.withdrawConsent).not.toHaveBeenCalled();
    expect(await store.providerBlock(1, "Private provider reason")).toBe(true);
    expect(api.providerBlock).toHaveBeenCalledWith(1, { reason: "Private provider reason" });
    expect(await store.report(1, "Valid report reason")).toBe(true);
  });
  it("suppresses private fields immediately during consent withdrawal", async () => {
    const { store, api } = setup(); await ready(store);
    const pending = deferred<unknown>(); api.withdrawConsent.mockImplementationOnce(() => pending.promise as never);
    const write = store.withdrawConsent(1); expect(JSON.stringify(store.getSnapshot())).not.toContain("private@example.test");
    pending.reject(new Error("lost")); await write; expect(store.commandFor(1).state.phase).toBe("failed");
  });

  it("does not let an older detail restore private data during a newer authority refresh", async () => {
    const { store, api } = setup(); await ready(store);
    const oldDetail = deferred<unknown>(), currentList = deferred<unknown>();
    api.detail.mockImplementationOnce(() => oldDetail.promise as never);
    store.select(1);
    api.mine.mockImplementationOnce(() => currentList.promise as never);
    const refresh = store.reload();
    oldDetail.resolve({ request: row() }); await Promise.resolve(); await Promise.resolve();
    const duringRefresh = JSON.stringify(store.getSnapshot());
    api.detail.mockRejectedValueOnce(new PlatformClientError(404, "not_found", "No longer available"));
    currentList.reject(new PlatformClientError(403, "forbidden", "Authority changed")); await refresh;
    expect(duringRefresh).not.toContain("private@example.test");
    expect(duringRefresh).not.toContain("Private note");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private@example.test");
  });

  it("does not accept an old recovery after a newer read loses authority", async () => {
    const { store, api } = setup(); await ready(store); store.select(1);
    await vi.waitFor(() => expect(store.getSnapshot().detail.phase).toBe("ready"));
    api.setStatus.mockRejectedValueOnce(new Error("lost response")); await store.transition(1, "withdrawn");
    const oldRecovery = deferred<unknown>(); api.detail.mockImplementationOnce(() => oldRecovery.promise as never);
    const recovery = store.reconcile(1);
    api.mine.mockRejectedValueOnce(new PlatformClientError(403, "forbidden", "Authority changed"));
    api.detail.mockRejectedValueOnce(new PlatformClientError(404, "not_found", "No longer available"));
    await store.reload();
    oldRecovery.resolve({ request: row() }); await recovery;
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private@example.test");
    expect(store.commandFor(1).recovery).not.toBe("ready");
    expect(store.acknowledge(1)).toBe(false);
  });

  it("invalidates a ready recovery acknowledgement when a later authority check begins", async () => {
    const { store, api } = setup(); await ready(store);
    api.setStatus.mockRejectedValueOnce(new Error("lost response")); await store.transition(1, "withdrawn");
    await store.reconcile(1); expect(store.commandFor(1).recovery).toBe("ready");
    const latest = deferred<unknown>(); api.mine.mockImplementationOnce(() => latest.promise as never);
    const refresh = store.reload(); const acknowledgedDuringRead = store.acknowledge(1);
    latest.reject(new PlatformClientError(403, "forbidden", "Authority changed")); await refresh;
    expect(acknowledgedDuringRead).toBe(false);
    expect(store.commandFor(1).state.phase).toBe("failed");
    expect(store.acknowledge(1)).toBe(false);
  });

  it("keeps a pending or uncertain privacy change masked through ordinary refreshes", async () => {
    const { store, api } = setup(); await ready(store);
    const change = deferred<unknown>(); api.withdrawConsent.mockImplementationOnce(() => change.promise as never);
    const pending = store.withdrawConsent(1);
    await store.reload(); const whilePending = JSON.stringify(store.getSnapshot());
    change.reject(new Error("withdrawal response lost")); await pending;
    await store.reload(); const whileUnknown = JSON.stringify(store.getSnapshot());
    await store.reconcile(1); // A new explicit inspection can show the actual server state.
    expect(whilePending).not.toContain("private@example.test");
    expect(whilePending).not.toContain("Private note");
    expect(whileUnknown).not.toContain("private@example.test");
    expect(whileUnknown).not.toContain("Private note");
    expect(store.commandFor(1).recovery).toBe("ready");
    expect(JSON.stringify(store.getSnapshot())).toContain("private@example.test");
  });

  it("does not let a list requested earlier undo a newer detail denial", async () => {
    const { store, api } = setup(); await ready(store);
    const staleList = deferred<unknown>(); api.mine.mockImplementationOnce(() => staleList.promise as never);
    const refresh = store.reload();
    api.detail.mockRejectedValueOnce(new PlatformClientError(404, "not_found", "Access removed"));
    store.select(1); await vi.waitFor(() => expect(store.getSnapshot().detail.phase).toBe("unavailable"));
    staleList.resolve({ requests: [row()] }); await refresh;
    expect(JSON.stringify(store.getSnapshot())).not.toContain("private@example.test");
    expect(store.getSnapshot().detail.phase).toBe("unavailable");
    expect(store.canAct(1)).toBe(false);
  });

  it("retains a newer detail version when an earlier list finally completes", async () => {
    const { store, api } = setup(); await ready(store);
    const staleList = deferred<unknown>(); api.mine.mockImplementationOnce(() => staleList.promise as never);
    const refresh = store.reload();
    api.detail.mockResolvedValueOnce({ request: row({ status: "closed", row_version: 2, contact: null, note: "[redacted]" }) });
    store.select(1); await vi.waitFor(() => expect(store.getSnapshot().detail.phase).toBe("ready"));
    staleList.resolve({ requests: [row()] }); await refresh;
    const snapshot = store.getSnapshot();
    expect(snapshot.detail.phase === "ready" && snapshot.detail.data.row_version).toBe(2);
    expect(snapshot.list.phase === "ready" && snapshot.list.data[0].row_version).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("private@example.test");
    expect(await store.transition(1, "withdrawn")).toBe(false);
    expect(api.setStatus).not.toHaveBeenCalled();
  });
});
