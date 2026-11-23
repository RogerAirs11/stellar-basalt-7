import { uiText } from "../../shared/uiLocale";
import React, { useState } from "react";
import type { PlatformClient } from "../../contracts/platform";
import { HeritageResourceNotice, HeritageCommandNotice } from "./DomainFeedback";
import { useI18n } from "../i18n";
import { useDomainResource, usePlatformCommand, pick as pickText, WORKSPACES } from "../../frontend-kit";

/**
 * R108-13: the Core workspace STAFF journey in Heritage's language — consent
 * before delegation. An owner invites; the invitee decides; authority is
 * re-checked live on every request so a later revoke takes effect
 * immediately. No assignment exists before acceptance, and a departure
 * suppresses only this workspace's queued reminders.
 */

const ACTION_CHOICES = ["view", "tasks_manage"] as const;

export function HeritageWorkspaceStaffPanel({ platform, workspaceId, mayManage, refresh, staff }: {
  platform: PlatformClient; workspaceId: number; mayManage: boolean; refresh: () => void;
  staff: Array<{ user_id: string; actions: string; granted_at: string; status: string }>;
}) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const inviteCommand = usePlatformCommand("workspace-invite");
  const assignCommand = usePlatformCommand("workspace-assign");
  const revokeCommand = usePlatformCommand("workspace-revoke");
  const [invitee, setInvitee] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteActions, setInviteActions] = useState<Record<string, boolean>>({ view: true, tasks_manage: false });
  const [directAssignee, setDirectAssignee] = useState("");

  const chosenActions = ACTION_CHOICES.filter((action) => inviteActions[action]);
  const inviteBlocked = inviteCommand.state.phase === "submitting" || inviteCommand.state.phase === "failed" || chosenActions.length === 0;

  return <section data-h-surface-role="panel" aria-label={L("Staff and invitations", "کارکنان و دعوت‌ها")}>
    <h3>{L("Staff and invitations", "کارکنان و دعوت‌ها")}</h3>
    <p className="h-mod-state-note">{pickText(WORKSPACES.staffConsent, locale)}</p>

    {staff.length ? <ul className="h-mod-task-list">
      {staff.map((member) => <li key={member.user_id}>
        <div className="registry-row-clickable">
          <strong dir="ltr">{member.user_id}</strong>
          <small dir="auto">{L("Actions", "اقدامات")}: {member.actions}</small>
        </div>
        {mayManage ? <div className="table-actions">
          <button type="button" disabled={revokeCommand.state.phase === "submitting"} onClick={() => {
            void revokeCommand.run(async () => {
              const result = await platform.modules.workspaces.revokeStaff(workspaceId, member.user_id);
              refresh(); return result;
            }, { successMessage: L("Staff access revoked. Their queued reminders for this workspace are suppressed.", "دسترسی کارمند لغو شد.") });
          }}>{L("Revoke access", "لغو دسترسی")}</button>
        </div> : null}
      </li>)}
    </ul> : <p>{L("No active staff.", "کارمند فعالی نیست.")}</p>}

    {mayManage ? <details><summary>{L("Invite a staff member", "دعوت کارمند")}</summary>
      <p className="h-mod-state-note">{L("The invitation needs the other person's consent — no assignment exists until they accept.", "دعوت نیاز به رضایت طرف مقابل دارد.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void inviteCommand.run(async () => {
        const result = await platform.modules.workspaces.inviteStaff(workspaceId, { invitee_user_id: invitee.trim(), actions: chosenActions.join(","), note: inviteNote.trim() || null });
        setInvitee(""); setInviteNote(""); refresh(); return result;
      }, { successMessage: L("Invitation sent. It expires honestly after 14 days.", "دعوت ارسال شد؛ پس از ۱۴ روز منقضی می‌شود.") }); }}>
        <label>{L("User id", "شناسه کاربر")}<input required minLength={3} maxLength={64} dir="ltr" value={invitee} disabled={inviteBlocked} onChange={(event) => setInvitee(event.target.value)} /></label>
        <fieldset><legend>{L("Proposed actions", "اقدامات پیشنهادی")}</legend>
          {ACTION_CHOICES.map((action) => <label key={action} className="h-mod-check"><input type="checkbox" checked={inviteActions[action] ?? false} disabled={inviteBlocked} onChange={(event) => setInviteActions((prev) => ({ ...prev, [action]: event.target.checked }))} />{action}</label>)}
        </fieldset>
        <label>{L("Note (optional)", "یادداشت (اختیاری)")}<input maxLength={500} dir="auto" value={inviteNote} disabled={inviteBlocked} onChange={(event) => setInviteNote(event.target.value)} /></label>
        <button type="submit" disabled={inviteBlocked}>{L("Send invitation", "ارسال دعوت")}</button>
      </form>
      <HeritageCommandNotice state={inviteCommand.state} reload={() => { inviteCommand.reset(); refresh(); }} />
    </details> : null}

    {mayManage ? <details><summary>{L("Assign staff directly (your own action)", "انتساب مستقیم کارمند")}</summary>
      <p className="h-mod-state-note">{L("A direct assignment records that YOU granted this access; the invitation flow above is the consent-first path.", "انتساب مستقیم ثبت می‌کند که خود شما این دسترسی را داده‌اید.")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void assignCommand.run(async () => {
        const result = await platform.modules.workspaces.assignStaff(workspaceId, { user_id: directAssignee.trim(), actions: chosenActions.join(",") });
        setDirectAssignee(""); refresh(); return result;
      }, { successMessage: L("Staff assignment recorded.", "انتساب کارمند ثبت شد.") }); }}>
        <label>{L("User id", "شناسه کاربر")}<input required minLength={3} maxLength={64} dir="ltr" value={directAssignee} disabled={assignCommand.state.phase === "submitting"} onChange={(event) => setDirectAssignee(event.target.value)} /></label>
        <button type="submit" disabled={assignCommand.state.phase === "submitting" || chosenActions.length === 0}>{L("Assign", "انتساب")}</button>
      </form>
      <HeritageCommandNotice state={assignCommand.state} reload={() => { assignCommand.reset(); refresh(); }} />
    </details> : null}
    {revokeCommand.state.phase !== "idle" ? <HeritageCommandNotice state={revokeCommand.state} reload={() => { revokeCommand.reset(); refresh(); }} /> : null}
  </section>;
}

