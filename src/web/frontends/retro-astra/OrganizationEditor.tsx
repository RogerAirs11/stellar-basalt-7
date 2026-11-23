import React, { useState } from 'react';
import { pick } from "../../../frontend-kit";
import { useOrganizationEditorController, usePrincipalScope, useMyOrganizationInvitations, useOrganizationRoster, useOrganizationStaffCommands, ORGANIZATION_ONBOARDING_EXPLAINER, ORGANIZATION_STAFF, classifyInvitationFailure, commandFeedback, unanswerableInvitationReason, IRAN_PROVINCES, SERVICE_CATEGORIES, serviceCategoryLabel, provinceLabel, type OrganizationEditorDraft, type OrganizationRosterMembership, type PlatformClient } from '../../../frontend-kit';
import { Button } from './transplant/components/ui';
import { usePreferences } from './transplant/preferences/PreferencesProvider';
import { EditorConflicts, EditorField, EditorTargetPicker } from './EditorControls';
import { DirectoryClaimPanel } from './DirectoryClaimPanel';

const WEEKDAYS = [['mon', 'Monday', 'دوشنبه'], ['tue', 'Tuesday', 'سه‌شنبه'], ['wed', 'Wednesday', 'چهارشنبه'], ['thu', 'Thursday', 'پنجشنبه'], ['fri', 'Friday', 'جمعه'], ['sat', 'Saturday', 'شنبه'], ['sun', 'Sunday', 'یکشنبه']] as const;

