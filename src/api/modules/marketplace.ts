import { z } from "zod";
import { parseBoundedIntegerParam } from "../../registry/query";
import { HttpError, json, readJson } from "../http";
import { requireAuth, requireCsrf } from "../../auth/guards";
import { mediaVerificationToLevel } from "../../trust/policy";
import { publicMediaPredicate } from "./mediaPolicy";
import { getAuth } from "../../auth/session";
import { readHorseGenetics } from "../../privacy/geneticReads";
import type { PrivacyViewer } from "../../privacy/policy";
import { isExpiredTimestamp } from "../../security/timestamps";
import { parseUtcTimestamp } from "../../shared/utcTimestamp";
import { utcTimestampMillisSql } from "../../shared/utcTimestampSql";
import { requireSameOriginMutation } from "../../security/origin";
import { assertListingTransition, assertInquiryTransition, isActiveListingConflict, INQUIRY_STATUSES, LISTING_STATUSES } from "../../marketplace/policy";
import { requireHorseAction, horseIdsWithAction, authorizeHorseAction } from "../../access/horseAccess";
import { hasEntitlement } from "../../commerce/entitlementGates";
import { acceptedGrantScope } from "../../commerce/entitlementScope";
import {
  commandRequestDigest,
  executeInquiryCreate,
  executeInquiryStatus,
  executeListingCreate,
  executeListingRenew,
  executeListingStatus,
  executeReplyCreate,
  executeBuyerClose,
  executeWatchlistAdd,
  executeWatchlistRemove,
  executeBlockCreate,
  executeBlockRemove,
  executeListingDossier,
  readIdempotencyKey,
  receiptActorId,
  type ReceiptScope,
} from "../../marketplace/commands";

/** R98-N12: the platform's honest role in a sale — shown on EVERY listing
 * detail and conversation surface in both languages. The platform introduces
 * buyers to sellers; it never escrows money, inspects horses or guarantees a
 * transaction, and no surface may claim otherwise. */
import { MARKETPLACE_DISCLOSURE as MARKETPLACE_INTRODUCTION_DISCLOSURE } from "../../shared/marketplacePolicy";
export { MARKETPLACE_INTRODUCTION_DISCLOSURE };
import { canReadModerationEvidence, type ModerationEvidenceCase } from "../../moderation/evidenceAccess";
import type { D1Database } from "@cloudflare/workers-types";

// Sales marketplace (client requirement: بخش فروش) — a buyer researches a horse
// (pedigree, competitions, verified documents) and then contacts the seller.
// Listings are per-horse, status-lifecycle managed, and always provenance-tagged.

const ListingCreateSchema = z.object({
  horse_id: z.number().int().positive(),
  seller_contact_name: z.string().trim().min(2).max(160),
  seller_contact_phone: z.string().trim().max(40).nullable().optional(),
  seller_contact_email: z.string().email().max(254).nullable().optional(),
  seller_city: z.string().trim().max(120).nullable().optional(),
  asking_price_toman: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  price_visible: z.boolean().default(true),
  negotiable: z.boolean().default(false),
  title: z.string().trim().max(220).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
});

const ListingStatusSchema = z.object({
  status: z.enum(LISTING_STATUSES),
  // P03: every edit is optimistic-concurrency guarded. The client sends the
  // row_version it read; a stale write is a 409 carrying the current version.
  expected_version: z.number().int().min(1).max(1_000_000_000),
});

const ListingRenewSchema = z.object({
  expected_version: z.number().int().min(1).max(1_000_000_000),
  extend_days: z.number().int().min(7).max(365).default(90),
});

const InquirySchema = z.object({
  buyer_name: z.string().trim().min(2).max(160),
  buyer_contact: z.string().trim().min(5).max(254),
  message: z.string().trim().max(2000).nullable().optional(),
});

const InquiryStatusSchema = z.object({
  status: z.enum(INQUIRY_STATUSES),
  expected_version: z.number().int().min(1).max(1_000_000_000),
});

const LISTING_COLUMNS = `
  l.id,l.horse_id,l.seller_user_id,l.seller_contact_name,l.seller_city,l.asking_price_toman,l.price_visible,l.negotiable,
  l.status,l.title,l.description,l.view_count,l.listed_at,l.updated_at,l.expires_at,l.provenance,l.row_version,
  l.availability_confirmed_at,l.sponsored_until,
  h.name_latin,h.name_native,h.breed_desc,h.sex_desc,h.birth_year,h.color_desc,h.main_strain_desc,h.is_stallion,h.register_no,
  (SELECT COUNT(*) FROM competition_results cr WHERE cr.horse_id=l.horse_id) AS competition_starts,
  (SELECT COUNT(*) FROM horse_media hm WHERE hm.horse_id=l.horse_id AND hm.media_type='document' AND hm.verification='federation_verified' AND hm.quarantined_at IS NULL AND hm.quarantine_reason IS NULL) AS verified_media_count,
  (SELECT COUNT(*) FROM listing_suspensions ls WHERE ls.listing_id=l.id AND ls.reinstated_at IS NULL) AS suspension_count,
  (SELECT ls.reason FROM listing_suspensions ls WHERE ls.listing_id=l.id AND ls.reinstated_at IS NULL ORDER BY ls.id DESC LIMIT 1) AS suspension_reason
` as const;

// The public endpoint must be invariant to changes in a hidden price, including sorting/filtering.
export const PUBLIC_LISTING_PRICE_SQL = "CASE WHEN l.price_visible=1 THEN l.asking_price_toman ELSE NULL END";
export const PUBLIC_LISTING_COLUMNS = LISTING_COLUMNS
  .replace("l.asking_price_toman", `${PUBLIC_LISTING_PRICE_SQL} AS asking_price_toman`)
  // Documents are private under the media policy; even their presence is not public.
  .replace(/\(SELECT COUNT\(\*\) FROM horse_media hm [^\n]+\) AS verified_media_count/, "0 AS verified_media_count");

export function isActiveSponsoredPlacement(value: unknown, now = Date.now()): boolean {
  const expiresAt = parseUtcTimestamp(value);
  return Number.isFinite(now) && expiresAt !== null && expiresAt > now;
}

