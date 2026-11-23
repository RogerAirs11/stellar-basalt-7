import { careIdentityMergeGuard } from "../equineCare/access";

/** Generic identity operations cannot move or strand private care, versioned
 * supplementary values, or professional assignments. An explicit reviewed
 * companion workflow must reconcile these records first. All writers lock
 * the same horse row before checking their live-subject predicates. */
export function protectedIdentityMergeGuard(horseIds: number[]) {
  const care = careIdentityMergeGuard(horseIds);
  const placeholders = horseIds.map(() => "?").join(",");
  return {
    sql: `${care.sql}
      AND NOT EXISTS(SELECT 1 FROM registry_metadata_values WHERE horse_id IN (${placeholders}))
      AND NOT EXISTS(SELECT 1 FROM professional_access_grants WHERE horse_id IN (${placeholders}) AND revoked_at IS NULL)`,
    bindings: [...care.bindings, ...horseIds, ...horseIds],
  };
}
