import type { CanonicalHorseUpdateParams, CanonicalHorseUpdateStatements } from "./mutations";
import { identifierStatementsForHorseChange } from "./identifiers";
import { registrationAliasStatements } from "./registrationDetails";
import { isTypedDateChange, TYPED_DATE_COLUMNS, type TypedDateField } from "./typedDateValue";

// The three bound IDs are typed once so PostgreSQL can type null parents.
// Guard liveness AND cycles after taking the graph lock. A preflight-only
// existence check races archive even when the cycle query itself is serialized.
const PARENTAGE_CYCLE_GUARD_SQL = ` AND NOT EXISTS (
  WITH RECURSIVE requested(father_id,mother_id,horse_id) AS (
    SELECT CAST(? AS BIGINT),CAST(? AS BIGINT),CAST(? AS BIGINT)
  ), ancestor_ids(id) AS (
    SELECT h.id FROM horses h, requested p
      WHERE h.deleted_at IS NULL AND (h.id=p.father_id OR h.id=p.mother_id)
    UNION
    SELECT CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END
      FROM horses h JOIN ancestor_ids a ON h.id=a.id,
           (SELECT 0 AS k UNION ALL SELECT 1) side
      WHERE CASE WHEN side.k=0 THEN h.father_id ELSE h.mother_id END IS NOT NULL
  )
  SELECT 1 FROM requested p WHERE
    (p.father_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM horses h WHERE h.id=p.father_id AND h.deleted_at IS NULL))
    OR (p.mother_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM horses h WHERE h.id=p.mother_id AND h.deleted_at IS NULL))
    OR EXISTS(SELECT 1 FROM ancestor_ids a WHERE a.id=p.horse_id)
)`;

/** R120 portable-guard note: PostgreSQL requires a recursive CTE's
 * self-reference to appear in exactly ONE recursive term — the previous
 * two-branch (father UNION mother) form passed through the SQLite→PG
 * translator unchanged and FAILED TO PARSE on PostgreSQL 18 ("recursive
 * reference ... must not appear within its non-recursive term"), meaning
 * every parentage edit on the live Supabase database would have errored.
 * The single-branch CASE form above is valid on BOTH SQLite/D1 and
 * PostgreSQL and walks the identical ancestor closure (verified by the
 * two-connection barrier evidence: scripts/r120-imp012-graph-barrier.mjs). */

/**
 * R120 / IMP-012 (BE-13): graph-wide serialization for pedigree mutations on
 * PostgreSQL. On PG (supabase_full) the batch is a READ COMMITTED
 * transaction: two concurrent parentage edits on DIFFERENT horses can each
 * evaluate the cycle guard above against a pre-commit snapshot and both
 * commit, corrupting the acyclic invariant (write skew). The fix follows the
 * proven AI-reservation pattern (src/db/supabaseCompat.ts): a SEPARATE
 * advisory-lock statement FIRST in the batch. Because it is a separate
 * statement, every later statement — including the guard inside the UPDATE —
 * takes a fresh READ COMMITTED snapshot AFTER the lock is granted, so the
 * guard re-validates the graph against all concurrent commits it serialized
 * with. On SQLite/D1 the marker executes as a plain SELECT: those engines
 * serialize writers at the database level, so no advisory lock is needed or
 * possible. The PG adapter recognizes this marker as batch[0] and substitutes
 * pg_advisory_xact_lock with a bounded lock_timeout (see supabaseCompat.ts).
 * Namespace 710110 is distinct from the AI admission lock (710109).
 */
export const PEDIGREE_GRAPH_LOCK_NAMESPACE = 710110;
export const PEDIGREE_GRAPH_LOCK_SQL = "SELECT ? AS pedigree_graph_lock";

/** Build the graph-lock first statement for a batch that mutates parentage. */
export function pedigreeGraphLockStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(PEDIGREE_GRAPH_LOCK_SQL).bind(PEDIGREE_GRAPH_LOCK_NAMESPACE);
}

/**
 * The conditioned-batch SQL below is exported as stable template constants so
 * the Python race-semantics regression suite (tests/python/test_audit_regressions.py)
 * can replay the EXACT statements the TypeScript builder emits against a real
 * SQLite database — keeping source and replay from drifting apart.
 */
export const HORSE_UPDATE_SQL_TEMPLATE = (setSql: string) => `UPDATE horses SET ${setSql},updated_at=CURRENT_TIMESTAMP,row_version=row_version+1,last_mutation_id=?
    WHERE id=? AND deleted_at IS NULL AND row_version=?`;
