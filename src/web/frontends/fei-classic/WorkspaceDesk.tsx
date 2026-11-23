import { useState } from "react";
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
  type WorkspaceDocumentKind, pick } from "../../../frontend-kit";
import { EditorNotice, editorText, type EditorLocale } from "./editorUi";

/**
 * R114-05 (Master AI R113 handoff D22/D32–35) — FEI Classic's NATIVE stable
 * workspace desk over the shared headless module: the principal's own lists,
 * a consent-first team, versioned (CAS) reminder completion and assignment,
 * and the working-set herd. A workspace is a WORKING SET, never an ownership
 * claim; every access is re-checked live by the server.
 */

const TASK_CATEGORY_LABEL: Record<string, [string, string]> = {
  document_renewal: ["Document renewal", "تمدید مدرک"],
  farrier: ["Farrier", "نعل‌بندی"],
  veterinary_appointment: ["Veterinary appointment", "نوبت دامپزشکی"],
  other: ["Other", "سایر"],
};

type Props = { workspaceId?: number | null; platform: PlatformClient | null; user?: PlatformUser | null; locale?: EditorLocale };

export function FeiClassicWorkspaceDesk({ workspaceId = null, platform, user, locale = "en" }: Props) {
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  const T = WORKSPACE_DESK;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(scope);
  const mine = useMyWorkspaces({ platform, scope, userId: user?.id ?? null, enabled: user != null });
  const [selected, setSelected] = useState<number | null>(workspaceId);
  const [nameDraft, setNameDraft] = useState("");
  const activeId = selected ?? workspaceId;
  return <section className="fc112-editor" aria-label={L("Stable workspaces", "فضاهای کاری اصطبل")} data-surface="workspace-desk">
    <h2>{pick(T.deskTitle, locale)}</h2><p>{pick(T.deskNote, locale)}</p>
    {!user ? <EditorNotice locale={locale} title={L("Sign in to see your stable workspaces", "برای دیدن فضاهای کاری اصطبل خود وارد شوید")}><a href="/f/fei-classic/auth">{L("Sign in", "ورود")}</a></EditorNotice> : <>
      {mine.mine.phase === "loading" ? <p role="status">{L("Loading your workspaces…", "بارگذاری فضاهای کاری شما…")}</p> : null}
      {mine.mine.phase === "forbidden" || mine.mine.phase === "unavailable" || mine.mine.phase === "error" ? <EditorNotice locale={locale} alert title={L("Your workspace list is unavailable", "فهرست فضای کاری شما در دسترس نیست")}><p dir="auto">{mine.mine.reason}</p><button type="button" onClick={mine.retry}>{L("Try loading again", "تلاش دوباره")}</button></EditorNotice> : null}
      {(mine.mine.phase === "ready" || mine.mine.phase === "reloading") ? (() => {
        const lists = mine.mine.lists;
        const rows = [...lists.owned, ...lists.staff, ...lists.organization];
        return rows.length ? <ul className="fc112-editor-checks">{rows.map(summary => <li key={`${summary.role}:${summary.id}`}>
          <button type="button" aria-current={activeId === summary.id} onClick={() => setSelected(summary.id)}><strong dir="auto">{summary.name}</strong><small>{summary.role === "owner" ? pick(T.ownerRole, locale) : summary.role === "manager" ? pick(T.managerRole, locale) : pick(T.staffRole, locale)} · #{summary.id}</small></button>
        </li>)}</ul> : <EditorNotice locale={locale} title={pick(T.noWorkspaces, locale)} />;
      })() : null}
      <details className="fc112-editor-areas"><summary>{pick(T.createWorkspace, locale)}</summary>
        <form onSubmit={event => { event.preventDefault(); void commands.create.run(async () => {
          const result = await platform!.modules.workspaces.create({ name: nameDraft.trim() });
          setNameDraft(""); mine.retry(); setSelected(result.workspace.id); return result;
        }, { successMessage: L("Workspace created. It is a working set, never an ownership claim.", "فضای کاری ایجاد شد. این یک مجموعه کاری است، نه ادعای مالکیت.") }); }}>
          <label className="fc112-editor-field"><span>{pick(T.workspaceName, locale)}</span><input required minLength={2} maxLength={120} dir="auto" value={nameDraft} disabled={commands.create.state.phase === "submitting"} onChange={event => setNameDraft(event.target.value)} /></label>
          <button type="submit" disabled={commands.create.state.phase === "submitting" || commands.create.state.phase === "failed" || nameDraft.trim().length < 2}>{pick(T.createWorkspace, locale)}</button>
        </form>
        {commands.create.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.create.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.create.reset(); mine.retry(); }}>{L("Reload list", "بارگذاری دوباره فهرست")}</button></EditorNotice> : null}
      </details>
      <FeiMyWorkspaceInvitations platform={platform} user={user} locale={locale} />
      {activeId !== null ? <FeiWorkspaceDetail key={`${scope}:${activeId}`} workspaceId={activeId} platform={platform} user={user} locale={locale} /> : <EditorNotice locale={locale} title={pick(T.selectWorkspace, locale)} />}
    </>}
  </section>;
}

