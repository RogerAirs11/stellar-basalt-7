import { parseUtcTimestamp } from "../shared/utcTimestamp";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { PERSON_MANDATE_AUTHORITY_SQL } from "./policy";
import { HttpError } from "../api/http";
import { getEffectiveRetentionPolicy } from "./privacyPolicy";

/**
 * R95-N12 — service consent withdrawal and anti-abuse lifecycle.
 *
 * Doctrine (from the reviewed N12 ticket):
 *  - Contact disclosure is consent-gated at EVERY read (P12) and consent can
 *    be WITHDRAWN after the fact. Withdrawal is one-way: it removes future
 *    disclosure and suppresses pending optional (non-essential) notices; the
 *    narrow dispute/audit record (status history, timestamps, digests) is
 *    preserved with an explicit retention rationale.
 *  - Both sides can block. The requester-side block (0044) stops re-targeting;
 *    the provider-side block stops NEW leads and pending optional notices from
 *    an account — and the refusal NEVER discloses the private block reason.
 *  - Anti-abuse bounds are transactional: per-account daily total, per
 *    account+category daily bound, duplicate-lead detection inside a window,
 *    and explicit moderation standing. None of them reveal another
 *    requester's identity (every predicate is about the acting account).
 *  - Response metrics are statistically honest: a defined measurement window,
 *    a disclosed denominator, a minimum cohort, and a per-requester sample
 *    cap to limit one account's influence (not proof against manipulation). A low-volume
 *    provider reports insufficient data — never a fake star or rating.
 *  - Message-body evidence is SEPARATE from any public provider biography:
 *    redaction keeps a SHA-256 of the original bytes and nothing else; the
 *    retention sweep applies the same minimization to terminal requests.
 *
 * SQL templates are exported constants so the python parity suite
 * regex-extracts and replays the EXACT production SQL against PostgreSQL.
 */

// ---------------------------------------------------------------------------
// Anti-abuse bounds (all re-checked INSIDE the create transaction).
// ---------------------------------------------------------------------------

/** Max new leads one account may create per rolling 24h window (all providers). */
export const MAX_NEW_REQUESTS_PER_DAY = 15;
/** Max new leads one account may create per rolling 24h window in one category. */
export const MAX_NEW_PER_CATEGORY_PER_DAY = 5;
/** A lead with the same provider+category+note text inside this window is a duplicate. */
export const DUPLICATE_WINDOW_HOURS = 24;
/** Terminal requests older than this get automatic note redaction + consent zeroing. */
export const RETENTION_DAYS = 365;

/** The neutral create refusal for a provider-blocked account. */
export const PROVIDER_BLOCK_REFUSAL = {
  status: 403 as const,
  code: "lead_refused",
  message: "This provider is not accepting new requests from your account.",
} as const;

/** Honest refusal when the account's recorded standing is not normal. */
export const ABUSE_STANDING_REFUSAL = {
  status: 403 as const,
  code: "service_standing",
  message: "Your account is currently restricted from sending service requests. Contact support.",
} as const;

/** The standing values the CHECK constraint admits (absent row = normal). */
export const SERVICE_STANDING_VALUES = ["normal", "restricted", "suspended"] as const;
export type ServiceStanding = (typeof SERVICE_STANDING_VALUES)[number];

function windowStartIso(nowIso: string, hours: number): string {
  return new Date(new Date(nowIso).getTime() - hours * 3_600_000).toISOString();
}

// ---------------------------------------------------------------------------
// The privacy decision table (completion evidence — exposed at
// GET /api/service-requests/privacy-policy, no personal data involved).
// ---------------------------------------------------------------------------

export const METRICS_MIN_COHORT = 5;
export const METRICS_WINDOW_DAYS = 180;
export const MAX_SAMPLES_PER_REQUESTER = 2;
/** R96-N08: the aggregation scan itself is bounded — even inside the window a
 * high-volume profile cannot force an unbounded read. Truncation is
 * disclosed (scan_cap_applied), never silent. */
export const METRICS_MAX_ROWS_SCAN = 5_000;

export interface PrivacyDecisionRow {
  field: string;
  stored: string;
  visible_to: readonly string[];
  condition: string;
  retention: string;
}

