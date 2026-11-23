import { describe, expect, it } from "vitest";
import { batchDigest, classifyImportRow, normalizeImportRow, normalizePersianText, type ExistingHorseRecord, type ImportRow } from "../../src/registry/importStaging";
import { adminCreateImportSource, adminStageImportBatch, adminMergeHorses, adminUnmergeHorses } from "../../src/api/modules/imports";
import { HttpError } from "../../src/api/http";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P10 — licensed ingestion, staging and duplicate
 * adjudication.
 *
 * Acceptance pinned:
 *  - reimporting an identical file stages NOTHING new (batch replay) and
 *    classifies identical content as skip (no duplicate horses/evidence);
 *  - conflicting parentage and identifier collisions enter review, never
 *    overwrite trusted fields;
 *  - merge/unmerge preserves source assertions/listings/offspring links via
 *    the replayable manifest and restores them exactly on unmerge;
 *  - the synthetic namespace can never be selected as a production source.
 */

// ---------------------------------------------------------------------------
// 1. Normalization preserves originals while unifying variants.
// ---------------------------------------------------------------------------

describe("P10 normalization", () => {
  it("unifies Arabic/Persian letter variants and digits in the normalized copy, PRESERVING the raw original", async () => {
    const raw: ImportRow = {
      external_id: "۱۰۰",
      register_no: "۰۹۸-۱۲",
      name_native: "كوه نور",  // Arabic Kaf + Yeh variants
      name_latin: "KOUH-e NOOR",
    };
    const normalized = await normalizeImportRow(raw);
    expect(normalized.raw.register_no).toBe("۰۹۸-۱۲");        // original untouched
    expect(normalized.raw.name_native).toBe("كوه نور");
    expect(normalized.normalized.register_no).toBe("098-12"); // digits unified
    expect(normalized.normalized.name_native).toBe("\u06A9\u0648\u0647 \u0646\u0648\u0631"); // Persian Kaf/Yeh
    expect(normalized.normalized.name_latin).toBe("kouh-e noor");
    expect(normalized.checksum).toHaveLength(64);
  });

  it("identical content produces identical checksums; any identity change changes the digest", async () => {
    const row: ImportRow = { external_id: "a1", register_no: "R-1", microchip_no: "123", name_latin: "One", birth_year: 2015 };
    const same: ImportRow = { external_id: "a1", register_no: "R-1", microchip_no: "123", name_latin: "One", birth_year: 2015 };
    const changed: ImportRow = { external_id: "a1", register_no: "R-1", microchip_no: "999", name_latin: "One", birth_year: 2015 };
    const a = await normalizeImportRow(row);
    const b = await normalizeImportRow(same);
    const c = await normalizeImportRow(changed);
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).not.toBe(c.checksum);
  });

  it("batchDigest is stable for identical payloads (order-sensitive, mapping-version bound)", async () => {
    const rows: ImportRow[] = [
      { external_id: "1", register_no: "A", name_latin: "Alpha" },
      { external_id: "2", register_no: "B", name_latin: "Beta" },
    ];
    const d1 = await batchDigest(rows, "v1");
    const d2 = await batchDigest([...rows], "v1");
    const d3 = await batchDigest(rows, "v2");
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);
  });

  it("normalizePersianText unifies the common Arabic/Persian confusables", () => {
    expect(normalizePersianText("كوه")).toBe(normalizePersianText("کوه"));
    expect(normalizePersianText("علي")).toBe(normalizePersianText("علی"));
    expect(normalizePersianText("ABـC")).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// 1b. R140-B canonical write path: blanks are not identifiers, garbage years
// never reach canonical, fullwidth digits unify with the T08 normalizer.
// ---------------------------------------------------------------------------

describe("R140-B canonical import normalization", () => {
  it("collapses blank/whitespace identifiers to NULL so they can never count as typed identifiers", async () => {
    const blank: ImportRow = { external_id: "b1", register_no: "   ", microchip_no: "", name_latin: "Blank" };
    const normalized = await normalizeImportRow(blank);
    expect(normalized.normalized.register_no).toBeNull();
    expect(normalized.normalized.microchip_no).toBeNull();
    // classification: the blank-identifier row is an ambiguous_match conflict,
    // not a create that would write register_no='' into canonical.
    const decision = classifyImportRow({ row: normalized, registerMatches: [], microchipMatches: [], existing: noExisting });
    expect(decision.action).toBe("conflict");
    expect("reason" in decision && decision.reason).toBe("ambiguous_match");
  });

  it("drops implausible birth years to NULL with a warning instead of writing garbage", async () => {
    const garbage = await normalizeImportRow({ external_id: "g1", register_no: "R-G", name_latin: "Garbage", birth_year: 999999 });
    expect(garbage.normalized.birth_year).toBeNull();
    expect(garbage.warnings.some((w) => w.startsWith("implausible_birth_year:999999"))).toBe(true);
    const future = await normalizeImportRow({ external_id: "g2", register_no: "R-G", name_latin: "Future", birth_year: new Date().getUTCFullYear() + 50 });
    expect(future.normalized.birth_year).toBeNull();
    const plausible = await normalizeImportRow({ external_id: "g3", register_no: "R-G", name_latin: "Plausible", birth_year: 2015 });
    expect(plausible.normalized.birth_year).toBe(2015);
    expect(plausible.warnings).toEqual([]);
  });

  it("unifies fullwidth digits through the canonical NFKC normalizer (same as the T08 write path)", async () => {
    const fullwidth = await normalizeImportRow({ external_id: "f1", register_no: "１２３", microchip_no: "４５６", name_latin: "Fullwidth" });
    expect(fullwidth.normalized.register_no).toBe("123");
    expect(fullwidth.normalized.microchip_no).toBe("456");
    // A canonical record holding "123" matches the fullwidth assertion — no fake parentage conflict.
    const existing: ExistingHorseRecord = {
      id: 31, register_no: "123", microchip_no: "456", father_id: null, mother_id: null,
      father_register_no: "77", mother_register_no: "88",
    };
    const decision = classifyImportRow({
      row: fullwidth,
      registerMatches: [{ horseId: 31, via: "register_no" }],
      microchipMatches: [{ horseId: 31, via: "microchip_no" }],
      existing,
    });
    expect(decision.action === "update" || decision.action === "skip").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Classification: review routing, never overwrites.
// ---------------------------------------------------------------------------

const noExisting: ExistingHorseRecord | null = null;

function row(overrides: Partial<ImportRow>): ImportRow {
  return { external_id: "x1", register_no: "R-1", name_latin: "Test", ...overrides };
}

describe("P10 dry-run classification", () => {
  it("no typed-identifier match => create", async () => {
    const decision = classifyImportRow({ row: await normalizeImportRow(row({})), registerMatches: [], microchipMatches: [], existing: noExisting });
    expect(decision.action).toBe("create");
  });

  it("identifiers resolving to DIFFERENT horses => conflict (identifier_collision)", async () => {
    const decision = classifyImportRow({
      row: await normalizeImportRow(row({ microchip_no: "M-9" })),
      registerMatches: [{ horseId: 11, via: "register_no" }],
      microchipMatches: [{ horseId: 12, via: "microchip_no" }],
      existing: noExisting,
    });
    expect(decision.action).toBe("conflict");
    if (decision.action === "conflict") expect(decision.reason).toBe("identifier_collision");
  });

  it("conflicting parentage on a matched horse => conflict (parentage_conflict), never an overwrite", async () => {
    const existing: ExistingHorseRecord = {
      id: 11, register_no: "R-1", microchip_no: null, father_id: 71, mother_id: null,
      father_register_no: "R-SIRE-A", mother_register_no: null,
    };
    const decision = classifyImportRow({
      row: await normalizeImportRow(row({ father_register_no: "R-SIRE-B" })),
      registerMatches: [{ horseId: 11, via: "register_no" }],
      microchipMatches: [],
      existing,
    });
    expect(decision.action).toBe("conflict");
    if (decision.action === "conflict") expect(decision.reason).toBe("parentage_conflict");
  });

  it("identical identity content on the matched horse => skip (reimport idempotency)", async () => {
    const normalized = await normalizeImportRow(row({ father_register_no: "R-SIRE-A" }));
    const existing: ExistingHorseRecord = {
      id: 11, register_no: "R-1", microchip_no: null, father_id: 71, mother_id: null,
      father_register_no: "R-SIRE-A", mother_register_no: null,
      identity_checksum: normalized.checksum,
    };
    const decision = classifyImportRow({ row: normalized, registerMatches: [{ horseId: 11, via: "register_no" }], microchipMatches: [], existing });
    expect(decision.action).toBe("skip");
  });

  it("matched horse with fill-once room => update; a row with NO typed identifier => conflict", async () => {
    const existing: ExistingHorseRecord = { id: 11, register_no: "R-1", microchip_no: null, father_id: null, mother_id: null, father_register_no: null, mother_register_no: null };
    const decision = classifyImportRow({ row: await normalizeImportRow(row({})), registerMatches: [{ horseId: 11, via: "register_no" }], microchipMatches: [], existing });
    expect(decision.action).toBe("update");
    if (decision.action === "update") expect(decision.horseId).toBe(11);

    const noIdentifier = classifyImportRow({ row: await normalizeImportRow(row({ register_no: null })), registerMatches: [], microchipMatches: [], existing: noExisting });
    expect(noIdentifier.action).toBe("conflict");
    if (noIdentifier.action === "conflict") expect(noIdentifier.reason).toBe("ambiguous_match");
  });
});

// ---------------------------------------------------------------------------
// 3. Handler boundaries (mocked D1).
// ---------------------------------------------------------------------------

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  existingSourceName?: Record<string, unknown> | null;
  replayBatch?: Record<string, unknown> | null;
  kept?: Record<string, unknown> | null;
  merged?: Record<string, unknown> | null;
  alias?: Record<string, unknown> | null;
  merge?: Record<string, unknown> | null;
  mergeReceipt?: Record<string, unknown> | null;
  protectedIdentityAllowed?: boolean;
  fkRows?: Record<string, Array<{ id: number }>>;
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string, args: unknown[]): unknown => {
    // This handler-wiring fixture models optional MFA for an unenrolled
    // account. Real factor/session/replay SQL is covered by r148-mfa.test.ts.
    if (sql.includes("auth_mfa_session_assurance")) return { allowed: 1 };
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("FROM import_sources WHERE name=?")) return script.existingSourceName ?? null;
    if (sql.includes("is_synthetic FROM import_sources")) return script.source ?? null;
    if (sql.includes("FROM import_batches WHERE source_id=? AND file_sha256=?")) {
      const inserted = writes.find(write => write.sql.includes("INSERT INTO import_batches"));
      return script.replayBatch ?? (inserted ? { id: autoIncrement, rows_total: Number(inserted.args[4]), status: "staged" } : null);
    }
    if (sql.includes("SELECT COUNT(*) AS n FROM import_staging_rows WHERE batch_id=?")) {
      return { n: script.replayBatch?.rows_total ?? writes.filter(write => write.sql.includes("INSERT INTO import_staging_rows")).length };
    }
    if (sql.includes("FROM merge_command_receipts WHERE operation_id=?")) return script.mergeReceipt ?? null;
    if (sql.includes("FROM horse_merges WHERE id=?")) return script.merge ?? null;
    if (sql.includes("FROM horse_redirect_aliases WHERE alias_horse_id=?")) return script.alias ?? null;
    if (sql.startsWith("SELECT 1 AS ok WHERE") && sql.includes("equine_clinical_events")) {
      return script.protectedIdentityAllowed === false ? null : { ok: 1 };
    }
    if (sql.includes("name_latin FROM horses WHERE id=?")) return [script.kept, script.merged].find(horse => Number(horse?.id) === Number(args[0])) ?? null;
    if (sql.includes("FROM horses WHERE id=? AND deleted_at IS NULL")) return script.kept ?? null;
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    for (const [needle, rows] of Object.entries(script.fkRows ?? {})) {
      if (sql.includes(`FROM ${needle} WHERE`)) return { results: rows };
    }
    return { results: [] };
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: (column?: string) => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async column => { const row = answerFirst(sql, args); return column && row ? (row as Record<string, unknown>)[column] : row; },
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  let autoIncrement = 100;
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      autoIncrement += 1;
      return statements.map(() => ({ results: [], success: true, meta: { changes: 1, last_row_id: autoIncrement } }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const staffSession = {
  session_id: "s-1", csrf_token: "csrf-1",
  expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "editor-1", email: "editor@example.com", display_name: "Editor",
  role: "editor", is_active: 1,
};

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };
const ORIGIN = "https://registry.example";

function post(body: unknown, path: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

const realSource = { id: 5, name: "Iranian Arabian Society ledger", issuer_namespace: "registry:ias", is_synthetic: 0 };

describe("P10 source agreements + staging boundary", () => {
  it("registers a source agreement with an audit row", async () => {
    const db = makeDb({ session: staffSession });
    const response = await adminCreateImportSource(post({
      name: "Iranian Arabian Society ledger", issuer_namespace: "registry:ias",
      scope_note: "Studbook register numbers, names and parentage for Arabian horses",
      redistribution_allowed: false, update_cadence: "quarterly",
    }, "/api/admin/imports/sources"), { ...env, DB: db });
    expect(response.status).toBe(201);
    const insert = db.__writes.find((w) => w.sql.includes("INSERT INTO import_sources"));
    expect(insert).toBeTruthy();
    expect(insert?.args[0]).toBe("Iranian Arabian Society ledger");
    const audit = db.__writes.find((w) => w.sql.includes("INSERT INTO audit_events"));
    expect(audit?.args[1]).toBe("import.source.registered");
  });

  it("refuses a duplicate source name (409)", async () => {
    const db = makeDb({ session: staffSession, existingSourceName: { id: 1 } });
    await expect(adminCreateImportSource(post({ name: "dup", issuer_namespace: "registry:x", scope_note: "0123456789 duplicate" }, "/api/admin/imports/sources"), { ...env, DB: db }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("REFUSES a synthetic source for production ingestion (P10 acceptance)", async () => {
    const db = makeDb({ session: staffSession, source: { id: 9, name: "demo data", issuer_namespace: "synthetic:r88", is_synthetic: 1 } });
    await expect(adminStageImportBatch(post({ source_id: 9, file_name: "demo.xlsx", mapping_version: "v1", rows: [{ external_id: "1", register_no: "A" }] }, "/api/admin/imports/stage"), { ...env, DB: db }))
      .rejects.toMatchObject({ status: 400, code: "synthetic_source_forbidden" });
    expect(db.__writes.filter((w) => w.sql.includes("INSERT INTO import_batches")).length).toBe(0);
  });

  it("stages a dry-run batch with raw + normalized copies and writes NOTHING canonical", async () => {
    const db = makeDb({ session: staffSession, source: realSource });
    const response = await adminStageImportBatch(post({
      source_id: 5, file_name: "ledger-q3.xlsx", mapping_version: "v1",
      rows: [{ external_id: "۱۰۰", register_no: "۰۹۸", name_native: "كوه نور", name_latin: "Kouh" }],
    }, "/api/admin/imports/stage"), { ...env, DB: db });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { dry_run: boolean; counts: Record<string, number> };
    expect(body.dry_run).toBe(true);
    expect(body.counts.create).toBe(1);
    const stageInsert = db.__writes.find((w) => w.sql.includes("INSERT INTO import_staging_rows"));
    expect(stageInsert).toBeTruthy();
    // The batch id is resolved by the unique source+digest inside the transaction.
    // binds: (externalId, rawJson, normalizedJson, checksum, action, horseId, ...)
    const rawJson = String(stageInsert?.args[1]);
    const normalizedJson = String(stageInsert?.args[2]);
    expect(rawJson).toContain("۰۹۸");       // Persian digits preserved raw
    expect(rawJson).toContain("كوه نور");   // Arabic variants preserved raw
    expect(normalizedJson).toContain("098"); // normalized copy unified
    // No canonical writes during staging.
    expect(db.__writes.filter((w) => w.sql.includes("INSERT INTO horses")).length).toBe(0);
    expect(db.__writes.filter((w) => w.sql.includes("INSERT INTO horse_identifiers")).length).toBe(0);
  });

  it("reimporting an identical file REPLAYS the existing batch (no duplicate staging)", async () => {
    const db = makeDb({ session: staffSession, source: realSource, replayBatch: { id: 77, rows_total: 1, status: "completed" } });
    const response = await adminStageImportBatch(post({
      source_id: 5, file_name: "ledger-q3 (copy).xlsx", mapping_version: "v1",
      rows: [{ external_id: "1", register_no: "A", name_latin: "Alpha" }],
    }, "/api/admin/imports/stage"), { ...env, DB: db });
    const body = (await response.json()) as { idempotent_replay: boolean; batch: { id: number } };
    expect(body.idempotent_replay).toBe(true);
    expect(body.batch.id).toBe(77);
    expect(db.__writes.filter((w) => w.sql.includes("INSERT INTO import_batches")).length).toBe(0);
  });

  it("refuses duplicate external_ids inside one payload", async () => {
    const db = makeDb({ session: staffSession, source: realSource });
    await expect(adminStageImportBatch(post({
      source_id: 5, file_name: "x.xlsx", mapping_version: "v1",
      rows: [
        { external_id: "7", register_no: "A" },
        { external_id: "7", register_no: "B" },
      ],
    }, "/api/admin/imports/stage"), { ...env, DB: db }))
      .rejects.toMatchObject({ status: 400, code: "invalid_import_batch" });
  });
});

// ---------------------------------------------------------------------------
// 4. Merge / unmerge — the R117-19 versioned command contract (validation,
//    preflight refusals and receipt idempotency; the full guarded SQL truth
//    lives in tests/integration/r117-19-merge-reversal.test.ts on the real
//    migrated database).
// ---------------------------------------------------------------------------

async function sha256Hex(text: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

describe("R117-19 versioned merge + unmerge commands", () => {
  const kept = { id: 10, name_latin: "Kept" };
  const merged = { id: 20, name_latin: "Duplicate" };
  const digest = "a".repeat(64);
  const versionedBody = { merge_horse_id: 20, reason: "Same horse registered twice under two namespaces", operation_id: "r117-19-unit-merge-0001", expected_manifest_digest: digest };

  it("the versioned merge command requires operation_id and the approved manifest digest", async () => {
    // The legacy unversioned body refuses with guidance, before any read.
    await expect(adminMergeHorses(post({ merge_horse_id: 20, reason: "Legacy unversioned body must refuse." }, "/api/admin/horses/10/merge"), { ...env, DB: makeDb({ session: staffSession }) }, 10))
      .rejects.toMatchObject({ status: 400, code: "invalid_merge" });
    // A non-sha256 digest refuses.
    await expect(adminMergeHorses(post({ ...versionedBody, expected_manifest_digest: "not-a-digest" }, "/api/admin/horses/10/merge"), { ...env, DB: makeDb({ session: staffSession }) }, 10))
      .rejects.toMatchObject({ status: 400, code: "invalid_merge" });
    // A malformed operation key refuses.
    await expect(adminMergeHorses(post({ ...versionedBody, operation_id: "bad key!" }, "/api/admin/horses/10/merge"), { ...env, DB: makeDb({ session: staffSession }) }, 10))
      .rejects.toMatchObject({ status: 400, code: "invalid_merge" });
  });

  it("refuses self-merge, missing horses and already-merged targets before touching anything", async () => {
    await expect(adminMergeHorses(post({ ...versionedBody, merge_horse_id: 10 }, "/api/admin/horses/10/merge"), { ...env, DB: makeDb({ session: staffSession }) }, 10))
      .rejects.toMatchObject({ status: 400 });
    await expect(adminMergeHorses(post(versionedBody, "/api/admin/horses/10/merge"), { ...env, DB: makeDb({ session: staffSession, kept: null }) }, 10))
      .rejects.toMatchObject({ status: 404 });
    const db = makeDb({ session: staffSession, kept, merged, alias: { kept_horse_id: 10 } });
    await expect(adminMergeHorses(post(versionedBody, "/api/admin/horses/10/merge"), { ...env, DB: db }, 10))
      .rejects.toMatchObject({ status: 409, code: "already_merged" });
    expect(db.__writes.filter((w) => w.sql.includes("INSERT INTO horse_merges")).length).toBe(0);
  });

  it("refuses protected identity records before evaluating ordinary merge conflicts", async () => {
    const db = makeDb({ session: staffSession, kept, merged, protectedIdentityAllowed: false, alias: { kept_horse_id: 10 } });
    await expect(adminMergeHorses(post(versionedBody, "/api/admin/horses/10/merge"), { ...env, DB: db }, 10))
      .rejects.toMatchObject({ status: 409, code: "protected_identity_reconciliation_required" });
    expect(db.__writes.filter(w => w.sql.includes("INSERT INTO horse_merges") || w.sql.includes("UPDATE horses"))).toEqual([]);
  });

  it("an exact operation-key retry replays the stored receipt; a reused key with different content refuses", async () => {
    const reason = "Same horse registered twice under two namespaces";
    const requestDigest = await sha256Hex(canonicalJson({ keptHorseId: 10, mergedId: 20, reason }));
    const db = makeDb({
      session: staffSession,
      mergeReceipt: { command: "merge", actor_user_id: "editor-1", request_digest: requestDigest, receipt_json: JSON.stringify({ merged: true, kept_horse_id: 10, merged_horse_id: 20, moved_references: 3 }) },
    });
    const response = await adminMergeHorses(post({ ...versionedBody, reason }, "/api/admin/horses/10/merge"), { ...env, DB: db }, 10);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { merged: boolean; replayed: boolean };
    expect(body).toMatchObject({ merged: true, replayed: true });
    // Same key, different reason => different request digest => refused before any write.
    await expect(adminMergeHorses(post({ ...versionedBody, reason: "A different reason under the same key must refuse." }, "/api/admin/horses/10/merge"), { ...env, DB: db }, 10))
      .rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("the versioned unmerge requires a reason and an operation key; missing/already-unmerged merges refuse", async () => {
    // Validation first: the legacy empty body refuses.
    await expect(adminUnmergeHorses(post({}, "/api/admin/horse-merges/3/unmerge"), { ...env, DB: makeDb({ session: staffSession }) }, 3))
      .rejects.toMatchObject({ status: 400, code: "invalid_unmerge" });
    const unmergeBody = { reason: "The duplicate resolution was wrong; restore the original.", operation_id: "r117-19-unit-unmerge-0001" };
    await expect(adminUnmergeHorses(post(unmergeBody, "/api/admin/horse-merges/3/unmerge"), { ...env, DB: makeDb({ session: staffSession, merge: null }) }, 3))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    const alreadyUnmerged = makeDb({ session: staffSession, merge: { id: 3, kept_horse_id: 10, merged_horse_id: 20, moved_manifest: "[]", reason: "r", unmerged_at: "2026-10-03T00:00:00Z", unmerge_operation_id: null, manifest_digest: null } });
    await expect(adminUnmergeHorses(post(unmergeBody, "/api/admin/horse-merges/3/unmerge"), { ...env, DB: alreadyUnmerged }, 3))
      .rejects.toMatchObject({ status: 409, code: "already_unmerged" });
    // An exact same-key retry of the winning unmerge replays its receipt.
    const requestDigest = await sha256Hex(canonicalJson({ mergeId: 3, reason: unmergeBody.reason }));
    const replayDb = makeDb({
      session: staffSession,
      merge: { id: 3, kept_horse_id: 10, merged_horse_id: 20, moved_manifest: "[]", reason: "r", unmerged_at: "2026-10-03T00:00:00Z", unmerge_operation_id: "r117-19-unit-unmerge-0001", manifest_digest: null },
      mergeReceipt: { command: "unmerge", actor_user_id: "editor-1", request_digest: requestDigest, receipt_json: JSON.stringify({ unmerged: true, merge_id: 3, restored_references: 0 }) },
    });
    const response = await adminUnmergeHorses(post(unmergeBody, "/api/admin/horse-merges/3/unmerge"), { ...env, DB: replayDb }, 3);
    expect(response.status).toBe(200);
    expect(await (response.json() as Promise<{ unmerged: boolean; replayed: boolean }>)).toMatchObject({ unmerged: true, replayed: true });
  });
});
