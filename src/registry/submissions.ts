import { z } from "zod";
import { HORSE_FIELD_SCHEMAS, parseHorseFieldValue, type HorseFieldValue } from "./validation";
import { isTypedDateChange } from "./relations";
import { canonicalJson } from "../marketplace/commands";
import { registrationDetailCreateStatements, validateRegistrationDetails } from "./registrationDetails";
import { identifierChangePlans } from "./identifiers";

/**
 * Master-Ai plan T11: complete new-horse submission and review.
 *
 * A submission is the STRUCTURED payload of a create_horse change request:
 * everything the registry needs to create the canonical record in one atomic
 * reviewed batch — names, identifiers, parents, people links — plus the
 * explicit source assertions the plan demands.
 *
 * Design decisions (pinned by tests/unit/registrySubmissions.test.ts):
 *
 *   - Native-only names are permitted. The Latin name is optional content,
 *     not invented mandatory content: when the submitter provides none, the
 *     canonical name_latin column receives the native name VERBATIM (never a
 *     fabricated transliteration) and submission_json keeps the honest record
 *     that no Latin form exists.
 *   - Parents are selected as EXISTING horse ids, or explicitly marked
 *     unresolved with a source assertion. Parent profiles are NEVER created
 *     automatically from free text — duplicate parents are impossible by
 *     construction.
 *   - The approval batch is ONE transaction: canonical horse insert +
 *     identifier claims + permitted relationships + initial owner grant +
 *     approval decision + revision bump. Any failure (duplicate identifier,
 *     lost review race) leaves the submission pending and writes NO partial
 *     canonical horse. The fresh horse id is resolved INSIDE the batch by
 *     subquery on last_mutation_id, so nothing depends on a client-supplied
 *     or intermediate-read id.
 *   - canonicalApplied / canonical_horse_id are reported only after the
 *     horse row is read back from the database.
 */

