import { createDossierStatements, createDossierLinkStatements, revokeDossierStatements, revokeDossierLinkStatements, claimDossierViewStatements } from "../../dossiers/commands";
import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { getAuth } from "../../auth/session";
import { requireHorseAction } from "../../access/horseAccess";
import { timestampMillis } from "../../security/timestamps";
import { buildDossierSnapshot, dossierContentDigest, dossierSnapshotsEqual, frozenGeneticsStillPublic, parseLegacyDossierPayload, DOSSIER_SCHEMA_VERSION } from "../../dossiers/snapshot";
export { buildDossierSnapshot, sectionMeta } from "../../dossiers/snapshot";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P15 — shareable sale dossiers with expiry and evidence
 * limits; R95-N13 — creation and sharing transactionally consistent.
 *
 * Boundary rules (each pinned by tests):
 *  - The snapshot is FROZEN at creation (snapshot_json is never rewritten).
 *    A later canonical correction makes the VIEW report staleness live —
 *    computed by comparing the included permitted evidence — without touching
 *    the shared bytes.
 *  - The snapshot is built from ONE consistent statement (see snapshot.ts) —
 *    a concurrent source update can never tear the sections.
 *  - Creation and link minting re-check the CURRENT seller mandate INSIDE the
 *    transaction: a mandate revoked between preflight and the batch produces
 *    no snapshot and no share token (honest 409, zero rows).
 *  - Every issued dossier carries an immutable digest over its exact content
 *    bytes; the view recomputes it — a mismatch is controlled operator
 *    review (410), never a 500, never altered bytes served silently.
 *  - Share tokens are 32 random bytes, base64url. Only the SHA-256 hash is
 *    stored; the raw token exists solely inside the URL given to the
 *    recipient.
 *  - Revoked/expired links return 410 and reveal nothing; responses are
 *    no-store so no cache can hold old private data.
 *  - Redaction is VISIBLE: excluded sections appear as "not_shared", never
 *    as a clean or verified absence. Genetics/contact default to not shared.
 *  - Every view carries the standing warnings: a dossier is neither a title
 *    transfer nor a veterinary purchase examination, is not an official
 *    passport or guarantee, and no verification badge exists for sale.
 *  - Access logging is BOUNDED: a counter and a last-access timestamp only —
 *    no viewer identity, IP or user agent is stored for token views.
 */

type Env = { DB: D1Database; SESSION_COOKIE_NAME: string };

export const DOSSIER_WARNINGS = {
  not_title_transfer: "This dossier is a summary of permitted registry data. It is not a title transfer, a bill of sale, or proof of ownership.",
  not_vet_exam: "This dossier is not a veterinary purchase examination (vetting). Health and suitability must be assessed by a qualified veterinarian.",
  not_official_document: "This dossier is a platform information extract with an integrity digest. It is not an official passport, identity document, or guarantee of accuracy.",
  snapshot_age: "The data below was captured when the dossier was generated; the registry record may have changed since. Public access can end when authority or evidence-sharing permission changes.",
  stale: "The registry record changed after this snapshot was generated. Ask the seller for a fresh dossier.",
} as const;

const CreateSchema = z.object({
  horse_id: z.number().int().positive(),
  include_pedigree: z.boolean().default(true),
  include_results: z.boolean().default(true),
  // Private-by-default sections: absence is listed as not_shared, never clean.
  include_genetics: z.boolean().default(false),
  include_contact: z.boolean().default(false),
  note: z.string().trim().max(500).nullable().optional(),
});

