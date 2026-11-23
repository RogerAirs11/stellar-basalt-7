import { useEffect } from 'react';
import { retroText } from '../i18n/messages';
import { ShieldCheck } from 'lucide-react';
import { useDomainResource, usePlatformCommand, usePrincipalScope, useScopedState } from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';
import { Button, EmptyState, Field, LinkButton } from '../components/ui';
import { DeskCommandNotice, DeskResourceNotice } from '../components/DeskFeedback';

/** A request draft belongs to this record and this principal, never a previous session. */
export function ProfileGovernance({ horseId }: { horseId: number }) {
  const { runtime } = useHorseDbAdapter();
  const { language, n, date } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const principal = usePrincipalScope(runtime.user, runtime.permissions);
  const scope = `${principal}|horse:${horseId}`;
  const allowed = (permission: (typeof runtime.permissions)[number]) => runtime.permissions.includes(permission);
  const [kind, setKind] = useScopedState<'claim' | 'change'>(scope, allowed('claim.create') ? 'claim' : 'change');
  const [evidence, setEvidence] = useScopedState(scope, '');
  const [refreshRequested, setRefreshRequested] = useScopedState(scope, false);
  const [refreshStarted, setRefreshStarted] = useScopedState(scope, false);
  const command = usePlatformCommand(scope);
  const claims = useDomainResource('retro-profile-claims', scope, signal => runtime.platform.claims.mine({ signal }), { enabled: allowed('claim.read_own') });
  const changes = useDomainResource('retro-profile-changes', scope, signal => runtime.platform.changes.mine({ signal }), { enabled: allowed('change.read_own') });
  const resources = [claims, changes];
  const pending = command.state.phase === 'submitting';
  const uncertain = command.state.phase === 'failed';
  const busy = pending || uncertain;
  const currentKind = allowed('claim.create') ? kind : 'change';
  const validEvidence = evidence.trim().length >= (currentKind === 'change' ? 3 : 1) && evidence.length <= 2000;
  const loaded = resources.every(resource => resource.state.phase === 'ready' || resource.state.phase === 'idle');
  useEffect(() => {
    if (refreshRequested && resources.some(resource => resource.state.phase === 'loading' || resource.state.phase === 'reloading')) setRefreshStarted(true);
  }, [refreshRequested, claims.state.phase, changes.state.phase]);
  const refresh = () => { setRefreshRequested(true); setRefreshStarted(false); resources.forEach(resource => resource.retry()); };
  const myClaims = claims.state.phase === 'ready' || claims.state.phase === 'reloading' ? claims.state.data.claims.filter(item => item.horse_id === horseId) : [];
  const myChanges = changes.state.phase === 'ready' || changes.state.phase === 'reloading' ? changes.state.data.requests.filter(item => item.horse_id === horseId) : [];
  const status = (value: string) => ({ pending: L('Pending review', 'در انتظار بررسی'), approved: L('Approved', 'تأییدشده'), rejected: L('Rejected', 'ردشده'), cancelled: L('Cancelled', 'لغوشده'), applied: L('Applied', 'اعمال‌شده'), draft: L('Draft', 'پیش‌نویس') } as Record<string, string>)[value] ?? value;
  return <section className="horse-notes profile-governance" aria-busy={pending}>
    <div className="notes-intro"><span className="eyebrow">{L('REQUEST A REVIEW', 'درخواست بررسی')}</span><h2>{L('Ownership and record corrections', 'مالکیت و اصلاح اطلاعات')}</h2><p>{L('Describe your connection to this horse or the information that needs correcting. Your request and evidence will be sent for review.', 'ارتباط خود با این اسب یا اطلاعاتی را که به اصلاح نیاز دارد توضیح دهید. درخواست و مدارک شما برای بررسی ارسال می‌شود.')}</p></div>
    {(allowed('claim.create') || allowed('change.create')) ? <form className="workspace-form profile-request-form" onSubmit={event => {
      event.preventDefault();
      if (busy || !validEvidence) return;
      void (async () => {
        const accepted = await command.run(() => currentKind === 'claim'
          ? runtime.platform.claims.create(horseId, { note: evidence.trim() })
          : runtime.platform.changes.create({ horse_id: horseId, request_type: 'update_horse', summary: evidence.trim() }),
        { successMessage: L('Your request was submitted for review.', 'درخواست شما برای بررسی ثبت شد.') });
        if (accepted) { setEvidence(''); resources.forEach(resource => resource.retry()); }
      })();
    }}>
      <Field label={L('Request type', 'نوع درخواست')}><select value={currentKind} onChange={event => setKind(event.target.value as typeof kind)} disabled={pending}>
        {allowed('claim.create') && <option value="claim">{L('Ownership claim', 'درخواست مالکیت')}</option>}{allowed('change.create') && <option value="change">{L('Record correction', 'اصلاح اطلاعات')}</option>}
      </select></Field>
      <Field label={currentKind === 'claim' ? L('Ownership evidence', 'مدرک مالکیت') : L('What needs correcting?', 'چه اطلاعاتی باید اصلاح شود؟')}><textarea value={evidence} onChange={event => setEvidence(event.target.value)} required minLength={currentKind === 'change' ? 3 : 1} maxLength={2000} rows={4} disabled={pending} dir="auto" /></Field>
      <div className="desk-actions"><Button type="submit" disabled={busy || !validEvidence}>{pending ? L('Submitting…', 'در حال ثبت…') : L('Submit for review', 'ثبت برای بررسی')}</Button><span className="muted">{L(`Horse #${n(horseId)}`, `اسب شماره ${n(horseId)}`)}</span></div>
    </form> : <p className="desk-notice">{runtime.user ? L('Your account can view the requests available below. It cannot submit a new request for this record.', 'حساب شما می‌تواند درخواست‌های زیر را مشاهده کند؛ امکان ثبت درخواست جدید برای این رکورد ندارد.') : L('Sign in to submit a request and see its review status.', 'برای ثبت درخواست و مشاهده وضعیت بررسی، وارد حساب خود شوید.')}</p>}
    <DeskCommandNotice state={command.state} reload={refresh} />
    {uncertain && refreshRequested && refreshStarted && loaded && <div className="desk-notice"><p>{L('The latest requests are shown below. If this request already appears, do not submit it again.', 'آخرین درخواست‌ها در زیر نمایش داده می‌شوند. اگر این درخواست ثبت شده است، آن را دوباره ارسال نکنید.')}</p><Button small onClick={() => { command.reset(); setRefreshRequested(false); }}>{L('I have checked the latest requests', 'آخرین درخواست‌ها را بررسی کردم')}</Button></div>}
    <div className="desk-actions profile-request-actions"><LinkButton href="#/collections/governance">{runtime.user ? L('Open account and requests', 'حساب و درخواست‌ها') : L('Sign in', 'ورود به حساب')}</LinkButton>{(allowed('claim.read_own') || allowed('change.read_own')) && <Button small disabled={pending} onClick={refresh}>{L('Refresh requests', 'به‌روزرسانی درخواست‌ها')}</Button>}</div>
    <DeskResourceNotice state={claims.state} retry={claims.retry} /><DeskResourceNotice state={changes.state} retry={changes.retry} />
    <div className="saved-notes">{myClaims.map(item => <article key={`claim:${item.id}`}><div className="saved-note-heading"><span><ShieldCheck size={14}/>{L('Ownership claim', 'درخواست مالکیت')} <bdi>#{item.id}</bdi></span><span>{status(item.status)}</span></div><p>{item.review_note || L('Awaiting a review decision.', 'در انتظار نتیجه بررسی.')}</p><time dateTime={item.created_at}>{date(item.created_at)}</time></article>)}{myChanges.map(item => <article key={`change:${item.id}`}><div className="saved-note-heading"><span><ShieldCheck size={14}/>{L('Record correction', 'اصلاح اطلاعات')} <bdi>#{item.id}</bdi></span><span>{status(item.status)}</span></div><p dir="auto">{item.summary}</p><time dateTime={item.created_at}>{date(item.created_at)}</time></article>)}</div>
    {loaded && (allowed('claim.read_own') || allowed('change.read_own')) && !myClaims.length && !myChanges.length && <EmptyState title={L('No requests for this horse', 'درخواستی برای این اسب ثبت نشده است')} description={L('Requests you submit for this horse will appear here with their review status.', 'درخواست‌هایی که برای این اسب ثبت می‌کنید، همراه با وضعیت بررسی در این بخش نمایش داده می‌شوند.')} />}
  </section>;
}
