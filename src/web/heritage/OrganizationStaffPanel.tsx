import { uiText } from "../../shared/uiLocale";
import "../styles/heritage.workbenches.css";
import React, { useState } from "react";
import {
  ORGANIZATION_STAFF,
  classifyInvitationFailure,
  unanswerableInvitationReason,
  useMyOrganizationInvitations,
  useOrganizationRoster,
  useOrganizationStaffCommands,
  type OrganizationRosterMembership,
  type PlatformClient,
  type PlatformUser,
} from "../../frontend-kit";
import { HeritageCommandNotice } from "./DomainFeedback";
import { useI18n } from "../i18n";

/**
 * R114-04 (Master AI R113 handoff D21) — Heritage's native organization
 * staff lifecycle. The backend evaluates every membership LIVE; this panel
 * renders that honesty:
 *
 *  - The roster is readable by CURRENT staff only. A 403 answer (revoked
 *    mid-session, stale UI) renders an explicit notice and never paints a
 *    private row — the former member sees nothing further.
 *  - Invitations are the invitee's decision; pending invitations expire
 *    honestly and a revoked invitation can no longer be answered (409),
 *    an expired one reports 410, an already-answered one is gone (404).
 *  - Self-targeted role changes and self-revocation are blocked in the UI
 *    outright; the server enforces it again on every request.
 *  - Memberships are USER-account facts; person profiles and person-level
 *    officiating roles are separate entities (visible in the copy).
 */

function RosterNotice({ phase, reason, retry, L }: { phase: string; reason?: string; retry: () => void; L: (en: string, fa: string) => string }) {
  if (phase === "loading") return <p role="status" className="h-mod-state-note">{L("Loading the membership roster…", "در حال بارگذاری فهرست عضویت…")}</p>;
  if (phase === "forbidden")
    return (
      <div role="alert" className="h-mod-state-note">
        <p>{L("Only CURRENT staff can view this organization's membership roster.", "فقط کارکنان جاری می‌توانند فهرست عضویت این سازمان را ببینند.")}</p>
        <p dir="auto">{reason}</p>
        <p>{L("If your membership was just revoked, this view shows nothing further. Memberships are evaluated live on every request.", "اگر عضویت شما تازه لغو شده، این نمای هیچ چیز بیشتری نشان نمی‌دهد. عضویت‌ها در هر درخواست زنده ارزیابی می‌شوند.")}</p>
      </div>
    );
  if (phase === "unavailable" || phase === "error")
    return (
      <div role="alert" className="h-mod-state-note">
        <p>{L("The membership roster is unavailable.", "فهرست عضویت در دسترس نیست.")}</p>
        <p dir="auto">{reason}</p>
        <button type="button" className="h-mod-button" onClick={retry}>{L("Retry", "تلاش دوباره")}</button>
      </div>
    );
  if (phase === "empty") return <p className="h-mod-state-note">{L("No memberships or invitations yet.", "هنوز عضویت یا دعوتی نیست.")}</p>;
  return null;
}

