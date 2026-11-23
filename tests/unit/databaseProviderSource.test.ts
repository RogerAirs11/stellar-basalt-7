import { describe, expect, it } from "vitest";
import fs from "node:fs";

const provider = fs.readFileSync(new URL("../../src/db/provider.ts", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../../src/db/tursoCompat.ts", import.meta.url), "utf8");
const supabaseAdapter = fs.readFileSync(new URL("../../src/db/supabaseCompat.ts", import.meta.url), "utf8");
// R69-audit (A2): the SQLite→Postgres translator was extracted from supabaseCompat.ts
// into sqliteSqlToPostgres.ts (supabaseCompat now re-exports it), so translation-marker
// assertions read the translator source directly.
const sqliteTranslator = fs.readFileSync(new URL("../../src/db/sqliteSqlToPostgres.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../../src/worker.ts", import.meta.url), "utf8");

describe("dual database provider safety", () => {
  it("supports explicit D1/Turso/Supabase single-provider and read-failover modes", () => {
    // R102: the mode union and parser moved to src/db/providerMode.ts with an
    // audited supabase_full default and fail-closed invalid handling. provider.ts
    // re-exports the type and consumes the parser, so the mode set is asserted
    // against the new authority file (plus supabase_read_with_d1_write below).
    const providerMode = fs.readFileSync(new URL("../../src/db/providerMode.ts", import.meta.url), "utf8");
    for (const mode of ["d1_only", "turso_only", "d1_with_turso_read_failover", "turso_with_d1_read_failover", "supabase_only", "d1_with_supabase_read_failover", "supabase_with_d1_read_failover", "supabase_with_turso_read_failover", "turso_with_supabase_read_failover"]) {
      expect(providerMode).toContain(`\"${mode}\"`);
    }
    expect(provider).toContain('parseDatabaseProviderMode as parseMode');
  });

  it("restricts automatic failover to reviewed anonymous public-snapshot reads", () => {
    // R98: the boundary moved from a provider.ts denylist to the reviewed
    // publicSnapshotPolicy ALLOWLIST — GET/HEAD only, anonymous only, explicit
    // path allowlist (new routes are denied until their read surface is
    // reviewed). Failover can never serve a private or authenticated read.
    expect(provider).toContain("publicSnapshotReadEligible");
    const policy = fs.readFileSync(new URL("../../src/db/publicSnapshotPolicy.ts", import.meta.url), "utf8");
    expect(policy).toContain('["GET", "HEAD"].includes(request.method.toUpperCase())');
    expect(policy).toContain('["authorization", "cookie", "x-api-key"]');
    expect(policy).toContain('"token", "signature", "access_token"');
    expect(policy).toContain("PUBLIC_SNAPSHOT_PATHS.has(url.pathname)");
    expect(policy).toContain("/api/search");
  });

  it("prevents DB mutations while automatic failover mode is active", () => {
    // R32: the mutation classifier was renamed to classifyDatabaseRequestIntent
    // during the intent-based routing refactor; the read-only guard itself is
    // asserted below through database_failover_mode_read_only.
    expect(provider).toContain("classifyDatabaseRequestIntent");
    expect(provider).toContain("database_failover_mode_read_only");
    expect(provider).toContain('path === "/api/breeding/optimizer"');
  });

  it("requires full dataset/source/filter parity before provider eligibility", () => {
    expect(provider).toContain("DEFAULT_REQUIRED_SOURCE_SHA");
    expect(provider).toContain("DEFAULT_REQUIRED_HORSES");
    expect(provider).toContain("value.filterCounts !== 412");
    expect(provider).toContain('value.importStatus !== "complete"');
    expect(provider).toContain("canonicalRevision");
  });

  it("fails closed on cold failover unless canonical and derived generations match the deployment pin", () => {
    expect(provider).toContain("DEFAULT_REQUIRED_CANONICAL_REVISION");
    expect(provider).toContain("DEFAULT_REQUIRED_ANALYTICS_SOURCE_REVISION");
    expect(provider).toContain("DB_FAILOVER_REQUIRED_CANONICAL_REVISION");
    expect(provider).toContain("DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION");
    expect(provider).toContain("value.analyticsStale !== 0");
    expect(provider).toContain("registrySnapshotRevision");
    expect(provider).toContain("filterRevisionMin");
    expect(provider).toContain("filterRevisionMax");
  });

  it("uses request-scoped Turso clients and enables foreign keys before transactional writes", () => {
    expect(adapter).toContain("create one client per Worker request");
    expect(adapter).toContain('await this.client.execute("PRAGMA foreign_keys=ON")');
    expect(adapter).toContain('await client.execute("PRAGMA foreign_keys=ON")');
    expect(adapter).toContain("SELECT last_insert_rowid() AS __last_row_id");
  });


  it("covers every ordered two-provider public-read fallback pairing", () => {
    for (const mode of [
      "d1_with_turso_read_failover", "turso_with_d1_read_failover",
      "d1_with_supabase_read_failover", "supabase_with_d1_read_failover",
      "turso_with_supabase_read_failover", "supabase_with_turso_read_failover",
    ]) expect(provider).toContain(`\"${mode}\"`);
    // R56: the split read/write posture keeps D1 as the canonical write primary
    // while Supabase serves public reads (with the Turso read failover).
    expect(provider).toContain("supabase_read_with_d1_write");
    expect(provider).toContain('write: "d1"');
  });

  it("keeps dual-mode Supabase read-only while the R59 full mode owns writes, with serverless transaction-pooler discipline", () => {
    // Dual/failover modes keep Supabase read-only; supabase_full (R59) is the
    // explicitly validated canonical write mode.
    expect(provider).toContain("supabase_provider_read_only");
    expect(provider).toContain("supabase_full");
    expect(provider).toContain('write: "supabase"');
    expect(provider).toContain("SUPABASE_HYPERDRIVE");
    expect(provider).toContain("SUPABASE_DATABASE_URL");
    expect(provider).toContain("{ hyperdrive: true, mode }");
    expect(supabaseAdapter).toContain("prepare: false");
    // R132: the R131 isolate-scoped client pool is REMOVED — sharing postgres.js
    // sockets across Workers requests violates the runtime's I/O model
    // ("Cannot perform I/O on behalf of a different request"). One
    // request-scoped client per request (max:1, idle_timeout:0); Hyperdrive
    // itself owns the cross-request connection pool. A failed read recycles
    // the client and retries once within the same request; writes fail fast.
    expect(supabaseAdapter).toContain("max: 1");
    expect(supabaseAdapter).toContain("idle_timeout: 0");
    expect(supabaseAdapter).toContain("request-scoped");
    expect(supabaseAdapter).not.toContain("const clients = new Map");
    expect(supabaseAdapter).not.toContain("hyperdriveClientPool");
    expect(supabaseAdapter).toContain("writes never retry");
    expect(supabaseAdapter).toContain("client.end({ timeout: 1 })");
    expect(supabaseAdapter).toContain("public-read-only");
    expect(supabaseAdapter).toContain("sqliteSqlToPostgres");
    expect(sqliteTranslator).toContain("ON CONFLICT DO NOTHING");
    expect(supabaseAdapter).toContain("client.begin");
    expect(worker).toContain("releaseDatabaseForRequest");
  });

  it("supports short health caching plus same-request read fallback", () => {
    expect(provider).toContain("DB_HEALTH_CACHE_MS");
    expect(provider).toContain("healthCache");
    expect(provider).toContain("resolveReadFallbackAfterFailure");
    expect(worker).toContain("resolveReadFallbackAfterFailure(request, env, databaseEnv)");
  });

  it("routes API requests through the provider resolver before routeApi", () => {
    expect(worker).toContain("resolveDatabaseForRequest(request, env)");
    expect(worker).toContain("routeApi(request, databaseEnv)");
  });
});
