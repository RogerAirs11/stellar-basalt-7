import { z } from "zod";
import { HttpError, json, readJson } from "../api/http";
import { requireCsrf, requirePermission } from "../auth/guards";
import { capabilitiesForRole } from "../auth/capabilities";
import { sha256Hex } from "./attestations";
import { publicHorseAttestations } from "./attestationStore";
import type { D1Database } from "@cloudflare/workers-types";

// Master-Ai plan T06 (finding F04): versioned registry extracts. The legacy
// certificate hashed horseId+language+code and rendered LIVE facts, so an old
// code could appear next to changed data. An extract is an immutable
// visibility-filtered snapshot: each issuance captures the canonical payload,
// hashes THE PAYLOAD, and gets its own secure random code. Verification
// replays stored facts, flags revocation, and reports whether the registry
// has changed since issuance. Renamed honestly: this is a Registry
// Information Extract, not an official certificate.

export const EXTRACT_TEMPLATE_VERSION = "2026-10-03.1";

export const EXTRACT_LEGAL_NOTE_EN =
  "Registry Information Extract — an informational snapshot of registry data at issuance time. It is not an official certificate and does not by itself establish ownership, identity or breeding claims.";
export const EXTRACT_LEGAL_NOTE_FA =
  "استخراج اطلاعات ثبت — تصویری اطلاعاتی از داده‌های ثبت در زمان صدور. این سند گواهی رسمی نیست و به‌تنهایی مالکیت، هویت یا اصالت نژادی را اثبات نمی‌کند.";

// ---------------------------------------------------------------------------
// Canonical serialization.

/**
 * Deterministic JSON: object keys sorted recursively, no incidental
 * whitespace. Two payloads with equal content serialize to equal strings, so
 * the digest is a function of FACTS, not of insertion order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Snapshot payload.

export interface ExtractPayload {
  meta: {
    template_version: string;
    language: "fa" | "en";
    issued_at: string;
    legal_status: "informational_extract";
    legal_status_note_en: string;
    legal_status_note_fa: string;
  };
  horse: Record<string, unknown>;
  pedigree: { sire: Record<string, unknown> | null; dam: Record<string, unknown> | null };
  people: { breeder: string[]; owner: string[] };
  attestations: Array<Record<string, unknown>>;
}

export interface ExtractSourceRow {
  id: number;
  register_no: string | null;
  ueln_no: string | null;
  name_latin: string | null;
  name_native: string | null;
  breed_desc: string | null;
  sex_desc: string | null;
  color_desc: string | null;
  birth_year: number | null;
  birth_place_desc: string | null;
  main_strain_desc: string | null;
  sub_strain_desc: string | null;
  sire_id: number | null;
  sire_latin: string | null;
  sire_native: string | null;
  dam_id: number | null;
  dam_latin: string | null;
  dam_native: string | null;
  breeder: string | null;
  owner: string | null;
}

/**
 * The only attestation fields that may enter an extract payload — the exact
 * allowlist the issuance SELECT reads (issuer identity + scope + validity).
 * P04 defense-in-depth: even if the SELECT were ever widened, the payload
 * builder still drops every field outside this list (lab accessions, notes,
 * internal ids and anything else private stay out of shared documents).
 */
const EXTRACT_ATTESTATION_FIELDS = [
  "attestation_id",
  "issuer_slug",
  "issuer_name",
  "record_kind",
  "field_scope",
  "issued_at",
  "expires_at",
  "status",
] as const;

function projectAttestation(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of EXTRACT_ATTESTATION_FIELDS) out[field] = field === "field_scope" ? null : row[field] ?? null;
  return out;
}

function splitNames(value: string | null): string[] {
  if (!value) return [];
  return value.split("، ").map((name) => name.trim()).filter(Boolean);
}

/**
 * Build the canonical, visibility-filtered snapshot. ONLY public registry
 * facts enter the payload — private evidence (lab accessions, notes,
 * addresses, documents) can never be embedded because it is never read here.
 */
