import { LISTING_TRANSITIONS as SERVER_LISTING_TRANSITIONS } from "../../src/marketplace/policy";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LISTING_LIFECYCLE,
  MARKETPLACE_DISCLOSURE,
  listingLifecycleView,
  classifyMarketplaceError,
  conversationThread,
} from "../../src/frontend-kit/domain/marketplace";
import { PlatformClientError } from "../../src/frontend-kit/errors";

/**
 * R98-N12 unit evidence — the ONE headless marketplace controller shared by
 * every frontend: the lifecycle map, the honest disclosure, error-state
 * classification, the conversation thread model, and the SOURCE PINS proving
 * (a) the kit's lifecycle map mirrors the server policy exactly, (b) the
 * kit's disclosure mirrors the server constant exactly, and (c) every
 * frontend marketplace surface binds the shared controller instead of
 * re-implementing lifecycle/error semantics locally.
 */

const ROOT = join(__dirname, "../..");

describe("N12 the lifecycle map mirrors the server policy (source pin)", () => {
  it("LISTING_LIFECYCLE is exactly src/marketplace/policy.ts LISTING_TRANSITIONS", () => {
    // R117: object identity proves a shared authority, not two copied literals.
    expect(LISTING_LIFECYCLE).toBe(SERVER_LISTING_TRANSITIONS);
    expect(Object.isFrozen(LISTING_LIFECYCLE)).toBe(true);
    for (const value of Object.values(LISTING_LIFECYCLE)) expect(Object.isFrozen(value)).toBe(true);
    // Terminal sold never silently resurrects.
    expect(LISTING_LIFECYCLE.sold).toEqual([]);
  });
});

describe("N12 the disclosure mirrors the server constant (source pin)", () => {
  it("MARKETPLACE_DISCLOSURE is byte-identical to the server's MARKETPLACE_INTRODUCTION_DISCLOSURE", async () => {
    const serverModule = await import("../../src/api/modules/marketplace");
    expect(MARKETPLACE_DISCLOSURE.role).toBe(serverModule.MARKETPLACE_INTRODUCTION_DISCLOSURE.role);
    expect(MARKETPLACE_DISCLOSURE.en).toBe(serverModule.MARKETPLACE_INTRODUCTION_DISCLOSURE.en);
    expect(MARKETPLACE_DISCLOSURE.fa).toBe(serverModule.MARKETPLACE_INTRODUCTION_DISCLOSURE.fa);
    expect(MARKETPLACE_DISCLOSURE.en).toContain("does not escrow");
  });
});

describe("N12 all five frontends bind the ONE shared marketplace semantics", () => {
  const FRONTEND_SURFACES: Array<{ path: string; marker: string }> = [
    { path: "src/web/heritage/MarketplacePage.tsx", marker: "listingLifecycleView" },
    { path: "src/web/frontends/equidata-elite/recordModules.tsx", marker: "listingLifecycleView" },
    { path: "src/web/frontends/retro-astra/transplant/pages/ReadDesks.tsx", marker: "listingLifecycleView" },
    // Classic Registry surfaces market through the host layer (manifest surface
    // declaration) — its embedded pages are the Heritage surfaces above.
    { path: "src/web/frontends/classic-registry/manifest.ts", marker: "market_data" },
    // FEI Classic's native market page (recordModules) also binds the shared
    // controller — all FIVE visual frontends share the ONE lifecycle semantics.
    { path: "src/web/frontends/fei-classic/recordModules.tsx", marker: "listingLifecycleView" },
  ];
  for (const surface of FRONTEND_SURFACES) {
    it(`${surface.path} carries the shared marker '${surface.marker}'`, () => {
      const source = readFileSync(join(ROOT, surface.path), "utf8");
      expect(source).toContain(surface.marker);
    });
  }
  it("the Heritage and EquiData inquiry surfaces carry the disclosure (introduction-only, EN+FA)", () => {
    expect(readFileSync(join(ROOT, "src/web/heritage/MarketplacePage.tsx"), "utf8")).toContain("MARKETPLACE_DISCLOSURE");
    expect(readFileSync(join(ROOT, "src/web/frontends/equidata-elite/recordModules.tsx"), "utf8")).toContain("MARKETPLACE_DISCLOSURE");
    expect(readFileSync(join(ROOT, "src/web/frontends/retro-astra/transplant/pages/ReadDesks.tsx"), "utf8")).toContain("MARKETPLACE_DISCLOSURE");
  });
});

