import { HERITAGE_DECORATION } from "../assetCatalog";
import { type UiLocale, uiText } from "../../shared/uiLocale";
import { horseSexLabel } from "../../frontend-kit/horseDisplay";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MarketListingRecord, PlatformClient, PlatformUser } from "../../contracts/platform";
import { listingLifecycleView, LISTING_LIFECYCLE, MARKETPLACE_DISCLOSURE, useMyMarketplace, useSentInquiries, useWatchlist, useMarketplaceLifecycleCommands, useInquiryConversation, conversationThread, usePrincipalScope, type ListingLifecycleView } from "../../frontend-kit";
import { useI18n } from "../i18n";
import { localizedDigits } from "./presentationLocale";
import { TrophyIcon, VerifyIcon, DocIcon } from "./icons";

// R47b marketplace page (client requirement: بخش فروش) — buyers research a
// horse (pedigree, competitions, documents) before contacting the seller.

function priceLabel(toman: number | null, locale: UiLocale, L: (en: string, fa: string) => string) {
  if (toman == null) return L("price on request", "قیمت با استعلام");
  if (toman >= 1_000_000_000) return `${localizedDigits((toman / 1_000_000_000).toFixed(2).replace(/\.?0+$/, ""), locale)} ${L("billion toman", "میلیارد تومان")}`;
  if (toman >= 1_000_000) return `${localizedDigits(Math.round(toman / 1_000_000), locale)} ${L("million toman", "میلیون تومان")}`;
  return `${localizedDigits(toman, locale)} ${L("toman", "تومان")}`;
}


