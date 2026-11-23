/**
 * Master-Ai plan T13: authentication delivery and recovery (engineering half).
 *
 * Password recovery without staff touching the database:
 *   - POST /api/auth/recover/request : anti-enumeration request; issues a
 *     single-use, hashed, 30-minute reset token (email_verifications table,
 *     purpose='password_reset' — migration 0029 already allows it).
 *   - POST /api/auth/recover/confirm : compare-and-set token consumption +
 *     password rotation + revocation of ALL sessions (a stolen old session
 *     must not survive a reset).
 *   - POST /api/auth/change-password : authenticated rotation; verifies the
 *     current password first, revokes every OTHER session, keeps the current.
 *   - POST /api/auth/sessions/revoke : authenticated revocation of all other
 *     sessions (device sign-out).
 *
 * Honesty rules: identical responses whether or not the email exists
 * (enumeration resistance); the reset link/token never appears in a
 * production response; delivery is either real (owner-configured provider)
 * or honestly unavailable; tokens are stored only as SHA-256 hashes.
 */

import { z } from "zod";
import { HttpError, json, readJson } from "../api/http";
import { hashPassword, verifyPassword } from "./password";
import { getEmailProvider, emailMessageFor, emailActionUrl } from "../notifications/email";
import type { D1Database } from "@cloudflare/workers-types";
import type { AuthContext } from "./session";

export const PASSWORD_RESET_MINUTES = 30;

const RecoverRequestSchema = z.object({
  email: z.string().email().max(254),
});

const RecoverConfirmSchema = z.object({
  token: z.string().trim().min(20).max(200),
  new_password: z.string().min(8).max(512),
});

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1).max(512),
  new_password: z.string().min(8).max(512),
});

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compare-and-set consumption (packet finding F17 doctrine): ONE conditional
 * UPDATE both claims and consumes the token. Two concurrent requests cannot
 * both win — the loser's UPDATE matches zero rows.
 */
export const CLAIM_PASSWORD_RESET_SQL = `
  UPDATE email_verifications
  SET consumed_at=CURRENT_TIMESTAMP, consumed_operation_id=?
  WHERE token_hash=? AND purpose='password_reset'
    AND consumed_at IS NULL
    AND datetime(expires_at)>datetime('now')
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=email_verifications.user_id AND u.is_active=1)
  RETURNING user_id
`;

export const ROTATE_PASSWORD_FOR_RESET_CLAIM_SQL = `
  UPDATE users
  SET password_hash=?, updated_at=CURRENT_TIMESTAMP
  WHERE is_active=1 AND id=(
    SELECT user_id FROM email_verifications
    WHERE token_hash=? AND purpose='password_reset' AND consumed_operation_id=?
  )
`;

export const REVOKE_SESSIONS_FOR_RESET_CLAIM_SQL = `
  DELETE FROM sessions
  WHERE user_id=(
    SELECT user_id FROM email_verifications
    WHERE token_hash=? AND purpose='password_reset' AND consumed_operation_id=?
  )
`;

/** One-time-use: any outstanding reset token for this user is voided first. */
export const VOID_PRIOR_RESET_TOKENS_SQL = `
  UPDATE email_verifications
  SET consumed_at=CURRENT_TIMESTAMP
  WHERE user_id=? AND purpose='password_reset' AND consumed_at IS NULL
`;

export const INSERT_RESET_TOKEN_SQL = `
  INSERT INTO email_verifications(id,user_id,token_hash,purpose,expires_at)
  VALUES(?,?,?,'password_reset',?)
`;

export const RESET_OTHER_SESSIONS_SQL = "DELETE FROM sessions WHERE user_id=? AND id<>?";

function isProductionEnv(env: unknown): boolean {
  const mode = (env as { APP_ENV?: string } | undefined)?.APP_ENV;
  return mode !== "development" && mode !== "test" && mode !== "local";
}

export interface ResetRequestOutcome {
  response: Response;
}

/**
 * Anti-enumeration contract: the JSON body (and status) is IDENTICAL whether
 * the account exists, is disabled, or does not exist at all. The only branch
 * is environment-dependent demo surfacing, which production never includes.
 */
