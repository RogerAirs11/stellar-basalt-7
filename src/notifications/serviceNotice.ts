import type { D1Database } from "@cloudflare/workers-types";
import { isServiceProviderManager } from "../services/policy";

export type ServiceNoticeSuppression = "invalid_service_reference" | "request_unavailable"
  | "recipient_not_authorized" | "contact_consent_withdrawn" | "participant_blocked";

export type ServiceNoticeResolution =
  | { kind: "sendable"; to: string; subject: string; html: string }
  | { kind: "suppressed"; reason: ServiceNoticeSuppression };

interface NoticeRow {
  recipient_user_id: string | null; email: string | null; recipient_active: number;
  requester_active: number; requester_user_id: string; provider_person_id: number;
  request_status: string; publication_consent: number; provider_deleted_at: string | null;
  share_contact: number; consent_updated_at: string | null; retention_minimized_at: string | null;
  provider_blocked: number; requester_blocked: number;
}

/** Send-time authority, independent of the earlier enqueue decision. Never read
 * the note, private provider contact value, horse documents or raw phone number.
 * This prevents queued messages reaching a revoked delegate. It cannot retract
 * an email already in flight or accepted by the provider. */
export async function resolveServiceRequestNotice(
  db: D1Database,
  input: {eventKey: string; payloadRef: string | null},
): Promise<ServiceNoticeResolution> {
  const match=/^service_requests:([1-9][0-9]*)$/.exec(input.payloadRef ?? "");
  const id=Number(match?.[1]);
  if (!match || !Number.isSafeInteger(id) || !input.eventKey.startsWith(`service-request:${id}:`)) {
    return {kind:"suppressed",reason:"invalid_service_reference"};
  }
  const row=await db.prepare(`SELECT n.recipient_user_id,u.email,u.is_active AS recipient_active,
      ru.is_active AS requester_active,r.requester_user_id,r.provider_person_id,r.status AS request_status,
      dp.publication_consent,p.deleted_at AS provider_deleted_at,r.share_contact,r.consent_updated_at,
      r.retention_minimized_at,
      CASE WHEN EXISTS(SELECT 1 FROM service_provider_blocks b WHERE b.provider_person_id=r.provider_person_id
        AND b.blocked_requester_user_id=r.requester_user_id) THEN 1 ELSE 0 END AS provider_blocked,
      CASE WHEN EXISTS(SELECT 1 FROM service_request_blocks b WHERE b.blocker_user_id=r.requester_user_id
        AND b.blocked_person_id=r.provider_person_id) THEN 1 ELSE 0 END AS requester_blocked
      FROM notification_outbox n JOIN service_requests r ON r.id=?
      JOIN people p ON p.id=r.provider_person_id
      JOIN directory_profiles dp ON dp.person_id=p.id
      JOIN users u ON u.id=n.recipient_user_id JOIN users ru ON ru.id=r.requester_user_id
      WHERE n.event_key=? AND n.payload_ref=? AND n.status='queued'`)
    .bind(id,input.eventKey,input.payloadRef).first<NoticeRow>();
  if (!row || row.provider_deleted_at || Number(row.publication_consent)!==1
      || row.retention_minimized_at || ["withdrawn","spam"].includes(row.request_status)) {
    return {kind:"suppressed",reason:"request_unavailable"};
  }
  if (Number(row.share_contact)===0 && row.consent_updated_at) {
    return {kind:"suppressed",reason:"contact_consent_withdrawn"};
  }
  if (Number(row.provider_blocked)===1 || Number(row.requester_blocked)===1) {
    return {kind:"suppressed",reason:"participant_blocked"};
  }
  const recipient=row.recipient_user_id;
  if (!recipient || !row.email || Number(row.recipient_active)!==1 || Number(row.requester_active)!==1
      || !input.eventKey.endsWith(`:${recipient}`)) {
    return {kind:"suppressed",reason:"recipient_not_authorized"};
  }
  const stage=input.eventKey.slice(`service-request:${id}:`.length,-(`:${recipient}`.length));
  if (stage!=="created" && !/^v[1-9][0-9]*$/.test(stage)) {
    return {kind:"suppressed",reason:"invalid_service_reference"};
  }
  const requester=recipient===row.requester_user_id;
  if (!requester && !(await isServiceProviderManager(db,recipient,row.provider_person_id))) {
    return {kind:"suppressed",reason:"recipient_not_authorized"};
  }
  if (stage==="created" && (requester || row.request_status!=="new")) {
    return {kind:"suppressed",reason:"request_unavailable"};
  }
  // The account's own verified email is resolved at send time. Message content
  // is deliberately generic and contains no lead text or private identifiers.
  const english=stage==="created" ? "You have a new service request." : "A service request you participate in has been updated.";
  const persian=stage==="created"
    ? "\u06cc\u06a9 \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u062e\u062f\u0645\u062a \u062c\u062f\u06cc\u062f \u062f\u0627\u0631\u06cc\u062f."
    : "\u06cc\u06a9 \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u062e\u062f\u0645\u062a \u0645\u0631\u0628\u0648\u0637 \u0628\u0647 \u0634\u0645\u0627 \u0628\u0647\u200c\u0631\u0648\u0632 \u0634\u062f\u0647 \u0627\u0633\u062a.";
  return {kind:"sendable",to:row.email,
    subject:stage==="created" ? "New service request / \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u062e\u062f\u0645\u062a \u062c\u062f\u06cc\u062f" : "Service request update / \u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u062f\u0631\u062e\u0648\u0627\u0633\u062a",
    html:`<!doctype html><html><body><p lang="fa" dir="rtl">${persian}</p><p lang="en">${english} Sign in to the platform to view it.</p><p lang="en">A request is not a confirmed appointment. Private details remain in the platform.</p></body></html>`};
}
