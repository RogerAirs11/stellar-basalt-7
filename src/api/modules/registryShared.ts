/** R117-20: shared mutation/audit helpers used by the route-handler modules
 * (claims, changeRequests) and the inline registry handlers in routes.ts.
 * Extracted verbatim from src/api/routes.ts — behavior unchanged.
 */
import { HttpError, json } from "../http";
import { finalizeCanonicalMutation, markMutationAuditComplete, recordMutationPendingError } from "../../audit/mutationJournal";
import { refreshHorseSearch } from "../../search/refresh";
import { register } from "../modules/authExt";
import { type ParentAssignmentIssue, validateParentAssignment } from "../../pedigree/integrity";

/**
 * R59 (review fact-check #6): a new write must not collide with another LIVE
 * horse's register number or microchip. The legacy import legitimately contains
 * historical duplicate register numbers, so this is an application-level guard
 * rather than a hard database constraint — new editorial writes are held to
 * the stricter rule.
 */
export async function assertNoLiveHorseDuplicates(
  db: D1Database,
  excludeId: number | null,
  data: { register_no?: string | null; microchip_no?: string | null },
): Promise<void> {
  for (const [field, value] of [["register_no", data.register_no], ["microchip_no", data.microchip_no]] as const) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const clash = await db
      .prepare(`SELECT id, name_latin, name_native FROM horses WHERE ${field}=? AND deleted_at IS NULL AND id != ? LIMIT 2`)
      .bind(normalized, excludeId ?? -1)
      .all<{ id: number; name_latin: string; name_native: string | null }>();
    const others = (clash.results ?? []).filter((row) => row.id !== excludeId);
    if (others.length) {
      throw new HttpError(409, "duplicate_horse_identity", `Another live horse already uses this ${field === "register_no" ? "register number" : "microchip number"}`, {
        field,
        value: normalized,
        existing: others.map((row) => ({ id: row.id, name_latin: row.name_latin, name_native: row.name_native })),
      });
    }
  }
}

export async function assertValidParentAssignment(
  db: D1Database,
  horseId: number | null,
  fatherId?: number | null,
  motherId?: number | null,
): Promise<void> {
  const validation = await validateParentAssignment(db, horseId, fatherId, motherId);
  if (validation.valid) return;
  throwParentAssignmentIssue(validation.issues[0]!);
}

export function throwParentAssignmentIssue(issue: ParentAssignmentIssue): never {
  const status = issue.code === "pedigree_validation_limit" ? 422 : 400;
  throw new HttpError(status, issue.code, issue.message, issue.details);
}

export async function settleWorkflowMutation(
  db: D1Database, mutationId: string, entityId: string, actor: string, action: string, entityType: string,
  before: unknown, after: unknown, reqId: string,
): Promise<void> {
  try { await finalizeCanonicalMutation(db, mutationId, entityId, after); }
  catch (cause) { await recordMutationPendingError(db, mutationId, cause); }

  try {
    await audit(db, actor, action, entityType, entityId, before, after, reqId, mutationId);
    await markMutationAuditComplete(db, mutationId);
  } catch (cause) {
    await recordMutationPendingError(db, mutationId, cause);
  }
}

export async function settleCanonicalHorseMutation(
  db: D1Database, mutationId: string, horseId: number, actor: string, action: string, before: unknown, after: unknown, reqId: string,
): Promise<void> {
  try { await finalizeCanonicalMutation(db, mutationId, String(horseId), after); }
  catch (cause) { await recordMutationPendingError(db, mutationId, cause); }

  try {
    await audit(db, actor, action, "horse", String(horseId), before, after, reqId, mutationId);
    await markMutationAuditComplete(db, mutationId);
  } catch (cause) {
    await recordMutationPendingError(db, mutationId, cause);
  }

  try {
    await db.prepare("INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason) VALUES(?,?)")
      .bind(horseId,"canonical_mutation_pending").run();
    await refreshHorseSearch(db, horseId);
    await db.batch([
      db.prepare("DELETE FROM horse_search_reindex_queue WHERE horse_id=?").bind(horseId),
      db.prepare("UPDATE canonical_mutation_log SET search_status='complete',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(mutationId),
    ]);
  } catch (cause) {
    await recordMutationPendingError(db, mutationId, cause);
  }
}

export async function audit(db: D1Database, actor: string, action: string, entityType: string, entityId: string, before: unknown, after: unknown, reqId: string, mutationLogId?: string): Promise<void> {
  await db.prepare(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id,mutation_log_id)
    VALUES(?,?,?,?,?,?,?,?)`).bind(actor, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reqId, mutationLogId ?? null).run();
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  // D1 returns JSON columns as text; Postgres json/jsonb arrives already
  // parsed (objects/arrays). Accept both shapes.
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; }
}

export function parseJsonArray(value: unknown): unknown[] {
  // D1 returns JSON columns as text; Postgres json/jsonb arrives already
  // parsed. Accept both shapes.
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

