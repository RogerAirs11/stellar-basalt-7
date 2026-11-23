import { defineFrontendManifest } from "../../../frontend-kit";

/**
 * Modern Pedigree — the owner-supplied "modern horse pedigree website" app,
 * served EXACTLY as delivered (byte-preserved donor build) as a standalone
 * static application at /f/modern-horse/ (public/f/modern-horse/, built from
 * src/donor-apps/modern-horse with the donor's own Vite + Tailwind pipeline).
 *
 * This manifest keeps the interface registered in the Heritage switcher; the
 * entry below hands the visitor over to the standalone app with a full page
 * load so the donor's own document, fonts and styles apply untouched.
 */
export const manifest = defineFrontendManifest({
  id: "modern-horse",
  name: "Modern Pedigree",
  author: "Owner donor app; Horse DB integration by Core",
  version: "1.1.0",
  description: "The exact donor app: calm editorial design with live registry search, horse profiles and pedigrees on the canonical platform.",
  contract: { minVersion: "2.1.0", maxMajor: 2 },
  capabilities: ["home", "search", "registry", "horse", "people", "pedigree", "breeding", "stats", "quality"],
  requiresPlatform: ["search", "registry", "horse_profiles"],
  featureRequirements: [
    { feature: "search", minVersion: "1.0.0", maxMajor: 1 },
    { feature: "registry", minVersion: "1.0.0", maxMajor: 1 },
    { feature: "horse_profiles", minVersion: "1.0.0", maxMajor: 1 },
  ],
  optionalPlatform: [
    "registry_facets", "people", "pedigree_ancestors", "pedigree_descendants",
    "pedigree_metrics", "relationships", "authentication", "media",
  ],
  platformFeatures: {
    authentication: "host",
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
    quality_queue: "surface",
    evidence_summary: "surface",
    exact_identifier: "surface",
    owner_claims: "surface",
    change_requests: "surface",
    audit: "surface",
    admin: "surface",
    media: "surface",
    curation: "surface",
    verification: "surface",
    inspections: "surface",
    exports: "surface",
    breed_standards: "surface",
    breeding_analysis: "surface",
    genomics: "surface",
    performance_records: "surface",
    market_data: "surface",
    ai_assistant: "surface",
  },
  styleScope: ".mrw-root",
  maturity: "experimental",
});
