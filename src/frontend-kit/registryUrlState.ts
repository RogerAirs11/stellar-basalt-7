import type { RegistrySort, RegistrySortDirection } from "../contracts/platform";
import { EMPTY_ADVANCED_REGISTRY_SEARCH, type AdvancedRegistrySearch } from "./registrySearch";

/**
 * Typed URL query-state contract for the registry Browse view (post-package delta D14).
 *
 * The serialized form mirrors the *server-facing* browse parameters, so a shared URL
 * reconstructs the same server request. Purely personal visual preferences (density,
 * column visibility, visual encoding) deliberately remain local-storage state and are
 * not part of this contract.
 *
 * `mode` disambiguates smart relevance search ("smart": ranked subset of the text query,
 * never a complete canonical result) from structured registry browsing ("registry":
 * the same text query applied as a registry filter). When absent, legacy behavior applies
 * (a lone text query of >=2 characters runs as smart relevance search).
 */
export interface RegistryUrlState {
  q: string;
  mode: "smart" | "registry" | null;
  advanced: AdvancedRegistrySearch;
  breed: string;
  sex: string;
  lifecycle: string;
  color: string;
  mainStrain: string;
  importedFrom: string;
  decade: string;
  flag: "" | "imported" | "sport" | "stallion" | "sport_card";
  sort: RegistrySort;
  dir: RegistrySortDirection;
  offset: number;
}

export const REGISTRY_URL_SORTS: readonly RegistrySort[] = ["importance", "id", "name", "year", "breed", "sex", "place"];
const REGISTRY_URL_FLAGS: readonly RegistryUrlState["flag"][] = ["", "imported", "sport", "stallion", "sport_card"];
const REGISTRY_URL_LIFECYCLES: readonly string[] = ["active", "inactive", "deceased"];

/**
 * R135 — the registry opens with the most significant horses first
 * (photographed champions, foundation sires, sport records — see the
 * importance ranking in src/registry/query.ts). R128 had switched the
 * default to alphabetical because raw id order surfaced the import order;
 * significance keeps the opener meaningful while name stays one tap away.
 * The id column remains available as an explicit sort.
 */
export const REGISTRY_URL_DEFAULT_SORT: RegistrySort = "importance";
/** The natural reading direction of each sort; used when the URL omits `dir`. */
export const REGISTRY_SORT_NATURAL_DIRECTION: Record<RegistrySort, RegistrySortDirection> = {
  importance: "desc", year: "desc", id: "asc", name: "asc", breed: "asc", sex: "asc", place: "asc",
};

export function emptyRegistryUrlState(): RegistryUrlState {
  return {
    q: "", mode: null, advanced: { ...EMPTY_ADVANCED_REGISTRY_SEARCH },
    breed: "", sex: "", lifecycle: "", color: "", mainStrain: "", importedFrom: "", decade: "",
    flag: "", sort: REGISTRY_URL_DEFAULT_SORT, dir: REGISTRY_SORT_NATURAL_DIRECTION[REGISTRY_URL_DEFAULT_SORT], offset: 0,
  };
}

function text(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? "").trim();
}

function year(params: URLSearchParams, key: string): string {
  const raw = text(params, key);
  return /^\d{4}$/.test(raw) ? raw : "";
}

function flagValue(params: URLSearchParams): RegistryUrlState["flag"] {
  // Server-facing boolean params are the URL contract; the combined flag is derived UI state.
  if (text(params, "isImported")) return "imported";
  if (text(params, "isSport")) return "sport";
  if (text(params, "isStallion")) return "stallion";
  if (text(params, "hasSportCard")) return "sport_card";
  const raw = text(params, "flag") as RegistryUrlState["flag"];
  return REGISTRY_URL_FLAGS.includes(raw) ? raw : "";
}

