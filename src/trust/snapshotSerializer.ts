import type { D1Database } from "@cloudflare/workers-types";
import { stableStringify } from "./extracts";
import type { AttestableRecordKind } from "./attestations";

/**
 * R98-N05: canonical, versioned attestation evidence snapshots.
 *
 * The server reads the ACTUAL target and evidence rows through a fixed
 * per-record-kind allowlist, serializes them deterministically (sorted keys —
 * engine JSON key order can never leak into a frozen document) and binds the
 * issuance to those exact observed values: the INSERT..SELECT in
 * attestationStore re-verifies every allowlisted column at commit time, so a
 * source row that changed between read and insert refuses the issuance
 * instead of certifying a mixture. A caller-supplied source_version or hash
 * never participates — the stored marker is always server-derived.
 *
 * canonical_json is PRIVATE (authorized review only). Public verification
 * exposes the content digest and per-row version markers, never the bytes
 * and never private free-text (notes are excluded from every allowlist:
 * hashing private text is not anonymization).
 */

export const ATTESTATION_SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotKindSpec {
  table: string;
  idNumeric: boolean;
  columns: readonly string[];
}

/** Structured-fact allowlists. Private free-text (genetic test notes,
 * competition notes) is deliberately excluded everywhere. */
export const SNAPSHOT_KIND_SPECS: Record<AttestableRecordKind, SnapshotKindSpec> = {
  horse_identity: {
    table: "horses",
    idNumeric: true,
    columns: ["id", "name_latin", "name_native", "sex_desc", "birth_year", "color_desc", "breed_desc",
      "father_id", "mother_id", "register_no", "uel_no", "microchip_no", "is_active", "updated_at"],
  },
  genetic_test: {
    table: "genetic_tests",
    idNumeric: true,
    columns: ["id", "horse_id", "test_type", "test_category", "result", "result_interpretation",
      "lab_name", "lab_accession", "tested_at", "verified", "certificate_media_id", "provenance", "created_at"],
  },
  media: {
    table: "horse_media",
    idNumeric: false,
    columns: ["id", "horse_id", "media_type", "role", "file_name", "mime_type", "size_bytes", "width", "height",
      "caption", "verification", "consent_state", "quarantined_at", "uploaded_by_user_id", "sort_order", "created_at", "updated_at"],
  },
  competition_result: {
    table: "competition_results",
    idNumeric: true,
    columns: ["id", "competition_id", "horse_id", "rider_name", "rider_club", "class_name", "placement",
      "placement_text", "score", "is_eliminated", "is_withdrawn", "provenance", "created_at"],
  },
};

const mediaSnapshotColumns = SNAPSHOT_KIND_SPECS.media.columns;
export const MEDIA_SNAPSHOT_COLUMNS = mediaSnapshotColumns;

export type SnapshotRow = Record<string, unknown>;

export async function readSnapshotRow(db: D1Database, kind: AttestableRecordKind, recordId: string): Promise<SnapshotRow | null> {
  const spec = SNAPSHOT_KIND_SPECS[kind];
  const row = await db.prepare(`SELECT ${spec.columns.join(",")} FROM ${spec.table} WHERE id=?`)
    .bind(recordId).first<SnapshotRow>();
  return row ?? null;
}

export async function readMediaSnapshotRow(db: D1Database, mediaId: string): Promise<SnapshotRow | null> {
  const row = await db.prepare(`SELECT ${MEDIA_SNAPSHOT_COLUMNS.join(",")} FROM horse_media WHERE id=?`)
    .bind(mediaId).first<SnapshotRow>();
  return row ?? null;
}

export interface BuiltSnapshot {
  canonicalJson: string;
  contentDigest: string;
  sourceRowVersions: string;
  rowDigests: Record<string, string>;
  serverVersionMarker: string;
}

/** WebCrypto SHA-256 (Workers + Node >= 18): same algorithm as
 * attestations.ts sha256Hex, kept local to avoid a runtime circular import. */
