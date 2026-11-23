import { HttpError } from "../api/http";
import type { AuthContext } from "../auth/session";
import type { HorseGrantAction } from "../access/horseAccess";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * R88 agent plan P03 — versioned, idempotent marketplace commands.
 *
 * Every mutable marketplace command is a single transactional D1 batch with
 * three guarantees the previous per-field guards could not give together:
 *
 * 1. Optimistic concurrency: rows carry row_version >= 1, every mutable
 *    command increments it, edits must carry the version the client read
 *    (expected_version), and a stale write is a 409 reporting the CURRENT
 *    version so the losing editor can reload. Two concurrent writers can
 *    never both land silently.
 *
 * 2. Idempotency: a client-supplied key (Idempotency-Key header) is claimed
 *    by exactly one successful (actor, command, target) execution. The
 *    request digest + response are persisted in command_receipts IN THE SAME
 *    BATCH as the write, conditioned on THIS call's operation marker (P02
 *    discipline): a receipt can only exist for an execution that actually
 *    happened. Replaying the same key with the same payload replays the
 *    stored response without re-executing; the same key under a different
 *    payload is a 409 conflict.
 *
 * 3. Authority inside the transaction: horse existence, seller identity and
 *    the active-grant check are evaluated in the SAME statement as the write,
 *    so a grant revoked (or a horse deleted) between the pre-check read and
 *    the write makes the write affect zero rows instead of succeeding on
 *    stale authority. Administrator/editorial authorization stays an explicit
 *    separate branch (a bound staff flag), exactly as in the route guards.
 *
 * Doctrine notes pinned by tests:
 * - A listing sold is NOT an ownership transfer: the status statement writes
 *   to sales_listings only; horses/horse_people/horse_access_grants are
 *   untouched (python replay test_p03_marketplace_commands.py).
 * - Inquiry contact fields stay private after grant revocation: the inquiry
 *   status statement requires a live manage_inquiries grant in-transaction,
 *   and its response shape carries no contact fields.
 */

export const MARKET_COMMANDS = ["listing.create", "listing.status", "listing.renew", "inquiry.create", "inquiry.status", "inquiry.reply", "inquiry.buyer_close", "watchlist.add", "watchlist.remove", "block.create", "block.remove", "listing.dossier"] as const;
export type MarketCommand = (typeof MARKET_COMMANDS)[number];

/** Relationships whose mandate can ever carry each action (mirror of RELATIONSHIP_ACTION_SETS). */
const ACTION_RELATIONSHIPS: Record<HorseGrantAction, readonly string[]> = {
  manage_profile: ["owner", "breeder", "manager"],
  upload_media: ["owner", "breeder", "manager"],
  create_listing: ["owner", "seller"],
  manage_inquiries: ["owner", "manager", "seller"],
};

/**
 * In-transaction active-grant predicate, SQL mirror of HORSE_GRANT_LOOKUP_SQL
 * semantics: a direct grant to this user, or a grant to one of this user's
 * ACTIVE organizations (grantee_user_id IS NULL), currently valid, whose
 * stored action list and relationship mandate both cover the action. The
 * relationship IN(...) plus the actions LIKE token make the SQL exactly as
 * narrow as grantActions() (stored list intersected with the mandate).
 *
 * Placeholder form ({{horseColumn}} / {{relationshipSlots}}) so the python
 * replay suite regex-extracts and reconstructs the EXACT production SQL.
 */
export const GRANT_PREDICATE_TEMPLATE = `EXISTS(
    SELECT 1 FROM horse_access_grants g
    WHERE g.horse_id={{horseColumn}}
      AND g.revoked_at IS NULL
      AND datetime(g.valid_from) <= datetime(?)
      AND (g.valid_until IS NULL OR datetime(g.valid_until) > datetime(?))
      AND (
        g.grantee_user_id={{viewerSlot}}
        OR (g.grantee_user_id IS NULL AND EXISTS(
          SELECT 1 FROM organization_memberships m
          JOIN organizations o ON o.id=m.organization_id AND o.status='active'
          WHERE m.organization_id=g.grantee_organization_id
            AND m.user_id={{viewerSlot}}
            AND m.status='active'
            AND m.revoked_at IS NULL
            AND datetime(m.valid_from) <= datetime(?)
            AND (m.valid_until IS NULL OR datetime(m.valid_until) > datetime(?))
        ))
      )
      AND (',' || g.actions || ',') LIKE ('%,' || ? || ',%')
      AND g.relationship IN ({{relationshipSlots}})
  )`;

/**
 * R96-N07: the viewer may be a bound value ({ userId }) OR a SQL column
 * expression ({ userIdColumn }) when the mandate must be evaluated for a
 * row-derived principal inside a single statement (e.g. the dossier CREATOR
 * during a public view claim — no JS-level sequential read is trustworthy
 * there). The predicate stays ONE definition either way.
 */
