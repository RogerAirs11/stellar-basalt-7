import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTHORITY_ARM_TEMPLATE,
  buildActiveGrantPredicate,
  canonicalJson,
  commandRequestDigest,
  executeInquiryCreate,
  executeInquiryStatus,
  executeListingCreate,
  executeListingRenew,
  executeListingStatus,
  GRANT_PREDICATE_TEMPLATE,
  IDEMPOTENCY_KEY_PATTERN,
  INQUIRY_CREATE_SQL_TEMPLATE,
  INQUIRY_STATUS_SQL_TEMPLATE,
  isCommandReceiptConflict,
  LISTING_CREATE_SQL_TEMPLATE,
  LISTING_RENEW_SQL_TEMPLATE,
  LISTING_STATUS_SQL_TEMPLATE,
  readIdempotencyKey,
  receiptInsertStatement,
  resolveReceipt,
  sqliteNowText,
  staleListingWriteError,
  type CommandReceiptRow,
  type ReceiptScope,
} from "../../src/marketplace/commands";
import { HttpError } from "../../src/api/http";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P03 — versioned marketplace commands. These fixtures pin the
 * three guarantees the command layer adds: optimistic concurrency (409 with
 * current_version on stale writes), idempotency receipts (replay/conflict/
 * concurrent-claim), and in-transaction authority (the write itself carries
 * the version + seller + live-grant guards; a revocation race is a 403, and
 * sold is never an ownership transfer). SQL-shape pins keep the guards from
 * silently disappearing; the python replay suite executes the exact same
 * statements on a real SQLite database.
 */

const NOW = new Date("2026-10-03T12:00:00.000Z");
const SELLER = { user: { id: "seller-1" } };

// ---------------------------------------------------------------------------
// Scripted D1 fake (horseAccess pattern): first() answers by SQL shape,
// batch() replays scripted changes counts, and every write is recorded.
// ---------------------------------------------------------------------------

interface Script {
  receipts?: CommandReceiptRow[];
  listingVersion?: number;
  inquiryVersion?: number;
  horseExists?: boolean;
  updateChanges?: number[];
  batchError?: unknown;
}

interface Recorded {
  sql: string;
  args: unknown[];
}

function makeDb(script: Script): D1Database & { __writes: Recorded[]; __reads: Recorded[] } {
  const writes: Recorded[] = [];
  const reads: Recorded[] = [];
  const updateChanges = script.updateChanges ?? [];
  let changeIndex = 0;
  const answerFirst = (sql: string): unknown => {
    if (sql.includes("FROM command_receipts")) return script.receipts?.[0] ?? null;
    if (sql.includes("row_version FROM sales_listings")) return script.listingVersion === undefined ? null : { row_version: script.listingVersion };
    if (sql.includes("row_version FROM sales_inquiries")) return script.inquiryVersion === undefined ? null : { row_version: script.inquiryVersion };
    if (sql.includes("FROM horses WHERE id=")) return script.horseExists === false ? null : { id: 1 };
    return null;
  };
  interface Builder {
    sql: string;
    args: unknown[];
    bind: (...nextArgs: unknown[]) => Builder;
    first: () => Promise<unknown>;
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
  }

  const makeBuilder = (sql: string, args: unknown[]): Builder => ({
    sql, args,
    bind: (...nextArgs: unknown[]) => makeBuilder(sql, nextArgs),
    first: async () => { reads.push({ sql, args }); return answerFirst(sql); },
    all: async () => ({ results: [] }),
    run: async () => { writes.push({ sql, args }); const changes = updateChanges[changeIndex] ?? 1; changeIndex += 1; return { meta: { changes } }; },
  });
  const db = {
    prepare: (sql: string) => makeBuilder(sql, []),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      for (const statement of statements) writes.push({ sql: statement.sql, args: statement.args });
      if (script.batchError) throw script.batchError;
      return statements.map((_, index) => ({ meta: { changes: updateChanges[index] ?? 1 } }));
    },
    __writes: writes,
    __reads: reads,
  } as unknown as D1Database & { __writes: Recorded[]; __reads: Recorded[] };
  return db;
}

