import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker";
import { hashPassword } from "../../src/auth/password";
import { getAuth } from "../../src/auth/session";
import { mfaAuthorizationPredicate, withMfaMutationGuard, withMfaPolicy } from "../../src/auth/mfaGuard";
import { acceptedTotpStep, decryptMfaSecret, encodeBase32, encryptMfaSecret, mfaHash, parseMfaKeyring, totpAtStep } from "../../src/auth/mfaCrypto";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";
import type { MfaBeginResponse, MfaCodesResponse, MfaCommandResponse } from "../../src/contracts/mfa";
import { careCapability } from "../../src/equineCare/access";

const limiter = { limit: async () => ({ success: true }) };
const keyring = { active_key_id: "synthetic-test-key", keys: { "synthetic-test-key": btoa("01234567890123456789012345678901") } };
const password = "Synthetic only password 148!";
afterEach(() => vi.useRealTimers());
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, settings: Record<string, unknown> = {}) {
  return (worker as unknown as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(authedRequest(path, body, { session }), {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", DB: db, SESSION_COOKIE_NAME: "hr_session", MFA_MODE: "optional", MFA_KEYRING_JSON: JSON.stringify(keyring),
    ASSETS: { fetch: async () => new Response("unused") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter, ...settings,
  });
}
async function world() {
  const db = await openRealDatabase(); await seedUser(db, "mfa-admin", "admin");
  await db.prepare("UPDATE users SET password_hash=? WHERE id='mfa-admin'").bind(await hashPassword(password)).run();
  return { db, session: await makeSession(db, "mfa-admin") };
}
async function command<T extends MfaCommandResponse>(db: D1Database, action: string, body: unknown, session: AuthedSession) {
  const response = await call(db, `/api/auth/mfa/${action}`, body, session);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  const data = await response.json() as T;
  const next = { ...session, cookie: response.headers.get("set-cookie")!.split(";", 1)[0]!, csrfToken: data.csrfToken };
  return { data, session: next, response };
}
async function enrollment(db: D1Database, session: AuthedSession, expected = 0, extra: Record<string, unknown> = {}) {
  return command<MfaBeginResponse>(db, "enroll", { current_password: password, expected_factor_version: expected, ...extra }, session);
}
async function enroll(db: D1Database, session: AuthedSession) {
  const started = await enrollment(db, session);
  const activated = await command<MfaCodesResponse>(db, "activate", { enrollment_id: started.data.enrollment.id,
    expected_factor_version: 0, code: await totpAtStep(started.data.enrollment.secret, Math.floor(Date.now() / 30_000)) }, started.session);
  return { ...activated, secret: started.data.enrollment.secret };
}
async function nextCode(secret: string) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 30_000);
  return totpAtStep(secret, Math.floor(Date.now() / 30_000));
}
async function allowed(db: D1Database, session: AuthedSession, policy: "optional" | "required" = "optional") {
  const auth = await getAuth(withMfaPolicy(db, policy), authedRequest("/api/test", undefined, { session }), "hr_session");
  if (!auth) return false;
  const predicate = mfaAuthorizationPredicate(auth);
  return Boolean(await db.prepare(`SELECT 1 AS ok WHERE ${predicate.sql}`).bind(...predicate.bindings).first());
}

