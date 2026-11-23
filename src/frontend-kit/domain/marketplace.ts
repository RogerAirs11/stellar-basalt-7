import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPlatformClientError } from "../errors";
import { parseUtcTimestamp } from "../../shared/utcTimestamp";
import { useDomainResource } from "./useDomainResource";
import { usePlatformCommand } from "./commandStatus";
import type {
  MarketConversationResponse,
  MarketListingDetailResponse,
  MarketListingRecord,
  MarketSentInquiriesResponse,
  MarketSentInquiryRow,
  MarketWatchlistResponse,
  PlatformClient,
} from "../../contracts/platform";

/**
 * R98-N12 — the ONE headless marketplace controller shared by every frontend.
 * Renderer-agnostic: the independent visual frontends bind to this state
 * machine, each with their own components. Nothing here renders, and nothing
 * here ever claims the platform guarantees a horse or a transaction.
 *
 * Pinned behaviors (from the reviewed N12 ticket):
 *  - The listing lifecycle imports the SAME authoritative map as the server
 *    from src/shared/marketplacePolicy.ts (no parallel client definition). Terminal sold state never silently resurrects;
 *    expired/withdrawn listings renew through the explicit renew path.
 *  - The seller-mandate badge is LIVE server state (seller_mandate_current
 *    computed at read time). An expired mandate renders as expired — never
 *    as verified ownership — and new inquiries are closed while it is.
 *  - Expired/withdrawn listings cannot accept fresh inquiries; old
 *    conversations stay readable (permission-protected) with the listing's
 *    CURRENT status shown honestly in the thread.
 *  - Error states are distinct and actionable: a 409 version conflict
 *    carries the CURRENT version for a reload; a 410 mandate expiry is a
 *    terminal, explained state; a 403 inquiry_refused is NEUTRAL (the
 *    controller never guesses or surfaces that a block may exist).
 *  - The disclosure is carried on every surface: introduction only — no
 *    escrow, no veterinary inspection, no transaction guarantee.
 */

// ---------------------------------------------------------------------------
// Lifecycle vocabulary (the same shared object used by the server)
// ---------------------------------------------------------------------------

import { LISTING_TRANSITIONS, MARKETPLACE_DISCLOSURE } from "../../shared/marketplacePolicy";
export { MARKETPLACE_DISCLOSURE };
export const LISTING_LIFECYCLE: Readonly<Record<string, readonly string[]>> = LISTING_TRANSITIONS;

export type ListingViewerRole = "seller" | "buyer" | "public";

export interface ListingLifecycleView {
  status: string;
  /** The status a reader should be shown (expired computed against now). */
  effectiveStatus: string;
  expired: boolean;
  /** Malformed expiry is not proof of expiry, but cannot authorize publication/inquiry. */
  expiryStatus: "none" | "valid" | "invalid";
  suspended: boolean;
  sellerMandateCurrent: boolean | null;
  /** Which lifecycle transitions the viewer may ATTEMPT (the server stays the authority). */
  sellerActions: readonly string[];
  /** Which buyer research actions are available for this listing right now. */
  buyerActions: readonly ("inquire" | "reply" | "watch" | "unwatch" | "close_own_inquiry")[];
}

export function listingLifecycleView(input: {
  listing: {
    status: string;
    expires_at: string | null;
    suspended?: boolean;
    seller_mandate_current?: boolean | null;
    watched?: boolean;
  };
  viewerRole: ListingViewerRole;
  now?: Date;
}): ListingLifecycleView {
  const now = input.now ?? new Date();
  const expiry = parseUtcTimestamp(input.listing.expires_at);
  const expiryStatus = input.listing.expires_at == null ? "none" : expiry === null ? "invalid" : "valid";
  const validReference = Number.isFinite(now.getTime());
  const expiryAllowsAction = expiryStatus !== "invalid" && validReference;
  const expired = expiry !== null && validReference && expiry <= now.getTime();
  const effectiveStatus = input.listing.status !== "sold" && expired && ["active", "pending_sale"].includes(input.listing.status)
    ? "expired"
    : input.listing.status;
  const mandate = input.listing.seller_mandate_current ?? null;
  const suspended = Boolean(input.listing.suspended);
  const allowed = Object.hasOwn(LISTING_LIFECYCLE, effectiveStatus) ? LISTING_LIFECYCLE[effectiveStatus]! : [];
  // The seller may attempt any mapped transition; publication-family targets
  // additionally require a CURRENT mandate and no active suspension.
  const sellerActions = input.viewerRole === "seller"
    ? allowed.filter((next) => {
        if (["active", "pending_sale"].includes(next)) return mandate === true && !suspended && expiryAllowsAction;
        return true;
      })
    : [];
  const canInquire = input.viewerRole === "buyer" && expiryAllowsAction && !suspended && mandate === true && ["active", "pending_sale"].includes(effectiveStatus);
  const buyerActions: ListingLifecycleView["buyerActions"] = input.viewerRole !== "buyer" ? [] : [
    ...(canInquire ? (["inquire"] as const) : []),
    "reply",
    input.listing.watched ? "unwatch" : "watch",
    "close_own_inquiry",
  ];
  return { status: input.listing.status, effectiveStatus, expired, expiryStatus, suspended, sellerMandateCurrent: mandate, sellerActions, buyerActions };
}

