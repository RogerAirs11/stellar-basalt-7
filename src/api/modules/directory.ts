import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf, requirePermission } from "../../auth/guards";
import { credentialVerificationLevel, isValidProvinceCode, isServiceCategoryId, parseServiceCategories, PROVINCE_CODE_SCHEME, publicProvince } from "../../directory/vocabulary";
import { managedProfile } from "../../directory/profileView";
import { credentialDay, credentialPeriod } from "../../directory/credentialPolicy";
import { reviewClaim, writeProfile, reviewCredential, createClaim, createCredential } from "../../directory/commands";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P11 — the professional directory.
 *
 * Doctrine:
 *  - Directory persons/organizations are SEPARATE from login users. A person
 *    may hold many service categories (one profile row, many categories);
 *    representation is established through reviewed claims, never assumed.
 *  - Self-declaration NEVER becomes verification: credentials stay
 *    'unverified' until platform review or issuer attestation (T05
 *    vocabulary), and every public DTO carries the honest level.
 *  - Publication requires EXPLICIT consent (publication_consent); revoking
 *    consent unpublishes instantly. contact_value is NEVER in any public
 *    DTO — only the preference for how contact should be mediated.
 *  - Expired credentials lose their active state but stay as history.
 *  - Service areas use the approved province code vocabulary (ISO
 *    3166-2:IR); city is canonical text within a province.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Public directory reads.
// ---------------------------------------------------------------------------

interface PublicPersonRow {
  id: number;
  person_id: number;
  name_latin: string | null;
  name_native: string | null;
  service_categories: string;
  province_code: string | null;
  province_code_scheme: string;
  city: string | null;
  contact_preference: string;
  languages: string | null;
  availability_text: string | null;
}

function projectPublicPerson(row: PublicPersonRow): Record<string, unknown> {
  return {
    person_id: row.person_id,
    name_latin: row.name_latin,
    name_native: row.name_native,
    service_categories: parseServiceCategories(row.service_categories),
    ...publicProvince(row.province_code, row.province_code_scheme),
    city: row.city,
    contact_preference: row.contact_preference,
    languages: row.languages,
    availability_text: row.availability_text,
    // contact_value is deliberately absent: private by default, never public.
    contact_note: "Contact is mediated by the platform per the stated preference.",
  };
}

export async function listDirectoryPersons(db: D1Database, url: URL): Promise<Response> {
  const category = url.searchParams.get("category");
  const province = url.searchParams.get("province");
  const city = url.searchParams.get("city");
  const name = url.searchParams.get("name");
  const cursor = Number(url.searchParams.get("cursor") ?? 0);
  if (category != null && category !== "" && !isServiceCategoryId(category)) {
    throw new HttpError(400, "invalid_category", "Unknown service category");
  }
  if (province != null && province !== "" && !isValidProvinceCode(province)) {
    throw new HttpError(400, "invalid_province", "Province must be an approved ISO 3166-2:IR code (e.g. IR-08)");
  }
  const where: string[] = ["dp.publication_consent=1", "p.deleted_at IS NULL"];
  const binds: Array<string | number> = [];
  if (category) {
    where.push("dp.service_categories LIKE ?");
    binds.push(`%"${category}"%`);
  }
  if (province) {
    where.push("dp.province_code=? AND dp.province_code_scheme=?");
    binds.push(province, PROVINCE_CODE_SCHEME);
  }
  if (city) {
    where.push("dp.city LIKE ? COLLATE NOCASE");
    binds.push(`%${city}%`);
  }
  if (name) {
    where.push("(p.name_latin LIKE ? COLLATE NOCASE OR p.name_native LIKE ?)");
    binds.push(`%${name}%`, `%${name}%`);
  }
  const rows = await db.prepare(`
    SELECT dp.id, dp.person_id, p.name_latin, p.name_native, dp.service_categories, dp.province_code, dp.province_code_scheme, dp.city,
           dp.contact_preference, dp.languages, dp.availability_text
    FROM directory_profiles dp
    JOIN people p ON p.id = dp.person_id
    WHERE ${where.join(" AND ")} AND dp.person_id > ?
    ORDER BY dp.person_id ASC
    LIMIT ${PAGE_SIZE + 1}
  `).bind(...binds, Number.isFinite(cursor) && cursor > 0 ? cursor : 0).all<PublicPersonRow>();
  const page = (rows.results ?? []).slice(0, PAGE_SIZE);
  const nextCursor = (rows.results ?? []).length > PAGE_SIZE ? page[page.length - 1]!.person_id : null;
  return json({
    persons: page.map(projectPublicPerson),
    next_cursor: nextCursor,
    page_size: PAGE_SIZE,
    filters: { category: category ?? null, province: province ?? null, city: city ?? null, name: name ?? null },
  });
}

