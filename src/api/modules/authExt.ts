import { z } from "zod";
import { HttpError, json, readJson, readTextBody } from "../http";
import { createSession, sessionCookie, isSecureRequest } from "../../auth/session";
import { capabilitiesForRole } from "../../auth/capabilities";
import { hashPassword } from "../../auth/password";
import { CLAIM_OTP_ATTEMPT_SQL, isProductionAuth, normalizeAuthDigits, normalizeIranianPhone, requireDemoOtpEnvironment } from "../../auth/publicAuthPolicy";
import { getSmsProvider } from "../../notifications/sms";
import { getEmailProvider, emailMessageFor, emailActionUrl } from "../../notifications/email";
import { outboxStatement, outboxEventKey, maskRecipient } from "../../notifications/outbox";
import type { D1Database } from "@cloudflare/workers-types";

export { normalizeIranianPhone } from "../../auth/publicAuthPolicy";
export { hashPassword } from "../../auth/password";

// Public self-registration (client requirement: ورود/ثبت‌نام + SMS).
// Passwords use the same PBKDF2-SHA256 encoding the staff bootstrap uses.
// Email verification + SMS OTP have a demo mode: without provider credentials
// the token/code is returned in the API response (and logged) instead of being
// sent, so the full flow is demonstrable end-to-end. In production, wiring a
// provider (SMTP / Kavenegar) replaces only the delivery step.

const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(512),
  display_name: z.string().trim().min(2).max(120),
  role: z.enum(["user", "owner"]).default("user"),
});

const VerifyEmailSchema = z.object({ token: z.string().trim().min(20).max(200) });

const OtpRequestSchema = z.object({ phone: z.string().trim().min(8).max(24) });

