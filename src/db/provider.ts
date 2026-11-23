import { associateDatabaseRuntimeIdentity } from "./runtimeIdentity";
import { safeErrorCategory } from "../security/logging";
import { publicSnapshotReadEligible } from "./publicSnapshotPolicy";
import { HttpError } from "../api/http";
import { closeTursoD1Database, createTursoD1Database } from "./tursoCompat";
import { closeSupabaseD1Database, createSupabaseD1Database } from "./supabaseCompat";

export type DatabaseProviderName = "d1" | "turso" | "supabase";
export type { DatabaseProviderMode } from "./providerMode";
import { parseDatabaseProviderMode as parseMode, type DatabaseProviderMode } from "./providerMode";

export interface DatabaseRuntimeSelection {
  configuredMode: DatabaseProviderMode;
  primary: DatabaseProviderName;
  fallback?: DatabaseProviderName;
  active: DatabaseProviderName;
  failoverUsed: boolean;
  failoverEligible: boolean;
  reason:
    | "primary"
    | "primary_cached_healthy"
    | "primary_circuit_open"
    | "primary_probe_failed"
    | "primary_request_failed"
    | "manual_single_provider";
}

type Probe = {
  horseCount: number;
  sourceSha256: string | null;
  importStatus: string | null;
  filterCounts: number;
  canonicalRevision: number;
  analyticsStale: number;
  analyticsSourceRevision: string | null;
  registrySnapshotRevision: string | null;
  filterRevisionMin: string | null;
  filterRevisionMax: string | null;
};

type ProviderSpec = {
  primary: DatabaseProviderName;
  fallback?: DatabaseProviderName;
  /** Canonical write primary for split read/write modes (R56). Reads pull
   *  from `primary`; mutations and other non-read intents route here. */
  write?: DatabaseProviderName;
};

type HealthCacheEntry = {
  healthyUntil: number;
  probe: Probe;
};

type ProviderHealthState = {
  configuration: unknown[];
  identities: Map<DatabaseProviderName, object>;
  circuitOpenUntil: Map<DatabaseProviderName, number>;
  healthCache: Map<DatabaseProviderName, HealthCacheEntry>;
};
const providerHealthStates = new WeakMap<Env, ProviderHealthState>();

function healthStateFor(env: Env): ProviderHealthState {
  // References/values stay in memory only and must never be logged. A changed
  // binding, credential, generation pin or policy invalidates cached health.
  const configuration = [env.DB, env.DB_PROVIDER_MODE,
    env.SUPABASE_HYPERDRIVE?.connectionString, env.SUPABASE_DATABASE_URL,
    env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN,
    env.DB_FAILOVER_REQUIRED_HORSE_COUNT, env.DB_FAILOVER_REQUIRED_SOURCE_SHA256,
    env.DB_FAILOVER_REQUIRED_CANONICAL_REVISION, env.DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION,
    env.DB_HEALTH_CACHE_MS, env.DB_HEALTH_TIMEOUT_MS, env.DB_FAILOVER_COOLDOWN_MS];
  let state = providerHealthStates.get(env);
  if (!state || configuration.some((value, index) => !Object.is(value, state!.configuration[index]))) {
    state = { configuration, identities: new Map(), circuitOpenUntil: new Map(), healthCache: new Map() };
    providerHealthStates.set(env, state);
  }
  return state;
}

// Serving generation pin (turn 28, 2026-10-23): rebuilt analytics generation
// over the quality-pass-2 registry (93,892 active horses = turn-26 93,421
// − 1,097 chip-evidence duplicate merges + 1,568 name-only racing-parent
// stubs). sha256:c6fea7b1… is the analytics source_revision computed by
// tools/build_analytics_snapshot.py; the bare hex is the latest source_imports
// ledger row (turn28_quality_pass_2). The round also fixed 3,276 birth dates,
// nulled 236 junk birth years, resolved 52 skipped racing cuids (+562 results
// linked), added +4,363/+4,238 pedigree edges and completed the newsroom
// ar/zh titles (141/141 posts fully quadlingual). Env overrides:
// DB_FAILOVER_REQUIRED_* — D1 and Turso stay at the previous generation until
// their mirror catch-up, so failover modes must arm those env vars (or remain
// unused) until then.
const DEFAULT_REQUIRED_SOURCE_SHA = "466cce97efad531d79e37a72a76efae03db644bf51af08c5170e890c03d5d4e6";
const DEFAULT_REQUIRED_HORSES = 93_896;
const DEFAULT_REQUIRED_CANONICAL_REVISION = 0;
const DEFAULT_REQUIRED_ANALYTICS_SOURCE_REVISION = "sha256:c6fea7b1bf29fb256e4605210c402927b994adea30b4740fdf275f40d89b135f";
const DEFAULT_HEALTH_TIMEOUT_MS = 2_500;
const DEFAULT_HEALTH_CACHE_MS = 2_000;
const DEFAULT_COOLDOWN_MS = 30_000;