export function buildActiveGrantPredicate(
  horseColumn: string,
  action: HorseGrantAction,
  viewer: { userId: string } | { userIdColumn: string },
  nowIso: string,
): { sql: string; binds: unknown[] } {
  const relationships = ACTION_RELATIONSHIPS[action];
  const columnViewer = "userIdColumn" in viewer ? viewer : null;
  const sql = GRANT_PREDICATE_TEMPLATE
    .replace("{{horseColumn}}", horseColumn)
    .replace(/\{\{viewerSlot\}\}/g, columnViewer ? columnViewer.userIdColumn : "?")
    .replace("{{relationshipSlots}}", relationships.map(() => "?").join(","));
  const binds = columnViewer
    ? [nowIso, nowIso, nowIso, nowIso, action, ...relationships]
    : [nowIso, nowIso, (viewer as { userId: string }).userId, (viewer as { userId: string }).userId, nowIso, nowIso, action, ...relationships];
  return { sql, binds };
}

// ---------------------------------------------------------------------------
// Idempotency receipts
// ---------------------------------------------------------------------------

export interface CommandReceiptRow {
  id: string;
  actor_user_id: string;
  command: string;
  target_id: string;
  request_digest: string;
  status_code: number;
  response_json: string;
  created_at: string;
}

/** Accepted idempotency key shape: 8-128 chars of URL/header-safe tokens. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function readIdempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key");
  if (key === null) return null;
  const trimmed = key.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw new HttpError(400, "invalid_idempotency_key", "The Idempotency-Key header must be 8-128 letters, digits, dots, underscores or hyphens");
  }
  return trimmed;
}

/** Stable canonical JSON: recursively sorted object keys, so payload key order never changes the digest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export async function commandRequestDigest(command: MarketCommand, payload: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson({ command, payload })));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isCommandReceiptConflict(cause: unknown): boolean {
  const error = cause as { message?: string; constraint?: string; cause?: { message?: string; constraint?: string } } | null;
  const message = [error?.message, error?.constraint, error?.cause?.message, error?.cause?.constraint].filter(Boolean).join(" ");
  return /command_receipts/i.test(message) && /UNIQUE constraint failed|duplicate key|PRIMARY KEY/i.test(message);
}

async function lookupReceipt(db: D1Database, key: string): Promise<CommandReceiptRow | null> {
  return await db.prepare("SELECT id,actor_user_id,command,target_id,request_digest,status_code,response_json,created_at FROM command_receipts WHERE id=?").bind(key).first<CommandReceiptRow>();
}

export interface ReceiptScope {
  key: string;
  actorId: string;
  command: MarketCommand;
  targetId: string;
  digest: string;
}

/**
 * Replay-or-conflict resolution for an existing receipt: the same key replayed
 * with the SAME (actor, command, target, digest) returns the original stored
 * response; anything else under this key is a conflict.
 */
export function resolveReceipt(scope: ReceiptScope, receipt: CommandReceiptRow): { replayed: true; statusCode: number; body: unknown } {
  if (receipt.actor_user_id !== scope.actorId || receipt.command !== scope.command || receipt.target_id !== scope.targetId || receipt.request_digest !== scope.digest) {
    throw new HttpError(409, "idempotency_conflict", "This idempotency key was already used for a different request");
  }
  let body: unknown;
  try {
    body = JSON.parse(receipt.response_json);
  } catch {
    throw new HttpError(500, "idempotency_receipt_corrupt", "The stored idempotency response could not be decoded");
  }
  return { replayed: true, statusCode: receipt.status_code, body };
}

/** Look up an existing receipt for the scope; replay, conflict, or signal "not claimed yet". */
export async function checkReceipt(db: D1Database, scope: ReceiptScope): Promise<{ replayed: true; statusCode: number; body: unknown } | { replayed: false }> {
  const receipt = await lookupReceipt(db, scope.key);
  if (!receipt) return { replayed: false };
  return resolveReceipt(scope, receipt);
}

/** Receipt INSERT, placeholder form ({{gate}}): lands only if the gated write landed. */
export const RECEIPT_INSERT_SQL_TEMPLATE = `INSERT INTO command_receipts(id,actor_user_id,command,target_id,request_digest,status_code,response_json,created_at)
    SELECT ?,?,?,?,?,?,?,CURRENT_TIMESTAMP
    WHERE EXISTS({{gate}})`;

/** Marker gate (P02 discipline): THIS call's operation marker on the row it changed. */
export const RECEIPT_MARKER_GATE_TEMPLATE = "SELECT 1 FROM {{table}} WHERE id=? AND last_operation_id=?";
/** Row gate for creates: the fresh row can only exist if THIS batch created it. */
export const RECEIPT_ROW_GATE_TEMPLATE = "SELECT 1 FROM {{table}} WHERE id=?";

