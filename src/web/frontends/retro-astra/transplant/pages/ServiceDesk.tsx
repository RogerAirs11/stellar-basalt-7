import { useEffect } from 'react';
import { retroText } from '../i18n/messages';
import { serviceTransitionsFor, serviceRequestStatusLabel, usePrincipalScope, useScopedState, useServiceRequestWorkbench, serviceCategoryLabel, type ServiceRequestRecord } from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';
import { Button, LinkButton, PageHeading } from '../components/ui';
import { DeskCommandNotice, DeskResourceNotice } from '../components/DeskFeedback';
import { positiveEditorTarget } from '../../EditorControls';
import { ServiceSafetyControls } from './ServiceSafetyControls';
import './ServiceDesk.css';

/** The shared workbench owns versions, actor transitions and per-request recovery. */
export function ServiceDesk({ requestId }: { requestId?: string }) {
  const { runtime } = useHorseDbAdapter();
  const { language, n, date } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const { store, snapshot } = useServiceRequestWorkbench(runtime.platform, scope, !!runtime.user);
  const id = requestId ? positiveEditorTarget(requestId) : null;
  useEffect(() => { store.select(id); }, [store, id]);
  const [confirm, setConfirm] = useScopedState<{ id: number; action: 'consent' | 'redact' } | null>(scope, null);
  // Keep report drafts while recovery deliberately removes private detail DOM.
  const [reportDrafts, setReportDrafts] = useScopedState<Record<number, string>>(scope, {});
  const rows = snapshot.list.phase === 'ready' || snapshot.list.phase === 'reloading' ? snapshot.list.data : [];
  const detail = snapshot.detail.phase === 'ready' ? snapshot.detail.data : null;
  const recovery = Object.entries(snapshot.commands).filter(([, command]) => command.state.phase === 'failed' || command.state.phase === 'rejected' && command.state.status === 409);
  const setView = (view: 'mine' | 'inbox') => { store.setView(view); window.location.hash = '#/services'; setConfirm(null); };
  const privacyAction = async (request: ServiceRequestRecord, action: 'consent' | 'redact') => {
    const accepted = action === 'consent' ? await store.withdrawConsent(request.id) : await store.redactNote(request.id);
    if (accepted) setConfirm(null);
  };
  return <div className="retro-service-desk">
    <PageHeading eyebrow={L('PRIVATE INQUIRIES', 'درخواست‌های خصوصی')} title={L('Service requests', 'درخواست‌های خدمت')} description={L('Follow inquiries you sent and requests for professionals you currently manage. A request is not an appointment or a guarantee of delivery.', 'درخواست‌های ارسالی و درخواست‌های متخصصانی را که اکنون مدیریت می‌کنید پیگیری کنید. درخواست به معنی نوبت قطعی یا تضمین تحویل پیام نیست.')} actions={<LinkButton href="#/directory">{L('Find a professional', 'یافتن متخصص')}</LinkButton>} />
    {!runtime.user ? <section className="collection-sheet"><p className="desk-notice">{L('Sign in to view your private service requests.', 'برای مشاهده درخواست‌های خصوصی خود وارد شوید.')}</p><LinkButton href="#/collections/governance">{L('Sign in', 'ورود')}</LinkButton></section> : <>
      <div className="retro-service-toolbar" role="group" aria-label={L('Request inbox', 'صندوق درخواست‌ها')}><Button aria-pressed={snapshot.view === 'mine'} onClick={() => setView('mine')}>{L('My requests', 'درخواست‌های من')}</Button><Button aria-pressed={snapshot.view === 'inbox'} onClick={() => setView('inbox')}>{L('Provider inbox', 'صندوق ارائه‌دهنده')}</Button><Button onClick={() => { void store.reload(); }} disabled={snapshot.list.phase === 'loading' || snapshot.list.phase === 'reloading'}>{L('Refresh', 'به‌روزرسانی')}</Button></div>
      {recovery.map(([key, command]) => <section key={key} className="collection-sheet retro-service-recovery" aria-label={L('Request recovery', 'بازیابی درخواست')}><h2>{L('Check request', 'بررسی درخواست')} <bdi>#{n(Number(key))}</bdi></h2><DeskCommandNotice state={command.state} /><p>{L('Actions remain locked until the current request is read successfully and you inspect its state.', 'تا خواندن موفق درخواست فعلی و بررسی وضعیت آن، اقدامات قفل می‌مانند.')}</p>{command.recovery === 'failed' && <p role="alert">{L('The latest request could not be read. The lock remains in place.', 'آخرین درخواست خوانده نشد. قفل همچنان برقرار است.')} <span dir="auto">{command.recoveryReason}</span></p>}<div className="retro-editor-actions"><Button disabled={command.recovery === 'reading'} onClick={() => { void store.reconcile(Number(key)); }}>{command.recovery === 'reading' ? L('Reading…', 'در حال خواندن…') : L('Read current request', 'خواندن درخواست فعلی')}</Button>{command.recovery === 'ready' && <Button onClick={() => { store.acknowledge(Number(key)); }}>{L('I have checked the current request', 'درخواست فعلی را بررسی کردم')}</Button>}<LinkButton href={`#/services/${key}`}>{L('Open request', 'باز کردن درخواست')}</LinkButton></div></section>)}
      {requestId && id === null && <p role="alert" className="desk-notice desk-notice--error">{L('Invalid request ID. Select a request from your list.', 'شناسه درخواست نامعتبر است. از فهرست خود یک درخواست انتخاب کنید.')}</p>}
      {id !== null && <section className="collection-sheet retro-service-detail"><div className="collection-sheet-heading"><h2>{L('Request details', 'جزئیات درخواست')} <bdi>#{n(id)}</bdi></h2><a href="#/services">{L('Back to requests', 'بازگشت به درخواست‌ها')}</a></div><DeskResourceNotice state={snapshot.detail} retry={() => store.select(id)} />
        {detail && <div className="retro-service-detail-body"><div className="retro-service-card-heading"><h3>{serviceCategoryLabel(detail.category, language)}</h3><span className="retro-service-status">{serviceRequestStatusLabel(detail.status, language)}</span></div>
          <dl className="retro-service-facts"><div><dt>{L('Provider', 'ارائه‌دهنده')}</dt><dd><a href={`#/directory/${detail.provider_person_id}`}><bdi>#{n(detail.provider_person_id)}</bdi></a></dd></div><div><dt>{L('Request view', 'نوع درخواست')}</dt><dd>{detail.is_requester_view ? L('Sent by you', 'ارسال‌شده توسط شما') : L('Received by your professional', 'دریافت‌شده برای متخصص شما')}</dd></div>{detail.city && <div><dt>{L('City', 'شهر')}</dt><dd dir="auto">{detail.city}</dd></div>}<div><dt>{L('Updated', 'آخرین تغییر')}</dt><dd><time dateTime={detail.updated_at}>{date(detail.updated_at)}</time></dd></div></dl>
          <div className="retro-service-private"><h3>{L('Private request note', 'یادداشت خصوصی درخواست')}</h3><p dir="auto">{detail.note ?? L('This note is not available in the current view.', 'این یادداشت در نمای فعلی در دسترس نیست.')}</p></div>
          <div className="retro-service-private"><h3>{L('Contact sharing', 'اشتراک اطلاعات تماس')}</h3>{detail.contact ? <p><span dir="auto">{detail.contact.display_name}</span> · <bdi>{detail.contact.email}</bdi></p> : <p>{L('Contact information is not shared in this view.', 'اطلاعات تماس در این نما به اشتراک گذاشته نشده است.')}</p>}</div>
          <p className="retro-service-note">{L('This is a service lead. Status changes do not confirm an appointment, provider acceptance, or notification delivery.', 'این یک درخواست اولیه خدمت است. تغییر وضعیت به معنی نوبت قطعی، پذیرش ارائه‌دهنده یا تحویل اعلان نیست.')}</p>
          <div className="retro-editor-actions">{serviceTransitionsFor(detail.status, detail.is_requester_view ? 'requester' : 'provider').map(status => <Button key={status} disabled={!store.canAct(detail.id)} onClick={() => { void store.transition(detail.id, status); }}>{serviceRequestStatusLabel(status, language)}</Button>)}</div>
          <DeskCommandNotice state={store.commandFor(detail.id).state} />
          <ServiceSafetyControls request={detail} store={store} scope={scope} reason={reportDrafts[detail.id] ?? ''} setReason={reason => setReportDrafts(previous => ({ ...previous, [detail.id]: reason }))} />
          {detail.is_requester_view && <details className="retro-service-privacy"><summary>{L('Privacy controls', 'کنترل‌های حریم خصوصی')}</summary><p>{L('Contact withdrawal and note redaction are one-way for this request. Messages already delivered cannot be recalled.', 'لغو اشتراک تماس و حذف یادداشت برای این درخواست برگشت‌ناپذیر است. پیام‌های تحویل‌شده قابل پس‌گرفتن نیستند.')}</p><div className="retro-editor-actions"><Button disabled={!store.canAct(detail.id)} onClick={() => setConfirm({ id: detail.id, action: 'consent' })}>{L('Withdraw contact sharing', 'لغو اشتراک تماس')}</Button><Button disabled={!store.canAct(detail.id)} onClick={() => setConfirm({ id: detail.id, action: 'redact' })}>{L('Redact private note', 'حذف یادداشت خصوصی')}</Button></div>{confirm?.id === detail.id && <div className="desk-notice" role="group" aria-label={L('Confirm privacy change', 'تأیید تغییر حریم خصوصی')}><p>{confirm.action === 'consent' ? L('Stop sharing your contact information on this request?', 'اشتراک اطلاعات تماس شما در این درخواست متوقف شود؟') : L('Permanently remove the private note from this request?', 'یادداشت خصوصی این درخواست برای همیشه حذف شود؟')}</p><div className="retro-editor-actions"><Button disabled={!store.canAct(detail.id)} onClick={() => { void privacyAction(detail, confirm.action); }}>{L('Confirm change', 'تأیید تغییر')}</Button><Button onClick={() => setConfirm(null)}>{L('Cancel', 'انصراف')}</Button></div></div>}</details>}
        </div>}
      </section>}
      <section className="collection-sheet"><div className="collection-sheet-heading"><h2>{snapshot.view === 'mine' ? L('Requests you sent', 'درخواست‌های ارسالی شما') : L('Requests for your professionals', 'درخواست‌های متخصصان شما')}</h2></div><DeskResourceNotice state={snapshot.list} retry={() => { void store.reload(); }} empty={snapshot.view === 'mine' ? ['No service requests yet', 'هنوز درخواست خدمتی ثبت نشده است'] : ['Your provider inbox is empty', 'صندوق ارائه‌دهنده شما خالی است']} />
        <div className="retro-service-list">{rows.map(request => <article className="retro-service-card" key={request.id}><div className="retro-service-card-heading"><h3>{serviceCategoryLabel(request.category, language)}</h3><span className="retro-service-status">{serviceRequestStatusLabel(request.status, language)}</span></div><p>{L('Request', 'درخواست')} <bdi>#{n(request.id)}</bdi> · {L('Provider', 'ارائه‌دهنده')} <bdi>#{n(request.provider_person_id)}</bdi></p>{request.city && <p dir="auto">{request.city}</p>}<LinkButton href={`#/services/${request.id}`}>{L('View request', 'مشاهده درخواست')}</LinkButton></article>)}</div>
      </section>
    </>}
  </div>;
}
