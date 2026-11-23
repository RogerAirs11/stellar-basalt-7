import { describe, expect, it } from "vitest";
import { contractCompatible, evaluateFrontendCompatibility, type FrontendManifest } from "../../src/contracts/frontend";
import { buildPlatformFeatureCatalog, PLATFORM_FEATURE_KEYS, type PlatformCapabilities, type PlatformMetaResponse } from "../../src/contracts/platform";
import { createFetchPlatformTransport, createPlatformClient, type PlatformTransport } from "../../src/frontend-kit/platformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";

const capabilities: PlatformCapabilities = {
  authentication: true,
  search: true,
  structured_search: true,
  registry: true,
  registry_facets: true,
  horse_profiles: true,
  people: true,
  pedigree_ancestors: true,
  pedigree_descendants: true,
  pedigree_metrics: true,
  pedigree_paths: true,
  pedigree_coefficients: true,
  relationships: true,
  horse_insights: true,
  registry_analytics: true,
  quality_summary: true,
  quality_queue: false,
  evidence_summary: true,
  exact_identifier: false,
  owner_claims: true,
  change_requests: false,
  audit: false,
  admin: false,
  media: false,
  curation: false,
  verification: false,
  inspections: false,
  exports: false,
  breed_standards: false,
  breeding_analysis: true,
  genomics: false,
  performance_records: false,
  market_data: false,
  ai_assistant: false,
};

const meta: PlatformMetaResponse = {
  contractVersion: "2.4.0",
  application: { name: "Test", shortName: "Test" },
  limits: {
    searchResultsMax: 50,
    registryPageMin: 1,
    registryPageMax: 100,
    peoplePageMax: 100,
    pedigreeAncestorDepthMax: 8,
    pedigreeDescendantDepthMax: 6,
    pedigreeDescendantNodesMax: 1000,
    pedigreeMetricsDepthMax: 8,
    pedigreeDescendantMetricsNodesMax: 10_000,
    pedigreePathMax: 32,
    relationshipDepthMax: 16,
    relationshipPathMax: 36,
    registryExportRowsMax: 500,
    changeRequestItemsMax: 24,
  },
  stats: { horses: 0, people: 0, ownerLinks: 0, breederLinks: 0, importerLinks: 0, passportReceiverLinks: 0, horsesWithBothParents: 0, horsesWithDnaData: 0, openQualityIssues: 0 },
  source: null,
  capabilities,
  featureCatalog: buildPlatformFeatureCatalog(capabilities),
};

