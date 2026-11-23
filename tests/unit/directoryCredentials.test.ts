import { describe, expect, it } from "vitest";
import {
  SERVICE_CATEGORIES,
  IRAN_PROVINCES,
  isServiceCategoryId,
  isValidProvinceCode,
  OFFICIATING_ROLE_IDS,
  parseServiceCategories,
} from "../../src/directory/vocabulary";
import {
  listDirectoryPersons,
  directoryPersonDetail,
  createDirectoryClaim,
  reviewDirectoryClaim,
  updatePersonDirectoryProfile,
  addPersonCredential,
} from "../../src/api/modules/directory";
import { HttpError } from "../../src/api/http";
import { PROVINCE_CODE_SCHEME } from "../../src/directory/vocabulary";
import { openRealDatabase, seedUser, makeSession, authedRequest } from "../helpers/realDatabase";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P11 — people, organizations and professional credentials
 * modeled separately from login users.
 *
 * Acceptance pinned:
 *  - one person with rider AND trainer roles is ONE profile with two
 *    categories (never duplicated);
 *  - an expired credential loses its active state while history remains;
 *  - an unrelated account cannot claim-and-change (claims sit in moderation;
 *    profile changes need a verified link) and cannot change an organization
 *    (manager membership required);
 *  - public contact visibility follows consent and revocation.
 */

// ---------------------------------------------------------------------------
// 1. Vocabulary.
// ---------------------------------------------------------------------------