// ---------------------------------------------------------------------------
// Honest disclosure (mirror of the server constant — pinned by source test)
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Error-state classification (distinct, actionable, never guessing causes)
// ---------------------------------------------------------------------------

export type MarketplaceErrorState =
  | { kind: "not_found" }
  | { kind: "version_conflict"; currentVersion: number | null; message: string }
  | { kind: "mandate_expired"; message: string }
  | { kind: "inquiry_closed"; message: string }
  | { kind: "inquiry_refused_neutral"; message: string }
  | { kind: "participant_required"; message: string }
  | { kind: "network" | "server" | "unknown"; message: string };

export function classifyMarketplaceError(error: unknown): MarketplaceErrorState {
  if (!isPlatformClientError(error)) {
    return { kind: "network", message: error instanceof Error ? error.message : "Network error" };
  }
  const code = error.code ?? "";
  const message = error.message ?? "Request failed";
  switch (code) {
    case "listing_version_conflict":
    case "inquiry_version_conflict": {
      const details = (error.details ?? {}) as { current_version?: unknown };
      return { kind: "version_conflict", currentVersion: typeof details.current_version === "number" ? details.current_version : null, message };
    }
    case "seller_authority_expired":
      return { kind: "mandate_expired", message };
    case "inquiry_closed":
      return { kind: "inquiry_closed", message };
    case "inquiry_refused":
      // NEUTRAL by contract: the refusal never carries (or implies) a cause.
      return { kind: "inquiry_refused_neutral", message };
    case "inquiry_participant_required":
      return { kind: "participant_required", message };
    default:
      if (error.status === 404) return { kind: "not_found" };
      return error.status >= 500 ? { kind: "server", message } : { kind: "unknown", message };
  }
}

// ---------------------------------------------------------------------------
// Conversation thread model
// ---------------------------------------------------------------------------

export interface ConversationEntry {
  id: string;
  side: "buyer" | "seller";
  body: string;
  createdAt: string;
}

/** Assemble the thread: the opening inquiry message, then replies in order.
 * The listing's CURRENT status rides along so every frontend shows the
 * conversation honestly (a sold/withdrawn listing says so in the thread). */
export function conversationThread(conversation: MarketConversationResponse): {
  entries: ConversationEntry[];
  open: boolean;
  listingStatusNote: { en: string; fa: string } | null;
} {
  const entries: ConversationEntry[] = [];
  if (conversation.inquiry.message) {
    entries.push({ id: `${conversation.inquiry.id}:opening`, side: "buyer", body: conversation.inquiry.message, createdAt: conversation.inquiry.created_at });
  }
  for (const reply of conversation.replies) {
    entries.push({ id: reply.id, side: reply.author_side === "seller" ? "seller" : "buyer", body: reply.body, createdAt: reply.created_at });
  }
  const open = ["new", "contacted"].includes(conversation.inquiry.status);
  const listingStatusNote = ["sold", "withdrawn", "expired"].includes(conversation.listing_status)
    ? {
        en: `This listing is ${conversation.listing_status}. The conversation history stays available; treat any exchange accordingly.`,
        fa: `این آگهی ${conversation.listing_status === "sold" ? "فروخته شده" : conversation.listing_status === "withdrawn" ? "برداشته شده" : "منقضی"} است. تاریخچه گفت‌وگو محفوظ است.`,
      }
    : null;
  return { entries, open, listingStatusNote };
}

