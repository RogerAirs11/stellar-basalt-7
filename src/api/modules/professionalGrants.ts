import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requirePermission, requireCsrf } from "../../auth/guards";
import {
  PROFESSIONAL_GRANT_PERMISSIONS,
  PROFESSIONAL_KINDS,
  PROFESSIONAL_GRANT_BASES,
  PROFESSIONAL_KIND_PERMISSIONS,
  parseProfessionalPermissions,
  revokeProfessionalGrant,
} from "../../access/professionalAccess";
import type { D1Database } from "@cloudflare/workers-types";

// R144-D01 (Master-AI plan): professional grants scoped to horse, data and
// purpose. Staff-only management surface (admin creates/revokes, editor
// reads the register). The grant is the ONLY non-staff path to private
// health data; a generic horse-edit capability never implies it.

const ProfessionalGrantCreateSchema = z
  .object({
    horse_id: z.number().int().positive(),
    grantee_user_id: z.string().min(1).max(120).nullable().optional(),
    grantee_organization_id: z.number().int().positive().nullable().optional(),
    professional_kind: z.enum(PROFESSIONAL_KINDS),
    permissions: z.array(z.enum(PROFESSIONAL_GRANT_PERMISSIONS)).min(1).max(PROFESSIONAL_GRANT_PERMISSIONS.length),
    authority_ref: z.string().trim().min(3).max(200),
    assignment_ref: z.string().trim().min(3).max(200),
    basis: z.enum(PROFESSIONAL_GRANT_BASES).default("admin_grant"),
    basis_ref: z.string().trim().max(200).nullable().optional(),
    valid_from: z.string().datetime({ offset: true }).nullable().optional(),
    valid_until: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((data) => (data.grantee_user_id != null) !== (data.grantee_organization_id != null), {
    message: "Exactly one grantee user or organization is required",
    path: ["grantee_user_id"],
  });

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function adminCreateProfessionalGrant(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run");
  requireCsrf(request, auth);
  const parsed = ProfessionalGrantCreateSchema.safeParse(await readJson<unknown>(request, 16 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_professional_grant", "Professional grant failed validation", parsed.error.flatten());
  const d = parsed.data;
  if (d.permissions.some(permission => !PROFESSIONAL_KIND_PERMISSIONS[d.professional_kind].includes(permission))) {
    throw new HttpError(422, "invalid_professional_permissions", "The requested permission is outside this professional kind's scope");
  }
  if (d.basis !== "admin_grant" && (!d.basis_ref || d.basis_ref.trim().length < 3)) {
    throw new HttpError(422, "missing_grant_basis", "Consent or institutional assignment requires a supporting evidence reference");
  }
  const horse = await env.DB.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(d.horse_id).first();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  if (d.grantee_user_id) {
    const grantee = await env.DB.prepare("SELECT id,is_active FROM users WHERE id=?").bind(d.grantee_user_id).first<{ id: string; is_active: number }>();
    if (!grantee) throw new HttpError(404, "grantee_not_found", "Grantee user does not exist");
    if (Number(grantee.is_active) !== 1) throw new HttpError(422, "grantee_inactive", "Grantee account is deactivated");
  }
  if (d.grantee_organization_id) {
    const org = await env.DB.prepare("SELECT id,status FROM organizations WHERE id=?").bind(d.grantee_organization_id).first<{ id: number; status: string }>();
    if (!org) throw new HttpError(404, "grantee_not_found", "Grantee organization does not exist");
    if (org.status !== "active") throw new HttpError(422, "grantee_inactive", "Grantee organization is not active");
  }
  const validFrom = d.valid_from ?? isoNow();
  if (!Number.isFinite(Date.parse(validFrom)) || (d.valid_until && (!Number.isFinite(Date.parse(d.valid_until)) || Date.parse(d.valid_until) <= Date.parse(validFrom)))) {
    throw new HttpError(422, "invalid_validity", "valid_until must be after valid_from");
  }
  const grantId = crypto.randomUUID();
  const permissions = [...new Set(d.permissions)].sort().join(",");
  const [, insert] = await env.DB.batch([
    env.DB.prepare("UPDATE horses SET row_version=row_version WHERE id=?").bind(d.horse_id),
    env.DB
      .prepare(
        `INSERT INTO professional_access_grants(id,horse_id,grantee_user_id,grantee_organization_id,professional_kind,permissions,authority_ref,assignment_ref,basis,basis_ref,granted_by_user_id,valid_from,valid_until,created_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP
         WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1 AND role IN ('admin','super_admin'))
           AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND datetime(expires_at)>CURRENT_TIMESTAMP)
           AND EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL)
           AND ((CAST(? AS TEXT) IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1))
             OR (CAST(? AS BIGINT) IS NOT NULL AND EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active')))`,
      )
      .bind(
        grantId,
        d.horse_id,
        d.grantee_user_id ?? null,
        d.grantee_organization_id ?? null,
        d.professional_kind,
        permissions,
        d.authority_ref,
        d.assignment_ref,
        d.basis,
        d.basis_ref ?? null,
        auth.user.id,
        validFrom,
        d.valid_until ?? null,
        auth.user.id, auth.sessionId, auth.user.id, d.horse_id,
        d.grantee_user_id ?? null, d.grantee_user_id ?? null,
        d.grantee_organization_id ?? null, d.grantee_organization_id ?? null,
      ),
    env.DB.prepare(
      `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,after_json,reason,created_at)
       SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP FROM professional_access_grants WHERE id=?`,
    ).bind(
      auth.user.id,
      "professional.grant.create",
      "professional_access_grant",
      grantId,
      JSON.stringify({
        grant_id: grantId,
        horse_id: d.horse_id,
        grantee_user_id: d.grantee_user_id ?? null,
        grantee_organization_id: d.grantee_organization_id ?? null,
        professional_kind: d.professional_kind,
        permissions,
        basis: d.basis,
        valid_from: validFrom,
        valid_until: d.valid_until ?? null,
      }),
      d.assignment_ref,
      grantId,
    ),
  ]);
  if (Number((insert as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) !== 1) {
    throw new HttpError(409, "professional_grant_not_created", "The grant authority or grantee changed; reload and review the assignment");
  }
  const grant = await env.DB.prepare(
    `SELECT id,horse_id,grantee_user_id,grantee_organization_id,professional_kind,permissions,authority_ref,assignment_ref,basis,basis_ref,valid_from,valid_until,revoked_at,revoked_by_user_id,revoke_reason,created_at
     FROM professional_access_grants WHERE id=?`,
  ).bind(grantId).first();
  if (!grant) throw new HttpError(500, "professional_grant_receipt_unavailable", "The grant was created but its receipt could not be read; reload the grant register before retrying");
  return json({ grant: { ...grant, permission_list: parseProfessionalPermissions(String(grant.permissions)) } }, { status: 201 });
}

/** GET /api/admin/professional-grants?horse_id=N — grant register for staff (audit + support). */
export async function adminProfessionalGrants(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, url: URL): Promise<Response> {
  await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "audit.read");
  const horseIdParam = url.searchParams.get("horse_id");
  const horseId = horseIdParam && /^\d+$/.test(horseIdParam) ? Number(horseIdParam) : null;
  const rows = await env.DB
    .prepare(
      `SELECT g.id,g.horse_id,g.grantee_user_id,g.grantee_organization_id,g.professional_kind,g.permissions,g.authority_ref,g.assignment_ref,
              g.basis,g.basis_ref,g.valid_from,g.valid_until,g.revoked_at,g.revoked_by_user_id,g.revoke_reason,g.created_at,
              h.name_latin,h.name_native
       FROM professional_access_grants g JOIN horses h ON h.id=g.horse_id
       ${horseId ? "WHERE g.horse_id=?" : ""}
       ORDER BY g.created_at DESC LIMIT 200`,
    )
    .bind(...(horseId ? [horseId] : []))
    .all();
  return json({
    grants: rows.results?.map((row) => {
      const record = row as { permissions: string; [key: string]: unknown };
      return { ...record, permission_list: parseProfessionalPermissions(record.permissions) };
    }),
  });
}

const ProfessionalGrantRevokeSchema = z.object({ reason: z.string().min(3).max(500) });

/** POST /api/admin/professional-grants/:id/revoke — immediate, audited, reason-required. */
export async function adminRevokeProfessionalGrant(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, grantId: string): Promise<Response> {
  const auth = await requirePermission(env.DB, request, env.SESSION_COOKIE_NAME, "maintenance.run");
  requireCsrf(request, auth);
  const parsed = ProfessionalGrantRevokeSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reason", "A revocation reason is required", parsed.error.flatten());
  const result = await revokeProfessionalGrant(env.DB, { grantId, byUserId: auth.user.id, sessionId: auth.sessionId, reason: parsed.data.reason });
  return json(result);
}
