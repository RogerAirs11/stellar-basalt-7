import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requirePermission, requireCsrf } from "../../auth/guards";
import { capabilitiesForRole } from "../../auth/capabilities";
import { batchDigest, classifyImportRow, normalizeDigits, normalizeImportRow, type ExistingHorseRecord, type ImportRow } from "../../registry/importStaging";
import { RULE_OVERRIDES_SCHEMA } from "../../registry/validation";
import { recordFieldClaims } from "./fieldClaims";
import { protectedIdentityMergeGuard } from "../../registry/protectedIdentity";
import { checkRegistryRules } from "./registryRules";
import { buildRuleSubject, type RuleEvaluationSubject, type RuleSubjectRecord } from "../../registry/rulesEngine";
import { runRegistryPolicyBatch, policyRowMatches, type RegistryPolicyCommit } from "../../registry/ruleCommit";
import type { D1Database } from "@cloudflare/workers-types";
import { isDuplicateIdentifierError, normalizeIdentifierValue } from "../../registry/identifiers";

/** R140-B: canonical identifier normalization for proof lookups — blank collapses to NULL, NFKC digits unify. */
function canonicalNormalizedIdentifier(value: unknown): string | null {
  if (value == null) return null;
  const normalized = normalizeIdentifierValue(String(value));
  return normalized === "" ? null : normalized;
}
import { pedigreeGraphLockStatement } from "../../registry/mutationStatements";
import { isGraphLockTimeoutError } from "../../registry/mutations";
import {
  mergeInvariantAssertionStatement,
  isMergeInvariantViolation,
  MERGE_ANCESTRY_CYCLE_GUARD_SQL,
  ANCESTRY_CYCLE_PROBE_SQL,
  ANCESTOR_OF_PROBE_SQL,
} from "../../registry/mergeInvariants";
import {
  HORSE_REFERENCE_INVENTORY_VERSION,
  HORSE_REFERENCE_INVENTORY,
  MERGE_MOVE_PAIRS,
  type HorseReferenceEntry,
} from "../../registry/horseReferenceInventory";

/**
 * R88 agent plan P10 — licensed ingestion, staging and duplicate
 * adjudication.
 *
 * Layering:
 *  - import_sources: the source AGREEMENT registry (scope, redistribution,
 *    retention, cadence, responsible operator). Synthetic namespaces can
 *    never be selected for production ingestion.
 *  - staging (POST .../stage): the DRY RUN. Raw rows are staged verbatim
 *    (Persian/Arabic variants preserved) next to their normalized copies;
 *    classification (create/update/conflict/skip) runs against typed
 *    identifiers only — horses are never matched by name. NOTHING canonical
 *    is written. (source_id, file_sha256) is unique: reimporting an
 *    identical file REPLAYS the same batch.
 *  - apply (POST .../batches/:id/apply): the ONLY canonical writer —
 *    reviewed, resumable (bounded rows per call, per-row outcome state) and
 *    per-row transactional. Creates claim identifiers inside the same batch
 *    (unique live index); a lost race or a live holder routes the row to
 *    conflict review — trusted fields are never overwritten. Updates are
 *    fill-once (NULL canonical identity facts only).
 *  - merge/unmerge: reviewer commands with a replayable moved-reference
 *    manifest, redirect alias, provenance and search-reindex fan-out. Two
 *    horses sharing a name are NEVER silently collapsed.
 */

const MAX_BATCH_ROWS = 500;
const MAX_APPLY_ROWS_PER_CALL = 50;

const ImportSourceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  issuer_namespace: z.string().trim().min(3).max(120),
  scope_note: z.string().trim().min(10).max(2000),
  redistribution_allowed: z.boolean().default(false),
  retention_note: z.string().trim().max(1000).nullable().optional(),
  update_cadence: z.string().trim().max(200).nullable().optional(),
  responsible_operator_user_id: z.string().trim().max(64).nullable().optional(),
  license_note: z.string().trim().max(2000).nullable().optional(),
  is_synthetic: z.boolean().default(false),
});

const StageBatchSchema = z.object({
  source_id: z.number().int().positive(),
  file_name: z.string().trim().min(1).max(240),
  mapping_version: z.string().trim().min(1).max(40),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_BATCH_ROWS),
});

const ApplySchema = z.object({
  operator_minutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  // R146-D04: permitted policy overrides applied to every evaluated row in
  // this apply call (rule_id + reason) — recorded in the rule outcome trail.
  rule_overrides: RULE_OVERRIDES_SCHEMA.optional(),
});

/** Opaque caller-generated idempotency key shared by the versioned import
 * review, merge and unmerge commands (same doctrine, one key grammar). */
const OperationKeySchema = z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/, "operation_id must be an opaque caller-generated key (letters, digits, dot, colon, dash, underscore)");

/** R117-19: the merge command is VERSIONED — the operator approves a fresh
 * preview's manifest digest and the commit refuses when the reference set
 * changed in between (new reference inserted after preview, changed FK before
 * commit, concurrent merge sharing a horse). */
const MergeSchema = z.object({
  merge_horse_id: z.number().int().positive(),
  reason: z.string().trim().min(10).max(500),
  operation_id: OperationKeySchema,
  expected_manifest_digest: z.string().trim().regex(/^[0-9a-f]{64}$/, "expected_manifest_digest must be the sha256 hex returned by a fresh merge preview"),
});

const UnmergeSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  operation_id: OperationKeySchema,
});

async function sha256HexLocal(text: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function canonicalJsonLocal(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJsonLocal).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonLocal(v)}`).join(",")}}`;
}

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

// Derive the write-time role predicate from the same capability map used by
// requirePermission. A preflight session must not authorize a later revoked edit.
const IMPORT_WRITER_ROLES = (["user", "owner", "editor", "admin", "super_admin"] as const)
  .filter(role => capabilitiesForRole(role).includes("horse.edit"))
  .map(role => `'${role}'`).join(",");
const IMPORT_WRITER_SQL = `EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES}))`;

function importWriterLock(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare(`UPDATE users SET is_active=is_active WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`).bind(userId);
}

/** PostgreSQL serializes competing applies on the staging row. Every later
 * write also tests pending: acquiring a lock after the winner committed does
 * not entitle the loser to repeat its canonical write or overwrite the receipt. */
function importRowLocks(db: D1Database, batchId: number, rowId: number, userId: string): D1PreparedStatement[] {
  return [importWriterLock(db, userId), db.prepare(`
    UPDATE import_staging_rows SET outcome=outcome
    WHERE id=? AND batch_id=? AND outcome='pending' AND ${IMPORT_WRITER_SQL}
  `).bind(rowId, batchId, userId)];
}

async function assertCompleteStaging(db: D1Database, batch: { id: unknown; rows_total: unknown }): Promise<void> {
  const expected = Number(batch.rows_total);
  const actual = Number(await db.prepare("SELECT COUNT(*) AS n FROM import_staging_rows WHERE batch_id=?").bind(Number(batch.id)).first("n"));
  if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) {
    throw new HttpError(409, "incomplete_import_batch", "This older import has an incomplete staging record. It cannot be replayed or applied; an operator must reconcile the original file before staging a new mapping version.");
  }
}

function isDuplicateImportBatch(cause: unknown): boolean {
  const error = cause as { code?: string; constraint?: string; constraint_name?: string; message?: string } | null;
  return (error?.code === "23505" && (error.constraint ?? error.constraint_name) === "uq_import_batches_source_file")
    || /UNIQUE constraint failed: import_batches\.source_id, import_batches\.file_sha256/i.test(error?.message ?? String(cause));
}

// ---------------------------------------------------------------------------
// Source agreements.
// ---------------------------------------------------------------------------