export async function directoryPersonDetail(db: D1Database, personId: number): Promise<Response> {
  const row = await db.prepare(`
    SELECT dp.id, dp.person_id, p.name_latin, p.name_native, dp.service_categories, dp.province_code, dp.province_code_scheme, dp.city,
           dp.contact_preference, dp.languages, dp.availability_text, dp.publication_consent
    FROM directory_profiles dp
    JOIN people p ON p.id = dp.person_id
    WHERE dp.person_id=? AND p.deleted_at IS NULL
  `).bind(personId).first<PublicPersonRow & { publication_consent: number }>();
  if (!row) throw new HttpError(404, "not_found", "Directory profile not found");
  if (row.publication_consent !== 1) {
    throw new HttpError(404, "not_published", "This profile is not published (consent withdrawn or never given)");
  }
  const credentials = await db.prepare(`
    SELECT id, role, issuer_name, identifier, issued_at, expires_at, verification_state, revoked_at, row_version
    FROM person_credentials WHERE person_id=? ORDER BY role, id
  `).bind(personId).all();
  // Honesty: an expired credential loses its active state but STAYS in the
  // history — never silently dropped, never shown as active.
  const projected = (credentials.results ?? []).map((credential) => {
    const record = credential as Record<string, unknown>;
    return {
      id: record.id,
      role: record.role,
      issuer_name: record.issuer_name,
      identifier: record.identifier,
      issued_at: record.issued_at ?? null,
      expires_at: record.expires_at ?? null,
      is_active: credentialPeriod(record) === "within_recorded_dates",
      recorded_period_status: credentialPeriod(record),
      authority_needs_review: record.verification_state === "issuer_attested",
      row_version: record.row_version,
      verification_state: credentialVerificationLevel(String(record.verification_state ?? "unverified")),
      verification_level: credentialVerificationLevel(String(record.verification_state ?? "unverified")),
    };
  });
  return json({
    person: projectPublicPerson(row),
    credentials: projected,
    active_credentials: projected.filter((credential) => credential.is_active),
    credentials_note: "Recorded dates are not a qualification guarantee. Platform review is editorial, not issuer attestation. Invalid, future, expired and revoked credentials remain visible as history. Legacy issuer labels require evidence review.",
  });
}

export async function listDirectoryOrganizations(db: D1Database, url: URL): Promise<Response> {
  const category = url.searchParams.get("category");
  const province = url.searchParams.get("province");
  const cursor = Number(url.searchParams.get("cursor") ?? 0);
  if (category != null && category !== "" && !isServiceCategoryId(category)) {
    throw new HttpError(400, "invalid_category", "Unknown service category");
  }
  if (province != null && province !== "" && !isValidProvinceCode(province)) {
    throw new HttpError(400, "invalid_province", "Province must be an approved ISO 3166-2:IR code");
  }
  const where: string[] = ["op.publication_consent=1", "o.status='active'"];
  const binds: Array<string | number> = [];
  if (category) {
    where.push("op.service_categories LIKE ?");
    binds.push(`%"${category}"%`);
  }
  if (province) {
    where.push("op.province_code=? AND op.province_code_scheme=?");
    binds.push(province, PROVINCE_CODE_SCHEME);
  }
  const rows = await db.prepare(`
    SELECT op.id, op.organization_id, o.slug, o.name_latin, o.name_native, o.kind,
           op.service_categories, op.province_code, op.province_code_scheme, op.city, op.contact_preference, op.description
    FROM organization_profiles op
    JOIN organizations o ON o.id = op.organization_id
    WHERE ${where.join(" AND ")} AND op.organization_id > ?
    ORDER BY op.organization_id ASC
    LIMIT ${PAGE_SIZE + 1}
  `).bind(...binds, Number.isFinite(cursor) && cursor > 0 ? cursor : 0).all();
  const page = (rows.results ?? []).slice(0, PAGE_SIZE);
  const nextCursor = (rows.results ?? []).length > PAGE_SIZE ? (page[page.length - 1] as Record<string, unknown>).organization_id : null;
  return json({
    organizations: page.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        organization_id: record.organization_id,
        slug: record.slug,
        name_latin: record.name_latin,
        name_native: record.name_native,
        kind: record.kind,
        description: record.description ?? null,
        service_categories: parseServiceCategories(typeof record.service_categories === "string" ? record.service_categories : "[]"),
        ...publicProvince(typeof record.province_code === "string" ? record.province_code : null, typeof record.province_code_scheme === "string" ? record.province_code_scheme : null),
        city: record.city ?? null,
        contact_preference: record.contact_preference ?? "platform_message",
        contact_note: "Contact is mediated by the platform per the stated preference.",
      };
    }),
    next_cursor: nextCursor,
    page_size: PAGE_SIZE,
  });
}

