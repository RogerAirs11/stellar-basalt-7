import { describe, expect, it } from "vitest";
import { mediaFixture as fixture } from "../helpers/mediaFixtures";
import worker from "../../src/worker";
import { isActiveSponsoredPlacement } from "../../src/api/modules/marketplace";
import { isPublicMedia, hasExpectedMediaSignature, signMediaAccessToken, verifyMediaAccessToken } from "../../src/api/modules/mediaPolicy";
import { sanitizeImage } from "../../src/api/modules/mediaImageHygiene";
import { openRealDatabase, seedUser, makeSession, authedRequest, type AuthedSession } from "../helpers/realDatabase";

const SECRET = "isolated-test-only-media-signing-secret";
const decodeText = (data: Uint8Array) => new TextDecoder("latin1").decode(data);
const formats = [["metadata.jpg", "image/jpeg"], ["progressive-metadata.jpg", "image/jpeg"], ["metadata.png", "image/png"],
  ["metadata.gif", "image/gif"], ["animated-metadata.gif", "image/gif"], ["metadata.webp", "image/webp"],
  ["lossless-metadata.webp", "image/webp"], ["animated-metadata.webp", "image/webp"]] as const;

describe("R111 bounded image-container sanitization", () => {
  it.each(formats)("removes EXIF/GPS/XMP/comments from %s and is stable on a second pass", (name, mime) => {
    const original = fixture(name);
    expect(decodeText(original)).toContain("SYNTHETIC-OWNER-SENTINEL");
    const clean = sanitizeImage(original, mime);
    expect(clean).toMatchObject({ stripped: true, width: 3, height: 3 });
    expect(decodeText(clean.bytes)).not.toContain("SYNTHETIC-");
    expect(decodeText(clean.bytes)).not.toContain("Exif");
    expect(decodeText(clean.bytes)).not.toContain("XMP DataXMP");
    expect(hasExpectedMediaSignature(clean.bytes, mime)).toBe(true);
    expect(sanitizeImage(clean.bytes, mime).bytes).toEqual(clean.bytes);
  });

  it.each(formats)("fails closed for truncated or trailing bytes in %s", (name, mime) => {
    const bytes = fixture(name);
    expect(() => sanitizeImage(bytes.slice(0, -3), mime)).toThrow();
    expect(() => sanitizeImage(new Uint8Array([...bytes, 60, 115, 99, 114, 105, 112, 116, 62]), mime)).toThrow();
  });

  it("recognizes a real AVIF but refuses to pretend its metadata was sanitized", () => {
    const bytes = fixture("metadata.avif");
    expect(hasExpectedMediaSignature(bytes, "image/avif")).toBe(true);
    expect(() => sanitizeImage(bytes, "image/avif")).toThrow(/Convert AVIF/);
  });

  it("rejects metadata hidden in unsupported JPEG extension/reserved markers", () => {
    const jpeg = fixture("metadata.jpg"), payload = new TextEncoder().encode("SYNTHETIC-OWNER-SENTINEL");
    for (const marker of [0x02, 0xc8]) {
      const altered = new Uint8Array([jpeg[0]!, jpeg[1]!, 0xff, marker, 0, payload.length + 2, ...payload, ...jpeg.subarray(2)]);
      expect(() => sanitizeImage(altered, "image/jpeg")).toThrow(/unsupported structure/);
    }
  });

  it("bounds input bytes and dimensions without allocating decoded pixel buffers", () => {
    expect(() => sanitizeImage(new Uint8Array(3 * 1024 * 1024 + 1), "image/png")).toThrow(/3 MB/);
    const gif = fixture("metadata.gif"); gif[6] = 255; gif[7] = 255;
    expect(() => sanitizeImage(gif, "image/gif")).toThrow(/16 million pixels/);
    const webp = fixture("metadata.webp"); webp[24] = 255; webp[25] = 255; webp[26] = 255;
    expect(() => sanitizeImage(webp, "image/webp")).toThrow(/16 million pixels/);
  });

  it("checks PNG CRCs and WebP RIFF/chunk bounds", () => {
    const png = fixture("metadata.png"); png[29] = png[29]! ^ 1;
    expect(() => sanitizeImage(png, "image/png")).toThrow();
    const webp = fixture("metadata.webp"); new DataView(webp.buffer).setUint32(4, 0xffffffff, true);
    expect(() => sanitizeImage(webp, "image/webp")).toThrow();
    const overflow = fixture("metadata.webp"); new DataView(overflow.buffer).setUint32(16, 0xffffffff, true);
    expect(() => sanitizeImage(overflow, "image/webp")).toThrow();
  });
});

