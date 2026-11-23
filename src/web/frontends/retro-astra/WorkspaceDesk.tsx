import React, { useState } from 'react';
import { pick } from "../../../frontend-kit";
import type { Language } from "./transplant/i18n/messages";
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
  classifyDocumentCommandFailure,
  commandFeedback,
  newImportIntentKey,
  WORKSPACE_DESK,
  WORKSPACES,
  type PlatformClient,
  type PlatformUser,
  type WorkspaceTaskRecord,
  type WorkspaceDocumentRecord,
  type WorkspaceDocumentKind,
} from '../../../frontend-kit';
import { Button } from './transplant/components/ui';
import { usePreferences } from './transplant/preferences/PreferencesProvider';
import { EditorField } from './EditorControls';

/**
 * R114-05 (Master AI R113 handoff D22/D32–35) — Retro Astra's NATIVE stable
 * workspace desk over the shared headless module: the principal's own lists,
 * a consent-first team, versioned (CAS) reminder completion and assignment,
 * and the working-set herd. A workspace is a WORKING SET, never an ownership
 * claim; every access is re-checked live by the server, so a revoked staff
 * member's view masks instead of painting stale private rows.
 */

const TASK_CATEGORY_LABEL: Record<string, [string, string]> = {
  document_renewal: ['Document renewal', 'تمدید مدرک'],
  farrier: ['Farrier', 'نعل‌بندی'],
  veterinary_appointment: ['Veterinary appointment', 'نوبت دامپزشکی'],
  other: ['Other', 'سایر'],
};

type WorkspaceId = number | null;

export function RetroAstraWorkspaceDesk({ workspaceId, platform, invalidTarget = false, signedIn = true, user = null, onSelect }: {
  workspaceId: WorkspaceId; platform: PlatformClient | null; invalidTarget?: boolean; signedIn?: boolean; user?: PlatformUser | null; onSelect?: (id: WorkspaceId) => void;
}) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const T = WORKSPACE_DESK;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(scope);
  const mine = useMyWorkspaces({ platform, scope, userId: user?.id ?? null, enabled: signedIn });
  const invitations = useMyWorkspaceInvitations({ platform, scope, userId: user?.id ?? null, enabled: signedIn && platform != null && user != null });
  const [selected, setSelected] = useState<WorkspaceId>(workspaceId);
  const [nameDraft, setNameDraft] = useState('');
  const activeId = selected ?? workspaceId;
  const dashboard = useWorkspaceDashboard({ workspaceId: activeId, platform, scope, userId: user?.id ?? null });
  const select = (id: WorkspaceId) => { setSelected(id); onSelect?.(id); };

  if (!signedIn) return <section className="collection-sheet retro-editor" aria-label={pick(T.deskTitle, language)} data-surface="workspace-desk">
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('STABLE WORKSPACES', 'فضاهای کاری اصطبل')}</span><h1>{pick(T.deskTitle, language)}</h1><p>{pick(T.deskNote, language)}</p></div></div>
    <p className="desk-notice">{L('Sign in to see your stable workspaces.', 'برای دیدن فضاهای کاری اصطبل خود وارد شوید.')}</p>
  </section>;

  return <>
    <section className="collection-sheet retro-editor" aria-label={pick(T.deskTitle, language)} data-surface="workspace-desk">
      <div className="collection-sheet-heading"><div><span className="eyebrow">{L('STABLE WORKSPACES', 'فضاهای کاری اصطبل')}</span><h1>{pick(T.deskTitle, language)}</h1><p>{pick(T.deskNote, language)}</p></div></div>
      {invalidTarget ? <div role="alert" className="desk-notice desk-notice--error"><p>{L('That workspace id is not valid.', 'آن شناسه فضای کاری معتبر نیست.')}</p></div> : null}
      {mine.mine.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading your workspaces…', 'بارگذاری فضاهای کاری شما…')}</p> : null}
      {mine.mine.phase === 'forbidden' || mine.mine.phase === 'unavailable' || mine.mine.phase === 'error' ? <div role="alert" className="desk-notice desk-notice--error"><p>{L('Your workspace list is unavailable.', 'فهرست فضای کاری شما در دسترس نیست.')}</p><p dir="auto">{mine.mine.reason}</p><Button onClick={mine.retry}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
      {(mine.mine.phase === 'ready' || mine.mine.phase === 'reloading') ? (() => {
        const lists = mine.mine.lists;
        const rows = [...lists.owned, ...lists.staff, ...lists.organization];
        return rows.length ? <ul className="retro-editor-options">{rows.map(summary => <li key={`${summary.role}:${summary.id}`} className="retro-editor-check">
          <div className="collection-sheet-heading"><div>
            <strong dir="auto">{summary.name}</strong>
            <small>{summary.role === 'owner' ? pick(T.ownerRole, language) : summary.role === 'manager' ? pick(T.managerRole, language) : pick(T.staffRole, language)} · #{n(summary.id)}</small>
          </div>
          <Button onClick={() => select(summary.id)} aria-current={activeId === summary.id}>{L('Open', 'باز کردن')}</Button></div>
        </li>)}</ul> : <p className="desk-notice">{pick(T.noWorkspaces, language)}</p>;
      })() : null}
      {mine.mine.phase === 'empty' ? <p className="desk-notice">{pick(T.noWorkspaces, language)}</p> : null}
      <details className="retro-editor-help"><summary>{pick(T.createWorkspace, language)}</summary>
        <form onSubmit={event => { event.preventDefault(); void commands.create.run(async () => {
          const result = await platform!.modules.workspaces.create({ name: nameDraft.trim() });
          setNameDraft(''); mine.retry(); select(result.workspace.id); return result;
        }, { successMessage: L('Workspace created. It is a working set, never an ownership claim.', 'فضای کاری ایجاد شد. این یک مجموعه کاری است، نه ادعای مالکیت.') }); }}>
          <div className="retro-editor-grid">
            <EditorField label={pick(T.workspaceName, language)}><input required minLength={2} maxLength={120} dir="auto" value={nameDraft} disabled={commands.create.state.phase === 'submitting'} onChange={event => setNameDraft(event.target.value)} /></EditorField>
          </div>
          <Button type="submit" disabled={commands.create.state.phase === 'submitting' || commands.create.state.phase === 'failed' || nameDraft.trim().length < 2}>{pick(T.createWorkspace, language)}</Button>
        </form>
        {commands.create.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.create.state)}</p><Button onClick={() => { commands.create.reset(); mine.retry(); }}>{L('Reload list', 'بارگذاری دوباره فهرست')}</Button></div> : null}
      </details>
    </section>
    {signedIn ? <RetroAstraMyWorkspaceInvitations platform={platform} user={user} /> : null}
    {activeId !== null ? <RetroAstraWorkspaceDetail key={`${scope}:${activeId}`} workspaceId={activeId} platform={platform} user={user} /> : <section className="collection-sheet retro-editor" aria-label={L('Workspace detail', 'جزئیات فضای کاری')}><p className="desk-notice">{pick(T.selectWorkspace, language)}</p></section>}
  </>;
}