// ---------------------------------------------------------------------------
// Claims: representation with evidence, moderation and appeal.
// ---------------------------------------------------------------------------

const ClaimSchema = z.object({
  claim_type: z.enum(["person", "organization"]),
  person_id: z.number().int().positive().nullable().optional(),
  organization_id: z.number().int().positive().nullable().optional(),
  evidence_note: z.string().trim().min(10).max(2000),
  evidence_media_id: z.string().trim().max(64).nullable().optional(),
  appeal_for_claim_id: z.number().int().positive().nullable().optional(),
});

export async function createDirectoryClaim(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = ClaimSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_claim", "Claim failed validation", parsed.error.flatten());
  const d = parsed.data;
  if ((d.claim_type === "person" && d.organization_id != null) || (d.claim_type === "organization" && d.person_id != null)) throw new HttpError(400, "invalid_claim", "A claim must identify exactly one target type");
  if (d.claim_type === "person") {
    if (d.person_id == null) throw new HttpError(400, "invalid_claim", "person_id is required for a person claim");
    const person = await env.DB.prepare("SELECT id FROM people WHERE id=? AND deleted_at IS NULL").bind(d.person_id).first();
    if (!person) throw new HttpError(404, "not_found", "Person not found");
  } else {
    if (d.organization_id == null) throw new HttpError(400, "invalid_claim", "organization_id is required for an organization claim");
    const organization = await env.DB.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(d.organization_id).first();
    if (!organization) throw new HttpError(404, "not_found", "Organization not found (or not active)");
  }
  // Appeal integrity: the referenced claim must belong to THIS user and be
  // rejected — you can only appeal your own rejection.
  if (d.appeal_for_claim_id != null) {
    const prior = await env.DB.prepare("SELECT id,user_id,status,claim_type,person_id,organization_id FROM directory_claims WHERE id=?").bind(d.appeal_for_claim_id)
      .first<{ id: number; user_id: string; status: string; claim_type: string; person_id: number | null; organization_id: number | null }>();
    if (!prior || prior.user_id !== auth.user.id || prior.status !== "rejected" || prior.claim_type !== d.claim_type || prior.person_id !== (d.person_id ?? null) || prior.organization_id !== (d.organization_id ?? null)) {
      throw new HttpError(400, "invalid_claim", "An appeal must reference your own rejected claim");
    }
  }
  const id = await createClaim(env.DB, { actorId: auth.user.id, kind: d.claim_type,
    personId: d.person_id ?? null, organizationId: d.organization_id ?? null,
    evidenceNote: d.evidence_note, evidenceId: d.evidence_media_id ?? null, appealId: d.appeal_for_claim_id ?? null });
  if (!id) throw new HttpError(409, "claim_conflict", "Claim target, evidence or account changed; duplicate pending claims and more than five pending claims are not permitted");
  const claim = await env.DB.prepare("SELECT * FROM directory_claims WHERE id=? AND user_id=?").bind(id, auth.user.id).first();
  return json({
    claim,
    note: "Claims are moderated. An approved person claim verifies your user_person_link; an approved organization claim grants a manager membership. Nothing publishes without explicit consent on the profile.",
  }, { status: 201 });
}

export async function myDirectoryClaims(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare("SELECT * FROM directory_claims WHERE user_id=? ORDER BY id DESC LIMIT 100").bind(auth.user.id).all();
  return json({ claims: rows.results ?? [] });
}

const ReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  review_note: z.string().trim().min(3).max(1000),
  expected_version: z.number().int().positive().optional(),
});

