// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDirectoryClaimFlow, type ProfileEditorPlatform } from "../../src/frontend-kit/domain/profileEditor";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { HeritageProfileWorkbench } from "../../src/web/heritage/ProfileWorkbench";
import { I18nProvider } from "../../src/web/i18n";
import type { PlatformClient } from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const input = { claim_type: "person" as const, person_id: 42, evidence_note: "My actual evidence for review." };
const receipt = { claim: { id: 123, person_id: 42, claim_type: "person", status: "pending" }, note: "Submitted for review." };
const makePlatform = (submitClaim: (...args: unknown[]) => Promise<unknown>, claims: Array<Record<string, unknown>> = []) => ({ modules: { directory: {
  submitClaim, myClaims: async () => ({ claims }), managedProfile: async () => ({ profile: null, permissions: { edit: false, private_contact: false, initial_publication: false } }),
} } }) as unknown as ProfileEditorPlatform;
let flow: ReturnType<typeof useDirectoryClaimFlow>;
function Probe({ platform, scope }: { platform: ProfileEditorPlatform; scope: string }) { flow = useDirectoryClaimFlow(platform, scope); return <p>{flow.state.phase}</p>; }
const render = async (view: React.ReactElement) => { await act(async () => { root.render(view); }); };
const setValue = (control: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (text: string) => [...element.querySelectorAll("button")].find(node => node.textContent === text)!;

describe("R112 directory claim submission guards", () => {
  it("suppresses duplicate events and cannot unlock an in-flight request with reset", async () => {
    const pending = deferred<unknown>(); const submit = vi.fn(() => pending.promise);
    await render(<Probe platform={makePlatform(submit)} scope="A" />);
    act(() => { flow.submitClaim(input); flow.reset(); flow.submitClaim(input); });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(flow.state.phase).toBe("submitting");
    await act(async () => pending.resolve(receipt));
    expect(flow.state.phase).toBe("submitted");
  });
  it("keeps a gateway failure unknown and blocks another write until explicit reconciliation", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new PlatformClientError(502, "gateway", "Response was lost")).mockResolvedValue(receipt);
    await render(<Probe platform={makePlatform(submit)} scope="A" />);
    await act(async () => flow.submitClaim(input));
    expect(flow.state.phase).toBe("failed");
    await act(async () => flow.submitClaim(input));
    expect(submit).toHaveBeenCalledTimes(1);
    act(() => flow.reset());
    await act(async () => flow.submitClaim(input));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(flow.state.phase).toBe("submitted");
  });
  it("preserves a known validation refusal as rejected and allows corrected submission", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new PlatformClientError(422, "evidence_required", "Evidence required")).mockResolvedValue(receipt);
    await render(<Probe platform={makePlatform(submit)} scope="A" />);
    await act(async () => flow.submitClaim(input));
    expect(flow.state.phase).toBe("rejected");
    await act(async () => flow.submitClaim({ ...input, evidence_note: "Additional actual evidence." }));
    expect(submit).toHaveBeenCalledTimes(2);
  });
  it("rejects stale handlers and ignores late A completion after switching to B", async () => {
    const pending = deferred<unknown>(); const submit = vi.fn(() => pending.promise); const platform = makePlatform(submit);
    await render(<Probe platform={platform} scope="A" />);
    const oldSubmit = flow.submitClaim;
    act(() => oldSubmit(input));
    await render(<Probe platform={platform} scope="B" />);
    act(() => oldSubmit(input));
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(receipt));
    expect(flow.state.phase).toBe("idle");
  });
  it("treats an unreadable success receipt as uncertain instead of inventing a claim ID", async () => {
    const submit = vi.fn(async () => ({ claim: {}, note: "ok" }));
    await render(<Probe platform={makePlatform(submit)} scope="A" />);
    await act(async () => flow.submitClaim(input));
    expect(flow.state.phase).toBe("failed");
    await act(async () => flow.submitClaim(input));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("R112 native Core claim form", () => {
  it("submits the selected person's real ID and the user's evidence", async () => {
    const submit = vi.fn(async () => receipt);
    await render(<I18nProvider locale="en"><HeritageProfileWorkbench personId={42} platform={makePlatform(submit) as unknown as PlatformClient} /></I18nProvider>);
    expect(element.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("42");
    act(() => setValue(element.querySelector("textarea")!, "  My actual relationship evidence.  "));
    await act(async () => button("Submit claim for moderation").click());
    expect(submit).toHaveBeenCalledWith({ claim_type: "person", person_id: 42, evidence_note: "My actual relationship evidence." });
  });
  it("gives the claim center an ID field and does not display a perpetual profile loader", async () => {
    const submit = vi.fn(async () => receipt);
    await render(<I18nProvider locale="en"><HeritageProfileWorkbench personId={null} platform={makePlatform(submit) as unknown as PlatformClient} /></I18nProvider>);
    expect(element.textContent).not.toContain("Loading the manageable profile");
    act(() => setValue(element.querySelector("textarea")!, "My evidence to establish representation."));
    expect(button("Submit claim for moderation").disabled).toBe(true);
    act(() => setValue(element.querySelector<HTMLInputElement>('input[type="number"]')!, "42"));
    await act(async () => button("Submit claim for moderation").click());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ person_id: 42 }));
  });
  it("requires supplied evidence for an appeal instead of fabricating it", async () => {
    const submit = vi.fn(async () => receipt);
    const platform = makePlatform(submit, [{ id: 9, person_id: 42, claim_type: "person", status: "rejected" }]);
    await render(<I18nProvider locale="en"><HeritageProfileWorkbench personId={null} platform={platform as unknown as PlatformClient} /></I18nProvider>);
    expect(button("Appeal once").disabled).toBe(true);
    act(() => setValue(element.querySelector("textarea")!, "These are my additional appeal facts."));
    await act(async () => button("Appeal once").click());
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ person_id: 42, evidence_note: "These are my additional appeal facts.", appeal_for_claim_id: 9 }));
  });
});
