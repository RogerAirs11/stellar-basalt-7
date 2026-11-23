import { describe, expect, it } from "vitest";
import { effectiveDisclosure, MATERIALIZED_DISCLOSURE_SQL } from "../../src/privacy/publicationDecisions";

/**
 * R144-D02 (Master-AI plan): versioned publication decisions. These fixtures
 * pin the compatibility reader (decision log wins, legacy boolean fallback),
 * the materialized-match diagnostic and the shared SQL boundary predicate.
 */

describe("effectiveDisclosure compatibility reader (D02)", () => {
  it("falls back to the legacy boolean when no decision history exists", () => {
    expect(effectiveDisclosure({ public_disclosed: 1 }, [])).toEqual({ disclosed: true, source: "legacy_boolean", latest_version: null, materialized_matches: true });
    expect(effectiveDisclosure({ public_disclosed: 0 }, [])).toEqual({ disclosed: false, source: "legacy_boolean", latest_version: null, materialized_matches: true });
    expect(effectiveDisclosure({ public_disclosed: null }, [])).toEqual({ disclosed: false, source: "legacy_boolean", latest_version: null, materialized_matches: true });
  });

  it("the latest decision version wins over the legacy boolean", () => {
    const history = [
      { decision: "publish" as const, decision_version: 1 },
      { decision: "withdraw" as const, decision_version: 2 },
    ];
    expect(effectiveDisclosure({ public_disclosed: 1 }, history)).toEqual({ disclosed: false, source: "decision_log", latest_version: 2, materialized_matches: false });
  });

  it("accepts unordered history and a republish after withdrawal", () => {
    const history = [
      { decision: "withdraw" as const, decision_version: 3 },
      { decision: "publish" as const, decision_version: 1 },
      { decision: "publish" as const, decision_version: 4 },
    ];
    const state = effectiveDisclosure({ public_disclosed: 1 }, history);
    expect(state).toMatchObject({ disclosed: true, source: "decision_log", latest_version: 4, materialized_matches: true });
  });

  it("flags a desynchronized materialized boolean instead of silently trusting it", () => {
    const history = [{ decision: "publish" as const, decision_version: 1 }];
    expect(effectiveDisclosure({ public_disclosed: 0 }, history).materialized_matches).toBe(false);
  });
});

describe("shared SQL boundary predicate (D02)", () => {
  it("is the exact materialized predicate the derived surfaces read", () => {
    expect(MATERIALIZED_DISCLOSURE_SQL).toBe("COALESCE(public_disclosed,0)=1");
  });
});