/** Receipt INSERT gated on THIS call's operation marker (P02 discipline): lands only if the write landed. */
export function receiptInsertStatement(db: D1Database, scope: ReceiptScope, statusCode: number, responseBody: unknown, markerGate: { table: string; id: string; operationId?: string }): { statement: ReturnType<D1Database["prepare"]> } {
  const gate = (markerGate.operationId ? RECEIPT_MARKER_GATE_TEMPLATE : RECEIPT_ROW_GATE_TEMPLATE).replace("{{table}}", markerGate.table);
  const sql = RECEIPT_INSERT_SQL_TEMPLATE.replace("{{gate}}", gate);
  const binds: unknown[] = [scope.key, scope.actorId, scope.command, scope.targetId, scope.digest, statusCode, JSON.stringify(responseBody)];
  binds.push(markerGate.id);
  if (markerGate.operationId) binds.push(markerGate.operationId);
  return { statement: db.prepare(sql).bind(...binds) };
}

// ---------------------------------------------------------------------------
// Statement builders (exported constants/regex-extractable for the python replay suite)
// ---------------------------------------------------------------------------

/**
 * Authority arm used inside every mutable statement: an explicit staff branch
 * (the current active database account, not a stale route-level role flag) OR
 * the seller identity AND a live grant covering the action on the listing's
 * horse. Placeholder form so the python replay suite can reconstruct the
 * EXACT production statements.
 */
export const AUTHORITY_ARM_TEMPLATE = "EXISTS(SELECT 1 FROM users command_actor WHERE command_actor.id=? AND command_actor.is_active=1 AND (command_actor.role IN ('editor','admin','super_admin') OR ({{sellerColumn}} = ? AND {{grantPredicate}})))";

/** Listing status: one guarded UPDATE. Binds: nextStatus, nowText, operationId, listingId, expectedVersion, currentStatus, actorId, userId, then grant binds (nowIso, userId, userId, nowIso, nowIso, action, rels...). */
export const LISTING_STATUS_SQL_TEMPLATE = `UPDATE sales_listings AS l
    SET status=?, updated_at=?, row_version=row_version+1, last_operation_id=?
    WHERE l.id=? AND l.row_version=? AND l.status=? AND {{authorityArm}}`;

/** Listing renewal: bounded expiry extension; expired reactivates to active. Binds: expiresAtText, nowText, operationId, listingId, expectedVersion, actorId, userId, then grant binds. */
export const LISTING_RENEW_SQL_TEMPLATE = `UPDATE sales_listings AS l
    SET expires_at=?, updated_at=?, status=CASE WHEN l.status='expired' THEN 'active' ELSE l.status END,
        row_version=row_version+1, last_operation_id=?
    WHERE l.id=? AND l.row_version=? AND l.status IN ('active','expired') AND {{authorityArm}}`;

/** Inquiry status: version + seller identity + live manage_inquiries grant, all inside the UPDATE. Binds: nextStatus, operationId, inquiryId, expectedVersion, currentStatus, actorId, userId, then grant binds. */
export const INQUIRY_STATUS_SQL_TEMPLATE = `UPDATE sales_inquiries AS i
    SET status=?, row_version=row_version+1, last_operation_id=?
    WHERE i.id=? AND i.row_version=? AND i.status=?
      AND EXISTS(
        SELECT 1 FROM sales_listings l WHERE l.id=i.listing_id
          AND {{authorityArm}}
      )`;

/** Listing create: horse existence + staff/editorial branch + authority inside the INSERT..SELECT. Binds: listingId, horseId, sellerUserId, contact fields..., priceVisible, negotiable, title, description, nowText, nowText, horseId, actorId, then grant binds. */
export const LISTING_CREATE_SQL_TEMPLATE = `INSERT INTO sales_listings(id,horse_id,seller_user_id,seller_contact_name,seller_contact_phone,seller_contact_email,seller_city,
      asking_price_toman,price_visible,negotiable,status,title,description,provenance,listed_at,updated_at,row_version)
    SELECT ?,?,?,?,?,?,?,?,?,?,'active',?,?,'user',?,?,1
    FROM horses h
    WHERE h.id=? AND h.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM users command_actor WHERE command_actor.id=? AND command_actor.is_active=1
        AND (command_actor.role IN ('editor','admin','super_admin') OR {{grantPredicate}}))`;

/** Inquiry create: availability AND participant blocks rechecked in the write
 * (either direction blocks NEW contact; anonymous inquiries have no account to
 * block). Binds: inquiryId, buyerUserId, buyerName, buyerContact, message,
 * listingId, buyerUserId, buyerUserId. */
export const INQUIRY_CREATE_SQL_TEMPLATE = `INSERT INTO sales_inquiries(id,listing_id,buyer_user_id,buyer_name,buyer_contact,message,row_version)
    SELECT ?,l.id,?,?,?,?,1
    FROM sales_listings l JOIN horses h ON h.id=l.horse_id AND h.deleted_at IS NULL
    WHERE l.id=? AND l.status IN ('active','pending_sale')
      AND (l.expires_at IS NULL OR datetime(l.expires_at)>datetime('now'))
      AND NOT EXISTS(
        SELECT 1 FROM marketplace_participant_blocks b
        WHERE (b.blocker_user_id=l.seller_user_id AND b.blocked_user_id=?)
           OR (b.blocker_user_id=? AND b.blocked_user_id=l.seller_user_id))`;