// ---------------------------------------------------------------------------
// Platform surface the controller needs (implemented by PlatformClient and
// the mock client; kept minimal so tests stay light)
// ---------------------------------------------------------------------------

export interface MarketplacePlatform {
  market: Pick<PlatformClient["modules"]["market"], "detail" | "conversation" | "reply" | "closeOwnInquiry" | "watch" | "unwatch">;
}

// ---------------------------------------------------------------------------
// useMarketplaceListing — detail + lifecycle view + watch toggle
// ---------------------------------------------------------------------------

export type MarketplaceListingState =
  | { phase: "loading" }
  | { phase: "not_found" }
  | { phase: "error"; error: MarketplaceErrorState; retry: () => void }
  | { phase: "ready"; detail: MarketListingDetailResponse; lifecycle: ListingLifecycleView; watched: boolean }
  | { phase: "watch_toggling"; detail: MarketListingDetailResponse; lifecycle: ListingLifecycleView; watched: boolean };

export function useMarketplaceListing(platform: MarketplacePlatform | null, listingId: string | null, viewerRole: ListingViewerRole): {
  state: MarketplaceListingState;
  toggleWatch: () => void;
} {
  const [state, setState] = useState<MarketplaceListingState>({ phase: "loading" });
  const [watched, setWatched] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const loadKey = useRef("");

  useEffect(() => {
    if (!platform || !listingId) { setState({ phase: "loading" }); return; }
    const key = `${listingId}:${viewerRole}:${reloadToken}`;
    if (loadKey.current === key) return;
    loadKey.current = key;
    const controller = new AbortController();
    setState({ phase: "loading" });
    platform.market.detail(listingId, { signal: controller.signal })
      .then((detail) => {
        setWatched(Boolean(detail.listing.watched));
        setState({
          phase: "ready",
          detail,
          lifecycle: listingLifecycleView({ listing: detail.listing, viewerRole }),
          watched: Boolean(detail.listing.watched),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const classified = classifyMarketplaceError(error);
        setState(classified.kind === "not_found"
          ? { phase: "not_found" }
          : { phase: "error", error: classified, retry: () => setReloadToken((t) => t + 1) });
      });
    return () => controller.abort();
  }, [platform, listingId, viewerRole, reloadToken]);

  const toggleWatch = useCallback(() => {
    if (!platform || !listingId) return;
    setState((current) => {
      if (current.phase !== "ready" && current.phase !== "watch_toggling") return current;
      const nextWatched = !current.watched;
      const op = nextWatched ? platform.market.watch(listingId) : platform.market.unwatch(listingId);
      op.then((outcome) => {
        setState((after) => (after.phase === "ready" || after.phase === "watch_toggling")
          ? { ...after, phase: "ready", watched: ("added" in outcome ? outcome.added : "removed" in outcome ? !outcome.removed : after.watched) }
          : after);
      }).catch(() => {
        // A failed toggle keeps the honest prior state; the next reload re-reads.
        setState((after) => (after.phase === "watch_toggling" ? { ...after, phase: "ready" } : after));
      });
      return { ...current, phase: "watch_toggling" };
    });
  }, [platform, listingId]);

  return { state, toggleWatch };
}

// ---------------------------------------------------------------------------
// useInquiryConversation — thread view + reply + buyer closure
// ---------------------------------------------------------------------------

export type InquiryConversationState =
  | { phase: "loading" }
  | { phase: "not_found" }
  | { phase: "forbidden" }
  | { phase: "error"; error: MarketplaceErrorState; retry: () => void }
  | {
      phase: "ready";
      conversation: MarketConversationResponse;
      thread: ReturnType<typeof conversationThread>;
      /** Present while a reply/close just failed — distinct from load errors. */
      commandError: MarketplaceErrorState | null;
    }
  | { phase: "sending"; conversation: MarketConversationResponse; thread: ReturnType<typeof conversationThread>; commandError: MarketplaceErrorState | null };

export function useInquiryConversation(platform: MarketplacePlatform | null, inquiryId: string | null): {
  state: InquiryConversationState;
  sendReply: (body: string) => void;
  closeOwnInquiry: () => void;
} {
  const [state, setState] = useState<InquiryConversationState>({ phase: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const loadKey = useRef("");

  useEffect(() => {
    if (!platform || !inquiryId) { setState({ phase: "loading" }); return; }
    const key = `${inquiryId}:${reloadToken}`;
    if (loadKey.current === key) return;
    loadKey.current = key;
    const controller = new AbortController();
    setState({ phase: "loading" });
    platform.market.conversation(inquiryId, { signal: controller.signal })
      .then((conversation) => {
        setState({ phase: "ready", conversation, thread: conversationThread(conversation), commandError: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const classified = classifyMarketplaceError(error);
        setState(classified.kind === "not_found"
          ? { phase: "not_found" }
          : classified.kind === "participant_required"
            ? { phase: "forbidden" }
            : { phase: "error", error: classified, retry: () => setReloadToken((t) => t + 1) });
      });
    // R114-07 REAL DEFECT FIX: the loadKey guard defeated React StrictMode's
    // double-invoked effects (run 1 starts the fetch and marks the key; the
    // cleanup ABORTS it; run 2 early-returns on the stale key — nothing ever
    // loads). Clearing the key on cleanup makes every fresh effect run a real
    // load; the guard still collapses same-key reruns within one mount.
    return () => { controller.abort(); loadKey.current = ""; };
  }, [platform, inquiryId, reloadToken]);

  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  const sendReply = useCallback((body: string) => {
    if (!platform || !inquiryId || !body.trim()) return;
    setState((current) => {
      if (current.phase !== "ready") return current;
      platform.market.reply(inquiryId, { body: body.trim() })
        .then(() => { loadKey.current = ""; refresh(); })
        .catch((error) => {
          setState((after) => (after.phase === "ready" || after.phase === "sending")
            ? { ...after, phase: "ready", commandError: classifyMarketplaceError(error) }
            : after);
        });
      return { ...current, phase: "sending", commandError: null };
    });
  }, [platform, inquiryId, refresh]);

  const closeOwnInquiry = useCallback(() => {
    if (!platform || !inquiryId) return;
    setState((current) => {
      if (current.phase !== "ready") return current;
      platform.market.closeOwnInquiry(inquiryId, { expectedVersion: current.conversation.inquiry.row_version })
        .then(() => { loadKey.current = ""; refresh(); })
        .catch((error) => {
          setState((after) => (after.phase === "ready" || after.phase === "sending")
            ? { ...after, phase: "ready", commandError: classifyMarketplaceError(error) }
            : after);
        });
      return { ...current, phase: "sending", commandError: null };
    });
  }, [platform, inquiryId, refresh]);

  return { state, sendReply, closeOwnInquiry };
}

// ---------------------------------------------------------------------------
// R114-07 (Master AI R113 handoff D19) — the two-principal MARKET lifecycle:
// the seller's own listings + inquiry inbox with versioned status control,
// the buyer's watchlist, and the private conversation both sides read.
// ---------------------------------------------------------------------------

export interface MarketplaceLifecyclePlatform {
  modules: {
    market: Pick<PlatformClient["modules"]["market"], "mine" | "sentInquiries" | "setStatus" | "renew" | "setInquiryStatus" | "conversation" | "reply" | "closeOwnInquiry" | "watchlist" | "watch" | "unwatch">;
  };
}

export type MyMarketplaceSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; listings: MarketListingRecord[]; inquiries: Array<Record<string, unknown>> }
  | { phase: "empty" }
  | { phase: "forbidden"; reason: string }
  | { phase: "unavailable" | "error"; reason: string };

/** The signed-in principal's own listings + received inquiries. Principal
 * scoped: an account change re-keys so one principal's inbox can never paint
 * under another. */
export function useMyMarketplace(options: {
  platform: MarketplaceLifecyclePlatform | null;
  scope?: string;
  userId?: string | null;
}): { mine: MyMarketplaceSnapshot; retry: () => void } {
  const { platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|market-mine|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ listings: [] as MarketListingRecord[], inquiries: [] as Array<Record<string, unknown>> });
    return platform.modules.market.mine();
  }, [platform]);
  const state = useDomainResource<{ listings: MarketListingRecord[]; inquiries: Array<Record<string, unknown>> }>(
    "market-mine", identity, load,
    { isEmpty: (data) => (data.listings?.length ?? 0) === 0 && (data.inquiries?.length ?? 0) === 0, enabled: platform !== null && userId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { mine: { phase: state.state.phase, listings: state.state.data.listings ?? [], inquiries: state.state.data.inquiries ?? [] }, retry: state.retry };
  if (state.state.phase === "empty") return { mine: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { mine: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { mine: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

export type WatchlistSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; rows: NonNullable<MarketWatchlistResponse["rows"]> }
  | { phase: "empty" }
  | { phase: "forbidden" | "unavailable" | "error"; reason: string };

/** The buyer's own saved-listings research list. Principal scoped the same
 * way; bounded per the server's own cap (the server refuses over-cap adds). */
export function useWatchlist(options: {
  platform: MarketplaceLifecyclePlatform | null;
  scope?: string;
  userId?: string | null;
}): { watchlist: WatchlistSnapshot; retry: () => void } {
  const { platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|market-watchlist|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ rows: [], note: "" } as MarketWatchlistResponse);
    return platform.modules.market.watchlist();
  }, [platform]);
  const state = useDomainResource<MarketWatchlistResponse>(
    "market-watchlist", identity, load,
    { isEmpty: (data) => (data.rows?.length ?? 0) === 0, enabled: platform !== null && userId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { watchlist: { phase: state.state.phase, rows: state.state.data.rows ?? [] }, retry: state.retry };
  if (state.state.phase === "empty") return { watchlist: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { watchlist: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { watchlist: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** R117-15 (Master AI R117 handoff D19): the buyer's own SENT-INQUIRY
 * snapshot. The listing status travels with each row so the renderer can
 * report a sold/withdrawn/expired listing honestly while keeping the row
 * (and its conversation) reachable. */
export type SentInquiriesSnapshot =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready" | "reloading"; rows: MarketSentInquiryRow[]; pagination: { limit: number; offset: number; total: number } }
  | { phase: "empty" }
  | { phase: "forbidden" | "unavailable" | "error"; reason: string };

/** The buyer-owned sent-inquiry inbox: exactly the inquiries the signed-in
 * principal sent, from the server's buyer-scoped query (never the seller's
 * inbox). Principal-scoped identity key: an account change re-keys so one
 * buyer's sent list can never paint under another principal. */
export function useSentInquiries(options: {
  platform: MarketplaceLifecyclePlatform | null;
  scope?: string;
  userId?: string | null;
}): { sent: SentInquiriesSnapshot; retry: () => void } {
  const { platform, scope, userId } = options;
  const identity = `${scope ?? "principal:unscoped"}|market-sent|viewer:${userId ?? "anonymous"}`;
  const load = useCallback((_signal: AbortSignal) => {
    if (platform === null) return Promise.resolve({ rows: [], pagination: { limit: 50, offset: 0, total: 0 }, note: "" } as MarketSentInquiriesResponse);
    return platform.modules.market.sentInquiries();
  }, [platform]);
  const state = useDomainResource<MarketSentInquiriesResponse>(
    "market-sent-inquiries", identity, load,
    { isEmpty: (data) => (data.rows?.length ?? 0) === 0, enabled: platform !== null && userId != null });
  if (state.state.phase === "ready" || state.state.phase === "reloading")
    return { sent: { phase: state.state.phase, rows: state.state.data.rows ?? [], pagination: state.state.data.pagination ?? { limit: 50, offset: 0, total: 0 } }, retry: state.retry };
  if (state.state.phase === "empty") return { sent: { phase: "empty" }, retry: state.retry };
  if (state.state.phase === "forbidden" || state.state.phase === "unavailable" || state.state.phase === "error")
    return { sent: { phase: state.state.phase, reason: state.state.reason }, retry: state.retry };
  return { sent: { phase: state.state.phase === "idle" ? "idle" : "loading" }, retry: state.retry };
}

/** Scoped lifecycle command slots; versioned writes (setStatus/renew/
 * setInquiryStatus/closeOwnInquiry) send the row version the renderer read —
 * a stale write is an honest 409 with the current version, never a blind
 * replay. */
export function useMarketplaceLifecycleCommands(scope: string | undefined) {
  const prefix = scope ?? "principal:unscoped";
  const setStatus = usePlatformCommand(`${prefix}|market-set-status`);
  const renew = usePlatformCommand(`${prefix}|market-renew`);
  const reply = usePlatformCommand(`${prefix}|market-reply`);
  const setInquiryStatus = usePlatformCommand(`${prefix}|market-inquiry-status`);
  const closeOwnInquiry = usePlatformCommand(`${prefix}|market-close-own-inquiry`);
  const watch = usePlatformCommand(`${prefix}|market-watch`);
  return { setStatus, renew, reply, setInquiryStatus, closeOwnInquiry, watch };
}
