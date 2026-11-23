import { uiText, type UiLocale } from "../../shared/uiLocale";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlatformClient, PlatformUser, WorkspaceSummary, WorkspaceTaskRecord } from "../../contracts/platform";
import { HeritageResourceNotice, HeritageCommandNotice } from "./DomainFeedback";
import { useI18n } from "../i18n";
import { useDomainResource, usePlatformCommand, pick as pickText, useWorkspaceDoneTasks, WORKSPACES, WORKSPACE_DESK, buildWorkspaceCalendar, type CalendarModel } from "../../frontend-kit";
import { HeritageWorkspaceStaffPanel, HeritageMyInvitations } from "./WorkspaceStaffPanel";
import { HeritageWorkspaceDocumentsPanel } from "./WorkspaceDocumentsPanel";
import "../styles/heritage.workbenches.css";

/**
 * R88 agent plan P21 (step 3): farm workspaces in Heritage's language. A
 * workspace is a WORKING SET, never an ownership claim — the note ships on
 * every surface. Task completion is CAS-guarded (expected_version) through
 * the canonical P20 command hook: a 409 shows the honest reload-and-retry
 * story instead of a blind resubmit. Veterinary reminders carry the
 * qualified-person notice; they are never medical instructions.
 */

const TASK_CATEGORY_LABEL: Record<string, [string, string]> = {
  document_renewal: ["Document renewal", "تمدید مدرک"],
  farrier: ["Farrier", "نعل‌بندی"],
  veterinary_appointment: ["Veterinary appointment", "نوبت دامپزشکی"],
  other: ["Other", "سایر"],
};

export function HeritageWorkspacesPage({ navigate, platform, user }: { navigate: (path: string) => void; platform: PlatformClient; user: PlatformUser | null }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [selected, setSelected] = useState<number | null>(null);
  const mine = useDomainResource("workspaces-mine", user?.id ?? "anonymous", (signal) => platform.modules.workspaces.mine({ signal }), { enabled: !!user, isEmpty: (data) => data.owned.length === 0 && data.staff.length === 0 && !data.organization?.length });
  const dashboard = useDomainResource("workspace-dashboard", JSON.stringify([user?.id ?? "anonymous", selected]), (signal) => (selected == null ? Promise.reject(new Error("No workspace selected")) : platform.modules.workspaces.dashboard(selected, { signal })), { enabled: !!user && selected != null, isEmpty: () => false });

  if (!user) {
    return <main className="page heritage-operations-page">
      <header className="section-title" data-h-surface-role="major"><div><span>{L("WORKSPACES", "فضاهای کاری")}</span><h2>{pickText(WORKSPACES.title, locale)}</h2></div></header>
      <section data-h-surface-role="panel"><p>{L("Sign in to see your farm workspaces.", "برای دیدن فضاهای کاری مزرعه خود وارد شوید.")}</p><div className="table-actions"><button onClick={() => navigate("/login")}>{L("Sign in", "ورود")}</button></div></section>
    </main>;
  }

  const list = (mine.state.phase === "ready" || mine.state.phase === "reloading") ? mine.state.data : null;
  const active = (dashboard.state.phase === "ready" || dashboard.state.phase === "reloading") ? dashboard.state.data : null;
  const renderSummary = (summary: WorkspaceSummary) => <li key={summary.id}>
    <button className="registry-row-clickable" aria-current={selected === summary.id} onClick={() => setSelected(summary.id)}>
      <strong dir="auto">{summary.name}</strong>
      <small>{summary.role === "owner" ? L("Owner", "مالک") : summary.role === "manager" ? L("Manager", "مدیر") : L("Staff", "کارکنان")}</small>
    </button>
  </li>;

  return <main className="page heritage-operations-page">
    <header className="section-title" data-h-surface-role="major">
      <div>
        <span>{L("WORKSPACES", "فضاهای کاری")}</span>
        <h2>{pickText(WORKSPACES.title, locale)}</h2>
        <p>{pickText(WORKSPACES.workingSet, locale)}</p>
      </div>
    </header>
    <div className="h-mod-domain-grid">
      <section data-h-surface-role="panel" aria-busy={mine.state.phase === "loading" || mine.state.phase === "reloading"}>
        <h3>{L("My collections", "مجموعه‌های من")}</h3>
        <HeritageResourceNotice state={mine.state} retry={mine.retry} />
        
        {mine.state.phase === "empty" ? <p>{L("No workspaces yet. Creation is subject to the current free-tier or plan limits.", "هنوز فضای کاری نیست. ایجاد تابع محدودیت فعلی طرح است.")}</p> : null}
        <WorkspaceCreateForm platform={platform} onCreated={(id) => { mine.retry(); setSelected(id); }} reload={mine.retry} />
        <HeritageMyInvitations platform={platform} userId={user.id} />
        {list ? <ul className="h-mod-workspace-list">{list.owned.map(renderSummary)}{list.staff.map(renderSummary)}{list.organization?.map(renderSummary)}</ul> : null}
      </section>
      <section data-h-surface-role="panel" aria-busy={dashboard.state.phase === "loading" || dashboard.state.phase === "reloading"}>
        {selected == null ? <p>{L("Select a workspace to see its herd and reminders.", "یک فضای کاری انتخاب کنید تا گله و یادآورها را ببینید.")}</p> : <>
          <HeritageResourceNotice state={dashboard.state} retry={dashboard.retry} />
          
          {active ? <WorkspaceDashboardView key={JSON.stringify([user.id,selected])} platform={platform} workspaceId={selected} dashboard={active} locale={locale} L={L} refresh={dashboard.retry} stale={dashboard.state.phase !== "ready"} /> : null}
        </>}
      </section>
    </div>
  </main>;
}

