import { z } from "zod";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { capabilitiesForRole } from "../../auth/capabilities";
import { HttpError, json, readJson } from "../http";
import { decodeMediaBase64, hasExpectedMediaSignature, scanForActiveContent, stripLocationMetadata, mediaContentDisposition } from "./mediaPolicy";
import { canonicalJson } from "../../marketplace/commands";
import type { AuthContext } from "../../auth/session";
import type { RegistrationEvidenceRecord } from "../../contracts/registrationEvidence";

const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 12;
const MAX_TOTAL = 48 * 1024 * 1024;
const CHUNK = 512 * 1024;
const Upload = z.object({
  role: z.enum(["passport", "identity_photo", "registration", "laboratory", "other"]),
  file_name: z.string().trim().min(1).max(240).refine(s => !/[\u0000-\u001f\u007f]/.test(s)),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  data_base64: z.string().min(4),
  operation_id: z.string().trim().min(8).max(120),
}).strict();
interface RequestRow { id: string; submitted_by_user_id: string; status: string; request_type: string }
interface StoredEvidence extends RegistrationEvidenceRecord { payload_digest: string; deleted_at: string | null }
const COLUMNS = "id,request_id,role,file_name,mime_type,size_bytes,sha256,created_at,payload_digest,deleted_at";
const ACTIVE_SESSION_SQL = "EXISTS(SELECT 1 FROM sessions es JOIN users eu ON eu.id=es.user_id WHERE es.id=? AND es.user_id=? AND datetime(es.expires_at)>CURRENT_TIMESTAMP AND eu.is_active=1)";

function safe(row: StoredEvidence): RegistrationEvidenceRecord {
  return { id: row.id, request_id: row.request_id, role: row.role, file_name: row.file_name,
    mime_type: row.mime_type, size_bytes: Number(row.size_bytes), sha256: row.sha256, created_at: row.created_at,
    verification: "unreviewed", public_visible: false };
}
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), b => b.toString(16).padStart(2, "0")).join("");
}
async function authorizedRequest(db: D1Database, auth: AuthContext, id: string): Promise<RequestRow> {
  const row = await db.prepare("SELECT id,submitted_by_user_id,status,request_type FROM change_requests WHERE id=?").bind(id).first<RequestRow>();
  const reviewer = capabilitiesForRole(auth.user.role).includes("change.review");
  if (!row || (row.submitted_by_user_id !== auth.user.id && !reviewer)) throw new HttpError(404, "not_found", "Registration request not found");
  return row;
}
function mayReadRole(auth: AuthContext, request: RequestRow, role: string): boolean {
  if (request.submitted_by_user_id === auth.user.id || ["admin", "super_admin"].includes(auth.user.role)) return true;
  // General registration reviewers do not acquire private laboratory access.
  return capabilitiesForRole(auth.user.role).includes("change.review") && role !== "laboratory";
}

export { registrationEvidenceCounts } from "../../registry/ruleCommit";