describe("R148 real authenticator lifecycle and sensitive-operation boundaries", () => {
  it("requires enforced MFA as well as an agreement before private care production activation", async () => {
    const { db } = await world();
    const environment = { DB: db, SESSION_COOKIE_NAME: "hr_session", APP_ENV: "production", EQUINE_CARE_MODE: "approved_production", EQUINE_CARE_AGREEMENT_REF: "SYNTHETIC-APPROVAL-REFERENCE" };
    expect(careCapability(environment).enabled).toBe(false);
    expect(careCapability({ ...environment, MFA_MODE: "optional" }).enabled).toBe(false);
    expect(careCapability({ ...environment, MFA_MODE: "required" }).enabled).toBe(true);
  });
  it("matches RFC 6238 SHA-1 vectors and rejects wrong or oversized codes", async () => {
    const secret = encodeBase32(new TextEncoder().encode("12345678901234567890"));
    for (const [seconds, expected] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const) {
      expect(await totpAtStep(secret, Math.floor(seconds / 30), 8)).toBe(expected);
    }
    expect(await acceptedTotpStep(secret, "1234567")).toBeNull();
  });
  it("encrypts with authenticated user/version binding, old-key reads and no plaintext persistence", async () => {
    const encoded = await encryptMfaSecret(keyring, "ABCDEFGHIJKLMNOP", "one", 1);
    expect(encoded).not.toContain("ABCDEFGHIJKLMNOP");
    expect(await decryptMfaSecret(keyring, encoded, "one", 1)).toBe("ABCDEFGHIJKLMNOP");
    await expect(decryptMfaSecret(keyring, encoded, "two", 1)).rejects.toMatchObject({ code: "mfa_key_unavailable" });
    await expect(decryptMfaSecret(keyring, encoded, "one", 2)).rejects.toMatchObject({ code: "mfa_key_unavailable" });
    expect(parseMfaKeyring('{"active_key_id":"x","keys":{"x":"bad"}}')).toBeNull();
  });
  it("requires session, CSRF, current password and configured key before setup", async () => {
    const { db, session } = await world();
    expect((await call(db, "/api/auth/mfa/status")).status).toBe(401);
    expect((await call(db, "/api/auth/mfa/enroll", { current_password: password, expected_factor_version: 0 }, { ...session, csrfToken: "bad" })).status).toBe(403);
    expect((await call(db, "/api/auth/mfa/enroll", { current_password: "wrong", expected_factor_version: 0 }, session)).status).toBe(400);
    expect((await call(db, "/api/auth/mfa/enroll", { current_password: password, expected_factor_version: 0 }, session, { MFA_KEYRING_JSON: undefined })).status).toBe(503);
    expect((await call(db, "/api/auth/mfa/status", undefined, session, { MFA_KEYRING_JSON: undefined })).status).toBe(200);
  });
  it("requires proof before activation; rotates cookies/CSRF and revokes other sessions on activation", async () => {
    const { db, session } = await world(); const other = await makeSession(db, "mfa-admin");
    const begin = await enrollment(db, session);
    expect(begin.data.status.enrolled).toBe(false); expect(begin.session.cookie).not.toBe(session.cookie);
    expect(await getAuth(db, authedRequest("/", undefined, { session }), "hr_session")).toBeNull();
    const row = await db.prepare("SELECT * FROM auth_mfa_factors").first();
    expect(JSON.stringify(row)).not.toContain(begin.data.enrollment.secret);
    const wrong = await call(db, "/api/auth/mfa/activate", { enrollment_id: begin.data.enrollment.id, code: "000000", expected_factor_version: 0 }, begin.session);
    expect(wrong.status).toBe(400);
    const result = await command<MfaCodesResponse>(db, "activate", { enrollment_id: begin.data.enrollment.id, code: await totpAtStep(begin.data.enrollment.secret, Math.floor(Date.now() / 30_000)), expected_factor_version: 0 }, begin.session);
    expect(result.data.status).toMatchObject({ enrolled: true, factor_version: 1, recovery_codes_remaining: 10, pending_enrollment: null });
    expect(result.data.recovery_codes).toHaveLength(10); expect(new Set(result.data.recovery_codes).size).toBe(10);
    const stored = JSON.stringify(await db.prepare("SELECT * FROM auth_mfa_recovery_codes").all());
    for (const code of result.data.recovery_codes) expect(stored).not.toContain(code);
    expect(await getAuth(db, authedRequest("/", undefined, { session: other }), "hr_session")).toBeNull();
    expect(await allowed(db, result.session)).toBe(true);
  });
  it("rejects expired enrollment and enrollment from a different session", async () => {
    const { db, session } = await world(); const begin = await enrollment(db, session); const other = await makeSession(db, "mfa-admin");
    const body = { enrollment_id: begin.data.enrollment.id, code: await totpAtStep(begin.data.enrollment.secret, Math.floor(Date.now() / 30_000)), expected_factor_version: 0 };
    expect((await call(db, "/api/auth/mfa/activate", body, other)).status).toBe(409);
    await db.prepare("UPDATE auth_mfa_factors SET pending_expires_at=datetime('now','-1 minute')").run();
    expect((await call(db, "/api/auth/mfa/activate", body, begin.session)).status).toBe(409);
    expect(await db.prepare("SELECT secret_ciphertext FROM auth_mfa_factors").first("secret_ciphertext")).toBeNull();
  });
  it("does not elevate password login; step-up expires and a TOTP is single-use across sessions", async () => {
    const { db, session } = await world(); const active = await enroll(db, session);
    const signedIn = await makeSession(db, "mfa-admin");
    expect(await allowed(db, signedIn)).toBe(false);
    expect((await call(db, "/api/admin/dashboard", undefined, signedIn)).status).toBe(403);
    const fresh = await nextCode(active.secret);
    const stepped = await command(db, "challenge", { code: fresh }, signedIn);
    expect(await allowed(db, stepped.session)).toBe(true);
    const third = await makeSession(db, "mfa-admin");
    expect((await call(db, "/api/auth/mfa/challenge", { code: fresh }, third)).status).toBe(400);
    await db.prepare("UPDATE auth_mfa_session_assurance SET expires_at=datetime('now','-1 second')").run();
    expect(await allowed(db, stepped.session)).toBe(false);
    expect((await call(db, "/api/horses", { id: 148000, name_latin: "Blocked" }, stepped.session)).status).toBe(403);
  });
  it("never bypasses an enrolled factor by disabling/missing key configuration", async () => {
    const { db, session } = await world(); const active = await enroll(db, session); const signedIn = await makeSession(db, "mfa-admin");
    expect((await call(db, "/api/admin/dashboard", undefined, signedIn, { MFA_MODE: "disabled", MFA_KEYRING_JSON: undefined })).status).toBe(403);
    const other = await seedUser(db, "unprotected", "admin"); const unprotected = await makeSession(db, other.id);
    expect((await call(db, "/api/admin/dashboard", undefined, unprotected, { MFA_MODE: "required" })).status).toBe(403);
    expect((await call(db, "/api/auth/mfa/status", undefined, unprotected, { MFA_MODE: "required" })).status).toBe(200);
    // Disabling NEW enrollments still lets an existing account prove its
    // current factor, preventing an operator toggle from stranding it.
    const verified = await call(db, "/api/auth/mfa/challenge", { code: await nextCode(active.secret) }, signedIn, { MFA_MODE: "disabled" });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ status: { available: true, enrolled: true, policy: "disabled" } });
  });
  it("recovery consumes one code, revokes sessions, grants only factor replacement and rotates the factor", async () => {
    const { db, session } = await world(); const active = await enroll(db, session); const signedIn = await makeSession(db, "mfa-admin");
    const recovered = await command(db, "recover", { current_password: password, recovery_code: active.data.recovery_codes[0] }, signedIn);
    expect(recovered.data.status).toMatchObject({ enrolled: true, factor_version: 1, verified_until: null, recovery_codes_remaining: 9 });
    expect(recovered.data.status.recovery_replacement_until).toBeTruthy();
    expect(await allowed(db, recovered.session)).toBe(false);
    expect((await call(db, "/api/admin/dashboard", undefined, recovered.session)).status).toBe(403);
    expect((await call(db, "/api/auth/mfa/recover", { current_password: password, recovery_code: active.data.recovery_codes[0] }, recovered.session)).status).toBe(400);
    const replacement = await enrollment(db, recovered.session, 1);
    const replaced = await command<MfaCodesResponse>(db, "activate", { enrollment_id: replacement.data.enrollment.id, expected_factor_version: 1,
      code: await totpAtStep(replacement.data.enrollment.secret, Math.floor(Date.now() / 30_000)) }, replacement.session);
    expect(replaced.data.status).toMatchObject({ factor_version: 2, recovery_codes_remaining: 10, recovery_replacement_until: null });
    expect(await allowed(db, replaced.session)).toBe(true);
    expect((await call(db, "/api/auth/mfa/recover", { current_password: password, recovery_code: active.data.recovery_codes[1] }, replaced.session)).status).toBe(400);
  });
  it("requires password plus a fresh authenticator for disabling or replacing recovery codes", async () => {
    const { db, session } = await world(); const active = await enroll(db, session);
    const code = await nextCode(active.secret);
    expect((await call(db, "/api/auth/mfa/recovery-codes", { expected_factor_version: 1, current_password: "wrong", current_code: code }, active.session)).status).toBe(400);
    const rotated = await command<MfaCodesResponse>(db, "recovery-codes", { expected_factor_version: 1, current_password: password, current_code: code }, active.session);
    expect(rotated.data.recovery_codes).not.toEqual(active.data.recovery_codes);
    expect((await call(db, "/api/auth/mfa/recover", { current_password: password, recovery_code: active.data.recovery_codes[0] }, rotated.session)).status).toBe(400);
    const disabled = await command(db, "disable", { expected_factor_version: 1, current_password: password, current_code: await nextCode(active.secret) }, rotated.session);
    expect(disabled.data.status).toMatchObject({ enrolled: false, factor_version: 2, recovery_codes_remaining: 0, verified_until: null });
    expect(await allowed(db, disabled.session, "required")).toBe(false);
  });
  it("locks repeated failures per account across changing sessions and never leaks entered secrets to events", async () => {
    const { db, session } = await world(); const begin = await enrollment(db, session);
    for (let index = 0; index < 5; index++) {
      const another = await makeSession(db, "mfa-admin");
      expect((await call(db, "/api/auth/mfa/enroll", { current_password: "wrong", expected_factor_version: 0 }, another)).status).toBe(400);
    }
    expect((await call(db, "/api/auth/mfa/enroll", { current_password: password, expected_factor_version: 0 }, begin.session)).status).toBe(429);
    const history = JSON.stringify(await db.prepare("SELECT * FROM auth_mfa_events").all());
    expect(history).not.toContain(password); expect(history).not.toContain(begin.data.enrollment.secret); expect(history).not.toContain("wrong");
  });
  it("pins the captured bearer and rolls back business mutations when assurance is revoked after preflight", async () => {
    const { db, session } = await world(); const active = await enroll(db, session);
    const auth = await getAuth(db, authedRequest("/", undefined, { session: active.session }), "hr_session");
    const guarded = withMfaMutationGuard(db, auth!);
    await db.prepare("DELETE FROM auth_mfa_session_assurance").run();
    await expect(guarded.batch([
      guarded.prepare("INSERT INTO horses(id,name_latin) VALUES(148001,'Should roll back')"),
      guarded.prepare("INSERT INTO audit_events(action,entity_type,entity_id) VALUES('mfa-test','horse','148001')"),
    ])).rejects.toMatchObject({ code: "mfa_step_up_required" });
    expect(await db.prepare("SELECT id FROM horses WHERE id=148001").first()).toBeNull();
    expect(await db.prepare("SELECT id FROM auth_mfa_commit_checks").first()).toBeNull();
  });
  it("protects run, all and RETURNING-first mutations without changing result positions", async () => {
    const { db, session } = await world(); const active = await enroll(db, session);
    const auth = await getAuth(db, authedRequest("/", undefined, { session: active.session }), "hr_session");
    const guarded = withMfaMutationGuard(db, auth!);
    expect(await guarded.prepare("INSERT INTO horses(id,name_latin) VALUES(148002,'Returning') RETURNING id").first("id")).toBe(148002);
    const results = await guarded.batch([guarded.prepare("UPDATE horses SET name_latin='Updated' WHERE id=148002"), guarded.prepare("SELECT name_latin FROM horses WHERE id=148002")]);
    expect(results).toHaveLength(2); expect(results[1]!.results[0]).toMatchObject({ name_latin: "Updated" });
    await db.prepare("UPDATE sessions SET token_hash='rotated-outside-request' WHERE id=?").bind(auth!.sessionId).run();
    await expect(guarded.prepare("UPDATE horses SET name_latin='Stale bearer' WHERE id=148002 RETURNING id").all()).rejects.toMatchObject({ code: "mfa_step_up_required" });
    expect(await db.prepare("SELECT name_latin FROM horses WHERE id=148002").first("name_latin")).toBe("Updated");
  });
  it("rechecks assurance in the actual privileged read transaction", async () => {
    const { db, session } = await world(); const active = await enroll(db, session);
    const auth = await getAuth(db, authedRequest("/", undefined, { session: active.session }), "hr_session");
    const guarded = withMfaMutationGuard(db, auth!, true);
    await db.prepare("DELETE FROM auth_mfa_session_assurance").run();
    await expect(guarded.prepare("SELECT email FROM users WHERE id='mfa-admin'").first()).rejects.toMatchObject({ code: "mfa_step_up_required" });
    expect(await db.prepare("SELECT id FROM auth_mfa_commit_checks").first()).toBeNull();
  });
  it("password reset revokes sessions while preserving the enrolled factor", async () => {
    const { db, session } = await world(); const active = await enroll(db, session);
    const token = "synthetic-reset-token-with-sufficient-length-r148";
    await db.prepare("INSERT INTO email_verifications(id,user_id,token_hash,purpose,expires_at) VALUES('mfa-reset','mfa-admin',?,'password_reset',datetime('now','+30 minutes'))").bind(await mfaHash(token)).run();
    const reset = await call(db, "/api/auth/recover/confirm", { token, new_password: "Changed synthetic password 148!" });
    expect(reset.status).toBe(200);
    expect(await db.prepare("SELECT factor_version FROM auth_mfa_factors WHERE user_id='mfa-admin'").first("factor_version")).toBe(1);
    expect(await allowed(db, active.session)).toBe(false);
    expect(await allowed(db, await makeSession(db, "mfa-admin"))).toBe(false);
  });
});
