import { describe, expect, it } from "vitest";
import {
  emptyRegistryUrlState,
  parseRegistryUrlState,
  serializeRegistryUrlState,
} from "../../src/frontend-kit/registryUrlState";

describe("D14 registry URL query-state contract", () => {
  it("parses a full structured URL into typed state", () => {
    const state = parseRegistryUrlState("?q=zephyr&breed=Arabian&lifecycle=active&sort=year&dir=desc&offset=100&mode=registry&isImported=1&yearFrom=2010&yearTo=2019&decade=1990&owner=Kerry");
    expect(state.q).toBe("zephyr");
    expect(state.mode).toBe("registry");
    expect(state.breed).toBe("Arabian");
    expect(state.lifecycle).toBe("active");
    expect(state.sort).toBe("year");
    expect(state.dir).toBe("desc");
    expect(state.offset).toBe(100);
    expect(state.flag).toBe("imported");
    expect(state.advanced.yearFrom).toBe("2010");
    expect(state.advanced.yearTo).toBe("2019");
    expect(state.advanced.owner).toBe("Kerry");
    expect(state.decade).toBe("1990");
  });

  it("round-trips serialize -> parse -> serialize stably", () => {
    const state = {
      ...emptyRegistryUrlState(),
      q: "mare", advanced: { ...emptyRegistryUrlState().advanced, horseName: "Smoke", sire: "Old Star" },
      breed: "Arabian", flag: "sport" as const, sort: "name" as const, dir: "desc" as const, offset: 50,
      mode: "registry" as const,
    };
    const url = serializeRegistryUrlState(state);
    const parsed = parseRegistryUrlState(url.split("?")[1] ?? "");
    expect(serializeRegistryUrlState(parsed)).toBe(url);
  });

  it("rejects invalid sort/dir/offset/mode values instead of propagating them", () => {
    const state = parseRegistryUrlState("?sort=exploit&dir=sideways&offset=-50&mode=hack");
    expect(state.sort).toBe("importance");
    expect(state.dir).toBe("desc");
    expect(state.offset).toBe(0);
    expect(state.mode).toBeNull();
  });

  it("opens the registry significance-first and only serializes an explicit non-default sort", () => {
    // R135: the explorer opens with the most significant horses first
    // (photographed champions / foundation sires / sport records). R128's
    // alphabetical default and the id-asc default before it both remain
    // available as explicit choices.
    expect(emptyRegistryUrlState().sort).toBe("importance");
    expect(emptyRegistryUrlState().dir).toBe("desc");
    expect(serializeRegistryUrlState(emptyRegistryUrlState())).toBe("/browse");
    expect(serializeRegistryUrlState({ ...emptyRegistryUrlState(), sort: "id", dir: "asc" })).toBe("/browse?sort=id"); // id keeps its natural asc
    expect(serializeRegistryUrlState({ ...emptyRegistryUrlState(), sort: "year", dir: "desc" })).toBe("/browse?sort=year"); // year keeps its natural desc
    expect(serializeRegistryUrlState({ ...emptyRegistryUrlState(), sort: "importance", dir: "asc" })).toBe("/browse?dir=asc"); // default sort omitted; only the reversed direction serializes
    expect(parseRegistryUrlState("?sort=id").sort).toBe("id");
    expect(parseRegistryUrlState("?sort=importance").dir).toBe("desc");
  });

  it("serializes the UI flag as server-facing boolean parameters", () => {
    const url = serializeRegistryUrlState({ ...emptyRegistryUrlState(), flag: "stallion" });
    expect(url).toBe("/browse?isStallion=1");
    expect(parseRegistryUrlState(url.split("?")[1]).flag).toBe("stallion");
  });

  it("omits defaults so ordinary reads keep clean URLs", () => {
    expect(serializeRegistryUrlState(emptyRegistryUrlState())).toBe("/browse");
  });

  it("keeps a lone text query in legacy smart mode when mode is absent", () => {
    const state = parseRegistryUrlState("?q=arabian");
    expect(state.q).toBe("arabian");
    expect(state.mode).toBeNull();
  });
});
