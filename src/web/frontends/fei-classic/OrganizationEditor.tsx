import { useState, useEffect } from "react";
import { useOrganizationEditorController, usePrincipalScope, useScopedState, ORGANIZATION_ONBOARDING_EXPLAINER, ORGANIZATION_STAFF, classifyInvitationFailure, commandFeedback, unanswerableInvitationReason, useMyOrganizationInvitations, useOrganizationRoster, useOrganizationStaffCommands, IRAN_PROVINCES, provinceLabel, type OrganizationEditorDraft, type OrganizationRosterMembership, type PlatformClient, type PlatformUser, pick } from "../../../frontend-kit";
import { editorPublicationLabel, editorWeekdayLabel, editorFieldLabel } from "../../../frontend-kit";
import { EditorTarget, EditorField, EditorNotice, EditorConflict, EditorServices, EditorProvince, editorText, type EditorLocale } from "./editorUi";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Props = { organizationId: number | null; platform: PlatformClient | null; user?: PlatformUser | null; locale?: EditorLocale };

export function FeiClassicOrganizationEditor({ organizationId, platform, user, locale = "en" }: Props) {
  const scope = usePrincipalScope(user, null);
  const [selectedId, setSelectedId] = useScopedState<number | null>(`${scope}:${organizationId ?? "select"}`, organizationId);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  return <section className="fc112-editor" aria-label={L("Organization profile editor", "ویرایشگر نمایه سازمان")}>
    <h2>{L("Organization profile", "نمایه سازمان")}</h2><p>{L("Update services, location, opening hours, and publication consent for an organization you manage.", "خدمات، محل، ساعت‌های کاری و رضایت انتشار سازمانی را که مدیریت می‌کنید به‌روزرسانی کنید.")}</p>
    {!user ? <EditorNotice locale={locale} title={L("Sign in to manage an organization", "برای مدیریت سازمان وارد شوید")}><a href="/f/fei-classic/auth">{L("Sign in", "ورود")}</a></EditorNotice> : <>
      <EditorTarget key={`${scope}:${organizationId ?? "select"}`} kind="organization" locale={locale} initialId={organizationId} onSelect={setSelectedId}/>
      {selectedId ? <ManagedOrganization key={`${scope}:${selectedId}`} organizationId={selectedId} platform={platform} user={user} locale={locale}/> : <EditorNotice locale={locale} title={L("Choose an organization to begin", "برای شروع یک سازمان انتخاب کنید")}/>}
      <FeiOrganizationStaffSection key={`${scope}:staff:${selectedId ?? "none"}`} organizationId={selectedId} platform={platform} user={user} locale={locale}/>
      <FeiMyOrganizationInvitations key={`${scope}:mine`} platform={platform} user={user} locale={locale}/>
    </>}
    <details className="fc112-editor-explainer"><summary>{L("Organization, account, and staff responsibilities", "سازمان، حساب و مسئولیت کارکنان")}</summary><ul>{ORGANIZATION_ONBOARDING_EXPLAINER.map(entry => <li key={entry.concept}>{pick(entry, locale)}</li>)}</ul></details>
  </section>;
}
function SpecialtiesField({ value, onChange, locale }: { value: string[]; onChange: (value: string[]) => void; locale: EditorLocale }) {
  const [text, setText] = useState(value.join(", "));
  const [focused, setFocused] = useState(false);
  const canonical = value.join(", ");
  useEffect(() => { if (!focused) setText(canonical); }, [canonical, focused]);
  return <EditorField locale={locale} field="specialties"><input dir="auto" value={text} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => { setText(event.target.value); onChange(event.target.value.split(/[,،]/).map(item => item.trim()).filter(Boolean)); }}/><small>{editorText(locale, "Separate specialties with commas.", "تخصص‌ها را با ویرگول جدا کنید.")}</small></EditorField>;
}
function ManagedOrganization({ organizationId, platform, user, locale = "en" }: Props & { organizationId: number }) {
  const scope = usePrincipalScope(user, null);
  const { state, updateDraft, submit, reconsentPublication, adoptAllServerValues, retryWithCurrentVersion, retry } = useOrganizationEditorController(organizationId, platform, scope);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  if (state.phase === "loading") return <EditorNotice locale={locale} title={L("Loading organization…", "بارگذاری سازمان…")}/>;
  if (state.phase === "denied") return <EditorNotice locale={locale} alert title={L("Your account cannot manage this organization", "حساب شما نمی‌تواند این سازمان را مدیریت کند")}><p dir="auto">{state.reason}</p><p>{L("Access requires a current staff role or authorized curation access.", "دسترسی به نقش فعلی کارکنان یا مجوز ویرایش نیاز دارد.")}</p></EditorNotice>;
  if (state.phase === "unavailable") return <EditorNotice locale={locale} alert title={L("The organization could not be loaded", "سازمان بارگذاری نشد")}><p dir="auto">{state.reason}</p><button type="button" onClick={retry}>{L("Try loading again", "تلاش دوباره برای بارگذاری")}</button></EditorNotice>;
  const { draft, permissions } = state;
  const setDraft = (mutate: (draft: OrganizationEditorDraft) => OrganizationEditorDraft) => updateDraft(mutate);
  const saving = state.phase === "saving";
  return <>
    <div className="fc112-editor-meta"><span>{L("Organization", "سازمان")} <bdi>#{organizationId}</bdi></span><span>{state.phase === "empty" ? L("New directory profile", "نمایه تازه در فهرست") : `${L("Revision", "نسخه")} ${state.stored?.row_version ?? 0}`}</span></div>
    {state.phase === "saved" && <EditorNotice locale={locale} title={L("Organization saved", "سازمان ذخیره شد")}><p>{editorPublicationLabel(state.publication, locale)}</p></EditorNotice>}
    {state.phase === "conflict" && <EditorConflict locale={locale} differences={state.differences} reconsentRequired={state.reconsentRequired} onReconsent={reconsentPublication} onRetry={retryWithCurrentVersion} onAdopt={adoptAllServerValues}/>}
    <form className="fc112-editor-form" onSubmit={event => { event.preventDefault(); if (!saving && permissions.edit) void submit(); }}>
      <fieldset disabled={saving || !permissions.edit} className="fc112-editor-fields"><legend className="fc112-editor-legend">{L("Public organization details", "اطلاعات عمومی سازمان")}</legend>
        <EditorField locale={locale} field="description"><textarea rows={4} dir="auto" value={draft.description} onChange={event => setDraft(d => ({ ...d, description: event.target.value }))}/></EditorField>
        <EditorServices locale={locale} value={draft.service_categories} onChange={service_categories => setDraft(d => ({ ...d, service_categories }))}/>
        <SpecialtiesField value={draft.specialties} locale={locale} onChange={specialties => setDraft(d => ({ ...d, specialties }))}/>
        <details className="fc112-editor-areas"><summary>{editorFieldLabel("service_areas", locale)} · {draft.service_areas.length} {L("selected", "انتخاب‌شده")}</summary><fieldset className="fc112-editor-choice-group"><legend>{L("Choose the provinces you serve", "استان‌های محل ارائه خدمت را انتخاب کنید")}</legend><div className="fc112-editor-checks">{IRAN_PROVINCES.map(province => <label key={province.code}><input type="checkbox" checked={draft.service_areas.includes(province.code)} onChange={event => setDraft(d => ({ ...d, service_areas: event.target.checked ? [...d.service_areas, province.code] : d.service_areas.filter(value => value !== province.code) }))}/><span>{provinceLabel(province.code, locale)}</span></label>)}</div></fieldset></details>
        <EditorField locale={locale} field="accessibility_notes"><textarea rows={2} dir="auto" value={draft.accessibility_notes} onChange={event => setDraft(d => ({ ...d, accessibility_notes: event.target.value }))}/></EditorField>
        <fieldset className="fc112-editor-choice-group"><legend>{editorFieldLabel("opening_hours", locale)}</legend><div className="fc112-editor-hours">{WEEKDAYS.map(day => <label className="fc112-editor-field" key={day}><span>{editorWeekdayLabel(day, locale)}</span><input dir="ltr" value={draft.opening_hours[day] ?? ""} placeholder="08:00–14:00" maxLength={120} onChange={event => setDraft(d => ({ ...d, opening_hours: { ...d.opening_hours, [day]: event.target.value } }))}/></label>)}</div></fieldset>
        <div className="fc112-editor-grid"><EditorProvince locale={locale} value={draft.province_code} onChange={province_code => setDraft(d => ({ ...d, province_code, province_scheme_confirmed: province_code !== "" }))}/><EditorField locale={locale} field="city"><input dir="auto" value={draft.city} onChange={event => setDraft(d => ({ ...d, city: event.target.value }))}/></EditorField></div>
        <EditorField locale={locale} field="contact_preference"><select value={draft.contact_preference} onChange={event => setDraft(d => ({ ...d, contact_preference: event.target.value as OrganizationEditorDraft["contact_preference"] }))}><option value="platform_message">{L("Platform message", "پیام سامانه")}</option><option value="phone">{L("Telephone", "تلفن")}</option><option value="email">{L("Email", "ایمیل")}</option></select></EditorField>
        {permissions.private_contact ? <EditorField locale={locale} field="contact_value"><input dir="ltr" autoComplete="off" value={draft.contact_value} onChange={event => setDraft(d => ({ ...d, contact_value: event.target.value }))}/></EditorField> : <p className="fc112-editor-note">{L("Private contact details are available only to authorized current staff.", "اطلاعات تماس خصوصی فقط در دسترس کارکنان فعلی مجاز است.")}</p>}
        <label className="fc112-editor-check"><input type="checkbox" checked={draft.publication_consent} disabled={!permissions.initial_publication && !draft.publication_consent} onChange={event => setDraft(d => ({ ...d, publication_consent: event.target.checked }))}/><span>{L("I consent to publishing this organization profile. I can withdraw this consent later.", "با انتشار نمایه این سازمان موافقم. می‌توانم بعداً این رضایت را پس بگیرم.")}</span></label>
      </fieldset>
      <button type="submit" disabled={saving || !permissions.edit || (state.phase === "conflict" && state.reconsentRequired)}>{saving ? L("Saving…", "ذخیره…") : L("Save organization", "ذخیره سازمان")}</button>
    </form>
  </>;
}