const OtpVerifySchema = z.object({
  phone: z.string().trim().min(8).max(24),
  code: z.string().trim().regex(/^[0-9\u06f0-\u06f9\u0660-\u0669]{6}$/),
  display_name: z.string().trim().min(2).max(120).optional(),
});

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const bits = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * R59 (review fact-check #20): OTP codes are stored under a KEYED hash. A plain
 * sha256(phone:code) is brute-forceable in ~10^6 tries if the database leaks;
 * HMAC-SHA256 with a server-side secret makes offline guessing useless.
 * OTP_HASH_SECRET is a worker secret; without it (local dev) the legacy plain
 * hash keeps flows working.
 */
async function otpCodeHash(phone: string, code: string, env?: unknown): Promise<string> {
  const secret = (env as { OTP_HASH_SECRET?: string } | undefined)?.OTP_HASH_SECRET;
  if (!secret) {
    if (isProductionAuth(env)) throw new HttpError(503, "otp_unavailable", "SMS sign-in is not configured");
    return sha256Hex(`${phone}:${code}`);
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`otp:${phone}:${code}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


function publicUser(user: Record<string, unknown>) {
  return { id: user.id as string, email: user.email as string, display_name: user.display_name as string, role: user.role as string };
}

function sessionResponse(env: { SESSION_COOKIE_NAME: string }, user: Record<string, unknown>, session: { token: string; csrfToken: string; expiresAt: string }, request: Request, extra?: Record<string, unknown>) {
  const role = (["user", "owner", "editor", "admin", "super_admin"].includes(String(user.role)) ? user.role : "user") as "user" | "owner" | "editor" | "admin" | "super_admin";
  const response = json({ user: publicUser(user), csrfToken: session.csrfToken, permissions: capabilitiesForRole(role), ...extra });
  response.headers.append("set-cookie", sessionCookie(env.SESSION_COOKIE_NAME, session.token, session.expiresAt, isSecureRequest(request)));
  return response;
}

export async function register(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string; AI_DEMO_MODE?: string }): Promise<Response> {
  const parsed = RegisterSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_registration", "Registration failed validation", parsed.error.flatten());
  const d = parsed.data;
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(d.email).first();
  if (existing) throw new HttpError(409, "email_taken", "An account with this email already exists");
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(d.password);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users(id,email,display_name,password_hash,role,is_active,registration_source)
      VALUES(?,?,?,?,?, 1, 'public_signup')
    `).bind(id, d.email, d.display_name, passwordHash, d.role),
  ]);
  // Email verification token. Delivery: owner-configured provider sends the
  // real link; otherwise dev keeps the demo surfacing and production reports
  // honest unavailability (the token never leaks in a production response).
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  // P13 transactional-outbox doctrine: the outbox event lands in the SAME
  // batch as the verification-token insert. If this batch rolls back, no
  // outbox row exists and no message can ever be emitted for it.
  const verificationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO email_verifications(id,user_id,token_hash,purpose,expires_at) VALUES(?,?,?,?,?)")
      .bind(verificationId, id, tokenHash, "signup", expires),
    outboxStatement(env.DB, {
      eventKey: outboxEventKey("signup_verification", verificationId),
      channel: "email",
      purpose: "signup_verification",
      recipientUserId: id,
      recipientMasked: maskRecipient("email", d.email),
      payloadRef: `email_verifications:${verificationId}`,
    }),
  ]);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<Record<string, unknown>>();
  const session = await createSession(env.DB, id, request);
  await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  // R59 (review fact-check #22): the raw verification URL must not leak in
  // production responses (whoever sees the response — logs, proxies, a shared
  // screen — can verify the account). Dev keeps the demo surfacing.
  const isProduction = isProductionAuth(env);
  const emailProvider = getEmailProvider(env);
  const verifyUrl = emailActionUrl(env, `/api/auth/verify-email?token=${token}`);
  let emailDelivery: "provider_accepted" | "unavailable" = "unavailable";
  if (emailProvider && verifyUrl && user?.email) {
    const result = await emailProvider.send(emailMessageFor("signup_verification", String(user.email), verifyUrl));
    if (result.accepted) {
      emailDelivery = "provider_accepted";
      // The row was enqueued 'queued' in the same batch as the token; the
      // request itself just performed the send, so record the honest outcome
      // now — a later drain pass must not send a second verification email.
      await env.DB.prepare(`
        UPDATE notification_outbox
        SET status='provider_accepted', provider_message_id=?, provider_name=?, provider_accepted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE event_key=? AND status='queued'
      `).bind(result.providerMessageId ?? null, emailProvider.name, outboxEventKey("signup_verification", verificationId)).run();
    } else {
      console.warn("signup verification email provider rejected the message", result.failure);
    }
  }
  return sessionResponse(env, user ?? { id, email: d.email, display_name: d.display_name, role: d.role }, session, request, {
    emailVerification: isProduction
      ? emailDelivery === "provider_accepted"
        ? { required: true, expiresInHours: 48, delivery: "provider_accepted", notice: "A verification link has been handed to the email provider. Provider acceptance is not yet delivery confirmation." }
        : { required: true, expiresInHours: 48, delivery: "unavailable", demoNotice: "Email delivery is not configured; no verification email has been sent. This account remains unverified." }
      : { required: true, expiresInHours: 48, demoTokenUrl: `/api/auth/verify-email?token=${token}`, demoNotice: "Email delivery is not configured in this demo — use the verification link below." },
  });
}

export async function verifyEmail(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    // R59 (review fact-check #23): the GET link no longer consumes the token —
    // mail-scanner prefetches were burning single-use tokens. The link renders
    // an explicit confirmation form; the actual consumption happens on POST.
    const token = url.searchParams.get("token") ?? "";
    if (!/^[A-Za-z0-9]{16,128}$/.test(token)) {
      return new Response(verificationPage(false, env), {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 400,
      });
    }
    const page = `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>تأیید ایمیل…</title><style>body{font-family:system-ui,sans-serif;background:#11150c;color:#e8e4d4;display:grid;place-items:center;min-height:100vh;margin:0}</style></head><body><noscript><p>برای تکمیل تأیید، درخواست POST را تأیید کنید / confirm the POST request to verify.</p></noscript><form method="POST" action="/api/auth/verify-email"><input type="hidden" name="token" value="${token.replace(/"/g, "&quot;")}"><button type="submit" style="padding:12px 22px;border-radius:10px;border:1px solid #4a4a33;background:#1d2214;color:#e8e4d4;font-size:15px;cursor:pointer">تأیید ایمیل / Verify email</button></form></body></html>`;
    return new Response(page, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }
  const parsed = VerifyEmailSchema.safeParse(await readJsonFormOrBody(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_token", "Token failed validation");
  const done = await consumeEmailToken(env.DB, parsed.data.token);
  if (!done) throw new HttpError(400, "invalid_token", "Verification token is invalid or expired");
  return json({ verified: true });
}

async function readJsonFormOrBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await readTextBody(request, maxBytes));
    return { token: form.get("token") ?? "" };
  }
  return readJson<unknown>(request, maxBytes);
}

