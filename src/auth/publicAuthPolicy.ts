import { HttpError } from "../api/http";

export function normalizeAuthDigits(value: string): string {
  return value.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, (ch) =>
    String(ch.charCodeAt(0) >= 0x06f0 ? ch.charCodeAt(0) - 0x06f0 : ch.charCodeAt(0) - 0x0660));
}

/** Iranian mobile numbers only; a future international provider needs its own policy. */
export function normalizeIranianPhone(input: string): string | null {
  const digits = normalizeAuthDigits(input).replace(/[\s\-()]/g, "");
  if (/^09\d{9}$/.test(digits)) return `+98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+98${digits}`;
  if (/^\+989\d{9}$/.test(digits)) return digits;
  if (/^00989\d{9}$/.test(digits)) return `+98${digits.slice(4)}`;
  return null;
}

/** Missing/unknown environment fails closed. Only explicit local modes may expose demo OTPs. */
export function isProductionAuth(env: unknown): boolean {
  const mode = (env as { APP_ENV?: string } | undefined)?.APP_ENV;
  return mode !== "development" && mode !== "test" && mode !== "local";
}

export function requireDemoOtpEnvironment(env: unknown): void {
  if (isProductionAuth(env)) {
    throw new HttpError(503, "sms_unavailable", "SMS sign-in is unavailable: delivery is not configured. Use email/password sign-in.");
  }
}

/** One UPDATE both spends an attempt and claims the success. Concurrent/replayed requests cannot both win. */
export const CLAIM_OTP_ATTEMPT_SQL = `
  UPDATE sms_otp_challenges
  SET attempts=attempts+1,
      consumed_at=CASE WHEN code_hash=? THEN CURRENT_TIMESTAMP ELSE consumed_at END
  WHERE id=? AND consumed_at IS NULL AND attempts<5
    AND datetime(expires_at)>datetime('now')
  RETURNING code_hash
`;

/** Zero-credential admin is an explicit local test convenience, never a production escape hatch. */
export function isDemoAdminLoginAvailable(env: unknown): boolean {
  const config = env as { APP_ENV?: string; ENABLE_DEMO_ADMIN_LOGIN?: string; REGISTRY_DATASET_KIND?: string; ISOLATED_DEMO_MODE?: string } | undefined;
  return config?.APP_ENV === "local" && config.ENABLE_DEMO_ADMIN_LOGIN === "1"
    && config.REGISTRY_DATASET_KIND === "synthetic" && config.ISOLATED_DEMO_MODE === "1";
}
