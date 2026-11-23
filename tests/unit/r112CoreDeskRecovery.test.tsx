// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryDeskPage } from "../../src/web/heritage/RegistryDeskPage";
import { I18nProvider } from "../../src/web/i18n";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { principalScopeKey } from "../../src/frontend-kit/domain/principalScope";
import type {
  ChangeRequestCreateResponse,
  ChangeRequestRecord,
  ChangeRequestsMineResponse,
  PlatformClient,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const permissions: PlatformPermission[] = ["change.read_own", "change.create"];
const meta = { capabilities: { change_requests: true, people: false, quality_summary: false, owner_claims: false } } as PlatformMetaResponse;
const user = (id: string): PlatformUser => ({ id, display_name: id, email: `${id}@example.test`, role: "owner" });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const request = (id: string, summary = "Accepted correction returned by the registry"): ChangeRequestRecord => ({
  id, horse_id: 17, request_type: "update_horse", summary, status: "pending", items: [],
  created_at: "2026-10-17T12:00:00Z", updated_at: "2026-10-17T12:00:00Z",
});
const receipt = (record: ChangeRequestRecord): ChangeRequestCreateResponse => ({ request: record, workflowEffect: "review_only", canonicalApplied: false });
const makePlatform = (
  create: PlatformClient["changes"]["create"],
  mine: PlatformClient["changes"]["mine"],
) => ({ changes: { create, mine } }) as PlatformClient;

// Match the actual Core content boundary in main.tsx: every principal or
// permission transition remounts its private pages, even on A -> B -> A.
async function render(platform: PlatformClient, principal = "A") {
  const account = user(principal);
  await act(async () => {
    root.render(<I18nProvider locale="en"><div key={principalScopeKey(account, permissions)}>
      <RegistryDeskPage platform={platform} platformMeta={meta} user={account} permissions={permissions} navigate={() => {}} />
    </div></I18nProvider>);
  });
}
const form = () => container.querySelector<HTMLFormElement>(".desk-change-form")!;
const summary = () => form().querySelector<HTMLTextAreaElement>("textarea")!;
const horse = () => form().querySelector<HTMLInputElement>("input")!;
const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent === label);
const acknowledgement = () => button("I checked my requests; allow another submission");
const changesPanel = () => container.querySelector<HTMLElement>(".desk-changes")!;
function setValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}
function fill(text: string, horseId = "17") {
  act(() => { setValue(summary(), text); setValue(horse(), horseId); });
}
function dispatchSubmit() { form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
function expectLocked(text: string) {
  expect(submitButton().disabled).toBe(true);
  expect(summary().disabled).toBe(true);
  expect(horse().disabled).toBe(true);
  expect(summary().value).toBe(text);
}

describe("R112 Core registry correction recovery", () => {
  it("suppresses duplicate submissions and clears the draft only after acceptance", async () => {
    const pending = deferred<ChangeRequestCreateResponse>();
    const saved = request("saved-1");
    const create = vi.fn(() => pending.promise);
    const mine = vi.fn<PlatformClient["changes"]["mine"]>()
      .mockResolvedValueOnce({ requests: [] })
      .mockResolvedValue({ requests: [saved] });
    await render(makePlatform(create, mine));
    fill("  Correct the recorded birth year using the attached source.  ");

    // Both events run before React can disable the button; the command flight
    // itself must prevent the second POST rather than relying on disabled UI.
    act(() => { dispatchSubmit(); dispatchSubmit(); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ horse_id: 17, request_type: "update_horse", summary: "Correct the recorded birth year using the attached source." });
    expectLocked("  Correct the recorded birth year using the attached source.  ");
    expect(mine).toHaveBeenCalledTimes(1);
    expect(changesPanel().textContent).not.toContain("Request submitted for review.");

    await act(async () => pending.resolve(receipt(saved)));
    expect(summary().value).toBe("");
    expect(horse().value).toBe("");
    expect(submitButton().disabled).toBe(false);
    expect(changesPanel().textContent).toContain("Request submitted for review.");
    expect(changesPanel().querySelector(".desk-claim-list")!.textContent).toContain(saved.summary);
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it("keeps an unknown write locked through pending and failed rereads until a successful read and explicit acknowledgement", async () => {
    const firstRead = deferred<ChangeRequestsMineResponse>();
    const secondRead = deferred<ChangeRequestsMineResponse>();
    const create = vi.fn<PlatformClient["changes"]["create"]>()
      .mockRejectedValue(new PlatformClientError(502, "gateway", "The write response was lost"));
    const mine = vi.fn<PlatformClient["changes"]["mine"]>()
      .mockResolvedValueOnce({ requests: [request("previous", "Earlier unrelated correction")] })
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    await render(makePlatform(create, mine));
    fill("Preserve this uncertain correction and its evidence.");
    await act(async () => dispatchSubmit());
    expectLocked("Preserve this uncertain correction and its evidence.");
    expect(changesPanel().textContent).toContain("The outcome is unknown");
    expect(acknowledgement()).toBeUndefined();

    await act(async () => button("Reload record")!.click());
    expect(mine).toHaveBeenCalledTimes(2);
    expectLocked("Preserve this uncertain correction and its evidence.");
    expect(acknowledgement()).toBeUndefined();
    expect(changesPanel().textContent).toContain("Refreshing; displayed data may be stale.");
    await act(async () => dispatchSubmit());
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => firstRead.reject(new Error("The request list is temporarily unavailable")));
    expectLocked("Preserve this uncertain correction and its evidence.");
    expect(acknowledgement()).toBeUndefined();
    expect(changesPanel().textContent).toContain("The request list is temporarily unavailable");
    expect(changesPanel().textContent).not.toContain("No change requests submitted yet.");
    await act(async () => dispatchSubmit());
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => button("Reload record")!.click());
    expect(mine).toHaveBeenCalledTimes(3);
    expectLocked("Preserve this uncertain correction and its evidence.");
    expect(acknowledgement()).toBeUndefined();
    const found = request("recovered", "The first correction was recorded despite the lost response");
    await act(async () => secondRead.resolve({ requests: [found] }));
    expect(changesPanel().querySelector(".desk-claim-list")!.textContent).toContain(found.summary);
    expectLocked("Preserve this uncertain correction and its evidence.");
    expect(acknowledgement()).toBeDefined();
    await act(async () => dispatchSubmit());
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => acknowledgement()!.click());
    expect(submitButton().disabled).toBe(false);
    expect(summary().value).toBe("Preserve this uncertain correction and its evidence.");
    expect(horse().value).toBe("17");
    expect(create).toHaveBeenCalledTimes(1);
    expect(acknowledgement()).toBeUndefined();
  });

  it("accepts a completed empty reread as reconciliation but never treats the old empty snapshot as sufficient", async () => {
    const read = deferred<ChangeRequestsMineResponse>();
    const create = vi.fn<PlatformClient["changes"]["create"]>()
      .mockRejectedValue(new Error("Connection interrupted after submission"));
    const mine = vi.fn<PlatformClient["changes"]["mine"]>()
      .mockResolvedValueOnce({ requests: [] })
      .mockImplementationOnce(() => read.promise);
    await render(makePlatform(create, mine));
    fill("Retain this correction while the result is checked.");
    await act(async () => dispatchSubmit());
    expect(acknowledgement()).toBeUndefined();
    await act(async () => button("Reload record")!.click());
    expectLocked("Retain this correction while the result is checked.");
    expect(acknowledgement()).toBeUndefined();

    await act(async () => read.resolve({ requests: [] }));
    expect(changesPanel().textContent).toContain("No change requests submitted yet.");
    expectLocked("Retain this correction while the result is checked.");
    expect(acknowledgement()).toBeDefined();
    await act(async () => acknowledgement()!.click());
    expect(submitButton().disabled).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it("preserves editable draft fields after a known rejection and clears them after the corrected request is accepted", async () => {
    const accepted = deferred<ChangeRequestCreateResponse>();
    const create = vi.fn<PlatformClient["changes"]["create"]>()
      .mockRejectedValueOnce(new PlatformClientError(422, "evidence_required", "The source reference is required"))
      .mockImplementationOnce(() => accepted.promise);
    const mine = vi.fn<PlatformClient["changes"]["mine"]>().mockResolvedValue({ requests: [] });
    await render(makePlatform(create, mine));
    fill("The existing birth year needs correction.");
    await act(async () => dispatchSubmit());
    expect(changesPanel().textContent).toContain("The source reference is required");
    expect(changesPanel().textContent).not.toContain("The outcome is unknown");
    expect(summary().value).toBe("The existing birth year needs correction.");
    expect(horse().value).toBe("17");
    expect(submitButton().disabled).toBe(false);
    expect(acknowledgement()).toBeUndefined();

    fill("Correct the birth year using archive source number 128.");
    act(() => dispatchSubmit());
    expect(create).toHaveBeenCalledTimes(2);
    expectLocked("Correct the birth year using archive source number 128.");
    await act(async () => accepted.resolve(receipt(request("corrected"))));
    expect(summary().value).toBe("");
    expect(horse().value).toBe("");
    expect(changesPanel().textContent).toContain("Request submitted for review.");
  });

  it("cannot clear a new principal's draft or refresh their requests when an old A submission completes after A -> B -> A", async () => {
    const pending = deferred<ChangeRequestCreateResponse>();
    const create = vi.fn(() => pending.promise);
    const mine = vi.fn<PlatformClient["changes"]["mine"]>().mockResolvedValue({ requests: [] });
    const platform = makePlatform(create, mine);
    await render(platform, "A");
    fill("A's first submission.");
    act(() => dispatchSubmit());
    await render(platform, "B");
    expect(summary().value).toBe("");
    expect(horse().value).toBe("");
    expect(submitButton().disabled).toBe(false);
    await render(platform, "A");
    fill("A's new unsent draft must survive the old response.", "29");
    expect(mine).toHaveBeenCalledTimes(3);

    await act(async () => pending.resolve(receipt(request("old-A"))));
    expect(summary().value).toBe("A's new unsent draft must survive the old response.");
    expect(horse().value).toBe("29");
    expect(submitButton().disabled).toBe(false);
    expect(changesPanel().textContent).not.toContain("Request submitted for review.");
    expect(mine).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
