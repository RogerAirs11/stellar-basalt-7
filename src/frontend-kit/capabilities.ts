import { featureVersionCompatible } from "../contracts/frontend";
import type {
  PlatformFeatureKey,
  PlatformFeatureRequirement,
  PlatformMetaResponse,
  PlatformPermission,
} from "../contracts/platform";

/** True only when the platform both advertises and version-matches a feature. */
export function supportsPlatformFeature(
  meta: PlatformMetaResponse | null | undefined,
  feature: PlatformFeatureKey,
  requirement: Omit<PlatformFeatureRequirement, "feature"> = {},
): boolean {
  if (!meta?.capabilities[feature]) return false;
  if (!requirement.minVersion && requirement.maxMajor === undefined) return true;
  const actual = meta.featureCatalog?.[feature]?.version;
  return Boolean(actual && featureVersionCompatible(actual, { feature, ...requirement }));
}

/** Frontends consume canonical permissions; they must not infer authorization from role names. */
export function hasPlatformPermission(
  permissions: readonly PlatformPermission[],
  permission: PlatformPermission,
): boolean {
  return permissions.includes(permission);
}
