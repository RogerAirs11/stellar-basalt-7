import { describe, expect, it } from "vitest";
import { advancedRegistryParams, hasAdvancedRegistrySearch } from "../../src/web/advancedSearch";
import { HORSE_PLACEHOLDER_PHOTOS, horsePlaceholderBatch } from "../../src/web/sharedAssets";

describe("advanced registry search contract", () => {
  it("maps fine-grained fields to normalized browse params", () => {
    const value = {
      horseName: " Rakhsh ", horseId: "#123", registerNo: "IR-44",
      owner: "Ahmadi", breeder: "Karimi", importer: "", passportReceiver: "", sire: "Rostam", dam: "Golnar",
      place: "Tehran", yearFrom: "1990", yearTo: "2020",
    };
    expect(hasAdvancedRegistrySearch(value)).toBe(true);
    expect(advancedRegistryParams(value)).toEqual({
      name: "Rakhsh", id: "123", register: "IR-44", owner: "Ahmadi", breeder: "Karimi",
      sire: "Rostam", dam: "Golnar", place: "Tehran", yearFrom: "1990", yearTo: "2020",
    });
  });

  it("does not send malformed year bounds", () => {
    const value = {
      horseName: "", horseId: "", registerNo: "", owner: "", breeder: "", importer: "", passportReceiver: "",
      sire: "", dam: "", place: "", yearFrom: "90", yearTo: "twenty",
    };
    expect(advancedRegistryParams(value).yearFrom).toBeUndefined();
    expect(advancedRegistryParams(value).yearTo).toBeUndefined();
  });
});

describe("shared horse photo batching", () => {
  it("is deterministic and avoids duplicate photos inside a short visible group", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `horse-${i + 1}`);
    const a = horsePlaceholderBatch(keys, "registry-test");
    const b = horsePlaceholderBatch(keys, "registry-test");
    expect(a.map(x => x.src)).toEqual(b.map(x => x.src));
    expect(new Set(a.map(x => x.src)).size).toBe(Math.min(a.length, HORSE_PLACEHOLDER_PHOTOS.length));
  });
});
