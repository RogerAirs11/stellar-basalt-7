import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

/**
 * R122 / R122-T01 (Master AI audit R122-A01/A02/A03) — the merge/unmerge
 * invariant protocol.
 *
 * The previous implementation gated its integrity on a CONDITIONAL final
 * receipt INSERT. When that INSERT's WHERE clause failed, the INSERT affected
 * zero rows — but the batch had already committed every earlier statement
 * (reference moves, soft-archive, redirect alias), and the post-batch
 * exception could not undo them. Merging an ancestor into its descendant
 * could also repoint the kept horse's own parent at itself; the advisory
 * graph lock serializes writers but never validated the resulting graph.
 *
 * The protocol here is a REAL, adapter-supported, transaction-aborting
 * assertion:
 *
 *   1. Acquire the graph-wide advisory lock FIRST (existing marker statement;
 *      pg_advisory_xact_lock with a bounded lock_timeout on PostgreSQL).
 *   2. Apply the value-guarded moves, archive/restore and alias writes.
 *   3. ASSERT every final invariant by inserting into merge_invariant_assertions
 *      with `ok = CASE WHEN <invariants> THEN 1 ELSE 0 END`. The table's named
 *      CHECK constraint (merge_invariant_required) makes a failed invariant a
 *      constraint violation INSIDE the batch — and because D1 batches, the
 *      SQLite adapter's BEGIN/COMMIT and the PostgreSQL transaction are all
 *      atomic, the ENTIRE command (moves, alias, record, receipt, revision
 *      bump, counters) rolls back. No zero-row receipt trick, no
 *      division-by-zero provider quirk, no post-commit check.
 *   4. Only after a passing assertion: the merge record / receipt, audit
 *      settlement, canonical-revision bump and active-horse counter, each
 *      CAS-conditioned on OUR operation's durable row so they commit exactly
 *      once, in the same transaction.
 *
 * The assertion rows that remain after a successful commit are durable
 * evidence of what was proven true at commit time.
 */

/** The named CHECK constraint that turns a failed predicate into a
 * transaction-aborting error on every provider. */
export const MERGE_INVARIANT_CONSTRAINT_NAME = "merge_invariant_required";

/**
 * The ancestry closure walk — the portable single-branch recursive CTE form
 * introduced by R120/IMP-012 (PostgreSQL requires the recursive self-reference
 * in exactly one recursive term; the older two-branch form failed to even
 * PARSE on PostgreSQL 18). Seeded at a subject horse's CURRENT parents and
 * walking upward over both father and mother edges.
 */
const SUBJECT_ANCESTRY_CLOSURE_SQL = `WITH RECURSIVE subject_ancestors(id) AS (
    SELECT CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END
      FROM horses h, (SELECT 0 AS k UNION ALL SELECT 1) side
      WHERE h.id=CAST(? AS BIGINT) AND CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
    UNION
    SELECT CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END
      FROM horses h JOIN subject_ancestors a ON h.id=a.id, (SELECT 0 AS k UNION ALL SELECT 1) side
      WHERE CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
  )`;

/**
 * The post-move cycle invariant. A violation exists when the subject horse
 * appears in its own ancestor closure: a direct self-parent (the R122-A02
 * ancestor-collapse reproduction) or any longer cycle through the subject.
 *
 * One closure check per command is EXACT, not a heuristic: every edge a merge
 * writes points at the KEPT horse and every edge an unmerge restores points
 * at the MERGED horse, so any cycle that did not exist before the command
 * must pass through that command's subject.
 *
 * Binds, in order: [subject_horse_id, subject_horse_id].
 */
export const MERGE_ANCESTRY_CYCLE_GUARD_SQL = `NOT EXISTS (
  ${SUBJECT_ANCESTRY_CLOSURE_SQL}
  SELECT 1 FROM subject_ancestors WHERE id=CAST(? AS BIGINT)
)`;

/**
 * Readable probe over the SAME closure for honest post-rollback
 * classification: returns a row when the CURRENT committed graph contains a
 * cycle through the subject. Binds: [subject, subject, subject].
 */
export const ANCESTRY_CYCLE_PROBE_SQL = `SELECT 1 AS cycle_through_subject FROM horses subject
  WHERE subject.id=CAST(? AS BIGINT) AND EXISTS (
  ${SUBJECT_ANCESTRY_CLOSURE_SQL}
  SELECT 1 FROM subject_ancestors WHERE id=CAST(? AS BIGINT)
)`;

/**
 * Readable probe: returns a row when `ancestor` is reachable from `subject`
 * through parent edges in the CURRENT committed graph (ancestor ∈ the
 * subject's ancestor closure). Used for honest post-rollback classification:
 * a merge whose merged horse is an ANCESTOR of the kept horse is exactly the
 * ancestor-collapse direction the assertion refuses (every merge edge points
 * at the kept horse, so the resulting cycle necessarily passes through it),
 * and symmetrically for unmerge with the roles exchanged.
 * Binds: [subject, subject, ancestor].
 */
export const ANCESTOR_OF_PROBE_SQL = `SELECT 1 AS ancestor_of_subject FROM horses subject
  WHERE subject.id=CAST(? AS BIGINT) AND EXISTS (
  ${SUBJECT_ANCESTRY_CLOSURE_SQL}
  SELECT 1 FROM subject_ancestors WHERE id=CAST(? AS BIGINT)
)`;

/**
 * Build the transaction-aborting invariant assertion statement.
 *
 * @param db adapter (D1 / SQLite / PostgreSQL-compatible)
 * @param scope command identity recorded with the durable assertion row
 * @param predicates invariant predicate SQL fragments, joined with AND. The
 *        caller's authority predicate is prepended automatically, so the
 *        first bind in `predicateBinds` must be the actor user id.
 */
export function mergeInvariantAssertionStatement(
  db: D1Database,
  scope: { command: "merge" | "unmerge"; operationId: string; keptHorseId: number; mergedHorseId: number; authoritySql: string },
  predicates: string[],
  predicateBinds: unknown[],
): D1PreparedStatement {
  const allPredicates = [`EXISTS(${scope.authoritySql})`, ...predicates];
  return db.prepare(`
    INSERT INTO merge_invariant_assertions(command,operation_id,kept_horse_id,merged_horse_id,ok)
    SELECT ?,?,?,?,CASE WHEN ${allPredicates.join(" AND ")} THEN 1 ELSE 0 END
  `).bind(scope.command, scope.operationId, scope.keptHorseId, scope.mergedHorseId, ...predicateBinds);
}

/**
 * Recognize the assertion's CHECK-constraint failure across providers:
 * PostgreSQL raises SQLSTATE 23514 naming the constraint; SQLite and D1
 * report "CHECK constraint failed: merge_invariant_required". Matching the
 * constraint NAME (not just the class) keeps unrelated CHECK failures —
 * e.g. the receipts' command enum — from being misclassified.
 */
export function isMergeInvariantViolation(cause: unknown): boolean {
  const record = cause as { code?: string; constraint?: string; message?: unknown } | null;
  const message = cause instanceof Error ? cause.message : String((cause as { message?: unknown } | null)?.message ?? cause ?? "");
  if (record?.code === "23514") {
    const constraint = record.constraint;
    return constraint === MERGE_INVARIANT_CONSTRAINT_NAME
      || (typeof constraint !== "string" && message.includes(MERGE_INVARIANT_CONSTRAINT_NAME));
  }
  return message.includes(`CHECK constraint failed: ${MERGE_INVARIANT_CONSTRAINT_NAME}`)
    || message.includes(`violates check constraint "${MERGE_INVARIANT_CONSTRAINT_NAME}"`);
}