function FeiWorkspaceDetail({ workspaceId, platform, user, locale = "en" }: Props & { workspaceId: number }) {
  const L = (en: string, fa: string) => editorText(locale, en, fa);
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

  if (dashboard.phase === "loading" || dashboard.phase === "idle") return <EditorNotice locale={locale} title={L("Loading the workspace…", "بارگذاری فضای کاری…")} />;
  if (dashboard.phase === "forbidden") return <EditorNotice locale={locale} alert title={pick(T.forbiddenDashboard, locale)}><p dir="auto">{dashboard.reason}</p></EditorNotice>;
  if (dashboard.phase === "unavailable" || dashboard.phase === "error") return <EditorNotice locale={locale} alert title={L("The workspace is unavailable", "فضای کاری در دسترس نیست")}><p dir="auto">{dashboard.reason}</p><button type="button" onClick={retry}>{L("Read current workspace", "خواندن فضای کاری فعلی")}</button></EditorNotice>;
  if (dashboard.phase === "empty") return <EditorNotice locale={locale} alert title={L("This workspace was not found", "این فضای کاری یافت نشد")} />;

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
  const bucket = (title: string, rows: WorkspaceTaskRecord[]) => rows.length ? <div className="fc112-editor-areas">
    <h4>{title} · {rows.length}</h4>
    <ul className="fc112-editor-checks">{rows.map(task => <li key={task.id}>
      <div><strong dir="auto">{task.title}</strong><small dir="auto">{L(TASK_CATEGORY_LABEL[task.category]?.[0] ?? "", TASK_CATEGORY_LABEL[task.category]?.[1] ?? "") ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? "Asia/Tehran"} · v{task.row_version}{task.assigned_to_user_id ? ` · ${L("assigned", "منتسب")}: ${task.assigned_to_user_id}` : ""}</small>
      {task.category === "veterinary_appointment" ? <small>{pick(W.veterinaryNotice, locale)}</small> : null}</div>
      <button type="button" disabled={commandBusy || !mayTask} onClick={() => complete(task)} aria-label={`${pick(T.markComplete, locale)}: ${task.title}`}>{pick(T.markComplete, locale)}</button>
    </li>)}</ul>
  </div> : null;

  return <div className="fc112-editor-form" data-surface="workspace-detail" aria-busy={dashboard.phase === "reloading"}>
    <div className="fc112-editor-meta"><span dir="auto">{data.workspace?.name ?? `#${workspaceId}`}</span><span>{data.herd_size} {L("horses in this working set", "اسب در این مجموعه کاری")}</span><button type="button" disabled={commandBusy} onClick={() => { Object.values(commands).forEach(command => command.reset()); retry(); }}>{L("Refresh workspace", "تازه‌سازی فضای کاری")}</button></div>
    {permissions.readOnly ? <EditorNotice locale={locale} title={pick(T.readOnlyPlan, locale)} /> : null}
    {commands.completeTask.state.phase === "rejected" ? <EditorNotice locale={locale} alert title={commands.completeTask.state.code === "already_closed" ? pick(T.alreadyClosed, locale) : pick(T.versionConflict, locale)}><button type="button" onClick={() => { commands.completeTask.reset(); retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></EditorNotice> : null}
    {commands.completeTask.state.phase === "failed" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.completeTask.state)}><button type="button" onClick={() => { commands.completeTask.reset(); retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></EditorNotice> : null}
    {commands.completeTask.state.phase === "accepted" ? <EditorNotice locale={locale} title={commandFeedback(commands.completeTask.state)} /> : null}

    <fieldset className="fc112-editor-fields"><legend className="fc112-editor-legend">{pick(W.tasks, locale)}</legend>
      {mayTask ? <details className="fc112-editor-areas"><summary>{pick(T.addReminder, locale)}</summary>
        <form onSubmit={event => { event.preventDefault(); void commands.addTask.run(async () => {
          const result = await platform!.modules.workspaces.addTask(workspaceId, { title: taskTitle.trim(), category: taskCategory, due_date: taskDue, due_timezone: "Asia/Tehran", recurrence: taskRepeat ? "custom_days" : "none", recurrence_interval_days: taskRepeat ? Number(taskRepeat) : null });
          setTaskTitle(""); setTaskDue(""); setTaskRepeat(""); retry(); return result;
        }, { successMessage: L("Reminder recorded; no appointment was booked.", "یادآور ثبت شد؛ هیچ نوبتی رزرو نشد.") }); }}>
          <label className="fc112-editor-field"><span>{pick(T.reminderTitle, locale)}</span><input required minLength={3} maxLength={200} dir="auto" value={taskTitle} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskTitle(event.target.value)} /></label>
          <label className="fc112-editor-field"><span>{pick(T.reminderDue, locale)}</span><input required type="date" value={taskDue} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskDue(event.target.value)} /></label>
          <label className="fc112-editor-field"><span>{pick(T.reminderCategory, locale)}</span><select value={taskCategory} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskCategory(event.target.value as typeof taskCategory)}>{Object.entries(TASK_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{L(label[0], label[1])}</option>)}</select></label>
          <label className="fc112-editor-field"><span>{pick(T.reminderRepeat, locale)}</span><input type="number" min="1" max="3650" step="1" value={taskRepeat} disabled={commands.addTask.state.phase === "submitting"} onChange={event => setTaskRepeat(event.target.value)} /></label>
          {taskCategory === "veterinary_appointment" ? <p className="fc112-editor-note">{pick(W.veterinaryNotice, locale)}</p> : null}
          <button type="submit" disabled={commands.addTask.state.phase === "submitting" || commands.addTask.state.phase === "failed"}>{pick(T.addReminder, locale)}</button>
        </form>
        {commands.addTask.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.addTask.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.addTask.reset(); retry(); }}>{L("Reload workspace", "بارگذاری دوباره")}</button></EditorNotice> : null}
      </details> : <p className="fc112-editor-note">{pick(T.needTasksManage, locale)}</p>}
      {tasks.invalid.length ? <div role="alert"><h4>{pick(T.invalidDates, locale)}</h4><ul>{tasks.invalid.map(task => <li key={task.id} dir="auto">{task.title} · {task.due_date} · {task.due_timezone}</li>)}</ul></div> : null}
      {bucket(pick(W.overdue, locale), tasks.overdue)}
      {bucket(pick(W.dueSoon, locale), tasks.dueSoon)}
      {bucket(pick(W.later, locale), tasks.later)}
      {tasks.all.length === 0 ? <p className="fc112-editor-note">{L("No open reminders.", "یادآور بازی نیست.")}</p> : null}
      <details className="fc112-editor-areas" data-surface="workspace-completed"><summary>{pick(T.completedHeading, locale)}{doneTasks.done.phase === "ready" || doneTasks.done.phase === "reloading" ? ` · ${(doneTasks.done.rows ?? []).length}` : ""}</summary>
        <p className="fc112-editor-note">{pick(T.completedNote, locale)}</p>
        {doneTasks.done.phase === "forbidden" || doneTasks.done.phase === "unavailable" || doneTasks.done.phase === "error" ? <EditorNotice locale={locale} alert title={L("The completed list is unavailable", "فهرست انجام‌شده‌ها در دسترس نیست")}> <p dir="auto">{doneTasks.done.reason}</p><button type="button" onClick={doneTasks.retry}>{L("Try loading again", "تلاش دوباره")}</button></EditorNotice> : null}
        {(doneTasks.done.phase === "ready" || doneTasks.done.phase === "reloading") && (doneTasks.done.rows ?? []).length ? <ul className="fc112-editor-checks">{(doneTasks.done.rows ?? []).map(task => <li key={task.id}>
          <div><strong dir="auto">{task.title}</strong><small dir="auto">{L(TASK_CATEGORY_LABEL[task.category]?.[0] ?? "", TASK_CATEGORY_LABEL[task.category]?.[1] ?? "") ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? "Asia/Tehran"} · v{task.row_version}{task.recurrence !== "none" ? ` · ${L("recurring occurrence", "وقوع تکرارشونده")}` : ""}</small>
            {task.recurrence !== "none" ? <small>{pick(T.recurringCompleted, locale)}</small> : null}</div>
          {task.recurrence === "none" ? <button type="button" disabled={commandBusy || !mayTask} onClick={() => reopen(task)} aria-label={`${pick(T.reopen, locale)}: ${task.title}`}>{pick(T.reopen, locale)}</button> : null}
        </li>)}</ul> : null}
        {doneTasks.done.phase === "empty" ? <p className="fc112-editor-note">{pick(T.completedEmpty, locale)}</p> : null}
        {(doneTasks.done.phase === "idle" || doneTasks.done.phase === "loading") ? <p role="status">{L("Loading completed reminders…", "بارگذاری یادآورهای انجام‌شده…")}</p> : null}
        {commands.reopenTask.state.phase === "rejected" ? <EditorNotice locale={locale} alert title={commands.reopenTask.state.code === "not_completed" ? pick(T.notCompleted, locale) : commands.reopenTask.state.code === "recurring_occurrence_completed" ? pick(T.recurringCompleted, locale) : pick(T.versionConflict, locale)}><button type="button" onClick={() => { commands.reopenTask.reset(); retry(); doneTasks.retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></EditorNotice> : null}
        {commands.reopenTask.state.phase === "failed" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.reopenTask.state)}><button type="button" onClick={() => { commands.reopenTask.reset(); retry(); doneTasks.retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></EditorNotice> : null}
        {commands.reopenTask.state.phase === "accepted" ? <EditorNotice locale={locale} title={commandFeedback(commands.reopenTask.state)} /> : null}
      </details>
      {mayTask && tasks.open.length ? <details className="fc112-editor-areas"><summary>{pick(T.assignReminder, locale)}</summary>
        <form onSubmit={event => { event.preventDefault(); const task = tasks.open.find(row => String(row.id) === assignTaskId); if (!task) return; void commands.reassignTask.run(async () => {
          const result = await platform!.modules.workspaces.reassignTask(workspaceId, task.id, assignee.trim() === "" ? null : assignee.trim(), { expectedVersion: task.row_version });
          setAssignTaskId(""); setAssignee(""); retry(); return result;
        }, { successMessage: L("Assignment updated and audit-recorded; the task version advanced.", "انتساب به‌روزرسانی و ثبت شد؛ نسخه یادآور پیش رفت.") }); }}>
          <label className="fc112-editor-field"><span>{pick(W.tasks, locale)}</span><select required value={assignTaskId} disabled={commands.reassignTask.state.phase === "submitting"} onChange={event => setAssignTaskId(event.target.value)}><option value="">{L("Choose…", "انتخاب…")}</option>{tasks.open.map(task => <option key={task.id} value={String(task.id)}>{task.title} · {task.due_date} · v{task.row_version}</option>)}</select></label>
          <label className="fc112-editor-field"><span>{pick(T.assignTo, locale)}</span><input dir="ltr" list="fei-workspace-staff" value={assignee} disabled={commands.reassignTask.state.phase === "submitting"} onChange={event => setAssignee(event.target.value)} /><datalist id="fei-workspace-staff">{(data.active_staff ?? []).map(member => <option key={member.user_id} value={member.user_id} />)}</datalist></label>
          <button type="submit" disabled={commands.reassignTask.state.phase === "submitting" || assignTaskId === ""}>{L("Update assignment", "به‌روزرسانی انتساب")}</button>
        </form>
        {commands.reassignTask.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.reassignTask.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.reassignTask.reset(); retry(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button></EditorNotice> : null}
      </details> : null}
    </fieldset>

    <fieldset className="fc112-editor-fields"><legend className="fc112-editor-legend">{pick(W.herd, locale)}</legend>
      <p className="fc112-editor-note">{pick(W.neverDeleted, locale)}</p>
      {data.horses.length ? <ul className="fc112-editor-checks">{data.horses.map((horse, index) => {
        const id = Number(horse.horse_id ?? horse.id);
        const name = String((locale !== "en" ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native) || (Number.isSafeInteger(id) ? `#${id}` : L("Horse record", "رکورد اسب")));
        return <li key={Number.isSafeInteger(id) ? id : index}><div><strong dir="auto">{name}</strong>{Number.isSafeInteger(id) && id > 0 ? <small>#{id}</small> : null}</div>
          {mayManage && Number.isSafeInteger(id) && id > 0 ? <button type="button" disabled={commands.removeHorse.state.phase === "submitting"} onClick={() => { void commands.removeHorse.run(async () => { const result = await platform!.modules.workspaces.removeHorse(workspaceId, id); retry(); return result; }, { successMessage: pick(W.neverDeleted, locale) }); }}>{pick(T.removeHorse, locale)}</button> : null}</li>;
      })}</ul> : <p className="fc112-editor-note">{pick(T.noHorses, locale)}</p>}
      {mayManage ? <details className="fc112-editor-areas"><summary>{L("Add a managed horse", "افزودن اسب تحت مدیریت")}</summary>
        <form onSubmit={event => { event.preventDefault(); const id = Number(horseId); if (!Number.isSafeInteger(id) || id < 1) return; void commands.addHorse.run(async () => { const result = await platform!.modules.workspaces.addHorse(workspaceId, id); setHorseId(""); retry(); return result; }); }}>
          <label className="fc112-editor-field"><span>{pick(T.addHorseLabel, locale)}</span><input required type="number" min="1" step="1" value={horseId} disabled={commands.addHorse.state.phase === "submitting"} onChange={event => setHorseId(event.target.value)} /></label>
          <button type="submit" disabled={commands.addHorse.state.phase === "submitting" || commands.addHorse.state.phase === "failed"}>{L("Add to working set", "افزودن به مجموعه کاری")}</button>
        </form>
        {commands.addHorse.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.addHorse.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.addHorse.reset(); retry(); }}>{L("Reload herd", "بارگذاری دوباره گله")}</button></EditorNotice> : null}
      </details> : null}
    </fieldset>

    <fieldset className="fc112-editor-fields"><legend className="fc112-editor-legend">{pick(T.staffHeading, locale)}</legend>
      <p className="fc112-editor-note">{pick(W.staffConsent, locale)}</p>
      {(data.active_staff ?? []).length ? <ul className="fc112-editor-checks">{(data.active_staff ?? []).map(member => <li key={member.user_id}>
        <div><strong dir="ltr">{member.user_id}</strong><small>{L("Actions", "اقدامات")}: {(member.actions ?? []).join(", ")}</small></div>
        {mayManage && member.user_id !== user?.id ? <button type="button" disabled={commands.revokeStaff.state.phase === "submitting"} onClick={() => { void commands.revokeStaff.run(async () => { const result = await platform!.modules.workspaces.revokeStaff(workspaceId, member.user_id); retry(); return result; }, { successMessage: pick(T.revokeSuccess, locale) }); }}>{pick(T.revokeAccess, locale)}</button> : null}
      </li>)}</ul> : <p className="fc112-editor-note">{pick(T.noActiveStaff, locale)}</p>}
      {mayManage ? <details className="fc112-editor-areas"><summary>{pick(T.inviteStaff, locale)}</summary>
        <p className="fc112-editor-note">{pick(T.inviteConsent, locale)}</p>
        <form onSubmit={event => { event.preventDefault(); void commands.invite.run(async () => {
          const result = await platform!.modules.workspaces.inviteStaff(workspaceId, { invitee_user_id: invitee.trim(), actions: chosenActions.join(","), note: null });
          setInvitee(""); retry(); return result;
        }, { successMessage: L("Invitation sent. It expires honestly after 14 days.", "دعوت ارسال شد؛ پس از ۱۴ روز صادقانه منقضی می‌شود.") }); }}>
          <label className="fc112-editor-field"><span>{L("User id", "شناسه کاربر")}</span><input required minLength={3} maxLength={64} dir="ltr" value={invitee} disabled={commands.invite.state.phase === "submitting"} onChange={event => setInvitee(event.target.value)} /></label>
          <fieldset className="fc112-editor-choice-group"><legend>{L("Proposed actions", "اقدامات پیشنهادی")}</legend><div className="fc112-editor-checks">{(["view", "tasks_manage"] as const).map(action => <label key={action}><input type="checkbox" checked={inviteActions[action] ?? false} disabled={commands.invite.state.phase === "submitting"} onChange={event => setInviteActions(prev => ({ ...prev, [action]: event.target.checked }))} /><span>{action}</span></label>)}</div></fieldset>
          <button type="submit" disabled={commands.invite.state.phase === "submitting" || commands.invite.state.phase === "failed" || chosenActions.length === 0}>{L("Send invitation", "ارسال دعوت")}</button>
        </form>
        {commands.invite.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.invite.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.invite.reset(); retry(); }}>{L("Reload team", "بارگذاری دوباره تیم")}</button></EditorNotice> : null}
      </details> : null}
      {commands.revokeStaff.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.revokeStaff.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.revokeStaff.reset(); retry(); }}>{L("Reload team", "بارگذاری دوباره تیم")}</button></EditorNotice> : null}
    </fieldset>

    <FeiWorkspaceDocuments platform={platform} workspaceId={workspaceId} mayTask={mayTask} user={user} locale={locale} />
  </div>;
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
 * R114-06 (Master AI handoff D23/D32–35) — FEI Classic's native DOCUMENT
 * trackers + the bounded no-overwrite reminder import. Trackers only — no
 * file bytes, no medical content; versioned CAS updates keep the draft on a
 * 409; the horse association is fixed at creation; archived rows are
 * read-only history; one durable intent key per import session.
 */