function WorkspaceDashboardView({ platform, workspaceId, dashboard, locale, L, refresh, stale }: { platform: PlatformClient; workspaceId: number; dashboard: NonNullable<Awaited<ReturnType<PlatformClient["modules"]["workspaces"]["dashboard"]>>>; locale: UiLocale; L: (en: string, fa: string) => string; refresh: () => void; stale: boolean }) {
  const command = usePlatformCommand(`workspace:${workspaceId}:complete`);
  // R117-14: completing a reminder moves it INTO the completed list, so the
  // completed-reminders panel (a sibling component) must reload too — the
  // ref keeps the panel's retry reachable without lifting its state.
  const completedRetryRef = useRef<(() => void) | null>(null);
  const mayTask = dashboard.workspace?.granted_actions?.includes("tasks_manage") === true;
  const mayManage = dashboard.workspace?.granted_actions?.includes("manage") === true;
  const blocked = stale || command.state.phase === "submitting" || command.state.phase === "failed";
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [section, setSection] = useState<"reminders" | "herd" | "team" | "documents">("reminders");
  const [monthOffset, setMonthOffset] = useState(0);
  const sectionId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sections = [
    { id: "reminders", label: L("Reminders", "یادآورها") },
    { id: "herd", label: L("Horses", "اسب‌ها") },
    { id: "team", label: L("People", "افراد") },
    { id: "documents", label: L("Documents", "مدارک") },
  ] as const;
  const allTasks = useMemo(() => [...(dashboard.tasks.overdue ?? []), ...(dashboard.tasks.due_soon ?? []), ...(dashboard.tasks.later ?? [])], [dashboard.tasks]);
  const taskById = useMemo(() => new Map(allTasks.map(task => [task.id, task])), [allTasks]);
  const calendar = useMemo<CalendarModel | null>(() => {
    if (viewMode !== "calendar") return null;
    const base = new Date();
    const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
    return buildWorkspaceCalendar(allTasks, target.getUTCFullYear(), target.getUTCMonth() + 1, base.toISOString());
  }, [viewMode, monthOffset, allTasks]);
  const complete = async (task: WorkspaceTaskRecord) => {
    const accepted = await command.run(() => platform.modules.workspaces.completeTask(workspaceId, task.id, { expectedVersion: task.row_version }), { successMessage: L("Reminder completed. A recurring reminder schedules its next occurrence exactly once.", "یادآور کامل شد. یادآور تکرارشونده فقط یک بار وقوع بعدی را زمان‌بندی می‌کند.") });
    if (accepted) { refresh(); completedRetryRef.current?.(); }
  };
  const bucket = (title: string, tasks: WorkspaceTaskRecord[]) => tasks.length ? <div className="h-mod-task-bucket">
    <h4>{title} · {tasks.length.toLocaleString(locale)}</h4>
    <ul className="h-mod-task-list">{tasks.map(task => <li key={task.id}>
      <button type="button" className="registry-row-clickable" onClick={() => void complete(task)} disabled={blocked || !mayTask} aria-label={`${L("Complete reminder", "تکمیل یادآور")}: ${task.title}`}>
        <strong dir="auto">{task.title}</strong>
        <small dir="auto">{TASK_CATEGORY_LABEL[task.category]?.[locale === "fa" ? 1 : 0] ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? "Asia/Tehran"}</small>
        {mayTask && <span className="h-task-action">{L("Mark complete", "علامت‌گذاری به‌عنوان انجام‌شده")}</span>}
      </button>
      {task.category === "veterinary_appointment" && <p className="h-mod-state-note">{pickText(WORKSPACES.veterinaryNotice, locale)}</p>}
    </li>)}</ul>
  </div> : null;
  const panel = (id: typeof section, content: React.ReactNode) => <div className="h-workspace-panel" id={`${sectionId}-${id}-panel`} role="tabpanel" aria-labelledby={`${sectionId}-${id}-tab`} hidden={section !== id} tabIndex={0}>{content}</div>;
  return <>
    <header className="h-workspace-header">
      <div><h3 dir="auto">{dashboard.workspace?.name ?? `#${workspaceId}`}</h3><small>{dashboard.herd_size.toLocaleString(locale)} {L("horses in this working set", "اسب در این مجموعه کاری")}</small></div>
      <button type="button" disabled={command.state.phase === "submitting"} onClick={() => { command.reset(); refresh(); }}>{L("Refresh workspace", "تازه‌سازی فضای کاری")}</button>
    </header>
    <HeritageCommandNotice state={command.state} reload={() => { command.reset(); refresh(); }} />
    {dashboard.workspace?.writable === false && <p role="status">{L("Your plan is read-only. Existing information and permitted exports remain available.", "طرح شما فقط‌خواندنی است. اطلاعات موجود و خروجی‌های مجاز در دسترس هستند.")}</p>}
    <div className="h-workspace-tabs" role="tablist" aria-label={L("Workspace sections", "بخش‌های فضای کاری")}>
      {sections.map((item, index) => <button key={item.id} type="button" ref={element => { tabRefs.current[index] = element; }} role="tab" id={`${sectionId}-${item.id}-tab`} aria-controls={`${sectionId}-${item.id}-panel`} aria-selected={section === item.id} tabIndex={section === item.id ? 0 : -1} onClick={() => setSection(item.id)} onKeyDown={event => {
        const direction = locale === "fa" ? -1 : 1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : event.key === "ArrowRight" ? (index + direction + sections.length) % sections.length : event.key === "ArrowLeft" ? (index - direction + sections.length) % sections.length : null;
        if (next !== null) { event.preventDefault(); setSection(sections[next]!.id); tabRefs.current[next]?.focus(); }
      }}>{item.label}</button>)}
    </div>
    {panel("reminders", <>
      <WorkspaceActions platform={platform} workspaceId={workspaceId} mayTask={mayTask} mayManage={mayManage} stale={stale} refresh={refresh} section="reminders" />
      <div className="h-mod-view-toggle" role="group" aria-label={L("Reminder view", "نمای یادآورها")}>
        <button type="button" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>{L("List view", "نمای فهرست")}</button>
        <button type="button" aria-pressed={viewMode === "calendar"} onClick={() => setViewMode("calendar")}>{L("Calendar view", "نمای تقویم")}</button>
      </div>
      {dashboard.tasks_truncated && <WorkspaceFullReminderList platform={platform} workspaceId={workspaceId} locale={locale} L={L} />}
      {dashboard.tasks.invalid?.length ? <div role="alert"><h4>{L("Reminder dates needing review", "تاریخ‌های نیازمند بررسی")}</h4>{dashboard.tasks.invalid.map(task => <p key={task.id} dir="auto">{task.title} · {task.due_date} · {task.due_timezone}</p>)}</div> : null}
      {viewMode === "list" ? <>
        {bucket(pickText(WORKSPACES.overdue, locale), dashboard.tasks.overdue)}
        {bucket(pickText(WORKSPACES.dueSoon, locale), dashboard.tasks.due_soon)}
        {bucket(pickText(WORKSPACES.later, locale), dashboard.tasks.later)}
      </> : calendar ? <section className="h-mod-calendar" aria-label={L("Reminders by day", "یادآورها بر اساس روز")}>
        <div className="h-mod-calendar-nav"><button type="button" onClick={() => setMonthOffset(v => v - 1)} aria-label={L("Previous month", "ماه قبل")}>‹</button><strong>{calendar.monthLabel}</strong><button type="button" onClick={() => setMonthOffset(v => v + 1)} aria-label={L("Next month", "ماه بعد")}>›</button></div>
        <p className="h-mod-state-note">{L("Select a reminder to mark it complete. Dates use each reminder’s timezone.", "برای تکمیل، یادآور را انتخاب کنید. تاریخ‌ها بر اساس منطقه زمانی هر یادآور هستند.")}</p>
        <div className="h-mod-calendar-grid">{calendar.days.map((cell, index) => <div key={index} className={`h-mod-calendar-cell ${cell.inMonth ? "" : "pad"} ${cell.tasks.some(task => task.overdue) ? "has-overdue" : ""}`}>
          {cell.inMonth && <><time dateTime={cell.day} aria-label={cell.day}>{Number(cell.day.slice(8)).toLocaleString(locale)}</time><ul>{cell.tasks.map(task => <li key={task.id}><button type="button" onClick={() => { const record = taskById.get(task.id); if (record) void complete(record); }} disabled={blocked || !mayTask || !taskById.has(task.id)} aria-label={`${L("Complete reminder", "تکمیل یادآور")}: ${task.title}`}><strong dir="auto">{task.title}</strong></button></li>)}</ul></>}
        </div>)}</div>
      </section> : null}
      {allTasks.length === 0 && <p>{L("No open reminders. Add one to track the next task for this workspace.", "یادآور بازی وجود ندارد. برای پیگیری کار بعدی یک یادآور اضافه کنید.")}</p>}
      <WorkspaceTaskImport platform={platform} workspaceId={workspaceId} mayTask={mayTask} locale={locale} L={L} refresh={refresh} />
      <WorkspaceCompletedReminders platform={platform} workspaceId={workspaceId} mayTask={mayTask} locale={locale} L={L} refresh={refresh} registerRetry={retry => { completedRetryRef.current = retry; }} />
    </>)}
    {panel("herd", <>
      <p className="h-mod-state-note">{pickText(WORKSPACES.neverDeleted, locale)}</p>
      <WorkspaceActions platform={platform} workspaceId={workspaceId} mayTask={mayTask} mayManage={mayManage} stale={stale} refresh={refresh} section="herd" />
      {dashboard.horses.length ? <ul className="h-workspace-herd">{dashboard.horses.map((horse, index) => {
        const id = Number(horse.horse_id ?? horse.id);
        const name = String((locale === "fa" ? horse.name_native || horse.name_latin : horse.name_latin || horse.name_native) || (Number.isSafeInteger(id) ? `#${id}` : L("Horse record", "رکورد اسب")));
        return <li key={Number.isSafeInteger(id) ? id : index}>{Number.isSafeInteger(id) && id > 0 ? <a href={`/horse/${id}`} dir="auto">{name}</a> : <span dir="auto">{name}</span>}</li>;
      })}</ul> : <p>{L("No horses have been added to this working set.", "هنوز اسبی به این مجموعه کاری اضافه نشده است.")}</p>}
    </>)}
    {panel("team", <>
      <HeritageWorkspaceStaffPanel platform={platform} workspaceId={workspaceId} mayManage={mayManage} refresh={refresh} staff={(dashboard.active_staff ?? []).map(member => ({ user_id: member.user_id, actions: (member.actions ?? []).join(","), granted_at: member.granted_at, status: "active" }))} />
      <WorkspaceTaskAssignment platform={platform} workspaceId={workspaceId} mayTask={mayTask} staff={dashboard.active_staff ?? []} tasks={allTasks} locale={locale} L={L} refresh={refresh} />
    </>)}
    {panel("documents", <HeritageWorkspaceDocumentsPanel platform={platform} workspaceId={workspaceId} mayTask={mayTask} stale={stale} refresh={refresh} />)}
  </>;
}

