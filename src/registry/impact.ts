/**
 * Master-Ai plan T09: compute the search/impact fan-out of a horse mutation
 * in ONE place. Every canonical write path (direct edit, reviewed change
 * request apply, create, archive) asks this module what it invalidates:
 *
 *   - the edited horse always reindexes (its own denormalized search text);
 *   - direct children reindex when a parent NAME changes, because their
 *     horse_search_source rows embed father_name/mother_name — before T09 the
 *     reviewed path never queued children, so a reviewed parent rename left
 *     child search results stale forever;
 *   - deeper pedigree/analytics caches are NOT recomputed synchronously —
 *     registry_state.canonical_revision is bumped and analytics_stale=1, so
 *     every reader can disclose staleness honestly instead of fabricating
 *     freshness.
 */

export interface HorseMutationImpact {
  queueSelf: true;
  queueDirectChildren: boolean;
  childReason: "parent_name_changed" | null;
  selfReason: string;
  touchesIdentifiers: boolean;
  touchesParentage: boolean;
  touchesName: boolean;
}

export function horseMutationImpact(changes: Record<string, unknown>): HorseMutationImpact {
  const keys = new Set(Object.keys(changes));
  const touchesName = keys.has("name_latin") || keys.has("name_native");
  const touchesParentage = keys.has("father_id") || keys.has("mother_id");
  const touchesIdentifiers =
    ["register_no","microchip_no","uel_no","life_number","passport_no","passport_issuer","foreign_registration_no","foreign_registration_issuer"].some(key=>keys.has(key));

  const reasons: string[] = [];
  if (touchesName) reasons.push("name");
  if (touchesParentage) reasons.push("parentage");
  if (touchesIdentifiers) reasons.push("identifiers");
  if (keys.has("birth_place_desc")) reasons.push("location");
  for (const key of keys) {
    if (!reasons.length || !["name_latin", "name_native", "father_id", "mother_id", "register_no", "microchip_no", "uel_no", "life_number", "birth_place_desc"].includes(key)) {
      if (!reasons.includes("fields")) reasons.push("fields");
    }
  }

  return {
    queueSelf: true,
    queueDirectChildren: touchesName,
    childReason: touchesName ? "parent_name_changed" : null,
    selfReason: reasons.length ? `canonical_horse_update:${reasons.join("+")}` : "canonical_horse_update",
    touchesIdentifiers,
    touchesParentage,
    touchesName,
  };
}

export interface MutationObservabilityInput {
  reindexQueueCount: number;
  oldestQueuedAgeSeconds: number | null;
  failedMutations: number;
  pendingSearchWork: number;
  pendingAuditWork: number;
  canonicalRevision: number | null;
  identifierConflictsOpen: number | null;
}

/**
 * T09 observability block: expose queue age, failed mutations and the
 * canonical/search revision lag so operators (and the public UI) can tell a
 * stale index from a fresh one instead of trusting silence.
 */
export function mutationObservabilityBlock(input: MutationObservabilityInput) {
  return {
    reindexQueue: {
      count: input.reindexQueueCount,
      oldestQueuedAgeSeconds: input.oldestQueuedAgeSeconds,
    },
    failedMutations: input.failedMutations,
    pendingSearchWork: input.pendingSearchWork,
    pendingAuditWork: input.pendingAuditWork,
    canonicalRevision: input.canonicalRevision,
    identifierConflictsOpen: input.identifierConflictsOpen,
  };
}
