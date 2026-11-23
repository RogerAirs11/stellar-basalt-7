import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { horseSexKind } from "../../src/frontend-kit";
import { donorSexCategory, sexScopeTabs } from "../../src/web/frontends/retro-astra/transplant/data/horses";
import { buildAncestry } from "../../src/web/frontends/retro-astra/transplant/features/pedigree/model";
import type { Horse } from "../../src/web/frontends/retro-astra/transplant/data/horses";

/**
 * R117-29 (Master AI R117 handoff, parents D28/D34): remove the remaining
 * coarse Retro classification assumptions. Three separate layers, never
 * conflated:
 *   1. source record — raw sex_desc, never rewritten (recordedSex);
 *   2. display category — the donor enum derived from the canonical kit
 *      classifier (exact vocabulary), decoration only;
 *   3. breeding position — the recorded parent relationship (pedigree model
 *      node.side), never the icon.
 * Fixtures per the reviewed ticket action 4:
 * male/stallion/colt/female/mare/filly/gelding/unknown, EN + FA + case.
 */
const read = (relative: string) => readFileSync(join(__dirname, relative), "utf8");
const transplant = "../../src/web/frontends/retro-astra/transplant";

const FIXTURES: Array<[string | null | undefined, "male" | "female" | "gelding" | "unknown"]> = [
  ["male", "male"], ["stallion", "male"], ["colt", "male"], ["Stallion", "male"], ["STALLION", "male"],
  ["نریان", "male"], ["کره نر", "male"], ["نر", "male"],
  ["female", "female"], ["mare", "female"], ["filly", "female"], ["Mare", "female"],
  ["مادیان", "female"], ["کره ماده", "female"], ["ماده", "female"],
  ["gelding", "gelding"], ["Gelding", "gelding"], ["geld", "gelding"], ["اخته", "gelding"], ["اسب اخته", "gelding"],
  ["unknown", "unknown"], ["", "unknown"], [null, "unknown"], [undefined, "unknown"],
  ["Not a stallion", "unknown"], ["stallionish", "unknown"],
];

describe("R117-29 canonical classification (kit horseSexKind, exact vocabulary)", () => {
  it("classifies the full mixed fixture set, EN + FA + case variants", () => {
    for (const [value, expected] of FIXTURES) expect(horseSexKind(value as string | null | undefined), String(value)).toBe(expected);
  });
});

describe("R117-29 donor display category (donorSexCategory derives from the kit, never rewrites the record)", () => {
  it("colt and کره نر are Stallion-class; filly, کره ماده and ماده are Mare-class — the pre-R117-29 regex left all four Unknown", () => {
    expect(donorSexCategory("colt")).toBe("Stallion");
    expect(donorSexCategory("کره نر")).toBe("Stallion");
    expect(donorSexCategory("filly")).toBe("Mare");
    expect(donorSexCategory("کره ماده")).toBe("Mare");
    expect(donorSexCategory("ماده")).toBe("Mare");
  });
  it("maps every fixture consistently with the kit classifier", () => {
    const expectedEnum = { male: "Stallion", female: "Mare", gelding: "Gelding", unknown: "Unknown" } as const;
    for (const [value, kind] of FIXTURES) {
      expect(donorSexCategory(value as string | null | undefined), String(value)).toBe(expectedEnum[kind]);
    }
  });
  it("is a pure category — substring guessing is gone", () => {
    expect(donorSexCategory("Not a stallion")).toBe("Unknown");
    expect(donorSexCategory("stallionish")).toBe("Unknown");
  });
});

describe("R117-29 registry sex scope tabs (filtering agrees with the backend, not the icon)", () => {
  it("tabs are the server facets' RAW values — colt, filly and Persian values are reachable, the old hardcoded enum made them invisible", () => {
    const tabs = sexScopeTabs(
      [
        { value: "Stallion", count: 40 },
        { value: "مادیان", count: 30 },
        { value: "Colt", count: 5 },
        { value: "Filly", count: 3 },
        { value: "Gelding", count: 2 },
        { value: "اخته", count: 1 },
      ],
      [],
      81,
    );
    expect(tabs[0]).toEqual({ value: "", count: 81 });
    expect(tabs.map(tab => tab.value)).toEqual(["", "Stallion", "مادیان", "Colt", "Filly", "Gelding"]);
    expect(tabs.find(tab => tab.value === "Colt")?.count).toBe(5);
  });
  it("caps the tab row at the requested maximum (the advanced-filter select still lists every value)", () => {
    const tabs = sexScopeTabs(
      [
        { value: "a", count: 1 }, { value: "b", count: 1 }, { value: "c", count: 1 },
        { value: "d", count: 1 }, { value: "e", count: 1 }, { value: "f", count: 1 },
      ],
      [],
      6,
    );
    expect(tabs).toHaveLength(6); // All + 5
  });
  it("never turns an empty recorded value into a tab", () => {
    const tabs = sexScopeTabs([{ value: "", count: 9 }, { value: "mare", count: 4 }], [], 13);
    expect(tabs.map(tab => tab.value)).toEqual(["", "mare"]);
  });
  it("degraded fallback (no facets): distinct recorded values on the page, counted case-insensitively to mirror SQL COLLATE NOCASE", () => {
    const page = [
      { recordedSex: "stallion" }, { recordedSex: "Stallion" }, { recordedSex: "colt" },
      { recordedSex: null }, { recordedSex: "" }, { recordedSex: "مادیان" }, { recordedSex: undefined as unknown as null },
    ];
    const tabs = sexScopeTabs(null, page, 7);
    expect(tabs[0]).toEqual({ value: "", count: 7 });
    expect(tabs.map(tab => tab.value)).toEqual(["", "stallion", "colt", "مادیان"]);
    expect(tabs.find(tab => tab.value === "stallion")?.count).toBe(2);
    expect(tabs.find(tab => tab.value === "colt")?.count).toBe(1);
    expect(tabs.find(tab => tab.value === "مادیان")?.count).toBe(1);
  });
});