function WorkspaceCreateForm({ platform, onCreated, reload }: { platform: PlatformClient; onCreated: (id: number) => void; reload: () => void }) {
  const { locale } = useI18n(); const fa=locale === "fa";
  const [name,setName]=useState(""); const command=usePlatformCommand();
  const blocked=command.state.phase === "submitting" || command.state.phase === "failed";
  return <details><summary>{fa ? "ایجاد فضای کاری" : "Create personal workspace"}</summary>
    <form onSubmit={(event) => { event.preventDefault(); void command.run(async () => {
      const result=await platform.modules.workspaces.create({ name:name.trim() });
      setName(""); onCreated(result.workspace.id); return result;
    }, { successMessage:fa ? "فضای کاری ایجاد شد." : "Workspace created." }); }}>
      <label>{fa ? "نام" : "Workspace name"}<input required minLength={2} maxLength={120} dir="auto" value={name} disabled={blocked} onChange={(event)=>setName(event.target.value)} /></label>
      <button disabled={blocked} type="submit">{fa ? "ایجاد" : "Create"}</button>
    </form><HeritageCommandNotice state={command.state} reload={() => { reload(); command.reset(); }} />
  </details>;
}
function WorkspaceActions({ platform,workspaceId,mayTask,mayManage,stale,refresh,section }: { platform: PlatformClient; workspaceId:number; mayTask:boolean; mayManage:boolean; stale:boolean; refresh:()=>void; section:"reminders"|"herd" }) {
  const { locale }=useI18n(); const fa=locale === "fa"; const command=usePlatformCommand();
  const [title,setTitle]=useState(""); const [due,setDue]=useState(""); const [horse,setHorse]=useState("");
  const [timezone,setTimezone]=useState("Asia/Tehran");
  const [category,setCategory]=useState<"document_renewal"|"farrier"|"veterinary_appointment"|"other">("other");
  const [repeat,setRepeat]=useState("");
  const blocked=stale || command.state.phase === "submitting" || command.state.phase === "failed";
  return <>
    {section === "reminders" && mayTask ? <details><summary>{fa ? "افزودن یادآور" : "Add reminder"}</summary>
      <form onSubmit={(event)=>{ event.preventDefault(); void command.run(async()=>{
        const result=await platform.modules.workspaces.addTask(workspaceId,{title:title.trim(),category,due_date:due,due_timezone:timezone,recurrence:repeat?"custom_days":"none",recurrence_interval_days:repeat?Number(repeat):null});
        setTitle(""); refresh(); return result;
      },{successMessage:fa ? "یادآور ثبت شد." : "Reminder recorded; no appointment was booked."}); }}>
        <label>{fa ? "عنوان" : "Title"}<input required minLength={3} maxLength={200} dir="auto" disabled={blocked} value={title} onChange={(event)=>setTitle(event.target.value)} /></label>
        <label>{fa ? "تاریخ میلادی" : "Due date (Gregorian)"}<input required type="date" disabled={blocked} value={due} onChange={(event)=>setDue(event.target.value)} /></label>
        <label>{fa ? "\u062f\u0633\u062a\u0647" : "Category"}<select value={category} disabled={blocked} onChange={event=>setCategory(event.target.value as typeof category)}>{Object.entries(TASK_CATEGORY_LABEL).map(([key,label])=><option value={key} key={key}>{label[fa?1:0]}</option>)}</select></label>
        <label>{fa ? "\u0645\u0646\u0637\u0642\u0647 \u0632\u0645\u0627\u0646\u06cc" : "Timezone (IANA)"}<input required list="workspace-timezones" value={timezone} dir="ltr" disabled={blocked} onChange={event=>setTimezone(event.target.value)} /><datalist id="workspace-timezones"><option value="Asia/Tehran"/><option value="Asia/Dubai"/><option value="Europe/London"/><option value="America/Los_Angeles"/></datalist></label>
        <label>{fa ? "\u062a\u06a9\u0631\u0627\u0631 \u067e\u0633 \u0627\u0632 \u0686\u0646\u062f \u0631\u0648\u0632 (\u0627\u062e\u062a\u06cc\u0627\u0631\u06cc)" : "Repeat every N calendar days (optional)"}<input type="number" min="1" max="3650" step="1" value={repeat} disabled={blocked} onChange={event=>setRepeat(event.target.value)} /></label>
        {category==="veterinary_appointment" ? <p className="h-mod-state-note">{pickText(WORKSPACES.veterinaryNotice,locale)}</p> : null}
        <button type="submit" disabled={blocked}>{fa ? "ثبت" : "Add reminder"}</button>
      </form>
    </details> : null}
    {section === "herd" && mayManage ? <details><summary>{fa ? "افزودن اسب" : "Add a managed horse"}</summary>
      <form onSubmit={(event)=>{ event.preventDefault(); const id=Number(horse); if(!Number.isSafeInteger(id)||id<1)return;
        void command.run(async()=>{ const result=await platform.modules.workspaces.addHorse(workspaceId,id); setHorse(""); refresh(); return result; }); }}>
        <label>{fa ? "شناسه اسب" : "Horse ID (requires your current management grant)"}<input required type="number" min="1" step="1" disabled={blocked} value={horse} onChange={(event)=>setHorse(event.target.value)} /></label>
        <button type="submit" disabled={blocked}>{fa ? "افزودن" : "Add to working set"}</button>
      </form>
    </details> : null}
    <HeritageCommandNotice state={command.state} reload={()=>{ command.reset(); refresh(); }} />
  </>;
}