const LinkCreateSchema = z.object({
  expires_in_days: z.number().int().min(1).max(90),
  recipient_user_id: z.string().min(3).max(64).nullable().optional(),
});

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** High-entropy share token: 32 random bytes, base64url (~43 chars). */
export function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createDossier(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = CreateSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_dossier", "Dossier failed validation", parsed.error.flatten());
  const d = parsed.data;
  // Seller mandate: creating a SALE dossier requires the create_listing
  // authority on this horse (owner mandate or delegated seller mandate).
  // The preflight gives the honest early error; the transaction re-checks.
  await requireHorseAction(env.DB, auth, d.horse_id, "create_listing");
  const { snapshot, sectionsMeta } = await buildDossierSnapshot(env.DB, d.horse_id, {
    includePedigree: d.include_pedigree,
    includeResults: d.include_results,
    includeGenetics: d.include_genetics,
    includeContact: d.include_contact,
    creatorUserId: auth.user.id,
  });
  const snapshotJson = JSON.stringify(snapshot);
  const sectionsMetaJson = JSON.stringify(sectionsMeta);
  const issuedDigest = await dossierContentDigest(snapshotJson, sectionsMetaJson);
  const operationId = crypto.randomUUID();
  const [insert] = await env.DB.batch(createDossierStatements(env.DB, {
    operationId, actorUserId: auth.user.id, actorRole: auth.user.role,
    horseId: d.horse_id, version: DOSSIER_SCHEMA_VERSION,
    snapshotJson, sectionsMetaJson, issuedDigest,
  }));
  if (Number(insert?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "sharing_authority_changed", "The horse or your sharing authority changed before the dossier could be issued; reload and retry");
  }
  const id = Number(insert?.meta.last_row_id ?? 0);
  return json({
    created: true,
    dossier: { id, horse_id: d.horse_id, version: DOSSIER_SCHEMA_VERSION, status: "active", issued_digest: issuedDigest },
    sections: sectionsMeta,
    warnings: DOSSIER_WARNINGS,
  }, { status: 201 });
}

export async function myDossiers(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(`
    SELECT ds.id, ds.horse_id, ds.version, ds.status, ds.issued_digest, ds.created_at,
           (SELECT COUNT(*) FROM dossier_share_links l WHERE l.dossier_id=ds.id AND l.revoked_at IS NULL AND datetime(l.expires_at)>datetime('now')) AS active_links
    FROM dossier_snapshots ds WHERE ds.created_by_user_id=? ORDER BY ds.id DESC LIMIT 100
  `).bind(auth.user.id).all<Record<string, unknown>>();
  return json({ dossiers: rows.results ?? [], warnings: DOSSIER_WARNINGS });
}

export async function createDossierLink(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = LinkCreateSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_link", "Link failed validation (expiry 1-90 days required)", parsed.error.flatten());
  const dossier = await env.DB.prepare("SELECT id, horse_id, status, created_by_user_id FROM dossier_snapshots WHERE id=?").bind(id)
    .first<{ id: number; horse_id: number; status: string; created_by_user_id: string }>();
  if (!dossier || dossier.created_by_user_id !== auth.user.id) throw new HttpError(404, "not_found", "Dossier not found");
  if (dossier.status !== "active") throw new HttpError(409, "dossier_revoked", "This dossier is revoked; its links can no longer be used");
  await requireHorseAction(env.DB, auth, dossier.horse_id, "create_listing");
  const token = generateShareToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + parsed.data.expires_in_days * 24 * 3600 * 1000).toISOString();
  const operationId = crypto.randomUUID();
  const [insert] = await env.DB.batch(createDossierLinkStatements(env.DB, {
    operationId, actorUserId: auth.user.id, actorRole: auth.user.role,
    dossierId: id, tokenHash, expiresAt, recipientUserId: parsed.data.recipient_user_id ?? null,
  }));
  if (Number(insert?.meta.changes ?? 0) !== 1) {
    // The mandate (or the horse, or the dossier) changed between the
    // preflight and the mint: NO share token was produced.
    throw new HttpError(409, "sharing_authority_changed", "The horse or your sharing authority changed before the link could be minted; reload and retry");
  }
  return json({
    created: true,
    link_id: Number(insert?.meta.last_row_id ?? 0),
    // The raw token appears EXACTLY ONCE, in this response, for the seller to
    // hand over. Only its hash is stored.
    share_url: `/api/dossiers/view/${token}`,
    expires_at: expiresAt,
    recipient_restricted: Boolean(parsed.data.recipient_user_id),
    note: "Store this URL now — the token is never shown again and only its hash is stored. Revoking the link makes it useless immediately.",
  }, { status: 201 });
}

export async function revokeDossierLink(request: Request, env: Env, id: number, linkId: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const dossier = await env.DB.prepare("SELECT id, created_by_user_id FROM dossier_snapshots WHERE id=?").bind(id)
    .first<{ created_by_user_id: string }>();
  if (!dossier || dossier.created_by_user_id !== auth.user.id) throw new HttpError(404, "not_found", "Dossier not found");
  const [update] = await env.DB.batch(revokeDossierLinkStatements(env.DB, {id, linkId, actorUserId: auth.user.id, operationId: crypto.randomUUID()}));
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "not_revocable", "Link not found or already revoked");
  return json({ revoked: true, note: "Future authorized link reads are refused. Previously downloaded, photographed or otherwise retained copies cannot be recalled; responses use no-store." });
}

