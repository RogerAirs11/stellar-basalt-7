// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HorseMediaGallery } from "../../src/web/heritage/HorseModulesPanels";
import { HorseMediaPanel } from "../../src/frontend-kit/HorseMediaPanel";
import { FeiHorseRecordModules } from "../../src/web/frontends/fei-classic/recordModules";
import { EquiDataRecordModules } from "../../src/web/frontends/equidata-elite/recordModules";
import { I18nProvider } from "../../src/web/i18n";
import { createMockPlatformClient } from "../../src/frontend-kit/mockPlatformClient";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import type { HorseMediaListResponse, HorseMediaRecord, HorseRecord, PlatformClient, PlatformUser } from "../../src/contracts/platform";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const horse = { id: 1, name_latin: "DEMO horse" } as HorseRecord;
const owner = { id: "owner-a", role: "owner", display_name: "A", email: "a@example.test" } as PlatformUser;
const other = { ...owner, id: "owner-b", display_name: "B" };
const basePhoto: HorseMediaRecord = { id: "11111111-1111-4111-a111-111111111111", horse_id: 1, media_type: "photo", role: "gallery", file_name: "private-photo.png",
  mime_type: "image/png", width: 3, height: 3, size_bytes: 100, caption: "Private A photo", verification: "federation_verified", verification_level: "platform_reviewed",
  row_version: 2, consent_state: "private", public_visible: false, can_publish: true, can_withdraw: false, sort_order: 0, created_at: "2026-10-17T00:00:00Z" };