/**
 * The INVITEE'S OWN cross-workspace view (R108-13): pending invitations
 * answerable WITHOUT selecting any workspace. Consent is the invitee's
 * decision — accept or decline, with the server re-checking the inviter's
 * live authority at acceptance time. The resource is PRINCIPAL-SCOPED: the
 * identity includes the current user so one principal's list can never leak
 * into another's view (the R107 NEXT-05 discipline).
 */
export function HeritageMyInvitations({ platform, userId, refresh }: { platform: PlatformClient; userId: string; refresh?: () => void }) {
  const { locale } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const respondCommand = usePlatformCommand("workspace-respond");
  const mine = useDomainResource("workspace-invites-mine", userId, (signal) => platform.modules.workspaces.myInvites({ signal }), { isEmpty: (data) => data.rows.length === 0 });
  return <section data-h-surface-role="panel" aria-label={L("My pending invitations", "دعوت‌های در انتظار من")}>
    <details><summary>{L("My pending invitations", "دعوت‌های در انتظار من")}</summary>
      <HeritageResourceNotice state={mine.state} retry={mine.retry} />
      {(mine.state.phase === "ready" || mine.state.phase === "reloading") ? (mine.state.data.rows.length
        ? <ul className="h-mod-task-list">{mine.state.data.rows.map((row) => <li key={`${row.collection_id}`}>
          <strong dir="auto">{row.workspace_name}</strong>
          <small dir="auto">{L("Proposed", "پیشنهاد")}: {row.proposed_actions} · {L("expires", "انقضا")}: {row.expires_at.slice(0, 10)}</small>
          <div className="table-actions">
            <button type="button" disabled={respondCommand.state.phase === "submitting"} onClick={() => { void respondCommand.run(async () => {
              const result = await platform.modules.workspaces.respondInvite(row.collection_id, "accept");
              mine.retry(); refresh?.(); return result;
            }, { successMessage: L("Invitation accepted. Your access is re-checked live on every request.", "دعوت پذیرفته شد.") }); }}>{L("Accept", "پذیرش")}</button>
            <button type="button" disabled={respondCommand.state.phase === "submitting"} onClick={() => { void respondCommand.run(async () => {
              const result = await platform.modules.workspaces.respondInvite(row.collection_id, "decline");
              mine.retry(); return result;
            }, { successMessage: L("Invitation declined.", "دعوت رد شد.") }); }}>{L("Decline", "رد")}</button>
          </div>
        </li>)}</ul>
        : <p>{L("You have no pending invitations.", "دعوت در انتظاری ندارید.")}</p>) : null}
      <HeritageCommandNotice state={respondCommand.state} reload={() => { respondCommand.reset(); mine.retry(); }} />
    </details>
  </section>;
}
