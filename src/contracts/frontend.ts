import type {
  PlatformContractRequirement,
  PlatformFeatureKey,
  PlatformFeatureRequirement,
  PlatformMetaResponse,
} from "./platform";
import { PLATFORM_FEATURE_KEYS } from "./platform";

export type FrontendCapability =
  | "home" | "search" | "registry" | "horse" | "people" | "pedigree" | "quality" | "claims" | "admin"
  | "stats" | "compare" | "rankings" | "breeding" | "assistant" | "favorites";
export type FrontendMaturity = "built-in" | "normalized" | "experimental";
export type FrontendFeatureDisposition = "surface" | "host" | "dormant";
export type FrontendPlatformFeatureCoverage = Record<PlatformFeatureKey, FrontendFeatureDisposition>;
/** Features the canonical host may legitimately own instead of every visual frontend. */
export const FRONTEND_HOST_DELEGABLE_FEATURES = Object.freeze([
  "authentication",
  "audit",
  "admin",
  "curation",
  "ai_assistant",
] as const satisfies readonly PlatformFeatureKey[]);

export interface FrontendManifest {
  id: string;
  name: string;
  author?: string;
  version: string;
  description: string;
  contract: PlatformContractRequirement;
  capabilities: FrontendCapability[];
  /** Required feature keys. Prefer featureRequirements when a minimum feature version matters. */
  requiresPlatform: PlatformFeatureKey[];
  optionalPlatform?: PlatformFeatureKey[];
  featureRequirements?: PlatformFeatureRequirement[];
  /**
   * Explicit accounting for every semantic platform feature.
   * - surface: this frontend exposes the capability itself.
   * - host: the shared host owns the UX (authentication shell and privileged governance only).
   * - dormant: intentionally unavailable in this frontend until a backend/source exists.
   *
   * This is deliberately exhaustive. New backend feature keys must not disappear
   * silently inside an older frontend.
   */
  platformFeatures: FrontendPlatformFeatureCoverage;
  /** CSS root selector used to contain this frontend's visual system. */
  styleScope?: string;
  maturity: FrontendMaturity;
}

export type FrontendCompatibilityIssueCode =
  | "contract-version"
  | "missing-feature"
  | "feature-version"
  | "unexposed-feature"
  | "invalid-manifest";

export type FrontendCompatibilityIssueSeverity = "error" | "warning";

export interface FrontendCompatibilityIssue {
  code: FrontendCompatibilityIssueCode;
  feature?: PlatformFeatureKey;
  message: string;
  severity: FrontendCompatibilityIssueSeverity;
}

export interface FrontendCompatibilityReport {
  compatible: boolean;
  platformKnown: boolean;
  issues: FrontendCompatibilityIssue[];
  blockingIssues: FrontendCompatibilityIssue[];
  warnings: FrontendCompatibilityIssue[];
}

export function defineFrontendManifest<const T extends FrontendManifest>(manifest: T): T {
  return manifest;
}

export function validateFrontendManifest(manifest: FrontendManifest): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) problems.push("id must be a lowercase kebab-case slug");
  if (!manifest.name.trim()) problems.push("name is required");
  if (!manifest.version.trim()) problems.push("version is required");
  if (!versionTuple(manifest.contract.minVersion)) problems.push("contract.minVersion must be semver");
  if (!Number.isSafeInteger(manifest.contract.maxMajor) || manifest.contract.maxMajor < 1) problems.push("contract.maxMajor must be a positive integer");
  const contractMinimum = versionTuple(manifest.contract.minVersion);
  if (contractMinimum && contractMinimum[0] > manifest.contract.maxMajor) problems.push("contract.minVersion major cannot exceed contract.maxMajor");

  const required = new Set(manifest.requiresPlatform);
  if (required.size !== manifest.requiresPlatform.length) problems.push("requiresPlatform contains duplicate feature keys");
  const optional = new Set(manifest.optionalPlatform ?? []);
  if (optional.size !== (manifest.optionalPlatform ?? []).length) problems.push("optionalPlatform contains duplicate feature keys");
  for (const feature of optional) if (required.has(feature)) problems.push(`${feature} cannot be both required and optional`);

  const versioned = new Set<PlatformFeatureKey>();
  for (const requirement of manifest.featureRequirements ?? []) {
    if (versioned.has(requirement.feature)) problems.push(`featureRequirements contains duplicate '${requirement.feature}' entries`);
    versioned.add(requirement.feature);
    if (!required.has(requirement.feature)) problems.push(`featureRequirements.${requirement.feature} must also appear in requiresPlatform`);
    const minimum = requirement.minVersion ? versionTuple(requirement.minVersion) : null;
    if (requirement.minVersion && !minimum) problems.push(`featureRequirements.${requirement.feature}.minVersion must be semver`);
    if (requirement.maxMajor !== undefined && (!Number.isSafeInteger(requirement.maxMajor) || requirement.maxMajor < 0)) problems.push(`featureRequirements.${requirement.feature}.maxMajor must be a non-negative integer`);
    if (minimum && requirement.maxMajor !== undefined && minimum[0] > requirement.maxMajor) problems.push(`featureRequirements.${requirement.feature}.minVersion major cannot exceed maxMajor`);
  }

  const coverageKeys = new Set(Object.keys(manifest.platformFeatures ?? {}) as PlatformFeatureKey[]);
  for (const feature of PLATFORM_FEATURE_KEYS) {
    const disposition = manifest.platformFeatures?.[feature];
    if (!disposition) problems.push(`platformFeatures.${feature} must explicitly be surface, host, or dormant`);
    else if (!(["surface", "host", "dormant"] as const).includes(disposition)) problems.push(`platformFeatures.${feature} has invalid disposition '${String(disposition)}'`);
    if (disposition === "host" && !FRONTEND_HOST_DELEGABLE_FEATURES.includes(feature as (typeof FRONTEND_HOST_DELEGABLE_FEATURES)[number])) problems.push(`platform feature '${feature}' cannot be delegated to the host`);
    if (required.has(feature) && disposition === "dormant") problems.push(`required feature '${feature}' cannot be marked dormant`);
  }
  for (const feature of coverageKeys) {
    if (!PLATFORM_FEATURE_KEYS.includes(feature)) problems.push(`platformFeatures contains unknown feature '${feature}'`);
  }
  if (manifest.styleScope && !/^(?:\.[a-zA-Z_][\w-]*|\[data-[^\]]+\])$/.test(manifest.styleScope)) problems.push("styleScope must be one class selector or one [data-*] selector");
  return problems;
}

