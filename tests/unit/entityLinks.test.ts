import { describe, expect, it } from "vitest";
import { linkEntityMentions } from "../../src/frontend-kit/ai/entityLinks";
import type { AiEntityReference } from "../../src/contracts/platform";

function ref(kind: "horse" | "person", id: number, label: string): AiEntityReference {
  return { kind, id, label, href: `/${kind === "horse" ? "horse" : "person"}/${id}` } as unknown as AiEntityReference;
}

describe("linkEntityMentions", () => {
  it("links horse and person names mentioned in plain text", () => {
    const result = linkEntityMentions("Nazeer was bred by the EAO, while *Bask++ came from Poland.", [
      ref("horse", 12, "Nazeer"),
      ref("horse", 77, "*Bask++"),
      ref("person", 5, "EAO"),
    ]);
    expect(result.text).toContain("[Nazeer](/horse/12)");
    expect(result.text).toContain("[\\*Bask++](/horse/77)");
    expect(result.linkedKeys.has("horse:12")).toBe(true);
    expect(result.linkedKeys.has("horse:77")).toBe(true);
    expect(result.linkedKeys.has("person:5")).toBe(true);
  });

  it("uses whole-word Unicode boundaries so partial names are untouched", () => {
    const result = linkEntityMentions("Nazeerabad is a place, not Nazeer the stallion.", [ref("horse", 12, "Nazeer")]);
    expect(result.text).not.toContain("Nazeerabad](/horse");
    expect(result.text).toContain("[Nazeer](/horse/12)");
  });

  it("prefers the longest label when one is a prefix of another", () => {
    const result = linkEntityMentions("Shagya Azraf and Shagya both appear.", [
      ref("horse", 3, "Shagya"),
      ref("horse", 9, "Shagya Azraf"),
    ]);
    expect(result.text).toContain("[Shagya Azraf](/horse/9)");
    expect(result.linkedKeys.has("horse:9")).toBe(true);
  });

  it("never rewrites existing markdown links, code, or URLs", () => {
    const text = "See [Nazeer](https://example.com/Nazeer) and `Nazeer` and https://x/Nazeer plus Nazeer again.";
    const result = linkEntityMentions(text, [ref("horse", 12, "Nazeer")]);
    expect(result.text).toContain("[Nazeer](https://example.com/Nazeer)");
    expect(result.text).toContain("`Nazeer`");
    expect(result.text).toContain("https://x/Nazeer");
    expect(result.text.endsWith("[Nazeer](/horse/12) again.")).toBe(true);
    expect(result.linkedKeys.has("horse:12")).toBe(true);
  });

  it("handles Persian labels and labels with regex metacharacters", () => {
    const result = linkEntityMentions("اسب ناصری (Nazeer) مشهور بود و «عناب» هم این‌جا بود.", [
      ref("horse", 12, "Nazeer"),
      ref("horse", 30, "عناب"),
    ]);
    expect(result.text).toContain("[Nazeer](/horse/12)");
    expect(result.text).toContain("[عناب](/horse/30)");
  });

  it("returns text unchanged with no refs or short labels", () => {
    expect(linkEntityMentions("Plain text", []).text).toBe("Plain text");
    expect(linkEntityMentions("An Ab", [ref("horse", 1, "Ab")]).text).toBe("An Ab");
    expect(linkEntityMentions("Content ref only", [{ kind: "content", id: 2, label: "Post", href: "/newsroom/x" } as unknown as AiEntityReference]).text).toBe("Content ref only");
  });
});
