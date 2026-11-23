import {
  defineFrontendAdapter,
  supportsPlatformFeature,
  type FrontendRuntimeProps,
  type HorseRecord,
  type PlatformFeatureKey,
} from "../../../frontend-kit";

export const adaptRuntime = defineFrontendAdapter((runtime: FrontendRuntimeProps) => {
  const supports = (feature: PlatformFeatureKey) => supportsPlatformFeature(runtime.platformMeta, feature);
  return {
    ...runtime,
    supports,
    capabilities: {
      authentication: supports("authentication"), structuredSearch: supports("structured_search"), facets: supports("registry_facets"),
      people: supports("people"), pedigree: supports("pedigree_ancestors"), descendants: supports("pedigree_descendants"), metrics: supports("pedigree_metrics"),
      paths: supports("pedigree_paths"), coefficients: supports("pedigree_coefficients"), relationships: supports("relationships"),
      insights: supports("horse_insights"), analytics: supports("registry_analytics"), quality: supports("quality_summary"),
      claims: supports("owner_claims"), changes: supports("change_requests"), exports: supports("exports"), breeding: supports("breeding_analysis"),
      audit: supports("audit"), admin: supports("admin"), curation: supports("curation"), ai: supports("ai_assistant"),
    },
  };
});

export type ClassicRuntime = ReturnType<typeof adaptRuntime>;

export function horseName(horse: Pick<HorseRecord, "id" | "name_latin" | "name_native">, locale: "en" | "fa" | "ar") {
  // Farsi and Arabic both read the native (Persian) name first.
  const nativeFirst = locale === "fa" || locale === "ar";
  return (nativeFirst ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native) || `#${horse.id}`;
}

export function visibleCoverage(horse: HorseRecord) {
  const keys: Array<keyof HorseRecord> = ["register_no", "birth_year", "birth_place_desc", "breed_desc", "sex_desc", "father_id", "mother_id", "dna_status"];
  const known = keys.filter(key => horse[key] !== null && horse[key] !== undefined && horse[key] !== "").length;
  return Math.round((known / keys.length) * 100);
}

export function lifecycle(horse: HorseRecord): "active" | "deceased" | "inactive" | "unknown" {
  if (horse.is_dead) return "deceased";
  if (horse.is_active === 1) return "active";
  if (horse.is_active === 0) return "inactive";
  return "unknown";
}