describe("N12 listingLifecycleView — honest states", () => {
  it("an active listing past its expiry is EFFECTIVELY expired; publication-family transitions need a current mandate", () => {
    const view = listingLifecycleView({
      listing: { status: "active", expires_at: "2026-01-01 00:00:00" },
      viewerRole: "seller",
      now: new Date("2026-10-06T00:00:00.000Z"),
    });
    expect(view.effectiveStatus).toBe("expired");
    expect(view.expired).toBe(true);
    // Without a known mandate the seller cannot attempt reactivation.
    expect(view.sellerActions).not.toContain("active");
  });

  it("a current mandate + live listing opens the seller transitions and the buyer research actions", () => {
    const seller = listingLifecycleView({
      listing: { status: "active", expires_at: null, seller_mandate_current: true },
      viewerRole: "seller",
    });
    expect(seller.sellerActions).toEqual(["pending_sale", "sold", "withdrawn", "expired"]);
    const buyer = listingLifecycleView({
      listing: { status: "active", expires_at: null, seller_mandate_current: true, watched: false },
      viewerRole: "buyer",
    });
    expect(buyer.buyerActions).toContain("inquire");
    expect(buyer.buyerActions).toContain("watch");
  });

  it("a suspended listing never offers inquiry; an expired mandate never offers publication", () => {
    const suspended = listingLifecycleView({ listing: { status: "active", expires_at: null, suspended: true, seller_mandate_current: true }, viewerRole: "buyer" });
    expect(suspended.buyerActions).not.toContain("inquire");
    const expiredMandate = listingLifecycleView({ listing: { status: "active", expires_at: null, seller_mandate_current: false }, viewerRole: "seller" });
    expect(expiredMandate.sellerActions).toEqual(["sold", "withdrawn", "expired"]);
    expect(expiredMandate.buyerActions).not.toContain("inquire");
  });
});

describe("N12 classifyMarketplaceError — distinct, actionable, never guessing", () => {
  it("a 409 version conflict carries the current version for a reload", () => {
    const state = classifyMarketplaceError(new PlatformClientError(409, "listing_version_conflict", "changed", { current_version: 7 }));
    expect(state).toMatchObject({ kind: "version_conflict", currentVersion: 7 });
  });
  it("a 410 mandate expiry is a terminal explained state", () => {
    expect(classifyMarketplaceError(new PlatformClientError(410, "seller_authority_expired", "expired")))
      .toMatchObject({ kind: "mandate_expired" });
  });
  it("the neutral inquiry refusal stays NEUTRAL — no block is implied or surfaced", () => {
    const state = classifyMarketplaceError(new PlatformClientError(403, "inquiry_refused", "This inquiry cannot be submitted."));
    expect(state).toMatchObject({ kind: "inquiry_refused_neutral" });
    expect("message" in state && state.message).not.toContain("block");
  });
  it("a closed conversation is inquiry_closed; a non-participant is participant_required; 404 is not_found", () => {
    expect(classifyMarketplaceError(new PlatformClientError(409, "inquiry_closed", "closed"))).toMatchObject({ kind: "inquiry_closed" });
    expect(classifyMarketplaceError(new PlatformClientError(403, "inquiry_participant_required", "participants"))).toMatchObject({ kind: "participant_required" });
    expect(classifyMarketplaceError(new PlatformClientError(404, "not_found", "missing"))).toMatchObject({ kind: "not_found" });
  });
});

describe("N12 conversationThread — one honest thread model", () => {
  it("the opening message becomes the first buyer entry; replies keep their sides; sold/withdrawn listings say so", () => {
    const thread = conversationThread({
      inquiry: { id: "inq-1", listing_id: "l-1", status: "contacted", row_version: 2, created_at: "2026-10-01 08:00", message: "Is he still for sale?", buyer_name: "B", buyer_contact: "+98" },
      listing_status: "sold",
      listing_expires_at: null,
      listing_title: null,
      replies: [
        { id: "r-1", author_side: "seller", body: "Yes.", created_at: "2026-10-01 09:00" },
        { id: "r-2", author_side: "buyer", body: "I will visit.", created_at: "2026-10-02 10:00" },
      ],
      viewer_side: "buyer",
      staff_dispute_case: null,
      disclosure: MARKETPLACE_DISCLOSURE,
    });
    expect(thread.entries.map((entry) => entry.side)).toEqual(["buyer", "seller", "buyer"]);
    expect(thread.open).toBe(true);
    expect(thread.listingStatusNote?.en).toContain("sold");
    expect(thread.listingStatusNote?.fa).toContain("فروخته");
  });
  it("a closed inquiry is not open, but its history stays readable in the model", () => {
    const thread = conversationThread({
      inquiry: { id: "inq-2", listing_id: "l-1", status: "closed", row_version: 3, created_at: "2026-10-01 08:00", message: "Hello", buyer_name: "B", buyer_contact: "+98" },
      listing_status: "active",
      listing_expires_at: null,
      listing_title: null,
      replies: [],
      viewer_side: "seller",
      staff_dispute_case: null,
      disclosure: MARKETPLACE_DISCLOSURE,
    });
    expect(thread.open).toBe(false);
    expect(thread.entries).toHaveLength(1);
    expect(thread.listingStatusNote).toBeNull();
  });
});