export async function routeRequestEvidence(request: Request, env: Env, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/change-requests\/([^/]+)\/evidence(?:\/([^/]+)(\/file)?)?$/);
  if (!match) return null;
  const requestId = decodeURIComponent(match[1]!);
  const evidenceId = match[2] ? decodeURIComponent(match[2]) : null;
  if (requestId.length > 120 || (evidenceId && evidenceId.length > 120)) throw new HttpError(400, "invalid_id", "Invalid request or evidence identifier");
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  requireCsrf(request, auth);
  const parent = await authorizedRequest(env.DB, auth, requestId);
  const owner = parent.submitted_by_user_id === auth.user.id;
  const method = request.method.toUpperCase();

  if (!evidenceId && method === "GET") {
    const roleGuard = !owner && !["admin", "super_admin"].includes(auth.user.role) ? " AND role<>'laboratory'" : "";
    const result = await env.DB.prepare(`SELECT ${COLUMNS} FROM request_evidence WHERE request_id=? AND deleted_at IS NULL${roleGuard} ORDER BY created_at,id LIMIT 12`)
      .bind(requestId).all<StoredEvidence>();
    return json({ request_id: requestId, evidence: (result.results ?? []).map(safe), can_edit: owner && parent.status === "draft",
      limits: { max_file_bytes: MAX_FILE, max_files: MAX_FILES, max_total_bytes: MAX_TOTAL } });
  }
  if (!evidenceId && method === "POST") {
    if (!owner) throw new HttpError(403, "forbidden", "Only the submitting account can attach draft evidence");
    const parsed = Upload.safeParse(await readJson<unknown>(request, 12 * 1024 * 1024));
    if (!parsed.success) throw new HttpError(400, "invalid_evidence", "Evidence upload failed validation", parsed.error.flatten());
    const input = parsed.data;
    if (input.role === "identity_photo" && !input.mime_type.startsWith("image/")) throw new HttpError(415, "invalid_evidence_type", "An identity photograph must be an image");
    const decoded = decodeMediaBase64(input.data_base64, MAX_FILE);
    if (!decoded.byteLength || !hasExpectedMediaSignature(decoded, input.mime_type)) throw new HttpError(415, "media_signature_mismatch", "File bytes do not match the declared type");
    const scan = scanForActiveContent(decoded, input.mime_type);
    if (!scan.ok) throw new HttpError(415, "media_active_content", scan.reason);
    const bytes = stripLocationMetadata(decoded, input.mime_type).bytes;
    const sha256 = await digest(bytes);
    const payloadDigest = await digest(new TextEncoder().encode(canonicalJson({ role: input.role, file_name: input.file_name, mime_type: input.mime_type, sha256 })));
    const replay = async () => {
      const old = await env.DB.prepare(`SELECT ${COLUMNS} FROM request_evidence WHERE request_id=? AND uploaded_by_user_id=? AND operation_id=? AND ${ACTIVE_SESSION_SQL}`)
        .bind(requestId, auth.user.id, input.operation_id, auth.sessionId, auth.user.id).first<StoredEvidence>();
      if (!old) return null;
      if (old.payload_digest !== payloadDigest || old.deleted_at) throw new HttpError(409, "idempotency_conflict", "This upload operation already identifies different or removed evidence");
      return json({ evidence: safe(old), idempotent_replay: true });
    };
    const old = await replay();
    if (old) return old;
    if (parent.status !== "draft") throw new HttpError(409, "request_not_editable", "Return the request to draft before changing its evidence");
    const id = crypto.randomUUID();
    const operation = crypto.randomUUID();
    const guard = "EXISTS(SELECT 1 FROM change_requests WHERE id=? AND last_evidence_operation=?)";
    const statements = [
      // A separate lock statement makes subsequent PostgreSQL predicates see
      // a concurrent submit/delete that won first, including its child rows.
      env.DB.prepare("UPDATE change_requests SET evidence_file_count=evidence_file_count WHERE id=?").bind(requestId),
      env.DB.prepare(`UPDATE change_requests SET evidence_file_count=evidence_file_count+1,evidence_total_bytes=evidence_total_bytes+?,last_evidence_operation=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND submitted_by_user_id=? AND status='draft' AND evidence_file_count<? AND evidence_total_bytes+?<=? AND ${ACTIVE_SESSION_SQL}`)
        .bind(bytes.byteLength, operation, requestId, auth.user.id, MAX_FILES, bytes.byteLength, MAX_TOTAL, auth.sessionId, auth.user.id),
      env.DB.prepare(`INSERT INTO request_evidence(id,request_id,uploaded_by_user_id,role,file_name,mime_type,size_bytes,sha256,payload_digest,operation_id)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
        .bind(id, requestId, auth.user.id, input.role, input.file_name, input.mime_type, bytes.byteLength, sha256, payloadDigest, input.operation_id, requestId, operation),
    ];
    for (let start = 0; start < bytes.byteLength; start += CHUNK) {
      statements.push(env.DB.prepare("INSERT INTO request_evidence_blobs(evidence_id,chunk,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM request_evidence WHERE id=?)")
        .bind(id, start / CHUNK, bytes.subarray(start, Math.min(start + CHUNK, bytes.byteLength)), id));
    }
    statements.push(env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json)
      SELECT ?,'registration.evidence.upload','change_request',?,? WHERE ${guard}`)
      .bind(auth.user.id, requestId, JSON.stringify({ evidence_id: id, role: input.role, sha256, size_bytes: bytes.byteLength }), requestId, operation));
    let results: D1Result[];
    try { results = await env.DB.batch(statements); }
    catch (error) {
      if (/unique|duplicate/i.test(error instanceof Error ? error.message : String(error))) {
        const existing = await replay();
        if (existing) return existing;
      }
      throw error;
    }
    if (Number(results[1]?.meta.changes) !== 1) throw new HttpError(409, "evidence_limit_or_request_changed", "The draft or session changed, or its evidence limit was reached; reload before retrying");
    const stored = await env.DB.prepare(`SELECT ${COLUMNS} FROM request_evidence WHERE id=?`).bind(id).first<StoredEvidence>();
    if (!stored) throw new HttpError(503, "evidence_unavailable", "Evidence receipt could not be loaded");
    return json({ evidence: safe(stored), idempotent_replay: false }, { status: 201 });
  }
  if (!evidenceId) throw new HttpError(405, "method_not_allowed", "Method not allowed");
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM request_evidence WHERE id=? AND request_id=? AND deleted_at IS NULL`).bind(evidenceId, requestId).first<StoredEvidence>();
  if (!row || !mayReadRole(auth, parent, row.role)) throw new HttpError(404, "not_found", "Evidence not found");
  if (match[3] && method === "GET") {
    const result = await env.DB.prepare("SELECT chunk,data FROM request_evidence_blobs WHERE evidence_id=? ORDER BY chunk LIMIT 17").bind(evidenceId).all<{ chunk: number; data: ArrayBuffer | Uint8Array }>();
    const parts = result.results ?? [];
    const size = parts.reduce((sum, item) => sum + item.data.byteLength, 0);
    if (!parts.length || parts.length > 16 || size !== Number(row.size_bytes) || size > MAX_FILE || parts.some((p, i) => p.chunk !== i || p.data.byteLength > CHUNK)) throw new HttpError(503, "evidence_incomplete", "Evidence is temporarily unavailable");
    const bytes = new Uint8Array(size); let cursor = 0;
    for (const item of parts) { const part = item.data instanceof Uint8Array ? item.data : new Uint8Array(item.data); bytes.set(part, cursor); cursor += part.length; }
    if (await digest(bytes) !== row.sha256) throw new HttpError(503, "evidence_integrity_failure", "Evidence integrity check failed");
    return new Response(bytes, { headers: { "content-type": row.mime_type, "content-disposition": mediaContentDisposition(row.file_name, true),
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "referrer-policy": "no-referrer" } });
  }
  if (!match[3] && method === "DELETE") {
    if (!owner || parent.status !== "draft") throw new HttpError(409, "request_not_editable", "Only the submitting account can remove evidence from a draft");
    const operation = crypto.randomUUID();
    const guard = "EXISTS(SELECT 1 FROM change_requests WHERE id=? AND last_evidence_operation=?)";
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE change_requests SET evidence_file_count=evidence_file_count WHERE id=?").bind(requestId),
      env.DB.prepare(`UPDATE change_requests SET evidence_file_count=evidence_file_count-1,evidence_total_bytes=evidence_total_bytes-?,last_evidence_operation=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND submitted_by_user_id=? AND status='draft' AND evidence_file_count>0 AND evidence_total_bytes>=?
        AND EXISTS(SELECT 1 FROM request_evidence WHERE id=? AND request_id=? AND deleted_at IS NULL) AND ${ACTIVE_SESSION_SQL}`)
        .bind(row.size_bytes, operation, requestId, auth.user.id, row.size_bytes, evidenceId, requestId, auth.sessionId, auth.user.id),
      env.DB.prepare(`UPDATE request_evidence SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND request_id=? AND deleted_at IS NULL AND ${guard}`).bind(evidenceId, requestId, requestId, operation),
      env.DB.prepare(`DELETE FROM request_evidence_blobs WHERE evidence_id=? AND ${guard}`).bind(evidenceId, requestId, operation),
      env.DB.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json) SELECT ?,'registration.evidence.remove','change_request',?,? WHERE ${guard}`)
        .bind(auth.user.id, requestId, JSON.stringify({ evidence_id: evidenceId }), requestId, operation),
    ]);
    if (Number(results[1]?.meta.changes) !== 1) throw new HttpError(409, "request_changed", "The draft, evidence or session changed; reload before retrying");
    return json({ removed: true, evidence_id: evidenceId });
  }
  throw new HttpError(405, "method_not_allowed", "Method not allowed");
}