/**
 * R108-13: the versioned ASSIGN/UNASSIGN control — reassignment advances the
 * task version and is audit-recorded; a stale version is an honest 409 with
 * the reload-and-retry story; the assignee must currently hold workspace
 * access (server-driven, never client-guessed).
 */
function WorkspaceTaskAssignment({ platform, workspaceId, mayTask, staff, tasks, locale, L, refresh }: {
  platform: PlatformClient; workspaceId: number; mayTask: boolean;
  staff: Array<{ user_id: string; actions: string[]; granted_at: string }>;
  tasks: WorkspaceTaskRecord[]; locale: UiLocale; L: (en: string, fa: string) => string; refresh: () => void;
}) {
  const command = usePlatformCommand("workspace-reassign");
  const [taskId, setTaskId] = useState("");
  const [assignee, setAssignee] = useState("");
  const blocked = command.state.phase === "submitting" || command.state.phase === "failed";
  const openTasks = tasks.filter((task) => task.status === "open");
  return <section data-h-surface-role="panel" aria-label={L("Assignment", "انتساب")}>
    <h3>{L("Assignment", "انتساب")}</h3>
    {mayTask ? <details><summary>{L("Assign or unassign a reminder (versioned)", "انتساب یا لغو انتساب یادآور (نسخه‌دار)")}</summary>
      <form onSubmit={(event) => { event.preventDefault(); const task = openTasks.find((t) => String(t.id) === taskId); if (!task) return; void command.run(async () => {
        const result = await platform.modules.workspaces.reassignTask(workspaceId, task.id, assignee.trim() === "" ? null : assignee.trim(), { expectedVersion: task.row_version });
        setTaskId(""); setAssignee(""); refresh(); return result;
      }, { successMessage: L("Assignment updated and audit-recorded; the task version advanced.", "انتساب به‌روزرسانی و ثبت شد.") }); }}>
        <label>{L("Reminder", "یادآور")}<select required value={taskId} disabled={blocked} onChange={(event) => setTaskId(event.target.value)}>
          <option value="">{L("Choose…", "انتخاب…")}</option>
          {openTasks.map((task) => <option key={task.id} value={String(task.id)}>{task.title} · {task.due_date} · v{task.row_version}</option>)}
        </select></label>
        <label>{L("Assign to (blank = unassign)", "انتساب به (خالی = لغو انتساب)")}<input list="workspace-staff-choices" dir="ltr" value={assignee} disabled={blocked} onChange={(event) => setAssignee(event.target.value)} />
          <datalist id="workspace-staff-choices">{staff.map((member) => <option key={member.user_id} value={member.user_id} />)}</datalist>
        </label>
        <button type="submit" disabled={blocked || taskId === ""}>{L("Update assignment", "به‌روزرسانی انتساب")}</button>
      </form>
      <HeritageCommandNotice state={command.state} reload={() => { command.reset(); refresh(); }} />
      {command.state.phase === "rejected" && command.state.currentVersion != null ? <p className="h-mod-state-note" role="alert">{L("This reminder changed; reload and retry with the current version.", "این یادآور تغییر کرده؛ با نسخه فعلی دوباره تلاش کنید.")}</p> : null}
    </details> : <p className="h-mod-state-note">{L("You need the tasks_manage action to assign reminders.", "برای انتساب یادآورها نیازمند اقدام مدیریت یادآورها هستید.")}</p>}
  </section>;
}

