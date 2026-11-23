import { databaseRuntimeIdentity } from "../../db/runtimeIdentity";
import { isVertexExpressKey } from "../providers/gemini/vertexExpress";
import { geminiKeyKind } from "../providers/gemini/relay";
import { decryptEnvelope, readEncryptionSecrets } from "./keyEncryption";

/**
 * Gemini API key ring: unified multi-key rotation for the assistant and the
 * content/editorial generators.
 *
 * Key sources, in priority order:
 *   1. Environment: GEMINI_API_KEY plus every entry of GEMINI_API_KEYS
 *      (comma/newline separated).
 *   2. Admin-managed rows in ai_provider_keys (is_enabled = 1).
 *
 * Vertex AI Express ("AQ.") keys are held back unless the ring is built with
 * vertexExpressEnabled — their Agent Platform API is disabled on the owner's
 * GCP projects, so they can only poison rotation with the enable-wall error.
 *
 * Behaviour:
 *   - pick() returns the first key that is not in a rate-limit cooldown.
 *   - markRateLimited() cools a key down (default 60s, or the provider's
 *     retry-after when known) so the next pick() rotates to another key.
 *   - Rotations are cheap: the ring is cached per process (short TTL) and
 *     cooldowns live in memory, which is sufficient for single-tenant and
 *     small-team deployments the registry targets.
 */

export interface GeminiKeyEntry {
  id: string;
  key: string;
  source: "env" | "database";
  label: string;
}

export interface GeminiKeyRingSnapshot {
  totalKeys: number;
  availableKeys: number;
  coolingKeys: number;
  keys: Array<{
    id: string;
    source: "env" | "database";
    label: string;
    masked: string;
    cooling: boolean;
    cooldownRemainingMs: number;
    lastUsedAt: string | null;
    lastStatus: string | null;
  }>;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const RING_CACHE_TTL_MS = 20_000;

export interface GeminiKeyRingOptions {
  /** Vertex AI Express ("AQ.") keys are accepted into the ring only when true. */
  vertexExpressEnabled?: boolean;
}

export class GeminiKeyRing {
  private entries: GeminiKeyEntry[] = [];
  private cooldownUntil = new Map<string, number>();
  /** Per-credential, per-model 429 cooldowns — Gemini quotas are enforced per
   *  project AND per model, so exhausting one model's bucket must not cool the
   *  credential for other models that retain independent quota. */
  private modelCooldownUntil = new Map<string, number>();
  private modelRestrictions = new Map<string, Set<string>>();
  private lastUsedAt = new Map<string, string | null>();
  private lastStatus = new Map<string, string | null>();
  private maxKeys = 12;
  private readonly vertexExpressEnabled: boolean;

  constructor(options: GeminiKeyRingOptions = {}) {
    this.vertexExpressEnabled = options.vertexExpressEnabled ?? false;
  }

  addEnvKey(key: string, label = "env key"): void {
    const cleaned = key.trim();
    if (!cleaned) return;
    if (!this.vertexExpressEnabled && isVertexExpressKey(cleaned)) return;
    if (this.entries.some(e => e.key === cleaned)) return;
    if (this.entries.length >= this.maxKeys) return;
    const index = this.entries.filter(e => e.source === "env").length + 1;
    this.entries.push({ id: `env-${index}`, key: cleaned, source: "env", label });
  }

