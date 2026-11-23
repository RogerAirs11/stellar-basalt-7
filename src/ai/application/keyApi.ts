import { z } from "zod";
import { json, readJson } from "../../api/http";
import { requireCsrf, requirePermission } from "../../auth/guards";
import { HttpError } from "../../api/http";
import { geminiQuotaForModel, loadAiConfig, resolveAiStateDatabase } from "../runtime/config";
import { reserveGeminiAttempt } from "../runtime/quotaGovernor";
import { invalidateGeminiKeyRing, loadGeminiKeyRing, maskKey } from "../core/keyRing";
import {
  decryptEnvelope,
  encryptApiKey,
  encryptionAvailable,
  isEnvelope,
  KeyEncryptionError,
  readEncryptionSecrets,
  reencryptRow,
} from "../core/keyEncryption";
import { readAdminAiSettings, writeAdminAiSettings } from "../core/settingsStore";
import { publicModelCatalog } from "../core/modelCatalog";
import { GEMINI_RELAY_BASE } from "../providers/gemini/relay";
import { isGeminiGeoBlockedMessage } from "../providers/gemini/vertexExpress";

const CreateKeySchema = z.object({
  provider: z.literal("gemini"),
  label: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(20).max(400),
});

const UpdateKeySchema = z.object({
  is_enabled: z.boolean().optional(),
  label: z.string().trim().min(1).max(120).optional(),
});

const UpdateSettingsSchema = z.object({
  defaultChatModel: z.string().trim().max(64).nullable(),
  defaultExecutionMode: z.enum(["fast", "auto", "research"]).nullable(),
});

/**
 * Admin-managed AI provider API keys. Admins can register as many Gemini keys
 * as they want; the runtime rotates across env + admin keys on rate limits.
 * Full key material never leaves the server; listings are masked.
 *
 * Also hosts the admin AI runtime settings (default chat model + default
 * execution mode) under /api/admin/ai/settings — R33: AI customization lives
 * in the admin panel, not the user-facing chat.
 */