export function HeritageOrganizationStaffPanel({ organizationId, platform, user, scope }: {
  organizationId: number; platform: PlatformClient | null; user?: PlatformUser | null; scope?: string;
}) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const pick = (entry: { en: string; fa: string }) => (locale === "fa" ? entry.fa : entry.en);
  const commands = useOrganizationStaffCommands(scope);
  const { roster, retry } = useOrganizationRoster({ organizationId, platform, scope, userId: user?.id ?? null });
  const [invitee, setInvitee] = useState("");
  const [proposedRole, setProposedRole] = useState<"member" | "manager" | "owner">("member");
  const [inviteNote, setInviteNote] = useState("");
  const [roleDraft, setRoleDraft] = useState<Record<string, "member" | "manager" | "owner">>({});
  const [revokeDraft, setRevokeDraft] = useState<Record<string, string>>({});
  const viewerId = user?.id ?? null;
  const inviteBusy = commands.invite.state.phase === "submitting";
  const inviteBlocked = inviteBusy || commands.invite.state.phase === "failed";
  const refresh = () => { retry(); };

  const memberships = (roster.phase === "ready" || roster.phase === "reloading" ? roster.entries.filter((e): e is OrganizationRosterMembership => e.kind === "membership") : []);
  const invites = roster.phase === "ready" || roster.phase === "reloading" ? roster.entries.filter((e) => e.kind === "invite") : [];

  return (
    <section data-h-surface-role="panel" aria-labelledby="organization-staff-title">
      <h2 id="organization-staff-title">{pick(ORGANIZATION_STAFF.rosterTitle)}</h2>
      <p className="h-mod-note">{pick(ORGANIZATION_STAFF.rosterNote)}</p>
      <RosterNotice phase={roster.phase} reason={roster.phase === "forbidden" || roster.phase === "unavailable" || roster.phase === "error" ? roster.reason : undefined} retry={retry} L={L} />
      {(roster.phase === "ready" || roster.phase === "reloading") ? (
        <>
          {memberships.length ? (
            <ul className="h-mod-task-list">
              {memberships.map((member) => (
                <li key={member.user_id}>
                  <div className="registry-row-clickable">
                    <strong dir="ltr">{member.user_id}</strong>
                    {member.email ? <small dir="ltr">{member.email}</small> : null}
                    <small>{L("Role", "نقش")}: {member.role} · {member.is_current ? pick(ORGANIZATION_STAFF.current) : pick(ORGANIZATION_STAFF.former)}</small>
                    {member.revoked_at ? <small dir="auto">{L("Revoked", "لغو شده")}: {member.revoked_at.slice(0, 10)}{member.revoke_reason ? ` — ${member.revoke_reason}` : ""}</small> : null}
                    {member.valid_until && !member.revoked_at ? <small>{L("Valid until", "معتبر تا")}: {member.valid_until.slice(0, 10)}</small> : null}
                  </div>
                  {viewerId !== null && member.user_id === viewerId ? (
                    <p className="h-mod-state-note">{pick(ORGANIZATION_STAFF.selfBlocked)}</p>
                  ) : member.is_current ? (
                    <div className="table-actions">
                      <label className="h-mod-field"><span>{pick(ORGANIZATION_STAFF.changeRole)}</span>
                        <select value={roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner")} disabled={commands.roleChange.state.phase === "submitting"}
                          onChange={(e) => setRoleDraft((prev) => ({ ...prev, [member.user_id]: e.target.value as "member" | "manager" | "owner" }))}>
                          {(["member", "manager", "owner"] as const).map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      </label>
                      <button type="button" className="h-mod-button" disabled={commands.roleChange.state.phase === "submitting" || (roleDraft[member.user_id] ?? member.role) === member.role}
                        onClick={() => {
                          const nextRole = roleDraft[member.user_id] ?? (member.role as "member" | "manager" | "owner");
                          void commands.roleChange.run(async () => {
                            const result = await platform!.modules.organizations.setStaffRole(organizationId, member.user_id, nextRole);
                            refresh(); return result;
                          }, { successMessage: L("Role changed. The roster re-reads current authority.", "نقش تغییر کرد. فهرست، اختیار جاری را دوباره می‌خواند.") });
                        }}>{pick(ORGANIZATION_STAFF.changeRole)}</button>
                      <button type="button" className="h-mod-button" disabled={commands.revoke.state.phase === "submitting"}
                        onClick={() => {
                          const reason = (revokeDraft[member.user_id] ?? "").trim();
                          if (reason.length < 3) return;
                          void commands.revoke.run(async () => {
                            const result = await platform!.modules.organizations.revokeStaff(organizationId, member.user_id, reason);
                            refresh(); return result;
                          }, { successMessage: pick(ORGANIZATION_STAFF.revokeNote) });
                        }}>{pick(ORGANIZATION_STAFF.revokeMembership)}</button>
                      <input className="h-mod-field" placeholder={pick(ORGANIZATION_STAFF.revokeReason)} maxLength={500} dir="auto"
                        value={revokeDraft[member.user_id] ?? ""} disabled={commands.revoke.state.phase === "submitting"}
                        onChange={(e) => setRevokeDraft((prev) => ({ ...prev, [member.user_id]: e.target.value }))} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="h-mod-state-note">{L("No current or former memberships.", "عضویت جاری یا پیشینی نیست.")}</p>}

          {invites.length ? (
            <details><summary>{L("Pending and past invitations", "دعوت‌های در انتظار و گذشته")}</summary>
              <ul className="h-mod-task-list">
                {invites.map((invite) => (
                  <li key={invite.id}>
                    <div className="registry-row-clickable">
                      <strong dir="ltr">{invite.invitee_user_id}</strong>
                      <small>{L("Proposed role", "نقش پیشنهادی")}: {invite.proposed_role} · {invite.status}</small>
                      {invite.expires_at ? <small>{L("Expires", "انقضا")}: {invite.expires_at.slice(0, 10)}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="h-mod-state-note">{pick(ORGANIZATION_STAFF.inviteConsent)}</p>
            </details>
          ) : null}

          <details><summary>{pick(ORGANIZATION_STAFF.inviteForm)}</summary>
            <p className="h-mod-state-note">{pick(ORGANIZATION_STAFF.inviteConsent)}</p>
            <form onSubmit={(event) => { event.preventDefault(); if (inviteBlocked) return; void commands.invite.run(async () => {
              const result = await platform!.modules.organizations.invite(organizationId, {
                invitee_user_id: invitee.trim(), proposed_role: proposedRole, note: inviteNote.trim() || null });
              setInvitee(""); setInviteNote(""); refresh(); return result;
            }, { successMessage: L("Invitation sent. It expires honestly; the invitee decides.", "دعوت ارسال شد. صادقانه منقضی می‌شود؛ طرف دعوت تصمیم می‌گیرد.") }); }}>
              <label className="h-mod-field"><span>{L("User id", "شناسه کاربر")}</span>
                <input required minLength={3} maxLength={64} dir="ltr" value={invitee} disabled={inviteBlocked} onChange={(e) => setInvitee(e.target.value)} />
              </label>
              <label className="h-mod-field"><span>{pick(ORGANIZATION_STAFF.proposedRole)}</span>
                <select value={proposedRole} disabled={inviteBlocked} onChange={(e) => setProposedRole(e.target.value as "member" | "manager" | "owner")}>
                  {(["member", "manager", "owner"] as const).map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <label className="h-mod-field"><span>{pick(ORGANIZATION_STAFF.inviteNote)}</span>
                <input maxLength={500} dir="auto" value={inviteNote} disabled={inviteBlocked} onChange={(e) => setInviteNote(e.target.value)} />
              </label>
              <button type="submit" className="h-mod-button" disabled={inviteBlocked}>{pick(ORGANIZATION_STAFF.sendInvite)}</button>
            </form>
            <HeritageCommandNotice state={commands.invite.state} reload={() => { commands.invite.reset(); refresh(); }} />
          </details>

          {commands.roleChange.state.phase !== "idle" ? <HeritageCommandNotice state={commands.roleChange.state} reload={() => { commands.roleChange.reset(); refresh(); }} /> : null}
          {commands.revoke.state.phase !== "idle" ? <HeritageCommandNotice state={commands.revoke.state} reload={() => { commands.revoke.reset(); refresh(); }} /> : null}
        </>
      ) : null}
      <p className="h-mod-state-note">{pick(ORGANIZATION_STAFF.personNotMembership)}</p>
    </section>
  );
}

/**
 * The invitee's OWN cross-organization inbox (R114-04): pending invitations
 * answerable WITHOUT selecting any organization. Consent is the invitee's
 * decision. Answer refusals map honestly: revoked 409 / expired 410 / gone
 * 404 / unknown otherwise — never translated into a success.
 */
export function HeritageMyOrganizationInvitations({ platform, user, scope, refresh }: {
  platform: PlatformClient | null; user?: PlatformUser | null; scope?: string; refresh?: () => void;
}) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const pick = (entry: { en: string; fa: string }) => (locale === "fa" ? entry.fa : entry.en);
  const commands = useOrganizationStaffCommands(scope);
  const mine = useMyOrganizationInvitations({ platform, scope, userId: user?.id ?? null, enabled: user != null });
  const [answerFailure, setAnswerFailure] = useState<string | null>(null);

  return (
    <section data-h-surface-role="panel" aria-labelledby="my-org-invitations-title">
      <h2 id="my-org-invitations-title">{pick(ORGANIZATION_STAFF.myInvitations)}</h2>
      {mine.phase === "loading" ? <p role="status" className="h-mod-state-note">{L("Loading your invitations…", "در حال بارگذاری دعوت‌های شما…")}</p> : null}
      {mine.phase === "unavailable" || mine.phase === "error" ? (
        <div role="alert" className="h-mod-state-note"><p>{L("Your invitation list is unavailable.", "فهرست دعوت شما در دسترس نیست.")}</p><p dir="auto">{mine.reason}</p>
          <button type="button" className="h-mod-button" onClick={mine.retry}>{L("Retry", "تلاش دوباره")}</button></div>
      ) : null}
      {mine.phase === "ready" ? (mine.invitations.length ? (
        <ul className="h-mod-task-list">
          {mine.invitations.map((invitation) => (
            <li key={invitation.id}>
              <div className="registry-row-clickable">
                <strong dir="auto">{invitation.name_latin ?? invitation.name_native ?? `#${invitation.organization_id}`}</strong>
                <small>{L("Proposed role", "نقش پیشنهادی")}: {invitation.proposed_role} · {L("expires", "انقضا")}: {(invitation.expires_at ?? "").slice(0, 10)}</small>
                {invitation.note ? <small dir="auto">{invitation.note}</small> : null}
              </div>
              {invitation.actionable ? (
                <div className="table-actions">
                  <button type="button" disabled={commands.respond.state.phase === "submitting"} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => {
                    try { const result = await platform!.modules.organizations.respondInvite(invitation.id, true); mine.retry(); refresh?.(); return result; }
                    catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; }
                  }, { successMessage: L("Invitation accepted. Your membership is checked live on every request.", "دعوت پذیرفته شد. عضویت شما در هر درخواست زنده بررسی می‌شود.") }); }}>{pick(ORGANIZATION_STAFF.accept)}</button>
                  <button type="button" disabled={commands.respond.state.phase === "submitting"} onClick={() => { setAnswerFailure(null); void commands.respond.run(async () => {
                    try { const result = await platform!.modules.organizations.respondInvite(invitation.id, false); mine.retry(); return result; }
                    catch (error) { setAnswerFailure(classifyInvitationFailure(error).message); throw error; }
                  }, { successMessage: L("Invitation declined.", "دعوت رد شد.") }); }}>{pick(ORGANIZATION_STAFF.decline)}</button>
                </div>
              ) : (
                <p className="h-mod-state-note">{unanswerableInvitationReason(invitation) === "expired" ? pick(ORGANIZATION_STAFF.expiredAnswer) : pick(ORGANIZATION_STAFF.revokedAnswer)}</p>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="h-mod-state-note">{L("You have no pending organization invitations.", "دعوت سازمانی در انتظار ندارید.")}</p>) : null}
      {answerFailure ? <div role="alert" className="h-mod-state-note"><p dir="auto">{answerFailure}</p></div> : null}
      <HeritageCommandNotice state={commands.respond.state} reload={() => { commands.respond.reset(); mine.retry(); }} />
    </section>
  );
}
