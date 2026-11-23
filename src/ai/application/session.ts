const AI_COOKIE = "horse_ai_session";

export async function aiOwnerIdentity(request: Request, env: Env): Promise<{ ownerKey: string; setCookie?: string }> {
  // Authenticated users receive a stable user-scoped owner key without exposing their identity to providers.
  try {
    const { getAuth } = await import("../../auth/session");
    const auth = await getAuth(env.AUTH_DB ?? env.DB, request, env.SESSION_COOKIE_NAME);
    if (auth) return { ownerKey: `user:${auth.user.id}` };
  } catch {
    // Public assistant must still work if optional authentication lookup is unavailable.
  }

  const existing = readCookie(request.headers.get("cookie"), AI_COOKIE);
  if (existing && /^[a-zA-Z0-9_-]{20,160}$/.test(existing)) return { ownerKey: `anon:${await sha256(existing)}` };
  const token = randomToken(32);
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const cookie = `${AI_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`;
  return { ownerKey: `anon:${await sha256(token)}`, setCookie: cookie };
}

export function pseudonymousProviderUserId(ownerKey: string): Promise<string> {
  return sha256(`horse-db-ai:${ownerKey}`);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const piece of header.split(";")) {
    const index = piece.indexOf("=");
    if (index < 0 || piece.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(piece.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function randomToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