/** A parent the submitter could not resolve to a registry record. */
const UnresolvedParentSchema = z
  .object({
    name_native: z.string().trim().min(2).max(200).optional(),
    name_latin: z.string().trim().min(2).max(200).optional(),
    note: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((value) => Boolean(value.name_native || value.name_latin), {
    message: "An unresolved parent needs at least a name",
  });

export type UnresolvedParent = z.infer<typeof UnresolvedParentSchema>;

const SUBMISSION_TEXT_FIELDS = [
  "register_no",
  "microchip_no",
  "birth_place_desc",
  "breed_desc",
  "sex_desc",
  "color_desc",
  "description",
  "main_strain_desc",
  "sub_strain_desc",
] as const;

export const HorseSubmissionSchema = z
  .object({
    name_native: HORSE_FIELD_SCHEMAS.name_native.optional(),
    name_latin: HORSE_FIELD_SCHEMAS.name_latin.optional(),
    register_no: HORSE_FIELD_SCHEMAS.register_no.optional(),
    microchip_no: HORSE_FIELD_SCHEMAS.microchip_no.optional(),
    passport_no: HORSE_FIELD_SCHEMAS.passport_no.optional(),
    passport_issuer: HORSE_FIELD_SCHEMAS.passport_issuer.optional(),
    passport_issue_date: HORSE_FIELD_SCHEMAS.passport_issue_date.optional(),
    passport_expiry: HORSE_FIELD_SCHEMAS.passport_expiry.optional(),
    uel_no: HORSE_FIELD_SCHEMAS.uel_no.optional(),
    life_number: HORSE_FIELD_SCHEMAS.life_number.optional(),
    foreign_registration_no: HORSE_FIELD_SCHEMAS.foreign_registration_no.optional(),
    foreign_registration_issuer: HORSE_FIELD_SCHEMAS.foreign_registration_issuer.optional(),
    birth_name: HORSE_FIELD_SCHEMAS.birth_name.optional(),
    previous_names: HORSE_FIELD_SCHEMAS.previous_names.optional(),
    height_cm: HORSE_FIELD_SCHEMAS.height_cm.optional(),
    markings: HORSE_FIELD_SCHEMAS.markings.optional(),
    life_status: HORSE_FIELD_SCHEMAS.life_status.optional(),
    death_date: HORSE_FIELD_SCHEMAS.death_date.optional(),
    birth_year: HORSE_FIELD_SCHEMAS.birth_year.optional(),
    birth_place_desc: HORSE_FIELD_SCHEMAS.birth_place_desc.optional(),
    breed_desc: HORSE_FIELD_SCHEMAS.breed_desc.optional(),
    sex_desc: HORSE_FIELD_SCHEMAS.sex_desc.optional(),
    color_desc: HORSE_FIELD_SCHEMAS.color_desc.optional(),
    description: HORSE_FIELD_SCHEMAS.description.optional(),
    main_strain_desc: HORSE_FIELD_SCHEMAS.main_strain_desc.optional(),
    sub_strain_desc: HORSE_FIELD_SCHEMAS.sub_strain_desc.optional(),
    father_horse_id: z.number().int().positive().nullable().optional(),
    mother_horse_id: z.number().int().positive().nullable().optional(),
    father_unresolved: UnresolvedParentSchema.nullable().optional(),
    mother_unresolved: UnresolvedParentSchema.nullable().optional(),
    breeder_person_id: z.number().int().positive().nullable().optional(),
    current_owner_person_id: z.number().int().positive().nullable().optional(),
    // T12: typed birth date + public places on the owner submission path.
    birth_date: HORSE_FIELD_SCHEMAS.birth_date.optional(),
    birth_city: HORSE_FIELD_SCHEMAS.birth_city.optional(),
    birth_province: HORSE_FIELD_SCHEMAS.birth_province.optional(),
    keeping_city: HORSE_FIELD_SCHEMAS.keeping_city.optional(),
    keeping_province: HORSE_FIELD_SCHEMAS.keeping_province.optional(),
  })
  // Unknown keys — including a client-declared id — are REJECTED: canonical
  // ids are allocated by the database at approval time, never chosen by the
  // submitter.
  .strict()
  .superRefine((value, ctx) => {
    try { validateRegistrationDetails(value); }
    catch (error) { ctx.addIssue({ code: "custom", path: ["passport_no"], message: error instanceof Error ? error.message : "Invalid registration details" }); }
    if (!value.name_latin && !value.name_native) {
      ctx.addIssue({ code: "custom", path: ["name_native"], message: "At least one name (native or Latin) is required" });
    }
    if (value.father_horse_id != null && value.father_unresolved) {
      ctx.addIssue({ code: "custom", path: ["father_unresolved"], message: "Provide the sire as an existing horse OR as an unresolved assertion, not both" });
    }
    if (value.mother_horse_id != null && value.mother_unresolved) {
      ctx.addIssue({ code: "custom", path: ["mother_unresolved"], message: "Provide the dam as an existing horse OR as an unresolved assertion, not both" });
    }
    if (value.father_horse_id != null && value.father_horse_id === value.mother_horse_id) {
      ctx.addIssue({ code: "custom", path: ["father_horse_id"], message: "The same horse cannot be both sire and dam" });
    }
  });

export type HorseSubmission = z.infer<typeof HorseSubmissionSchema>;

/**
 * The canonical columns a submission may set, in INSERT order. The id is
 * deliberately absent — canonical ids are allocated by the database only.
 */
export const SUBMISSION_HORSE_COLUMNS = [
  "name_latin",
  "name_native",
  "register_no",
  "microchip_no",
  "father_id",
  "mother_id",
  "birth_year",
  "birth_date_value",
  "birth_date_precision",
  "birth_date_calendar",
  "birth_place_desc",
  "birth_city",
  "birth_province",
  "keeping_city",
  "keeping_province",
  "breed_desc",
  "sex_desc",
  "color_desc",
  "description",
  "main_strain_desc",
  "sub_strain_desc",
  "last_mutation_id",
] as const;

export function submissionHorseColumns(): string[] {
  return [...SUBMISSION_HORSE_COLUMNS];
}

/**
 * Bind values for the conditioned canonical INSERT. Values are normalized
 * through the shared T07 field rules (whitespace transforms applied); a
 * native-only submission stores its native name verbatim in name_latin
 * because the column is NOT NULL — no transliteration is ever invented.
 */
export function horseInsertValuesForSubmission(submission: HorseSubmission, mutationId: string): HorseFieldValue[] {
  const latin = submission.name_latin ?? submission.name_native ?? "";
  // T12: the typed birth date parses through the shared calendar rules; a
  // typed date seeds the legacy birth_year bucket when no explicit year was
  // supplied, so search/filters stay honest without inventing precision.
  const birthDateParsed = parseHorseFieldValue("birth_date", submission.birth_date ?? null);
  const birthDate = birthDateParsed.ok && isTypedDateChange(birthDateParsed.value) ? birthDateParsed.value : null;
  const birthYear = submission.birth_year ?? (birthDate?.date ? birthDate.gregorianYear : null);
  return [
    latin,
    submission.name_native ?? null,
    submission.register_no ?? null,
    submission.microchip_no ?? null,
    submission.father_horse_id ?? null,
    submission.mother_horse_id ?? null,
    birthYear,
    birthDate?.date ? birthDate.date.value : null,
    birthDate?.date ? birthDate.date.precision : null,
    birthDate?.date ? birthDate.date.calendar : null,
    submission.birth_place_desc ?? null,
    submission.birth_city ?? null,
    submission.birth_province ?? null,
    submission.keeping_city ?? null,
    submission.keeping_province ?? null,
    submission.breed_desc ?? null,
    submission.sex_desc ?? null,
    submission.color_desc ?? null,
    submission.description ?? null,
    submission.main_strain_desc ?? null,
    submission.sub_strain_desc ?? null,
    mutationId,
  ];
}

// ---------------------------------------------------------------------------
// State machine + status surface.
// ---------------------------------------------------------------------------

/**
 * Computed review status for API surfaces. 'needs_changes' is stored as
 * status='draft' + review_outcome='needs_changes' (the 0001 CHECK cannot be
 * altered in place; a table rebuild would cascade-delete every item row), so
 * this helper keeps the five-state workflow the plan asks for visible:
 * draft -> pending -> needs_changes -> draft -> ... -> approved/rejected.
 */
export function submissionReviewStatus(row: { status: string; review_outcome?: string | null }): string {
  if (row.status === "draft" && row.review_outcome === "needs_changes") return "needs_changes";
  return row.status;
}

// ---------------------------------------------------------------------------
// Atomic approval batch SQL.
//
// Exported as stable template constants so the regression suites can pin the
// EXACT statements the builder emits (source-anchored, never drifting).
// ---------------------------------------------------------------------------

/** Canonical insert, conditioned on the request still being undecided. */
export const SUBMISSION_HORSE_INSERT_SQL = `INSERT INTO horses(${SUBMISSION_HORSE_COLUMNS.join(",")})
  SELECT ${SUBMISSION_HORSE_COLUMNS.map(() => "?").join(",")}
  WHERE EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))`;

/**
 * Identifier claim INSIDE the same transaction. The fresh horse's id is
 * resolved by subquery on last_mutation_id — no intermediate read, no
 * client-supplied id, no follow-up batch that could leave a partial horse.
 */
export const SUBMISSION_IDENTIFIER_CLAIM_SQL = `INSERT INTO horse_identifiers(kind,issuer_namespace,normalized_value,raw_value,horse_id,status,source_id,created_at,updated_at)
  SELECT ?,?,?,?,(SELECT id FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL),'live',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  WHERE EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)`;

/** Permitted relationship (owner/breeder) on the created horse. */
export const SUBMISSION_PEOPLE_LINK_SQL = `INSERT OR IGNORE INTO horse_people(horse_id,person_id,role,is_current,created_at)
  SELECT (SELECT id FROM horses WHERE last_mutation_id=?),?,'owner',1,CURRENT_TIMESTAMP
  WHERE EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)
    AND EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))`;

/**
 * Initial owner grant: minted only when the submitter declared a current
 * owner AND that person is a VERIFIED link of the submitter (T10 doctrine —
 * legal ownership and permission stay explicit), conditioned on both the
 * creation landing and the request still being undecided.
 */
export const SUBMISSION_GRANT_SQL = `INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,grantee_organization_id,relationship,actions,basis,basis_ref,granted_by_user_id,valid_from,created_at)
  SELECT ?,(SELECT id FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL),?,NULL,'owner','manage_profile,upload_media,create_listing,manage_inquiries','admin_grant',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  WHERE EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)
    AND EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))
    AND EXISTS(SELECT 1 FROM user_person_links WHERE user_id=? AND person_id=? AND status='verified')`;

/** Approval decision — only lands after the canonical horse did. */
export const SUBMISSION_DECISION_SQL = `UPDATE change_requests SET status='approved',reviewed_by_user_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,review_outcome='approved',canonical_horse_id=(SELECT id FROM horses WHERE last_mutation_id=? AND deleted_at IS NULL)
  WHERE id=? AND status IN ('pending','draft')
  AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)`;

/** needs_changes: back to draft with a recorded outcome, zero canonical effects. */
export const SUBMISSION_NEEDS_CHANGES_SQL = `UPDATE change_requests SET status='draft',reviewed_by_user_id=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,review_outcome='needs_changes'
  WHERE id=? AND status IN ('pending','draft')`;

/** Revision bump + analytics staleness, only when the creation landed. */
export const SUBMISSION_REVISION_BUMP_SQL = `UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP WHERE id=1
  AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)`;

/** Live-horse counter, only when the creation landed. */
export const SUBMISSION_COUNTER_BUMP_SQL = `UPDATE registry_runtime_counters SET active_horse_count=active_horse_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=1
  AND EXISTS(SELECT 1 FROM horses WHERE last_mutation_id=?)`;

export interface SubmissionApprovalParams {
  db: D1Database;
  changeRequestId: string;
  submission: HorseSubmission;
  submitterUserId: string;
  reviewerUserId: string;
  mutationId: string;
  reviewNote: string | null;
  identifierTableReady: boolean;
  /** Grant id allocated by the caller (crypto.randomUUID). */
  grantId: string;
}

export interface SubmissionApprovalStatements {
  /** The conditioned canonical INSERT — always index 1 (after the intent). */
  horseInsertStatement: D1PreparedStatement;
  /** Identifier claims + people links + grant + decision + bumps. */
  afterInsertStatements: D1PreparedStatement[];
  /** The approval decision statement (also inside afterInsertStatements) — exposed so the caller can locate its result row in the batch. */
  decisionStatement: D1PreparedStatement;
  /** Identifier kind/value pairs for duplicate-identifier error translation. */
  identifierChanges: Record<string, HorseFieldValue>;
}

/**
 * Build the ONE-transaction approval batch for a create_horse submission.
 * Statement order (all inside the caller's db.batch, which D1 runs as a
 * single transaction):
 *
 *   0. canonical mutation intent            (caller adds — audit journal)
 *   1. conditioned canonical horse INSERT
 *   2. identifier claims (subquery id)
 *   3. people links (owner, breeder)
 *   4. initial owner grant (linked-verified owners only)
 *   5. approval decision (conditioned on the horse landing)
 *   6. revision bump + live counter
 */
export function buildSubmissionApprovalStatements(params: SubmissionApprovalParams): SubmissionApprovalStatements {
  const { db, submission, mutationId } = params;
  const values = horseInsertValuesForSubmission(submission, mutationId);
  const horseInsertStatement = db
    .prepare(SUBMISSION_HORSE_INSERT_SQL)
    .bind(...values, params.changeRequestId);

  const afterInsertStatements: D1PreparedStatement[] = registrationDetailCreateStatements(db, submission as Record<string, unknown>, mutationId);

  // Identifier claims: register_no + microchip_no in the SAME transaction.
  const identifierChanges: Record<string, HorseFieldValue> = {};
  if (params.identifierTableReady) {
    for (const field of ["register_no", "microchip_no", "passport_no", "uel_no", "life_number", "foreign_registration_no"] as const) {
      const raw = submission[field] ?? null;
      if (raw === null || String(raw).trim() === "") continue;
      const normalized = normalizeSubmissionIdentifier(String(raw));
      identifierChanges[field] = raw;
      if (field === "passport_no") identifierChanges.passport_issuer = submission.passport_issuer ?? null;
      if (field === "foreign_registration_no") identifierChanges.foreign_registration_issuer = submission.foreign_registration_issuer ?? null;
      const namespace = identifierChangePlans({ [field]: raw, passport_issuer: submission.passport_issuer ?? null, foreign_registration_issuer: submission.foreign_registration_issuer ?? null })[0]!.namespace;
      afterInsertStatements.push(
        db.prepare(SUBMISSION_IDENTIFIER_CLAIM_SQL).bind(field, namespace, normalized, String(raw).trim(), mutationId, `submission:${params.changeRequestId}`, mutationId),
      );
    }
  }

  // Permitted relationships: declared current owner + breeder.
  if (submission.current_owner_person_id != null) {
    afterInsertStatements.push(
      db.prepare(peopleLinkSql("owner")).bind(mutationId, submission.current_owner_person_id, mutationId, params.changeRequestId),
    );
  }
  if (submission.breeder_person_id != null) {
    afterInsertStatements.push(
      db.prepare(peopleLinkSql("breeder")).bind(mutationId, submission.breeder_person_id, mutationId, params.changeRequestId),
    );
  }

  // Initial owner grant (only for verified linked owners — see SQL header).
  if (submission.current_owner_person_id != null) {
    afterInsertStatements.push(
      db.prepare(SUBMISSION_GRANT_SQL).bind(
        params.grantId, mutationId, params.submitterUserId, params.changeRequestId, params.reviewerUserId,
        mutationId, params.changeRequestId, params.submitterUserId, submission.current_owner_person_id,
      ),
    );
  }

  // Approval decision, conditioned on the canonical horse landing.
  const decisionStatement = db
    .prepare(SUBMISSION_DECISION_SQL)
    .bind(params.reviewerUserId, params.reviewNote, mutationId, params.changeRequestId, mutationId);
  afterInsertStatements.push(decisionStatement);

  // Derived-state bumps.
  afterInsertStatements.push(db.prepare(SUBMISSION_REVISION_BUMP_SQL).bind(mutationId));
  afterInsertStatements.push(db.prepare(SUBMISSION_COUNTER_BUMP_SQL).bind(mutationId));

  return { horseInsertStatement, afterInsertStatements, decisionStatement, identifierChanges };
}

function peopleLinkSql(role: "owner" | "breeder"): string {
  return SUBMISSION_PEOPLE_LINK_SQL.replace("'owner'", `'${role}'`);
}

/** Identifier normalization identical to the T08 module (digits + whitespace). */
function normalizeSubmissionIdentifier(value: string): string {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  let out = String(value).normalize("NFKC").trim();
  out = out.replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)));
  out = out.replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)));
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Idempotency.
// ---------------------------------------------------------------------------