export async function listListings(db: D1Database, url: URL, now = Date.now()): Promise<Response> {
  const limit = parseBoundedIntegerParam(url.searchParams.get("limit"), 20, 1, 60, "limit");
  const offset = parseBoundedIntegerParam(url.searchParams.get("offset"), 0, 0, 100_000, "offset");
  const includeAll = url.searchParams.get("all") === "1";
  // R88 agent plan P16: suspended listings (transparent moderation overlay)
  // are hidden from PUBLIC lists; staff/seller views still reach the detail.
  const where: string[] = [includeAll ? "l.status IN ('active','pending_sale','sold')" : "l.status IN ('active','pending_sale')", "(l.status='sold' OR l.expires_at IS NULL OR datetime(l.expires_at)>datetime('now'))", "NOT EXISTS(SELECT 1 FROM listing_suspensions ls WHERE ls.listing_id=l.id AND ls.reinstated_at IS NULL)"];
  const binds: unknown[] = [];
  const breed = url.searchParams.get("breed");
  if (breed) { where.push("h.breed_desc=?"); binds.push(breed); }
  const sex = url.searchParams.get("sex");
  if (sex) { where.push("h.sex_desc=?"); binds.push(sex); }
  const city = url.searchParams.get("city");
  if (city) { where.push("l.seller_city=?"); binds.push(city); }
  const maxPrice = url.searchParams.get("maxPrice");
  if (maxPrice && /^\d+$/.test(maxPrice)) { where.push("l.price_visible=1 AND l.asking_price_toman<=?"); binds.push(Number(maxPrice)); }
  const minPrice = url.searchParams.get("minPrice");
  if (minPrice && /^\d+$/.test(minPrice)) { where.push("l.price_visible=1 AND l.asking_price_toman>=?"); binds.push(Number(minPrice)); }
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q) {
    where.push("(h.name_latin LIKE ? ESCAPE '!' OR h.name_native LIKE ? ESCAPE '!' OR h.register_no LIKE ? ESCAPE '!')");
    const pattern = `%${q.replace(/[!%_]/g, (m) => `!${m}`)}%`;
    if (new TextEncoder().encode(pattern).byteLength > 50) throw new HttpError(400, "filter_too_long", "Search must fit within 48 UTF-8 bytes after escaping");
    binds.push(pattern, pattern, pattern);
  }
  const sort = url.searchParams.get("sort") === "price_asc" ? `(${PUBLIC_LISTING_PRICE_SQL}) IS NULL ASC, (${PUBLIC_LISTING_PRICE_SQL}) ASC` : url.searchParams.get("sort") === "price_desc" ? `(${PUBLIC_LISTING_PRICE_SQL}) IS NULL ASC, (${PUBLIC_LISTING_PRICE_SQL}) DESC` : "l.listed_at DESC";
  // R88 agent plan P19: sponsored placement sorts FIRST, but ONLY while
  // sponsored_until is in the future, and every such row carries the
  // bilingual Sponsored/تبلیغ label. Scientific surfaces (breeding rankings,
  // pedigree quality, credential authenticity) never read sponsored_until.
  // One strict, millisecond-precise value governs both pagination order and
  // the visible paid-placement label. A malformed legacy date is inactive on
  // SQLite and PostgreSQL; neither engine may normalize it into paid status.
  const sponsoredActive = `CASE WHEN ${utcTimestampMillisSql("l.sponsored_until")}>? THEN 1 ELSE 0 END AS sponsored_active`;
  const whereSql = `FROM sales_listings l JOIN horses h ON h.id=l.horse_id AND h.deleted_at IS NULL AND h.is_active=1 WHERE ${where.join(" AND ")}`;
  const [rows, total] = await db.batch([
    db.prepare(`SELECT ${PUBLIC_LISTING_COLUMNS},${sponsoredActive} ${whereSql} ORDER BY sponsored_active DESC, ${sort}, l.id ASC LIMIT ? OFFSET ?`).bind(Number.isFinite(now) ? now : null, ...binds, limit, offset),
    db.prepare(`SELECT COUNT(*) AS n ${whereSql}`).bind(...binds),
  ]);
  const labeled = (rows.results ?? []).map((row) => {
    const { sponsored_active, ...record } = row as Record<string, unknown>;
    const isSponsored = Number(sponsored_active) === 1;
    return { ...record, sponsored: isSponsored, sponsored_label: isSponsored ? { en: "Sponsored", fa: "تبلیغ" } : null };
  });
  return json({ rows: labeled, total: Number((total.results?.[0] as { n?: number } | undefined)?.n ?? 0), limit, offset,
    sponsored_note: "Rows marked sponsored are paid placements, clearly labeled in English and Persian. They are never part of scientific breeding rankings, pedigree quality metrics or credential authenticity." });
}

