import { z } from "zod";
import {
  isPublicMedia, decodeMediaBase64, hasExpectedMediaSignature, mediaContentDisposition, PUBLIC_MEDIA_PREDICATE,
  MEDIA_ACCESS_TOKEN_TTL_SECONDS, scanForActiveContent, signMediaAccessToken, stripLocationMetadata, verifyMediaAccessToken,
  type MediaViewer,
} from "./mediaPolicy";
import { mediaVerificationToLevel } from "../../trust/policy";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf, requirePermission } from "../../auth/guards";
import { requireHorseAction, authorizeHorseAction } from "../../access/horseAccess";
import { SANITIZED_IMAGE_MIMES } from "./mediaImageHygiene";
import { buildActiveGrantPredicate, readIdempotencyKey } from "../../marketplace/commands";
import type { D1Database } from "@cloudflare/workers-types";
import { parseUtcTimestamp } from "../../shared/utcTimestamp";
import { authorizeProfessionalAction, professionalActionPredicate } from "../../access/professionalAccess";

import { mediaReadPredicate, mediaSubjectPredicate } from "../../access/mediaAccess";
import { privateEvidenceSessionPredicate } from "../../access/privateEvidence";

// Horse photos & documents (client requirement: آپلود عکس و مدارک).
// Blobs are stored chunked in D1/SQLite (horse_media_blobs) so the feature works
// identically on every provider with zero infrastructure; the metadata table
// stays payload-free for listing queries. Uploads start 'pending' and federation
// staff verify them — the two-tier information model the client asked for.
// Scale-out path (R2 object storage) is documented in the runbook.

const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // 3 MB per file
const BLOB_CHUNK_BYTES = 512 * 1024;     // 512 KB chunks — D1-friendly row sizes
const MAX_MEDIA_CHUNKS = Math.ceil(MAX_MEDIA_BYTES / BLOB_CHUNK_BYTES);
const ALLOWED_PHOTO_MIME = new Set<string>(SANITIZED_IMAGE_MIMES);
const ALLOWED_DOCUMENT_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

const MediaUploadSchema = z.object({
  media_type: z.enum(["photo", "document"]),
  role: z.enum(["profile", "gallery", "passport", "certificate", "veterinary", "competition", "other"]).default("gallery"),
  file_name: z.string().trim().min(1).max(240),
  mime_type: z.string().trim().min(3).max(120),
  data_base64: z.string().min(4),
  caption: z.string().trim().max(500).nullable().optional(),
  width: z.number().int().min(1).max(20000).nullable().optional(),
  height: z.number().int().min(1).max(20000).nullable().optional(),
});

const VerifySchema = z.object({
  // Master-Ai plan T05 (finding F03): 'platform_reviewed' is the honest name
  // for what this editorial action is. 'federation_verified' stays as a
  // deprecated alias (legacy storage token) so existing clients keep working.
  decision: z.enum(["platform_reviewed", "federation_verified", "rejected"]),
  note: z.string().trim().max(1000).nullable().optional(),
  expected_version: z.number().int().min(1).max(1_000_000_000).optional(),
});

const PublicationSchema = z.object({
  consent_state: z.enum(["private", "shared_public"]),
  expected_version: z.number().int().min(1).max(1_000_000_000),
});

/** Legacy storage token — has only ever been set by platform staff review. */
const PLATFORM_REVIEWED_STORAGE_TOKEN = "federation_verified";