export interface IdempotentReplayRow {
  id: string;
  status: string;
  /** R140-C: payload fingerprint bound to the key (null on legacy rows). */
  payload_digest?: string | null;
}

/** True when a batch failure is the (submitter, idempotency_key) unique hit. */
export function isIdempotencyViolation(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("UNIQUE constraint failed") && message.includes("idempotency_key");
}

/**
 * After a unique-index hit, load the original row so the API can replay it
 * (200 with idempotent_replay=true) instead of creating a second submission.
 */
export async function resolveIdempotencyReplay(
  db: D1Database,
  userId: string,
  idempotencyKey: string | null,
): Promise<IdempotentReplayRow | null> {
  if (!idempotencyKey) return null;
  const row = await db
    .prepare("SELECT id,status,payload_digest FROM change_requests WHERE submitted_by_user_id=? AND idempotency_key=? ORDER BY created_at DESC LIMIT 1")
    .bind(userId, idempotencyKey)
    .first<IdempotentReplayRow>();
  return row ?? null;
}

/**
 * R140-C (second Master-AI audit): bind the idempotency key to a payload
 * fingerprint. Same key + same content replays the original receipt; same key
 * + DIFFERENT content is an explicit conflict instead of silently replaying
 * the first submission. Canonical JSON keeps key order irrelevant.
 */