export function HeritageMarketplacePage({ navigate, platform, user }: { navigate: (path: string) => void; platform: PlatformClient; user: PlatformUser | null }) {
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => (uiText(locale, en, fa));
  const [rows, setRows] = useState<MarketListingRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState(false);
  const [listRetry, setListRetry] = useState(0);
  const [detailError, setDetailError] = useState(false);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [breed, setBreed] = useState("");
  const [sort, setSort] = useState<"newest" | "price_asc" | "price_desc">("newest");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<PlatformClient["modules"]["market"]["detail"]>> | null>(null);
  // R88 P03: after a version/availability conflict the detail is reloaded and
  // mutation controls stay disabled until a fresh version has loaded.
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRows(null); setListError(false);
    platform.modules.market.list({ q, breed: breed || undefined, sort, limit: 12, offset }, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) { setRows(value.rows); setTotal(value.total); } })
      .catch(() => { if (!controller.signal.aborted) { setListError(true); setRows([]); } });
    return () => controller.abort();
  }, [q, breed, sort, offset, platform, listRetry]);
  useEffect(() => {
    if (!selected) { setDetail(null); setDetailError(false); return; }
    const controller = new AbortController();
    setDetail(null); setDetailError(false);
    platform.modules.market.detail(selected, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setDetail(value); })
      .catch(() => { if (!controller.signal.aborted) setDetailError(true); });
    return () => controller.abort();
  }, [selected, platform, reloadToken]);
  const openDetail = selected && detail;

  return <main className="page h-mod-market">
    <header className="h-mod-page-head premium-page-head" data-h-surface-role="major">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule"></span>{L("MARKETPLACE", "بازار")}</div>
        <h1>{L("Horses for sale", "اسب‌های در حال فروش")}</h1>
        <p>{L("Review the available pedigree, competition history and document status before contacting the seller.", "پیش از تماس با فروشنده، شجره‌نامه، سوابق مسابقات و وضعیت بررسی مدارک موجود را ببینید.")}</p>
      </div>
      <div className="h-mod-count"><small>{L("active listings", "آگهی فعال")}</small><strong>{rows === null || listError ? "—" : localizedDigits(total, locale)}</strong><span>{L("for sale", "در حال فروش")}</span></div>
      <img className="page-head-ornament" src={HERITAGE_DECORATION.divider} alt=""/>
    </header>
    <p className="h-mod-provenance page-level">{uiText(locale, MARKETPLACE_DISCLOSURE.en, MARKETPLACE_DISCLOSURE.fa)}</p>
    <section className="h-mod-panel h-mod-market-panel" data-h-surface-role="panel">
    <div className="h-mod-filters">
      <input aria-label={L("Search listings", "جست‌وجوی آگهی‌ها")} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder={L("Search name or register no…", "جست‌وجوی نام یا شماره ثبت…")} dir="auto"/>
      <select aria-label={L("Breed", "نژاد")} value={breed} onChange={(e) => { setBreed(e.target.value); setOffset(0); }}>
        <option value="">{L("All breeds", "همه نژادها")}</option>
        {["Arabian", "Part Bred", "Thoroughbred", "Turkoman", "Kurdish", "Sport Horses", "Caspian", "Persian Plateau", "Darehshouri", "Friesian"].map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select aria-label={L("Sort listings", "مرتب‌سازی آگهی‌ها")} value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setOffset(0); }}>
        <option value="newest">{L("Newest", "جدیدترین")}</option>
        <option value="price_asc">{L("Price ↑", "قیمت ↑")}</option>
        <option value="price_desc">{L("Price ↓", "قیمت ↓")}</option>
      </select>
    </div>
    {listError && <div className="h-mod-error" role="alert">
      <p>{L("Listings could not be loaded. This does not mean there are no listings.","دریافت آگهی‌ها با مشکل روبه‌رو شد. این پیام به معنی خالی بودن فهرست نیست.")}</p>
      <button type="button" onClick={()=>setListRetry(value=>value+1)}>{L("Try again","تلاش دوباره")}</button>
    </div>}
    <div className="h-mod-listings">
      {rows === null && <div className="h-mod-loading">{L("Loading listings…", "در حال بارگذاری آگهی‌ها…")}</div>}
      {!listError && rows?.length === 0 && <div className="h-mod-empty">{L("No listings match these filters.", "آگهی‌ای با این فیلترها یافت نشد.")}</div>}
      {rows?.map((row) => <button key={row.id} className={`h-mod-listing ${selected === row.id ? "selected" : ""}`} onClick={() => setSelected(row.id)}>
        {/* R136: Chromium quirk — a <button> grid container's content does not
            contribute to grid track sizing, collapsing card rows. The button
            is a plain block; one inner wrapper carries the card grid. */}
        <div className="h-mod-listing-inner">
        <div className="h-mod-listing-head">
          <strong dir="auto">{locale === "fa" && row.name_native ? row.name_native : row.name_latin}</strong>
          <small>#{localizedDigits(row.horse_id, locale)}</small>
        </div>
        <div className="h-mod-listing-meta" dir="auto">
          <span>{row.breed_desc ?? "—"}</span>
          <span>{horseSexLabel(row.sex_desc,locale,"—")}{row.birth_year ? ` · ${localizedDigits(new Date().getFullYear() - row.birth_year, locale)} ${L("y", "سال")}` : ""}</span>
          <span>{row.seller_city ?? "—"}</span>
        </div>
        <div className="h-mod-listing-price">
          <b>{Number(row.price_visible) === 1 ? priceLabel(row.asking_price_toman, locale, L) : L("contact seller", "تماس با فروشنده")}</b>
          {Number(row.negotiable) === 1 && <small>{L("negotiable", "قابل مذاکره")}</small>}
        </div>
        <div className="h-mod-listing-trust">
          {Number(row.competition_starts ?? 0) > 0 && <small className="h-mod-trust-chip starts"><TrophyIcon size={13}/>{localizedDigits(row.competition_starts ?? 0, locale)} {L(Number(row.competition_starts) === 1 ? "competition start" : "competition starts", "حضور در مسابقه")}</small>}
          {Number(row.verified_media_count ?? 0) > 0 && <small className="h-mod-trust-chip docs" title={L("Public files reviewed by platform staff. This count does not establish ownership, identity or laboratory certification.", "فایل‌های عمومی بررسی‌شده توسط کارکنان سامانه. این تعداد تأیید مالکیت، هویت یا گواهی آزمایشگاه نیست.")}><VerifyIcon size={13}/>{localizedDigits(row.verified_media_count ?? 0, locale)} {L(Number(row.verified_media_count) === 1 ? "reviewed file" : "reviewed files", "فایل بررسی‌شده")}</small>}
        </div>
        </div>{/* /.h-mod-listing-inner */}
      </button>)}
    </div>
    {!listError && rows !== null && total > 12 && <div className="h-mod-pager">
      <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 12))}>← {L("Previous", "قبلی")}</button>
      <span>{localizedDigits(Math.floor(offset / 12) + 1, locale)} / {localizedDigits(Math.ceil(total / 12), locale)}</span>
      <button disabled={offset + 12 >= total} onClick={() => setOffset(offset + 12)}>{L("Next", "بعدی")} →</button>
    </div>}
    </section>
    {selected && !detail && <section className="h-mod-panel" role={detailError ? "alert" : "status"}>
      <p>{detailError ? L("The listing could not be loaded.","دریافت اطلاعات آگهی ممکن نشد.") : L("Loading listing...","در حال دریافت اطلاعات آگهی…")}</p>
      {detailError && <button type="button" onClick={()=>setReloadToken(value=>value+1)}>{L("Try again","تلاش دوباره")}</button>}
      <button type="button" onClick={()=>setSelected(null)}>{L("Close","بستن")}</button>
    </section>}
    {openDetail && <HeritageListingDetail listing={openDetail.listing} detail={openDetail} navigate={navigate} platform={platform} user={user} onClose={() => setSelected(null)} onConflict={() => setReloadToken((t) => t + 1)} locale={locale} L={L} n={n} />}
    {user ? <HeritageMarketLifecycleSection platform={platform} user={user} locale={locale} L={L} n={n} onOpenListing={(id) => setSelected(id)} /> : null}
  </main>;
}

const INQUIRY_STATUS_LABEL: Record<string, [string, string]> = {
  new: ["New", "جدید"],
  contacted: ["Contacted", "تماس‌گرفته‌شده"],
  closed: ["Closed", "بسته‌شده"],
};

