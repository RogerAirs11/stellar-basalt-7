import { describe, expect, it } from "vitest";
import workerDefault from "../../src/worker";
import { openRealDatabase, seedUser, makeSession, authedRequest, countRows } from "../helpers/realDatabase";
import { PROVINCE_CODE_SCHEME } from "../../src/directory/vocabulary";
import type { D1Database } from "@cloudflare/workers-types";

/** Real router, real session/CSRF, full migrated database. External provider I/O
 * is not part of these tests. Execute in the authoritative repository with its
 * locked dependencies; this export's native command tests are separate evidence. */
const worker = workerDefault as unknown as { fetch(request: Request, env: Env): Promise<Response> };
const limiter = { limit: async () => ({ success: true }) };
function env(db: D1Database): Env {
  return { APP_ENV: "production", DB_PROVIDER_MODE: "d1_only", SESSION_COOKIE_NAME: "hr_session", DB: db,
    ASSETS: { fetch: async () => new Response("<html>") }, PUBLIC_RATE_LIMITER: limiter, AUTH_RATE_LIMITER: limiter,
    EXPENSIVE_RATE_LIMITER: limiter, WRITE_RATE_LIMITER: limiter, ACCOUNT_RATE_LIMITER: limiter } as unknown as Env;
}
async function fixture() {
  const db = await openRealDatabase();
  for (const [id, role] of [["owner", "user"], ["other", "user"], ["editor", "editor"], ["admin", "admin"]]) await seedUser(db, id!, role!);
  await db.exec("INSERT INTO people(id,name_latin) VALUES(1,'Synthetic professional'); INSERT INTO user_person_links(user_id,person_id,status) VALUES('owner',1,'verified')");
  return { db, owner: await makeSession(db,"owner"), other: await makeSession(db,"other"), editor: await makeSession(db,"editor"), admin: await makeSession(db,"admin") };
}
const profile = { service_categories: ["farrier"], province_code: "IR-23", province_code_scheme: PROVINCE_CODE_SCHEME,
  contact_value: "private@example.test", publication_consent: false, expected_version: 0 };

describe("R98 directory boundaries over HTTP", () => {
  it("binds publication and creator correctly; private reads require current representation", async () => {
    const w = await fixture();
    const saved = await worker.fetch(authedRequest("/api/directory/persons/1/profile", {...profile,publication_consent:true}, {session:w.owner,method:"PUT"}), env(w.db));
    expect(saved.status).toBe(200);
    const row = await w.db.prepare("SELECT created_by_user_id,published_at,row_version FROM directory_profiles WHERE person_id=1").first<Record<string, unknown>>();
    expect(row?.created_by_user_id).toBe("owner"); expect(row?.published_at).toMatch(/^\d{4}-\d{2}-\d{2} /); expect(row?.row_version).toBe(1);
    const managed = await worker.fetch(authedRequest("/api/directory/persons/1/profile", undefined, {session:w.owner}), env(w.db));
    expect(managed.status).toBe(200); expect(managed.headers.get("cache-control")).toContain("no-store");
    expect((await managed.json() as {profile:{contact_value:string}}).profile.contact_value).toBe("private@example.test");
    const other = await worker.fetch(authedRequest("/api/directory/persons/1/profile", undefined, {session:w.other}), env(w.db));
    expect(other.status).toBe(403);
    const publicView = await worker.fetch(authedRequest("/api/directory/persons/1", undefined),env(w.db));
    expect(await publicView.text()).not.toContain("private@example.test");
    await w.db.exec("UPDATE user_person_links SET status='revoked'");
    expect((await worker.fetch(authedRequest("/api/directory/persons/1/profile", undefined, {session:w.owner}),env(w.db))).status).toBe(403);
  });
  it("requires an explicit version for updates and produces no success audit on stale save", async () => {
    const w = await fixture(); const url="/api/directory/persons/1/profile";
    expect((await worker.fetch(authedRequest(url,profile,{session:w.owner,method:"PUT"}),env(w.db))).status).toBe(200);
    const {expected_version:_ignored,...unversioned}=profile;
    expect((await worker.fetch(authedRequest(url,unversioned,{session:w.owner,method:"PUT"}),env(w.db))).status).toBe(428);
    expect((await worker.fetch(authedRequest(url,profile,{session:w.owner,method:"PUT"}),env(w.db))).status).toBe(409);
    expect(await countRows(w.db,"audit_events","action='directory.profile.updated'")).toBe(1);
  });
  it("does not accept a current province code without its scheme", async () => {
    const w = await fixture(); const {province_code_scheme:_ignored,...ambiguous}=profile;
    expect((await worker.fetch(authedRequest("/api/directory/persons/1/profile",ambiguous,{session:w.owner,method:"PUT"}),env(w.db))).status).toBe(400);
    expect(await countRows(w.db,"directory_profiles")).toBe(0);
  });
  it("editorial staff cannot create external credential authority", async () => {
    const w = await fixture();
    await w.db.exec("INSERT INTO person_credentials(id,person_id,role,issuer_name,identifier,created_by_user_id) VALUES(1,1,'farrier','Synthetic body','DEMO-1','owner')");
    const url="/api/admin/directory/credentials/1/review";
    expect((await worker.fetch(authedRequest(url,{decision:"issuer_attested",note:"No actual issuer authority"},{session:w.admin}),env(w.db))).status).toBe(409);
    expect((await worker.fetch(authedRequest(url,{decision:"platform_reviewed",note:"Editorial only",expected_version:1},{session:w.editor}),env(w.db))).status).toBe(403);
    expect(await countRows(w.db,"person_credentials","verification_state='unverified'")).toBe(1);
  });
  it("legacy issuer labels and impossible dates do not become valid public credentials", async () => {
    const w = await fixture();
    await w.db.exec("INSERT INTO directory_profiles(person_id,publication_consent) VALUES(1,1); INSERT INTO person_credentials(person_id,role,issuer_name,identifier,issued_at,verification_state) VALUES(1,'farrier','Synthetic body','DEMO-1','2026-02-30','issuer_attested')");
    const response=await worker.fetch(authedRequest("/api/directory/persons/1",undefined),env(w.db));
    expect(response.status).toBe(200);
    const body=await response.json() as {credentials:Array<{is_active:boolean;recorded_period_status:string;verification_level:string;authority_needs_review:boolean}>};
    expect(body.credentials[0]).toMatchObject({is_active:false,recorded_period_status:"invalid_dates",verification_level:"unverified",authority_needs_review:true});
  });
});