function FeiWorkspaceDocuments({ platform, workspaceId, mayTask, user, locale = "en" }: { platform: PlatformClient | null; workspaceId: number; mayTask: boolean; user?: PlatformUser | null; locale?: EditorLocale }) {
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  const T = WORKSPACE_DESK;
  const W = WORKSPACES;
  const scope = usePrincipalScope(user, null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const { documents, retry } = useWorkspaceDocuments({ workspaceId, includeArchived, platform, scope, userId: user?.id ?? null });
  const { createDocument, importTasks } = useWorkspaceDocumentCommands(`${scope}|workspace:${workspaceId}`);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<WorkspaceDocumentKind>("registration");
  const [horseId, setHorseId] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [importRows, setImportRows] = useState<Array<{ title: string; category: "document_renewal" | "farrier" | "veterinary_appointment" | "other"; due_date: string }>>([{ title: "", category: "other", due_date: "" }]);
  const [receipts, setReceipts] = useState<Array<{ title: string; status: string; task_id: number | null }> | null>(null);
  const [intentKey, setIntentKey] = useState(() => newImportIntentKey());
  const createBlocked = (documents.phase !== "ready" && documents.phase !== "reloading" && documents.phase !== "empty") || createDocument.state.phase === "submitting" || createDocument.state.phase === "failed";
  const importBlocked = importTasks.state.phase === "submitting" || importTasks.state.phase === "failed";
  const importValid = importRows.length >= 1 && importRows.length <= 200 && importRows.every(row => row.title.trim().length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date));

  return <fieldset className="fc112-editor-fields" aria-label={pick(T.documentsTitle, locale)} data-surface="workspace-documents"><legend className="fc112-editor-legend">{pick(T.documentsTitle, locale)}</legend>
      <p className="fc112-editor-note">{pick(W.documentTrackers, locale)}</p>
      <div className="fc112-editor-actions">
        <button type="button" aria-pressed={includeArchived} onClick={() => setIncludeArchived(v => !v)}>{includeArchived ? pick(T.hideArchived, locale) : pick(T.includeArchived, locale)}</button>
        <button type="button" onClick={() => retry()}>{L("Refresh documents", "تازه‌سازی مدرک‌ها")}</button>
        {platform ? <a href={platform.modules.workspaces.exportUrl(workspaceId)}>{pick(T.exportCsv, locale)}</a> : null}
      </div>
      {documents.phase === "loading" ? <p role="status">{L("Loading document trackers…", "بارگذاری پیگیرهای مدرک…")}</p> : null}
      {documents.phase === "forbidden" ? <EditorNotice locale={locale} alert title={pick(T.forbiddenDashboard, locale)} /> : null}
      {documents.phase === "unavailable" || documents.phase === "error" ? <EditorNotice locale={locale} alert title={L("The document list is unavailable", "فهرست مدرک در دسترس نیست")}><p dir="auto">{documents.reason}</p><button type="button" onClick={retry}>{L("Try loading again", "تلاش دوباره")}</button></EditorNotice> : null}
      {(documents.phase === "ready" || documents.phase === "reloading") ? (documents.rows.length ? <ul className="fc112-editor-checks">{documents.rows.map(row => <FeiDocumentRow key={row.id} platform={platform} workspaceId={workspaceId} row={row} mayTask={mayTask && documents.phase === "ready"} locale={locale} onDone={retry} />)}</ul> : <p className="fc112-editor-note">{pick(T.noDocuments, locale)}</p>) : null}
      {documents.phase === "empty" ? <p className="fc112-editor-note">{pick(T.noDocuments, locale)}</p> : null}
      {mayTask ? <details className="fc112-editor-areas"><summary>{pick(T.trackDocument, locale)}</summary>
        <form onSubmit={event => { event.preventDefault(); if (createBlocked) return; const parsedHorse = horseId.trim() === "" ? null : Number(horseId); if (parsedHorse !== null && (!Number.isSafeInteger(parsedHorse) || parsedHorse <= 0)) return; void createDocument.run(async () => {
          const result = await platform!.modules.workspaces.createDocument(workspaceId, {
            title: title.trim(), category, note: note.trim() || null, expires_at: expiresAt || null,
            ...(parsedHorse != null && Number.isSafeInteger(parsedHorse) && parsedHorse > 0 ? { horse_id: parsedHorse } : {}),
          });
          setTitle(""); setNote(""); setExpiresAt(""); setHorseId(""); retry(); return result;
        }, { successMessage: L("Document tracker created. Expiry (if set) can drive a renewal reminder.", "پیگیر مدرک ساخته شد.") }); }}>
          <label className="fc112-editor-field"><span>{L("Title", "عنوان")}</span><input required minLength={1} maxLength={300} dir="auto" value={title} disabled={createBlocked} onChange={event => setTitle(event.target.value)} /></label>
          <label className="fc112-editor-field"><span>{L("Category", "دسته")}</span><select value={category} disabled={createBlocked} onChange={event => setCategory(event.target.value as WorkspaceDocumentKind)}>{Object.entries(DOCUMENT_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{L(label[0], label[1])}</option>)}</select></label>
          <label className="fc112-editor-field"><span>{L("Horse id (optional — fixed once created)", "شناسه اسب (اختیاری — پس از ایجاد ثابت است)")}</span><input type="number" min="1" step="1" dir="ltr" value={horseId} disabled={createBlocked} onChange={event => setHorseId(event.target.value)} /></label>
          <label className="fc112-editor-field"><span>{L("Expiry day (optional, Gregorian)", "روز انقضا (اختیاری، میلادی)")}</span><input type="date" value={expiresAt} disabled={createBlocked} onChange={event => setExpiresAt(event.target.value)} /></label>
          <label className="fc112-editor-field"><span>{L("Note (optional)", "یادداشت (اختیاری)")}</span><input maxLength={2000} dir="auto" value={note} disabled={createBlocked} onChange={event => setNote(event.target.value)} /></label>
          <button type="submit" disabled={createBlocked}>{pick(T.createTracker, locale)}</button>
        </form>
        {createDocument.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(createDocument.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { createDocument.reset(); retry(); }}>{L("Reload documents", "بارگذاری دوباره مدرک‌ها")}</button></EditorNotice> : null}
      </details> : <p className="fc112-editor-note">{pick(T.needTasksManageDocuments, locale)}</p>}
      {mayTask ? <details className="fc112-editor-areas"><summary>{pick(T.importUpTo, locale)}</summary>
        <p className="fc112-editor-note">{pick(W.importNoOverwrite, locale)}</p>
        <form onSubmit={event => { event.preventDefault(); if (importBlocked || !importValid) return; void importTasks.run(async () => {
          const result = await platform!.modules.workspaces.importTasks(workspaceId, importRows.map(row => ({ title: row.title.trim(), category: row.category, due_date: row.due_date })), { intentKey });
          setReceipts(result.receipts.map(receipt => ({ title: receipt.title, status: receipt.status, task_id: receipt.task_id })));
          setIntentKey(newImportIntentKey());
          setImportRows([{ title: "", category: "other", due_date: "" }]);
          retry(); return result;
        }, { successMessage: pick(T.importFinished, locale) }); }}>
          {importRows.map((row, index) => <fieldset key={index}><legend>{L("Row", "ردیف")} {index + 1}</legend>
            <label className="fc112-editor-field"><span>{L("Title", "عنوان")}</span><input required maxLength={300} dir="auto" value={row.title} disabled={importBlocked} onChange={event => setImportRows(prev => prev.map((r, i) => i === index ? { ...r, title: event.target.value } : r))} /></label>
            <label className="fc112-editor-field"><span>{L("Category", "دسته")}</span><select value={row.category} disabled={importBlocked} onChange={event => setImportRows(prev => prev.map((r, i) => i === index ? { ...r, category: event.target.value as typeof row.category } : r))}>{Object.entries(TASK_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{L(label[0], label[1])}</option>)}</select></label>
            <label className="fc112-editor-field"><span>{L("Due date (Gregorian)", "سررسید (میلادی)")}</span><input required type="date" value={row.due_date} disabled={importBlocked} onChange={event => setImportRows(prev => prev.map((r, i) => i === index ? { ...r, due_date: event.target.value } : r))} /></label>
            {importRows.length > 1 ? <button type="button" disabled={importBlocked} onClick={() => setImportRows(prev => prev.filter((_, i) => i !== index))}>{L("Remove row", "حذف ردیف")}</button> : null}
          </fieldset>)}
          <div className="fc112-editor-actions">
            <button type="button" disabled={importBlocked || importRows.length >= 200} onClick={() => setImportRows(prev => [...prev, { title: "", category: "other", due_date: "" }])}>{L("Add row", "افزودن ردیف")}</button>
            <button type="submit" disabled={importBlocked || !importValid}>{L("Import", "درون‌ریزی")}</button>
          </div>
        </form>
        {importTasks.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(importTasks.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { importTasks.reset(); retry(); }}>{L("Reload workspace", "بارگذاری دوباره")}</button></EditorNotice> : null}
        {importTasks.state.phase === "accepted" && receipts ? <div role="status" aria-label={pick(T.perRowReceipts, locale)}><h4>{pick(T.perRowReceipts, locale)}</h4><ul className="fc112-editor-checks">{receipts.map((receipt, index) => <li key={index}><strong dir="auto">{receipt.title}</strong><small dir="auto">{receipt.status === "imported" ? pick(T.importedLabel, locale) : receipt.status === "already_imported" ? pick(T.alreadyImportedLabel, locale) : receipt.status === "occurrence_exists" ? pick(T.occurrenceExistsLabel, locale) : pick(T.rowRefusedLabel, locale)}{receipt.task_id != null ? ` · #${receipt.task_id}` : ""}</small></li>)}</ul></div> : null}
      </details> : null}
  </fieldset>;
}