function sellerAuthorityArm(sellerColumn: string, grantSql: string): string {
  return AUTHORITY_ARM_TEMPLATE.replace("{{sellerColumn}}", sellerColumn).replace("{{grantPredicate}}", grantSql);
}

/** SQLite text timestamps look like 2026-10-03 12:00:00 (CURRENT_TIMESTAMP form). */
export function sqliteNowText(now: Date): string {
  return now.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Listing status (single transactional UPDATE; version + authority + marker)
// ---------------------------------------------------------------------------

export interface ListingStatusCommandInput {
  listingId: string;
  expectedVersion: number;
  currentStatus: string;
  nextStatus: string;
  /** Legacy caller hint; current database role is authoritative. */
  isStaff: boolean;
  sellerUserId: string;
  horseId: number;
  now: Date;
}

export async function executeListingStatus(db: D1Database, auth: { user: { id: string } }, input: ListingStatusCommandInput, receipt: ReceiptScope | null): Promise<{ body: { id: string; status: string; row_version: number }; statusCode: 200; replayed: boolean }> {
  const nowIso = input.now.toISOString();
  const operationId = crypto.randomUUID();
  const grant = buildActiveGrantPredicate("l.horse_id", "create_listing", { userId: auth.user.id }, nowIso);
  const sql = LISTING_STATUS_SQL_TEMPLATE.replace("{{authorityArm}}", sellerAuthorityArm("l.seller_user_id", grant.sql));
  const binds: unknown[] = [input.nextStatus, sqliteNowText(input.now), operationId, input.listingId, input.expectedVersion, input.currentStatus, auth.user.id, auth.user.id, ...grant.binds];
  const responseBody = { id: input.listingId, status: input.nextStatus, row_version: input.expectedVersion + 1 };

  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
  }
  const statements = [db.prepare(sql).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 200, responseBody, { table: "sales_listings", id: input.listingId, operationId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    throw await staleListingWriteError(db, input.listingId, input.expectedVersion);
  }
  return { body: responseBody, statusCode: 200, replayed: false };
}

/**
 * A zero-row guarded write is either a version conflict (another writer won)
 * or an authority race (the grant was revoked between the pre-check and the
 * write). Re-read the row and return the precise error.
 */
export async function staleListingWriteError(db: D1Database, listingId: string, expectedVersion: number): Promise<HttpError> {
  const row = await db.prepare("SELECT row_version FROM sales_listings WHERE id=?").bind(listingId).first<{ row_version: number }>();
  if (row && Number(row.row_version) !== expectedVersion) {
    return new HttpError(409, "listing_version_conflict", "This listing changed while you were editing; reload the current version and try again", { current_version: Number(row.row_version) });
  }
  return new HttpError(403, "horse_access_required", "Your permission to manage this listing was removed before the change could be applied");
}

// ---------------------------------------------------------------------------
// Listing renewal (expiry extension; expired -> active reactivation)
// ---------------------------------------------------------------------------

export interface ListingRenewCommandInput {
  listingId: string;
  expectedVersion: number;
  currentStatus: string;
  extendDays: number;
  /** Legacy caller hint; current database role is authoritative. */
  isStaff: boolean;
  now: Date;
}

export async function executeListingRenew(db: D1Database, auth: { user: { id: string } }, input: ListingRenewCommandInput, receipt: ReceiptScope | null): Promise<{ body: { id: string; status: string; expires_at: string; row_version: number }; statusCode: 200; replayed: boolean }> {
  const nowIso = input.now.toISOString();
  const operationId = crypto.randomUUID();
  const expiresAt = new Date(input.now.getTime() + input.extendDays * 86_400_000);
  const expiresAtText = sqliteNowText(expiresAt);
  const nextStatus = input.currentStatus === "expired" ? "active" : input.currentStatus;
  const grant = buildActiveGrantPredicate("l.horse_id", "create_listing", { userId: auth.user.id }, nowIso);
  const sql = LISTING_RENEW_SQL_TEMPLATE.replace("{{authorityArm}}", sellerAuthorityArm("l.seller_user_id", grant.sql));
  const binds: unknown[] = [expiresAtText, sqliteNowText(input.now), operationId, input.listingId, input.expectedVersion, auth.user.id, auth.user.id, ...grant.binds];
  const responseBody = { id: input.listingId, status: nextStatus, expires_at: expiresAtText, row_version: input.expectedVersion + 1 };

  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
  }
  const statements = [db.prepare(sql).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 200, responseBody, { table: "sales_listings", id: input.listingId, operationId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    // A renewal can zero-row on status drift too (e.g. sold between read and
    // write) — the version re-read distinguishes that from an authority race.
    throw await staleListingWriteError(db, input.listingId, input.expectedVersion);
  }
  return { body: responseBody, statusCode: 200, replayed: false };
}

// ---------------------------------------------------------------------------
// Inquiry status (seller + live manage_inquiries grant, in-transaction)
// ---------------------------------------------------------------------------

export interface InquiryStatusCommandInput {
  inquiryId: string;
  expectedVersion: number;
  currentStatus: string;
  nextStatus: string;
  /** Legacy caller hint; current database role is authoritative. */
  isStaff: boolean;
  now: Date;
}

export async function executeInquiryStatus(db: D1Database, auth: { user: { id: string } }, input: InquiryStatusCommandInput, receipt: ReceiptScope | null): Promise<{ body: { inquiry: { id: string; status: string; row_version: number } }; statusCode: 200; replayed: boolean }> {
  const nowIso = input.now.toISOString();
  const operationId = crypto.randomUUID();
  const grant = buildActiveGrantPredicate("l.horse_id", "manage_inquiries", { userId: auth.user.id }, nowIso);
  const sql = INQUIRY_STATUS_SQL_TEMPLATE.replace("{{authorityArm}}", sellerAuthorityArm("l.seller_user_id", grant.sql));
  const binds: unknown[] = [input.nextStatus, operationId, input.inquiryId, input.expectedVersion, input.currentStatus, auth.user.id, auth.user.id, ...grant.binds];
  const responseBody = { inquiry: { id: input.inquiryId, status: input.nextStatus, row_version: input.expectedVersion + 1 } };

  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
  }
  const statements = [db.prepare(sql).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 200, responseBody, { table: "sales_inquiries", id: input.inquiryId, operationId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    const row = await db.prepare("SELECT row_version FROM sales_inquiries WHERE id=?").bind(input.inquiryId).first<{ row_version: number }>();
    if (row && Number(row.row_version) !== input.expectedVersion) {
      throw new HttpError(409, "inquiry_version_conflict", "This inquiry changed while you were editing; reload the current version and try again", { current_version: Number(row.row_version) });
    }
    throw new HttpError(403, "horse_access_required", "Your permission to manage this inquiry was removed before the change could be applied");
  }
  return { body: responseBody, statusCode: 200, replayed: false };
}

// ---------------------------------------------------------------------------
// Listing create (horse existence + authority inside the INSERT..SELECT)
// ---------------------------------------------------------------------------

export interface ListingCreateCommandInput {
  listingId: string;
  horseId: number;
  values: {
    seller_contact_name: string;
    seller_contact_phone: string | null;
    seller_contact_email: string | null;
    seller_city: string | null;
    asking_price_toman: number | null;
    price_visible: number;
    negotiable: number;
    title: string | null;
    description: string | null;
  };
  isEditorial: boolean;
  now: Date;
}

/**
 * Authority predicate for creates: the staff flag mirrors requireHorseAction's
 * editorial path (editor/admin/super_admin); everyone else needs the live
 * create_listing grant on THIS horse, evaluated in the same statement as the
 * INSERT — a revocation landing between the guard and the write turns the
 * INSERT into a zero-row no-op instead of a stale-authority success.
 */
export async function executeListingCreate(db: D1Database, auth: { user: { id: string } }, input: ListingCreateCommandInput, receipt: ReceiptScope | null, horseProjection: Record<string, unknown>): Promise<{ body: { listing: Record<string, unknown> }; statusCode: 201; replayed: boolean }> {
  const nowIso = input.now.toISOString();
  const nowText = sqliteNowText(input.now);
  const grant = buildActiveGrantPredicate("h.id", "create_listing", { userId: auth.user.id }, nowIso);
  const sql = LISTING_CREATE_SQL_TEMPLATE.replace("{{grantPredicate}}", grant.sql);
  const v = input.values;
  const binds: unknown[] = [input.listingId, input.horseId, auth.user.id, v.seller_contact_name, v.seller_contact_phone, v.seller_contact_email, v.seller_city,
    v.asking_price_toman, v.price_visible, v.negotiable, v.title, v.description, nowText, nowText, input.horseId, auth.user.id, ...grant.binds];
  const listingBody: Record<string, unknown> = {
    id: input.listingId,
    horse_id: input.horseId,
    seller_user_id: auth.user.id,
    ...v,
    status: "active",
    view_count: 0,
    listed_at: nowText,
    updated_at: nowText,
    expires_at: null,
    provenance: "user",
    row_version: 1,
    ...horseProjection,
  };
  const responseBody = { listing: listingBody };

  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 201, replayed: true };
  }
  const statements = [db.prepare(sql).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 201, responseBody, { table: "sales_listings", id: input.listingId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 201, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    const horse = await db.prepare("SELECT id FROM horses WHERE id=? AND deleted_at IS NULL").bind(input.horseId).first();
    if (!horse) throw new HttpError(404, "not_found", "Horse not found");
    throw new HttpError(403, "horse_access_required", "Your permission to list this horse was removed before the listing could be created");
  }
  return { body: responseBody, statusCode: 201, replayed: false };
}