export async function adminCreateImportSource(request: Request, env: Env): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = ImportSourceSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_import_source", "Import source failed validation", parsed.error.flatten());
  const d = parsed.data;
  const existing = await env.DB.prepare("SELECT id FROM import_sources WHERE name=?").bind(d.name).first();
  if (existing) throw new HttpError(409, "import_source_exists", "An import source with this name already exists");
  const [insert] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO import_sources(name,issuer_namespace,scope_note,redistribution_allowed,retention_note,update_cadence,responsible_operator_user_id,license_note,is_synthetic)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(d.name, d.issuer_namespace, d.scope_note, d.redistribution_allowed ? 1 : 0, d.retention_note ?? null, d.update_cadence ?? null, d.responsible_operator_user_id ?? null, d.license_note ?? null, d.is_synthetic ? 1 : 0),
    env.DB.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      VALUES(?,?,?,?,'null',?,CURRENT_TIMESTAMP)
    `).bind(auth.user.id, "import.source.registered", "import_source", "new", JSON.stringify({ name: d.name, issuer_namespace: d.issuer_namespace, redistribution_allowed: d.redistribution_allowed, is_synthetic: d.is_synthetic })),
  ]);
  const source = await env.DB.prepare("SELECT * FROM import_sources WHERE id=?").bind(Number(insert?.meta.last_row_id ?? 0)).first();
  return json({ source }, { status: 201 });
}

export async function adminListImportSources(request: Request, env: Env): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const rows = await env.DB.prepare("SELECT * FROM import_sources ORDER BY id").all();
  return json({ sources: rows.results ?? [] });
}

// ---------------------------------------------------------------------------
// Staging (the dry run — no canonical writes).
// ---------------------------------------------------------------------------

export async function adminStageImportBatch(request: Request, env: Env): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = StageBatchSchema.safeParse(await readJson<unknown>(request, 4 * 1024 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_import_batch", "Batch staging failed validation", parsed.error.flatten());
  const d = parsed.data;
  const source = await env.DB.prepare("SELECT id,name,issuer_namespace,is_synthetic FROM import_sources WHERE id=?").bind(d.source_id)
    .first<{ id: number; name: string; issuer_namespace: string; is_synthetic: number }>();
  if (!source) throw new HttpError(404, "not_found", "Import source not found");
  // P10 acceptance: the synthetic namespace can NEVER be selected as a
  // production canonical source.
  if (source.is_synthetic === 1) {
    throw new HttpError(400, "synthetic_source_forbidden", `Source '${source.name}' is a synthetic/demo namespace and can never feed production canonical data`);
  }

  const digest = await batchDigest(d.rows as ImportRow[], d.mapping_version);
  // Duplicate external_ids inside one payload are refused outright — staging
  // rows are unique per (batch, external_id).
  const externalIds = new Set<string>();
  for (const row of d.rows as ImportRow[]) {
    const key = normalizeDigits(String(row.external_id ?? "")).trim();
    if (!key) throw new HttpError(400, "invalid_import_batch", "Every row needs a non-empty external_id");
    if (externalIds.has(key)) throw new HttpError(400, "invalid_import_batch", `Duplicate external_id in payload: ${key}`);
    externalIds.add(key);
  }
  const replay = await env.DB.prepare("SELECT * FROM import_batches WHERE source_id=? AND file_sha256=?").bind(d.source_id, digest).first<Record<string, unknown>>();
  if (replay) {
    await assertCompleteStaging(env.DB, { id: replay.id, rows_total: replay.rows_total });
    return json({ batch: replay, idempotent_replay: true, digest, note: "Identical file content already staged — replaying the existing batch (no duplicate staging, no canonical writes)" });
  }

  const staged: Array<{ externalId: string; rawJson: string; normalizedJson: string; checksum: string; action: string; horseId: number | null; detail: string }> = [];
  const counts = { create: 0, update: 0, conflict: 0, skip: 0 };

  for (const rawRow of d.rows as ImportRow[]) {
    const normalized = await normalizeImportRow(rawRow);
    const registerMatches = await lookupIdentifier(env.DB, "register_no", source.issuer_namespace, normalized.normalized.register_no ?? null);
    const microchipMatches = await lookupIdentifier(env.DB, "microchip_no", "microchip", normalized.normalized.microchip_no ?? null);
    let existing: ExistingHorseRecord | null = null;
    const matchedId = registerMatches[0]?.horseId ?? microchipMatches[0]?.horseId ?? null;
    if (matchedId != null) {
      const row = await env.DB.prepare(
        "SELECT h.id,h.register_no,h.microchip_no,h.father_id,h.mother_id,p.register_no AS father_register_no,m.register_no AS mother_register_no FROM horses h LEFT JOIN horses p ON p.id=h.father_id LEFT JOIN horses m ON m.id=h.mother_id WHERE h.id=? AND h.deleted_at IS NULL",
      ).bind(matchedId).first<ExistingHorseRecord>();
      existing = row ?? null;
    }
    const decision = classifyImportRow({ row: normalized, registerMatches, microchipMatches, existing });
    counts[decision.action] += 1;
    staged.push({
      externalId: normalized.raw.external_id,
      rawJson: JSON.stringify(normalized.raw),
      normalizedJson: JSON.stringify(normalized.normalized),
      checksum: normalized.checksum,
      action: decision.action,
      horseId: "horseId" in decision ? decision.horseId : null,
      detail: decision.detail,
    });
  }

  // The header and every row commit together. Resolve the header through its
  // unique source+digest key inside the same transaction, never last_insert_id.
  // Do not use INSERT ... ON CONFLICT DO NOTHING for the header: the digest
  // identifies normalized content, so a concurrent equivalent file may carry
  // different external IDs. Its rows must never be appended to the winner.
  try {
    const results = await env.DB.batch([
      importWriterLock(env.DB, auth.user.id),
      env.DB.prepare(`
        INSERT INTO import_batches(source_id,file_name,file_sha256,mapping_version,status,rows_total,rows_created,rows_updated,rows_conflict,rows_skipped,created_by_user_id)
        SELECT ?,?,?,?, 'staged', ?,?,?,?,?,?
        WHERE ${IMPORT_WRITER_SQL} AND EXISTS(SELECT 1 FROM import_sources WHERE id=? AND is_synthetic=0)
      `).bind(d.source_id, d.file_name, digest, d.mapping_version, d.rows.length, counts.create, counts.update, counts.conflict, counts.skip, auth.user.id, auth.user.id, d.source_id),
      ...staged.map(row => env.DB.prepare(`
        INSERT INTO import_staging_rows(batch_id,external_id,raw_json,normalized_json,row_checksum,row_action,horse_id)
        SELECT b.id,?,?,?,?,?,? FROM import_batches b JOIN import_sources s ON s.id=b.source_id
        WHERE b.source_id=? AND b.file_sha256=? AND s.is_synthetic=0 AND ${IMPORT_WRITER_SQL}
      `).bind(row.externalId, row.rawJson, row.normalizedJson, row.checksum, row.action, row.horseId, d.source_id, digest, auth.user.id)),
    ]);
    if (Number(results[1]?.meta.changes ?? 0) !== 1) {
      await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
      throw new HttpError(409, "import_source_changed", "The source changed before staging; reload and review the source agreement.");
    }
  } catch (cause) {
    if (!isDuplicateImportBatch(cause)) throw cause;
    const concurrent = await env.DB.prepare("SELECT * FROM import_batches WHERE source_id=? AND file_sha256=?").bind(d.source_id, digest).first<Record<string, unknown>>();
    if (!concurrent) throw new HttpError(503, "staging_unconfirmed", "The staging outcome could not be confirmed; recheck this file before starting another import.");
    await assertCompleteStaging(env.DB, { id: concurrent.id, rows_total: concurrent.rows_total });
    return json({ batch: concurrent, idempotent_replay: true, digest, note: "Identical content was staged concurrently; the existing complete batch is returned without duplicate rows." });
  }
  const batch = await env.DB.prepare("SELECT * FROM import_batches WHERE source_id=? AND file_sha256=?").bind(d.source_id, digest).first<Record<string, unknown>>();
  if (!batch) throw new HttpError(503, "staging_unconfirmed", "The complete staging outcome could not be confirmed; recheck this file before retrying.");
  await assertCompleteStaging(env.DB, { id: batch.id, rows_total: batch.rows_total });
  return json({
    batch,
    dry_run: true,
    digest,
    counts,
    rows: staged.map((row) => ({ external_id: row.externalId, action: row.action, detail: row.detail })),
    note: "Dry-run staging complete: nothing canonical was written. Review the classification, then POST /api/admin/imports/batches/:id/apply.",
  }, { status: 201 });
}

async function lookupIdentifier(db: D1Database, kind: string, namespace: string, value: string | null): Promise<Array<{ horseId: number; via: "register_no" | "microchip_no" }>> {
  if (value == null || value === "") return [];
  const rows = await db.prepare(
    "SELECT horse_id FROM horse_identifiers WHERE kind=? AND issuer_namespace=? AND normalized_value=? AND status='live' LIMIT 5",
  ).bind(kind, namespace, value).all<{ horse_id: number }>();
  return (rows.results ?? []).map((row) => ({ horseId: row.horse_id, via: kind === "microchip_no" ? "microchip_no" : "register_no" }));
}

// ---------------------------------------------------------------------------
// Apply (resumable, per-row transactional, conflicts never overwrite).
// ---------------------------------------------------------------------------

export async function adminApplyImportBatch(request: Request, env: Env, batchId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = ApplySchema.safeParse(await readJson<unknown>(request, 4 * 1024).catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "invalid_apply", "Apply failed validation", parsed.error.flatten());
  const applyInput = parsed.data;
  const batch = await env.DB.prepare("SELECT id,source_id,status,rows_total FROM import_batches WHERE id=?").bind(batchId)
    .first<{ id: number; source_id: number; status: string; rows_total: number }>();
  if (!batch) throw new HttpError(404, "not_found", "Import batch not found");
  await assertCompleteStaging(env.DB, batch);
  if (batch.status === "completed") {
    return json({ batch, already_completed: true, note: "This batch is already fully applied (resumable replay)" });
  }

  const pending = await env.DB.prepare(`
    SELECT id,external_id,raw_json,normalized_json,row_checksum,row_action,horse_id
    FROM import_staging_rows WHERE batch_id=? AND outcome='pending' ORDER BY id LIMIT ${MAX_APPLY_ROWS_PER_CALL}
  `).bind(batchId).all<{
    id: number; external_id: string; raw_json: string; normalized_json: string; row_checksum: string; row_action: string; horse_id: number | null;
  }>();
  const rows = pending.results ?? [];
  if (rows.length === 0) {
    await finalizeBatch(env.DB, batchId);
    const final = await env.DB.prepare("SELECT * FROM import_batches WHERE id=?").bind(batchId).first();
    return json({ batch: final, completed: true });
  }

  const source = await env.DB.prepare("SELECT issuer_namespace,is_synthetic,redistribution_allowed FROM import_sources WHERE id=?").bind(batch.source_id)
    .first<{ issuer_namespace: string; is_synthetic: number; redistribution_allowed: number }>();
  if (!source || Number(source.is_synthetic) !== 0) throw new HttpError(409, "import_source_changed", "The source is no longer eligible for canonical import; reload its agreement.");
  const namespace = source.issuer_namespace;
  const policySourceId = batch.source_id;
  // R142-B06 (Master-AI): permission to ingest PRIVATELY is separate from
  // permission to PUBLISH. A source whose agreement withholds redistribution
  // may still feed the canonical registry, but its created rows start
  // INACTIVE (invisible to anonymous reads) until an independent publication
  // decision exists — automatic public promotion of restricted input is no
  // longer possible. The data_origin token keeps the provenance visible to
  // reviewers while the row stays private.
  const publicationAllowed = Number(source.redistribution_allowed) === 1;
  const dataOriginToken = `import:${namespace}`;

  const pendingRowSql = `EXISTS(SELECT 1 FROM import_staging_rows r
    JOIN import_batches b ON b.id=r.batch_id JOIN import_sources s ON s.id=b.source_id
    WHERE r.id=? AND r.batch_id=? AND r.outcome='pending' AND s.is_synthetic=0 AND ${IMPORT_WRITER_SQL})`;
  async function reconcileNoWrite(rowId: number): Promise<void> {
    // A zero-row write may be a concurrent replay or a lost permission. Recheck
    // the latter before exposing a private receipt or calling anything applied.
    await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
    const current = await env.DB.prepare("SELECT outcome FROM import_staging_rows WHERE id=? AND batch_id=?").bind(rowId, batchId).first<{ outcome: string }>();
    if (!current || current.outcome === "pending") throw new HttpError(409, "import_row_changed", "The import row or its source changed before apply. Reload the batch and review its current state.");
  }

  let appliedCreates = 0, appliedUpdates = 0, conflicts = 0, skipped = 0;
  const failed = 0;
  // Every canonical row captures a policy epoch, including an empty rule set.
  // Its rule receipts commit with that row; no post-commit best-effort queue.
  for (const row of rows) {
    const raw = JSON.parse(row.raw_json) as ImportRow;
    // R140-B: apply writes through the SAME canonical normalization staging
    // computed — the raw copy never feeds SQL directly. Blank identifiers
    // become NULL ("" is not an identifier), implausible birth years are
    // dropped to unknown, and identifier claims match the T08 canonical path.
    const canonical = JSON.parse(row.normalized_json) as ImportRow;
    const gateBinds = [row.id, batchId, auth.user.id];
    const locks = () => importRowLocks(env.DB, batchId, row.id, auth.user.id);
    async function markConflict(reason: string, detail: unknown = null, policy?: RegistryPolicyCommit) {
      const detailJson = JSON.stringify({ reason, detail, ...(policy ? { policy_operation_id: policy.operationId } : {}) });
      const statements = [...locks(), env.DB.prepare(`UPDATE import_staging_rows SET outcome='conflict',outcome_detail=?,processed_at=CURRENT_TIMESTAMP WHERE id=? AND ${pendingRowSql}`)
        .bind(detailJson, row.id, ...gateBinds)];
      const changed = policy ? await runRegistryPolicyBatch(env.DB, statements, { ...policy, decision: "rejected", overrides: [],
        landed: { sql: "EXISTS(SELECT 1 FROM import_staging_rows WHERE id=? AND batch_id=? AND outcome='conflict' AND outcome_detail=?)", bindings: [row.id, batchId, detailJson] } })
        : await env.DB.batch(statements);
      if (Number(changed[2]?.meta.changes ?? 0) === 1) conflicts += 1;
      else await reconcileNoWrite(row.id);
    }
    async function checkImportRules(subject: RuleEvaluationSubject, operationId: string): Promise<RegistryPolicyCommit | null> {
      subject.policyContext!.checks.push(policyRowMatches("import_sources", { id: policySourceId, ...source }, ["id", "issuer_namespace", "is_synthetic", "redistribution_allowed"]));
      const checked = await checkRegistryRules(env.DB, subject, applyInput.rule_overrides);
      const policy = { subject, outcome: checked.outcome, overrides: checked.overrides, operationId, actorUserId: auth.user.id };
      if (checked.violation) {
        await markConflict("blocked_by_registry_rule", checked.violation.details, policy);
        return null;
      }
      return policy;
    }
    if (row.row_action === "create") {
      // ONE atomic D1 batch per row: the horse INSERT carries a unique marker
      // (horses.last_mutation_id), the typed-identifier claims resolve the
      // fresh id through that marker, and the staging outcome + audit land in
      // the SAME transaction. A lost identifier race (unique live index)
      // rolls back the WHOLE batch — no orphan horse — and the row is routed
      // to conflict review instead of overwriting the holder.
      // A fresh attempt marker gates only THIS successful insertion. Reusing a
      // deterministic row marker would let a loser repeat the winner's effects.
      const marker = `import:${batchId}:${row.id}:${crypto.randomUUID()}`;
      const nameLatin = typeof raw.name_latin === "string" && raw.name_latin.trim() ? raw.name_latin.trim() : (typeof raw.name_native === "string" && raw.name_native.trim() ? raw.name_native.trim() : "Unrecorded name");
      const registerNo = canonical.register_no ?? null;
      const microchipNo = canonical.microchip_no ?? null;
      const birthYear = canonical.birth_year ?? null;
      // R142-B08 (Master-AI): breed and sex are supported create-path fields —
      // they are applied through the same trim/empty-to-NULL discipline as the
      // identity fields, and the per-field outcome is reported in the receipt.
      const breedValue = typeof canonical.breed === "string" && canonical.breed.trim() ? canonical.breed.trim() : null;
      const sexValue = typeof canonical.sex === "string" && canonical.sex.trim() ? canonical.sex.trim() : null;
      // R146-D04: import evaluates the SAME rules as manual entry and review.
      // A blocked row routes to the conflict queue with an explainable
      // receipt; it never silently registers. Overrides ride on the apply
      // payload and are recorded per row in the rule outcome trail.
      const importSubject = await buildRuleSubject(env.DB, {
          subjectType: "import", subjectRef: `batch:${batchId}:row:${row.id}`, viaImport: true, includeEvidenceCounts: false,
          importSourceId: batch.source_id,
          record: {
            name_latin: nameLatin ?? null,
            breed_desc: breedValue ?? null,
            sex_desc: sexValue ?? null,
            register_no: registerNo ?? null,
            microchip_no: microchipNo ?? null,
            birth_year: birthYear ?? null,
          },
        });
      const importPolicy = await checkImportRules(importSubject, marker);
      if (!importPolicy) continue;
      try {
        const result = await runRegistryPolicyBatch(env.DB, [
          ...locks(),
          env.DB.prepare(`
            INSERT INTO horses(register_no,microchip_no,name_latin,name_native,birth_year,breed_desc,sex_desc,data_origin,is_active,last_mutation_id)
            SELECT ?,?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM import_sources WHERE id=? AND redistribution_allowed=1) THEN 1 ELSE 0 END,? WHERE ${pendingRowSql}
          `).bind(registerNo, microchipNo, nameLatin, raw.name_native ?? null, birthYear, breedValue, sexValue, dataOriginToken, batch.source_id, marker, ...gateBinds),
          env.DB.prepare(`
            INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id)
            SELECT 'register_no',?,?,?,h.id,'live',? FROM horses h
            WHERE h.last_mutation_id=? AND CAST(? AS TEXT) IS NOT NULL AND ? != ''
          `).bind(namespace, registerNo ?? "", String(raw.register_no ?? ""), String(batchId), marker, registerNo, registerNo),
          env.DB.prepare(`
            INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id)
            SELECT 'microchip_no','microchip',?,?,h.id,'live',? FROM horses h
            WHERE h.last_mutation_id=? AND CAST(? AS TEXT) IS NOT NULL AND ? != ''
          `).bind(microchipNo ?? "", String(raw.microchip_no ?? ""), String(batchId), marker, microchipNo, microchipNo),
          env.DB.prepare(`UPDATE import_staging_rows SET outcome='applied_create',outcome_detail=NULL,
            horse_id=(SELECT id FROM horses WHERE last_mutation_id=?),processed_at=CURRENT_TIMESTAMP
            WHERE id=? AND batch_id=? AND outcome='pending' AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)`).bind(marker, row.id, batchId, marker),
          env.DB.prepare(`
            INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
            SELECT ?,?, 'horse', CAST(id AS TEXT), 'null', CASE WHEN is_active=1 THEN ? ELSE ? END, CURRENT_TIMESTAMP FROM horses WHERE last_mutation_id=?
          `).bind(auth.user.id, "import.horse.created", ...[true, false].map(published => JSON.stringify({ batch_id: batchId, staging_row_id: row.id, external_id: row.external_id, register_no: registerNo, microchip_no: microchipNo, source_issuer_namespace: namespace, data_origin: dataOriginToken, published, applied_fields: ["name","register_no","microchip_no","birth_year",...(breedValue?["breed"]:[]),...(sexValue?["sex"]:[])] })), marker),
          env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT id,'licensed_import' FROM horses WHERE last_mutation_id=?").bind(marker),
          env.DB.prepare("UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL AND is_active=1)").bind(marker),
          env.DB.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)").bind(marker),
        ], importPolicy);
        if (Number(result[2]?.meta.changes ?? 0) === 1) appliedCreates += 1;
        else await reconcileNoWrite(row.id);
      } catch (cause) {
        if (cause instanceof HttpError) throw cause;
        // A lost database acknowledgement can follow a successful commit.
        // Keep the outcome unknown; a subsequent apply reconciles its receipt.
        if (!isDuplicateIdentifierError(cause)) throw new HttpError(503, "import_apply_failed", "The apply outcome could not be confirmed. Re-read this batch before retrying; its durable row receipts prevent duplicate application.");
        const conflict = await env.DB.prepare(`UPDATE import_staging_rows SET outcome='conflict',outcome_detail=?,processed_at=CURRENT_TIMESTAMP
          WHERE id=? AND batch_id=? AND outcome='pending' AND ${IMPORT_WRITER_SQL}`)
          .bind(JSON.stringify({ reason: "identifier_claim_lost", message: cause instanceof Error ? cause.message : String(cause) }), row.id, batchId, auth.user.id).run();
        if (Number(conflict.meta.changes ?? 0) === 1) conflicts += 1;
        else await reconcileNoWrite(row.id);
      }
    } else if (row.row_action === "update" && row.horse_id != null) {
      // Fill-once updates: only NULL canonical identity facts are filled.
      // R140-B: identifiers/birth-year come from the canonical normalized copy
      // (no garbage years, no blank-string fills); names keep their original
      // casing but a blank string can never overwrite a NULL.
      const rawParsed = JSON.parse(row.raw_json) as ImportRow;
      const marker = `import:${batchId}:${row.id}:${crypto.randomUUID()}`;
      const nameLatinFill = typeof rawParsed.name_latin === "string" && rawParsed.name_latin.trim() ? rawParsed.name_latin.trim() : null;
      const nameNativeFill = typeof rawParsed.name_native === "string" && rawParsed.name_native.trim() ? rawParsed.name_native.trim() : null;
      const birthYearFill = canonical.birth_year ?? null;
      // R142-B08: breed/sex fill-once — a supplied value can only fill a NULL
      // canonical fact, never overwrite a stronger reviewed value.
      const breedFill = typeof canonical.breed === "string" && canonical.breed.trim() ? canonical.breed.trim() : null;
      const sexFill = typeof canonical.sex === "string" && canonical.sex.trim() ? canonical.sex.trim() : null;
      const currentHorse = await env.DB.prepare("SELECT * FROM horses WHERE id=? AND deleted_at IS NULL").bind(row.horse_id).first<Record<string, unknown>>();
      if (currentHorse && !publicationAllowed) {
        await recordFieldClaims(env.DB, row.horse_id!, ([
          ["name_latin", nameLatinFill], ["name_native", nameNativeFill], ["birth_year", birthYearFill],
          ["breed_desc", breedFill], ["sex_desc", sexFill],
        ] as const).filter(([, value]) => value != null).map(([field_name, claimed_value]) => ({
          field_name, claimed_value, source_type: "import" as const,
          source_ref: `batch:${batchId}:row:${row.id}`, created_by: auth.user.id,
        })));
        await markConflict("restricted_source_public_update", "Restricted source data remains staged; an existing public horse is not permission to republish it");
        continue;
      }
      let importPolicy: RegistryPolicyCommit | null = null;
      if (currentHorse) {
        const proposed = { ...currentHorse, horse_id: row.horse_id,
          name_latin: currentHorse.name_latin || nameLatinFill,
          name_native: currentHorse.name_native ?? nameNativeFill,
          birth_year: currentHorse.birth_year ?? birthYearFill,
          breed_desc: currentHorse.breed_desc ?? breedFill,
          sex_desc: currentHorse.sex_desc ?? sexFill };
        const subject = await buildRuleSubject(env.DB, { subjectType: "import", subjectRef: `batch:${batchId}:row:${row.id}`, viaImport: true, includeEvidenceCounts: true, importSourceId: batch.source_id, record: proposed as RuleSubjectRecord });
        importPolicy = await checkImportRules(subject, marker);
        if (!importPolicy) continue;
      }
      // R146-D05: a refreshed external source can never silently replace a
      // stronger reviewed value — and its competing values are no longer
      // silently DROPPED either. Any incoming value that differs from an
      // existing canonical fact is RETAINED as a pending field claim (with
      // source + batch provenance) for review. Claims are computed before
      // the fill lands and recorded after it (a value that got filled is a
      // canonical match and is skipped as noise).
      let competingClaims: Parameters<typeof recordFieldClaims>[2] = [];
      if (row.horse_id != null && (nameLatinFill != null || nameNativeFill != null || birthYearFill != null || breedFill != null || sexFill != null)) {
        const current = await env.DB.prepare("SELECT name_latin,name_native,birth_year,breed_desc,sex_desc FROM horses WHERE id=? AND deleted_at IS NULL").bind(row.horse_id).first<Record<string, unknown>>();
        if (current) {
          competingClaims = [];
          const differs = (incoming: string | number | null, existing: unknown): boolean =>
            incoming != null && existing != null && String(existing).trim() !== "" && String(incoming).trim() !== String(existing).trim();
          const sourceRef = `batch:${batchId}:row:${row.id}`;
          if (differs(nameLatinFill, current.name_latin)) competingClaims.push({ field_name: "name_latin", claimed_value: nameLatinFill, source_type: "import", source_ref: sourceRef, created_by: auth.user.id });
          if (differs(nameNativeFill, current.name_native)) competingClaims.push({ field_name: "name_native", claimed_value: nameNativeFill, source_type: "import", source_ref: sourceRef, created_by: auth.user.id });
          if (differs(birthYearFill, current.birth_year)) competingClaims.push({ field_name: "birth_year", claimed_value: birthYearFill, source_type: "import", source_ref: sourceRef, created_by: auth.user.id });
          if (differs(breedFill, current.breed_desc)) competingClaims.push({ field_name: "breed_desc", claimed_value: breedFill, source_type: "import", source_ref: sourceRef, created_by: auth.user.id });
          if (differs(sexFill, current.sex_desc)) competingClaims.push({ field_name: "sex_desc", claimed_value: sexFill, source_type: "import", source_ref: sourceRef, created_by: auth.user.id });
        }
      }
      // Retain source assertions before canonical acceptance. Intake is
      // idempotent; if it fails, the staged row remains pending and no fill
      // commits. A later canonical conflict never invalidates the source's
      // independently recorded assertion.
      if (competingClaims.length && row.horse_id != null) await recordFieldClaims(env.DB, row.horse_id, competingClaims);
      const updateBatch = [
        ...locks(),
        env.DB.prepare(`
          UPDATE horses SET
            name_latin = CASE WHEN (name_latin IS NULL OR name_latin='') AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE name_latin END,
            name_native = CASE WHEN name_native IS NULL AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE name_native END,
            birth_year = CASE WHEN birth_year IS NULL AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE birth_year END,
            breed_desc = CASE WHEN breed_desc IS NULL AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE breed_desc END,
            sex_desc = CASE WHEN sex_desc IS NULL AND CAST(? AS TEXT) IS NOT NULL THEN ? ELSE sex_desc END,
            row_version=row_version+1,updated_at=CURRENT_TIMESTAMP,last_mutation_id=?
          WHERE id=? AND deleted_at IS NULL AND row_version=?
            AND EXISTS(SELECT 1 FROM import_sources WHERE id=? AND redistribution_allowed=1)
            AND ${pendingRowSql}
        `).bind(nameLatinFill, nameLatinFill, nameNativeFill, nameNativeFill, birthYearFill, birthYearFill, breedFill, breedFill, sexFill, sexFill, marker, row.horse_id, Number(currentHorse?.row_version ?? -1), batch.source_id, ...gateBinds),
        env.DB.prepare(`UPDATE import_staging_rows SET
          outcome=CASE WHEN EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?) THEN 'applied_update' ELSE 'skipped' END,
          processed_at=CURRENT_TIMESTAMP WHERE id=? AND ${pendingRowSql}`).bind(marker, row.id, ...gateBinds),
        env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
          SELECT ?,'import.horse.updated','horse',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP FROM horses WHERE last_mutation_id=?`)
          .bind(auth.user.id, JSON.stringify({ batch_id: batchId, staging_row_id: row.id, operation: "fill_once" }), marker),
        env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT id,'licensed_import' FROM horses WHERE last_mutation_id=?").bind(marker),
        env.DB.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)").bind(marker),
      ];
      const result = importPolicy ? await runRegistryPolicyBatch(env.DB, updateBatch, importPolicy) : await env.DB.batch(updateBatch);
      if (Number(result[2]?.meta.changes ?? 0) === 1) {
        appliedUpdates += 1;
      }
      else if (Number(result[3]?.meta.changes ?? 0) === 1) skipped += 1;
      else await reconcileNoWrite(row.id);
    } else if (row.row_action === "skip") {
      const result = await env.DB.batch([...locks(), env.DB.prepare(`UPDATE import_staging_rows SET outcome='skipped',processed_at=CURRENT_TIMESTAMP WHERE id=? AND ${pendingRowSql}`).bind(row.id, ...gateBinds)]);
      if (Number(result[2]?.meta.changes ?? 0) === 1) skipped += 1; else await reconcileNoWrite(row.id);
    } else {
      // conflict rows never apply — they wait for reviewer decisions
      const result = await env.DB.batch([...locks(), env.DB.prepare(`UPDATE import_staging_rows SET outcome='conflict',outcome_detail=COALESCE(outcome_detail,'{"reason":"staged_conflict"}'),processed_at=CURRENT_TIMESTAMP WHERE id=? AND ${pendingRowSql}`).bind(row.id, ...gateBinds)]);
      if (Number(result[2]?.meta.changes ?? 0) === 1) conflicts += 1; else await reconcileNoWrite(row.id);
    }
  }

  // Canonical revision/search invalidation already committed per row. A later
  // row failure cannot leave earlier accepted rows without that bookkeeping.

  const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM import_staging_rows WHERE batch_id=? AND outcome='pending'").bind(batchId).first<{ n: number }>();
  if (Number(remaining?.n ?? 0) === 0) {
    await finalizeBatch(env.DB, batchId);
  } else {
    await env.DB.prepare("UPDATE import_batches SET status='applying' WHERE id=? AND EXISTS(SELECT 1 FROM import_staging_rows WHERE batch_id=? AND outcome='pending')").bind(batchId, batchId).run();
  }
  const after = await env.DB.prepare("SELECT * FROM import_batches WHERE id=?").bind(batchId).first();
  return json({
    batch: after,
    applied_this_call: { creates: appliedCreates, updates: appliedUpdates, conflicts, skipped, failed },
    remaining_pending: Number(remaining?.n ?? 0),
    resumable: Number(remaining?.n ?? 0) > 0,
    note: Number(remaining?.n ?? 0) > 0 ? "Bounded apply: call again to continue from the next pending row" : "Batch fully processed",
  });
}

