import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRouteId } from "../../src/frontend-kit/routes";
import { listingLifecycleView } from "../../src/frontend-kit";

/**
 * R108-06 — route validation and malformed-expiry presentation.
 *
 * Acceptance:
 *  1. 0, -1, 1.5, unsafe integers and /edit trailing junk produce NO mutation
 *     request: parseRouteId rejects them all, and every skin entry routes
 *     ids through the shared parser (source locks) with a localized
 *     invalid-route view when the shape matched but the id is malformed.
 *  2. SQL timestamps, ISO Z and offsets render consistent expiry; malformed
 *     dates show an explanation in EN/FA: listingLifecycleView maps all three
 *     textual forms to the same instant (same expired verdict), and every
 *     marketplace presentation carries explicit invalid-expiry copy
 *     (source locks, EN + FA).
 *  3. Normal valid deep links keep working: valid ids parse, valid routes
 *     still open the editors (source locks on the entry regexes).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string): string => readFileSync(join(root, relative), "utf8");

describe("R108-06 A. the one safe route-id parser", () => {
  it("accepts exactly the positive safe integers", () => {
    expect(parseRouteId("1")).toBe(1);
    expect(parseRouteId("42")).toBe(42);
    expect(parseRouteId("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects zero, negatives, fractions, signs and junk — no SDK call possible", () => {
    expect(parseRouteId("0")).toBeNull();
    expect(parseRouteId("-1")).toBeNull();
    expect(parseRouteId("1.5")).toBeNull();
    expect(parseRouteId("+7")).toBeNull();
    expect(parseRouteId("1e3")).toBeNull();
    expect(parseRouteId("0x10")).toBeNull();
    expect(parseRouteId("abc")).toBeNull();
    expect(parseRouteId("42/edit")).toBeNull();
    expect(parseRouteId(" 42")).toBeNull();
    expect(parseRouteId("42 ")).toBeNull();
  });

  it("rejects precision-losing overflow (the Number() coercion gap)", () => {
    // 20 nines: matches \d+ regexes and coerces to an unsafe float — the
    // exact case the old `Number(match[1]) || null` entries let through.
    expect(parseRouteId("99999999999999999999")).toBeNull();
    expect(parseRouteId("9007199254740992")).toBeNull();
  });

  it("rejects missing/empty segments (create mode stays explicit)", () => {
    expect(parseRouteId(undefined)).toBeNull();
    expect(parseRouteId(null)).toBeNull();
    expect(parseRouteId("")).toBeNull();
  });
});

describe("R108-06 B. every entry routes ids through the shared parser (source locks)", () => {
  it("retro native editors and classic-registry entries validate IDs and render localized invalid views", () => {
    const retro = read("src/web/frontends/retro-astra/entry.tsx");
    expect(retro).toContain("RetroAstraDonorTransplant");
    const retroApp = read("src/web/frontends/retro-astra/transplant/App.tsx");
    const retroControls = read("src/web/frontends/retro-astra/EditorControls.tsx");
    expect(retroApp).toContain("positiveEditorTarget(route.id)");
    expect(retroApp).toContain("invalidTarget={!!route.id && editorTarget === null}");
    expect(retroControls).toContain("Number.isSafeInteger(id) && id > 0");
    expect(retroControls).toContain("شناسه رکورد نامعتبر است");
    expect(retroControls).toContain("record ID is invalid");

    const classic = read("src/web/frontends/classic-registry/entry.tsx");
    expect(classic).toContain("parseRouteId(profileEditorMatch?.[1])");
    expect(classic).toContain("parseRouteId(orgEditorMatch?.[1])");
    expect(classic).toContain("ClassicInvalidRoute");
    expect(classic).toContain("شناسه باید یک عدد صحیح مثبت باشد");
    expect(classic).toContain("must be a positive whole number");
  });

  it("no skin entry coerces a route capture with bare Number() anymore", () => {
    for (const entry of [
      "src/web/frontends/retro-astra/entry.tsx",
      "src/web/frontends/classic-registry/entry.tsx",
      "src/web/frontends/equidata-elite/entry.tsx",
    ]) {
      const source = read(entry);
      expect(source.match(/Number\([^)]*match\([^)]*\)[^)]*\)/), entry).toBeNull();
    }
  });

  it("valid deep links still open both native Retro editors and the Classic host editors", () => {
    const retro = read("src/web/frontends/retro-astra/transplant/App.tsx");
    expect(retro).toContain("route.page === 'directory-profile'");
    expect(retro).toContain("personId={editorTarget}");
    expect(retro).toContain("route.page === 'organization-profile'");
    expect(retro).toContain("organizationId={editorTarget}");
    const classic = read("src/web/frontends/classic-registry/entry.tsx");
    expect(classic).toContain("/^\\/directory-profile(?:\\/(\\d+))?$/");
    expect(classic).toContain("/^\\/organization-profile(?:\\/(\\d+))?$/");
  });
});

describe("R108-06 C. expiry consistency and malformed-expiry explanations", () => {
  const base = (expires_at: string | null) => listingLifecycleView({
    listing: { status: "active", expires_at, suspended: false, seller_mandate_current: true },
    viewerRole: "buyer",
  });

  it("SQL, ISO Z and offset forms of the SAME instant agree", () => {
    const sql = base("2027-03-01 09:00:00"); // SQL convention: offset-less = UTC
    const iso = base("2027-03-01T09:00:00Z");
    const offset = base("2027-03-01T12:30:00+03:30"); // same instant, other zone
    for (const view of [sql, iso, offset]) {
      expect(view.expiryStatus).toBe("valid");
      expect(view.expired).toBe(false);
      expect(view.effectiveStatus).toBe("active");
    }
    // And the past forms agree the same way.
    const pastSql = base("2021-03-01 09:00:00");
    const pastIso = base("2021-03-01T09:00:00Z");
    for (const view of [pastSql, pastIso]) {
      expect(view.expired).toBe(true);
      expect(view.effectiveStatus).toBe("expired");
    }
  });

  it("malformed and impossible dates are invalid — never silently valid, never 'expired'", () => {
    for (const bad of ["not-a-date", "2027-02-30 00:00:00", "2027-13-01T00:00:00Z", "2027-03-01T25:00:00Z", "", "next tuesday"]) {
      const view = base(bad);
      expect(view.expiryStatus, bad).toBe("invalid");
      expect(view.expired, bad).toBe(false); // malformed is NOT proof of expiry
      expect(view.effectiveStatus, bad).toBe("active"); // and not a fake expiry either
    }
  });

  it("an invalid expiry cannot authorize publication or inquiry (public action fields)", () => {
    for (const bad of ["not-a-date", "2027-02-30 00:00:00"]) {
      const seller = listingLifecycleView({
        listing: { status: "draft", expires_at: bad, suspended: false, seller_mandate_current: true },
        viewerRole: "seller",
      });
      expect(seller.sellerActions, bad).not.toContain("active");
      expect(seller.sellerActions, bad).not.toContain("pending_sale");
      const buyer = listingLifecycleView({
        listing: { status: "active", expires_at: bad, suspended: false, seller_mandate_current: true },
        viewerRole: "buyer",
      });
      expect(buyer.buyerActions, bad).not.toContain("inquire");
      // A VALID expiry with the same shape does allow both (control).
      const sellerControl = listingLifecycleView({
        listing: { status: "draft", expires_at: "2027-03-01 09:00:00", suspended: false, seller_mandate_current: true },
        viewerRole: "seller",
      });
      expect(sellerControl.sellerActions).toContain("active");
      const buyerControl = listingLifecycleView({
        listing: { status: "active", expires_at: "2027-03-01 09:00:00", suspended: false, seller_mandate_current: true },
        viewerRole: "buyer",
      });
      expect(buyerControl.buyerActions).toContain("inquire");
    }
  });

  it("null expiry stays 'none' — unknown is distinct from not expiring vs invalid", () => {
    const none = base(null);
    expect(none.expiryStatus).toBe("none");
    expect(none.expired).toBe(false);
  });

  it("every React marketplace presentation carries explicit localized invalid-expiry copy", () => {
    const heritage = read("src/web/heritage/MarketplacePage.tsx");
    expect(heritage).toContain('lifecycle.expiryStatus === "invalid"');
    expect(heritage).toContain("تاریخ انقضای این آگهی نامعتبر است");
    expect(heritage).toContain("expiry date is invalid");

    const elite = read("src/web/frontends/equidata-elite/recordModules.tsx");
    expect(elite).toContain('lifecycle.expiryStatus === "invalid"');
    expect(elite).toContain("تاریخ انقضای این آگهی نامعتبر است");

    const fei = read("src/web/frontends/fei-classic/recordModules.tsx");
    expect(fei).toContain('lifecycle.expiryStatus === "invalid"');
    expect(fei).toContain("تاریخ انقضای این آگهی نامعتبر است");

    const retro = read("src/web/frontends/retro-astra/transplant/pages/ReadDesks.tsx");
    expect(retro).toMatch(/lifecycle\.expiryStatus\s*===\s*['"]invalid['"]/);
    expect(retro).toContain("تاریخ انقضا نامعتبر");
    expect(retro).toMatch(/invalid expiry date/i);
  });
});
