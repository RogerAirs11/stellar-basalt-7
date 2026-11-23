// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformClientError, useHorseReviewQueue, type AdminClaimRecord, type ChangeRequestRecord, type ClaimReviewResponse, type ChangeRequestReviewResponse, type FrontendRuntimeProps, type HorseReviewKind, type PlatformClient } from "../../src/frontend-kit";
import { EliteReviewQueue } from "../../src/web/frontends/equidata-elite/ReviewQueue";
import { FeiReviewQueue } from "../../src/web/frontends/fei-classic/ReviewQueue";
import type { ClassicRuntime } from "../../src/web/frontends/fei-classic/adapter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, model: ReturnType<typeof useHorseReviewQueue>;
beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const claim = (): AdminClaimRecord => ({ id: "claim-review-17", horse_id: 17, person_id: 41, status: "pending", created_at: "2026-10-17", claimant: "Claimant", name_latin: "Test Horse", evidence: { note: "A private ownership deed is available.", source: "native" } });
const correction = (): ChangeRequestRecord => ({ id: "change-review-17", horse_id: 17, status: "pending", request_type: "update_horse", summary: "Correct the birth year", created_at: "2026-10-17", updated_at: "2026-10-17", evidence: { note: "The birth record confirms the date." }, items: [{ field_name: "birth_year", old_value: 2010, proposed_value: 2011 }] });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function api() {
  const admin = {
    claims: vi.fn(async () => ({ claims: [claim()] })),
    changeRequests: vi.fn(async () => ({ requests: [correction()] })),
    reviewClaim: vi.fn(async (..._args: unknown[]): Promise<ClaimReviewResponse> => ({ claim: { ...claim(), status: "approved" }, workflowEffect: "canonical_owner_link", canonicalApplied: true, accessGranted: true })),
    reviewChangeRequest: vi.fn(async (..._args: unknown[]): Promise<ChangeRequestReviewResponse> => ({ request: { ...correction(), status: "draft", review_status: "needs_changes" }, workflowEffect: "review_only", canonicalApplied: false })),
  };
  return { platform: { admin } as unknown as PlatformClient, admin };
}
function Probe({ platform, kind = "claim", scope = "reviewer:A", enabled = true }: { platform: PlatformClient; kind?: HorseReviewKind; scope?: string; enabled?: boolean }) { model = useHorseReviewQueue({ platform, kind, scope, enabled }); return null; }

describe("R113 permission-scoped horse review lifecycle", () => {
  it("requires a real reason and current record, sends one decision, and retains truthful canonical effects", async () => {
    const a = api(), gate = deferred<ClaimReviewResponse>(); a.admin.reviewClaim.mockImplementationOnce(() => gate.promise);
    await render(<Probe platform={a.platform} />);
    expect(model.canReview("claim-review-17")).toBe(false);
    act(() => model.setNote("claim-review-17", "  Verified the registry and deed.  "));
    await act(async () => { expect(await model.review("not-a-record", "approved")).toBe(false); });
    act(() => { void model.review("claim-review-17", "approved"); void model.review("claim-review-17", "approved"); });
    expect(a.admin.reviewClaim).toHaveBeenCalledOnce(); expect(a.admin.reviewClaim).toHaveBeenCalledWith("claim-review-17", "approved", "Verified the registry and deed.");
    expect(Object.keys(localStorage).map(key => localStorage.getItem(key)).join("")).not.toContain("Verified the registry");
    await act(async () => gate.resolve({ claim: { ...claim(), status: "approved" }, workflowEffect: "canonical_owner_link", canonicalApplied: true, accessGranted: true }));
    expect(model.receipt).toMatchObject({ id: "claim-review-17", status: "approved", canonicalApplied: true, accessGranted: true }); expect(model.notes["claim-review-17"]).toBeUndefined();
  });
  it("holds unknown and conflicting decisions through failed reads and only unlocks after fresh read plus acknowledgement", async () => {
    const a = api(); a.admin.reviewClaim.mockRejectedValueOnce(new PlatformClientError(502, "gateway", "Review response lost"));
    await render(<Probe platform={a.platform} />); act(() => model.setNote("claim-review-17", "Keep this reviewer reason."));
    await act(async () => { await model.review("claim-review-17", "approved"); });
    expect(model.uncertain).toBe(true); act(() => model.acknowledge()); expect(model.locked).toBe(true);
    a.admin.claims.mockRejectedValueOnce(new Error("Protected read failed")); await act(async () => model.reload());
    expect(model.rows.phase).toBe("error"); expect(model.recoveryReady).toBe(false);
    await act(async () => { await model.review("claim-review-17", "approved"); }); expect(a.admin.reviewClaim).toHaveBeenCalledOnce();
    await act(async () => model.reload()); expect(model.recoveryReady).toBe(true); expect(model.locked).toBe(true);
    act(() => model.acknowledge()); expect(model.locked).toBe(false); expect(model.notes["claim-review-17"]).toContain("reviewer reason");
    a.admin.reviewClaim.mockRejectedValueOnce(new PlatformClientError(409, "claim_closed", "Another reviewer decided"));
    await act(async () => { await model.review("claim-review-17", "approved"); }); expect(model.conflict).toBe(true); expect(model.recoveryReady).toBe(false);
  });
  it("blocks a malformed receipt, preserves a coarse marker across remount, and never persists a reason", async () => {
    const a = api(); a.admin.reviewClaim.mockResolvedValueOnce({ claim: { ...claim(), id: "other-claim", status: "approved" }, workflowEffect: "review_only", canonicalApplied: false });
    await render(<Probe platform={a.platform} />); act(() => model.setNote("claim-review-17", "This private reason stays in memory."));
    await act(async () => { await model.review("claim-review-17", "approved"); }); expect(model.receipt).toBeNull(); expect(model.uncertain).toBe(true);
    await render(null); await render(<Probe platform={a.platform} />);
    expect(model.locked).toBe(true); expect(model.notes).toEqual({}); expect(model.recoveryReady).toBe(false);
    await act(async () => model.reload()); act(() => model.acknowledge()); expect(model.locked).toBe(false);
  });
  it("masks protected evidence and late decision feedback after principal or permission changes", async () => {
    const a = api(), gate = deferred<ClaimReviewResponse>(); a.admin.reviewClaim.mockImplementationOnce(() => gate.promise);
    await render(<Probe platform={a.platform} />); act(() => model.setNote("claim-review-17", "Private reason from reviewer A.")); act(() => { void model.review("claim-review-17", "approved"); });
    await render(<Probe platform={a.platform} scope="reviewer:B" enabled={false} />);
    expect(model.rows.phase).toBe("idle"); expect(model.notes).toEqual({});
    await act(async () => gate.resolve({ claim: { ...claim(), status: "approved" }, workflowEffect: "review_only", canonicalApplied: false }));
    expect(model.receipt).toBeNull(); expect(model.command.phase).toBe("idle");
    await act(async () => { await model.review("claim-review-17", "approved"); }); expect(a.admin.reviewClaim).toHaveBeenCalledOnce();
  });
  it("returns a correction to draft with an explicit changes-requested reason", async () => {
    const a = api(); await render(<Probe platform={a.platform} kind="change" />);
    act(() => model.setNote("change-review-17", "Please attach the dated registry source."));
    await act(async () => { await model.review("change-review-17", "needs_changes"); });
    expect(a.admin.reviewChangeRequest).toHaveBeenCalledWith("change-review-17", "needs_changes", "Please attach the dated registry source."); expect(model.receipt?.status).toBe("draft"); expect(model.receipt?.canonicalApplied).toBe(false);
  });
});

