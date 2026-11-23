import type { CommandState, ResourceState } from '../../../../../frontend-kit';
import { retroText } from '../i18n/messages';
import { usePreferences } from '../preferences/PreferencesProvider';
import { Button, EmptyState } from './ui';

/** Retro owns the presentation; request and command semantics stay in frontend-kit. */
export function DeskResourceNotice<T>({ state, retry, empty }: {
  state: ResourceState<T>; retry: () => void; empty?: [string, string];
}) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  if (state.phase === 'loading') return <p className="desk-notice" role="status">{L('Loading records…', 'در حال بارگذاری سوابق…')}</p>;
  if (state.phase === 'reloading') return <p className="desk-notice" role="status">{L('Updating… The previous results remain visible until the update finishes.', 'در حال به‌روزرسانی… تا پایان آن، نتایج قبلی نمایش داده می‌شوند.')}</p>;
  if (state.phase === 'empty') return <EmptyState title={empty ? L(...empty) : L('No matching records', 'رکوردی پیدا نشد')} description={L('Try a different search or return later.', 'جست‌وجو را تغییر دهید یا بعداً دوباره مراجعه کنید.')} />;
  if (state.phase !== 'error' && state.phase !== 'unavailable' && state.phase !== 'forbidden') return null;
  return <div className="desk-notice desk-notice--error" role="alert">
    <p>{state.phase === 'forbidden' ? L('Your account does not have access to these records.', 'حساب شما به این سوابق دسترسی ندارد.') : state.phase === 'unavailable' ? L('These records are not available to this session.', 'این سوابق در نشست فعلی در دسترس نیستند.') : L('The records could not be loaded. Please try again.', 'بارگذاری سوابق انجام نشد. دوباره تلاش کنید.')}</p>
    {state.phase === 'error' && state.retryAfterSeconds != null && <p>{L('Try again after', 'زمان انتظار برای تلاش دوباره:')} {n(state.retryAfterSeconds)} {L('seconds.', 'ثانیه.')}</p>}
    <details><summary>{L('Error details', 'جزئیات خطا')}</summary><p dir="auto">{state.reason}</p></details>
    <Button small onClick={retry}>{L('Try again', 'تلاش دوباره')}</Button>
  </div>;
}

export function DeskCommandNotice({ state, reload }: { state: CommandState; reload?: () => void }) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => retroText(language, en, fa);
  if (state.phase === 'idle') return null;
  if (state.phase === 'submitting') return <p className="desk-notice" role="status">{L('Saving…', 'در حال ثبت…')}</p>;
  if (state.phase === 'accepted') return <p className="desk-notice desk-notice--success" role="status">{state.message}</p>;
  return <div className="desk-notice desk-notice--error" role="alert">
    <p>{state.phase === 'failed'
      ? L('The result could not be confirmed. Refresh the records to check whether the change was saved before trying again.', 'نتیجه تأیید نشد. پیش از تلاش دوباره، سوابق را به‌روزرسانی کنید و ثبت شدن تغییر را بررسی کنید.')
      : state.status === 409 ? L('This record changed while you were editing. Refresh it, review the changes, and try again. Your input is still here.', 'این رکورد هنگام ویرایش تغییر کرده است. آن را به‌روزرسانی کنید، تغییرات را بررسی کنید و دوباره تلاش کنید. متن شما حفظ شده است.')
      : state.status === 401 || state.status === 403 ? L('Please sign in with an account that can make this change.', 'برای انجام این تغییر، با حسابی که دسترسی لازم را دارد وارد شوید.')
      : L('The change was not accepted. Review your input and try again.', 'تغییر پذیرفته نشد. اطلاعات واردشده را بررسی کنید و دوباره تلاش کنید.')}</p>
    {state.phase === 'rejected' && state.retryAfterSeconds != null && <p>{L('Please wait', 'لطفاً صبر کنید:')} {n(state.retryAfterSeconds)} {L('seconds.', 'ثانیه.')}</p>}
    <details><summary>{L('Error details', 'جزئیات خطا')}</summary><p dir="auto">{state.message}</p></details>
    {reload && <Button small onClick={reload}>{L('Refresh records', 'به‌روزرسانی سوابق')}</Button>}
  </div>;
}
