import { useScopedState, type AdminClaimRecord, type ChangeRequestRecord } from '../../../../../frontend-kit';
import { retroText } from '../i18n/messages';
import { EditorField } from '../../EditorControls';
import { Button } from '../components/ui';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import { usePreferences } from '../preferences/PreferencesProvider';

type ReviewRow = (AdminClaimRecord & { kind: 'claim' }) | (ChangeRequestRecord & { kind: 'change' });
function readable(value: unknown): string {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function ReviewRequest({ item, scope, busy, stale, run }: { item: ReviewRow; scope: string; busy: boolean; stale: boolean; run: (execute: () => Promise<unknown>, message: string, after?: () => void) => Promise<void> }) {
  const { runtime } = useHorseDbAdapter();
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  const identity = `${scope}|review:${item.kind}:${item.id}`;
  const [reason, setReason] = useScopedState(identity, '');
  const [decision, setDecision] = useScopedState<'' | 'approved' | 'rejected'>(identity, '');
  // Older protected API responses did not include ownership evidence. Never invent it.
  const projection = item as ReviewRow & { evidence?: unknown; person_id?: number | null };
  const evidence = projection.evidence && typeof projection.evidence === 'object' && !Array.isArray(projection.evidence) ? Object.entries(projection.evidence) : [];
  const locked = busy || stale || item.status !== 'pending';
  const status = ({ pending: L('Pending review', 'در انتظار بررسی'), approved: L('Approved', 'تأییدشده'), rejected: L('Rejected', 'ردشده'), withdrawn: L('Withdrawn', 'بازپس‌گیری‌شده'), draft: L('Draft', 'پیش‌نویس') } as Record<string, string>)[item.status] ?? item.status;
  return <details className="retro-review-request">
    <summary><span><strong>{item.kind === 'claim' ? L('Ownership claim', 'درخواست مالکیت') : L('Record correction', 'اصلاح اطلاعات')}</strong> <bdi>#{item.id}</bdi></span><span>{L('Horse', 'اسب')} <bdi>#{item.horse_id == null ? '—' : n(item.horse_id)}</bdi> · {status}</span></summary>
    <div className="retro-review-body">
      <dl className="retro-review-evidence"><div><dt>{L('Submitted by', 'ارسال‌کننده')}</dt><dd dir="auto">{item.kind === 'claim' ? item.claimant || '—' : item.submitted_by || '—'}</dd></div>{projection.person_id != null && <div><dt>{L('Represented person', 'شخص مورد نمایندگی')}</dt><dd><bdi>#{n(projection.person_id)}</bdi></dd></div>}{item.kind === 'change' && <div><dt>{L('Requested correction', 'اصلاح درخواستی')}</dt><dd dir="auto">{item.summary || '—'}</dd></div>}</dl>
      <h3>{L('Submitted evidence', 'مدارک ارسال‌شده')}</h3>
      {evidence.length ? <dl className="retro-review-evidence">{evidence.map(([key, value]) => <div key={key}><dt dir="auto">{key}</dt><dd dir="auto">{readable(value)}</dd></div>)}</dl> : <p>{L('No evidence was returned for this request. Do not assume evidence has been verified.', 'مدرکی برای این درخواست برگردانده نشده است. تأیید شدن مدارک را فرض نکنید.')}</p>}
      {item.kind === 'change' && <><h3>{L('Proposed fields', 'فیلدهای پیشنهادی')}</h3>{item.items?.length ? <div className="retro-editor-differences">{item.items.map((field, index) => <dl key={`${field.field_name}:${index}`}><dt dir="auto">{field.field_name}</dt><dd><strong>{L('Submitted previous value', 'مقدار قبلی ارسال‌شده')}</strong><span dir="auto">{readable(field.old_value)}</span></dd><dd><strong>{L('Proposed value', 'مقدار پیشنهادی')}</strong><span dir="auto">{readable(field.proposed_value)}</span></dd></dl>)}</div> : <p>{L('No individual field changes were supplied. Review the summary and evidence.', 'تغییر جداگانه فیلدها ارسال نشده است. توضیحات و مدارک را بررسی کنید.')}</p>}{(item.submission || item.parent_correction) && <details><summary>{L('Structured request details', 'جزئیات ساختاریافته درخواست')}</summary><p className="retro-review-structured" dir="auto">{readable(item.submission ?? item.parent_correction)}</p></details>}</>}
      {item.review_note && <p dir="auto"><strong>{L('Recorded review reason', 'دلیل ثبت‌شده بررسی')}: </strong>{item.review_note}</p>}
      {item.status === 'pending' && <form className="retro-editor-grid" onSubmit={event => {
        event.preventDefault(); if (locked || !decision || reason.trim().length < 3 || reason.length > 2000) return;
        void run(() => item.kind === 'claim' ? runtime.platform.admin.reviewClaim(item.id, decision, reason.trim()) : runtime.platform.admin.reviewChangeRequest(item.id, decision, reason.trim()), L('Review saved. Check the current request and record for the resulting status.', 'نتیجه بررسی ذخیره شد. وضعیت نهایی را در درخواست و رکورد فعلی بررسی کنید.'), () => { setReason(''); setDecision(''); });
      }}>
        <EditorField label={L('Review decision', 'تصمیم بررسی')}><select required value={decision} disabled={locked} onChange={event => setDecision(event.target.value as typeof decision)}><option value="">{L('Choose a decision', 'انتخاب تصمیم')}</option><option value="approved">{L('Approve', 'تأیید')}</option><option value="rejected">{L('Reject', 'رد')}</option></select></EditorField>
        <EditorField label={L('Reason for this decision', 'دلیل این تصمیم')} wide><textarea required minLength={3} maxLength={2000} rows={3} dir="auto" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></EditorField>
        <div className="retro-editor-actions retro-editor-wide"><Button type="submit" disabled={locked || !decision || reason.trim().length < 3}>{L('Save review', 'ذخیره بررسی')}</Button></div>
      </form>}
    </div>
  </details>;
}