export async function listingDetail(db: D1Database, id: string, url: URL, auth?: PrivacyViewer | null): Promise<Response> {
  const listing = await db.prepare(`SELECT ${LISTING_COLUMNS} FROM sales_listings l JOIN horses h ON h.id=l.horse_id AND h.deleted_at IS NULL AND (h.is_active=1 OR ?=1) WHERE l.id=?`).bind(auth && ["editor", "admin", "super_admin"].includes(auth.user.role) ? 1 : 0, id).first<{
    horse_id: number; father_id?: number; mother_id?: number; status: string; price_visible: number; asking_price_toman: number | null; seller_user_id?: string | null;
    availability_confirmed_at?: string | null; suspension_count?: number; suspension_reason?: string | null;
  } & Record<string, unknown>>();
  if (!listing) throw new HttpError(404, "not_found", "Listing not found");
  // R88 agent plan P16: a suspended listing stays reachable on its detail
  // view with the TRANSPARENT suspension status — but only for the seller
  // and staff. The public gets an honest 404 (the horse profile is never
  // touched by any of this).
  const isSuspended = Number(listing.suspension_count ?? 0) > 0;
  if (isSuspended && !(auth && (listing.seller_user_id === auth.user.id || ["editor", "admin", "super_admin"].includes(auth.user.role)))) {
    throw new HttpError(404, "not_found", "Listing not found");
  }
  // R59 (review fact-check #16/#17): drafts are invisible to anonymous users and
  // to everyone except the listing's seller or editorial staff.
  const staffView = auth && ["editor", "admin", "super_admin"].includes(auth.user.role);
  const sellerView = auth && listing.seller_user_id === auth.user.id;
  if (!staffView && !sellerView) listing.verified_media_count = 0;
  if ((!(["active", "pending_sale", "sold"].includes(listing.status)) || (listing.status !== "sold" && isExpiredTimestamp(listing.expires_at))) && !staffView && !sellerView) {
    throw new HttpError(404, "not_found", "Listing not found");
  }
  // R59 (review fact-check #16): price_visible is enforced server-side — the
  // hidden listing's asking price is never serialized to anonymous buyers.
  if (!listing.price_visible && !staffView && !sellerView) {
    listing.asking_price_toman = null;
    (listing as Record<string, unknown>).price_on_request = true;
  }
  // View tracking is not a GET-side write. Add a consent-aware, rate-limited analytics endpoint separately.
  const horseId = listing.horse_id;
  const [competitions, media] = await db.batch([
    db.prepare(`
      SELECT c.id,c.name_native AS competition_name,c.discipline,c.event_date,c.venue,c.city,c.tier,c.season,
             r.placement,r.placement_text,r.rider_name
      FROM competition_results r JOIN competitions c ON c.id=r.competition_id
      WHERE r.horse_id=? ORDER BY c.event_date DESC LIMIT 10
    `).bind(horseId),
    db.prepare(`
      SELECT m.id,m.media_type,m.role,m.file_name,m.mime_type,m.caption,m.verification,m.width,m.height
      FROM horse_media m WHERE m.horse_id=? AND ${publicMediaPredicate('m')}
      ORDER BY m.sort_order, m.created_at DESC LIMIT 24
    `).bind(horseId),
  ]);
  const horseRow = await db.prepare("SELECT father_id,mother_id FROM horses WHERE id=?").bind(horseId).first<{ father_id: number | null; mother_id: number | null }>();
  const [sire, dam] = await db.batch([
    db.prepare("SELECT id,name_latin,name_native,breed_desc,birth_year FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(horseRow?.father_id ?? -1),
    db.prepare("SELECT id,name_latin,name_native,breed_desc,birth_year FROM horses WHERE id=? AND deleted_at IS NULL AND is_active=1").bind(horseRow?.mother_id ?? -1),
  ]);
  // R98-N12: honest seller-mandate badge — computed LIVE at read time for the
  // seller of record, never a stored flag that can go stale. An expired
  // mandate is reported as expired; it is NEVER rendered as verified
  // ownership, and new inquiries are already refused while it is expired.
  let sellerMandateCurrent: boolean | null = null;
  if (listing.seller_user_id) {
    const sellerAuthority = await authorizeHorseAction(db, { userId: listing.seller_user_id, role: "user" }, horseId, "create_listing", new Date());
    sellerMandateCurrent = sellerAuthority.ok;
  }
  // R98-N12: the optional immutable dossier link — availability and honesty
  // only here; the CONTENT stays behind the existing access-controlled
  // dossier view (a revoked dossier is reported as revoked, never shown).
  let dossierSummary: { id: number; status: string; version: number } | null = null;
  if (listing.dossier_id != null) {
    const dossierRow = await db.prepare("SELECT id,status,version FROM dossier_snapshots WHERE id=?").bind(listing.dossier_id)
      .first<{ id: number; status: string; version: number }>();
    if (dossierRow) dossierSummary = { id: dossierRow.id, status: dossierRow.status, version: dossierRow.version };
  }
  // R98-N12: the signed-in viewer's own watch state for this listing.
  let watched = false;
  if (auth) {
    watched = Boolean(await db.prepare("SELECT 1 FROM buyer_watchlist WHERE user_id=? AND listing_id=?").bind(auth.user.id, id).first());
  }
  return json({
    listing: {
      ...listing,
      // R88 agent plan P16: transparent suspension status + freshness of the
      // availability signal, exposed on every listing detail view.
      suspended: isSuspended,
      suspension: isSuspended ? { reason_scope: "moderation", note: "This listing is suspended following a moderation decision. The horse's registry profile is unaffected." } : null,
      availability_note: listing.availability_confirmed_at
        ? "The seller last confirmed availability on the date shown (availability_confirmed_at). A confirmation is not a reservation."
        : "The seller has not confirmed availability recently.",
      // R98-N12 honesty fields (see the constants above).
      seller_mandate_current: sellerMandateCurrent,
      seller_mandate_note: sellerMandateCurrent === false
        ? "The seller's authority to sell this horse is no longer current. New inquiries are closed."
        : "The listing carries a live seller mandate at the time of this response."
      ,
      dossier: dossierSummary,
      watched,
    },
    pedigree: { sire: sire.results?.[0] ?? null, dam: dam.results?.[0] ?? null },
    competitions: competitions.results ?? [],
    disclosure: MARKETPLACE_INTRODUCTION_DISCLOSURE,
    media: (media.results ?? []).map((row) => ({ ...(row as Record<string, unknown>), verification_level: mediaVerificationToLevel(String((row as Record<string, unknown>).verification ?? "")) })),
    // All viewers (including a seller) use the same evidence policy as the horse profile.
    genetics: (await readHorseGenetics(db, horseId, auth, 30)).tests,
  });
}

export async function createListing(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  // Master-Ai plan T10 (closing the R59 fact-check #12 gap): listing creation
  // is a seller-authorized workflow. Editorial staff keep their capability;
  // any other account needs an active grant covering create_listing on THIS
  // horse (owner mandate, or a delegated seller mandate).
  // R88 agent plan P03: the write itself re-evaluates horse existence and the
  // active grant in the same transactional statement (executeListingCreate),
  // and an Idempotency-Key header claims a durable receipt for exactly one
  // successful execution — a retried create can never produce two listings.
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = ListingCreateSchema.safeParse(await readJson<unknown>(request, 32 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_listing", "Listing data failed validation", parsed.error.flatten());
  const d = parsed.data;
  const horse = await env.DB.prepare(`SELECT h.name_latin,h.name_native,h.breed_desc,h.sex_desc,h.birth_year,h.color_desc,h.main_strain_desc,h.is_stallion,h.register_no,
      (SELECT COUNT(*) FROM competition_results cr WHERE cr.horse_id=h.id) AS competition_starts,
      (SELECT COUNT(*) FROM horse_media hm WHERE hm.horse_id=h.id AND hm.media_type='document' AND hm.verification='federation_verified' AND hm.quarantined_at IS NULL AND hm.quarantine_reason IS NULL) AS verified_media_count
    FROM horses h WHERE h.id=? AND h.deleted_at IS NULL`).bind(d.horse_id)
    .first<Record<string, unknown>>();
  if (!horse) throw new HttpError(404, "not_found", "Horse not found");
  await requireHorseAction(env.DB, auth, d.horse_id, "create_listing");
  const active = await env.DB.prepare("SELECT id FROM sales_listings WHERE horse_id=? AND status IN ('draft','active','pending_sale')").bind(d.horse_id).first<{ id: string }>();
  if (active) throw new HttpError(409, "listing_exists", "This horse already has an active listing");
  const id = crypto.randomUUID();
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "listing.create", targetId: String(d.horse_id), digest: await commandRequestDigest("listing.create", d) }
    : null;
  try {
    const outcome = await executeListingCreate(env.DB, auth, {
      listingId: id,
      horseId: d.horse_id,
      values: {
        seller_contact_name: d.seller_contact_name,
        seller_contact_phone: d.seller_contact_phone ?? null,
        seller_contact_email: d.seller_contact_email ?? null,
        seller_city: d.seller_city ?? null,
        asking_price_toman: d.asking_price_toman ?? null,
        price_visible: d.price_visible ? 1 : 0,
        negotiable: d.negotiable ? 1 : 0,
        title: d.title ?? null,
        description: d.description ?? null,
      },
      isEditorial: auth.user.role === "editor" || auth.user.role === "admin" || auth.user.role === "super_admin",
      now: new Date(),
    }, receipt, horse);
    return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
  } catch (cause) {
    // The unique index, not a preflight read, is the concurrent-write authority.
    if (isActiveListingConflict(cause)) throw new HttpError(409, "listing_exists", "This horse already has an active listing");
    throw cause;
  }
}

export async function updateListingStatus(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, id: string): Promise<Response> {
  // R88 agent plan P03: versioned command. The status change is one guarded
  // transactional statement (executeListingStatus): expected row_version,
  // expected current status, seller identity and the live create_listing
  // grant are all evaluated IN the write. A stale write is a 409 carrying the
  // current version; an authority race (grant revoked between the guard read
  // and the write) is a 403, never a success on stale permission.
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = ListingStatusSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_status", "Status failed validation (expected_version is required)", parsed.error.flatten());
  const listing = await env.DB.prepare("SELECT id,horse_id,seller_user_id,status,expires_at,row_version FROM sales_listings WHERE id=?").bind(id).first<{ id: string; horse_id: number; seller_user_id: string | null; status: string; expires_at: string | null; row_version: number }>();
  if (!listing) throw new HttpError(404, "not_found", "Listing not found");
  const isOwner = listing.seller_user_id === auth.user.id;
  const isStaff = auth.user.role === "admin" || auth.user.role === "super_admin";
  if (!isOwner && !isStaff) throw new HttpError(403, "forbidden", "Only the seller or staff can update this listing");
  // Being the original submitter is not a permanent mandate after a grant is revoked.
  await requireHorseAction(env.DB, auth, listing.horse_id, "create_listing");
  assertListingTransition(listing.status, parsed.data.status, listing.expires_at);
  // A no-op transition is honest without consuming a version: nothing changes.
  if (listing.status === parsed.data.status) return json({ id, status: listing.status, row_version: Number(listing.row_version) });
  if (Number(listing.row_version) !== parsed.data.expected_version) {
    throw new HttpError(409, "listing_version_conflict", "This listing changed while you were editing; reload the current version and try again", { current_version: Number(listing.row_version) });
  }
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "listing.status", targetId: id, digest: await commandRequestDigest("listing.status", parsed.data) }
    : null;
  try {
    const outcome = await executeListingStatus(env.DB, auth, {
      listingId: id,
      expectedVersion: parsed.data.expected_version,
      currentStatus: listing.status,
      nextStatus: parsed.data.status,
      isStaff,
      sellerUserId: listing.seller_user_id ?? "",
      horseId: listing.horse_id,
      now: new Date(),
    }, receipt);
    return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
  } catch (cause) {
    if (isActiveListingConflict(cause)) throw new HttpError(409, "listing_exists", "This horse already has an active listing");
    throw cause;
  }
}

/**
 * R88 agent plan P03: listing renewal (expiry extension). Renewal was the
 * missing command: an expired listing could move to draft but could never be
 * published again (draft -> active is blocked by the stale expires_at), so
 * expiry was a dead end. Renew extends expires_at from now by a bounded
 * number of days; an EXPIRED listing is reactivated to active in the same
 * guarded statement. Like every mutable command: expected_version, in-write
 * authority, idempotency receipt.
 */
/**
 * R88 agent plan P16: the seller confirms the listing is still available.
 * Requires a CURRENT create_listing mandate (an expired mandate cannot refresh
 * a stale availability signal), and the timestamp is exposed on the public
 * listing so buyers can see how fresh the claim is.
 */
export async function confirmListingAvailability(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, id: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const listing = await env.DB.prepare("SELECT id,horse_id,seller_user_id,status FROM sales_listings WHERE id=?").bind(id)
    .first<{ id: string; horse_id: number; seller_user_id: string | null; status: string }>();
  if (!listing) throw new HttpError(404, "not_found", "Listing not found");
  if (listing.seller_user_id !== auth.user.id && !['admin', 'super_admin'].includes(auth.user.role)) {
    throw new HttpError(403, "forbidden", "Only the seller can confirm availability");
  }
  // The CURRENT mandate is required — this is the trust signal itself.
  await requireHorseAction(env.DB, auth, listing.horse_id, "create_listing");
  if (!['active', 'pending_sale'].includes(listing.status)) {
    throw new HttpError(409, "not_confirmable", "Only a live listing can carry a fresh availability confirmation");
  }
  const [update] = await env.DB.batch([
    env.DB.prepare("UPDATE sales_listings SET availability_confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('active','pending_sale')").bind(id),
  ]);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "not_confirmable", "Only a live listing can carry a fresh availability confirmation");
  return json({
    confirmed: true,
    listing_id: id,
    note: "Availability confirmed under your current seller mandate. Buyers see when this confirmation was made.",
  });
}