// ---------------------------------------------------------------------------
// Inquiry create (availability rechecked in the write; receipt optional)
// ---------------------------------------------------------------------------

export interface InquiryCreateCommandInput {
  inquiryId: string;
  listingId: string;
  buyerUserId: string | null;
  buyerName: string;
  buyerContact: string;
  message: string | null;
}

export async function executeInquiryCreate(db: D1Database, input: InquiryCreateCommandInput, receipt: ReceiptScope | null): Promise<{ body: { inquiry: { id: string; listing_id: string; status: string; row_version: number } }; statusCode: 201; replayed: boolean }> {
  const sql = INQUIRY_CREATE_SQL_TEMPLATE;
  const binds: unknown[] = [input.inquiryId, input.buyerUserId, input.buyerName, input.buyerContact, input.message, input.listingId, input.buyerUserId, input.buyerUserId];
  const responseBody = { inquiry: { id: input.inquiryId, listing_id: input.listingId, status: "new", row_version: 1 } };

  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 201, replayed: true };
  }
  const statements = [db.prepare(sql).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 201, responseBody, { table: "sales_inquiries", id: input.inquiryId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 201, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    throw new HttpError(409, "listing_unavailable", "Listing is no longer available");
  }
  return { body: responseBody, statusCode: 201, replayed: false };
}

