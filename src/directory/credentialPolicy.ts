import { timestampMillis } from "../security/timestamps";
/** Date-only credential intervals are inclusive calendar days in UTC for
 * display. They are not a legal determination of licensing or qualification. */
export function credentialDay(value: unknown): number | null {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    return timestampMillis(`${value}T00:00:00Z`);
}
export type CredentialPeriod = "dates_not_recorded" | "within_recorded_dates" | "not_yet_valid" | "expired" | "revoked" | "invalid_dates";
export function credentialPeriod(record: {
    issued_at?: unknown;
    expires_at?: unknown;
    revoked_at?: unknown;
}, now = Date.now()): CredentialPeriod {
    if (record.revoked_at != null)
        return "revoked";
    const start = record.issued_at == null ? null : credentialDay(record.issued_at);
    const end = record.expires_at == null ? null : credentialDay(record.expires_at);
    if (!Number.isFinite(now) || (record.issued_at != null && start === null)
        || (record.expires_at != null && end === null) || (start !== null && end !== null && end < start))
        return "invalid_dates";
    if (start === null && end === null)
        return "dates_not_recorded";
    if (start !== null && start > now)
        return "not_yet_valid";
    if (end !== null && now >= end + 86400000)
        return "expired";
    return "within_recorded_dates";
}