function receiptScope(overrides: Partial<ReceiptScope> = {}): ReceiptScope {
  return { key: "key-12345678", actorId: "seller-1", command: "listing.status", targetId: "listing-1", digest: "digest-a", ...overrides };
}

function storedReceipt(overrides: Partial<CommandReceiptRow> = {}): CommandReceiptRow {
  return {
    id: "key-12345678", actor_user_id: "seller-1", command: "listing.status", target_id: "listing-1",
    request_digest: "digest-a", status_code: 200, response_json: JSON.stringify({ id: "listing-1", status: "sold", row_version: 2 }), created_at: "2026-10-03 12:00:00",
    ...overrides,
  };
}

const statusInput = {
  listingId: "listing-1", expectedVersion: 1, currentStatus: "active", nextStatus: "pending_sale",
  isStaff: false, sellerUserId: "seller-1", horseId: 7, now: NOW,
};

describe("P03 digest and key handling", () => {
  it("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it("the same command+payload yields one digest; a different payload does not", async () => {
    const a = await commandRequestDigest("listing.status", { status: "sold", expected_version: 1 });
    const b = await commandRequestDigest("listing.status", { expected_version: 1, status: "sold" });
    const c = await commandRequestDigest("listing.status", { status: "sold", expected_version: 2 });
    const d = await commandRequestDigest("listing.renew", { status: "sold", expected_version: 1 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it("accepts well-formed idempotency keys and rejects malformed ones", () => {
    const header = (value: string | null) => new Request("https://x/", { method: "POST", headers: value === null ? {} : { "idempotency-key": value } });
    expect(readIdempotencyKey(header(null))).toBeNull();
    expect(readIdempotencyKey(header("key-12345678"))).toBe("key-12345678");
    expect(IDEMPOTENCY_KEY_PATTERN.test("abc.123_xyz-A")).toBe(true);
    expect(() => readIdempotencyKey(header("short"))).toThrowError(HttpError);
    expect(() => readIdempotencyKey(header("bad key!"))).toThrowError(HttpError);
  });

  it("classifies command_receipts unique conflicts, not other unique errors", () => {
    expect(isCommandReceiptConflict(new Error("UNIQUE constraint failed: command_receipts.id"))).toBe(true);
    expect(isCommandReceiptConflict(new Error("UNIQUE constraint failed: sales_listings.horse_id"))).toBe(false);
    expect(isCommandReceiptConflict(null)).toBe(false);
  });
});

describe("P03 receipt replay and conflict resolution", () => {
  it("a matching receipt replays the stored response", () => {
    const outcome = resolveReceipt(receiptScope(), storedReceipt());
    expect(outcome).toEqual({ replayed: true, statusCode: 200, body: { id: "listing-1", status: "sold", row_version: 2 } });
  });

  it("the same key under a different payload is a conflict", () => {
    expect(() => resolveReceipt(receiptScope({ digest: "digest-b" }), storedReceipt())).toThrowError(HttpError);
  });

  it("the same key for another actor, command or target is a conflict", () => {
    expect(() => resolveReceipt(receiptScope({ actorId: "someone-else" }), storedReceipt())).toThrowError(HttpError);
    expect(() => resolveReceipt(receiptScope({ command: "listing.renew" }), storedReceipt())).toThrowError(HttpError);
    expect(() => resolveReceipt(receiptScope({ targetId: "listing-2" }), storedReceipt())).toThrowError(HttpError);
  });

  it("a corrupt stored response fails closed", () => {
    expect(() => resolveReceipt(receiptScope(), storedReceipt({ response_json: "{not json" }))).toThrowError(/could not be decoded/);
  });

  it("the receipt INSERT is gated on the operation marker (P02 discipline)", () => {
    const db = makeDb({}) as unknown as D1Database;
    const statement = receiptInsertStatement(db, receiptScope(), 200, { ok: true }, { table: "sales_listings", id: "listing-1", operationId: "op-9" }).statement as unknown as { sql: string; args: unknown[] };
    expect(statement.sql).toContain("INSERT INTO command_receipts");
    expect(statement.sql).toContain("WHERE EXISTS(SELECT 1 FROM sales_listings WHERE id=? AND last_operation_id=?)");
    expect(statement.sql).toContain("CURRENT_TIMESTAMP");
    expect(statement.args).toEqual(["key-12345678", "seller-1", "listing.status", "listing-1", "digest-a", 200, JSON.stringify({ ok: true }), "listing-1", "op-9"]);
  });
});

describe("P03 executeListingStatus", () => {
  it("success: one guarded statement, version increments, response carries row_version", async () => {
    const db = makeDb({ updateChanges: [1] });
    const outcome = await executeListingStatus(db, SELLER, statusInput, null);
    expect(outcome).toEqual({ body: { id: "listing-1", status: "pending_sale", row_version: 2 }, statusCode: 200, replayed: false });
    expect(db.__writes).toHaveLength(1);
    const write = db.__writes[0];
    // The three guards live INSIDE the write.
    expect(write.sql).toContain("row_version=row_version+1");
    expect(write.sql).toContain("l.row_version=?");
    expect(write.sql).toContain("l.status=?");
    expect(write.sql).toContain("command_actor.is_active=1");
    expect(write.sql).toContain("command_actor.role IN");
    expect(write.sql).toContain("FROM horse_access_grants g");
    expect(write.args).toContain(1); // expectedVersion bind
  });

  it("stale version: 409 listing_version_conflict with the CURRENT version", async () => {
    const db = makeDb({ updateChanges: [0], listingVersion: 5 });
    await expect(executeListingStatus(db, SELLER, { ...statusInput, expectedVersion: 2 }, null)).rejects.toMatchObject({
      status: 409, code: "listing_version_conflict", details: { current_version: 5 },
    });
  });

  it("authority race (grant revoked between guard and write): 403, not a success", async () => {
    const db = makeDb({ updateChanges: [0], listingVersion: 1 });
    await expect(executeListingStatus(db, SELLER, statusInput, null)).rejects.toMatchObject({
      status: 403, code: "horse_access_required",
    });
  });

  it("replay: an existing matching receipt returns the stored response and writes NOTHING", async () => {
    const db = makeDb({ receipts: [storedReceipt()] });
    const outcome = await executeListingStatus(db, SELLER, statusInput, receiptScope());
    expect(outcome.replayed).toBe(true);
    expect(outcome.body).toEqual({ id: "listing-1", status: "sold", row_version: 2 });
    expect(db.__writes).toHaveLength(0);
  });

  it("a concurrent claim of the same key replays the winner's response", async () => {
    const db = makeDb({ batchError: new Error("UNIQUE constraint failed: command_receipts.id"), receipts: [storedReceipt()] });
    const outcome = await executeListingStatus(db, SELLER, statusInput, receiptScope());
    expect(outcome.replayed).toBe(true);
    expect(outcome.body).toEqual({ id: "listing-1", status: "sold", row_version: 2 });
  });

  it("a concurrent claim under a different payload stays a conflict", async () => {
    const db = makeDb({ batchError: new Error("UNIQUE constraint failed: command_receipts.id"), receipts: [storedReceipt({ request_digest: "digest-b" })] });
    await expect(executeListingStatus(db, SELLER, statusInput, receiptScope())).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
  });

  it("with a receipt, the batch carries the marker-gated receipt INSERT", async () => {
    const db = makeDb({ updateChanges: [1] });
    await executeListingStatus(db, SELLER, statusInput, receiptScope());
    expect(db.__writes).toHaveLength(2);
    expect(db.__writes[1].sql).toContain("INSERT INTO command_receipts");
    expect(db.__writes[1].sql).toContain("last_operation_id=?");
  });
});

describe("P03 executeListingRenew", () => {
  const renewInput = { listingId: "listing-1", expectedVersion: 2, currentStatus: "expired", extendDays: 30, isStaff: false, now: NOW };

  it("an expired listing reactivates to active with an extended expiry", async () => {
    const db = makeDb({ updateChanges: [1] });
    const outcome = await executeListingRenew(db, SELLER, renewInput, null);
    expect(outcome.body.status).toBe("active");
    expect(outcome.body.row_version).toBe(3);
    expect(outcome.body.expires_at).toBe("2026-11-02 12:00:00");
    expect(db.__writes[0].sql).toContain("status=CASE WHEN l.status='expired' THEN 'active' ELSE l.status END");
    expect(db.__writes[0].sql).toContain("l.status IN ('active','expired')");
  });

  it("an active listing stays active and only extends", async () => {
    const db = makeDb({ updateChanges: [1] });
    const outcome = await executeListingRenew(db, SELLER, { ...renewInput, currentStatus: "active" }, null);
    expect(outcome.body.status).toBe("active");
  });

  it("a stale renewal is a 409 with the current version", async () => {
    const db = makeDb({ updateChanges: [0], listingVersion: 9 });
    await expect(executeListingRenew(db, SELLER, { ...renewInput, expectedVersion: 2 }, null)).rejects.toMatchObject({
      status: 409, code: "listing_version_conflict", details: { current_version: 9 },
    });
  });
});

describe("P03 executeInquiryStatus", () => {
  const inquiryInput = { inquiryId: "inquiry-1", expectedVersion: 1, currentStatus: "new", nextStatus: "contacted", isStaff: false, now: NOW };

  it("success: the write carries version + seller + live manage_inquiries grant", async () => {
    const db = makeDb({ updateChanges: [1] });
    const outcome = await executeInquiryStatus(db, SELLER, inquiryInput, null);
    expect(outcome.body).toEqual({ inquiry: { id: "inquiry-1", status: "contacted", row_version: 2 } });
    const sql = db.__writes[0].sql;
    expect(sql).toContain("i.row_version=?");
    expect(sql).toContain("SELECT 1 FROM sales_listings l WHERE l.id=i.listing_id");
    expect(sql).toContain("l.seller_user_id = ?");
    // manage_inquiries is the action in the grant predicate, and its mandate relationships.
    expect(db.__writes[0].args).toContain("manage_inquiries");
    // The response shape carries no buyer contact fields (privacy pin).
    expect(JSON.stringify(outcome.body)).not.toContain("buyer_contact");
    expect(JSON.stringify(outcome.body)).not.toContain("buyer_name");
  });

  it("stale inquiry write: 409 inquiry_version_conflict with current version", async () => {
    const db = makeDb({ updateChanges: [0], inquiryVersion: 4 });
    await expect(executeInquiryStatus(db, SELLER, { ...inquiryInput, expectedVersion: 2 }, null)).rejects.toMatchObject({
      status: 409, code: "inquiry_version_conflict", details: { current_version: 4 },
    });
  });

  it("revoked manage_inquiries grant mid-flight: 403", async () => {
    const db = makeDb({ updateChanges: [0], inquiryVersion: 1 });
    await expect(executeInquiryStatus(db, SELLER, inquiryInput, null)).rejects.toMatchObject({ status: 403, code: "horse_access_required" });
  });
});

describe("P03 executeListingCreate / executeInquiryCreate", () => {
  const createInput = {
    listingId: "listing-new", horseId: 7,
    values: {
      seller_contact_name: "Demo Stud", seller_contact_phone: null, seller_contact_email: null, seller_city: "Tehran",
      asking_price_toman: 1000, price_visible: 1, negotiable: 0, title: null, description: null,
    },
    isEditorial: false, now: NOW,
  };

  it("create success: authority is INSIDE the INSERT..SELECT and the response is deterministic", async () => {
    const db = makeDb({ updateChanges: [1] });
    const outcome = await executeListingCreate(db, SELLER, createInput, null, { name_latin: "Shahriar" });
    expect(outcome.statusCode).toBe(201);
    expect(outcome.body.listing).toMatchObject({ id: "listing-new", horse_id: 7, status: "active", row_version: 1, name_latin: "Shahriar", listed_at: sqliteNowText(NOW) });
    const sql = db.__writes[0].sql;
    expect(sql).toContain("FROM horses h");
    expect(sql).toContain("h.deleted_at IS NULL");
    expect(sql).toContain("FROM horse_access_grants g");
    // The create gate embeds the staff branch too.
    expect(db.__writes[0].args).toContain(0);
    expect(db.__writes[0].args).toContain("create_listing");
  });

  it("create authority race: zero rows + horse still present = 403 horse_access_required", async () => {
    const db = makeDb({ updateChanges: [0], horseExists: true });
    await expect(executeListingCreate(db, SELLER, createInput, null, {})).rejects.toMatchObject({ status: 403, code: "horse_access_required" });
  });

  it("create when the horse vanished: 404", async () => {
    const db = makeDb({ updateChanges: [0], horseExists: false });
    await expect(executeListingCreate(db, SELLER, createInput, null, {})).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("inquiry create rechecks availability in the write; zero rows is a 409", async () => {
    const db = makeDb({ updateChanges: [1] });
    const ok = await executeInquiryCreate(db, { inquiryId: "inq-1", listingId: "listing-1", buyerUserId: null, buyerName: "Buyer", buyerContact: "+98...", message: null }, null);
    expect(ok.body).toEqual({ inquiry: { id: "inq-1", listing_id: "listing-1", status: "new", row_version: 1 } });
    expect(db.__writes[0].sql).toContain("l.status IN ('active','pending_sale')");
    expect(db.__writes[0].sql).toContain("datetime(l.expires_at)>datetime('now')");

    const gone = makeDb({ updateChanges: [0] });
    await expect(executeInquiryCreate(gone, { inquiryId: "inq-2", listingId: "listing-1", buyerUserId: null, buyerName: "Buyer", buyerContact: "+98...", message: null }, null))
      .rejects.toMatchObject({ status: 409, code: "listing_unavailable" });
  });
});

describe("P03 grant predicate SQL mirror", () => {
  it("embeds the horse column, the org-membership path and the mandate narrowing", () => {
    const predicate = buildActiveGrantPredicate("l.horse_id", "create_listing", { userId: "u1" }, "2026-10-03T12:00:00.000Z");
    expect(predicate.sql).toContain("g.horse_id=l.horse_id");
    expect(predicate.sql).toContain("g.grantee_user_id IS NULL AND EXISTS");
    expect(predicate.sql).toContain("organization_memberships m");
    expect(predicate.sql).toContain("o.status='active'");
    // create_listing mandate: owner or seller only.
    expect(predicate.binds).toEqual(["2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z", "u1", "u1", "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z", "create_listing", "owner", "seller"]);
  });

  it("manage_inquiries carries its own mandate (owner, manager, seller)", () => {
    const predicate = buildActiveGrantPredicate("h.id", "manage_inquiries", { userId: "u1" }, "2026-10-03T12:00:00.000Z");
    expect(predicate.binds.slice(6)).toEqual(["manage_inquiries", "owner", "manager", "seller"]);
  });

  it("the sold transition is not an ownership transfer (template pin)", async () => {
    // The status statement writes sales_listings only: no horses/horse_people
    // writes, no grant minting. Behavioral proof runs in the python replay.
    const sql = LISTING_STATUS_SQL_TEMPLATE.replace("{{authorityArm}}", AUTHORITY_ARM_TEMPLATE.replace("{{sellerColumn}}", "l.seller_user_id").replace("{{grantPredicate}}", GRANT_PREDICATE_TEMPLATE));
    expect(sql.trim().startsWith("UPDATE sales_listings")).toBe(true);
    expect((sql.match(/UPDATE /g) ?? []).length).toBe(1);
    expect((sql.match(/INSERT INTO/g) ?? []).length).toBe(0);
    expect(sql).not.toContain("INSERT OR REPLACE");
    expect(sql).not.toContain("UPDATE horses");
    expect(sql).not.toContain("horse_people");
  });
});

// ---------------------------------------------------------------------------
// Source-level wiring locks (privacyMatrix pattern)
// ---------------------------------------------------------------------------

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("P03 source-level wiring locks", () => {
  it("reads expose row_version (public listing columns, mine inquiries)", () => {
    const marketplace = read("src/api/modules/marketplace.ts");
    expect(marketplace).toContain("l.provenance,l.row_version");
    expect(marketplace).toContain("i.status,i.created_at,i.row_version");
    expect(marketplace).toContain("PUBLIC_LISTING_COLUMNS");
  });

  it("every edit schema requires expected_version", () => {
    const marketplace = read("src/api/modules/marketplace.ts");
    // R98-N12 adds the buyer-close and dossier-attach edit schemas (5 total).
    expect(marketplace.match(/expected_version: z\.number\(\)\.int\(\)\.min\(1\)/g)?.length).toBe(5);
  });

  it("contract exposes row_version and the renew command; adapters send version + key", () => {
    const contracts = read("src/contracts/platform.ts");
    expect(contracts).toMatch(/PLATFORM_CONTRACT_VERSION = "2\.\d{2}\.0"/);
    const packageVersion = (JSON.parse(read("package.json")) as { version: string }).version;
    expect(contracts).toContain(`PLATFORM_APPLICATION_VERSION = "${packageVersion}"`);
    expect(contracts).toContain("row_version: number;");
    expect(contracts).toContain("renew(id: string");
    expect(contracts).toContain("idempotencyKey?: string;");
    const client = read("src/frontend-kit/platformClient.ts");
    expect(client).toContain('"idempotency-key": request.idempotencyKey');
    expect(client).toContain("expected_version: expectedVersion");
    expect(client).toContain("/renew");
    const mock = read("src/frontend-kit/mockPlatformClient.ts");
    expect(mock).toContain("renew: async () =>");
    expect(mock).toContain("row_version: 1");
  });

  it("the renew route is wired", () => {
    const routes = read("src/api/routes.ts");
    expect(routes).toContain("/renew$/");
    expect(routes).toContain("renewListing");
  });

  it("inquiry UIs send idempotency keys and disable controls on conflict until a fresh version loads", () => {
    const heritage = read("src/web/heritage/MarketplacePage.tsx");
    expect(heritage).toContain("idempotencyKey: idemKey.current");
    expect(heritage).toContain("disabled={stale");
    expect(heritage).toContain("setReloadToken");
    const equidata = read("src/web/frontends/equidata-elite/recordModules.tsx");
    expect(equidata).toContain("idempotencyKey: idemKey.current");
    expect(equidata).toContain("disabled={stale}");
    const fei = read("src/web/frontends/fei-classic/recordModules.tsx");
    expect(fei).toContain("idempotencyKey: idemKey.current");
    expect(fei).toContain("disabled={stale}");
  });

  it("sqliteNowText matches SQLite CURRENT_TIMESTAMP text form", () => {
    expect(sqliteNowText(new Date("2026-10-03T12:00:00.000Z"))).toBe("2026-10-03 12:00:00");
  });

  it("staleListingWriteError distinguishes version drift from an authority race", async () => {
    const drifted = makeDb({ listingVersion: 8 });
    const versionError = await staleListingWriteError(drifted as unknown as D1Database, "listing-1", 2);
    expect(versionError).toMatchObject({ status: 409, code: "listing_version_conflict", details: { current_version: 8 } });
    const sameVersion = makeDb({ listingVersion: 2 });
    const authorityError = await staleListingWriteError(sameVersion as unknown as D1Database, "listing-1", 2);
    expect(authorityError).toMatchObject({ status: 403, code: "horse_access_required" });
  });
});
