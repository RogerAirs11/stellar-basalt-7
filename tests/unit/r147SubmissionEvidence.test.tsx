// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionEvidencePanel } from "../../src/web/heritage/SubmissionEvidencePanel";
import { I18nProvider } from "../../src/web/i18n";
import type { PlatformClient, RegistrationEvidenceRecord } from "../../src/contracts/platform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const evidence: RegistrationEvidenceRecord = { id: "evidence-1", request_id: "draft-a", role: "passport", file_name: "passport.pdf", mime_type: "application/pdf", size_bytes: 24, sha256: "a".repeat(64), created_at: "2026-10-01", verification: "unreviewed", public_visible: false };
const limits = { max_file_bytes: 8 * 1024 * 1024, max_files: 12, max_total_bytes: 48 * 1024 * 1024 };
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.includes(text));
async function render(platform: PlatformClient) { await act(async () => root.render(<I18nProvider locale="en"><SubmissionEvidencePanel platform={platform} requestId="draft-a" /></I18nProvider>)); }

describe("private registration evidence", () => {
  it("preserves actual file bytes and the same operation ID when upload acknowledgement is lost", async () => {
    let saved = false;
    const list = vi.fn(async () => ({ request_id: "draft-a", evidence: saved ? [evidence] : [], can_edit: true, limits }));
    const upload = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockImplementationOnce(async () => { saved = true; return { evidence, idempotent_replay: true }; });
    const platform = { changes: { evidence: { list, upload, remove: vi.fn(), fileUrl: (request: string, file: string) => `/private-requests/${request}/${file}` } } } as unknown as PlatformClient;
    await render(platform);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!; const file = new File(["%PDF-1.4 real user bytes"], "passport.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(button("Retry the same upload")).toBeTruthy();
    await act(async () => button("Retry the same upload")!.click());
    expect(upload).toHaveBeenCalledTimes(2); expect(upload.mock.calls[0][0]).toBe("draft-a"); expect(upload.mock.calls[0][1]).toEqual(upload.mock.calls[1][1]);
    expect(upload.mock.calls[0][1].data_base64).toBe(btoa("%PDF-1.4 real user bytes"));
    expect(upload.mock.calls[0][1].operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/private-requests/draft-a/evidence-1");
    expect(container.textContent).toContain("Private · unreviewed");
  });

  it("keeps pending evidence readable while all attachment mutations are unavailable", async () => {
    const upload = vi.fn(); const remove = vi.fn();
    const platform = { changes: { evidence: { list: vi.fn().mockResolvedValue({ request_id: "draft-a", evidence: [evidence], can_edit: false, limits }), upload, remove, fileUrl: () => "/private-evidence" } } } as unknown as PlatformClient;
    await render(platform);
    expect(container.querySelector("a")?.textContent).toBe("passport.pdf"); expect(container.querySelector('input[type="file"]')).toBeNull(); expect(button("Remove")).toBeUndefined();
    expect(container.textContent).toContain("read-only while it is outside draft status"); expect(upload).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
});