describe("R117-29 breeding position (structural side from recorded parent relationships)", () => {
  const base = { breed: "—", coat: "—", country: "—", height: "—", status: "Active" as const, image: "", imageCanonical: false, stud: "—", owner: "—", registration: "", description: "", knownParents: 0, imported: false };
  const horseOf = (id: string, recordedSex: string | null, sex: Horse["sex"], sireId?: string, damId?: string): Horse =>
    ({ id, numericId: Number(id), name: id, year: 2000, sex, recordedSex, ...base, sireId, damId });

  it("a dam-slot mother with an unknown/empty recorded sex is still a dam — the icon never overrides the relationship", () => {
    const unknownSexMother = horseOf("D1", null, "Unknown");            // legacy record: sex_desc empty
    const fillyRecordedMother = horseOf("D2", "Filly", "Mare");         // pre-R117-29 the icon said Unknown
    const sire = horseOf("S1", "Stallion", "Stallion");
    const root = horseOf("R1", "Colt", "Stallion", "S1", "D1");         // the subject itself is a colt
    const ancestry = buildAncestry([root, sire, unknownSexMother, fillyRecordedMother], "R1", 3);
    expect(ancestry.nodes.find(node => node.horse?.id === "D1")?.side).toBe("dam");
    expect(ancestry.nodes.find(node => node.horse?.id === "S1")?.side).toBe("sire");
    expect(ancestry.nodes.find(node => node.horse?.id === "R1")?.side).toBe("root");
  });
  it("the subject's own colt/filly category changes nothing about its parents' structural sides", () => {
    const mother = horseOf("M1", null, "Unknown");
    const father = horseOf("F1", null, "Unknown");
    const subject = horseOf("X1", "Filly", "Mare", "F1", "M1");
    const ancestry = buildAncestry([subject, father, mother], "X1", 2);
    expect(ancestry.nodes.find(node => node.horse?.id === "M1")?.side).toBe("dam");
    expect(ancestry.nodes.find(node => node.horse?.id === "F1")?.side).toBe("sire");
  });
});

describe("R117-29 source-level locks (the coarse assumptions stay removed)", () => {
  it("the pedigree diagrams never derive side from the donor sex icon", () => {
    expect(read(`${transplant}/features/pedigree/FanDiagram.tsx`)).not.toContain("sex === 'Mare'");
    expect(read(`${transplant}/features/pedigree/TreeDiagram.tsx`)).not.toContain("sex === 'Mare'");
    expect(read(`${transplant}/features/pedigree/FanDiagram.tsx`)).toContain("R117-29: structural side only");
    expect(read(`${transplant}/features/pedigree/TreeDiagram.tsx`)).toContain("R117-29: structural side only");
  });
  it("the adapter classifies through the canonical helper and passes the raw record through untouched", () => {
    const adapter = read(`${transplant}/HorseDbAdapter.tsx`);
    expect(adapter).not.toContain("function sexOf");
    expect(adapter).toContain("donorSexCategory(record.sex_desc)");
    expect(adapter).toContain("recordedSex:record.sex_desc");
  });
  it("the Directory scope tabs are facet-driven, not a hardcoded donor enum", () => {
    const directory = read(`${transplant}/pages/Directory.tsx`);
    expect(directory).not.toContain("value:'Stallion'");
    expect(directory).not.toContain("value:'Mare'");
    expect(directory).not.toContain("value:'Gelding'");
    expect(directory).toContain("sexScopeTabs(facets?.sexes,horses,total)");
  });
  it("display surfaces render the record first (recordedSex ?? category) through the canonical label", () => {
    const deskTools = read(`${transplant}/components/DeskTools.tsx`);
    const home = read(`${transplant}/pages/Home.tsx`);
    expect(deskTools).not.toContain("text(horse.sex)");
    expect(home).not.toContain("text(horse.sex)");
    expect(deskTools).toContain("horseSexLabel(horse.recordedSex ?? horse.sex, language)");
    expect(home).toContain("horseSexLabel(horse.recordedSex ?? horse.sex, language)");
  });
});
