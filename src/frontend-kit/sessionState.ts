import { PLATFORM_PERMISSION_KEYS, type PlatformAuthState } from "../contracts/platform";
import { PlatformClientError } from "./errors";

export interface ValidatedSession extends PlatformAuthState { csrfToken: string | null }
const permissionKeys = new Set<string>(PLATFORM_PERMISSION_KEYS);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** Treat transport generics as unknown at the authority boundary. Missing or
 * contradictory fields never become a usable principal/CSRF token. This checks
 * shape, not authenticity: the server remains the authorization authority. */
export function validateSessionResponse(value: unknown): ValidatedSession {
  const invalid = () => new PlatformClientError(502, "invalid_session_response", "The server returned an invalid session; sign in again or reload to reconcile");
  if (!record(value) || !Array.isArray(value.permissions) || value.permissions.length > PLATFORM_PERMISSION_KEYS.length
    || !value.permissions.every(item => typeof item === "string" && permissionKeys.has(item))
    || new Set(value.permissions).size !== value.permissions.length) throw invalid();
  if (value.user === null) {
    if (value.csrfToken !== null || value.permissions.length !== 0) throw invalid();
    return { user: null, permissions: [], csrfToken: null };
  }
  const user = value.user;
  if (!record(user) || !boundedString(user.id, 128) || !boundedString(user.email, 320)
    || !boundedString(user.display_name, 512) || !boundedString(user.role, 64)
    || !boundedString(value.csrfToken, 512)) throw invalid();
  return {
    user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    permissions: [...value.permissions] as ValidatedSession["permissions"], csrfToken: value.csrfToken,
  };
}
