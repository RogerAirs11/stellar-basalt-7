/** Initial-task identity includes every field that changes the user's intent.
 * Recurrences retain their parent-family occurrence identity separately. */
export interface InitialTaskIdentity {
  collectionId: number; actorUserId: string; horseId: number | null;
  title: string; category: string; dueDate: string; dueTimezone: string;
  recurrence: string; recurrenceIntervalDays: number | null; assignedToUserId: string | null;
}
export async function initialTaskKey(input: InitialTaskIdentity): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([
    "initial-task-v2",input.collectionId,input.actorUserId,input.horseId,input.title.trim(),input.category,
    input.dueDate,input.dueTimezone,input.recurrence,
    input.recurrence === "custom_days" ? input.recurrenceIntervalDays : null,input.assignedToUserId,
  ]));
  const digest = await crypto.subtle.digest("SHA-256",bytes);
  return `task:initial:${[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("")}`;
}
export function matchesInitialTask(row: Record<string,unknown>,input: InitialTaskIdentity): boolean {
  return Number(row.collection_id)===input.collectionId && row.created_by_user_id===input.actorUserId
    && (row.horse_id==null?null:Number(row.horse_id))===input.horseId && row.title===input.title.trim() && row.category===input.category
    && row.due_date===input.dueDate && (row.due_timezone ?? "Asia/Tehran")===input.dueTimezone
    && row.recurrence===input.recurrence
    && (row.recurrence==="custom_days"?Number(row.recurrence_interval_days):null)===(input.recurrence==="custom_days"?input.recurrenceIntervalDays:null)
    && (row.assigned_to_user_id ?? null)===input.assignedToUserId;
}