export function buildExtractSnapshot(input: {
  horse: ExtractSourceRow;
  attestations: Array<Record<string, unknown>>;
  language: "fa" | "en";
  issuedAt: string;
  templateVersion?: string;
}): ExtractPayload {
  const { horse, language } = input;
  return {
    meta: {
      template_version: input.templateVersion ?? EXTRACT_TEMPLATE_VERSION,
      language,
      issued_at: input.issuedAt,
      legal_status: "informational_extract",
      legal_status_note_en: EXTRACT_LEGAL_NOTE_EN,
      legal_status_note_fa: EXTRACT_LEGAL_NOTE_FA,
    },
    horse: {
      id: horse.id,
      register_no: horse.register_no,
      name_latin: horse.name_latin,
      name_native: horse.name_native,
      breed_desc: horse.breed_desc,
      sex_desc: horse.sex_desc,
      color_desc: horse.color_desc,
      birth_year: horse.birth_year,
      birth_place_desc: horse.birth_place_desc,
      main_strain_desc: horse.main_strain_desc,
      sub_strain_desc: horse.sub_strain_desc,
    },
    pedigree: {
      sire: horse.sire_id ? { id: horse.sire_id, name_latin: horse.sire_latin, name_native: horse.sire_native } : null,
      dam: horse.dam_id ? { id: horse.dam_id, name_latin: horse.dam_latin, name_native: horse.dam_native } : null,
    },
    people: {
      breeder: splitNames(horse.breeder),
      owner: splitNames(horse.owner),
    },
    attestations: input.attestations.map(projectAttestation),
  };
}

/**
 * Field-level diff between an issued snapshot and the current registry state.
 * `meta.issued_at` is intentionally excluded: issuance time is not a fact.
 */
export function diffExtractPayloads(issued: ExtractPayload, current: ExtractPayload): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(issued.horse)) {
    if (stableStringify(issued.horse[key]) !== stableStringify(current.horse[key])) changed.push(`horse.${key}`);
  }
  if (stableStringify(issued.pedigree) !== stableStringify(current.pedigree)) changed.push("pedigree");
  if (stableStringify(issued.people) !== stableStringify(current.people)) changed.push("people");
  if (stableStringify(issued.attestations) !== stableStringify(current.attestations)) changed.push("attestations");
  return changed;
}

// ---------------------------------------------------------------------------
// Secure public codes.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // 32 chars: unbiased modulo mapping, no ambiguous glyphs

export function generateExtractCode(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return `RX-${chars.slice(0, 5).join("")}-${chars.slice(5, 10).join("")}-${chars.slice(10, 15).join("")}-${chars.slice(15, 20).join("")}`;
}

