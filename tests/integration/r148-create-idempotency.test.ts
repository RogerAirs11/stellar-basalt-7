import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../../src/worker";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R148 Task 6 — universal direct-create retry idempotency.
 * Same command key + same content replays the original horse; the same key
 * with different content is refused; the receipt binds the actual horse id.
 */
const limiter = { limit: async () => ({ success: true }) };
function call(db: D1Database, path: string, body?: unknown, session?: AuthedSession, method?: string) {
  return (worker as unknown as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(authedRequest(path, body, { session, method }), {
    APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", DB: db, SESSION_COOKIE_NAME: "hr_session",
    ASSETS: { fetch: async () => new Response("unused") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter,
  });
}

async function world() {
  const db = await openRealDatabase();
  await seedUser(db, "create-editor", "editor");
  return { db, editor: await makeSession(db, "create-editor") };
}

async function horseCount(db: D1Database, name: string) {
  return Number(await db.prepare("SELECT COUNT(*) AS n FROM horses WHERE name_latin=?").bind(name).first<number>("n"));
}

describe("R148 Task 6 — direct-create command receipts", () => {
  it("replays an exact retry and refuses reuse with changed content", async () => {
    const { db, editor } = await world();
    const payload = { name_latin: "Idem One", breed_desc: "Arabian", birth_year: 2021, command_key: "cmd-idem-0001" };

    const first = await call(db, "/api/horses", payload, editor, "POST");
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { horse: { id: number } };
    const horseId = firstBody.horse.id;
    expect(horseId).toBeGreaterThan(0);

    // Lost response: the exact retry (same key, same content) replays.
    const retry = await call(db, "/api/horses", payload, editor, "POST");
    expect(retry.status).toBe(201);
    const retryBody = await retry.json() as { horse: { id: number }; idempotent_replay?: boolean };
    expect(retryBody.idempotent_replay).toBe(true);
    expect(retryBody.horse.id).toBe(horseId);
    expect(await horseCount(db, "Idem One")).toBe(1);

    // Receipt binds the actual created id (never stays 'pending').
    const receipt = await db.prepare(
      "SELECT request_digest,entity_id FROM canonical_command_receipts WHERE actor_user_id=? AND action='horse.create' AND command_key=?"
    ).bind("create-editor", "cmd-idem-0001").first<{ request_digest: string; entity_id: string }>();
    expect(receipt?.entity_id).toBe(String(horseId));
    expect(receipt?.entity_id).not.toBe("pending");

    // Same key, different content -> refused, still one horse.
    const reuse = await call(db, "/api/horses", { ...payload, name_latin: "Idem Two" }, editor, "POST");
    expect(reuse.status).toBe(409);
    const reuseBody = await reuse.json() as { error?: { code?: string } };
    expect(reuseBody.error?.code).toBe("command_key_reuse");
    expect(await horseCount(db, "Idem One")).toBe(1);
    expect(await horseCount(db, "Idem Two")).toBe(0);
  });

  it("creates independently without a command key (legacy behavior)", async () => {
    const { db, editor } = await world();
    const plain = await call(db, "/api/horses", { name_latin: "Plain Create", breed_desc: "Arabian" }, editor, "POST");
    expect(plain.status).toBe(201);
    expect(await horseCount(db, "Plain Create")).toBe(1);
  });
});
