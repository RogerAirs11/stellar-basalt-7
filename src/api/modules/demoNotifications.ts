/**
 * R98-N11 operator demo inbox — the safe operator view for demonstration
 * deliveries, plus the explicit simulate-settlement action.
 *
 * The operator view pairs the PROVIDER-side record (demo_deliveries: what
 * the demo provider "accepted", to which address, with which message id)
 * with the PLATFORM-side outbox row state for the same event key — so an
 * operator can SEE that acceptance and delivery are different facts, which
 * rows are stuck, and what a signed callback settles.
 *
 * The simulate action does not write delivery state directly: it builds the
 * provider's bridge envelope, signs it exactly like the real bridge
 * (HMAC over `provider:rawBody`) and drives the REAL recording path
 * (recordDeliveryCallback) — signature verification, envelope translation,
 * replay handling and CAS correlation all run their production code.
 */

import { z } from "zod";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { recordDeliveryCallback } from "../../notifications/outbox";
import { signedDemoDeliveryCallback, DEMO_EMAIL_PROVIDER_NAME } from "../../notifications/demoProvider";
import type { D1Database } from "@cloudflare/workers-types";

type DemoNotificationsEnv = { DB: D1Database; SESSION_COOKIE_NAME: string; NOTIFICATION_CALLBACK_SECRET?: string };

interface DemoDeliveryRow {
  id: number;
  event_key: string;
  channel: string;
  purpose: string;
  to_address: string;
  subject: string | null;
  provider_message_id: string;
  status: string;
  accepted_at: string;
  settled_at: string | null;
}

/** The operator demo inbox, paired with the live outbox state per event. */
export async function adminDemoDeliveries(request: Request, env: DemoNotificationsEnv): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  void auth;
  const rows = await env.DB.prepare(`
    SELECT d.id, d.event_key, d.channel, d.purpose, d.to_address, d.subject,
           d.provider_message_id, d.status, d.accepted_at, d.settled_at,
           o.status AS outbox_status, o.attempts AS outbox_attempts, o.last_error AS outbox_last_error
    FROM demo_deliveries d
    LEFT JOIN notification_outbox o ON o.event_key = d.event_key
    ORDER BY d.id DESC LIMIT 100
  `).all<DemoDeliveryRow & { outbox_status: string | null; outbox_attempts: number | null; outbox_last_error: string | null }>();
  return json({
    demo_inbox: (rows.results ?? []).map(row => ({
      id: row.id,
      event_key: row.event_key,
      channel: row.channel,
      purpose: row.purpose,
      to: row.to_address,
      subject: row.subject,
      provider_message_id: row.provider_message_id,
      provider_side_status: row.status,
      outbox_status: row.outbox_status,
      outbox_attempts: row.outbox_attempts,
      outbox_last_error: row.outbox_last_error,
      accepted_at: row.accepted_at,
      settled_at: row.settled_at,
    })),
    note: "Provider-side demonstration inbox. Acceptance (recorded here) and delivery (a signed provider callback fact) are different states — use the simulate action to drive a settlement through the real callback path.",
  });
}

/** Simulate the provider's signed delivery/non-delivery callback for one
 * demo delivery — through the production recording path. */
export async function adminSimulateDemoDelivery(request: Request, env: DemoNotificationsEnv, id: number): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({ outcome: z.enum(["delivered", "not_delivered"]) }).safeParse(await readJson<unknown>(request, 2 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_outcome", "outcome must be 'delivered' or 'not_delivered'");
  const delivery = await env.DB.prepare(
    "SELECT id, event_key, provider_message_id, status FROM demo_deliveries WHERE id=?",
  ).bind(id).first<{ id: number; event_key: string; provider_message_id: string; status: string }>();
  if (!delivery) throw new HttpError(404, "not_found", "No demo delivery matches this id");
  if (delivery.status !== "accepted") {
    return json({ simulated: false, provider_side_status: delivery.status,
      note: "This demo delivery is already settled; the recorded provider-side state is returned unchanged." });
  }
  const secret = env.NOTIFICATION_CALLBACK_SECRET;
  if (!secret) throw new HttpError(503, "callback_secret_unconfigured", "The notification callback secret is not configured; a signed callback cannot be simulated until the owner sets NOTIFICATION_CALLBACK_SECRET");

  const { rawBody, signature } = await signedDemoDeliveryCallback(
    { event_key: delivery.event_key, provider_message_id: delivery.provider_message_id },
    parsed.data.outcome,
    secret,
  );
  // The REAL recording path: signature verification, bridge translation,
  // replay rules and CAS correlation all run their production code.
  const recorded = await recordDeliveryCallback(env.DB, {
    provider: DEMO_EMAIL_PROVIDER_NAME,
    rawBody,
    signature,
    secret,
  });
  const settled = await env.DB.prepare(
    "UPDATE demo_deliveries SET status=?, settled_at=CURRENT_TIMESTAMP WHERE id=? AND status='accepted'",
  ).bind(parsed.data.outcome === "delivered" ? "delivered" : "failed", id).run();
  const body = await recorded.json() as Record<string, unknown>;
  return json({
    simulated: Number(settled.meta.changes ?? 0) === 1,
    outcome: parsed.data.outcome,
    provider_side_status: parsed.data.outcome === "delivered" ? "delivered" : "failed",
    recording: body,
    note: "The settlement was driven through the real signed-callback recording path (signature verification, envelope translation, replay and correlation rules).",
  });
}
