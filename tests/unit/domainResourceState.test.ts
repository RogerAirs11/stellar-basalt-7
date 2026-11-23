import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PlatformClientError } from "../../src/frontend-kit/errors";
import {
  BILLING,
  DIRECTORY,
  MONEY,
  RESOURCE_STATES,
  SERVICE_REQUESTS,
  WORKSPACES,
  advanceCursor,
  advanceOffset,
  canAdvanceCursor,
  canAdvanceOffset,
  canRetreatCursor,
  canRetreatOffset,
  classifyResourceError,
  cursorPageLoaded,
  hasRenderableData,
  initialCursorPage,
  initialOffsetPage,
  isAbortError,
  offsetPageLoaded,
  retreatCursor,
  retreatOffset,
} from "../../src/frontend-kit";

/**
 * R88 agent plan P20: the canonical resource state model. A failed request
 * is never empty; unavailable (404/501/503) is distinct from forbidden (403)
 * and from error (429/5xx); 429 carries a retry hint.
 */
describe("P20 resource state classification", () => {
  it("maps 403 to forbidden — access denied is stated, never guessed", () => {
    const state = classifyResourceError(new PlatformClientError(403, "directory_claim_required", "You need an approved directory claim"));
    expect(state.phase).toBe("forbidden");
    if (state.phase === "forbidden") expect(state.reason).toContain("approved directory claim");
  });

  it("maps 404 to unavailable — private and absent both answer 404 (anti-enumeration)", () => {
    for (const [status, code] of [[404, "not_found"], [404, "not_published"], [501, "feature_unavailable"], [503, "payment_provider_unconfigured"]] as const) {
      const state = classifyResourceError(new PlatformClientError(status, code, "reason"));
      expect(state.phase).toBe("unavailable");
    }
  });

  it("maps 429 to error with a retry hint when the envelope carries one", () => {
    const withHint = classifyResourceError(new PlatformClientError(429, "too_many_open_requests", "slow down", { retry_after_seconds: 60 }));
    expect(withHint.phase).toBe("error");
    if (withHint.phase === "error") expect(withHint.retryAfterSeconds).toBe(60);
    const withoutHint = classifyResourceError(new PlatformClientError(429, "rate_limited", "slow down"));
    expect(withoutHint.phase).toBe("error");
    if (withoutHint.phase === "error") expect(withoutHint.retryAfterSeconds).toBeUndefined();
  });

  it("maps 5xx and network errors to error — an error is never an empty record", () => {
    expect(classifyResourceError(new PlatformClientError(500, "internal", "boom")).phase).toBe("error");
    expect(classifyResourceError(new Error("network down")).phase).toBe("error");
    expect(classifyResourceError("string error").phase).toBe("error");
  });

  it("recognizes abort errors and renderable data phases", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(hasRenderableData({ phase: "ready", data: 1 })).toBe(true);
    expect(hasRenderableData({ phase: "reloading", data: 1 })).toBe(true);
    expect(hasRenderableData({ phase: "loading" })).toBe(false);
    expect(hasRenderableData({ phase: "empty" })).toBe(false);
  });
});

describe("P20 pagination semantics", () => {
  it("cursor pager advances only on a server-provided cursor and can step back", () => {
    let page = initialCursorPage(20);
    expect(canAdvanceCursor(page)).toBe(false);
    expect(canRetreatCursor(page)).toBe(false);
    page = cursorPageLoaded(page, 9001);
    expect(canAdvanceCursor(page)).toBe(true);
    page = advanceCursor(page);
    expect(page.current).toBe(9001);
    expect(canRetreatCursor(page)).toBe(true);
    page = cursorPageLoaded(page, null);
    expect(canAdvanceCursor(page)).toBe(false);
    page = retreatCursor(page);
    expect(page.current).toBe(0);
  });

  it("offset pager bounds forward movement by the reported total", () => {
    let page = initialOffsetPage(12);
    page = offsetPageLoaded(page, 25);
    expect(canAdvanceOffset(page)).toBe(true);
    page = advanceOffset(page);
    expect(page.offset).toBe(12);
    // 25 items: offset 24 would hold exactly one item — still advanceable…
    expect(canAdvanceOffset(page)).toBe(true);
    page = advanceOffset(page);
    expect(page.offset).toBe(24);
    // …but offset 36 is beyond the total: refused.
    expect(canAdvanceOffset(page)).toBe(false);
    page = advanceOffset(page);
    expect(page.offset).toBe(24); // refused
    page = retreatOffset(page);
    expect(page.offset).toBe(12);
    page = retreatOffset(page);
    expect(page.offset).toBe(0);
    expect(canRetreatOffset(page)).toBe(false);
  });
});

describe("P20 bilingual locale resources", () => {
  it("every domain pack carries EN and FA for every key", () => {
    const packs = { BILLING, DIRECTORY, MONEY, RESOURCE_STATES, SERVICE_REQUESTS, WORKSPACES } as const;
    for (const [name, pack] of Object.entries(packs)) {
      for (const [key, text] of Object.entries(pack)) {
        const bilingual = text as { en?: unknown; fa?: unknown };
        expect(bilingual.en, `${name}.${key}.en`).toBeTruthy();
        expect(bilingual.fa, `${name}.${key}.fa`).toBeTruthy();
      }
    }
  });

  it("keeps the honest phrases the API modules ship (never softened)", () => {
    expect(SERVICE_REQUESTS.notAppointment.en).toBe("A service request is not a confirmed appointment.");
    expect(SERVICE_REQUESTS.notAppointment.fa).toBe("درخواست خدمت، نوبت تأییدشده نیست.");
    expect(WORKSPACES.workingSet.fa).toContain("ادعای مالکیت");
    expect(MONEY.tomanNote.en).toContain("display conversion only");
    expect(BILLING.trustNote.fa).toContain("هرگز");
    expect(DIRECTORY.credentialsNote.en).toContain("self-declared");
  });
});

describe("P20 frontend independence (acceptance: five entrypoints and style roots remain independent)", () => {
  const domainDir = join(__dirname, "../../src/frontend-kit/domain");

  it("the domain layer never imports a frontend skin, a stylesheet, or anything from src/web", () => {
    const files = readdirSync(domainDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      const source = readFileSync(join(domainDir, file), "utf8");
      expect(source, `${file} must not import src/web`).not.toMatch(/from\s+"[^"]*web\//);
      expect(source, `${file} must not import css`).not.toMatch(/\.css/);
    }
  });

  it("the shared layer adds semantics without a global fetch hook (no fetch/window globals in domain code)", () => {
    const files = readdirSync(domainDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    for (const file of files) {
      const source = readFileSync(join(domainDir, file), "utf8");
      expect(source, `${file} must not call fetch directly`).not.toMatch(/\bfetch\(/);
      expect(source, `${file} must not touch window`).not.toMatch(/\bwindow\b/);
    }
  });
});
