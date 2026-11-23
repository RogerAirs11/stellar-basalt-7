import { useRef, useState } from 'react';
import { useDomainResource, type PlatformClient } from '../frontend-kit';
import './styles/demo-session-picker.css';

type PersonaKey = Parameters<PlatformClient['auth']['demoPersona']>[0];
interface DemoContext { dataset_kind: 'synthetic'; revision: string; personas: { key: PersonaKey; label: string; role: string }[] }
const LABELS: Record<PersonaKey, [string, string]> = {
  admin: ['Administrator', 'مدیر سامانه'], owner_a: ['Horse owner A', 'اسب‌دار الف'], owner_b: ['Horse owner B', 'اسب‌دار ب'],
  reviewer: ['Record reviewer', 'بررسی‌کننده سوابق'], provider: ['Service provider', 'ارائه‌دهنده خدمات'], manager: ['Farm manager', 'مدیر مزرعه'], staff: ['Farm staff', 'کارکنان مزرعه'],
};

/** A host demo control: real cookie/CSRF auth, no credentials or client-only roles. */
export function DemoSessionPicker({ platform, locale, enabled, userId }: { platform: PlatformClient; locale: 'en' | 'fa'; enabled: boolean; userId: string | null }) {
  const L = (en: string, fa: string) => locale === 'fa' ? fa : en;
  const [persona, setPersona] = useState<PersonaKey>('owner_a');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const flight = useRef(false);
  const context = useDomainResource<DemoContext>('isolated-demo-context', 'r111', async signal => {
    const response = await fetch('/api/demo/context', { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error('Demo context unavailable');
    const data = await response.json() as DemoContext;
    if (data.dataset_kind !== 'synthetic' || !Array.isArray(data.personas)) throw new Error('Not an isolated synthetic demo');
    return data;
  }, { enabled });
  if (!enabled || context.state.phase !== 'ready') return null;
  const personas = context.state.data.personas.filter(item => Object.prototype.hasOwnProperty.call(LABELS, item.key));
  if (!personas.length) return null;
  const apply = async () => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError('');
    try { await platform.auth.demoPersona(persona); }
    catch {
      // Reconcile the real cookie after an uncertain/failed session change.
      // The SDK already hid the previous principal before the request began.
      try { await platform.auth.me(); } catch { /* Keep authority masked if reconciliation also fails. */ }
      setError(L('The demo account could not be opened. Try again.', 'ورود به حساب نمایشی انجام نشد. دوباره تلاش کنید.'));
    }
    finally { flight.current = false; setBusy(false); }
  };
  return <details className="demo-session-picker" dir={locale === 'fa' ? 'rtl' : 'ltr'} data-testid="demo-persona-picker">
    <summary>{L('Demo accounts', 'حساب‌های نمایشی')} <span>{L('Synthetic records', 'اطلاعات ساختگی')}</span></summary>
    <div className="demo-session-picker-body" role="region" aria-label={L('Demo account options', 'گزینه‌های حساب نمایشی')}><p>{L('Try each role with a separate demo account. Changes are saved in this local demo.', 'نقش‌های مختلف را با حساب‌های نمایشی امتحان کنید. تغییرات در همین محیط نمایشی محلی ذخیره می‌شوند.')}</p>
      <form onSubmit={event => { event.preventDefault(); void apply(); }} aria-busy={busy}>
        <label>{L('Demo account', 'حساب نمایشی')}<select value={persona} onChange={event => setPersona(event.target.value as PersonaKey)} disabled={busy}>{personas.map(item => <option key={item.key} value={item.key}>{L(...LABELS[item.key])}</option>)}</select></label>
        <button type="submit" disabled={busy}>{busy ? L('Opening account…', 'در حال ورود…') : userId ? L('Switch demo account', 'تغییر حساب نمایشی') : L('Open demo account', 'ورود به حساب نمایشی')}</button>
        {userId && <button type="button" disabled={busy} onClick={async () => { if (flight.current) return; flight.current = true; setBusy(true); setError(''); try { await platform.auth.logout(); } catch { setError(L('Sign-out could not be confirmed. Try again.', 'خروج از حساب تأیید نشد. دوباره تلاش کنید.')); } finally { flight.current = false; setBusy(false); } }}>{L('Sign out', 'خروج')}</button>}
      </form>{error && <p role="alert">{error}</p>}
    </div>
  </details>;
}
