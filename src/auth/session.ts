import { safeErrorCategory } from "../security/logging";
import type { PublicUser, UserRow } from "../db/types";
import { parseUtcTimestamp } from "../shared/utcTimestamp";
import { mfaPolicyForDatabase } from "./mfaGuard";

const encoder = new TextEncoder();
const SESSION_HOURS = 12;

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  /** Internal authorization binding. Never include in an HTTP user DTO. */
  sessionTokenHash?: string;
  mfaPolicy?: import("../contracts/mfa").MfaPolicy;
  user: PublicUser;
}

export async function createSession(db: D1Database, userId: string, request: Request): Promise<{ token: string; csrfToken: string; expiresAt: string }> {
  await db.prepare("DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP LIMIT 100)").run();
  const id = crypto.randomUUID();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60_000).toISOString();
  const tokenHash = await sha256Hex(token);
  const userAgentHash = await optionalHash(request.headers.get("user-agent"));
  const ipPrefixHash = await optionalHash(clientNetworkPrefix(request));

  await db.prepare(`
    INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,user_agent_hash,ip_prefix_hash)
    VALUES(?,?,?,?,?,?,?)
  `).bind(id, userId, tokenHash, csrfToken, expiresAt, userAgentHash, ipPrefixHash).run();
  return { token, csrfToken, expiresAt };
}

export async function getAuth(db: D1Database, request: Request, cookieName: string): Promise<AuthContext | null> {
  const token = getCookie(request.headers.get("cookie"), cookieName);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`
    SELECT s.id AS session_id,s.csrf_token,s.expires_at,s.last_seen_at,
           u.id,u.email,u.display_name,u.role,u.is_active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND datetime(s.expires_at)>CURRENT_TIMESTAMP AND u.is_active=1
  `).bind(tokenHash).first<{
    session_id: string; csrf_token: string; expires_at: string; last_seen_at: string;
    id: string; email: string; display_name: string; role: PublicUser["role"]; is_active: number;
  }>();
  if (!row) return null;

  // Activity tracking is non-critical and write-throttled for D1 Free. Authorization never depends on this update.
  const lastSeenMs = parseUtcTimestamp(row.last_seen_at);
  if (lastSeenMs === null || Date.now() - lastSeenMs >= 60 * 60_000) {
    try {
      await db.prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=? AND last_seen_at < datetime('now','-60 minutes')").bind(row.session_id).run();
    } catch (cause) {
      console.warn("Session activity update failed", { errorType: safeErrorCategory(cause) });
    }
  }
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    sessionTokenHash: tokenHash,
    mfaPolicy: mfaPolicyForDatabase(db),
    user: { id: row.id, email: row.email, display_name: row.display_name, role: row.role },
  };
}

export function sessionCookie(name: string, token: string, expiresAt: string, secure: boolean): string {
  return serializeCookie(name, token, {
    path: "/", httpOnly: true, secure, sameSite: "Strict", expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { path: "/", httpOnly: true, secure, sameSite: "Strict", expires: new Date(0), maxAge: 0 });
}

export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

export function readSessionToken(request: Request, cookieName: string): string | null {
  return getCookie(request.headers.get("cookie"), cookieName);
}

function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function serializeCookie(name: string, value: string, options: { path: string; httpOnly: boolean; secure: boolean; sameSite: "Strict"; expires: Date; maxAge?: number }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `Expires=${options.expires.toUTCString()}`, `SameSite=${options.sameSite}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function randomToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function optionalHash(value: string | null): Promise<string | null> {
  return value ? sha256Hex(value) : null;
}

function clientNetworkPrefix(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return null;
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".");
  return ip.split(":").slice(0, 4).join(":");
}
