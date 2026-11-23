import { describe, expect, it } from "vitest";
import { verifyPassword } from "../../src/auth/password";

/**
 * Cloudflare-only staging defect regression: the Workers runtime rejects PBKDF2
 * iteration counts above 100000 with NotSupportedError. A stored hash generated
 * with 310000 iterations used to crash login with an unhandled 500; verify must
 * fail CLOSED (false -> controlled 401) for unsupported parameters.
 */

async function encode(iterations: number, password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const SALT: Uint8Array<ArrayBuffer> = new Uint8Array(16).fill(7);

describe("verifyPassword PBKDF2 runtime-cap boundaries", () => {
  it("accepts a hash with exactly 100000 iterations (runtime cap)", async () => {
    const encoded = await encode(100_000, "correct horse battery", SALT);
    expect(await verifyPassword("correct horse battery", encoded)).toBe(true);
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
  });

  it("fails closed for a 310000-iteration hash instead of throwing", async () => {
    // Generate the hash with a non-WebCrypto number of iterations is not
    // possible here; craft the encoded string with a real 100000-iteration
    // digest but label it 310000 - verify must reject the LABEL without
    // attempting the derive (no throw).
    const encoded = await encode(100_000, "correct horse battery", SALT);
    const mislabeled = encoded.replace("pbkdf2-sha256$100000$", "pbkdf2-sha256$310000$");
    await expect(verifyPassword("correct horse battery", mislabeled)).resolves.toBe(false);
  });

  it("fails closed for malformed base64 and wrong salt sizes", async () => {
    expect(await verifyPassword("x", "pbkdf2-sha256$100000$!!!not-base64!!!$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toBe(false);
    const shortSalt = new Uint8Array(8).fill(1);
    const encoded = await encode(100_000, "correct horse battery", shortSalt);
    expect(await verifyPassword("correct horse battery", encoded)).toBe(false);
  });

  it("rejects malformed encodings", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$100000$abc$def")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100000$onlythree")).toBe(false);
  });
});