async function digestHex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildAttestationSnapshot(input: {
  recordKind: AttestableRecordKind;
  recordId: string;
  horseId: number;
  targetRow: SnapshotRow;
  evidenceRow: SnapshotRow | null;
  now?: Date;
}): Promise<BuiltSnapshot> {
  const capturedAt = (input.now ?? new Date()).toISOString();
  const payload = {
    schema_version: ATTESTATION_SNAPSHOT_SCHEMA_VERSION,
    record_kind: input.recordKind,
    record_id: input.recordId,
    horse_id: input.horseId,
    target: input.targetRow,
    evidence: input.evidenceRow,
    captured_at: capturedAt,
  };
  const canonicalJson = stableStringify(payload);
  const rowDigests: Record<string, string> = {
    [SNAPSHOT_KIND_SPECS[input.recordKind].table]: await digestHex(stableStringify(input.targetRow)),
  };
  if (input.evidenceRow) rowDigests.horse_media = await digestHex(stableStringify(input.evidenceRow));
  const contentDigest = await digestHex(canonicalJson);
  return {
    canonicalJson,
    contentDigest,
    sourceRowVersions: stableStringify(rowDigests),
    rowDigests,
    serverVersionMarker: `snap:${ATTESTATION_SNAPSHOT_SCHEMA_VERSION}:${contentDigest.slice(0, 16)}`,
  };
}

/**
 * Commit-time column guard: one SQL predicate per allowlisted column, binding
 * the OBSERVED value. Engine-neutral null-safe equality following the
 * codebase's established COALESCE/CAST pattern. A row that changed in any
 * allowlisted column between the snapshot read and the INSERT refuses the
 * whole issuance (0 rows -> 409).
 */
export function columnGuardSql(alias: string, columns: readonly string[]): string {
  return columns.map((column) => `AND COALESCE(CAST(${alias}.${column} AS TEXT),'')=COALESCE(CAST(? AS TEXT),'')`).join("\n");
}

export function columnGuardBinds(row: SnapshotRow, columns: readonly string[]): unknown[] {
  // Bind the TEXT form: both sides of the guard are CAST(... AS TEXT), so a
  // string bind is semantically identical on every engine — and node:sqlite
  // binds JS numbers as REAL, where CAST(55.0 AS TEXT)='55.0' would break
  // equality against an INTEGER column's '55'.
  return columns.map((column) => {
    const value = row[column];
    return value === null || value === undefined ? null : String(value);
  });
}

export function parseRowVersions(stored: string): Record<string, string> {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    }
  } catch { /* fall through */ }
  return {};
}

export interface SnapshotVerificationRows {
  targetRow: SnapshotRow | null;
  evidenceRow: SnapshotRow | null;
}

/** Recompute the per-row digests from the CURRENT rows. Null row = removed. */
export async function readCurrentRowsForVerification(
  db: D1Database,
  kind: AttestableRecordKind,
  recordId: string,
  evidenceMediaId: string | null,
): Promise<SnapshotVerificationRows> {
  const targetRow = await readSnapshotRow(db, kind, recordId);
  const evidenceRow = evidenceMediaId ? await readMediaSnapshotRow(db, evidenceMediaId) : null;
  return { targetRow, evidenceRow };
}

export async function compareRowDigests(observed: Record<string, string>, current: SnapshotVerificationRows, kind: AttestableRecordKind): Promise<{
  matches: boolean;
  changed_tables: string[];
  removed_tables: string[];
}> {
  const changed: string[] = [];
  const removed: string[] = [];
  const targetTable = SNAPSHOT_KIND_SPECS[kind].table;
  if (current.targetRow === null) removed.push(targetTable);
  else if ((await digestHex(stableStringify(current.targetRow))) !== observed[targetTable]) changed.push(targetTable);
  if (Object.prototype.hasOwnProperty.call(observed, "horse_media")) {
    if (current.evidenceRow === null) removed.push("horse_media");
    else if ((await digestHex(stableStringify(current.evidenceRow))) !== observed.horse_media) changed.push("horse_media");
  }
  return { matches: changed.length === 0 && removed.length === 0, changed_tables: changed, removed_tables: removed };
}

/** Verify the stored canonical bytes against the stored digest (tamper
 * defense in depth, same discipline as registry extract payloads). */
export async function snapshotBytesMatchDigest(canonicalJson: string, contentDigest: string): Promise<boolean> {
  return (await digestHex(canonicalJson)) === contentDigest;
}
