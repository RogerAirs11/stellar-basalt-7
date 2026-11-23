// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneticDisclosureHistoryResponse, GeneticTestRecord, HorseGeneticsResponse, PlatformClient } from "../../src/contracts/platform";
import type { GeneticAccessResponse } from "../../src/contracts/professionalAccess";
import { GENETIC_ACCESS_POLICY_VERSION } from "../../src/contracts/professionalAccess";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { GeneticWorkbench } from "../../src/web/shared/GeneticWorkbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const none: GeneticAccessResponse = { horse_id: 7, policy_version: GENETIC_ACCESS_POLICY_VERSION, permissions: [], can_view_private_evidence: false, can_view_verified_health_results: false, can_intake: false, can_review: false, can_publish: false };
const intake: GeneticAccessResponse = { ...none, permissions: ["genetic_intake"], can_intake: true };
const review: GeneticAccessResponse = { ...none, permissions: ["genetic_review", "genetic_evidence_read"], can_view_private_evidence: true, can_review: true };
const publish: GeneticAccessResponse = { ...none, permissions: ["genetic_publish"], can_publish: true };
const test: GeneticTestRecord = { id: 19, test_type: "SCID", test_category: "disease", result: "N/N", result_status: "clear", result_interpretation: "Source interpretation", lab_name: "Synthetic laboratory", lab_accession: "PRIVATE-LAB-ACCESSION-A", tested_at: "2026-10-01", verified: 1, provenance: "user", public_disclosed: 0, notes: "PRIVATE-REPORT-NOTE-A", row_version: 4, review_eligibility: { own_submission: false, legacy_origin_unknown: false }, pairing_review: null };
const genetics: HorseGeneticsResponse = { horse: { id: 7, name_latin: "Synthetic horse", name_native: null, breed_desc: null }, summary: { tested: 1, verified: 1, unverified: 0, clear: 1, carriers: 0, affected: 0, uninterpreted: 0, conflicts: 0, resolvedAssays: 1, unresolvedAssays: 0, unmappedRecords: 0 }, tests: [test] };
const history: GeneticDisclosureHistoryResponse = { test: { id: 19, horse_id: 7, test_type: "SCID", test_category: "disease", verified: 1, public_disclosed: 0 }, effective: { disclosed: false, source: "decision_log", latest_version: 3, materialized_matches: true }, decisions: [] };
function client(access: GeneticAccessResponse = none, source: GeneticTestRecord = test): PlatformClient { return { modules: { genetics: {
  capabilities: vi.fn().mockResolvedValue(access), horse: vi.fn().mockResolvedValue({ ...genetics, tests: [source] }),
  addTest: vi.fn().mockResolvedValue({ test: { id: 20, horse_id: 7, verified: 0, public_disclosed: 0, row_version: 1 }, operation_id: "receipt", replayed: false }),
  interpret: vi.fn().mockResolvedValue({ review: { operation_id: "receipt", test_id: 19, horse_id: 7, row_version: 5, verified: 1, result_status: "clear", interpretation_version: "review-v1", verification_scope: "record_review_not_issuer_attestation", scope: "recorded_genotype_only", clinical_diagnosis: false, publication_withdrawn: false }, operation_id: "receipt", replayed: false }),
  reviewPairing: vi.fn().mockResolvedValue({ review: { test_id: 19, assay_key: "SCID", review_state: "accepted", row_version: 1, expires_at: null, reviewed_at: "2026-10-28T00:00:00Z" } }),
  reviewHistory: vi.fn().mockResolvedValue({ test: { id: 19, horse_id: 7, row_version: 4, verified: 1 }, decisions: [], limit: 200, truncated: false }),
  disclosureHistory: vi.fn().mockResolvedValue(history), setDisclosure: vi.fn().mockResolvedValue({ test: { ...history.test, public_disclosed: 1 }, changed: true, decision_version: 4 }),
} } } as unknown as PlatformClient; }
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function mount(platform: PlatformClient, scope = "professional-a", horseId = 7) { await act(async () => root.render(<GeneticWorkbench platform={platform} horseId={horseId} scope={scope} locale="en" />)); }
async function click(text: string) { await act(async () => { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent === text); expect(button).toBeTruthy(); button!.click(); }); }
async function change(name: string, value: string) { await act(async () => { const input = container.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }
async function check(name: string) { await act(async () => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.click()); }
async function submit(name: string) { await act(async () => container.querySelector(`[name="${name}"]`)!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function open(platform: PlatformClient) { await mount(platform); await click("Check my access for this horse"); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function preparePublication() { await change("publication_test_id", "19"); await change("genetic_publication", "publish"); await change("publication_basis", "staff_publication"); await change("publication_reason", "Documented publication review"); await check("publication_confirm"); }

describe("R148 assigned genetic evidence workflow", () => {
  it("does not infer genetic authority from login and makes a write-only intake without reading private reports", async () => {
    const platform = client(intake); await mount(platform);
    expect(platform.modules.genetics.capabilities).not.toHaveBeenCalled();
    await click("Check my access for this horse");
    expect(platform.modules.genetics.horse).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("PRIVATE-REPORT-NOTE-A");
    expect(container.querySelector('[name="genetic_test_choice"]')).toBeNull();
    await change("intake_test_type", "SCID"); await change("intake_result", "N/N"); await change("intake_notes", "Exact report reference #14"); await submit("intake_result");
    expect(platform.modules.genetics.addTest).toHaveBeenCalledWith(7, expect.objectContaining({ test_type: "SCID", result: "N/N", operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const payload = vi.mocked(platform.modules.genetics.addTest).mock.calls[0][1];
    expect(payload).not.toHaveProperty("verified"); expect(payload).not.toHaveProperty("public_disclosed");
    expect(container.textContent).toContain("received privately, pending independent review");
    expect(platform.modules.genetics.horse).not.toHaveBeenCalled();
  });

  it("retries an ambiguous intake with the identical operation ID and payload", async () => {
    const platform = client(intake); vi.mocked(platform.modules.genetics.addTest).mockRejectedValueOnce(new Error("Response lost after insert"));
    await open(platform); await change("intake_test_type", "SCID"); await change("intake_result", "N/N"); await submit("intake_result");
    expect(container.textContent).toContain("Do not prepare a duplicate submission");
    expect(container.querySelector('[name="intake_test_type"]')).toBeNull();
    await click("Retry the same saved operation");
    const calls = vi.mocked(platform.modules.genetics.addTest).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1]);
    expect(container.textContent).toContain("received privately, pending independent review");
  });

  it("requires independent origin and explicit legacy acknowledgment for a positive record confirmation", async () => {
    const platform = client(review, { ...test, verified: 0, review_eligibility: { own_submission: false, legacy_origin_unknown: true } });
    await open(platform); await change("genetic_test_choice", "19"); await change("genetic_verification", "confirm_record");
    await change("genetic_review_evidence", "Independently checked report #7"); await change("genetic_review_reason", "Rechecked reported exact assay");
    await submit("genetic_review_reason"); expect(platform.modules.genetics.interpret).not.toHaveBeenCalled();
    await check("legacy_origin_acknowledged"); await submit("genetic_review_reason");
    expect(platform.modules.genetics.interpret).toHaveBeenCalledWith(19, expect.objectContaining({ expected_version: 4, verification: "confirm_record", evidence_ref: "Independently checked report #7", legacy_origin_acknowledged: true, operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }), expect.anything());
    expect(container.textContent).toContain("Review saved for test #19, revision 5");
  });

  it("blocks positive self-review but allows withdrawal without changing the recorded genotype", async () => {
    const platform = client(review, { ...test, review_eligibility: { own_submission: true, legacy_origin_unknown: false } });
    await open(platform); await change("genetic_test_choice", "19"); await change("genetic_review_reason", "Withdraw for source investigation");
    await submit("genetic_review_reason"); expect(platform.modules.genetics.interpret).not.toHaveBeenCalled();
    expect((container.querySelector('[name="genetic_result_status"]') as unknown as HTMLSelectElement).disabled).toBe(true);
    await change("genetic_verification", "withdraw"); await submit("genetic_review_reason");
    expect(platform.modules.genetics.interpret).toHaveBeenCalledWith(19, expect.objectContaining({ verification: "withdraw", result_status: "clear" }), expect.anything());
  });

  it("binds pairing review to the exact source revision and raw assay/result, reusing the operation on retry", async () => {
    const platform = client(review); vi.mocked(platform.modules.genetics.reviewPairing).mockRejectedValueOnce(new Error("Ambiguous mapping response"));
    await open(platform); await change("genetic_test_choice", "19"); await change("pairing_assay", "SCID"); await change("pairing_reason", "Independent exact-variant verification"); await submit("pairing_reason");
    await click("Retry the same saved operation");
    const calls = vi.mocked(platform.modules.genetics.reviewPairing).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1]);
    expect(calls[0][1]).toMatchObject({ assay_key: "SCID", expected_version: 0, expected_test_version: 4, expected_test_type: "SCID", expected_result: "N/N", state: "accepted" });
  });

  it("blocks missing private review metadata and removes evidence immediately after a rejected authority check", async () => {
    const platform = client(review, { ...test, row_version: undefined, review_eligibility: undefined });
    await open(platform); await change("genetic_test_choice", "19"); await change("genetic_review_reason", "A review must have a valid version");
    await submit("genetic_review_reason"); expect(platform.modules.genetics.interpret).not.toHaveBeenCalled();
    vi.mocked(platform.modules.genetics.horse).mockResolvedValue(genetics); await click("Reload access and evidence");
    await change("genetic_review_reason", "Independent source review complete");
    vi.mocked(platform.modules.genetics.interpret).mockRejectedValueOnce(new PlatformClientError(403, "genetic_grant_revoked", "Assignment revoked"));
    await submit("genetic_review_reason");
    expect(container.textContent).toContain("Assignment revoked"); expect(container.textContent).not.toContain("PRIVATE-REPORT-NOTE-A");
    expect(container.textContent).not.toContain("Retry the same saved operation");
    vi.mocked(platform.modules.genetics.capabilities).mockResolvedValue(none); await click("Reload access and evidence");
    expect(container.textContent).toContain("No current genetic evidence access"); expect(container.querySelector("form")).toBeNull();
  });

  it("reconciles ambiguous publication only against the same test's loaded current history, without repeating the write", async () => {
    const platform = client(publish); vi.mocked(platform.modules.genetics.setDisclosure).mockRejectedValueOnce(new Error("Publication response lost"));
    await open(platform); await preparePublication(); await submit("publication_reason");
    expect(platform.modules.genetics.horse).not.toHaveBeenCalled();
    expect(vi.mocked(platform.modules.genetics.setDisclosure).mock.calls[0][1]).toMatchObject({ public_disclosed: true, expected_decision_version: 3 });
    expect(container.textContent).not.toContain("Retry the same saved operation");
    vi.mocked(platform.modules.genetics.disclosureHistory).mockRejectedValueOnce(new Error("History read failed"));
    await click("Reload access and evidence");
    expect(container.textContent).not.toContain("I have checked the publication history");
    vi.mocked(platform.modules.genetics.disclosureHistory).mockResolvedValueOnce({ ...history, effective: { ...history.effective, disclosed: true, latest_version: 4 }, test: { ...history.test, public_disclosed: 1 } });
    await click("Reload publication history");
    expect(container.textContent).toContain("I have checked the publication history");
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="publication_reason"]')!.closest("fieldset")!.disabled).toBe(true);
    await click("I have checked the publication history");
    expect(platform.modules.genetics.setDisclosure).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("publication decision is currently active");
  });

  it("rejects publication history for a different horse before enabling any decision", async () => {
    const platform = client(publish); vi.mocked(platform.modules.genetics.disclosureHistory).mockResolvedValue({ ...history, test: { ...history.test, horse_id: 8 } });
    await open(platform); await change("publication_test_id", "19");
    expect(container.textContent).toContain("belongs to a different horse");
    expect(container.querySelector('[name="publication_reason"]')).toBeNull();
    expect(platform.modules.genetics.setDisclosure).not.toHaveBeenCalled();
  });

  it("drops the old principal's private evidence and pending read when the account or horse changes", async () => {
    const platform = client(review); await open(platform); await change("genetic_test_choice", "19");
    expect(container.textContent).toContain("PRIVATE-LAB-ACCESSION-A");
    const pending = deferred<HorseGeneticsResponse>(); vi.mocked(platform.modules.genetics.horse).mockImplementationOnce(() => pending.promise);
    await click("Reload access and evidence"); const signal = vi.mocked(platform.modules.genetics.horse).mock.calls.at(-1)![1]!.signal!;
    await mount(platform, "professional-b"); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(genetics)); expect(container.textContent).not.toContain("PRIVATE-REPORT-NOTE-A");
    expect(container.querySelector('[name="genetic_test_choice"]')).toBeNull();
    await mount(platform, "professional-a", 8); expect(container.textContent).not.toContain("PRIVATE-LAB-ACCESSION-A");
    expect(container.textContent).toContain("Check my access for this horse");
  });

  it("preserves the successful review receipt even when the refreshed evidence cannot be read", async () => {
    const platform = client(review); await open(platform); await change("genetic_test_choice", "19"); await change("genetic_review_reason", "Independent report source checked");
    vi.mocked(platform.modules.genetics.capabilities).mockRejectedValueOnce(new Error("Refresh unavailable"));
    await submit("genetic_review_reason");
    expect(container.textContent).toContain("Review saved for test #19"); expect(container.textContent).toContain("Refresh unavailable");
    expect(container.textContent).not.toContain("operation may have completed");
  });
});