/** ONE workspace's private dashboard — reminders (versioned completion +
 * assignment), the working-set herd and the consent-first team. */
function RetroAstraWorkspaceDetail({ workspaceId, platform, user }: { workspaceId: number; platform: PlatformClient | null; user?: PlatformUser | null }) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const T = WORKSPACE_DESK;
  const W = WORKSPACES;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(`${scope}|workspace:${workspaceId}`);
  const { dashboard, retry } = useWorkspaceDashboard({ workspaceId, platform, scope, userId: user?.id ?? null });
  // R117-14: the completed list powers the reopen surface (one-shot rows only;
  // recurring closures carry their honest inline explanation instead).
  const doneTasks = useWorkspaceDoneTasks({ workspaceId, platform, scope, userId: user?.id ?? null });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskCategory, setTaskCategory] = useState<'document_renewal' | 'farrier' | 'veterinary_appointment' | 'other'>('other');
  const [taskRepeat, setTaskRepeat] = useState('');
  const [horseId, setHorseId] = useState('');
  const [assignTaskId, setAssignTaskId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [invitee, setInvitee] = useState('');
  const [inviteActions, setInviteActions] = useState<Record<string, boolean>>({ view: true, tasks_manage: false });

  if (dashboard.phase === 'loading' || dashboard.phase === 'idle') return <section className="collection-sheet retro-editor" aria-label={L('Workspace detail', 'جزئیات فضای کاری')} aria-busy="true"><p role="status" className="desk-notice">{L('Loading the workspace…', 'بارگذاری فضای کاری…')}</p></section>;
  if (dashboard.phase === 'forbidden') return <section className="collection-sheet retro-editor" aria-label={L('Workspace detail', 'جزئیات فضای کاری')}><div role="alert" className="desk-notice desk-notice--error"><p>{pick(T.forbiddenDashboard, language)}</p><p dir="auto">{dashboard.reason}</p></div></section>;
  if (dashboard.phase === 'unavailable' || dashboard.phase === 'error') return <section className="collection-sheet retro-editor" aria-label={L('Workspace detail', 'جزئیات فضای کاری')}><div role="alert" className="desk-notice desk-notice--error"><p>{L('The workspace is unavailable.', 'فضای کاری در دسترس نیست.')}</p><p dir="auto">{dashboard.reason}</p><Button onClick={retry}>{L('Read current workspace', 'خواندن فضای کاری فعلی')}</Button></div></section>;
  if (dashboard.phase === 'empty') return <section className="collection-sheet retro-editor" aria-label={L('Workspace detail', 'جزئیات فضای کاری')}><div role="alert" className="desk-notice desk-notice--error"><p>{L('This workspace was not found.', 'این فضای کاری یافت نشد.')}</p></div></section>;

  const { data, tasks, permissions } = dashboard;
  const mayTask = permissions.mayTask;
  const mayManage = permissions.mayManage;
  const commandBusy = Object.values(commands).some(command => command.state.phase === 'submitting');
  const chosenActions = (['view', 'tasks_manage'] as const).filter(action => inviteActions[action]);
  const complete = (task: WorkspaceTaskRecord) => {
    void commands.completeTask.run(async () => {
      const result = await platform!.modules.workspaces.completeTask(workspaceId, task.id, { expectedVersion: task.row_version });
      retry(); doneTasks.retry(); return result;
    }, { successMessage: pick(T.completeSuccess, language) });
  };
  const reopen = (task: WorkspaceTaskRecord) => {
    void commands.reopenTask.run(async () => {
      const result = await platform!.modules.workspaces.reopenTask(workspaceId, task.id, { expectedVersion: task.row_version });
      retry(); doneTasks.retry(); return result;
    }, { successMessage: pick(T.reopenSuccess, language) });
  };
  const bucket = (title: string, rows: WorkspaceTaskRecord[]) => rows.length ? <div className="retro-editor-options">
    <h4>{title} · {n(rows.length)}</h4>
    <ul>{rows.map(task => <li key={task.id} className="retro-editor-check">
      <div className="collection-sheet-heading"><div>
        <strong dir="auto">{task.title}</strong>
        <small dir="auto">{TASK_CATEGORY_LABEL[task.category]?.[language === 'fa' ? 1 : 0] ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? 'Asia/Tehran'} · v{n(task.row_version)}{task.assigned_to_user_id ? ` · ${L('assigned', 'منتسب')}: ${task.assigned_to_user_id}` : ''}</small>
        {task.category === 'veterinary_appointment' ? <small>{pick(W.veterinaryNotice, language)}</small> : null}
      </div>
      <Button disabled={commandBusy || !mayTask} onClick={() => complete(task)} aria-label={`${pick(T.markComplete, language)}: ${task.title}`}>{pick(T.markComplete, language)}</Button></div>
    </li>)}</ul>
  </div> : null;

  return <section className="collection-sheet retro-editor" aria-label={L('Workspace detail', 'جزئیات فضای کاری')} data-surface="workspace-detail" aria-busy={dashboard.phase === 'reloading'}>
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('STABLE WORKSPACES', 'فضاهای کاری اصطبل')}</span><h1 dir="auto">{data.workspace?.name ?? `#${workspaceId}`}</h1><p>{n(data.herd_size)} {L('horses in this working set', 'اسب در این مجموعه کاری')}</p></div>
      <Button disabled={commandBusy} onClick={() => { Object.values(commands).forEach(command => command.reset()); retry(); }}>{L('Refresh workspace', 'تازه‌سازی فضای کاری')}</Button></div>
    {permissions.readOnly ? <p role="status" className="desk-notice">{pick(T.readOnlyPlan, language)}</p> : null}
    {commands.completeTask.state.phase === 'rejected' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commands.completeTask.state.code === 'already_closed' ? pick(T.alreadyClosed, language) : pick(T.versionConflict, language)}</p><Button onClick={() => { commands.completeTask.reset(); retry(); }}>{L('Reload current version', 'بازخوانی نسخه فعلی')}</Button></div> : null}
    {commands.completeTask.state.phase === 'failed' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.completeTask.state)}</p><Button onClick={() => { commands.completeTask.reset(); retry(); }}>{L('Reload current version', 'بازخوانی نسخه فعلی')}</Button></div> : null}
    {commands.completeTask.state.phase === 'accepted' ? <p role="status" className="desk-notice desk-notice--success">{commandFeedback(commands.completeTask.state)}</p> : null}

    <h3>{pick(W.tasks, language)}</h3>
    {mayTask ? <details className="retro-editor-help"><summary>{pick(T.addReminder, language)}</summary>
      <form onSubmit={event => { event.preventDefault(); void commands.addTask.run(async () => {
        const result = await platform!.modules.workspaces.addTask(workspaceId, { title: taskTitle.trim(), category: taskCategory, due_date: taskDue, due_timezone: 'Asia/Tehran', recurrence: taskRepeat ? 'custom_days' : 'none', recurrence_interval_days: taskRepeat ? Number(taskRepeat) : null });
        setTaskTitle(''); setTaskDue(''); setTaskRepeat(''); retry(); return result;
      }, { successMessage: L('Reminder recorded; no appointment was booked.', 'یادآور ثبت شد؛ هیچ نوبتی رزرو نشد.') }); }}>
        <div className="retro-editor-grid">
          <EditorField label={pick(T.reminderTitle, language)}><input required minLength={3} maxLength={200} dir="auto" value={taskTitle} disabled={commands.addTask.state.phase === 'submitting'} onChange={event => setTaskTitle(event.target.value)} /></EditorField>
          <EditorField label={pick(T.reminderDue, language)}><input required type="date" value={taskDue} disabled={commands.addTask.state.phase === 'submitting'} onChange={event => setTaskDue(event.target.value)} /></EditorField>
          <EditorField label={pick(T.reminderCategory, language)}><select value={taskCategory} disabled={commands.addTask.state.phase === 'submitting'} onChange={event => setTaskCategory(event.target.value as typeof taskCategory)}>{Object.entries(TASK_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label[language === 'fa' ? 1 : 0]}</option>)}</select></EditorField>
          <EditorField label={pick(T.reminderRepeat, language)}><input type="number" min="1" max="3650" step="1" value={taskRepeat} disabled={commands.addTask.state.phase === 'submitting'} onChange={event => setTaskRepeat(event.target.value)} /></EditorField>
        </div>
        {taskCategory === 'veterinary_appointment' ? <p className="desk-notice">{pick(W.veterinaryNotice, language)}</p> : null}
        <Button type="submit" disabled={commands.addTask.state.phase === 'submitting' || commands.addTask.state.phase === 'failed'}>{pick(T.addReminder, language)}</Button>
      </form>
      {commands.addTask.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.addTask.state)}</p><Button onClick={() => { commands.addTask.reset(); retry(); }}>{L('Reload workspace', 'بارگذاری دوباره')}</Button></div> : null}
    </details> : <p className="desk-notice">{pick(T.needTasksManage, language)}</p>}
    {tasks.invalid.length ? <div role="alert" className="desk-notice desk-notice--error"><h4>{pick(T.invalidDates, language)}</h4><ul>{tasks.invalid.map(task => <li key={task.id} dir="auto">{task.title} · {task.due_date} · {task.due_timezone}</li>)}</ul></div> : null}
    {bucket(pick(W.overdue, language), tasks.overdue)}
    {bucket(pick(W.dueSoon, language), tasks.dueSoon)}
    {bucket(pick(W.later, language), tasks.later)}
    {tasks.all.length === 0 ? <p className="desk-notice">{L('No open reminders.', 'یادآور بازی نیست.')}</p> : null}

    <details className="retro-editor-help" data-surface="workspace-completed"><summary>{pick(T.completedHeading, language)}{doneTasks.done.phase === 'ready' || doneTasks.done.phase === 'reloading' ? ` · ${n((doneTasks.done.rows ?? []).length)}` : ''}</summary>
      <p className="desk-notice">{pick(T.completedNote, language)}</p>
      {doneTasks.done.phase === 'forbidden' || doneTasks.done.phase === 'unavailable' || doneTasks.done.phase === 'error' ? <div role="alert" className="desk-notice desk-notice--error"><p dir="auto">{doneTasks.done.reason}</p><Button onClick={doneTasks.retry}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
      {(doneTasks.done.phase === 'ready' || doneTasks.done.phase === 'reloading') && (doneTasks.done.rows ?? []).length ? <ul className="retro-editor-options">{(doneTasks.done.rows ?? []).map(task => <li key={task.id} className="retro-editor-check">
        <div className="collection-sheet-heading"><div>
          <strong dir="auto">{task.title}</strong>
          <small dir="auto">{TASK_CATEGORY_LABEL[task.category]?.[language === 'fa' ? 1 : 0] ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? 'Asia/Tehran'} · v{n(task.row_version)}{task.recurrence !== 'none' ? ` · ${L('recurring occurrence', 'وقوع تکرارشونده')}` : ''}</small>
          {task.recurrence !== 'none' ? <small>{pick(T.recurringCompleted, language)}</small> : null}
        </div>
        {task.recurrence === 'none' ? <Button disabled={commandBusy || !mayTask} onClick={() => reopen(task)} aria-label={`${pick(T.reopen, language)}: ${task.title}`}>{pick(T.reopen, language)}</Button> : null}</div>
      </li>)}</ul> : null}
      {doneTasks.done.phase === 'empty' ? <p className="desk-notice">{pick(T.completedEmpty, language)}</p> : null}
      {(doneTasks.done.phase === 'idle' || doneTasks.done.phase === 'loading') ? <p role="status" className="desk-notice">{L('Loading completed reminders…', 'بارگذاری یادآورهای انجام‌شده…')}</p> : null}
      {commands.reopenTask.state.phase === 'rejected' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commands.reopenTask.state.code === 'not_completed' ? pick(T.notCompleted, language) : commands.reopenTask.state.code === 'recurring_occurrence_completed' ? pick(T.recurringCompleted, language) : pick(T.versionConflict, language)}</p><Button onClick={() => { commands.reopenTask.reset(); retry(); doneTasks.retry(); }}>{L('Reload current version', 'بازخوانی نسخه فعلی')}</Button></div> : null}
      {commands.reopenTask.state.phase === 'failed' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.reopenTask.state)}</p><Button onClick={() => { commands.reopenTask.reset(); retry(); doneTasks.retry(); }}>{L('Reload current version', 'بازخوانی نسخه فعلی')}</Button></div> : null}
      {commands.reopenTask.state.phase === 'accepted' ? <p role="status" className="desk-notice desk-notice--success">{commandFeedback(commands.reopenTask.state)}</p> : null}
    </details>

    {mayTask && tasks.open.length ? <details className="retro-editor-help"><summary>{pick(T.assignReminder, language)}</summary>
      <form onSubmit={event => { event.preventDefault(); const task = tasks.open.find(row => String(row.id) === assignTaskId); if (!task) return; void commands.reassignTask.run(async () => {
        const result = await platform!.modules.workspaces.reassignTask(workspaceId, task.id, assignee.trim() === '' ? null : assignee.trim(), { expectedVersion: task.row_version });
        setAssignTaskId(''); setAssignee(''); retry(); return result;
      }, { successMessage: L('Assignment updated and audit-recorded; the task version advanced.', 'انتساب به‌روزرسانی و ثبت شد؛ نسخه یادآور پیش رفت.') }); }}>
        <div className="retro-editor-grid">
          <EditorField label={pick(W.tasks, language)}><select required value={assignTaskId} disabled={commands.reassignTask.state.phase === 'submitting'} onChange={event => setAssignTaskId(event.target.value)}><option value="">{L('Choose…', 'انتخاب…')}</option>{tasks.open.map(task => <option key={task.id} value={String(task.id)}>{task.title} · {task.due_date} · v{task.row_version}</option>)}</select></EditorField>
          <EditorField label={pick(T.assignTo, language)}><input dir="ltr" list="retro-workspace-staff" value={assignee} disabled={commands.reassignTask.state.phase === 'submitting'} onChange={event => setAssignee(event.target.value)} /></EditorField>
          <datalist id="retro-workspace-staff">{(data.active_staff ?? []).map(member => <option key={member.user_id} value={member.user_id} />)}</datalist>
        </div>
        <Button type="submit" disabled={commands.reassignTask.state.phase === 'submitting' || assignTaskId === ''}>{L('Update assignment', 'به‌روزرسانی انتساب')}</Button>
      </form>
      {commands.reassignTask.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.reassignTask.state)}</p><Button onClick={() => { commands.reassignTask.reset(); retry(); }}>{L('Reload current version', 'بازخوانی نسخه فعلی')}</Button></div> : null}
    </details> : null}

    <h3>{pick(W.herd, language)}</h3>
    <p className="desk-notice">{pick(W.neverDeleted, language)}</p>
    {data.horses.length ? <ul className="retro-editor-options">{data.horses.map((horse, index) => {
      const id = Number(horse.horse_id ?? horse.id);
      const name = String((language === 'fa' ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native) || (Number.isSafeInteger(id) ? `#${id}` : L('Horse record', 'رکورد اسب')));
      return <li key={Number.isSafeInteger(id) ? id : index} className="retro-editor-check">
        <div className="collection-sheet-heading"><div><strong dir="auto">{name}</strong><small>#{n(Number.isSafeInteger(id) ? id : 0)}</small></div>
          {mayManage && Number.isSafeInteger(id) && id > 0 ? <Button disabled={commands.removeHorse.state.phase === 'submitting'} onClick={() => { void commands.removeHorse.run(async () => { const result = await platform!.modules.workspaces.removeHorse(workspaceId, id); retry(); return result; }, { successMessage: pick(W.neverDeleted, language) }); }}>{pick(T.removeHorse, language)}</Button> : null}</div>
      </li>;
    })}</ul> : <p className="desk-notice">{pick(T.noHorses, language)}</p>}
    {mayManage ? <details className="retro-editor-help"><summary>{L('Add a managed horse', 'افزودن اسب تحت مدیریت')}</summary>
      <form onSubmit={event => { event.preventDefault(); const id = Number(horseId); if (!Number.isSafeInteger(id) || id < 1) return; void commands.addHorse.run(async () => { const result = await platform!.modules.workspaces.addHorse(workspaceId, id); setHorseId(''); retry(); return result; }); }}>
        <div className="retro-editor-grid">
          <EditorField label={pick(T.addHorseLabel, language)}><input required type="number" min="1" step="1" value={horseId} disabled={commands.addHorse.state.phase === 'submitting'} onChange={event => setHorseId(event.target.value)} /></EditorField>
        </div>
        <Button type="submit" disabled={commands.addHorse.state.phase === 'submitting' || commands.addHorse.state.phase === 'failed'}>{L('Add to working set', 'افزودن به مجموعه کاری')}</Button>
      </form>
      {commands.addHorse.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.addHorse.state)}</p><Button onClick={() => { commands.addHorse.reset(); retry(); }}>{L('Reload herd', 'بارگذاری دوباره گله')}</Button></div> : null}
    </details> : null}

    <h3>{pick(T.staffHeading, language)}</h3>
    <p className="desk-notice">{pick(W.staffConsent, language)}</p>
    {(data.active_staff ?? []).length ? <ul className="retro-editor-options">{(data.active_staff ?? []).map(member => <li key={member.user_id} className="retro-editor-check">
      <div className="collection-sheet-heading"><div><strong dir="ltr">{member.user_id}</strong><small>{L('Actions', 'اقدامات')}: {(member.actions ?? []).join(', ')}</small></div>
        {mayManage && member.user_id !== user?.id ? <Button disabled={commands.revokeStaff.state.phase === 'submitting'} onClick={() => { void commands.revokeStaff.run(async () => { const result = await platform!.modules.workspaces.revokeStaff(workspaceId, member.user_id); retry(); return result; }, { successMessage: pick(T.revokeSuccess, language) }); }}>{pick(T.revokeAccess, language)}</Button> : null}</div>
    </li>)}</ul> : <p className="desk-notice">{pick(T.noActiveStaff, language)}</p>}
    {mayManage ? <details className="retro-editor-help"><summary>{pick(T.inviteStaff, language)}</summary>
      <p>{pick(T.inviteConsent, language)}</p>
      <form onSubmit={event => { event.preventDefault(); void commands.invite.run(async () => {
        const result = await platform!.modules.workspaces.inviteStaff(workspaceId, { invitee_user_id: invitee.trim(), actions: chosenActions.join(','), note: null });
        setInvitee(''); retry(); return result;
      }, { successMessage: L('Invitation sent. It expires honestly after 14 days.', 'دعوت ارسال شد؛ پس از ۱۴ روز صادقانه منقضی می‌شود.') }); }}>
        <div className="retro-editor-grid">
          <EditorField label={L('User id', 'شناسه کاربر')}><input required minLength={3} maxLength={64} dir="ltr" value={invitee} disabled={commands.invite.state.phase === 'submitting'} onChange={event => setInvitee(event.target.value)} /></EditorField>
          <fieldset className="retro-editor-options"><legend>{L('Proposed actions', 'اقدامات پیشنهادی')}</legend>{(['view', 'tasks_manage'] as const).map(action => <label key={action} className="retro-editor-check"><input type="checkbox" checked={inviteActions[action] ?? false} disabled={commands.invite.state.phase === 'submitting'} onChange={event => setInviteActions(prev => ({ ...prev, [action]: event.target.checked }))} />{action}</label>)}</fieldset>
        </div>
        <Button type="submit" disabled={commands.invite.state.phase === 'submitting' || commands.invite.state.phase === 'failed' || chosenActions.length === 0}>{L('Send invitation', 'ارسال دعوت')}</Button>
      </form>
      {commands.invite.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.invite.state)}</p><Button onClick={() => { commands.invite.reset(); retry(); }}>{L('Reload team', 'بارگذاری دوباره تیم')}</Button></div> : null}
    </details> : null}
    {commands.revokeStaff.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.revokeStaff.state)}</p><Button onClick={() => { commands.revokeStaff.reset(); retry(); }}>{L('Reload team', 'بارگذاری دوباره تیم')}</Button></div> : null}

    <RetroAstraWorkspaceDocuments platform={platform} workspaceId={workspaceId} mayTask={mayTask} user={user} />
  </section>;
}