export async function reviewDirectoryClaim(request: Request, env: Env, claimId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "claim.review");
  requireCsrf(request, auth);
  const parsed = ReviewSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "Review failed validation", parsed.error.flatten());
  const claim = await env.DB.prepare("SELECT id,user_id,claim_type,person_id,organization_id,status,row_version FROM directory_claims WHERE id=?").bind(claimId)
    .first<{ id: number; user_id: string; claim_type: string; person_id: number | null; organization_id: number | null; status: string; row_version: number }>();
  if (!claim) throw new HttpError(404, "not_found", "Claim not found");
  if (claim.status !== "pending") throw new HttpError(409, "already_reviewed", "This claim has already been reviewed (appeal through a new claim)");

  const applied = await reviewClaim(env.DB, { actorId: auth.user.id, claimId,
    expectedVersion: parsed.data.expected_version ?? claim.row_version,
    decision: parsed.data.decision, note: parsed.data.review_note });
  if (!applied) throw new HttpError(409, "review_conflict", "Claim, claimant or authority changed; self-review is not allowed");
  const after = await env.DB.prepare("SELECT * FROM directory_claims WHERE id=?").bind(claimId).first();
  return json({ claim: after, review: { decision: parsed.data.decision, review_note: parsed.data.review_note } });
}

// ---------------------------------------------------------------------------
// Profile management (requires representation: approved claim or staff).
// ---------------------------------------------------------------------------

const ProfileSchema = z.object({
  service_categories: z.array(z.string().trim().min(2).max(40)).max(22).default([]),
  province_code: z.string().trim().max(8).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  contact_preference: z.enum(["platform_message", "phone", "email"]).default("platform_message"),
  contact_value: z.string().trim().max(240).nullable().optional(),
  languages: z.string().trim().max(200).nullable().optional(),
  availability_text: z.string().trim().max(500).nullable().optional(),
  publication_consent: z.boolean(),
  expected_version: z.number().int().nonnegative().optional(),
  province_code_scheme: z.string().max(80).optional(),
});

async function personManageAuthorized(db: D1Database, userId: string, role: string, personId: number): Promise<boolean> {
  if (role === "admin" || role === "super_admin" || role === "editor") return true;
  const link = await db.prepare("SELECT id FROM user_person_links WHERE user_id=? AND person_id=? AND status='verified'").bind(userId, personId).first();
  return Boolean(link);
}

export async function getManagedPersonProfile(request: Request, env: Env, personId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const view = await managedProfile(env.DB, auth.user.id, personId);
  if (!view) throw new HttpError(403, "directory_claim_required", "This account cannot manage the requested profile");
  return json(view, { headers: { "Cache-Control": "private, no-store" } });
}

export async function updatePersonDirectoryProfile(request: Request, env: Env, personId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const person = await env.DB.prepare("SELECT id FROM people WHERE id=? AND deleted_at IS NULL").bind(personId).first();
  if (!person) throw new HttpError(404, "not_found", "Person not found");
  const authorized = await personManageAuthorized(env.DB, auth.user.id, auth.user.role, personId);
  if (!authorized) {
    // An unrelated account cannot change a person's directory profile.
    throw new HttpError(403, "directory_claim_required", "You need an approved directory claim (verified person link) to manage this profile");
  }
  const parsed = ProfileSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_profile", "Profile failed validation", parsed.error.flatten());
  const d = parsed.data;
  for (const category of d.service_categories) {
    if (!isServiceCategoryId(category)) throw new HttpError(400, "invalid_category", `Unknown service category: ${category}`);
  }
  if (d.province_code != null && d.province_code !== "" && !isValidProvinceCode(d.province_code)) {
    throw new HttpError(400, "invalid_province", "Province must be an approved ISO 3166-2:IR code (e.g. IR-08)");
  }
  if (d.publication_consent && !d.contact_preference) {
    throw new HttpError(400, "invalid_profile", "A published profile needs a contact preference");
  }
  if (d.province_code && d.province_code_scheme !== PROVINCE_CODE_SCHEME) {
    throw new HttpError(400, "province_scheme_required", "Select the province again using the current reference dataset");
  }
  const prior = await env.DB.prepare("SELECT row_version FROM directory_profiles WHERE person_id=?").bind(personId).first<{ row_version: number }>();
  if (prior && d.expected_version === undefined) throw new HttpError(428, "profile_version_required", "Read the manageable profile and submit its exact row_version; updates cannot silently overwrite an unseen edit");
  const applied = await writeProfile(env.DB, { actorId: auth.user.id, personId,
    expectedVersion: d.expected_version ?? 0, categories: d.service_categories,
    province: d.province_code || null, city: d.city ?? null, contactPreference: d.contact_preference,
    contactValue: d.contact_value ?? null, languages: d.languages ?? null, availability: d.availability_text ?? null,
    consent: d.publication_consent });
  if (!applied) throw new HttpError(409, "profile_conflict", "Profile or representation changed. Initial publication requires the subject's verified representative.");
  const profile = await env.DB.prepare("SELECT id,person_id,service_categories,province_code,city,contact_preference,languages,availability_text,publication_consent,published_at,row_version,province_code_scheme FROM directory_profiles WHERE person_id=?").bind(personId).first();
  const privateView = await managedProfile(env.DB, auth.user.id, personId);
  return json({
    profile,
    // Return actual stored state only to a current verified representative.
    contact_value_stored: privateView?.profile.contact_value ?? null,
    publication: d.publication_consent ? "published" : "unpublished (consent not given or withdrawn)",
  });
}