export function isExtractCodeShape(code: string): boolean {
  return /^RX-[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(code);
}

// ---------------------------------------------------------------------------
// Data access.

const EXTRACT_HORSE_SQL = `
  SELECT h.id,h.register_no,NULL AS ueln_no,h.name_latin,h.name_native,h.birth_year,h.birth_place_desc,h.breed_desc,h.sex_desc,h.color_desc,
         h.main_strain_desc,h.sub_strain_desc,
         s.id AS sire_id, s.name_latin AS sire_latin, s.name_native AS sire_native,
         m.id AS dam_id, m.name_latin AS dam_latin, m.name_native AS dam_native,
         (SELECT group_concat(p.name_latin || ' ' || COALESCE(p.name_native,''), '، ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='breeder' AND hp.is_current=1) AS breeder,
         (SELECT group_concat(p.name_latin || ' ' || COALESCE(p.name_native,''), '، ') FROM horse_people hp JOIN people p ON p.id=hp.person_id WHERE hp.horse_id=h.id AND hp.role='owner' AND hp.is_current=1) AS owner
  FROM horses h
  LEFT JOIN horses s ON s.id=h.father_id AND s.deleted_at IS NULL AND s.is_active=1
  LEFT JOIN horses m ON m.id=h.mother_id AND m.deleted_at IS NULL AND m.is_active=1
  WHERE h.id=? AND h.deleted_at IS NULL AND h.is_active=1
`;

async function loadPublicAttestationRefs(db: D1Database, horseId: number): Promise<Array<Record<string, unknown>>> {
  const rows = await publicHorseAttestations(db, horseId);
  return rows.attestations.slice(0, 50).map(row => ({
    attestation_id: row.id, issuer_slug: row.issuer.slug, issuer_name: row.issuer.name,
    record_kind: row.record_kind, field_scope: null, issued_at: row.issued_at,
    expires_at: row.expires_at, status: row.status,
  }));
}

async function loadCurrentSnapshot(db: D1Database, horseId: number, language: "fa" | "en"): Promise<ExtractPayload | null> {
  const horse = await db.prepare(EXTRACT_HORSE_SQL).bind(horseId).first<ExtractSourceRow>();
  if (!horse) return null;
  const attestations = await loadPublicAttestationRefs(db, horseId);
  return buildExtractSnapshot({ horse, attestations, language, issuedAt: "" });
}

// ---------------------------------------------------------------------------
// Issuance.

export interface IssuedExtract {
  id: string;
  horse_id: number;
  extract_code: string;
  language: "fa" | "en";
  template_version: string;
  issued_at: string;
  payload_digest: string;
  verify_url: string;
}

async function issueExtract(
  db: D1Database,
  actorUserId: string,
  horseId: number,
  language: "fa" | "en",
): Promise<IssuedExtract> {
  const horse = await db.prepare(EXTRACT_HORSE_SQL).bind(horseId).first<ExtractSourceRow>();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  const attestations = await loadPublicAttestationRefs(db, horseId);
  const issuedAt = new Date().toISOString();
  const payload = buildExtractSnapshot({ horse, attestations, language, issuedAt });
  const canonical = stableStringify(payload);
  const digest = await sha256Hex(canonical);
  const id = crypto.randomUUID();
  const code = generateExtractCode();
  await db.prepare(`
    INSERT INTO registry_extracts(id,horse_id,extract_code,language,template_version,payload,payload_digest,issued_by_user_id,status)
    VALUES(?,?,?,?,?,?,?,?, 'active')
  `).bind(id, horseId, code, language, payload.meta.template_version, canonical, digest, actorUserId).run();
  return {
    id,
    horse_id: horseId,
    extract_code: code,
    language,
    template_version: payload.meta.template_version,
    issued_at: issuedAt,
    payload_digest: digest,
    verify_url: `/api/extract/verify?code=${code}`,
  };
}

/**
 * POST /api/horses/{id}/certificate — records an extract issuance. Editorial
 * permission gates WHO issues, but issuance is a snapshot operation: it never
 * changes verification state and paying never influences it (plan T05
 * acceptance). The response keeps the legacy `certificate` envelope for
 * existing clients and adds the canonical `extract` envelope.
 */
export async function recordExtractIssuance(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  horseId: number,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const lang: "fa" | "en" = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "fa";
  const extract = await issueExtract(env.DB, auth.user.id, horseId, lang);
  return json({
    extract,
    certificate: {
      id: extract.id,
      horse_id: extract.horse_id,
      language: extract.language,
      verification_code: extract.extract_code,
      svg_url: `/api/horses/${horseId}/certificate.svg?lang=${lang}&extract=${extract.extract_code}`,
    },
  }, { status: 201 });
}

// ---------------------------------------------------------------------------
// Revocation (reason required, audit retained).

const ExtractRevokeSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export async function revokeExtract(
  request: Request,
  env: { DB: D1Database; SESSION_COOKIE_NAME: string },
  extractId: string,
): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  if (!capabilitiesForRole(auth.user.role as never).includes("content.manage")) {
    throw new HttpError(403, "forbidden", "Only platform content managers can revoke issued extracts");
  }
  const row = await env.DB.prepare("SELECT id,status FROM registry_extracts WHERE id=?").bind(extractId).first<{ id: string; status: string }>();
  if (!row) throw new HttpError(404, "not_found", "Extract not found");
  if (row.status !== "active") throw new HttpError(409, "not_active", `Extract is already ${row.status}`);
  const parsed = ExtractRevokeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "reason_required", "A reason is required to revoke an extract", parsed.error.flatten());
  await env.DB.prepare("UPDATE registry_extracts SET status='revoked', revoked_at=CURRENT_TIMESTAMP, revoked_reason=? WHERE id=? AND status='active'")
    .bind(parsed.data.reason, extractId).run();
  return json({ revoked: extractId, reason: parsed.data.reason });
}

// ---------------------------------------------------------------------------
// Public verification.

export interface ExtractVerifyResult {
  valid: boolean;
  reason?: string;
  extract?: {
    code: string;
    status: string;
    revoked_at: string | null;
    revoked_reason: string | null;
    issued_at: string;
    language: string;
    template_version: string;
    payload: ExtractPayload;
    payload_digest_matches: boolean;
    changed_since_issuance: boolean;
    changed_fields: string[];
  };
}

