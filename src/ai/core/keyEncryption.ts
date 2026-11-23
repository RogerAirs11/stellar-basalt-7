/**
 * A19/B06: envelope encryption for admin-managed AI provider keys at rest.
 *
 * Storage format (inside the existing ai_provider_keys.api_key TEXT column,
 * identical on D1 and Postgres — deliberately DDL-free so no migration is
 * required and deploys never wait on a schema step):
 *
 *   enc:v1:<b64url nonce>:<b64url ciphertext+tag>
 *
 * - AES-256-GCM via WebCrypto (available in Workers and Node 22 alike).
 * - Key material: SHA-256(secret) — one 32-byte key per secret.
 * - Per-row random 12-byte nonce; the GCM tag detects tampering.
 * - Secrets come from AI_KEY_ENCRYPTION_SECRETS (comma/newline separated;
 *   the FIRST entry is the active key used for all new writes) or the single
 *   AI_KEY_ENCRYPTION_SECRET. Listing several secrets is the rotation path:
 *   keep the old secret listed until every row has been re-encrypted with
 *   POST /api/admin/ai/keys/rotate-encryption, then drop it.
 * - Rows that do not start with the envelope prefix are LEGACY PLAINTEXT.
 *   They still load (readable), are flagged as unencrypted in the admin
 *   listing, and are converted by the rotate-encryption endpoint.
 * - Writes fail closed when no secret is configured: registering a new key
 *   without an encryption secret is refused with a clear operator message,
 *   the same honest-unavailable posture as B04 OTP delivery.
 */

const ENVELOPE_PREFIX = "enc:v1:";
const SECRETS_MIN_LENGTH = 16;

export class KeyEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyEncryptionError";
  }
}

export interface EncryptionSecrets {
  /** All secrets usable for decryption, in listed order. */
  read: string[];
  /** The first listed secret — used for all new envelopes. */
  active: string | null;
}

export function readEncryptionSecrets(env: { AI_KEY_ENCRYPTION_SECRETS?: string; AI_KEY_ENCRYPTION_SECRET?: string }): EncryptionSecrets {
  const parse = (raw: string | undefined): string[] =>
    (raw ?? "")
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= SECRETS_MIN_LENGTH);
  const multi = parse(env.AI_KEY_ENCRYPTION_SECRETS);
  const single = parse(env.AI_KEY_ENCRYPTION_SECRET);
  const secrets = multi.length ? multi : single;
  return { read: secrets, active: secrets[0] ?? null };
}

export function encryptionAvailable(env: { AI_KEY_ENCRYPTION_SECRETS?: string; AI_KEY_ENCRYPTION_SECRET?: string }): boolean {
  return readEncryptionSecrets(env).active !== null;
}

export function isEnvelope(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`horse-db-ai-key-encryption:v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function encryptApiKey(activeSecret: string, plaintext: string): Promise<string> {
  if (!plaintext) throw new KeyEncryptionError("cannot encrypt an empty key");
  const key = await deriveKey(activeSecret);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext));
  return `${ENVELOPE_PREFIX}${toB64Url(nonce)}:${toB64Url(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt an envelope with any of the listed secrets. AES-GCM authentication
 * failure means the secret set is wrong for that row — surfaced as a
 * KeyEncryptionError, never as an empty key.
 */
export async function decryptEnvelope(secrets: string[], value: string): Promise<string> {
  if (!isEnvelope(value)) return value; // legacy plaintext row — readable, flagged by isEnvelope()
  const body = value.slice(ENVELOPE_PREFIX.length);
  const split = body.indexOf(":");
  if (split <= 0) throw new KeyEncryptionError("malformed key envelope (missing nonce segment)");
  const nonce = fromB64Url(body.slice(0, split));
  const ciphertext = fromB64Url(body.slice(split + 1));
  if (nonce.length !== 12) throw new KeyEncryptionError("malformed key envelope (bad nonce length)");
  let lastError: unknown = null;
  for (const secret of secrets) {
    try {
      const key = await deriveKey(secret);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
      return new TextDecoder().decode(plaintext);
    } catch (error) {
      lastError = error;
    }
  }
  throw new KeyEncryptionError(
    `stored AI key envelope could not be decrypted with any configured AI_KEY_ENCRYPTION_SECRET(S) entry (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`,
  );
}

/** Re-encrypt any row (legacy or envelope) under the active secret. */
export async function reencryptRow(activeSecret: string, secrets: string[], stored: string): Promise<string> {
  const plaintext = await decryptEnvelope(secrets, stored);
  return encryptApiKey(activeSecret, plaintext);
}