  setDatabaseKeys(rows: Array<{ id: string; api_key: string; label?: string | null; last_used_at?: string | null; last_status?: string | null }>): void {
    const previous = new GeminiKeyRing({ vertexExpressEnabled: this.vertexExpressEnabled });
    previous.entries = this.entries;
    previous.cooldownUntil = this.cooldownUntil;
    previous.modelRestrictions = this.modelRestrictions;
    previous.lastUsedAt = this.lastUsedAt;
    previous.lastStatus = this.lastStatus;
    this.cooldownUntil = new Map();
    this.modelRestrictions = new Map();
    this.lastUsedAt = new Map();
    this.lastStatus = new Map();
    const envKeys = this.entries.filter(e => e.source === "env");
    const database: GeminiKeyEntry[] = [];
    for (const row of rows) {
      const key = String(row.api_key ?? "").trim();
      if (!key) continue;
      if (!this.vertexExpressEnabled && isVertexExpressKey(key)) continue;
      if (envKeys.some(e => e.key === key) || database.some(e => e.key === key)) continue;
      database.push({ id: String(row.id), key, source: "database", label: String(row.label ?? "admin key") });
      this.lastUsedAt.set(String(row.id), row.last_used_at ?? null);
      this.lastStatus.set(String(row.id), row.last_status ?? null);
    }
    this.entries = [...envKeys, ...database.slice(0, Math.max(0, this.maxKeys - envKeys.length))];
    this.inheritOperationalState(previous);
  }

  /** Preserve operational state across refresh only for unchanged credentials. */
  inheritOperationalState(previous: GeminiKeyRing): void {
    for (const entry of this.entries) {
      const prior = previous.entries.find(item => item.key === entry.key);
      if (!prior) continue;
      const cooldown = previous.cooldownUntil.get(prior.id);
      if (cooldown !== undefined) this.cooldownUntil.set(entry.id, cooldown);
      const restrictions = previous.modelRestrictions.get(prior.id);
      if (restrictions) this.modelRestrictions.set(entry.id, new Set(restrictions));
      const lastUsed = previous.lastUsedAt.get(prior.id);
      if (lastUsed !== undefined) this.lastUsedAt.set(entry.id, lastUsed);
      const status = previous.lastStatus.get(prior.id);
      if (status !== undefined) this.lastStatus.set(entry.id, status);
    }
  }

  get size(): number { return this.entries.length; }

  available(): number {
    const now = Date.now();
    return this.entries.filter(e => (this.cooldownUntil.get(e.id) ?? 0) <= now).length;
  }

  pick(): GeminiKeyEntry | null {
    const now = Date.now();
    for (const entry of this.entries) {
      if ((this.cooldownUntil.get(entry.id) ?? 0) <= now) return entry;
    }
    return null;
  }

  /** Never select a credential that has already rejected this model. */
  pickForModel(model: string): GeminiKeyEntry | null {
    const now = Date.now();
    for (const entry of this.entries) {
      const restricted = this.modelRestrictions.get(entry.id);
      if (restricted?.has(model)) continue;
      if ((this.cooldownUntil.get(entry.id) ?? 0) > now) continue;
      if ((this.modelCooldownUntil.get(`${entry.id}|${model}`) ?? 0) > now) continue;
      return entry;
    }
    return null;
  }

  /** Remember that `id` cannot serve `model` (availability 404). */
  markModelUnsupported(id: string, model: string): void {
    const set = this.modelRestrictions.get(id) ?? new Set<string>();
    set.add(model);
    this.modelRestrictions.set(id, set);
    this.lastStatus.set(id, `model_unsupported:${model}`);
  }

  /** Diagnostics only. Request execution must respect pick()/pickForModel(). */
  forced(): GeminiKeyEntry | null {
    return this.entries[0] ?? null;
  }

  /** First Vertex AI Express key ("AQ.…") in the ring — used as the regional-block
   *  fallback transport when generativelanguage.googleapis.com is unavailable.
   *  Empty while Vertex Express is gated off (AI_VERTEX_EXPRESS_ENABLED unset). */
  vertexExpressKey(): GeminiKeyEntry | null {
    if (!this.vertexExpressEnabled) return null;
    return this.entries.find(e => isVertexExpressKey(e.key.trim()) && this.cooldownRemainingMs(e.id) === 0) ?? null;
  }

  /** Pick any key except the given one, preferring available keys. */
  pickExcept(excludeId: string): GeminiKeyEntry | null {
    return this.pickSkipping(new Set([excludeId]));
  }