/** ONE document row with its own command slots; the 409 story derives from
 * the command STATE at render time (a refusal is never an exception). */
function FeiDocumentRow({ platform, workspaceId, row, mayTask, locale = "en", onDone }: { platform: PlatformClient | null; workspaceId: number; row: WorkspaceDocumentRecord; mayTask: boolean; locale?: EditorLocale; onDone: () => void }) {
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  const T = WORKSPACE_DESK;
  const updateDocument = usePlatformCommand(`workspace-document-update:${workspaceId}:${row.id}`);
  const archiveCommand = usePlatformCommand(`workspace-document-archive:${workspaceId}:${row.id}`);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [note, setNote] = useState(row.note ?? "");
  const [expiresAt, setExpiresAt] = useState(row.expires_at ?? "");
  const archived = row.status === "archived";
  return <li data-surface="workspace-document-row">
    <div><strong dir="auto">{row.title}</strong><small dir="auto">{L(DOCUMENT_CATEGORY_LABEL[row.category]?.[0] ?? "", DOCUMENT_CATEGORY_LABEL[row.category]?.[1] ?? "") ?? row.category}{row.horse_id != null ? ` · ${L("horse", "اسب")} #${row.horse_id} (${pick(T.horseFixed, locale)})` : ""}{row.expires_at ? ` · ${L("expires", "انقضا")}: ${row.expires_at}` : ""} · v{row.row_version}{archived ? ` · ${pick(T.archivedReadOnly, locale)}` : ""}</small>
    {row.note ? <small dir="auto">{row.note}</small> : null}</div>
    {mayTask && !archived ? <div className="fc112-editor-actions">
      {!editing ? <button type="button" onClick={() => { setTitle(row.title); setNote(row.note ?? ""); setExpiresAt(row.expires_at ?? ""); setEditing(true); }}>{L("Edit", "ویرایش")}</button> : null}
      {editing ? <form onSubmit={event => { event.preventDefault(); void updateDocument.run(async () => {
        const result = await platform!.modules.workspaces.updateDocument(workspaceId, row.id, {
          // R108-08: the association round-trips exactly as stored.
          horse_id: row.horse_id, title: title.trim(), category: row.category, note: note.trim() || null, expires_at: expiresAt || null,
        }, { expectedVersion: row.row_version });
        setEditing(false); onDone(); return result;
      }, { successMessage: L("Document updated.", "مدرک به‌روزرسانی شد.") }); }}>
        <label className="fc112-editor-field"><span>{L("Title", "عنوان")}</span><input required minLength={1} maxLength={300} dir="auto" value={title} disabled={updateDocument.state.phase === "submitting"} onChange={event => setTitle(event.target.value)} /></label>
        <label className="fc112-editor-field"><span>{L("Expiry day (optional)", "روز انقضا (اختیاری)")}</span><input type="date" value={expiresAt} disabled={updateDocument.state.phase === "submitting"} onChange={event => setExpiresAt(event.target.value)} /></label>
        <label className="fc112-editor-field"><span>{L("Note", "یادداشت")}</span><input maxLength={2000} dir="auto" value={note} disabled={updateDocument.state.phase === "submitting"} onChange={event => setNote(event.target.value)} /></label>
        <button type="submit" disabled={updateDocument.state.phase === "submitting"}>{pick(T.saveVersioned, locale)}</button>
        <button type="button" className="secondary" disabled={updateDocument.state.phase === "submitting"} onClick={() => setEditing(false)}>{L("Cancel", "انصراف")}</button>
      </form> : null}
      <button type="button" className="secondary" disabled={archiveCommand.state.phase === "submitting"} onClick={() => { void archiveCommand.run(async () => { const result = await platform!.modules.workspaces.archiveDocument(workspaceId, row.id); onDone(); return result; }, { successMessage: pick(T.archivedNote, locale) }); }}>{pick(T.archive, locale)}</button>
    </div> : null}
    {updateDocument.state.phase === "rejected" ? <EditorNotice locale={locale} alert title={updateDocument.state.message}>
      <p>{updateDocument.state.code === "document_version_conflict" ? pick(T.documentConflict, locale) : updateDocument.state.code === "document_horse_immutable" ? pick(WORKSPACES.documentHorseImmutable, locale) : updateDocument.state.code === "document_archived" ? pick(T.archivedReadOnly, locale) : ""}</p>
      {updateDocument.state.currentVersion != null ? <p>{L("Current version", "نسخه فعلی")}: v{updateDocument.state.currentVersion}</p> : null}
      <button type="button" onClick={() => { updateDocument.reset(); onDone(); }}>{L("Reload current version", "بازخوانی نسخه فعلی")}</button>
    </EditorNotice> : null}
    {archiveCommand.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(archiveCommand.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { archiveCommand.reset(); onDone(); }}>{L("Reload documents", "بارگذاری دوباره مدرک‌ها")}</button></EditorNotice> : null}
  </li>;
}