const DOCUMENT_CATEGORY_LABEL: Record<string, [string, string]> = {
  identification: ['Identification', 'شناسایی'],
  registration: ['Registration', 'ثبت‌نامه'],
  insurance: ['Insurance', 'بیمه'],
  ownership: ['Ownership', 'مالکیت'],
  veterinary_paper: ['Veterinary paper', 'مدرک دامپزشکی'],
  transport: ['Transport', 'حمل‌ونقل'],
  other: ['Other', 'سایر'],
};

/**
 * R114-06 (Master AI handoff D23/D32–35) — Retro Astra's native DOCUMENT
 * trackers + the bounded no-overwrite reminder import. Trackers only — no
 * file bytes, no medical content. Versioned updates are CAS-guarded (a 409
 * keeps the draft and shows the honest reload story); a document's horse
 * association is fixed at creation (R108-08) and never silently moved;
 * archived rows are read-only history. One durable intent key per import
 * session: an interrupted import replays to its exact accepted rows.
 */
function RetroAstraWorkspaceDocuments({ platform, workspaceId, mayTask, user }: { platform: PlatformClient | null; workspaceId: number; mayTask: boolean; user?: PlatformUser | null }) {
  const { language } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const T = WORKSPACE_DESK;
  const W = WORKSPACES;
  const scope = usePrincipalScope(user, null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const { documents, retry } = useWorkspaceDocuments({ workspaceId, includeArchived, platform, scope, userId: user?.id ?? null });
  const { createDocument, importTasks } = useWorkspaceDocumentCommands(`${scope}|workspace:${workspaceId}`);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<WorkspaceDocumentKind>('registration');
  const [horseId, setHorseId] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [importRows, setImportRows] = useState<Array<{ title: string; category: 'document_renewal' | 'farrier' | 'veterinary_appointment' | 'other'; due_date: string }>>([{ title: '', category: 'other', due_date: '' }]);
  const [receipts, setReceipts] = useState<Array<{ title: string; status: string; task_id: number | null }> | null>(null);
  const [intentKey, setIntentKey] = useState(() => newImportIntentKey());
  const createBlocked = documents.phase !== 'ready' && documents.phase !== 'reloading' && documents.phase !== 'empty' || createDocument.state.phase === 'submitting' || createDocument.state.phase === 'failed';
  const importBlocked = importTasks.state.phase === 'submitting' || importTasks.state.phase === 'failed';
  const importValid = importRows.length >= 1 && importRows.length <= 200 && importRows.every(row => row.title.trim().length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date));

  return <section className="collection-sheet retro-editor" aria-label={pick(T.documentsTitle, language)} data-surface="workspace-documents">
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('STABLE WORKSPACES', 'فضاهای کاری اصطبل')}</span><h1>{pick(T.documentsTitle, language)}</h1><p>{pick(W.documentTrackers, language)}</p></div>
      <div className="retro-editor-actions">
        <Button aria-pressed={includeArchived} onClick={() => setIncludeArchived(v => !v)}>{includeArchived ? pick(T.hideArchived, language) : pick(T.includeArchived, language)}</Button>
        <Button onClick={() => retry()}>{L('Refresh documents', 'تازه‌سازی مدرک‌ها')}</Button>
        {platform ? <a className="retro-editor-check" href={platform.modules.workspaces.exportUrl(workspaceId)}>{pick(T.exportCsv, language)}</a> : null}
      </div></div>
    {documents.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading document trackers…', 'بارگذاری پیگیرهای مدرک…')}</p> : null}
    {documents.phase === 'forbidden' ? <div role="alert" className="desk-notice desk-notice--error"><p>{pick(T.forbiddenDashboard, language)}</p></div> : null}
    {documents.phase === 'unavailable' || documents.phase === 'error' ? <div role="alert" className="desk-notice desk-notice--error"><p>{L('The document list is unavailable.', 'فهرست مدرک در دسترس نیست.')}</p><p dir="auto">{documents.reason}</p><Button onClick={retry}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
    {(documents.phase === 'ready' || documents.phase === 'reloading') ? (documents.rows.length ? <ul className="retro-editor-options">{documents.rows.map(row => <RetroAstraDocumentRow key={row.id} platform={platform} workspaceId={workspaceId} row={row} mayTask={mayTask && documents.phase === 'ready'} language={language} onDone={retry} />)}</ul> : <p className="desk-notice">{pick(T.noDocuments, language)}</p>) : null}
    {documents.phase === 'empty' ? <p className="desk-notice">{pick(T.noDocuments, language)}</p> : null}

    {mayTask ? <details className="retro-editor-help"><summary>{pick(T.trackDocument, language)}</summary>
      <form onSubmit={event => { event.preventDefault(); if (createBlocked) return; const parsedHorse = horseId.trim() === '' ? null : Number(horseId); if (parsedHorse !== null && (!Number.isSafeInteger(parsedHorse) || parsedHorse <= 0)) return; void createDocument.run(async () => {
        const result = await platform!.modules.workspaces.createDocument(workspaceId, {
          title: title.trim(), category, note: note.trim() || null, expires_at: expiresAt || null,
          ...(parsedHorse != null && Number.isSafeInteger(parsedHorse) && parsedHorse > 0 ? { horse_id: parsedHorse } : {}),
        });
        setTitle(''); setNote(''); setExpiresAt(''); setHorseId(''); retry(); return result;
      }, { successMessage: L('Document tracker created. Expiry (if set) can drive a renewal reminder.', 'پیگیر مدرک ساخته شد.') }); }}>
        <div className="retro-editor-grid">
          <EditorField label={L('Title', 'عنوان')}><input required minLength={1} maxLength={300} dir="auto" value={title} disabled={createBlocked} onChange={event => setTitle(event.target.value)} /></EditorField>
          <EditorField label={L('Category', 'دسته')}><select value={category} disabled={createBlocked} onChange={event => setCategory(event.target.value as WorkspaceDocumentKind)}>{Object.entries(DOCUMENT_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label[language === 'fa' ? 1 : 0]}</option>)}</select></EditorField>
          <EditorField label={L('Horse id (optional — fixed once created)', 'شناسه اسب (اختیاری — پس از ایجاد ثابت است)')}><input type="number" min="1" step="1" dir="ltr" value={horseId} disabled={createBlocked} onChange={event => setHorseId(event.target.value)} /></EditorField>
          <EditorField label={L('Expiry day (optional, Gregorian)', 'روز انقضا (اختیاری، میلادی)')}><input type="date" value={expiresAt} disabled={createBlocked} onChange={event => setExpiresAt(event.target.value)} /></EditorField>
          <EditorField label={L('Note (optional)', 'یادداشت (اختیاری)')}><input maxLength={2000} dir="auto" value={note} disabled={createBlocked} onChange={event => setNote(event.target.value)} /></EditorField>
        </div>
        <Button type="submit" disabled={createBlocked}>{pick(T.createTracker, language)}</Button>
      </form>
      {createDocument.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(createDocument.state)}</p><Button onClick={() => { createDocument.reset(); retry(); }}>{L('Reload documents', 'بارگذاری دوباره مدرک‌ها')}</Button></div> : null}
    </details> : <p className="desk-notice">{pick(T.needTasksManageDocuments, language)}</p>}

    {mayTask ? <details className="retro-editor-help"><summary>{pick(T.importUpTo, language)}</summary>
      <p className="desk-notice">{pick(W.importNoOverwrite, language)}</p>
      <form onSubmit={event => { event.preventDefault(); if (importBlocked || !importValid) return; void importTasks.run(async () => {
        const result = await platform!.modules.workspaces.importTasks(workspaceId, importRows.map(row => ({ title: row.title.trim(), category: row.category, due_date: row.due_date })), { intentKey });
        setReceipts(result.receipts.map(receipt => ({ title: receipt.title, status: receipt.status, task_id: receipt.task_id })));
        setIntentKey(newImportIntentKey());
        setImportRows([{ title: '', category: 'other', due_date: '' }]);
        retry(); return result;
      }, { successMessage: pick(T.importFinished, language) }); }}>
        {importRows.map((row, index) => <fieldset key={index} className="retro-editor-grid"><legend>{L('Row', 'ردیف')} {index + 1}</legend>
          <EditorField label={L('Title', 'عنوان')}><input required maxLength={300} dir="auto" value={row.title} disabled={importBlocked} onChange={event => setImportRows(prev => prev.map((r, i) => i === index ? { ...r, title: event.target.value } : r))} /></EditorField>
          <EditorField label={L('Category', 'دسته')}><select value={row.category} disabled={importBlocked} onChange={event => setImportRows(prev => prev.map((r, i) => i === index ? { ...r, category: event.target.value as typeof row.category } : r))}>{Object.entries(TASK_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label[language === 'fa' ? 1 : 0]}</option>)}</select></EditorField>
          <EditorField label={L('Due date (Gregorian)', 'سررسید (میلادی)')}><input required type="date" value={row.due_date} disabled={importBlocked} onChange={event => setImportRows(prev => prev.map((r, i) => i === index ? { ...r, due_date: event.target.value } : r))} /></EditorField>
          {importRows.length > 1 ? <Button type="button" disabled={importBlocked} onClick={() => setImportRows(prev => prev.filter((_, i) => i !== index))}>{L('Remove row', 'حذف ردیف')}</Button> : null}
        </fieldset>)}
        <div className="retro-editor-actions">
          <Button type="button" disabled={importBlocked || importRows.length >= 200} onClick={() => setImportRows(prev => [...prev, { title: '', category: 'other', due_date: '' }])}>{L('Add row', 'افزودن ردیف')}</Button>
          <Button type="submit" disabled={importBlocked || !importValid}>{L('Import', 'درون‌ریزی')}</Button>
        </div>
      </form>
      {importTasks.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(importTasks.state)}</p><Button onClick={() => { importTasks.reset(); retry(); }}>{L('Reload workspace', 'بارگذاری دوباره')}</Button></div> : null}
      {importTasks.state.phase === 'accepted' && receipts ? <div role="status" aria-label={pick(T.perRowReceipts, language)}><h4>{pick(T.perRowReceipts, language)}</h4><ul className="retro-editor-options">{receipts.map((receipt, index) => <li key={index}>
        <strong dir="auto">{receipt.title}</strong>
        <small dir="auto">{receipt.status === 'imported' ? pick(T.importedLabel, language) : receipt.status === 'already_imported' ? pick(T.alreadyImportedLabel, language) : receipt.status === 'occurrence_exists' ? pick(T.occurrenceExistsLabel, language) : pick(T.rowRefusedLabel, language)}{receipt.task_id != null ? ` · #${receipt.task_id}` : ''}</small>
      </li>)}</ul></div> : null}
    </details> : null}
  </section>;
}

