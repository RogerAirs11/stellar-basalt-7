// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHorseWorkflows, parseWorkflowHorseId, type HorseWorkflowModel, type HorseWorkflowAccess } from "../../src/frontend-kit/domain/horseWorkflows";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { ChangeRequestCreateResponse, ChangeRequestRecord, ClaimCreateResponse, ClaimRecord, PlatformClient } from "../../src/contracts/platform";
import { EliteHorseRequestsPage, EliteHorseClaimPanel } from "../../src/web/frontends/equidata-elite/HorseRequests";
import { WorkflowPage, FeiHorseClaimPanel } from "../../src/web/frontends/fei-classic/workflows";
import type { EquiDataRuntime } from "../../src/web/frontends/equidata-elite/adapter";
import type { ClassicRuntime } from "../../src/web/frontends/fei-classic/adapter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, model: HorseWorkflowModel;
beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const claim = (id = "claim-17", horse_id = 17): ClaimRecord => ({ id, horse_id, status: "pending", created_at: "2026-10-17T12:00:00Z" });
const change = (id = "change-17", status: ChangeRequestRecord["status"] = "pending"): ChangeRequestRecord => ({ id, horse_id: 17, request_type: "update_horse", status, summary: "Correct the birth place", evidence: { note: "Registry source note", document_reference: "preserved-reference" }, items: [{ field_name: "birth_year", old_value: 2010, proposed_value: 2011 }], content_revision: 1, created_at: "2026-10-17T12:00:00Z", updated_at: "2026-10-17T12:00:00Z" });
const claimReceipt = (row = claim()): ClaimCreateResponse => ({ claim: row, workflowEffect: "review_only", canonicalApplied: false });
const changeReceipt = (row = change()): ChangeRequestCreateResponse => ({ request: row, workflowEffect: "review_only", canonicalApplied: false });
const access: HorseWorkflowAccess = { claimRead: true, claimCreate: true, changeRead: true, changeCreate: true };
function api() {
  const claims = { mine: vi.fn(async () => ({ claims: [] as ClaimRecord[] })), create: vi.fn(async (..._args: unknown[]) => claimReceipt()) };
  const changes = { mine: vi.fn(async () => ({ requests: [] as ChangeRequestRecord[] })), create: vi.fn(async (..._args: unknown[]) => changeReceipt()), update: vi.fn(async (..._args: unknown[]) => changeReceipt(change("change-17", "draft"))), submit: vi.fn(async (..._args: unknown[]) => changeReceipt()), withdraw: vi.fn(async (..._args: unknown[]) => changeReceipt(change("change-17", "withdrawn"))) };
  return { platform: { claims, changes } as unknown as PlatformClient, claims, changes };
}
function Probe({ platform, scope = "user:A|p:claims", horseId, permissions = access }: { platform: PlatformClient; scope?: string; horseId?: number; permissions?: HorseWorkflowAccess }) { model = useHorseWorkflows({ platform, scope, horseId, access: permissions, source: "native-test" }); return null; }
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };

describe("R113 shared native ownership and correction lifecycle", () => {
  it.each(["-1", "0", "1.5", "1e3", "0x11", "9007199254740992", "17oops"])("rejects invalid ID %s rather than creating a general request", value => {
    expect(parseWorkflowHorseId(value)).toEqual({ value: null, issue: "horse_invalid" });
  });
  it("accepts Persian/Arabic digits and distinguishes an optional empty ID", () => {
    expect(parseWorkflowHorseId(" ۱۷ ", true)).toEqual({ value: 17, issue: null });
    expect(parseWorkflowHorseId("١٧", true)).toEqual({ value: 17, issue: null });
    expect(parseWorkflowHorseId("")).toEqual({ value: null, issue: null });
    expect(parseWorkflowHorseId("", true).issue).toBe("horse_required");
  });
  it("sends explicit evidence for the selected horse once, then clears only after a valid receipt", async () => {
    const a = api(), gate = deferred<ClaimCreateResponse>(); a.claims.create.mockImplementation(() => gate.promise);
    await render(<Probe platform={a.platform} horseId={17} />);
    act(() => model.setClaimDraft({ evidence: "  My ownership record and sale receipt are available.  " }));
    act(() => { void model.submitClaim(); void model.submitClaim(); });
    expect(a.claims.create).toHaveBeenCalledTimes(1);
    expect(a.claims.create).toHaveBeenCalledWith(17, { note: "My ownership record and sale receipt are available.", source: "native-test" });
    expect(model.claimLocked).toBe(true); expect(model.claimDraft.evidence).toContain("sale receipt");
    const persisted = Object.keys(localStorage).map(key => localStorage.getItem(key)).join("");
    expect(persisted).not.toContain("sale receipt");
    await act(async () => gate.resolve(claimReceipt()));
    expect(model.claimReceipt?.id).toBe("claim-17"); expect(model.claimDraft.evidence).toBe(""); expect(model.claimLocked).toBe(false);
  });
  it("keeps unknown writes locked through failed and stale rereads until a fresh read and explicit acknowledgement", async () => {
    const a = api(); a.claims.create.mockRejectedValue(new PlatformClientError(502, "gateway", "Response lost"));
    await render(<Probe platform={a.platform} horseId={17} />);
    act(() => model.setClaimDraft({ evidence: "Keep this private ownership evidence." }));
    await act(async () => { await model.submitClaim(); });
    expect(model.claimUncertain).toBe(true); expect(model.claimRecoveryReady).toBe(false);
    act(() => model.acknowledgeClaim()); expect(model.claimLocked).toBe(true);
    a.claims.mine.mockRejectedValueOnce(new Error("Claims read is unavailable"));
    await act(async () => model.reloadClaims());
    expect(model.claims.phase).toBe("error"); expect(model.claimRecoveryReady).toBe(false);
    await act(async () => { await model.submitClaim(); }); expect(a.claims.create).toHaveBeenCalledTimes(1);
    const gate = deferred<{ claims: ClaimRecord[] }>(); a.claims.mine.mockImplementationOnce(() => gate.promise);
    act(() => model.reloadClaims()); expect(model.claimRecoveryReady).toBe(false);
    await act(async () => gate.resolve({ claims: [claim()] }));
    expect(model.claimRecoveryReady).toBe(true); expect(model.claimLocked).toBe(true);
    act(() => model.acknowledgeClaim()); expect(model.claimLocked).toBe(false); expect(model.claimDraft.evidence).toContain("private ownership");
  });
  it.each(["missing", "wrong-horse"])("does not report success for a %s ownership receipt", async variant => {
    const a = api(); a.claims.create.mockResolvedValue(variant === "missing" ? {} as ClaimCreateResponse : claimReceipt(claim("wrong", 18)));
    await render(<Probe platform={a.platform} horseId={17} />);
    act(() => model.setClaimDraft({ evidence: "Evidence that must survive a malformed receipt." }));
    await act(async () => { await model.submitClaim(); });
    expect(model.claimUncertain).toBe(true); expect(model.claimReceipt).toBeNull(); expect(model.claimDraft.evidence).toContain("survive");
  });
  it("reopens durable unknown state after remount without storing the private evidence", async () => {
    const a = api(); a.claims.create.mockRejectedValue(new Error("Network interrupted"));
    await render(<Probe platform={a.platform} horseId={17} />);
    act(() => model.setClaimDraft({ evidence: "Private ownership note stays only in this form." }));
    await act(async () => { await model.submitClaim(); });
    await render(null); await render(<Probe platform={a.platform} horseId={17} />);
    expect(model.claimUncertain).toBe(true); expect(model.claimDraft.evidence).toBe(""); expect(model.claimRecoveryReady).toBe(false);
    await act(async () => model.reloadClaims()); expect(model.claimRecoveryReady).toBe(true);
  });
  it("requires an explicit fresh own-list inspection after an existing-active-claim conflict", async () => {
    const a = api(); a.claims.create.mockRejectedValue(new PlatformClientError(409, "claim_exists", "An active claim already exists"));
    await render(<Probe platform={a.platform} horseId={17} />);
    act(() => model.setClaimDraft({ evidence: "Preserve this evidence while inspecting the active claim." }));
    await act(async () => { await model.submitClaim(); });
    expect(model.claimConflict).toBe(true); expect(model.claimLocked).toBe(true); expect(model.claimUncertain).toBe(false);
    await act(async () => { await model.submitClaim(); }); expect(a.claims.create).toHaveBeenCalledOnce();
    a.claims.mine.mockRejectedValueOnce(new Error("Read failed")); await act(async () => model.reloadClaims()); act(() => model.acknowledgeClaim()); expect(model.claimLocked).toBe(true);
    a.claims.mine.mockResolvedValue({ claims: [{ ...claim(), status: "approved" }] }); await act(async () => model.reloadClaims());
    expect(model.claimRecoveryReady).toBe(true); act(() => model.acknowledgeClaim()); expect(model.claimLocked).toBe(false); expect(model.claimDraft.evidence).toContain("Preserve this evidence");
  });
  it("ignores old completions and drafts across principal, permission, and horse switches", async () => {
    const a = api(), gate = deferred<ClaimCreateResponse>(); a.claims.create.mockImplementationOnce(() => gate.promise);
    await render(<Probe platform={a.platform} horseId={17} />);
    act(() => model.setClaimDraft({ evidence: "Private principal A horse 17 evidence." }));
    act(() => { void model.submitClaim(); });
    await render(<Probe platform={a.platform} scope="user:B|p:claims" horseId={18} />);
    expect(model.claimDraft).toEqual({ horseId: "18", evidence: "" });
    act(() => model.setClaimDraft({ evidence: "Principal B horse 18 own evidence." }));
    await act(async () => gate.resolve(claimReceipt()));
    expect(model.claimReceipt).toBeNull(); expect(model.claimDraft.evidence).toContain("Principal B");
    await render(<Probe platform={a.platform} horseId={17} />);
    expect(model.claimDraft.evidence).toBe(""); expect(model.claimReceipt).toBeNull();
    await render(<Probe platform={a.platform} scope="user:A|p:read-only" horseId={17} permissions={{ ...access, claimCreate: false }} />);
    act(() => model.setClaimDraft({ evidence: "Revoked account must not submit evidence." }));
    await act(async () => { await model.submitClaim(); }); expect(a.claims.create).toHaveBeenCalledTimes(1);
  });
  it("retains the exact correction payload and key for recovery without a second intent", async () => {
    const a = api(); a.changes.create.mockRejectedValueOnce(new PlatformClientError(503, "proxy", "Response lost"));
    await render(<Probe platform={a.platform} />);
    act(() => model.setChangeDraft({ horseId: "۱۷", requestType: "update_horse", summary: "Fix the recorded location", evidence: "The original registry extract confirms this location." }));
    await act(async () => { await model.saveCorrection(false); });
    const original = a.changes.create.mock.calls[0]![0];
    expect(original).toMatchObject({ horse_id: 17, request_type: "update_horse", submit: false, evidence: { note: "The original registry extract confirms this location." }, idempotency_key: expect.any(String) });
    act(() => model.setChangeDraft({ summary: "Changed while uncertain" })); expect(model.changeDraft.summary).toBe("Fix the recorded location");
    await act(async () => { await model.retryExactCorrection(); }); expect(a.changes.create).toHaveBeenCalledTimes(1);
    await act(async () => model.reloadChanges()); expect(model.canRetryExactCorrection).toBe(true);
    a.changes.create.mockResolvedValueOnce(changeReceipt(change("change-17", "draft")));
    await act(async () => { await model.retryExactCorrection(); });
    expect(a.changes.create.mock.calls[1]![0]).toEqual(original); expect(model.changeLocked).toBe(false); expect(model.changeDraft.summary).toBe("");
  });
  it("edits a draft without replacing typed field proposals, then submits and withdraws using current records", async () => {
    const a = api(); a.changes.mine.mockResolvedValue({ requests: [change("change-17", "draft")] });
    await render(<Probe platform={a.platform} />);
    act(() => { expect(model.editCorrection(change("change-17", "draft"))).toBe(true); model.setChangeDraft({ summary: "A more precise correction", evidence: "New source explanation" }); });
    await act(async () => { await model.saveCorrection(true); });
    // R148 Task 5: the draft edit carries the content revision the form loaded.
    expect(a.changes.update).toHaveBeenCalledWith("change-17", { expected_content_revision: 1, summary: "A more precise correction", evidence: { note: "New source explanation", document_reference: "preserved-reference" } });
    expect(a.changes.submit).not.toHaveBeenCalled();
    a.changes.mine.mockResolvedValue({ requests: [change()] });
    await act(async () => { await model.transitionCorrection("change-17", "submit"); }); expect(a.changes.submit).toHaveBeenCalledOnce();
    a.changes.mine.mockResolvedValue({ requests: [change("change-17", "withdrawn")] });
    await act(async () => { await model.transitionCorrection("change-17", "withdraw"); }); expect(a.changes.withdraw).toHaveBeenCalledOnce();
    await act(async () => { await model.transitionCorrection("change-17", "submit"); }); expect(a.changes.submit).toHaveBeenCalledOnce();
  });
  it("requires a successful reread before a conflict can be acknowledged, preserving the draft", async () => {
    const a = api(); a.changes.mine.mockResolvedValue({ requests: [change("change-17", "draft")] }); a.changes.update.mockRejectedValue(new PlatformClientError(409, "not_editable", "Another action changed this request"));
    await render(<Probe platform={a.platform} />);
    act(() => model.editCorrection(change("change-17", "draft")));
    await act(async () => { await model.saveCorrection(true); }); expect(model.changeLocked).toBe(true);
    a.changes.mine.mockRejectedValueOnce(new Error("Read failed")); await act(async () => model.reloadChanges());
    act(() => model.acknowledgeCorrection()); expect(model.changeLocked).toBe(true);
    await act(async () => model.reloadChanges()); act(() => model.acknowledgeCorrection()); expect(model.changeLocked).toBe(false); expect(model.changeDraft.summary).toBe("Correct the birth place");
  });
});