  /** Pick an available, unattempted credential; never bypass Retry-After. */
  pickSkipping(excludeIds: Set<string>): GeminiKeyEntry | null {
    const now = Date.now();
    for (const entry of this.entries) {
      if (excludeIds.has(entry.id)) continue;
      if ((this.cooldownUntil.get(entry.id) ?? 0) <= now) return entry;
    }
    return null;
  }

  /** Operator diagnostics: id/label/source/kind per key (never the raw key). */
  describeEntries(): Array<{ id: string; source: "env" | "database"; label: string; kind: "ai-studio" | "vertex-express" }> {
    return this.entries.map(e => ({ id: e.id, source: e.source, label: e.label, kind: geminiKeyKind(e.key) }));
  }

  /** Raw key lookup for server-side probes (diagnostics endpoint). */
  keyOf(id: string): string | null {
    return this.entries.find(e => e.id === id)?.key ?? null;
  }

  /** Cool a credential. With `model`, the cooldown is scoped to that model
   *  only (per-model quota exhaustion — e.g. a 429 on gemini-3.8-flash must not
   *  block the same credential's independent gemini-2.5-flash quota). Without
   *  `model`, the cooldown is global to the credential (project-wide or
   *  unidentified quota failures). Retry-After timing is always respected. */
  markRateLimited(id: string, retryAfterMs?: number | null, model?: string): void {
    const base = Number.isFinite(retryAfterMs as number) && (retryAfterMs as number) > 0
      ? Math.ceil(retryAfterMs as number)
      : DEFAULT_COOLDOWN_MS;
    if (model) {
      this.modelCooldownUntil.set(`${id}|${model}`, Date.now() + base);
      this.lastStatus.set(id, `rate_limited:${model}`);
      return;
    }
    this.cooldownUntil.set(id, Date.now() + base);
    this.lastStatus.set(id, "rate_limited");
  }

  markInvalid(id: string): void {
    // An invalid/permission error key is cooled for a long window; admin UI surfaces it.
    this.cooldownUntil.set(id, Date.now() + 30 * 60_000);
    this.lastStatus.set(id, "invalid");
  }

  markUsed(id: string): void {
    this.lastUsedAt.set(id, new Date().toISOString());
    this.lastStatus.set(id, "ok");
  }

  cooldownRemainingMs(id: string): number {
    return Math.max(0, (this.cooldownUntil.get(id) ?? 0) - Date.now());
  }

  snapshot(): GeminiKeyRingSnapshot {
    const now = Date.now();
    return {
      totalKeys: this.entries.length,
      availableKeys: this.entries.filter(e => (this.cooldownUntil.get(e.id) ?? 0) <= now).length,
      coolingKeys: this.entries.filter(e => (this.cooldownUntil.get(e.id) ?? 0) > now).length,
      keys: this.entries.map(e => ({
        id: e.id,
        source: e.source,
        label: e.label,
        masked: maskKey(e.key),
        cooling: (this.cooldownUntil.get(e.id) ?? 0) > now,
        cooldownRemainingMs: this.cooldownRemainingMs(e.id),
        lastUsedAt: this.lastUsedAt.get(e.id) ?? null,
        lastStatus: this.lastStatus.get(e.id) ?? null,
      })),
    };
  }

  /** Persisted usage bookkeeping (best effort; failures never break a turn). */
  async persistUsage(db: D1Database | null, id: string, status: string): Promise<void> {
    if (!db || !id.startsWith("db-")) {
      // Env keys have no durable row; env usage is not persisted.
      return;
    }
    const rowId = id.slice(3);
    try { await db.prepare("UPDATE ai_provider_keys SET last_used_at=CURRENT_TIMESTAMP, last_status=? WHERE id=?").bind(status, rowId).run(); } catch { /* best effort */ }
  }

