/** Failover is an explicitly reviewed PUBLIC SNAPSHOT feature. A horse-data
 * revision does not establish freshness of sessions, consent, payments, grants,
 * leads or private workspaces. Those requests must use the authoritative DB.
 * New routes are denied until their read surface and replication are reviewed. */
const PUBLIC_SNAPSHOT_PATHS = new Set([
    "/api/search", "/api/search/meta", "/api/registry/facets",
    "/api/analytics/registry", "/api/quality/summary", "/api/relationship",
    "/api/relationship/coefficients",
]);
export function publicSnapshotReadEligible(request: Request, intent: string): boolean {
    if (intent !== "canonical_read" || !["GET", "HEAD"].includes(request.method.toUpperCase()))
        return false;
    if (["authorization", "cookie", "x-api-key"].some((name) => request.headers.has(name)))
        return false;
    const url = new URL(request.url);
    if (["token", "signature", "access_token"].some((key) => url.searchParams.has(key)))
        return false;
    return PUBLIC_SNAPSHOT_PATHS.has(url.pathname) || /^\/api\/horses\/[1-9]\d*\/pedigree$/.test(url.pathname);
}