const viewFor = (platform: PlatformClient, skin: string) => ({ platform, locale: "en", user: { id: "native-owner", email: "owner@example.test", display_name: "Owner", role: "owner" }, permissions: ["claim.read_own", "claim.create", "change.read_own", "change.create"], capabilities: { claims: true, changes: true, authentication: true }, navigate: vi.fn(), route: `/f/${skin}/claims` });
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
function fill(control: HTMLInputElement | HTMLTextAreaElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); }); }
for (const skin of ["equidata-elite", "fei-classic"]) describe(`${skin} native workflow forms`, () => {
  const page = (platform: PlatformClient) => skin === "equidata-elite" ? <EliteHorseRequestsPage view={viewFor(platform, skin) as unknown as EquiDataRuntime} /> : <WorkflowPage view={viewFor(platform, skin) as unknown as ClassicRuntime} goLocal={() => {}} />;
  const profile = (platform: PlatformClient, id: number) => skin === "equidata-elite" ? <EliteHorseClaimPanel view={viewFor(platform, skin) as unknown as EquiDataRuntime} horseId={id} /> : <FeiHorseClaimPanel view={viewFor(platform, skin) as unknown as ClassicRuntime} horseId={id} />;
  it("surfaces independent read failures without false empty lists", async () => {
    const a = api(); a.claims.mine.mockRejectedValue(new Error("Claims are temporarily unavailable")); a.changes.mine.mockResolvedValue({ requests: [change()] });
    await render(page(a.platform));
    expect(host.textContent).toContain("Claims are temporarily unavailable"); expect(host.textContent).toContain("Correct the birth place");
    expect(host.textContent).not.toContain("No ownership claims");
  });
  it("submits actual profile evidence once and visibly locks an unknown result", async () => {
    const a = api(), gate = deferred<ClaimCreateResponse>(); a.claims.create.mockImplementation(() => gate.promise);
    await render(profile(a.platform, 17));
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[name="evidence"]')!;
    fill(textarea, "This horse belongs to me; please inspect the registry deed.");
    const form = textarea.closest("form")!;
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(a.claims.create).toHaveBeenCalledTimes(1);
    expect(a.claims.create.mock.calls[0]).toEqual([17, { note: "This horse belongs to me; please inspect the registry deed.", source: skin === "equidata-elite" ? "equidata-elite" : "federation-classic" }]);
    await act(async () => gate.reject(new Error("Lost response")));
    expect(host.textContent).toContain("The outcome is unknown"); expect(button("Submit ownership evidence").disabled).toBe(true);
    expect(form.querySelector("fieldset")!.disabled).toBe(true); expect(textarea.value).toContain("registry deed");
    expect(button("Reload my requests")).toBeTruthy();
    await render(profile(a.platform, 18)); expect(host.querySelector<HTMLTextAreaElement>('textarea[name="evidence"]')!.value).toBe("");
  });
  it("rejects invalid correction IDs and keeps a stable accessible textarea name", async () => {
    const a = api(); await render(page(a.platform));
    const form = host.querySelector<HTMLFormElement>('form[id$="correction-form"]')!;
    fill(form.querySelector('textarea[name="summary"]')!, "A proposed correction requiring review");
    fill(form.querySelector('input[name="horse_id"]')!, "9007199254740992");
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(a.changes.create).not.toHaveBeenCalled(); expect(button("Submit correction").disabled).toBe(true);
    const field = form.querySelector<HTMLTextAreaElement>('textarea[name="summary"]')!;
    const namedBy = field.getAttribute("aria-labelledby");
    const label = namedBy ? document.getElementById(namedBy)! : host.querySelector(`label[for="${field.id}"]`)!;
    expect(label.textContent).toBe("Correction summary"); expect(label.textContent).not.toContain(field.value);
    expect(form.querySelector('option[value="create_horse"]')).toBeNull();
  });
});