export async function routeAiKeyAdminApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const isKeys = path.startsWith("/api/admin/ai/keys");
  const isSettings = path.startsWith("/api/admin/ai/settings");
  if (!isKeys && !isSettings) return null;

  const stateDb = resolveAiStateDatabase(env);

  if (isSettings && path === "/api/admin/ai/settings" && method === "GET") {
    const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
    void auth;
    const settings = await readAdminAiSettings(stateDb);
    const config = loadAiConfig(env);
    const ringKeys = config.enabled && env.AI_GEMINI_ENABLED !== "0" ? await loadGeminiKeyRing(env, stateDb).then(ring => ring.size).catch(() => 0) : 0;
    const geminiEnabled = config.gemini.enabled || ringKeys > 0;
    const models = publicModelCatalog({ geminiEnabled, deepseekEnabled: config.deepseek.enabled, deepseekVisionEnabled: config.deepseek.visionEnabled, offlineEnabled: config.offline.enabled });
    return json({ settings, models });
  }

  if (isSettings && path === "/api/admin/ai/settings" && method === "PUT") {
    const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
    requireCsrf(request, auth);
    const parsed = UpdateSettingsSchema.safeParse(await readJson(request, 8 * 1024));
    if (!parsed.success) throw new HttpError(400, "invalid_ai_settings_request", "AI settings failed validation", parsed.error.flatten());
    try {
      const settings = await writeAdminAiSettings(stateDb, parsed.data);
      return json({ ok: true, settings });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "invalid_ai_settings_value", e instanceof Error ? e.message : "Invalid AI settings");
    }
  }

  if (path === "/api/admin/ai/keys" && method === "GET") {
    const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
    void auth;
    const rows = await listKeyRows(stateDb);
    const secrets = readEncryptionSecrets(env);
    const ring = await loadGeminiKeyRing(env, stateDb).catch(() => null);
    const masked = [] as Array<Record<string, unknown>>;
    let undecryptable = 0;
    for (const row of rows) {
      let plain: string;
      try {
        plain = await decryptEnvelope(secrets.read, row.api_key);
      } catch (error) {
        // Undecryptable rows are reported, never silently hidden or masked-as-if-fine.
        undecryptable += 1;
        masked.push({
          id: row.id,
          provider: row.provider,
          label: row.label,
          masked: "—",
          encrypted: isEnvelope(row.api_key),
          decryption_error: error instanceof KeyEncryptionError ? error.message : String(error),
          is_enabled: Number(row.is_enabled) === 1,
          last_status: row.last_status ?? null,
          last_used_at: row.last_used_at ?? null,
          created_at: row.created_at,
        });
        continue;
      }
      masked.push({
        id: row.id,
        provider: row.provider,
        label: row.label,
        masked: maskKey(plain),
        encrypted: isEnvelope(row.api_key),
        is_enabled: Number(row.is_enabled) === 1,
        last_status: row.last_status ?? null,
        last_used_at: row.last_used_at ?? null,
        created_at: row.created_at,
      });
    }
    return json({
      keys: masked,
      encryption: {
        available: encryptionAvailable(env),
        activeConfigured: secrets.active !== null,
        legacyPlaintextRows: rows.filter(row => !isEnvelope(row.api_key)).length,
        undecryptableRows: undecryptable,
      },
      envKeyCount: ring?.snapshot().totalKeys ?? 0,
      ring: ring?.snapshot() ?? null,
    });
  }

  if (path === "/api/admin/ai/keys" && method === "POST") {
    const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
    requireCsrf(request, auth);
    const parsed = CreateKeySchema.safeParse(await readJson(request, 16 * 1024));
    if (!parsed.success) throw new HttpError(400, "invalid_ai_key_request", "Key data failed validation", parsed.error.flatten());
    const { provider, label, apiKey } = parsed.data;
    if (!/^AIza[0-9A-Za-z_-]{30,}$|^AQ\.[0-9A-Za-z_.-]{20,}$/.test(apiKey)) {
      throw new HttpError(400, "invalid_gemini_key_format", "That does not look like a Gemini API key (expected AIza… or AQ.… format)");
    }
    const secrets = readEncryptionSecrets(env);
    if (!secrets.active) {
      // A19/B06 fail closed: no encryption secret configured — refuse the write
      // instead of storing another plaintext row.
      throw new HttpError(503, "ai_key_encryption_unavailable", "Admin-managed keys are stored encrypted at rest; set the worker secret AI_KEY_ENCRYPTION_SECRETS (min 16 chars) before registering keys");
    }
    // Duplicate detection must compare the PLAINTEXT key, so decrypt the few
    // existing rows (≤12) rather than matching an envelope column value.
    const existing = await listKeyRows(stateDb);
    for (const row of existing) {
      let plain: string;
      try {
        plain = await decryptEnvelope(secrets.read, row.api_key);
      } catch {
        continue; // undecryptable rows cannot match; the listing surfaces them separately
      }
      if (plain === apiKey) throw new HttpError(409, "ai_key_duplicate", "This API key is already registered");
    }
    const count = await stateDb.prepare("SELECT COUNT(*) AS n FROM ai_provider_keys WHERE provider='gemini'").first<{ n: number }>();
    if (Number(count?.n ?? 0) >= 12) throw new HttpError(409, "ai_key_limit_reached", "At most 12 admin-managed keys are supported per provider");
    const id = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const stored = await encryptApiKey(secrets.active, apiKey);
    await stateDb.prepare("INSERT INTO ai_provider_keys(id,provider,label,api_key,is_enabled) VALUES(?,?,?,?,1)").bind(id, provider, label, stored).run();
    invalidateGeminiKeyRing(stateDb);
    return json({ ok: true, id, masked: maskKey(apiKey), encrypted: true }, { status: 201 });
  }

  if (path === "/api/admin/ai/keys/rotate-encryption" && method === "POST") {
    // A19/B06 key-rotation path: (re-)encrypt every row under the ACTIVE secret —
    // converts legacy plaintext rows and re-wraps rows still on an older secret.
    const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
    requireCsrf(request, auth);
    const secrets = readEncryptionSecrets(env);
    if (!secrets.active) {
      throw new HttpError(503, "ai_key_encryption_unavailable", "Set AI_KEY_ENCRYPTION_SECRETS first; there is no active secret to rotate onto");
    }
    const rows = await listKeyRows(stateDb);
    let converted = 0;
    let alreadyCurrent = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const row of rows) {
      if (isEnvelope(row.api_key)) {
        try {
          // Already decryptable with the ACTIVE secret — current, no rewrite needed.
          await decryptEnvelope([secrets.active], row.api_key);
          alreadyCurrent += 1;
          continue;
        } catch {
          // Not decryptable with the active secret. Undecryptable at all = failure;
          // decryptable only via an older listed secret = re-wrap under the active one.
          try {
            await decryptEnvelope(secrets.read, row.api_key);
          } catch (error) {
            failures.push({ id: row.id, error: error instanceof KeyEncryptionError ? error.message : String(error) });
            continue;
          }
        }
      }
      try {
        const next = await reencryptRow(secrets.active, secrets.read, row.api_key);
        await stateDb.prepare("UPDATE ai_provider_keys SET api_key=? WHERE id=?").bind(next, row.id).run();
        converted += 1;
      } catch (error) {
        failures.push({ id: row.id, error: error instanceof KeyEncryptionError ? error.message : String(error) });
      }
    }
    if (converted) invalidateGeminiKeyRing(stateDb);
    return json({ ok: failures.length === 0, converted, alreadyCurrent, failed: failures });
  }

  const idMatch = path.match(/^\/api\/admin\/ai\/keys\/([^/]+)$/);
  const testMatch = path.match(/^\/api\/admin\/ai\/keys\/([^/]+)\/test$/);
  const keyIdOf = (match: RegExpMatchArray | null): string | null => (match ? decodeURIComponent(match[1]) : null);
  // Connectivity test lives at /keys/:id/test (the platformClient form). The
  // historical POST /keys/:id alias is kept for older clients.
  const testTarget = keyIdOf(testMatch) ?? (idMatch && method === "POST" ? keyIdOf(idMatch) : null);
  if (testTarget) {
    if (method === "POST") {
      // Connectivity test: a minimal classic generateContent request with the key.
      const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
      requireCsrf(request, auth);
      const row = await stateDb.prepare("SELECT api_key FROM ai_provider_keys WHERE id=? AND provider='gemini'").bind(testTarget).first<{ api_key: string }>();
      if (!row) throw new HttpError(404, "ai_key_not_found", "Key not found");
      const secrets = readEncryptionSecrets(env);
      const plain = await decryptEnvelope(secrets.read, row.api_key).catch((error) => {
        throw new HttpError(500, "ai_key_undecryptable", error instanceof KeyEncryptionError ? error.message : "Stored key could not be decrypted");
      });
      const outcome = await testGeminiKey(plain, env);
      await stateDb.prepare("UPDATE ai_provider_keys SET last_status=?,last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(outcome.ok ? "ok" : `error:${outcome.code}`.slice(0, 60), testTarget).run().catch(() => {});
      return json(outcome);
    }
  }
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1]);
    if (method === "DELETE") {
      const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
      requireCsrf(request, auth);
      const result = await stateDb.prepare("DELETE FROM ai_provider_keys WHERE id=? AND provider='gemini'").bind(id).run();
      if (!result.meta.changes) throw new HttpError(404, "ai_key_not_found", "Key not found");
      invalidateGeminiKeyRing(stateDb);
      return json({ ok: true });
    }
    if (method === "PATCH") {
      const auth = await requirePermission(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME, "content.manage");
      requireCsrf(request, auth);
      const parsed = UpdateKeySchema.safeParse(await readJson(request, 16 * 1024));
      if (!parsed.success) throw new HttpError(400, "invalid_ai_key_request", "Key update failed validation", parsed.error.flatten());
      const { is_enabled, label } = parsed.data;
      const result = await stateDb.prepare("UPDATE ai_provider_keys SET is_enabled=COALESCE(?,is_enabled),label=COALESCE(?,label) WHERE id=? AND provider='gemini'")
        .bind(is_enabled === undefined ? null : is_enabled ? 1 : 0, label ?? null, id).run();
      if (!result.meta.changes) throw new HttpError(404, "ai_key_not_found", "Key not found");
      invalidateGeminiKeyRing(stateDb);
      return json({ ok: true });
    }
  }

  return null;
}

