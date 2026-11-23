import React, { useState } from "react";
import { useOrganizationEditorController, usePrincipalScope, ORGANIZATION_ONBOARDING_EXPLAINER, ORGANIZATION_STAFF, classifyInvitationFailure, commandFeedback, unanswerableInvitationReason, useMyOrganizationInvitations, useOrganizationRoster, useOrganizationStaffCommands, type OrganizationEditorDraft, type OrganizationRosterMembership, type PlatformClient, type PlatformUser } from "../../../frontend-kit";
import { IRAN_PROVINCES, SERVICE_CATEGORIES, PROVINCE_CODE_SCHEME } from "../../../frontend-kit";

/**
 * R98-N07 — Classic Registry's compact organization editor (host layer, iframe
 * boundary intact): the same ONE shared headless controller
 * (useOrganizationEditorController) with Classic Registry's compact visual
 * treatment. Distinct states, private contact only for current staff,
 * field-level conflict diffs, no auto-resubmission of withdrawn consent.
 */

const style: React.CSSProperties = { border: "1px solid #b45309", background: "#fffbeb", padding: "12px", margin: "10px 0", borderRadius: "4px" };
const label: React.CSSProperties = { display: "block", margin: "8px 0", fontSize: "14px" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: "6px", marginTop: "4px", border: "1px solid #92400e", borderRadius: "3px" };
const button: React.CSSProperties = { padding: "8px 14px", background: "#92400e", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer", marginTop: "8px" };
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function ClassicRegistryOrganizationEditor({ organizationId, platform, user }: { organizationId: number | null; platform: PlatformClient | null; user?: PlatformUser | null }) {
  // R107 NEXT-05: the managed-organization view is private — it keys on the
  // calling principal so an account switch re-keys it.
  const principalScope = usePrincipalScope(user, null);
  const { state, updateDraft, submit, reconsentPublication, adoptAllServerValues, retryWithCurrentVersion, retry } = useOrganizationEditorController(organizationId, platform, principalScope);
  const setDraft = (mutate: (d: OrganizationEditorDraft) => OrganizationEditorDraft) => updateDraft(mutate);

  const staffSurfaces = (<>
    <ClassicRegistryOrganizationStaffSection organizationId={organizationId} platform={platform} user={user} scope={principalScope} />
    <ClassicRegistryMyOrganizationInvitations platform={platform} user={user} scope={principalScope} />
  </>);
  if (state.phase === "loading") return <><p role="status" style={style}>Loading organization editor…</p>{staffSurfaces}</>;
  if (state.phase === "denied") return <><div role="alert" style={style}><p>Cannot manage this organization.</p><p>{state.reason}</p><p>Only current staff may manage it — a former employee retains nothing.</p></div>{staffSurfaces}</>;
  if (state.phase === "unavailable") return <><div role="alert" style={style}><p>Organization editor unavailable.</p><p>{state.reason}</p><button style={button} onClick={retry}>Retry</button></div>{staffSurfaces}</>;

  const { draft, permissions } = state;
  return (
    <>
    <section style={style} aria-label="Classic Registry organization editor">
      <h3 style={{ margin: "0 0 8px" }}>Organization editor {state.phase === "empty" ? "(first creation)" : `(v${state.stored?.row_version ?? 0})`}</h3>
      {state.phase === "saved" ? <p role="status">Saved — {state.publication}</p> : null}
      {state.phase === "conflict" ? (
        <div role="alert" style={{ ...style, borderColor: "#b91c1c", background: "#fef2f2" }}>
          <p>The organization changed elsewhere — your draft is kept. Review:</p>
          <ul>{state.differences.map((d) => <li key={d.field}><strong>{d.field}</strong>: draft “{d.local}” vs current “{d.server}”</li>)}</ul>
          {state.reconsentRequired ? (
            <><p>Publication consent was withdrawn on the server; nothing is resubmitted automatically.</p><button style={button} onClick={reconsentPublication}>Re-consent to publication</button></>
          ) : (
            <><button style={button} onClick={retryWithCurrentVersion}>Retry draft at current version</button> <button style={button} onClick={adoptAllServerValues}>Adopt current values</button></>
          )}
        </div>
      ) : null}
      <label style={label}>Description<textarea style={input} rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></label>
      <div style={label}>Services{SERVICE_CATEGORIES.map((c) => (
        <label key={c.id} style={{ marginRight: "10px" }}><input type="checkbox" checked={draft.service_categories.includes(c.id)}
          onChange={(e) => setDraft((d) => ({ ...d, service_categories: e.target.checked ? [...d.service_categories, c.id] : d.service_categories.filter((x) => x !== c.id) }))} />{c.en}</label>
      ))}</div>
      <label style={label}>Specialties<input style={input} value={draft.specialties.join(", ")} onChange={(e) => setDraft((d) => ({ ...d, specialties: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))} /></label>
      <div style={label}>Service areas{IRAN_PROVINCES.slice(0, 12).map((p) => (
        <label key={p.code} style={{ marginRight: "8px" }}><input type="checkbox" checked={draft.service_areas.includes(p.code)}
          onChange={(e) => setDraft((d) => ({ ...d, service_areas: e.target.checked ? [...d.service_areas, p.code] : d.service_areas.filter((x) => x !== p.code) }))} />{p.code}</label>
      ))}<p style={{ fontSize: "12px", color: "#92400e" }}>{draft.service_areas.length} province(s) selected</p></div>
      <label style={label}>Accessibility<input style={input} value={draft.accessibility_notes} onChange={(e) => setDraft((d) => ({ ...d, accessibility_notes: e.target.value }))} /></label>
      <div style={label}>Opening hours{WEEKDAYS.map((day) => (
        <label key={day} style={{ display: "inline-block", marginRight: "8px", fontSize: "13px" }}>{day} <input style={{ width: "90px" }} value={draft.opening_hours[day] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, opening_hours: { ...d.opening_hours, [day]: e.target.value } }))} /></label>
      ))}</div>
      <label style={label}>Province [{PROVINCE_CODE_SCHEME}]
        <select style={input} value={draft.province_code} onChange={(e) => setDraft((d) => ({ ...d, province_code: e.target.value, province_scheme_confirmed: e.target.value !== "" }))}>
          <option value="">(not set)</option>{IRAN_PROVINCES.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
        </select>
      </label>
      <label style={label}>City<input style={input} value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} /></label>
      <label style={label}>Contact preference
        <select style={input} value={draft.contact_preference} onChange={(e) => setDraft((d) => ({ ...d, contact_preference: e.target.value as OrganizationEditorDraft["contact_preference"] }))}>
          <option value="platform_message">platform_message</option><option value="phone">phone</option><option value="email">email</option>
        </select>
      </label>
      {permissions.private_contact
        ? <label style={label}>Contact value (private, current staff)<input style={input} dir="ltr" value={draft.contact_value} onChange={(e) => setDraft((d) => ({ ...d, contact_value: e.target.value }))} /></label>
        : <p style={{ fontSize: "13px", color: "#92400e" }}>Curator mode: the contact route is private to current staff — not loaded, not rendered, not submitted.</p>}
      <label style={label}><input type="checkbox" checked={draft.publication_consent} onChange={(e) => setDraft((d) => ({ ...d, publication_consent: e.target.checked }))} /> Publication consent (withdrawable)</label>
      <button style={button} onClick={submit} disabled={state.phase === "saving" || (state.phase === "conflict" && state.reconsentRequired)}>{state.phase === "saving" ? "Saving…" : "Save organization"}</button>
      <hr style={{ margin: "12px 0" }} />
      <h4 style={{ margin: "6px 0" }}>Who is who</h4>
      <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>{ORGANIZATION_ONBOARDING_EXPLAINER.map((e) => <li key={e.concept}>{e.en}</li>)}</ul>
    </section>
    {staffSurfaces}
    </>  );
}

