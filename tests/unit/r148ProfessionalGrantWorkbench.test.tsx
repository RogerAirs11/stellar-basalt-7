// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformClient, ProfessionalGrantRecord } from "../../src/contracts/platform";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { ProfessionalGrantWorkbench } from "../../src/web/shared/ProfessionalGrantWorkbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const grant: ProfessionalGrantRecord = {
  id: "grant-a", horse_id: 7, grantee_user_id: "PRIVATE-RECIPIENT-A", grantee_organization_id: null,
  professional_kind: "veterinarian", permissions: "private_health_read", permission_list: ["private_health_read"],
  authority_ref: "PRIVATE-AUTHORITY-A", assignment_ref: "Veterinary appointment", basis: "owner_consent", basis_ref: "Signed consent #18",
  valid_from: "2026-01-01T00:00:00Z", valid_until: "2099-01-01T00:00:00Z", revoked_at: null,
  revoked_by_user_id: null, revoke_reason: null, created_at: "2026-01-01 00:00:00",
};
function client(): PlatformClient { return { modules: { professionalGrants: { list: vi.fn().mockResolvedValue({ grants: [] }), create: vi.fn().mockResolvedValue({ grant }), revoke: vi.fn().mockResolvedValue({ id: grant.id, revoked: true }) } } } as unknown as PlatformClient; }
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function mount(platform: PlatformClient, scope = "admin-a", canManage = true, canRead = true, locale: "en" | "fa" = "en") { await act(async () => root.render(<ProfessionalGrantWorkbench platform={platform} scope={scope} canRead={canRead} canManage={canManage} locale={locale} />)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function change(name: string, value: string) {
  await act(async () => {
    const element = container.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | HTMLSelectElement;
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function click(text: string) { await act(async () => { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent === text); expect(button).toBeTruthy(); button!.click(); }); }
async function chooseHorse(value = "7") { await change("grant_horse_id", value); await act(async () => container.querySelector<HTMLFormElement>(".hdb-professional-grants > form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function permission(value: string) { await act(async () => container.querySelector<HTMLInputElement>(`input[name="grant_permission"][value="${value}"]`)!.click()); }
async function fillGrant() { await change("grant_recipient", "professional-b"); await permission("private_health_read"); await change("grant_authority", "Licence reviewed #7"); await change("grant_assignment", "Owner appointment #4"); }
async function submitGrant() { await act(async () => container.querySelector<HTMLFormElement>(".hdb-account-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

describe("R148 professional access register", () => {
  it("loads only an explicit horse, accepts Persian digits and does not expose management to a read-only auditor", async () => {
    const platform = client(); await mount(platform, "auditor", false);
    expect(platform.modules.professionalGrants.list).not.toHaveBeenCalled();
    await chooseHorse("۷");
    expect(platform.modules.professionalGrants.list).toHaveBeenCalledWith(expect.objectContaining({ horse_id: 7, signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("200 most recent");
    expect(container.querySelector(".hdb-account-form")).toBeNull();
    await mount(platform, "auditor", false, false);
    expect(container.textContent).toBe("");
  });

  it("narrows permissions on a profession change and submits exactly one identified recipient", async () => {
    const platform = client(); await mount(platform); await chooseHorse();
    await permission("genetic_review");
    expect(container.textContent).toContain("an existing separate grant can provide it");
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Create this grant")!.disabled).toBe(false);
    await permission("genetic_evidence_read");
    await change("grant_profession", "farrier");
    expect(container.querySelector('input[value="genetic_review"]')).toBeNull();
    expect(container.querySelectorAll('input[name="grant_permission"]:checked')).toHaveLength(0);
    await permission("clinical_write"); await change("grant_recipient_type", "organization"); await change("grant_recipient", "۳۲");
    await change("grant_authority", "Credential ref"); await change("grant_assignment", "Appointment ref");
    await submitGrant();
    const input = vi.mocked(platform.modules.professionalGrants.create).mock.calls[0][0];
    expect(input).toMatchObject({ horse_id: 7, grantee_organization_id: 32, professional_kind: "farrier", permissions: ["clinical_write"] });
    expect(input).not.toHaveProperty("grantee_user_id");
  });

  it("requires consent evidence and a valid date window before sending a grant", async () => {
    const platform = client(); await mount(platform); await chooseHorse(); await fillGrant();
    await change("grant_basis", "owner_consent"); await submitGrant();
    expect(platform.modules.professionalGrants.create).not.toHaveBeenCalled();
    expect(container.textContent).toContain("required consent or institution evidence");
    await change("grant_basis_ref", "Consent #22"); await change("grant_valid_from", "2028-02-03T12:00"); await change("grant_valid_until", "2028-02-02T12:00"); await submitGrant();
    expect(platform.modules.professionalGrants.create).not.toHaveBeenCalled();
    expect(container.textContent).toContain("end date must be after");
    await change("grant_valid_until", "2028-02-04T12:00"); await submitGrant();
    expect(platform.modules.professionalGrants.create).toHaveBeenCalledOnce();
    expect(vi.mocked(platform.modules.professionalGrants.create).mock.calls[0][0]).toMatchObject({ basis_ref: "Consent #22", valid_from: new Date("2028-02-03T12:00").toISOString(), valid_until: new Date("2028-02-04T12:00").toISOString() });
  });

  it("never blindly repeats an ambiguous create; requires a current reload and deliberate inspection", async () => {
    const platform = client(); vi.mocked(platform.modules.professionalGrants.create).mockRejectedValueOnce(new Error("Response lost after commit"));
    await mount(platform); await chooseHorse(); await fillGrant(); await submitGrant();
    expect(container.textContent).toContain("previous change may already have completed");
    await submitGrant(); expect(platform.modules.professionalGrants.create).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("I have checked the current grants");
    vi.mocked(platform.modules.professionalGrants.list).mockRejectedValueOnce(new Error("Read unavailable"));
    await click("Reload current grants");
    expect(container.textContent).not.toContain("I have checked the current grants");
    vi.mocked(platform.modules.professionalGrants.list).mockResolvedValueOnce({ grants: [grant] });
    await click("Reload current grants");
    expect(container.textContent).toContain(grant.grantee_user_id);
    expect(container.querySelector<HTMLFieldSetElement>(".hdb-account-form > fieldset")!.disabled).toBe(true);
    await click("I have checked the current grants");
    expect(container.querySelector<HTMLFieldSetElement>(".hdb-account-form > fieldset")!.disabled).toBe(false);
    expect(platform.modules.professionalGrants.create).toHaveBeenCalledOnce();
  });

  it("keeps an accepted create receipt when the following read fails and prevents accidental duplicate submission", async () => {
    const platform = client(); await mount(platform); await chooseHorse(); await fillGrant();
    vi.mocked(platform.modules.professionalGrants.list).mockRejectedValueOnce(new Error("Refresh failed"));
    await submitGrant();
    expect(container.textContent).toContain(`Grant ${grant.id} created.`);
    expect(container.textContent).toContain("Refresh failed");
    expect(container.textContent).not.toContain("previous change may already have completed");
    expect(container.querySelector<HTMLInputElement>('[name="grant_recipient"]')!.value).toBe("");
    expect(container.querySelector<HTMLFieldSetElement>(".hdb-account-form > fieldset")!.disabled).toBe(true);
    await submitGrant(); expect(platform.modules.professionalGrants.create).toHaveBeenCalledOnce();
    await click("Reload current grants");
    expect(container.textContent).toContain(`Grant ${grant.id} created.`);
  });

  it("removes all private rows and drafts at account changes and ignores an old account's late read", async () => {
    const platform = client(); vi.mocked(platform.modules.professionalGrants.list).mockResolvedValueOnce({ grants: [grant] });
    await mount(platform); await chooseHorse(); await change("grant_authority", "PRIVATE unfinished evidence");
    expect(container.textContent).toContain("PRIVATE-RECIPIENT-A");
    const pending = deferred<{ grants: ProfessionalGrantRecord[] }>(); vi.mocked(platform.modules.professionalGrants.list).mockImplementationOnce(() => pending.promise);
    await click("Reload current grants");
    const signal = vi.mocked(platform.modules.professionalGrants.list).mock.calls.at(-1)![0]!.signal!;
    await mount(platform, "admin-b");
    expect(signal.aborted).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[name="grant_horse_id"]')!.value).toBe("");
    expect(container.querySelector('[name="grant_authority"]')).toBeNull();
    await act(async () => pending.resolve({ grants: [grant] }));
    expect(container.textContent).not.toContain("PRIVATE-RECIPIENT-A");
    await mount(platform, "admin-a"); expect(container.textContent).not.toContain("PRIVATE-AUTHORITY-A");
  });

  it("requires a revocation reason, ignores duplicate commands and hides stale access after a permission rejection", async () => {
    const platform = client(); vi.mocked(platform.modules.professionalGrants.list).mockResolvedValue({ grants: [grant] });
    vi.mocked(platform.modules.professionalGrants.revoke).mockRejectedValueOnce(new PlatformClientError(403, "mfa_step_up_required", "Verify account security first"));
    await mount(platform); await chooseHorse();
    await click("Revoke this grant"); expect(platform.modules.professionalGrants.revoke).not.toHaveBeenCalled();
    await change("revocation_reason", "Assignment finished"); await click("Revoke this grant");
    expect(platform.modules.professionalGrants.revoke).toHaveBeenCalledWith(grant.id, { reason: "Assignment finished" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("Verify account security first");
    expect(container.textContent).not.toContain("PRIVATE-RECIPIENT-A");
    expect(container.textContent).not.toContain("previous change may already have completed");
    expect(container.querySelector<HTMLFieldSetElement>(".hdb-account-form > fieldset")!.disabled).toBe(true);
  });

  it("does not transfer a late create receipt or draft into a different horse", async () => {
    const platform = client(); const pending = deferred<{ grant: ProfessionalGrantRecord }>();
    vi.mocked(platform.modules.professionalGrants.create).mockImplementationOnce(() => pending.promise);
    await mount(platform); await chooseHorse(); await fillGrant(); await submitGrant();
    const signal = vi.mocked(platform.modules.professionalGrants.create).mock.calls[0][1]!.signal!;
    await chooseHorse("8"); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ grant }));
    expect(container.textContent).toContain("Horse #8"); expect(container.textContent).not.toContain("Grant grant-a created.");
    expect(container.querySelector<HTMLInputElement>('[name="grant_recipient"]')!.value).toBe("");
  });

  it("renders the access workflow in Persian", async () => {
    const platform = client(); await mount(platform, "admin-a", true, true, "fa");
    expect(container.textContent).toContain("دسترسی حرفه‌ای"); expect(container.textContent).toContain("شناسه اسب");
    expect(container.textContent).not.toContain("Professional access");
  });
});