/** Parse a query string (`location.search`) into the typed registry URL state. */
export function parseRegistryUrlState(search: string): RegistryUrlState {
  const params = new URLSearchParams(search);
  const advanced: AdvancedRegistrySearch = {
    ...EMPTY_ADVANCED_REGISTRY_SEARCH,
    horseName: text(params, "name"),
    horseId: text(params, "id"),
    registerNo: text(params, "register"),
    owner: text(params, "owner"),
    breeder: text(params, "breeder"),
    importer: text(params, "importer"),
    passportReceiver: text(params, "passportReceiver"),
    sire: text(params, "sire"),
    dam: text(params, "dam"),
    place: text(params, "place"),
    yearFrom: year(params, "yearFrom"),
    yearTo: year(params, "yearTo"),
  };
  const sortRaw = text(params, "sort") as RegistrySort;
  const dirRaw = text(params, "dir") as RegistrySortDirection;
  const offsetRaw = Number.parseInt(text(params, "offset"), 10);
  const modeRaw = text(params, "mode");
  const lifecycle = text(params, "lifecycle");
  const decadeRaw = text(params, "decade");
  return {
    q: text(params, "q").slice(0, 300),
    mode: modeRaw === "smart" || modeRaw === "registry" ? modeRaw : null,
    advanced,
    breed: text(params, "breed"),
    sex: text(params, "sex"),
    lifecycle: REGISTRY_URL_LIFECYCLES.includes(lifecycle) ? lifecycle : "",
    color: text(params, "color"),
    mainStrain: text(params, "mainStrain"),
    importedFrom: text(params, "importedFrom"),
    decade: /^\d{4}$/.test(decadeRaw) ? decadeRaw : "",
    flag: flagValue(params),
    sort: REGISTRY_URL_SORTS.includes(sortRaw) ? sortRaw : REGISTRY_URL_DEFAULT_SORT,
    // The natural direction of the resolved sort applies when the URL is
    // silent, so a fresh /browse opens significance-first (desc) and an
    // alphabetical read opens A-first without a `dir` parameter.
    dir: dirRaw === "desc" || dirRaw === "asc"
      ? dirRaw
      : REGISTRY_SORT_NATURAL_DIRECTION[REGISTRY_URL_SORTS.includes(sortRaw) ? sortRaw : REGISTRY_URL_DEFAULT_SORT],
    offset: Number.isSafeInteger(offsetRaw) && offsetRaw > 0 ? Math.min(offsetRaw, 1_000_000) : 0,
  };
}

function setIfValue(params: URLSearchParams, key: string, value: string | number | boolean | undefined | null): void {
  if (value === undefined || value === null || value === "" || value === false) return;
  params.set(key, value === true ? "1" : String(value));
}

/**
 * Serialize registry URL state into a canonical `/browse` URL. Only meaningful values are
 * emitted; defaults are omitted so ordinary reads keep clean URLs. Partial input is merged
 * over the documented default state.
 */
export function serializeRegistryUrlState(state: Partial<RegistryUrlState>): string {
  const full: RegistryUrlState = { ...emptyRegistryUrlState(), ...state };
  const params = new URLSearchParams();
  setIfValue(params, "q", full.q);
  setIfValue(params, "mode", full.mode);
  setIfValue(params, "name", full.advanced.horseName.trim());
  setIfValue(params, "id", full.advanced.horseId.replace(/^#/, "").trim());
  setIfValue(params, "register", full.advanced.registerNo.trim());
  setIfValue(params, "owner", full.advanced.owner.trim());
  setIfValue(params, "breeder", full.advanced.breeder.trim());
  setIfValue(params, "importer", full.advanced.importer.trim());
  setIfValue(params, "passportReceiver", full.advanced.passportReceiver.trim());
  setIfValue(params, "sire", full.advanced.sire.trim());
  setIfValue(params, "dam", full.advanced.dam.trim());
  setIfValue(params, "place", full.advanced.place.trim());
  setIfValue(params, "yearFrom", /^\d{4}$/.test(full.advanced.yearFrom.trim()) ? full.advanced.yearFrom.trim() : "");
  setIfValue(params, "yearTo", /^\d{4}$/.test(full.advanced.yearTo.trim()) ? full.advanced.yearTo.trim() : "");
  setIfValue(params, "breed", full.breed.trim());
  setIfValue(params, "sex", full.sex.trim());
  setIfValue(params, "lifecycle", full.lifecycle.trim());
  setIfValue(params, "color", full.color.trim());
  setIfValue(params, "mainStrain", full.mainStrain.trim());
  setIfValue(params, "importedFrom", full.importedFrom.trim());
  setIfValue(params, "decade", /^\d{4}$/.test(full.decade) ? full.decade : "");
  setIfValue(params, "isImported", full.flag === "imported");
  setIfValue(params, "isSport", full.flag === "sport");
  setIfValue(params, "isStallion", full.flag === "stallion");
  setIfValue(params, "hasSportCard", full.flag === "sport_card");
  if (full.sort !== REGISTRY_URL_DEFAULT_SORT) setIfValue(params, "sort", full.sort);
  if (full.dir !== REGISTRY_SORT_NATURAL_DIRECTION[full.sort]) setIfValue(params, "dir", full.dir);
  if (Number.isSafeInteger(full.offset) && full.offset > 0) setIfValue(params, "offset", full.offset);
  const query = params.toString();
  return query ? `/browse?${query}` : "/browse";
}