const response = (photo: HorseMediaRecord = basePhoto): HorseMediaListResponse => ({ horse_id: 1, media: [photo], counts: { photos: 1, documents: 0, verified: 1 } });
function client() {
  const platform = createMockPlatformClient({ authenticated: true });
  platform.modules.access.horseActions = vi.fn().mockResolvedValue({ horse_id: 1, actions: ["upload_media"], relationships: ["owner"], is_staff: false, grants: [] });
  platform.modules.media.list = vi.fn().mockResolvedValue(response());
  platform.modules.media.setPublication = vi.fn();
  platform.modules.media.verify = vi.fn();
  platform.modules.media.upload = vi.fn();
  platform.modules.media.access = vi.fn();
  platform.modules.media.revokeAccess = vi.fn();
  return platform;
}
async function render(platform: PlatformClient, user: PlatformUser = owner, locale: "en" | "fa" = "en", permissions: string[] = []) {
  await act(async () => { root.render(<I18nProvider locale={locale}><HorseMediaGallery horse={horse} platform={platform} user={user} permissions={permissions}/></I18nProvider>); });
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(node => node.textContent === label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("R111 Core media consent and principal boundaries (mounted React)", () => {
  it("keeps commands usable after StrictMode replays lifecycle cleanup", async () => {
    const p = client();
    vi.mocked(p.modules.media.setPublication).mockResolvedValue({ id: basePhoto.id, row_version: 3, consent_state: "shared_public", public_visible: true });
    await act(async () => { root.render(<React.StrictMode><I18nProvider locale="en"><HorseMediaGallery horse={horse} platform={p} user={owner} permissions={[]}/></I18nProvider></React.StrictMode>); });
    await act(async () => button("Publish photo").click());
    expect(p.modules.media.setPublication).toHaveBeenCalledTimes(1);
  });
  it("masks a previous owner's private media immediately while the next owner loads", async () => {
    const p = client(), pending = deferred<HorseMediaListResponse>();
    await render(p);
    expect(container.textContent).toContain("Private A photo");
    vi.mocked(p.modules.media.list).mockReturnValueOnce(pending.promise);
    await render(p, other);
    expect(container.textContent).not.toContain("Private A photo");
    await act(async () => pending.resolve(response({ ...basePhoto, caption: "Private B photo" })));
    expect(container.textContent).toContain("Private B photo");
  });

  it("discards a delayed response across A → B → A instead of reviving the old A snapshot", async () => {
    const p = client(), oldA = deferred<HorseMediaListResponse>();
    vi.mocked(p.modules.media.list).mockReturnValueOnce(oldA.promise).mockResolvedValueOnce(response({ ...basePhoto, caption: "Private B" }))
      .mockResolvedValueOnce(response({ ...basePhoto, caption: "Current A" }));
    await render(p); await render(p, other); await render(p, owner);
    expect(container.textContent).toContain("Current A");
    await act(async () => oldA.resolve(response({ ...basePhoto, caption: "STALE PRIVATE A" })));
    expect(container.textContent).toContain("Current A");
    expect(container.textContent).not.toContain("STALE PRIVATE A");
  });

  it("preserves a conflicted publication intent and retries only after a deliberate click against the fresh version", async () => {
    const p = client();
    vi.mocked(p.modules.media.list).mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ ...basePhoto, row_version: 3 }))
      .mockResolvedValueOnce(response({ ...basePhoto, row_version: 4, consent_state: "shared_public", public_visible: true, can_withdraw: true }));
    vi.mocked(p.modules.media.setPublication).mockRejectedValueOnce(new PlatformClientError(409, "media_conflict", "Changed"))
      .mockResolvedValueOnce({ id: basePhoto.id, row_version: 4, consent_state: "shared_public", public_visible: true });
    await render(p);
    await act(async () => button("Publish photo").click());
    expect(container.textContent).toContain("Your visibility request is saved below");
    expect(container.textContent).toContain("Saved request:");
    expect(p.modules.media.setPublication).toHaveBeenCalledTimes(1);
    const firstOptions = vi.mocked(p.modules.media.setPublication).mock.calls[0]![2];
    expect(firstOptions.expectedVersion).toBe(2);
    await act(async () => button("Retry visibility change").click());
    const retryOptions = vi.mocked(p.modules.media.setPublication).mock.calls[1]![2];
    expect(retryOptions.expectedVersion).toBe(3);
    expect(retryOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey);
    expect(container.textContent).not.toContain("Saved request:");
    expect(container.textContent).toContain("Photo published. Visitors can now view it.");
    expect(button("Withdraw publication")).toBeTruthy();
  });

  it("reviews without silently publishing, and gives the uploader separate controls", async () => {
    const p = client();
    vi.mocked(p.modules.media.list).mockResolvedValueOnce(response({ ...basePhoto, verification: "pending", row_version: 1, can_publish: false }))
      .mockResolvedValueOnce(response({ ...basePhoto, can_publish: false }));
    vi.mocked(p.modules.media.verify).mockResolvedValue({ id: basePhoto.id, verification: "federation_verified", verification_level: "platform_reviewed", note: "Editorial review" });
    await render(p, { ...owner, id: "admin", role: "admin" }, "en", ["horse.edit"]);
    expect(container.textContent).not.toContain("Publish photo");
    await act(async () => button("Approve review").click());
    expect(p.modules.media.verify).toHaveBeenCalledWith(basePhoto.id, "platform_reviewed", null, expect.objectContaining({ expectedVersion: 1 }));
    expect(p.modules.media.setPublication).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Publication still needs the uploader's separate consent");
    expect(container.textContent).not.toContain("Publish photo");
  });

  it("keeps file purpose and publication controls localized and excludes unsupported AVIF", async () => {
    const p = client(); await render(p, owner, "fa");
    expect(button("انتشار عکس")).toBeTruthy();
    expect(container.textContent).toContain("مدرک خصوصی");
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.accept).not.toContain("avif");
    const purpose = container.querySelector("select")!;
    await act(async () => { purpose.value = "document"; purpose.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe("application/pdf,image/jpeg,image/png");
  });

  it("does not submit an upload after a slow file read outlives its principal", async () => {
    const p = client();
    let reader: { onload?: () => void; result: string } | undefined;
    vi.stubGlobal("FileReader", class {
      onload?: () => void;
      onerror?: () => void;
      result = "data:image/png;base64,aGVsbG8=";
      constructor() { reader = this; }
      readAsDataURL() { /* intentionally delayed until after account change */ }
    });
    await render(p);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["hello"], "image.png", { type: "image/png" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await render(p, other);
    await act(async () => reader?.onload?.());
    expect(p.modules.media.upload).not.toHaveBeenCalled();
  });

  it("mints and revokes precisely the shown private document link", async () => {
    const p = client(), id = "document-id", grantId = "22222222-2222-4222-a222-222222222222";
    const doc = { ...basePhoto, id, media_type: "document" as const, role: "other", can_publish: false, mime_type: "application/pdf", file_name: "DEMO-private.pdf" };
    vi.mocked(p.modules.media.list).mockResolvedValue({ horse_id: 1, media: [doc], counts: { photos: 0, documents: 1, verified: 1 } });
    vi.mocked(p.modules.media.access).mockResolvedValue({ media_id: id, grant_id: grantId, token: "test-only-token", url: `/api/media/file/${id}?token=test-only-token`, expires_at: "2026-10-17T12:15:00Z", ttl_seconds: 900, evidence_class: "other", consent_state: "private" });
    await render(p);
    await act(async () => button("Create 15-minute access link").click());
    expect(p.modules.media.access).toHaveBeenCalledWith(id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toContain("test-only-token");
    expect(container.textContent).toContain("Anyone with this link");
    await act(async () => button("Revoke this link").click());
    expect(p.modules.media.revokeAccess).toHaveBeenCalledWith(id, grantId, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.textContent).toContain("This temporary link is revoked");
  });

  it("does not carry a generated private bearer URL into the next principal", async () => {
    const p = client();
    vi.mocked(p.modules.media.access).mockResolvedValue({ media_id: basePhoto.id, grant_id: crypto.randomUUID(), token: "PRIVATE-A-ONLY", url: `/api/media/file/${basePhoto.id}?token=PRIVATE-A-ONLY`, expires_at: "2026-10-17T12:15:00Z", ttl_seconds: 900, evidence_class: "gallery", consent_state: "private" });
    await render(p);
    await act(async () => button("Create 15-minute access link").click());
    expect(container.innerHTML).toContain("PRIVATE-A-ONLY");
    await render(p, other);
    expect(container.innerHTML).not.toContain("PRIVATE-A-ONLY");
  });

  it("lets staff reject a review with a current version without changing uploader consent", async () => {
    const p = client();
    vi.mocked(p.modules.media.list).mockResolvedValueOnce(response({ ...basePhoto, can_publish: false }))
      .mockResolvedValueOnce(response({ ...basePhoto, verification: "rejected", row_version: 3, can_publish: false }));
    await render(p, { ...owner, id: "admin", role: "admin" }, "en", ["horse.edit"]);
    await act(async () => button("Reject review").click());
    expect(p.modules.media.verify).toHaveBeenCalledWith(basePhoto.id, "rejected", null, expect.objectContaining({ expectedVersion: 2 }));
    expect(p.modules.media.setPublication).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Review rejected");
  });

  it("makes the same native controls available in FEI and EquiData record pages", async () => {
    const p = client();
    const view = { platform: p, user: owner, permissions: [], locale: "en", navigate: vi.fn() };
    for (const [Component, appearance] of [[FeiHorseRecordModules, "fei"], [EquiDataRecordModules, "equidata"]] as const) {
      await act(async () => root.render(<Component view={view as never} horseId={1} goLocal={vi.fn()}/>));
      expect(container.querySelector(`.registry-media-${appearance}`)).toBeTruthy();
      expect(button("Publish photo")).toBeTruthy();
      expect(button("Choose and upload file")).toBeTruthy();
      expect(container.querySelector(".h-mod-media")).toBeNull();
    }
    await act(async () => root.render(<HorseMediaPanel horseId={1} platform={p} user={owner} permissions={[]} locale="fa" appearance="retro"/>));
    expect(container.querySelector('.registry-media-retro[dir="rtl"]')).toBeTruthy();
    expect(button("انتشار عکس")).toBeTruthy();
  });
});
