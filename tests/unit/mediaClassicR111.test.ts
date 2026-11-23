// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const dependencies = vi.hoisted(() => ({ api: vi.fn(), state: { locale: "en", auth: { user: { id: "owner-a" }, permissions: [] as string[] } } }));
vi.mock("../../public/classic-registry/ui/core.js", () => ({
  ...dependencies,
  esc: (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!)),
  attr: (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!)),
  num: (value: unknown) => String(value),
}));
// Native JavaScript is shipped intentionally without a TypeScript declaration.
// @ts-expect-error The test exercises the actual standalone browser module.
import { mountHorseMedia } from "../../public/classic-registry/ui/views/media.js";

let container: HTMLDivElement, destroy: (() => void) | undefined;
const photo = { id: "11111111-1111-4111-a111-111111111111", media_type: "photo", file_name: "DEMO-photo.png", mime_type: "image/png", verification: "federation_verified", row_version: 2, public_visible: false, can_publish: true, can_withdraw: false };
let currentPhoto: typeof photo;
const response = () => ({ media: [currentPhoto], counts: { photos: 1, documents: 0, verified: 1 } });
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container);
  dependencies.state.auth = { user: { id: "owner-a" }, permissions: [] };
  dependencies.state.locale = "en";
  currentPhoto = { ...photo };
  dependencies.api.mockReset().mockImplementation(async (path: string, options?: { method?: string; json?: { consent_state?: string } }) => {
    if (path.endsWith("/actions")) return { actions: ["upload_media"] };
    if (options?.method === "POST" && path.endsWith("/publication")) {
      currentPhoto = { ...currentPhoto, row_version: currentPhoto.row_version + 1, public_visible: options.json?.consent_state === "shared_public", can_withdraw: options.json?.consent_state === "shared_public", can_publish: options.json?.consent_state !== "shared_public" };
      return { id: currentPhoto.id, row_version: currentPhoto.row_version };
    }
    return response();
  });
});
afterEach(() => { destroy?.(); destroy = undefined; container.remove(); vi.unstubAllGlobals(); });
const control = (name: string) => container.querySelector<HTMLButtonElement>(`[data-media-action="${name}"]`)!;
async function mount() {
  destroy = mountHorseMedia(container, 1);
  await vi.waitFor(() => expect(control("choose")).not.toBeNull());
}

describe("R111 Classic native media workflow", () => {
  it("uses versioned explicit publication and keeps donor and embedded modules identical", async () => {
    await mount();
    control("publish").click();
    await vi.waitFor(() => expect(container.textContent).toContain("Photo published"));
    const [, request] = dependencies.api.mock.calls.find(([path]) => path.endsWith("/publication"))!;
    expect(request.json).toEqual({ consent_state: "shared_public", expected_version: 2 });
    expect(request.headers["Idempotency-Key"]).toMatch(/^[a-f0-9-]{36}$/);
    expect(control("withdraw")).toBeTruthy();
    for (const file of ["views/media.js", "media.css"]) expect(readFileSync(`public/classic-registry/ui/${file}`, "utf8"))
      .toBe(readFileSync(`standalone-frontends/classic-v1.4/public/ui/${file}`, "utf8"));
  });

  it("retains a visibility conflict for explicit retry with a fresh row version and request identifier", async () => {
    const handler = dependencies.api.getMockImplementation()!;
    let refused = false;
    dependencies.api.mockImplementation(async (path, options) => {
      if (path.endsWith("/publication") && !refused) {
        refused = true; currentPhoto.row_version = 8;
        throw Object.assign(new Error("stale version"), { status: 409 });
      }
      return handler(path, options);
    });
    await mount(); control("publish").click();
    await vi.waitFor(() => expect(container.textContent).toContain("Your visibility request is saved"));
    expect(dependencies.api.mock.calls.filter(([path]) => path.endsWith("/publication"))).toHaveLength(1);
    control("retry").click();
    await vi.waitFor(() => expect(container.textContent).toContain("Photo published"));
    const writes = dependencies.api.mock.calls.filter(([path]) => path.endsWith("/publication"));
    expect(writes[1]![1].json.expected_version).toBe(8);
    expect(writes[1]![1].headers["Idempotency-Key"]).not.toBe(writes[0]![1].headers["Idempotency-Key"]);
  });

  it("keeps staff review separate from uploader publication and localizes file purpose", async () => {
    dependencies.state.auth.permissions = ["horse.edit"];
    dependencies.state.locale = "fa";
    currentPhoto = { ...photo, verification: "pending", can_publish: false };
    await mount();
    expect(control("publish")).toBeNull();
    expect(control("review").textContent).toBe("تأیید بررسی");
    control("review").click();
    await vi.waitFor(() => expect(dependencies.api.mock.calls.some(([path]) => path.endsWith("/verify"))).toBe(true));
    expect(dependencies.api.mock.calls.some(([path]) => path.endsWith("/publication"))).toBe(false);
    await vi.waitFor(() => expect(container.getAttribute("aria-busy")).toBe("false"));
    const purpose = container.querySelector("select")!;
    purpose.value = "document"; purpose.dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe("application/pdf,image/jpeg,image/png");
  });

  it("does not submit a delayed file under a replacement principal", async () => {
    let reader: { onload?: () => void; result: string } | undefined;
    vi.stubGlobal("FileReader", class {
      onload?: () => void; onerror?: () => void; result = "data:image/png;base64,aGVsbG8=";
      constructor() { reader = this; }
      readAsDataURL() { /* release after the session changes */ }
    });
    await mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["hello"], "DEMO.png", { type: "image/png" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    dependencies.state.auth = { user: { id: "owner-b" }, permissions: [] };
    reader?.onload?.();
    await Promise.resolve(); await Promise.resolve();
    expect(dependencies.api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  });

  it("revokes exactly the private link shown in this view", async () => {
    const grantId = crypto.randomUUID(), handler = dependencies.api.getMockImplementation()!;
    dependencies.api.mockImplementation(async (path, options) => {
      if (path.endsWith("/access")) return { grant_id: grantId, url: `/api/media/file/${photo.id}?token=CLASSIC-PRIVATE`, expires_at: "2026-10-17T12:15:00Z" };
      return handler(path, options);
    });
    await mount(); control("access").click();
    await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.value).toContain("CLASSIC-PRIVATE"));
    control("revoke").click();
    await vi.waitFor(() => expect(container.textContent).toContain("This temporary link is revoked"));
    expect(dependencies.api.mock.calls.some(([path, request]) => path.endsWith(`/access/${grantId}`) && request.method === "DELETE")).toBe(true);
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });
});
