import { beforeEach, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import workerDefault from "../../src/worker";
import { authedRequest, makeSession, openRealDatabase, seedUser, type AuthedSession } from "../helpers/realDatabase";
const worker = workerDefault as unknown as { fetch(request: Request, env: unknown): Promise<Response> };

describe("R113 protected reviewer claim evidence", () => {
  let db: D1Database; let editor: AuthedSession; let owner: AuthedSession;
  const read = (path: string, session?: AuthedSession) => worker.fetch(authedRequest(path, undefined, { session }), {
    DB: db, DB_PROVIDER_MODE: "d1_only", APP_ENV: "production", SESSION_COOKIE_NAME: "hr_session",
    ASSETS: { fetch: async () => new Response("<html>") },
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
  });
  beforeEach(async () => {
    db = await openRealDatabase(); await seedUser(db, "reviewer", "editor"); await seedUser(db, "claimant", "owner");
    editor = await makeSession(db, "reviewer"); owner = await makeSession(db, "claimant");
    await db.prepare("INSERT INTO horses(id,name_latin) VALUES(1,'Fictional test horse')").run();
    await db.prepare("INSERT INTO people(id,name_latin) VALUES(2,'Fictional claimant profile')").run();
    await db.prepare("INSERT INTO horse_claims(id,horse_id,person_id,claimant_user_id,evidence_json) VALUES('r113-claim',1,2,'claimant',?)")
      .bind(JSON.stringify({ note: "Private original evidence", source: "test" })).run();
  });
  it("returns original parsed evidence and person to a current reviewer, without raw JSON", async () => {
    const response = await read("/api/admin/claims", editor); expect(response.status).toBe(200);
    const body = await response.json() as { claims: Record<string, unknown>[] };
    expect(body.claims[0]).toMatchObject({ person_id: 2, evidence: { note: "Private original evidence", source: "test" } });
    expect(body.claims[0]).not.toHaveProperty("evidence_json");
  });
  it("denies anonymous and owner access to reviewer evidence", async () => {
    for (const session of [undefined, owner]) {
      const response = await read("/api/admin/claims", session); expect([401, 403]).toContain(response.status);
      expect(await response.text()).not.toContain("Private original evidence");
    }
  });
  it("does not extend own-list or public horse projections with private evidence", async () => {
    for (const [path, session] of [["/api/claims/mine", owner], ["/api/horses/1", undefined]] as const) {
      const response = await read(path, session); expect(response.status).toBe(200);
      const body = await response.text(); expect(body).not.toContain("Private original evidence"); expect(body).not.toContain("evidence_json");
    }
  });
  it("handles malformed legacy evidence without inventing content or failing the queue", async () => {
    await db.prepare("UPDATE horse_claims SET evidence_json='not json' WHERE id='r113-claim'").run();
    const response = await read("/api/admin/claims", editor); expect(response.status).toBe(200);
    expect((await response.json() as { claims: { evidence: unknown }[] }).claims[0].evidence).toBeNull();
  });
});