function specFor(mode: DatabaseProviderMode): ProviderSpec {
  if (mode === "d1_full") return { primary: "d1", write: "d1" };
  if (mode === "turso_full") return { primary: "turso", write: "turso" };
  if (mode === "turso_only") return { primary: "turso" };
  if (mode === "supabase_only") return { primary: "supabase" };
  if (mode === "d1_with_turso_read_failover") return { primary: "d1", fallback: "turso" };
  if (mode === "turso_with_d1_read_failover") return { primary: "turso", fallback: "d1" };
  if (mode === "d1_with_supabase_read_failover") return { primary: "d1", fallback: "supabase" };
  if (mode === "supabase_with_d1_read_failover") return { primary: "supabase", fallback: "d1" };
  if (mode === "supabase_with_turso_read_failover") return { primary: "supabase", fallback: "turso" };
  if (mode === "turso_with_supabase_read_failover") return { primary: "turso", fallback: "supabase" };
  if (mode === "supabase_read_with_d1_write") return { primary: "supabase", fallback: "turso", write: "d1" };
  if (mode === "supabase_full") return { primary: "supabase", write: "supabase" };
  return { primary: "d1" };
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function scopedProviderDatabase(provider: DatabaseProviderName, env: Env, database: D1Database): D1Database {
  const state = healthStateFor(env);
  let identity = state.identities.get(provider);
  if (!identity) { identity = {}; state.identities.set(provider, identity); }
  return associateDatabaseRuntimeIdentity(database, identity);
}

function providerDb(provider: DatabaseProviderName, env: Env, opts: { write?: boolean } = {}): D1Database {
  if (provider === "d1") {
    if (!env.DB || typeof env.DB.prepare !== "function" || typeof env.DB.batch !== "function") {
      throw new HttpError(503, "d1_not_configured", "The D1 database binding is not configured");
    }
    return env.DB;
  }
  if (provider === "supabase") {
    const mode = opts.write ? ("full" as const) : ("read" as const);
    if (env.SUPABASE_HYPERDRIVE?.connectionString) {
      return scopedProviderDatabase(provider, env, createSupabaseD1Database(env.SUPABASE_HYPERDRIVE.connectionString, { hyperdrive: true, mode }));
    }
    if (!env.SUPABASE_DATABASE_URL) {
      throw new HttpError(503, "supabase_not_configured", "Supabase Hyperdrive binding or database connection string is not configured");
    }
    return scopedProviderDatabase(provider, env, createSupabaseD1Database(env.SUPABASE_DATABASE_URL, { mode }));
  }
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new HttpError(503, "turso_not_configured", "Turso database credentials are not configured");
  }
  return scopedProviderDatabase(provider, env, createTursoD1Database(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN));
}

export type DatabaseRequestIntent =
  | "canonical_read"
  | "canonical_write"
  | "ai_state_read"
  | "ai_state_write"
  | "ai_state_write_canonical_read";

/**
 * Classify the database semantics of an API request. HTTP method alone is not
 * sufficient: an AI message POST writes assistant state while only reading the
 * canonical registry, and the breeding optimizer is a read-only calculation.
 */
