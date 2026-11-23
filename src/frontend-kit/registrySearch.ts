/** Canonical presentation-side model for field-based registry search controls. */
export type AdvancedRegistrySearch = {
  horseName: string;
  horseId: string;
  registerNo: string;
  owner: string;
  breeder: string;
  importer: string;
  passportReceiver: string;
  sire: string;
  dam: string;
  place: string;
  yearFrom: string;
  yearTo: string;
};

export const EMPTY_ADVANCED_REGISTRY_SEARCH: AdvancedRegistrySearch = {
  horseName: "",
  horseId: "",
  registerNo: "",
  owner: "",
  breeder: "",
  importer: "",
  passportReceiver: "",
  sire: "",
  dam: "",
  place: "",
  yearFrom: "",
  yearTo: "",
};

export function hasAdvancedRegistrySearch(value: AdvancedRegistrySearch): boolean {
  return Object.values(value).some((item) => item.trim().length > 0);
}

/** Translate standard advanced-search controls into canonical registry browse parameters. */
export function advancedRegistryParams(value: AdvancedRegistrySearch): Record<string, string | undefined> {
  const yearFrom = /^\d{4}$/.test(value.yearFrom.trim()) ? value.yearFrom.trim() : undefined;
  const yearTo = /^\d{4}$/.test(value.yearTo.trim()) ? value.yearTo.trim() : undefined;
  return {
    name: clean(value.horseName),
    id: clean(value.horseId.replace(/^#/, "")),
    register: clean(value.registerNo),
    owner: clean(value.owner),
    breeder: clean(value.breeder),
    importer: clean(value.importer),
    passportReceiver: clean(value.passportReceiver),
    sire: clean(value.sire),
    dam: clean(value.dam),
    place: clean(value.place),
    yearFrom,
    yearTo,
  };
}

export function advancedRegistrySummary(value: AdvancedRegistrySearch): Array<{ key: keyof AdvancedRegistrySearch; value: string }> {
  return (Object.keys(value) as Array<keyof AdvancedRegistrySearch>)
    .map((key) => ({ key, value: value[key].trim() }))
    .filter((item) => item.value.length > 0);
}

function clean(value: string): string | undefined {
  const next = value.trim();
  return next || undefined;
}