const CredentialSchema = z.object({
  role: z.string().trim().min(2).max(40),
  issuer_name: z.string().trim().min(2).max(200),
  identifier: z.string().trim().min(1).max(120),
  issued_at: z.string().refine((value) => credentialDay(value) !== null, "A real Gregorian calendar date is required").nullable().optional(),
  expires_at: z.string().refine((value) => credentialDay(value) !== null, "A real Gregorian calendar date is required").nullable().optional(),
  evidence_media_id: z.string().trim().max(64).nullable().optional(),
});

export async function addPersonCredential(request: Request, env: Env, personId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const authorized = await personManageAuthorized(env.DB, auth.user.id, auth.user.role, personId);
  if (!authorized) throw new HttpError(403, "directory_claim_required", "You need an approved directory claim (verified person link) to manage this profile");
  const parsed = CredentialSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_credential", "Credential failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (!isServiceCategoryId(d.role)) throw new HttpError(400, "invalid_credential", "Role must be a reviewed vocabulary category");
  if (d.issued_at && d.expires_at && d.expires_at < d.issued_at) throw new HttpError(400, "invalid_credential", "Expiry precedes issue date");
  // Self-declaration never becomes verification: the credential lands as
  // 'unverified' — platform review and issuer attestation are the only paths
  // to higher states (handled by staff tools, not by this endpoint).
  const id = await createCredential(env.DB, { actorId: auth.user.id, personId, role: d.role,
    issuerName: d.issuer_name, identifier: d.identifier, issuedAt: d.issued_at ?? null,
    expiresAt: d.expires_at ?? null, evidenceId: d.evidence_media_id ?? null });
  if (!id) throw new HttpError(409, "credential_conflict", "Credential already exists, evidence is unavailable, or representation changed");
  const credential = await env.DB.prepare("SELECT id,person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,row_version FROM person_credentials WHERE id=?").bind(id).first();
  return json({
    credential,
    verification_level: "unverified",
    note: "Self-declared credentials remain unverified until editorial review. Issuer-bound credential attestation is not integrated; no paid or editorial action grants issuer authority.",
  }, { status: 201 });
}

export async function reviewPersonCredential(request: Request, env: Env, credentialId: number): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "claim.review");
  requireCsrf(request, auth);
  const parsed = z.object({ decision: z.enum(["platform_reviewed", "revoked", "issuer_attested"]),
    note: z.string().trim().min(3).max(500), expected_version: z.number().int().positive().optional() })
    .safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_review", "Review failed validation", parsed.error.flatten());
  if (parsed.data.decision === "issuer_attested") throw new HttpError(409, "issuer_authority_required",
    "Platform staff cannot issue an external attestation. This credential workflow has no issuer-bound attestation integration.");
  const credential = await env.DB.prepare("SELECT id,row_version FROM person_credentials WHERE id=?").bind(credentialId)
    .first<{ id: number; row_version: number }>();
  if (!credential) throw new HttpError(404, "not_found", "Credential not found");
  const applied = await reviewCredential(env.DB, { actorId: auth.user.id, credentialId,
    expectedVersion: parsed.data.expected_version ?? credential.row_version, decision: parsed.data.decision, note: parsed.data.note });
  if (!applied) throw new HttpError(409, "credential_conflict", "Credential or authority changed; self-review and reactivation of revoked credentials are not permitted");
  const after = await env.DB.prepare("SELECT id,person_id,role,issuer_name,identifier,issued_at,expires_at,verification_state,verified_at,revoked_at,row_version FROM person_credentials WHERE id=?").bind(credentialId).first();
  return json({ credential: after, verification_level: credentialVerificationLevel(String(after?.verification_state ?? "unverified")) });
}
