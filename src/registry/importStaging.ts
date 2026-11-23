/**
 * R88 agent plan P10 — pure ingestion normalization + classification.
 *
 * Design rules from the plan:
 *  - Normalize Persian/Arabic letter variants and digits WHILE PRESERVING
 *    ORIGINALS: the raw row is staged verbatim; normalization only produces
 *    the matching copy.
 *  - Registry+issuer and microchip are TYPED identifiers; horses are never
 *    deduplicated globally by name.
 *  - Conflicting parentage and identifier collisions ENTER REVIEW instead of
 *    overwriting trusted fields.
 *
 * R140-B (second Master-AI audit): the importer now normalizes identifiers
 * through the SAME canonical normalizer as every other canonical write
 * (normalizeIdentifierValue — NFKC catches fullwidth digits the old local
 * mapping missed), collapses blank/whitespace identifiers to NULL exactly like
 * the T08 change-plan path ("" is not an identifier), and drops implausible
 * birth years to NULL instead of writing garbage (e.g. 999999) into canonical
 * rows.
 *
 * Digests use WebCrypto (Workers-safe, same pattern as src/auth/recovery.ts).
 */
import { normalizeIdentifierValue } from "./identifiers";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Unicode digits -> ASCII (identifier-grade: leading zeros preserved). */
export function normalizeDigits(value: string): string {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

/** Birth years outside this window are data errors, not history. */
export const IMPORT_BIRTH_YEAR_MIN = 1700;
export function importBirthYearMax(): number {
  return new Date().getUTCFullYear() + 1;
}

/**
 * Text-grade normalization for NAMES and free text: unifies Arabic Yeh (ي)
 * with Persian Yeh (ی), Arabic Kaf (ك) with Persian Kaf (ک), removes Arabic
 * Tatweel (ـ), folds NBSP, collapses whitespace and lowercases Latin — so
 * «كوه نور» and «کوه نور» match. NEVER applied to the stored raw copy.
 */
export function normalizePersianText(value: string): string {
  return normalizeDigits(String(value).normalize("NFKC"))
    .replace(/\u064A/g, "\u06CC") // Arabic Yeh -> Persian Yeh
    .replace(/\u0643/g, "\u06A9") // Arabic Kaf -> Persian Kaf
    .replace(/\u0640/g, "")       // Tatweel
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ImportRow {
  external_id: string;
  register_no?: string | null;
  microchip_no?: string | null;
  name_latin?: string | null;
  name_native?: string | null;
  father_register_no?: string | null;
  mother_register_no?: string | null;
  birth_year?: number | null;
  [key: string]: unknown;
}

export interface NormalizedImportRow {
  raw: ImportRow;
  normalized: ImportRow;
  /** R140-B: normalization notes (e.g. dropped implausible birth years). */
  warnings: string[];
  /** sha256 over the normalized identity-bearing fields (stable ordering).
   * R142-B07: this is the IDENTITY FINGERPRINT — it deliberately covers only
   * the fields that recognize a horse, so fill-once matching and the
   * identical-identity skip stay stable. It is NO LONGER the replay digest. */
  checksum: string;
  /** R142-B07 (Master-AI): sha256 over ALL normalized fields plus the raw
   * payload — the replay/evidence digest. Two payloads with different
   * external IDs, sex, breed, notes or parent claims now produce different
   * digests (changed evidence becomes a new reviewable version), while JSON
   * key order and identity-only differences still behave predictably. */
  contentChecksum: string;
}

/** R140-B: canonical identifier normalization shared with the T08 write path — blank collapses to NULL. */
function normalizeImportIdentifier(value: unknown): string | null {
  if (value == null) return null;
  const normalized = normalizeIdentifierValue(String(value));
  return normalized === "" ? null : normalized;
}

/** R140-B: plausibility gate — an implausible year becomes NULL with a warning, never canonical garbage. */
function normalizeImportBirthYear(value: unknown, warnings: string[]): number | null {
  if (value == null || value === "") return null;
  const year = Number(typeof value === "number" ? value : normalizeDigits(String(value)).trim());
  if (!Number.isInteger(year)) return null;
  if (year < IMPORT_BIRTH_YEAR_MIN || year > importBirthYearMax()) {
    warnings.push(`implausible_birth_year:${year} (dropped to unknown; allowed ${IMPORT_BIRTH_YEAR_MIN}-${importBirthYearMax()})`);
    return null;
  }
  return year;
}

export async function normalizeImportRow(raw: ImportRow): Promise<NormalizedImportRow> {
  const warnings: string[] = [];
  const normalized: ImportRow = {
    ...raw,
    external_id: normalizeIdentifierValue(String(raw.external_id)),
    register_no: normalizeImportIdentifier(raw.register_no),
    microchip_no: normalizeImportIdentifier(raw.microchip_no),
    name_latin: raw.name_latin != null ? normalizePersianText(String(raw.name_latin)) : null,
    name_native: raw.name_native != null ? normalizePersianText(String(raw.name_native)) : null,
    father_register_no: normalizeImportIdentifier(raw.father_register_no),
    mother_register_no: normalizeImportIdentifier(raw.mother_register_no),
    birth_year: normalizeImportBirthYear(raw.birth_year, warnings),
  };
  const identity = JSON.stringify({
    register_no: normalized.register_no ?? null,
    microchip_no: normalized.microchip_no ?? null,
    name_latin: normalized.name_latin ?? null,
    name_native: normalized.name_native ?? null,
    father_register_no: normalized.father_register_no ?? null,
    mother_register_no: normalized.mother_register_no ?? null,
    birth_year: normalized.birth_year ?? null,
  });
  // R142-B07: content digest over every normalized field (sorted keys so JSON
  // key ordering cannot change the semantic digest) PLUS the verbatim raw
  // payload bytes hash, so nonidentity evidence participates in replay
  // detection while raw-byte integrity keeps its own separate value.
  const contentKeys = Object.keys(normalized).filter((key) => key !== "raw").sort();
  const content: Record<string, unknown> = {};
  for (const key of contentKeys) content[key] = normalized[key] ?? null;
  const rawCopy: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort()) rawCopy[key] = raw[key] ?? null;
  const contentPayload = JSON.stringify({ fields: content, raw: rawCopy });
  return { raw, normalized, warnings, checksum: await sha256Hex(identity), contentChecksum: await sha256Hex(contentPayload) };
}

export interface IdentifierMatch {
  horseId: number;
  via: "register_no" | "microchip_no";
}

export interface ExistingHorseRecord {
  id: number;
  register_no: string | null;
  microchip_no: string | null;
  father_id: number | null;
  mother_id: number | null;
  /** Raw parent register numbers as recorded canonically (for parentage comparison). */
  father_register_no: string | null;
  mother_register_no: string | null;
  /** Identity checksum of the canonical row, when the caller can compute it. */
  identity_checksum?: string | null;
}

export type StagedRowAction =
  | { action: "create"; detail: string }
  | { action: "skip"; detail: string }
  | { action: "update"; detail: string; horseId: number }
  | { action: "conflict"; detail: string; reason: "identifier_collision" | "parentage_conflict" | "ambiguous_match" };

/**
 * Dry-run classification of one normalized row against the canonical state.
 * Pure function: the caller supplies the typed-identifier matches (register
 * in the source's issuer namespace, microchip — NEVER name-based) and the
 * canonical record of the matched horse.
 *
 *  - identifiers resolving to DIFFERENT horses => conflict (merge review);
 *  - matched horse whose recorded parentage DISAGREES with the incoming
 *    asserted parentage => conflict (a licensed source never overwrites
 *    trusted parentage);
 *  - matched horse with identical identity content => skip (reimporting an
 *    identical file stages zero creates/updates — idempotent);
 *  - matched horse with fill-once facts => update (only NULL canonical
 *    identity facts would be filled by the apply step);
 *  - no typed-identifier match => create;
 *  - no typed identifier at all => conflict (cannot be matched or created).
 */
export function classifyImportRow(input: {
  row: NormalizedImportRow;
  registerMatches: IdentifierMatch[];
  microchipMatches: IdentifierMatch[];
  existing: ExistingHorseRecord | null;
}): StagedRowAction {
  const { row, registerMatches, microchipMatches, existing } = input;
  const registerIds = [...new Set(registerMatches.map((match) => match.horseId))];
  const microchipIds = [...new Set(microchipMatches.map((match) => match.horseId))];
  const allMatched = [...new Set([...registerIds, ...microchipIds])];

  if (row.normalized.register_no == null && row.normalized.microchip_no == null) {
    return { action: "conflict", reason: "ambiguous_match", detail: "Row carries no typed identifier (register_no/microchip_no) — cannot be matched or created safely; enter review" };
  }
  if (registerIds.length > 1 || microchipIds.length > 1 || allMatched.length > 1) {
    return {
      action: "conflict",
      reason: "identifier_collision",
      detail: `Typed identifiers resolve to different horses (register: [${registerIds.join(", ")}], microchip: [${microchipIds.join(", ")}]) — merge review required before any write`,
    };
  }
  if (allMatched.length === 1) {
    const horseId = allMatched[0]!;
    const record = existing && existing.id === horseId ? existing : null;
    if (!record) {
      return { action: "conflict", reason: "ambiguous_match", detail: `Identifier matched horse ${horseId} but the canonical record could not be loaded` };
    }
    // Parentage disagreement enters review — never an overwrite. Both sides
    // normalize through the canonical identifier normalizer (R140-B) so
    // fullwidth digits and stray whitespace cannot fake a disagreement.
    const fatherAsserted = row.normalized.father_register_no;
    const motherAsserted = row.normalized.mother_register_no;
    if (fatherAsserted != null && record.father_register_no != null
      && normalizeIdentifierValue(record.father_register_no) !== fatherAsserted) {
      return { action: "conflict", reason: "parentage_conflict", detail: `Incoming sire register ${fatherAsserted} disagrees with the recorded sire ${record.father_register_no} on horse ${horseId} — parentage review required` };
    }
    if (motherAsserted != null && record.mother_register_no != null
      && normalizeIdentifierValue(record.mother_register_no) !== motherAsserted) {
      return { action: "conflict", reason: "parentage_conflict", detail: `Incoming dam register ${motherAsserted} disagrees with the recorded dam ${record.mother_register_no} on horse ${horseId} — parentage review required` };
    }
    if (record.identity_checksum != null && record.identity_checksum === row.checksum) {
      return { action: "skip", detail: `Identical identity content already recorded on horse ${horseId} — idempotent reimport` };
    }
    return { action: "update", detail: `Matched horse ${horseId} by typed identifier; fill-once update proposed`, horseId };
  }
  return { action: "create", detail: "No typed-identifier match; proposed canonical create" };
}

/** sha256 over the canonicalized batch payload — reimport detection digest.
 * R142-B07 (Master-AI): binds replay to the COMPLETE evidence (content
 * checksums of every row), not only the identity fields — changed external
 * IDs, sex, breed, notes or parent claims now produce a new batch digest
 * instead of silently replaying the earlier batch's receipts. */
export async function batchDigest(rows: ImportRow[], mappingVersion: string): Promise<string> {
  const digests = await Promise.all(rows.map((row) => normalizeImportRow(row).then((normalized) => normalized.contentChecksum)));
  const canonical = JSON.stringify({ mapping_version: mappingVersion, rows: digests });
  return sha256Hex(canonical);
}
