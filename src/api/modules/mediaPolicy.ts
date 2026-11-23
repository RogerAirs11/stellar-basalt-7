import { HttpError } from "../http";
import { sanitizeImage, SANITIZED_IMAGE_MIMES } from "./mediaImageHygiene";
import type { PrivacyViewer } from "../../privacy/policy";

export interface MediaVisibilityRecord {
  media_type: string;
  mime_type?: string;
  role: string;
  verification: string;
  consent_state?: string;
  quarantined_at?: string | null;
  quarantine_reason?: string | null;
  uploaded_by_user_id?: string | null;
}
export interface MediaViewer extends PrivacyViewer {}
export const MEDIA_PRIVATE_READER_ROLES = ["admin", "super_admin"] as const;
export const PUBLIC_MEDIA_REVIEW_STATES = ["federation_verified", "owner_submitted"] as const;

/** One purpose-specific rule for gallery metadata, counts, attestations and
 * bytes. Legacy owner_submitted is retained only with explicit consent; new
 * publications require platform review. Neither state is issuer attestation.
 * Documents, evidence roles, unknown formats and quarantine are never public. */
export function publicMediaPredicate(alias = ""): string {
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid media SQL alias");
  const p = alias ? `${alias}.` : "";
  return `${p}media_type='photo' AND ${p}role IN ('profile','gallery') AND ${p}consent_state='shared_public' AND ${p}verification IN ('federation_verified','owner_submitted') AND ${p}quarantined_at IS NULL AND ${p}quarantine_reason IS NULL AND ${p}mime_type IN ('image/jpeg','image/png','image/gif','image/webp')`;
}
export const PUBLIC_MEDIA_PREDICATE = publicMediaPredicate();

export function isPublicMedia(media: MediaVisibilityRecord): boolean {
  return media.media_type === "photo" && ["profile", "gallery"].includes(media.role)
    && media.consent_state === "shared_public"
    && (PUBLIC_MEDIA_REVIEW_STATES as readonly string[]).includes(media.verification)
    && media.quarantined_at == null && media.quarantine_reason == null
    && (SANITIZED_IMAGE_MIMES as readonly string[]).includes(media.mime_type ?? "");
}
export function canReadPrivateMedia(media: MediaVisibilityRecord, viewer?: MediaViewer | null): boolean {
  return Boolean(viewer && (viewer.user.id === media.uploaded_by_user_id
    || (MEDIA_PRIVATE_READER_ROLES as readonly string[]).includes(viewer.user.role)));
}
export function canReadMedia(media: MediaVisibilityRecord, viewer?: MediaViewer | null): boolean {
  return isPublicMedia(media) || canReadPrivateMedia(media, viewer);
}

export function decodeMediaBase64(value: string, maxBytes: number): Uint8Array {
  const clean = value.replace(/^data:[^;]+;base64,/, "");
  if (clean.length > Math.ceil(maxBytes / 3) * 4) throw new HttpError(413, "media_too_large", "File is too large");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)); }
  catch { throw new HttpError(400, "invalid_media", "File data is not valid base64"); }
  if (bytes.length > maxBytes) throw new HttpError(413, "media_too_large", "File is too large");
  return bytes;
}

/** Signature validation is a format check, NOT a malware scanner or full decoder. */
export function hasExpectedMediaSignature(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  switch (mime) {
    case "image/png": return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
    case "image/jpeg": return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/gif": return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case "image/avif": return ascii(4, 4) === "ftyp" && /avif|avis/.test(ascii(8, Math.min(bytes.length - 8, 248)));
    case "application/pdf": return ascii(0, 5) === "%PDF-";
    default: return false;
  }
}

