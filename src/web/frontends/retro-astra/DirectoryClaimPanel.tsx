import { useEffect } from 'react';
import { pick } from "../../../frontend-kit";
import { DIRECTORY_CLAIM_EXPLAINER, useDirectoryClaimFlow, useMyDirectoryClaims, useScopedState, type PlatformClient } from '../../../frontend-kit';
import { Button } from './transplant/components/ui';
import { usePreferences } from './transplant/preferences/PreferencesProvider';
import { EditorField } from './EditorControls';

/** Representation claims are independent of permission to edit the selected profile. */
export function DirectoryClaimPanel({ kind, targetId, platform, scope, signedIn = true }: { kind: 'person' | 'organization'; targetId: number; platform: PlatformClient | null; scope: string; signedIn?: boolean }) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const identity = `${scope}|${kind}:${targetId}`;
  const [evidence, setEvidence] = useScopedState(identity, '');
  const [recoveryRequested, setRecoveryRequested] = useScopedState(identity, false);
  const flow = useDirectoryClaimFlow(signedIn ? platform : null, identity);
  const claims = useMyDirectoryClaims(signedIn ? platform : null, identity);
  const pending = flow.state.phase === 'submitting';
  const uncertain = flow.state.phase === 'failed';
  const locked = pending || uncertain;
  const own = claims.claims.filter(claim => kind === 'person' ? claim.person_id === targetId : claim.organization_id === targetId);
  const recoveryReady = recoveryRequested && !claims.loading && claims.unavailable === null;
  const refresh = () => { if (!platform || !signedIn) return; setRecoveryRequested(true); claims.retry(); };
  useEffect(() => {
    if (flow.state.phase === 'submitted') { setEvidence(''); claims.retry(); }
    if (flow.state.phase !== 'failed') setRecoveryRequested(false);
  }, [flow.state]);
  const status = (value: string) => ({ pending: L('Pending review', 'در انتظار بررسی'), approved: L('Approved', 'تأییدشده'), rejected: L('Rejected', 'ردشده'), cancelled: L('Cancelled', 'لغوشده') } as Record<string, string>)[value] ?? value;
  return <section className="collection-sheet retro-editor retro-claim-panel" aria-busy={pending}>
    <div className="collection-sheet-heading"><div><h2>{L('Request representation', 'درخواست نمایندگی')}</h2><p>{L('Explain your connection to this record. The request requires review and does not itself grant management access.', 'ارتباط خود را با این رکورد توضیح دهید. درخواست نیازمند بررسی است و به‌تنهایی دسترسی مدیریت نمی‌دهد.')} <bdi>#{n(targetId)}</bdi></p></div></div>
    {!signedIn ? <p className="desk-notice"><a href="#/collections/governance">{L('Sign in to submit a representation request.', 'برای ثبت درخواست نمایندگی وارد شوید.')}</a></p> : <>
      <form className="retro-editor-grid" onSubmit={event => {
        event.preventDefault();
        if (locked || !platform || evidence.trim().length < 10 || evidence.trim().length > 2000) return;
        flow.submitClaim({ claim_type: kind, ...(kind === 'person' ? { person_id: targetId } : { organization_id: targetId }), evidence_note: evidence.trim() });
      }}>
        <EditorField label={L('Evidence for this request', 'مدرک پشتیبان درخواست')} wide><textarea required minLength={10} maxLength={2000} rows={4} value={evidence} dir="auto" disabled={locked} onChange={event => setEvidence(event.target.value)} /></EditorField>
        <div className="retro-editor-actions retro-editor-wide"><Button type="submit" disabled={locked || !platform || evidence.trim().length < 10}>{pending ? L('Submitting…', 'در حال ثبت…') : L('Submit representation request', 'ثبت درخواست نمایندگی')}</Button></div>
      </form>
      {flow.state.phase === 'submitted' && <p role="status" className="desk-notice desk-notice--success">{L('Request submitted for review.', 'درخواست برای بررسی ثبت شد.')} <bdi>#{n(flow.state.claim.id)}</bdi></p>}
      {flow.state.phase === 'rejected' && <div role="alert" className="desk-notice desk-notice--error"><p>{L('The request was not accepted. Your evidence is preserved.', 'درخواست پذیرفته نشد. مدارک شما حفظ شده است.')}</p><p dir="auto">{flow.state.message}</p></div>}
      {uncertain && <div role="alert" className="desk-notice desk-notice--error"><p>{L('The result is unknown. Read your latest requests before starting another attempt.', 'نتیجه نامشخص است. پیش از تلاش دوباره، آخرین درخواست‌ها را بررسی کنید.')}</p><p dir="auto">{flow.state.phase === 'failed' ? flow.state.message : ''}</p><Button small disabled={claims.loading} onClick={refresh}>{L('Read latest requests', 'خواندن آخرین درخواست‌ها')}</Button>{recoveryReady && <Button small onClick={() => { if (!recoveryReady) return; flow.reset(); setRecoveryRequested(false); }}>{L('I have checked the latest requests', 'آخرین درخواست‌ها را بررسی کردم')}</Button>}</div>}
      <div className="retro-editor-body"><h3>{L('Your requests for this record', 'درخواست‌های شما برای این رکورد')}</h3>
        {claims.loading ? <p role="status">{L('Loading requests…', 'در حال بارگذاری درخواست‌ها…')}</p> : claims.unavailable ? <div role="alert"><p>{L('Requests could not be read. An empty history cannot be assumed.', 'خواندن درخواست‌ها انجام نشد؛ نمی‌توان سابقه را خالی فرض کرد.')}</p><p dir="auto">{claims.unavailable}</p><Button small onClick={refresh}>{L('Try again', 'تلاش دوباره')}</Button></div> : own.length ? <ul className="retro-claim-history">{own.map(claim => <li key={claim.id}><strong><bdi>#{n(claim.id)}</bdi> · {status(claim.status)}</strong>{claim.review_note && <p dir="auto">{claim.review_note}</p>}</li>)}</ul> : <p>{L('No representation requests for this record.', 'درخواست نمایندگی برای این رکورد ثبت نشده است.')}</p>}
      </div>
    </>}
    <details className="retro-editor-help"><summary>{L('What this request verifies', 'این درخواست چه چیزی را تأیید می‌کند')}</summary><ul>{DIRECTORY_CLAIM_EXPLAINER.map(entry => <li key={entry.concept}>{pick(entry, language)}</li>)}</ul></details>
  </section>;
}
