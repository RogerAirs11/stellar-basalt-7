import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { workspaceAuthority } from "./mutationCommands";

/** A stale completion must not create a next reminder. The random marker
 * binds recurrence to THIS successful CAS, never merely to a done task.
 * R95-N08: the authority predicate is the ONE shared mutation-time
 * workspaceAuthority fragment (N07-consistent: an org workspace requires a
 * CURRENT workspace-manager membership even for its creating owner). */
export function completeTaskStatements(db:D1Database,input:{collectionId:number;taskId:number;actorUserId:string;expectedVersion:number;operationId:string;nextDueDate:string|null}):D1PreparedStatement[] {
  const auth=workspaceAuthority(input.actorUserId,"tasks_manage");
  const statements=[db.prepare(`UPDATE workspace_tasks
    SET status='done',completed_at=CURRENT_TIMESTAMP,completed_by_user_id=?,row_version=row_version+1,updated_at=CURRENT_TIMESTAMP,last_operation_id=?
    WHERE id=? AND collection_id=? AND row_version=? AND status='open' AND EXISTS(
      SELECT 1 FROM workspace_collections wc WHERE wc.id=workspace_tasks.collection_id AND wc.deleted_at IS NULL AND ${auth.sql})`)
    .bind(input.actorUserId,input.operationId,input.taskId,input.collectionId,input.expectedVersion,...auth.binds)];
  if (input.nextDueDate) statements.push(db.prepare(`
    INSERT INTO workspace_tasks(collection_id,horse_id,title,category,due_date,recurrence,recurrence_interval_days,created_by_user_id,assigned_to_user_id,occurrence_key,occurrence_index,parent_task_id,due_timezone)
    SELECT collection_id,horse_id,title,category,?,recurrence,recurrence_interval_days,created_by_user_id,assigned_to_user_id,?,occurrence_index+1,id,due_timezone
    FROM workspace_tasks WHERE id=? AND collection_id=? AND status='done' AND last_operation_id=?
    ON CONFLICT(occurrence_key) DO NOTHING
  `).bind(input.nextDueDate,`task-parent:${input.taskId}:next`,input.taskId,input.collectionId,input.operationId));
  return statements;
}
