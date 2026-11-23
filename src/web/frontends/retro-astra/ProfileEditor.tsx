import React from 'react';
import { useProfileEditorController, IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel, type ProfileEditorDraft, type PlatformClient } from '../../../frontend-kit';
import { Button } from './transplant/components/ui';
import { usePreferences } from './transplant/preferences/PreferencesProvider';
import { EditorConflicts, EditorField, EditorTargetPicker } from './EditorControls';
import { DirectoryClaimPanel } from './DirectoryClaimPanel';

/** Retro renders the shared editor controller inside its normal themed workspace. */
export function RetroAstraProfileEditor({ personId, platform, scope = 'principal:unscoped', invalidTarget = false, signedIn = true }: { personId: number | null; platform: PlatformClient | null; scope?: string; invalidTarget?: boolean; signedIn?: boolean }) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const { state, updateDraft, submit, reconsentPublication, takeServerValues, retryWithCurrentVersion, retry } = useProfileEditorController(personId, platform, scope);
  if (personId === null) return <EditorTargetPicker kind="person" scope={scope} invalid={invalidTarget} />;
  const editable = 'draft' in state ? state : null;
  const pending = state.phase === 'saving';
  const locked = pending || !editable?.permissions.edit;
  const setDraft = (mutate: (draft: ProfileEditorDraft) => ProfileEditorDraft) => updateDraft(mutate);
  return <div className="retro-editor-stack">
    <section className="collection-sheet retro-editor" aria-label={L('Professional profile editor', 'ویرایش نمایه متخصص')} aria-busy={pending || state.phase === 'loading'}>
      <div className="collection-sheet-heading"><div><span className="eyebrow">{L('PROFESSIONAL DIRECTORY', 'فهرست متخصصان')}</span><h1>{L('Manage professional profile', 'مدیریت نمایه متخصص')}</h1><p>{L('Person', 'شخص')} <bdi>#{n(personId)}</bdi>{editable?.stored ? ' · ' + L('Version', 'نسخه') + ' ' + n(editable.stored.row_version) : ''}</p></div><a href="#/directory-profile">{L('Choose another record', 'انتخاب رکورد دیگر')}</a></div>
      {state.phase === 'loading' && <p role="status" className="desk-notice">{L('Loading profile…', 'در حال بارگذاری نمایه…')}</p>}
      {state.phase === 'denied' && <div role="alert" className="desk-notice desk-notice--error"><p>{L('You cannot manage this profile with the current account. You can request representation below.', 'با حساب فعلی نمی‌توانید این نمایه را مدیریت کنید. در پایین می‌توانید درخواست نمایندگی ثبت کنید.')}</p><p dir="auto">{state.reason}</p></div>}
      {state.phase === 'unavailable' && <div role="alert" className="desk-notice desk-notice--error"><p>{L('The profile could not be confirmed. Read the current record before continuing.', 'وضعیت نمایه تأیید نشد. پیش از ادامه، رکورد فعلی را بخوانید.')}</p><p dir="auto">{state.reason}</p><Button onClick={retry}>{L('Read current profile', 'خواندن نمایه فعلی')}</Button></div>}
      {state.phase === 'saved' && <p role="status" className="desk-notice desk-notice--success">{L('Profile saved.', 'نمایه ذخیره شد.')} <span dir="auto">{state.publication}</span></p>}
      {state.phase === 'conflict' && <div role="alert" className="desk-notice desk-notice--error"><h2>{L('The record changed while you were editing', 'رکورد هنگام ویرایش تغییر کرده است')}</h2><p>{L('Your draft is preserved. Review the differences before applying it to the current version.', 'پیش‌نویس شما حفظ شده است. پیش از ثبت روی نسخه فعلی، تفاوت‌ها را بررسی کنید.')}</p><EditorConflicts differences={state.differences} />
        {state.reconsentRequired ? <><p>{L('Publication consent was withdrawn. Confirm consent explicitly before retrying.', 'رضایت انتشار لغو شده است. پیش از تلاش دوباره، رضایت را صریحاً تأیید کنید.')}</p><Button onClick={reconsentPublication}>{L('Confirm publication consent', 'تأیید رضایت انتشار')}</Button></> : <div className="retro-editor-actions"><Button onClick={retryWithCurrentVersion}>{L('Save reviewed draft', 'ذخیره پیش‌نویس بررسی‌شده')}</Button><Button onClick={takeServerValues}>{L('Use current record values', 'استفاده از مقادیر رکورد فعلی')}</Button></div>}
      </div>}
      {editable && <form onSubmit={event => { event.preventDefault(); if (!locked && state.phase !== 'conflict') submit(); }}>
        <fieldset className="retro-editor-grid" disabled={locked}><legend>{L('Profile details', 'اطلاعات نمایه')}</legend>
          <fieldset className="retro-editor-options retro-editor-wide"><legend>{L('Services', 'خدمات')}</legend>{SERVICE_CATEGORIES.map(category => <label key={category.id}><input type="checkbox" checked={editable.draft.service_categories.includes(category.id)} onChange={event => setDraft(draft => ({ ...draft, service_categories: event.target.checked ? [...draft.service_categories, category.id] : draft.service_categories.filter(value => value !== category.id) }))} /><span>{serviceCategoryLabel(category.id, language)}</span></label>)}</fieldset>
          <EditorField label={L('Province', 'استان')}><select value={editable.draft.province_code} onChange={event => setDraft(draft => ({ ...draft, province_code: event.target.value, province_scheme_confirmed: event.target.value !== '' }))}><option value="">{L('Not specified', 'مشخص نشده')}</option>{IRAN_PROVINCES.map(province => <option key={province.code} value={province.code}>{provinceLabel(province.code, language)}</option>)}</select></EditorField>
          <EditorField label={L('City', 'شهر')}><input dir="auto" value={editable.draft.city} maxLength={120} onChange={event => setDraft(draft => ({ ...draft, city: event.target.value }))} /></EditorField>
          <EditorField label={L('Contact preference', 'روش تماس')}><select value={editable.draft.contact_preference} onChange={event => setDraft(draft => ({ ...draft, contact_preference: event.target.value as ProfileEditorDraft['contact_preference'] }))}><option value="platform_message">{L('Platform message', 'پیام سامانه')}</option><option value="phone">{L('Phone', 'تلفن')}</option><option value="email">{L('Email', 'ایمیل')}</option></select></EditorField>
          {editable.permissions.private_contact ? <EditorField label={L('Private contact value', 'اطلاعات تماس خصوصی')}><input dir="ltr" value={editable.draft.contact_value} maxLength={240} onChange={event => setDraft(draft => ({ ...draft, contact_value: event.target.value }))} /></EditorField> : <p>{L('Private contact is available only to an authorized representative.', 'اطلاعات تماس خصوصی فقط در دسترس نماینده مجاز است.')}</p>}
          <EditorField label={L('Languages', 'زبان‌ها')}><input dir="auto" value={editable.draft.languages} maxLength={240} onChange={event => setDraft(draft => ({ ...draft, languages: event.target.value }))} /></EditorField>
          <EditorField label={L('Availability', 'زمان دسترسی')}><textarea dir="auto" rows={3} value={editable.draft.availability_text} maxLength={2000} onChange={event => setDraft(draft => ({ ...draft, availability_text: event.target.value }))} /></EditorField>
          <label className="retro-editor-check retro-editor-wide"><input type="checkbox" checked={editable.draft.publication_consent} onChange={event => setDraft(draft => ({ ...draft, publication_consent: event.target.checked }))} /><span>{L('I consent to publishing this professional profile. Consent can be withdrawn.', 'با انتشار این نمایه حرفه‌ای موافقم. این رضایت قابل لغو است.')}</span></label>
          <div className="retro-editor-actions retro-editor-wide"><Button type="submit" disabled={locked || state.phase === 'conflict'}>{pending ? L('Saving…', 'در حال ذخیره…') : L('Save profile', 'ذخیره نمایه')}</Button></div>
        </fieldset>
      </form>}
    </section>
    <DirectoryClaimPanel kind="person" targetId={personId} platform={platform} scope={scope} signedIn={signedIn} />
  </div>;
}
