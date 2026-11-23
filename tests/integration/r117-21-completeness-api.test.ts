import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R117-21 (Master AI R117 handoff, parent D30) — separate, data-derived
 * completeness measures: the /api/analytics/registry endpoint labels stale,
 * empty and present snapshots honestly and passes the completeness section
 * through unmodified, so every skin renders identical numbers from one value.
 *
 * The only substituted boundary is the D1 binding (scripted fake answering
 * the exact analytics snapshot SQL) — the request runs the REAL worker
 * entrypoint with the real origin/rate-limit/response pipeline.
 */

const worker = workerDefault as unknown as {
  fetch(request: Request, env: unknown): Promise<Response>;
};

interface ScriptedDb {
  analyticsStale: number;
  payloadJson: string | null;
}

function makeDb(script: ScriptedDb) {
  const makeBuilder = (sql: string, args: unknown[]) => ({
    sql,
    args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => {
      if (sql.includes("FROM registry_state s LEFT JOIN analytics_snapshots")) {
        return { payload_json: script.payloadJson ?? undefined, analytics_stale: script.analyticsStale };
      }
      return null;
    },
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 1 } }),
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string }>) =>
      statements.map((statement) => ({ results: [], success: true, meta: { changes: /\b(SELECT|WITH)\b/i.test(statement.sql) ? 0 : 1 } })),
  };
  return db as unknown as D1Database;
}

function makeLimiter() {
  return { limit: async () => ({ success: true }) };
}

function makeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    DB_PROVIDER_MODE: "d1_only",
    SESSION_COOKIE_NAME: "hr_session",
    DB: db,
    PUBLIC_RATE_LIMITER: makeLimiter(),
    AUTH_RATE_LIMITER: makeLimiter(),
    EXPENSIVE_RATE_LIMITER: makeLimiter(),
    WRITE_RATE_LIMITER: makeLimiter(),
    ACCOUNT_RATE_LIMITER: makeLimiter(),
    ASSETS: { fetch: async () => new Response("<!doctype html><html><body>Registry</body></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) },
  };
}

function call(env: unknown, path: string): Promise<Response> {
  const headers = new Headers({ "cf-connecting-ip": "203.0.113.7" });
  const request = new Request(`https://registry.example${path}`, { headers });
  return worker.fetch(request, env);
}

const COMPLETENESS = {
  snapshotTime: "2026-10-21T00:00:00Z",
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

const PAYLOAD = {
  schemaVersion: "2.2.0",
  algorithmVersion: "2.2.0",
  generatedAt: "2026-10-21T00:00:00Z",
  sourceRevision: "r117-21-test",
  horseCount: 5,
  birthDecades: [],
  sexDistribution: [],
  topBreeds: [],
  topBirthPlaces: [],
  progeny: { percentiles: { p50: 0, p90: 0, p95: 0, p99: 0, max: 0 }, horsesWithRecordedOffspring: 0, topParents: [], topSires: [], topDams: [] },
  pedigree: { analyticsEligibleHorseCount: 5, cycleNodeCount: 0, cycleContaminatedHorseCount: 0, completeness: [], topRepresentedAncestorsDepth4: [], representationInterpretation: "test" },
  completeness: COMPLETENESS,
  provenance: { interpretation: "test", canonical: false },
};

describe("R117-21 /api/analytics/registry completeness labelling", () => {
  it("labels a stale snapshot 409 analytics_stale instead of presenting old numbers as current", async () => {
    const response = await call(makeEnv(makeDb({ analyticsStale: 1, payloadJson: JSON.stringify(PAYLOAD) })), "/api/analytics/registry");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("analytics_stale");
  });

  it("labels a missing snapshot 503 analytics_unavailable instead of inventing completeness numbers", async () => {
    const response = await call(makeEnv(makeDb({ analyticsStale: 0, payloadJson: null })), "/api/analytics/registry");
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("analytics_unavailable");
  });

  it("returns the built completeness section unmodified so every skin renders identical values", async () => {
    const response = await call(makeEnv(makeDb({ analyticsStale: 0, payloadJson: JSON.stringify(PAYLOAD) })), "/api/analytics/registry");
    expect(response.status).toBe(200);
    const body = (await response.json()) as typeof PAYLOAD;
    expect(body.completeness).toEqual(COMPLETENESS);
    expect(body.completeness.measures.map((measure) => [measure.key, measure.coveredRecords, measure.totalRecords, measure.coveragePercent])).toEqual([
      ["identity", 5, 5, 100],
      ["ancestry", 3, 5, 60],
      ["evidence", 2, 5, 40],
      ["media", 1, 5, 20],
      ["activity", 4, 5, 80],
    ]);
  });
});