async function finalizeBatch(db: D1Database, batchId: number): Promise<void> {
  // Counters and completion use one snapshot, so a late finalizer cannot
  // overwrite a winner's receipts with counts read before its commit.
  await db.prepare(`
    UPDATE import_batches AS b SET
      status=CASE WHEN EXISTS(SELECT 1 FROM import_staging_rows WHERE batch_id=b.id AND outcome IN ('conflict','failed')) THEN 'partial' ELSE 'completed' END,
      rows_created=(SELECT COUNT(*) FROM import_staging_rows WHERE batch_id=b.id AND outcome='applied_create'),
      rows_updated=(SELECT COUNT(*) FROM import_staging_rows WHERE batch_id=b.id AND outcome='applied_update'),
      rows_conflict=(SELECT COUNT(*) FROM import_staging_rows WHERE batch_id=b.id AND outcome='conflict'),
      rows_skipped=(SELECT COUNT(*) FROM import_staging_rows WHERE batch_id=b.id AND outcome='skipped'),
      completed_at=CURRENT_TIMESTAMP
    WHERE b.id=? AND b.rows_total=(SELECT COUNT(*) FROM import_staging_rows WHERE batch_id=b.id)
      AND NOT EXISTS(SELECT 1 FROM import_staging_rows WHERE batch_id=b.id AND outcome='pending')
  `).bind(batchId).run();
}

export async function adminImportBatchStatus(request: Request, env: Env, batchId: number): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const batch = await env.DB.prepare("SELECT * FROM import_batches WHERE id=?").bind(batchId).first();
  if (!batch) throw new HttpError(404, "not_found", "Import batch not found");
  const rows = await env.DB.prepare(`
    SELECT id,external_id,row_action,outcome,outcome_detail,horse_id,processed_at
    FROM import_staging_rows WHERE batch_id=? ORDER BY id LIMIT 500
  `).bind(batchId).all();
  const conflicts = (rows.results ?? []).filter((row) => (row as Record<string, unknown>).outcome === "conflict");
  return json({
    batch,
    rows: rows.results ?? [],
    outstanding_conflicts: conflicts,
    operator_note: "Conflicts require reviewer decisions (merge/parentage/identifier adjudication) before re-apply; operator_minutes records the review effort per batch.",
  });
}

// ---------------------------------------------------------------------------
// R117-19 (Master AI R117 handoff, D31 / NEXT_BACKEND.md D31-B): reversible
// duplicate resolution. The merge/unmerge commands are versioned, bounded and
// receipt-guarded over the complete horse-reference inventory
// (src/registry/horseReferenceInventory.ts — the move set is derived from it).
//
// Command doctrine (mirrors import_row_reviews):
//  - merge preview (GET, read-only): enumerates EVERY affected reference with
//    its disposition, the permissions that govern it, blockers, warnings and
//    the manifest digest the operator approves.
//  - merge (POST, versioned): requires the fresh preview's digest; refuses
//    when the reference set changed (new reference after preview, changed FK
//    before commit, concurrent merge). One receipt per operation key; the
//    receipt, audit and reindex fan-out are gated inside the guarded
//    transaction — a losing or demoted writer claims nothing.
//  - unmerge (POST, versioned): the deterministic recovery. Verifies EVERY
//    manifest entry's CURRENT value before touching anything and replays
//    per-entry value-guarded restores; a later legitimate reassignment or an
//    identifier reallocation refuses the WHOLE reversal with an exact report
//    (never a blind manifest replay).
// ---------------------------------------------------------------------------

/** Bounded reversal: a pair (or the whole manifest) above these bounds is
 * refused honestly instead of attempting an unbounded guarded batch. */
const MAX_MANIFEST_PER_PAIR = 500;
const MAX_MANIFEST_TOTAL = 2000;
const PREVIEW_SAMPLE_ROW_IDS = 200;
const DRIFT_REPORT_LIMIT = 50;

interface ManifestEntry { table: string; row_id: number | string; column: string; from: number; to: number; role?: string }

interface MergeManifestBuild {
  entries: ManifestEntry[];
  perPair: Array<{ table: string; column: string; rowIds: Array<number | string>; count: number; overBound: boolean }>;
  archiveRowIds: Array<number | string>;
  archiveCount: number;
  archiveOverBound: boolean;
  withinBounds: boolean;
  digest: string | null;
}

/** In-transaction authority guard, embedded in EVERY mutating statement of the
 * merge/unmerge commands (the importRowLocks doctrine made per-statement): a
 * demoted or deactivated operator writes nothing at all — no FK move, no soft
 * delete, no alias — so no partial state can exist. */
const WRITER_GUARD_SQL = `EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES}))`;

/** The manifest legacy entry shape is preserved so pre-R117-19 merge records
 * replay under the guarded unmerge unchanged (from/to on FK entries; the
 * identifier archive entries carry column 'status' with from/to 0). Composite
 * -PK rows (horse_people) carry person_id in row_id plus their role — the
 * legacy code could never have produced such entries (its manifest build
 * crashed on the missing id column), so no ambiguity exists. */
