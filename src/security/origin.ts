import { HttpError } from "../api/http";

/** Protect public writes too; authenticated writes additionally need their CSRF token. */
export function requireSameOriginMutation(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== new URL(request.url).origin) || site === "cross-site") {
    throw new HttpError(403, "origin_failed", "Cross-origin state-changing request rejected");
  }
}