/** ONE document row: its own command slots (one row's in-flight state never
 * paints onto another), CAS-guarded versioned edit that keeps the draft on a
 * 409, and the honest archive-then-history story. The failure notice derives
 * from the command STATE at render time — command.run never rejects; a
 * refusal is a rejected state, never an exception in the submit handler. */
function RetroAstraDocumentRow({ platform, workspaceId, row, mayTask, language, onDone }: { platform: PlatformClient | null; workspaceId: number; row: WorkspaceDocumentRecord; mayTask: boolean; language: Language; onDone: () => void }) {
  const T = WORKSPACE_DESK;
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const updateDocument = usePlatformCommand(`workspace-document-update:${workspaceId}:${row.id}`);
  const archiveCommand = usePlatformCommand(`workspace-document-archive:${workspaceId}:${row.id}`);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [note, setNote] = useState(row.note ?? '');
  const [expiresAt, setExpiresAt] = useState(row.expires_at ?? '');
  const archived = row.status === 'archived';
  return <li className="retro-editor-check" data-surface="workspace-document-row">
    <div className="collection-sheet-heading"><div>
      <strong dir="auto">{row.title}</strong>
      <small dir="auto">{DOCUMENT_CATEGORY_LABEL[row.category]?.[language === 'fa' ? 1 : 0] ?? row.category}{row.horse_id != null ? ` · ${L('horse', 'اسب')} #${row.horse_id} (${pick(T.horseFixed, language)})` : ''}{row.expires_at ? ` · ${L('expires', 'انقضا')}: ${row.expires_at}` : ''} · v{row.row_version}{archived ? ` · ${pick(T.archivedReadOnly, language)}` : ''}</small>
      {row.note ? <small dir="auto">{row.note}</small> : null}
    </div></div>
    {mayTask && !archived ? <div className="retro-editor-actions">
      {!editing ? <Button onClick={() => { setTitle(row.title); setNote(row.note ?? ''); setExpiresAt(row.expires_at ?? ''); setEditing(true); }}>{L('Edit', 'ویرایش')}</Button> : null}
      {editing ? <form onSubmit={event => { event.preventDefault(); void updateDocument.run(async () => {
        const result = await platform!.modules.workspaces.updateDocument(workspaceId, row.id, {
          // R108-08: the association round-trips exactly as stored — the update
          // never tries to move it, and a mismatched value is an explicit 409.
          horse_id: row.horse_id, title: title.trim(), category: row.category, note: note.trim() || null, expires_at: expiresAt || null,
        }, { expectedVersion: row.row_version });
        setEditing(false); onDone(); return result;
      }, { successMessage: L('Document updated.', 'مدرک به‌روزرسانی شد.') }); }}>
        <div className="retro-editor-grid">
          <EditorField label={L('Title', 'عنوان')}><input required minLength={1} maxLength={300} dir="auto" value={title} disabled={updateDocument.state.phase === 'submitting'} onChange={event => setTitle(event.target.value)} /></EditorField>
          <EditorField label={L('Expiry day (optional)', 'روز انقضا (اختیاری)')}><input type="date" value={expiresAt} disabled={updateDocument.state.phase === 'submitting'} onChange={event => setExpiresAt(event.target.value)} /></EditorField>
          <EditorField label={L('Note', 'یادداشت')}><input maxLength={2000} dir="auto" value={note} disabled={updateDocument.state.phase === 'submitting'} onChange={event => setNote(event.target.value)} /></EditorField>
        </div>
        <Button type="submit" disabled={updateDocument.state.phase === 'submitting'}>{pick(T.saveVersioned, language)}</Button>
        <Button type="button" disabled={updateDocument.state.phase === 'submitting'} onClick={() => setEditing(false)}>{L('Cancel', 'انصراف')}</Button>
      </form> : null}
      <Button disabled={archiveCommand.state.phase === 'submitting'} onClick={() => { void archiveCommand.run(async () => { const result = await platform!.modules.workspaces.archiveDocument(workspaceId, row.id); onDone(); return result; }, { successMessage: pick(T.archivedNote, language) }); }}>{pick(T.archive, language)}</Button>
    </div> : null}
    {updateDocument.state.phase === 'rejected' ? <div role="alert" className="desk-notice desk-notice--error">
      <p dir="auto">{updateDocument.state.message}</p>
      <p>{updateDocument.state.code === 'document_version_conflict' ? pick(T.documentConflict, language) : updateDocument.state.code === 'document_horse_immutable' ? pick(WORKSPACES.documentHorseImmutable, language) : updateDocument.state.code === 'document_archived' ? pick(T.archivedReadOnly, language) : ''}</p>
      {updateDocument.state.currentVersion != null ? <p>{L('Current version', 'نسخه فعلی')}: v{updateDocument.state.currentVersion}</p> : null}
      <Button onClick={() => { updateDocument.reset(); onDone(); }}>{L('Reload current version', 'بازخوانی نسخه فعلی')}</Button>
    </div> : null}
    {updateDocument.state.phase === 'failed' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(updateDocument.state)}</p><Button onClick={() => { updateDocument.reset(); onDone(); }}>{L('Reload documents', 'بارگذاری دوباره مدرک‌ها')}</Button></div> : null}
    {archiveCommand.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(archiveCommand.state)}</p><Button onClick={() => { archiveCommand.reset(); onDone(); }}>{L('Reload documents', 'بارگذاری دوباره مدرک‌ها')}</Button></div> : null}
  </li>;
}