async function buildMergeManifest(db: D1Database, keptHorseId: number, mergedHorseId: number): Promise<MergeManifestBuild> {
  const perPair: MergeManifestBuild["perPair"] = [];
  const entries: ManifestEntry[] = [];
  let total = 0;
  for (const pair of MERGE_MOVE_PAIRS) {
    if (pair.key === "person_id+role") {
      // horse_people has NO id column (composite PK horse_id+person_id+role);
      // the manifest row_id carries person_id and the entry carries the role.
      const rows = await db.prepare(`SELECT person_id, role FROM ${pair.table} WHERE ${pair.column}=? ORDER BY person_id, role LIMIT ${MAX_MANIFEST_PER_PAIR + 1}`)
        .bind(mergedHorseId).all<{ person_id: number; role: string }>();
      const found = (rows.results ?? []).map((row) => ({ personId: Number(row.person_id), role: String(row.role) }));
      const overBound = found.length > MAX_MANIFEST_PER_PAIR;
      const listed = overBound ? found.slice(0, MAX_MANIFEST_PER_PAIR) : found;
      perPair.push({ table: pair.table, column: pair.column, rowIds: listed.map((row) => row.personId), count: found.length, overBound });
      if (!overBound) {
        for (const row of listed) entries.push({ table: pair.table, row_id: row.personId, column: pair.column, from: mergedHorseId, to: keptHorseId, role: row.role });
        total += found.length;
      }
      continue;
    }
    const rows = await db.prepare(`SELECT id FROM ${pair.table} WHERE ${pair.column}=? ORDER BY id LIMIT ${MAX_MANIFEST_PER_PAIR + 1}`)
      .bind(mergedHorseId).all<{ id: number | string }>();
    // Row ids keep their DATABASE type: horse_media/attestations have TEXT
    // primary keys — coercing them to Number() yields NaN and the guarded
    // replay would miss (a latent trap the real-database tests caught).
    const rowIds: Array<number | string> = (rows.results ?? []).map((row) => row.id);
    const overBound = rowIds.length > MAX_MANIFEST_PER_PAIR;
    perPair.push({ table: pair.table, column: pair.column, rowIds: overBound ? rowIds.slice(0, MAX_MANIFEST_PER_PAIR) : rowIds, count: rowIds.length, overBound });
    if (!overBound) {
      for (const rowId of rowIds) entries.push({ table: pair.table, row_id: rowId, column: pair.column, from: mergedHorseId, to: keptHorseId });
      total += rowIds.length;
    }
  }
  const identifierRows = await db.prepare(`SELECT id FROM horse_identifiers WHERE horse_id=? AND status='live' ORDER BY id LIMIT ${MAX_MANIFEST_PER_PAIR + 1}`)
    .bind(mergedHorseId).all<{ id: number | string }>();
  const archiveRowIds: Array<number | string> = (identifierRows.results ?? []).map((row) => row.id);
  const archiveOverBound = archiveRowIds.length > MAX_MANIFEST_PER_PAIR;
  const archiveCount = archiveRowIds.length;
  if (!archiveOverBound) {
    for (const rowId of archiveRowIds) entries.push({ table: "horse_identifiers", row_id: rowId, column: "status", from: 0, to: 0 });
    total += archiveRowIds.length;
  }
  const withinBounds = !archiveOverBound && !perPair.some((pair) => pair.overBound) && total <= MAX_MANIFEST_TOTAL;
  let digest: string | null = null;
  if (withinBounds) {
    const rowKey = (entry: ManifestEntry) => typeof entry.row_id === "number" ? `n${entry.row_id}` : `s${entry.row_id}`;
    const sorted = [...entries].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : a.column < b.column ? -1 : a.column > b.column ? 1 : rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : (a.role ?? "").localeCompare(b.role ?? "")));
    digest = await sha256HexLocal(canonicalJsonLocal({
      inventory_version: HORSE_REFERENCE_INVENTORY_VERSION,
      kept_horse_id: keptHorseId,
      merged_horse_id: mergedHorseId,
      entries: sorted.map((entry) => [entry.table, entry.column, entry.row_id, entry.from, entry.to, entry.role ?? null]),
    }));
  }
  return { entries, perPair, archiveRowIds: archiveOverBound ? archiveRowIds.slice(0, MAX_MANIFEST_PER_PAIR) : archiveRowIds, archiveCount, archiveOverBound, withinBounds, digest };
}

/** Replay-or-refuse for a merge/unmerge operation key. The receipt's identity
 * is (actor, command, request digest) — an exact retry replays, a reused key
 * with different content refuses before any write. */
async function resolveMergeOperationKey(db: D1Database, scope: { operationId: string; actorId: string; command: "merge" | "unmerge"; requestDigest: string }): Promise<{ replayed: true; statusCode: number; body: Record<string, unknown> } | null> {
  const stored = await db.prepare("SELECT command,actor_user_id,request_digest,receipt_json FROM merge_command_receipts WHERE operation_id=?").bind(scope.operationId)
    .first<{ command: string; actor_user_id: string; request_digest: string; receipt_json: string }>();
  if (!stored) return null;
  const matches = stored.actor_user_id === scope.actorId && stored.command === scope.command && stored.request_digest === scope.requestDigest;
  if (!matches) throw new HttpError(409, "idempotency_conflict", "This operation_id was already used for a different merge command");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(stored.receipt_json) as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "idempotency_receipt_corrupt", "The stored merge command receipt could not be decoded");
  }
  return { replayed: true, statusCode: 200, body: { ...body, replayed: true } };
}

function isMergeReceiptConflict(cause: unknown): boolean {
  const error = cause as { message?: string; constraint?: string; cause?: { message?: string } } | null;
  const message = [error?.message, error?.constraint, error?.cause?.message].filter(Boolean).join(" ");
  return /merge_command_receipts|horse_merges\.(unmerge_)?operation_id/i.test(message) && /UNIQUE constraint failed|duplicate key|PRIMARY KEY/i.test(message);
}

/** Count references to the merged horse for one inventory entry (exact counts
 * for the preview's policy walk; the manifest itself stays bounded). */
