/**
 * R96-N09 — timezone-aware reminder delivery integration.
 *
 * A bounded, idempotent pass that enqueues ONE non-essential notification
 * per (task, due date) when an OPEN reminder reaches its due date in ITS OWN
 * timezone. Deterministic event keys ('workspace-task:<id>:due:<date>') make
 * scheduler retries no-ops; the notification drain's own send-time rules
 * (preferences, quiet hours, monthly caps, live recipient re-authorization)
 * apply unchanged. The reminder body is built from the task's public-to-the-
 * workspace fields only (title, category, due date, workspace name) — never
 * private contact or medical content, and no veterinary schedule is invented
 * (the veterinary notice travels with the category).
 */
import type { D1Database } from "@cloudflare/workers-types";
import { outboxStatement, maskRecipient } from "../notifications/outbox";
import { workspaceAuthority } from "./policy";
import { isValidDay, localDateInZone, VETERINARY_NOTICE } from "./domain";

export const DUE_REMINDER_BATCH_LIMIT = 50;

export async function enqueueDueTaskReminders(db: D1Database, nowIso: string): Promise<{ enqueued: number; scanned: number }> {
  // One pass: open tasks whose LOCAL date (in the task's own timezone) has
  // reached the due date. Due-today and overdue both remind exactly once.
  const rows = await db.prepare(`
    SELECT t.id, t.title, t.category, t.due_date, t.due_timezone, t.assigned_to_user_id,
           t.collection_id, c.name AS workspace_name, c.owner_user_id,
           COALESCE(t.assigned_to_user_id, c.owner_user_id) AS notify_user_id
    FROM workspace_tasks t
    JOIN workspace_collections c ON c.id=t.collection_id AND c.deleted_at IS NULL
    WHERE t.status='open' AND t.due_date IS NOT NULL AND t.due_date<=?
      AND NOT EXISTS(SELECT 1 FROM notification_outbox n
        WHERE n.payload_ref='workspace_tasks:'||CAST(t.id AS TEXT)
          AND n.recipient_user_id=COALESCE(t.assigned_to_user_id,c.owner_user_id)
          AND (n.event_key='workspace-task:'||CAST(t.id AS TEXT)||':due:'||t.due_date
            OR n.event_key LIKE 'workspace-task:'||CAST(t.id AS TEXT)||':due:'||t.due_date||':%'))
    ORDER BY COALESCE(t.reminder_checked_at,''),t.due_date,t.id LIMIT ${DUE_REMINDER_BATCH_LIMIT}
  `).bind(new Date(Date.parse(nowIso)+86_400_000).toISOString().slice(0,10)).all<{
    id: number; title: string; category: string; due_date: string; due_timezone: string;
    collection_id: number; workspace_name: string; notify_user_id: string;
  }>();
  const candidates = rows.results ?? [];
  let enqueued = 0;
  for (const task of candidates) {
    // Rotate temporarily ineligible candidates instead of permanently starving
    // later tasks. Outbox identity excludes already-enqueued occurrences.
    await db.prepare("UPDATE workspace_tasks SET reminder_checked_at=? WHERE id=? AND status='open'")
      .bind(nowIso,task.id).run();
    const tz = task.due_timezone || "Asia/Tehran";
    let localToday: string;
    try { localToday = localDateInZone(tz, nowIso); } catch { continue; }
    const due = String(task.due_date).slice(0, 10);
    if (!isValidDay(due) || due > localToday) continue; // not due yet in its own zone
    // Only notify accounts that exist and are active; a missing/deactivated
    // recipient is skipped honestly (never a fabricated send).
    const user = await db.prepare("SELECT email FROM users WHERE id=? AND is_active=1").bind(task.notify_user_id)
      .first<{ email: string }>();
    if (!user) continue;
    const authority = workspaceAuthority(task.notify_user_id,"view");
    if (!await db.prepare(`SELECT wc.id FROM workspace_collections wc WHERE wc.id=? AND wc.deleted_at IS NULL AND ${authority.sql}`)
      .bind(task.collection_id,...authority.binds).first()) continue;
    const recipientHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(task.notify_user_id))))
      .map(byte=>byte.toString(16).padStart(2,"0")).join("").slice(0,24);
    const eventKey = `workspace-task:${task.id}:due:${due}:recipient:${recipientHash}`;
    const statements = outboxStatement(db, {
      eventKey,
      channel: "email",
      purpose: "workspace_task_due",
      recipientUserId: task.notify_user_id,
      recipientMasked: maskRecipient("email",user.email),
      payloadRef: `workspace_tasks:${task.id}`,
      occurredAt: nowIso,
    });
    const results = await db.batch(Array.isArray(statements) ? statements : [statements]);
    enqueued += Number(results[0]?.meta.changes ?? 0);
  }
  return { enqueued, scanned: candidates.length };
}

/** Build the reminder body from the task's workspace-visible fields only.
 * User-entered strings (task title, workspace name) are HTML-ESCAPED — the
 * service-notice channel stays deliberately generic, but a reminder must
 * say WHICH task is due, so the title rides along escaped, never raw. */
export function workspaceTaskReminderBody(task: { title: string; category: string; due_date: string; workspace_name: string }): { subject: string; html: string } {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const title = esc(task.title);
  const wsName = esc(task.workspace_name);
  const dueDate = esc(task.due_date);
  const veterinary = task.category === "veterinary_appointment" ? `<p>${VETERINARY_NOTICE}</p>` : "";
  return {
    subject: `یادآوری سررسید / Reminder due ${task.due_date} — ${task.workspace_name}`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;direction:ltr">
<p>یادآوری «${title}» در ${wsName} سررسید شده است.</p>
<p>The reminder "${title}" in workspace "${wsName}" is due (${dueDate}).</p>
${veterinary}
<p>این یک یادآوری ثبت‌شده توسط کاربر است. / This is a user-entered reminder, not medical advice.</p>
</body></html>`,
  };
}
