import { describe, expect, it, vi, afterEach } from "vitest";
import {
  decryptEnvelope,
  encryptApiKey,
  encryptionAvailable,
  isEnvelope,
  KeyEncryptionError,
  readEncryptionSecrets,
  reencryptRow,
} from "../../src/ai/core/keyEncryption";
import { loadGeminiKeyRing } from "../../src/ai/core/keyRing";
import { routeAiKeyAdminApi } from "../../src/ai/application/keyApi";

/**
 * A19/B06 — AI provider keys are encrypted at rest.
 *
 * The envelope is AES-256-GCM inside the existing api_key column (DDL-free,
 * identical on D1 and Postgres). Reads decrypt; undecryptable rows surface as
 * errors, never as silent empties; writes fail closed without a secret; the
 * rotate-encryption endpoint is the key-rotation path.
 */

const SECRET_A = "rotation-secret-A_0123456789abcdef";
const SECRET_B = "rotation-secret-B_fedcba9876543210";
const GEMINI_KEY = "AIzaSyD_TESTKEY_0123456789abcdefghijklmnopqrstuv";

function envWith(secrets?: string, plural?: string) {
  return { AI_KEY_ENCRYPTION_SECRET: secrets, AI_KEY_ENCRYPTION_SECRETS: plural };
}

