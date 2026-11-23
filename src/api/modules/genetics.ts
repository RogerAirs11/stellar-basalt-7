import { z } from "zod";
import { resolveBreedingSeason, validateGregorianDay } from "../../genetics/breedingDates";
import { classifyBreedingSex } from "../../pedigree/breeding";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requirePermission, requireCsrf } from "../../auth/guards";
import { ASSAY_CATALOG_VERSION, summarizeGeneticTests, interpretAssayResult } from "../../genetics/assayCatalog";
import { projectBreedingRecord, type PrivacyViewer } from "../../privacy/projections";
import { readHorseGenetics } from "../../privacy/geneticReads";
import { geneticActionPredicate, geneticCapabilities, requireGeneticPermissions } from "../../access/geneticAccess";
import { recordPublicationDecision, effectiveDisclosure } from "../../privacy/publicationDecisions";
import { geneticOperationReceipt, isGeneticReceiptConflict, type GeneticOperationContext } from "../../genetics/operationReceipts";
import type { GeneticIntakeResponse, GeneticInterpretationReceipt } from "../../contracts/genetics";
import { stripCallerAuthority } from "../../trust/policy";
import type { D1Database, D1Result } from "@cloudflare/workers-types";

// Structured genetics + breeding records (client phase-2 requirement, early).
// genetic_tests model disease-marker panels (SCID/CA/LFS/... for Arabians),
// coat-color loci and parentage tests with lab provenance. breeding_records
// include rows DERIVED deterministically from registered pedigree — real
// registry facts, never invented — plus staff-entered covering records.

export const DISEASE_TESTS = ["SCID", "CA", "LFS", "OLWS", "HYPP", "GBED", "JEB1", "JEB2", "MH", "PSSM1"] as const;
export const COAT_LOCI = ["extension_MC1R", "agouti_ASIP", "gray_STX17", "dun_TBX3", "cream_SLC45A2", "champagne_SLC36A1", "silver_PMEL17", "tobiano_KIT", "sabino1_KIT", "splash_PAX3"] as const;

const GeneticTestSchema = z.object({
  operation_id: z.string().uuid(),
  test_type: z.string().trim().min(2).max(60),
  test_category: z.enum(["disease", "coat_color", "parentage", "diversity", "other"]).default("disease"),
  result: z.string().trim().min(1).max(60),
  result_interpretation: z.string().trim().max(500).nullable().optional(),
  lab_name: z.string().trim().max(200).nullable().optional(),
  lab_accession: z.string().trim().max(120).nullable().optional(),
  tested_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  verified: z.boolean().default(false),
  // R140-A: explicit publication permission for health-sensitive results.
  // Intake never publishes a report. A separately scoped publisher makes
  // any later disclosure decision after independent record review.
  public_disclosed: z.literal(false).default(false),
  notes: z.string().trim().max(2000).nullable().optional(),
  provenance: z.enum(["demo", "federation", "user"]).default("user"),
});

