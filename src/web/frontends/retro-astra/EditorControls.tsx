import React, { useId, type ReactElement } from 'react';
import { useScopedState } from '../../../frontend-kit';
import { Button } from './transplant/components/ui';
import { usePreferences } from './transplant/preferences/PreferencesProvider';

/** Native presentation helpers. Business permissions and write state stay in frontend-kit. */
export function EditorField({ label, children, wide = false }: { label: string; children: ReactElement<{ id?: string }>; wide?: boolean }) {
  const id = useId();
  return <div className={`retro-editor-field${wide ? ' retro-editor-wide' : ''}`}><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id })}</div>;
}

export function positiveEditorTarget(value: string): number | null {
  const normalized = value.trim().replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632));
  const id = /^\d+$/.test(normalized) ? Number(normalized) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function EditorTargetPicker({ kind, scope, invalid = false }: { kind: 'person' | 'organization'; scope: string; invalid?: boolean }) {
  const { language } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const [target, setTarget] = useScopedState(`${scope}|editor-target:${kind}`, '');
  const id = positiveEditorTarget(target);
  return <section className="collection-sheet retro-editor">
    <div className="collection-sheet-heading"><div><h1>{kind === 'person' ? L('Manage a professional profile', 'مدیریت نمایه متخصص') : L('Manage an organization', 'مدیریت سازمان')}</h1><p>{L('Open an existing registry record. Your current permissions determine the information you can manage.', 'یک رکورد موجود را باز کنید. دسترسی فعلی شما مشخص می‌کند کدام اطلاعات قابل مدیریت است.')}</p></div></div>
    {invalid && <p role="alert" className="desk-notice desk-notice--error">{L('That record ID is invalid. Enter a positive whole number.', 'شناسه رکورد نامعتبر است. یک عدد صحیح مثبت وارد کنید.')}</p>}
    <form className="retro-editor-grid" onSubmit={event => { event.preventDefault(); if (id !== null) window.location.hash = `#/${kind === 'person' ? 'directory-profile' : 'organization-profile'}/${id}`; }}>
      <EditorField label={kind === 'person' ? L('Person ID', 'شناسه شخص') : L('Organization ID', 'شناسه سازمان')}><input inputMode="numeric" dir="ltr" required pattern="[0-9۰-۹٠-٩]+" value={target} onChange={event => setTarget(event.target.value)} /></EditorField>
      <div className="retro-editor-actions"><Button type="submit" disabled={id === null}>{L('Open record', 'باز کردن رکورد')}</Button></div>
    </form>
  </section>;
}

export function EditorConflicts({ differences }: { differences: readonly { field: string; local: string; server: string }[] }) {
  const { language } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  return <div className="retro-editor-differences">{differences.map(difference => <dl key={difference.field}><dt dir="auto">{difference.field}</dt><dd><strong>{L('Your draft', 'پیش‌نویس شما')}</strong><span dir="auto">{difference.local || '—'}</span></dd><dd><strong>{L('Current record', 'رکورد فعلی')}</strong><span dir="auto">{difference.server || '—'}</span></dd></dl>)}</div>;
}
