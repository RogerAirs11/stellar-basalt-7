import React, { useMemo, useState } from "react";
import {
  usePrincipalScope,
  useMyMarketplace,
  useSentInquiries,
  useWatchlist,
  useMarketplaceLifecycleCommands,
  useInquiryConversation,
  LISTING_LIFECYCLE,
  listingLifecycleView,
  type PlatformClient,
  type PlatformUser, kitText } from "../../../frontend-kit";

/**
 * R117-15 (Master AI R117 handoff D19) — Classic Registry's compact NATIVE
 * market desk (host layer, iframe boundary intact) over the ONE shared
 * headless marketplace controller: the seller's own listings + received
 * inquiry inbox with versioned status control, the buyer's OWN sent inquiries
 * (a separate bounded buyer-scoped query — never the seller's inbox), and the
 * buyer's watchlist. The marketplace is an introduction surface; no payment,
 * delivery or ownership transfer happens here. Each sent row reports the
 * listing's CURRENT status honestly (sold/withdrawn/expired say so) while its
 * conversation history stays reachable for both participants.
 */

const panel: React.CSSProperties = { border: "1px solid #92400e", background: "#fffbeb", padding: "12px", margin: "10px 0", borderRadius: "4px" };
const label: React.CSSProperties = { display: "block", margin: "8px 0", fontSize: "14px" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: "6px", marginTop: "4px", border: "1px solid #92400e", borderRadius: "3px", boxSizing: "border-box" };
const button: React.CSSProperties = { padding: "8px 14px", background: "#92400e", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer", marginTop: "8px" };
const buttonGhost: React.CSSProperties = { ...button, background: "#fff", color: "#92400e", border: "1px solid #92400e" };
const alertBox: React.CSSProperties = { ...panel, borderColor: "#b91c1c", background: "#fef2f2" };
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #fde68a", flexWrap: "wrap" };

const INQUIRY_STATUS_LABEL: Record<string, [string, string]> = {
  new: ["new", "جدید"],
  contacted: ["contacted", "تماس‌گرفته‌شده"],
  closed: ["closed", "بسته"],
};

export function ClassicRegistryMarketDesk({ platform, user, locale = "en" }: { platform: PlatformClient | null; user?: PlatformUser | null; locale?: "en" | "fa" | "ar" }) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const scope = usePrincipalScope(user ?? null, null);
  const { mine, retry } = useMyMarketplace({ platform, scope, userId: user?.id });
  const { sent, retry: retrySent } = useSentInquiries({ platform, scope, userId: user?.id });
  const { watchlist, retry: retryWatchlist } = useWatchlist({ platform, scope, userId: user?.id });
  const commands = useMarketplaceLifecycleCommands(scope);
  if (!platform || !user) {
    return <div style={panel} data-surface="market-lifecycle">
      <p>{L("Sign in to see your listings, received inquiries, sent inquiries and watchlist.", "برای دیدن آگهی‌ها، درخواست‌های دریافتی، درخواست‌های ارسالی و فهرست پیگیری خود وارد شوید.")}</p>
    </div>;
  }
  return <div data-surface="market-lifecycle">
    <p style={panel}>{L("The marketplace is an introduction surface — no payment, delivery or ownership transfer happens here. Status changes are versioned; a changed row is reloaded before your edit can land.", "بازار فقط سطح آشنایی است — هیچ پرداخت، تحویل یا انتقال مالکیتی اینجا انجام نمی‌شود. تغییر وضعیت نسخه‌دار است؛ ردیف تغییرکرده پیش از اعمال ویرایش شما بازخوانی می‌شود.")}</p>

    <section style={panel} data-surface="market-seller">
      <h2>{L("My listings", "آگهی‌های من")}</h2>
      {mine.phase === "loading" ? <p role="status">{L("Loading your listings…", "بارگذاری آگهی‌های شما…")}</p> : null}
      {mine.phase === "forbidden" || mine.phase === "unavailable" || mine.phase === "error" ? <div style={alertBox} role="alert"><p>{L("Your listing list is unavailable.", "فهرست آگهی شما در دسترس نیست.")}</p><p dir="auto">{mine.reason}</p><button style={buttonGhost} onClick={retry}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
      {mine.phase === "empty" ? <p>{L("You have no listings and no received inquiries yet.", "هنوز آگهی یا درخواستی ندارید.")}</p> : null}
      {(mine.phase === "ready" || mine.phase === "reloading") && mine.listings.length ? <div data-surface="market-seller-listings">{mine.listings.map((row) => {
        const lifecycle = listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at ?? null, seller_mandate_current: null }, viewerRole: "seller" });
        const allowed = (LISTING_LIFECYCLE[lifecycle.effectiveStatus] ?? []).filter((status: string) => status !== "expired");
        return <div key={row.id} style={rowStyle} data-surface="market-seller-listing">
          <span><strong dir="auto">{locale !== "en" && row.name_native ? row.name_native : row.name_latin}</strong>
            <small> #{row.horse_id} · {lifecycle.effectiveStatus} · v{row.row_version ?? 0}</small></span>
          <span>{allowed.map((status: string) => <button key={status} style={buttonGhost} disabled={commands.setStatus.state.phase === "submitting"} onClick={() => { void commands.setStatus.run(async () => {
            const result = await platform.modules.market.setStatus(row.id, status, { expectedVersion: row.row_version ?? 0 });
            retry(); return result;
          }, { successMessage: L("Listing status updated (versioned).", "وضعیت آگهی به‌روزرسانی شد (نسخه‌دار).") }); }}>{L(`Mark ${status}`, `علامت ${status}`)}</button>)}</span>
        </div>;
      })}</div> : null}
      {commands.setStatus.state.phase === "rejected" || commands.renew.state.phase === "rejected" ? <div style={alertBox} role="alert">{L("The listing changed elsewhere — the current version was reloaded; retry with the fresh version.", "آگهی جای دیگر تغییر کرده — نسخه فعلی بازخوانی شد؛ با نسخه تازه دوباره تلاش کنید.")}</div> : null}
    </section>

    {(mine.phase === "ready" || mine.phase === "reloading") && mine.inquiries.length ? <section style={panel} data-surface="market-inquiry-inbox">
      <h2>{L("Inquiries received on your listings", "درخواست‌های دریافتی روی آگهی‌های شما")}</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{mine.inquiries.map((inquiry) => <ClassicMarketInquiryRow key={String(inquiry.id)} platform={platform} inquiry={inquiry} locale={locale} commands={commands} onDone={retry} seller />)}</ul>
    </section> : null}

    <section style={panel} data-surface="market-sent-inquiries">
      <h2>{L("My sent inquiries", "درخواست‌های ارسالی من")}</h2>
      <p>{L("Exactly the inquiries you sent — never a seller's inbox. Each listing's current status is reported honestly.", "دقیقاً درخواست‌هایی که شما ارسال کرده‌اید — نه صندوق فروشنده. وضعیت فعلی هر آگهی صادقانه گزارش می‌شود.")}</p>
      {sent.phase === "loading" ? <p role="status">{L("Loading your sent inquiries…", "بارگذاری درخواست‌های ارسالی شما…")}</p> : null}
      {sent.phase === "forbidden" || sent.phase === "unavailable" || sent.phase === "error" ? <div style={alertBox} role="alert"><p>{L("Your sent-inquiry list is unavailable.", "فهرست درخواست‌های ارسالی شما در دسترس نیست.")}</p><p dir="auto">{sent.reason}</p><button style={buttonGhost} onClick={retrySent}>{L("Try loading again", "تلاش دوباره")}</button></div> : null}
      {sent.phase === "empty" ? <p>{L("You have not sent any inquiries yet — open a listing and ask the seller a question.", "هنوز درخواستی ارسال نکرده‌اید — یک آگهی را باز کنید و از فروشنده سؤال بپرسید.")}</p> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length ? <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{(sent.rows as unknown as Array<Record<string, unknown>>).map((row) => <ClassicMarketInquiryRow key={String(row.id)} platform={platform} inquiry={row} locale={locale} commands={commands} onDone={retrySent} seller={false} />)}</ul> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length < sent.pagination.total ? <p>{L(`Showing the newest ${sent.rows.length} of ${sent.pagination.total} sent inquiries.`, `نمایش ${sent.rows.length} درخواست آخر از ${sent.pagination.total} درخواست ارسالی.`)}</p> : null}
    </section>

    <section style={panel} data-surface="market-watchlist">
      <h2>{L("My watchlist", "فهرست پیگیری من")}</h2>
      {watchlist.phase === "loading" ? <p role="status">{L("Loading your watchlist…", "بارگذاری فهرست پیگیری شما…")}</p> : null}
      {watchlist.phase === "empty" ? <p>{L("No saved listings yet — watch a listing to keep it here.", "هنوز آگهی ذخیره‌شده‌ای نیست — آگهی‌ای را دنبال کنید تا اینجا بماند.")}</p> : null}
      {(watchlist.phase === "ready" || watchlist.phase === "reloading") && watchlist.rows.length ? <div>{watchlist.rows.map((row) => <div key={String(row.listing_id ?? row.id)} style={rowStyle} data-surface="market-watchlist-row">
        <span><strong dir="auto">{locale !== "en" && row.name_native ? String(row.name_native) : String(row.name_latin ?? row.title ?? `#${row.listing_id ?? row.id}`)}</strong>
          <small> · {L("listing", "آگهی")} {String(row.status ?? "—")}</small></span>
        <span><button style={buttonGhost} disabled={commands.watch.state.phase === "submitting"} onClick={() => { void commands.watch.run(async () => {
          const result = await platform.modules.market.unwatch(String(row.listing_id ?? row.id));
          retryWatchlist(); return result;
        }, { successMessage: L("Removed from your watchlist.", "از فهرست پیگیری شما حذف شد.") }); }}>{L("Unwatch", "حذف پیگیری")}</button></span>
      </div>)}</div> : null}
    </section>
  </div>;
}

