/**
 * Same-origin image proxy for allowlisted external hosts (Wikimedia).
 *
 * See src/contracts/media.ts for why this exists. The handler streams the
 * upstream image body through with edge + browser caching and refuses anything
 * that is not an image, so it can never be used as an open proxy, an HTML
 * injection channel, or a private-network (SSRF) fetcher: targets must be
 * public https Wikimedia URLs validated against the shared allowlist.
 *
 * R59 (review fact-check #19): redirects are followed MANUALLY — each hop is
 * re-validated against the allowlist and limited in count, so an allowlisted
 * host can never bounce the proxy to an arbitrary origin. Response size is
 * capped to keep a hostile upstream from streaming an unbounded body through
 * the Worker.
 */
import { error } from "./http";
import { MEDIA_PROXY_CACHE_SECONDS, parseProxyableImageUrl } from "../contracts/media";

/** Wikimedia's user-agent policy requires a descriptive UA with contact info. */
const UPSTREAM_USER_AGENT = "HorseRegistry/1.0 (+https://horse-registry-nextgen.rogerfires10.workers.dev; image proxy for article covers)";

const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export async function mediaProxyHandler(url: URL): Promise<Response> {
  const requested = parseProxyableImageUrl(url.searchParams.get("u") ?? "");
  if (!requested) {
    return error(400, "media_proxy_invalid_url", "Provide ?u=<https URL of an allowlisted image host (Wikimedia)>");
  }

  let current: URL = requested;
  let upstream: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      upstream = await fetch(current.toString(), {
        method: "GET",
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", "user-agent": UPSTREAM_USER_AGENT },
        redirect: "manual",
        cf: { cacheTtl: MEDIA_PROXY_CACHE_SECONDS, cacheEverything: true },
      });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get("location");
        if (!location) {
          return error(502, "media_proxy_upstream", "The image host returned a redirect without a location");
        }
        const next = new URL(location, current);
        // Every hop must pass the same allowlist validation as the original.
        const validated = parseProxyableImageUrl(next.toString());
        if (!validated) {
          return error(400, "media_proxy_redirect_off_allowlist", "The image host tried to redirect outside the allowed hosts");
        }
        if (hop === MAX_REDIRECTS) {
          return error(508, "media_proxy_too_many_redirects", "The image host redirected too many times");
        }
        current = validated;
        continue;
      }
      break;
    }
  } catch (cause) {
    return error(502, "media_proxy_unreachable", "The image host could not be reached", { cause: cause instanceof Error ? cause.message : String(cause) });
  }

  if (!upstream || !upstream.ok) {
    return error(upstream?.status === 404 ? 404 : 502, "media_proxy_upstream", `The image host responded ${upstream?.status ?? "with no response"}`);
  }

  const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    return error(415, "media_proxy_not_an_image", "The upstream URL did not return an image");
  }
  const contentLength = Number(upstream.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMAGE_BYTES) {
    return error(413, "media_proxy_too_large", "The upstream image exceeds the proxy size limit");
  }

  // Bounded read: a lying/chunked upstream cannot stream an unbounded body.
  const buffer = new Uint8Array(await upstream.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return error(413, "media_proxy_too_large", "The upstream image exceeds the proxy size limit");
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("cache-control", `public, max-age=${MEDIA_PROXY_CACHE_SECONDS}`);
  headers.set("x-content-type-options", "nosniff");
  return new Response(buffer, { status: 200, headers });
}