export function classifyDatabaseRequestIntent(request: Request): DatabaseRequestIntent {
  const method = request.method.toUpperCase();
  const path = new URL(request.url).pathname;

  if (path === "/api/ai/status" || path === "/api/ai/models" || path === "/api/admin/ai/status") {
    return "ai_state_read";
  }
  if (path === "/api/ai/conversations") {
    return method === "GET" || method === "HEAD" ? "ai_state_read" : "ai_state_write";
  }
  if (/^\/api\/ai\/conversations\/[^/]+\/messages$/.test(path) && method === "POST") {
    return "ai_state_write_canonical_read";
  }
  if (/^\/api\/ai\/conversations\/[^/]+$/.test(path)) {
    return method === "GET" || method === "HEAD" ? "ai_state_read" : "ai_state_write";
  }
  if (path === "/api/breeding/optimizer" && method === "POST") return "canonical_read";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "canonical_read";
  return "canonical_write";
}

function needsCanonicalRead(intent: DatabaseRequestIntent): boolean {
  return intent === "canonical_read" || intent === "ai_state_write_canonical_read";
}

function needsAiState(intent: DatabaseRequestIntent): boolean {
  return intent === "ai_state_read" || intent === "ai_state_write" || intent === "ai_state_write_canonical_read";
}

