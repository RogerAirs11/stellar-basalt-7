import { z } from "zod";
import { HttpError, json, readJson } from "../api/http";
import { requireAuth, requireCsrf } from "./guards";
import { capabilitiesForRole } from "./capabilities";
import { verifyPassword } from "./password";
import { isSecureRequest, sessionCookie, type AuthContext } from "./session";
import { acceptedTotpStep, decryptMfaSecret, encryptMfaSecret, mfaHash, newTotpSecret, parseMfaKeyring, randomMfaToken, type MfaKeyring } from "./mfaCrypto";
import { currentMfaSessionPredicate, mfaCheckStatement, mfaConstraintFailure, mfaLockStatements, mfaPolicy, type MfaSqlPredicate } from "./mfaGuard";
import type { MfaStatus } from "../contracts/mfa";
import { parseUtcTimestamp } from "../shared/utcTimestamp";

export const MFA_ASSURANCE_MINUTES = 15;
export const MFA_ENROLLMENT_MINUTES = 10;
export const MFA_RECOVERY_CODES = 10;
interface MfaEnvironment { DB: D1Database; SESSION_COOKIE_NAME: string; MFA_MODE?: string; MFA_KEYRING_JSON?: string }
interface Factor {
  user_id: string; factor_version: number; secret_ciphertext: string | null; last_totp_step: number;
  pending_id: string | null; pending_secret_ciphertext: string | null; pending_expires_at: string | null; pending_session_id: string | null;
  recovery_generation: number; recovery_session_id: string | null; recovery_until: string | null;
  failed_attempts: number; locked_until: string | null;
}
const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const password = z.string().min(1).max(512);
const code = z.string().trim().regex(/^\d{6}$/);
const factorCommand = z.object({ current_password: password, current_code: code, expected_factor_version: version }).strict();
const schemas = {
  enroll: z.object({ current_password: password, current_code: code.optional(), expected_factor_version: version }).strict(),
  activate: z.object({ enrollment_id: z.string().uuid(), code, expected_factor_version: version }).strict(),
  challenge: z.object({ code }).strict(),
  recover: z.object({ current_password: password, recovery_code: z.string().trim().min(20).max(100) }).strict(),
  "recovery-codes": factorCommand,
  disable: factorCommand,
  cancel: z.object({ enrollment_id: z.string().uuid(), expected_factor_version: version }).strict(),
};