const nativeView = (platform: PlatformClient, user = "reviewer") => ({ platform, locale: "en", user: { id: user, email: "staff@example.test", role: "admin", display_name: user }, permissions: ["claim.review", "change.review"], capabilities: { admin: true }, navigate: vi.fn() });
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
function fill(value: string) { const control = host.querySelector("textarea")!; act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); }); }
for (const skin of ["elite", "fei"]) describe(`R113 ${skin} native protected reviews`, () => {
  const page = (platform: PlatformClient, kind: HorseReviewKind = "claim") => skin === "elite" ? <EliteReviewQueue runtime={nativeView(platform) as unknown as FrontendRuntimeProps} kind={kind} /> : <FeiReviewQueue view={nativeView(platform) as unknown as ClassicRuntime} kind={kind} />;
  it("renders real evidence and uses an accessible inline reason before any decision", async () => {
    const a = api(); await render(page(a.platform));
    expect(host.textContent).toContain("A private ownership deed is available."); expect(host.textContent).toContain("#41"); expect(button("Approve request").disabled).toBe(true);
    fill("The deed matches the registry.");
    const control = host.querySelector("textarea")!;
    const label = control.hasAttribute("aria-labelledby") ? host.querySelector(`[id="${control.getAttribute("aria-labelledby")}"]`) : host.querySelector(`label[for="${control.id}"]`);
    expect(label?.textContent).toBe("Review reason");
    await act(async () => button("Approve request").click());
    expect(a.admin.reviewClaim).toHaveBeenCalledWith("claim-review-17", "approved", "The deed matches the registry."); expect(host.textContent).toContain("Review recorded");
    expect(host.textContent).not.toContain("approval remains review-only");
  });
  it("never turns a failed queue read into empty success and lets staff retry", async () => {
    const a = api(); a.admin.claims.mockRejectedValueOnce(new Error("Protected review data unavailable")); await render(page(a.platform));
    expect(host.textContent).toContain("Protected review data unavailable"); expect(host.textContent).not.toContain("No requests were returned");
    await act(async () => button("Retry queue").click()); expect(host.textContent).toContain("A private ownership deed is available.");
  });
  it("shows typed changes and exposes the supported request-changes action", async () => {
    const a = api(); await render(page(a.platform, "change")); expect(host.textContent).toContain("2010"); expect(host.textContent).toContain("2011");
    fill("Provide a clearer copy of the birth certificate."); await act(async () => button("Request changes").click());
    expect(a.admin.reviewChangeRequest).toHaveBeenCalledWith("change-review-17", "needs_changes", "Provide a clearer copy of the birth certificate.");
  });
});
