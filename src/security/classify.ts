import { HttpError } from "../api/http";

/**
 * Rate-limit classification shared by the Worker entrypoint (D08).
 *
 * Precedence (highest first):
 *   1. login            -> auth limiter (10/min/IP) + per-account login protection (D10)
 *   2. expensive routes -> expensive limiter (12/min)
 *   3. other state-changing methods -> dedicated write limiter (30/min/IP, D08)
 *   4. ordinary GET/HEAD/OPTIONS    -> public limiter (300/min)
 *
 * Mutation routes therefore never consume the 300/min public-read budget.
 */
export type RateLimitKind = "auth" | "expensive" | "write" | "public";

export function classifyApiRateLimit(path: string, method: string): RateLimitKind {
  if (path.startsWith("/api/auth/mfa/") && method.toUpperCase() !== "GET") return "auth";
  if ([
    "/api/auth/login",
    "/api/auth/demo-admin",
    "/api/auth/register",
    "/api/auth/otp/request",
    "/api/auth/otp/verify",
    "/api/auth/verify-email",
    // T13 recovery family: credential-adjacent, so the strict auth limiter
    // (10/min/IP) + per-account protection (D10) applies, not the write class.
    "/api/auth/recover/request",
    "/api/auth/recover/confirm",
    "/api/auth/change-password",
    "/api/auth/sessions/revoke",
  ].includes(path)) return "auth";
  if (isExpensiveApi(path)) return "expensive";
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return "public";
  return "write";
}

export function isExpensiveApi(path: string): boolean {
  return (path.startsWith("/api/ai/conversations/") && path.endsWith("/messages"))
    || path === "/api/admin/content/generate"
    || path.startsWith("/api/breeding/")
    || path === "/api/relationship"
    || path === "/api/relationship/coefficients"
    || path.includes("/pedigree")
    || path.includes("/insights");
}