export function RetroAstraOrganizationEditor({ organizationId, platform, scope = 'principal:unscoped', invalidTarget = false, signedIn = true, user = null }: { organizationId: number | null; platform: PlatformClient | null; scope?: string; invalidTarget?: boolean; signedIn?: boolean; user?: import('../../../frontend-kit').PlatformUser | null }) {
  const staffScope = usePrincipalScope(user, null);
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const { state, updateDraft, submit, reconsentPublication, adoptAllServerValues, retryWithCurrentVersion, retry } = useOrganizationEditorController(organizationId, platform, scope);
  if (organizationId === null) return <EditorTargetPicker kind="organization" scope={scope} invalid={invalidTarget} />;
  const editable = 'draft' in state ? state : null;
  const pending = state.phase === 'saving';
  const locked = pending || !editable?.permissions.edit;
  const setDraft = (mutate: (draft: OrganizationEditorDraft) => OrganizationEditorDraft) => updateDraft(mutate);
  return <div className="retro-editor-stack">
    <section className="collection-sheet retro-editor" aria-label={L('Organization profile editor', 'ویرایش نمایه سازمان')} aria-busy={pending || state.phase === 'loading'}>
      <div className="collection-sheet-heading"><div><span className="eyebrow">{L('ORGANIZATION DIRECTORY', 'فهرست سازمان‌ها')}</span><h1>{L('Manage organization profile', 'مدیریت نمایه سازمان')}</h1><p>{L('Organization', 'سازمان')} <bdi>#{n(organizationId)}</bdi>{editable?.stored ? ' · ' + L('Version', 'نسخه') + ' ' + n(editable.stored.row_version) : ''}</p></div><a href="#/organization-profile">{L('Choose another record', 'انتخاب رکورد دیگر')}</a></div>
      {state.phase === 'loading' && <p role="status" className="desk-notice">{L('Loading organization…', 'در حال بارگذاری سازمان…')}</p>}
      {state.phase === 'denied' && <div role="alert" className="desk-notice desk-notice--error"><p>{L('Current organization membership is required to manage this profile. You can request representation below.', 'برای مدیریت این نمایه عضویت فعلی سازمان لازم است. در پایین می‌توانید درخواست نمایندگی ثبت کنید.')}</p><p dir="auto">{state.reason}</p></div>}
      {state.phase === 'unavailable' && <div role="alert" className="desk-notice desk-notice--error"><p>{L('The organization record could not be confirmed. Read the current record before continuing.', 'وضعیت رکورد سازمان تأیید نشد. پیش از ادامه، رکورد فعلی را بخوانید.')}</p><p dir="auto">{state.reason}</p><Button onClick={retry}>{L('Read current organization', 'خواندن سازمان فعلی')}</Button></div>}
      {state.phase === 'saved' && <p role="status" className="desk-notice desk-notice--success">{L('Organization profile saved.', 'نمایه سازمان ذخیره شد.')} <span dir="auto">{state.publication}</span></p>}
      {state.phase === 'conflict' && <div role="alert" className="desk-notice desk-notice--error"><h2>{L('The organization record changed', 'رکورد سازمان تغییر کرده است')}</h2><p>{L('Your draft is preserved. Review the current values before retrying.', 'پیش‌نویس شما حفظ شده است. پیش از تلاش دوباره، مقادیر فعلی را بررسی کنید.')}</p><EditorConflicts differences={state.differences} />{state.reconsentRequired ? <><p>{L('Publication consent was withdrawn. A new explicit consent is required.', 'رضایت انتشار لغو شده است. رضایت صریح تازه لازم است.')}</p><Button onClick={reconsentPublication}>{L('Confirm publication consent', 'تأیید رضایت انتشار')}</Button></> : <div className="retro-editor-actions"><Button onClick={retryWithCurrentVersion}>{L('Save reviewed draft', 'ذخیره پیش‌نویس بررسی‌شده')}</Button><Button onClick={adoptAllServerValues}>{L('Use current record values', 'استفاده از مقادیر رکورد فعلی')}</Button></div>}</div>}
      {editable && <form onSubmit={event => { event.preventDefault(); if (!locked && state.phase !== 'conflict') submit(); }}><fieldset className="retro-editor-grid" disabled={locked}><legend>{L('Organization details', 'اطلاعات سازمان')}</legend>
        <EditorField label={L('Description', 'توضیحات')} wide><textarea dir="auto" rows={4} value={editable.draft.description} maxLength={4000} onChange={event => setDraft(draft => ({ ...draft, description: event.target.value }))} /></EditorField>
        <fieldset className="retro-editor-options retro-editor-wide"><legend>{L('Services', 'خدمات')}</legend>{SERVICE_CATEGORIES.map(category => <label key={category.id}><input type="checkbox" checked={editable.draft.service_categories.includes(category.id)} onChange={event => setDraft(draft => ({ ...draft, service_categories: event.target.checked ? [...draft.service_categories, category.id] : draft.service_categories.filter(value => value !== category.id) }))} /><span>{serviceCategoryLabel(category.id, language)}</span></label>)}</fieldset>
        <EditorField label={L('Specialties, separated by commas', 'تخصص‌ها با جداکننده ویرگول')}><input dir="auto" value={editable.draft.specialties.join(', ')} onChange={event => setDraft(draft => ({ ...draft, specialties: event.target.value.split(/[,،]/).map(value => value.trim()).filter(Boolean) }))} /></EditorField>
        <EditorField label={L('Accessibility', 'دسترسی‌پذیری')}><input dir="auto" value={editable.draft.accessibility_notes} onChange={event => setDraft(draft => ({ ...draft, accessibility_notes: event.target.value }))} /></EditorField>
        <details className="retro-editor-wide"><summary>{L('Service areas', 'مناطق ارائه خدمت')} · {n(editable.draft.service_areas.length)}</summary><div className="retro-editor-options">{IRAN_PROVINCES.map(province => <label key={province.code}><input type="checkbox" checked={editable.draft.service_areas.includes(province.code)} onChange={event => setDraft(draft => ({ ...draft, service_areas: event.target.checked ? [...draft.service_areas, province.code] : draft.service_areas.filter(value => value !== province.code) }))} /><span>{provinceLabel(province.code, language)}</span></label>)}</div></details>
        <fieldset className="retro-editor-grid retro-editor-wide retro-editor-hours"><legend>{L('Opening hours', 'ساعت فعالیت')}</legend>{WEEKDAYS.map(([day, en, fa]) => <EditorField key={day} label={L(en, fa)}><input dir="auto" value={editable.draft.opening_hours[day] ?? ''} maxLength={120} onChange={event => setDraft(draft => ({ ...draft, opening_hours: { ...draft.opening_hours, [day]: event.target.value } }))} /></EditorField>)}</fieldset>
        <EditorField label={L('Province', 'استان')}><select value={editable.draft.province_code} onChange={event => setDraft(draft => ({ ...draft, province_code: event.target.value, province_scheme_confirmed: event.target.value !== '' }))}><option value="">{L('Not specified', 'مشخص نشده')}</option>{IRAN_PROVINCES.map(province => <option key={province.code} value={province.code}>{provinceLabel(province.code, language)}</option>)}</select></EditorField>
        <EditorField label={L('City', 'شهر')}><input dir="auto" value={editable.draft.city} maxLength={120} onChange={event => setDraft(draft => ({ ...draft, city: event.target.value }))} /></EditorField>
        <EditorField label={L('Contact preference', 'روش تماس')}><select value={editable.draft.contact_preference} onChange={event => setDraft(draft => ({ ...draft, contact_preference: event.target.value as OrganizationEditorDraft['contact_preference'] }))}><option value="platform_message">{L('Platform message', 'پیام سامانه')}</option><option value="phone">{L('Phone', 'تلفن')}</option><option value="email">{L('Email', 'ایمیل')}</option></select></EditorField>
        {editable.permissions.private_contact ? <EditorField label={L('Private contact value', 'اطلاعات تماس خصوصی')}><input dir="ltr" value={editable.draft.contact_value} maxLength={240} onChange={event => setDraft(draft => ({ ...draft, contact_value: event.target.value }))} /></EditorField> : <p>{L('Private contact is available only to authorized organization staff.', 'اطلاعات تماس خصوصی فقط در دسترس کارکنان مجاز سازمان است.')}</p>}
        <label className="retro-editor-check retro-editor-wide"><input type="checkbox" checked={editable.draft.publication_consent} onChange={event => setDraft(draft => ({ ...draft, publication_consent: event.target.checked }))} /><span>{L('I consent to publishing this organization profile. Consent can be withdrawn.', 'با انتشار این نمایه سازمان موافقم. این رضایت قابل لغو است.')}</span></label>
        <div className="retro-editor-actions retro-editor-wide"><Button type="submit" disabled={locked || state.phase === 'conflict'}>{pending ? L('Saving…', 'در حال ذخیره…') : L('Save organization', 'ذخیره سازمان')}</Button></div>
      </fieldset></form>}
      <details className="retro-editor-help"><summary>{L('Organization access and publication', 'دسترسی سازمان و انتشار')}</summary><ul>{ORGANIZATION_ONBOARDING_EXPLAINER.map(entry => <li key={entry.concept}>{pick(entry, language)}</li>)}</ul></details>
    </section>
    {signedIn ? <RetroAstraOrganizationStaffSection organizationId={organizationId} platform={platform} user={user} /> : null}
    {signedIn ? <RetroAstraMyOrganizationInvitations platform={platform} user={user} /> : null}
    <DirectoryClaimPanel kind="organization" targetId={organizationId} platform={platform} scope={scope} signedIn={signedIn} />
  </div>;
}