export async function renewListing(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, id: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = ListingRenewSchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_renewal", "Renewal failed validation (expected_version is required; extend_days 7-365)", parsed.error.flatten());
  const listing = await env.DB.prepare("SELECT id,horse_id,seller_user_id,status,expires_at,row_version FROM sales_listings WHERE id=?").bind(id).first<{ id: string; horse_id: number; seller_user_id: string | null; status: string; expires_at: string | null; row_version: number }>();
  if (!listing) throw new HttpError(404, "not_found", "Listing not found");
  const isOwner = listing.seller_user_id === auth.user.id;
  const isStaff = auth.user.role === "admin" || auth.user.role === "super_admin";
  if (!isOwner && !isStaff) throw new HttpError(403, "forbidden", "Only the seller or staff can renew this listing");
  await requireHorseAction(env.DB, auth, listing.horse_id, "create_listing");
  // Only a live or lapsed listing can be renewed: sold/withdrawn/pending_sale
  // are outside renewal semantics (sold is terminal and is never a state you
  // can buy your way back from; withdrawn listings restart via draft).
  if (!["active", "expired"].includes(listing.status)) {
    throw new HttpError(409, "invalid_listing_transition", "Only an active or expired listing can be renewed", { current: listing.status, allowed: ["active", "expired"] });
  }
  if (Number(listing.row_version) !== parsed.data.expected_version) {
    throw new HttpError(409, "listing_version_conflict", "This listing changed while you were editing; reload the current version and try again", { current_version: Number(listing.row_version) });
  }
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "listing.renew", targetId: id, digest: await commandRequestDigest("listing.renew", parsed.data) }
    : null;
  try {
    const outcome = await executeListingRenew(env.DB, auth, {
      listingId: id,
      expectedVersion: parsed.data.expected_version,
      currentStatus: listing.status,
      extendDays: parsed.data.extend_days,
      isStaff,
      now: new Date(),
    }, receipt);
    return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
  } catch (cause) {
    // Reactivating an expired listing whose horse already has another
    // draft/active/pending_sale listing trips the per-horse partial unique
    // index — the honest answer is the same 409 as a conflicting create.
    if (isActiveListingConflict(cause)) throw new HttpError(409, "listing_exists", "This horse already has an active listing");
    throw cause;
  }
}