export const PRIVACY_DECISION_TABLE: readonly PrivacyDecisionRow[] = [
  {
    field: "requester email + display name",
    stored: "users (never copied into the request row)",
    visible_to: ["the requester", "the CURRENT verified provider manager of the targeted person"],
    condition: "share_contact=1 AND consent not withdrawn; re-authorized at EVERY read — a revoked manager link loses access on the next request",
    retention: "kept while the account exists; disclosure stops immediately on consent withdrawal",
  },
  {
    field: "note body (the lead message)",
    stored: "service_requests.note",
    visible_to: ["the requester", "the CURRENT verified provider manager"],
    condition: "never public, never in any provider biography, never in notifications or emails",
    retention: `requester redaction replaces the body with a marker at any time (SHA-256 preserved as dispute evidence); the retention sweep auto-redacts notes of terminal requests older than ${RETENTION_DAYS} days`,
  },
  {
    field: "coarse location (province + city)",
    stored: "service_requests.province_code / city",
    visible_to: ["the requester", "the CURRENT verified provider manager"],
    condition: "approved ISO 3166-2:IR code + canonical city only; no precise address is solicited",
    retention: "kept with the request row for dispute/audit context; minimized with the row by the retention sweep",
  },
  {
    field: "status history + timestamps",
    stored: "service_requests + audit_events",
    visible_to: ["both parties (their own view)", "operator review (audit trail)"],
    condition: "the dispute/audit record: what states the lead passed through and when",
    retention: "preserved — narrowly necessary for dispute resolution and abuse investigation (this is the documented retention rationale)",
  },
  {
    field: "redaction digest",
    stored: "service_requests.note_digest",
    visible_to: ["operator review only"],
    condition: "SHA-256 of available original note bytes. It can corroborate a separately supplied message, but cannot reconstruct it or establish authorship; low-entropy text can be guessed",
    retention: "restricted dispute evidence, not anonymous data; unavailable legacy digests are explicitly marked",
  },
  {
    field: "blocks (requester-side and provider-side)",
    stored: "service_request_blocks / service_provider_blocks",
    visible_to: ["the blocking party only"],
    condition: "a provider-side block refuses future leads with a NEUTRAL lead_refused error — the reason and the block itself are never disclosed to the blocked account",
    retention: "kept while both accounts exist (undo requires the blocking party's explicit action)",
  },
  {
    field: "abuse reports",
    stored: "service_request_reports",
    visible_to: ["operator review only"],
    condition: "the reported party never sees the report, the reporter, or any internal note",
    retention: "kept as abuse evidence (dispute rationale); linked to the request row",
  },
  {
    field: "moderation standing",
    stored: "service_abuse_standing",
    visible_to: ["the account owner (their own standing)", "operator review"],
    condition: "absent row = normal; a restricted/suspended account cannot create leads (transaction-checked); set only through the moderation workflow",
    retention: "updated through moderation decisions (N14 lifecycle); visible to the account in their data export",
  },
  {
    field: "provider response-time metrics",
    stored: "computed from service_requests (first_response_at captured at acknowledgement)",
    visible_to: ["the public directory (aggregates only)"],
    condition: `only requests inside a ${METRICS_WINDOW_DAYS}-day window, at most ${MAX_SAMPLES_PER_REQUESTER} samples per requester, spam excluded; below ${METRICS_MIN_COHORT} eligible samples the directory shows insufficient data — never a synthetic rating`,
    retention: "computed at read time; nothing new is stored",
  },
  {
    field: "notification events",
    stored: "notification_outbox (masked recipient, no note content)",
    visible_to: ["operator review (masked)"],
    condition: "optional notices are suppressed the moment consent is withdrawn, a lead is withdrawn, or the provider blocks the requester; essential notices use a separate authorization and delivery policy",
    retention: "outbox lifecycle (delivery reconciliation) — bodies were never stored",
  },
];

// ---------------------------------------------------------------------------
// Honest response metrics (pure — unit-testable without a database).
// ---------------------------------------------------------------------------

export interface MetricsInputRow {
  requester_user_id: string;
  status: string;
  created_at: string;
  first_response_at: string | null;
}

export interface ProviderResponseMetrics {
  measurement_window_days: number;
  minimum_cohort: number;
  max_samples_per_requester: number;
  requests_in_window: number;
  response_time_hours: { sample_size: number; median_hours: number; average_hours: number } | null;
  insufficient_data: boolean;
  exclusions: {
    outside_window: number;
    spam: number;
    withdrawn_before_acknowledgement: number;
    never_acknowledged: number;
    capped_per_requester: number;
  };
  method_note: string;
  disclaimer: string;
}

/**
 * Limit individual account influence, without claiming fraud resistance: at most
 * MAX_SAMPLES_PER_REQUESTER acknowledged requests per requester count as
 * samples (the rest are counted in `capped_per_requester`). Low volume is
 * reported as insufficient data — a synthetic star/rating never exists.
 */