export function evaluateFrontendCompatibility(
  manifest: FrontendManifest,
  platform?: PlatformMetaResponse | null,
): FrontendCompatibilityReport {
  const manifestProblems = validateFrontendManifest(manifest);
  const issues: FrontendCompatibilityIssue[] = manifestProblems.map((message) => ({ code: "invalid-manifest", message, severity: "error" }));
  if (!platform) return compatibilityReport(false, issues);

  if (!contractCompatible(manifest.contract, platform.contractVersion)) {
    issues.push({
      code: "contract-version",
      severity: "error",
      message: `Frontend requires contract >=${manifest.contract.minVersion} through major ${manifest.contract.maxMajor}; platform is ${platform.contractVersion}`,
    });
  }

  for (const feature of manifest.requiresPlatform) {
    if (!platform.capabilities[feature]) {
      issues.push({ code: "missing-feature", feature, severity: "error", message: `Required platform feature '${feature}' is unavailable` });
    }
  }

  for (const requirement of manifest.featureRequirements ?? []) {
    if (!platform.capabilities[requirement.feature]) continue;
    if (!requirement.minVersion && requirement.maxMajor === undefined) continue;
    const actual = platform.featureCatalog?.[requirement.feature]?.version;
    if (!actual || !featureVersionCompatible(actual, requirement)) {
      const range = `${requirement.minVersion ? `>=${requirement.minVersion}` : "any"}${requirement.maxMajor !== undefined ? ` through major ${requirement.maxMajor}` : ""}`;
      issues.push({
        code: "feature-version",
        severity: "error",
        feature: requirement.feature,
        message: `Feature '${requirement.feature}' requires ${range}; platform provides ${actual ?? "unknown"}`,
      });
    }
  }


  for (const feature of PLATFORM_FEATURE_KEYS) {
    if (!platform.capabilities[feature]) continue;
    if (manifest.platformFeatures[feature] !== "dormant") continue;
    issues.push({
      code: "unexposed-feature",
      severity: "warning",
      feature,
      message: `Platform feature '${feature}' is available but this frontend still marks it dormant`,
    });
  }

  return compatibilityReport(true, issues);
}

function compatibilityReport(platformKnown: boolean, issues: FrontendCompatibilityIssue[]): FrontendCompatibilityReport {
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { compatible: blockingIssues.length === 0, platformKnown, issues, blockingIssues, warnings };
}

export function platformFeatureCoverageSummary(manifest: FrontendManifest, platform?: PlatformMetaResponse | null) {
  const entries = PLATFORM_FEATURE_KEYS.map((feature) => ({
    feature,
    disposition: manifest.platformFeatures[feature],
    available: Boolean(platform?.capabilities[feature]),
  }));
  return {
    entries,
    surface: entries.filter((entry) => entry.disposition === "surface").length,
    host: entries.filter((entry) => entry.disposition === "host").length,
    dormant: entries.filter((entry) => entry.disposition === "dormant").length,
    liveUnexposed: entries.filter((entry) => entry.available && entry.disposition === "dormant").map((entry) => entry.feature),
  };
}

export function contractCompatible(requirement: PlatformContractRequirement, actualVersion: string): boolean {
  const actual = versionTuple(actualVersion);
  const minimum = versionTuple(requirement.minVersion);
  if (!actual || !minimum) return false;
  if (actual[0] > requirement.maxMajor) return false;
  return compareVersion(actual, minimum) >= 0;
}

export function versionAtLeast(actualVersion: string, minimumVersion: string): boolean {
  const actual = versionTuple(actualVersion);
  const minimum = versionTuple(minimumVersion);
  return Boolean(actual && minimum && compareVersion(actual, minimum) >= 0);
}

export function featureVersionCompatible(actualVersion: string, requirement: PlatformFeatureRequirement): boolean {
  const actual = versionTuple(actualVersion);
  if (!actual) return false;
  if (requirement.minVersion && !versionAtLeast(actualVersion, requirement.minVersion)) return false;
  if (requirement.maxMajor !== undefined && actual[0] > requirement.maxMajor) return false;
  return true;
}

function versionTuple(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}
