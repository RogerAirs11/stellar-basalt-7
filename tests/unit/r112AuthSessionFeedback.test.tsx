// @vitest-environment happy-dom
import { act, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformClient, PlatformPermission, PlatformUser } from "../../src/contracts/platform";
import { createPlatformClient, type PlatformTransport } from "../../src/frontend-kit/platformClient";
import { principalScopeKey } from "../../src/frontend-kit";
import { HeritageAuthPage, type HeritageAuthNotice } from "../../src/web/heritage/AuthPage";

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

const owner: PlatformUser = { id: "owner-a", display_name: "Owner Alpha", email: "owner-a@example.invalid", role: "owner" };
const permissions: PlatformPermission[] = ["horse.read", "claim.create"];
const guest = { user: null, permissions: [], csrfToken: null };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  history.replaceState({}, "", "/login");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mountAccount() {
  const calls: Array<{ url: string; init?: RequestInit; response: Deferred<unknown> }> = [];
  const transport: PlatformTransport = <T,>(url: string, init?: RequestInit) => {
    const response = deferred<unknown>();
    calls.push({ url, init, response });
    return response.promise as Promise<T>;
  };
  const navigate = vi.fn((path: string) => { history.pushState({}, "", path); });
  let platform!: PlatformClient;
  const trace: Array<{ principal: string; notice: HeritageAuthNotice }> = [];

  // Keep the notice above the SAME principal-keyed boundary used by main.tsx.
  // The real SDK, not a logout mock, synchronously publishes the guest here.
  function Host() {
    const [user, setUser] = useState<PlatformUser | null>(owner);
    const [access, setAccess] = useState(permissions);
    const [authNotice, setAuthNotice] = useState<HeritageAuthNotice>(null);
    const csrf = useRef<string | null>("csrf-owner-a");
    const [client] = useState(() => createPlatformClient({
      transport,
      csrfToken: () => csrf.current,
      onSessionChange: session => {
        setUser(session.user);
        setAccess([...session.permissions]);
        csrf.current = session.csrfToken;
        if (session.user) setAuthNotice(null);
      },
    }));
    useEffect(() => { platform = client; }, [client]);
    const principal = principalScopeKey(user, access);
    trace.push({ principal, notice: authNotice });
    return <div key={principal} data-principal={principal}>
      <HeritageAuthPage platform={client} user={user} navigate={navigate} authNotice={authNotice} setAuthNotice={setAuthNotice}/>
    </div>;
  }
  act(() => root.render(<StrictMode><Host/></StrictMode>));
  return { calls, navigate, trace, platform };
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(element => element.textContent === label);
  expect(found, `Missing button: ${label}`).toBeTruthy();
  return found!;
}
function click(label: string) { act(() => button(label).click()); }
function fill(selector: string, value: string) {
  act(() => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function assertGuest() {
  expect(container.querySelector('[aria-label="Signed-in account"]')).toBeNull();
  expect(container.textContent).not.toContain(owner.display_name);
  expect(container.querySelector('input[type="email"]')).not.toBeNull();
}

describe("R112 Core auth feedback across principal remount", () => {
  it("keeps pending sign-out visible and blocks guest authentication until the real request settles", async () => {
    const harness = mountAccount();
    const signedInPage = container.firstElementChild;
    click("Sign out");
    assertGuest();
    expect(container.firstElementChild).not.toBe(signedInPage);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Signing out");
    expect([...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")].every(control => control.disabled)).toBe(true);
    expect(harness.calls.map(call => call.url)).toEqual(["/api/auth/logout"]);
    expect(harness.calls[0].init?.headers).toEqual({ "x-csrf-token": "csrf-owner-a" });

    // Native disabled controls and an explicit submit dispatch must both be safe
    // after the old component's local busy/ref state has been discarded.
    act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(harness.calls).toHaveLength(1);
    expect(harness.trace.filter(entry => entry.principal === principalScopeKey(null, [])).every(entry => entry.notice === "signing-out")).toBe(true);

    await act(async () => { harness.calls[0].response.resolve({ ok: true }); });
    assertGuest();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')!.disabled).toBe(false);
    expect(button("Register").disabled).toBe(false);
    expect(harness.navigate).toHaveBeenCalledExactlyOnceWith("/login");
    expect(location.search).toBe("");
    expect(harness.trace.at(-1)?.notice).toBeNull();
  });

  it.each(["transport-rejection", "invalid-confirmation"])("retains uncertainty after %s and requires an explicit successful status read", async failure => {
    const harness = mountAccount();
    click("Sign out");
    await act(async () => {
      if (failure === "transport-rejection") harness.calls[0].response.reject(new Error("Connection lost"));
      else harness.calls[0].response.resolve({ ok: false });
    });
    assertGuest();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign-out could not be confirmed");
    expect(harness.calls).toHaveLength(1); // No automatic /me or authority restore.
    expect(location.pathname).toBe("/login");
    expect(location.search).toBe("");
    expect(button("Check account status").disabled).toBe(false);

    click("Check account status");
    expect(harness.calls[1].url).toBe("/api/auth/me");
    expect(button("Checking account status…").disabled).toBe(true);
    click("Checking account status…");
    expect(harness.calls).toHaveLength(2);
    await act(async () => { harness.calls[1].response.reject(new Error("Account status unavailable")); });
    assertGuest();
    expect(container.textContent).toContain("Sign-out could not be confirmed");
    expect(container.textContent).toContain("Account status unavailable");
    expect(button("Check account status").disabled).toBe(false);

    click("Check account status");
    await act(async () => { harness.calls[2].response.resolve(guest); });
    assertGuest();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("You are signed out");
    expect(harness.trace.at(-1)?.notice).toBeNull();
  });

  it("discards a superseded session response and renders only a fresh explicit account check", async () => {
    const harness = mountAccount();
    const staleRead = harness.platform.auth.me().catch(error => error);
    click("Sign out");
    await act(async () => { harness.calls[1].response.reject(new Error("Connection lost")); });
    const afterLogout = harness.trace.length;
    await act(async () => {
      harness.calls[0].response.resolve({ user: owner, permissions, csrfToken: "stale-csrf" });
      expect((await staleRead).code).toBe("session_superseded");
    });
    assertGuest();
    expect(harness.trace.slice(afterLogout).every(entry => entry.principal === principalScopeKey(null, []))).toBe(true);
    expect(container.textContent).toContain("Sign-out could not be confirmed");

    click("Check account status");
    const current: PlatformUser = { ...owner, id: "owner-b", display_name: "Owner Beta", email: "owner-b@example.invalid" };
    await act(async () => { harness.calls[2].response.resolve({ user: current, permissions: ["horse.read"], csrfToken: "fresh-csrf" }); });
    expect(container.querySelector('[aria-label="Signed-in account"]')?.textContent).toContain("Owner Beta");
    expect(container.textContent).not.toContain("Owner Alpha");
    expect(container.textContent).not.toContain("Sign-out could not be confirmed");
    expect(harness.trace.at(-1)?.principal).toBe(principalScopeKey(current, ["horse.read"]));

    click("Sign out");
    expect(harness.calls[3].init?.headers).toEqual({ "x-csrf-token": "fresh-csrf" });
    await act(async () => { harness.calls[3].response.resolve({ ok: true }); });
  });

  it("clears an obsolete warning after a new explicit sign-in publishes a validated session", async () => {
    const harness = mountAccount();
    click("Sign out");
    await act(async () => { harness.calls[0].response.reject(new Error("Connection lost")); });
    fill('input[type="email"]', "owner-b@example.invalid");
    fill('input[type="password"]', "new-password");
    act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(harness.calls[1].url).toBe("/api/auth/login");
    assertGuest();
    const current: PlatformUser = { ...owner, id: "owner-b", display_name: "Owner Beta", email: "owner-b@example.invalid" };
    await act(async () => { harness.calls[1].response.resolve({ user: current, permissions, csrfToken: "fresh-csrf" }); });
    expect(container.querySelector('[aria-label="Signed-in account"]')?.textContent).toContain("Owner Beta");
    expect(container.textContent).not.toContain("Sign-out could not be confirmed");
    expect(harness.trace.at(-1)?.notice).toBeNull();
  });
});
