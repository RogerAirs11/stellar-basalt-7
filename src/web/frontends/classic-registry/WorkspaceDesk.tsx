import React, { useState } from "react";
import {
  usePlatformCommand,
  usePrincipalScope,
  useMyWorkspaces,
  useWorkspaceDashboard,
  useWorkspaceDeskCommands,
  useWorkspaceDoneTasks,
  useMyWorkspaceInvitations,
  useWorkspaceDocumentCommands,
  useWorkspaceDocuments,
  classifyWorkspaceAnswerFailure,
  commandFeedback,
  newImportIntentKey,
  WORKSPACE_DESK,
  WORKSPACES,
  type PlatformClient,
  type PlatformUser,
  type WorkspaceTaskRecord,
  type WorkspaceDocumentRecord,
  type WorkspaceDocumentKind, kitText, pick } from "../../../frontend-kit";

/**
 * R114-05 (Master AI R113 handoff D22/D32–35) — Classic Registry's compact
 * NATIVE stable-workspace desk (host layer, iframe boundary intact) over the
 * ONE shared headless module: the principal's own lists, a consent-first
 * team, versioned (CAS) reminder completion and assignment, and the
 * working-set herd. A workspace is a WORKING SET, never an ownership claim;
 * the server re-checks every access live, so a revoked member's stale view
 * masks instead of painting private rows.
 */

