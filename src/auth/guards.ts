import { HttpError } from "../api/http";
import { getAuth, type AuthContext } from "./session";
import { capabilitiesForRole } from "./capabilities";
import type { PlatformPermission } from "../contracts/platform";
import type { UserRole } from "../db/types";
import { requireMfaAssurance } from "./mfaGuard";

const ROLE_LEVEL: Record<UserRole, number> = {
  user: 10,
  owner: 20,
  editor: 30,
  admin: 40,
  super_admin: 50,
};

export async function requireAuth(db: D1Database, request: Request, cookieName: string, minimum: UserRole = "user"): Promise<AuthContext> {
  const auth = await getAuth(db, request, cookieName);
  if (!auth) throw new HttpError(401, "authentication_required", "Sign in is required");
  if ((ROLE_LEVEL[auth.user.role] ?? 0) < ROLE_LEVEL[minimum]) {
    throw new HttpError(403, "forbidden", "Your account does not have permission for this action");
  }
  if ((ROLE_LEVEL[minimum] ?? 0) >= ROLE_LEVEL.editor) await requireMfaAssurance(db, auth);
  return auth;
}

/**
 * Semantic permission guard (D17): authorizes on a shared PlatformPermission capability
 * instead of a hard-coded minimum role. The role->permission mapping in capabilities.ts
 * remains the single authorization authority shared with frontend visibility.
 */
export async function requirePermission(db: D1Database, request: Request, cookieName: string, permission: PlatformPermission): Promise<AuthContext> {
  const auth = await getAuth(db, request, cookieName);
  if (!auth) throw new HttpError(401, "authentication_required", "Sign in is required");
  if (!capabilitiesForRole(auth.user.role).includes(permission)) {
    throw new HttpError(403, "forbidden", "Your account does not have permission for this action");
  }
  if (["horse.create", "horse.edit", "horse.archive", "registry.export", "claim.review", "change.review", "quality.read", "audit.read", "maintenance.run", "content.manage"].includes(permission)) await requireMfaAssurance(db, auth);
  return auth;
}

export function requireCsrf(request: Request, auth: AuthContext): void {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  const token = request.headers.get("x-csrf-token");
  if (!token || token !== auth.csrfToken) throw new HttpError(403, "csrf_failed", "Security token is missing or invalid");

  const origin = request.headers.get("origin");
  if (origin) {
    const expected = new URL(request.url).origin;
    if (origin !== expected) throw new HttpError(403, "origin_failed", "Cross-origin state-changing request rejected");
  }
}