/** ONE inquiry row (seller inbox or buyer sent) in Classic's compact desk: the
 * participant-only conversation with reply, the versioned inquiry status for
 * the seller, and the buyer's own close action. */
function ClassicMarketInquiryRow({ platform, inquiry, locale, commands, onDone, seller }: {
  platform: PlatformClient; inquiry: Record<string, unknown>; locale: "en" | "fa" | "ar"; commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void; seller: boolean;
}) {
  const L = (en: string, faText: string) => kitText(locale, en, faText);
  const [open, setOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const conversationPlatform = useMemo(() => ({ market: platform.modules.market }), [platform]);
  const { state: conversation } = useInquiryConversation(conversationPlatform, String(inquiry.id ?? ""));
  const id = String(inquiry.id ?? "");
  const status = String(inquiry.status ?? "new");
  const closed = status === "closed";
  const listingTitle = inquiry.listing_title ? String(inquiry.listing_title) : "";
  const horseLabel = locale !== "en" && inquiry.name_native ? String(inquiry.name_native) : (inquiry.name_latin ? String(inquiry.name_latin) : "");
  const listingStatus = inquiry.listing_status ? String(inquiry.listing_status) : null;
  const replyCount = Number(inquiry.reply_count ?? 0);
  return <li style={{ borderTop: "1px solid #fde68a", padding: "8px 0" }} data-surface="market-inquiry-row">
    <div style={rowStyle}>
      <span><strong dir="auto">{seller ? String(inquiry.buyer_name ?? (listingTitle || horseLabel || id)) : (listingTitle || horseLabel || id)}</strong>
        <small> · {INQUIRY_STATUS_LABEL[status] ? L(...INQUIRY_STATUS_LABEL[status]!) : status}{listingStatus ? ` · ${L("listing", "آگهی")} ${listingStatus}` : ""}{replyCount > 0 ? ` · ${replyCount} ${L("replies", "پاسخ")}` : ""}{inquiry.created_at ? ` · ${String(inquiry.created_at).slice(0, 10)}` : ""}</small></span>
      <span>
        <button style={buttonGhost} onClick={() => setOpen((value) => !value)}>{open ? L("Hide conversation", "پنهان‌کردن تبادل پیام") : L("Conversation", "تبادل پیام")}</button>
        {seller && !closed ? <button style={buttonGhost} disabled={commands.setInquiryStatus.state.phase === "submitting"} onClick={() => { void commands.setInquiryStatus.run(async () => {
          const result = await platform.modules.market.setInquiryStatus(id, status === "new" ? "contacted" : "closed", { expectedVersion: Number(inquiry.row_version ?? 0) });
          onDone(); return result;
        }, { successMessage: L("Inquiry status updated (versioned).", "وضعیت درخواست به‌روزرسانی شد (نسخه‌دار).") }); }}>{status === "new" ? L("Mark contacted", "تماس‌گرفته‌شده") : L("Close inquiry", "بستن درخواست")}</button> : null}
        {!seller && !closed ? <button style={buttonGhost} disabled={commands.closeOwnInquiry.state.phase === "submitting"} onClick={() => { void commands.closeOwnInquiry.run(async () => {
          const result = await platform.modules.market.closeOwnInquiry(id, { expectedVersion: Number(inquiry.row_version ?? 0) });
          onDone(); return result;
        }, { successMessage: L("Your inquiry is closed. No further replies are accepted.", "درخواست شما بسته شد. پاسخ دیگری پذیرفته نمی‌شود.") }); }}>{L("Close my inquiry", "بستن درخواست من")}</button> : null}
      </span>
    </div>
    {open ? <div style={{ marginTop: "8px" }} data-surface="market-conversation">
      {conversation.phase === "loading" ? <p role="status">{L("Loading the conversation…", "بارگذاری تبادل پیام…")}</p> : null}
      {conversation.phase === "forbidden" ? <p role="alert">{L("Only the participants can read this conversation.", "فقط طرف‌های درخواست می‌توانند این تبادل پیام را بخوانند.")}</p> : null}
      {conversation.phase === "not_found" ? <p role="alert">{L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.")}</p> : null}
      {conversation.phase === "error" ? <p role="alert">{conversation.error.kind === "not_found" ? L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.") : conversation.error.message}</p> : null}
      {(conversation.phase === "ready" || conversation.phase === "sending") ? (conversation.thread.entries.length ? <ul style={{ paddingLeft: "16px" }}>{conversation.thread.entries.map((entry) => <li key={entry.id}><strong>{entry.side}</strong> <small>{entry.createdAt}</small><p dir="auto">{entry.body}</p></li>)}</ul> : <p>{L("No messages yet.", "هنوز پیامی نیست.")}</p>) : null}
      {!closed ? <div>
        <label style={label}>{L("Reply", "پاسخ")}<input style={input} dir="auto" maxLength={4000} value={replyBody} disabled={commands.reply.state.phase === "submitting"} onChange={(event) => setReplyBody(event.target.value)} /></label>
        <button style={button} disabled={commands.reply.state.phase === "submitting" || replyBody.trim().length < 1} onClick={() => { void commands.reply.run(async () => {
          const result = await platform.modules.market.reply(id, { body: replyBody.trim() });
          setReplyBody(""); onDone(); return result;
        }, { successMessage: L("Reply sent to the conversation.", "پاسخ در تبادل پیام ارسال شد.") }); }}>{L("Send reply", "ارسال پاسخ")}</button>
      </div> : <p>{L("This inquiry is closed — the conversation is read-only history.", "این درخواست بسته است — تبادل پیام فقط تاریخچه خواندنی است.")}</p>}
      {commands.setInquiryStatus.state.phase === "rejected" || commands.closeOwnInquiry.state.phase === "rejected" ? <p role="alert">{L("The inquiry changed elsewhere — reload its current version and retry.", "درخواست جای دیگر تغییر کرده — نسخه فعلی را بازخوانی و دوباره تلاش کنید.")}</p> : null}
    </div> : null}
  </li>;
}
