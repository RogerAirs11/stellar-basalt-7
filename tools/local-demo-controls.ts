/** Loopback adapter controls; deliberately not registered in production routes. */
import { z } from "zod";
import { HttpError, json, readJson } from "../src/api/http";
import { requireAuth, requireCsrf } from "../src/auth/guards";
import { enqueueDueTaskReminders } from "../src/workspaces/reminders";
import { drainNotificationOutbox } from "../src/notifications/worker";
import { serviceRetentionSweep } from "../src/services/privacy";

export async function localDemoControl(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!["/api/demo/context", "/api/demo/clock", "/api/demo/run-pending-jobs"].includes(url.pathname)) return null;
  if (env.APP_ENV !== "local" || env.ISOLATED_DEMO_MODE !== "1" || env.REGISTRY_DATASET_KIND !== "synthetic"
      || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new HttpError(404, "not_found", "Route not found");
  const marker = await env.DB.prepare("SELECT namespace,manifest_json FROM local_demo_manifest WHERE id=1").first<{ namespace: string; manifest_json: string }>();
  if (marker?.namespace !== "synthetic:r111") throw new HttpError(404, "not_found", "Route not found");
  const manifest = JSON.parse(marker.manifest_json);
  const readClock = async () => (await env.DB.prepare("SELECT now_iso FROM local_demo_clock WHERE id=1").first<{now_iso:string}>())!.now_iso;
  if (url.pathname === "/api/demo/context" && request.method === "GET") {
    return json({ dataset_kind: "synthetic", write_policy: env.REGISTRY_WRITE_POLICY === "read_only" ? "read_only" : "isolated_local_only", revision: "r111", as_of: manifest.as_of,
      warning: manifest.warning, clock: { now_iso: await readClock(), scope: "reminder_scheduler" },
      personas: env.REGISTRY_WRITE_POLICY === "read_only" ? [] : manifest.stories.personas, stories: manifest.stories, counts: manifest.counts,
      research: { available: env.AI_DEMO_REGISTRY_RESEARCH === "1", provider: "offline", dataset_kind: "synthetic",
        commands: ["Find DEMO", "Horse 900000017", "Count horses", "List horses"],
        unavailable: ["external_ai", "web_research", "image_analysis", "free_form_analysis", "breeding_or_medical_advice"] },
      note: "Fictional records and isolated local sessions. Payments are simulated; notifications are recorded without sending. Reminder clock does not change authentication or payment expiry." });
  }
  if (env.REGISTRY_WRITE_POLICY === "read_only") throw new HttpError(403, "reference_read_only", "This reference copy is read-only");
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST for demo controls");
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  if (url.pathname === "/api/demo/clock") {
    const parsed = z.object({ advance_days: z.number().int().min(1).max(365) }).strict().safeParse(await readJson(request, 1024));
    if (!parsed.success) throw new HttpError(400, "invalid_clock_advance", "advance_days must be an integer from 1 to 365");
    const before = await readClock();
    const after = new Date(Date.parse(before) + parsed.data.advance_days * 86_400_000).toISOString();
    const moved = await env.DB.prepare("UPDATE local_demo_clock SET now_iso=? WHERE id=1 AND now_iso=?").bind(after, before).run();
    if (Number(moved.meta.changes ?? 0) !== 1) throw new HttpError(409, "demo_clock_changed", "The reminder clock changed concurrently; reload it before advancing");
    return json({ demo: true, before, now_iso: after, scope: "reminder_scheduler" });
  }
  if (url.pathname === "/api/demo/run-pending-jobs") {
    // Use the real bounded scheduler/drain services with an explicit clock.
    // Only the loopback provider receives this environment; no real credentials
    // or request-selected providers are forwarded to the send adapter.
    const now = await readClock();
    const retention = await serviceRetentionSweep(env.DB, now);
    const reminders = await enqueueDueTaskReminders(env.DB, now);
    const notifications = await drainNotificationOutbox(env.DB, { DEMO_NOTIFICATIONS_ENABLED: "1" }, { now: () => new Date(now), limit: 10 });
    return json({ demo: true, now_iso: now, retention, reminders, notifications,
      note: "One bounded pass completed. Acceptance is not delivery; use the signed callback action in the demo inbox to settle delivery." });
  }
  throw new HttpError(405, "method_not_allowed", "This demo control does not accept this method");
}