/** Actor id for receipt scoping: the signed-in user, or the literal anonymous scope. */
export function receiptActorId(auth: AuthContext | null | undefined): string {
  return auth?.user?.id ?? "anonymous";
}

// ---------------------------------------------------------------------------
// R98-N12 — inquiry reply thread (participants only; open inquiry required
// for NEW replies; reads stay permission-protected for the conversation's
// whole life, including after the listing expires/withdraws/is sold)
// ---------------------------------------------------------------------------

/** Reply create: author must be the recorded buyer or the listing seller, and
 * the inquiry must still be open. Binds: replyId, inquiryId, authorUserId,
 * authorSide, body, operationId, inquiryId, authorUserId, authorUserId. */
export const REPLY_CREATE_SQL_TEMPLATE = `INSERT INTO sales_inquiry_replies(id,inquiry_id,author_user_id,author_side,body,last_operation_id)
    SELECT ?,?,?,?,?,?
    FROM sales_inquiries i
    JOIN sales_listings l ON l.id=i.listing_id
    WHERE i.id=? AND i.status IN ('new','contacted')
      AND (? = i.buyer_user_id OR ? = l.seller_user_id)`;

export interface ReplyCreateCommandInput {
  inquiryId: string;
  replyId: string;
  authorUserId: string;
  authorSide: "buyer" | "seller";
  body: string;
  now: Date;
}

export async function executeReplyCreate(db: D1Database, input: ReplyCreateCommandInput, receipt: ReceiptScope | null): Promise<{ body: { reply: { id: string; inquiry_id: string; author_side: string; created_at: string } }; statusCode: 201; replayed: boolean }> {
  const operationId = crypto.randomUUID();
  const createdAt = sqliteNowText(input.now);
  const binds: unknown[] = [input.replyId, input.inquiryId, input.authorUserId, input.authorSide, input.body, operationId, input.inquiryId, input.authorUserId, input.authorUserId];
  const responseBody = { reply: { id: input.replyId, inquiry_id: input.inquiryId, author_side: input.authorSide, created_at: createdAt } };

  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 201, replayed: true };
  }
  const statements = [db.prepare(REPLY_CREATE_SQL_TEMPLATE).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 201, responseBody, { table: "sales_inquiry_replies", id: input.replyId, operationId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 201, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    const row = await db.prepare("SELECT i.status, i.buyer_user_id, l.seller_user_id FROM sales_inquiries i JOIN sales_listings l ON l.id=i.listing_id WHERE i.id=?").bind(input.inquiryId)
      .first<{ status: string; buyer_user_id: string | null; seller_user_id: string | null }>();
    if (!row) throw new HttpError(404, "not_found", "Inquiry not found");
    if (row.status === "closed") throw new HttpError(409, "inquiry_closed", "This conversation is closed; the history stays available but new replies are not accepted");
    if (row.buyer_user_id !== input.authorUserId && row.seller_user_id !== input.authorUserId) {
      throw new HttpError(403, "inquiry_participant_required", "Only the participants of this conversation can reply");
    }
    throw new HttpError(409, "inquiry_state_changed", "This inquiry changed while you were replying; reload and try again");
  }
  return { body: responseBody, statusCode: 201, replayed: false };
}

/** Buyer-side closure: the BUYER of record can close their own inquiry (the
 * seller closes through inquiry.status with a live manage_inquiries grant).
 * Binds: operationId, inquiryId, expectedVersion, buyerUserId. */
export const BUYER_CLOSE_SQL_TEMPLATE = `UPDATE sales_inquiries AS i
    SET status='closed', row_version=row_version+1, last_operation_id=?
    WHERE i.id=? AND i.row_version=? AND i.status IN ('new','contacted') AND i.buyer_user_id=?`;

