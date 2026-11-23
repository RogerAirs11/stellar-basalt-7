import type { ComponentType } from "react";
import {
  contractCompatible,
  evaluateFrontendCompatibility,
  validateFrontendManifest,
  type FrontendCapability,
  type FrontendManifest,
} from "../contracts/frontend";
import { PLATFORM_APPLICATION_VERSION, type PlatformMetaResponse } from "../contracts/platform";
import type { FrontendRuntimeProps } from "../frontend-kit/runtime";
import frontendReleasePolicy from "./frontendReleasePolicy.json";

export type { FrontendCapability, FrontendManifest } from "../contracts/frontend";
export { contractCompatible, evaluateFrontendCompatibility } from "../contracts/frontend";

export type { FrontendRuntimeProps, FrontendAdapter } from "../frontend-kit/runtime";
export { defineFrontendAdapter } from "../frontend-kit/runtime";

type ManifestModule = { manifest?: FrontendManifest };
type EntryModule = { default?: ComponentType<FrontendRuntimeProps> };

/** Selectable presentations of one runtime; both share Heritage routes,
 * permissions, request handling and platform feature coverage.
 * R154: the "professional" presentation was removed by owner decision. */
export const HERITAGE_PRESENTATIONS = [
  { id: "heritage", name: { en: "Heritage Registry", fa: "رابط اصلی هریتیج" }, description: { en: "Your existing artwork, appearance and navigation settings.", fa: "ظاهر، تصاویر و تنظیمات قبلی شما." } },
] as const;

const BUILTIN: FrontendManifest = {
  id: "heritage",
  name: "Heritage Registry",
  author: "Core",
  version: PLATFORM_APPLICATION_VERSION,
  description: "The canonical glass / registry interface.",
  contract: { minVersion: "2.1.0", maxMajor: 2 },
  capabilities: ["home", "search", "registry", "horse", "people", "pedigree", "quality", "claims", "admin", "stats", "compare", "breeding", "assistant"],
  requiresPlatform: ["search", "registry", "horse_profiles", "pedigree_ancestors", "pedigree_descendants"],
  featureRequirements: [
    { feature: "search", minVersion: "1.0.0", maxMajor: 1 },
    { feature: "registry", minVersion: "1.0.0", maxMajor: 1 },
    { feature: "horse_profiles", minVersion: "1.0.0", maxMajor: 1 },
  ],
  optionalPlatform: ["change_requests", "audit", "admin", "curation", "authentication", "structured_search", "registry_facets", "people", "relationships", "pedigree_metrics", "pedigree_paths", "pedigree_coefficients", "horse_insights", "registry_analytics", "quality_summary", "owner_claims", "breeding_analysis", "exports", "ai_assistant"],
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
    quality_queue: "surface",
    evidence_summary: "surface",
    exact_identifier: "surface",
    owner_claims: "surface",
    change_requests: "surface",
    audit: "surface",
    admin: "surface",
    media: "surface",
    curation: "surface",
    verification: "dormant",
    inspections: "dormant",
    exports: "surface",
    breed_standards: "dormant",
    breeding_analysis: "surface",
    genomics: "dormant",
    performance_records: "surface",
    market_data: "surface",
    ai_assistant: "surface",
  },
  maturity: "built-in",
};

// Release authority is centralized in frontendReleasePolicy.json so the runtime
// registry and the production asset gate cannot disagree about which frontends
// are active. Glob all external frontend modules, then filter them against that
// single allowlist.
const activeExternalFrontendIds = new Set(frontendReleasePolicy.activeExternalFrontends);
const manifestModules = import.meta.glob(
  "./frontends/*/manifest.ts",
  { eager: true },
) as Record<string, ManifestModule>;
const entryLoaders = import.meta.glob(
  "./frontends/*/entry.tsx",
) as Record<string, () => Promise<EntryModule>>;

function folderFromPath(path: string): string | null {
  return path.match(/\.\/frontends\/([^/]+)\//)?.[1] ?? null;
}

const discovered = Object.entries(manifestModules)
  .map(([path, module]) => ({ folder: folderFromPath(path), manifest: module.manifest }))
  .filter((item): item is { folder: string; manifest: FrontendManifest } =>
    Boolean(item.folder && item.manifest && activeExternalFrontendIds.has(item.folder)),
  );

validateRegistry(BUILTIN, discovered);

export function getFrontendManifests(): FrontendManifest[] {
  return [BUILTIN, ...discovered.map((item) => item.manifest)].sort((a, b) => {
    if (a.id === "heritage") return -1;
    if (b.id === "heritage") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function hasFrontend(id: string): boolean {
  return getFrontendManifests().some((manifest) => manifest.id === id);
}

export function frontendCompatible(manifest: FrontendManifest, platform?: PlatformMetaResponse | null): boolean {
  return evaluateFrontendCompatibility(manifest, platform).compatible;
}

export async function loadFrontend(id: string): Promise<ComponentType<FrontendRuntimeProps> | null> {
  if (id === "heritage") return null;
  const found = discovered.find((item) => item.manifest.id === id);
  if (!found) return null;
  const key = Object.keys(entryLoaders).find((path) => folderFromPath(path) === found.folder);
  if (!key) return null;
  const module = await entryLoaders[key]!();
  return module.default ?? null;
}

function validateRegistry(builtin: FrontendManifest, external: Array<{ folder: string; manifest: FrontendManifest }>): void {
  const seen = new Set<string>();
  const problems: string[] = [];
  const discoveredExternalIds = new Set(external.map((item) => item.manifest.id));
  for (const id of frontendReleasePolicy.activeExternalFrontends) {
    if (!discoveredExternalIds.has(id)) problems.push(`${id}: active release frontend is missing from the runtime registry`);
  }
  if (!frontendReleasePolicy.activeFrontends.includes(builtin.id)) {
    problems.push(`${builtin.id}: built-in frontend is missing from the active release policy`);
  }
  for (const item of [{ folder: builtin.id, manifest: builtin }, ...external]) {
    const local = validateFrontendManifest(item.manifest);
    for (const problem of local) problems.push(`${item.manifest.id}: ${problem}`);
    if (seen.has(item.manifest.id)) problems.push(`${item.manifest.id}: duplicate frontend id`);
    seen.add(item.manifest.id);
    if (item.manifest.id !== "heritage" && item.folder !== item.manifest.id) {
      problems.push(`${item.manifest.id}: folder '${item.folder}' must match manifest id`);
    }
  }
  if (problems.length) throw new Error(`Invalid frontend registry:\n${problems.map((x) => `- ${x}`).join("\n")}`);
}