export async function submissionPayloadDigest(payload: {
  horse_id?: number | null;
  request_type?: string;
  submission?: unknown;
  items?: unknown;
  parent_correction?: unknown;
}): Promise<string | null> {
  if (payload.request_type === undefined && payload.submission === undefined && payload.items === undefined && payload.parent_correction === undefined && payload.horse_id === undefined) {
    return null;
  }
  const fingerprint = {
    horse_id: payload.horse_id ?? null,
    request_type: payload.request_type ?? null,
    submission: payload.submission ?? null,
    items: payload.items ?? null,
    parent_correction: payload.parent_correction ?? null,
  };
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(fingerprint)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Submission-time validation against the live database (T11 step 3).
// ---------------------------------------------------------------------------

export interface SubmissionStorageIssue {
  code: "parent_not_found" | "parent_unavailable" | "person_not_found";
  message: string;
}

/**
 * Verify the submission's references against the live database BEFORE it is
 * stored: selected parents must exist and be live; declared people must
 * exist. Free-text parents are impossible by schema, so duplicate parent
 * profiles can never be created automatically.
 */
export async function validateSubmissionReferences(
  db: D1Database,
  submission: HorseSubmission,
): Promise<SubmissionStorageIssue[]> {
  const issues: SubmissionStorageIssue[] = [];
  for (const [label, horseId] of [["sire", submission.father_horse_id], ["dam", submission.mother_horse_id]] as const) {
    if (horseId == null) continue;
    const row = await db.prepare("SELECT id,deleted_at FROM horses WHERE id=?").bind(horseId).first<{ id: number; deleted_at: string | null }>();
    if (!row) {
      issues.push({ code: "parent_not_found", message: `The selected ${label} (#${horseId}) does not exist in the registry` });
    } else if (row.deleted_at != null) {
      issues.push({ code: "parent_unavailable", message: `The selected ${label} (#${horseId}) is archived and cannot be referenced` });
    }
  }
  for (const [label, personId] of [["current owner", submission.current_owner_person_id], ["breeder", submission.breeder_person_id]] as const) {
    if (personId == null) continue;
    const row = await db.prepare("SELECT id FROM people WHERE id=?").bind(personId).first<{ id: number }>();
    if (!row) issues.push({ code: "person_not_found", message: `The declared ${label} (#${personId}) does not exist in the people registry` });
  }
  return issues;
}

/** Re-parse a stored submission_json payload (defense against corrupt rows). */
export function parseStoredSubmission(value: unknown): HorseSubmission | null {
  if (!value || typeof value !== "object") return null;
  const parsed = HorseSubmissionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Normalize one field through the shared rules (helper for callers). */
export function parseSubmissionField(field: string, value: unknown): HorseFieldValue | null {
  const parsed = parseHorseFieldValue(field, value);
  return parsed.ok ? parsed.value : null;
}