/** ASCII-safe HTTP header plus RFC 5987 Unicode filename; blocks CR/LF and path segments. */
export function mediaContentDisposition(fileName: string, attachment: boolean): string {
  const clean = Array.from(fileName.replace(/[\u0000-\u001f\u007f/\\]/g, "_")).slice(0, 240)
    .map((char) => /^[\uD800-\uDFFF]$/.test(char) ? "\uFFFD" : char).join("") || "download";
  const fallback = clean.replace(/[^\x20-\x7e]|[";]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${attachment ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// ---------------------------------------------------------------------------
// R88 agent plan P09: quarantine-grade upload hygiene.
// ---------------------------------------------------------------------------

/** Sanitize recognized containers or reject the image. AVIF stays disabled
 * until a decoder-backed, bounded metadata-removal path has its own tests. */
export const stripLocationMetadata = sanitizeImage;

/**
 * Reject files carrying ACTIVE CONTENT at the upload boundary:
 *  - PDF: /JavaScript, /JS, /OpenAction, /Launch, /EmbeddedFile, /SubmitForm
 *    (interactive/scriptable constructs — a registry evidence PDF does not
 *    need them).
 *  - Any image type: trailing bytes after the format's logical end marker
 *    (JPEG EOI / PNG IEND / GIF trailer) = polyglot smuggling attempt.
 * SVG and HTML are already impossible: they are not in the MIME allowlist
 * and no signature check passes for them.
 */
export function scanForActiveContent(bytes: Uint8Array, mime: string): { ok: true } | { ok: false; reason: string } {
  const text = () => new TextDecoder("latin1").decode(bytes);
  if (mime === "application/pdf") {
    const source = text();
    for (const needle of ["/JavaScript", "/JS", "/OpenAction", "/Launch", "/EmbeddedFile", "/SubmitForm", "/AA"]) {
      if (source.includes(needle)) return { ok: false, reason: `PDF contains an active-content construct (${needle})` };
    }
    return { ok: true };
  }
  const endsCleanly =
    mime === "image/jpeg" ? hasSuffix(bytes, [0xff, 0xd9])
    : mime === "image/png" ? hasSuffix(bytes, [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
    : mime === "image/gif" ? bytes[bytes.length - 1] === 0x3b
    : mime === "image/webp" ? bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) === bytes.length - 8
    : true; // The sanitizer separately validates every accepted image container.
  if (!endsCleanly) {
    return { ok: false, reason: "File carries trailing bytes after the image end marker (possible polyglot)" };
  }
  return { ok: true };
}

function hasSuffix(bytes: Uint8Array, suffix: number[]): boolean {
  if (bytes.length < suffix.length) return false;
  // JPEGs may legally end with padding after EOI; allow <= 16 trailing bytes
  // of 0x00/0xff padding but nothing else.
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x00 || bytes[end - 1] === 0xff) && bytes.length - end < 16) end -= 1;
  if (end < suffix.length) return false;
  for (let i = 0; i < suffix.length; i += 1) {
    if (bytes[end - suffix.length + i] !== suffix[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// R88 agent plan P09: short-lived signed access tokens.
// ---------------------------------------------------------------------------

export const MEDIA_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface MediaAccessClaims { mediaId: string; userId: string; grantId: string; expiresAtMs: number }
const GRANT_BINDING = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Version 2 binds one unpredictable grant, subject, object and exact expiry.
 * No role or authority is delegated: serving rechecks the current account. */
export async function signMediaAccessToken(mediaId: string, userId: string, grantId: string, expiresAtMs: number, secret: string): Promise<string> {
  if (!GRANT_BINDING.test(grantId) || !Number.isSafeInteger(expiresAtMs)) throw new Error("Invalid media grant binding");
  const payload = base64UrlEncode(JSON.stringify({ v: 2, m: mediaId, u: userId, g: grantId, e: expiresAtMs }));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Legacy unbound tokens intentionally fail closed at cutover. */
export async function verifyMediaAccessToken(token: string, secret: string, nowMs = Date.now()): Promise<MediaAccessClaims | null> {
  try {
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const [payload, signature] = token.split(".") as [string, string];
    const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), decode(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder().decode(decode(payload))) as Record<string, unknown>;
    if (value.v !== 2 || typeof value.m !== "string" || !value.m || value.m.length > 64
      || typeof value.u !== "string" || !value.u || value.u.length > 128
      || typeof value.g !== "string" || !GRANT_BINDING.test(value.g)
      || typeof value.e !== "number" || !Number.isSafeInteger(value.e) || !Number.isFinite(nowMs)
      || value.e <= nowMs || value.e > nowMs + MEDIA_ACCESS_TOKEN_TTL_SECONDS * 1000) return null;
    return { mediaId: value.m, userId: value.u, grantId: value.g, expiresAtMs: value.e };
  } catch {
    return null;
  }
}
