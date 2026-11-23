import { describe, expect, it } from "vitest";
import { mediaFixture } from "../helpers/mediaFixtures";
import { uploadHorseMedia, serveMediaFile, mintMediaAccess, adminMediaQuarantine } from "../../src/api/modules/media";
import {
  canReadMedia,
  scanForActiveContent,
  signMediaAccessToken,
  stripLocationMetadata,
  verifyMediaAccessToken,
  MEDIA_ACCESS_TOKEN_TTL_SECONDS,
} from "../../src/api/modules/mediaPolicy";
import { HttpError } from "../../src/api/http";
import type { D1Database } from "@cloudflare/workers-types";
import { openRealDatabase,seedUser,makeSession,authedRequest } from "../helpers/realDatabase";
import { getAuth } from "../../src/auth/session";

/**
 * R88 agent plan P09 — secure evidence upload + private document delivery.
 *
 * Pins:
 *  - oversized / mismatched-MIME / active-content / polyglot uploads fail;
 *  - EXIF/XMP/location metadata never survives upload (bytes are stripped
 *    BEFORE storage, so no projection can ever leak them);
 *  - short-lived tokens: HMAC-bound, bounded TTL, tamper-proof, fail closed;
 *  - revocation: a revoked grant kills the serve path; lost read access
 *    means no new URL can be minted;
 *  - the operator quarantine queue surfaces metadata + reasons only.
 */

const ORIGIN = "https://registry.example";
const SECRET = "test-media-access-secret";
const GRANT = "11111111-1111-4111-a111-111111111111";

// ---------------------------------------------------------------------------
// Byte fixtures.
// ---------------------------------------------------------------------------

/** Real decodable fixtures with fictional GPS/owner metadata. */
function jpegWithExif(): Uint8Array { return mediaFixture("metadata.jpg"); }
function pngWithExif(): Uint8Array { return mediaFixture("metadata.png"); }

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// 1. Hygiene primitives.
// ---------------------------------------------------------------------------

