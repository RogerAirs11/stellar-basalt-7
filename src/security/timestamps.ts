/**
 * Parse persisted instants independently of server/browser timezone. Accept the
 * database's UTC CURRENT_TIMESTAMP format and offset-qualified ISO timestamps.
 * Invalid dates fail closed instead of Date.parse(NaN) accidentally authorizing.
 */
export function timestampMillis(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, , zone] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const normalized = value.replace(" ", "T") + (zone ? "" : "Z");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An absent expiry is unbounded; a malformed expiry is unusable, not immortal. */
export function isExpiredTimestamp(value: unknown, now = Date.now()): boolean {
  if (value === null || value === undefined) return false;
  const expiry = timestampMillis(value);
  return !Number.isFinite(now) || expiry === null || expiry <= now;
}