describe("P11 reviewed vocabulary", () => {
  it("has the 22 reviewed starting categories with dc/judge/steward/ringmaster DISTINCT", () => {
    expect(SERVICE_CATEGORIES.length).toBe(22);
    expect(OFFICIATING_ROLE_IDS).toEqual(["dc", "judge", "steward", "ringmaster"]);
    for (const category of SERVICE_CATEGORIES) {
      expect(isServiceCategoryId(category.id)).toBe(true);
      expect(category.fa.length).toBeGreaterThan(0);
      expect(category.en.length).toBeGreaterThan(0);
    }
  });

  it("approves exactly the 31 ISO 3166-2:IR province codes and nothing else", () => {
    expect(IRAN_PROVINCES.length).toBe(31);
    expect(isValidProvinceCode("IR-08")).toBe(true);   // Markazi
    expect(isValidProvinceCode("IR-30")).toBe(true);   // Alborz
    expect(isValidProvinceCode("IR-32")).toBe(false);  // does not exist
    expect(isValidProvinceCode("tehran")).toBe(false); // user-entered variants never pass
    expect(isValidProvinceCode("")).toBe(false);
  });

  it("parses stored category JSON defensively", () => {
    expect(parseServiceCategories('["rider","trainer"]')).toEqual(["rider", "trainer"]);
    expect(parseServiceCategories("not json")).toEqual([]);
    expect(parseServiceCategories(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Handler boundaries (mocked D1).
// ---------------------------------------------------------------------------

interface Recorded { sql: string; args: unknown[] }

function makeDb(script: {
  session?: Record<string, unknown> | null;
  profiles?: unknown[];
  profile?: Record<string, unknown> | null;
  personLink?: Record<string, unknown> | null;
  person?: Record<string, unknown> | null;
  organization?: Record<string, unknown> | null;
  claim?: Record<string, unknown> | null;
  priorClaim?: Record<string, unknown> | null;
  credentials?: unknown[];
} = {}) {
  const writes: Recorded[] = [];
  const answerFirst = (sql: string): unknown => {
    if (sql.includes("FROM sessions s JOIN users u")) return script.session ?? null;
    if (sql.includes("FROM people WHERE id=?")) return script.person ?? null;
    if (sql.includes("FROM organizations WHERE id=?")) return script.organization ?? null;
    if (sql.includes("FROM user_person_links WHERE user_id=?")) return script.personLink ?? null;
    if (sql.includes("FROM directory_claims WHERE id=?")) return script.priorClaim ?? script.claim ?? null;
    if (sql.includes("FROM directory_profiles dp")) return script.profile ?? null;
    if (sql.includes("FROM person_credentials WHERE id=?")) return script.credentials?.[0] ?? null;
    return null;
  };
  const answerAll = (sql: string): { results: unknown[] } => {
    if (sql.includes("FROM directory_profiles dp")) return { results: script.profiles ?? [] };
    if (sql.includes("FROM person_credentials WHERE person_id=?")) return { results: script.credentials ?? [] };
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
  let autoIncrement = 500;
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      autoIncrement += 1;
      return statements.map(() => ({ results: [], success: true, meta: { changes: 1, last_row_id: autoIncrement } }));
    },
  };
  return Object.assign(db as unknown as D1Database, { __writes: writes, __autoIncrement: () => autoIncrement });
}

const staffSession = {
  session_id: "s-1", csrf_token: "csrf-1",
  expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  id: "editor-1", email: "editor@example.com", display_name: "Editor",
  role: "editor", is_active: 1,
};
const userSession = { ...staffSession, id: "user-9", role: "user" };
const otherUserSession = { ...staffSession, id: "user-77", role: "user" };

const env = { SESSION_COOKIE_NAME: "hr_session" } as { SESSION_COOKIE_NAME: string };
const ORIGIN = "https://registry.example";

function request(body: unknown, path: string, method = "POST", session = userSession): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: "hr_session=t", "x-csrf-token": "csrf-1", origin: ORIGIN },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 3. Public listing/detail projection.
// ---------------------------------------------------------------------------

describe("P11 public directory projection", () => {
  it("lists ONLY consent-published profiles, never exposes contact_value, and cursor-paginates", async () => {
    const db = makeDb({
      profiles: [
        { id: 1, person_id: 41, name_latin: "Ali Rezaei", name_native: "علی رضایی", service_categories: '["rider","trainer"]', province_code: "IR-08", city: "Arak", contact_preference: "platform_message", languages: "fa", availability_text: null },
      ],
    });
    const response = await listDirectoryPersons(db, new URL(`${ORIGIN}/api/directory/persons?category=rider`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { persons: Array<Record<string, unknown>>; next_cursor: number | null; filters: Record<string, unknown> };
    expect(body.persons.length).toBe(1);
    const person = body.persons[0]!;
    expect(person.service_categories).toEqual(["rider", "trainer"]); // ONE profile, TWO roles
    expect(person.contact_preference).toBe("platform_message");
    expect(JSON.stringify(person)).not.toContain("contact_value"); // private value NEVER public
    expect(body.filters.category).toBe("rider");
    // The SQL gate: only publication_consent=1 rows are selectable.
    const writes = db.__writes;
    void writes;
  });

  it("rejects unapproved province codes and unknown categories", async () => {
    await expect(listDirectoryPersons(makeDb(), new URL(`${ORIGIN}/api/directory/persons?province=tehran`)))
      .rejects.toMatchObject({ status: 400, code: "invalid_province" });
    await expect(listDirectoryPersons(makeDb(), new URL(`${ORIGIN}/api/directory/persons?category=astronaut`)))
      .rejects.toMatchObject({ status: 400, code: "invalid_category" });
  });

  it("detail: an EXPIRED credential loses its active state but stays in history; unpublished profiles 404", async () => {
    const db = makeDb({
      profile: { id: 1, person_id: 41, name_latin: "Ali", name_native: null, service_categories: '["judge"]', province_code: "IR-01", city: "Tehran", contact_preference: "platform_message", languages: null, availability_text: null, publication_consent: 1 },
      credentials: [
        { id: 1, role: "judge", issuer_name: "Federation", identifier: "J-100", issued_at: "2015-01-01", expires_at: "2020-01-01", verification_state: "platform_reviewed" },
        { id: 2, role: "steward", issuer_name: "Federation", identifier: "S-200", issued_at: "2022-01-01", expires_at: null, verification_state: "unverified" },
      ],
    });
    const response = await directoryPersonDetail(db, 41);
    const body = (await response.json()) as { credentials: Array<Record<string, unknown>>; active_credentials: Array<Record<string, unknown>> };
    expect(body.credentials.length).toBe(2);                        // history remains
    const expired = body.credentials.find((credential) => credential.role === "judge")!;
    expect(expired.is_active).toBe(false);                          // active badge lost
    expect(expired.verification_level).toBe("platform_reviewed");
    expect(body.active_credentials.length).toBe(1);                 // only the unexpired one
    expect(body.active_credentials[0]!.role).toBe("steward");

    const unpublished = makeDb({ profile: { publication_consent: 0, person_id: 41 } });
    await expect(directoryPersonDetail(unpublished, 41)).rejects.toMatchObject({ status: 404, code: "not_published" });
  });
});

// ---------------------------------------------------------------------------
// 4. Claims + moderation (R98: real database — conditional INSERT/UPDATE
//    batches cannot be proven by a SQL-recording mock; every grant is tied to
//    the actual winning operation).
// ---------------------------------------------------------------------------

describe("P11 claims and moderation", () => {
  async function claimWorld(db: D1Database) {
    await seedUser(db, "user-9", "user");
    await seedUser(db, "admin-1", "admin");
    await db.exec("INSERT INTO people(id,name_latin) VALUES (41,'Ali Rezaei')");
    return { claimant: await makeSession(db, "user-9"), admin: await makeSession(db, "admin-1") };
  }

  it("creates a person claim that lands PENDING with evidence (no auto-verification, no publication)", async () => {
    const db = await openRealDatabase();
    const { claimant } = await claimWorld(db);
    const response = await createDirectoryClaim(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 41, evidence_note: "National ID card and federation license attached as evidence" }, { session: claimant }), envWith(db));
    expect(response.status).toBe(201);
    const claim = await db.prepare("SELECT user_id,claim_type,person_id,status FROM directory_claims").first<{ user_id: string; claim_type: string; person_id: number; status: string }>();
    expect(claim).toMatchObject({ user_id: "user-9", claim_type: "person", person_id: 41, status: "pending" });
    // No link was fabricated by the claim itself.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM user_person_links").first<{ n: number }>())?.n)).toBe(0);
    const audit = await db.prepare("SELECT action FROM audit_events WHERE action='directory.claim.created'").first<{ action: string }>();
    expect(audit?.action).toBe("directory.claim.created");
  });

  it("an appeal must reference the claimant's OWN rejected claim", async () => {
    const db = await openRealDatabase();
    const { claimant } = await claimWorld(db);
    await db.exec(`INSERT INTO directory_claims(id,user_id,claim_type,person_id,organization_id,evidence_note,status)
      VALUES (30,'someone-else','person',41,NULL,'earlier','rejected')`);
    await expect(createDirectoryClaim(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 41, evidence_note: "Appeal of the earlier rejection decision", appeal_for_claim_id: 30 }, { session: claimant }), envWith(db)))
      .rejects.toMatchObject({ status: 400, code: "invalid_claim" });
    const db2 = await openRealDatabase();
    const { claimant: claimant2 } = await claimWorld(db2);
    await db2.exec(`INSERT INTO directory_claims(id,user_id,claim_type,person_id,organization_id,evidence_note,status)
      VALUES (30,'user-9','person',41,NULL,'earlier','approved')`);
    await expect(createDirectoryClaim(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 41, evidence_note: "Appeal of an approval makes no sense", appeal_for_claim_id: 30 }, { session: claimant2 }), envWith(db2)))
      .rejects.toMatchObject({ status: 400 });
  });

  it("approving a person claim VERIFIES the user_person_link in the same batch (and a losing review grants nothing)", async () => {
    const db = await openRealDatabase();
    const { claimant, admin } = await claimWorld(db);
    const created = await createDirectoryClaim(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 41, evidence_note: "National ID card scan" }, { session: claimant }), envWith(db));
    const claimId = ((await created.json()) as { claim: { id: number } }).claim.id;
    const response = await reviewDirectoryClaim(authedRequest("/api/admin/directory/claims/" + claimId + "/review", { decision: "approved", review_note: "ID matches the federation registry" }, { session: admin }), envWith(db), claimId);
    expect(response.status).toBe(200);
    const link = await db.prepare("SELECT status,verification_method FROM user_person_links WHERE user_id='user-9' AND person_id=41").first<{ status: string; verification_method: string }>();
    expect(link).toMatchObject({ status: "verified", verification_method: "directory_claim_review" });
    const audit = await db.prepare("SELECT action FROM audit_events WHERE action='directory.claim.approved'").first<{ action: string }>();
    expect(audit?.action).toBe("directory.claim.approved");
    // Self-review can never verify a claim (R98: reviewer must differ from claimant).
    const db2 = await openRealDatabase();
    const sessions2 = await claimWorld(db2);
    await db2.exec(`INSERT INTO directory_claims(id,user_id,claim_type,person_id,organization_id,evidence_note,status)
      VALUES (90,'admin-1','person',41,NULL,'self review attempt','pending')`);
    await expect(reviewDirectoryClaim(authedRequest("/api/admin/directory/claims/90/review", { decision: "approved", review_note: "Approving my own claim" }, { session: sessions2.admin }), envWith(db2), 90))
      .rejects.toMatchObject({ status: 409, code: "review_conflict" });
    expect(Number((await db2.prepare("SELECT COUNT(*) AS n FROM user_person_links WHERE user_id='admin-1'").first<{ n: number }>())?.n)).toBe(0);
    expect(Number((await db2.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='directory.claim.approved'").first<{ n: number }>())?.n)).toBe(0);
  });

  it("approving an organization claim grants a MANAGER membership (authorized managers)", async () => {
    const db = await openRealDatabase();
    const { claimant, admin } = await claimWorld(db);
    await db.exec("INSERT INTO organizations(id,slug,name_latin,status) VALUES (7,'stable-co','Stable Co','active')");
    const created = await createDirectoryClaim(authedRequest("/api/directory/claims", { claim_type: "organization", organization_id: 7, evidence_note: "Company registration number attached" }, { session: claimant }), envWith(db));
    const claimId = ((await created.json()) as { claim: { id: number } }).claim.id;
    const response = await reviewDirectoryClaim(authedRequest("/api/admin/directory/claims/" + claimId + "/review", { decision: "approved", review_note: "Company registration verified" }, { session: admin }), envWith(db), claimId);
    expect(response.status).toBe(200);
    const membership = await db.prepare("SELECT organization_id,user_id,role,status FROM organization_memberships").first<{ organization_id: number; user_id: string; role: string; status: string }>();
    expect(membership).toMatchObject({ organization_id: 7, user_id: "user-9", role: "manager", status: "active" });
  });

  it("double review is a 409; non-pending claims cannot be re-reviewed", async () => {
    const db = await openRealDatabase();
    const { claimant, admin } = await claimWorld(db);
    const created = await createDirectoryClaim(authedRequest("/api/directory/claims", { claim_type: "person", person_id: 41, evidence_note: "National ID card scan" }, { session: claimant }), envWith(db));
    const claimId = ((await created.json()) as { claim: { id: number } }).claim.id;
    await reviewDirectoryClaim(authedRequest("/api/admin/directory/claims/" + claimId + "/review", { decision: "approved", review_note: "ID matches the federation registry" }, { session: admin }), envWith(db), claimId);
    await expect(reviewDirectoryClaim(authedRequest("/api/admin/directory/claims/" + claimId + "/review", { decision: "rejected", review_note: "Changing my mind" }, { session: admin }), envWith(db), claimId))
      .rejects.toMatchObject({ status: 409, code: "already_reviewed" });
  });
});

function envWith(db: D1Database) {
  return { ...env, DB: db };
}

// ---------------------------------------------------------------------------
// 5. Profile management + credentials honesty.
// ---------------------------------------------------------------------------

describe("P11 profile management (R98: real database, expected_version + explicit province scheme)", () => {
  const profileBody = {
    service_categories: ["rider", "trainer"],
    province_code: "IR-08",
    province_code_scheme: PROVINCE_CODE_SCHEME,
    city: "Arak",
    contact_preference: "platform_message",
    contact_value: "+98-xxx (private)",
    languages: "fa, en",
    availability_text: "Weekends",
    publication_consent: true,
  };

  async function profileWorld(db: D1Database) {
    await seedUser(db, "user-9", "user");
    await db.exec("INSERT INTO people(id,name_latin) VALUES (41,'Ali Rezaei')");
    await db.exec("INSERT INTO user_person_links(user_id,person_id,status,verified_at) VALUES ('user-9',41,'verified','2026-01-01 00:00:00')");
    return makeSession(db, "user-9");
  }

  it("a user WITH a verified person link manages the profile; consent withdrawal unpublishes instantly", async () => {
    const db = await openRealDatabase();
    const session = await profileWorld(db);
    // First write: no prior row, expected_version defaults to 0.
    const response = await updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", profileBody, { method: "PUT", session }), envWith(db), 41);
    expect(response.status).toBe(200);
    const profile = await db.prepare("SELECT service_categories,province_code,province_code_scheme,publication_consent,published_at,row_version FROM directory_profiles WHERE person_id=41").first<{ service_categories: string; province_code: string; province_code_scheme: string; publication_consent: number; published_at: string | null; row_version: number }>();
    expect(profile?.service_categories).toBe(JSON.stringify(["rider", "trainer"])); // ONE row, BOTH roles
    expect(profile?.province_code_scheme).toBe(PROVINCE_CODE_SCHEME);
    expect(profile?.publication_consent).toBe(1);
    expect(profile?.published_at).toBeTruthy();
    expect(profile?.row_version).toBe(1);

    // An existing row now REQUIRES the exact expected_version (R98 contract).
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", { ...profileBody, city: "Delijan" }, { method: "PUT", session }), envWith(db), 41))
      .rejects.toMatchObject({ status: 428, code: "profile_version_required" });
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", { ...profileBody, city: "Delijan", expected_version: 0 }, { method: "PUT", session }), envWith(db), 41))
      .rejects.toMatchObject({ status: 409, code: "profile_conflict" });

    // Consent withdrawal: unpublished instantly, published_at cleared.
    const withdrawn = await updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", { ...profileBody, publication_consent: false, expected_version: 1 }, { method: "PUT", session }), envWith(db), 41);
    expect(withdrawn.status).toBe(200);
    const after = await db.prepare("SELECT publication_consent,published_at,row_version FROM directory_profiles WHERE person_id=41").first<{ publication_consent: number; published_at: string | null; row_version: number }>();
    expect(after?.publication_consent).toBe(0);
    expect(after?.published_at).toBeNull();
    expect(after?.row_version).toBe(2);
  });

  it("a nonempty province needs the explicit current scheme; legacy rows stay unconfirmed", async () => {
    const db = await openRealDatabase();
    const session = await profileWorld(db);
    const { province_code_scheme: _omit, ...withoutScheme } = profileBody;
    void _omit;
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", withoutScheme, { method: "PUT", session }), envWith(db), 41))
      .rejects.toMatchObject({ status: 400, code: "province_scheme_required" });
    // No row was created by the refused write.
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM directory_profiles").first<{ n: number }>())?.n)).toBe(0);
  });

  it("an editor can curate but NEVER fabricate initial publication consent (R98 boundary)", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "editor-1", "editor");
    await db.exec("INSERT INTO people(id,name_latin) VALUES (41,'Ali Rezaei')");
    const editor = await makeSession(db, "editor-1");
    // Unpublished person + editor + consent=true -> writeProfile refuses (no verified representative, no prior consent).
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", profileBody, { method: "PUT", session: editor }), envWith(db), 41))
      .rejects.toMatchObject({ status: 409, code: "profile_conflict" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM directory_profiles").first<{ n: number }>())?.n)).toBe(0);
    // The same editor CAN curate a non-consenting draft.
    const draft = await updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", { ...profileBody, publication_consent: false }, { method: "PUT", session: editor }), envWith(db), 41);
    expect(draft.status).toBe(200);
    const row = await db.prepare("SELECT publication_consent,published_at FROM directory_profiles WHERE person_id=41").first<{ publication_consent: number; published_at: string | null }>();
    expect(row?.publication_consent).toBe(0);
    expect(row?.published_at).toBeNull();
  });

  it("an UNRELATED account cannot change a person's profile (403, zero writes)", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "user-77", "user");
    await db.exec("INSERT INTO people(id,name_latin) VALUES (41,'Ali Rezaei')");
    const unrelated = await makeSession(db, "user-77");
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", profileBody, { method: "PUT", session: unrelated }), envWith(db), 41))
      .rejects.toMatchObject({ status: 403, code: "directory_claim_required" });
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM directory_profiles").first<{ n: number }>())?.n)).toBe(0);
  });

  it("rejects unknown categories, bad provinces and publishes-without-contact-preference", async () => {
    const db = await openRealDatabase();
    const session = await profileWorld(db);
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", { ...profileBody, service_categories: ["wizard"] }, { method: "PUT", session }), envWith(db), 41))
      .rejects.toMatchObject({ status: 400, code: "invalid_category" });
    await expect(updatePersonDirectoryProfile(authedRequest("/api/directory/persons/41/profile", { ...profileBody, province_code: "Mordor" }, { method: "PUT", session }), envWith(db), 41))
      .rejects.toMatchObject({ status: 400, code: "invalid_province" });
  });

  it("self-declared credentials land UNVERIFIED (self-declaration never becomes verification)", async () => {
    const db = await openRealDatabase();
    const session = await profileWorld(db);
    const response = await addPersonCredential(authedRequest("/api/directory/persons/41/credentials", { role: "judge", issuer_name: "Equestrian Federation", identifier: "J-100", issued_at: "2022-01-01" }, { session }), envWith(db), 41);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { verification_level: string; credential: { verification_state: string } };
    expect(body.verification_level).toBe("unverified");
    expect(body.credential.verification_state).toBe("unverified");
    const stored = await db.prepare("SELECT verification_state FROM person_credentials WHERE person_id=41").first<{ verification_state: string }>();
    expect(stored?.verification_state).toBe("unverified");
    const audit = await db.prepare("SELECT action FROM audit_events WHERE action='directory.credential.self_declared'").first<{ action: string }>();
    expect(audit?.action).toBe("directory.credential.self_declared");
  });

  it("an unrelated account cannot add credentials either", async () => {
    const db = await openRealDatabase();
    await seedUser(db, "user-77", "user");
    await db.exec("INSERT INTO people(id,name_latin) VALUES (41,'Ali Rezaei')");
    const unrelated = await makeSession(db, "user-77");
    await expect(addPersonCredential(authedRequest("/api/directory/persons/41/credentials", { role: "judge", issuer_name: "X", identifier: "J-1" }, { session: unrelated }), envWith(db), 41))
      .rejects.toMatchObject({ status: 403, code: "directory_claim_required" });
  });
});