/**
 * R114-04 (Master AI R113 handoff D21) — Classic Registry's compact native
 * staff lifecycle: live roster (current vs former vs pending), the
 * invitee-decides invitation flow, honest answer refusals (revoked 409 /
 * expired 410 / gone 404 / unknown). Self-targeted role changes and
 * self-revocation are blocked outright. Classic is EN-only by design.
 */
export function ClassicRegistryOrganizationStaffSection({ organizationId, platform, user, scope }: { organizationId: number | null; platform: PlatformClient | null; user?: PlatformUser | null; scope?: string }) {
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
  const entries = roster.phase === "ready" || roster.phase === "reloading" ? roster.entries : [];
  const memberships = entries.filter((entry): entry is OrganizationRosterMembership => entry.kind === "membership");
  const invites = entries.filter((entry) => entry.kind === "invite");
  return (
    <section style={style} aria-label="Classic Registry organization staff" data-surface="organization-staff">
      <h3 style={{ margin: "0 0 8px" }}>{T.rosterTitle.en}</h3>
      <p style={{ fontSize: "13px", color: "#92400e" }}>{T.rosterNote.en}</p>
      {roster.phase === "loading" ? <p role="status">Loading the membership roster…</p> : null}
      {roster.phase === "forbidden" ? <div role="alert" style={style}><p>{T.notCurrentStaff.en}</p><p>{roster.reason}</p></div> : null}
      {roster.phase === "unavailable" || roster.phase === "error" ? <div role="alert" style={style}><p>Membership roster unavailable.</p><p>{roster.reason}</p><button style={button} onClick={retry}>Retry</button></div> : null}
      {(roster.phase === "ready" || roster.phase === "reloading") ? <>
        {memberships.length ? <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>{memberships.map((member) => (
          <li key={member.user_id}>
            <strong dir="ltr">{member.user_id}</strong> — {member.role} · {member.is_current ? T.current.en : T.former.en}
            {member.email ? <span dir="ltr"> ({member.email})</span> : null}
            {member.revoked_at ? <div style={{ fontSize: "12px", color: "#92400e" }}>Revoked {member.revoked_at.slice(0, 10)}{member.revoke_reason ? ` — ${member.revoke_reason}` : ""}</div> : null}
            {member.valid_until && !member.revoked_at ? <div style={{ fontSize: "12px" }}>Valid until {member.valid_until.slice(0, 10)}</div> : null}
            {viewerId !== null && member.user_id === viewerId ? <div style={{ fontSize: "12px", color: "#92400e" }}>{T.selfBlocked.en}</div> : member.is_current ? <div style={{ margin: "6px 0" }}>
              <label style={label}>{T.changeRole.en}<select style={input} value={roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner")} disabled={commands.roleChange.state.phase === "submitting"} onChange={(e) => setRoleDraft((prev) => ({ ...prev, [member.user_id]: e.target.value as "member" | "manager" | "owner" }))}>{(["member", "manager", "owner"] as const).map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
              <button style={button} disabled={commands.roleChange.state.phase === "submitting" || (roleDraft[member.user_id] ?? member.role) === member.role} onClick={() => { const nextRole = roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner"); void commands.roleChange.run(async () => { const result = await platform!.modules.organizations.setStaffRole(activeId, member.user_id, nextRole); retry(); return result; }, { successMessage: "Role changed." }); }}>Change role</button>
              <label style={label}>{T.revokeReason.en}<input style={input} maxLength={500} value={revokeDraft[member.user_id] ?? ""} disabled={commands.revoke.state.phase === "submitting"} onChange={(e) => setRevokeDraft((prev) => ({ ...prev, [member.user_id]: e.target.value }))} /></label>
              <button style={button} disabled={commands.revoke.state.phase === "submitting" || (revokeDraft[member.user_id] ?? "").trim().length < 3} onClick={() => { void commands.revoke.run(async () => { const result = await platform!.modules.organizations.revokeStaff(activeId, member.user_id, (revokeDraft[member.user_id] ?? "").trim()); retry(); return result; }, { successMessage: T.revokeNote.en }); }}>{T.revokeMembership.en}</button>
            </div> : null}
          </li>
        ))}</ul> : <p>No memberships yet.</p>}
        {invites.length ? <details><summary>Pending and past invitations</summary><ul style={{ margin: "4px 0", paddingLeft: "18px" }}>{invites.map((invite) => (
          <li key={invite.id}><strong dir="ltr">{invite.invitee_user_id}</strong> — {T.proposedRole.en}: {invite.proposed_role} · {invite.status}{invite.expires_at ? ` · expires ${invite.expires_at.slice(0, 10)}` : ""}</li>
        ))}</ul><p style={{ fontSize: "12px", color: "#92400e" }}>{T.inviteConsent.en}</p></details> : null}
        <details><summary>{T.inviteForm.en}</summary>
          <p style={{ fontSize: "12px", color: "#92400e" }}>{T.inviteConsent.en}</p>
          <form onSubmit={(event) => { event.preventDefault(); void commands.invite.run(async () => { const result = await platform!.modules.organizations.invite(activeId, { invitee_user_id: invitee.trim(), proposed_role: proposedRole, note: inviteNote.trim() || null }); setInvitee(""); setInviteNote(""); retry(); return result; }, { successMessage: "Invitation sent. The invitee decides." }); }}>
            <label style={label}>User id<input style={input} required minLength={3} maxLength={64} dir="ltr" value={invitee} onChange={(e) => setInvitee(e.target.value)} /></label>
            <label style={label}>{T.proposedRole.en}<select style={input} value={proposedRole} onChange={(e) => setProposedRole(e.target.value as "member" | "manager" | "owner")}>{(["member", "manager", "owner"] as const).map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <label style={label}>{T.inviteNote.en}<input style={input} maxLength={500} value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} /></label>
            <button type="submit" style={button} disabled={commands.invite.state.phase === "submitting" || commands.invite.state.phase === "failed"}>{T.sendInvite.en}</button>
          </form>
        </details>
        {commands.invite.state.phase !== "idle" ? <div role="alert" style={style}><p>{commandFeedback(commands.invite.state)}</p><button style={button} onClick={() => { commands.invite.reset(); retry(); }}>Reload roster</button></div> : null}
        {commands.roleChange.state.phase !== "idle" ? <div role="alert" style={style}><p>{commandFeedback(commands.roleChange.state)}</p><button style={button} onClick={() => { commands.roleChange.reset(); retry(); }}>Reload roster</button></div> : null}
        {commands.revoke.state.phase !== "idle" ? <div role="alert" style={style}><p>{commandFeedback(commands.revoke.state)}</p><button style={button} onClick={() => { commands.revoke.reset(); retry(); }}>Reload roster</button></div> : null}
      </> : null}
      <p style={{ fontSize: "12px", color: "#92400e" }}>{T.personNotMembership.en}</p>
    </section>
  );
}

/** The invitee's own cross-organization inbox (R114-04) with honest answer refusals. */
export function ClassicRegistryMyOrganizationInvitations({ platform, user, scope }: { platform: PlatformClient | null; user?: PlatformUser | null; scope?: string }) {
  const commands = useOrganizationStaffCommands(scope);
  const mine = useMyOrganizationInvitations({ platform, scope, userId: user?.id ?? null, enabled: user != null });
  const [answerFailure, setAnswerFailure] = useState<string | null>(null);
  const T = ORGANIZATION_STAFF;
  if (!user) return null;
  return (
    <section style={style} aria-label="Classic Registry my organization invitations" data-surface="organization-invitations">
      <h3 style={{ margin: "0 0 8px" }}>{T.myInvitations.en}</h3>
      {mine.phase === "loading" ? <p role="status">Loading your invitations…</p> : null}
      {mine.phase === "unavailable" || mine.phase === "error" ? <div role="alert" style={style}><p>Your invitation list is unavailable.</p><p>{mine.reason}</p><button style={button} onClick={mine.retry}>Retry</button></div> : null}
      {mine.phase === "ready" ? (mine.invitations.length ? <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>{mine.invitations.map((invitation) => (
        <li key={invitation.id}>
          <strong dir="auto">{invitation.name_latin ?? invitation.name_native ?? `#${invitation.organization_id}`}</strong> — {T.proposedRole.en}: {invitation.proposed_role} · expires {(invitation.expires_at ?? "").slice(0, 10)}
          {invitation.note ? <div style={{ fontSize: "12px" }} dir="auto">{invitation.note}</div> : null}
          {invitation.actionable ? <div style={{ margin: "6px 0" }}>
            <button style={button} disabled={commands.respond.state.phase === "submitting"} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => { try { const result = await platform!.modules.organizations.respondInvite(invitation.id, true); mine.retry(); return result; } catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; } }, { successMessage: "Invitation accepted. Your membership is checked live on every request." }); }}>{T.accept.en}</button>{" "}
            <button style={button} disabled={commands.respond.state.phase === "submitting"} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => { try { const result = await platform!.modules.organizations.respondInvite(invitation.id, false); mine.retry(); return result; } catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; } }, { successMessage: "Invitation declined." }); }}>{T.decline.en}</button>
          </div> : <div style={{ fontSize: "12px", color: "#92400e" }}>{unanswerableInvitationReason(invitation) === "expired" ? T.expiredAnswer.en : T.revokedAnswer.en}</div>}
        </li>
      ))}</ul> : <p>You have no pending organization invitations.</p>) : null}
      {answerFailure ? <div role="alert" style={style}><p>{answerFailure}</p></div> : null}
      {commands.respond.state.phase !== "idle" ? <div role="alert" style={style}><p>{commandFeedback(commands.respond.state)}</p><button style={button} onClick={() => { commands.respond.reset(); mine.retry(); }}>Reload invitations</button></div> : null}
    </section>
  );
}