  static fromEnv(env: { GEMINI_API_KEY?: string; GEMINI_API_KEYS?: string; AI_VERTEX_EXPRESS_ENABLED?: string }): GeminiKeyRing {
    const ring = new GeminiKeyRing({ vertexExpressEnabled: env.AI_VERTEX_EXPRESS_ENABLED === "1" });
    if (env.GEMINI_API_KEY?.trim()) ring.addEnvKey(env.GEMINI_API_KEY, "GEMINI_API_KEY");
    const extra = env.GEMINI_API_KEYS ?? "";
    for (const part of extra.split(/[\n,]+/)) {
      const key = part.trim();
      if (key) ring.addEnvKey(key, "GEMINI_API_KEYS");
    }
    return ring;
  }
}

export function maskKey(key: string): string {
  if (key.length <= 10) return `${key.slice(0, 2)}${"•".repeat(Math.max(2, key.length - 2))}`;
  return `${key.slice(0, 6)}${"•".repeat(8)}${key.slice(-4)}`;
}

type RingCacheEntry = {
  ring: GeminiKeyRing;
  configuration: Array<string | undefined>;
  loadedAt: number;
  loading: Promise<GeminiKeyRing> | null;
};
const ringCache = new WeakMap<object, RingCacheEntry>();

/** Invalidate this isolate after an admin mutation; the TTL bounds other isolates. */
export function invalidateGeminiKeyRing(db: D1Database): void {
  const entry = ringCache.get(databaseRuntimeIdentity(db));
  if (entry) {
    entry.loadedAt = -Infinity;
    // An in-flight read predating the mutation must not repopulate the cache.
    ringCache.set(databaseRuntimeIdentity(db), { ...entry, loading: null });
  }
}

/**
 * Cache by writable database configuration, never APP_ENV alone. Request-local
 * adapters may share an opaque scope, but never a socket or another tenant's
 * credentials. Keys/encryption changes invalidate the cache immediately.
 */
export async function loadGeminiKeyRing(env: Env, db: D1Database): Promise<GeminiKeyRing> {
  const identity = databaseRuntimeIdentity(db);
  const configuration = [env.APP_ENV, env.GEMINI_API_KEY, env.GEMINI_API_KEYS,
    env.AI_VERTEX_EXPRESS_ENABLED, env.AI_KEY_ENCRYPTION_SECRET, env.AI_KEY_ENCRYPTION_SECRETS];
  const cached = ringCache.get(identity);
  const sameConfiguration = cached && configuration.every((value, index) => value === cached.configuration[index]);
  if (sameConfiguration && cached.loading) return cached.loading;
  if (sameConfiguration && Date.now() - cached.loadedAt < RING_CACHE_TTL_MS) return cached.ring;

  const entry: RingCacheEntry = {
    ring: GeminiKeyRing.fromEnv(env), configuration, loadedAt: -Infinity, loading: null,
  };
  // Install BEFORE the first asynchronous query, including on a cold cache.
  ringCache.set(identity, entry);
  entry.loading = (async () => {
    const ring = entry.ring;
    try {
      const result = await db.prepare("SELECT id, api_key, label, last_used_at, last_status FROM ai_provider_keys WHERE provider='gemini' AND is_enabled=1 ORDER BY created_at").all<{ id: string; api_key: string; label: string | null; last_used_at: string | null; last_status: string | null }>();
      const secrets = readEncryptionSecrets(env);
      const decrypted: Array<{ id: string; api_key: string; label: string | null; last_used_at: string | null; last_status: string | null }> = [];
      for (const row of result.results ?? []) {
        try {
          decrypted.push({ ...row, api_key: await decryptEnvelope(secrets.read, String(row.api_key ?? "")) });
        } catch {
          // The admin key listing surfaces undecryptable rows. Never use them.
        }
      }
      ring.setDatabaseKeys(decrypted.map(row => ({ ...row, id: `db-${row.id}` })));
    } catch {
      // Missing/unavailable key storage cannot resurrect previously removed
      // admin keys. Explicitly configured environment keys remain usable.
    }
    if (cached) ring.inheritOperationalState(cached.ring);
    // Invalidation or a credential change may have replaced us while loading.
    if (ringCache.get(identity) === entry) entry.loadedAt = Date.now();
    entry.loading = null;
    return ring;
  })();
  return entry.loading;
}