async function setup() {
  const db = await openRealDatabase();
  await seedUser(db, "media-owner", "owner");
  await seedUser(db, "media-other", "owner");
  await seedUser(db, "media-admin", "admin");
  await db.exec(`INSERT INTO horses(id,name_latin) VALUES(1,'DEMO media horse'),(2,'DEMO unrelated horse');
    INSERT INTO horse_access_grants(id,horse_id,grantee_user_id,relationship,actions,basis,valid_from)
      VALUES('media-owner-grant',1,'media-owner','owner','manage_profile,upload_media,create_listing,manage_inquiries','admin_grant','2000-01-01 00:00:00'),
            ('media-other-grant',2,'media-other','owner','upload_media','admin_grant','2000-01-01 00:00:00');`);
  const owner = await makeSession(db, "media-owner"), other = await makeSession(db, "media-other"), admin = await makeSession(db, "media-admin");
  const env = { DB: db, APP_ENV: "test", DB_PROVIDER_MODE: "d1_full", SESSION_COOKIE_NAME: "hr_session", MEDIA_ACCESS_TOKEN_SECRET: SECRET } as Env;
  const http = (path: string, body?: unknown, session?: AuthedSession, options: { method?: string; key?: string } = {}) =>
    worker.fetch(authedRequest(path, body, { session, method: options.method, headers: options.key ? { "idempotency-key": options.key } : undefined }), env);
  const upload = async (overrides: Record<string, unknown> = {}) => {
    const response = await http("/api/horses/1/media", { media_type: "photo", role: "gallery", file_name: "DEMO.png", mime_type: "image/png",
      data_base64: Buffer.from(fixture("metadata.png")).toString("base64"), ...overrides }, owner);
    expect(response.status).toBe(201);
    return (await response.json() as any).media as { id: string; row_version: number; size_bytes: number };
  };
  const consent = (id: string, state: string, version: number, session = owner, key?: string) =>
    http(`/api/media/${id}/publication`, { consent_state: state, expected_version: version }, session, { key });
  const review = (id: string, decision = "platform_reviewed") => http(`/api/admin/media/${id}/verify`, { decision }, admin);
  return { db, owner, other, admin, http, upload, consent, review };
}

