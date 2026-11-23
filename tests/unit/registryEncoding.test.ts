import { describe, expect, it } from "vitest";
import {
  breedEncoding,
  coatColorEncoding,
  horseLifecycleLabel,
  horseLifecycleState,
  horseSexKind,
  horseSexSymbol,
  registrySexKind,
} from "../../src/frontend-kit/registryEncoding";

describe("R128 semantic encoding brain", () => {
  it("classifies the real registry sex vocabulary", () => {
    expect(horseSexKind("Filly")).toBe("female");
    expect(horseSexKind("Colt")).toBe("male");
    expect(horseSexKind("Mare")).toBe("female");
    expect(horseSexKind("Stallion")).toBe("male");
    expect(horseSexKind("Geld.")).toBe("unknown");
    expect(horseSexKind("مادیان")).toBe("female");
    expect(horseSexSymbol("male")).toBe("♂");
    expect(horseSexSymbol("female")).toBe("♀");
    // The registry-tolerant wrapper must catch the source abbreviations.
    expect(registrySexKind("Geld.")).toBe("gelding");
    expect(registrySexKind("Geld")).toBe("gelding");
    expect(registrySexKind("Filly")).toBe("female");
    expect(registrySexKind("Colt")).toBe("male");
    expect(registrySexKind(null)).toBe("unknown");
  });

  it("resolves the leading coat colors into physical swatches with localized labels", () => {
    const bay = coatColorEncoding("Bay", "fa");
    expect(bay?.className).toBe("coat-bay");
    expect(bay?.swatch).toBe("#7a4a21");
    expect(bay?.label).toBe("کهر");
    expect(coatColorEncoding("dk/ Bay", "fa")?.className).toBe("coat-darkbay");
    expect(coatColorEncoding("GREY", "en")?.label).toBe("Grey");
    expect(coatColorEncoding("Chestnut", "ar")?.label).toBe("كستنائي");
    expect(coatColorEncoding("Skewbald", "en")?.swatchAlt).toBeDefined();
    // Unknown coats degrade to null — never a gatekeeper.
    expect(coatColorEncoding("sparkle rainbow", "fa")).toBeNull();
    expect(coatColorEncoding("", "fa")).toBeNull();
    expect(coatColorEncoding(null, "fa")).toBeNull();
  });

  it("resolves the real breed inventory into stable hue families", () => {
    expect(breedEncoding("Arabian", "fa")?.tone).toBe("arabian");
    expect(breedEncoding("Arabian", "fa")?.label).toBe("عرب");
    expect(breedEncoding("Part Bred", "en")?.tone).toBe("partbred");
    expect(breedEncoding("Thoroughbred", "fa")?.label).toBe("تروبرد");
    expect(breedEncoding("Turkoman", "fa")?.label).toBe("ترکمن");
    expect(breedEncoding("Sport Horses", "fa")?.label).toBe("اسب ورزشی");
    expect(breedEncoding("Kurdish", "fa")?.label).toBe("کردی");
    expect(breedEncoding("Persian Plateau", "fa")?.label).toBe("فلات ایران");
    expect(breedEncoding("Caspian", "fa")?.label).toBe("کاسپین");
    expect(breedEncoding("Darehshouri", "fa")?.label).toBe("دره‌شوری");
    expect(breedEncoding("Warmblood nonsense", "fa")).toBeNull();
  });

  it("derives the lifecycle state and its localized label", () => {
    expect(horseLifecycleState(1, 0)).toBe("active");
    expect(horseLifecycleState(0, 0)).toBe("inactive");
    expect(horseLifecycleState(0, 1)).toBe("deceased");
    expect(horseLifecycleState(1, 1)).toBe("deceased");
    expect(horseLifecycleLabel("active", "fa")).toBe("فعال");
    expect(horseLifecycleLabel("deceased", "en")).toBe("Deceased");
    expect(horseLifecycleLabel("inactive", "ar")).toBe("غير نشط");
  });
});