export async function listHorseMedia(db: D1Database, horseId: number, viewer?: MediaViewer | null): Promise<Response> {
  const access = mediaReadPredicate(viewer), subject = mediaSubjectPredicate(viewer), live = privateEvidenceSessionPredicate(viewer);
  const [horseResult, rows, counts] = await db.batch([
    db.prepare(`SELECT h.id FROM horses h WHERE h.id=? AND h.deleted_at IS NULL AND (${subject.sql})`).bind(horseId,...subject.bindings),
    db.prepare(`SELECT m.id,m.horse_id,m.media_type,m.role,m.file_name,m.mime_type,m.size_bytes,m.width,m.height,m.caption,
        m.verification,m.sort_order,m.created_at,m.row_version,m.consent_state,m.uploaded_by_user_id,m.quarantined_at,m.quarantine_reason,
        CASE WHEN ${live.sql} THEN 1 ELSE 0 END AS private_session_allowed
      FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL
      WHERE m.horse_id=? AND (${access.sql}) ORDER BY m.sort_order,m.created_at DESC LIMIT 100`)
      .bind(...live.bindings,horseId,...access.bindings),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN m.media_type='photo' THEN 1 ELSE 0 END),0) AS photos,
        COALESCE(SUM(CASE WHEN m.media_type='document' THEN 1 ELSE 0 END),0) AS documents,
        COALESCE(SUM(CASE WHEN m.verification='${PLATFORM_REVIEWED_STORAGE_TOKEN}' THEN 1 ELSE 0 END),0) AS verified
      FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL
      WHERE m.horse_id=? AND (${access.sql})`).bind(horseId,...access.bindings),
  ]);
  if (!horseResult.results?.length) throw new HttpError(404,"not_found","Horse not found");
  const mayPublish = viewer ? (await authorizeHorseAction(db,{userId:viewer.user.id,role:viewer.user.role},horseId,"upload_media",new Date())).ok : false;
  const media = (rows.results ?? []).map(row => {
    const record = row as Record<string,unknown>;
    const {uploaded_by_user_id,quarantine_reason,quarantined_at,private_session_allowed,...safe}=record;
    const own = Number(private_session_allowed) === 1 && viewer?.user.id === uploaded_by_user_id;
    return {...safe,verification_level:mediaVerificationToLevel(String(record.verification ?? "")),public_visible:isPublicMedia(record as never),
      can_publish:own && mayPublish && record.media_type === "photo" && ["profile","gallery"].includes(String(record.role))
        && record.verification === PLATFORM_REVIEWED_STORAGE_TOKEN && quarantined_at == null && quarantine_reason == null
        && ALLOWED_PHOTO_MIME.has(String(record.mime_type)),
      can_withdraw:own && record.consent_state === "shared_public"};
  });
  return json({horse_id:horseId,counts:counts.results?.[0] ?? {photos:0,documents:0,verified:0},media});
}

export async function uploadHorseMedia(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, horseId: number): Promise<Response> {
  // Master-Ai plan T10 (closing the R59 fact-check #11 gap): media uploads are
  // horse-scoped. Editorial staff keep their platform capability; any other
  // account needs an active grant (e.g. an approved ownership claim) covering
  // upload_media on EXACTLY this horse — Owner A can never attach media to
  // Horse B.
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const horse = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(horseId).first();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  const ordinaryUpload = await authorizeHorseAction(env.DB, { userId: auth.user.id, role: auth.user.role }, horseId, "upload_media", new Date());
  const professionalUpload = !ordinaryUpload.ok && ((await authorizeProfessionalAction(env.DB, auth.user.id, horseId, "sample_submit")).ok
    || (await authorizeProfessionalAction(env.DB, auth.user.id, horseId, "clinical_write")).ok);
  if (!ordinaryUpload.ok && !professionalUpload) throw new HttpError(403, "media_upload_permission_required", "A current horse-scoped upload assignment is required");
  const parsed = MediaUploadSchema.safeParse(await readJson<unknown>(request, 8 * 1024 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_media", "Media upload failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (!ordinaryUpload.ok && (d.media_type !== "document" || d.role !== "veterinary")) {
    throw new HttpError(403, "professional_upload_scope", "This assignment permits private veterinary documents only");
  }
  const bytes = decodeMediaBase64(d.data_base64, MAX_MEDIA_BYTES);
  if (bytes.byteLength === 0) throw new HttpError(400, "invalid_media", "Empty payload");
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new HttpError(413, "media_too_large", `Files are limited to ${MAX_MEDIA_BYTES / (1024 * 1024)} MB`);
  const allowed = d.media_type === "photo" ? ALLOWED_PHOTO_MIME : ALLOWED_DOCUMENT_MIME;
  if (!allowed.has(d.mime_type)) throw new HttpError(415, "unsupported_media_type", `Allowed: ${[...allowed].join(", ")}. Convert AVIF to JPEG, PNG or WebP before uploading.`);
  if (!hasExpectedMediaSignature(bytes, d.mime_type)) throw new HttpError(415, "media_signature_mismatch", "File bytes do not match the declared media type");
  // SVG/HTML are not accepted. The conservative PDF token check rejects
  // known scriptable constructs; it is not a full PDF parser or malware
  // scanner. Image-container validation below also rejects trailing bytes.
  const scan = scanForActiveContent(bytes, d.mime_type);
  if (!scan.ok) throw new HttpError(415, "media_active_content", scan.reason);
  // Strip supported image containers' EXIF/GPS, XMP, comments and metadata
  // chunks before storage. Unsupported formats fail closed. This does not
  // remove information deliberately drawn into image pixels or captions.
  const hygiene = stripLocationMetadata(bytes, d.mime_type);
  const storedBytes = hygiene.bytes;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(storedBytes));
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const editorialGrant = buildActiveGrantPredicate("h.id", "upload_media", { userId: auth.user.id }, now);
  const sampleGrant = professionalActionPredicate({ viewerUserId: auth.user.id, horseId, permission: "sample_submit" });
  const clinicalGrant = professionalActionPredicate({ viewerUserId: auth.user.id, horseId, permission: "clinical_write" });
  const professionalGuard = d.media_type === "document" && d.role === "veterinary"
    ? ` OR (${sampleGrant.sql}) OR (${clinicalGrant.sql})` : "";
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE horses SET row_version=row_version WHERE id=?").bind(horseId),
    env.DB.prepare(`
      INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,width,height,caption,verification,uploaded_by_user_id,sort_order,consent_state)
      SELECT ?,?,?,?,?,?,?,?,?,?, 'pending', ?, 0, 'private'
      FROM horses h JOIN users actor ON actor.id=? AND actor.is_active=1
      WHERE h.id=? AND h.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM sessions upload_session WHERE upload_session.id=? AND upload_session.user_id=actor.id AND datetime(upload_session.expires_at)>CURRENT_TIMESTAMP)
        AND (actor.role IN ('editor','admin','super_admin') OR ${editorialGrant.sql}${professionalGuard})
    `).bind(id, horseId, d.media_type, d.role, d.file_name, d.mime_type, storedBytes.byteLength, hygiene.width, hygiene.height, d.caption ?? null, auth.user.id,
      auth.user.id, horseId, auth.sessionId, ...editorialGrant.binds, ...(professionalGuard ? [...sampleGrant.bindings, ...clinicalGrant.bindings] : [])),
  ];
  for (let offset = 0; offset < storedBytes.byteLength; offset += BLOB_CHUNK_BYTES) {
    const chunk = storedBytes.subarray(offset, Math.min(offset + BLOB_CHUNK_BYTES, storedBytes.byteLength));
    statements.push(env.DB.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM horse_media WHERE id=?)").bind(id, Math.floor(offset / BLOB_CHUNK_BYTES), chunk, id));
  }
  const results = await env.DB.batch(statements);
  if (Number(results[1]?.meta.changes ?? 0) !== 1) throw new HttpError(409, "media_upload_authority_changed", "The horse or upload assignment changed; no file was accepted");
  return json({ media: { id, horse_id: horseId, media_type: d.media_type, role: d.role, file_name: d.file_name, mime_type: d.mime_type, size_bytes: storedBytes.byteLength, sha256, verification: "pending", verification_level: "pending", row_version: 1, consent_state: "private", public_visible: false, can_publish: false, can_withdraw: false, width: hygiene.width, height: hygiene.height, caption: d.caption ?? null, sort_order: 0, created_at: new Date().toISOString(), location_metadata_stripped: hygiene.stripped } }, { status: 201 });
}

export async function serveMediaFile(db: D1Database, mediaId: string, url: URL, viewer?: MediaViewer | null, accessTokenSecret?: string): Promise<Response> {
  const access=mediaReadPredicate(viewer);
  let tokenSql="1=1"; const tokenBindings:Array<string|number>=[];
  const token=url.searchParams.get("token");
  if(token) {
    if(!accessTokenSecret) throw new HttpError(403,"forbidden","Token access is not configured");
    const claims=await verifyMediaAccessToken(token,accessTokenSecret);
    if(!claims || claims.mediaId!==mediaId || !viewer?.sessionId || !viewer.sessionTokenHash || claims.userId!==viewer.user.id) {
      throw new HttpError(404,"not_found","Media not found");
    }
    tokenSql=`EXISTS(SELECT 1 FROM media_access_grants mag WHERE mag.token_binding=? AND mag.media_id=m.id
      AND mag.granted_to_user_id=? AND mag.granted_to_session_id=? AND mag.granted_to_token_hash=?
      AND mag.revoked_at IS NULL AND mag.expires_at=? AND datetime(mag.expires_at)>CURRENT_TIMESTAMP)`;
    tokenBindings.push(claims.grantId,viewer.user.id,viewer.sessionId,viewer.sessionTokenHash,new Date(claims.expiresAtMs).toISOString());
  }
  // Metadata, grant/session/MFA, consent and bounded bytes share one SQL
  // snapshot. No preflight authorization can race an unguarded blob SELECT.
  const chunks=await db.prepare(`SELECT m.id,m.horse_id,h.is_active AS horse_active,m.mime_type,m.file_name,m.media_type,m.role,
      m.verification,m.size_bytes,m.uploaded_by_user_id,m.consent_state,m.quarantined_at,m.quarantine_reason,b.chunk,b.data
    FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL
    LEFT JOIN horse_media_blobs b ON b.media_id=m.id
    WHERE m.id=? AND (${access.sql}) AND (${tokenSql}) ORDER BY b.chunk ASC LIMIT ${MAX_MEDIA_CHUNKS+1}`)
    .bind(mediaId,...access.bindings,...tokenBindings).all<{id:string;mime_type:string;file_name:string;media_type:string;size_bytes:number;chunk:number;data:ArrayBuffer}>();
  const media=chunks.results?.[0];
  if(!media) throw new HttpError(404,"not_found","Media not found");
  const rows = chunks.results ?? [];
  const parts = rows.map((row) => row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (rows.length > MAX_MEDIA_CHUNKS || !Number.isSafeInteger(total) || total <= 0 || total > MAX_MEDIA_BYTES || total !== Number(media.size_bytes)
    || rows.some((row, index) => Number(row.chunk) !== index || parts[index]!.byteLength === 0 || parts[index]!.byteLength > BLOB_CHUNK_BYTES)) {
    throw new HttpError(503, "media_incomplete", "Media is temporarily unavailable");
  }
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { merged.set(part, cursor); cursor += part.byteLength; }
  // Sanitize historical uploads too. No legacy unsanitized original may slip
  // through an otherwise valid public consent or private access link.
  let deliveryBytes: Uint8Array = merged;
  if (media.mime_type.startsWith("image/")) {
    try { deliveryBytes = stripLocationMetadata(merged, media.mime_type).bytes; }
    catch { throw new HttpError(503, "media_unavailable", "This image needs to be replaced with a supported file."); }
  }
  const download = url.searchParams.get("download") === "1";
  return new Response(new Uint8Array(deliveryBytes), {
    headers: {
      "content-type": media.mime_type,
      "content-length": String(deliveryBytes.byteLength),
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-store",
      "vary": "Cookie",
      "content-disposition": mediaContentDisposition(media.file_name, download || media.media_type === "document"),
      "x-content-type-options": "nosniff",
    },
  });
}

export async function deleteHorseMedia(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, mediaId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const media = await env.DB.prepare("SELECT id,horse_id,uploaded_by_user_id FROM horse_media WHERE id=?").bind(mediaId).first<{ id: string; horse_id: number; uploaded_by_user_id: string | null }>();
  if (!media) throw new HttpError(404, "not_found", "Media not found");
  const isOwner = media.uploaded_by_user_id === auth.user.id;
  const isStaff = auth.user.role === "admin" || auth.user.role === "super_admin";
  if (!isOwner && !isStaff) throw new HttpError(403, "forbidden", "Only the uploader or staff can delete this media");
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM horse_media_blobs WHERE media_id=?").bind(mediaId),
      env.DB.prepare("DELETE FROM horse_media WHERE id=?").bind(mediaId),
    ]);
  } catch (cause) {
    if ((cause as { code?: string } | null)?.code === "23503" || /FOREIGN KEY constraint failed/i.test(cause instanceof Error ? cause.message : String(cause))) {
      throw new HttpError(409, "retained_evidence", "This file supports a retained evidence record and cannot be deleted");
    }
    throw cause;
  }
  return json({ deleted: mediaId });
}

/** Consent belongs to the uploader, not to the reviewer. Publishing also
 * requires the uploader's current horse mandate; withdrawal remains possible
 * after that mandate ends. Documents can never become public through this API. */
export async function setMediaPublication(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, mediaId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = PublicationSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_publication", "Choose visibility and reload the current version before submitting.", parsed.error.flatten());
  const { consent_state: consent, expected_version: version } = parsed.data;
  const key = readIdempotencyKey(request);
  const media = await env.DB.prepare(`SELECT m.* FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL WHERE m.id=?`)
    .bind(mediaId).first<Record<string, unknown>>();
  if (!media) throw new HttpError(404, "not_found", "Media not found");
  if (media.uploaded_by_user_id !== auth.user.id) throw new HttpError(403, "media_consent_required", "Only the uploader can change this file's publication consent.");
  const replay = async (): Promise<Response | null> => {
    if (!key) return null;
    const receipt = await env.DB.prepare("SELECT actor_user_id,media_id,consent_state,expected_version,response_json FROM media_consent_receipts WHERE id=?")
      .bind(key).first<{ actor_user_id: string; media_id: string; consent_state: string; expected_version: number; response_json: string }>();
    if (!receipt) return null;
    if (receipt.actor_user_id !== auth.user.id || receipt.media_id !== mediaId || receipt.consent_state !== consent || Number(receipt.expected_version) !== version) {
      throw new HttpError(409, "idempotency_conflict", "This request identifier has already been used for a different change.");
    }
    return json({ ...JSON.parse(receipt.response_json), replayed: true });
  };
  const previous = await replay();
  if (previous) return previous;
  if (Number(media.row_version) !== version) throw new HttpError(409, "media_conflict", "This file changed. Reload its visibility before submitting again.", { current_version: media.row_version });
  if (consent === "shared_public") {
    await requireHorseAction(env.DB, auth, Number(media.horse_id), "upload_media");
    if (media.verification !== PLATFORM_REVIEWED_STORAGE_TOKEN || !isPublicMedia({ ...media, consent_state: consent } as never)) {
      throw new HttpError(409, "media_not_publishable", "Only a reviewed gallery or profile photo can be published. Documents remain private.");
    }
  }
  const operation = crypto.randomUUID(), now = new Date().toISOString();
  const grant = buildActiveGrantPredicate("horse_media.horse_id", "upload_media", { userId: auth.user.id }, now);
  const publicationGuard = consent === "shared_public"
    ? ` AND ${PUBLIC_MEDIA_PREDICATE.replace("consent_state='shared_public'", "1=1")} AND verification='${PLATFORM_REVIEWED_STORAGE_TOKEN}'`
    : "";
  const authority = consent === "shared_public" ? ` AND (actor.role IN ('editor','admin','super_admin') OR ${grant.sql})` : "";
  const body = { id: mediaId, consent_state: consent, row_version: version + 1, public_visible: consent === "shared_public" };
  const statements = [
    env.DB.prepare(`UPDATE horse_media SET consent_state=?,row_version=row_version+1,last_operation_id=?,updated_at=?
      WHERE id=? AND row_version=? AND uploaded_by_user_id=?
        AND EXISTS(SELECT 1 FROM horses h WHERE h.id=horse_media.horse_id AND h.deleted_at IS NULL)
        AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.is_active=1${authority})${publicationGuard}`)
      .bind(consent, operation, now, mediaId, version, auth.user.id, auth.user.id, ...(consent === "shared_public" ? grant.binds : [])),
    env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id)
      SELECT ?,'media.publication','horse_media',?,?,?,? FROM horse_media WHERE id=? AND last_operation_id=?`)
      .bind(auth.user.id, mediaId, JSON.stringify({ consent_state: media.consent_state, row_version: version }), JSON.stringify(body), operation, mediaId, operation),
  ];
  if (consent === "private") statements.push(env.DB.prepare(`UPDATE media_access_grants SET revoked_at=? WHERE media_id=? AND revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM horse_media WHERE id=? AND last_operation_id=?)`).bind(now, mediaId, mediaId, operation));
  if (key) statements.push(env.DB.prepare(`INSERT INTO media_consent_receipts(id,actor_user_id,media_id,consent_state,expected_version,response_json)
    SELECT ?,?,?,?,?,? FROM horse_media WHERE id=? AND last_operation_id=?`)
    .bind(key, auth.user.id, mediaId, consent, version, JSON.stringify(body), mediaId, operation));
  let result;
  try { [result] = await env.DB.batch(statements); }
  catch (cause) { const prior = await replay(); if (prior) return prior; throw cause; }
  if (Number(result?.meta.changes) !== 1) {
    const prior = await replay(); if (prior) return prior;
    if (consent === "shared_public") await requireHorseAction(env.DB, auth, Number(media.horse_id), "upload_media");
    throw new HttpError(409, "media_conflict", "This file changed before your request completed. Reload its visibility and try again.");
  }
  return json(body);
}