export async function executeBuyerClose(db: D1Database, input: { inquiryId: string; expectedVersion: number; buyerUserId: string }, receipt: ReceiptScope | null): Promise<{ body: { inquiry: { id: string; status: string; row_version: number } }; statusCode: 200; replayed: boolean }> {
  const operationId = crypto.randomUUID();
  const binds: unknown[] = [operationId, input.inquiryId, input.expectedVersion, input.buyerUserId];
  const responseBody = { inquiry: { id: input.inquiryId, status: "closed", row_version: input.expectedVersion + 1 } };
  if (receipt) {
    const prior = await checkReceipt(db, receipt);
    if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
  }
  const statements = [db.prepare(BUYER_CLOSE_SQL_TEMPLATE).bind(...binds)];
  if (receipt) statements.push(receiptInsertStatement(db, receipt, 200, responseBody, { table: "sales_inquiries", id: input.inquiryId, operationId }).statement);
  let result: { meta: { changes?: number } };
  try {
    [result] = await db.batch(statements) as Array<{ meta: { changes?: number } }>;
  } catch (cause) {
    if (receipt && isCommandReceiptConflict(cause)) {
      const prior = await checkReceipt(db, receipt);
      if (prior.replayed) return { body: prior.body as typeof responseBody, statusCode: prior.statusCode as 200, replayed: true };
    }
    throw cause;
  }
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    const row = await db.prepare("SELECT row_version, status, buyer_user_id FROM sales_inquiries WHERE id=?").bind(input.inquiryId).first<{ row_version: number; status: string; buyer_user_id: string | null }>();
    if (!row) throw new HttpError(404, "not_found", "Inquiry not found");
    if (row.buyer_user_id !== input.buyerUserId) throw new HttpError(403, "inquiry_participant_required", "Only the buyer of this inquiry can close it");
    if (Number(row.row_version) !== input.expectedVersion) throw new HttpError(409, "inquiry_version_conflict", "This inquiry changed while you were editing; reload the current version and try again", { current_version: Number(row.row_version) });
    throw new HttpError(409, "inquiry_state_changed", "This inquiry can no longer be closed from its current state");
  }
  return { body: responseBody, statusCode: 200, replayed: false };
}

// ---------------------------------------------------------------------------
// R98-N12 — buyer watchlist (bounded, idempotent, owner-readable research list)
// ---------------------------------------------------------------------------

export const MAX_WATCHLIST_PER_USER = 25;

/** Binds: userId, listingId, userId, bound. */
export const WATCHLIST_ADD_SQL_TEMPLATE = `INSERT INTO buyer_watchlist(user_id,listing_id)
    SELECT ?,l.id FROM sales_listings l
    WHERE l.id=? AND (SELECT COUNT(*) FROM buyer_watchlist WHERE user_id=?) < ?
    ON CONFLICT(user_id,listing_id) DO NOTHING`;

export async function executeWatchlistAdd(db: D1Database, input: { userId: string; listingId: string }): Promise<{ added: boolean; bounded: boolean }> {
  const result = await db.prepare(WATCHLIST_ADD_SQL_TEMPLATE).bind(input.userId, input.listingId, input.userId, MAX_WATCHLIST_PER_USER).run();
  const changes = Number(result?.meta?.changes ?? 0);
  if (changes === 1) return { added: true, bounded: false };
  const existing = await db.prepare("SELECT 1 FROM buyer_watchlist WHERE user_id=? AND listing_id=?").bind(input.userId, input.listingId).first();
  if (existing) return { added: false, bounded: false };
  const listing = await db.prepare("SELECT 1 FROM sales_listings WHERE id=?").bind(input.listingId).first();
  if (!listing) throw new HttpError(404, "not_found", "Listing not found");
  throw new HttpError(409, "watchlist_full", `Your watchlist is full (${MAX_WATCHLIST_PER_USER} listings); remove one before adding another`);
}

export async function executeWatchlistRemove(db: D1Database, input: { userId: string; listingId: string }): Promise<{ removed: boolean }> {
  const result = await db.prepare("DELETE FROM buyer_watchlist WHERE user_id=? AND listing_id=?").bind(input.userId, input.listingId).run();
  return { removed: Number(result?.meta?.changes ?? 0) === 1 };
}

// ---------------------------------------------------------------------------
// R98-N12 — participant blocks (either side; NEUTRAL refusal of NEW contact
// only; existing conversations and their history are never touched)
// ---------------------------------------------------------------------------

export const MAX_PARTICIPANT_BLOCKS_PER_USER = 200;

/** Binds: blockerId, blockedId, reason, nowText, blockedId, blockerId, blockerId, blockedId, blockerId, bound. */
export const BLOCK_CREATE_SQL_TEMPLATE = `INSERT INTO marketplace_participant_blocks(blocker_user_id,blocked_user_id,reason_private,created_at)
    SELECT ?,?,?,?
    FROM users blocked
    WHERE blocked.id=? AND blocked.is_active=1
      AND EXISTS(SELECT 1 FROM users blocker WHERE blocker.id=? AND blocker.is_active=1)
      AND ? <> ?
      AND (SELECT COUNT(*) FROM marketplace_participant_blocks WHERE blocker_user_id=?) < ?
    ON CONFLICT(blocker_user_id,blocked_user_id) DO NOTHING`;