export async function revokeDossier(request: Request, env: Env, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const dossier = await env.DB.prepare("SELECT id, created_by_user_id, status FROM dossier_snapshots WHERE id=?").bind(id)
    .first<{ created_by_user_id: string; status: string }>();
  if (!dossier || dossier.created_by_user_id !== auth.user.id) throw new HttpError(404, "not_found", "Dossier not found");
  if (dossier.status === "revoked") throw new HttpError(409, "already_revoked", "This dossier is already revoked");
  const [update] = await env.DB.batch(revokeDossierStatements(env.DB, {id, actorUserId: auth.user.id, operationId: crypto.randomUUID()}));
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "not_revocable", "Dossier could not be revoked");
  return json({ revoked: true, note: "All share links for this dossier are revoked. The immutable snapshot is retained for audit." });
}

/**
 * The PUBLIC share view (R96-N07): the token-hash lookup resolves the link,
 * then ONE conditional claim statement (see claimDossierViewStatements) is the
 * LINEARIZATION POINT — authorization and the access counter commit together
 * or not at all. Revoked/expired/tampered/lost-authority = 410/403/404 with NO
 * data leakage; every response is private no-store; malformed historical
 * payloads get a controlled operator-review response — never a 500.
 */
export async function viewDossierByToken(request: Request, env: Env, token: string): Promise<Response> {
  const noStore = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return noStore({ error: "not_found", message: "Dossier not found" }, 404);
  const tokenHash = await sha256Hex(token);
  const link = await env.DB.prepare(`
    SELECT l.id, l.dossier_id, l.expires_at, l.revoked_at, l.recipient_user_id
    FROM dossier_share_links l WHERE l.token_hash=?
  `).bind(tokenHash).first<{ id: number; dossier_id: number; expires_at: string; revoked_at: string | null; recipient_user_id: string | null }>();
  if (!link) return noStore({ error: "not_found", message: "Dossier not found" }, 404);

  // The viewer session (if any) resolves BEFORE the claim so the recipient
  // restriction is enforced against the CURRENT session inside the claim
  // statement itself.
  const viewer = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  // R96-N07: claim + read in ONE batch (a transaction on every provider —
  // D1 batch, localSqlite BEGIN/COMMIT, supabaseCompat client.begin).
  const [claim, dossierRead] = await env.DB.batch(claimDossierViewStatements(env.DB, {
    linkId: link.id, viewerUserId: viewer?.user.id ?? null, nowIso: new Date().toISOString(),
  }));
  if (Number(claim?.meta.changes ?? 0) !== 1) {
    // The claim REFUSED: classify for the honest message. This read happens
    // AFTER enforcement and only chooses wording — it grants nothing.
    const fresh = await env.DB.prepare(`
      SELECT l.revoked_at, l.expires_at, l.recipient_user_id, ds.status AS dossier_status,
             (SELECT u.is_active FROM users u WHERE u.id=ds.created_by_user_id) AS creator_active,
             (SELECT COUNT(*) FROM horses h WHERE h.id=ds.horse_id AND h.deleted_at IS NULL AND h.is_active=1) AS horse_alive
      FROM dossier_share_links l JOIN dossier_snapshots ds ON ds.id=l.dossier_id WHERE l.id=?
    `).bind(link.id).first<{ revoked_at: string | null; expires_at: string; recipient_user_id: string | null; dossier_status: string; creator_active: number | null; horse_alive: number }>();
    if (!fresh) return noStore({ error: "not_found", message: "Dossier not found" }, 404);
    if (fresh.revoked_at) return noStore({ error: "link_revoked", message: "This share link has been revoked and no longer provides access." }, 410);
    if (timestampMillis(fresh.expires_at) === null || timestampMillis(fresh.expires_at)! <= Date.now()) {
      return noStore({ error: "link_expired", message: "This share link has expired. Ask the seller for a fresh dossier." }, 410);
    }
    if (fresh.recipient_user_id && fresh.recipient_user_id !== viewer?.user.id) {
      return noStore({ error: "recipient_restricted", message: "This dossier link is restricted to its intended recipient." }, 403);
    }
    if (fresh.dossier_status !== "active") {
      return noStore({ error: "dossier_unavailable", message: "This dossier is no longer available." }, 410);
    }
    if (!fresh.creator_active || !fresh.horse_alive) {
      return noStore({ error: "dossier_unavailable", message: "The seller no longer has current sharing authority." }, 410);
    }
    // Live link, active creator, alive horse — the mandate itself is gone.
    return noStore({ error: "dossier_unavailable", message: "The seller no longer has current sharing authority." }, 410);
  }
  const dossier = (dossierRead?.results ?? [])[0] as { id: number; horse_id: number; snapshot_json: string; sections_meta_json: string; version: number; created_at: string; created_by_user_id: string; issued_digest: string | null } | undefined;
  if (!dossier) {
    // The claim landed but the dossier row vanished before the read (only
    // possible via a revocation committing between the two statements on
    // PostgreSQL READ COMMITTED): refuse — never serve unverified bytes.
    return noStore({ error: "dossier_unavailable", message: "This dossier is no longer available." }, 410);
  }
  // Controlled validation of the historical payload — never a 500.
  const payload = parseLegacyDossierPayload(dossier.snapshot_json, dossier.sections_meta_json);
  if (!payload.ok) {
    return noStore({ error: "dossier_unavailable", message: "This dossier's stored content requires operator review. It is not shown." }, 410);
  }
  const frozen = payload.snapshot;
  const pedigree = frozen.pedigree as { sire_id?: unknown; dam_id?: unknown } | undefined;
  const parentIds = [...new Set([pedigree?.sire_id, pedigree?.dam_id].filter(id => id != null))];
  if (parentIds.length) {
    const validIds = parentIds.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0);
    const visible = validIds ? await env.DB.prepare(`SELECT COUNT(*) AS count FROM horses WHERE id IN (${parentIds.map(() => "?").join(",")}) AND deleted_at IS NULL AND is_active=1`).bind(...parentIds.map(Number)).first<number>("count") : 0;
    if (Number(visible) !== parentIds.length) return noStore({ error: "dossier_unavailable", message: "Pedigree sharing permissions changed. Ask for a newly reviewed dossier." }, 410);
  }
  // Integrity digest: binds the EXACT issued content bytes. Legacy rows
  // (pre-digest) report digest_verified: null — honestly historical, never
  // retroactively authenticated, never blocked.
  let digestVerified: boolean | null = null;
  if (dossier.issued_digest) {
    digestVerified = (await dossierContentDigest(dossier.snapshot_json, dossier.sections_meta_json)) === dossier.issued_digest;
    if (!digestVerified) {
      return noStore({ error: "dossier_unavailable", message: "This dossier's stored content no longer matches its issued digest and requires operator review." }, 410);
    }
  }
  const current = await buildDossierSnapshot(env.DB, dossier.horse_id, {
    includePedigree: !(frozen.pedigree as { not_shared?: boolean })?.not_shared,
    includeResults: Array.isArray(frozen.results),
    includeGenetics: Array.isArray(frozen.genetics),
    includeContact: !(frozen.contact as { not_shared?: boolean })?.not_shared,
    creatorUserId: dossier.created_by_user_id,
  });
  if (!frozenGeneticsStillPublic(frozen, current.snapshot)) {
    return noStore({ error: "dossier_unavailable", message: "Evidence sharing permissions changed. Ask for a newly reviewed dossier." }, 410);
  }
  const stale = dossier.version < 2 || !dossierSnapshotsEqual(frozen, current.snapshot);
  const generatedMs = timestampMillis(dossier.created_at);
  const ageDays = generatedMs === null ? null : Math.max(0, Math.floor((Date.now() - generatedMs) / 86_400_000));

  return noStore({
    dossier: {
      id: dossier.id,
      version: dossier.version,
      generated_at: dossier.created_at,
      age_days: ageDays,
      stale,
      snapshot: frozen,
      sections: payload.sectionsMeta,
      issued_digest: dossier.issued_digest,
      digest_verified: digestVerified,
      digest_note: "The issued digest binds this document's exact stored content. It certifies integrity of the platform information extract — not accuracy, official status, or any guarantee.",
    },
    access_log_note: "Only a view counter and a last-access timestamp are recorded for this link; no viewer identity is stored. The counter is incremented only for views that were authorized at the moment of access — refused views are never counted.",
    warnings: {
      ...DOSSIER_WARNINGS,
      ...(stale ? { active: DOSSIER_WARNINGS.stale } : { active: DOSSIER_WARNINGS.snapshot_age }),
    },
  });
}