describe("P09 upload hygiene primitives", () => {
  it("strips the Exif APP1 segment from JPEGs while keeping the image structure", () => {
    const original = jpegWithExif();
    const { bytes, stripped } = stripLocationMetadata(original, "image/jpeg");
    expect(stripped).toBe(true);
    expect(bytes.length).toBeLessThan(original.length);
    // SOI preserved, no APP1 (0xff 0xe1) marker remains, EOI still terminates.
    expect(bytes[0]).toBe(0xff); expect(bytes[1]).toBe(0xd8);
    let app1 = false;
    for (let i = 0; i + 1 < bytes.length; i += 1) if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) app1 = true;
    expect(app1).toBe(false);
    expect(bytes[bytes.length - 1]).toBe(0xd9);
    expect(bytes[bytes.length - 2]).toBe(0xff);
    // The image segments (DQT/SOF/SOS) survive.
    const text = String.fromCharCode(...bytes);
    expect(text).not.toContain("Exif");
  });

  it("strips the eXIf chunk from PNGs", () => {
    const original = pngWithExif();
    const { bytes, stripped } = stripLocationMetadata(original, "image/png");
    expect(stripped).toBe(true);
    const text = String.fromCharCode(...bytes.subarray(8));
    expect(text).not.toContain("eXIf");
    expect(text).toContain("IHDR");
    expect(text).toContain("IEND");
  });

  it("rejects PDFs carrying active-content constructs", () => {
    const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);
    expect(scanForActiveContent(pdf("1 0 obj << /Type /Catalog >> endobj"), "application/pdf")).toEqual({ ok: true });
    for (const needle of ["/JavaScript", "/OpenAction", "/Launch", "/EmbeddedFile"]) {
      const scan = scanForActiveContent(pdf(`1 0 obj << ${needle} (x) >> endobj`), "application/pdf");
      expect(scan.ok).toBe(false);
      if (!scan.ok) expect(scan.reason).toContain(needle);
    }
  });

  it("rejects image polyglots (trailing bytes after the end marker)", () => {
    const jpeg = jpegWithExif();
    const polyglot = Uint8Array.from([...jpeg, 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]); // "<script>"
    expect(scanForActiveContent(polyglot, "image/jpeg").ok).toBe(false);
    const clean = scanForActiveContent(jpeg, "image/jpeg");
    expect(clean.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Signed access tokens.
// ---------------------------------------------------------------------------

describe("P09 short-lived signed access tokens", () => {
  it("roundtrips a valid token and binds (media, user, expiry)", async () => {
    const expires = Date.now() + 60_000;
    const token = await signMediaAccessToken("media-1", "user-1", GRANT, expires, SECRET);
    const claims = await verifyMediaAccessToken(token, SECRET);
    expect(claims).toEqual({ mediaId: "media-1", userId: "user-1", grantId: GRANT, expiresAtMs: expires });
  });

  it("rejects expired, tampered and wrong-secret tokens (fail closed)", async () => {
    const token = await signMediaAccessToken("media-1", "user-1", GRANT, Date.now() + 60_000, SECRET);
    expect(await verifyMediaAccessToken(token, SECRET, Date.now() + 61_000)).toBeNull();
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await verifyMediaAccessToken(tampered, SECRET)).toBeNull();
    expect(await verifyMediaAccessToken(token, "other-secret")).toBeNull();
    expect(await verifyMediaAccessToken("garbage", SECRET)).toBeNull();
  });

  it("the TTL is bounded (15 minutes) by construction", () => {
    expect(MEDIA_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// 3. canReadMedia is consent-based and fails closed.
// ---------------------------------------------------------------------------

describe("P09 consent-based read policy", () => {
  it("only consented rows are public; unknown consent is private; rejected is never public", () => {
    expect(canReadMedia({ media_type: "photo", mime_type: "image/jpeg", role: "profile", verification: "federation_verified", consent_state: "shared_public" })).toBe(true);
    expect(canReadMedia({ media_type: "photo", mime_type: "image/jpeg", role: "profile", verification: "federation_verified" })).toBe(false); // missing consent fails closed
    expect(canReadMedia({ media_type: "photo", mime_type: "image/jpeg", role: "profile", verification: "rejected", consent_state: "shared_public" })).toBe(false);
    expect(canReadMedia({ media_type: "document", role: "passport", verification: "federation_verified", consent_state: "private" })).toBe(false);
    expect(canReadMedia({ media_type: "document", role: "passport", verification: "federation_verified", consent_state: "private", uploaded_by_user_id: "u1" }, { user: { id: "u1", role: "user" } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Handler-level tests through the module (mocked D1).
// ---------------------------------------------------------------------------

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  media?: Record<string, unknown> | null;
  grant?: Record<string, unknown> | null;
  quarantineRows?: unknown[];
  blobs?: Array<{ chunk: number; data: ArrayBuffer }>;
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string): unknown => {
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("FROM horse_media m JOIN horses h")) return script.media ?? null;
    if (sql.includes("FROM horse_media WHERE id=?")) return script.media ?? null;
    if (sql.includes("FROM media_access_grants")) return script.grant ?? null;
    if (sql.includes("FROM horses WHERE id=?")) return { id: 1 };
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("FROM horse_media m") && sql.includes("quarantine_reason")) return { results: script.quarantineRows ?? [] };
    if (sql.includes("FROM horse_media_blobs")) return { results: script.blobs ?? [] };
    return { results: [] };
  };
  interface Builder {
    sql: string; args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }
  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => answerFirst(sql),
    all: async () => answerAll(sql),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      return statements.map(() => ({ results: [], success: true, meta: { changes: 1 } }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes });
}

const staffSession = {
  session_id: "s-1", csrf_token: "csrf-1",
  expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "editor-1", email: "editor@example.com", display_name: "Editor",
  role: "editor", is_active: 1,
};

const ownerSession = { ...staffSession, id: "user-9", role: "user" };

function uploadRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/horses/1/media`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };

describe("P09 upload handler", () => {
  const jpeg = jpegWithExif();
  const baseBody = { media_type: "photo", role: "gallery", file_name: "photo.jpg", mime_type: "image/jpeg", data_base64: toBase64(jpeg) };

  it("rejects an oversized payload before any storage write", async () => {
    const db = makeDb({ session: staffSession });
    const big = "A".repeat(5 * 1024 * 1024); // > 3 MB decoded
    await expect(uploadHorseMedia(uploadRequest({ ...baseBody, data_base64: big }), { ...env, DB: db }, 1))
      .rejects.toMatchObject({ status: 413 });
  });

  it("rejects a MIME type outside the allowlist (SVG/HTML can never upload)", async () => {
    const db = makeDb({ session: staffSession });
    await expect(uploadHorseMedia(uploadRequest({ ...baseBody, mime_type: "image/svg+xml", data_base64: toBase64(new TextEncoder().encode("<svg onload=alert(1)>")) }), { ...env, DB: db }, 1))
      .rejects.toMatchObject({ status: 415, code: "unsupported_media_type" });
  });

  it("rejects a signature mismatch (browser MIME is never trusted)", async () => {
    const db = makeDb({ session: staffSession });
    await expect(uploadHorseMedia(uploadRequest({ ...baseBody, mime_type: "image/png", data_base64: toBase64(new TextEncoder().encode("not a png at all..........")) }), { ...env, DB: db }, 1))
      .rejects.toMatchObject({ status: 415, code: "media_signature_mismatch" });
  });

  it("rejects an active-content PDF and stores NOTHING", async () => {
    const db = makeDb({ session: staffSession });
    const evilPdf = `%PDF-1.7\n1 0 obj << /JavaScript (app.launch('calc')) >> endobj\n%%EOF`;
    await expect(uploadHorseMedia(uploadRequest({ media_type: "document", role: "certificate", file_name: "cert.pdf", mime_type: "application/pdf", data_base64: toBase64(new TextEncoder().encode(evilPdf)) }), { ...env, DB: db }, 1))
      .rejects.toMatchObject({ status: 415, code: "media_active_content" });
    expect(db.__writes.filter((w) => w.sql.includes("INSERT INTO horse_media")).length).toBe(0);
  });

  it("stores metadata-stripped bytes and records the hygiene outcome", async () => {
    const db = makeDb({ session: staffSession });
    const response = await uploadHorseMedia(uploadRequest(baseBody), { ...env, DB: db }, 1);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { media: { size_bytes: number; consent_state: string; location_metadata_stripped: boolean } };
    expect(body.media.location_metadata_stripped).toBe(true);
    expect(body.media.size_bytes).toBeLessThan(jpeg.byteLength);
    expect(body.media.consent_state).toBe("private");
    const insert = db.__writes.find((w) => w.sql.includes("INSERT INTO horse_media"));
    expect(insert).toBeTruthy();
    expect(insert?.sql).toContain("consent_state");
    expect(String(insert?.sql)).toContain("'private'");
    // The stored blob chunk is the STRIPPED byte stream (smaller than the original).
    const blob = db.__writes.find((w) => w.sql.includes("INSERT INTO horse_media_blobs"));
    expect((blob?.args[2] as ArrayBuffer).byteLength).toBe(body.media.size_bytes);
  });

  it("refuses an unprivileged session without a horse grant", async () => {
    const db = makeDb({ session: ownerSession }); // role user, no grants -> grant lookup returns [] -> denied
    await expect(uploadHorseMedia(uploadRequest(baseBody), { ...env, DB: db }, 1))
      .rejects.toMatchObject({ status: 403, code: "media_upload_permission_required" });
  });
});

describe("P09/R148 access minting and session-bound delivery on real SQL",()=>{
  const mediaId="11111111-1111-4111-8111-111111111111";
  async function fixture(){
    const db=await openRealDatabase();await seedUser(db,"user-9");await seedUser(db,"other");
    const bytes=new TextEncoder().encode("%PDF-1.4\nSynthetic private passport\n%%EOF");
    await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic private media horse')");
    await db.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,mime_type,file_name,size_bytes,uploaded_by_user_id,consent_state)
      VALUES(?,1,'document','passport','application/pdf','passport.pdf',?,'user-9','private')`).bind(mediaId,bytes.length).run();
    await db.prepare("INSERT INTO horse_media_blobs(media_id,chunk,data) VALUES(?,0,?)").bind(mediaId,bytes).run();
    const session=await makeSession(db,"user-9"),other=await makeSession(db,"other");
    const request=()=>authedRequest(`/api/media/${mediaId}/access`,{},{session});
    const auth=await getAuth(db,request(),"hr_session");
    return {db,session,other,request,auth:auth!,env:{DB:db,SESSION_COOKIE_NAME:"hr_session",MEDIA_ACCESS_TOKEN_SECRET:SECRET}};
  }
  it("mints a bounded grant bound to the exact current session bearer",async()=>{
    const c=await fixture();const response=await mintMediaAccess(c.request(),c.env,mediaId);
    expect(response.status).toBe(201);
    const body=await response.json() as {token:string;url:string;ttl_seconds:number;evidence_class:string;consent_state:string};
    expect(body).toMatchObject({ttl_seconds:900,evidence_class:"passport",consent_state:"private"});
    expect((await verifyMediaAccessToken(body.token,SECRET))?.mediaId).toBe(mediaId);
    expect(await c.db.prepare("SELECT granted_to_session_id,granted_to_token_hash FROM media_access_grants").first())
      .toEqual({granted_to_session_id:c.auth.sessionId,granted_to_token_hash:c.auth.sessionTokenHash});
  });
  it("fails closed without the deployment signing secret",async()=>{
    const c=await fixture();await expect(mintMediaAccess(c.request(),{DB:c.db,SESSION_COOKIE_NAME:"hr_session"},mediaId)).rejects.toMatchObject({status:503,code:"token_access_unconfigured"});
  });
  it("does not mint for an unrelated reader",async()=>{
    const c=await fixture();await expect(mintMediaAccess(authedRequest(`/api/media/${mediaId}/access`,{},{session:c.other}),c.env,mediaId)).rejects.toMatchObject({status:404});
  });
  it("requires the current authenticated session even for a valid signed link",async()=>{
    const c=await fixture();const body=await (await mintMediaAccess(c.request(),c.env,mediaId)).json() as {url:string;token:string};
    const url=new URL(body.url,ORIGIN);
    await expect(serveMediaFile(c.db,mediaId,url,null,SECRET)).rejects.toMatchObject({status:404});
    const response=await serveMediaFile(c.db,mediaId,url,c.auth,SECRET);
    expect(response.status).toBe(200);expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const tampered=new URL(`/api/media/file/${mediaId}?token=${encodeURIComponent(body.token.slice(0,-3)+"xyz")}`,ORIGIN);
    await expect(serveMediaFile(c.db,mediaId,tampered,c.auth,SECRET)).rejects.toMatchObject({status:404});
  });
  it("revocation, old unbound grants and session deletion immediately close delivery",async()=>{
    const c=await fixture();const body=await (await mintMediaAccess(c.request(),c.env,mediaId)).json() as {url:string};const url=new URL(body.url,ORIGIN);
    await c.db.exec("UPDATE media_access_grants SET granted_to_session_id=NULL");
    await expect(serveMediaFile(c.db,mediaId,url,c.auth,SECRET)).rejects.toMatchObject({status:404});
    await c.db.prepare("UPDATE media_access_grants SET granted_to_session_id=?,revoked_at=CURRENT_TIMESTAMP").bind(c.auth.sessionId).run();
    await expect(serveMediaFile(c.db,mediaId,url,c.auth,SECRET)).rejects.toMatchObject({status:404});
    await c.db.exec("DELETE FROM sessions");
    await expect(serveMediaFile(c.db,mediaId,new URL(`/api/media/file/${mediaId}`,ORIGIN),c.auth,SECRET)).rejects.toMatchObject({status:404});
  });
});

describe("P09 operator quarantine queue", () => {
  it("surfaces pending + quarantined items with reasons and NO payload fields", async () => {
    const db = await openRealDatabase();
    await seedUser(db,"quarantine-editor","editor");
    const session = await makeSession(db,"quarantine-editor");
    await db.exec("INSERT INTO horses(id,name_latin) VALUES(1,'Synthetic quarantine subject'),(2,'Synthetic rejected subject')");
    await db.prepare(`INSERT INTO horse_media(id,horse_id,media_type,role,file_name,mime_type,size_bytes,verification,quarantine_reason,quarantined_at,created_at,uploaded_by_user_id)
      VALUES('a',1,'photo','gallery','x.jpg','image/jpeg',10,'pending',NULL,NULL,?,'quarantine-editor'),
      ('b',2,'document','passport','p.pdf','application/pdf',20,'rejected','Blurry scan',?,?, 'quarantine-editor')`)
      .bind(new Date(Date.now()-63*86400000).toISOString(),new Date(Date.now()-3*86400000).toISOString(),new Date(Date.now()-4*86400000).toISOString()).run();
    const request = authedRequest('/api/admin/media/quarantine',undefined,{session});
    const response = await adminMediaQuarantine(request, { ...env, DB: db });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { queue: Array<Record<string, unknown>>; counts: Record<string, number>; retention: { abandoned_after_days: number } };
    expect(body.counts.pending_review).toBe(1);
    expect(body.counts.quarantined).toBe(1);
    expect(body.counts.abandoned_pending).toBe(1);
    expect(body.retention.abandoned_after_days).toBe(30);
    const first = body.queue.find((item) => item.id === "a")!;
    expect(first.abandoned).toBe(true);
    const quarantined = body.queue.find((item) => item.id === "b")!;
    expect(quarantined.quarantine_reason).toBe("Blurry scan");
    // Metadata only — no blob bytes, no data_base64 anywhere in the payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("data_base64");
    expect(serialized).not.toContain("chunk");
  });

  it("refuses non-staff viewers", async () => {
    const db = makeDb({ session: { ...staffSession, role: "user" } });
    const request = new Request(`${ORIGIN}/api/admin/media/quarantine`, { headers: { cookie: "hr_session=t" } });
    await expect(adminMediaQuarantine(request, { ...env, DB: db })).rejects.toMatchObject({ status: 403 });
  });
});