async function countInventoryReferences(db: D1Database, entry: HorseReferenceEntry, mergedHorseId: number): Promise<number> {
  if (entry.table === "audit_events") {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='horse' AND entity_id=?").bind(String(mergedHorseId)).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
  if (entry.table === "registry_rule_outcomes" || entry.table === "registry_policy_receipts") {
    // These historical fields also contain mutation, submission and import
    // references. Only horse_update resolves its subject_ref as a horse ID.
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${entry.table} WHERE subject_type='horse_update' AND subject_ref=?`)
      .bind(String(mergedHorseId)).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${entry.column}=?`).bind(mergedHorseId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * The read-only merge DRY RUN: enumerates every affected reference with its
 * disposition from the horse-reference inventory, the permissions that govern
 * the command, blockers, companion-operation warnings and the manifest digest
 * the operator must approve. Nothing canonical is written here.
 */
export async function adminMergePreview(request: Request, env: Env, keptHorseId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const url = new URL(request.url);
  const mergedId = Number(url.searchParams.get("merge_horse_id"));
  if (!Number.isInteger(mergedId) || mergedId < 1) throw new HttpError(400, "invalid_merge_preview", "merge_horse_id query parameter is required and must be a positive integer");
  if (mergedId === keptHorseId) throw new HttpError(400, "invalid_merge_preview", "A horse cannot be merged with itself");

  const [kept, merged] = await Promise.all([
    env.DB.prepare("SELECT id,name_latin,register_no,microchip_no,deleted_at FROM horses WHERE id=?").bind(keptHorseId)
      .first<{ id: number; name_latin: string; register_no: string | null; microchip_no: string | null; deleted_at: string | null }>(),
    env.DB.prepare("SELECT id,name_latin,register_no,microchip_no,deleted_at FROM horses WHERE id=?").bind(mergedId)
      .first<{ id: number; name_latin: string; register_no: string | null; microchip_no: string | null; deleted_at: string | null }>(),
  ]);
  const blockers: Array<{ code: string; message: string }> = [];
  if (!kept) blockers.push({ code: "kept_not_found", message: `Kept horse ${keptHorseId} does not exist` });
  else if (kept.deleted_at) blockers.push({ code: "kept_unavailable", message: `Kept horse ${keptHorseId} is archived or already merged away` });
  if (!merged) blockers.push({ code: "merged_not_found", message: `Merged horse ${mergedId} does not exist` });
  else if (merged.deleted_at) blockers.push({ code: "merged_unavailable", message: `Merged horse ${mergedId} is archived or already merged away` });
  const alias = await env.DB.prepare("SELECT kept_horse_id FROM horse_redirect_aliases WHERE alias_horse_id=?").bind(mergedId).first<{ kept_horse_id: number }>();
  const careGuard = protectedIdentityMergeGuard([keptHorseId, mergedId]);
  if (!await env.DB.prepare(`SELECT 1 AS ok WHERE ${careGuard.sql}`).bind(...careGuard.bindings).first()) {
    blockers.push({ code: "protected_identity_reconciliation_required", message: "A protected evidence relationship requires separate authorized identity reconciliation before merging" });
  }
  if (alias) blockers.push({ code: "already_merged", message: `Horse ${mergedId} is already merged into horse ${alias.kept_horse_id}` });

  // The bounded manifest + digest (null when out of bounds — the command
  // refuses such merges, so the preview never offers a digest for them).
  const manifest = await buildMergeManifest(env.DB, keptHorseId, mergedId);

  // The full policy walk: EVERY inventory entry with its live reference count
  // on the merged horse. This is the dry-run enumeration the R117-19
  // acceptance requires — including the references merge deliberately leaves
  // alone (stays, companion operations, immutable history, derived data).
  const policy: Array<Record<string, unknown>> = [];
  for (const entry of HORSE_REFERENCE_INVENTORY) {
    const count = blockers.length ? 0 : await countInventoryReferences(env.DB, entry, mergedId);
    const pair = manifest.perPair.find((candidate) => candidate.table === entry.table && candidate.column === entry.column);
    policy.push({
      table: entry.table, column: entry.column, kind: entry.kind,
      disposition: entry.disposition, references_on_merged_horse: count,
      ...(entry.disposition === "moves" && pair ? { manifest_row_ids: pair.rowIds.slice(0, PREVIEW_SAMPLE_ROW_IDS), manifest_count: pair.count, over_bound: pair.overBound } : {}),
      ...(entry.disposition === "archives" ? { manifest_row_ids: manifest.archiveRowIds.slice(0, PREVIEW_SAMPLE_ROW_IDS), manifest_count: manifest.archiveCount, over_bound: manifest.archiveOverBound } : {}),
      note: entry.note,
    });
  }

  // Chained-merge visibility: horses merged INTO the merged horse earlier and
  // merges already resolved into the kept horse.
  const mergedIntoMerged = alias ? 0 : Number(await env.DB.prepare("SELECT COUNT(*) AS n FROM horse_redirect_aliases WHERE kept_horse_id=?").bind(mergedId).first<{ n: number }>("n") ?? 0);
  const mergedIntoKept = Number(await env.DB.prepare("SELECT COUNT(*) AS n FROM horse_redirect_aliases WHERE kept_horse_id=?").bind(keptHorseId).first<{ n: number }>("n") ?? 0);
  const warnings: Array<{ code: string; message: string }> = [];
  if (mergedIntoMerged > 0) warnings.push({ code: "chained_merge", message: `${mergedIntoMerged} earlier merge(s) resolved INTO horse ${mergedId}; unmerging them later requires this merge to be unmerged first (the guarded unmerge refuses out-of-order reversal)` });
  if (mergedIntoKept > 0) warnings.push({ code: "kept_has_history", message: `${mergedIntoKept} earlier merge(s) already resolved into kept horse ${keptHorseId}` });
  const companionCounts = policy.filter((row) => row.disposition === "requires_companion_operation" && Number(row.references_on_merged_horse) > 0);
  if (companionCounts.length > 0) {
    warnings.push({ code: "companion_operations_required", message: `Workspace references on the merged horse need reviewed companion operations (they stay with their original subject): ${companionCounts.map((row) => `${row.table}.${row.column}=${row.references_on_merged_horse}`).join(", ")}` });
  }

  return json({
    dry_run: true,
    operator: { user_id: auth.user.id, role: auth.user.role, capability: "horse.edit", authorized: true },
    command_permission: "horse.edit",
    kept, merged,
    blockers,
    inventory_version: HORSE_REFERENCE_INVENTORY_VERSION,
    policy,
    manifest_digest: manifest.digest,
    manifest_summary: {
      moves: manifest.perPair.reduce((sum, pair) => sum + pair.count, 0),
      archives: manifest.archiveCount,
      per_pair: manifest.perPair.map((pair) => ({ table: pair.table, column: pair.column, count: pair.count, over_bound: pair.overBound })),
    },
    bounds: { max_per_pair: MAX_MANIFEST_PER_PAIR, max_total: MAX_MANIFEST_TOTAL, within_bounds: manifest.withinBounds },
    warnings,
    note: "Read-only merge preview: every affected reference is enumerated with its disposition from the horse-reference inventory. Approve manifest_digest through the versioned merge command; the commit refuses if the reference set changes in between. Nothing canonical is written here.",
  });
}

export async function adminMergeHorses(request: Request, env: Env, keptHorseId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = MergeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_merge", "Merge failed validation (the versioned command requires operation_id and the expected_manifest_digest from a fresh preview)", parsed.error.flatten());
  const mergedId = parsed.data.merge_horse_id;
  if (mergedId === keptHorseId) throw new HttpError(400, "invalid_merge", "A horse cannot be merged with itself");
  const requestDigest = await sha256HexLocal(canonicalJsonLocal({ keptHorseId, mergedId, reason: parsed.data.reason }));
  const replay = await resolveMergeOperationKey(env.DB, { operationId: parsed.data.operation_id, actorId: auth.user.id, command: "merge", requestDigest });
  if (replay) return json(replay.body, { status: replay.statusCode });

  const [kept, merged] = await Promise.all([
    env.DB.prepare("SELECT id,name_latin FROM horses WHERE id=? AND deleted_at IS NULL").bind(keptHorseId).first(),
    env.DB.prepare("SELECT id,name_latin FROM horses WHERE id=? AND deleted_at IS NULL").bind(mergedId).first(),
  ]);
  if (!kept || !merged) throw new HttpError(404, "not_found", "Both horses must exist and be live");
  const careGuard = protectedIdentityMergeGuard([keptHorseId, mergedId]);
  if (!await env.DB.prepare(`SELECT 1 AS ok WHERE ${careGuard.sql}`).bind(...careGuard.bindings).first()) {
    throw new HttpError(409, "protected_identity_reconciliation_required", "Protected evidence requires authorized identity reconciliation before merging");
  }
  const alias = await env.DB.prepare("SELECT kept_horse_id FROM horse_redirect_aliases WHERE alias_horse_id=?").bind(mergedId).first();
  if (alias) throw new HttpError(409, "already_merged", `Horse ${mergedId} is already merged into horse ${alias.kept_horse_id}`);

  // Fresh manifest: the operator's approved digest must match EXACTLY. A new
  // reference inserted after the preview, a changed FK before commit or a
  // concurrent merge sharing a horse all change the digest and refuse here.
  const manifest = await buildMergeManifest(env.DB, keptHorseId, mergedId);
  if (!manifest.withinBounds) {
    const offenders = [
      ...manifest.perPair.filter((pair) => pair.overBound).map((pair) => `${pair.table}.${pair.column}=${pair.count}`),
      ...(manifest.archiveOverBound ? [`horse_identifiers(live)=${manifest.archiveCount}`] : []),
    ].join(", ");
    throw new HttpError(409, "merge_too_large", `This merge exceeds the bounded reversal limits (${MAX_MANIFEST_PER_PAIR} per reference pair, ${MAX_MANIFEST_TOTAL} total): ${offenders}. Investigate the reference set and split or reduce the work; an unbounded merge cannot be reversed by the guarded unmerge.`);
  }
  if (manifest.digest !== parsed.data.expected_manifest_digest) {
    throw new HttpError(409, "merge_state_changed", "The reference set changed since the approved preview (a reference was added, removed or reassigned). Re-run the merge preview and approve its fresh manifest_digest.", {
      approved_digest: parsed.data.expected_manifest_digest,
      current_digest: manifest.digest,
      current_manifest_summary: manifest.perPair.map((pair) => ({ table: pair.table, column: pair.column, count: pair.count })).concat([{ table: "horse_identifiers", column: "status", count: manifest.archiveCount }]),
    });
  }

  // The guarded transaction (R122/T01 atomic protocol). The batch acquires the
  // graph-wide advisory lock, applies the value-guarded moves, archive and
  // alias writes, and then ASSERTS every final invariant by inserting into
  // merge_invariant_assertions — whose named CHECK constraint turns any failed
  // invariant into a constraint violation INSIDE the batch, rolling the ENTIRE
  // command back on every provider (D1 batch, SQLite BEGIN/COMMIT, PostgreSQL
  // transaction are all atomic). The previous design gated integrity on a
  // conditional final receipt INSERT: when its WHERE failed, the moves, the
  // archive and the alias had already committed and could not be undone
  // (Master AI R122-A01). The assertion also validates the RESULTING graph —
  // the kept horse's post-move ancestry closure must not contain the kept
  // horse, which makes an ancestor-into-descendant merge (self-parent, R122-A02)
  // impossible to commit — and the canonical revision and active-horse counter
  // now settle in the SAME transaction, exactly once (R122-A03).
  // The receipt, audit and reindex fan-out are gated on the merge record, so a
  // losing or demoted writer claims nothing.
  const statements: D1PreparedStatement[] = [pedigreeGraphLockStatement(env.DB), importWriterLock(env.DB, auth.user.id)];
  for (const id of [keptHorseId, mergedId].sort((a,b) => a-b)) statements.push(env.DB.prepare("UPDATE horses SET row_version=row_version WHERE id=?").bind(id));
  for (const entry of manifest.entries) {
    if (entry.table === "horse_identifiers") {
      statements.push(env.DB.prepare(`UPDATE horse_identifiers SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=? AND horse_id=? AND status='live' AND ${WRITER_GUARD_SQL}`).bind(entry.row_id, mergedId, auth.user.id));
    } else if (entry.role != null) {
      // Composite-PK row (horse_people): person_id rides in row_id, role here.
      statements.push(env.DB.prepare(`UPDATE ${entry.table} SET ${entry.column}=? WHERE person_id=? AND role=? AND ${entry.column}=? AND ${WRITER_GUARD_SQL}`).bind(keptHorseId, entry.row_id, entry.role, mergedId, auth.user.id));
    } else {
      statements.push(env.DB.prepare(`UPDATE ${entry.table} SET ${entry.column}=? WHERE id=? AND ${entry.column}=? AND ${WRITER_GUARD_SQL}`).bind(keptHorseId, entry.row_id, mergedId, auth.user.id));
    }
  }
  statements.push(
    env.DB.prepare(`UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL AND ${WRITER_GUARD_SQL}`).bind(mergedId, auth.user.id),
    env.DB.prepare(`INSERT INTO horse_redirect_aliases(alias_horse_id,kept_horse_id) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM horse_redirect_aliases WHERE alias_horse_id=?) AND ${WRITER_GUARD_SQL}`).bind(mergedId, keptHorseId, mergedId, auth.user.id),
  );
  // Airtight in-transaction verification — EXACT expected state, not just
  // "no row still references the merged horse": per pair, every manifest row
  // must STILL EXIST and now hold the KEPT horse id (a row deleted or changed
  // between the digest check and the locked batch — the R122-A01
  // reproduction — breaks the count and refuses the whole command), AND no
  // row anywhere may reference the merged horse (a late reference). The
  // ancestry cycle guard makes the resulting graph acyclic by construction:
  // every edge the merge writes points at the kept horse, so any newly
  // possible cycle passes through it.
  const invariantPredicates: string[] = [
    `EXISTS(SELECT 1 FROM horses kh WHERE kh.id=? AND kh.deleted_at IS NULL)`,
    `EXISTS(SELECT 1 FROM horses mh WHERE mh.id=? AND mh.deleted_at IS NOT NULL)`,
    `EXISTS(SELECT 1 FROM horse_redirect_aliases ra WHERE ra.alias_horse_id=? AND ra.kept_horse_id=?)`,
  ];
  const invariantBinds: unknown[] = [auth.user.id, keptHorseId, mergedId, mergedId, keptHorseId];
  const manifestRowsMoved: string[] = [];
  const gateBinds: unknown[] = [];
  for (const pair of manifest.perPair.filter((candidate) => candidate.rowIds.length > 0)) {
    if (pair.table === "horse_people") {
      for (const entry of manifest.entries.filter((candidate) => candidate.table === pair.table && candidate.role != null)) {
        manifestRowsMoved.push(`EXISTS(SELECT 1 FROM horse_people WHERE person_id=? AND role=? AND horse_id=${keptHorseId})`);
        gateBinds.push(entry.row_id, entry.role);
      }
    } else {
      // EXACT: every manifest row of this pair exists and moved to the kept horse.
      manifestRowsMoved.push(`(SELECT COUNT(*) FROM ${pair.table} WHERE id IN (${pair.rowIds.map(() => "?").join(",")}) AND ${pair.column}=?) = ${pair.rowIds.length}`);
      gateBinds.push(...pair.rowIds, keptHorseId);
    }
  }
  const noRemainingReferences = MERGE_MOVE_PAIRS
    .map((pair) => `NOT EXISTS(SELECT 1 FROM ${pair.table} WHERE ${pair.column}=${mergedId})`)
    .concat(["NOT EXISTS(SELECT 1 FROM horse_identifiers WHERE horse_id=" + mergedId + " AND status='live')"]);
  invariantPredicates.push(...manifestRowsMoved, ...noRemainingReferences, MERGE_ANCESTRY_CYCLE_GUARD_SQL);
  invariantBinds.push(...gateBinds, keptHorseId, keptHorseId);
  invariantPredicates.push(careGuard.sql);
  invariantBinds.push(...careGuard.bindings);
  statements.push(mergeInvariantAssertionStatement(env.DB, {
    command: "merge", operationId: parsed.data.operation_id, keptHorseId, mergedHorseId: mergedId,
    authoritySql: `SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`,
  }, invariantPredicates, invariantBinds));
  // Post-assertion: the merge record itself (plain insert — every guard was
  // just proven true inside this transaction under the graph lock).
  statements.push(
    env.DB.prepare(`
      INSERT INTO horse_merges(kept_horse_id,merged_horse_id,moved_manifest,reason,merged_by_user_id,manifest_digest,policy_version,operation_id,merged_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).bind(keptHorseId, mergedId, JSON.stringify(manifest.entries), parsed.data.reason, auth.user.id, manifest.digest, HORSE_REFERENCE_INVENTORY_VERSION, parsed.data.operation_id),
  );
  const receiptJson = JSON.stringify({
    merged: true, kept_horse_id: keptHorseId, merged_horse_id: mergedId,
    moved_references: manifest.entries.length, reason: parsed.data.reason,
    manifest_digest: manifest.digest, policy_version: HORSE_REFERENCE_INVENTORY_VERSION,
    note: "Every moved reference is recorded in the manifest with its exact row id; the guarded unmerge verifies each entry's current value before restoring it. References that stay with the merged subject are enumerated in the approved preview.",
  });
  if (receiptJson.length > 8000) throw new HttpError(400, "invalid_merge", "The merge receipt would overflow its bound");
  statements.push(
    env.DB.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?, 'horse.merged', 'horse', CAST(merged_horse_id AS TEXT), 'null', ?, CURRENT_TIMESTAMP
      FROM horse_merges WHERE operation_id=? AND unmerged_at IS NULL
    `).bind(auth.user.id, JSON.stringify({ kept_horse_id: keptHorseId, reason: parsed.data.reason, moved_references: manifest.entries.length, manifest_digest: manifest.digest, operation_id: parsed.data.operation_id }), parsed.data.operation_id),
    env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT kept_horse_id,'merge' FROM horse_merges WHERE operation_id=? AND unmerged_at IS NULL").bind(parsed.data.operation_id),
    env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT merged_horse_id,'merge' FROM horse_merges WHERE operation_id=? AND unmerged_at IS NULL").bind(parsed.data.operation_id),
  );
  for (const entry of manifest.entries) {
    if (entry.table === "horses") {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT ?, 'merge_parent_change' FROM horse_merges WHERE operation_id=? AND unmerged_at IS NULL").bind(entry.row_id, parsed.data.operation_id));
    }
  }
  statements.push(
    env.DB.prepare(`
      INSERT INTO merge_command_receipts(operation_id,command,merge_id,actor_user_id,request_digest,receipt_json)
      SELECT ?, 'merge', m.id, ?, ?, ? FROM horse_merges m WHERE m.operation_id=? AND m.unmerged_at IS NULL
    `).bind(parsed.data.operation_id, auth.user.id, requestDigest, receiptJson, parsed.data.operation_id),
    // R122-A03: the canonical revision and the active-horse counter settle in
    // the SAME transaction, CAS-conditioned on OUR merge record so they commit
    // exactly once (the pre-R122 merge never advanced either).
    env.DB.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horse_merges WHERE operation_id=? AND unmerged_at IS NULL)").bind(parsed.data.operation_id),
    env.DB.prepare("UPDATE registry_runtime_counters SET active_horse_count=CASE WHEN active_horse_count>0 THEN active_horse_count-1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM horse_merges m JOIN horses mh ON mh.id=m.merged_horse_id WHERE m.operation_id=? AND m.unmerged_at IS NULL AND mh.deleted_at IS NOT NULL)").bind(parsed.data.operation_id),
    env.DB.prepare("SELECT * FROM horse_merges WHERE operation_id=?").bind(parsed.data.operation_id),
  );

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (cause) {
    if (isMergeInvariantViolation(cause)) {
      // The ENTIRE command rolled back — nothing was moved, archived or
      // aliased. Classify honestly against the current committed state.
      const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`).bind(auth.user.id).first();
      if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has merge authority");
      if (!await env.DB.prepare(`SELECT 1 AS ok WHERE ${careGuard.sql}`).bind(...careGuard.bindings).first()) throw new HttpError(409, "protected_identity_reconciliation_required", "A protected relationship changed during the merge; nothing was committed");
      const aliasNow = await env.DB.prepare("SELECT kept_horse_id FROM horse_redirect_aliases WHERE alias_horse_id=?").bind(mergedId).first<{ kept_horse_id: number }>();
      if (aliasNow && Number(aliasNow.kept_horse_id) !== keptHorseId) throw new HttpError(409, "already_merged", `Horse ${mergedId} is already merged into horse ${aliasNow.kept_horse_id}`);
      const existingCycle = await env.DB.prepare(ANCESTRY_CYCLE_PROBE_SQL).bind(keptHorseId, keptHorseId, keptHorseId).first()
        ?? await env.DB.prepare(ANCESTRY_CYCLE_PROBE_SQL).bind(mergedId, mergedId, mergedId).first();
      if (existingCycle) {
        throw new HttpError(409, "merge_graph_unsafe", `The current pedigree graph already contains a cycle through horse ${keptHorseId} or horse ${mergedId}; the merge refused and nothing was written. Report the pre-existing cycle to the registry operator.`);
      }
      const ancestorCollapse = await env.DB.prepare(ANCESTOR_OF_PROBE_SQL).bind(keptHorseId, keptHorseId, mergedId).first();
      if (ancestorCollapse) {
        throw new HttpError(409, "merge_graph_unsafe", `Horse ${mergedId} is an ancestor of horse ${keptHorseId}; merging an ancestor into its own descendant would make the pedigree graph cyclic (a horse cannot become its own ancestor). Nothing was written.`);
      }
      throw new HttpError(409, "merge_state_changed", "The reference set changed between the digest check and the commit (a late reference appeared or a concurrent writer won). The merge refused atomically: no moves, no archive, no alias, no receipt. Re-run the merge preview and approve its fresh manifest_digest.");
    }
    if (isGraphLockTimeoutError(cause)) {
      throw new HttpError(409, "merge_busy", "Another pedigree change is being saved right now. Nothing was written — reload and retry the merge in a moment.");
    }
    if (isMergeReceiptConflict(cause)) {
      const replayed = await resolveMergeOperationKey(env.DB, { operationId: parsed.data.operation_id, actorId: auth.user.id, command: "merge", requestDigest });
      if (replayed) return json(replayed.body, { status: replayed.statusCode });
    }
    throw cause;
  }
  const mergeRow = (results[results.length - 1]?.results ?? [])[0] as Record<string, unknown> | undefined;
  if (!mergeRow) {
    // The guarded transition lost: classify honestly against current state.
    const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`).bind(auth.user.id).first();
    if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has merge authority");
    const aliasNow = await env.DB.prepare("SELECT kept_horse_id FROM horse_redirect_aliases WHERE alias_horse_id=?").bind(mergedId).first<{ kept_horse_id: number }>();
    if (aliasNow && Number(aliasNow.kept_horse_id) !== keptHorseId) throw new HttpError(409, "already_merged", `Horse ${mergedId} is already merged into horse ${aliasNow.kept_horse_id}`);
    const [keptNow, mergedNow] = await Promise.all([
      env.DB.prepare("SELECT id,deleted_at FROM horses WHERE id=?").bind(keptHorseId).first<{ id: number; deleted_at: string | null }>(),
      env.DB.prepare("SELECT id,deleted_at FROM horses WHERE id=?").bind(mergedId).first<{ id: number; deleted_at: string | null }>(),
    ]);
    if (!keptNow || !mergedNow) throw new HttpError(404, "not_found", "One of the horses no longer exists");
    if (mergedNow.deleted_at && (!aliasNow || Number(aliasNow.kept_horse_id) === keptHorseId)) {
      throw new HttpError(409, "merge_state_changed", "The reference set changed between the digest check and the commit. Re-run the merge preview and approve its fresh manifest_digest.");
    }
    throw new HttpError(503, "merge_unconfirmed", "The merge outcome could not be confirmed. Re-read both horses before retrying; the durable command receipt prevents duplicate application.");
  }
  return json({
    merged: true,
    replayed: false,
    kept_horse_id: keptHorseId,
    merged_horse_id: mergedId,
    moved_references: manifest.entries.length,
    manifest_digest: manifest.digest,
    policy_version: HORSE_REFERENCE_INVENTORY_VERSION,
    operation_id: parsed.data.operation_id,
    merge: mergeRow,
    note: "Every moved reference is recorded in the manifest; the guarded unmerge verifies each entry's current value before restoring it (a later legitimate reassignment refuses the reversal with an exact report). Source assertions, listings, offspring links and audit history are preserved (moved, never deleted).",
  }, { status: 201 });
}

interface MergeRecord {
  id: number; kept_horse_id: number; merged_horse_id: number; moved_manifest: string;
  reason: string; unmerged_at: string | null; unmerge_operation_id: string | null; manifest_digest: string | null;
}

export async function adminUnmergeHorses(request: Request, env: Env, mergeId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = UnmergeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_unmerge", "Unmerge failed validation (the versioned recovery requires operation_id and a reason)", parsed.error.flatten());
  const operationId = parsed.data.operation_id;

  const merge = await env.DB.prepare("SELECT id,kept_horse_id,merged_horse_id,moved_manifest,reason,unmerged_at,unmerge_operation_id,manifest_digest FROM horse_merges WHERE id=?").bind(mergeId)
    .first<MergeRecord>();
  if (!merge) throw new HttpError(404, "not_found", "Merge record not found");
  if (merge.unmerged_at) {
    // An exact same-key retry replays the stored receipt (the transition is
    // already durable); anything else is an honest double-unmerge refusal.
    const requestDigest = await sha256HexLocal(canonicalJsonLocal({ mergeId, reason: parsed.data.reason }));
    const priorReplay = await resolveMergeOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "unmerge", requestDigest });
    if (priorReplay) return json(priorReplay.body, { status: priorReplay.statusCode });
    throw new HttpError(409, "already_unmerged", "This merge has already been unmerged");
  }
  const requestDigest = await sha256HexLocal(canonicalJsonLocal({ mergeId, reason: parsed.data.reason }));
  const replay = await resolveMergeOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "unmerge", requestDigest });
  if (replay) return json(replay.body, { status: replay.statusCode });

  const manifest = JSON.parse(merge.moved_manifest) as ManifestEntry[];
  const keptId = Number(merge.kept_horse_id);
  const mergedId = Number(merge.merged_horse_id);
  const careGuard = protectedIdentityMergeGuard([keptId, mergedId]);
  if (!await env.DB.prepare(`SELECT 1 AS ok WHERE ${careGuard.sql}`).bind(...careGuard.bindings).first()) {
    throw new HttpError(409, "protected_identity_reconciliation_required", "Protected evidence requires authorized identity reconciliation before reversing this merge");
  }

  // ---- deterministic preflight: verify EVERY entry's current value --------
  // A blind manifest replay is the documented D31-B barrier: it would
  // overwrite later legitimate reassignments. Every entry is verified against
  // the exact value the merge wrote; any drift refuses the WHOLE reversal
  // with an exact report (supported cases stay reversible, unsupported ones
  // are explicit).
  const fkDrift: Array<{ table: string; row_id: number | string; column: string; expected: number; actual: string }> = [];
  const identifierDrift: Array<{ row_id: number | string; expected: string; actual: string }> = [];
  for (const entry of manifest) {
    if (entry.table === "horse_identifiers") {
      const row = await env.DB.prepare("SELECT horse_id,status FROM horse_identifiers WHERE id=?").bind(entry.row_id)
        .first<{ horse_id: number; status: string }>();
      if (!row || Number(row.horse_id) !== mergedId || row.status !== "archived") {
        identifierDrift.push({ row_id: entry.row_id, expected: `archived on horse ${mergedId}`, actual: row ? `horse_id=${row.horse_id}, status=${row.status}` : "row_missing" });
      }
    } else if (entry.role != null) {
      // Composite-PK row (horse_people): person_id + role identify the row.
      const row = await env.DB.prepare(`SELECT ${entry.column} AS value FROM ${entry.table} WHERE person_id=? AND role=?`).bind(entry.row_id, entry.role).first<{ value: number | null }>();
      const current = row ? (row.value === null ? null : Number(row.value)) : undefined;
      if (current !== Number(entry.to)) {
        fkDrift.push({ table: entry.table, row_id: entry.row_id, column: entry.column, expected: Number(entry.to), actual: current === undefined ? "row_missing" : String(current) });
      }
    } else {
      const row = await env.DB.prepare(`SELECT ${entry.column} AS value FROM ${entry.table} WHERE id=?`).bind(entry.row_id).first<{ value: number | null }>();
      const current = row ? (row.value === null ? null : Number(row.value)) : undefined;
      if (current !== Number(entry.to)) {
        fkDrift.push({ table: entry.table, row_id: entry.row_id, column: entry.column, expected: Number(entry.to), actual: current === undefined ? "row_missing" : String(current) });
      }
    }
  }
  const [keptNow, mergedNow] = await Promise.all([
    env.DB.prepare("SELECT deleted_at FROM horses WHERE id=?").bind(keptId).first<{ deleted_at: string | null }>(),
    env.DB.prepare("SELECT deleted_at FROM horses WHERE id=?").bind(mergedId).first<{ deleted_at: string | null }>(),
  ]);
  if (identifierDrift.length > 0) {
    throw new HttpError(409, "identifier_reallocated", "One or more archived identifiers were reallocated (re-pointed or re-activated) after the merge; the reversal refuses to overwrite them. Resolve the identifier adjudication first, then retry the unmerge.", { drifted_entries: identifierDrift.slice(0, DRIFT_REPORT_LIMIT), drifted_count: identifierDrift.length });
  }
  if (fkDrift.length > 0) {
    throw new HttpError(409, "unmerge_state_changed", "One or more manifest entries were legitimately reassigned after the merge; a blind manifest replay would overwrite those writes, so the reversal refuses. Resolve the drifted references first, then retry the unmerge.", { drifted_entries: fkDrift.slice(0, DRIFT_REPORT_LIMIT), drifted_count: fkDrift.length });
  }
  if (!keptNow || keptNow.deleted_at) throw new HttpError(409, "unmerge_state_changed", `Kept horse ${keptId} no longer exists or was itself merged away; unmerge this merge's successors first (out-of-order reversal is refused).`, { kept_deleted_at: keptNow?.deleted_at ?? "missing" });
  if (!mergedNow || !mergedNow.deleted_at) throw new HttpError(409, "unmerge_state_changed", `Merged horse ${mergedId} is not in the expected soft-deleted state`, { merged_deleted_at: mergedNow?.deleted_at ?? null });

  // ---- the guarded transaction (R122/T01 atomic protocol) ----------------
  // Per-entry value-guarded restores + a race-safe unmerged_at transition,
  // then the SAME transaction-aborting invariant assertion as the merge: the
  // CAS win, both horses' expected liveness, the cleared alias, every manifest
  // entry back at its exact pre-merge value AND the restored graph acyclic
  // (every restored edge points at the merged horse, so any newly possible
  // cycle passes through it). A failed invariant rolls the ENTIRE reversal
  // back — the pre-R122 design instead inserted the receipt conditionally, so
  // a late drift could commit the restores, the un-archive and the alias
  // deletion while the receipt silently inserted zero rows (R122-A03).
  // R120 / IMP-012: unmerge restores children parent links - same graph
  // mutation class as merge; same bounded graph-wide serialization.
  const statements: D1PreparedStatement[] = [pedigreeGraphLockStatement(env.DB), importWriterLock(env.DB, auth.user.id)];
  for (const id of [keptId, mergedId].sort((a,b) => a-b)) statements.push(env.DB.prepare("UPDATE horses SET row_version=row_version WHERE id=?").bind(id));
  for (const entry of manifest) {
    if (entry.table === "horse_identifiers") {
      statements.push(env.DB.prepare(`UPDATE horse_identifiers SET status='live',updated_at=CURRENT_TIMESTAMP WHERE id=? AND horse_id=? AND status='archived' AND ${WRITER_GUARD_SQL}`).bind(entry.row_id, mergedId, auth.user.id));
    } else if (entry.role != null) {
      statements.push(env.DB.prepare(`UPDATE ${entry.table} SET ${entry.column}=? WHERE person_id=? AND role=? AND ${entry.column}=? AND ${WRITER_GUARD_SQL}`).bind(entry.from, entry.row_id, entry.role, entry.to, auth.user.id));
    } else {
      statements.push(env.DB.prepare(`UPDATE ${entry.table} SET ${entry.column}=? WHERE id=? AND ${entry.column}=? AND ${WRITER_GUARD_SQL}`).bind(entry.from, entry.row_id, entry.to, auth.user.id));
    }
  }
  // EXACT expected restored state: every manifest row must STILL EXIST and
  // hold EXACTLY its pre-merge value (the merged horse) — not merely "not the
  // kept horse". A row reassigned to a THIRD horse between the preflight and
  // the batch (the audit's "reassigned references must refuse safely") breaks
  // the exact check and refuses the whole reversal, preserving the legitimate
  // reassignment instead of silently committing an incomplete restore.
  const restoredChecks: string[] = [];
  const restoredBinds: unknown[] = [];
  for (const entry of manifest) {
    if (entry.table === "horse_identifiers") continue;
    if (entry.role != null) {
      restoredChecks.push(`EXISTS(SELECT 1 FROM ${entry.table} WHERE person_id=? AND role=? AND ${entry.column}=?)`);
      restoredBinds.push(entry.row_id, entry.role, Number(mergedId));
    }
  }
  const idPairs = new Map<string, Array<number | string>>();
  for (const entry of manifest) {
    if (entry.table === "horse_identifiers" || entry.role != null) continue;
    const key = `${entry.table}.${entry.column}`;
    if (!idPairs.has(key)) idPairs.set(key, []);
    (idPairs.get(key) as Array<number | string>).push(entry.row_id);
  }
  for (const [key, ids] of idPairs) {
    const [table, column] = key.split(".");
    // EXACT: every manifest row of this pair exists and is back at the merged horse.
    restoredChecks.push(`(SELECT COUNT(*) FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")}) AND ${column}=?) = ${ids.length}`);
    restoredBinds.push(...ids, Number(mergedId));
  }
  const identifierIds: Array<number | string> = manifest.filter((entry) => entry.table === "horse_identifiers").map((entry) => entry.row_id);
  if (identifierIds.length > 0) {
    // EXACT: every archived identifier exists, is live again and still on the merged horse.
    restoredChecks.push(`(SELECT COUNT(*) FROM horse_identifiers WHERE id IN (${identifierIds.map(() => "?").join(",")}) AND status='live' AND horse_id=?) = ${identifierIds.length}`);
    restoredBinds.push(...identifierIds, Number(mergedId));
  }
  statements.push(
    env.DB.prepare(`UPDATE horses SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL AND ${WRITER_GUARD_SQL}`).bind(mergedId, auth.user.id),
    env.DB.prepare(`DELETE FROM horse_redirect_aliases WHERE alias_horse_id=? AND kept_horse_id=? AND ${WRITER_GUARD_SQL}`).bind(mergedId, keptId, auth.user.id),
    env.DB.prepare(`UPDATE horse_merges SET unmerged_at=CURRENT_TIMESTAMP, unmerged_by_user_id=?, unmerge_operation_id=? WHERE id=? AND unmerged_at IS NULL AND ${WRITER_GUARD_SQL}`)
      .bind(auth.user.id, operationId, mergeId, auth.user.id),
  );
  // The transaction-aborting invariant assertion: everything the preflight
  // verified is re-proven HERE, inside the locked transaction, against the
  // state the restores just produced.
  statements.push(mergeInvariantAssertionStatement(env.DB, {
    command: "unmerge", operationId, keptHorseId: keptId, mergedHorseId: mergedId,
    authoritySql: `SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`,
  }, [
    `EXISTS(SELECT 1 FROM horse_merges m WHERE m.id=? AND m.unmerged_at IS NOT NULL AND m.unmerge_operation_id=?)`,
    `EXISTS(SELECT 1 FROM horses kh WHERE kh.id=? AND kh.deleted_at IS NULL)`,
    `EXISTS(SELECT 1 FROM horses mh WHERE mh.id=? AND mh.deleted_at IS NULL)`,
    `NOT EXISTS(SELECT 1 FROM horse_redirect_aliases WHERE alias_horse_id=? AND kept_horse_id=?)`,
    ...restoredChecks,
    MERGE_ANCESTRY_CYCLE_GUARD_SQL, careGuard.sql,
  ], [auth.user.id, mergeId, operationId, keptId, mergedId, mergedId, keptId, ...restoredBinds, mergedId, mergedId, ...careGuard.bindings]));
  const receiptJson = JSON.stringify({
    unmerged: true, merge_id: mergeId, kept_horse_id: keptId, merged_horse_id: mergedId,
    restored_references: manifest.length, reason: parsed.data.reason,
    note: "Every manifest entry was verified against the exact value the merge wrote and restored value-guarded; drift anywhere refuses the whole reversal.",
  });
  statements.push(
    // Post-assertion: every previous WHERE guard was just proven true inside
    // this transaction; the receipt keeps only its own CAS identity, and the
    // UNIQUE(operation_id) constraint still enforces idempotency.
    env.DB.prepare(`
      INSERT INTO merge_command_receipts(operation_id,command,merge_id,actor_user_id,request_digest,receipt_json)
      SELECT ?, 'unmerge', ?, ?, ?, ? FROM horse_merges m
      WHERE m.id=? AND m.unmerged_at IS NOT NULL AND m.unmerge_operation_id=?
    `).bind(operationId, mergeId, auth.user.id, requestDigest, receiptJson, mergeId, operationId),
    env.DB.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?, 'horse.unmerged', 'horse', CAST(merge_id AS TEXT), ?, 'null', CURRENT_TIMESTAMP
      FROM merge_command_receipts WHERE operation_id=? AND command='unmerge'
    `).bind(auth.user.id, JSON.stringify({ merge_id: mergeId, kept_horse_id: keptId, restored_references: manifest.length, operation_id: operationId }), operationId),
    env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT ?, 'unmerge'").bind(keptId),
    env.DB.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) SELECT ?, 'unmerge'").bind(mergedId),
    // R122-A03: revision and active-horse counter settle in the SAME
    // transaction, CAS-conditioned on OUR receipt (exactly once).
    env.DB.prepare("UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM merge_command_receipts WHERE operation_id=? AND command='unmerge')").bind(operationId),
    env.DB.prepare("UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND EXISTS(SELECT 1 FROM merge_command_receipts r JOIN horse_merges m ON m.id=r.merge_id JOIN horses mh ON mh.id=m.merged_horse_id WHERE r.operation_id=? AND r.command='unmerge' AND mh.deleted_at IS NULL)").bind(operationId),
    env.DB.prepare("SELECT * FROM merge_command_receipts WHERE operation_id=?").bind(operationId),
  );

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (cause) {
    if (isMergeInvariantViolation(cause)) {
      // The ENTIRE reversal rolled back — no restore, no un-archive, no alias
      // deletion, no receipt. Classify honestly against current state.
      const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`).bind(auth.user.id).first();
      if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has unmerge authority");
      if (!await env.DB.prepare(`SELECT 1 AS ok WHERE ${careGuard.sql}`).bind(...careGuard.bindings).first()) throw new HttpError(409, "protected_identity_reconciliation_required", "A protected relationship changed during reversal; nothing was committed");
      const mergeNow = await env.DB.prepare("SELECT unmerged_at,unmerge_operation_id FROM horse_merges WHERE id=?").bind(mergeId).first<{ unmerged_at: string | null; unmerge_operation_id: string | null }>();
      if (mergeNow?.unmerged_at && mergeNow.unmerge_operation_id !== operationId) throw new HttpError(409, "already_unmerged", "This merge has already been unmerged by another command");
      const existingCycle = await env.DB.prepare(ANCESTRY_CYCLE_PROBE_SQL).bind(mergedId, mergedId, mergedId).first()
        ?? await env.DB.prepare(ANCESTRY_CYCLE_PROBE_SQL).bind(keptId, keptId, keptId).first();
      if (existingCycle) {
        throw new HttpError(409, "unmerge_graph_unsafe", `The current pedigree graph already contains a cycle through horse ${keptId} or horse ${mergedId}; the unmerge refused and nothing was written. Report the pre-existing cycle to the registry operator.`);
      }
      const restoringCycle = await env.DB.prepare(ANCESTOR_OF_PROBE_SQL).bind(mergedId, mergedId, keptId).first();
      if (restoringCycle) {
        throw new HttpError(409, "unmerge_graph_unsafe", `Horse ${keptId} is currently an ancestor of horse ${mergedId}; restoring the pre-merge parent links would make the pedigree graph cyclic. Nothing was written. Resolve the newer parent links first.`);
      }
      const drift = await reverifyDrift(env.DB, manifest, keptId, mergedId);
      if (drift.identifierDrift.length > 0 || drift.fkDrift.length > 0) {
        throw new HttpError(409, "unmerge_state_changed", "The reference state changed between the preflight verification and the commit; the reversal refused atomically (nothing was restored). Re-run the unmerge after reviewing the drifted entries.", { drifted_entries: [...drift.fkDrift, ...drift.identifierDrift].slice(0, DRIFT_REPORT_LIMIT), drifted_count: drift.fkDrift.length + drift.identifierDrift.length });
      }
      throw new HttpError(503, "unmerge_unconfirmed", "The unmerge outcome could not be confirmed. Re-read the merge record before retrying; the durable command receipt prevents duplicate application.");
    }
    if (isGraphLockTimeoutError(cause)) {
      throw new HttpError(409, "unmerge_busy", "Another pedigree change is being saved right now. Nothing was written — reload and retry the unmerge in a moment.");
    }
    if (isMergeReceiptConflict(cause)) {
      const replayed = await resolveMergeOperationKey(env.DB, { operationId, actorId: auth.user.id, command: "unmerge", requestDigest });
      if (replayed) return json(replayed.body, { status: replayed.statusCode });
    }
    throw cause;
  }
  const receiptRow = (results[results.length - 1]?.results ?? [])[0] as Record<string, unknown> | undefined;
  if (!receiptRow) {
    const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`).bind(auth.user.id).first();
    if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has unmerge authority");
    const mergeNow = await env.DB.prepare("SELECT unmerged_at,unmerge_operation_id FROM horse_merges WHERE id=?").bind(mergeId).first<{ unmerged_at: string | null; unmerge_operation_id: string | null }>();
    if (mergeNow?.unmerged_at && mergeNow.unmerge_operation_id !== operationId) throw new HttpError(409, "already_unmerged", "This merge has already been unmerged by another command");
    const drift = await reverifyDrift(env.DB, manifest, keptId, mergedId);
    if (drift.identifierDrift.length > 0 || drift.fkDrift.length > 0) {
      throw new HttpError(409, "unmerge_state_changed", "The reference state changed between the preflight verification and the commit; nothing further was written. Re-run the unmerge after reviewing the drifted entries.", { drifted_entries: [...drift.fkDrift, ...drift.identifierDrift].slice(0, DRIFT_REPORT_LIMIT), drifted_count: drift.fkDrift.length + drift.identifierDrift.length });
    }
    throw new HttpError(503, "unmerge_unconfirmed", "The unmerge outcome could not be confirmed. Re-read the merge record before retrying; the durable command receipt prevents duplicate application.");
  }
  return json({
    unmerged: true,
    replayed: false,
    merge_id: mergeId,
    kept_horse_id: keptId,
    merged_horse_id: mergedId,
    restored_references: manifest.length,
    operation_id: operationId,
    receipt: receiptRow,
    note: "Every manifest entry was verified against the exact value the merge wrote, then restored value-guarded. Identifiers are live again on their original horse, the redirect alias is cleared and the merged horse is restored.",
  });
}

async function reverifyDrift(db: D1Database, manifest: ManifestEntry[], keptId: number, mergedId: number): Promise<{ fkDrift: unknown[]; identifierDrift: unknown[] }> {
  const fkDrift: Array<{ table: string; row_id: number | string; column: string; expected: number; actual: string }> = [];
  const identifierDrift: Array<{ row_id: number | string; expected: string; actual: string }> = [];
  for (const entry of manifest) {
    if (entry.table === "horse_identifiers") {
      const row = await db.prepare("SELECT horse_id,status FROM horse_identifiers WHERE id=?").bind(entry.row_id).first<{ horse_id: number; status: string }>();
      if (!row || Number(row.horse_id) !== mergedId || row.status !== "live") {
        identifierDrift.push({ row_id: entry.row_id, expected: `live on horse ${mergedId}`, actual: row ? `horse_id=${row.horse_id}, status=${row.status}` : "row_missing" });
      }
    } else {
      const statement = entry.role != null
        ? db.prepare(`SELECT ${entry.column} AS value FROM ${entry.table} WHERE person_id=? AND role=?`).bind(entry.row_id, entry.role)
        : db.prepare(`SELECT ${entry.column} AS value FROM ${entry.table} WHERE id=?`).bind(entry.row_id);
      const row = await statement.first<{ value: number | null }>();
      const current = row ? (row.value === null ? null : Number(row.value)) : undefined;
      if (current !== Number(entry.from)) {
        fkDrift.push({ table: entry.table, row_id: entry.row_id, column: entry.column, expected: Number(entry.from), actual: current === undefined ? "row_missing" : String(current) });
      }
    }
  }
  void keptId;
  return { fkDrift, identifierDrift };
}


// ---------------------------------------------------------------------------
// R114-03 (Master AI R113 handoff D31-A): the staged-import operator surface —
// bounded preview, review report and the versioned row-review command.
// ---------------------------------------------------------------------------

const RowReviewSchema = z.object({
  decision: z.enum(["skip", "reclassify", "target_override"]),
  reason: z.string().trim().min(10).max(1000),
  operation_id: OperationKeySchema,
  target_horse_id: z.number().int().positive().optional(),
}).superRefine((input, context) => {
  if (input.decision === "target_override" && input.target_horse_id == null) {
    context.addIssue({ code: "custom", message: "target_override requires target_horse_id", path: ["target_horse_id"] });
  }
  if (input.decision !== "target_override" && input.target_horse_id != null) {
    context.addIssue({ code: "custom", message: "target_horse_id is only valid with the target_override decision", path: ["target_horse_id"] });
  }
});

/** Batch-state gate for reviews: never a completed or failed batch. */
const REVIEW_BATCH_STATE_SQL = `EXISTS(SELECT 1 FROM import_batches rb WHERE rb.id=import_staging_rows.batch_id AND rb.status IN ('staged','partial','applying'))`;

interface ImportRowReviewReceiptRow {
  id: number; row_id: number; batch_id: number; decision: "skip" | "reclassify" | "target_override";
  reason: string; prior_row_action: string; prior_outcome: string; prior_horse_id: number | null;
  new_row_action: string; new_outcome: string; new_horse_id: number | null;
  decided_by_user_id: string; operation_id: string; receipt_json: string; created_at: string;
}

/** Replay-or-refuse for a review operation key (same doctrine as the
 * competition commands: exact retry replays, reuse with new content refuses). */
async function resolveReviewOperationKey(db: D1Database, scope: { operationId: string; actorId: string; batchId: number; rowId: number; digest: string }): Promise<{ replayed: true; statusCode: number; body: Record<string, unknown> } | null> {
  const stored = await db.prepare("SELECT row_id,batch_id,decided_by_user_id,operation_id,request_digest,receipt_json FROM import_row_reviews WHERE operation_id=?").bind(scope.operationId)
    .first<{ row_id: number; batch_id: number; decided_by_user_id: string; operation_id: string; request_digest: string; receipt_json: string }>();
  if (!stored) return null;
  const matches = stored.decided_by_user_id === scope.actorId && Number(stored.row_id) === scope.rowId && Number(stored.batch_id) === scope.batchId && stored.request_digest === scope.digest;
  if (!matches) throw new HttpError(409, "idempotency_conflict", "This operation_id was already used for a different import review command");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(stored.receipt_json) as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "idempotency_receipt_corrupt", "The stored import review receipt could not be decoded");
  }
  return { replayed: true, statusCode: 200, body: { ...body, replayed: true } };
}

function isReviewPrimaryKeyConflict(cause: unknown): boolean {
  const error = cause as { message?: string; constraint?: string; cause?: { message?: string } } | null;
  const message = [error?.message, error?.constraint, error?.cause?.message].filter(Boolean).join(" ");
  return /import_row_reviews/i.test(message) && /UNIQUE constraint failed|duplicate key|PRIMARY KEY/i.test(message);
}

/**
 * Bounded, protected, READ-ONLY preview of a staged batch: raw and normalized
 * values side by side, the mapping version, the classification and its reason,
 * the matched target (when any) and the latest review decisions. Preview never
 * writes canonical data and never re-runs classification — it reports exactly
 * what staging classified and what reviews have decided since.
 */
export async function adminImportBatchPreview(request: Request, env: Env, batchId: number): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const batch = await env.DB.prepare(`
    SELECT b.*, s.name AS source_name, s.issuer_namespace, s.scope_note, s.redistribution_allowed,
           s.retention_note, s.update_cadence, s.license_note, s.is_synthetic
    FROM import_batches b JOIN import_sources s ON s.id=b.source_id WHERE b.id=?
  `).bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new HttpError(404, "not_found", "Import batch not found");
  await assertCompleteStaging(env.DB, { id: batch.id, rows_total: batch.rows_total });
  const page = await env.DB.prepare(`
    SELECT r.id,r.external_id,r.raw_json,r.normalized_json,r.row_action,r.outcome,r.outcome_detail,r.horse_id,
           r.last_review_operation_id,r.processed_at,
           h.name_latin AS target_name_latin,h.register_no AS target_register_no
    FROM import_staging_rows r LEFT JOIN horses h ON h.id=r.horse_id AND h.deleted_at IS NULL
    WHERE r.batch_id=? ORDER BY r.id LIMIT 500
  `).bind(batchId).all();
  const rows = (page.results ?? []) as Array<Record<string, unknown>>;
  const rowIds = rows.map(row => Number(row.id));
  const reviews = rowIds.length
    ? await env.DB.prepare(`
        SELECT row_id,decision,reason,prior_row_action,prior_outcome,new_row_action,new_outcome,decided_by_user_id,created_at
        FROM import_row_reviews WHERE batch_id=? ORDER BY id DESC LIMIT 200
      `).bind(batchId).all()
    : { results: [] };
  const reviewsByRow = new Map<number, Array<Record<string, unknown>>>();
  for (const review of (reviews.results ?? []) as Array<Record<string, unknown>>) {
    const key = Number(review.row_id);
    if (!reviewsByRow.has(key)) reviewsByRow.set(key, []);
    if ((reviewsByRow.get(key) as Array<Record<string, unknown>>).length < 5) (reviewsByRow.get(key) as Array<Record<string, unknown>>).push(review);
  }
  const total = Number(batch.rows_total);
  return json({
    batch: {
      id: Number(batch.id), source_id: Number(batch.source_id), source_name: batch.source_name,
      issuer_namespace: batch.issuer_namespace, scope_note: batch.scope_note,
      redistribution_allowed: Number(batch.redistribution_allowed) === 1, retention_note: batch.retention_note,
      update_cadence: batch.update_cadence, license_note: batch.license_note, is_synthetic: Number(batch.is_synthetic) === 1,
      file_name: batch.file_name, mapping_version: batch.mapping_version, status: batch.status,
      rows_total: total, rows_created: Number(batch.rows_created), rows_updated: Number(batch.rows_updated),
      rows_conflict: Number(batch.rows_conflict), rows_skipped: Number(batch.rows_skipped),
    },
    rows: rows.map(row => ({
      id: Number(row.id),
      external_id: row.external_id,
      raw: safeJsonParse(row.raw_json as string),
      normalized: safeJsonParse(row.normalized_json as string),
      row_action: row.row_action,
      outcome: row.outcome,
      outcome_detail: safeJsonParse(row.outcome_detail as string | null),
      horse_id: row.horse_id === null || row.horse_id === undefined ? null : Number(row.horse_id),
      target: row.horse_id == null ? null : { name_latin: row.target_name_latin ?? null, register_no: row.target_register_no ?? null },
      last_review_operation_id: row.last_review_operation_id ?? null,
      processed_at: row.processed_at ?? null,
      reviews: reviewsByRow.get(Number(row.id)) ?? [],
    })),
    rows_window: { limit: 500, total, has_more: total > 500 },
    note: "Read-only operator preview: raw and normalized values side by side with the staged classification and review history. Nothing canonical is written here; apply remains the only canonical writer.",
  });
}

function safeJsonParse(text: string | null): unknown {
  if (text == null || text === "") return null;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Bounded export of the review/RESULT report WITHOUT raw source blobs: batch
 * counters plus per-row classification/outcome and the decision history. The
 * full raw payload lives only in the protected preview surface.
 */
export async function adminImportReviewReport(request: Request, env: Env, batchId: number): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const batch = await env.DB.prepare("SELECT * FROM import_batches WHERE id=?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new HttpError(404, "not_found", "Import batch not found");
  const [rows, reviews] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id,external_id,row_action,outcome,outcome_detail,horse_id,processed_at
      FROM import_staging_rows WHERE batch_id=? ORDER BY id LIMIT 500
    `).bind(batchId),
    env.DB.prepare(`
      SELECT row_id,decision,reason,prior_row_action,prior_outcome,new_row_action,new_outcome,decided_by_user_id,operation_id,created_at
      FROM import_row_reviews WHERE batch_id=? ORDER BY id LIMIT 500
    `).bind(batchId),
  ]);
  const staged = (rows.results ?? []) as Array<Record<string, unknown>>;
  return json({
    batch,
    outcome_counts: {
      pending: staged.filter(r => r.outcome === "pending").length,
      applied_create: staged.filter(r => r.outcome === "applied_create").length,
      applied_update: staged.filter(r => r.outcome === "applied_update").length,
      conflict: staged.filter(r => r.outcome === "conflict").length,
      skipped: staged.filter(r => r.outcome === "skipped").length,
      failed: staged.filter(r => r.outcome === "failed").length,
    },
    rows: staged.map(row => ({
      id: Number(row.id), external_id: row.external_id, row_action: row.row_action, outcome: row.outcome,
      outcome_detail: safeJsonParse(row.outcome_detail as string | null),
      horse_id: row.horse_id === null || row.horse_id === undefined ? null : Number(row.horse_id),
      processed_at: row.processed_at ?? null,
    })),
    reviews: (reviews.results ?? []) as Array<Record<string, unknown>>,
    window: { limit: 500, total: Number(batch.rows_total) },
    note: "Bounded review/result report. Raw source values are intentionally excluded from the export; use the protected preview for side-by-side inspection.",
  });
}