export async function createInquiry(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, listingId: string): Promise<Response> {
  requireSameOriginMutation(request);
  // A storage failure must remain a failure, not masquerade as an anonymous inquiry.
  const auth = await getAuth(env.DB, request, env.SESSION_COOKIE_NAME);
  if (auth) requireCsrf(request, auth);
  // R88 agent plan P03: an Idempotency-Key makes the public inquiry form safe
  // against double submits and network retries — one key, one inquiry.
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = InquirySchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_inquiry", "Inquiry failed validation", parsed.error.flatten());
  // R88 agent plan P16: a suspended listing is hidden from NEW inquiries
  // (transparent moderation overlay — the listing row itself is untouched).
  const suspended = await env.DB.prepare(
    "SELECT id FROM listing_suspensions WHERE listing_id=? AND reinstated_at IS NULL"
  ).bind(listingId).first();
  if (suspended) throw new HttpError(404, "not_found", "Listing not available");
  const listing = await env.DB.prepare(`SELECT l.id,l.seller_user_id,l.horse_id FROM sales_listings l
    JOIN horses h ON h.id=l.horse_id AND h.deleted_at IS NULL
    WHERE l.id=? AND l.status IN ('active','pending_sale')
      AND (l.expires_at IS NULL OR datetime(l.expires_at)>datetime('now'))`).bind(listingId).first<{ id: string; seller_user_id: string | null; horse_id: number }>();
  if (!listing) throw new HttpError(404, "not_found", "Listing not available");
  // R88 agent plan P16: an EXPIRED seller mandate blocks NEW inquiries — the
  // buyer is never routed into a conversation the seller is no longer
  // authorized to receive (renewal is refused for the same reason in
  // renewListing's requireHorseAction guard).
  if (listing.seller_user_id) {
    const sellerAuthority = await authorizeHorseAction(env.DB, { userId: listing.seller_user_id, role: "user" }, listing.horse_id, "create_listing", new Date());
    if (!sellerAuthority.ok) {
      throw new HttpError(410, "seller_authority_expired", "This listing's seller mandate is no longer current; new inquiries are closed. The listing expires on its own schedule.");
    }
  }
  // R98-N12: participant blocks refuse NEW contact NEUTRALLY — the refusal
  // never mentions that a block exists or which side created it (the same
  // honest-refusal rule as the service-request provider block). The INSERT
  // below re-checks the same predicate inside the write, so a block landing
  // between this read and the write still fails closed.
  if (auth && listing.seller_user_id) {
    const blocked = await env.DB.prepare(
      "SELECT 1 FROM marketplace_participant_blocks WHERE (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?)"
    ).bind(auth.user.id, listing.seller_user_id, listing.seller_user_id, auth.user.id).first();
    if (blocked) {
      throw new HttpError(403, "inquiry_refused", "This inquiry cannot be submitted.");
    }
  }
  if (auth && listing.seller_user_id === auth.user.id) throw new HttpError(400, "self_inquiry", "You cannot inquire about your own listing");
  const id = crypto.randomUUID();
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "inquiry.create", targetId: listingId, digest: await commandRequestDigest("inquiry.create", parsed.data) }
    : null;
  // Availability is rechecked in the write itself (INSERT .. SELECT), not just
  // the preceding read.
  const outcome = await executeInquiryCreate(env.DB, {
    inquiryId: id,
    listingId,
    buyerUserId: auth?.user.id ?? null,
    buyerName: parsed.data.buyer_name,
    buyerContact: parsed.data.buyer_contact,
    message: parsed.data.message ?? null,
  }, receipt);
  return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
}

/**
 * Private seller workflow. Closed inquiries cannot be silently reopened.
 * R88 agent plan P03: versioned command — expected_version required, and the
 * seller identity + live manage_inquiries grant are evaluated inside the
 * UPDATE (executeInquiryStatus), so a grant revoked between the guard and the
 * write turns the command into a no-op 403 instead of a success. The response
 * carries no buyer contact fields: inquiry contacts stay private and disappear
 * with the grant (myListings already filters on the live grant).
 */
