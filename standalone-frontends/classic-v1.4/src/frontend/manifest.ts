import { defineFrontendManifest } from "../contracts/frontend";

/**
 * Classic Registry UI
 * A dependency-free, host-neutral frontend that deliberately accounts for the
 * complete platform surface. Reserved backend features remain visible to the
 * compatibility layer as dormant rather than silently disappearing.
 */
export const CLASSIC_REGISTRY_FRONTEND = defineFrontendManifest({
  id: "classic-registry",
  name: "Classic Registry",
  author: "Equine Registry",
  version: "1.4.2",
  description: "Compact bilingual registry interface with low-glare professional palettes, independent light/dark appearance, selectable Persian/Latin font packs, optional original retro interaction cues, precision vertical pedigree trees and modern responsive behavior.",
  contract: { minVersion: "2.13.0", maxMajor: 2 },
  capabilities: ["home", "search", "registry", "horse", "people", "pedigree", "quality", "claims", "admin", "stats", "compare", "rankings", "breeding"],
  requiresPlatform: [
    "authentication", "search", "structured_search", "registry", "registry_facets", "horse_profiles", "people",
    "pedigree_ancestors", "pedigree_descendants", "pedigree_metrics", "pedigree_paths", "pedigree_coefficients",
    "relationships", "horse_insights", "registry_analytics", "quality_summary", "owner_claims", "change_requests",
    "audit", "admin", "curation", "exports", "breeding_analysis",
  ],
  featureRequirements: [
    { feature: "structured_search", minVersion: "1.3.0", maxMajor: 1 },
    { feature: "registry", minVersion: "1.2.0", maxMajor: 1 },
    { feature: "horse_profiles", minVersion: "1.1.0", maxMajor: 1 },
    { feature: "relationships", minVersion: "1.2.0", maxMajor: 1 },
  ],
  platformFeatures: {
    authentication: "surface",
    search: "surface",
    structured_search: "surface",
    registry: "surface",
    registry_facets: "surface",
    horse_profiles: "surface",
    people: "surface",
    pedigree_ancestors: "surface",
    pedigree_descendants: "surface",
    pedigree_metrics: "surface",
    pedigree_paths: "surface",
    pedigree_coefficients: "surface",
    relationships: "surface",
    horse_insights: "surface",
    registry_analytics: "surface",
    quality_summary: "surface",
    owner_claims: "surface",
    change_requests: "surface",
    audit: "surface",
    admin: "surface",
    media: "dormant",
    curation: "surface",
    verification: "dormant",
    inspections: "dormant",
    exports: "surface",
    breed_standards: "dormant",
    breeding_analysis: "surface",
    genomics: "dormant",
    performance_records: "dormant",
    market_data: "dormant",
    ai_assistant: "dormant",
  },
  styleScope: "[data-classic-registry]",
  maturity: "built-in",
});