/**
 * R114-04 (Master AI R113 handoff D21) — FEI Classic's native organization
 * staff lifecycle over the shared headless hooks: live roster (current vs
 * former vs pending), the invitee-decides invitation flow, and honest answer
 * refusals (revoked 409 / expired 410 / gone 404 / unknown). Self-targeted
 * role changes and self-revocation are blocked outright.
 */
export function FeiOrganizationStaffSection({ organizationId, platform, user, locale = "en" }: Omit<Props, "organizationId"> & { organizationId?: number | null }) {
  const scope = usePrincipalScope(user, null);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
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
  const entries = roster.phase === "ready" || roster.phase === "reloading" ? roster.entries : [];
  const memberships = entries.filter((entry): entry is OrganizationRosterMembership => entry.kind === "membership");
  const invites = entries.filter((entry) => entry.kind === "invite");
  return <section className="fc112-editor" aria-label={L("Membership and invitations", "عضویت و دعوت‌ها")} data-surface="organization-staff">
    <h2>{pick(ORGANIZATION_STAFF.rosterTitle, locale)}</h2>
    <p>{pick(ORGANIZATION_STAFF.rosterNote, locale)}</p>
    {roster.phase === "loading" ? <EditorNotice locale={locale} title={L("Loading the membership roster…", "بارگذاری فهرست عضویت…")}/> : null}
    {roster.phase === "forbidden" ? <EditorNotice locale={locale} alert title={pick(ORGANIZATION_STAFF.notCurrentStaff, locale)}><p dir="auto">{roster.reason}</p></EditorNotice> : null}
    {roster.phase === "unavailable" || roster.phase === "error" ? <EditorNotice locale={locale} alert title={L("The membership roster is unavailable.", "فهرست عضویت در دسترس نیست.")}><p dir="auto">{roster.reason}</p><button type="button" onClick={retry}>{L("Try loading again", "تلاش دوباره")}</button></EditorNotice> : null}
    {(roster.phase === "ready" || roster.phase === "reloading") ? <>
      {memberships.length ? <ul className="fc112-editor-checks" role="list">
        {memberships.map(member => <li key={member.user_id} className="fc112-editor-check">
          <strong dir="ltr">{member.user_id}</strong>
          <small>{L("Role", "نقش")}: {member.role} · {member.is_current ? pick(ORGANIZATION_STAFF.current, locale) : pick(ORGANIZATION_STAFF.former, locale)}</small>
          {member.email ? <small dir="ltr">{member.email}</small> : null}
          {member.revoked_at ? <small dir="auto">{L("Revoked", "لغو شده")}: {member.revoked_at.slice(0, 10)}{member.revoke_reason ? ` — ${member.revoke_reason}` : ""}</small> : null}
          {member.valid_until && !member.revoked_at ? <small>{L("Valid until", "معتبر تا")}: {member.valid_until.slice(0, 10)}</small> : null}
          {viewerId !== null && member.user_id === viewerId ? <small>{pick(ORGANIZATION_STAFF.selfBlocked, locale)}</small> : member.is_current ? <div className="fc112-editor-grid">
            <label><span>{pick(ORGANIZATION_STAFF.changeRole, locale)}</span><select value={roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner")} disabled={commands.roleChange.state.phase === "submitting"} onChange={event => setRoleDraft(prev => ({ ...prev, [member.user_id]: event.target.value as "member" | "manager" | "owner" }))}>{(["member", "manager", "owner"] as const).map(role => <option key={role} value={role}>{role}</option>)}</select></label>
            <button type="button" disabled={commands.roleChange.state.phase === "submitting" || (roleDraft[member.user_id] ?? member.role) === member.role} onClick={() => { const nextRole = roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner"); void commands.roleChange.run(async () => { const result = await platform!.modules.organizations.setStaffRole(activeId, member.user_id, nextRole); retry(); return result; }, { successMessage: L("Role changed.", "نقش تغییر کرد.") }); }}>{pick(ORGANIZATION_STAFF.changeRole, locale)}</button>
            <input dir="auto" maxLength={500} placeholder={pick(ORGANIZATION_STAFF.revokeReason, locale)} value={revokeDraft[member.user_id] ?? ""} disabled={commands.revoke.state.phase === "submitting"} onChange={event => setRevokeDraft(prev => ({ ...prev, [member.user_id]: event.target.value }))}/>
            <button type="button" disabled={commands.revoke.state.phase === "submitting" || (revokeDraft[member.user_id] ?? "").trim().length < 3} onClick={() => { void commands.revoke.run(async () => { const result = await platform!.modules.organizations.revokeStaff(activeId, member.user_id, (revokeDraft[member.user_id] ?? "").trim()); retry(); return result; }, { successMessage: pick(ORGANIZATION_STAFF.revokeNote, locale) }); }}>{pick(ORGANIZATION_STAFF.revokeMembership, locale)}</button>
          </div> : null}
        </li>)}
      </ul> : <EditorNotice locale={locale} title={L("No memberships yet.", "هنوز عضویتی نیست.")}/>}
      {invites.length ? <details className="fc112-editor-areas"><summary>{L("Pending and past invitations", "دعوت‌های در انتظار و گذشته")}</summary><ul className="fc112-editor-checks" role="list">{invites.map(invite => <li key={invite.id} className="fc112-editor-check"><strong dir="ltr">{invite.invitee_user_id}</strong><small>{pick(ORGANIZATION_STAFF.proposedRole, locale)}: {invite.proposed_role} · {invite.status}</small>{invite.expires_at ? <small>{L("Expires", "انقضا")}: {invite.expires_at.slice(0, 10)}</small> : null}</li>)}</ul><p>{pick(ORGANIZATION_STAFF.inviteConsent, locale)}</p></details> : null}
      <details className="fc112-editor-areas"><summary>{pick(ORGANIZATION_STAFF.inviteForm, locale)}</summary>
        <p>{pick(ORGANIZATION_STAFF.inviteConsent, locale)}</p>
        <form onSubmit={event => { event.preventDefault(); void commands.invite.run(async () => { const result = await platform!.modules.organizations.invite(activeId, { invitee_user_id: invitee.trim(), proposed_role: proposedRole, note: inviteNote.trim() || null }); setInvitee(""); setInviteNote(""); retry(); return result; }, { successMessage: L("Invitation sent.", "دعوت ارسال شد.") }); }}>
          <div className="fc112-editor-grid">
            <label><span>{L("User id", "شناسه کاربر")}</span><input required minLength={3} maxLength={64} dir="ltr" value={invitee} onChange={event => setInvitee(event.target.value)}/></label>
            <label><span>{pick(ORGANIZATION_STAFF.proposedRole, locale)}</span><select value={proposedRole} onChange={event => setProposedRole(event.target.value as "member" | "manager" | "owner")}>{(["member", "manager", "owner"] as const).map(role => <option key={role} value={role}>{role}</option>)}</select></label>
            <label><span>{pick(ORGANIZATION_STAFF.inviteNote, locale)}</span><input maxLength={500} dir="auto" value={inviteNote} onChange={event => setInviteNote(event.target.value)}/></label>
          </div>
          <button type="submit" disabled={commands.invite.state.phase === "submitting" || commands.invite.state.phase === "failed"}>{pick(ORGANIZATION_STAFF.sendInvite, locale)}</button>
        </form>
      </details>
      {commands.invite.state.phase !== "idle" ? <EditorNotice locale={locale} alert={commands.invite.state.phase === "rejected" || commands.invite.state.phase === "failed"} title={commands.invite.state.phase === "accepted" ? L("Invitation sent.", "دعوت ارسال شد.") : commandFeedback(commands.invite.state)}><button type="button" onClick={() => { commands.invite.reset(); retry(); }}>{L("Reload roster", "بارگذاری دوباره فهرست")}</button></EditorNotice> : null}
      {commands.roleChange.state.phase !== "idle" ? <EditorNotice locale={locale} alert={commands.roleChange.state.phase === "rejected" || commands.roleChange.state.phase === "failed"} title={commands.roleChange.state.phase === "accepted" ? L("Role changed.", "نقش تغییر کرد.") : commandFeedback(commands.roleChange.state)}><button type="button" onClick={() => { commands.roleChange.reset(); retry(); }}>{L("Reload roster", "بارگذاری دوباره فهرست")}</button></EditorNotice> : null}
      {commands.revoke.state.phase !== "idle" ? <EditorNotice locale={locale} alert={commands.revoke.state.phase === "rejected" || commands.revoke.state.phase === "failed"} title={commands.revoke.state.phase === "accepted" ? L("Membership revoked. The former staff member loses every organization capability immediately.", "عضویت لغو شد. کارمند سابق فوراً همه توانمندی‌های سازمان را از دست می‌دهد.") : commandFeedback(commands.revoke.state)}><button type="button" onClick={() => { commands.revoke.reset(); retry(); }}>{L("Reload roster", "بارگذاری دوباره فهرست")}</button></EditorNotice> : null}
    </> : null}
    <p>{pick(ORGANIZATION_STAFF.personNotMembership, locale)}</p>
  </section>;
}

/** The invitee's own cross-organization inbox (R114-04) with honest answer refusals. */
export function FeiMyOrganizationInvitations({ platform, user, locale = "en" }: Omit<Props, "organizationId">) {
  const scope = usePrincipalScope(user, null);
  const L = (en: string, fa: string) => editorText(locale, en, fa);
  const commands = useOrganizationStaffCommands(scope);
  const mine = useMyOrganizationInvitations({ platform, scope, userId: user?.id ?? null, enabled: user != null });
  const [answerFailure, setAnswerFailure] = useState<string | null>(null);
  if (!user) return null;
  return <section className="fc112-editor" aria-label={pick(ORGANIZATION_STAFF.myInvitations, locale)} data-surface="organization-invitations">
    <h2>{pick(ORGANIZATION_STAFF.myInvitations, locale)}</h2>
    {mine.phase === "loading" ? <EditorNotice locale={locale} title={L("Loading your invitations…", "بارگذاری دعوت‌های شما…")}/> : null}
    {mine.phase === "unavailable" || mine.phase === "error" ? <EditorNotice locale={locale} alert title={L("Your invitation list is unavailable.", "فهرست دعوت شما در دسترس نیست.")}><p dir="auto">{mine.reason}</p><button type="button" onClick={mine.retry}>{L("Try loading again", "تلاش دوباره")}</button></EditorNotice> : null}
    {mine.phase === "ready" ? (mine.invitations.length ? <ul className="fc112-editor-checks" role="list">
      {mine.invitations.map(invitation => <li key={invitation.id} className="fc112-editor-check">
        <strong dir="auto">{invitation.name_latin ?? invitation.name_native ?? `#${invitation.organization_id}`}</strong>
        <small>{pick(ORGANIZATION_STAFF.proposedRole, locale)}: {invitation.proposed_role} · {L("expires", "انقضا")}: {(invitation.expires_at ?? "").slice(0, 10)}</small>
        {invitation.note ? <small dir="auto">{invitation.note}</small> : null}
        {invitation.actionable ? <div className="fc112-editor-grid">
          <button type="button" disabled={commands.respond.state.phase === "submitting"} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => { try { const result = await platform!.modules.organizations.respondInvite(invitation.id, true); mine.retry(); return result; } catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; } }, { successMessage: L("Invitation accepted. Your membership is checked live on every request.", "دعوت پذیرفته شد. عضویت شما در هر درخواست زنده بررسی می‌شود.") }); }}>{pick(ORGANIZATION_STAFF.accept, locale)}</button>
          <button type="button" disabled={commands.respond.state.phase === "submitting"} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => { try { const result = await platform!.modules.organizations.respondInvite(invitation.id, false); mine.retry(); return result; } catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; } }, { successMessage: L("Invitation declined.", "دعوت رد شد.") }); }}>{pick(ORGANIZATION_STAFF.decline, locale)}</button>
        </div> : <small>{unanswerableInvitationReason(invitation) === "expired" ? pick(ORGANIZATION_STAFF.expiredAnswer, locale) : pick(ORGANIZATION_STAFF.revokedAnswer, locale)}</small>}
      </li>)}
    </ul> : <EditorNotice locale={locale} title={L("You have no pending organization invitations.", "دعوت سازمانی در انتظار ندارید.")}/>) : null}
    {answerFailure ? <EditorNotice locale={locale} alert title={answerFailure}/> : null}
    {commands.respond.state.phase !== "idle" ? <EditorNotice locale={locale} alert={commands.respond.state.phase === "rejected" || commands.respond.state.phase === "failed"} title={commands.respond.state.phase === "accepted" ? L("Answered.", "پاسخ داده شد.") : commandFeedback(commands.respond.state)}><button type="button" onClick={() => { commands.respond.reset(); mine.retry(); }}>{L("Reload invitations", "بارگذاری دوباره دعوت‌ها")}</button></EditorNotice> : null}
  </section>;
}