/**
 * R114-04 (Master AI R113 handoff D21) — Retro Astra's native organization
 * staff lifecycle over the shared headless hooks: live roster (current vs
 * former vs pending), the invitee-decides invitation flow, honest answer
 * refusals (revoked 409 / expired 410 / gone 404 / unknown). Self-targeted
 * role changes and self-revocation are blocked outright.
 */
export function RetroAstraOrganizationStaffSection({ organizationId, platform, user }: { organizationId: number | null; platform: PlatformClient | null; user?: import('../../../frontend-kit').PlatformUser | null }) {
  const { language, n } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const scope = usePrincipalScope(user, null);
  const commands = useOrganizationStaffCommands(scope);
  const viewerId = user?.id ?? null;
  const [invitee, setInvitee] = useState("");
  const [proposedRole, setProposedRole] = useState<"member" | "manager" | "owner">("member");
  const [inviteNote, setInviteNote] = useState("");
  const [roleDraft, setRoleDraft] = useState<Record<string, "member" | "manager" | "owner">>({});
  const [revokeDraft, setRevokeDraft] = useState<Record<string, string>>({});
  const activeId = organizationId ?? null;
  const { roster, retry } = useOrganizationRoster(activeId === null ? { organizationId: 0, platform: null, scope, userId: viewerId } : { organizationId: activeId, platform, scope, userId: viewerId });
  if (activeId === null) return null;
  const T = ORGANIZATION_STAFF;
  const entries = roster.phase === 'ready' || roster.phase === 'reloading' ? roster.entries : [];
  const memberships = entries.filter((entry): entry is OrganizationRosterMembership => entry.kind === 'membership');
  const invites = entries.filter((entry) => entry.kind === 'invite');
  return <section className="collection-sheet retro-editor" aria-label={L('Membership and invitations', 'عضویت و دعوت‌ها')} data-surface="organization-staff">
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('ORGANIZATION DIRECTORY', 'فهرست سازمان‌ها')}</span><h1>{pick(T.rosterTitle, language)}</h1><p>{pick(T.rosterNote, language)}</p></div></div>
    {roster.phase === 'loading' && <p role="status" className="desk-notice">{L('Loading the membership roster…', 'بارگذاری فهرست عضویت…')}</p>}
    {roster.phase === 'forbidden' && <div role="alert" className="desk-notice desk-notice--error"><p>{pick(T.notCurrentStaff, language)}</p><p dir="auto">{roster.reason}</p></div>}
    {roster.phase === 'unavailable' || roster.phase === 'error' ? <div role="alert" className="desk-notice desk-notice--error"><p>{L('The membership roster is unavailable.', 'فهرست عضویت در دسترس نیست.')}</p><p dir="auto">{roster.reason}</p><Button onClick={retry}>{L('Read current roster', 'خواندن فهرست فعلی')}</Button></div> : null}
    {(roster.phase === 'ready' || roster.phase === 'reloading') ? <>
      {memberships.length ? <ul className="retro-editor-options">{memberships.map(member => <li key={member.user_id} className="retro-editor-check">
        <div className="collection-sheet-heading"><div><strong dir="ltr">{member.user_id}</strong>
          <small>{L('Role', 'نقش')}: {member.role} · {member.is_current ? pick(T.current, language) : pick(T.former, language)}</small>
          {member.email ? <small dir="ltr">{member.email}</small> : null}
          {member.revoked_at ? <small dir="auto">{L('Revoked', 'لغو شده')}: {member.revoked_at.slice(0, 10)}{member.revoke_reason ? ` — ${member.revoke_reason}` : ''}</small> : null}
          {member.valid_until && !member.revoked_at ? <small>{L('Valid until', 'معتبر تا')}: {member.valid_until.slice(0, 10)}</small> : null}
        </div>
        {viewerId !== null && member.user_id === viewerId ? <small>{pick(T.selfBlocked, language)}</small> : member.is_current ? <div className="retro-editor-actions">
          <label><span>{pick(T.changeRole, language)}</span><select value={roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner")} disabled={commands.roleChange.state.phase === 'submitting'} onChange={event => setRoleDraft(prev => ({ ...prev, [member.user_id]: event.target.value as "member" | "manager" | "owner" }))}>{(['member', 'manager', 'owner'] as const).map(role => <option key={role} value={role}>{role}</option>)}</select></label>
          <Button disabled={commands.roleChange.state.phase === 'submitting' || (roleDraft[member.user_id] ?? member.role) === member.role} onClick={() => { const nextRole = roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner"); void commands.roleChange.run(async () => { const result = await platform!.modules.organizations.setStaffRole(activeId, member.user_id, nextRole); retry(); return result; }, { successMessage: L('Role changed.', 'نقش تغییر کرد.') }); }}>{pick(T.changeRole, language)}</Button>
          <input dir="auto" maxLength={500} placeholder={pick(T.revokeReason, language)} value={revokeDraft[member.user_id] ?? ''} disabled={commands.revoke.state.phase === 'submitting'} onChange={event => setRevokeDraft(prev => ({ ...prev, [member.user_id]: event.target.value }))} />
          <Button disabled={commands.revoke.state.phase === 'submitting' || (revokeDraft[member.user_id] ?? '').trim().length < 3} onClick={() => { void commands.revoke.run(async () => { const result = await platform!.modules.organizations.revokeStaff(activeId, member.user_id, (revokeDraft[member.user_id] ?? '').trim()); retry(); return result; }, { successMessage: pick(T.revokeNote, language) }); }}>{pick(T.revokeMembership, language)}</Button>
        </div> : null}
        </div>
      </li>)}</ul> : <p className="desk-notice">{L('No memberships yet.', 'هنوز عضویتی نیست.')}</p>}
      {invites.length ? <details className="retro-editor-help"><summary>{L('Pending and past invitations', 'دعوت‌های در انتظار و گذشته')}</summary><ul className="retro-editor-options">{invites.map(invite => <li key={invite.id}><strong dir="ltr">{invite.invitee_user_id}</strong> <small>{pick(T.proposedRole, language)}: {invite.proposed_role} · {invite.status}{invite.expires_at ? ` · ${L('expires', 'انقضا')} ${invite.expires_at.slice(0, 10)}` : ''}</small></li>)}</ul><p>{pick(T.inviteConsent, language)}</p></details> : null}
      <details className="retro-editor-help"><summary>{pick(T.inviteForm, language)}</summary>
        <p>{pick(T.inviteConsent, language)}</p>
        <form onSubmit={event => { event.preventDefault(); void commands.invite.run(async () => { const result = await platform!.modules.organizations.invite(activeId, { invitee_user_id: invitee.trim(), proposed_role: proposedRole, note: inviteNote.trim() || null }); setInvitee(''); setInviteNote(''); retry(); return result; }, { successMessage: L('Invitation sent. It expires honestly; the invitee decides.', 'دعوت ارسال شد. صادقانه منقضی می‌شود؛ طرف دعوت تصمیم می‌گیرد.') }); }}>
          <div className="retro-editor-grid">
            <EditorField label={L('User id', 'شناسه کاربر')}><input required minLength={3} maxLength={64} dir="ltr" value={invitee} onChange={event => setInvitee(event.target.value)} /></EditorField>
            <EditorField label={pick(T.proposedRole, language)}><select value={proposedRole} onChange={event => setProposedRole(event.target.value as "member" | "manager" | "owner")}>{(['member', 'manager', 'owner'] as const).map(role => <option key={role} value={role}>{role}</option>)}</select></EditorField>
            <EditorField label={pick(T.inviteNote, language)}><input maxLength={500} dir="auto" value={inviteNote} onChange={event => setInviteNote(event.target.value)} /></EditorField>
          </div>
          <Button type="submit" disabled={commands.invite.state.phase === 'submitting' || commands.invite.state.phase === 'failed'}>{pick(T.sendInvite, language)}</Button>
        </form>
      </details>
      {commands.invite.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.invite.state)}</p><Button onClick={() => { commands.invite.reset(); retry(); }}>{L('Reload roster', 'بارگذاری دوباره فهرست')}</Button></div> : null}
      {commands.roleChange.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.roleChange.state)}</p><Button onClick={() => { commands.roleChange.reset(); retry(); }}>{L('Reload roster', 'بارگذاری دوباره فهرست')}</Button></div> : null}
      {commands.revoke.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.revoke.state)}</p><Button onClick={() => { commands.revoke.reset(); retry(); }}>{L('Reload roster', 'بارگذاری دوباره فهرست')}</Button></div> : null}
    </> : null}
    <p>{pick(T.personNotMembership, language)}</p>
  </section>;
}

