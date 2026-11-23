export interface CanonicalMutationIntent {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  requested?: unknown;
  requestId: string;
  searchStatus?: "pending" | "complete" | "not_applicable";
}

function jsonValue(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** Statement inserted in the same D1 batch as the canonical mutation. */
export function canonicalMutationIntentStatement(db: D1Database, input: CanonicalMutationIntent): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_mutation_log(
      id,actor_user_id,action,entity_type,entity_id,before_json,requested_json,request_id,search_status
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    input.id,
    input.actorUserId,
    input.action,
    input.entityType,
    input.entityId ?? null,
    jsonValue(input.before),
    jsonValue(input.requested),
    input.requestId,
    input.searchStatus ?? "pending",
  );
}

export async function finalizeCanonicalMutation(
  db: D1Database,
  mutationId: string,
  entityId: string,
  after: unknown,
): Promise<void> {
  await db.prepare(`
    UPDATE canonical_mutation_log
    SET entity_id=?,after_json=?,status='committed',finalized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(entityId, jsonValue(after), mutationId).run();
}

export async function abortCanonicalMutation(db: D1Database, mutationId: string, error?: string): Promise<void> {
  await db.prepare(`
    UPDATE canonical_mutation_log
    SET status='aborted',search_status='not_applicable',audit_status='not_applicable',last_error=?,finalized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(error?.slice(0, 1000) ?? null, mutationId).run();
}

export async function markMutationAuditComplete(db: D1Database, mutationId: string): Promise<void> {
  await db.prepare("UPDATE canonical_mutation_log SET audit_status='complete',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(mutationId).run();
}

export async function markMutationSearchComplete(db: D1Database, mutationId: string): Promise<void> {
  await db.prepare("UPDATE canonical_mutation_log SET search_status='complete',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(mutationId).run();
}

export async function recordMutationPendingError(db: D1Database, mutationId: string, cause: unknown): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause ?? "unknown side-effect failure");
  try {
    await db.prepare("UPDATE canonical_mutation_log SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(message.slice(0, 1000), mutationId).run();
  } catch {
    // The journal intent itself is already durable; failure to annotate it must not
    // turn a committed canonical mutation into a false client-visible failure.
  }
}

export async function materializePendingMutationSearchWork(db: D1Database, limit = 3): Promise<number> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 3)) : 3;
  const result = await db.prepare(`
    INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason)
    SELECT h.id,'canonical_mutation_pending'
    FROM canonical_mutation_log m
    JOIN horses h ON (CAST(m.entity_id AS INTEGER)=h.id OR h.last_mutation_id=m.id)
    WHERE m.entity_type='horse' AND m.search_status='pending' AND m.status IN ('intent','committed')
    ORDER BY m.created_at
    LIMIT ?
  `).bind(safeLimit).run();
  return Number(result.meta.changes ?? 0);
}

export async function markHorseMutationSearchComplete(db: D1Database, horseId: number): Promise<void> {
  await db.prepare(`
    UPDATE canonical_mutation_log
    SET search_status='complete',updated_at=CURRENT_TIMESTAMP
    WHERE entity_type='horse' AND search_status='pending'
      AND (CAST(entity_id AS INTEGER)=? OR id=(SELECT last_mutation_id FROM horses WHERE id=?))
  `).bind(horseId, horseId).run();
}

/** Recreate user-facing audit rows from the durable canonical journal when needed. */
export async function reconcilePendingMutationAudits(
  db: D1Database,
  limit = 4,
): Promise<{ processed: number; remaining: number; quarantined: number }> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 4)) : 4;
  const pending = await db.prepare(`
    SELECT m.id,m.actor_user_id,m.action,m.entity_type,
           COALESCE(m.entity_id,CAST(h.id AS TEXT)) AS resolved_entity_id,
           m.before_json,m.after_json,m.requested_json,m.request_id,m.status
    FROM canonical_mutation_log m
    LEFT JOIN horses h ON m.entity_type='horse' AND h.last_mutation_id=m.id
    WHERE m.audit_status='pending'
      AND (
        m.status='committed'
        OR (m.status='intent' AND (m.entity_id IS NOT NULL OR h.id IS NOT NULL))
      )
    ORDER BY m.created_at
    LIMIT ?
  `).bind(safeLimit).all<{
    id: string; actor_user_id: string | null; action: string; entity_type: string; resolved_entity_id: string | null;
    before_json: string | null; after_json: string | null; requested_json: string | null; request_id: string | null; status: string;
  }>();

  let processed = 0;
  let quarantined = 0;
  for (const item of pending.results) {
    if (!item.resolved_entity_id) continue;
    try {
      await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,reason,request_id,mutation_log_id)
          VALUES(?,?,?,?,?,?,?,?,?)
        `).bind(
          item.actor_user_id,
          item.action,
          item.entity_type,
          item.resolved_entity_id,
          item.before_json,
          item.after_json ?? item.requested_json,
          item.after_json ? null : "reconciled_from_durable_mutation_intent",
          item.request_id,
          item.id,
        ),
        db.prepare(`
          UPDATE canonical_mutation_log
          SET entity_id=?,status='committed',audit_status='complete',updated_at=CURRENT_TIMESTAMP,
              finalized_at=COALESCE(finalized_at,CURRENT_TIMESTAMP)
          WHERE id=?
        `).bind(item.resolved_entity_id, item.id),
      ]);
      processed += 1;
    } catch (cause) {
      // D-REC-1: a single corrupt journal row (e.g. an actor FK violation that
      // can only originate from direct DB tampering, because every product path
      // binds actor_user_id from the authenticated session) must not crash the
      // whole reconciliation batch or wedge the pending queue. Quarantine the
      // one row through the EXISTING journal state machine without inventing a
      // new architecture: keep `status` truthful (the canonical change may be
      // durably committed), mark only the impossible audit side-effect as
      // 'not_applicable', and record the cause in last_error for operators.
      // The row leaves the pending queue but remains visible and inspectable.
      const message = cause instanceof Error ? cause.message : String(cause ?? "unknown reconcile failure");
      await db.prepare(`
        UPDATE canonical_mutation_log
        SET audit_status='not_applicable',last_error=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(`reconcile_quarantine: ${message}`.slice(0, 1000), item.id).run();
      quarantined += 1;
    }
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM canonical_mutation_log WHERE audit_status='pending' AND status IN ('intent','committed')")
    .first<{ count: number }>();
  return { processed, remaining: Number(count?.count ?? 0), quarantined };
}