/**
 * T13 / packet finding F17: compare-and-set consumption. ONE conditional
 * UPDATE claims and consumes the token atomically — concurrent double-clicks,
 * prefetchers and replays cannot both win (the loser's UPDATE matches zero
 * rows). Scope is signup verification only; password-reset tokens are
 * consumed exclusively by their own endpoint with the same CAS doctrine.
 */
export const CLAIM_EMAIL_VERIFICATION_SQL = `
  UPDATE email_verifications
  SET consumed_at=CURRENT_TIMESTAMP
  WHERE token_hash=? AND purpose='signup'
    AND consumed_at IS NULL
    AND datetime(expires_at)>datetime('now')
  RETURNING user_id
`;

async function consumeEmailToken(db: D1Database, token: string): Promise<boolean> {
  const tokenHash = await sha256Hex(token);
  const claimed = await db.prepare(CLAIM_EMAIL_VERIFICATION_SQL).bind(tokenHash).first<{ user_id: string }>();
  if (!claimed) return false;
  await db.prepare("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?").bind(claimed.user_id).run();
  return true;
}

function verificationPage(success: boolean, env: { SESSION_COOKIE_NAME: string }): string {
  const title = success ? "ایمیل تأیید شد ✓" : "لینک نامعتبر است";
  const body = success
    ? "<p>حساب کاربری شما تأیید شد. می‌توانید به سامانه برگردید و وارد شوید.</p>"
    : "<p>این لینک منقضی شده یا نامعتبر است. لطفاً دوباره درخواست تأیید بدهید.</p>";
  void env;
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#11150c;color:#e8e4d4;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:420px;padding:40px;border:1px solid #4a4a33;border-radius:14px;background:#191d12;text-align:center}h1{font-size:1.4rem}a{color:#d9b24c}</style></head><body><main><h1>${title}</h1>${body}<p><a href="/">← سامانه ثبت اسب ایران</a></p></main></body></html>`;
}

export async function requestOtp(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  // T13: with an owner-configured provider, production OTP is REALLY delivered.
  // Without one, production keeps the honest 503 (requireDemoOtpEnvironment)
  // and local dev keeps the demo surfacing. Credentials alone never fabricate
  // a "sent" — the provider call below must actually succeed.
  const smsProvider = getSmsProvider(env);
  if (!smsProvider) requireDemoOtpEnvironment(env);
  const parsed = OtpRequestSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_phone", "Phone failed validation");
  const phone = normalizeIranianPhone(parsed.data.phone);
  if (!phone) throw new HttpError(400, "invalid_phone", "Enter a valid mobile number (e.g. 09121234567)");
  // Basic abuse limit: at most 3 outstanding challenges per number per 10 minutes.
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sms_otp_challenges WHERE phone_e164=? AND created_at > datetime('now','-10 minutes')"
  ).bind(phone).first<{ n: number }>();
  if (Number(recent?.n ?? 0) >= 3) throw new HttpError(429, "otp_throttled", "Too many codes requested; try again in a few minutes");
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const codeHash = await otpCodeHash(phone, code, env);
  // Delivery happens BEFORE the challenge row lands: a provider outage leaves
  // no dead challenges behind and the user can retry without hitting the
  // outstanding-challenge limit.
  let delivery: "provider_accepted" | "demo" = "demo";
  let providerMessageId: string | undefined;
  if (smsProvider) {
    const result = await smsProvider.deliverOtp(phone, code);
    if (!result.accepted) {
      throw new HttpError(503, "sms_delivery_failed", "SMS delivery is temporarily unavailable; please try again in a few minutes");
    }
    delivery = "provider_accepted";
    providerMessageId = result.providerMessageId;
  }
  // P13: the OTP outbox event lands in the SAME batch as the challenge row,
  // recording the ACTUAL synchronous outcome (never 'queued' — a later drain
  // pass must not re-send an OTP the request already delivered). The row
  // stores only the MASKED number and a pointer to the challenge — never the
  // code, never the full number, never a body.
  const challengeId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sms_otp_challenges(id,phone_e164,code_hash,purpose,expires_at) VALUES(?,?,?,?,?)")
      .bind(challengeId, phone, codeHash, "login", new Date(Date.now() + 5 * 60 * 1000).toISOString()),
    outboxStatement(env.DB, {
      eventKey: outboxEventKey("login_otp", challengeId),
      channel: "sms",
      purpose: "login_otp",
      recipientUserId: null,
      recipientMasked: maskRecipient("sms", phone),
      payloadRef: `sms_otp_challenges:${challengeId}`,
      status: delivery === "provider_accepted" ? "provider_accepted" : "queued",
      providerMessageId: providerMessageId ?? null,
      providerName: smsProvider?.name ?? null,
    }),
  ]);
  // R59: no demo OTP is ever included in a production response — one 6-digit
  // code equals full account takeover. Only explicit local modes surface it.
  const isProduction = isProductionAuth(env);
  return json({
    sent: true,
    delivery,
    demoMode: !isProduction && delivery === "demo",
    ...(!isProduction && delivery === "demo" ? { demoCode: code } : {}),
    ...(!isProduction && delivery === "demo"
      ? { demoNotice: "SMS delivery is not configured in this demo — the code is shown here and not sent by an SMS provider." }
      : { notice: "The code has been handed to the SMS provider. Provider acceptance is not yet delivery confirmation." }),
    expiresInMinutes: 5,
  });
}