describe("R111 media routes against the actual Worker, real sessions and migrated SQLite", () => {
  it("runs upload → review → explicit publication → public bytes → withdrawal", async () => {
    const c = await setup();
    const media = await c.upload();
    expect((await c.http(`/api/media/file/${media.id}`)).status).toBe(404);
    expect((await c.review(media.id)).status).toBe(200);
    expect((await c.http(`/api/media/file/${media.id}`)).status).toBe(404); // review never implies consent
    const publish = await c.consent(media.id, "shared_public", 2, c.owner, "publish-valid-001");
    expect(publish.status).toBe(200);
    const visible = await c.http("/api/horses/1/media");
    const listing = await visible.json() as any;
    expect(listing.counts).toEqual({ photos: 1, documents: 0, verified: 1 });
    expect(listing.media[0]).toMatchObject({ public_visible: true, consent_state: "shared_public", row_version: 3, can_publish: false, can_withdraw: false });
    const file = await c.http(`/api/media/file/${media.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(decodeText(new Uint8Array(await file.arrayBuffer()))).not.toContain("SYNTHETIC-");
    expect((await c.consent(media.id, "private", 3)).status).toBe(200);
    expect((await c.http(`/api/media/file/${media.id}`)).status).toBe(404);
    expect((await (await c.http("/api/horses/1/media")).json() as any).counts).toEqual({ photos: 0, documents: 0, verified: 0 });
    expect((await c.http(`/api/media/file/${media.id}`, undefined, c.owner)).status).toBe(200);
  });

  it("keeps private/rejected/quarantined/evidence-role media out of gallery and marketplace counts/metadata", async () => {
    const c = await setup();
    const variants = [
      { consent: "shared_public", verification: "federation_verified", role: "gallery", type: "photo", quarantine: null },
      { consent: "private", verification: "federation_verified", role: "gallery", type: "photo", quarantine: null },
      { consent: "shared_public", verification: "rejected", role: "gallery", type: "photo", quarantine: null },
      { consent: "shared_public", verification: "federation_verified", role: "gallery", type: "photo", quarantine: "PRIVATE-QUARANTINE" },
      { consent: "shared_public", verification: "pending", role: "gallery", type: "photo", quarantine: null },
      { consent: "shared_public", verification: "federation_verified", role: "passport", type: "photo", quarantine: null },
      { consent: "shared_public", verification: "federation_verified", role: "gallery", type: "document", quarantine: null },
    ];
    const ids: string[] = [];
    for (const [i, v] of variants.entries()) {
      const media = await c.upload({ file_name: i ? `PRIVATE-SENTINEL-${i}.png` : "PUBLIC.png", caption: i ? "PRIVATE-CAPTION" : "Public fixture" });
      await c.db.prepare("UPDATE horse_media SET consent_state=?,verification=?,role=?,media_type=?,quarantine_reason=? WHERE id=?")
        .bind(v.consent, v.verification, v.role, v.type, v.quarantine, media.id).run();
      ids.push(media.id);
    }
    const id = "55555555-5555-4555-a555-555555555555";
    await c.db.prepare("INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,status) VALUES(?,1,'media-owner','DEMO seller','active')").bind(id).run();
    for (const session of [undefined, c.other]) {
      const response = await c.http("/api/horses/1/media", undefined, session);
      const text = await response.text();
      expect(text).not.toContain("PRIVATE-");
      const body = JSON.parse(text);
      expect(body.media.map((m: any) => m.id)).toEqual([ids[0]]);
      expect(body.counts).toEqual({ photos: 1, documents: 0, verified: 1 });
      const detail = await c.http(`/api/market/listings/${id}`, undefined, session);
      expect(detail.status).toBe(200);
      const detailText = await detail.text(); expect(detailText).not.toContain("PRIVATE-");
      expect(JSON.parse(detailText).listing.verified_media_count).toBe(0);
      expect(JSON.parse(detailText).media.map((m: any) => m.id)).toEqual([ids[0]]);
    }
    const market = await (await c.http("/api/market/listings")).json() as any;
    expect(market.rows[0].verified_media_count).toBe(0);
    for (const session of [c.owner, c.admin]) {
      const own = await (await c.http("/api/horses/1/media", undefined, session)).json() as any;
      expect(own.media).toHaveLength(variants.length);
      expect(JSON.stringify(own)).not.toContain("PRIVATE-QUARANTINE");
    }
    for (const hidden of ids.slice(1)) expect((await c.http(`/api/media/file/${hidden}`)).status).toBe(404);
    // A timestamp-only quarantine is also private (not just a rejection token).
    await c.db.prepare("UPDATE horse_media SET quarantined_at=CURRENT_TIMESTAMP WHERE id=?").bind(ids[0]).run();
    expect((await (await c.http("/api/horses/1/media")).json() as any).counts.photos).toBe(0);
  });

  it("denies unrelated owners and staff consent, private document publication, and revoked publication authority", async () => {
    const c = await setup(), media = await c.upload();
    await c.review(media.id);
    for (const session of [c.other, c.admin]) expect((await c.consent(media.id, "shared_public", 2, session)).status).toBe(403);
    const doc = await c.upload({ media_type: "document", role: "passport" }); await c.review(doc.id);
    expect((await c.consent(doc.id, "shared_public", 2)).status).toBe(409);
    await c.db.exec("UPDATE horse_access_grants SET revoked_at=CURRENT_TIMESTAMP WHERE id='media-owner-grant'");
    expect((await c.consent(media.id, "shared_public", 2)).status).toBe(403);
    await c.db.prepare("UPDATE horse_media SET consent_state='shared_public' WHERE id=?").bind(media.id).run();
    expect((await c.consent(media.id, "private", 2)).status).toBe(200); // consent can still be withdrawn
  });

  it("atomic version guards admit one competing write and create only its audit", async () => {
    const c = await setup(), media = await c.upload(); await c.review(media.id);
    const responses = await Promise.all([c.consent(media.id, "shared_public", 2), c.consent(media.id, "private", 2)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const audits = await c.db.prepare("SELECT * FROM audit_events WHERE action='media.publication' AND entity_id=?").bind(media.id).all();
    expect(audits.results).toHaveLength(1);
    expect((await c.db.prepare("SELECT row_version FROM horse_media WHERE id=?").bind(media.id).first() as any).row_version).toBe(3);
  });

  it("same-intent retries replay once; reused keys and stale new intents return 409", async () => {
    const c = await setup(), media = await c.upload(); await c.review(media.id);
    expect((await c.consent(media.id, "shared_public", 2, c.owner, "same-intent-key-001")).status).toBe(200);
    const retry = await c.consent(media.id, "shared_public", 2, c.owner, "same-intent-key-001");
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ replayed: true, row_version: 3 });
    expect((await c.consent(media.id, "private", 2, c.owner, "same-intent-key-001")).status).toBe(409);
    expect((await c.consent(media.id, "shared_public", 2, c.owner, "new-stale-key-0002")).status).toBe(409);
    expect((await c.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='media.publication'").first() as any).n).toBe(1);
  });

  it("binds independent grants, honors exact revocation, and preserves staff authority only while current", async () => {
    const c = await setup(), media = await c.upload({ media_type: "document", role: "other" });
    const mint = async (session: AuthedSession) => {
      const r = await c.http(`/api/media/${media.id}/access`, {}, session); expect(r.status).toBe(201); return await r.json() as any;
    };
    expect((await c.http(`/api/media/${media.id}/access`, {}, c.other)).status).toBe(404);
    const first = await mint(c.owner), second = await mint(c.owner), staff = await mint(c.admin);
    expect(first.grant_id).not.toBe(second.grant_id);
    expect((await c.http(staff.url, undefined, c.admin)).status).toBe(200);
    expect((await c.http(`/api/media/${media.id}/access/${first.grant_id}`, undefined, c.owner, { method: "DELETE" })).status).toBe(200);
    expect((await c.http(first.url, undefined, c.owner)).status).toBe(404);
    expect((await c.http(second.url, undefined, c.owner)).status).toBe(200);
    await c.db.exec("UPDATE users SET role='user' WHERE id='media-admin'");
    expect((await c.http(staff.url, undefined, c.admin)).status).toBe(404);
    await c.db.exec("UPDATE users SET is_active=0 WHERE id='media-owner'");
    expect((await c.http(second.url, undefined, c.owner)).status).toBe(404);
  });

  it("does not claim successful link revocation after a zero-change write", async () => {
    const c = await setup(), media = await c.upload();
    const grant = await (await c.http(`/api/media/${media.id}/access`, {}, c.owner)).json() as any;
    // Force the actual UPDATE to make no change. A lost-authority race can
    // produce this same result after the initial grant lookup succeeds.
    await c.db.exec("CREATE TRIGGER r111_ignore_revoke BEFORE UPDATE OF revoked_at ON media_access_grants BEGIN SELECT RAISE(IGNORE); END;");
    const response = await c.http(`/api/media/${media.id}/access/${grant.grant_id}`, undefined, c.owner, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe("media_access_conflict");
    expect((await c.http(grant.url, undefined, c.owner)).status).toBe(200);
    await c.db.exec("DROP TRIGGER r111_ignore_revoke;");
    expect((await c.http(`/api/media/${media.id}/access/${grant.grant_id}`, undefined, c.owner, { method: "DELETE" })).status).toBe(200);
    expect((await c.http(grant.url, undefined, c.owner)).status).toBe(404);
  });

  it("withdrawal and rejection invalidate existing signed URLs as well as public projections", async () => {
    const c = await setup(), media = await c.upload(); await c.review(media.id); await c.consent(media.id, "shared_public", 2);
    const token = await (await c.http(`/api/media/${media.id}/access`, {}, c.other)).json() as any;
    expect((await c.http(token.url, undefined, c.other)).status).toBe(200);
    await c.consent(media.id, "private", 3);
    expect((await c.http(token.url, undefined, c.other)).status).toBe(404);
    await c.consent(media.id, "shared_public", 4);
    const next = await (await c.http(`/api/media/${media.id}/access`, {}, c.other)).json() as any;
    await c.review(media.id, "rejected");
    expect((await c.http(next.url, undefined, c.other)).status).toBe(404);
    expect((await c.http(`/api/media/file/${media.id}`)).status).toBe(404);
    expect((await (await c.http("/api/horses/1/media")).json() as any).media).toHaveLength(0);
  });

  it("fails closed on changed expiry, deleted horse and missing or noncontiguous chunks", async () => {
    const c = await setup(), media = await c.upload();
    const grant = await (await c.http(`/api/media/${media.id}/access`, {}, c.owner)).json() as any;
    await c.db.prepare("UPDATE media_access_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_binding=?").bind(grant.grant_id).run();
    expect((await c.http(grant.url, undefined, c.owner)).status).toBe(404);
    await c.db.exec("UPDATE horses SET deleted_at=CURRENT_TIMESTAMP WHERE id=1");
    expect((await c.http(`/api/media/file/${media.id}`, undefined, c.owner)).status).toBe(404);
    await c.db.exec("UPDATE horses SET deleted_at=NULL WHERE id=1");
    await c.db.prepare("UPDATE horse_media_blobs SET chunk=2 WHERE media_id=?").bind(media.id).run();
    expect((await c.http(`/api/media/file/${media.id}`, undefined, c.owner)).status).toBe(503);
    await c.db.prepare("DELETE FROM horse_media_blobs WHERE media_id=?").bind(media.id).run();
    expect((await c.http(`/api/media/file/${media.id}`, undefined, c.owner)).status).toBe(503);
  });

  it("uploads and delivers sanitized bytes for every accepted image format; AVIF writes nothing", async () => {
    const c = await setup();
    for (const [name, mime] of formats) {
      const m = await c.upload({ file_name: name, mime_type: mime, data_base64: Buffer.from(fixture(name)).toString("base64"), width: 9999, height: 9999 });
      const stored = await c.db.prepare("SELECT width,height FROM horse_media WHERE id=?").bind(m.id).first();
      expect(stored).toMatchObject({ width: 3, height: 3 }); // client dimensions are not authority
      const bytes = await c.http(`/api/media/file/${m.id}`, undefined, c.owner);
      expect(bytes.status).toBe(200); expect(decodeText(new Uint8Array(await bytes.arrayBuffer()))).not.toContain("SYNTHETIC-");
    }
    const rejected = await c.http("/api/horses/1/media", { media_type: "photo", role: "gallery", file_name: "metadata.avif", mime_type: "image/avif", data_base64: Buffer.from(fixture("metadata.avif")).toString("base64") }, c.owner);
    expect(rejected.status).toBe(415);
    expect((await c.db.prepare("SELECT COUNT(*) AS n FROM horse_media").first() as any).n).toBe(formats.length);
  });

  it("sanitizes legacy stored image bytes on delivery too", async () => {
    const c = await setup(), media = await c.upload();
    const original = fixture("metadata.webp");
    await c.db.prepare("UPDATE horse_media SET mime_type='image/webp',size_bytes=?,consent_state='shared_public',verification='federation_verified' WHERE id=?").bind(original.length, media.id).run();
    await c.db.prepare("UPDATE horse_media_blobs SET data=? WHERE media_id=?").bind(original, media.id).run();
    const response = await c.http(`/api/media/file/${media.id}`);
    expect(response.status).toBe(200); expect(decodeText(new Uint8Array(await response.arrayBuffer()))).not.toContain("SYNTHETIC-");
  });
});

describe("R111 policy and sponsorship boundary cases", () => {
  it("requires a supported photo purpose, explicit consent, review and no quarantine", () => {
    const base = { media_type: "photo", mime_type: "image/webp", role: "gallery", consent_state: "shared_public", verification: "federation_verified" };
    expect(isPublicMedia(base)).toBe(true);
    for (const extra of [{ consent_state: "private" }, { role: "passport" }, { media_type: "document" }, { verification: "pending" }, { verification: "rejected" }, { quarantined_at: "2026-01-01" }, { quarantine_reason: "blocked" }, { mime_type: "image/avif" }]) expect(isPublicMedia({ ...base, ...extra })).toBe(false);
  });
  it("rejects expired tokens and tokens without an exact grant binding", async () => {
    const now = Date.now(), grant = crypto.randomUUID();
    const token = await signMediaAccessToken("media-1", "user-1", grant, now + 60_000, SECRET);
    expect(await verifyMediaAccessToken(token, SECRET, now + 60_000)).toBeNull();
    expect(await verifyMediaAccessToken(token, "wrong", now)).toBeNull();
    const payload = Buffer.from(JSON.stringify({ m: "media-1", u: "user-1", e: now + 60_000 })).toString("base64url");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    expect(await verifyMediaAccessToken(`${payload}.${Buffer.from(sig).toString("base64url")}`, SECRET)).toBeNull();
  });
  it.each([
    ["2026-10-17T11:00:00Z", false], ["2026-10-17 11:00:00", false],
    ["2026-10-17T12:00:00Z", false], ["2026-10-17 12:00:01", true],
    ["2026-10-17T15:30:01+03:30", true], ["2026-10-17T15:30:00+03:30", false],
    ["2026-02-30T13:00:00Z", false], ["garbage", false], [null, false],
  ])("sponsorship expiry %s matches the actual instant", (value, active) => {
    expect(isActiveSponsoredPlacement(value, Date.parse("2026-10-17T12:00:00Z"))).toBe(active);
  });
});