/** The invitee's own cross-organization inbox (R114-04) with honest answer refusals. */
export function RetroAstraMyOrganizationInvitations({ platform, user }: { platform: PlatformClient | null; user?: import('../../../frontend-kit').PlatformUser | null }) {
  const { language } = usePreferences();
  const L = (en: string, fa: string) => language === 'fa' ? fa : en;
  const T = ORGANIZATION_STAFF;
  const scope = usePrincipalScope(user, null);
  const commands = useOrganizationStaffCommands(scope);
  const mine = useMyOrganizationInvitations({ platform, scope, userId: user?.id ?? null, enabled: user != null });
  const [answerFailure, setAnswerFailure] = useState<string | null>(null);
  if (!user) return null;
  return <section className="collection-sheet retro-editor" aria-label={pick(T.myInvitations, language)} data-surface="organization-invitations">
    <div className="collection-sheet-heading"><div><span className="eyebrow">{L('ORGANIZATION DIRECTORY', 'فهرست سازمان‌ها')}</span><h1>{pick(T.myInvitations, language)}</h1></div></div>
    {mine.phase === 'loading' && <p role="status" className="desk-notice">{L('Loading your invitations…', 'بارگذاری دعوت‌های شما…')}</p>}
    {mine.phase === 'unavailable' || mine.phase === 'error' ? <div role="alert" className="desk-notice desk-notice--error"><p>{L('Your invitation list is unavailable.', 'فهرست دعوت شما در دسترس نیست.')}</p><p dir="auto">{mine.reason}</p><Button onClick={mine.retry}>{L('Try loading again', 'تلاش دوباره')}</Button></div> : null}
    {mine.phase === 'ready' ? (mine.invitations.length ? <ul className="retro-editor-options">{mine.invitations.map(invitation => <li key={invitation.id}>
      <div><strong dir="auto">{invitation.name_latin ?? invitation.name_native ?? `#${invitation.organization_id}`}</strong>
        <small>{pick(T.proposedRole, language)}: {invitation.proposed_role} · {L('expires', 'انقضا')}: {(invitation.expires_at ?? '').slice(0, 10)}</small>
        {invitation.note ? <small dir="auto">{invitation.note}</small> : null}
      </div>
      {invitation.actionable ? <div className="retro-editor-actions">
        <Button disabled={commands.respond.state.phase === 'submitting'} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => { try { const result = await platform!.modules.organizations.respondInvite(invitation.id, true); mine.retry(); return result; } catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; } }, { successMessage: L('Invitation accepted. Your membership is checked live on every request.', 'دعوت پذیرفته شد. عضویت شما در هر درخواست زنده بررسی می‌شود.') }); }}>{pick(T.accept, language)}</Button>
        <Button disabled={commands.respond.state.phase === 'submitting'} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => { try { const result = await platform!.modules.organizations.respondInvite(invitation.id, false); mine.retry(); return result; } catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; } }, { successMessage: L('Invitation declined.', 'دعوت رد شد.') }); }}>{pick(T.decline, language)}</Button>
      </div> : <small>{unanswerableInvitationReason(invitation) === 'expired' ? pick(T.expiredAnswer, language) : pick(T.revokedAnswer, language)}</small>}
    </li>)}</ul> : <p className="desk-notice">{L('You have no pending organization invitations.', 'دعوت سازمانی در انتظار ندارید.')}</p>) : null}
    {answerFailure ? <div role="alert" className="desk-notice desk-notice--error"><p>{answerFailure}</p></div> : null}
    {commands.respond.state.phase !== 'idle' ? <div role="alert" className="desk-notice desk-notice--error"><p>{commandFeedback(commands.respond.state)}</p><Button onClick={() => { commands.respond.reset(); mine.retry(); }}>{L('Reload invitations', 'بارگذاری دوباره دعوت‌ها')}</Button></div> : null}
  </section>;
}