export async function verifyOtp(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  // Symmetric with requestOtp: real delivery implies real verification; without
  // a provider, production stays honestly closed and dev keeps the demo flow.
  if (!getSmsProvider(env)) requireDemoOtpEnvironment(env);
  const parsed = OtpVerifySchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_otp", "OTP failed validation");
  const phone = normalizeIranianPhone(parsed.data.phone);
  if (!phone) throw new HttpError(400, "invalid_phone", "Enter a valid mobile number");
  const challenge = await env.DB.prepare(
    "SELECT id,code_hash,attempts FROM sms_otp_challenges WHERE phone_e164=? AND consumed_at IS NULL AND datetime(expires_at)>datetime('now') ORDER BY created_at DESC LIMIT 1"
  ).bind(phone).first<{ id: string; code_hash: string; attempts: number }>();
  if (!challenge) throw new HttpError(400, "otp_expired", "No active code; request a new one");
  const codeHash = await otpCodeHash(phone, normalizeAuthDigits(parsed.data.code), env);
  const claimed = await env.DB.prepare(CLAIM_OTP_ATTEMPT_SQL).bind(codeHash, challenge.id).first<{ code_hash: string }>();
  if (!claimed) throw new HttpError(400, "otp_expired", "Code is expired, already used, or locked; request a new one");
  if (claimed.code_hash !== codeHash) throw new HttpError(400, "otp_invalid", "Incorrect code");
  // Find or create the account bound to this phone.
  let user = await env.DB.prepare(`
    SELECT u.* FROM users u JOIN phone_identities p ON p.user_id=u.id WHERE p.phone_e164=? AND p.verified_at IS NOT NULL
  `).bind(phone).first<Record<string, unknown>>();
  if (!user) {
    const id = crypto.randomUUID();
    const displayName = parsed.data.display_name?.trim() || `کاربر ${phone.slice(-4)}`;
    const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users(id,email,display_name,password_hash,role,is_active,registration_source,display_phone)
        VALUES(?,?,?,?, 'user', 1, 'sms_signup', ?)
      `).bind(id, `sms-${phone.replace(/\+/g, "")}@horse-db.local`, displayName, passwordHash, phone),
      env.DB.prepare("INSERT INTO phone_identities(user_id,phone_e164,verified_at) VALUES(?,?,CURRENT_TIMESTAMP)").bind(id, phone),
    ]);
    user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<Record<string, unknown>>();
  }
  if (!user || Number(user.is_active ?? 1) !== 1) throw new HttpError(403, "account_disabled", "This account is disabled");
  const session = await createSession(env.DB, user.id as string, request);
  await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id as string).run();
  return sessionResponse(env, user, session, request, { method: "sms_otp" });
}
