import type { D1Database } from "@cloudflare/workers-types";
import { HttpError } from "../api/http";
import type { PrivacyViewer } from "../privacy/policy";
import type { ProfessionalGrantPermission } from "../contracts/professionalAccess";
import { geneticActionPredicate, requireGeneticPermissions } from "../access/geneticAccess";

export type GeneticOperation = "intake" | "interpretation" | "pairing_review";
export interface GeneticOperationContext {
  viewer: PrivacyViewer;
  horseId: number;
  operationId: string;
  action: GeneticOperation;
  requestJson: string;
  permissions: readonly ProfessionalGrantPermission[];
}

/** A retry rechecks current authority before revealing a private receipt.
 * Operation IDs cannot be reassigned to another actor, subject or intent. */
export async function geneticOperationReceipt<T>(db: D1Database, context: GeneticOperationContext): Promise<T | null> {
  await requireGeneticPermissions(db, context.viewer, context.horseId, context.permissions);
  const guard = geneticActionPredicate(context.viewer, context.horseId, context.permissions);
  const row = await db.prepare(`SELECT actor_user_id,horse_id,action,request_json,decision_json
    FROM genetic_evidence_operations WHERE operation_id=? AND (${guard.sql})`)
    .bind(context.operationId, ...guard.bindings)
    .first<{ actor_user_id: string; horse_id: number; action: string; request_json: string; decision_json: string }>();
  if (!row) return null;
  if (row.actor_user_id !== context.viewer.user.id || Number(row.horse_id) !== context.horseId || row.action !== context.action || row.request_json !== context.requestJson) {
    throw new HttpError(409, "operation_conflict", "This operation reference was used for another actor, subject or request");
  }
  return JSON.parse(row.decision_json) as T;
}

export function isGeneticReceiptConflict(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "23505" || /UNIQUE constraint failed: (genetic_evidence_operations|genetic_tests\.intake_operation_id)/i.test(cause instanceof Error ? cause.message : String(cause));
}