describe("platform client", () => {
  it("normalizes registry browse parameters behind the shared client", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport: PlatformTransport = async <T>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { rows: [], total: 0, limit: 12, offset: 0, nextOffset: null, previousOffset: null, sort: "year", dir: "desc", filter: "" } as T;
    };
    const platform = createPlatformClient({ transport });

    await platform.registry.browse({
      q: "Arabian",
      yearFrom: 1990,
      yearTo: 1999,
      hasSire: true,
      sort: "year",
      dir: "desc",
      limit: 12,
    });

    const url = new URL(calls[0]!.url, "https://registry.test");
    expect(url.pathname).toBe("/api/horses");
    expect(url.searchParams.get("q")).toBe("Arabian");
    expect(url.searchParams.get("yearFrom")).toBe("1990");
    expect(url.searchParams.get("yearTo")).toBe("1999");
    expect(url.searchParams.get("hasSire")).toBe("1");
    expect(url.searchParams.get("sort")).toBe("year");
    expect(url.searchParams.get("dir")).toBe("desc");
  });

  it("keeps pedigree metric transport behind the shared client", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport: PlatformTransport = async <T>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { horseId: 42 } as T;
    };
    const platform = createPlatformClient({ transport });
    await platform.pedigree.metrics(42, { depth: 6 });
    const url = new URL(calls[0]!.url, "https://registry.test");
    expect(url.pathname).toBe("/api/horses/42/pedigree/metrics");
    expect(url.searchParams.get("depth")).toBe("6");
  });

  it("routes advanced pedigree and registry analytics through the shared SDK", async () => {
    const calls: string[] = [];
    const transport: PlatformTransport = async <T>(url: string) => { calls.push(url); return {} as T; };
    const platform = createPlatformClient({ transport });
    await platform.pedigree.coefficients(42, { depth: 8 });
    await platform.pedigree.pathsToAncestor(42, 7, { depth: 6, maxPaths: 4 });
    await platform.relationships.coefficients(1, 2, { depth: 10 });
    await platform.breeding.pairingAnalysis(1, 2, { depth: 8 });
    await platform.analytics.registry();
    expect(calls[0]).toBe("/api/horses/42/pedigree/coefficients?depth=8");
    expect(calls[1]).toBe("/api/horses/42/pedigree/paths?ancestor=7&depth=6&maxPaths=4");
    expect(calls[2]).toBe("/api/relationship/coefficients?from=1&to=2&depth=10");
    expect(calls[3]).toBe("/api/breeding/pairing-analysis?sire=1&dam=2&depth=8");
    expect(calls[4]).toBe("/api/analytics/registry");
  });

  it("owns CSRF details for frontend claim mutations", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport: PlatformTransport = async <T>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { claim: { id: "c1", horse_id: 42, status: "pending", created_at: "now" } } as T;
    };
    const platform = createPlatformClient({ transport, csrfToken: () => "csrf-123" });

    await platform.claims.create(42, { source: "test-frontend" });

    expect(calls[0]!.url).toBe("/api/claims");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-123");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ horse_id: 42, evidence: { source: "test-frontend" } });
  });

  it("rejects invalid entity ids before transport", async () => {
    let called = false;
    const platform = createPlatformClient({ transport: async <T>() => { called = true; return {} as T; } });
    await expect(platform.horses.get(0)).rejects.toThrow("positive registry id");
    expect(called).toBe(false);
  });

  it("rejects invalid breeding pairings before transport", async () => {
    let called = false;
    const platform = createPlatformClient({ transport: async <T>() => { called = true; return {} as T; } });
    await expect(platform.breeding.pairingAnalysis(42, 42)).rejects.toMatchObject({ code: "invalid_pairing", status: 400 });
    expect(called).toBe(false);
  });


  it("keeps auth session/CSRF mechanics inside the SDK", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let csrf: string | null = null;
    const sessions: Array<{ csrfToken: string | null; user: unknown }> = [];
    const transport: PlatformTransport = async <T>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/auth/login") return { user: { id: "u1", email: "x@example.com", display_name: "X", role: "owner" }, csrfToken: "csrf-login", permissions: ["claim.create", "claim.read_own"] } as T;
      if (url === "/api/auth/logout") return { ok: true } as T;
      return { user: null, csrfToken: null, permissions: [] } as T;
    };
    const platform = createPlatformClient({
      transport,
      csrfToken: () => csrf,
      onSessionChange: (session) => { csrf = session.csrfToken; sessions.push({ csrfToken: session.csrfToken, user: session.user }); },
    });

    const loggedIn = await platform.auth.login({ email: " x@example.com ", password: "password123" });
    expect(loggedIn.permissions).toContain("claim.create");
    expect(JSON.parse(String(calls[0]!.init?.body)).email).toBe("x@example.com");
    await platform.auth.logout();
    expect((calls[1]!.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-login");
    expect(sessions.at(-1)?.csrfToken).toBeNull();
  });
  it("normalizes backend error envelopes into PlatformClientError", async () => {
    const transport = createFetchPlatformTransport(async () => new Response(
      JSON.stringify({ error: { code: "not_found", message: "Horse not found", details: { id: 999 } } }),
      { status: 404, headers: { "content-type": "application/json" } },
    ));

    try {
      await transport("/api/horses/999");
      throw new Error("expected transport failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformClientError);
      expect((error as PlatformClientError).status).toBe(404);
      expect((error as PlatformClientError).code).toBe("not_found");
    }
  });

  it("captures the current CSRF token before masking authority during demo account switches", async () => {
    let csrf: string | null = null;
    const submitted: Array<{ persona: string; csrf: string | null }> = [];
    const publicIdentities: Array<string | null> = [];
    const transport: PlatformTransport = async <T>(url: string, init?: RequestInit) => {
      expect(url).toBe("/api/auth/demo-admin");
      // The host has already masked private content when transport begins.
      expect(csrf).toBeNull();
      const { persona } = JSON.parse(String(init?.body));
      submitted.push({ persona, csrf: new Headers(init?.headers).get("x-csrf-token") });
      return { user: { id: persona, email: `${persona}@example.test`, display_name: persona, role: "owner" }, csrfToken: `csrf-${submitted.length}`, permissions: ["claim.create", "claim.read_own"] } as T;
    };
    const platform = createPlatformClient({ transport, csrfToken: () => csrf, onSessionChange: session => { csrf = session.csrfToken; publicIdentities.push(session.user?.id ?? null); } });
    await platform.auth.demoPersona("owner_a");
    await platform.auth.demoPersona("owner_b");
    await platform.auth.demoPersona("owner_a");
    expect(submitted).toEqual([{ persona: "owner_a", csrf: null }, { persona: "owner_b", csrf: "csrf-1" }, { persona: "owner_a", csrf: "csrf-2" }]);
    expect(publicIdentities).toEqual([null, "owner_a", null, "owner_b", null, "owner_a"]);
  });
});

