// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/web/i18n";
import { MetadataWorkbench, SupplementaryValues } from "../../src/web/heritage/MetadataWorkbench";
import { RegistryDeskPage } from "../../src/web/heritage/RegistryDeskPage";
import type { MetadataCatalog, MetadataField, MetadataFieldDetail, MetadataValue, PlatformClient, PlatformUser } from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const field: MetadataField = { key: "extra_source_note", revision: 4, latest_version: 2, active_version: 1, definition_version: 1, definition: { type: "text", label: { en: "Private source note" }, visibility: "staff", filter_enabled: false, max_length: 200 } };
const catalog: MetadataCatalog = { fields: [field], limit: 100, truncated: false, supported_workflows: ["existing_horse_curation"] };
const detail: MetadataFieldDetail = { field, versions: [1, 2].map(version => ({ version, definition: field.definition, created_at: "2026-10-01", reason: "Source definition review" })), history: [], history_truncated: false };
const stored: MetadataValue = { field_key: field.key, definition: field.definition, definition_version: 1, version: 1, value: "PRIVATE-ACCOUNT-A-VALUE", source_ref: "Private source reference", updated_at: "2026-10-01" };
function client(): PlatformClient { return { metadata: { horse: vi.fn(), admin: { catalog: vi.fn().mockResolvedValue(catalog), detail: vi.fn().mockResolvedValue(detail), activate: vi.fn(), horse: vi.fn().mockResolvedValue({ horse_id: 7, values: [stored] }), history: vi.fn().mockResolvedValue({ horse_id: 7, history: [], limit: 100, truncated: false }) } } } as unknown as PlatformClient; }
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function mount(element: React.ReactNode) { await act(async () => root.render(<I18nProvider locale="en">{element}</I18nProvider>)); }
function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(res => { resolve = res; }); return { promise, resolve }; }

describe("supplementary metadata workflow", () => {
  it("retries exactly the same activation UUID, version and revision after an ambiguous response", async () => {
    const platform = client(); vi.mocked(platform.metadata.admin.activate).mockRejectedValueOnce(new Error("Response lost after write")).mockImplementationOnce(async (_key, input) => ({ receipt: { field_key: field.key, horse_id: null, revision: 5, version: 2, operation_id: input.operation_id } }));
    await mount(<MetadataWorkbench platform={platform} scope="admin-a" />);
    await act(async () => change(container.querySelector(".metadata-layout aside select") as unknown as HTMLSelectElement, field.key));
    const form = container.querySelector<HTMLFormElement>(".metadata-editor form.metadata-form")!;
    await act(async () => { change(form.querySelector("select")!, "2"); change(form.querySelector("textarea")!, "Activate reviewed definition"); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(form.querySelector("fieldset")!.disabled).toBe(true);
    const retry = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Retry the same saved operation"))!;
    expect(retry).toBeTruthy();
    await act(async () => retry.click());
    const calls = vi.mocked(platform.metadata.admin.activate).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][0]).toBe(field.key); expect(calls[0][1]).toEqual(calls[1][1]);
    expect(calls[0][1]).toMatchObject({ expected_revision: 4, version: 2, reason: "Activate reviewed definition" });
    expect(calls[0][1].operation_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("unmounts staff values, definition selection and unfinished text when the Registry Desk account changes", async () => {
    const platform = client(); const admin: PlatformUser = { id: "admin-a", display_name: "Admin A", email: "a@example.test", role: "admin" };
    const renderDesk = (user: PlatformUser) => mount(<RegistryDeskPage platform={platform} platformMeta={null} permissions={[]} user={user} navigate={() => {}} />);
    await renderDesk(admin);
    await act(async () => change(container.querySelector(".metadata-layout aside select") as unknown as HTMLSelectElement, field.key));
    const activation = container.querySelector<HTMLTextAreaElement>(".metadata-editor form textarea")!;
    await act(async () => change(activation, "PRIVATE unfinished definition reason"));
    const horseForm = container.querySelector<HTMLFormElement>(".metadata-horse-choice")!;
    await act(async () => { change(horseForm.querySelector("input")!, "7"); horseForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain("PRIVATE-ACCOUNT-A-VALUE");
    const pending = deferred<MetadataCatalog>(); vi.mocked(platform.metadata.admin.catalog).mockImplementationOnce(() => pending.promise);
    await renderDesk({ ...admin, id: "admin-b" });
    expect(container.textContent).not.toContain("PRIVATE-ACCOUNT-A-VALUE");
    expect(container.querySelector(".metadata-editor")).toBeNull();
    expect(container.querySelector<HTMLInputElement>(".metadata-horse-choice input")!.value).toBe("");
    expect([...container.querySelectorAll("textarea")].some(element => element.value.includes("PRIVATE unfinished"))).toBe(false);
    await act(async () => pending.resolve(catalog));
    expect((container.querySelector(".metadata-layout aside select") as unknown as HTMLSelectElement).value).toBe("");
    expect(container.textContent).not.toContain("PRIVATE-ACCOUNT-A-VALUE");
  });

  it("masks the prior horse's public facts immediately while a new horse is loading", async () => {
    const platform = client(); const pending = deferred<{ horse_id: number; values: MetadataValue[] }>();
    vi.mocked(platform.metadata.horse).mockResolvedValueOnce({ horse_id: 7, values: [{ ...stored, value: "PUBLIC-HORSE-A", definition: { ...field.definition, visibility: "public" } }] }).mockImplementationOnce(() => pending.promise);
    await mount(<SupplementaryValues platform={platform} horseId={7} />);
    expect(container.textContent).toContain("PUBLIC-HORSE-A");
    await mount(<SupplementaryValues platform={platform} horseId={8} />);
    expect(container.textContent).not.toContain("PUBLIC-HORSE-A"); expect(container.textContent).toContain("Loading");
    await act(async () => pending.resolve({ horse_id: 8, values: [{ ...stored, value: "PUBLIC-HORSE-B", definition: { ...field.definition, visibility: "public" } }] }));
    expect(container.textContent).toContain("PUBLIC-HORSE-B"); expect(container.textContent).not.toContain("PUBLIC-HORSE-A");
  });
});