const BreedingRecordSchema = z.object({
  sire_id: z.number().int().positive(),
  dam_id: z.number().int().positive(),
  covering_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  season: z.number().int().min(1380).max(1500).nullable().optional(),
  method: z.enum(["natural", "ai_fresh", "ai_frozen", "embryo_transfer"]).nullable().optional(),
  outcome: z.enum(["planned", "pregnant", "foaled", "failed", "unknown"]).default("unknown"),
  foal_id: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function horseGenetics(db: D1Database, horseId: number, viewer?: PrivacyViewer | null): Promise<Response> {
  const { horse, tests } = await readHorseGenetics(db, horseId, viewer);
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  return json({ horse, summary: summarizeGeneticTests(tests), tests });
}

export async function horseGeneticAccess(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, horseId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  return json(await geneticCapabilities(env.DB, auth, horseId));
}

export async function adminAddGeneticTest(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, horseId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  requireCsrf(request, auth);
  await requireGeneticPermissions(env.DB, auth, horseId, ["genetic_intake"]);
  const parsed = GeneticTestSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_genetic_test", "Genetic test failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.tested_at) validateGregorianDay(d.tested_at);
  const { verified: storedVerified, provenance: storedProvenance } = stripCallerAuthority(d.provenance);
  const requestJson = JSON.stringify({ horse_id: horseId, ...d, verified: storedVerified, provenance: storedProvenance });
  const context: GeneticOperationContext = { viewer: auth, horseId, operationId: d.operation_id, action: "intake", requestJson, permissions: ["genetic_intake"] };
  const prior = await geneticOperationReceipt<GeneticIntakeResponse["test"]>(env.DB, context);
  if (prior) return json({ test: prior, operation_id: d.operation_id, replayed: true });
  const guard = geneticActionPredicate(auth, horseId, ["genetic_intake"]);
  const attemptId = crypto.randomUUID();
  let committed = false;
  try {
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE horses SET row_version=row_version WHERE id=?").bind(horseId),
      env.DB.prepare(`INSERT INTO genetic_tests(horse_id,test_type,test_category,result,result_interpretation,lab_name,lab_accession,tested_at,verified,notes,provenance,public_disclosed,created_by_user_id,intake_operation_id)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,0,?,? WHERE (${guard.sql})
          AND NOT EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=?)
        ON CONFLICT(intake_operation_id) DO NOTHING`)
        .bind(horseId,d.test_type,d.test_category,d.result,d.result_interpretation ?? null,d.lab_name ?? null,d.lab_accession ?? null,
          d.tested_at ?? null,storedVerified,d.notes ?? null,storedProvenance,auth.user.id,d.operation_id,...guard.bindings,d.operation_id),
      // The guarded fact INSERT is this command's authorization point. Once
      // it succeeds, its receipt and audit must follow in this same atomic
      // batch even if an independent grant revocation is now visible. A
      // second authority check here could strand an unreceipted raw report.
      env.DB.prepare(`INSERT INTO genetic_evidence_operations(operation_id,attempt_id,test_id,horse_id,actor_user_id,action,request_json,decision_json)
        SELECT ?,?,g.id,g.horse_id,?,'intake',?,
          json_object('id',g.id,'horse_id',g.horse_id,'verified',0,'public_disclosed',0,'row_version',g.row_version)
        FROM genetic_tests g WHERE g.intake_operation_id=? AND g.created_by_user_id=?
          AND NOT EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=?)
        ON CONFLICT(operation_id) DO NOTHING`)
        .bind(d.operation_id,attemptId,auth.user.id,requestJson,d.operation_id,auth.user.id,d.operation_id),
      env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json)
        SELECT actor_user_id,'genetic.intake.recorded','genetic_test',CAST(test_id AS TEXT),?
        FROM genetic_evidence_operations WHERE operation_id=? AND attempt_id=?`)
        .bind(JSON.stringify({ operation_id: d.operation_id, authority_scope: "genetic_intake", verified: false, public_disclosed: false }),d.operation_id,attemptId),
    ]);
    committed = Number(results[2]?.meta.changes ?? 0) === 1;
  } catch (cause) {
    if (!isGeneticReceiptConflict(cause)) throw cause;
  }
  const test = await geneticOperationReceipt<GeneticIntakeResponse["test"]>(env.DB, context);
  if (!test) throw new HttpError(409, "genetic_intake_not_recorded", "The subject or permission changed; reload before retrying with the same operation reference");
  // A write-only intake actor receives their operation receipt, never a GET
  // projection of unrelated reports or an implicit evidence-read permission.
  return json({ test, operation_id: d.operation_id, replayed: !committed }, { status: committed ? 201 : 200 });
}

export async function horseBreedings(db: D1Database, horseId: number, viewer?: PrivacyViewer | null): Promise<Response> {
  // R132 PERFORMANCE: existence + the three breeding views in one ordered
  // batch (one Hyperdrive round trip instead of two sequential ones).
  // This is a public registry view for every caller. Resolve linked identities
  // through live public horse rows; staff note access does not publish a
  // withheld subject, partner or foal, or change the stored pedigree pointers.
  const sireNotes = geneticActionPredicate(viewer, { column: "b.sire_id" }, ["private_health_read"]);
  const damNotes = geneticActionPredicate(viewer, { column: "b.dam_id" }, ["private_health_read"]);
  const notesSql = `CASE WHEN (${sireNotes.sql}) AND (${damNotes.sql}) THEN b.notes ELSE NULL END AS notes`;
  const notesBindings = [...sireNotes.bindings,...damNotes.bindings];
  const [horseResult, asSire, asDam, asFoal] = await db.batch([
    db.prepare("SELECT id,name_latin,name_native,sex_desc FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(horseId),
    db.prepare(`
      SELECT b.id,b.sire_id,d.id AS dam_id,b.covering_date,b.season,b.method,b.outcome,b.provenance,${notesSql},b.row_version,
             d.name_latin AS dam_name, d.name_native AS dam_name_native,
             f.name_latin AS foal_name, f.id AS foal_id
      FROM breeding_records b
      LEFT JOIN horses d ON d.id=b.dam_id AND d.deleted_at IS NULL AND d.is_active=1
      LEFT JOIN horses f ON f.id=b.foal_id AND f.deleted_at IS NULL AND f.is_active=1
      WHERE b.sire_id=? ORDER BY b.season DESC, b.id ASC LIMIT 200
    `).bind(...notesBindings,horseId),
    db.prepare(`
      SELECT b.id,s.id AS sire_id,b.dam_id,b.covering_date,b.season,b.method,b.outcome,b.provenance,${notesSql},b.row_version,
             s.name_latin AS sire_name, s.name_native AS sire_name_native,
             f.name_latin AS foal_name, f.id AS foal_id
      FROM breeding_records b
      LEFT JOIN horses s ON s.id=b.sire_id AND s.deleted_at IS NULL AND s.is_active=1
      LEFT JOIN horses f ON f.id=b.foal_id AND f.deleted_at IS NULL AND f.is_active=1
      WHERE b.dam_id=? ORDER BY b.season DESC, b.id ASC LIMIT 200
    `).bind(...notesBindings,horseId),
    db.prepare(`
      SELECT b.id,s.id AS sire_id,d.id AS dam_id,b.season,b.outcome,b.provenance,b.row_version,
             s.name_latin AS sire_name, s.name_native AS sire_name_native,
             d.name_latin AS dam_name, d.name_native AS dam_name_native
      FROM breeding_records b
      LEFT JOIN horses s ON s.id=b.sire_id AND s.deleted_at IS NULL AND s.is_active=1
      LEFT JOIN horses d ON d.id=b.dam_id AND d.deleted_at IS NULL AND d.is_active=1
      WHERE b.foal_id=? LIMIT 5
    `).bind(horseId),
  ]);
  const horse = horseResult.results?.[0];
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  // Master-Ai plan T03 (F01): private covering notes are stripped for
  // non-privileged viewers; registry facts stay public.
  const rowsAsRecords = <T,>(list: unknown[]): T[] => list.map((item) => {
    const row = item as Record<string, unknown>;
    // SQL already checked both parents; this scope only permits the pure
    // projection to retain those masked notes, never a client-provided flag.
    const scoped: PrivacyViewer | null = viewer && row.notes != null && Number(row.sire_id) > 0 && Number(row.dam_id) > 0
      ? { user: viewer.user, breedingNotesScope: { sireId: Number(row.sire_id), damId: Number(row.dam_id) } } : null;
    return projectBreedingRecord(row, scoped) as T;
  });
  return json({
    horse,
    as_sire: rowsAsRecords(asSire.results ?? []),
    as_dam: rowsAsRecords(asDam.results ?? []),
    birth_record: asFoal.results?.[0] ? projectBreedingRecord(asFoal.results[0] as Record<string, unknown>, viewer) : null,
  });
}

export async function adminAddBreedingRecord(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, horseId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = BreedingRecordSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_breeding", "Breeding record failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.sire_id === d.dam_id) throw new HttpError(400, "invalid_breeding", "Sire and dam must be different horses");
  const [sire, dam] = await Promise.all([
    env.DB.prepare("SELECT id,sex_desc FROM horses WHERE id=? AND deleted_at IS NULL").bind(d.sire_id).first<{ id: number; sex_desc: string | null }>(),
    env.DB.prepare("SELECT id,sex_desc FROM horses WHERE id=? AND deleted_at IS NULL").bind(d.dam_id).first<{ id: number; sex_desc: string | null }>(),
  ]);
  if (!sire || !dam) throw new HttpError(404, "not_found", "Sire or dam not found");
  // R59 (review fact-check #24): manual breeding entries validate the parents'
  // sexes so swapped sire/dam ids are caught at entry time. Historical derived
  // records are untouched by this rule.
  if (classifyBreedingSex(sire.sex_desc) === "female") {
    throw new HttpError(400, "invalid_breeding", `The selected sire is recorded as “${sire.sex_desc}” — check that sire and dam are not swapped`);
  }
  if (["male", "gelding"].includes(classifyBreedingSex(dam.sex_desc))) {
    throw new HttpError(400, "invalid_breeding", `The selected dam is recorded as “${dam.sex_desc}” — check that sire and dam are not swapped`);
  }
  if (![d.sire_id, d.dam_id, d.foal_id].includes(horseId)) throw new HttpError(400, "invalid_breeding", "The route horse must be a parent or foal in this record");
  if (d.foal_id != null && (d.foal_id === d.sire_id || d.foal_id === d.dam_id)) throw new HttpError(400, "invalid_breeding", "A foal cannot be its own parent");
  if (d.foal_id != null) {
    const foal = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(d.foal_id).first();
    if (!foal) throw new HttpError(404, "not_found", "Foal not found");
  }
  const season = resolveBreedingSeason(d.covering_date, d.season);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO breeding_records(sire_id,dam_id,covering_date,season,method,outcome,foal_id,notes,provenance)
      VALUES(?,?,?,?,?,?,?,?, 'user')
    `).bind(d.sire_id, d.dam_id, d.covering_date ?? null, season, d.method ?? null, d.outcome, d.foal_id ?? null, d.notes ?? null),
  ]);
  return json({ created: true }, { status: 201 });
}