const panel: React.CSSProperties = { border: "1px solid #92400e", background: "#fffbeb", padding: "12px", margin: "10px 0", borderRadius: "4px" };
const label: React.CSSProperties = { display: "block", margin: "8px 0", fontSize: "14px" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: "6px", marginTop: "4px", border: "1px solid #92400e", borderRadius: "3px", boxSizing: "border-box" };
const button: React.CSSProperties = { padding: "8px 14px", background: "#92400e", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer", marginTop: "8px" };
const alertBox: React.CSSProperties = { ...panel, borderColor: "#b91c1c", background: "#fef2f2" };
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #fde68a" };

const TASK_CATEGORY_LABEL: Record<string, [string, string]> = {
  document_renewal: ["Document renewal", "تمدید مدرک"],
  farrier: ["Farrier", "نعل‌بندی"],
  veterinary_appointment: ["Veterinary appointment", "نوبت دامپزشکی"],
  other: ["Other", "سایر"],
};

export function ClassicRegistryWorkspaceDesk({ workspaceId, platform, user, locale = "en" }: { workspaceId: number | null; platform: PlatformClient | null; user?: PlatformUser | null; locale?: "en" | "fa" | "ar" }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const T = WORKSPACE_DESK;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(scope);
  const mine = useMyWorkspaces({ platform, scope, userId: user?.id ?? null, enabled: user != null });
  const [selected, setSelected] = useState<number | null>(workspaceId);
  const [nameDraft, setNameDraft] = useState("");
  const activeId = selected ?? workspaceId;
  if (!user) return <section style={panel} aria-label={pick(T.deskTitle, locale)}><p>{L("Sign in to see your stable workspaces.", "برای دیدن فضاهای کاری اصطبل خود وارد شوید.")}</p></section>;
  const rows = mine.mine.phase === "ready" || mine.mine.phase === "reloading" ? [...mine.mine.lists.owned, ...mine.mine.lists.staff, ...mine.mine.lists.organization] : [];
  return <>
    <section style={panel} aria-label={pick(T.deskTitle, locale)} data-surface="workspace-desk">
      <h3 style={{ margin: "0 0 8px" }}>{pick(T.deskTitle, locale)}</h3>
      <p style={{ fontSize: "13px" }}>{pick(T.deskNote, locale)}</p>
      {mine.mine.phase === "loading" ? <p role="status">{L("Loading your workspaces…", "بارگذاری فضاهای کاری شما…")}</p> : null}
      {mine.mine.phase === "forbidden" || mine.mine.phase === "unavailable" || mine.mine.phase === "error" ? <div role="alert" style={alertBox}><p>{L("Your workspace list is unavailable.", "فهرست فضای کاری شما در دسترس نیست.")}</p><p>{mine.mine.reason}</p><button style={button} onClick={mine.retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
      {(mine.mine.phase === "ready" || mine.mine.phase === "reloading") ? (rows.length ? <ul style={{ listStyle: "none", padding: 0 }}>{rows.map(summary => <li key={`${summary.role}:${summary.id}`} style={rowStyle}>
        <div><strong>{summary.name}</strong><small> · {summary.role === "owner" ? pick(T.ownerRole, locale) : summary.role === "manager" ? pick(T.managerRole, locale) : pick(T.staffRole, locale)} · #{summary.id}</small></div>
        <button style={button} aria-current={activeId === summary.id} onClick={() => setSelected(summary.id)}>{L("Open", "باز کردن")}</button>
      </li>)}</ul> : <p>{pick(T.noWorkspaces, locale)}</p>) : null}
      <details><summary>{pick(T.createWorkspace, locale)}</summary>
        <form onSubmit={event => { event.preventDefault(); void commands.create.run(async () => {
          const result = await platform!.modules.workspaces.create({ name: nameDraft.trim() });
          setNameDraft(""); mine.retry(); setSelected(result.workspace.id); return result;
        }, { successMessage: L("Workspace created. It is a working set, never an ownership claim.", "فضای کاری ایجاد شد. این یک مجموعه کاری است، نه ادعای مالکیت.") }); }}>
          <label style={label}>{pick(T.workspaceName, locale)}<input style={input} required minLength={2} maxLength={120} dir="auto" value={nameDraft} disabled={commands.create.state.phase === "submitting"} onChange={event => setNameDraft(event.target.value)} /></label>
          <button style={button} type="submit" disabled={commands.create.state.phase === "submitting" || commands.create.state.phase === "failed" || nameDraft.trim().length < 2}>{pick(T.createWorkspace, locale)}</button>
        </form>
        {commands.create.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.create.state)}</p><button style={button} onClick={() => { commands.create.reset(); mine.retry(); }}>{L("Reload list", "بارگذاری دوباره فهرست")}</button></div> : null}
      </details>
    </section>
    {activeId !== null ? <ClassicWorkspaceDetail key={`${scope}:${activeId}`} workspaceId={activeId} platform={platform} user={user} locale={locale} /> : <section style={panel}><p>{pick(T.selectWorkspace, locale)}</p></section>}
    <ClassicMyWorkspaceInvitations platform={platform} user={user} locale={locale} />
  </>;
}

function ClassicWorkspaceDetail({ workspaceId, platform, user, locale = "en" }: { workspaceId: number; platform: PlatformClient | null; user?: PlatformUser | null; locale?: "en" | "fa" | "ar" }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const T = WORKSPACE_DESK;
  const W = WORKSPACES;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(`${scope}|workspace:${workspaceId}`);
  const { dashboard, retry } = useWorkspaceDashboard({ workspaceId, platform, scope, userId: user?.id ?? null });
  // R117-14: the completed list powers the reopen surface (one-shot rows only;
  // recurring closures carry their honest inline explanation instead).
  const doneTasks = useWorkspaceDoneTasks({ workspaceId, platform, scope, userId: user?.id ?? null });
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskCategory, setTaskCategory] = useState<"document_renewal" | "farrier" | "veterinary_appointment" | "other">("other");
  const [taskRepeat, setTaskRepeat] = useState("");
  const [horseId, setHorseId] = useState("");
  const [assignTaskId, setAssignTaskId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [invitee, setInvitee] = useState("");
  const [inviteActions, setInviteActions] = useState<Record<string, boolean>>({ view: true, tasks_manage: false });

  if (dashboard.phase === "loading" || dashboard.phase === "idle") return <section style={panel} aria-busy="true"><p role="status">{L("Loading the workspace…", "بارگذاری فضای کاری…")}</p></section>;
  if (dashboard.phase === "forbidden") return <section style={alertBox} role="alert"><p>{pick(T.forbiddenDashboard, locale)}</p><p>{dashboard.reason}</p></section>;
  if (dashboard.phase === "unavailable" || dashboard.phase === "error") return <section style={alertBox} role="alert"><p>{L("The workspace is unavailable.", "فضای کاری در دسترس نیست.")}</p><p>{dashboard.reason}</p><button style={button} onClick={retry}>{L("Read current workspace", "خواندن فضای کاری فعلی")}</button></section>;
  if (dashboard.phase === "empty") return <section style={alertBox} role="alert"><p>{L("This workspace was not found.", "این فضای کاری یافت نشد.")}</p></section>;

  const { data, tasks, permissions } = dashboard;
  const mayTask = permissions.mayTask;
  const mayManage = permissions.mayManage;
  const commandBusy = Object.values(commands).some(command => command.state.phase === "submitting");
  const chosenActions = (["view", "tasks_manage"] as const).filter(action => inviteActions[action]);
  const complete = (task: WorkspaceTaskRecord) => {
    void commands.completeTask.run(async () => {
      const result = await platform!.modules.workspaces.completeTask(workspaceId, task.id, { expectedVersion: task.row_version });
      retry(); doneTasks.retry(); return result;
    }, { successMessage: pick(T.completeSuccess, locale) });
  };
  const reopen = (task: WorkspaceTaskRecord) => {
    void commands.reopenTask.run(async () => {
      const result = await platform!.modules.workspaces.reopenTask(workspaceId, task.id, { expectedVersion: task.row_version });
      retry(); doneTasks.retry(); return result;
    }, { successMessage: pick(T.reopenSuccess, locale) });
  };
  const bucket = (title: string, rows: WorkspaceTaskRecord[]) => rows.length ? <div>
    <h4>{title} · {rows.length}</h4>
    <ul style={{ listStyle: "none", padding: 0 }}>{rows.map(task => <li key={task.id} style={rowStyle}>
      <div><strong>{task.title}</strong><small> · {L(TASK_CATEGORY_LABEL[task.category]?.[0] ?? "", TASK_CATEGORY_LABEL[task.category]?.[1] ?? "") ?? task.category} · {task.due_date} · {task.due_timezone ?? "Asia/Tehran"} · v{task.row_version}{task.assigned_to_user_id ? ` · ${L("assigned", "منتسب")}: ${task.assigned_to_user_id}` : ""}</small>
      {task.category === "veterinary_appointment" ? <small style={{ display: "block" }}>{pick(W.veterinaryNotice, locale)}</small> : null}</div>
      <button style={button} disabled={commandBusy || !mayTask} onClick={() => complete(task)} aria-label={`${pick(T.markComplete, locale)}: ${task.title}`}>{pick(T.markComplete, locale)}</button>
    </li>)}</ul>
  </div> : null;

  return <section style={panel} data-surface="workspace-detail" aria-busy={dashboard.phase === "reloading"}>
    <h3 style={{ margin: "0 0 8px" }}>{data.workspace?.name ?? `#${workspaceId}`} <small>· {data.herd_size} {L("horses in this working set", "اسب در این مجموعه کاری")}</small></h3>
    <button style={button} disabled={commandBusy} onClick={() => { Object.values(commands).forEach(command => command.reset()); retry(); }}>{L("Refresh workspace", "تازه‌سازی فضای کاری")}</button>
    {permissions.readOnly ? <p role="status">{pick(T.readOnlyPlan, locale)}</p> : null}
    {commands.completeTask.state.phase === "rejected" ? <div role="alert" style={alertBox}><p>{commands.completeTask.state.code === "already_closed" ? pick(T.alreadyClosed, locale) : pick(T.versionConflict, locale)}</p><button style={button} onClick={() => { commands.completeTask.reset(); retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></div> : null}
    {commands.completeTask.state.phase === "failed" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.completeTask.state)}</p><button style={button} onClick={() => { commands.completeTask.reset(); retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></div> : null}
    {commands.completeTask.state.phase === "accepted" ? <p role="status">{commandFeedback(commands.completeTask.state)}</p> : null}

    <h4>{pick(W.tasks, locale)}</h4>
    {mayTask ? <details><summary>{pick(T.addReminder, locale)}</summary>
      <form onSubmit={event => { event.preventDefault(); void commands.addTask.run(async () => {
        const result = await platform!.modules.workspaces.addTask(workspaceId, { title: taskTitle.trim(), category: taskCategory, due_date: taskDue, due_timezone: "Asia/Tehran", recurrence: taskRepeat ? "custom_days" : "none", recurrence_interval_days: taskRepeat ? Number(taskRepeat) : null });
        setTaskTitle(""); setTaskDue(""); setTaskRepeat(""); retry(); return result;
      }, { successMessage: L("Reminder recorded; no appointment was booked.", "یادآور ثبت شد؛ هیچ نوبتی رزرو نشد.") }); }}>
        <label style={label}>{pick(T.reminderTitle, locale)}<input style={input} required minLength={3} maxLength={200} dir="auto" value={taskTitle} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskTitle(event.target.value)} /></label>
        <label style={label}>{pick(T.reminderDue, locale)}<input style={input} required type="date" value={taskDue} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskDue(event.target.value)} /></label>
        <label style={label}>{pick(T.reminderCategory, locale)}<select style={input} value={taskCategory} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskCategory(event.target.value as typeof taskCategory)}>{Object.entries(TASK_CATEGORY_LABEL).map(([key, text]) => <option key={key} value={key}>{text[0]}</option>)}</select></label>
        <label style={label}>{pick(T.reminderRepeat, locale)}<input style={input} type="number" min="1" max="3650" step="1" value={taskRepeat} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskRepeat(event.target.value)} /></label>
        {taskCategory === "veterinary_appointment" ? <p style={{ fontSize: "12px" }}>{pick(W.veterinaryNotice, locale)}</p> : null}
        <button style={button} type="submit" disabled={commands.addTask.state.phase === "submitting" || commands.addTask.state.phase === "failed"}>{pick(T.addReminder, locale)}</button>
      </form>
      {commands.addTask.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.addTask.state)}</p><button style={button} onClick={() => { commands.addTask.reset(); retry(); }}>{L("Reload workspace", "بارگذاری دوباره")}</button></div> : null}
    </details> : <p>{pick(T.needTasksManage, locale)}</p>}
    {tasks.invalid.length ? <div role="alert" style={alertBox}><h4>{pick(T.invalidDates, locale)}</h4><ul>{tasks.invalid.map(task => <li key={task.id}>{task.title} · {task.due_date} · {task.due_timezone}</li>)}</ul></div> : null}
    {bucket(pick(W.overdue, locale), tasks.overdue)}
    {bucket(pick(W.dueSoon, locale), tasks.dueSoon)}
    {bucket(pick(W.later, locale), tasks.later)}
    {tasks.all.length === 0 ? <p>{L("No open reminders.", "یادآور بازی نیست.")}</p> : null}
    <details data-surface="workspace-completed"><summary>{pick(T.completedHeading, locale)}{doneTasks.done.phase === "ready" || doneTasks.done.phase === "reloading" ? ` · ${(doneTasks.done.rows ?? []).length}` : ""}</summary>
      <p>{pick(T.completedNote, locale)}</p>
      {doneTasks.done.phase === "forbidden" || doneTasks.done.phase === "unavailable" || doneTasks.done.phase === "error" ? <div role="alert" style={alertBox}><p dir="auto">{doneTasks.done.reason}</p><button style={button} onClick={doneTasks.retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
      {(doneTasks.done.phase === "ready" || doneTasks.done.phase === "reloading") && (doneTasks.done.rows ?? []).length ? <ul style={{ listStyle: "none", padding: 0 }}>{(doneTasks.done.rows ?? []).map(task => <li key={task.id} style={rowStyle}>
        <div><strong>{task.title}</strong><small> · {L(TASK_CATEGORY_LABEL[task.category]?.[0] ?? "", TASK_CATEGORY_LABEL[task.category]?.[1] ?? "") ?? task.category} · {task.due_date} · {task.due_timezone ?? "Asia/Tehran"} · v{task.row_version}{task.recurrence !== "none" ? ` · ${L("recurring occurrence", "وقوع تکرارشونده")}` : ""}</small>
          {task.recurrence !== "none" ? <small style={{ display: "block" }}>{pick(T.recurringCompleted, locale)}</small> : null}</div>
        {task.recurrence === "none" ? <button style={button} disabled={commandBusy || !mayTask} onClick={() => reopen(task)} aria-label={`${pick(T.reopen, locale)}: ${task.title}`}>{pick(T.reopen, locale)}</button> : null}
      </li>)}</ul> : null}
      {doneTasks.done.phase === "empty" ? <p>{pick(T.completedEmpty, locale)}</p> : null}
      {(doneTasks.done.phase === "idle" || doneTasks.done.phase === "loading") ? <p role="status">{L("Loading completed reminders…", "بارگذاری یادآورهای انجام‌شده…")}</p> : null}
      {commands.reopenTask.state.phase === "rejected" ? <div role="alert" style={alertBox}><p>{commands.reopenTask.state.code === "not_completed" ? pick(T.notCompleted, locale) : commands.reopenTask.state.code === "recurring_occurrence_completed" ? pick(T.recurringCompleted, locale) : pick(T.versionConflict, locale)}</p><button style={button} onClick={() => { commands.reopenTask.reset(); retry(); doneTasks.retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></div> : null}
      {commands.reopenTask.state.phase === "failed" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.reopenTask.state)}</p><button style={button} onClick={() => { commands.reopenTask.reset(); retry(); doneTasks.retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></div> : null}
      {commands.reopenTask.state.phase === "accepted" ? <p role="status">{commandFeedback(commands.reopenTask.state)}</p> : null}
    </details>
    {mayTask && tasks.open.length ? <details><summary>{pick(T.assignReminder, locale)}</summary>
      <form onSubmit={event => { event.preventDefault(); const task = tasks.open.find(row => String(row.id) === assignTaskId); if (!task) return; void commands.reassignTask.run(async () => {
        const result = await platform!.modules.workspaces.reassignTask(workspaceId, task.id, assignee.trim() === "" ? null : assignee.trim(), { expectedVersion: task.row_version });
        setAssignTaskId(""); setAssignee(""); retry(); return result;
      }, { successMessage: L("Assignment updated and audit-recorded; the task version advanced.", "انتساب به‌روزرسانی و ثبت شد؛ نسخه یادآور پیش رفت.") }); }}>
        <label style={label}>{pick(W.tasks, locale)}<select style={input} required value={assignTaskId} disabled={commands.reassignTask.state.phase === "submitting"} onChange={event => setAssignTaskId(event.target.value)}><option value="">{L("Choose…", "انتخاب…")}</option>{tasks.open.map(task => <option key={task.id} value={String(task.id)}>{task.title} · {task.due_date} · v{task.row_version}</option>)}</select></label>
        <label style={label}>{pick(T.assignTo, locale)}<input style={input} dir="ltr" list="classic-workspace-staff" value={assignee} disabled={commands.reassignTask.state.phase === "submitting"} onChange={event => setAssignee(event.target.value)} /><datalist id="classic-workspace-staff">{(data.active_staff ?? []).map(member => <option key={member.user_id} value={member.user_id} />)}</datalist></label>
        <button style={button} type="submit" disabled={commands.reassignTask.state.phase === "submitting" || assignTaskId === ""}>{L("Update assignment", "به‌روزرسانی انتساب")}</button>
      </form>
      {commands.reassignTask.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.reassignTask.state)}</p><button style={button} onClick={() => { commands.reassignTask.reset(); retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></div> : null}
    </details> : null}

    <h4>{pick(W.herd, locale)}</h4>
    <p style={{ fontSize: "13px" }}>{pick(W.neverDeleted, locale)}</p>
    {data.horses.length ? <ul style={{ listStyle: "none", padding: 0 }}>{data.horses.map((horse, index) => {
      const id = Number(horse.horse_id ?? horse.id);
      const name = String((locale !== "en" ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native) || (Number.isSafeInteger(id) ? `#${id}` : L("Horse record", "رکورد اسب")));
      return <li key={Number.isSafeInteger(id) ? id : index} style={rowStyle}>
        <div><strong>{name}</strong>{Number.isSafeInteger(id) && id > 0 ? <small> · #{id}</small> : null}</div>
        {mayManage && Number.isSafeInteger(id) && id > 0 ? <button style={button} disabled={commands.removeHorse.state.phase === "submitting"} onClick={() => { void commands.removeHorse.run(async () => { const result = await platform!.modules.workspaces.removeHorse(workspaceId, id); retry(); return result; }, { successMessage: pick(W.neverDeleted, locale) }); }}>{pick(T.removeHorse, locale)}</button> : null}
      </li>;
    })}</ul> : <p>{pick(T.noHorses, locale)}</p>}
    {mayManage ? <details><summary>{L("Add a managed horse", "افزودن اسب تحت مدیریت")}</summary>
      <form onSubmit={event => { event.preventDefault(); const id = Number(horseId); if (!Number.isSafeInteger(id) || id < 1) return; void commands.addHorse.run(async () => { const result = await platform!.modules.workspaces.addHorse(workspaceId, id); setHorseId(""); retry(); return result; }); }}>
        <label style={label}>{pick(T.addHorseLabel, locale)}<input style={input} required type="number" min="1" step="1" value={horseId} disabled={commands.addHorse.state.phase === "submitting"} onChange={event => setHorseId(event.target.value)} /></label>
        <button style={button} type="submit" disabled={commands.addHorse.state.phase === "submitting" || commands.addHorse.state.phase === "failed"}>{L("Add to working set", "افزودن به مجموعه کاری")}</button>
      </form>
      {commands.addHorse.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.addHorse.state)}</p><button style={button} onClick={() => { commands.addHorse.reset(); retry(); }}>{L("Reload herd", "بارگذاری دوباره گله")}</button></div> : null}
    </details> : null}

    <h4>{pick(T.staffHeading, locale)}</h4>
    <p style={{ fontSize: "13px" }}>{pick(W.staffConsent, locale)}</p>
    {(data.active_staff ?? []).length ? <ul style={{ listStyle: "none", padding: 0 }}>{(data.active_staff ?? []).map(member => <li key={member.user_id} style={rowStyle}>
      <div><strong>{member.user_id}</strong><small> · {L("Actions", "اقدامات")}: {(member.actions ?? []).join(", ")}</small></div>
      {mayManage && member.user_id !== user?.id ? <button style={button} disabled={commands.revokeStaff.state.phase === "submitting"} onClick={() => { void commands.revokeStaff.run(async () => { const result = await platform!.modules.workspaces.revokeStaff(workspaceId, member.user_id); retry(); return result; }, { successMessage: pick(T.revokeSuccess, locale) }); }}>{pick(T.revokeAccess, locale)}</button> : null}
    </li>)}</ul> : <p>{pick(T.noActiveStaff, locale)}</p>}
    {mayManage ? <details><summary>{pick(T.inviteStaff, locale)}</summary>
      <p style={{ fontSize: "13px" }}>{pick(T.inviteConsent, locale)}</p>
      <form onSubmit={event => { event.preventDefault(); void commands.invite.run(async () => {
        const result = await platform!.modules.workspaces.inviteStaff(workspaceId, { invitee_user_id: invitee.trim(), actions: chosenActions.join(","), note: null });
        setInvitee(""); retry(); return result;
      }, { successMessage: L("Invitation sent. It expires honestly after 14 days.", "دعوت ارسال شد؛ پس از ۱۴ روز صادقانه منقضی می‌شود.") }); }}>
        <label style={label}>{L("User id", "شناسه کاربر")}<input style={input} required minLength={3} maxLength={64} dir="ltr" value={invitee} disabled={commands.invite.state.phase === "submitting"} onChange={event => setInvitee(event.target.value)} /></label>
        <div style={label}>{L("Proposed actions", "اقدامات پیشنهادی")}{(["view", "tasks_manage"] as const).map(action => <label key={action} style={{ marginRight: "10px", display: "inline-flex", gap: "4px" }}><input type="checkbox" checked={inviteActions[action] ?? false} disabled={commands.invite.state.phase === "submitting"} onChange={event => setInviteActions(prev => ({ ...prev, [action]: event.target.checked }))} />{action}</label>)}</div>
        <button style={button} type="submit" disabled={commands.invite.state.phase === "submitting" || commands.invite.state.phase === "failed" || chosenActions.length === 0}>{L("Send invitation", "ارسال دعوت")}</button>
      </form>
      {commands.invite.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.invite.state)}</p><button style={button} onClick={() => { commands.invite.reset(); retry(); }}>{L("Reload team", "بارگذاری دوباره تیم")}</button></div> : null}
    </details> : null}
    {commands.revokeStaff.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.revokeStaff.state)}</p><button style={button} onClick={() => { commands.revokeStaff.reset(); retry(); }}>{L("Reload team", "بارگذاری دوباره تیم")}</button></div> : null}

    <ClassicWorkspaceDocuments platform={platform} workspaceId={workspaceId} mayTask={mayTask} locale={locale} user={user} />
  </section>;
}