/**
 * R114-07 (Master AI handoff D19) — the two-principal market lifecycle in
 * Heritage's language: the SELLER's own listings with versioned status
 * control (withdraw/reserve/sold/renew — a stale version is an honest 409,
 * never a blind replay), the seller's inquiry inbox with the private
 * conversation + reply, the BUYER's watchlist, and the buyer's own inquiries
 * with close-own-inquiry. Nothing here claims a transaction or a delivery:
 * the marketplace is an introduction surface only.
 */
function HeritageMarketLifecycleSection({ platform, user, locale, L, n, onOpenListing }: {
  platform: PlatformClient; user: PlatformUser; locale: UiLocale;
  L: (en: string, fa: string) => string; n: (value: number) => string; onOpenListing: (id: string) => void;
}) {
  const scope = usePrincipalScope(user, null);
  const { mine, retry } = useMyMarketplace({ platform, scope, userId: user.id });
  const { sent, retry: retrySent } = useSentInquiries({ platform, scope, userId: user.id });
  const { watchlist, retry: retryWatchlist } = useWatchlist({ platform, scope, userId: user.id });
  const commands = useMarketplaceLifecycleCommands(scope);

  return <section className="h-mod-panel h-mod-market-panel" data-h-surface-role="panel" data-surface="market-lifecycle" aria-label={L("My listings and inquiries", "آگهی‌ها و درخواست‌های من")}>
    <h3>{L("My listings and inquiries", "آگهی‌ها و درخواست‌های من")}</h3>
    <p className="h-mod-state-note">{L("The marketplace is an introduction surface — no payment, delivery or ownership transfer happens here. Status changes are versioned: if a listing changed elsewhere, the current version is reloaded before your edit can land.", "بازار فقط سطح آشنایی است — هیچ پرداخت، تحویل یا انتقال مالکیتی اینجا انجام نمی‌شود. تغییر وضعیت نسخه‌دار است: اگر آگهی جای دیگر تغییر کرده باشد، نسخه فعلی پیش از اعمال تغییر شما بازخوانی می‌شود.")}</p>

    {mine.phase === "loading" ? <p role="status">{L("Loading your listings…", "بارگذاری آگهی‌های شما…")}</p> : null}
    {mine.phase === "forbidden" || mine.phase === "unavailable" || mine.phase === "error" ? <div role="alert"><p>{L("Your listing list is unavailable.", "فهرست آگهی شما در دسترس نیست.")}</p><p dir="auto">{mine.reason}</p><button type="button" onClick={retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
    {mine.phase === "empty" ? <p>{L("You have no listings and no received inquiries yet.", "هنوز آگهی یا درخواستی ندارید.")}</p> : null}

    {(mine.phase === "ready" || mine.phase === "reloading") && mine.listings.length ? <div className="h-mod-listings">
      {mine.listings.map((row) => <HeritageSellerListingRow key={row.id} platform={platform} row={row} locale={locale} L={L} n={n} commands={commands} onDone={retry} onOpenListing={onOpenListing} />)}
    </div> : null}

    {(mine.phase === "ready" || mine.phase === "reloading") && mine.inquiries.length ? <div data-surface="market-inquiry-inbox">
      <h4>{L("Inquiries received on your listings", "درخواست‌های دریافتی روی آگهی‌های شما")}</h4>
      <ul className="h-mod-task-list">{mine.inquiries.map((inquiry) => <HeritageInquiryRow key={String(inquiry.id)} platform={platform} inquiry={inquiry} locale={locale} L={L} commands={commands} onDone={retry} seller />)}</ul>
    </div> : null}

    {/* R117-15: the buyer-owned sent-inquiry inbox — a separate bounded query,
        never the seller's inbox; the listing status travels with each row and
        is reported honestly (sold/withdrawn/expired say so). */}
    <div data-surface="market-sent-inquiries">
      <h4>{L("My sent inquiries", "درخواست‌های ارسالی من")}</h4>
      {sent.phase === "loading" ? <p role="status">{L("Loading your sent inquiries…", "بارگذاری درخواست‌های ارسالی شما…")}</p> : null}
      {sent.phase === "forbidden" || sent.phase === "unavailable" || sent.phase === "error" ? <div role="alert"><p>{L("Your sent-inquiry list is unavailable.", "فهرست درخواست‌های ارسالی شما در دسترس نیست.")}</p><p dir="auto">{sent.reason}</p><button type="button" onClick={retrySent}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
      {sent.phase === "empty" ? <p>{L("You have not sent any inquiries yet — open a listing and ask the seller a question.", "هنوز درخواستی ارسال نکرده‌اید — یک آگهی را باز کنید و از فروشنده سؤال بپرسید.")}</p> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length ? <ul className="h-mod-task-list">{(sent.rows as unknown as Array<Record<string, unknown>>).map((row) => <HeritageInquiryRow key={String(row.id)} platform={platform} inquiry={row} locale={locale} L={L} commands={commands} onDone={retrySent} seller={false} />)}</ul> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length < sent.pagination.total ? <p className="h-mod-state-note">{L(`Showing the newest ${sent.rows.length} of ${sent.pagination.total} sent inquiries.`, `نمایش ${sent.rows.length} درخواست آخر از ${sent.pagination.total} درخواست ارسالی.`)}</p> : null}
    </div>

    {commands.setStatus.state.phase === "rejected" || commands.renew.state.phase === "rejected" ? <div role="alert"><p>{L("The listing changed elsewhere — the current version was reloaded; retry with the fresh version.", "آگهی جای دیگر تغییر کرده — نسخه فعلی بازخوانی شد؛ با نسخه تازه دوباره تلاش کنید.")}</p><button type="button" onClick={() => { commands.setStatus.reset(); commands.renew.reset(); retry(); }}>{L("Reload my listings", "بازخوانی آگهی‌های من")}</button></div> : null}

    <div data-surface="market-watchlist">
      <h4>{L("My watchlist", "فهرست پیگیری من")}</h4>
      {watchlist.phase === "loading" ? <p role="status">{L("Loading your watchlist…", "بارگذاری فهرست پیگیری شما…")}</p> : null}
      {watchlist.phase === "empty" ? <p>{L("No saved listings yet — watch a listing to keep it here.", "هنوز آگهی ذخیره‌شده‌ای نیست — آگهی‌ای را دنبال کنید تا اینجا بماند.")}</p> : null}
      {(watchlist.phase === "ready" || watchlist.phase === "reloading") && watchlist.rows.length ? <ul className="h-mod-task-list">{watchlist.rows.map((row) => <li key={String(row.listing_id ?? row.id)}>
        <div className="registry-row-clickable">
          <strong dir="auto">{locale === "fa" && row.name_native ? String(row.name_native) : String(row.name_latin ?? row.title ?? `#${row.listing_id ?? row.id}`)}</strong>
          <small>{L("saved", "ذخیره‌شده")} {String(row.created_at ?? "").slice(0, 10)}</small>
        </div>
        <div className="table-actions">
          <button type="button" onClick={() => onOpenListing(String(row.listing_id ?? row.id))}>{L("Open listing", "باز کردن آگهی")}</button>
          <button type="button" disabled={commands.watch.state.phase === "submitting"} onClick={() => { void commands.watch.run(async () => { const result = await platform.modules.market.unwatch(String(row.listing_id ?? row.id)); retryWatchlist(); return result; }, { successMessage: L("Removed from your watchlist.", "از فهرست پیگیری شما حذف شد.") }); }}>{L("Unwatch", "حذف پیگیری")}</button>
        </div>
      </li>)}</ul> : null}
    </div>
  </section>;
}

/** ONE of the seller's own listings: the effective lifecycle status and the
 * versioned transitions the lifecycle map allows (the server stays the
 * authority); renew extends a bounded expiry honestly. */
function HeritageSellerListingRow({ platform, row, locale, L, n, commands, onDone, onOpenListing }: {
  platform: PlatformClient; row: MarketListingRecord; locale: UiLocale; L: (en: string, fa: string) => string; n: (value: number) => string;
  commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void; onOpenListing: (id: string) => void;
}) {
  const lifecycle = listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at ?? null, seller_mandate_current: null }, viewerRole: "seller" });
  const allowed = LISTING_LIFECYCLE[lifecycle.effectiveStatus] ?? [];
  const busy = commands.setStatus.state.phase === "submitting" || commands.renew.state.phase === "submitting";
  return <div className="h-mod-listing" data-surface="market-seller-listing">
    <div className="h-mod-listing-head">
      <strong dir="auto">{locale === "fa" && row.name_native ? row.name_native : row.name_latin}</strong>
      <small>#{localizedDigits(row.horse_id, locale)} · {lifecycle.effectiveStatus} · v{n(row.row_version ?? 0)}{row.expires_at ? ` · ${L("expires", "انقضا")} ${String(row.expires_at).slice(0, 10)}` : ""}</small>
    </div>
    <div className="h-mod-listing-price"><b>{Number(row.price_visible) === 1 ? priceLabel(row.asking_price_toman, locale, L) : L("contact seller", "تماس با فروشنده")}</b></div>
    <div className="table-actions">
      <button type="button" onClick={() => onOpenListing(row.id)}>{L("View listing", "دیدن آگهی")}</button>
      {allowed.filter((status) => status !== "expired").map((status) => <button key={status} type="button" disabled={busy} onClick={() => { void commands.setStatus.run(async () => {
        const result = await platform.modules.market.setStatus(row.id, status, { expectedVersion: row.row_version ?? 0 });
        onDone(); return result;
      }, { successMessage: L("Listing status updated (versioned).", "وضعیت آگهی به‌روزرسانی شد (نسخه‌دار).") }); }}>{L(`Mark ${status}`, `علامت ${status}`)}</button>)}
      {(lifecycle.effectiveStatus === "expired" || lifecycle.effectiveStatus === "withdrawn") && (LISTING_LIFECYCLE[lifecycle.effectiveStatus] ?? []).includes("draft") ? <button type="button" disabled={busy} onClick={() => { void commands.renew.run(async () => {
        const result = await platform.modules.market.renew(row.id, { extend_days: 30 }, { expectedVersion: row.row_version ?? 0 });
        onDone(); return result;
      }, { successMessage: L("Listing reactivated with a bounded 30-day extension.", "آگهی با تمدید محدود ۳۰ روزه فعال شد.") }); }}>{L("Renew 30 days", "تمدید ۳۰ روز")}</button> : null}
    </div>
  </div>;
}