// ---------------------------------------------------------------------------
// R88 agent plan P08: reviewed correction of reproduction/calendar facts.
//
// tools/audit-breeding-dates.mjs surfaces anomalies read-only (it cannot
// write); THIS handler is the only reviewed correction path for
// covering_date/season. Every correction:
//   - requires horse.edit + CSRF (staff editorial action);
//   - requires a reason (human review trail);
//   - revalidates the new values with the SAME rules as create
//     (Gregorian day precision; season is Solar Hijri; date/season match);
//   - writes the guarded UPDATE and an audit_events row (before_json carries
//     the OLD values) in ONE batch — the audit trail is exactly as truthful
//     as the state change.
// Historical seasons are corrected one row at a time; never mass-converted.
// ---------------------------------------------------------------------------

const BreedingCorrectionSchema = z.object({
  expected_version: z.number().int().positive().optional(),
  operation_id: z.string().uuid().optional(),
  covering_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  season: z.number().int().min(1380).max(1500).nullable().optional(),
  reason: z.string().trim().min(10).max(500),
});

export async function adminCorrectBreedingRecord(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, recordId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = BreedingCorrectionSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_breeding_correction", "Correction failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.covering_date === undefined && d.season === undefined) {
    throw new HttpError(400, "invalid_breeding_correction", "Provide a new covering_date or season (at least one)");
  }

  if (d.expected_version === undefined) throw new HttpError(428, "expected_version_required", "Reload the breeding record before correcting it");
  const operationId = d.operation_id ?? crypto.randomUUID();
  // Bind a retry to the exact actor, record, version and submitted intent. A
  // per-attempt token prevents a losing concurrent retry from appending audit.
  const requestJson = JSON.stringify({ record_id: recordId, expected_version: d.expected_version,
    covering_date: d.covering_date, season: d.season, reason: d.reason });
  type Receipt = { actor_user_id: string; request_json: string; before_json: string; after_json: string };
  const replay = async (): Promise<Response | null> => {
    const receipt = await env.DB.prepare("SELECT actor_user_id,request_json,before_json,after_json FROM breeding_record_corrections WHERE operation_id=?")
      .bind(operationId).first<Receipt>();
    if (!receipt) return null;
    if (receipt.actor_user_id !== auth.user.id || receipt.request_json !== requestJson) {
      throw new HttpError(409, "operation_conflict", "This correction reference was already used for a different request");
    }
    const before = JSON.parse(receipt.before_json) as Record<string, unknown>;
    const after = JSON.parse(receipt.after_json) as Record<string, unknown>;
    return json({ record: after, replayed: true, operation_id: operationId,
      correction: { old: before, new: after, reason: d.reason, corrected_by: auth.user.id } });
  };
  const existing = await replay();
  if (existing) return existing;

  const record = await env.DB.prepare(
    "SELECT id,sire_id,dam_id,covering_date,season,row_version FROM breeding_records WHERE id=?",
  ).bind(recordId).first<{ id: number; sire_id: number; dam_id: number; covering_date: string | null; season: number | null; row_version: number }>();
  if (!record) throw new HttpError(404, "not_found", "Breeding record not found");
  if (Number(record.row_version) !== d.expected_version) throw new HttpError(409, "correction_conflict", "The record changed; review the current version before submitting your correction", { current_version: Number(record.row_version) });

  // The corrected record must satisfy the SAME calendar rules as a fresh
  // create: explicit season is Solar Hijri, covering date is a real Gregorian
  // day, and the two cannot disagree.
  const newCovering = d.covering_date === undefined ? record.covering_date : d.covering_date;
  const newSeason = d.season === undefined ? record.season : d.season;
  let season: number;
  try {
    season = resolveBreedingSeason(newCovering, newSeason);
  } catch (error) {
    if (error instanceof HttpError) throw new HttpError(400, "invalid_breeding_correction", error.message);
    throw error;
  }

  const writeToken = crypto.randomUUID();
  const before = { covering_date: record.covering_date, season: record.season, row_version: Number(record.row_version) };
  const after = { id: record.id, sire_id: record.sire_id, dam_id: record.dam_id,
    covering_date: newCovering, season, row_version: d.expected_version + 1 };
  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  let update: D1Result<unknown>;
  try { [update] = await env.DB.batch([
    env.DB.prepare(`UPDATE breeding_records SET covering_date=?, season=?, row_version=row_version+1, last_correction_id=?
      WHERE id=? AND row_version=?
        AND NOT EXISTS(SELECT 1 FROM breeding_record_corrections WHERE operation_id=?)
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))`)
      .bind(newCovering, season, writeToken, recordId, d.expected_version, operationId, auth.user.id),
    env.DB.prepare(`INSERT INTO breeding_record_corrections(operation_id,write_token,record_id,actor_user_id,expected_version,request_json,before_json,after_json)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM breeding_records WHERE id=? AND last_correction_id=? AND row_version=?)`)
      .bind(operationId, writeToken, recordId, auth.user.id, d.expected_version, requestJson, beforeJson, afterJson,
        recordId, writeToken, d.expected_version + 1),
    env.DB.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM breeding_record_corrections WHERE operation_id=? AND write_token=?)
    `).bind(
      auth.user.id,
      "breeding.record.corrected",
      "breeding_record",
      String(recordId),
      beforeJson,
      JSON.stringify({ ...after, reason: d.reason, operation_id: operationId }),
      operationId, writeToken,
    ),
  ]); } catch (error) {
    // A concurrent request can claim the same operation on another row after
    // preflight. The unique receipt rolls that whole losing transaction back;
    // return the prior result/conflict without misreporting it as a server error.
    const repeated = await replay();
    if (repeated) return repeated;
    throw error;
  }
  if (Number(update?.meta.changes ?? 0) !== 1) {
    const repeated = await replay();
    if (repeated) return repeated;
    throw new HttpError(409, "correction_conflict", "The record or your editing authority changed before the correction landed; reload and retry");
  }

  return json({
    record: after,
    replayed: false,
    operation_id: operationId,
    correction: {
      old: before,
      new: after,
      reason: d.reason,
      corrected_by: auth.user.id,
    },
  });
}

// ---------------------------------------------------------------------------
// R88 agent plan P06: append-only reviewed-interpretation provenance.
//
// A qualified reviewer records a structured interpretation against a specific
// catalog version. The laboratory report (result, result_interpretation,
// lab_name, lab_accession, notes) is NEVER modified — scientific history is
// preserved, and the append-only trail lives in these provenance columns plus
// the audit_events row this handler writes in the same batch. Report
// authenticity (issuer attestations, T05) and clinical diagnosis (never
// automated) stay separate concerns.
// ---------------------------------------------------------------------------

const ReviewedInterpretationSchema = z.object({
  operation_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  result_status: z.enum(["clear", "carrier", "affected", "recorded_uninterpreted"]),
  verification: z.enum(["unchanged", "confirm_record", "withdraw"]),
  evidence_ref: z.string().trim().min(3).max(200).nullable().optional(),
  legacy_origin_acknowledged: z.boolean().default(false),
  reason: z.string().trim().min(10).max(1000),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function recordGeneticInterpretation(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, testId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  requireCsrf(request, auth);
  const permissions = ["genetic_review", "genetic_evidence_read"] as const;
  const access = geneticActionPredicate(auth, { column: "g.horse_id" }, permissions);
  const test = await env.DB.prepare(`SELECT g.id,g.horse_id,g.test_type,g.test_category,g.result,g.verified,
      g.public_disclosed,g.row_version,g.created_by_user_id,g.interpretation_version,g.interpreted_at,g.catalog_reviewed_by
    FROM genetic_tests g WHERE g.id=? AND (${access.sql})`)
    .bind(testId,...access.bindings).first<{
      id: number; horse_id: number; test_type: string; test_category: string; result: string; verified: number;
      public_disclosed: number; row_version: number; created_by_user_id: string | null;
      interpretation_version: string | null; interpreted_at: string | null; catalog_reviewed_by: string | null;
    }>();
  if (!test) throw new HttpError(403, "genetic_review_required", "Current evidence-read and review permissions are required for this record");
  const parsed = ReviewedInterpretationSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_interpretation", "Interpretation failed validation", parsed.error.flatten());
  const d = parsed.data;
  const context: GeneticOperationContext = { viewer: auth, horseId: Number(test.horse_id), operationId: d.operation_id,
    action: "interpretation", requestJson: JSON.stringify({ test_id: testId, ...d }), permissions };
  const prior = await geneticOperationReceipt<GeneticInterpretationReceipt>(env.DB, context);
  if (prior) return json({ review: prior, operation_id: d.operation_id, replayed: true });
  if (Number(test.row_version) !== d.expected_version) throw new HttpError(409, "genetic_review_conflict", "The record changed; reload it before reviewing");
  if (test.created_by_user_id === auth.user.id && d.verification !== "withdraw") {
    throw new HttpError(403, "independent_reviewer_required", "A submitter cannot approve or interpret their own report; request an independent reviewer");
  }
  if (d.verification === "confirm_record" && !d.evidence_ref) {
    throw new HttpError(422, "review_evidence_required", "Record confirmation requires a supporting report reference");
  }
  if (d.verification === "confirm_record" && !test.created_by_user_id && !d.legacy_origin_acknowledged) {
    throw new HttpError(422, "legacy_origin_acknowledgement_required", "This legacy record has no known submitter; explicitly acknowledge that limitation before confirming it");
  }
  const catalogStatus = test.test_category === "disease" ? interpretAssayResult(test.test_type, test.result).status : "recorded_uninterpreted";
  if (d.result_status !== catalogStatus) throw new HttpError(422, "catalog_status_mismatch", "The chosen status must match the current catalog interpretation of the unchanged report");
  const verified = d.verification === "confirm_record" ? 1 : d.verification === "withdraw" ? 0 : Number(test.verified);
  const publicationWithdrawn = Number(test.public_disclosed) === 1 && d.verification !== "unchanged" && (verified === 0 || Number(test.verified) === 0);
  const receipt: GeneticInterpretationReceipt = { operation_id: d.operation_id, test_id: testId, horse_id: Number(test.horse_id),
    row_version: d.expected_version + 1, verified, result_status: d.result_status, interpretation_version: ASSAY_CATALOG_VERSION,
    verification_scope: "record_review_not_issuer_attestation", scope: "recorded_genotype_only", clinical_diagnosis: false,
    publication_withdrawn: publicationWithdrawn };
  const attemptId = crypto.randomUUID(), withdrawalId = crypto.randomUUID();
  const guard = geneticActionPredicate(auth, Number(test.horse_id), permissions);
  let committed = false;
  try {
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE genetic_tests SET row_version=row_version WHERE id=?").bind(testId),
      env.DB.prepare(`INSERT INTO genetic_evidence_operations(operation_id,attempt_id,test_id,horse_id,actor_user_id,action,request_json,decision_json,private_detail_json)
        SELECT ?,?,g.id,g.horse_id,?,'interpretation',?,?,? FROM genetic_tests g
        WHERE g.id=? AND g.horse_id=? AND g.row_version=? AND g.test_type=? AND g.result=? AND g.verified=?
          AND COALESCE(g.public_disclosed,0)=? AND (g.created_by_user_id IS NULL OR g.created_by_user_id<>? OR ?='withdraw')
          AND (g.created_by_user_id IS NOT NULL OR ?=1 OR ?<>'confirm_record')
          AND (${guard.sql}) AND NOT EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=?)
        ON CONFLICT(operation_id) DO NOTHING`)
        .bind(d.operation_id,attemptId,auth.user.id,context.requestJson,JSON.stringify(receipt),
          JSON.stringify({ before: test, after: receipt, reason: d.reason, note: d.note ?? null, evidence_ref: d.evidence_ref ?? null,
            legacy_origin_acknowledged: d.legacy_origin_acknowledged }),
          testId,test.horse_id,d.expected_version,test.test_type,test.result,Number(test.verified),Number(test.public_disclosed),auth.user.id,d.verification,d.legacy_origin_acknowledged ? 1 : 0,d.verification,
          ...guard.bindings,d.operation_id),
      // Quality withdrawal may remove exposure; confirming an old unverified
      // row never reuses an old publication flag to publish without authority.
      env.DB.prepare(`INSERT INTO publication_decisions(id,subject_kind,record_id,horse_id,decision,decision_version,basis,purpose,evidence_ref,reason,actor_user_id,expected_version)
        SELECT ?,'genetic_test',CAST(g.id AS TEXT),g.horse_id,'withdraw',
          (SELECT COALESCE(MAX(d.decision_version),0)+1 FROM publication_decisions d WHERE d.subject_kind='genetic_test' AND d.record_id=CAST(g.id AS TEXT)),
          'staff_publication','Verification review requires a fresh publication decision',NULL,
          'Publication withdrawn by a verification review; no private report content is included',?,
          (SELECT COALESCE(MAX(d.decision_version),0) FROM publication_decisions d WHERE d.subject_kind='genetic_test' AND d.record_id=CAST(g.id AS TEXT))
        FROM genetic_tests g WHERE g.id=? AND ?=1
          AND EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=? AND attempt_id=?)`)
        .bind(withdrawalId,auth.user.id,testId,publicationWithdrawn ? 1 : 0,d.operation_id,attemptId),
      // Withdrawal removes trust; it must not stamp a new positive catalog
      // review or let a submitter replace the independent review's author.
      env.DB.prepare(`UPDATE genetic_tests SET
          interpretation_version=CASE WHEN ?='withdraw' THEN interpretation_version ELSE ? END,
          interpreted_at=CASE WHEN ?='withdraw' THEN interpreted_at ELSE CURRENT_TIMESTAMP END,
          catalog_reviewed_by=CASE WHEN ?='withdraw' THEN catalog_reviewed_by ELSE ? END,
          verified=?,row_version=row_version+1,public_disclosed=CASE WHEN ?=1 THEN 0 ELSE public_disclosed END
        WHERE id=? AND EXISTS(SELECT 1 FROM genetic_evidence_operations WHERE operation_id=? AND attempt_id=?)`)
        .bind(d.verification,ASSAY_CATALOG_VERSION,d.verification,d.verification,auth.user.id,verified,publicationWithdrawn ? 1 : 0,testId,d.operation_id,attemptId),
      env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json)
        SELECT actor_user_id,'genetic.interpretation.recorded','genetic_test',CAST(test_id AS TEXT),?
        FROM genetic_evidence_operations WHERE operation_id=? AND attempt_id=?`)
        .bind(JSON.stringify({ operation_id: d.operation_id, row_version: receipt.row_version, authority_scope: "genetic_review", publication_withdrawn: publicationWithdrawn }),d.operation_id,attemptId),
      env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json)
        SELECT actor_user_id,'genetic.disclosure.updated','genetic_test',record_id,?
        FROM publication_decisions WHERE id=?`)
        .bind(JSON.stringify({ operation_id: d.operation_id, public_disclosed: false, basis: "verification_review" }),withdrawalId),
    ]);
    committed = Number(results[1]?.meta.changes ?? 0) === 1;
  } catch (cause) {
    if (!isGeneticReceiptConflict(cause)) throw cause;
  }
  const saved = await geneticOperationReceipt<GeneticInterpretationReceipt>(env.DB, context);
  if (!saved) throw new HttpError(409, "genetic_review_conflict", "The report, publication or authority changed; reload before retrying");
  return json({ review: saved, operation_id: d.operation_id, replayed: !committed });
}

export async function geneticReviewHistory(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, testId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  const guard = geneticActionPredicate(auth, { column: "g.horse_id" }, ["genetic_evidence_read"]);
  const rows = (await env.DB.prepare(`SELECT g.id,g.horse_id,g.row_version,g.verified,
      o.operation_id,o.action,o.actor_user_id,o.private_detail_json AS decision_json,o.created_at
    FROM genetic_tests g LEFT JOIN genetic_evidence_operations o ON o.test_id=g.id AND o.action IN ('interpretation','pairing_review')
    WHERE g.id=? AND (${guard.sql}) ORDER BY o.created_at DESC,o.operation_id DESC LIMIT 201`)
    .bind(testId,...guard.bindings).all<Record<string, unknown>>()).results ?? [];
  if (!rows.length) throw new HttpError(403, "genetic_evidence_read_required", "Current evidence-read permission is required for this record");
  const first = rows[0];
  return json({ test: { id: first.id, horse_id: first.horse_id, row_version: first.row_version, verified: first.verified },
    decisions: rows.filter(row => row.operation_id != null).slice(0,200).map(row => ({ operation_id: row.operation_id,
      action: row.action, actor_user_id: row.actor_user_id, decision_json: row.decision_json, created_at: row.created_at })),
    limit: 200, truncated: rows.length > 200 });
}

// R140-A (second Master-AI audit): the publication switch for health-sensitive
// results. Verification is a quality gate; this is the separate, explicit
// publication decision (owner consent recorded by staff, or a staff
// publication). The toggle is audited in the same batch and never touches the
// verified flag or the laboratory payload — the projection still refuses to
// publish unverified rows, so disclosure alone can never leak raw data.
//
// R144-D02 (Master-AI plan): the bare boolean becomes a VERSIONED, append-only
// publication decision (who/basis/purpose/evidence/reason + per-record
// decision_version). A stale expected_version is rejected 409 so a lagging
// client can never overwrite a newer withdrawal; the legacy boolean stays as
// the materialized projection updated in the same transactional batch.
const DisclosureSchema = z.object({
  public_disclosed: z.boolean(),
  expected_decision_version: z.number().int().min(0),
  basis: z.enum(["owner_consent", "staff_publication", "official_basis"]).default("staff_publication"),
  purpose: z.string().trim().max(500).nullable().optional(),
  evidence_ref: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().min(3).max(1000),
});

export async function adminSetGeneticTestDisclosure(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, testId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  requireCsrf(request, auth);
  const parsed = DisclosureSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_disclosure", "Disclosure state failed validation", parsed.error.flatten());

  const permission = geneticActionPredicate(auth, { column: "g.horse_id" }, ["genetic_publish"]);
  const test = await env.DB.prepare(`SELECT g.id,g.horse_id,g.test_type,g.test_category,g.verified,g.public_disclosed
    FROM genetic_tests g WHERE g.id=? AND (${permission.sql})`)
    .bind(testId,...permission.bindings).first<{ id: number; horse_id: number; test_type: string; test_category: string; verified: number; public_disclosed: number }>();
  if (!test) throw new HttpError(403, "genetic_publication_required", "Current publication permission is required for this record");

  const desired = parsed.data.public_disclosed ? "publish" : "withdraw";
  const result = await recordPublicationDecision(env.DB, {
    testId,
    horseId: test.horse_id,
    desired,
    basis: parsed.data.basis,
    purpose: parsed.data.purpose ?? null,
    evidenceRef: parsed.data.evidence_ref ?? null,
    reason: parsed.data.reason,
    actorUserId: auth.user.id,
    actorSessionId: auth.sessionId,
    actor: auth,
    expectedVersion: parsed.data.expected_decision_version,
  });
  const after = { id: test.id, horse_id: test.horse_id, test_type: test.test_type, test_category: test.test_category,
    verified: test.verified, public_disclosed: result.disclosed ? 1 : 0 };
  // R142-B02 (Master-AI): a disclosure withdrawal must not keep serving the
  // pre-withdrawal projection from the edge. Best-effort same-colo purge of
  // the horse's cached profile/genetics copies; the stale window for the
  // genetics read is disabled worker-side (staleEligible) because Cloudflare's
  // Cache API delete is data-center-local and cannot prove global withdrawal.
  try {
    // Same typed access as the worker's cachesDefault(): the generated types
    // only model the standard DOM CacheStorage surface.
    const colo = (caches as unknown as { default?: { delete: (url: URL) => Promise<boolean> } } | undefined)?.default;
    if (test.horse_id && colo && typeof colo.delete === "function") {
      await Promise.all([
        `/api/horses/${test.horse_id}`,
        `/api/horses/${test.horse_id}/genetics`,
      ].map(async (path) => {
        await colo.delete(new URL(path, "https://iraho.ir")).catch(() => undefined);
        const stale = new URL(`${path}${path.includes("?") ? "&" : "?"}__edge_stale=1`, "https://iraho.ir");
        await colo.delete(stale).catch(() => undefined);
      }));
    }
  } catch { // runtime without the Cache API — containment stays worker-side
  }
  return json({
    test: after,
    changed: result.changed,
    ...(result.changed ? {} : { note: "Disclosure state already set" }),
    decision: result.decision,
    decision_version: result.current_version,
  });
}

// R144-D02: the explainable decision history for one health result — who
// decided what, on which basis, at which version. Metadata only: the
// confidential supporting evidence stays in its own access path.
export async function adminGetGeneticTestDisclosureHistory(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, testId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  const publish = geneticActionPredicate(auth, { column: "g.horse_id" }, ["genetic_publish"]);
  const review = geneticActionPredicate(auth, { column: "g.horse_id" }, ["genetic_review", "genetic_evidence_read"]);
  // Metadata and decisions use one statement/snapshot, including empty history.
  const rows = (await env.DB.prepare(`SELECT g.id AS test_id,g.horse_id AS test_horse_id,g.test_type,g.test_category,g.verified,g.public_disclosed,
      d.id,d.subject_kind,d.record_id,d.horse_id,d.decision,d.decision_version,d.basis,d.purpose,d.evidence_ref,d.reason,d.actor_user_id,d.expected_version,d.created_at
    FROM genetic_tests g LEFT JOIN publication_decisions d ON d.subject_kind='genetic_test' AND d.record_id=CAST(g.id AS TEXT)
    WHERE g.id=? AND ((${publish.sql}) OR (${review.sql})) ORDER BY d.decision_version ASC`)
    .bind(testId,...publish.bindings,...review.bindings).all<Record<string, unknown>>()).results ?? [];
  if (!rows.length) throw new HttpError(403, "genetic_publication_history_required", "Current publication or evidence-review permission is required for this record");
  const first = rows[0];
  const test = { id: first.test_id, horse_id: first.test_horse_id, test_type: first.test_type, test_category: first.test_category,
    verified: first.verified, public_disclosed: Number(first.public_disclosed) };
  const decisions = rows.filter(row => row.id != null).map(row => ({ id: row.id, subject_kind: row.subject_kind,
    record_id: row.record_id, horse_id: row.horse_id, decision: String(row.decision) as "publish" | "withdraw", decision_version: Number(row.decision_version),
    basis: row.basis, purpose: row.purpose, evidence_ref: row.evidence_ref, reason: row.reason, actor_user_id: row.actor_user_id,
    expected_version: row.expected_version, created_at: row.created_at }));
  const state = effectiveDisclosure(test, decisions);
  return json({ test, effective: { disclosed: state.disclosed, source: state.source, latest_version: state.latest_version,
    materialized_matches: state.materialized_matches }, decisions });
}
