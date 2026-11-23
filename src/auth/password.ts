const encoder = new TextEncoder();

function bytesToBase64UrlSafe(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * PBKDF2-SHA256 encoding, 100_000 iterations — deliberately equal to the
 * Workers runtime cap (see verifyPassword). T13 doctrine: benchmarked, not
 * blindly raised; a versioned migration would move the iteration count via
 * the `$iterations$` field already carried in the encoding.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return `pbkdf2-sha256$100000$${bytesToBase64UrlSafe(salt)}$${bytesToBase64UrlSafe(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  // The Workers runtime rejects PBKDF2 iteration counts above 100_000 with
  // NotSupportedError. Treat anything outside [100_000, 100_000] as an
  // unsupported hash and fail closed with `false` (controlled 401) instead of
  // an unhandled 500 - a hash the runtime can never verify is not a valid
  // credential. Keep this equal to the runtime cap; see tools/make_admin.py.
  if (!Number.isSafeInteger(iterations) || iterations !== 100_000) return false;

  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(parts[2]!);
    expected = base64ToBytes(parts[3]!);
  } catch {
    return false;
  }
  if (salt.length < 12 || expected.length !== 32) return false;

  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  let bits: ArrayBuffer;
  try {
    bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      expected.length * 8,
    );
  } catch {
    // Any runtime crypto failure (unsupported parameters, malformed key) must
    // degrade to a controlled authentication failure, not an unhandled 500.
    return false;
  }
  return timingSafeEqual(new Uint8Array(bits), expected);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