/** The invitee's own cross-workspace inbox (R114-05) with honest answer refusals. */
export function RetroAstraMyWorkspaceInvitations({ platform, user }: { platform: PlatformClient | null; user?: PlatformUser | null }) {
  const { language } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const T = WORKSPACE_DESK;
  const scope = usePrincipalScope(user, null);
  const commands = useWorkspaceDeskCommands(scope);
  const mine = useMyWorkspaceInvitations({ platform, scope, userId: user?.id ?? null, enabled: user != null && platform != null });
  const [answerFailure, setAnswerFailure] = useState<string | null>(null);
  if (!user || platform == null) return null;
  const answer = (invitationId: number, action: 'accept' | 'decline', success: string) => {
    setAnswerFailure(null);
    void commands.respond.run(async () => {
      try {
        const result = await platform.modules.workspaces.respondInvite(invitationId, action);
        mine.retry(); return result;
      } catch (error) {
        const failure = classifyWorkspaceAnswerFailure(error);
        setAnswerFailure(failure.kind === 'expired' ? pick(T.expiredAnswer, language) : failure.kind === 'already_answered' ? pick(T.alreadyAnswered, language) : failure.kind === 'not_acceptable' ? pick(T.notAcceptableAnswer, language) : failure.kind === 'gone' ? pick(T.goneAnswer, language) : pick(T.unknownAnswer, language));
        throw error;
      }
    }, { successMessage: success });
  };
  return <section className="collection-sheet retro-editor" aria-label={pick(T.myInvitations, language)} data-surface="workspace-invitations">
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('STABLE WORKSPACES', 'فضاهای کاری اصطبل')}</span><h1>{pick(T.myInvitations, language)}</h1></div></div>
    {mine.phase === 'loading' ? <p role="status" className="desk-notice">{L('Loading your invitations…', 'بارگذاری دعوت‌های شما…')}</p> : null}
    {mine.phase === 'unavailable' || mine.phase === 'error' ? <div role="alert" className="desk-notice desk-notice--error"><p>{L('Your invitation list is unavailable.', 'فهرست دعوت شما در دسترس نیست.')}</p><p dir="auto">{mine.reason}</p><Button onClick={mine.retry}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
    {mine.phase === 'ready' ? (mine.invitations.length ? <ul className="retro-editor-options">{mine.invitations.map(invitation => <li key={invitation.collection_id}>
      <div><strong dir="auto">{invitation.workspace_name}</strong>
        <small>{L('Proposed', 'پیشنهاد')}: {invitation.proposed_actions} · {L('expires', 'انقضا')}: {invitation.expires_at.slice(0, 10)}</small>
        {invitation.note ? <small dir="auto">{invitation.note}</small> : null}
      </div>
      {invitation.actionable ? <div className="retro-editor-actions">
        <Button disabled={commands.respond.state.phase === 'submitting'} onClick={() => answer(invitation.collection_id, 'accept', L('Invitation accepted. Your access is re-checked live on every request.', 'دعوت پذیرفته شد. دسترسی شما در هر درخواست زنده بررسی می‌شود.'))}>{pick(T.accept, language)}</Button>
        <Button disabled={commands.respond.state.phase === 'submitting'} onClick={() => answer(invitation.collection_id, 'decline', L('Invitation declined.', 'دعوت رد شد.'))}>{pick(T.decline, language)}</Button>
      </div> : <small>{pick(T.expiredAnswer, language)}</small>}
    </li>)}</ul> : <p className="desk-notice">{L('You have no pending workspace invitations.', 'دعوت فضای کاری در انتظار ندارید.')}</p>) : null}
    {answerFailure ? <div role="alert" className="desk-notice desk-notice--error"><p>{answerFailure}</p></div> : null}
    {commands.respond.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.respond.state)}</p><Button onClick={() => { commands.respond.reset(); mine.retry(); }}>{L('Reload invitations', 'بارگذاری دوباره دعوت‌ها')}</Button></div> : null}
  </section>;
}
