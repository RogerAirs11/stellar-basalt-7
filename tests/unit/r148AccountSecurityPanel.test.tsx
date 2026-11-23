// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAuthState, PlatformClient } from "../../src/contracts/platform";
import type { MfaBeginResponse, MfaCommandResponse, MfaStatus } from "../../src/contracts/mfa";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import { AccountSecurityPanel, AccountSecuritySessionNotice } from "../../src/web/shared/AccountSecurityPanel";
import { createPlatformClient, type PlatformTransport } from "../../src/frontend-kit/platformClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial: MfaStatus = { available: true, policy: "required", enrolled: false, factor_version: 0, pending_enrollment: null, verified_until: null, recovery_codes_remaining: 0, recovery_replacement_until: null, recent_events: [] };
const active: MfaStatus = { ...initial, enrolled: true, factor_version: 2, recovery_codes_remaining: 8 };
const pendingStatus: MfaStatus = { ...initial, pending_enrollment: { id: "enroll-a", expires_at: "2099-01-01T00:00:00Z" } };
const enrollment = { id: "enroll-a", secret: "PRIVATE-SETUP-KEY-A", otpauth_uri: "otpauth://totp/Registry%3ATest?secret=PRIVATEKEY", expires_at: "2099-01-01T00:00:00Z" };
function response(status: MfaStatus): MfaCommandResponse { return { status, user: { id: "user-a", display_name: "Test user", email: "test@example.test", role: "owner" }, permissions: [], csrfToken: "new-csrf" }; }
function client(status: MfaStatus = initial): PlatformClient {
  return { auth: { mfa: {
    status: vi.fn().mockResolvedValue(status), beginEnrollment: vi.fn().mockResolvedValue({ ...response(pendingStatus), enrollment }),
    activate: vi.fn().mockResolvedValue({ ...response(active), recovery_codes: ["RECOVERY-ONE", "RECOVERY-TWO"] }),
    challenge: vi.fn().mockResolvedValue(response({ ...active, verified_until: "2099-01-01T00:00:00Z" })),
    recover: vi.fn().mockResolvedValue(response({ ...active, recovery_replacement_until: "2099-01-01T00:00:00Z", recovery_codes_remaining: 7 })),
    cancelEnrollment: vi.fn().mockResolvedValue(response(initial)),
    rotateRecoveryCodes: vi.fn().mockResolvedValue({ ...response({ ...active, factor_version: 3 }), recovery_codes: ["REPLACEMENT-ONE"] }),
    disable: vi.fn().mockResolvedValue(response({ ...initial, factor_version: 3 })),
  } } } as unknown as PlatformClient;
}
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function mount(platform: PlatformClient, scope = "user-a", locale: "en" | "fa" = "en") { await act(async () => root.render(<AccountSecurityPanel platform={platform} scope={scope} locale={locale} />)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function change(name: string, value: string) { await act(async () => { const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function check(name: string) { await act(async () => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.click()); }
async function click(text: string) { await act(async () => { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent === text); expect(button).toBeTruthy(); button!.click(); }); }
async function submitByInput(name: string) { await act(async () => container.querySelector(`[name="${name}"]`)!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function open(platform: PlatformClient) { await mount(platform); await click("Open security settings"); }
async function begin(platform: PlatformClient) { await open(platform); await change("mfa_setup_password", "current-private-password"); await submitByInput("mfa_setup_password"); }

describe("R148 account security", () => {
  it("loads security only when opened and states provider unavailability without a fabricated setup", async () => {
    const platform = client({ ...initial, available: false }); await mount(platform);
    expect(platform.auth.mfa.status).not.toHaveBeenCalled();
    await click("Open security settings");
    expect(platform.auth.mfa.status).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("unavailable in this environment");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('input[name="mfa_setup_secret"]')).toBeNull();
  });

  it("uses a real enrollment key, verifies the new factor with Persian digits and shows recovery codes once", async () => {
    const platform = client(); const storage = vi.spyOn(Storage.prototype, "setItem"); await begin(platform);
    expect(platform.auth.mfa.beginEnrollment).toHaveBeenCalledWith({ current_password: "current-private-password", expected_factor_version: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector<HTMLInputElement>('[name="mfa_setup_secret"]')!.value).toBe(enrollment.secret);
    expect(container.querySelector<HTMLInputElement>('[type="password"]')).toBeNull();
    await change("mfa_activation", "۱۲۳۴۵۶"); await submitByInput("mfa_activation");
    expect(platform.auth.mfa.activate).toHaveBeenCalledWith({ enrollment_id: "enroll-a", code: "123456", expected_factor_version: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("RECOVERY-ONE"); expect(container.textContent).toContain("only starts authenticator replacement");
    expect(container.querySelector('[name="mfa_setup_secret"]')).toBeNull();
    await click("Hide saved recovery codes"); expect(container.textContent).toContain("RECOVERY-ONE");
    await check("mfa_codes_saved"); await click("Hide saved recovery codes"); expect(container.textContent).not.toContain("RECOVERY-ONE");
    expect(storage).not.toHaveBeenCalled();
  });

  it("preserves a pending key after an invalid activation code so a fresh code can be entered", async () => {
    const platform = client(); vi.mocked(platform.auth.mfa.activate).mockRejectedValueOnce(new PlatformClientError(422, "mfa_invalid_code", "Invalid authenticator code"));
    await begin(platform); await change("mfa_activation", "123456"); await submitByInput("mfa_activation");
    expect(container.textContent).toContain("Invalid authenticator code");
    expect(container.querySelector<HTMLInputElement>('[name="mfa_setup_secret"]')!.value).toBe(enrollment.secret);
    expect(container.querySelector<HTMLInputElement>('[name="mfa_activation"]')!.value).toBe("");
    await change("mfa_activation", "654321"); await submitByInput("mfa_activation");
    expect(platform.auth.mfa.activate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(platform.auth.mfa.activate).mock.calls[1][0].code).toBe("654321");
  });

  it("offers a fresh authenticator challenge and drops the proof indication as it expires", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const platform = client(active); vi.mocked(platform.auth.mfa.challenge).mockResolvedValue(response({ ...active, verified_until: "2026-10-28T12:00:01Z" }));
    await open(platform); await change("mfa_challenge", "123456"); await submitByInput("mfa_challenge");
    expect(platform.auth.mfa.challenge).toHaveBeenCalledWith({ code: "123456" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("Verified until");
    expect(container.querySelector<HTMLInputElement>('[name="mfa_challenge"]')!.value).toBe("");
    await act(async () => vi.advanceTimersByTime(1100));
    expect(container.textContent).not.toContain("Verified until"); expect(container.textContent).toContain("fresh authenticator check is needed");
  });

  it("uses recovery solely for replacement and requests the password again before beginning a new factor", async () => {
    const platform = client(active); await open(platform);
    await change("mfa_recovery_password", "recover-password"); await change("mfa_recovery_code", "ONE-USE-RECOVERY"); await submitByInput("mfa_recovery_code");
    expect(platform.auth.mfa.recover).toHaveBeenCalledWith({ current_password: "recover-password", recovery_code: "ONE-USE-RECOVERY" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("does not authorize sensitive operations");
    expect(container.querySelector('[name="mfa_challenge"]')).toBeNull();
    expect(container.querySelector('[name="mfa_replace_code"]')).toBeNull();
    await change("mfa_setup_password", "new-password-entry"); await submitByInput("mfa_setup_password");
    expect(vi.mocked(platform.auth.mfa.beginEnrollment).mock.calls[0][0]).toEqual({ current_password: "new-password-entry", expected_factor_version: 2 });
  });

  it("cancels an orphaned pending enrollment with its exact factor version", async () => {
    const platform = client({ ...pendingStatus, factor_version: 4 }); await open(platform);
    expect(container.textContent).toContain("private key is unavailable in this page");
    await click("Cancel pending setup");
    expect(platform.auth.mfa.cancelEnrollment).toHaveBeenCalledWith({ enrollment_id: "enroll-a", expected_factor_version: 4 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("Pending setup cancelled");
  });

  it("requires credentials and explicit confirmation for replacement codes and disabling", async () => {
    const platform = client(active); await open(platform);
    await change("mfa_rotate_password", "rotate-password"); await change("mfa_rotate_code", "123456");
    await submitByInput("mfa_rotate_password"); expect(platform.auth.mfa.rotateRecoveryCodes).not.toHaveBeenCalled();
    await check("mfa_rotate_confirm"); await submitByInput("mfa_rotate_password");
    expect(platform.auth.mfa.rotateRecoveryCodes).toHaveBeenCalledWith({ current_password: "rotate-password", current_code: "123456", expected_factor_version: 2 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("Previous codes no longer work"); expect(container.textContent).toContain("REPLACEMENT-ONE");
    await change("mfa_disable_password", "disable-password"); await change("mfa_disable_code", "654321"); await check("mfa_disable_confirm"); await submitByInput("mfa_disable_password");
    expect(platform.auth.mfa.disable).toHaveBeenCalledWith({ current_password: "disable-password", current_code: "654321", expected_factor_version: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("Authenticator disabled"); expect(container.textContent).not.toContain("REPLACEMENT-ONE");
  });

  it("does not repeat an ambiguous security operation and requires a fresh status read", async () => {
    const platform = client(); vi.mocked(platform.auth.mfa.beginEnrollment).mockRejectedValueOnce(new Error("Response lost"));
    await begin(platform);
    expect(container.textContent).toContain("change may have completed");
    expect(container.querySelector("form")).toBeNull();
    expect(platform.auth.mfa.beginEnrollment).toHaveBeenCalledOnce();
    vi.mocked(platform.auth.mfa.status).mockResolvedValueOnce(pendingStatus);
    await click("Reload security status");
    expect(container.textContent).not.toContain("change may have completed");
    expect(container.textContent).toContain("private key is unavailable in this page");
    expect(platform.auth.mfa.beginEnrollment).toHaveBeenCalledOnce();
  });

  it("aborts the prior account's pending setup and never displays its late secret after switching accounts", async () => {
    const platform = client(); const pending = deferred<MfaBeginResponse>(); vi.mocked(platform.auth.mfa.beginEnrollment).mockImplementationOnce(() => pending.promise);
    await begin(platform);
    const signal = vi.mocked(platform.auth.mfa.beginEnrollment).mock.calls[0][1]!.signal!;
    await mount(platform, "user-b"); expect(signal.aborted).toBe(true);
    expect(container.textContent).toContain("Open security settings");
    await act(async () => pending.resolve({ ...response(pendingStatus), enrollment }));
    expect(container.querySelector('[name="mfa_setup_secret"]')).toBeNull();
    expect(container.textContent).not.toContain("Setup started");
    await mount(platform, "user-a"); expect(container.querySelector("form")).toBeNull();
  });

  it("removes an expired enrollment secret and instructs the user to restart", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const platform = client(); const expiry = "2026-10-28T12:00:01Z";
    vi.mocked(platform.auth.mfa.beginEnrollment).mockResolvedValue({ ...response({ ...pendingStatus, pending_enrollment: { id: enrollment.id, expires_at: expiry } }), enrollment: { ...enrollment, expires_at: expiry } });
    await begin(platform); expect(container.querySelector('[name="mfa_setup_secret"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1100));
    expect(container.querySelector('[name="mfa_setup_secret"]')).toBeNull(); expect(container.textContent).toContain("setup key expired");
  });

  it("renders Persian security controls", async () => {
    const platform = client(); await mount(platform, "user-a", "fa");
    expect(container.textContent).toContain("امنیت حساب"); expect(container.textContent).toContain("باز کردن تنظیمات امنیت");
  });

  it("keeps a public recovery notice through the real SDK's principal reset and restores only after explicit account-status reconciliation", async () => {
    let rejectEnrollment!: (error: unknown) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectEnrollment = reject; });
    let publish: (state: PlatformAuthState) => void = () => {};
    let csrf: string | null = null; const calls: string[] = [];
    const authenticated = response(initial);
    const transport: PlatformTransport = async <T,>(url: string) => {
      calls.push(url);
      if (url === "/api/auth/me") return authenticated as T;
      if (url === "/api/auth/mfa/status") return initial as T;
      if (url === "/api/auth/mfa/enroll") return pending;
      throw new Error(`Unexpected transport: ${url}`);
    };
    const platform = createPlatformClient({ transport, csrfToken: () => csrf, onSessionChange: state => { csrf = state.csrfToken; publish(state); } });
    function Shell() {
      const [session, setSession] = React.useState<PlatformAuthState>({ user: null, permissions: [] }); publish = setSession;
      return <><AccountSecuritySessionNotice platform={platform} locale="en"/>{session.user ? <AccountSecurityPanel platform={platform} locale="en" scope={session.user.id}/> : <p>Authentication required</p>}</>;
    }
    await act(async () => { root.render(<Shell/>); });
    await act(async () => { await platform.auth.me(); });
    await click("Open security settings"); await change("mfa_setup_password", "synthetic-current-password"); await submitByInput("mfa_setup_password");
    expect(container.textContent).toContain("Updating account security");
    await act(async () => { rejectEnrollment(new Error("Response lost after rotation")); });
    expect(container.textContent).toContain("Authentication required");
    expect(container.textContent).toContain("security update or your current session could not be confirmed");
    expect(container.querySelector('[type="password"]')).toBeNull();
    expect(calls.filter(url => url === "/api/auth/mfa/enroll")).toHaveLength(1);
    await click("Check account status");
    expect(container.textContent).toContain("Open security settings");
    expect(container.textContent).not.toContain("could not be confirmed");
    expect(calls.filter(url => url === "/api/auth/me")).toHaveLength(2);
  });
});