export async function updateInquiryStatus(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, id: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = InquiryStatusSchema.safeParse(await readJson<unknown>(request, 4096));
  if (!parsed.success) throw new HttpError(400, "invalid_inquiry_status", "Inquiry status failed validation (expected_version is required)", parsed.error.flatten());
  const row = await env.DB.prepare(`SELECT i.id,i.status,i.row_version,l.horse_id,l.seller_user_id FROM sales_inquiries i
    JOIN sales_listings l ON l.id=i.listing_id WHERE i.id=?`).bind(id)
    .first<{ id: string; status: string; row_version: number; horse_id: number; seller_user_id: string | null }>();
  if (!row) throw new HttpError(404, "not_found", "Inquiry not found");
  if (row.seller_user_id !== auth.user.id && !["admin", "super_admin"].includes(auth.user.role)) throw new HttpError(403, "forbidden", "Only the seller or staff can update this inquiry");
  await requireHorseAction(env.DB, auth, row.horse_id, "manage_inquiries");
  assertInquiryTransition(row.status, parsed.data.status);
  if (row.status === parsed.data.status) return json({ inquiry: { id, status: row.status, row_version: Number(row.row_version) } });
  if (Number(row.row_version) !== parsed.data.expected_version) {
    throw new HttpError(409, "inquiry_version_conflict", "This inquiry changed while you were editing; reload the current version and try again", { current_version: Number(row.row_version) });
  }
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "inquiry.status", targetId: id, digest: await commandRequestDigest("inquiry.status", parsed.data) }
    : null;
  const outcome = await executeInquiryStatus(env.DB, auth, {
    inquiryId: id,
    expectedVersion: parsed.data.expected_version,
    currentStatus: row.status,
    nextStatus: parsed.data.status,
    isStaff: ["admin", "super_admin"].includes(auth.user.role),
    now: new Date(),
  }, receipt);
  return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
}

export async function myListings(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(`SELECT ${LISTING_COLUMNS} FROM sales_listings l JOIN horses h ON h.id=l.horse_id WHERE l.seller_user_id=? ORDER BY l.listed_at DESC LIMIT 100`).bind(auth.user.id).all();
  const inquiries = await env.DB.prepare(`
    SELECT i.id,i.listing_id,i.buyer_name,i.buyer_contact,i.message,i.status,i.created_at,i.row_version,l.horse_id,h.name_latin
    FROM sales_inquiries i JOIN sales_listings l ON l.id=i.listing_id JOIN horses h ON h.id=l.horse_id
    WHERE l.seller_user_id=? ORDER BY i.created_at DESC LIMIT 100
  `).bind(auth.user.id).all();
  const inquiryRows = (inquiries.results ?? []) as Array<Record<string, unknown>>;
  const authorized = await horseIdsWithAction(env.DB, { userId: auth.user.id, role: auth.user.role },
    inquiryRows.map((row) => Number(row.horse_id)), "manage_inquiries");
  const visible = inquiryRows.filter((row) => authorized.has(Number(row.horse_id)));

  return json({ listings: rows.results ?? [], inquiries: visible });
}

/**
 * R117-15 (Master AI R117 handoff D19): the buyer-owned SENT-INQUIRY inbox —
 * a bounded, paginated, buyer-scoped query that is deliberately SEPARATE from
 * the seller's myListings above. The buyer sees exactly the inquiries THEY
 * sent (WHERE i.buyer_user_id = the caller), never a seller's full inbox, so
 * no inquiry/contact data crosses principals and the seller query surface is
 * not broadened to populate the buyer screen. Each row reports the listing's
 * CURRENT status honestly — a sold, withdrawn or expired listing says so —
 * because the conversation history stays readable to both participants for
 * the whole life of the conversation. The horse is LEFT-JOINED: if the horse
 * record becomes unreadable the buyer still sees their own inquiry (with the
 * horse name simply absent), mirroring the participant-only conversation
 * read; unreadable rows are never silently dropped from the buyer's own list.
 */
export async function sentInquiries(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const url = new URL(request.url);
  const limit = parseBoundedIntegerParam(url.searchParams.get("limit"), 50, 1, 100, "limit");
  const offset = parseBoundedIntegerParam(url.searchParams.get("offset"), 0, 0, 1_000_000, "offset");
  const [rows, total] = await env.DB.batch([
    env.DB.prepare(`
      SELECT i.id, i.listing_id, i.status, i.row_version, i.created_at, i.message,
             l.status AS listing_status, l.expires_at AS listing_expires_at, l.title AS listing_title, l.horse_id,
             h.name_latin, h.name_native,
             (SELECT COUNT(*) FROM sales_inquiry_replies r WHERE r.inquiry_id = i.id) AS reply_count,
             (SELECT MAX(r.created_at) FROM sales_inquiry_replies r WHERE r.inquiry_id = i.id) AS last_reply_at
      FROM sales_inquiries i
      JOIN sales_listings l ON l.id = i.listing_id
      LEFT JOIN horses h ON h.id = l.horse_id AND h.deleted_at IS NULL
      WHERE i.buyer_user_id = ?
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?`).bind(auth.user.id, limit, offset),
    env.DB.prepare("SELECT COUNT(*) AS total FROM sales_inquiries WHERE buyer_user_id = ?").bind(auth.user.id),
  ]) as Array<{ results?: Array<Record<string, unknown>> }>;
  return json({
    rows: rows.results ?? [],
    pagination: { limit, offset, total: Number((total.results?.[0] as { total?: number } | undefined)?.total ?? 0) },
    note: "Your sent inquiries. Each listing's status is reported honestly — a sold, withdrawn or expired listing says so — and the conversation history stays readable to both participants.",
  });
}

/**
 * R88 agent plan P19: operator-set sponsored placement. Requires the
 * LISTING SELLER to hold an ACTIVE sponsored_visibility entitlement (checked
 * live at set time) and is audit-logged. The placement is an expiry
 * timestamp — never a permanent flag — and scientific surfaces never read it.
 */