/** R117-14: the completed-reminders list with the REOPEN surface. One-shot
 * rows offer a versioned reopen; a closed RECURRING occurrence explains
 * inline why it cannot be reopened (its next occurrence already exists). */
function WorkspaceCompletedReminders({ platform, workspaceId, mayTask, locale, L, refresh, registerRetry }: {
  platform: PlatformClient; workspaceId: number; mayTask: boolean; locale: UiLocale; L: (en: string, fa: string) => string; refresh: () => void; registerRetry?: (retry: () => void) => void;
}) {
  const done = useWorkspaceDoneTasks({ workspaceId, platform, scope: `workspace:${workspaceId}` });
  useEffect(() => { registerRetry?.(done.retry); }, [registerRetry, done.retry]);
  const command = usePlatformCommand(`workspace:${workspaceId}:reopen`);
  const blocked = command.state.phase === "submitting" || command.state.phase === "failed";
  const reopen = async (task: WorkspaceTaskRecord) => {
    const accepted = await command.run(() => platform.modules.workspaces.reopenTask(workspaceId, task.id, { expectedVersion: task.row_version }), { successMessage: pickText(WORKSPACE_DESK.reopenSuccess, locale) });
    if (accepted) { refresh(); done.retry(); }
  };
  const rows = done.done.phase === "ready" || done.done.phase === "reloading" ? (done.done.rows ?? []) : null;
  return <details className="h-mod-completed" data-surface="workspace-completed">
    <summary>{pickText(WORKSPACE_DESK.completedHeading, locale)}{rows ? ` · ${rows.length.toLocaleString(locale)}` : ""}</summary>
    <p className="h-mod-state-note">{pickText(WORKSPACE_DESK.completedNote, locale)}</p>
    {done.done.phase === "forbidden" || done.done.phase === "unavailable" || done.done.phase === "error" ? <div role="alert"><p dir="auto">{done.done.reason}</p><button type="button" onClick={done.retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
    {done.done.phase === "idle" || done.done.phase === "loading" ? <p role="status">{L("Loading completed reminders…", "بارگذاری یادآورهای انجام‌شده…")}</p> : null}
    {rows && rows.length ? <ul className="h-mod-task-list">{rows.map(task => <li key={task.id}>
      {task.recurrence === "none"
        ? <button type="button" className="registry-row-clickable" onClick={() => void reopen(task)} disabled={blocked || !mayTask} aria-label={`${pickText(WORKSPACE_DESK.reopen, locale)}: ${task.title}`}>
            <strong dir="auto">{task.title}</strong>
            <small dir="auto">{TASK_CATEGORY_LABEL[task.category]?.[locale === "fa" ? 1 : 0] ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? "Asia/Tehran"} · v{task.row_version.toLocaleString(locale)}</small>
            {mayTask && <span className="h-task-action">{pickText(WORKSPACE_DESK.reopen, locale)}</span>}
          </button>
        : <div className="h-mod-completed-recurring">
            <strong dir="auto">{task.title}</strong>
            <small dir="auto">{TASK_CATEGORY_LABEL[task.category]?.[locale === "fa" ? 1 : 0] ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? "Asia/Tehran"} · v{task.row_version.toLocaleString(locale)} · {L("recurring occurrence", "وقوع تکرارشونده")}</small>
            <p className="h-mod-state-note">{pickText(WORKSPACE_DESK.recurringCompleted, locale)}</p>
          </div>}
    </li>)}</ul> : null}
    {rows && rows.length === 0 ? <p>{pickText(WORKSPACE_DESK.completedEmpty, locale)}</p> : null}
    <HeritageCommandNotice state={command.state} reload={() => { command.reset(); refresh(); done.retry(); }} />
  </details>;
}

/** R124 (R122-T05): the dashboard's 500-row bucket window is bounded by
 * design; this disclosure walks the keyset-paged tasks endpoint so the FULL
 * open-reminder history is reachable page by page from the workspace desk. */
function WorkspaceFullReminderList({ platform, workspaceId, locale, L }: {
  platform: PlatformClient; workspaceId: number; locale: UiLocale; L: (en: string, fa: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<WorkspaceTaskRecord[] | null>(null);
  const [page, setPage] = useState<{ total: number; next_cursor: string | null; has_more: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setRows(null); setPage(null); setError(false); }, [open && !open]);
  const loadPage = (cursor?: string) => {
    if (loading) return;
    setLoading(true); setError(false);
    platform.modules.workspaces.tasks(workspaceId, { status: "open", limit: 100, ...(cursor ? { cursor } : {}) })
      .then(next => {
        setRows(previous => previous == null ? next.tasks : [...previous, ...next.tasks]);
        setPage(next.page ? { total: next.page.total, next_cursor: next.page.next_cursor, has_more: next.page.has_more } : null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  return <details className="h-mod-completed" data-surface="workspace-full-reminder-list" open={open}
    onToggle={event => {
      const next = (event.target as HTMLDetailsElement).open;
      setOpen(next);
      if (next && rows == null && !loading) loadPage();
    }}>
    <summary>{L("Complete open-reminder list", "فهرست کامل یادآورهای باز")}{page ? ` · ${page.total.toLocaleString(locale)}` : ""}</summary>
    <p className="h-mod-state-note">{L("The workspace view shows a bounded window; this list pages through every open reminder.", "نمای فضای کاری یک پنجره محدود نشان می‌دهد؛ این فهرست همه یادآورهای باز را صفحه‌به‌صفحه می‌آورد.")}</p>
    {error ? <div role="alert"><p>{L("The list could not be loaded.", "بارگذاری فهرست ممکن نشد.")}</p><button type="button" onClick={() => loadPage(page?.next_cursor ?? undefined)}>{L("Try again", "تلاش دوباره")}</button></div> : null}
    {loading && rows == null ? <p role="status">{L("Loading the complete list…", "بارگذاری فهرست کامل…")}</p> : null}
    {rows && rows.length ? <ul className="h-mod-task-list">{rows.map(task => <li key={task.id}>
      <strong dir="auto">{task.title}</strong>
      <small dir="auto">{TASK_CATEGORY_LABEL[task.category]?.[locale === "fa" ? 1 : 0] ?? task.category} · <time dateTime={task.due_date}>{task.due_date}</time> · {task.due_timezone ?? "Asia/Tehran"}</small>
    </li>)}</ul> : null}
    {rows && rows.length === 0 ? <p>{L("No open reminders.", "یادآور بازی وجود ندارد.")}</p> : null}
    {page?.has_more && page.next_cursor ? <p className="h-mod-note" role="status">
      {L("Reminders listed", "یادآورهای فهرست‌شده")}: {rows ? rows.length.toLocaleString(locale) : "0"} / {page.total.toLocaleString(locale)}.{" "}
      <button type="button" className="h-mod-load-more" onClick={() => loadPage(page.next_cursor ?? undefined)} disabled={loading}>
        {loading ? L("Loading more…", "بارگذاری بیشتر…") : L("Load the next page", "بارگذاری صفحه بعدی")}
      </button>
    </p> : null}
  </details>;
}

function WorkspaceTaskImport({ platform, workspaceId, mayTask, locale, L, refresh }: {
  platform: PlatformClient; workspaceId: number; mayTask: boolean; locale: UiLocale; L: (en: string, fa: string) => string; refresh: () => void;
}) {
  /**
   * R108-13 + R108-08: the bounded NO-OVERWRITE import with durable receipts.
   * The client holds one intent key per import session; an interrupted import
   * replays with the SAME key and reconciles to its exact accepted rows. Every
   * row reports its honest outcome — imported, already_imported (accepted by a
   * previous attempt of THIS import), occurrence_exists (someone else's
   * occurrence — skipped, never overwritten) or row_refused.
   */
  const command = usePlatformCommand("workspace-import");
  const [rows, setRows] = useState<Array<{ title: string; category: "document_renewal" | "farrier" | "veterinary_appointment" | "other"; due_date: string }>>([{ title: "", category: "other", due_date: "" }]);
  const [receipts, setReceipts] = useState<Array<{ title: string; status: string; task_id: number | null }> | null>(null);
  const [intentKey, setIntentKey] = useState(() => `import-${crypto.randomUUID()}`);
  const blocked = command.state.phase === "submitting" || command.state.phase === "failed";
  const valid = rows.length >= 1 && rows.length <= 200 && rows.every((row) => row.title.trim().length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(row.due_date));
  return <section data-h-surface-role="panel" aria-label={L("Import reminders", "درون‌ریزی یادآورها")}>
    <h3>{L("Import reminders (no overwrite)", "درون‌ریزی یادآورها (بدون بازنویسی)")}</h3>
    <p className="h-mod-state-note">{pickText(WORKSPACES.importNoOverwrite, locale)}</p>
    {mayTask ? <details><summary>{L("Import up to 200 rows", "درون‌ریزی تا ۲۰۰ ردیف")}</summary>
      <form onSubmit={(event) => { event.preventDefault(); void command.run(async () => {
        const result = await platform.modules.workspaces.importTasks(workspaceId, rows.map((row) => ({ title: row.title.trim(), category: row.category, due_date: row.due_date })), { intentKey });
        setReceipts(result.receipts.map((receipt) => ({ title: receipt.title, status: receipt.status, task_id: receipt.task_id })));
        // A completed import mints a fresh intent so the next import is a NEW intent.
        setIntentKey(`import-${crypto.randomUUID()}`);
        setRows([{ title: "", category: "other", due_date: "" }]);
        refresh(); return result;
      }, { successMessage: L("Import finished — every row reports its honest outcome below.", "درون‌ریزی پایان یافت — نتیجه واقعی هر ردیف زیر است.") }); }}>
        {rows.map((row, index) => <fieldset key={index}><legend>{L("Row", "ردیف")} {index + 1}</legend>
          <label>{L("Title", "عنوان")}<input required maxLength={300} dir="auto" value={row.title} disabled={blocked} onChange={(event) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, title: event.target.value } : r))} /></label>
          <label>{L("Category", "دسته")}<select value={row.category} disabled={blocked} onChange={(event) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, category: event.target.value as "document_renewal" | "farrier" | "veterinary_appointment" | "other" } : r))}>{Object.entries(TASK_CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label[locale === "fa" ? 1 : 0]}</option>)}</select></label>
          <label>{L("Due date (Gregorian)", "سررسید (میلادی)")}<input required type="date" value={row.due_date} disabled={blocked} onChange={(event) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, due_date: event.target.value } : r))} /></label>
          {rows.length > 1 ? <button type="button" disabled={blocked} onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}>{L("Remove row", "حذف ردیف")}</button> : null}
        </fieldset>)}
        <div className="table-actions">
          <button type="button" disabled={blocked || rows.length >= 200} onClick={() => setRows((prev) => [...prev, { title: "", category: "other", due_date: "" }])}>{L("Add row", "افزودن ردیف")}</button>
          <button type="submit" disabled={blocked || !valid}>{L("Import", "درون‌ریزی")}</button>
        </div>
      </form>
      <HeritageCommandNotice state={command.state} reload={() => { command.reset(); refresh(); }} />
      {command.state.phase === "accepted" && receipts ? <div role="status" aria-label={L("Import receipts", "رسیدهای درون‌ریزی")}>
        <h4>{L("Per-row receipts", "رسید هر ردیف")}</h4>
        <ul className="h-mod-task-list">{receipts.map((receipt, index) => <li key={index}>
          <strong dir="auto">{receipt.title}</strong>
          <small dir="auto">{
            receipt.status === "imported" ? L("imported", "وارد شد")
            : receipt.status === "already_imported" ? L("already imported by a previous attempt of this import (accepted)", "قبلاً در تلاش قبلی همین درون‌ریزی پذیرفته شده (پذیرفته)")
            : receipt.status === "occurrence_exists" ? L("an existing occurrence was skipped and reported — never overwritten", "مورد موجود گزارش و رد شد — هرگز بازنویسی نشد")
            : L("the write refused this row", "نوشتن این ردیف را رد کرد")
          }{receipt.task_id != null ? ` · #${receipt.task_id}` : ""}</small>
        </li>)}</ul>
      </div> : null}
    </details> : <p className="h-mod-state-note">{L("You need the tasks_manage action to import reminders.", "برای درون‌ریزی یادآورها نیازمند اقدام مدیریت یادآورها هستید.")}</p>}
  </section>;
}