describe("keyEncryption envelope primitives", () => {
  it("round-trips and marks envelopes", async () => {
    const stored = await encryptApiKey(SECRET_A, GEMINI_KEY);
    expect(isEnvelope(stored)).toBe(true);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(await decryptEnvelope([SECRET_A], stored)).toBe(GEMINI_KEY);
  });

  it("uses a fresh nonce per row (two encryptions differ)", async () => {
    const first = await encryptApiKey(SECRET_A, GEMINI_KEY);
    const second = await encryptApiKey(SECRET_A, GEMINI_KEY);
    expect(first).not.toBe(second);
  });

  it("rejects tampered ciphertext (GCM authentication)", async () => {
    const stored = await encryptApiKey(SECRET_A, GEMINI_KEY);
    const body = stored.slice("enc:v1:".length);
    const [nonce, payload] = body.split(":");
    const corrupted = `enc:v1:${nonce}:${payload.slice(0, -6)}AAAAAA`;
    await expect(decryptEnvelope([SECRET_A], corrupted)).rejects.toThrow(KeyEncryptionError);
  });

  it("decrypts with any listed secret, then survives dropping the old one", async () => {
    const storedUnderA = await encryptApiKey(SECRET_A, GEMINI_KEY);
    expect(await decryptEnvelope([SECRET_B, SECRET_A], storedUnderA)).toBe(GEMINI_KEY);
    const rotated = await reencryptRow(SECRET_B, [SECRET_B, SECRET_A], storedUnderA);
    expect(isEnvelope(rotated)).toBe(true);
    expect(await decryptEnvelope([SECRET_B], rotated)).toBe(GEMINI_KEY);
    await expect(decryptEnvelope([SECRET_A], rotated)).rejects.toThrow(KeyEncryptionError);
    await expect(decryptEnvelope([SECRET_B], storedUnderA)).rejects.toThrow(/could not be decrypted/);
  });

  it("passes legacy plaintext rows through unchanged", async () => {
    expect(isEnvelope(GEMINI_KEY)).toBe(false);
    expect(await decryptEnvelope([SECRET_A], GEMINI_KEY)).toBe(GEMINI_KEY);
    const wrapped = await reencryptRow(SECRET_A, [SECRET_A], GEMINI_KEY);
    expect(isEnvelope(wrapped)).toBe(true);
    expect(await decryptEnvelope([SECRET_A], wrapped)).toBe(GEMINI_KEY);
  });

  it("fails closed on undecryptable envelopes instead of returning empty", async () => {
    const stored = await encryptApiKey(SECRET_A, GEMINI_KEY);
    await expect(decryptEnvelope([SECRET_B], stored)).rejects.toThrow(KeyEncryptionError);
    await expect(encryptApiKey(SECRET_A, "")).rejects.toThrow(KeyEncryptionError);
    await expect(decryptEnvelope([SECRET_A], "enc:v1:onlyonesegment")).rejects.toThrow(/malformed/);
    await expect(decryptEnvelope([SECRET_A], `enc:v1:${"A".repeat(20)}:${"B".repeat(40)}`)).rejects.toThrow(/bad nonce length/);
  });

  it("parses the plural form with the first entry active, and falls back to the single form", () => {
    const plural = readEncryptionSecrets(envWith(undefined, `${SECRET_A}\n${SECRET_B}, short, ${SECRET_A}x-extra`));
    expect(plural.active).toBe(SECRET_A);
    expect(plural.read).toEqual([SECRET_A, SECRET_B, `${SECRET_A}x-extra`]);
    const single = readEncryptionSecrets(envWith(SECRET_B, undefined));
    expect(single.active).toBe(SECRET_B);
    expect(single.read).toEqual([SECRET_B]);
    const none = readEncryptionSecrets(envWith(undefined, undefined));
    expect(none.active).toBeNull();
    expect(encryptionAvailable(envWith(undefined, undefined))).toBe(false);
    expect(encryptionAvailable(envWith("too-short", undefined))).toBe(false);
    expect(encryptionAvailable(envWith(SECRET_A, undefined))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stub D1 shared by the ring + keyApi tests.
// ---------------------------------------------------------------------------

interface KeyRow {
  id: string;
  provider: string;
  label: string;
  api_key: string;
  is_enabled: number;
  last_status: string | null;
  last_used_at: string | null;
  created_at: string;
}

function makeDb(rows: KeyRow[]) {
  const sessionRow = {
    session_id: "sess-1", csrf_token: "csrf-1", expires_at: "2999-01-01 00:00:00", last_seen_at: new Date().toISOString(),
    id: "u1", email: "admin@test", display_name: "Admin", role: "admin", is_active: 1,
  };
  const matches = (sql: string) => (needle: string) => sql.includes(needle);
  const runSql = async (sql: string, args: unknown[]) => {
    const m = matches(sql);
    if (m("FROM sessions s JOIN users u")) return { first: sessionRow };
    // This key-encryption fixture models an unenrolled account under optional
    // MFA. The migrated-database MFA suite proves factor/session enforcement.
    if (sql.startsWith("SELECT 1 AS allowed WHERE") && m("auth_mfa_session_assurance")) {
      expect(args[0]).toBe("optional");
      expect(args[1]).toBe(sessionRow.id);
      return { first: { allowed: 1 } };
    }
    // R109-33: the admin key connectivity test admits through the AI ledger
    // (reserveGeminiAttempt) before its generateContent probe — the admission
    // INSERT admits (changes 1) and the quota counters read as empty.
    if (m("INSERT INTO ai_request_ledger")) return { meta: { changes: 1 } };
    if (m("FROM ai_request_ledger")) return { first: { count: 0, tokens: 0 } };
    if (m("FROM ai_provider_keys") && m("ORDER BY created_at")) {
      return { all: { results: rows.map(row => ({ ...row })) } };
    }
    if (m("SELECT COUNT(*) AS n FROM ai_provider_keys")) return { first: { n: rows.length } };
    if (m("INSERT INTO ai_provider_keys")) {
      rows.push({ id: String(args[0]), provider: String(args[1]), label: String(args[2]), api_key: String(args[3]), is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02 00:00:00" });
      return { meta: { changes: 1 } };
    }
    if (m("UPDATE ai_provider_keys SET api_key=?")) {
      const row = rows.find(r => r.id === String(args[1]));
      if (row) row.api_key = String(args[0]);
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (m("UPDATE ai_provider_keys SET last_status")) return { meta: { changes: 1 } };
    if (m("SELECT api_key FROM ai_provider_keys WHERE id=?")) {
      const row = rows.find(r => r.id === String(args[0]));
      return { first: row ?? null };
    }
    if (m("SELECT id, api_key, label, last_used_at, last_status FROM ai_provider_keys")) {
      return { all: { results: rows.map(row => ({ id: row.id, api_key: row.api_key, label: row.label, last_used_at: row.last_used_at, last_status: row.last_status })) } };
    }
    if (m("DELETE FROM ai_provider_keys")) {
      const index = rows.findIndex(r => r.id === String(args[0]));
      if (index >= 0) rows.splice(index, 1);
      return { meta: { changes: index >= 0 ? 1 : 0 } };
    }
    throw new Error(`stub db: unexpected SQL ${sql}`);
  };
  const statement = (sql: string, bound: unknown[] = []) => {
    const entry = {
      sql,
      bind(...values: unknown[]) { return statement(sql, values); },
      first: async <T,>(): Promise<T | null> => {
        const outcome = await runSql(sql, bound) as { first?: unknown };
        return (outcome.first ?? null) as T | null;
      },
      all: async <T,>(): Promise<{ results: T[] }> => {
        const outcome = await runSql(sql, bound) as { all?: { results: T[] } };
        return { results: outcome.all?.results ?? [] };
      },
      run: async () => {
        const outcome = await runSql(sql, bound) as { meta?: { changes: number } };
        return { meta: { changes: outcome.meta?.changes ?? 0 } };
      },
    };
    return entry;
  };
  return {
    prepare: (sql: string) => statement(sql),
    batch: async () => [] as D1Result<unknown>[],
    exec: async () => ({}),
    dump: async () => null,
    rows,
  } as unknown as D1Database & { rows: KeyRow[] };
}

function adminRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://registry.test${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: "sess=test-session", "x-csrf-token": "csrf-1", origin: "https://registry.test" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("loadGeminiKeyRing decrypts database rows", () => {
  it("loads envelope rows and skips undecryptable ones", async () => {
    const stored = await encryptApiKey(SECRET_A, GEMINI_KEY);
    const broken = await encryptApiKey(SECRET_B, "AIzaSyD_OTHERKEY_zzzzzzzzzzzzzzzzzzzzzzzz1234");
    const db = makeDb([
      { id: "k1", provider: "gemini", label: "one", api_key: stored, is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" },
      { id: "k2", provider: "gemini", label: "two", api_key: broken, is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" },
      { id: "k3", provider: "gemini", label: "legacy", api_key: "AIzaSyD_LEGACYKEY_yyyyyyyyyyyyyyyyyyyyyyyy", is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" },
    ]);
    const ring = await loadGeminiKeyRing({ APP_ENV: "test-ring", ...envWith(SECRET_A, undefined) } as Parameters<typeof loadGeminiKeyRing>[0], db);
    const snapshot = ring.snapshot();
    const ids = snapshot.keys.map(key => key.id).sort();
    // k2 is undecryptable (needs SECRET_B, only A configured) — skipped, never empty-masked.
    expect(ids).toEqual(["db-k1", "db-k3"]);
    expect(ring.keyOf("db-k1")).toBe(GEMINI_KEY);
    expect(ring.keyOf("db-k3")).toBe("AIzaSyD_LEGACYKEY_yyyyyyyyyyyyyyyyyyyyyyyy");
    expect(ring.keyOf("db-k2")).toBeNull();
  });
});

describe("keyApi encryption at rest", () => {
  const emptyRows = () => [] as KeyRow[];
  afterEach(() => { vi.restoreAllMocks(); });

  it("refuses new keys without an encryption secret (fail closed)", async () => {
    const db = makeDb(emptyRows());
    const env = { APP_ENV: "test-failclosed", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(undefined, undefined) };
    await expect(routeAiKeyAdminApi(
      adminRequest("/api/admin/ai/keys", "POST", { provider: "gemini", label: "L", apiKey: GEMINI_KEY }),
      env as never,
      new URL("https://registry.test/api/admin/ai/keys"),
    )).rejects.toThrow(/AI_KEY_ENCRYPTION_SECRETS/);
  });

  it("stores new keys as envelopes and lists them masked with encryption state", async () => {
    const db = makeDb(emptyRows());
    const env = { APP_ENV: "test-keys", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(SECRET_A, undefined) };
    const created = await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys", "POST", { provider: "gemini", label: "Laptop", apiKey: GEMINI_KEY }), env as never, new URL("https://registry.test/api/admin/ai/keys")) as Response;
    expect(created.status).toBe(201);
    const body = await created.json() as { masked: string; encrypted: boolean };
    expect(body.encrypted).toBe(true);
    expect(body.masked).toContain("AIzaSy");
    // The stored value is an envelope, never the plaintext key.
    expect(db.rows[0]!.api_key.startsWith("enc:v1:")).toBe(true);
    expect(db.rows[0]!.api_key).not.toContain(GEMINI_KEY);

    const listResponse = await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys", "GET"), env as never, new URL("https://registry.test/api/admin/ai/keys")) as Response;
    const list = await listResponse.json() as { keys: Array<{ masked: string; encrypted: boolean }>; encryption: { available: boolean; legacyPlaintextRows: number; undecryptableRows: number } };
    expect(list.encryption.available).toBe(true);
    expect(list.encryption.legacyPlaintextRows).toBe(0);
    expect(list.keys[0]!.masked).toContain("•");
    expect(list.keys[0]!.encrypted).toBe(true);
  });

  it("detects duplicates by plaintext comparison, not by stored value", async () => {
    const db = makeDb(emptyRows());
    const env = { APP_ENV: "test-dup", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(SECRET_A, undefined) };
    await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys", "POST", { provider: "gemini", label: "L", apiKey: GEMINI_KEY }), env as never, new URL("https://registry.test/api/admin/ai/keys"));
    await expect(routeAiKeyAdminApi(
      adminRequest("/api/admin/ai/keys", "POST", { provider: "gemini", label: "L2", apiKey: GEMINI_KEY }),
      env as never, new URL("https://registry.test/api/admin/ai/keys"),
    )).rejects.toThrow(/already registered/);
  });

  it("rotate-encryption converts legacy rows and reports already-current ones", async () => {
    const legacyKey = "AIzaSyD_OLDPLAIN_hhhhhhhhhhhhhhhhhhhhhhhhhhh";
    const stored = await encryptApiKey(SECRET_A, GEMINI_KEY);
    const db = makeDb([
      { id: "k-legacy", provider: "gemini", label: "legacy", api_key: legacyKey, is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" },
      { id: "k-env", provider: "gemini", label: "current", api_key: stored, is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" },
    ]);
    const env = { APP_ENV: "test-rotate", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(SECRET_A, undefined) };
    const rotateResponse = await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys/rotate-encryption", "POST", {}), env as never, new URL("https://registry.test/api/admin/ai/keys/rotate-encryption")) as Response;
    const result = await rotateResponse.json() as { ok: boolean; converted: number; alreadyCurrent: number; failed: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.converted).toBe(1);
    expect(result.alreadyCurrent).toBe(1);
    expect(result.failed).toEqual([]);
    expect(db.rows.find(row => row.id === "k-legacy")!.api_key.startsWith("enc:v1:")).toBe(true);
    expect(await decryptEnvelope([SECRET_A], db.rows.find(row => row.id === "k-legacy")!.api_key)).toBe(legacyKey);
    // Rotation onto a NEW active secret re-wraps the old envelope too.
    const envB = { APP_ENV: "test-rotate2", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(undefined, `${SECRET_B},${SECRET_A}`) };
    const second = await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys/rotate-encryption", "POST", {}), envB as never, new URL("https://registry.test/api/admin/ai/keys/rotate-encryption")) as Response;
    const secondBody = await second.json() as { ok: boolean; converted: number; alreadyCurrent: number };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.converted).toBe(2); // both rows re-wrapped under SECRET_B
    for (const row of db.rows) {
      expect(await decryptEnvelope([SECRET_B], row.api_key)).toBeTruthy();
    }
  });

  it("surfaces undecryptable rows in the listing instead of hiding them", async () => {
    const storedUnderB = await encryptApiKey(SECRET_B, "AIzaSyD_FOREIGN_bbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const db = makeDb([
      { id: "k-b", provider: "gemini", label: "foreign", api_key: storedUnderB, is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" },
    ]);
    const env = { APP_ENV: "test-list", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(SECRET_A, undefined) };
    const listResponse = await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys", "GET"), env as never, new URL("https://registry.test/api/admin/ai/keys")) as Response;
    const list = await listResponse.json() as { keys: Array<{ decryption_error?: string; masked: string }>; encryption: { undecryptableRows: number } };
    expect(list.encryption.undecryptableRows).toBe(1);
    expect(list.keys[0]!.decryption_error).toMatch(/could not be decrypted/);
    expect(list.keys[0]!.masked).toBe("—");
  });

  it("decrypts before the connectivity test and accepts the /test form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })));
    const stored = await encryptApiKey(SECRET_A, GEMINI_KEY);
    const db = makeDb([{ id: "k-test", provider: "gemini", label: "test", api_key: stored, is_enabled: 1, last_status: null, last_used_at: null, created_at: "2026-10-02" }]);
    const env = { APP_ENV: "test-conn", DB: db, SESSION_COOKIE_NAME: "sess", ...envWith(SECRET_A, undefined) };
    const tested = await routeAiKeyAdminApi(adminRequest("/api/admin/ai/keys/k-test/test", "POST", {}), env as never, new URL("https://registry.test/api/admin/ai/keys/k-test/test")) as Response;
    const outcome = await tested.json() as { ok: boolean; code: string };
    expect(outcome.ok).toBe(true);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(String(call[0])).toContain("generateContent");
    const headers = (call[1] as { headers: Record<string, string> }).headers;
    expect(String(headers["x-goog-api-key"])).toBe(GEMINI_KEY);
  });
});