export async function adminSponsorListing(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, id: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "admin");
  requireCsrf(request, auth);
  const parsed = z.object({ days: z.number().int().min(1).max(90) }).safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_sponsorship", "Sponsorship failed validation (days 1-90)");
  const listing = await env.DB.prepare("SELECT id, horse_id, seller_user_id, status FROM sales_listings WHERE id=?").bind(id)
    .first<{ id: string; horse_id: number; seller_user_id: string | null; status: string }>();
  if (!listing) throw new HttpError(404, "not_found", "Listing not found");
  if (listing.status !== "active") throw new HttpError(409, "not_sponsorable", "Only an active listing can carry sponsored placement");
  // The seller must hold the paid plan — placement is never granted free.
  // R120: scope follows the environment (isolated demo recognizes its own
  // demo-scope plan; production accepts production scope only).
  if (!listing.seller_user_id || !(await hasEntitlement(env.DB, listing.seller_user_id, "sponsored_visibility_monthly", null, acceptedGrantScope(env)))) {
    throw new HttpError(409, "sponsor_entitlement_required", "The listing seller does not hold an active sponsored visibility plan");
  }
  const until = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString();
  const [update] = await env.DB.batch([
    env.DB.prepare("UPDATE sales_listings SET sponsored_until=? WHERE id=? AND status='active'").bind(until, id),
    env.DB.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).bind(auth.user.id, "listing.sponsored", "sales_listings", id, "null", JSON.stringify({ sponsored_until: until, days: parsed.data.days })),
  ]);
  if (Number(update?.meta.changes ?? 0) !== 1) throw new HttpError(409, "not_sponsorable", "Only an active listing can carry sponsored placement");
  return json({
    sponsored: true,
    listing_id: id,
    sponsored_until: until,
    labels: { en: "Sponsored", fa: "تبلیغ" },
    note: "The placement is clearly labeled in both languages, sorts first only while active, and never appears in scientific breeding rankings, pedigree quality metrics or credential authenticity.",
  });
}

// ---------------------------------------------------------------------------
// R98-N12 — conversation view, reply thread, buyer closure
// ---------------------------------------------------------------------------

const ReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

/**
 * The private conversation view: the opening inquiry message, the reply
 * thread, and the LISTING's current status reported honestly (an expired,
 * withdrawn or sold listing says so — the conversation never pretends the
 * listing is still live). Reads are PARTICIPANT-ONLY for the whole life of
 * the conversation, including after the listing expires or is withdrawn.
 * Staff can read ONLY while triaging a moderation case that targets this
 * inquiry (dispute handling with an independent case history).
 */