describe("frontend contract compatibility", () => {
  const v2 = { minVersion: "2.0.0", maxMajor: 2 };
  const fullSurfaceCoverage = Object.fromEntries(PLATFORM_FEATURE_KEYS.map((feature) => [feature, "surface"])) as FrontendManifest["platformFeatures"];

  it("accepts compatible v2 platform versions", () => {
    expect(contractCompatible(v2, "2.0.0")).toBe(true);
    expect(contractCompatible(v2, "2.8.4")).toBe(true);
  });

  it("rejects older or future-major platform contracts", () => {
    expect(contractCompatible(v2, "1.9.9")).toBe(false);
    expect(contractCompatible(v2, "3.0.0")).toBe(false);
  });

  it("checks required feature availability and minimum feature versions", () => {
    const manifest: FrontendManifest = {
      id: "test-ui",
      name: "Test UI",
      version: "1.0.0",
      description: "test",
      contract: { minVersion: "2.1.0", maxMajor: 2 },
      capabilities: ["home"],
      requiresPlatform: ["search", "registry"],
      featureRequirements: [{ feature: "search", minVersion: "1.0.0" }],
      platformFeatures: fullSurfaceCoverage,
      maturity: "experimental",
    };
    expect(evaluateFrontendCompatibility(manifest, meta).compatible).toBe(true);

    const futureMajor = { ...meta, featureCatalog: { ...meta.featureCatalog, search: { ...meta.featureCatalog.search, version: "2.0.0" } } };
    const maxMajorManifest = { ...manifest, featureRequirements: [{ feature: "search" as const, minVersion: "1.0.0", maxMajor: 1 }] };
    expect(evaluateFrontendCompatibility(maxMajorManifest, futureMajor).compatible).toBe(false);

    const missingRegistry = { ...meta, capabilities: { ...meta.capabilities, registry: false } };
    const report = evaluateFrontendCompatibility(manifest, missingRegistry);
    expect(report.compatible).toBe(false);
    expect(report.blockingIssues.some((issue) => issue.code === "missing-feature" && issue.feature === "registry")).toBe(true);
  });

  it("keeps additive live-feature parity debt non-blocking at runtime", () => {
    const manifest: FrontendManifest = {
      id: "older-ui",
      name: "Older UI",
      version: "1.0.0",
      description: "test",
      contract: { minVersion: "2.1.0", maxMajor: 2 },
      capabilities: ["home"],
      requiresPlatform: ["search", "registry", "horse_profiles"],
      platformFeatures: { ...fullSurfaceCoverage, breeding_analysis: "dormant" },
      maturity: "experimental",
    };
    const report = evaluateFrontendCompatibility(manifest, meta);
    expect(report.compatible).toBe(true);
    expect(report.blockingIssues).toHaveLength(0);
    expect(report.warnings.some((issue) => issue.code === "unexposed-feature" && issue.feature === "breeding_analysis")).toBe(true);
  });
});