export function computeProviderResponseMetrics(rows: readonly MetricsInputRow[], nowIso: string): ProviderResponseMetrics {
  const at = parseUtcTimestamp(nowIso);
  if (at === null) throw new RangeError("Metrics require a valid timestamp");
  const windowStart = at - METRICS_WINDOW_DAYS * 86_400_000;
  const exclusions = { outside_window: 0, spam: 0, withdrawn_before_acknowledgement: 0, never_acknowledged: 0, capped_per_requester: 0 };
  const perRequester = new Map<string, number>();
  const samples: number[] = [];

  const inWindow = (createdAt: string): boolean => {
    const created = parseUtcTimestamp(createdAt);
    return created !== null && created >= windowStart && created <= at;
  };

  const ordered = [...rows].sort((a,b) => (parseUtcTimestamp(a.created_at) ?? 0) - (parseUtcTimestamp(b.created_at) ?? 0) || a.requester_user_id.localeCompare(b.requester_user_id) || String(a.first_response_at).localeCompare(String(b.first_response_at)));
  for (const row of ordered) {
    if (!inWindow(row.created_at)) { exclusions.outside_window += 1; continue; }
    if (row.status === "spam") { exclusions.spam += 1; continue; }
    if (row.first_response_at) {
      const start = parseUtcTimestamp(row.created_at);
      const end = parseUtcTimestamp(row.first_response_at);
      const hours = start === null || end === null || end > at ? NaN : (end - start) / 3_600_000;
      if (!Number.isFinite(hours) || hours < 0) { exclusions.never_acknowledged += 1; continue; }
      const used = perRequester.get(row.requester_user_id) ?? 0;
      if (used >= MAX_SAMPLES_PER_REQUESTER) { exclusions.capped_per_requester += 1; continue; }
      perRequester.set(row.requester_user_id, used + 1);
      samples.push(hours);
    } else if (row.status === "withdrawn") {
      exclusions.withdrawn_before_acknowledgement += 1;
    } else {
      exclusions.never_acknowledged += 1;
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const average = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null;
  const eligible = sorted.length;
  return {
    measurement_window_days: METRICS_WINDOW_DAYS,
    minimum_cohort: METRICS_MIN_COHORT,
    max_samples_per_requester: MAX_SAMPLES_PER_REQUESTER,
    requests_in_window: rows.length - exclusions.outside_window,
    response_time_hours: eligible >= METRICS_MIN_COHORT ? {
      sample_size: eligible,
      median_hours: Number(median.toFixed(2)),
      average_hours: Number(average!.toFixed(2)),
    } : null,
    insufficient_data: eligible < METRICS_MIN_COHORT,
    exclusions,
    method_note: `Computed only from real received requests created inside a ${METRICS_WINDOW_DAYS}-day window that reached an acknowledgement, with at most ${MAX_SAMPLES_PER_REQUESTER} chronologically earliest eligible samples per requester (this limits, but does not eliminate, manipulation). Below ${METRICS_MIN_COHORT} eligible samples no metric is shown. No synthetic ratings exist.`,
    disclaimer: "Response-time history is not a quality guarantee.",
  };
}

// ---------------------------------------------------------------------------
// Contact consent withdrawal (one-way; suppresses pending optional notices).
// ---------------------------------------------------------------------------

export const CONSENT_WITHDRAWAL_UPDATE_SQL = `UPDATE service_requests
      SET share_contact=0,consent_updated_at=CURRENT_TIMESTAMP,last_operation_id=?,
          row_version=row_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND requester_user_id=? AND share_contact=1
        AND EXISTS(SELECT 1 FROM users WHERE id=service_requests.requester_user_id AND is_active=1)`;

export const CONSENT_WITHDRAWAL_SUPPRESS_SQL = `UPDATE notification_outbox
      SET status='suppressed',last_error='consent_withdrawn',last_operation_id=?,
          lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','failed','dead_letter') AND essential=0
        AND event_key LIKE 'service-request:' || CAST(? AS TEXT) || ':%'
        AND EXISTS(SELECT 1 FROM service_requests WHERE id=? AND last_operation_id=? AND share_contact=0)`;

export const CONSENT_WITHDRAWAL_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_request.consent_withdrawn','service_request',CAST(id AS TEXT),
        '{"share_contact":1}','{"share_contact":0,"reason":"requester_withdrew_consent"}',CURRENT_TIMESTAMP
      FROM service_requests WHERE id=? AND last_operation_id=? AND share_contact=0`;

export interface ConsentWithdrawalCommand {
  requestId: number; requesterUserId: string; operationId: string;
}

export function consentWithdrawalStatements(db: D1Database, input: ConsentWithdrawalCommand): D1PreparedStatement[] {
  return [
    db.prepare(CONSENT_WITHDRAWAL_UPDATE_SQL).bind(input.operationId, input.requestId, input.requesterUserId),
    db.prepare(CONSENT_WITHDRAWAL_SUPPRESS_SQL).bind(input.operationId, String(input.requestId), input.requestId, input.operationId),
    db.prepare(CONSENT_WITHDRAWAL_AUDIT_SQL).bind(input.requesterUserId, input.requestId, input.operationId),
  ];
}

// ---------------------------------------------------------------------------
// Provider-side blocks: current authority and operation-gated side effects.
// ---------------------------------------------------------------------------

export const PROVIDER_BLOCK_INSERT_SQL = `INSERT INTO service_provider_blocks
      (provider_person_id,blocked_requester_user_id,reason,created_by_user_id,creation_operation_id)
      SELECT ?,?,?,?,? WHERE EXISTS({{personMandate}})
        AND EXISTS(SELECT 1 FROM service_requests WHERE provider_person_id=? AND requester_user_id=?)
        AND ?<>?
      ON CONFLICT(provider_person_id,blocked_requester_user_id) DO NOTHING`;

export const PROVIDER_BLOCK_SUPPRESS_SQL = `UPDATE notification_outbox
      SET status='suppressed',last_error='provider_blocked_requester',lease_token=NULL,lease_until=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','failed','dead_letter') AND essential=0
        AND EXISTS(SELECT 1 FROM service_provider_blocks b
          JOIN service_requests r ON r.provider_person_id=b.provider_person_id
            AND r.requester_user_id=b.blocked_requester_user_id
          WHERE b.creation_operation_id=?
            AND notification_outbox.event_key LIKE 'service-request:' || CAST(r.id AS TEXT) || ':%')`;

export const PROVIDER_BLOCK_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_provider.blocked','service_provider_block',CAST(id AS TEXT),'null',?,CURRENT_TIMESTAMP
      FROM service_provider_blocks WHERE creation_operation_id=?`;

export interface ProviderBlockCommand {
  providerPersonId: number; blockedRequesterUserId: string; actorUserId: string;
  reason: string | null; operationId: string;
}

export function providerBlockStatements(db: D1Database, input: ProviderBlockCommand): D1PreparedStatement[] {
  const sql = PROVIDER_BLOCK_INSERT_SQL.replace("{{personMandate}}", PERSON_MANDATE_AUTHORITY_SQL.replace("{{personColumn}}", "?"));
  return [
    db.prepare(sql).bind(input.providerPersonId, input.blockedRequesterUserId, input.reason,
      input.actorUserId, input.operationId, input.actorUserId, input.providerPersonId,
      input.providerPersonId, input.blockedRequesterUserId, input.actorUserId, input.blockedRequesterUserId),
    db.prepare(PROVIDER_BLOCK_SUPPRESS_SQL).bind(input.operationId),
    db.prepare(PROVIDER_BLOCK_AUDIT_SQL).bind(input.actorUserId,
      JSON.stringify({provider_person_id: input.providerPersonId, reason_recorded: input.reason != null}), input.operationId),
  ];
}

// ---------------------------------------------------------------------------
// Requester-side blocking: current ownership and active account are checked in
// the same transaction; only a fresh insertion can suppress notices or audit.
// ---------------------------------------------------------------------------
export function requesterBlockStatements(db: D1Database, input: {
  requestId: number; requesterUserId: string; providerPersonId: number;
}): D1PreparedStatement[] {
  const operationId = crypto.randomUUID();
  return [
    db.prepare(`INSERT OR IGNORE INTO service_request_blocks
      (blocker_user_id,blocked_person_id,creation_operation_id)
      SELECT r.requester_user_id,r.provider_person_id,? FROM service_requests r
      JOIN users u ON u.id=r.requester_user_id AND u.is_active=1
      WHERE r.id=? AND r.requester_user_id=? AND r.provider_person_id=?`)
      .bind(operationId,input.requestId,input.requesterUserId,input.providerPersonId),
    db.prepare(`UPDATE notification_outbox SET status='suppressed',last_error='requester_blocked',
      lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','failed','dead_letter') AND essential=0
        AND EXISTS(SELECT 1 FROM service_request_blocks b JOIN service_requests r
          ON r.requester_user_id=b.blocker_user_id AND r.provider_person_id=b.blocked_person_id
          WHERE b.creation_operation_id=?
            AND notification_outbox.event_key LIKE 'service-request:' || CAST(r.id AS TEXT) || ':%')`)
      .bind(operationId),
    db.prepare(`INSERT INTO audit_events
      (actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT blocker_user_id,'service_request.blocked','service_request_block',
        CAST(blocked_person_id AS TEXT),NULL,?,CURRENT_TIMESTAMP
      FROM service_request_blocks WHERE creation_operation_id=?`)
      .bind(JSON.stringify({blocked_person_id:input.providerPersonId}),operationId),
  ];
}

// ---------------------------------------------------------------------------
// Requester note redaction (body replaced; SHA-256 evidence preserved).
// ---------------------------------------------------------------------------

export const NOTE_REDACT_UPDATE_SQL = `UPDATE service_requests
      SET note='[redacted by requester]', note_digest=?, note_digest_status='original_sha256',
          note_redacted_at=CURRENT_TIMESTAMP, last_operation_id=?,row_version=row_version+1
      WHERE id=? AND requester_user_id=? AND note_redacted_at IS NULL AND note=? AND row_version=?
        AND EXISTS(SELECT 1 FROM users WHERE id=service_requests.requester_user_id AND is_active=1)`;

export const NOTE_REDACT_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_request.note_redacted','service_request',CAST(? AS TEXT),'{"note":"[redacted]"}',?,CURRENT_TIMESTAMP
      FROM service_requests WHERE id=? AND last_operation_id=? AND note_redacted_at IS NOT NULL`;

export interface NoteRedactCommand {
  requestId: number; requesterUserId: string; noteDigest: string; operationId: string; expectedNote: string; expectedVersion: number;
}

export function redactNoteStatements(db: D1Database, input: NoteRedactCommand): D1PreparedStatement[] {
  return [
    db.prepare(NOTE_REDACT_UPDATE_SQL).bind(input.noteDigest, input.operationId, input.requestId, input.requesterUserId, input.expectedNote, input.expectedVersion),
    db.prepare(NOTE_REDACT_AUDIT_SQL).bind(input.requesterUserId, String(input.requestId), JSON.stringify({ digest_preserved: true }), input.requestId, input.operationId),
  ];
}

// ---------------------------------------------------------------------------
// Retention sweep (terminal leads older than RETENTION_DAYS are minimized).
// ---------------------------------------------------------------------------

/** Bounded, compare-and-set minimization. Digests are computed outside the
 * transaction, but the exact note and row version are checked again inside it. */
export const RETENTION_REDACT_SQL = `UPDATE service_requests
      SET note='[retention: note minimized]',note_digest=?,note_digest_status=?,
          note_redacted_at=COALESCE(note_redacted_at,?),share_contact=0,
          consent_updated_at=COALESCE(consent_updated_at,?),province_code=NULL,city=NULL,
          retention_minimized_at=?,last_operation_id=?,row_version=row_version+1
      WHERE id=? AND row_version=? AND note=? AND retention_minimized_at IS NULL
        AND status IN ('closed','withdrawn','spam')
        AND datetime(COALESCE(closed_at,updated_at))<=datetime(?)
        AND NOT EXISTS(SELECT 1 FROM service_request_holds h
          WHERE h.service_request_id=service_requests.id AND h.released_at IS NULL)`;

export const RETENTION_SUPPRESS_SQL = `UPDATE notification_outbox
      SET status='suppressed',last_error='retention_sweep',lease_token=NULL,lease_until=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','failed','dead_letter') AND essential=0
        AND EXISTS(SELECT 1 FROM service_requests r WHERE r.id=? AND r.last_operation_id=?
          AND notification_outbox.event_key LIKE 'service-request:' || CAST(r.id AS TEXT) || ':%')`;

export const RETENTION_AUDIT_SQL = `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT NULL,'service_request.retention_minimized','service_request',CAST(id AS TEXT),NULL,?,?
      FROM service_requests WHERE id=? AND last_operation_id=? AND retention_minimized_at IS NOT NULL`;

export interface RetentionSweepSummary {
  redacted_notes: number;
  minimized_requests: number;
  suppressed_notices: number;
  retention_days: number;
  batch_limit: number;
  /** R98-N09: effective policy provenance — inherited assumption vs operator approval. */
  policy_source: "inherited_default" | "operator_approved";
  policy_version: number | null;
  /** R98-N09: per-state monitoring — candidates skipped because an active hold
   * appeared between selection and the mutation are reported, never guessed. */
  held_deferred: number;
  unavailable_evidence: number;
  already_redacted: number;
  /** How many db.batch calls the sweep was split into (bounded statements each). */
  chunks: number;
  note: string;
}

/** R98-N09: sub-batch bound. Each candidate contributes exactly 4 statements
 * (parent lock, redact, suppress, audit) and they MUST stay in one atomic
 * db.batch call — the sweep splits into chunks of at most this many
 * candidates so a single batch call stays well inside real D1 statement/
 * parameter limits while per-record atomicity is preserved. An interrupted
 * chunk is simply retried by the next scheduled run: every statement is
 * compare-and-set (retention_minimized_at IS NULL) so a resume never
 * fabricates a digest, loses hold history or re-sends a withdrawn inquiry. */
export const RETENTION_SWEEP_CHUNK_CANDIDATES = 10;

interface RetentionCandidate {
  id: number; note: string; note_digest: string | null; note_redacted_at: string | null;
  note_digest_status: string | null; row_version: number;
}

/** Deterministic evidence handling: never invent a digest of missing bytes. */
export async function retainedNoteEvidence(row: Pick<RetentionCandidate,"note"|"note_digest"|"note_redacted_at"|"note_digest_status">): Promise<{
  digest: string | null; status: "original_sha256" | "legacy_recorded_sha256" | "unavailable";
}> {
  if (!row.note_redacted_at) {
    const bits=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(row.note));
    return {digest:[...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join(""),status:"original_sha256"};
  }
  if (row.note_digest && /^[a-f0-9]{64}$/i.test(row.note_digest)) {
    return {digest:row.note_digest.toLowerCase(),status:row.note_digest_status==="original_sha256"?"original_sha256":"legacy_recorded_sha256"};
  }
  return {digest:null,status:"unavailable"};
}

/** Minimize at most `limit` terminal leads. Mutations, suppressions and their
 * actual audit evidence commit together. An empty run writes nothing.
 * No guarantee can retract a notice already accepted by an external provider.
 * R98-N09: the interval comes from the OPERATOR-APPROVED policy when one
 * exists (inherited default otherwise, reported as such); the work is split
 * into bounded chunks that preserve per-record atomicity; holds are rechecked
 * at the actual mutation and reported as held_deferred. */
export async function serviceRetentionSweep(db: D1Database, nowIso: string, options: {limit?: number} = {}): Promise<RetentionSweepSummary> {
  const at=parseUtcTimestamp(nowIso);
  if (at===null) throw new RangeError("Retention requires a valid timestamp");
  const requested=options.limit ?? 20;
  if (!Number.isSafeInteger(requested) || requested<1 || requested>30) throw new RangeError("Retention batch limit must be 1-30");
  const policy=await getEffectiveRetentionPolicy(db, "service_request_terminal", RETENTION_DAYS);
  const cutoff=new Date(at-policy.retention_days*86_400_000).toISOString();
  // R96-N08: a request under an ACTIVE dispute/legal hold is NEVER minimized
  // — irreversible minimization waits for the hold's authorized release.
  const candidates=await db.prepare(`SELECT id,note,note_digest,note_redacted_at,note_digest_status,row_version
      FROM service_requests WHERE retention_minimized_at IS NULL AND status IN ('closed','withdrawn','spam')
        AND datetime(COALESCE(closed_at,updated_at))<=datetime(?)
        AND NOT EXISTS(SELECT 1 FROM service_request_holds h
          WHERE h.service_request_id=service_requests.id AND h.released_at IS NULL)
      ORDER BY id LIMIT ?`)
    .bind(cutoff,requested).all<RetentionCandidate>();
  const rows=candidates.results ?? [];
  let minimized=0,redacted=0,suppressed=0,heldDeferred=0,unavailable=0,alreadyRedacted=0,chunks=0;
  // R98-N09: bounded chunks — each candidate's 4 statements stay inside ONE
  // atomic batch call; chunks are processed sequentially so a later chunk can
  // still complete when an earlier one was interrupted.
  for (let start=0;start<rows.length;start+=RETENTION_SWEEP_CHUNK_CANDIDATES) {
    const slice=rows.slice(start,start+RETENTION_SWEEP_CHUNK_CANDIDATES);
    const statements:D1PreparedStatement[]=[];
    for (const row of slice) {
      const evidence=await retainedNoteEvidence(row),operationId=crypto.randomUUID();
      if (evidence.status==="unavailable") unavailable+=1;
      if (row.note_redacted_at) alreadyRedacted+=1;
      statements.push(
        // Acquire the common parent lock before the next statement takes its
        // snapshot. Hold creation/release use the same lock. A held record is
        // rechecked at the actual mutation, not only in the candidate query.
        db.prepare("UPDATE service_requests SET row_version=row_version WHERE id=?").bind(row.id),
        db.prepare(RETENTION_REDACT_SQL).bind(evidence.digest,evidence.status,nowIso,nowIso,nowIso,operationId,row.id,row.row_version,row.note,cutoff),
        db.prepare(RETENTION_SUPPRESS_SQL).bind(row.id,operationId),
        db.prepare(RETENTION_AUDIT_SQL).bind(JSON.stringify({retention_days:policy.retention_days,policy_source:policy.source,note_digest_status:evidence.status,contact_and_location_minimized:true}),nowIso,row.id,operationId),
      );
    }
    if (!statements.length) continue;
    const results=await db.batch(statements);
    chunks+=1;
    for(let index=0;index<slice.length;index++) {
      const changed=Number(results[index*4+1]?.meta.changes ?? 0);
      minimized+=changed;
      if (!slice[index]!.note_redacted_at) redacted+=changed;
      suppressed+=Number(results[index*4+2]?.meta.changes ?? 0);
      if (changed===0) {
        // The compare-and-set failed: either the row changed (new hold won
        // the race, version moved) — the record stays intact and is retried
        // by a later run; never force-minimized past an active hold.
        heldDeferred+=1;
      }
    }
  }
  return {redacted_notes:redacted,minimized_requests:minimized,suppressed_notices:suppressed,
    retention_days:policy.retention_days,batch_limit:requested,
    policy_source:policy.source,policy_version:policy.policy_version,
    held_deferred:heldDeferred,unavailable_evidence:unavailable,already_redacted:alreadyRedacted,chunks,
    note:"Eligible terminal leads are minimized in bounded batches; requests under an ACTIVE dispute/legal hold are never minimized until an authorized release. The effective interval comes from the operator-approved policy when present, otherwise the documented inherited default (an explicit configuration assumption, not legal advice). Digests identify available original bytes only; missing legacy evidence is marked unavailable. Status history remains restricted dispute evidence, not anonymous data."};
}

// ---------------------------------------------------------------------------
// Route preflight helpers (the create transaction re-checks every bound).
// ---------------------------------------------------------------------------

export interface CreatePreflightCheck {
  kind: "ok" | "provider_blocked" | "standing" | "rate_limited_daily" | "rate_limited_category" | "duplicate";
}

/** All bounds are about the ACTING account — no other requester is examined. */
export async function preflightServiceCreate(
  db: D1Database,
  actorUserId: string,
  providerPersonId: number,
  category: string,
  note: string,
  nowIso: string,
): Promise<CreatePreflightCheck> {
  const blocked = await db.prepare("SELECT 1 AS ok FROM service_provider_blocks WHERE provider_person_id=? AND blocked_requester_user_id=?")
    .bind(providerPersonId, actorUserId).first();
  if (blocked) return { kind: "provider_blocked" };
  const standing = await db.prepare("SELECT standing FROM service_abuse_standing WHERE user_id=?")
    .bind(actorUserId).first<{ standing: string }>();
  if (standing && standing.standing !== "normal") return { kind: "standing" };
  const day = windowStartIso(nowIso, 24);
  const daily = await db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE requester_user_id=? AND datetime(created_at)>=datetime(?)")
    .bind(actorUserId, day).first<{ n: number }>();
  if (Number(daily?.n ?? 0) >= MAX_NEW_REQUESTS_PER_DAY) return { kind: "rate_limited_daily" };
  const perCategory = await db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE requester_user_id=? AND category=? AND datetime(created_at)>=datetime(?)")
    .bind(actorUserId, category, day).first<{ n: number }>();
  if (Number(perCategory?.n ?? 0) >= MAX_NEW_PER_CATEGORY_PER_DAY) return { kind: "rate_limited_category" };
  const duplicate = await db.prepare(
    "SELECT 1 AS ok FROM service_requests WHERE requester_user_id=? AND provider_person_id=? AND category=? AND note=? AND datetime(created_at)>=datetime(?)",
  ).bind(actorUserId, providerPersonId, category, note, windowStartIso(nowIso, DUPLICATE_WINDOW_HOURS)).first();
  if (duplicate) return { kind: "duplicate" };
  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// R96-N08 — dispute/legal holds and the block-complaint support queue.
// ---------------------------------------------------------------------------

const ACTIVE_ADMIN_SQL = "EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))";

/** Place a dispute/legal hold on a service request. Admin-only (deliberately
 * SEPARATE from ordinary editors: a hold blocks irreversible retention
 * minimization), one ACTIVE hold per request (partial unique index), the
 * operator-authored reason is bounded and audited — the request's private
 * note text NEVER enters any log. */
export function placeServiceRequestHoldStatements(db: D1Database, input: {
  requestId: number; operatorUserId: string; holdKind: "dispute" | "legal_hold"; reason: string;
}): D1PreparedStatement[] {
  if (!input.reason || input.reason.trim().length < 10 || input.reason.length > 2000) {
    throw new HttpError(400, "invalid_hold_reason", "A hold requires a substantive reason (10-2000 chars) for the audit trail");
  }
  const operationId = crypto.randomUUID();
  return [
    db.prepare(`UPDATE service_requests SET row_version=row_version WHERE id=? AND ${ACTIVE_ADMIN_SQL}`)
      .bind(input.requestId, input.operatorUserId),
    db.prepare(`INSERT INTO service_request_holds(service_request_id,hold_kind,reason,created_by_user_id,operation_id)
      SELECT ?,?,?,?,? FROM service_requests r
      WHERE r.id=? AND ${ACTIVE_ADMIN_SQL}
        AND NOT EXISTS(SELECT 1 FROM service_request_holds h WHERE h.service_request_id=r.id AND h.released_at IS NULL)`)
      .bind(input.requestId, input.holdKind, input.reason.trim(), input.operatorUserId, operationId, input.requestId, input.operatorUserId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_request.hold_placed','service_request_holds',CAST(id AS TEXT),'{}',?,CURRENT_TIMESTAMP
      FROM service_request_holds WHERE service_request_id=? AND operation_id=?`)
      .bind(input.operatorUserId, JSON.stringify({ hold_kind: input.holdKind, request_id: input.requestId }), input.requestId, operationId),
  ];
}

