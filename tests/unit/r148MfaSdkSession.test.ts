import { describe, expect, it } from "vitest";
import { createPlatformClient, type PlatformTransport } from "../../src/frontend-kit/platformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { MfaCommandResponse, MfaStatus } from "../../src/contracts/mfa";
import type { PlatformUser } from "../../src/contracts/platform";

const user: PlatformUser = { id: "account-a", role: "owner", display_name: "Synthetic account", email: "synthetic@example.test" };
const auth = { user, permissions: [], csrfToken: "csrf-initial" };
const status: MfaStatus = { available: true, policy: "required", enrolled: true, factor_version: 1, pending_enrollment: null, verified_until: "2099-01-01T00:00:00Z", recovery_codes_remaining: 8, recovery_replacement_until: null, recent_events: [] };
const verified: MfaCommandResponse = { ...auth, csrfToken: "csrf-rotated", status };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function harness(handler: (url: string, init?: RequestInit) => Promise<unknown>) {
  const snapshots: unknown[] = []; const calls: Array<{ url: string; init?: RequestInit }> = [];
  let csrf: string | null = null;
  const transport: PlatformTransport = async <T>(url: string, init?: RequestInit) => { calls.push({ url, init }); return await handler(url, init) as T; };
  const platform = createPlatformClient({ transport, csrfToken: () => csrf, onSessionChange: state => { snapshots.push(state); csrf = state.csrfToken; } });
  return { platform, snapshots, calls };
}

describe("R148 MFA SDK cookie-changing session fence", () => {
  it("preserves the principal during verification, fences concurrent account changes and publishes only the rotated session", async () => {
    const pending = deferred<MfaCommandResponse>();
    const h = harness(async url => url === "/api/auth/me" ? auth : pending.promise);
    await h.platform.auth.me();
    const challenge = h.platform.auth.mfa.challenge({ code: "123456" });
    expect(h.snapshots).toEqual([auth]);
    await expect(h.platform.auth.login({ email: "other@example.test", password: "other-password" })).rejects.toMatchObject({ code: "session_change_in_progress" });
    await expect(h.platform.auth.logout()).rejects.toMatchObject({ code: "session_change_in_progress" });
    await expect(h.platform.auth.mfa.challenge({ code: "654321" })).rejects.toMatchObject({ code: "session_change_in_progress" });
    await expect(h.platform.auth.me()).rejects.toMatchObject({ code: "session_change_in_progress" });
    expect(h.calls.map(call => call.url)).toEqual(["/api/auth/me", "/api/auth/mfa/challenge"]);
    expect(h.calls[1].init?.headers).toMatchObject({ "x-csrf-token": "csrf-initial" });
    pending.resolve(verified); await challenge;
    expect(h.snapshots.at(-1)).toEqual({ ...auth, csrfToken: "csrf-rotated" });
  });

  it("rejects an earlier /me response after a successful MFA rotation", async () => {
    const lateRead = deferred<typeof auth>(); let reads = 0;
    const h = harness(async url => url === "/api/auth/me" ? (++reads === 1 ? auth : lateRead.promise) : verified);
    await h.platform.auth.me(); const stale = h.platform.auth.me(); const rejected = expect(stale).rejects.toMatchObject({ code: "session_superseded" });
    await h.platform.auth.mfa.challenge({ code: "123456" }); lateRead.resolve(auth); await rejected;
    expect(h.snapshots.at(-1)).toEqual({ ...auth, csrfToken: "csrf-rotated" });
    expect(h.snapshots).toHaveLength(2);
  });

  it("masks authority after an ambiguous response and performs no automatic replay", async () => {
    const h = harness(async url => { if (url === "/api/auth/me") return auth; throw new Error("Lost after cookie rotation"); });
    await h.platform.auth.me(); await expect(h.platform.auth.mfa.challenge({ code: "123456" })).rejects.toThrow("Lost after cookie rotation");
    expect(h.snapshots.at(-1)).toEqual({ user: null, permissions: [], csrfToken: null });
    expect(h.calls.filter(call => call.url === "/api/auth/mfa/challenge")).toHaveLength(1);
    await h.platform.auth.me(); expect(h.snapshots.at(-1)).toEqual(auth);
  });

  it("preserves the established principal after an ordinary input refusal but masks an expired/forbidden session", async () => {
    let failure = new PlatformClientError(400, "invalid_mfa_code", "Enter six digits");
    const h = harness(async url => { if (url === "/api/auth/me") return auth; throw failure; });
    await h.platform.auth.me(); await expect(h.platform.auth.mfa.challenge({ code: "bad" })).rejects.toMatchObject({ status: 400 });
    expect(h.snapshots).toEqual([auth]);
    failure = new PlatformClientError(403, "session_invalid", "Session is unavailable");
    await expect(h.platform.auth.mfa.challenge({ code: "123456" })).rejects.toMatchObject({ status: 403 });
    expect(h.snapshots.at(-1)).toEqual({ user: null, permissions: [], csrfToken: null });
  });

  it("never publishes a different principal returned by an MFA endpoint", async () => {
    const h = harness(async url => url === "/api/auth/me" ? auth : { ...verified, user: { ...user, id: "account-b" } });
    await h.platform.auth.me(); await expect(h.platform.auth.mfa.challenge({ code: "123456" })).rejects.toMatchObject({ code: "mfa_principal_changed" });
    expect(h.snapshots.at(-1)).toEqual({ user: null, permissions: [], csrfToken: null });
    expect(h.snapshots.some(value => (value as typeof auth).user?.id === "account-b")).toBe(false);
  });

  it("discards an aborted late response and excludes recovery secrets from session notifications", async () => {
    const pending = deferred<MfaCommandResponse>(); let pendingRequest = true;
    const h = harness(async url => url === "/api/auth/me" ? auth : pendingRequest ? pending.promise : { ...verified, recovery_codes: ["PRIVATE-ONE-TIME-CODE"] });
    await h.platform.auth.me(); const controller = new AbortController();
    const attempt = h.platform.auth.mfa.challenge({ code: "123456" }, { signal: controller.signal }); const rejected = expect(attempt).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); pending.resolve(verified); await rejected;
    expect(h.snapshots.at(-1)).toEqual({ user: null, permissions: [], csrfToken: null });
    pendingRequest = false; await h.platform.auth.me();
    const result = await h.platform.auth.mfa.rotateRecoveryCodes({ current_password: "synthetic-password", current_code: "654321", expected_factor_version: 1 });
    expect(result.recovery_codes).toEqual(["PRIVATE-ONE-TIME-CODE"]);
    expect(JSON.stringify(h.snapshots)).not.toContain("PRIVATE-ONE-TIME-CODE");
  });
});
