import { describe, expect, it } from "vitest";
import { compactText, normalizeText, tokens } from "../../src/search/normalize";

describe("search normalization", () => {
  it("normalizes Arabic/Persian character variants and digits", () => {
    expect(normalizeText("  كيان ١٢۳  ")).toBe("کیان 123");
  });
  it("normalizes punctuation and spacing", () => {
    expect(normalizeText("NOVA-H.S. / Grey")).toBe("nova h s grey");
    expect(compactText("NOVA H S")).toBe("novahs");
    expect(tokens("  one   two ")).toEqual(["one", "two"]);
  });
});
