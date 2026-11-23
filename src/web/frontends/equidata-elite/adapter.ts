import {
  defineFrontendAdapter,
  supportsPlatformFeature,
  type FrontendRuntimeProps,
  type HorseRecord,
  type PlatformFeatureKey,
} from "../../../frontend-kit";

export type EquiDataHorse = HorseRecord & {
  displayName: string;
  secondaryName: string | null;
  lifecycle: "active" | "deceased" | "inactive" | "unknown";
};

export const adaptRuntime = defineFrontendAdapter((runtime: FrontendRuntimeProps) => {
  const supports = (feature: PlatformFeatureKey) => supportsPlatformFeature(runtime.platformMeta, feature);
  return {
    ...runtime,
    supports,
    capabilities: {
      authentication: supports("authentication"),
      audit: supports("audit"),
      admin: supports("admin"),
      curation: supports("curation"),
      structuredSearch: supports("structured_search"),
      facets: supports("registry_facets"),
      people: supports("people"),
      pedigree: supports("pedigree_ancestors"),
      descendants: supports("pedigree_descendants"),
      descendantMetrics: supports("pedigree_metrics"),
      pedigreeMetrics: supports("pedigree_metrics"),
      pedigreePaths: supports("pedigree_paths"),
      pedigreeCoefficients: supports("pedigree_coefficients"),
      relationships: supports("relationships"),
      insights: supports("horse_insights"),
      analytics: supports("registry_analytics"),
      quality: supports("quality_summary"),
      evidenceSummary: supports("evidence_summary"),
      exactIdentifier: supports("exact_identifier"),
      claims: supports("owner_claims"),
      changes: supports("change_requests"),
      breeding: supports("breeding_analysis"),
      genomics: supports("genomics"),
      performance: supports("performance_records"),
      market: supports("market_data"),
      ai: supports("ai_assistant"),
      media: supports("media"),
      verification: supports("verification"),
    },
  };
});

export function adaptHorse(horse: HorseRecord, locale: "en" | "fa" | "ar"): EquiDataHorse {
  const preferred = locale === "fa" ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native;
  const secondary = locale === "fa" ? horse.name_latin : horse.name_native;
  return {
    ...horse,
    displayName: preferred || `Horse #${horse.id}`,
    secondaryName: secondary || null,
    lifecycle: horse.is_dead ? "deceased" : horse.is_active === 1 ? "active" : horse.is_active === 0 ? "inactive" : "unknown",
  };
}

export function featureStatusLabel(available: boolean): "LIVE" | "DORMANT" {
  return available ? "LIVE" : "DORMANT";
}

export type EquiDataRuntime = ReturnType<typeof adaptRuntime>;