async function factor(db: D1Database, userId: string): Promise<Factor | null> {
  return db.prepare("SELECT * FROM auth_mfa_factors WHERE user_id=?").bind(userId).first<Factor>();
}
async function ensureFactor(db: D1Database, auth: AuthContext): Promise<Factor> {
  await db.prepare("INSERT INTO auth_mfa_factors(user_id) SELECT ? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND is_active=1) ON CONFLICT(user_id) DO NOTHING").bind(auth.user.id, auth.user.id).run();
  const row = await factor(db, auth.user.id);
  if (!row) throw new HttpError(401, "authentication_required", "Sign in is required");
  return row;
}
export async function mfaStatus(db: D1Database, env: MfaEnvironment, auth: AuthContext): Promise<MfaStatus> {
  const policy = mfaPolicy(env.MFA_MODE);
  const row = await factor(db, auth.user.id);
  const results = await db.batch([
    db.prepare(`SELECT expires_at FROM auth_mfa_session_assurance WHERE session_id=? AND user_id=? AND token_hash=?
      AND factor_version=? AND datetime(expires_at)>CURRENT_TIMESTAMP`).bind(auth.sessionId, auth.user.id, auth.sessionTokenHash ?? "", row?.factor_version ?? 0),
    db.prepare("SELECT COUNT(*) AS count FROM auth_mfa_recovery_codes WHERE user_id=? AND factor_version=? AND generation=? AND used_at IS NULL")
      .bind(auth.user.id, row?.factor_version ?? 0, row?.recovery_generation ?? 0),
    db.prepare("SELECT id,event_type,created_at FROM auth_mfa_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(auth.user.id),
    db.prepare(`SELECT pending_id,pending_expires_at,recovery_until FROM auth_mfa_factors WHERE user_id=?
      AND (pending_session_id=? OR recovery_session_id=?)`).bind(auth.user.id, auth.sessionId, auth.sessionId),
  ]);
  const privateState = results[3]?.results?.[0] as { pending_id?: string; pending_expires_at?: string; recovery_until?: string } | undefined;
  const pendingMs = parseUtcTimestamp(privateState?.pending_expires_at);
  const recoveryMs = parseUtcTimestamp(privateState?.recovery_until);
  const assuranceMs = parseUtcTimestamp((results[0]?.results?.[0] as { expires_at?: string } | undefined)?.expires_at);
  const pending = row?.pending_session_id === auth.sessionId && privateState?.pending_id && pendingMs != null && pendingMs > Date.now();
  const recovery = row?.recovery_session_id === auth.sessionId && recoveryMs != null && recoveryMs > Date.now();
  return { available: Boolean(parseMfaKeyring(env.MFA_KEYRING_JSON)) && (policy !== "disabled" || Boolean(row?.secret_ciphertext)), policy,
    enrolled: Boolean(row?.secret_ciphertext), factor_version: Number(row?.factor_version ?? 0),
    pending_enrollment: pending ? { id: privateState.pending_id!, expires_at: new Date(pendingMs!).toISOString() } : null,
    verified_until: row?.secret_ciphertext && assuranceMs != null ? new Date(assuranceMs).toISOString() : null,
    recovery_codes_remaining: Number((results[1]?.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    recovery_replacement_until: recovery ? new Date(recoveryMs!).toISOString() : null,
    recent_events: (results[2]?.results ?? []) as MfaStatus["recent_events"] };
}
function requireKeys(env: MfaEnvironment): MfaKeyring {
  const keys = parseMfaKeyring(env.MFA_KEYRING_JSON);
  if (!keys) throw new HttpError(503, "mfa_unavailable", "Authenticator setup and verification are unavailable until the operator configures account security");
  return keys;
}
function requireVersion(row: Factor, expected: number): void {
  if (Number(row.factor_version) !== expected) throw new HttpError(409, "mfa_factor_changed", "Account security changed; reload its current status before retrying");
}
async function checkLock(db: D1Database, auth: AuthContext): Promise<void> {
  const locked = await db.prepare("SELECT 1 AS locked FROM auth_mfa_factors WHERE user_id=? AND datetime(locked_until)>CURRENT_TIMESTAMP").bind(auth.user.id).first();
  if (locked) throw new HttpError(429, "mfa_temporarily_locked", "Too many verification attempts; wait 15 minutes before trying again");
}
async function rejectAttempt(db: D1Database, auth: AuthContext): Promise<never> {
  // Count against the account even if a caller changes sessions. A bounded
  // lock resets only after its deadline; no OTP/password is ever recorded.
  const live = currentMfaSessionPredicate(auth);
  await db.prepare(`UPDATE auth_mfa_factors SET
    failed_attempts=CASE WHEN locked_until IS NOT NULL AND datetime(locked_until)<=CURRENT_TIMESTAMP THEN 1 ELSE failed_attempts+1 END,
    locked_until=CASE WHEN locked_until IS NOT NULL AND datetime(locked_until)<=CURRENT_TIMESTAMP THEN NULL
      WHEN failed_attempts+1>=5 THEN datetime('now','+15 minutes') ELSE locked_until END
    WHERE user_id=? AND (${live.sql}) AND (locked_until IS NULL OR datetime(locked_until)<=CURRENT_TIMESTAMP)`)
    .bind(auth.user.id, ...live.bindings).run();
  throw new HttpError(400, "mfa_verification_failed", "The supplied account verification was not accepted");
}
async function passwordProof(db: D1Database, auth: AuthContext, supplied: string): Promise<MfaSqlPredicate> {
  const row = await db.prepare("SELECT password_hash FROM users WHERE id=? AND is_active=1").bind(auth.user.id).first<{ password_hash: string }>();
  if (!row || !await verifyPassword(supplied, row.password_hash)) return rejectAttempt(db, auth);
  return { sql: "EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND is_active=1)", bindings: [auth.user.id, row.password_hash] };
}
async function totpProof(db: D1Database, keys: MfaKeyring, auth: AuthContext, row: Factor, supplied: string | undefined): Promise<number> {
  if (!row.secret_ciphertext || !supplied) return rejectAttempt(db, auth);
  const secret = await decryptMfaSecret(keys, row.secret_ciphertext, auth.user.id, Number(row.factor_version));
  const step = await acceptedTotpStep(secret, supplied);
  if (step == null || step <= Number(row.last_totp_step)) return rejectAttempt(db, auth);
  return step;
}
function factorCheck(row: Factor): MfaSqlPredicate {
  return { sql: `EXISTS(SELECT 1 FROM auth_mfa_factors WHERE user_id=? AND factor_version=?
    AND (locked_until IS NULL OR datetime(locked_until)<=CURRENT_TIMESTAMP))`, bindings: [row.user_id, Number(row.factor_version)] };
}
function stepCheck(row: Factor, step: number): MfaSqlPredicate {
  return { sql: "EXISTS(SELECT 1 FROM auth_mfa_factors WHERE user_id=? AND last_totp_step<?)", bindings: [row.user_id, step] };
}
function recoveryCheck(row: Factor, auth: AuthContext): MfaSqlPredicate {
  return { sql: "EXISTS(SELECT 1 FROM auth_mfa_factors WHERE user_id=? AND recovery_session_id=? AND datetime(recovery_until)>CURRENT_TIMESTAMP)", bindings: [row.user_id, auth.sessionId] };
}
async function recoveryCodes(userId: string, factorVersion: number, generation: number): Promise<Array<{ id: string; plaintext: string; hash: string }>> {
  return Promise.all(Array.from({ length: MFA_RECOVERY_CODES }, async () => {
    const plaintext = randomMfaToken(20);
    return { id: crypto.randomUUID(), plaintext, hash: await mfaHash(`horse-mfa-recovery-v1:${userId}:${factorVersion}:${generation}:${plaintext}`) };
  }));
}
function codeStatements(db: D1Database, row: Factor, factorVersion: number, generation: number, codes: Awaited<ReturnType<typeof recoveryCodes>>): D1PreparedStatement[] {
  return [db.prepare("DELETE FROM auth_mfa_recovery_codes WHERE user_id=?").bind(row.user_id),
    ...codes.map(value => db.prepare("INSERT INTO auth_mfa_recovery_codes(id,user_id,factor_version,generation,code_hash) VALUES(?,?,?,?,?)")
      .bind(value.id, row.user_id, factorVersion, generation, value.hash))];
}
interface CommitOptions {
  event: string;
  checks?: MfaSqlPredicate[];
  statements: D1PreparedStatement[];
  assurance?: "preserve" | "clear" | { version: number };
  revokeOthers?: boolean;
  extra?: Record<string, unknown>;
}
async function commit(db: D1Database, env: MfaEnvironment, request: Request, auth: AuthContext, row: Factor, options: CommitOptions): Promise<Response> {
  const token = randomMfaToken(); const csrfToken = randomMfaToken(24); const tokenHash = await mfaHash(token);
  const operationId = crypto.randomUUID();
  const session = await db.prepare("SELECT expires_at FROM sessions WHERE id=? AND token_hash=?").bind(auth.sessionId, auth.sessionTokenHash ?? "").first<{ expires_at: string }>();
  if (!session) throw new HttpError(401, "authentication_required", "Sign in again before changing account security");
  const assurance: D1PreparedStatement[] = [];
  if (options.assurance === "clear") assurance.push(db.prepare("DELETE FROM auth_mfa_session_assurance WHERE user_id=?").bind(auth.user.id));
  else if (typeof options.assurance === "object") {
    assurance.push(db.prepare("DELETE FROM auth_mfa_session_assurance WHERE session_id=?").bind(auth.sessionId));
    assurance.push(db.prepare(`INSERT INTO auth_mfa_session_assurance(session_id,user_id,factor_version,token_hash,verified_at,expires_at,method)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP,datetime('now','+15 minutes'),'totp')`).bind(auth.sessionId, auth.user.id, options.assurance.version, tokenHash));
  } else assurance.push(db.prepare("UPDATE auth_mfa_session_assurance SET token_hash=? WHERE session_id=? AND token_hash=?")
    .bind(tokenHash, auth.sessionId, auth.sessionTokenHash ?? ""));
  try {
    await db.batch([...mfaLockStatements(db, auth),
      mfaCheckStatement(db, operationId, [currentMfaSessionPredicate(auth), factorCheck(row), ...(options.checks ?? [])]),
      ...options.statements,
      db.prepare("UPDATE auth_mfa_factors SET failed_attempts=0,locked_until=NULL,command_id=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(operationId, auth.user.id),
      ...(options.revokeOthers ? [db.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(auth.user.id, auth.sessionId)] : []),
      db.prepare("UPDATE sessions SET token_hash=?,csrf_token=? WHERE id=?").bind(tokenHash, csrfToken, auth.sessionId),
      ...assurance,
      db.prepare("INSERT INTO auth_mfa_events(id,user_id,event_type) VALUES(?,?,?)").bind(operationId, auth.user.id, options.event),
      // Keep bounded in-app security history. No clinical or authentication secret data.
      db.prepare("DELETE FROM auth_mfa_events WHERE user_id=? AND id NOT IN (SELECT id FROM auth_mfa_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100)").bind(auth.user.id, auth.user.id),
      db.prepare("DELETE FROM auth_mfa_commit_checks WHERE id=?").bind(operationId),
    ]);
  } catch (cause) {
    if (mfaConstraintFailure(cause)) throw new HttpError(409, "mfa_security_changed", "Account verification changed or was already used; reload status and use a fresh code");
    throw cause;
  }
  const nextAuth = { ...auth, csrfToken, sessionTokenHash: tokenHash };
  const user = await db.prepare("SELECT id,email,display_name,role FROM users WHERE id=? AND is_active=1").bind(auth.user.id).first<AuthContext["user"]>();
  if (!user) throw new HttpError(401, "authentication_required", "Sign in is required");
  return json({ status: await mfaStatus(db, env, nextAuth), user, permissions: capabilitiesForRole(user.role), csrfToken, ...options.extra },
    { headers: { "set-cookie": sessionCookie(env.SESSION_COOKIE_NAME, token, session.expires_at, isSecureRequest(request)) } });
}

export async function routeMfa(request: Request, env: MfaEnvironment): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/auth/mfa/")) return null;
  const action = path.slice("/api/auth/mfa/".length);
  const db = env.DB; const auth = await requireAuth(db, request, env.SESSION_COOKIE_NAME);
  if (action === "status" && request.method === "GET") return json(await mfaStatus(db, env, auth));
  if (request.method !== "POST" || !Object.hasOwn(schemas, action)) throw new HttpError(404, "not_found", "Account security operation not found");
  requireCsrf(request, auth);
  const keys = requireKeys(env);
  const schema = schemas[action as keyof typeof schemas];
  const parsed = schema.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, "invalid_request", "Account security input failed validation");
  const input = parsed.data as Record<string, string | number | undefined>;
  const row = await ensureFactor(db, auth); await checkLock(db, auth);
  // Disabling new enrollment must not strand accounts already protected by
  // a factor. Existing verification, recovery and replacement remain usable.
  if (mfaPolicy(env.MFA_MODE) === "disabled" && !row.secret_ciphertext && action !== "cancel") {
    throw new HttpError(503, "mfa_unavailable", "New authenticator enrollment is disabled in this environment");
  }
  if (typeof input.expected_factor_version === "number") requireVersion(row, input.expected_factor_version);

  if (action === "enroll") {
    const proof = await passwordProof(db, auth, String(input.current_password));
    const checks = [proof]; let acceptedStep: number | null = null;
    if (row.secret_ciphertext) {
      const permittedRecovery = await db.prepare(`SELECT 1 AS allowed WHERE ${recoveryCheck(row, auth).sql}`).bind(...recoveryCheck(row, auth).bindings).first();
      if (permittedRecovery) checks.push(recoveryCheck(row, auth));
      else { acceptedStep = await totpProof(db, keys, auth, row, input.current_code as string | undefined); checks.push(stepCheck(row, acceptedStep)); }
    }
    const secret = newTotpSecret(); const id = crypto.randomUUID(); const expiresAt = new Date(Date.now() + MFA_ENROLLMENT_MINUTES * 60_000).toISOString();
    const encrypted = await encryptMfaSecret(keys, secret, auth.user.id, Number(row.factor_version) + 1);
    return commit(db, env, request, auth, row, { event: "enrollment_started", checks,
      statements: [db.prepare(`UPDATE auth_mfa_factors SET pending_id=?,pending_secret_ciphertext=?,pending_expires_at=?,pending_session_id=?,
        last_totp_step=CASE WHEN ?<0 THEN last_totp_step ELSE ? END WHERE user_id=?`).bind(id, encrypted, expiresAt, auth.sessionId, acceptedStep ?? -1, acceptedStep ?? -1, auth.user.id)],
      extra: { enrollment: { id, secret, expires_at: expiresAt, otpauth_uri: `otpauth://totp/${encodeURIComponent(`Horse Registry:${auth.user.email}`)}?secret=${secret}&issuer=Horse%20Registry&algorithm=SHA1&digits=6&period=30` } } });
  }
  if (action === "activate") {
    if (!row.pending_id || row.pending_id !== input.enrollment_id || row.pending_session_id !== auth.sessionId || !row.pending_secret_ciphertext) throw new HttpError(409, "mfa_enrollment_changed", "Start or reload your current enrollment before verifying it");
    const secret = await decryptMfaSecret(keys, row.pending_secret_ciphertext, auth.user.id, Number(row.factor_version) + 1);
    const acceptedStep = await acceptedTotpStep(secret, String(input.code));
    if (acceptedStep == null) return rejectAttempt(db, auth);
    const nextVersion = Number(row.factor_version) + 1; const generation = Number(row.recovery_generation) + 1;
    const codes = await recoveryCodes(auth.user.id, nextVersion, generation);
    return commit(db, env, request, auth, row, { event: row.secret_ciphertext ? "factor_replaced" : "factor_activated", revokeOthers: true, assurance: { version: nextVersion },
      checks: [{ sql: `EXISTS(SELECT 1 FROM auth_mfa_factors WHERE user_id=? AND pending_id=? AND pending_session_id=? AND datetime(pending_expires_at)>CURRENT_TIMESTAMP)`, bindings: [auth.user.id, row.pending_id, auth.sessionId] }],
      statements: [db.prepare(`UPDATE auth_mfa_factors SET secret_ciphertext=pending_secret_ciphertext,factor_version=?,last_totp_step=?,recovery_generation=?,
        pending_id=NULL,pending_secret_ciphertext=NULL,pending_expires_at=NULL,pending_session_id=NULL,recovery_session_id=NULL,recovery_until=NULL WHERE user_id=?`)
        .bind(nextVersion, acceptedStep, generation, auth.user.id), ...codeStatements(db, row, nextVersion, generation, codes)],
      extra: { recovery_codes: codes.map(value => value.plaintext) } });
  }
  if (action === "challenge") {
    const acceptedStep = await totpProof(db, keys, auth, row, String(input.code));
    return commit(db, env, request, auth, row, { event: "step_up_verified", checks: [stepCheck(row, acceptedStep)], assurance: { version: Number(row.factor_version) },
      statements: [db.prepare("UPDATE auth_mfa_factors SET last_totp_step=? WHERE user_id=?").bind(acceptedStep, auth.user.id)] });
  }
  if (action === "recover") {
    const proof = await passwordProof(db, auth, String(input.current_password));
    if (!row.secret_ciphertext) return rejectAttempt(db, auth);
    const digest = await mfaHash(`horse-mfa-recovery-v1:${auth.user.id}:${row.factor_version}:${row.recovery_generation}:${String(input.recovery_code).trim()}`);
    const recovery = await db.prepare("SELECT id FROM auth_mfa_recovery_codes WHERE user_id=? AND factor_version=? AND generation=? AND code_hash=? AND used_at IS NULL")
      .bind(auth.user.id, row.factor_version, row.recovery_generation, digest).first<{ id: string }>();
    if (!recovery) return rejectAttempt(db, auth);
    const consumedId = crypto.randomUUID();
    return commit(db, env, request, auth, row, { event: "recovery_code_used", revokeOthers: true, assurance: "clear",
      checks: [proof, { sql: "EXISTS(SELECT 1 FROM auth_mfa_recovery_codes WHERE id=? AND user_id=? AND generation=? AND used_at IS NULL)", bindings: [recovery.id, auth.user.id, row.recovery_generation] }],
      statements: [db.prepare("UPDATE auth_mfa_recovery_codes SET used_at=CURRENT_TIMESTAMP,consumed_operation_id=? WHERE id=?").bind(consumedId, recovery.id),
        db.prepare(`UPDATE auth_mfa_factors SET recovery_session_id=?,recovery_until=datetime('now','+10 minutes'),
          pending_id=NULL,pending_secret_ciphertext=NULL,pending_expires_at=NULL,pending_session_id=NULL WHERE user_id=?`).bind(auth.sessionId, auth.user.id)] });
  }
  if (action === "cancel") {
    return commit(db, env, request, auth, row, { event: "enrollment_cancelled",
      checks: [{ sql: "EXISTS(SELECT 1 FROM auth_mfa_factors WHERE user_id=? AND pending_id=? AND pending_session_id=?)", bindings: [auth.user.id, String(input.enrollment_id), auth.sessionId] }],
      statements: [db.prepare("UPDATE auth_mfa_factors SET pending_id=NULL,pending_secret_ciphertext=NULL,pending_expires_at=NULL,pending_session_id=NULL WHERE user_id=?").bind(auth.user.id)] });
  }
  const proof = await passwordProof(db, auth, String(input.current_password));
  const acceptedStep = await totpProof(db, keys, auth, row, String(input.current_code));
  if (action === "disable") {
    return commit(db, env, request, auth, row, { event: "factor_disabled", checks: [proof, stepCheck(row, acceptedStep)], revokeOthers: true, assurance: "clear",
      statements: [db.prepare(`UPDATE auth_mfa_factors SET secret_ciphertext=NULL,factor_version=factor_version+1,last_totp_step=-1,
        pending_id=NULL,pending_secret_ciphertext=NULL,pending_expires_at=NULL,pending_session_id=NULL,recovery_session_id=NULL,recovery_until=NULL WHERE user_id=?`).bind(auth.user.id),
        db.prepare("DELETE FROM auth_mfa_recovery_codes WHERE user_id=?").bind(auth.user.id)] });
  }
  const generation = Number(row.recovery_generation) + 1; const codes = await recoveryCodes(auth.user.id, Number(row.factor_version), generation);
  return commit(db, env, request, auth, row, { event: "recovery_codes_rotated", checks: [proof, stepCheck(row, acceptedStep)], revokeOthers: true, assurance: { version: Number(row.factor_version) },
    statements: [db.prepare("UPDATE auth_mfa_factors SET last_totp_step=?,recovery_generation=?,recovery_session_id=NULL,recovery_until=NULL WHERE user_id=?").bind(acceptedStep, generation, auth.user.id),
      ...codeStatements(db, row, Number(row.factor_version), generation, codes)], extra: { recovery_codes: codes.map(value => value.plaintext) } });
}