/** ONE inquiry row: the private conversation (participants only) with reply,
 * versioned inquiry status for the seller, and the buyer's own close action.
 * The other side is never told about blocks; an unknown write stays unknown. */
function HeritageInquiryRow({ platform, inquiry, locale, L, commands, onDone, seller }: {
  platform: PlatformClient; inquiry: Record<string, unknown>; locale: UiLocale; L: (en: string, fa: string) => string;
  commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void; seller: boolean;
}) {
  const id = String(inquiry.id ?? inquiry.inquiry_id ?? "");
  const status = String(inquiry.status ?? "new");
  const [open, setOpen] = useState(false);
  // A STABLE platform wrapper (the hook's effect keys on identity; an inline
  // object would abort its own in-flight load on every render).
  const conversationPlatform = useMemo(() => (platform ? { market: platform.modules.market } : null), [platform]);
  const closed = status === "closed";
  // R117-15: the buyer-side row names WHAT THEY INQUIRED ABOUT (listing title
  // or horse name), never the buyer's own name; the seller-side row keeps
  // naming the inquiring buyer. The sent row also reports the listing's
  // CURRENT status honestly — a sold/withdrawn/expired listing says so.
  const horseLabel = locale === "fa" && inquiry.name_native ? String(inquiry.name_native) : (inquiry.name_latin ? String(inquiry.name_latin) : "");
  const listingTitle = inquiry.listing_title ? String(inquiry.listing_title) : "";
  const displayName = seller ? String(inquiry.buyer_name ?? (listingTitle || horseLabel || id)) : (listingTitle || horseLabel || id);
  const listingStatus = inquiry.listing_status ? String(inquiry.listing_status) : null;
  const replyCount = Number(inquiry.reply_count ?? 0);
  return <li data-surface="market-inquiry-row">
    <div className="registry-row-clickable">
      <strong dir="auto">{displayName}</strong>
      <small>{INQUIRY_STATUS_LABEL[status]?.[locale === "fa" ? 1 : 0] ?? status}{seller && listingTitle ? ` · ${listingTitle}` : ""}{listingStatus ? ` · ${L("listing", "آگهی")} ${listingStatus}` : ""}{replyCount > 0 ? ` · ${replyCount} ${L("replies", "پاسخ")}` : ""}{inquiry.created_at ? ` · ${String(inquiry.created_at).slice(0, 10)}` : ""}</small>
    </div>
    <div className="table-actions">
      <button type="button" onClick={() => setOpen((v) => !v)}>{open ? L("Hide conversation", "پنهان‌کردن تبادل پیام") : L("Conversation", "تبادل پیام")}</button>
      {seller && !closed ? <button type="button" disabled={commands.setInquiryStatus.state.phase === "submitting"} onClick={() => { void commands.setInquiryStatus.run(async () => {
        const result = await platform.modules.market.setInquiryStatus(id, status === "new" ? "contacted" : "closed", { expectedVersion: Number(inquiry.row_version ?? 0) });
        onDone(); return result;
      }, { successMessage: L("Inquiry status updated (versioned).", "وضعیت درخواست به‌روزرسانی شد (نسخه‌دار).") }); }}>{status === "new" ? L("Mark contacted", "تماس‌گرفته‌شده") : L("Close inquiry", "بستن درخواست")}</button> : null}
      {!seller && !closed ? <button type="button" disabled={commands.closeOwnInquiry.state.phase === "submitting"} onClick={() => { void commands.closeOwnInquiry.run(async () => {
        const result = await platform.modules.market.closeOwnInquiry(id, { expectedVersion: Number(inquiry.row_version ?? 0) });
        onDone(); return result;
      }, { successMessage: L("Your inquiry is closed. No further replies are accepted.", "درخواست شما بسته شد. پاسخ دیگری پذیرفته نمی‌شود.") }); }}>{L("Close my inquiry", "بستن درخواست من")}</button> : null}
    </div>
    {open ? <HeritageConversationPanel key={`open:${id}`} platform={conversationPlatform} inquiryId={id} closed={closed} locale={locale} L={L} commands={commands} onDone={onDone} /> : null}
  </li>;
}

