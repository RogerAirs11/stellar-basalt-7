// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HorseCurationForm } from "../../src/web/shared/HorseCurationForm";
import { publicHorseDetailFields, staffHorseDetailFields } from "../../src/frontend-kit/horseFields";
import { horseCurationChanges, horseCurationDraft } from "../../src/frontend-kit/horseCuration";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { AdminHorseRecord, PlatformClient } from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const record: AdminHorseRecord = { id: 17, row_version: 4, name_latin: "Source horse", name_native: "اسب منبع", birth_name: "Birth source name", previous_names_json: '["Earlier name","نام قبلی"]', height_cm: 155.5, markings: "Source facial marking", life_status: "alive", passport_no: "P-001", passport_issuer: "Source registry", passport_issue_date_value: "1402-05", passport_issue_date_precision: "month", passport_issue_date_calendar: "solar_hijri", passport_expiry_value: "2030", passport_expiry_precision: "year", passport_expiry_calendar: "gregorian", foreign_registration_no: "F-001", foreign_registration_issuer: "Foreign source registry", microchip_no: "1234567", precise_address: "Private source address" };
function client(): PlatformClient { return { admin: { horses: { create: vi.fn().mockResolvedValue({ horse: record }), update: vi.fn().mockResolvedValue({ horse: { ...record, row_version: 5 } }) } }, search: { horses: vi.fn().mockResolvedValue({ results: [] }) } } as unknown as PlatformClient; }
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(platform: PlatformClient, horse?: AdminHorseRecord, scope = "staff-a", onSaved?: () => Promise<void>) { await act(async () => root.render(<HorseCurationForm platform={platform} horse={horse} locale="en" scope={scope} onSaved={onSaved} />)); }
const control = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function set(name: string, value: string) { const element = control(name); const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }
async function fill(values: Record<string, string>) { await act(async () => { for (const [name, value] of Object.entries(values)) set(name, value); }); }
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

