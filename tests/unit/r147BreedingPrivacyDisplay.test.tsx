// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HorseGeneticsPanel } from "../../src/web/heritage/HorseModulesPanels";
import { RecordModules } from "../../src/web/frontends/retro-astra/transplant/pages/RecordModules";
import { I18nProvider } from "../../src/web/i18n";
import type { BreedingRecordRow, FrontendRuntimeProps, PlatformClient } from "../../src/frontend-kit";

const context = vi.hoisted(() => ({ runtime: null as unknown as FrontendRuntimeProps, language: "en" as "en" | "fa" }));
vi.mock("../../src/web/frontends/retro-astra/transplant/HorseDbAdapter", () => ({ useHorseDbAdapter: () => ({ runtime: context.runtime }) }));
vi.mock("../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider", () => ({ usePreferences: () => ({ language: context.language, n: String, date: String, t: (key: string) => key, text: (value: string) => value }) }));
vi.mock("../../src/frontend-kit/HorseMediaPanel", () => ({ HorseMediaPanel: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); context.language = "en"; });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(element: React.ReactElement) { await act(async () => { root.render(element); }); }

const masked = (): BreedingRecordRow => ({ id: 1, row_version: 1, sire_id: null, dam_id: null, foal_id: null, covering_date: null, season: null, method: null, outcome: "unknown", provenance: "user", sire_name: "Withheld sire stale name", sire_name_native: "نام خصوصی پدر", dam_name: "Withheld dam stale name", dam_name_native: "نام خصوصی مادر", foal_name: "Withheld foal stale name" });
function client(record: BreedingRecordRow): PlatformClient {
  return { modules: {
    genetics: { horse: vi.fn().mockResolvedValue({ horse: { id: 17, name_latin: "Public horse", name_native: null }, tests: [], summary: { tested: 0, clear: 0, carriers: 0, affected: 0 } }) },
    breedings: { horse: vi.fn().mockResolvedValue({ horse: { id: 17 }, as_sire: [record], as_dam: [], birth_record: record }) },
    competitions: { horseHistory: vi.fn().mockResolvedValue({ results: [] }) },
    media: { list: vi.fn().mockResolvedValue({ media: [] }) },
    registryExtras: { certificateUrl: () => "/extract/17" },
  } } as unknown as PlatformClient;
}
function assertNoMaskedIdentity() {
  expect(container.textContent).not.toMatch(/#(?:null|undefined)|Withheld|نام خصوصی/);
  for (const link of container.querySelectorAll("a")) expect(link.getAttribute("href")).not.toMatch(/\/horses?\/(?:null|undefined)|#(?:null|undefined)/);
}
function retroRuntime(platform: PlatformClient) { context.runtime = { user: null, permissions: [], platform } as unknown as FrontendRuntimeProps; }

describe("masked legacy breeding identities", () => {
  it("Heritage shows unavailable labels, hides stale names and disables a withheld foal target", async () => {
    const navigate = vi.fn(); const platform = client(masked());
    await render(<I18nProvider locale="en"><HorseGeneticsPanel horseId={17} navigate={navigate} platform={platform} user={null} /></I18nProvider>);
    expect(container.textContent).toContain("Unavailable sire"); expect(container.textContent).toContain("Unavailable dam"); expect(container.textContent).toContain("Foal unavailable"); assertNoMaskedIdentity();
    const button = container.querySelector(".h-mod-breedings-detail button") as unknown as HTMLButtonElement;
    expect(button.disabled).toBe(true); act(() => button.click()); expect(navigate).not.toHaveBeenCalled();
  });

  it("Heritage preserves the public horse and available foal navigation", async () => {
    const navigate = vi.fn(); const platform = client({ ...masked(), sire_id: 17, dam_id: 42, dam_name: "Public dam", dam_name_native: null, foal_id: 43, foal_name: "Public foal" });
    await render(<I18nProvider locale="en"><HorseGeneticsPanel horseId={17} navigate={navigate} platform={platform} user={null} /></I18nProvider>);
    expect(container.textContent).toContain("Public horse"); expect(container.textContent).toContain("Public dam"); expect(container.textContent).toContain("Public foal"); assertNoMaskedIdentity();
    act(() => (container.querySelector(".h-mod-breedings-detail button") as unknown as HTMLButtonElement).click()); expect(navigate).toHaveBeenCalledWith("/horse/43");
  });

  it("Retro renders Persian unavailable parents for null or omitted IDs without a fabricated URL", async () => {
    context.language = "fa";
    // An older partial payload can omit an ID; both forms must fail closed.
    const row = { ...masked(), dam_id: undefined } as unknown as BreedingRecordRow;
    retroRuntime(client(row)); await render(<RecordModules horseId={17} />);
    expect(container.textContent).toContain("پدر در دسترس نیست"); expect(container.textContent).toContain("مادر در دسترس نیست"); assertNoMaskedIdentity();
    expect(container.querySelector('a[href^="#/horses/"]')).toBeNull();
  });

  it("Retro retains a visible parent link while keeping the masked partner unavailable", async () => {
    retroRuntime(client({ ...masked(), sire_id: 42, sire_name: "Public sire" })); await render(<RecordModules horseId={17} />);
    expect(container.querySelector('a[href="#/horses/42"]')?.textContent).toBe("Public sire"); expect(container.textContent).toContain("Unavailable dam"); assertNoMaskedIdentity();
    expect(container.querySelectorAll('a[href^="#/horses/"]')).toHaveLength(1);
  });
});
