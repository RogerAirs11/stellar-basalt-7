import { useScopedState, type ServiceRequestRecord, type ServiceRequestWorkbench } from '../../../../../frontend-kit';
import { retroText } from '../i18n/messages';
import { EditorField } from '../../EditorControls';
import { Button } from '../components/ui';
import { usePreferences } from '../preferences/PreferencesProvider';

export function ServiceSafetyControls({ request, store, scope, reason, setReason }: { request: ServiceRequestRecord; store: ServiceRequestWorkbench; scope: string; reason: string; setReason: (reason: string) => void }) {
  const { language } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const identity = `${scope}:service:${request.id}`;
  const [confirmBlock, setConfirmBlock] = useScopedState(identity, false);
  const locked = !store.canAct(request.id);
  return <details className="retro-service-privacy"><summary>{L('Report or block', 'گزارش یا مسدود کردن')}</summary>
    <form className="retro-editor-grid" onSubmit={event => { event.preventDefault(); if (locked || reason.trim().length < 5) return; void store.report(request.id, reason).then(accepted => { if (accepted) setReason(''); }); }}>
      <EditorField label={L('Report reason (5–500 characters)', 'دلیل گزارش (۵ تا ۵۰۰ نویسه)')} wide><textarea value={reason} disabled={locked} required minLength={5} maxLength={500} dir="auto" rows={3} onChange={event => setReason(event.target.value)} /></EditorField>
      <div className="retro-editor-actions retro-editor-wide"><Button type="submit" disabled={locked || reason.trim().length < 5}>{L('Submit report', 'ارسال گزارش')}</Button></div>
    </form>
    <p>{request.is_requester_view ? L('Blocking prevents new inquiries from your account to this professional. Existing requests remain in your history.', 'مسدود کردن، ارسال درخواست تازه از حساب شما به این متخصص را متوقف می‌کند. درخواست‌های قبلی در سابقه شما می‌مانند.') : L('Blocking prevents new inquiries from this requester to the professional you manage. It does not close this request.', 'مسدود کردن، درخواست‌های تازه این درخواست‌کننده به متخصص تحت مدیریت شما را متوقف می‌کند. این درخواست بسته نمی‌شود.')}</p>
    {!confirmBlock ? <Button disabled={locked} onClick={() => setConfirmBlock(true)}>{request.is_requester_view ? L('Block this professional', 'مسدود کردن این متخصص') : L('Block this requester', 'مسدود کردن این درخواست‌کننده')}</Button> : <div className="desk-notice" role="group" aria-label={L('Confirm block', 'تأیید مسدود کردن')}><p>{L('Apply this block? There is no unblock control in this screen.', 'این مسدودسازی اعمال شود؟ در این صفحه کنترل رفع مسدودی وجود ندارد.')}</p><div className="retro-editor-actions"><Button disabled={locked} onClick={() => { const operation = request.is_requester_view ? store.block(request.id) : store.providerBlock(request.id); void operation.then(accepted => { if (accepted) setConfirmBlock(false); }); }}>{L('Confirm block', 'تأیید مسدود کردن')}</Button><Button disabled={locked} onClick={() => setConfirmBlock(false)}>{L('Cancel', 'انصراف')}</Button></div></div>}
  </details>;
}
