import { useState } from 'react';
import { retroText } from '../i18n/messages';
import { Database, Wrench } from 'lucide-react';
import { useDomainResource, usePlatformCommand, usePrincipalScope, useScopedState, redactionFulfillmentLabel, runRedactionDecision, runRedactionFulfillment, useAdminRedactionQueue, type AdminHorseRecord, type AdminRedactionQueueRow } from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';
import { Button, EmptyState, Field } from '../components/ui';
import { DeskCommandNotice, DeskResourceNotice } from '../components/DeskFeedback';
import { ReviewRequest } from './ReviewRequest';
import { ProfessionalGrantWorkbench } from '../../../../../frontend-kit';
import { AccountSecurityPanel, AccountSecuritySessionNotice } from '../../../../../frontend-kit';

/** Every private load, input and continuation is bound to this principal. */
export function GovernanceDesk() {
  const { runtime } = useHorseDbAdapter();
  const { language, n, date } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const perms = runtime.permissions;
  const scope = usePrincipalScope(runtime.user, perms);
  const allowed = (permission: (typeof perms)[number]) => perms.includes(permission);
  const [email, setEmail] = useScopedState(scope, '');
  const [password, setPassword] = useScopedState(scope, '');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'error' | ''>('');
  const [horseId, setHorseId] = useScopedState(scope, '');
  const [newName, setNewName] = useScopedState(scope, '');
  const [horse, setHorse] = useScopedState<AdminHorseRecord | null>(scope, null);
  const [requestKind, setRequestKind] = useScopedState<'claim' | 'change'>(scope, 'claim');
  const [requestHorse, setRequestHorse] = useScopedState(scope, '');
  const [requestText, setRequestText] = useScopedState(scope, '');
  const [maintenanceResult, setMaintenanceResult] = useScopedState<{ kind: 'reindex' | 'reconcile'; processed: number; remaining: number; problems: number } | null>(scope, null);
  const [recoveryRequested, setRecoveryRequested] = useScopedState(scope, false);
  const command = usePlatformCommand(scope);
  const pending = command.state.phase === 'submitting';
  const uncertain = command.state.phase === 'failed';
  const busy = pending || uncertain;
  const dashboard = useDomainResource('retro-dashboard', scope, signal => runtime.platform.admin.dashboard({ signal }), { enabled: allowed('audit.read') });
  const audit = useDomainResource('retro-audit', scope, signal => runtime.platform.admin.audit({ signal }), { enabled: allowed('audit.read') });
  const quality = useDomainResource('retro-quality', `${scope}:${severity}`, signal => runtime.platform.admin.quality(severity ? { severity } : {}, { signal }), { enabled: allowed('quality.read') });
  const claims = useDomainResource('retro-review-claims', scope, signal => runtime.platform.admin.claims({ signal }), { enabled: allowed('claim.review') });
  const changes = useDomainResource('retro-review-changes', scope, signal => runtime.platform.admin.changeRequests({ signal }), { enabled: allowed('change.review') });
  const mineClaims = useDomainResource('retro-my-claims', scope, signal => runtime.platform.claims.mine({ signal }), { enabled: allowed('claim.read_own') });
  const mineChanges = useDomainResource('retro-my-changes', scope, signal => runtime.platform.changes.mine({ signal }), { enabled: allowed('change.read_own') });
  const resources = [dashboard, audit, quality, claims, changes, mineClaims, mineChanges];
  const refresh = () => { setRecoveryRequested(true); resources.forEach(resource => resource.retry()); };
  const recoveryReady = recoveryRequested && resources.every(resource => ['ready', 'empty', 'idle'].includes(resource.state.phase));
  const rows = <T,>(resource: { state: import('../../../../../frontend-kit').ResourceState<T> }): T | null => resource.state.phase === 'ready' || resource.state.phase === 'reloading' ? resource.state.data : null;
  const run = async (execute: () => Promise<unknown>, message: string, after?: () => void) => {
    if (busy) return;
    setRecoveryRequested(false);
    if (await command.run(execute, { successMessage: message })) { after?.(); resources.forEach(resource => resource.retry()); }
  };
  const status = (value: string) => ({ pending: L('Pending', 'در انتظار بررسی'), approved: L('Approved', 'تأییدشده'), rejected: L('Rejected', 'ردشده'), cancelled: L('Cancelled', 'لغوشده'), applied: L('Applied', 'اعمال‌شده') } as Record<string, string>)[value] || value;
  const validHorseId = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const myRows = [...(rows(mineClaims)?.claims ?? []).map(item => ({ ...item, kind: L('Ownership claim', 'درخواست مالکیت') })), ...(rows(mineChanges)?.requests ?? []).map(item => ({ ...item, kind: L('Correction request', 'درخواست اصلاح') }))];
  const reviewRows = [...(rows(claims)?.claims ?? []).map(item => ({ ...item, kind: 'claim' as const })), ...(rows(changes)?.requests ?? []).map(item => ({ ...item, kind: 'change' as const }))];
  const totals = rows(dashboard);
  return <div className="desk-admin" aria-busy={pending}>
    <AccountSecuritySessionNotice platform={runtime.platform} locale={language}/>
    <DeskCommandNotice state={command.state} reload={refresh} />
    {uncertain && recoveryReady && <div className="desk-notice"><p>{L('The latest records are loaded. Check the affected request before allowing another attempt.', 'آخرین سوابق بارگذاری شد. پیش از اجازه تلاش دوباره، درخواست مربوط را بررسی کنید.')}</p><Button small onClick={() => { if (!recoveryReady) return; command.reset(); setRecoveryRequested(false); }}>{L('I have checked the latest records', 'آخرین سوابق را بررسی کردم')}</Button></div>}
    <section className="collection-sheet collection-sheet--rust">
      <div className="collection-sheet-heading"><div><span className="eyebrow">{L('ACCOUNT', 'حساب کاربری')}</span><h2 dir="auto">{runtime.user?.display_name || L('Public access', 'دسترسی عمومی')}</h2><p>{L('Sign in to manage your requests and the records available to your account.', 'برای مدیریت درخواست‌ها و سوابقی که به آن‌ها دسترسی دارید، وارد شوید.')}</p></div></div>
      {runtime.platformMeta?.featureCatalog.authentication.available ? runtime.user
        ? <Button small disabled={busy} onClick={() => run(() => runtime.platform.auth.logout(), L('Signed out.', 'از حساب خارج شدید.'))}>{L('Sign out', 'خروج')}</Button>
        : <form className="collection-toolbar" onSubmit={event => { event.preventDefault(); void run(() => runtime.platform.auth.login({ email, password }), L('Signed in.', 'وارد حساب شدید.'), () => setPassword('')); }}>
          <Field label={L('Email', 'ایمیل')}><input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} dir="ltr" /></Field>
          <Field label={L('Password', 'گذرواژه')}><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} /></Field>
          <Button type="submit" small disabled={busy}>{pending ? L('Signing in…', 'در حال ورود…') : L('Sign in', 'ورود')}</Button>
        </form> : <p className="desk-notice">{L('Sign-in is unavailable right now.', 'در حال حاضر امکان ورود وجود ندارد.')}</p>}
    </section>
    {runtime.user && <AccountSecurityPanel platform={runtime.platform} locale={language} scope={scope} />}
    {runtime.user && <ProfessionalGrantWorkbench platform={runtime.platform} locale={language} scope={scope} canRead={allowed('audit.read')} canManage={allowed('maintenance.run')} />}
    {(allowed('claim.create') || allowed('change.create') || allowed('claim.read_own') || allowed('change.read_own')) && <section className="collection-sheet collection-sheet--blue">
      <div className="collection-sheet-heading"><h2>{L('My requests', 'درخواست‌های من')}</h2></div>
      {(allowed('claim.create') || allowed('change.create')) && <form className="workspace-form desk-request-form" onSubmit={event => {
        event.preventDefault(); const isClaim = requestKind === 'claim' && allowed('claim.create');
        void run(() => isClaim ? runtime.platform.claims.create(Number(requestHorse), { note: requestText.trim() }) : runtime.platform.changes.create({ horse_id: Number(requestHorse), request_type: 'update_horse', summary: requestText.trim() }), L('Request submitted for review.', 'درخواست برای بررسی ثبت شد.'), () => { setRequestText(''); setRequestHorse(''); });
      }}>
        <Field label={L('Request type', 'نوع درخواست')}><select value={allowed('claim.create') ? requestKind : 'change'} onChange={event => setRequestKind(event.target.value as 'claim' | 'change')} disabled={busy}>
          {allowed('claim.create') && <option value="claim">{L('Ownership claim', 'درخواست مالکیت')}</option>}{allowed('change.create') && <option value="change">{L('Record correction', 'اصلاح اطلاعات')}</option>}
        </select></Field>
        <Field label={L('Horse ID', 'شناسه اسب')}><input inputMode="numeric" pattern="[0-9]+" required value={requestHorse} onChange={event => setRequestHorse(event.target.value)} disabled={pending} /></Field>
        <Field label={L('Explanation or supporting evidence', 'توضیحات یا مدرک پشتیبان')}><textarea required minLength={requestKind === 'change' ? 3 : 1} maxLength={2000} value={requestText} onChange={event => setRequestText(event.target.value)} disabled={pending} dir="auto" /></Field>
        <Button type="submit" disabled={busy || !validHorseId(requestHorse) || !requestText.trim()}>{L('Submit request', 'ثبت درخواست')}</Button>
      </form>}
      <DeskResourceNotice state={mineClaims.state} retry={mineClaims.retry} /><DeskResourceNotice state={mineChanges.state} retry={mineChanges.retry} />
      {myRows.length > 0 ? <div className="table-scroll" tabIndex={0} aria-label={L('My requests', 'درخواست‌های من')}><table className="horse-table"><thead><tr><th>{L('Request', 'درخواست')}</th><th>{L('Horse', 'اسب')}</th><th>{L('Status', 'وضعیت')}</th></tr></thead><tbody>{myRows.map(item => <tr key={`${item.kind}:${item.id}`}><td>{item.kind}</td><td><bdi>#{item.horse_id ?? '—'}</bdi></td><td>{status(item.status)}</td></tr>)}</tbody></table></div> : mineClaims.state.phase === 'ready' || mineChanges.state.phase === 'ready' ? <EmptyState title={L('No requests yet', 'هنوز درخواستی ثبت نشده است')} description={L('Your submitted requests and their status appear here.', 'درخواست‌های ثبت‌شده و وضعیت آن‌ها در این بخش نمایش داده می‌شود.')} /> : null}
    </section>}
    {totals && <div className="profile-totals">{[[totals.horses, L('Horses', 'اسب‌ها')], [totals.people, L('People', 'افراد')], [totals.openIssues, L('Open issues', 'موارد نیازمند بررسی')], [totals.pendingMutations ?? 0, L('Pending changes', 'تغییرات در انتظار ثبت')]].map(([count, label]) => <div key={String(label)}><strong>{n(Number(count))}</strong><span>{label}</span></div>)}</div>}
    {allowed('quality.read') && <section className="collection-sheet collection-sheet--gold">
      <div className="collection-sheet-heading"><h2>{L('Data quality review', 'بررسی کیفیت اطلاعات')}</h2></div>
      <div className="collection-toolbar"><Field label={L('Severity', 'اهمیت')}><select value={severity} onChange={event => setSeverity(event.target.value as typeof severity)}><option value="">{L('All', 'همه')}</option><option value="info">{L('Information', 'اطلاع')}</option><option value="warning">{L('Warning', 'هشدار')}</option><option value="error">{L('Error', 'خطا')}</option></select></Field></div>
      <DeskResourceNotice state={quality.state} retry={quality.retry} />
      {rows(quality) && <div className="table-scroll" tabIndex={0} aria-label={L('Data quality issues', 'موارد بررسی کیفیت')}><table className="horse-table"><thead><tr><th>{L('Severity', 'اهمیت')}</th><th>{L('Horse', 'اسب')}</th><th>{L('Details', 'توضیحات')}</th></tr></thead><tbody>{rows(quality)!.issues.map(item => <tr key={item.id}><td>{item.severity === 'error' ? L('Error', 'خطا') : item.severity === 'warning' ? L('Warning', 'هشدار') : L('Information', 'اطلاع')}</td><td>{item.horse_id ? <a href={`#/horses/${item.horse_id}`} dir="auto">{item.name_latin || `#${item.horse_id}`}</a> : '—'}</td><td dir="auto">{item.message}</td></tr>)}</tbody></table></div>}
    </section>}
    {(allowed('claim.review') || allowed('change.review')) && <section className="collection-sheet collection-sheet--green">
      <div className="collection-sheet-heading"><h2>{L('Requests awaiting review', 'درخواست‌های در انتظار بررسی')}</h2></div>
      <DeskResourceNotice state={claims.state} retry={claims.retry} /><DeskResourceNotice state={changes.state} retry={changes.retry} />
      {reviewRows.length > 0 && <div className="retro-review-list">{reviewRows.map(item => <ReviewRequest key={`${item.kind}:${item.id}`} item={item} scope={scope} busy={busy} stale={(item.kind === 'claim' ? claims : changes).state.phase !== 'ready'} run={run} />)}</div>}
    </section>}
    {/* R117-18: the privacy redaction operator queue — gated on the
    * admin-tier maintenance.run permission (held only by admin and
    * super_admin); the server stays the authority and a 403 renders the
    * honest forbidden state if permissions ever diverge from the role. */}
    {allowed('maintenance.run') && <RetroPrivacyRedactionDesk />}
    {(allowed('horse.edit') || allowed('horse.create') || allowed('horse.archive')) && <section className="collection-sheet collection-sheet--blue">
      <div className="collection-sheet-heading"><h2>{L('Manage a horse record', 'مدیریت اطلاعات اسب')}</h2></div>
      <div className="collection-toolbar"><Field label={L('Horse ID', 'شناسه اسب')}><input inputMode="numeric" value={horseId} onChange={event => setHorseId(event.target.value)} disabled={pending} /></Field>
        {allowed('horse.edit') && <Button small disabled={busy || !validHorseId(horseId)} onClick={() => run(async () => { const result = await runtime.platform.admin.horses.get(Number(horseId)); setHorse(result.horse); setNewName(result.horse.name_latin); }, L('Record loaded.', 'اطلاعات اسب بارگذاری شد.'))}>{L('Load record', 'بارگذاری اطلاعات')}</Button>}
      </div>
      <div className="workspace-form"><Field label={L('Latin name', 'نام لاتین')}><input value={newName} maxLength={240} onChange={event => setNewName(event.target.value)} disabled={pending} dir="ltr" /></Field>
        <div className="form-footer desk-actions">{allowed('horse.create') && <Button disabled={busy || !newName.trim()} onClick={() => run(async () => { const result = await runtime.platform.admin.horses.create({ name_latin: newName.trim() }); setHorse(result.horse); setHorseId(String(result.horse.id)); }, L('Horse record created.', 'اطلاعات اسب ثبت شد.'))}>{L('Create record', 'ایجاد رکورد')}</Button>}
          {horse && allowed('horse.edit') && <Button disabled={busy || !newName.trim()} onClick={() => run(async () => { const result = await runtime.platform.admin.horses.update(horse.id, horse.row_version, { name_latin: newName.trim() }); setHorse(result.horse); }, L('Changes saved.', 'تغییرات ذخیره شد.'))}>{L('Save changes', 'ذخیره تغییرات')}</Button>}
          {horse && allowed('horse.archive') && <Button variant="danger" disabled={busy} onClick={() => { if (confirm(L(`Archive horse #${horse.id}?`, `اسب شماره ${n(horse.id)} بایگانی شود؟`))) void run(() => runtime.platform.admin.horses.archive(horse.id), L('Horse record archived.', 'اطلاعات اسب بایگانی شد.'), () => setHorse(null)); }}>{L('Archive record', 'بایگانی اطلاعات')}</Button>}
        </div>
      </div>
    </section>}
    {allowed('maintenance.run') && <section className="collection-sheet collection-sheet--rust"><div className="collection-sheet-heading"><h2>{L('System maintenance', 'نگهداری سامانه')}</h2></div><div className="collection-toolbar">
      <Button small disabled={busy} onClick={() => { if (confirm(L('Rebuild the search index now?', 'فهرست جست‌وجو بازسازی شود؟'))) void run(async () => { setMaintenanceResult(null); const result = await runtime.platform.admin.maintenance.reindex(); setMaintenanceResult({ kind: 'reindex', processed: result.processed, remaining: result.remaining, problems: result.failed }); }, L('Search queue batch processed. See the counts below.', 'یک دسته از صف جست‌وجو پردازش شد. شمارش‌ها در زیر نمایش داده می‌شوند.')); }}><Wrench size={14} />{L('Rebuild search', 'بازسازی جست‌وجو')}</Button>
      <Button small disabled={busy} onClick={() => { if (confirm(L('Review pending record updates now?', 'تغییرات ثبت‌نشده بررسی شوند؟'))) void run(async () => { setMaintenanceResult(null); const result = await runtime.platform.admin.maintenance.reconcileMutations(); setMaintenanceResult({ kind: 'reconcile', processed: result.processed, remaining: result.remaining, problems: result.quarantined }); }, L('Update queue batch reviewed. See the counts below.', 'یک دسته از صف تغییرات بررسی شد. شمارش‌ها در زیر نمایش داده می‌شوند.')); }}><Database size={14} />{L('Review pending updates', 'بررسی تغییرات ثبت‌نشده')}</Button>
    </div>{maintenanceResult && <div className="desk-notice" role="status"><p>{maintenanceResult.kind === 'reindex' ? L('Search index batch', 'دسته نمایه جست‌وجو') : L('Pending update batch', 'دسته تغییرات ثبت‌نشده')}</p><dl className="maintenance-counts"><div><dt>{L('Processed', 'پردازش‌شده')}</dt><dd>{n(maintenanceResult.processed)}</dd></div><div><dt>{L('Remaining', 'باقی‌مانده')}</dt><dd>{n(maintenanceResult.remaining)}</dd></div><div><dt>{maintenanceResult.kind === 'reindex' ? L('Failed', 'ناموفق') : L('Quarantined', 'قرنطینه‌شده')}</dt><dd>{n(maintenanceResult.problems)}</dd></div></dl></div>}</section>}
    {allowed('audit.read') && <section className="collection-sheet collection-sheet--green"><div className="collection-sheet-heading"><h2>{L('Recent activity', 'فعالیت‌های اخیر')}</h2><Button small onClick={refresh} disabled={pending}>{L('Refresh', 'به‌روزرسانی')}</Button></div><DeskResourceNotice state={audit.state} retry={audit.retry} />{rows(audit) && <div className="table-scroll" tabIndex={0} aria-label={L('Recent activity', 'فعالیت‌های اخیر')}><table className="horse-table"><thead><tr><th>{L('Action', 'اقدام')}</th><th>{L('Record', 'رکورد')}</th><th>{L('Account', 'حساب')}</th><th>{L('Date', 'تاریخ')}</th></tr></thead><tbody>{rows(audit)!.events.slice(0, 50).map(item => <tr key={item.id}><td dir="auto">{item.action}</td><td dir="auto">{item.entity_type} <bdi>#{item.entity_id}</bdi></td><td dir="auto">{item.actor ?? '—'}</td><td>{date(item.created_at)}</td></tr>)}</tbody></table></div>}</section>}
  </div>;
}

/** R117-18 — Retro Astra's native privacy-redaction operator desk over the
 * retained R114 executor. The decision (grant/refuse) and the audited
 * execution are SEPARATE actions; the per-row indicator is driven by the
 * execution receipt, never by the grant. Honest refusals (hold-blocked
 * grant, unresolved scope, already-completed repeat) surface their server
 * codes; after every command the queue reloads so the desk matches the
 * server state after refresh. */
export function RetroPrivacyRedactionDesk() {
  const { runtime } = useHorseDbAdapter();
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const { queue, retry } = useAdminRedactionQueue({ platform: runtime.platform, scope });
  const [note, setNote] = useState('');
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [outcome, setOutcome] = useState('');
  const decide = async (row: AdminRedactionQueueRow, decision: 'grant' | 'refuse') => {
    if (note.trim().length < 10) { setOutcome(L('A substantive decision note (at least 10 characters) is required.', 'یادداشت تصمیم معتبر (حداقل ۱۰ نویسه) الزامی است.')); return; }
    setBusyRow(row.id); setOutcome('');
    const result = await runRedactionDecision(runtime.platform, row.id, { decision, decision_note: note.trim() });
    setOutcome(result.phase === 'done' ? result.response.note : `${L('Refused', 'رد شد')} — ${result.code}: ${result.reason}`);
    if (result.phase === 'done') setNote('');
    retry(); setBusyRow(null);
  };
  const fulfill = async (row: AdminRedactionQueueRow) => {
    setBusyRow(row.id); setOutcome('');
    const result = await runRedactionFulfillment(runtime.platform, row.id, note.trim().length >= 10 ? note.trim() : null);
    setOutcome(result.phase === 'done' ? result.response.note : `${L('Refused', 'رد شد')} — ${result.code}: ${result.reason}`);
    if (result.phase === 'done') setNote('');
    retry(); setBusyRow(null);
  };
  const categoryLabel = (row: AdminRedactionQueueRow) => row.data_category === 'service_request_notes' ? L('Service-request notes', 'یادداشت‌های درخواست خدمت') : L('Service-request contact & location', 'تماس و موقعیت درخواست خدمت');
  const rows = queue.phase === 'ready' || queue.phase === 'reloading' ? queue.rows : [];
  const counts = queue.phase === 'ready' || queue.phase === 'reloading' ? queue.counts : null;
  return <section className="collection-sheet collection-sheet--rust" data-surface="privacy-redaction-desk">
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('PRIVACY OPERATIONS', 'عملیات حریم خصوصی')}</span><h2>{L('Subject redaction queue', 'صف حذف داده اشخاص')}</h2><p>{L("The operator decision and the audited execution are separate steps. Only the executor's receipt reports completion.", 'تصمیم اپراتور و اجرای ممیزی‌شده دو گام جدا هستند. فقط رسید مجری، انجام را گزارش می‌کند.')}</p></div>{counts != null && <span className="eyebrow">{L(`${counts.received + counts.deferred_active_hold} open · ${counts.executed} executed`, `${n(counts.received + counts.deferred_active_hold)} باز · ${n(counts.executed)} اجراشده`)}</span>}</div>
    {queue.phase === 'loading' || queue.phase === 'idle' ? <p className="desk-notice">{L('Loading the redaction queue…', 'در حال بارگذاری صف حذف…')}</p>
      : queue.phase === 'forbidden' ? <p className="desk-notice">{L('This account cannot read the privacy operator queue.', 'این حساب اجازه خواندن صف حریم خصوصی را ندارد.')}</p>
      : queue.phase === 'unavailable' || queue.phase === 'error' ? <div className="desk-notice"><p>{queue.reason}</p><Button small onClick={retry}>{L('Retry', 'تلاش دوباره')}</Button></div>
      : queue.phase === 'empty' ? <EmptyState title={L('No redaction requests', 'درخواست حذفی وجود ندارد')} description={L('Filed subject requests will appear here with their decision and execution states.', 'درخواست‌های ثبت‌شده با وضعیت تصمیم و اجرا در این بخش نمایش داده می‌شوند.')} />
      : <div className="retro-review-list" data-surface="privacy-redaction-rows">{rows.map(row => {
        const indicator = redactionFulfillmentLabel(row);
        const decidable = row.status === 'received' || row.status === 'deferred_active_hold';
        const fulfillable = row.status === 'granted' && row.execution_status !== 'completed';
        return <article key={row.id} data-request-id={row.id} className={`desk-request privacy-redaction-row tone-${indicator.tone}`}>
          <header><b dir="auto">#{n(row.id)} · {row.subject_name ?? row.subject_user_id}</b><small>{categoryLabel(row)}{row.service_request_id != null ? ` · ${L('service request', 'درخواست خدمت')} #${n(row.service_request_id)}` : ` · ${L('untargeted', 'بدون هدف مشخص')}`}{row.request_under_active_hold ? ` · ${L('active hold', 'توقیف فعال')} ` : ''}</small></header>
          <p dir="auto">“{row.request_note}”</p>
          <div className="retro-privacy-states">
            <span className={`status-chip status-${row.status}`}>{row.status.replaceAll('_', ' ')}</span>
            <span className={`privacy-fulfillment fulfillment-${indicator.tone}`} data-surface="privacy-fulfillment-indicator">{language === 'fa' ? indicator.fa : indicator.en}</span>
            {row.execution_status === 'completed' && <details data-surface="privacy-execution-receipt"><summary>{L('Execution receipt', 'رسید اجرا')}</summary><pre dir="ltr">{row.execution_receipt_json ?? '—'}</pre></details>}
          </div>
          {(decidable || fulfillable) && <div className="collection-toolbar privacy-redaction-actions">
            <Field label={L('Operator note', 'یادداشت اپراتور')}><input dir="auto" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} disabled={busyRow != null} placeholder={L('Required for decisions, optional for execution', 'برای تصمیم الزامی، برای اجرا اختیاری')} /></Field>
            {decidable && <span className="form-footer desk-actions"><Button small disabled={busyRow != null} onClick={() => void decide(row, 'grant')}>{L('Grant decision', 'تصمیم به تأیید')}</Button><Button small variant="danger" disabled={busyRow != null} onClick={() => void decide(row, 'refuse')}>{L('Refuse', 'رد')}</Button></span>}
            {fulfillable && <Button small disabled={busyRow != null} onClick={() => void fulfill(row)}>{L('Execute redaction', 'اجرای حذف')}</Button>}
          </div>}
        </article>; })}</div>}
    {outcome && <div className="desk-notice" role="status" dir="auto" data-surface="privacy-command-outcome"><p>{outcome}</p></div>}
  </section>;
}
