import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../../src/worker";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";

/**
 * R148 Task 5 — stale-browser-draft version contract.
 * A draft edit must send the content_revision its form loaded; a stale tab
 * conflicts (409 content_revision_conflict) instead of clobbering a newer
 * save through a freshly-read revision.
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
  await seedUser(db, "rev-owner", "owner");
  return { db, owner: await makeSession(db, "rev-owner") };
}

const draftPayload = { request_type: "create_horse", submit: false, submission: { name_latin: "Revision Mare", breed_desc: "Arabian", birth_year: 2020 } };

describe("R148 Task 5 — draft content_revision contract", () => {
  it("returns the content_revision, accepts fresh edits, and conflicts on a stale tab", async () => {
    const { db, owner } = await world();
    const created = await call(db, "/api/change-requests", draftPayload, owner, "POST");
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { request: { id: string; content_revision?: number } };
    const id = createdBody.request.id;
    expect(createdBody.request.content_revision).toBe(1);

    // Tab A saves with the revision it loaded -> accepted, revision bumps to 2.
    // (create_horse drafts edit as a whole: the structured submission is required.)
    const tabA = await call(db, `/api/change-requests/${id}`,
      { expected_content_revision: 1, summary: "Saved from tab A", submission: { name_latin: "Revision Mare A", breed_desc: "Arabian", birth_year: 2020 } }, owner, "PUT");
    expect(tabA.status).toBe(200);
    const tabABody = await tabA.json() as { request: { content_revision?: number; summary?: string } };
    expect(tabABody.request.content_revision).toBe(2);
    expect(tabABody.request.summary).toBe("Saved from tab A");

    // Tab B opened the form at revision 1 and saves late -> conflict, not a clobber.
    const tabB = await call(db, `/api/change-requests/${id}`,
      { expected_content_revision: 1, summary: "Stale overwrite from tab B", submission: { name_latin: "Revision Mare B", breed_desc: "Arabian", birth_year: 2021 } }, owner, "PUT");
    expect(tabB.status).toBe(409);
    const tabBBody = await tabB.json() as { error?: { code?: string; details?: { current_content_revision?: number } } };
    expect(tabBBody.error?.code).toBe("content_revision_conflict");
    expect(tabBBody.error?.details?.current_content_revision).toBe(2);

    // The newer content survives the stale attempt.
    const mine = await call(db, "/api/change-requests/mine", undefined, owner, "GET");
    const mineRaw = await mine.text();
    expect(mine.status, `mine responded ${mine.status}: ${mineRaw.slice(0, 200)}`).toBe(200);
    const mineBody = JSON.parse(mineRaw) as { requests: Array<{ id: string; summary?: string; content_revision?: number }> };
    const row = mineBody.requests.find((request) => request.id === id);
    expect(row?.summary).toBe("Saved from tab A");
    expect(row?.content_revision).toBe(2);

    // A fresh tab (revision 2) saves cleanly.
    const fresh = await call(db, `/api/change-requests/${id}`,
      { expected_content_revision: 2, summary: "Saved from a fresh tab", submission: { name_latin: "Revision Mare C", breed_desc: "Arabian", birth_year: 2019 } }, owner, "PUT");
    expect(fresh.status).toBe(200);
    const freshBody = await fresh.json() as { request: { content_revision?: number } };
    expect(freshBody.request.content_revision).toBe(3);
  });

  it("rejects an edit payload without expected_content_revision", async () => {
    const { db, owner } = await world();
    const created = await call(db, "/api/change-requests", draftPayload, owner, "POST");
    const createdBody = await created.json() as { request: { id: string } };
    const missing = await call(db, `/api/change-requests/${createdBody.request.id}`,
      { summary: "No revision guard" }, owner, "PUT");
    expect(missing.status).toBe(400);
    const missingBody = await missing.json() as { error?: { code?: string } };
    expect(missingBody.error?.code).toBe("invalid_change_request");
  });
});