export async function requestPasswordReset(
  db: D1Database,
  env: Record<string, unknown>,
  request: Request,
): Promise<Response> {
  const parsed = RecoverRequestSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_request", "Email failed validation");

  const email = parsed.data.email;
  const user = await db
    .prepare("SELECT id,email FROM users WHERE email=? COLLATE NOCASE AND is_active=1")
    .bind(email)
    .first<{ id: string; email: string }>();

  let demoTokenUrl: string | null = null;
  if (user) {
    // Void any outstanding reset token, then issue exactly one fresh token.
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(token);
    const expires = new Date(Date.now() + PASSWORD_RESET_MINUTES * 60_000).toISOString();
    await db.batch([
      db.prepare(VOID_PRIOR_RESET_TOKENS_SQL).bind(user.id),
      db.prepare(INSERT_RESET_TOKEN_SQL).bind(crypto.randomUUID(), user.id, tokenHash, expires),
    ]);

    const provider = getEmailProvider(env);
    const actionUrl = emailActionUrl(env, `/api/auth/recover/confirm?token=${token}`);
    if (provider && actionUrl) {
      const result = await provider.send(emailMessageFor("password_reset", user.email, actionUrl));
      if (!result.accepted) {
        // Honest failure: the token exists but never reached the provider. The
        // response stays enumeration-neutral (generic success envelope) — the
        // owner-facing signal is the provider failure, surfaced to logs only.
        // (P13: `accepted` = provider took the message; delivery confirmation
        // would only come from a verified provider callback.)
        console.warn("password-reset email provider rejected the message", result.failure);
      }
    } else if (!isProductionEnv(env)) {
      demoTokenUrl = `/api/auth/recover/confirm?token=${token}`;
    }
  }

  // Identical envelope for every caller (enumeration resistance).
  return json({
    requested: true,
    notice: "If an account exists for this email, a password reset link has been issued. The link is valid for 30 minutes and can be used once.",
    ...(demoTokenUrl ? { demoTokenUrl, demoNotice: "Email delivery is not configured in this demo — use the reset link below." } : {}),
  });
}

/**
 * Compare-and-set token consumption + password rotation + full session
 * revocation in one transaction. Every effect is marker-gated on THIS claim;
 * if any statement throws, D1/local SQLite/libSQL/PostgreSQL adapter batch
 * semantics roll the whole command back, leaving the token reusable.
 * Losing a race (or replaying a used token) yields the same generic 400 as an
 * unknown token — no information leaks.
 */
export async function confirmPasswordReset(
  db: D1Database,
  env: Record<string, unknown>,
  request: Request,
): Promise<Response> {
  void env;
  const parsed = RecoverConfirmSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_request", "Token or new password failed validation");

  // Expensive password derivation occurs BEFORE the single-use capability is
  // claimed, so a hashing failure can never burn the reset token.
  const passwordHash = await hashPassword(parsed.data.new_password);
  const tokenHash = await sha256Hex(parsed.data.token);
  const operationId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(CLAIM_PASSWORD_RESET_SQL).bind(operationId, tokenHash),
    db.prepare(ROTATE_PASSWORD_FOR_RESET_CLAIM_SQL).bind(passwordHash, tokenHash, operationId),
    db.prepare(REVOKE_SESSIONS_FOR_RESET_CLAIM_SQL).bind(tokenHash, operationId),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(400, "invalid_token", "Reset link is invalid, expired, or already used");
  }
  // A successful claim must identify one active FK-backed user. Treat anything
  // else as an invariant failure rather than reporting a reset that did not
  // actually rotate credentials. Under transactional batch semantics an SQL
  // failure rolls back the claim before this point.
  if (Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(500, "reset_invariant_failed", "Password reset could not be completed safely");
  }
  return json({ reset: true, notice: "Password updated. All previous sign-ins have been revoked; sign in again." });
}

/** Authenticated password rotation: current password verified, other sessions revoked. */
export async function changePassword(
  db: D1Database,
  request: Request,
  auth: AuthContext,
): Promise<Response> {
  const parsed = ChangePasswordSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_request", "Current or new password failed validation");
  if (parsed.data.current_password === parsed.data.new_password) {
    throw new HttpError(422, "unchanged_password", "The new password must differ from the current one");
  }

  const user = await db
    .prepare("SELECT id,password_hash FROM users WHERE id=? AND is_active=1")
    .bind(auth.user.id)
    .first<{ id: string; password_hash: string }>();
  // Generic failure for missing user AND wrong password (no account-state leak).
  if (!user || !(await verifyPassword(parsed.data.current_password, user.password_hash))) {
    throw new HttpError(403, "invalid_credentials", "Current password is incorrect");
  }

  const passwordHash = await hashPassword(parsed.data.new_password);
  await db.batch([
    db.prepare("UPDATE users SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash, user.id),
    db.prepare(RESET_OTHER_SESSIONS_SQL).bind(user.id, auth.sessionId),
  ]);
  return json({
    changed: true,
    otherSessionsRevoked: true,
    notice: "Password updated. Other devices have been signed out; this session stays signed in.",
  });
}

/** Authenticated sign-out of every OTHER session (device management). */
export async function revokeOtherSessions(db: D1Database, auth: AuthContext): Promise<Response> {
  const result = await db.prepare(RESET_OTHER_SESSIONS_SQL).bind(auth.user.id, auth.sessionId).run();
  const revoked = Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  return json({ revoked, notice: revoked > 0 ? "Other sessions have been signed out." : "No other active sessions existed." });
}