/** Core verification, separated from HTTP for testability. */
export async function verifyExtractCore(db: D1Database, code: string): Promise<ExtractVerifyResult> {
  const row = await db.prepare(`
    SELECT id,horse_id,extract_code,language,template_version,payload,payload_digest,issued_at,status,revoked_at,revoked_reason
    FROM registry_extracts WHERE extract_code=?
  `).bind(code).first<{
    id: string; horse_id: number; extract_code: string; language: "fa" | "en"; template_version: string;
    payload: string; payload_digest: string; issued_at: string; status: string; revoked_at: string | null; revoked_reason: string | null;
  }>();
  if (!row) return { valid: false, reason: "unknown_code" };

  let payload: ExtractPayload;
  try {
    payload = JSON.parse(row.payload) as ExtractPayload;
  } catch {
    return { valid: false, reason: "unreadable_payload" };
  }
  // Defense in depth: the stored digest must still authenticate the stored
  // payload. A tampered row fails closed.
  const digestMatches = (await sha256Hex(row.payload)) === row.payload_digest;
  if (!digestMatches) return { valid: false, reason: "payload_tampered" };

  const current = await loadCurrentSnapshot(db, row.horse_id, row.language);
  if (!current) return { valid: false, reason: "subject_unavailable" };
  // Frozen data never overrides a later visibility withdrawal. Legacy
  // snapshots that contain private identifiers or unbound attestation scope
  // require a new, filtered extract instead of redisclosing historical bytes.
  if (payload.horse.ueln_no || payload.horse.uel_no || payload.horse.microchip_no
    || payload.attestations.some(a => !a.attestation_id || a.field_scope != null
      || !current.attestations.some(visible => visible.attestation_id === a.attestation_id))) {
    return { valid: false, reason: "visibility_changed" };
  }
  const parentIds = [...new Set([payload.pedigree.sire?.id, payload.pedigree.dam?.id].filter(id => id != null))];
  if (parentIds.length) {
    if (parentIds.some(id => !Number.isSafeInteger(Number(id)) || Number(id) < 1)) return { valid: false, reason: "visibility_changed" };
    const visible = await db.prepare(`SELECT COUNT(*) AS count FROM horses WHERE id IN (${parentIds.map(() => "?").join(",")}) AND deleted_at IS NULL AND is_active=1`).bind(...parentIds.map(Number)).first<number>("count");
    if (Number(visible) !== parentIds.length) return { valid: false, reason: "visibility_changed" };
  }
  const changedFields = diffExtractPayloads(payload, current);

  return {
    valid: true,
    extract: {
      code: row.extract_code,
      status: row.status,
      revoked_at: row.revoked_at,
      revoked_reason: row.revoked_reason,
      issued_at: row.issued_at,
      language: row.language,
      template_version: row.template_version,
      payload,
      payload_digest_matches: true,
      changed_since_issuance: changedFields.length > 0,
      changed_fields: changedFields,
    },
  };
}

/** GET /api/extract/verify?code= — public, central public-limiter protected. */
export async function verifyExtractEndpoint(db: D1Database, url: URL): Promise<Response> {
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,80}$/.test(code)) return json({ valid: false, reason: "malformed_code" });
  const result = await verifyExtractCore(db, code);
  if (!result.valid) return json({ valid: false, reason: result.reason });
  const { payload, ...meta } = result.extract!;
  return json({
    valid: true,
    extract: {
      ...meta,
      // Historical FACTS come from the stored snapshot; never live data.
      facts: payload.horse,
      pedigree: payload.pedigree,
      people: payload.people,
      attestation_references: payload.attestations,
      legal_status: payload.meta.legal_status,
      legal_status_note: payload.meta.language === "fa" ? payload.meta.legal_status_note_fa : payload.meta.legal_status_note_en,
      changed_since_issuance: meta.changed_since_issuance,
      changed_fields: meta.changed_fields,
    },
  });
}

/** Load a stored extract payload + change notice (for the SVG renderer). */
export async function loadExtractForRendering(
  db: D1Database,
  horseId: number,
  code: string,
): Promise<{ payload: ExtractPayload; status: string; revokedReason: string | null; changedFields: string[] } | null> {
  const verified = await verifyExtractCore(db, code);
  if (!verified.valid || !verified.extract || Number(verified.extract.payload.horse.id) !== horseId) return null;
  return {
    payload: verified.extract.payload,
    status: verified.extract.status,
    revokedReason: verified.extract.revoked_reason,
    changedFields: verified.extract.changed_fields,
  };
}

/** Latest extract code for a horse (preview banner "latest issued extract"). */
export async function latestExtractCode(db: D1Database, horseId: number): Promise<string | null> {
  const row = await db.prepare(
    "SELECT extract_code FROM registry_extracts WHERE horse_id=? AND status='active' ORDER BY issued_at DESC LIMIT 1",
  ).bind(horseId).first<{ extract_code: string }>();
  return row?.extract_code ?? null;
}