async function listKeyRows(db: D1Database): Promise<Array<{ id: string; provider: string; label: string; api_key: string; is_enabled: number; last_status: string | null; last_used_at: string | null; created_at: string }>> {
  const result = await db.prepare("SELECT id,provider,label,api_key,is_enabled,last_status,last_used_at,created_at FROM ai_provider_keys WHERE provider='gemini' ORDER BY created_at").all();
  return (result.results ?? []) as unknown as Array<{ id: string; provider: string; label: string; api_key: string; is_enabled: number; last_status: string | null; last_used_at: string | null; created_at: string }>;
}

async function testGeminiKey(apiKey: string, env: Env): Promise<{ ok: boolean; code: string; message: string }> {
  // R56: probe through the Durable-Object relay when active (the worker's own
  // egress is region-blocked from several visitor PoPs) and use the fast 2.5
  // tier so admin key tests take ~1s instead of 40s+ on the congested 3.5 queue.
  const config = loadAiConfig(env);
  const fetchImpl = config.gemini.relay.fetchImpl ?? ((input: RequestInfo, init?: RequestInit) => fetch(input, init));
  const base = config.gemini.relay.active ? GEMINI_RELAY_BASE : "https://generativelanguage.googleapis.com/v1beta";
  // R109-33: this connectivity test IS a real generation network attempt
  // (generateContent, up to 512 output tokens), so it must pass the same
  // canonical admission as every other Gemini generation. A refused admission
  // means NO network call — the admin sees the honest quota-refused result.
  const TEST_MODEL = "gemini-2.5-flash-lite";
  try {
    await reserveGeminiAttempt(resolveAiStateDatabase(env), {
      id: crypto.randomUUID(),
      conversationId: null,
      model: TEST_MODEL,
      requestKind: "admin_key_test",
      estimatedInputTokens: 32,
      quota: geminiQuotaForModel(config.gemini, TEST_MODEL),
    });
  } catch (cause) {
    const code = (cause as { code?: string })?.code ?? "admission_refused";
    return { ok: false, code: "quota_refused", message: `Key test not sent: ${code} (project quota admission refused)` };
  }
  try {
    const response = await fetchImpl(`${base}/models/gemini-2.5-flash-lite:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }],
        generationConfig: { maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return { ok: true, code: "ok", message: "Key is valid and reachable" };
    const body = await response.text().catch(() => "");
    if (isGeminiGeoBlockedMessage(body)) return { ok: false, code: "geo_blocked", message: "This transport's egress region is not supported by the Gemini API" };
    if (response.status === 401 || response.status === 403) return { ok: false, code: "unauthorized", message: "Gemini rejected this key" };
    if (response.status === 429) return { ok: true, code: "rate_limited", message: "Key is valid but currently rate-limited" };
    if (response.status >= 500) return { ok: false, code: "unavailable", message: `Gemini service error (${response.status})` };
    return { ok: false, code: "invalid", message: body.slice(0, 300) || `Request failed (${response.status})` };
  } catch (e) {
    return { ok: false, code: "network", message: e instanceof Error ? e.message : "Network failure" };
  }
}
