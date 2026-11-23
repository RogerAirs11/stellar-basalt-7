import { framePolicyForPath } from "./framePolicy";

export function withSecurityHeaders(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const production = env.APP_ENV === "production";
  headers.set("x-content-type-options", "nosniff");
  // Route-level privacy may be stricter than the default for static pages.
  if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  const framePolicy = framePolicyForPath(new URL(request.url).pathname);
  headers.set("x-frame-options", framePolicy.xFrameOptions);
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set(
    "content-security-policy",
    production
      ? `default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://fastly.jsdelivr.net https://raw.githubusercontent.com https://threejs.org; object-src 'none'; base-uri 'self'; frame-ancestors ${framePolicy.frameAncestors}; form-action 'self'`
      : `default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://fastly.jsdelivr.net https://raw.githubusercontent.com https://threejs.org ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors ${framePolicy.frameAncestors}; form-action 'self'`,
  );
  if (production && new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/admin") || path === "/demo-workbench" || path.startsWith("/demo-workbench/") || path === "/business-model" || path.startsWith("/business-model/")) headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