/** The invitee's own cross-workspace inbox (R114-05) with honest answer refusals. */
export function ClassicMyWorkspaceInvitations({ platform, user, locale = "en" }: { platform: PlatformClient | null; user?: PlatformUser | null; locale?: "en" | "fa" | "ar" }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const T = WORKSPACE_DESK;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(scope);
  const mine = useMyWorkspaceInvitations({ platform, scope, userId: user?.id ?? null, enabled: user != null && platform != null });
  const [answerFailure, setAnswerFailure] = useState<string | null>(null);
  if (!user || platform == null) return null;
  const answer = (invitationId: number, action: "accept" | "decline", success: string) => {
    setAnswerFailure(null);
    void commands.respond.run(async () => {
      try {
        const result = await platform.modules.workspaces.respondInvite(invitationId, action);
        mine.retry(); return result;
      } catch (error) {
        const failure = classifyWorkspaceAnswerFailure(error);
        setAnswerFailure(failure.kind === "expired" ? pick(T.expiredAnswer, locale) : failure.kind === "already_answered" ? pick(T.alreadyAnswered, locale) : failure.kind === "not_acceptable" ? pick(T.notAcceptableAnswer, locale) : failure.kind === "gone" ? pick(T.goneAnswer, locale) : pick(T.unknownAnswer, locale));
        throw error;
      }
    }, { successMessage: success });
  };
  return <section style={panel} aria-label={pick(T.myInvitations, locale)} data-surface="workspace-invitations">
    <h3 style={{ margin: "0 0 8px" }}>{pick(T.myInvitations, locale)}</h3>
    {mine.phase === "loading" ? <p role="status">{L("Loading your invitations…", "بارگذاری دعوت‌های شما…")}</p> : null}
    {mine.phase === "unavailable" || mine.phase === "error" ? <div role="alert" style={alertBox}><p>{L("Your invitation list is unavailable.", "فهرست دعوت شما در دسترس نیست.")}</p><p>{mine.reason}</p><button style={button} onClick={mine.retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
    {mine.phase === "ready" ? (mine.invitations.length ? <ul style={{ listStyle: "none", padding: 0 }}>{mine.invitations.map(invitation => <li key={invitation.collection_id} style={rowStyle}>
      <div><strong>{invitation.workspace_name}</strong><small> · {L("Proposed", "پیشنهاد")}: {invitation.proposed_actions} · {L("expires", "انقضا")}: {invitation.expires_at.slice(0, 10)}</small></div>
      {invitation.actionable ? <div>
        <button style={button} disabled={commands.respond.state.phase === "submitting"} onClick={() => answer(invitation.collection_id, "accept", L("Invitation accepted. Your access is re-checked live on every request.", "دعوت پذیرفته شد. دسترسی شما در هر درخواست زنده بررسی می‌شود."))}>{pick(T.accept, locale)}</button>
        <button style={{ ...button, marginLeft: "6px" }} disabled={commands.respond.state.phase === "submitting"} onClick={() => answer(invitation.collection_id, "decline", L("Invitation declined.", "دعوت رد شد."))}>{pick(T.decline, locale)}</button>
      </div> : <small>{pick(T.expiredAnswer, locale)}</small>}
    </li>)}</ul> : <p>{L("You have no pending workspace invitations.", "دعوت فضای کاری در انتظار ندارید.")}</p>) : null}
    {answerFailure ? <div role="alert" style={alertBox}><p>{answerFailure}</p></div> : null}
    {commands.respond.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(commands.respond.state)}</p><button style={button} onClick={() => { commands.respond.reset(); mine.retry(); }}>{L("Reload invitations", "بارگذاری دوباره دعوت‌ها")}</button></div> : null}
  </section>;
}

const DOCUMENT_CATEGORY_LABEL: Record<string, [string, string]> = {
  identification: ["Identification", "شناسایی"],
  registration: ["Registration", "ثبت‌نامه"],
  insurance: ["Insurance", "بیمه"],
  ownership: ["Ownership", "مالکیت"],
  veterinary_paper: ["Veterinary paper", "مدرک دامپزشکی"],
  transport: ["Transport", "حمل‌ونقل"],
  other: ["Other", "سایر"],
};

/**
 * R114-06 (Master AI handoff D23/D32–35) — Classic Registry's compact native
 * DOCUMENT trackers + bounded no-overwrite reminder import (host layer, donor
 * iframe boundary intact). Trackers only; versioned CAS updates keep the
 * draft on a 409; the horse association is fixed at creation; archived rows
 * are read-only history; one durable intent key per import session.
 */
function ClassicWorkspaceDocuments({ platform, workspaceId, mayTask, locale = "en", user }: { platform: PlatformClient | null; workspaceId: number; mayTask: boolean; locale?: "en" | "fa" | "ar"; user?: PlatformUser | null }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const T = WORKSPACE_DESK;
  const W = WORKSPACES;
  const scope = usePrincipalScope(user, null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const { documents, retry } = useWorkspaceDocuments({ workspaceId, includeArchived, platform, scope, userId: user?.id ?? null });
  const { createDocument, importTasks } = useWorkspaceDocumentCommands(`${scope}|workspace:${workspaceId}`);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<WorkspaceDocumentKind>("registration");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [receipts, setReceipts] = useState<Array<{ title: string; status: string; task_id: number | null }> | null>(null);
  const [importTitle, setImportTitle] = useState("");
  const [importDue, setImportDue] = useState("");
  const [intentKey, setIntentKey] = useState(() => newImportIntentKey());
  const createBlocked = (documents.phase !== "ready" && documents.phase !== "reloading" && documents.phase !== "empty") || createDocument.state.phase === "submitting" || createDocument.state.phase === "failed";
  const importBlocked = importTasks.state.phase === "submitting" || importTasks.state.phase === "failed";
  const importValid = importTitle.trim().length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(importDue);

  return <section style={panel} aria-label={pick(T.documentsTitle, locale)} data-surface="workspace-documents">
    <h3 style={{ margin: "0 0 8px" }}>{pick(T.documentsTitle, locale)}</h3>
    <p style={{ fontSize: "13px" }}>{pick(W.documentTrackers, locale)}</p>
    <button style={button} aria-pressed={includeArchived} onClick={() => setIncludeArchived(v => !v)}>{includeArchived ? pick(T.hideArchived, locale) : pick(T.includeArchived, locale)}</button>
    <button style={{ ...button, marginLeft: "6px" }} onClick={() => retry()}>{L("Refresh documents", "تازه‌سازی مدرک‌ها")}</button>
    {platform ? <a style={{ marginLeft: "8px" }} href={platform.modules.workspaces.exportUrl(workspaceId)}>{pick(T.exportCsv, locale)}</a> : null}
    {documents.phase === "loading" ? <p role="status">{L("Loading document trackers…", "بارگذاری پیگیرهای مدرک…")}</p> : null}
    {documents.phase === "forbidden" ? <div role="alert" style={alertBox}><p>{pick(T.forbiddenDashboard, locale)}</p></div> : null}
    {documents.phase === "unavailable" || documents.phase === "error" ? <div role="alert" style={alertBox}><p>{L("The document list is unavailable.", "فهرست مدرک در دسترس نیست.")}</p><p>{documents.reason}</p><button style={button} onClick={retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
    {(documents.phase === "ready" || documents.phase === "reloading") ? (documents.rows.length ? <ul style={{ listStyle: "none", padding: 0 }}>{documents.rows.map(row => <ClassicDocumentRow key={row.id} platform={platform} workspaceId={workspaceId} row={row} mayTask={mayTask && documents.phase === "ready"} locale={locale} onDone={retry} />)}</ul> : <p>{pick(T.noDocuments, locale)}</p>) : null}
    {documents.phase === "empty" ? <p>{pick(T.noDocuments, locale)}</p> : null}
    {mayTask ? <details><summary>{pick(T.trackDocument, locale)}</summary>
      <form onSubmit={event => { event.preventDefault(); if (createBlocked) return; void createDocument.run(async () => {
        const result = await platform!.modules.workspaces.createDocument(workspaceId, { title: title.trim(), category, note: note.trim() || null, expires_at: expiresAt || null });
        setTitle(""); setNote(""); setExpiresAt(""); retry(); return result;
      }, { successMessage: L("Document tracker created.", "پیگیر مدرک ساخته شد.") }); }}>
        <label style={label}>{L("Title", "عنوان")}<input style={input} required minLength={1} maxLength={300} dir="auto" value={title} disabled={createBlocked} onChange={event => setTitle(event.target.value)} /></label>
        <label style={label}>{L("Category", "دسته")}<select style={input} value={category} disabled={createBlocked} onChange={event => setCategory(event.target.value as typeof category)}>{Object.entries(DOCUMENT_CATEGORY_LABEL).map(([key, text]) => <option key={key} value={key}>{text[0]}</option>)}</select></label>
        <label style={label}>{L("Expiry day (optional, Gregorian)", "روز انقضا (اختیاری، میلادی)")}<input style={input} type="date" value={expiresAt} disabled={createBlocked} onChange={event => setExpiresAt(event.target.value)} /></label>
        <label style={label}>{L("Note (optional)", "یادداشت (اختیاری)")}<input style={input} maxLength={2000} dir="auto" value={note} disabled={createBlocked} onChange={event => setNote(event.target.value)} /></label>
        <button style={button} type="submit" disabled={createBlocked}>{pick(T.createTracker, locale)}</button>
      </form>
      {createDocument.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(createDocument.state)}</p><button style={button} onClick={() => { createDocument.reset(); retry(); }}>{L("Reload documents", "بارگذاری دوباره مدرک‌ها")}</button></div> : null}
    </details> : <p>{pick(T.needTasksManageDocuments, locale)}</p>}
    {mayTask ? <details><summary>{pick(T.importUpTo, locale)}</summary>
      <p style={{ fontSize: "13px" }}>{pick(W.importNoOverwrite, locale)}</p>
      <form onSubmit={event => { event.preventDefault(); if (importBlocked || !importValid) return; const row = { title: importTitle.trim(), category: "other" as const, due_date: importDue }; void importTasks.run(async () => {
        const result = await platform!.modules.workspaces.importTasks(workspaceId, [row], { intentKey });
        setReceipts(result.receipts.map(receipt => ({ title: receipt.title, status: receipt.status, task_id: receipt.task_id })));
        setIntentKey(newImportIntentKey());
        retry(); return result;
      }, { successMessage: pick(T.importFinished, locale) }); }}>
        <label style={label}>{L("Row title", "عنوان ردیف")}<input style={input} required maxLength={300} dir="auto" value={importTitle} disabled={importBlocked} onChange={event => setImportTitle(event.target.value)} /></label>
        <label style={label}>{L("Due date (Gregorian)", "سررسید (میلادی)")}<input style={input} required type="date" value={importDue} disabled={importBlocked} onChange={event => setImportDue(event.target.value)} /></label>
        <button style={button} type="submit" disabled={importBlocked || !importValid}>{L("Import one row", "درون‌ریزی یک ردیف")}</button>
      </form>
      {importTasks.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(importTasks.state)}</p><button style={button} onClick={() => { importTasks.reset(); retry(); }}>{L("Reload workspace", "بارگذاری دوباره")}</button></div> : null}
      {importTasks.state.phase === "accepted" && receipts ? <div role="status"><h4>{pick(T.perRowReceipts, locale)}</h4><ul style={{ listStyle: "none", padding: 0 }}>{receipts.map((receipt, index) => <li key={index} style={rowStyle}><strong>{receipt.title}</strong><small> · {receipt.status === "imported" ? pick(T.importedLabel, locale) : receipt.status === "already_imported" ? pick(T.alreadyImportedLabel, locale) : receipt.status === "occurrence_exists" ? pick(T.occurrenceExistsLabel, locale) : pick(T.rowRefusedLabel, locale)}{receipt.task_id != null ? ` · #${receipt.task_id}` : ""}</small></li>)}</ul></div> : null}
    </details> : null}
  </section>;
}

/** ONE document row (compact): its own command slots; the 409 story derives
 * from the command STATE at render time. */
function ClassicDocumentRow({ platform, workspaceId, row, mayTask, locale = "en", onDone }: { platform: PlatformClient | null; workspaceId: number; row: WorkspaceDocumentRecord; mayTask: boolean; locale?: "en" | "fa" | "ar"; onDone: () => void }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const T = WORKSPACE_DESK;
  const updateDocument = usePlatformCommand(`workspace-document-update:${workspaceId}:${row.id}`);
  const archiveCommand = usePlatformCommand(`workspace-document-archive:${workspaceId}:${row.id}`);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [note, setNote] = useState(row.note ?? "");
  const [expiresAt, setExpiresAt] = useState(row.expires_at ?? "");
  const archived = row.status === "archived";
  return <li style={rowStyle} data-surface="workspace-document-row">
    <div><strong>{row.title}</strong><small> · {DOCUMENT_CATEGORY_LABEL[row.category]?.[0] ?? row.category}{row.horse_id != null ? ` · ${L("horse", "اسب")} #${row.horse_id} (${pick(T.horseFixed, locale)})` : ""}{row.expires_at ? ` · ${L("expires", "انقضا")}: ${row.expires_at}` : ""} · v{row.row_version}{archived ? ` · ${pick(T.archivedReadOnly, locale)}` : ""}</small>
    {row.note ? <small style={{ display: "block" }}>{row.note}</small> : null}</div>
    {mayTask && !archived ? <div>
      {!editing ? <button style={button} onClick={() => { setTitle(row.title); setNote(row.note ?? ""); setExpiresAt(row.expires_at ?? ""); setEditing(true); }}>{L("Edit", "ویرایش")}</button> : null}
      {editing ? <form onSubmit={event => { event.preventDefault(); void updateDocument.run(async () => {
        const result = await platform!.modules.workspaces.updateDocument(workspaceId, row.id, {
          // R108-08: the association round-trips exactly as stored.
          horse_id: row.horse_id, title: title.trim(), category: row.category, note: note.trim() || null, expires_at: expiresAt || null,
        }, { expectedVersion: row.row_version });
        setEditing(false); onDone(); return result;
      }, { successMessage: L("Document updated.", "مدرک به‌روزرسانی شد.") }); }}>
        <label style={label}>{L("Title", "عنوان")}<input style={input} required minLength={1} maxLength={300} dir="auto" value={title} disabled={updateDocument.state.phase === "submitting"} onChange={event => setTitle(event.target.value)} /></label>
        <label style={label}>{L("Expiry day (optional)", "روز انقضا (اختیاری)")}<input style={input} type="date" value={expiresAt} disabled={updateDocument.state.phase === "submitting"} onChange={event => setExpiresAt(event.target.value)} /></label>
        <label style={label}>{L("Note", "یادداشت")}<input style={input} maxLength={2000} dir="auto" value={note} disabled={updateDocument.state.phase === "submitting"} onChange={event => setNote(event.target.value)} /></label>
        <button style={button} type="submit" disabled={updateDocument.state.phase === "submitting"}>{pick(T.saveVersioned, locale)}</button>
        <button style={{ ...button, marginLeft: "6px" }} type="button" disabled={updateDocument.state.phase === "submitting"} onClick={() => setEditing(false)}>{L("Cancel", "انصراف")}</button>
      </form> : null}
      <button style={{ ...button, marginLeft: "6px" }} disabled={archiveCommand.state.phase === "submitting"} onClick={() => { void archiveCommand.run(async () => { const result = await platform!.modules.workspaces.archiveDocument(workspaceId, row.id); onDone(); return result; }, { successMessage: pick(T.archivedNote, locale) }); }}>{pick(T.archive, locale)}</button>
    </div> : null}
    {updateDocument.state.phase === "rejected" ? <div role="alert" style={alertBox}><p>{updateDocument.state.message}</p><p>{updateDocument.state.code === "document_version_conflict" ? pick(T.documentConflict, locale) : updateDocument.state.code === "document_horse_immutable" ? pick(WORKSPACES.documentHorseImmutable, locale) : updateDocument.state.code === "document_archived" ? pick(T.archivedReadOnly, locale) : ""}</p>{updateDocument.state.currentVersion != null ? <p>{L("Current version", "نسخه فعلی")}: v{updateDocument.state.currentVersion}</p> : null}<button style={button} onClick={() => { updateDocument.reset(); onDone(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></div> : null}
    {archiveCommand.state.phase !== "idle" ? <div role="alert" style={alertBox}><p>{commandFeedback(archiveCommand.state)}</p><button style={button} onClick={() => { archiveCommand.reset(); onDone(); }}>{L("Reload documents", "بارگذاری دوباره مدرک‌ها")}</button></div> : null}
  </li>;
}