describe("shared authorized horse curation", () => {
  it("creates through the canonical SDK with arrays, numeric measurements, identifiers and typed dates", async () => {
    const platform = client(); await render(platform);
    await fill({ name_latin: "Created source horse", birth_name: "First name", previous_names: " Earlier\nنام قبلی\nEarlier ", height_cm: "۱۵۷٫۵", markings: "White facial source marking", life_status: "alive", passport_no: "P-۱۲۳", passport_issuer: "Source registry", uel_no: "UEL-۴۵", life_number: "L-۶۷", foreign_registration_no: "F-۸۹", foreign_registration_issuer: "Foreign source registry", passport_issue_date_value: "۱۴۰۲-۰۵", passport_issue_date_precision: "month", passport_issue_date_calendar: "solar_hijri", passport_expiry_value: "۲۰۳۰", passport_expiry_precision: "year", passport_expiry_calendar: "gregorian" });
    await submit(); expect(platform.admin.horses.create).toHaveBeenCalledOnce();
    const [body, options] = vi.mocked(platform.admin.horses.create).mock.calls[0];
    expect(body).toMatchObject({ name_latin: "Created source horse", birth_name: "First name", previous_names: ["Earlier", "نام قبلی"], height_cm: 157.5, life_status: "alive", passport_no: "P-123", passport_issuer: "Source registry", uel_no: "UEL-45", life_number: "L-67", foreign_registration_no: "F-89", foreign_registration_issuer: "Foreign source registry", passport_issue_date: { value: "1402-05", precision: "month", calendar: "solar_hijri" }, passport_expiry: { value: "2030", precision: "year", calendar: "gregorian" }, death_date: null });
    expect(body).not.toHaveProperty("previous_names_json"); expect(body).not.toHaveProperty("passport_issue_date_value"); expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(control("passport_no").value).toBe(""); expect(container.textContent).toContain("Created horse #17.");
  });

  it("hydrates the actual storage columns and updates only changed facts with the loaded row version", async () => {
    const platform = client(); await render(platform, record);
    expect(control("previous_names").value).toBe("Earlier name\nنام قبلی"); expect(control("height_cm").value).toBe("155.5");
    expect(control("passport_issue_date_value").value).toBe("1402-05"); expect(control("passport_issue_date_precision").value).toBe("month"); expect(control("passport_issue_date_calendar").value).toBe("solar_hijri"); expect(control("foreign_registration_issuer").value).toBe("Foreign source registry");
    await fill({ previous_names: "New alias\nNew alias", height_cm: "۱۵۸", passport_issue_date_value: "۱۴۰۳", passport_issue_date_precision: "year", foreign_registration_issuer: "Corrected source registry" }); await submit();
    const [id, version, body] = vi.mocked(platform.admin.horses.update).mock.calls[0]; expect(id).toBe(17); expect(version).toBe(4);
    expect(body).toEqual({ previous_names: ["New alias"], height_cm: 158, passport_issue_date: { value: "1403", precision: "year", calendar: "solar_hijri" }, foreign_registration_issuer: "Corrected source registry" });
    expect(platform.admin.horses.create).not.toHaveBeenCalled();
  });

  it("does not guess absent source date metadata or rewrite untouched legacy identifiers", async () => {
    const legacy = { ...record, passport_issuer: null, passport_issue_date_precision: null, passport_issue_date_calendar: null };
    const platform = client(); await render(platform, legacy);
    expect(control("passport_issue_date_precision").value).toBe(""); expect(control("passport_issue_date_calendar").value).toBe("");
    await fill({ name_latin: "Corrected Latin name" }); await submit();
    expect(vi.mocked(platform.admin.horses.update).mock.calls[0][2]).toEqual({ name_latin: "Corrected Latin name" });
  });

  it("blocks invalid height, unsourced identifiers and precision mismatches before sending", async () => {
    const platform = client(); await render(platform);
    await fill({ name_latin: "Source horse", height_cm: "abc" }); await submit(); expect(platform.admin.horses.create).not.toHaveBeenCalled();
    await fill({ height_cm: "156", passport_no: "P-001" }); await submit(); expect(container.textContent).toContain("requires its issuing authority");
    await fill({ passport_issuer: "Registry", passport_issue_date_value: "1402-05", passport_issue_date_precision: "day", passport_issue_date_calendar: "solar_hijri" }); await submit();
    expect(platform.admin.horses.create).not.toHaveBeenCalled(); expect(container.textContent).toContain("enter a valid date at that precision");
  });

  it("uses explicit null for a cleared date and preserves other partial dates", () => {
    const draft = horseCurationDraft(record); draft.dates.passport_issue_date.value = "";
    expect(horseCurationChanges(draft, record, en => en)).toEqual({ passport_issue_date: null });
    expect(draft.dates.passport_expiry).toEqual({ value: "2030", precision: "year", calendar: "gregorian" });
  });

  it("does not reverse a recorded death through ordinary curation", async () => {
    const platform = client(); await render(platform, { ...record, life_status: "dead", is_dead: 1, death_date_value: "2025", death_date_precision: "year", death_date_calendar: "gregorian" });
    await fill({ life_status: "alive" }); await submit(); expect(platform.admin.horses.update).not.toHaveBeenCalled(); expect(container.textContent).toContain("reviewed lifecycle correction");
  });

  it("preserves the draft after a stale-version refusal and never retries with another version", async () => {
    const platform = client(); vi.mocked(platform.admin.horses.update).mockRejectedValue(new PlatformClientError(409, "stale_record", "Record changed; reload before correcting")); await render(platform, record);
    await fill({ height_cm: "160" }); await submit(); expect(control("height_cm").value).toBe("160"); expect(container.textContent).toContain("Record changed; reload before correcting"); expect(platform.admin.horses.update).toHaveBeenCalledOnce(); expect(vi.mocked(platform.admin.horses.update).mock.calls[0][1]).toBe(4);
  });

  it("clears private create drafts when the principal scope changes", async () => {
    const platform = client(); await render(platform); await fill({ name_latin: "Private unfinished name", passport_no: "PRIVATE-001", precise_address: "Private address" });
    await render(platform, undefined, "staff-b"); expect(control("name_latin").value).toBe(""); expect(control("passport_no").value).toBe(""); expect(control("precise_address").value).toBe("");
  });

  it("keeps an acknowledged create successful when the parent list refresh fails", async () => {
    const platform = client(); await render(platform, undefined, "staff-a", async () => { throw new Error("refresh failed"); });
    await fill({ name_latin: "Source horse" }); await submit(); expect(container.textContent).toContain("Record saved. Refresh the surrounding list"); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(platform.admin.horses.create).toHaveBeenCalledOnce();
  });

  it("shows safe new profile facts while keeping passport and foreign identity details in staff projection", () => {
    const publicFields = publicHorseDetailFields(record, { locale: "fa" }); const publicMap = Object.fromEntries(publicFields.map(field => [field.key, field.value]));
    expect(publicMap).toMatchObject({ birth_name: "Birth source name", previous_names_json: "Earlier name; نام قبلی", height_cm: 155.5, markings: "Source facial marking", life_status: "زنده" });
    for (const key of ["passport_no", "passport_issuer", "passport_issue_date_value", "passport_expiry_value", "foreign_registration_no", "foreign_registration_issuer", "precise_address"]) expect(publicMap).not.toHaveProperty(key);
    const staffMap = Object.fromEntries(staffHorseDetailFields(record).map(field => [field.key, field.value]));
    expect(staffMap).toMatchObject({ passport_no: "P-001", passport_issuer: "Source registry", passport_issue_date_value: "1402-05", passport_issue_date_precision: "month", passport_issue_date_calendar: "solar_hijri", foreign_registration_issuer: "Foreign source registry", precise_address: "Private source address" });
  });
});