/** The invitee's own cross-workspace inbox (R114-05) with honest answer refusals. */
export function FeiMyWorkspaceInvitations({ platform, user, locale = "en" }: { platform: PlatformClient | null; user?: PlatformUser | null; locale?: EditorLocale }) {
  const L = (en: string, fa: string) => editorText(locale, en, fa);
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
  return <section className="fc112-editor" aria-label={pick(T.myInvitations, locale)} data-surface="workspace-invitations">
    <h3>{pick(T.myInvitations, locale)}</h3>
    {mine.phase === "loading" ? <p role="status">{L("Loading your invitations…", "بارگذاری دعوت‌های شما…")}</p> : null}
    {mine.phase === "unavailable" || mine.phase === "error" ? <EditorNotice locale={locale} alert title={L("Your invitation list is unavailable", "فهرست دعوت شما در دسترس نیست")}><p dir="auto">{mine.reason}</p><button type="button" onClick={mine.retry}>{L("Try loading again", "تلاش دوباره")}</button></EditorNotice> : null}
    {mine.phase === "ready" ? (mine.invitations.length ? <ul className="fc112-editor-checks">{mine.invitations.map(invitation => <li key={invitation.collection_id}>
      <div><strong dir="auto">{invitation.workspace_name}</strong><small>{L("Proposed", "پیشنهاد")}: {invitation.proposed_actions} · {L("expires", "انقضا")}: {invitation.expires_at.slice(0, 10)}</small></div>
      {invitation.actionable ? <div className="fc112-editor-actions">
        <button type="button" disabled={commands.respond.state.phase === "submitting"} onClick={() => answer(invitation.collection_id, "accept", L("Invitation accepted. Your access is re-checked live on every request.", "دعوت پذیرفته شد. دسترسی شما در هر درخواست زنده بررسی می‌شود."))}>{pick(T.accept, locale)}</button>
        <button type="button" className="secondary" disabled={commands.respond.state.phase === "submitting"} onClick={() => answer(invitation.collection_id, "decline", L("Invitation declined.", "دعوت رد شد."))}>{pick(T.decline, locale)}</button>
      </div> : <small>{pick(T.expiredAnswer, locale)}</small>}
    </li>)}</ul> : <p className="fc112-editor-note">{L("You have no pending workspace invitations.", "دعوت فضای کاری در انتظار ندارید.")}</p>) : null}
    {answerFailure ? <EditorNotice locale={locale} alert title={answerFailure} /> : null}
    {commands.respond.state.phase !== "idle" ? <EditorNotice locale={locale} alert title={commandFeedback(commands.respond.state) || L("Command feedback", "بازخورد فرمان")}><button type="button" onClick={() => { commands.respond.reset(); mine.retry(); }}>{L("Reload invitations", "بارگذاری دوباره دعوت‌ها")}</button></EditorNotice> : null}
  </section>;
}