/** Release a hold (admin-only, audited with a release reason). After release,
 * retention minimization may proceed on its normal schedule. */
export function releaseServiceRequestHoldStatements(db: D1Database, input: {
  requestId: number; operatorUserId: string; releaseReason: string;
}): D1PreparedStatement[] {
  if (!input.releaseReason || input.releaseReason.trim().length < 10 || input.releaseReason.trim().length > 2000) {
    throw new HttpError(400, "invalid_release_reason", "A hold release requires a substantive reason (10-2000 chars) for the audit trail");
  }
  const operationId = crypto.randomUUID();
  return [
    db.prepare(`UPDATE service_requests SET row_version=row_version WHERE id=? AND ${ACTIVE_ADMIN_SQL}`)
      .bind(input.requestId, input.operatorUserId),
    db.prepare(`UPDATE service_request_holds SET released_at=CURRENT_TIMESTAMP, released_by_user_id=?, release_reason=?, release_operation_id=?
      WHERE service_request_id=? AND released_at IS NULL AND ${ACTIVE_ADMIN_SQL}`)
      .bind(input.operatorUserId, input.releaseReason.trim(), operationId, input.requestId, input.operatorUserId),
    db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      SELECT ?,'service_request.hold_released','service_request_holds',CAST(service_request_id AS TEXT),'{"active":true}',?,CURRENT_TIMESTAMP
      FROM service_request_holds
      WHERE service_request_id=? AND released_at IS NOT NULL AND released_by_user_id=? AND release_operation_id=?`)
      .bind(input.operatorUserId, JSON.stringify({ release_reason: input.releaseReason.trim() }), input.requestId, input.operatorUserId, operationId),
  ];
}

/** File a block complaint: ONE per (complainant, provider) pair — retries
 * append nothing. The PRIVATE block reason is never part of this surface:
 * the complaint is the complainant's own bounded text, and only operators
 * see the queue. */
export const BLOCK_COMPLAINT_MAX_CHARS = 2000;
export function fileProviderBlockComplaintStatements(db: D1Database, input: {
  complainantUserId: string; providerPersonId: number; complaint: string;
}): D1PreparedStatement[] {
  if (!input.complaint || input.complaint.trim().length < 20 || input.complaint.length > BLOCK_COMPLAINT_MAX_CHARS) {
    throw new HttpError(400, "invalid_complaint", "A complaint requires 20-2000 characters describing the problem");
  }
  return [
    db.prepare(`INSERT INTO provider_block_complaints(complainant_user_id,provider_person_id,complaint)
      SELECT ?,?,? FROM people p
      WHERE p.id=? AND p.deleted_at IS NULL
      ON CONFLICT(complainant_user_id,provider_person_id) DO NOTHING`)
      .bind(input.complainantUserId, input.providerPersonId, input.complaint.trim(), input.providerPersonId),
  ];
}

export { windowStartIso };
