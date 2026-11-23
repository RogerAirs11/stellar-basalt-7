import { HttpError } from "../api/http";

const encoder = new TextEncoder();
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export interface MfaKeyring { active_key_id: string; keys: Record<string, string> }
export function parseMfaKeyring(value: unknown): MfaKeyring | null {
  if (typeof value !== "string" || !value || value.length > 8192) return null;
  try {
    const parsed = JSON.parse(value) as MfaKeyring;
    const entries = Object.entries(parsed.keys ?? {});
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(parsed.active_key_id) || entries.length < 1 || entries.length > 8 || !Object.hasOwn(parsed.keys, parsed.active_key_id)) return null;
    for (const [id, key] of entries) if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || typeof key !== "string" || decode64(key).length !== 32) return null;
    return parsed;
  } catch { return null; }
}
function encode64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decode64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function randomMfaToken(bytes = 32): string {
  return encode64(crypto.getRandomValues(new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export async function mfaHash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decodeBase32(secret: string): Uint8Array<ArrayBuffer> {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret) {
    const digit = alphabet.indexOf(char); if (digit < 0) throw new Error("Invalid authenticator secret encoding");
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(bytes);
}
export function newTotpSecret(): string { return encodeBase32(crypto.getRandomValues(new Uint8Array(20))); }
export async function totpAtStep(secret: string, step: number, digits = 6): Promise<string> {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits)) throw new Error("Invalid authenticator step");
  const counter = new Uint8Array(8); new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey("raw", decodeBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = signature[signature.length - 1]! & 15;
  const number = ((signature[offset]! & 127) * 2 ** 24 + signature[offset + 1]! * 2 ** 16 + signature[offset + 2]! * 256 + signature[offset + 3]!) % 10 ** digits;
  return String(number).padStart(digits, "0");
}
export async function acceptedTotpStep(secret: string, code: string, now = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000); let match: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = await totpAtStep(secret, step); let different = 0;
    for (let index = 0; index < 6; index++) different |= expected.charCodeAt(index) ^ code.charCodeAt(index);
    if (different === 0) match = step;
  }
  return match;
}
export async function encryptMfaSecret(keyring: MfaKeyring, secret: string, userId: string, version: number): Promise<string> {
  const keyId = keyring.active_key_id;
  const key = await crypto.subtle.importKey("raw", decode64(keyring.keys[keyId]!), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`horse-mfa-v1:${userId}:${version}`) }, key, encoder.encode(secret));
  return JSON.stringify({ v: 1, kid: keyId, iv: encode64(iv), data: encode64(new Uint8Array(encrypted)) });
}
export async function decryptMfaSecret(keyring: MfaKeyring, encoded: string, userId: string, version: number): Promise<string> {
  try {
    const value = JSON.parse(encoded) as { v: number; kid: string; iv: string; data: string };
    if (value.v !== 1 || !Object.hasOwn(keyring.keys, value.kid)) throw new Error("Unavailable key");
    const key = await crypto.subtle.importKey("raw", decode64(keyring.keys[value.kid]!), "AES-GCM", false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode64(value.iv), additionalData: encoder.encode(`horse-mfa-v1:${userId}:${version}`) }, key, decode64(value.data));
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch { throw new HttpError(503, "mfa_key_unavailable", "Authenticator verification is temporarily unavailable; contact the operator"); }
}
