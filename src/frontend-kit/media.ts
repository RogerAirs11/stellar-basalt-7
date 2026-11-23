/**
 * Browser-side external media resolver (frontend-kit presentation helper).
 *
 * Kit home (R53): `resolveExternalImage` originally lived in `src/web/externalMedia.ts`,
 * but external frontends may only import their own files or this kit root. The
 * allowlist/proxy logic itself is dependency-free and lives in `contracts/media`
 * (shared by the worker route handler and the browser bundles) — this module is
 * the browser-facing wrapper every frontend is supposed to consume.
 */
import { proxiedMediaUrl, proxyableImageUrl } from "../contracts/media";

export function resolveExternalImage(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return proxyableImageUrl(raw) ? proxiedMediaUrl(raw) : raw;
}