export async function verifyHorseMedia(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, mediaId: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  requireCsrf(request, auth);
  const parsed = VerifySchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_verification", "Verification failed validation", parsed.error.flatten());
  const media = await env.DB.prepare("SELECT m.id,m.verification,m.row_version FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL WHERE m.id=?")
    .bind(mediaId).first<{ id: string; verification: string; row_version: number }>();
  if (!media) throw new HttpError(404, "not_found", "Media not found");
  if (parsed.data.expected_version !== undefined && parsed.data.expected_version !== media.row_version) throw new HttpError(409, "media_conflict", "This file changed. Reload before reviewing.");
  // Storage keeps the legacy CHECK-constrained token; the response reports
  // the honest level. A platform review NEVER becomes an issuer attestation —
  // those live in the attestations subsystem with membership gating.
  const storageValue = parsed.data.decision === "rejected" ? "rejected" : PLATFORM_REVIEWED_STORAGE_TOKEN;
  // P09: a staff rejection is a quarantine decision — the operator-facing
  // reason lands in quarantine_reason (never in public projections) and the
  // timestamp records when the item entered quarantine.
  const isRejection = parsed.data.decision === "rejected";
  const operation = crypto.randomUUID(), now = new Date().toISOString();
  const statements = [env.DB.prepare(`UPDATE horse_media SET verification=?,rejection_note=?,quarantine_reason=?,quarantined_at=?,
      row_version=row_version+1,last_operation_id=?,updated_at=? WHERE id=? AND row_version=?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('editor','admin','super_admin'))`)
    .bind(storageValue,
      isRejection ? (parsed.data.note ?? null) : null,
      isRejection ? (parsed.data.note ?? "Staff rejected this upload") : null,
      isRejection ? now : null, operation, now, mediaId, media.row_version, auth.user.id),
    env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,request_id)
      SELECT ?,'media.review','horse_media',?,?,?,?,? FROM horse_media WHERE id=? AND last_operation_id=?`)
      .bind(auth.user.id, mediaId, JSON.stringify({ verification: media.verification, row_version: media.row_version }),
        JSON.stringify({ verification: storageValue, row_version: media.row_version + 1 }), parsed.data.note ?? null, operation, mediaId, operation),
  ];
  if (isRejection) statements.push(env.DB.prepare(`UPDATE media_access_grants SET revoked_at=? WHERE media_id=? AND revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM horse_media WHERE id=? AND last_operation_id=?)`).bind(now, mediaId, mediaId, operation));
  const [result] = await env.DB.batch(statements);
  if (Number(result?.meta.changes) !== 1) throw new HttpError(409, "media_conflict", "This file changed. Reload before reviewing.");
  return json({
    id: mediaId,
    verification: storageValue,
    verification_level: isRejection ? "rejected" : "platform_reviewed",
    row_version: media.row_version + 1,
    note: "Platform staff review (editorial). Not an issuer attestation.",
  });
}

// ---------------------------------------------------------------------------
// R88 agent plan P09: short-lived private document delivery.
// ---------------------------------------------------------------------------

/** Mint a 15-minute URL bound to one revocable grant. Serving always checks
 * the same grant and the subject's current server-side authority. */
export async function mintMediaAccess(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string; MEDIA_ACCESS_TOKEN_SECRET?: string }, mediaId: string): Promise<Response> {
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME,"user");requireCsrf(request,auth);
  if(!env.MEDIA_ACCESS_TOKEN_SECRET) throw new HttpError(503,"token_access_unconfigured","Short-lived media access is not configured on this deployment (set MEDIA_ACCESS_TOKEN_SECRET)");
  const access=mediaReadPredicate(auth),live=privateEvidenceSessionPredicate(auth);
  const expiresAtMs=Date.now()+MEDIA_ACCESS_TOKEN_TTL_SECONDS*1000,expiresAtIso=new Date(expiresAtMs).toISOString();
  const grantId=crypto.randomUUID();
  const token=await signMediaAccessToken(mediaId,auth.user.id,grantId,expiresAtMs,env.MEDIA_ACCESS_TOKEN_SECRET);
  const result=await env.DB.prepare(`INSERT INTO media_access_grants(media_id,granted_to_user_id,granted_by_user_id,expires_at,token_binding,granted_to_session_id,granted_to_token_hash)
    SELECT m.id,?,?,?,?,?,? FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL
    WHERE m.id=? AND (${access.sql}) AND (${live.sql})`)
    .bind(auth.user.id,auth.user.id,expiresAtIso,grantId,auth.sessionId,auth.sessionTokenHash ?? "",mediaId,...access.bindings,...live.bindings).run();
  if(Number(result.meta.changes ?? 0)!==1) throw new HttpError(404,"not_found","Media not found or current export authority is unavailable");
  // Only minimal, authorized metadata accompanies the link. A signed token
  // remains bound to this exact live session bearer and its MFA assurance.
  const media=await env.DB.prepare(`SELECT m.role,m.consent_state FROM horse_media m JOIN horses h ON h.id=m.horse_id AND h.deleted_at IS NULL
    WHERE m.id=? AND (${access.sql})`).bind(mediaId,...access.bindings).first<{role:string;consent_state:string}>();
  if(!media) throw new HttpError(403,"media_access_changed","Current media access changed; reload before requesting another link");
  return json({media_id:mediaId,grant_id:grantId,token,url:`/api/media/file/${mediaId}?token=${encodeURIComponent(token)}`,
    expires_at:expiresAtIso,ttl_seconds:MEDIA_ACCESS_TOKEN_TTL_SECONDS,evidence_class:media.role,consent_state:media.consent_state},{status:201});
}

/** Revoke exactly one of the caller's URLs; another surviving grant cannot
 * revive it. Administrators may revoke a grant during evidence review. */
export async function revokeMediaAccess(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, mediaId: string, grantId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const grant = await env.DB.prepare(`SELECT g.id,g.revoked_at FROM media_access_grants g
    WHERE g.media_id=? AND g.token_binding=? AND (g.granted_to_user_id=? OR EXISTS(
      SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND u.role IN ('admin','super_admin')))`)
    .bind(mediaId, grantId, auth.user.id, auth.user.id).first<{ id: number; revoked_at: string | null }>();
  if (!grant) throw new HttpError(404, "not_found", "Media access grant not found");
  if (!grant.revoked_at) {
    const result = await env.DB.prepare(`UPDATE media_access_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.is_active=1 AND (u.id=media_access_grants.granted_to_user_id OR u.role IN ('admin','super_admin')))`)
      .bind(new Date().toISOString(), grant.id, auth.user.id).run();
    if (Number(result.meta.changes) !== 1) {
      const current = await env.DB.prepare("SELECT revoked_at FROM media_access_grants WHERE id=?").bind(grant.id).first<{ revoked_at: string | null }>();
      // A concurrent revoke is already successful. A lost-authority no-op
      // must never claim the still-live URL was revoked.
      if (!current?.revoked_at) throw new HttpError(409, "media_access_conflict", "The access link could not be revoked. Reload your current access before retrying.");
    }
  }
  return json({ media_id: mediaId, grant_id: grantId, revoked: true });
}

/**
 * GET /api/admin/media/quarantine — operator queue for evidence review and
 * retention. Lists PENDING uploads (with age and abandoned flag) and
 * QUARANTINED/rejected items with their staff reason — metadata only, the
 * payloads are never rendered or inlined. Abandoned = pending older than 30
 * days; deletion stays an explicit operator decision through the existing
 * DELETE /api/media/:id route (nothing is auto-purged).
 */
const ABANDONED_AFTER_DAYS = 30;

/** Provider-neutral age calculation. Database timestamps are part of the
 * registry's UTC text contract, so this deliberately avoids SQLite-only date
 * functions (`julianday`) and behaves the same on PostgreSQL/Turso/D1. */
export function mediaAgeDays(createdAt: unknown, nowMs = Date.now()): number {
  const createdMs = parseUtcTimestamp(createdAt);
  if (createdMs === null || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - createdMs) / 86_400_000));
}

export async function adminMediaQuarantine(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "horse.edit");
  const session = privateEvidenceSessionPredicate(auth);
  const rows = await env.DB.prepare(`
    SELECT m.id,m.horse_id,m.media_type,m.role,m.file_name,m.mime_type,m.size_bytes,m.verification,
           m.quarantine_reason,m.quarantined_at,m.created_at,m.uploaded_by_user_id
    FROM horse_media m
    WHERE (m.verification='pending' OR (m.verification='rejected' AND m.quarantine_reason IS NOT NULL))
      AND (${session.sql})
      AND EXISTS(SELECT 1 FROM users quarantine_actor WHERE quarantine_actor.id=?
        AND quarantine_actor.role IN ('editor','admin','super_admin') AND quarantine_actor.is_active=1)
    ORDER BY m.created_at ASC LIMIT 200
  `).bind(...session.bindings,auth.user.id).all();
  const nowMs = Date.now();
  const items = (rows.results ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const ageDays = mediaAgeDays(record.created_at, nowMs);
    return {
      id: record.id,
      horse_id: record.horse_id,
      media_type: record.media_type,
      evidence_class: record.role,
      file_name: record.file_name,
      mime_type: record.mime_type,
      size_bytes: record.size_bytes,
      state: record.verification === "pending" ? "pending_review" : "quarantined",
      quarantine_reason: record.quarantine_reason ?? null,
      quarantined_at: record.quarantined_at ?? null,
      created_at: record.created_at,
      uploaded_by_user_id: record.uploaded_by_user_id,
      age_days: ageDays,
      abandoned: record.verification === "pending" && ageDays > ABANDONED_AFTER_DAYS,
    };
  });
  return json({
    queue: items,
    counts: {
      pending_review: items.filter((item) => item.state === "pending_review").length,
      quarantined: items.filter((item) => item.state === "quarantined").length,
      abandoned_pending: items.filter((item) => item.abandoned).length,
    },
    retention: {
      abandoned_after_days: ABANDONED_AFTER_DAYS,
      note: "Nothing is auto-purged. Operators delete explicitly via DELETE /api/media/:id after review.",
    },
  });
}