function canonicalReadFailoverEligible(request: Request, intent = classifyDatabaseRequestIntent(request)): boolean {
  return publicSnapshotReadEligible(request, intent);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`database health probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probe(db: D1Database): Promise<Probe> {
  const row = await db.prepare(`
    SELECT
      r.active_horse_count AS horse_count,
      (SELECT source_sha256 FROM source_imports ORDER BY id DESC LIMIT 1) AS source_sha256,
      (SELECT status FROM source_imports ORDER BY id DESC LIMIT 1) AS import_status,
      (SELECT COUNT(*) FROM registry_filter_counts) AS filter_counts,
      rs.canonical_revision AS canonical_revision,
      rs.analytics_stale AS analytics_stale,
      rs.analytics_source_revision AS analytics_source_revision,
      (SELECT source_revision FROM analytics_snapshots WHERE key='registry-overview' LIMIT 1) AS registry_snapshot_revision,
      (SELECT MIN(source_revision) FROM registry_filter_counts) AS filter_revision_min,
      (SELECT MAX(source_revision) FROM registry_filter_counts) AS filter_revision_max
    FROM registry_runtime_counters r
    JOIN registry_state rs ON rs.id=1
    WHERE r.id=1
  `).first<{
    horse_count?: number;
    source_sha256?: string;
    import_status?: string;
    filter_counts?: number;
    canonical_revision?: number;
    analytics_stale?: number;
    analytics_source_revision?: string;
    registry_snapshot_revision?: string;
    filter_revision_min?: string;
    filter_revision_max?: string;
  }>();
  return {
    horseCount: Number(row?.horse_count ?? 0),
    sourceSha256: row?.source_sha256 ? String(row.source_sha256) : null,
    importStatus: row?.import_status ? String(row.import_status) : null,
    filterCounts: Number(row?.filter_counts ?? 0),
    canonicalRevision: Number(row?.canonical_revision ?? -1),
    analyticsStale: Number(row?.analytics_stale ?? 1),
    analyticsSourceRevision: row?.analytics_source_revision ? String(row.analytics_source_revision) : null,
    registrySnapshotRevision: row?.registry_snapshot_revision ? String(row.registry_snapshot_revision) : null,
    filterRevisionMin: row?.filter_revision_min ? String(row.filter_revision_min) : null,
    filterRevisionMax: row?.filter_revision_max ? String(row.filter_revision_max) : null,
  };
}

function assertCompleteDataset(value: Probe, env: Env, provider: DatabaseProviderName): void {
  const requiredHorseCount = boundedInteger(env.DB_FAILOVER_REQUIRED_HORSE_COUNT, DEFAULT_REQUIRED_HORSES, 1, 10_000_000);
  const requiredSourceSha = (env.DB_FAILOVER_REQUIRED_SOURCE_SHA256 || DEFAULT_REQUIRED_SOURCE_SHA).trim().toLowerCase();
  if (value.horseCount !== requiredHorseCount) {
    throw new Error(`${provider} horse-count mismatch: ${value.horseCount} != ${requiredHorseCount}`);
  }
  if ((value.sourceSha256 ?? "").toLowerCase() !== requiredSourceSha) {
    throw new Error(`${provider} source SHA mismatch`);
  }
  if (value.importStatus !== "complete") throw new Error(`${provider} source import is not complete`);
  if (value.filterCounts !== 412) throw new Error(`${provider} filter-count snapshot mismatch: ${value.filterCounts} != 412`);
  if (!Number.isSafeInteger(value.canonicalRevision) || value.canonicalRevision < 0) {
    throw new Error(`${provider} canonical revision is invalid`);
  }
  const requiredCanonicalRevision = boundedInteger(
    env.DB_FAILOVER_REQUIRED_CANONICAL_REVISION,
    DEFAULT_REQUIRED_CANONICAL_REVISION,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (value.canonicalRevision !== requiredCanonicalRevision) {
    throw new Error(`${provider} canonical revision mismatch: ${value.canonicalRevision} != ${requiredCanonicalRevision}`);
  }
  const requiredAnalyticsRevision = (
    env.DB_FAILOVER_REQUIRED_ANALYTICS_SOURCE_REVISION || DEFAULT_REQUIRED_ANALYTICS_SOURCE_REVISION
  ).trim();
  if (value.analyticsStale !== 0) throw new Error(`${provider} derived analytics are stale`);
  if (!requiredAnalyticsRevision || value.analyticsSourceRevision !== requiredAnalyticsRevision) {
    throw new Error(`${provider} analytics source revision mismatch`);
  }
  if (value.registrySnapshotRevision !== requiredAnalyticsRevision) {
    throw new Error(`${provider} registry analytics snapshot revision mismatch`);
  }
  if (value.filterRevisionMin !== requiredAnalyticsRevision || value.filterRevisionMax !== requiredAnalyticsRevision) {
    throw new Error(`${provider} registry filter-count generation mismatch`);
  }
}

async function freshHealthyProvider(
  provider: DatabaseProviderName,
  env: Env,
  timeoutMs: number,
  healthCacheMs: number,
): Promise<{ db: D1Database; probe: Probe }> {
  const db = providerDb(provider, env);
  try {
    const result = await withTimeout(probe(db), timeoutMs);
    assertCompleteDataset(result, env, provider);
    healthStateFor(env).healthCache.set(provider, { healthyUntil: Date.now() + healthCacheMs, probe: result });
    return { db, probe: result };
  } catch (cause) {
    await releaseProviderDatabase(db);
    throw cause;
  }
}

function cloneEnvWithDb(env: Env, db: D1Database, runtime: DatabaseRuntimeSelection): Env {
  // Preserve canonical authentication authority before replacing DB with a
  // request-selected registry read provider.
  if (runtime.configuredMode === "supabase_full" || runtime.configuredMode === "d1_full" || runtime.configuredMode === "turso_full") {
    // Full-canonical modes: auth, AI state and registry data share one store. Override legacy bindings as well: a configured D1 AUTH_DB must
    // not silently split session/AI authority from the canonical store.
    return { ...env, AUTH_DB: db, AI_DB: db, DB: db, DB_RUNTIME: runtime };
  }
  return { ...env, AUTH_DB: env.AUTH_DB ?? env.DB, AI_DB: env.AI_DB ?? env.DB, DB: db, DB_RUNTIME: runtime };
}

function runtime(
  mode: DatabaseProviderMode,
  spec: ProviderSpec,
  active: DatabaseProviderName,
  failoverUsed: boolean,
  failoverEligible: boolean,
  reason: DatabaseRuntimeSelection["reason"],
): DatabaseRuntimeSelection {
  return {
    configuredMode: mode,
    primary: spec.primary,
    fallback: spec.fallback,
    active,
    failoverUsed,
    failoverEligible,
    reason,
  };
}

async function eligibleFallback(
  request: Request,
  env: Env,
  mode: DatabaseProviderMode,
  spec: ProviderSpec,
  reason: DatabaseRuntimeSelection["reason"],
  expectedCanonicalRevision?: number,
): Promise<Env> {
  if (!spec.fallback || !canonicalReadFailoverEligible(request)) {
    throw new HttpError(503, "database_unavailable", "Database fallback is not allowed for this request");
  }
  const timeoutMs = boundedInteger(env.DB_HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT_MS, 250, 10_000);
  const healthCacheMs = boundedInteger(env.DB_HEALTH_CACHE_MS, DEFAULT_HEALTH_CACHE_MS, 0, 30_000);
  let fallback: Awaited<ReturnType<typeof freshHealthyProvider>> | undefined;
  try {
    fallback = await freshHealthyProvider(spec.fallback, env, timeoutMs, healthCacheMs);
    // Every provider is independently pinned to the deployed serving generation
    // by assertCompleteDataset(), including canonical revision and derived-data
    // source revision. When a primary revision was observed in this isolate, also
    // require exact primary/fallback revision parity. This keeps cold-start
    // failover fail-closed even when the primary dies before its first probe.
    if (expectedCanonicalRevision !== undefined && fallback.probe.canonicalRevision !== expectedCanonicalRevision) {
      throw new Error(
        `${spec.fallback} canonical revision mismatch: ${fallback.probe.canonicalRevision} != ${expectedCanonicalRevision}`,
      );
    }
    return cloneEnvWithDb(env, fallback.db, runtime(mode, spec, spec.fallback, true, true, reason));
  } catch (cause) {
    if (fallback) await releaseProviderDatabase(fallback.db);
    throw new HttpError(503, "database_unavailable", "Primary database is unavailable and the read-only fallback is not eligible", {
      primary: spec.primary,
      fallback: spec.fallback,
    });
  }
}

export async function resolveDatabaseForRequest(request: Request, env: Env): Promise<Env> {
  const mode = parseMode(env.DB_PROVIDER_MODE);
  const spec = specFor(mode);
  const intent = classifyDatabaseRequestIntent(request);
  // Pure AI-state requests do not need a canonical registry provider at all.
  // Keep the original canonical D1 binding available for auth and let AI_DB
  // (or DB in a validated single-provider mode) own assistant persistence —
  // EXCEPT in full Supabase mode, where AI state is canonical in Supabase too.
  if (intent === "ai_state_read" || intent === "ai_state_write") {
    if (mode === "supabase_full" || mode === "d1_full" || mode === "turso_full") {
      const db = providerDb(spec.primary, env, { write: true });
      return cloneEnvWithDb(env, db, runtime(mode, spec, spec.primary, false, false, "manual_single_provider"));
    }
    return { ...env, AUTH_DB: env.AUTH_DB ?? env.DB };
  }

  const failoverEligible = Boolean(spec.fallback) && canonicalReadFailoverEligible(request, intent);

  // R98: a read replica's horse-data revision does not prove freshness of
  // private grants, leads, payments or publication consent. In split mode only
  // reviewed anonymous public-snapshot requests may use the read provider.
  // Everything else, including authenticated GETs and hybrid AI, uses the
  // canonical write authority (and never falls back).
  if (spec.write && !publicSnapshotReadEligible(request, intent)) {
    const writeIsPrimary = spec.write === spec.primary;
    const db = providerDb(spec.write, env, { write: true });
    return cloneEnvWithDb(env, db, runtime(mode, spec, spec.write, false, false, writeIsPrimary ? "manual_single_provider" : "primary"));
  }

  if (spec.primary === "supabase" && !spec.write && !publicSnapshotReadEligible(request, intent)) {
    throw new HttpError(503, "snapshot_provider_private_read_denied",
      "This provider is an immutable public snapshot; private reads require an authoritative database mode");
  }

  // Supabase is deliberately canonical-read-only EXCEPT in the R59 full mode
  // where it is the canonical write primary as well.
  if (spec.primary === "supabase" && spec.write !== "supabase" && intent === "canonical_write") {
    throw new HttpError(503, "supabase_provider_read_only",
      "Supabase provider is currently public-read-only; use a validated D1/Turso single-provider mode for canonical writes");
  }
  if (spec.primary === "supabase" && spec.write !== "supabase" && !needsCanonicalRead(intent)) {
    throw new HttpError(503, "supabase_provider_public_read_only",
      "Supabase provider currently serves only the validated canonical-read API surface");
  }

  // Dual-provider modes do not replicate canonical writes. AI-state writes are
  // independent and were already required to use AI_DB above.
  if (spec.fallback && intent === "canonical_write") {
    throw new HttpError(503, "database_failover_mode_read_only",
      "Automatic database failover mode is read-only for canonical registry data; switch to a single-provider mode for canonical writes");
  }

  if (!spec.fallback || !failoverEligible) {
    // R59: in supabase_full the read path also uses the full-mode adapter —
    // hybrid AI requests resolve here and their state writes must be able to
    // use the same database object.
    const db = providerDb(spec.primary, env, { write: mode === "supabase_full" });
    return cloneEnvWithDb(env, db, runtime(
      mode,
      spec,
      spec.primary,
      false,
      failoverEligible,
      spec.fallback ? "primary" : "manual_single_provider",
    ));
  }

  const timeoutMs = boundedInteger(env.DB_HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT_MS, 250, 10_000);
  const healthCacheMs = boundedInteger(env.DB_HEALTH_CACHE_MS, DEFAULT_HEALTH_CACHE_MS, 0, 30_000);
  const cooldownMs = boundedInteger(env.DB_FAILOVER_COOLDOWN_MS, DEFAULT_COOLDOWN_MS, 1_000, 300_000);
  const { circuitOpenUntil, healthCache } = healthStateFor(env);
  const now = Date.now();
  const openUntil = circuitOpenUntil.get(spec.primary) ?? 0;
  const cached = healthCache.get(spec.primary);

  if (openUntil <= now && cached && cached.healthyUntil > now) {
    const db = providerDb(spec.primary, env);
    return cloneEnvWithDb(env, db, runtime(mode, spec, spec.primary, false, true, "primary_cached_healthy"));
  }

  if (openUntil <= now) {
    try {
      const healthy = await freshHealthyProvider(spec.primary, env, timeoutMs, healthCacheMs);
      circuitOpenUntil.delete(spec.primary);
      return cloneEnvWithDb(env, healthy.db, runtime(mode, spec, spec.primary, false, true, "primary"));
    } catch (cause) {
      console.warn("Database primary health probe failed; evaluating read-only fallback", {
        provider: spec.primary,
        errorType: safeErrorCategory(cause),
      });
      healthCache.delete(spec.primary);
      circuitOpenUntil.set(spec.primary, now + cooldownMs);
    }
  }

  const expectedRevision = cached?.probe.canonicalRevision;
  return eligibleFallback(
    request,
    env,
    mode,
    spec,
    openUntil > now ? "primary_circuit_open" : "primary_probe_failed",
    expectedRevision,
  );
}

/**
 * Same-request emergency retry for a public read that selected the primary but
 * then failed during the actual route query (for example a D1 quota rejection
 * immediately after a successful health probe). Http/validation errors are
 * filtered by the Worker before calling this helper.
 */
export async function resolveReadFallbackAfterFailure(request: Request, originalEnv: Env, selectedEnv: Env): Promise<Env | null> {
  // Never replay hybrid AI turns: assistant state/provider side effects may have
  // occurred before a registry read failure. Proactive failover is still used.
  if (classifyDatabaseRequestIntent(request) !== "canonical_read") return null;
  const selected = selectedEnv.DB_RUNTIME;
  if (!selected || selected.failoverUsed || !selected.failoverEligible || !selected.fallback) return null;

  const mode = parseMode(originalEnv.DB_PROVIDER_MODE);
  const spec = specFor(mode);
  if (spec.primary !== selected.active || spec.fallback !== selected.fallback) return null;

  const cooldownMs = boundedInteger(originalEnv.DB_FAILOVER_COOLDOWN_MS, DEFAULT_COOLDOWN_MS, 1_000, 300_000);
  const { circuitOpenUntil, healthCache } = healthStateFor(originalEnv);
  const cached = healthCache.get(spec.primary);
  healthCache.delete(spec.primary);
  circuitOpenUntil.set(spec.primary, Date.now() + cooldownMs);

  return eligibleFallback(
    request,
    originalEnv,
    mode,
    spec,
    "primary_request_failed",
    cached?.probe.canonicalRevision,
  );
}


/** Only adapters created by this layer own closeable request resources. */
async function releaseProviderDatabase(db: D1Database): Promise<void> {
  try {
    await closeSupabaseD1Database(db);
    await closeTursoD1Database(db);
  } catch {
    // Cleanup must not replace a route/probe failure or disclose driver secrets.
    console.warn("Database request-scope cleanup failed");
  }
}

/** Called after body EOF/error/cancellation, not when an SSE response is made. */
export async function releaseDatabaseForRequest(resolvedEnv: Env | undefined): Promise<void> {
  if (resolvedEnv) await releaseProviderDatabase(resolvedEnv.DB);
}