export async function executeBlockCreate(db: D1Database, input: { blockerUserId: string; blockedUserId: string; reasonPrivate: string | null; now: Date }): Promise<{ blocked: boolean }> {
  const nowText = sqliteNowText(input.now);
  const result = await db.prepare(BLOCK_CREATE_SQL_TEMPLATE).bind(
    input.blockerUserId, input.blockedUserId, input.reasonPrivate, nowText,
    input.blockedUserId, input.blockerUserId, input.blockerUserId, input.blockedUserId,
    input.blockerUserId, MAX_PARTICIPANT_BLOCKS_PER_USER,
  ).run();
  const changes = Number(result?.meta?.changes ?? 0);
  if (changes === 1) return { blocked: true };
  const existing = await db.prepare("SELECT 1 FROM marketplace_participant_blocks WHERE blocker_user_id=? AND blocked_user_id=?").bind(input.blockerUserId, input.blockedUserId).first();
  if (existing) return { blocked: true };
  const blocked = await db.prepare("SELECT is_active FROM users WHERE id=?").bind(input.blockedUserId).first<{ is_active: number }>();
  if (!blocked || !blocked.is_active) throw new HttpError(404, "not_found", "Account not found");
  throw new HttpError(409, "block_limit_reached", `You have reached the block limit (${MAX_PARTICIPANT_BLOCKS_PER_USER})`);
}

export async function executeBlockRemove(db: D1Database, input: { blockerUserId: string; blockedUserId: string }): Promise<{ removed: boolean }> {
  const result = await db.prepare("DELETE FROM marketplace_participant_blocks WHERE blocker_user_id=? AND blocked_user_id=?").bind(input.blockerUserId, input.blockedUserId).run();
  return { removed: Number(result?.meta?.changes ?? 0) === 1 };
}

// ---------------------------------------------------------------------------
// R98-N12 — optional immutable dossier link (seller-owned dossier for the
// SAME horse, created by the seller, still active; CURRENT mandate required
// inside the write — an expired mandate can never attach or re-attach)
// ---------------------------------------------------------------------------

/** Binds: dossierId, nowText, operationId, listingId, expectedVersion, dossierId, sellerUserId, nowIso, nowIso, actorId, then grant binds. */
export const LISTING_DOSSIER_SQL_TEMPLATE = `UPDATE sales_listings AS l
    SET dossier_id=?, row_version=row_version+1, last_operation_id=?, updated_at=?
    WHERE l.id=? AND l.row_version=?
      AND EXISTS(
        SELECT 1 FROM dossier_snapshots ds
        WHERE ds.id=? AND ds.horse_id=l.horse_id AND ds.created_by_user_id=? AND ds.status='active')
      AND EXISTS(
        SELECT 1 FROM users command_actor WHERE command_actor.id=? AND command_actor.is_active=1
          AND ({{grantPredicate}}))`;

export async function executeListingDossier(db: D1Database, auth: { user: { id: string } }, input: { listingId: string; expectedVersion: number; dossierId: number | null; now: Date }): Promise<{ body: { id: string; dossier_id: number | null; row_version: number }; statusCode: 200 }> {
  const nowIso = input.now.toISOString();
  const nowText = sqliteNowText(input.now);
  const operationId = crypto.randomUUID();
  const grant = buildActiveGrantPredicate("l.horse_id", "create_listing", { userId: auth.user.id }, nowIso);
  const sql = LISTING_DOSSIER_SQL_TEMPLATE.replace("{{grantPredicate}}", grant.sql);
  const binds: unknown[] = [input.dossierId, operationId, nowText, input.listingId, input.expectedVersion, input.dossierId, auth.user.id, auth.user.id, ...grant.binds];
  const responseBody = { id: input.listingId, dossier_id: input.dossierId, row_version: input.expectedVersion + 1 };
  const [result] = await db.batch([db.prepare(sql).bind(...binds)]) as Array<{ meta: { changes?: number } }>;
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    const row = await db.prepare("SELECT row_version, horse_id FROM sales_listings WHERE id=?").bind(input.listingId).first<{ row_version: number; horse_id: number }>();
    if (!row) throw new HttpError(404, "not_found", "Listing not found");
    if (Number(row.row_version) !== input.expectedVersion) {
      throw new HttpError(409, "listing_version_conflict", "This listing changed while you were editing; reload the current version and try again", { current_version: Number(row.row_version) });
    }
    if (input.dossierId != null) {
      const dossier = await db.prepare("SELECT horse_id, created_by_user_id, status FROM dossier_snapshots WHERE id=?").bind(input.dossierId).first<{ horse_id: number; created_by_user_id: string; status: string }>();
      if (!dossier || dossier.horse_id !== row.horse_id) throw new HttpError(404, "dossier_mismatch", "The dossier does not belong to this horse");
      if (dossier.created_by_user_id !== auth.user.id || dossier.status !== "active") throw new HttpError(403, "dossier_not_allowed", "Only the dossier's creator can attach an active dossier to their listing");
    }
    throw new HttpError(403, "horse_access_required", "Your permission to manage this listing was removed before the change could be applied");
  }
  return { body: responseBody, statusCode: 200 };
}