export const HORSE_UPDATE_CHANGE_REQUEST_GUARD_SQL = ` AND EXISTS(SELECT 1 FROM change_requests WHERE id=? AND status IN ('pending','draft'))`;
export const HORSE_UPDATE_PARENTAGE_GUARD_SQL = PARENTAGE_CYCLE_GUARD_SQL;
export const REGISTRY_REVISION_BUMP_SQL = `UPDATE registry_state SET canonical_revision=canonical_revision+1,analytics_stale=1,updated_at=CURRENT_TIMESTAMP
      WHERE id=1 AND EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)`;
export const REINDEX_SELF_SQL = `INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason)
      SELECT ?,?
      WHERE EXISTS(SELECT 1 FROM horses WHERE id=? AND last_mutation_id=?)`;
export const REINDEX_CHILDREN_ON_NAME_SQL = `INSERT OR IGNORE INTO horse_search_reindex_queue(horse_id,reason)
          SELECT child.id,'parent_name_changed' FROM horses child
          WHERE child.deleted_at IS NULL AND (child.father_id=? OR child.mother_id=?)
            AND EXISTS(SELECT 1 FROM horses changed WHERE changed.id=? AND changed.last_mutation_id=?)`;

/**
 * Build the shared conditioned-batch statements for a canonical horse update.
 * Both the direct edit path and the reviewed change-request apply path use
 * this builder, guaranteeing identical race protections (optimistic row
 * version + pedigree cycle guard + change-request CAS) and identical search
 * invalidation (self always; direct children when a parent name changed —
 * T09: the reviewed path previously never queued children).
 */
export function buildCanonicalHorseUpdateStatements(db: D1Database, params: CanonicalHorseUpdateParams): CanonicalHorseUpdateStatements {
  const { plan, horseId, expectedRowVersion, mutationId } = params;
  // T12: a typed date change expands into its value/precision/calendar column
  // triple; birth_date additionally syncs the legacy birth_year bucket used by
  // search/filters, and a death date implies is_dead=1 (set in planHorseMutation).
  if (!Object.keys(plan.normalizedChanges).length) throw new TypeError("A canonical update requires at least one field");
  const setSqlParts: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(plan.normalizedChanges)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || ["id", "row_version", "last_mutation_id", "deleted_at"].includes(key)) throw new TypeError("Invalid canonical update field");
    if (isTypedDateChange(value)) {
      const columns = TYPED_DATE_COLUMNS[key as TypedDateField];
      if (!columns) throw new TypeError("Typed date supplied for a non-date field");
      setSqlParts.push(`${columns.value}=?`, `${columns.precision}=?`, `${columns.calendar}=?`);
      values.push(value.date ? value.date.value : null, value.date ? value.date.precision : null, value.date ? value.date.calendar : null);
      if (key === "birth_date" && plan.normalizedChanges.birth_year === undefined) {
        setSqlParts.push("birth_year=?");
        values.push(value.date ? value.gregorianYear : null);
      }
      continue;
    }
    setSqlParts.push(`${key}=?`);
    values.push(value);
  }
  const setSql = setSqlParts.join(",");

  const updateSql = HORSE_UPDATE_SQL_TEMPLATE(setSql)
    + (params.viaChangeRequestId ? HORSE_UPDATE_CHANGE_REQUEST_GUARD_SQL : "")
    + (plan.parentageChanged ? HORSE_UPDATE_PARENTAGE_GUARD_SQL : "")
    + (params.additionalGuard ? ` AND (${params.additionalGuard.sql})` : "");
  const updateStatement = db.prepare(updateSql)
    .bind(...values, mutationId, horseId, expectedRowVersion,
      ...(params.viaChangeRequestId ? [params.viaChangeRequestId] : []),
      ...(plan.parentageChanged ? [plan.nextFather, plan.nextMother, horseId] : []),
      ...(params.additionalGuard?.bindings ?? []));

  const afterUpdateStatements: D1PreparedStatement[] = [
    // T08: move live identifier rows in the same transaction
    ...identifierStatementsForHorseChange(db, {
      horseId,
      mutationId,
      source: params.viaChangeRequestId ? "change_request_apply" : "direct_edit",
      changes: plan.effectiveIdentifierChanges,
      identifierTableReady: params.identifierTableReady,
    }),
    ...(plan.registrationAliases === undefined ? [] : registrationAliasStatements(db, plan.registrationAliases, mutationId, true)),
    // canonical revision bump + analytics staleness (deeper caches recompute via revision)
    db.prepare(REGISTRY_REVISION_BUMP_SQL).bind(horseId, mutationId),
    // T09: the edited horse always reindexes
    db.prepare(REINDEX_SELF_SQL)
      .bind(horseId, params.viaChangeRequestId ? "change_request_applied" : "canonical_horse_update", horseId, mutationId),
    // T09: direct children carry the parent name in their denormalized search text
    ...(plan.touchesName ? [db.prepare(REINDEX_CHILDREN_ON_NAME_SQL).bind(horseId, horseId, horseId, mutationId)] : []),
  ];
  return { updateStatement, afterUpdateStatements };
}