/**
 * The versioned row-review command — the per-row adjudication API D31-A
 * names as missing. One immutable receipt per caller operation key; the
 * prior state is preserved in the decision history; authority, batch state,
 * row state and (for target_override) the typed-identifier match are all
 * revalidated inside the guarded mutation. A decision NEVER writes canonical
 * data: skip moves the row out of the apply pool, reclassify re-runs the
 * dry-run classification against CURRENT canonical state, and
 * target_override directs an ambiguous row to a horse the row's own typed
 * identifiers prove (register in the source namespace or microchip — never
 * a name). Merge remains the separately authorized reconciliation command.
 */
export async function adminReviewImportRow(request: Request, env: Env, batchId: number, rowId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = RowReviewSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "The row review command failed validation", parsed.error.flatten());
  const { decision, reason, operation_id: operationId, target_horse_id: targetHorseId } = parsed.data;
  const digest = await sha256HexLocal(canonicalJsonLocal({ batchId, rowId, decision, reason, targetHorseId }));
  const replay = await resolveReviewOperationKey(env.DB, { operationId, actorId: auth.user.id, batchId, rowId, digest });
  if (replay) return json(replay.body, { status: replay.statusCode });

  const batch = await env.DB.prepare("SELECT id,status,rows_total,source_id FROM import_batches WHERE id=?").bind(batchId).first<{ id: number; status: string; rows_total: number; source_id: number }>();
  if (!batch) throw new HttpError(404, "not_found", "Import batch not found");
  await assertCompleteStaging(env.DB, batch);
  if (batch.status === "completed" || batch.status === "failed") {
    throw new HttpError(409, "batch_not_reviewable", `A ${batch.status} batch has nothing left to review`);
  }
  const row = await env.DB.prepare("SELECT id,batch_id,external_id,raw_json,normalized_json,row_action,outcome,horse_id FROM import_staging_rows WHERE id=? AND batch_id=?").bind(rowId, batchId)
    .first<{ id: number; batch_id: number; external_id: string; raw_json: string; normalized_json: string; row_action: string; outcome: string; horse_id: number | null }>();
  if (!row) throw new HttpError(404, "not_found", "Import row not found in this batch");

  const REVIEW_ALLOWED_FROM: Record<string, string[]> = {
    skip: ["pending", "conflict", "failed"],
    reclassify: ["pending", "conflict", "skipped", "failed"],
    target_override: ["pending", "conflict"],
  };
  if (!REVIEW_ALLOWED_FROM[decision].includes(row.outcome)) {
    throw new HttpError(409, "row_not_reviewable", `A row with outcome '${row.outcome}' cannot take the '${decision}' decision (allowed from: ${REVIEW_ALLOWED_FROM[decision].join(", ")})`);
  }
  if (decision === "target_override" && row.row_action !== "conflict") {
    throw new HttpError(409, "row_not_reviewable", "target_override applies to conflict-classified rows; a create/skip/update classification is already unambiguous");
  }

  const receiptJsonParts = { batch_id: batchId, row_id: rowId, external_id: row.external_id, decision, reason, prior: { row_action: row.row_action, outcome: row.outcome, horse_id: row.horse_id } };
  const baseNote = "Decision recorded in the immutable review history; canonical data was not touched. The apply command remains the only canonical writer, and merge stays the separately authorized reconciliation.";

  // ---- decision-specific pre-reads (read-only; every guard repeats in-transaction) ----
  let newAction = row.row_action;
  let newHorseId = row.horse_id;
  let newOutcome = "skipped";
  let detail: string | null = `Reviewer skip: ${reason}`;
  let reclassified: Record<string, unknown> | undefined;
  let targetEvidence: Record<string, unknown> | undefined;
  let proofRegisterNo: string | null = null;
  let proofMicrochipNo: string | null = null;

  if (decision === "reclassify") {
    const source = await env.DB.prepare("SELECT issuer_namespace,is_synthetic FROM import_sources WHERE id=?").bind(batch.source_id).first<{ issuer_namespace: string; is_synthetic: number }>();
    if (!source || Number(source.is_synthetic) !== 0) throw new HttpError(409, "import_source_changed", "The source is no longer eligible; reload its agreement before reviewing.");
    const raw = JSON.parse(row.raw_json) as ImportRow;
    const normalized = await normalizeImportRow(raw);
    const registerMatches = await lookupIdentifier(env.DB, "register_no", source.issuer_namespace, normalized.normalized.register_no ?? null);
    const microchipMatches = await lookupIdentifier(env.DB, "microchip_no", "microchip", normalized.normalized.microchip_no ?? null);
    let existing: ExistingHorseRecord | null = null;
    const matchedId = registerMatches[0]?.horseId ?? microchipMatches[0]?.horseId ?? null;
    if (matchedId != null) {
      existing = await env.DB.prepare(
        "SELECT h.id,h.register_no,h.microchip_no,h.father_id,h.mother_id,p.register_no AS father_register_no,m.register_no AS mother_register_no FROM horses h LEFT JOIN horses p ON p.id=h.father_id LEFT JOIN horses m ON m.id=h.mother_id WHERE h.id=? AND h.deleted_at IS NULL",
      ).bind(matchedId).first<ExistingHorseRecord>() ?? null;
    }
    const fresh = classifyImportRow({ row: normalized, registerMatches, microchipMatches, existing });
    if (fresh.action === row.row_action && ("horseId" in fresh ? fresh.horseId : null) === row.horse_id) {
      throw new HttpError(409, "reclassification_unchanged",
        "Re-running the classification against current canonical state reproduces the same result. Resolve the underlying identifier disagreement (merge is the separately authorized reconciliation) or choose skip.",
        { current: { row_action: row.row_action, horse_id: row.horse_id }, fresh: { action: fresh.action, detail: fresh.detail } });
    }
    newAction = fresh.action;
    newHorseId = "horseId" in fresh ? fresh.horseId : null;
    newOutcome = "pending";
    detail = `Reviewer reclassification: ${reason}`;
    reclassified = { action: fresh.action, detail: fresh.detail };
  }

  if (decision === "target_override") {
    const source = await env.DB.prepare("SELECT issuer_namespace FROM import_sources WHERE id=?").bind(batch.source_id).first<{ issuer_namespace: string }>();
    if (!source) throw new HttpError(409, "import_source_changed", "The source is no longer eligible; reload its agreement before reviewing.");
    const raw = JSON.parse(row.raw_json) as ImportRow;
    // R140-B: proof values normalize through the SAME canonical normalizer as
    // the identifier claims — fullwidth digits cannot evade or fake a match.
    proofRegisterNo = canonicalNormalizedIdentifier(raw.register_no);
    proofMicrochipNo = canonicalNormalizedIdentifier(raw.microchip_no);
    const registerNo = proofRegisterNo;
    const microchipNo = proofMicrochipNo;
    // Typed-identifier proof ONLY: the target must actually hold this row's
    // register (source namespace) or microchip. A name is never evidence.
    const evidence = await env.DB.prepare(`
      SELECT 'register_no' AS via, 1 AS ok FROM horse_identifiers
        WHERE horse_id=? AND status='live' AND kind='register_no' AND issuer_namespace=? AND normalized_value=? AND ? IS NOT NULL AND ? != ''
      UNION ALL
      SELECT 'microchip_no' AS via, 1 FROM horse_identifiers
        WHERE horse_id=? AND status='live' AND kind='microchip_no' AND issuer_namespace='microchip' AND normalized_value=? AND ? IS NOT NULL AND ? != ''
      LIMIT 1
    `).bind(targetHorseId, source.issuer_namespace, registerNo, registerNo, registerNo, targetHorseId, microchipNo, microchipNo, microchipNo).first<{ via: string }>();
    if (!evidence) {
      throw new HttpError(409, "target_not_proven",
        "The target horse does not hold this row's typed identifier (register in the source namespace or microchip). Name similarity is never targeting evidence; use merge for a separately authorized reconciliation.",
        { target_horse_id: targetHorseId, row_register_no: registerNo, row_microchip_no: microchipNo });
    }
    const target = await env.DB.prepare("SELECT id,name_latin,deleted_at FROM horses WHERE id=?").bind(targetHorseId).first<{ id: number; name_latin: string; deleted_at: string | null }>();
    if (!target || target.deleted_at) throw new HttpError(409, "target_unavailable", "The target horse does not exist or is archived");
    newAction = "update";
    newHorseId = targetHorseId ?? null;
    newOutcome = "pending";
    detail = `Reviewer target override (via ${evidence.via}): ${reason}`;
    targetEvidence = { via: evidence.via, target_horse_id: targetHorseId, target_name_latin: target.name_latin };
  }

  const receiptJson = JSON.stringify({ reviewed: true, ...receiptJsonParts, new: { row_action: newAction, outcome: newOutcome, horse_id: newHorseId }, ...(reclassified ? { reclassified } : {}), ...(targetEvidence ? { target_evidence: targetEvidence } : {}), note: baseNote });
  if (receiptJson.length > 4000) throw new HttpError(400, "invalid_review", "The review receipt would overflow its bound");

  // ---- the guarded transaction: state transition + marker-gated receipt + audit ----
  const priorStateSql = "row_action=? AND outcome=? AND (horse_id=? OR (horse_id IS NULL AND ? IS NULL))";
  const transitionSql = decision === "skip"
    ? `UPDATE import_staging_rows SET outcome='skipped',outcome_detail=?,processed_at=CURRENT_TIMESTAMP,last_review_operation_id=?
       WHERE id=? AND batch_id=? AND ${priorStateSql} AND ${REVIEW_BATCH_STATE_SQL} AND ${IMPORT_WRITER_SQL}`
    : `UPDATE import_staging_rows SET row_action=?,horse_id=?,outcome='pending',outcome_detail=?,processed_at=NULL,last_review_operation_id=?
       WHERE id=? AND batch_id=? AND ${priorStateSql} AND ${REVIEW_BATCH_STATE_SQL} AND ${IMPORT_WRITER_SQL}
         ${decision === "target_override" ? "AND EXISTS(SELECT 1 FROM horses t WHERE t.id=? AND t.deleted_at IS NULL AND EXISTS(SELECT 1 FROM horse_identifiers hi WHERE hi.horse_id=t.id AND hi.status='live' AND ((hi.kind='register_no' AND hi.issuer_namespace=? AND hi.normalized_value=? AND ? IS NOT NULL AND ? != '') OR (hi.kind='microchip_no' AND hi.issuer_namespace='microchip' AND hi.normalized_value=? AND ? IS NOT NULL AND ? != ''))))" : ""}`;

  let results;
  try {
    const transitionBinds: unknown[] = decision === "skip"
      ? [detail, operationId, rowId, batchId, row.row_action, row.outcome, row.horse_id, row.horse_id, auth.user.id]
      : decision === "reclassify"
        ? [newAction, newHorseId, detail, operationId, rowId, batchId, row.row_action, row.outcome, row.horse_id, row.horse_id, auth.user.id]
        : [newAction, newHorseId, detail, operationId, rowId, batchId, row.row_action, row.outcome, row.horse_id, row.horse_id, auth.user.id, targetHorseId, (await env.DB.prepare("SELECT issuer_namespace FROM import_sources WHERE id=?").bind(batch.source_id).first<{ issuer_namespace: string }>())?.issuer_namespace, proofRegisterNo, proofRegisterNo, proofRegisterNo, proofMicrochipNo, proofMicrochipNo, proofMicrochipNo];
    results = await env.DB.batch([
      importWriterLock(env.DB, auth.user.id),
      env.DB.prepare(transitionSql).bind(...transitionBinds),
      env.DB.prepare(`
        INSERT INTO import_row_reviews(row_id,batch_id,decision,reason,request_digest,prior_row_action,prior_outcome,prior_horse_id,new_row_action,new_outcome,new_horse_id,decided_by_user_id,operation_id,receipt_json,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP
        FROM import_staging_rows WHERE id=? AND batch_id=? AND last_review_operation_id=? AND row_action=? AND outcome=?
      `).bind(rowId, batchId, decision, reason, digest, row.row_action, row.outcome, row.horse_id, newAction, newOutcome, newHorseId, auth.user.id, operationId, receiptJson,
        rowId, batchId, operationId, newAction, newOutcome),
      env.DB.prepare(`
        INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
        SELECT ?,'import.row.reviewed','import_staging_row',CAST(row_id AS TEXT),?,?,CURRENT_TIMESTAMP
        FROM import_row_reviews WHERE operation_id=?
      `).bind(auth.user.id, JSON.stringify(receiptJsonParts.prior), receiptJson, operationId),
      env.DB.prepare("SELECT row_id,batch_id,decision,reason,prior_row_action,prior_outcome,new_row_action,new_outcome,new_horse_id,operation_id,created_at FROM import_row_reviews WHERE operation_id=?").bind(operationId),
    ]);
  } catch (cause) {
    if (isReviewPrimaryKeyConflict(cause)) {
      const replayed = await resolveReviewOperationKey(env.DB, { operationId, actorId: auth.user.id, batchId, rowId, digest });
      if (replayed) return json(replayed.body, { status: replayed.statusCode });
    }
    throw cause;
  }
  const transitionChanges = Number(results[1]?.meta.changes ?? 0);
  const receiptRow = results[4]?.results?.[0] as ImportRowReviewReceiptRow | undefined;
  if (transitionChanges !== 1 || !receiptRow) {
    // The guarded transition lost: classify honestly against current state.
    const fresh = await env.DB.prepare("SELECT row_action,outcome,horse_id FROM import_staging_rows WHERE id=? AND batch_id=?").bind(rowId, batchId).first<{ row_action: string; outcome: string; horse_id: number | null }>();
    const authority = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id=? AND is_active=1 AND role IN (${IMPORT_WRITER_ROLES})`).bind(auth.user.id).first();
    if (!authority) throw new HttpError(403, "forbidden", "Your account no longer has import review authority");
    if (!fresh) throw new HttpError(404, "not_found", "Import row not found in this batch");
    if (fresh.row_action !== row.row_action || fresh.outcome !== row.outcome || (fresh.horse_id ?? null) !== (row.horse_id ?? null)) {
      throw new HttpError(409, "row_changed", "The row changed between inspection and the decision; nothing was written. Reload the row and review its current state.", { current: fresh });
    }
    throw new HttpError(409, "review_conflict", "The review could not commit with current batch/row state; nothing changed and no receipt was claimed");
  }
  return json({
    reviewed: true,
    replayed: false,
    row: { id: rowId, batch_id: batchId, external_id: row.external_id, row_action: newAction, outcome: newOutcome, horse_id: newHorseId },
    receipt: { operation_id: operationId, decision, prior: receiptJsonParts.prior, new: { row_action: newAction, outcome: newOutcome, horse_id: newHorseId } },
    ...(reclassified ? { reclassified } : {}),
    ...(targetEvidence ? { target_evidence: targetEvidence } : {}),
    note: baseNote + (newOutcome === "pending" ? " Call apply to process the re-adjudicated row and finalize the batch counters." : ""),
  }, { status: 201 });
}
