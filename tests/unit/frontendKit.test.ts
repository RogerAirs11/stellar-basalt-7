import { describe, expect, it } from "vitest";
import { createMockPlatformClient, horseDbRoutes, isCanonicalHorseDbRoute, isPlatformClientError, parseFrontendLocalRoute, parseHorseDbRoute, supportsPlatformFeature } from "../../src/frontend-kit";

describe("frontend integration kit", () => {
  it("provides canonical route builders and parsing", () => {
    expect(horseDbRoutes.horse(42)).toBe("/horse/42");
    expect(horseDbRoutes.person(7)).toBe("/person/7");
    expect(horseDbRoutes.stats()).toBe("/stats");
    expect(parseHorseDbRoute("/stats")).toEqual({ kind: "stats" });
    expect(isCanonicalHorseDbRoute("/stats")).toBe(true);
    expect(parseHorseDbRoute("/horse/42")).toEqual({ kind: "horse", id: 42 });
    expect(horseDbRoutes.frontend("equidata-elite", "/compare")).toBe("/f/equidata-elite/compare");
    expect(parseFrontendLocalRoute("/f/equidata-elite/compare")).toEqual({ frontendId: "equidata-elite", path: "/compare" });
    expect(isCanonicalHorseDbRoute("/horse/42")).toBe(true);
    expect(isCanonicalHorseDbRoute("/f/equidata-elite/compare")).toBe(false);
    expect(parseHorseDbRoute("/admin")).toEqual({ kind: "unknown", path: "/admin" });
    expect(parseHorseDbRoute("/something-new")).toEqual({ kind: "unknown", path: "/something-new" });
  });

  it("lets a frontend prototype against the contract without a backend", async () => {
    const platform = createMockPlatformClient();
    const meta = await platform.meta();
    expect(meta.capabilities.registry).toBe(true);
    expect(meta.featureCatalog.registry.version).toBe("1.2.0");
    expect(supportsPlatformFeature(meta, "registry", { minVersion: "1.0.0", maxMajor: 1 })).toBe(true);
    expect("transport" in meta).toBe(false);

    const search = await platform.search.horses("Shah", { limit: 5 });
    expect(search.results[0]?.name_latin).toBe("Shahriar");
    const metrics = await platform.pedigree.metrics(101, { depth: 2 });
    expect(metrics.knownAncestorPositions).toBe(2);
    expect(metrics.completenessPercent).toBeCloseTo(33.33, 2);
    expect(metrics.provenance.method).toBe("pedigree-position-coverage");
    expect(metrics.branches?.sire.rootHorseId).toBe(102);
    const descendants = await platform.pedigree.descendantMetrics(102, { depth: 3 });
    expect(descendants.directChildren).toBeGreaterThanOrEqual(1);
    expect(descendants.provenance.method).toBe("bounded-descendant-reach");
    const relationship = await platform.relationships.commonAncestors(102, 101, { depth: 4 });
    expect(relationship.summary?.kind).toBe("direct_ancestor");

    expect((await platform.auth.me()).user).toBeNull();
    expect((await platform.auth.login({ email: "demo@example.com", password: "demo" })).permissions).toContain("claim.create");
    await platform.auth.logout();
    expect((await platform.auth.me()).user).toBeNull();
  });

  it("lets agents simulate unavailable optional features with production-shaped errors", async () => {
    const platform = createMockPlatformClient({ capabilities: { relationships: false } });
    try {
      await platform.relationships.commonAncestors(101, 102);
      throw new Error("expected feature failure");
    } catch (error) {
      expect(isPlatformClientError(error)).toBe(true);
      if (isPlatformClientError(error)) {
        expect(error.status).toBe(501);
        expect(error.code).toBe("feature_unavailable");
      }
    }
  });

});