export async function inquiryConversation(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, inquiryId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const row = await env.DB.prepare(`
    SELECT i.id, i.listing_id, i.buyer_user_id, i.buyer_name, i.buyer_contact, i.message, i.status, i.row_version, i.created_at,
           l.status AS listing_status, l.expires_at AS listing_expires_at, l.title AS listing_title, l.seller_user_id, l.horse_id
    FROM sales_inquiries i JOIN sales_listings l ON l.id=i.listing_id
    WHERE i.id=?`).bind(inquiryId)
    .first<{ id: string; listing_id: string; buyer_user_id: string | null; buyer_name: string; buyer_contact: string; message: string | null; status: string; row_version: number; created_at: string; listing_status: string; listing_expires_at: string | null; listing_title: string | null; seller_user_id: string | null; horse_id: number }>();
  if (!row) throw new HttpError(404, "not_found", "Inquiry not found");
  const isBuyer = row.buyer_user_id === auth.user.id;
  const isSeller = row.seller_user_id === auth.user.id;
  const hasModerationRole = ["admin", "super_admin"].includes(auth.user.role);
  if (!isBuyer && !isSeller && !hasModerationRole) throw new HttpError(404, "not_found", "Inquiry not found");
  let staffDisputeCase: { id: number; status: string } | null = null;
  const isStaffEvidenceReader = !isBuyer && !isSeller && hasModerationRole;
  if (isStaffEvidenceReader) {
    const caseRows = await env.DB.prepare(
      "SELECT id, status, assigned_operator_user_id FROM moderation_cases WHERE target_table='sales_inquiries' AND target_id=? ORDER BY id DESC LIMIT 100"
    ).bind(inquiryId).all<ModerationEvidenceCase>();
    const caseRow = (caseRows.results ?? []).find((candidate) => canReadModerationEvidence(auth.user, candidate));
    // Do not disclose whether a case exists when the viewer lacks current
    // evidence authority. The conversation itself is a private object.
    if (!caseRow) throw new HttpError(404, "not_found", "Inquiry not found");
    staffDisputeCase = { id: caseRow.id, status: caseRow.status };
  }
  const replies = await env.DB.prepare(
    "SELECT id, author_side, body, created_at FROM sales_inquiry_replies WHERE inquiry_id=? ORDER BY created_at, id"
  ).bind(inquiryId).all<{ id: string; author_side: string; body: string; created_at: string }>();
  // The buyer's contact details stay with the buyer/seller pair; a staff
  // dispute reader sees the message bodies but never the buyer's contact
  // string (moderation needs the exchange, not the PII).
  const conversation = {
    inquiry: {
      id: row.id,
      listing_id: row.listing_id,
      status: row.status,
      row_version: row.row_version,
      created_at: row.created_at,
      message: row.message,
      buyer_name: row.buyer_name,
      buyer_contact: isStaffEvidenceReader ? null : row.buyer_contact,
    },
    listing_status: row.listing_status,
    listing_expires_at: row.listing_expires_at,
    listing_title: row.listing_title,
    replies: replies.results ?? [],
    viewer_side: isSeller ? "seller" : isBuyer ? "buyer" : "staff",
    staff_dispute_case: staffDisputeCase,
    disclosure: MARKETPLACE_INTRODUCTION_DISCLOSURE,
  };
  if (isStaffEvidenceReader && staffDisputeCase) {
    // Sensitive evidence reads are auditable without copying message bodies or
    // buyer contact data into the audit stream.
    await env.DB.prepare(`
      INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).bind(
      auth.user.id,
      "moderation.evidence_read",
      "sales_inquiries",
      inquiryId,
      "null",
      JSON.stringify({ case_id: staffDisputeCase.id, purpose: "active_case_inquiry_evidence" }),
    ).run();
  }
  return json(conversation);
}

export async function replyToInquiry(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, inquiryId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = ReplySchema.safeParse(await readJson<unknown>(request, 8 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_reply", "Reply failed validation", parsed.error.flatten());
  // Resolve the side from the CURRENT database rows (not from the client).
  const row = await env.DB.prepare(`
    SELECT i.status, i.buyer_user_id, l.seller_user_id FROM sales_inquiries i
    JOIN sales_listings l ON l.id=i.listing_id WHERE i.id=?`).bind(inquiryId)
    .first<{ status: string; buyer_user_id: string | null; seller_user_id: string | null }>();
  if (!row) throw new HttpError(404, "not_found", "Inquiry not found");
  const isBuyer = row.buyer_user_id === auth.user.id;
  const isSeller = row.seller_user_id === auth.user.id;
  if (!isBuyer && !isSeller) throw new HttpError(403, "inquiry_participant_required", "Only the participants of this conversation can reply");
  if (row.status === "closed") throw new HttpError(409, "inquiry_closed", "This conversation is closed; the history stays available but new replies are not accepted");
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "inquiry.reply", targetId: inquiryId, digest: await commandRequestDigest("inquiry.reply", parsed.data) }
    : null;
  const outcome = await executeReplyCreate(env.DB, {
    inquiryId,
    replyId: crypto.randomUUID(),
    authorUserId: auth.user.id,
    authorSide: isSeller ? "seller" : "buyer",
    body: parsed.data.body,
    now: new Date(),
  }, receipt);
  return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
}

const BuyerCloseSchema = z.object({
  expected_version: z.number().int().min(1).max(1_000_000_000),
});

/** The buyer of record closes their own inquiry (status closure for buyers —
 * the seller closes through inquiry.status with a live manage_inquiries
 * grant). Closing keeps the history readable for both participants. */
export async function buyerCloseInquiry(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, inquiryId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const idempotencyKey = readIdempotencyKey(request);
  const parsed = BuyerCloseSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_close", "Close failed validation (expected_version is required)", parsed.error.flatten());
  const receipt: ReceiptScope | null = idempotencyKey
    ? { key: idempotencyKey, actorId: receiptActorId(auth), command: "inquiry.buyer_close", targetId: inquiryId, digest: await commandRequestDigest("inquiry.buyer_close", parsed.data) }
    : null;
  const outcome = await executeBuyerClose(env.DB, {
    inquiryId,
    expectedVersion: parsed.data.expected_version,
    buyerUserId: auth.user.id,
  }, receipt);
  return json(outcome.body, { status: outcome.statusCode, ...(outcome.replayed ? { headers: { "idempotency-replayed": "true" } } : {}) });
}

// ---------------------------------------------------------------------------
// R98-N12 — buyer watchlist
// ---------------------------------------------------------------------------

export async function myWatchlist(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(`
    SELECT w.listing_id, w.created_at AS watched_at, l.status, l.expires_at, l.title,
           h.name_latin, h.name_native, h.breed_desc, h.sex_desc, h.birth_year,
           ${PUBLIC_LISTING_PRICE_SQL} AS asking_price_toman, l.price_visible, l.negotiable, l.seller_city
    FROM buyer_watchlist w
    JOIN sales_listings l ON l.id=w.listing_id
    JOIN horses h ON h.id=l.horse_id AND h.deleted_at IS NULL
    WHERE w.user_id=?
    ORDER BY w.created_at DESC LIMIT 100`).bind(auth.user.id).all<Record<string, unknown>>();
  return json({
    rows: rows.results ?? [],
    note: "Your watchlist is private research data. Watching a listing is not a reservation and conveys no priority or claim.",
  });
}

export async function watchlistAdd(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, listingId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const outcome = await executeWatchlistAdd(env.DB, { userId: auth.user.id, listingId });
  return json(outcome);
}

export async function watchlistRemove(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, listingId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const outcome = await executeWatchlistRemove(env.DB, { userId: auth.user.id, listingId });
  return json(outcome);
}

// ---------------------------------------------------------------------------
// R98-N12 — participant blocks (the blocker's own management view; the blocked
// party can never discover a block)
// ---------------------------------------------------------------------------

const BlockSchema = z.object({
  blocked_user_id: z.string().trim().min(3).max(64),
  reason_private: z.string().trim().max(500).nullable().optional(),
});

export async function myBlocks(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  const rows = await env.DB.prepare(
    "SELECT blocked_user_id, reason_private, created_at FROM marketplace_participant_blocks WHERE blocker_user_id=? ORDER BY created_at DESC LIMIT 200"
  ).bind(auth.user.id).all<{ blocked_user_id: string; reason_private: string | null; created_at: string }>();
  return json({
    rows: rows.results ?? [],
    note: "Blocking stops new inquiries between you and the other account in BOTH directions, and the other side is never told. Existing conversations and their history are preserved.",
  });
}

export async function blockCreate(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = BlockSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_block", "Block failed validation", parsed.error.flatten());
  const outcome = await executeBlockCreate(env.DB, {
    blockerUserId: auth.user.id,
    blockedUserId: parsed.data.blocked_user_id,
    reasonPrivate: parsed.data.reason_private ?? null,
    now: new Date(),
  });
  return json({ ...outcome, note: "New inquiries between you two are refused in both directions. The other side is never told a block exists." });
}

export async function blockRemove(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, blockedUserId: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const outcome = await executeBlockRemove(env.DB, { blockerUserId: auth.user.id, blockedUserId });
  return json(outcome);
}

// ---------------------------------------------------------------------------
// R98-N12 — optional immutable dossier link (seller-owned, same horse, active)
// ---------------------------------------------------------------------------

const ListingDossierSchema = z.object({
  dossier_id: z.number().int().positive().nullable(),
  expected_version: z.number().int().min(1).max(1_000_000_000),
});

export async function attachListingDossier(request: Request, env: { DB: D1Database; SESSION_COOKIE_NAME: string }, id: string): Promise<Response> {
  const auth = await requireAuth(env.DB, request, env.SESSION_COOKIE_NAME, "user");
  requireCsrf(request, auth);
  const parsed = ListingDossierSchema.safeParse(await readJson<unknown>(request, 4 * 1024));
  if (!parsed.success) throw new HttpError(400, "invalid_dossier_attach", "Dossier attach failed validation", parsed.error.flatten());
  const outcome = await executeListingDossier(env.DB, auth, {
    listingId: id,
    expectedVersion: parsed.data.expected_version,
    dossierId: parsed.data.dossier_id,
    now: new Date(),
  });
  return json({ ...outcome.body, note: "The dossier stays a separate, revocable resource. Revoking it makes the listing report it as revoked; the listing's own data never contains a copy of the dossier." });
}
