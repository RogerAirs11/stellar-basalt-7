/**
 * Shared media-proxy host allowlist and URL helpers (worker + web, zero imports).
 *
 * Why a proxy at all: article cover photos reference Wikimedia Commons URLs, but
 * the deployed worker enforces a strict Content-Security-Policy
 * (img-src 'self' data: blob:) and some visitors cannot reach Wikimedia hosts
 * directly from their network. Routing allowlisted images through
 * /api/media/proxy keeps the strict CSP intact AND makes covers load for every
 * visitor: the fetch happens from Cloudflare's edge (with edge caching), and the
 * browser only ever talks to this origin.
 *
 * This module must stay dependency-free — it is imported by both the worker
 * route handler and the browser bundles.
 */

/** Hosts that may be proxied. Wikimedia serves all article cover imagery today. */
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org"]);
const ALLOWED_HOST_SUFFIXES = [".wikimedia.org", ".wikipedia.org"] as const;

export const MEDIA_PROXY_PATH = "/api/media/proxy";
export const MEDIA_PROXY_MAX_URL_LENGTH = 2048;
export const MEDIA_PROXY_CACHE_SECONDS = 86_400;

/** Parse + validate an external image URL against the allowlist. Returns null when not proxyable. */
export function parseProxyableImageUrl(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > MEDIA_PROXY_MAX_URL_LENGTH) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host) && !ALLOWED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) return null;
  return parsed;
}

/** Type guard: is this URL allowlisted for the same-origin media proxy? */
export function proxyableImageUrl(raw: string | null | undefined): raw is string {
  return parseProxyableImageUrl(raw) !== null;
}

/** Build the same-origin proxy URL for an allowlisted external image URL. */
export function proxiedMediaUrl(raw: string): string {
  return `${MEDIA_PROXY_PATH}?u=${encodeURIComponent(raw)}`;
}