/** The conversation panel mounts FRESH each time it opens (the hook's
 * reload key is per-mount); the reply form rides the versioned command. */
function HeritageConversationPanel({ platform, inquiryId, closed, locale, L, commands, onDone }: {
  platform: { market: PlatformClient["modules"]["market"] } | null; inquiryId: string; closed: boolean; locale: UiLocale;
  L: (en: string, fa: string) => string; commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const { state: conversation } = useInquiryConversation(platform, inquiryId);
  const entries = conversation.phase === "ready" || conversation.phase === "sending" ? conversation.thread.entries : [];
  return <div className="h-mod-conversation" data-surface="market-conversation">
    {conversation.phase === "loading" ? <p role="status">{L("Loading the conversation…", "بارگذاری تبادل پیام…")}</p> : null}
    {conversation.phase === "forbidden" ? <p role="alert">{L("Only the participants can read this conversation.", "فقط طرف‌های درخواست می‌توانند این تبادل پیام را بخوانند.")}</p> : null}
    {conversation.phase === "not_found" ? <p role="alert">{L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.")}</p> : null}
    {conversation.phase === "error" ? <p role="alert">{L("The conversation could not be loaded.", "تبادل پیام بارگذاری نشد.")}</p> : null}
    {(conversation.phase === "ready" || conversation.phase === "sending") ? (entries.length ? <ul>{entries.map((entry) => <li key={entry.id}><strong>{entry.side}</strong> <small>{entry.createdAt}</small><p dir="auto">{entry.body}</p></li>)}</ul> : <p>{L("No messages yet.", "هنوز پیامی نیست.")}</p>) : null}
    {!closed ? <form onSubmit={(event) => { event.preventDefault(); if (replyBody.trim().length < 1) return; void commands.reply.run(async () => {
      const result = await platform?.market.reply(inquiryId, { body: replyBody.trim() });
      setReplyBody(""); onDone(); return result;
    }, { successMessage: L("Reply sent to the conversation.", "پاسخ در تبادل پیام ارسال شد.") }); }}>
      <label>{L("Reply", "پاسخ")}<input required maxLength={4000} dir="auto" value={replyBody} disabled={commands.reply.state.phase === "submitting"} onChange={(event) => setReplyBody(event.target.value)} /></label>
      <button type="submit" disabled={commands.reply.state.phase === "submitting" || replyBody.trim().length < 1}>{L("Send reply", "ارسال پاسخ")}</button>
    </form> : <p className="h-mod-state-note">{L("This inquiry is closed — the conversation is read-only history.", "این درخواست بسته است — تبادل پیام فقط تاریخچه خواندنی است.")}</p>}
    {commands.reply.state.phase === "rejected" || commands.reply.state.phase === "failed" ? <p role="alert">{commands.reply.state.message}</p> : null}
    {commands.setInquiryStatus.state.phase === "rejected" || commands.closeOwnInquiry.state.phase === "rejected" ? <p role="alert">{L("The inquiry changed elsewhere — reload its current version and retry.", "درخواست جای دیگر تغییر کرده — نسخه فعلی را بازخوانی و دوباره تلاش کنید.")}</p> : null}
  </div>;
}

function HeritageListingDetail({ listing, detail, navigate, platform, user, onClose, onConflict, locale, L, n }: {
  listing: MarketListingRecord;
  detail: Awaited<ReturnType<PlatformClient["modules"]["market"]["detail"]>>;
  navigate: (path: string) => void;
  platform: PlatformClient;
  user: PlatformUser | null;
  onClose: () => void;
  /** R88 P03: bump when a conflict means the listing changed server-side; the parent reloads a fresh version. */
  onConflict: () => void;
  locale: UiLocale;
  L: (en: string, fa: string) => string;
  n: (v: number) => string;
}) {
  const [buyerName, setBuyerName] = useState("");
  const [buyerContact, setBuyerContact] = useState("");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  // R88 P03: mutation controls stay disabled after a conflict until a fresh
  // version of the listing has loaded (detail prop changes -> stale clears).
  const [stale, setStale] = useState(false);
  const [sending, setSending] = useState(false);
  // R98-N12: the ONE shared lifecycle view (headless marketplace controller).
  const lifecycle = listingLifecycleView({
    listing: {
      status: listing.status,
      expires_at: listing.expires_at,
      suspended: (listing as { suspended?: boolean }).suspended,
      seller_mandate_current: (listing as { seller_mandate_current?: boolean | null }).seller_mandate_current,
      watched: (listing as { watched?: boolean }).watched,
    },
    viewerRole: user && (listing as { seller_user_id?: string | null }).seller_user_id === user.id ? "seller" : "buyer",
  });
  const [watched, setWatched] = useState(Boolean((listing as { watched?: boolean }).watched));
  const [watchBusy, setWatchBusy] = useState(false);
  useEffect(() => { setWatched(Boolean((listing as { watched?: boolean }).watched)); }, [listing]);
  const toggleWatch = async () => {
    if (!user || watchBusy) return;
    setWatchBusy(true);
    try {
      if (watched) { await platform.modules.market.unwatch(listing.id); setWatched(false); }
      else { await platform.modules.market.watch(listing.id); setWatched(true); }
    } catch { /* keep the honest prior state; the next reload re-reads */ }
    finally { setWatchBusy(false); }
  };
  // One idempotency key per filled form intent: double submits and retries of
  // the same intent claim one server-side receipt instead of two inquiries.
  const idemKey = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `inq-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // R114-07: the buyer-side lifecycle commands (reply / close-own-inquiry) —
  // hoisted unconditionally so the hooks order never depends on `sent`.
  const buyerCommands = useMarketplaceLifecycleCommands(usePrincipalScope(user, null));
  useEffect(() => { if (detail) setStale(false); }, [detail]);
  const [myInquiryId, setMyInquiryId] = useState<string | null>(null);
  const submit = async () => {
    setError("");
    setSending(true);
    try {
      const result = await platform.modules.market.inquire(listing.id, { buyer_name: buyerName, buyer_contact: buyerContact, message: inquiryMessage || null }, { idempotencyKey: idemKey.current });
      // R114-07: keep the buyer's OWN inquiry id from the receipt — the
      // conversation, reply and close-own-inquiry all hang off it. There is
      // no buyer-side inbox endpoint yet (an honest API gap recorded in the
      // backlog), so the id travels with this listing view.
      setMyInquiryId(result.inquiry?.id ?? null);
      setSent(true);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError((e as Error).message);
      if (code === "listing_unavailable" || code === "listing_version_conflict" || code === "idempotency_conflict") {
        setStale(true);
        onConflict();
      }
    } finally {
      setSending(false);
    }
  };
  // R98-N12: honest lifecycle + disclosure rendering, shared semantics with
  // every other frontend (the controller is the ONE authority; the page only
  // translates it into Heritage's visual language).
  const statusBadge = lifecycleBadge(lifecycle, L);
  return <div className="h-mod-listing-overlay" role="dialog" aria-modal="true">
    <div className="h-mod-listing-sheet" data-h-surface-role="major">
      <header className="h-mod-sheet-head">
        <div>
          <span className="h-mod-kicker">{L("FOR SALE — BUYER RESEARCH VIEW", "در حال فروش — نمای تحقیق خریدار")}</span>
          <h2 dir="auto">{locale === "fa" && listing.name_native ? listing.name_native : listing.name_latin} <small>#{n(listing.horse_id)}</small></h2>
          {statusBadge && <p className="h-mod-status-badge" role="status">{statusBadge}</p>}
          <div className="h-mod-listing-meta" dir="auto">
            <span>{listing.breed_desc ?? "—"}</span>
            <span>{horseSexLabel(listing.sex_desc,locale,"—")}</span>
            <span>{listing.birth_year ? localizedDigits(listing.birth_year, locale) : "—"}</span>
            <span>{listing.color_desc ?? "—"}</span>
            <span>{listing.main_strain_desc ?? ""}</span>
          </div>
        </div>
        <button className="h-mod-close" onClick={onClose} aria-label={L("Close", "بستن")}>×</button>
      </header>
      <div className="h-mod-sheet-grid">
        <section className="h-mod-sheet-block">
          <h3>{L("Price & seller", "قیمت و فروشنده")}</h3>
          <dl className="h-mod-sheet-list">
            <div><dt>{L("Asking price", "قیمت")}</dt><dd>{Number(listing.price_visible) === 1 ? priceLabel(listing.asking_price_toman, locale, L) : L("on request", "تماس")}{Number(listing.negotiable) === 1 ? ` · ${L("negotiable", "قابل مذاکره")}` : ""}</dd></div>
            <div><dt>{L("City", "شهر")}</dt><dd dir="auto">{listing.seller_city ?? "—"}</dd></div>
            <div><dt>{L("Seller", "فروشنده")}</dt><dd dir="auto">{listing.seller_contact_name}</dd></div>
            <div><dt>{L("Listed", "تاریخ آگهی")}</dt><dd>{localizedDigits(String(listing.listed_at).slice(0, 10), locale)}</dd></div>
          </dl>
        </section>
        <section className="h-mod-sheet-block">
          <h3>{L("Pedigree", "تبارنامه")}</h3>
          <div className="h-mod-sheet-parents">
            <button disabled={!detail.pedigree.sire} onClick={() => detail.pedigree.sire && navigate(`/horse/${detail.pedigree.sire.id}`)}><small>{L("Sire", "پدر")}</small><b dir="auto">{detail.pedigree.sire?.name_latin ?? "—"}</b></button>
            <button disabled={!detail.pedigree.dam} onClick={() => detail.pedigree.dam && navigate(`/horse/${detail.pedigree.dam.id}`)}><small>{L("Dam", "مادر")}</small><b dir="auto">{detail.pedigree.dam?.name_latin ?? "—"}</b></button>
          </div>
          <a className="h-mod-action ghost" href={`#/horse/${listing.horse_id}`} onClick={(e) => { e.preventDefault(); navigate(`/horse/${listing.horse_id}`); }}>{L("Open full profile →", "پروفایل کامل →")}</a>
        </section>
        <section className="h-mod-sheet-block">
          <h3>{L("Competition highlights", "برترین‌های مسابقات")}</h3>
          {detail.competitions.length === 0 ? <p className="h-mod-empty">{L("No competition record.", "سابقه مسابقه‌ای نیست.")}</p> : <ul className="h-mod-sheet-comps">{detail.competitions.map((row, i) => <li key={i} dir="auto">
            <b>{String((row as Record<string, unknown>).competition_name ?? "")}</b>
            <small>{String((row as Record<string, unknown>).event_date ?? "")} · {String((row as Record<string, unknown>).placement_text ?? (row as Record<string, unknown>).placement ?? "—")}</small>
          </li>)}</ul>}
        </section>
        <section className="h-mod-sheet-block">
          <h3>{L("Verified documents", "مدارک تأییدشده")}</h3>
          {detail.media.length === 0 ? <p className="h-mod-empty">{L("No documents shared yet.", "هنوز مدرکی به اشتراک گذاشته نشده.")}</p> : <ul className="h-mod-docs">{detail.media.map((row, i) => <li key={i}><a className="h-mod-doc-link" href={platform.modules.media.fileUrl(String((row as Record<string, unknown>).id))} target="_blank" rel="noreferrer"><span className="h-mod-doc-glyph"><DocIcon size={16}/></span><b dir="auto">{String((row as Record<string, unknown>).file_name ?? "")}</b></a></li>)}</ul>}
          {detail.genetics.length > 0 && <p className="h-mod-sheet-genetics" dir="auto">{detail.genetics.map((row) => `${String((row as Record<string, unknown>).test_type)}: ${String((row as Record<string, unknown>).result)}`).join(" · ")}</p>}
        </section>
      </div>
      <section className="h-mod-sheet-inquiry">
        <h3>{L("Contact the seller", "تماس با فروشنده")}</h3>
        {/* R98-N12: the disclosure travels with every inquiry surface — the
            platform introduces buyers to sellers; it never guarantees the
            horse or the transaction. */}
        <p className="h-mod-disclosure" dir="auto">{locale === "fa" ? MARKETPLACE_DISCLOSURE.fa : MARKETPLACE_DISCLOSURE.en}</p>
        {user && <button className="h-mod-action ghost" disabled={watchBusy || lifecycle.sellerMandateCurrent === false} onClick={() => void toggleWatch()}>{watched ? L("★ Saved — remove from watchlist", "★ ذخیره شد — حذف از فهرست پیگیری") : L("☆ Save to watchlist", "☆ افزودن به فهرست پیگیری")}</button>}
        {lifecycle.sellerMandateCurrent === false
          ? <p className="h-mod-message" role="status">{L("The seller's authority to sell this horse is no longer current; new inquiries are closed.", "اعتبار فروشنده برای فروش این اسب دیگر برقرار نیست؛ درخواست جدید بسته است.")}</p>
          : sent ? <div>
            <p className="h-mod-message ok">{L("Your inquiry was sent to the seller.", "درخواست شما برای فروشنده ارسال شد.")}</p>
            {/* R114-07: the buyer's OWN conversation on this inquiry — reply
                and close-own hang off the id the inquire receipt returned. */}
            {myInquiryId ? <HeritageInquiryRow platform={platform} inquiry={{ id: myInquiryId, status: "new", buyer_name: buyerName }} locale={locale} L={L} commands={buyerCommands} onDone={() => {}} seller={false} /> : null}
          </div> : <div className="h-mod-inquiry-form">
          <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder={L("Your name", "نام شما")} dir="auto" disabled={stale}/>
          <input value={buyerContact} onChange={(e) => setBuyerContact(e.target.value)} placeholder={L("Phone or email", "تلفن یا ایمیل")} dir="auto" disabled={stale}/>
          <textarea value={inquiryMessage} onChange={(e) => setInquiryMessage(e.target.value)} placeholder={L("Message (optional)", "پیام (اختیاری)")} rows={2} dir="auto" disabled={stale}/>
          <button className="h-mod-action" disabled={stale || sending || !buyerName.trim() || !buyerContact.trim() || lifecycle.suspended} onClick={() => void submit()}>{stale ? L("Reloading listing…", "بارگذاری مجدد آگهی…") : L("Send inquiry", "ارسال درخواست")}</button>
          {error && <p className="h-mod-message" dir="auto">{error}{stale ? ` — ${L("loading the current version…", "در حال بارگذاری نسخه فعلی…")}` : ""}</p>}
        </div>}
        {!user && <p className="h-mod-note">{L("You can also register an account to track your inquiries.", "می‌توانید حساب کاربری بسازید و درخواست‌های خود را پیگیری کنید.")}</p>}
      </section>
    </div>
  </div>;
}

/** R98-N12: Heritage's honest status badge, built ONLY from the shared
 * lifecycle view — expired/suspended/mandate states never masquerade as a
 * live listing, and every state is explained rather than implied. */
function lifecycleBadge(lifecycle: ListingLifecycleView, L: (en: string, fa: string) => string): string | null {
  if (lifecycle.suspended) return L("Listing suspended by moderation — the horse's registry profile is unaffected.", "آگهی توسط مدیریت معلق شده است — پروفایل ثبت اسب دست‌نخورده است.");
  // R108-06: a malformed expiry date is not proof of expiry, but the reader
  // gets an explicit explanation (not just a silently disabled action).
  if (lifecycle.expiryStatus === "invalid") return L("This listing's expiry date is invalid; actions are disabled until the seller corrects it.", "تاریخ انقضای این آگهی نامعتبر است؛ تا اصلاح آن توسط فروشنده امکان اقدام وجود ندارد.");
  if (lifecycle.effectiveStatus === "expired") return L("This listing has expired and no longer accepts new inquiries.", "این آگهی منقضی شده و درخواست جدید نمی‌پذیرد.");
  if (lifecycle.effectiveStatus === "sold") return L("This horse has been reported sold.", "این اسب فروخته‌شده گزارش شده است.");
  if (lifecycle.effectiveStatus === "withdrawn") return L("The seller has withdrawn this listing.", "فروشنده این آگهی را برداشته است.");
  if (lifecycle.sellerMandateCurrent === false) return L("The seller's mandate is no longer current — new inquiries are closed.", "اعتبار فروشنده برقرار نیست — درخواست جدید بسته است.");
  return null;
}
