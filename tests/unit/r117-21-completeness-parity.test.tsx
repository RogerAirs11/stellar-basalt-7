// @vitest-environment happy-dom
/**
 * R117-21 (Master AI R117 handoff, parent D30) — separate, data-derived
 * completeness measures. Acceptance: "The same fixture produces identical
 * numbers across skins." One fixture RegistryAnalyticsResponse is rendered
 * through every native skin's analytics surface — heritage stats, EquiData
 * Elite observatory, FEI Classic analytics, Retro Astra insights, and the
 * vanilla Classic renderer (executed against its real module with the app
 * core substituted) — and each must show the SAME covered/total counts and
 * snapshot time, with its own independent presentation.
 *
 * Also pins: a stale/failed analytics request is labelled as an error in the
 * skin, never silently rendered as an empty registry.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformClient, RegistryAnalyticsResponse, RegistryCompletenessSection } from "../../src/frontend-kit";
import { RegistryStatsPage } from "../../src/web/heritage/RegistryStatsPage";
import { StatsPage as EquiDataStatsPage } from "../../src/web/frontends/equidata-elite/pages";
import { RegistryAnalyticsPage } from "../../src/web/frontends/fei-classic/analytics";
import { Insights } from "../../src/web/frontends/retro-astra/transplant/pages/Insights";

const hoisted = vi.hoisted(() => ({ platform: null as PlatformClient | null }));

vi.mock("../../src/web/i18n", () => ({
  useI18n: () => ({ locale: "en", n: (v: number) => String(v), t: (key: string, fallback?: string) => fallback ?? key, year: (v: number | null) => String(v ?? "—"), isRTL: false }),
}));
vi.mock("../../src/web/frontends/retro-astra/transplant/HorseDbAdapter", () => ({
  useHorseDbAdapter: () => ({ runtime: { platform: hoisted.platform as PlatformClient, permissions: [], platformMeta: null } }),
}));
vi.mock("../../src/web/frontends/retro-astra/transplant/preferences/PreferencesProvider", () => ({
  usePreferences: () => ({ t: (key: string) => key, n: (value: number) => String(value), language: "en" }),
}));
// Vanilla Classic renderer: the real views/labs.js module, app core substituted.
vi.mock("../../standalone-frontends/classic-v1.4/public/ui/core.js", () => ({
  api: async (path: string) => {
    if (path === "/api/analytics/registry") return FIXTURE;
    if (path === "/api/quality/summary") return { openIssues: 0, severities: [], topIssueCodes: [] };
    return { ok: true, horses: FIXTURE.horseCount };
  },
  state: { route: { name: "analytics", query: new Map() } },
  t: (key: string) => key,
  fa: () => false,
  L3: (en: string) => en,
  esc: (value: unknown) => String(value),
  attr: (value: unknown) => String(value ?? ""),
  num: (value: number) => String(value),
  pct: (value: number) => `${value}%`,
  date: (value: string) => String(value),
  pageHead: (title: string) => `<div>${title}</div>`,
  panel: (title: string, content: string) => `<section><h3>${title}</h3>${content}</section>`,
  stat: (label: string, value: string) => `<div>${label}:${value}</div>`,
  badge: (text: string) => text,
  loading: () => `<div>loading</div>`,
  errorBox: (error: unknown) => `<div>${String(error)}</div>`,
  primaryName: (row: { name_latin?: string | null }) => row.name_latin ?? "—",
  renderJson: () => `<div>json</div>`,
  horseLink: (id: number) => `#/horse/${id}`,
}));
vi.mock("../../standalone-frontends/classic-v1.4/public/ui/contextNavigation.js", () => ({ contextNavigation: () => "" }));
// @ts-expect-error -- the vanilla Classic renderer is an untyped browser ES module; its app core is substituted above.
import { renderAnalytics } from "../../standalone-frontends/classic-v1.4/public/ui/views/labs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };

const SNAPSHOT_TIME = "2026-10-21T00:00:00Z";
const COMPLETENESS: RegistryCompletenessSection = {
  snapshotTime: SNAPSHOT_TIME,
  denominatorDefinition: "Every measure uses the same denominator: all non-deleted canonical horse records in this database revision.",
  permissionScope: "Computed over canonical registry records readable through the public registry surface; private, owner-scoped or draft rows are not part of these denominators.",
  interpretation: "These are recorded-data coverage measures. They describe which share of records carry recorded values or linked rows; they never assert verification, authenticity, or that the registry itself is complete.",
  measures: [
    { key: "identity", label: "Identity field coverage", totalRecords: 5, coveredRecords: 5, coveragePercent: 100, missingDefinition: "Meaningful recorded name required.", components: [{ key: "name", label: "Meaningful name (Latin or native)", coveredRecords: 5, totalRecords: 5, coveragePercent: 100, missingDefinition: "Latin or native name is non-blank." }] },
    { key: "ancestry", label: "Recorded ancestry coverage", totalRecords: 5, coveredRecords: 3, coveragePercent: 60, missingDefinition: "At least one parent recorded.", components: [{ key: "anyParent", label: "At least one recorded parent", coveredRecords: 3, totalRecords: 5, coveragePercent: 60, missingDefinition: "Father or mother is recorded." }] },
    { key: "evidence", label: "Linked evidence coverage", totalRecords: 5, coveredRecords: 2, coveragePercent: 40, missingDefinition: "At least one linked evidence row.", components: [] },
    { key: "media", label: "Media coverage", totalRecords: 5, coveredRecords: 1, coveragePercent: 20, missingDefinition: "At least one media row is linked.", components: [] },
    { key: "activity", label: "Recorded activity coverage", totalRecords: 5, coveredRecords: 4, coveragePercent: 80, missingDefinition: "At least one activity flag set.", components: [] },
  ],
};

const FIXTURE: RegistryAnalyticsResponse = {
  schemaVersion: "2.2.0",
  algorithmVersion: "2.2.0",
  generatedAt: SNAPSHOT_TIME,
  sourceRevision: "r117-21-parity-fixture",
  horseCount: 5,
  birthDecades: [],
  sexDistribution: [],
  topBreeds: [],
  topBirthPlaces: [],
  parentage: { bothParents: 3, oneParent: 0, noParents: 2, bothParentsPercent: 60, oneParentPercent: 0, noParentsPercent: 40 },
  progeny: { percentiles: { p50: 0, p90: 0, p95: 0, p99: 0, max: 0 }, horsesWithRecordedOffspring: 0, topParents: [], topSires: [], topDams: [] },
  pedigree: { analyticsEligibleHorseCount: 5, cycleNodeCount: 0, cycleContaminatedHorseCount: 0, completeness: [], topRepresentedAncestorsDepth4: [], representationInterpretation: "fixture" },
  completeness: COMPLETENESS,
  provenance: { interpretation: "fixture", canonical: false },
};

const COUNTS = ["5 / 5", "3 / 5", "2 / 5", "1 / 5", "4 / 5"];
const LABELS = ["Identity field coverage", "Recorded ancestry coverage", "Linked evidence coverage", "Media coverage", "Recorded activity coverage"];

function platform(fixture: RegistryAnalyticsResponse | Error): PlatformClient {
  const registry = vi.fn(async () => { if (fixture instanceof Error) throw fixture; return fixture; });
  const summary = vi.fn(async () => ({ openIssues: 0, severities: [], topIssueCodes: [] }));
  return { analytics: { registry }, quality: { summary } } as unknown as PlatformClient;
}

describe("R117-21 identical completeness numbers across every skin", () => {
  it("heritage stats renders the shared measures with snapshot time and interpretation", async () => {
    await render(<RegistryStatsPage platform={platform(FIXTURE)} navigate={() => {}} />);
    const section = host.querySelector('[data-surface="registry-completeness"]')!;
    expect(section).toBeTruthy();
    expect(section.querySelector("[data-completeness-snapshot]")?.getAttribute("data-completeness-snapshot")).toBe(SNAPSHOT_TIME);
    for (const count of COUNTS) expect(section.textContent).toContain(count);
    for (const label of LABELS) expect(section.textContent).toContain(label);
    expect(section.textContent).toContain("never assert verification");
  });

  it("EquiData Elite observatory renders the same counts after opening the fidelity tab", async () => {
    const view = { platform: platform(FIXTURE), locale: "en" as const, capabilities: { analytics: true }, navigate: vi.fn(), user: null, permissions: [] };
    await render(<EquiDataStatsPage view={view as never} />);
    await act(async () => { const tab = [...host.querySelectorAll("button")].find(button => button.textContent === "DATA FIDELITY")!; tab.click(); });
    const section = host.querySelector('[data-surface="registry-completeness"]')!;
    expect(section).toBeTruthy();
    expect(section.querySelector("[data-completeness-snapshot]")?.getAttribute("data-completeness-snapshot")).toBe(SNAPSHOT_TIME);
    for (const count of COUNTS) expect(section.textContent).toContain(count);
    for (const label of LABELS) expect(section.textContent).toContain(label);
    expect(section.textContent).toContain("never a verification or registry-completeness claim");
  });

  it("FEI Classic analytics renders the same counts and snapshot", async () => {
    const view = { platform: platform(FIXTURE), locale: "en" as const, capabilities: { analytics: true }, navigate: vi.fn() };
    await render(<RegistryAnalyticsPage view={view as never} />);
    const marker = host.querySelector('[data-surface="registry-completeness"]')!;
    expect(marker).toBeTruthy();
    expect(marker.getAttribute("data-completeness-snapshot")).toBe(SNAPSHOT_TIME);
    const section = marker.closest("section")!;
    for (const count of COUNTS) expect(section.textContent).toContain(count);
    for (const label of LABELS) expect(section.textContent).toContain(label);
  });

  it("Retro Astra insights renders the same counts and snapshot", async () => {
    hoisted.platform = platform(FIXTURE);
    try {
      await render(<Insights />);
      const section = host.querySelector('[data-surface="registry-completeness"]')!;
      expect(section).toBeTruthy();
      expect(section.querySelector("[data-completeness-snapshot]")?.getAttribute("data-completeness-snapshot")).toBe(SNAPSHOT_TIME);
      for (const count of COUNTS) expect(section.textContent).toContain(count);
      for (const label of LABELS) expect(section.textContent).toContain(label);
    } finally {
      hoisted.platform = null;
    }
  });

  it("vanilla Classic renderer renders the same counts and snapshot from the same fixture", async () => {
    const target = document.createElement("div");
    host.appendChild(target);
    await act(async () => { await renderAnalytics(target); });
    const section = target.querySelector('[data-surface="registry-completeness"]')!;
    expect(section).toBeTruthy();
    expect(section.getAttribute("data-completeness-snapshot")).toBe(SNAPSHOT_TIME);
    const html = section.innerHTML;
    for (const count of COUNTS) expect(html).toContain(count);
    for (const label of LABELS) expect(html).toContain(label);
  });

  it("labels a failed (stale) analytics request as an error, never as an empty registry", async () => {
    await render(<RegistryStatsPage platform={platform(new Error("Registry analytics are stale for the current canonical data revision"))} navigate={() => {}} />);
    expect(host.textContent).toContain("stale");
    expect(host.querySelector('[data-surface="registry-completeness"]')).toBeNull();
  });
});
