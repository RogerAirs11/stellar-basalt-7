import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  loadHorseRecordDetails,
  HorseMediaPanel,
  usePrincipalScope,
  useScopedState,
  type HorseRecordDetails,
  type RecordSection,
  type CompetitionResultRecord,
  horseDbRoutes,
} from "../../../frontend-kit";
import type { EquiDataRuntime } from "./adapter";
import { EmptyPanel, ErrorPanel, Icon, Panel, SectionTitle } from "./components";
import { edxText } from "./i18n";
import { horseName, num } from "./format";
import type { GoLocal } from "./pages";
import { GeneticWorkbench } from "../../../frontend-kit";
import { AccountSecuritySessionNotice } from "../../../frontend-kit";
// R98-N12: the ONE shared marketplace lifecycle semantics (headless controller).
import { listingLifecycleView, LISTING_LIFECYCLE, MARKETPLACE_DISCLOSURE, useMyMarketplace, useSentInquiries, useWatchlist, useMarketplaceLifecycleCommands, useInquiryConversation, useHorseCredentialStories, useAttestationVerification, useIssuerDirectory, useCredentialStoryCommands, runSnapshotReview, type CredentialStoryRow } from "../../../frontend-kit";

/**
 * F05 (R75): EquiData Elite's native record modules. The horse profile gains a
 * RECORDS tab backed by the canonical module endpoints (the same typed loader
 * the other frontends use), rendered in EquiData's own design language —
 * shared data loading, not shared theme CSS. Every section states its own
 * failure honestly; a failed request is never shown as an empty record.
 */
export function EquiDataRecordModules({ view, horseId, goLocal }: { view: EquiDataRuntime; horseId: number; goLocal: GoLocal }) {
  return <><HorseMediaPanel horseId={horseId} platform={view.platform} user={view.user} permissions={view.permissions} locale={view.locale} appearance="equidata"/><EquiDataRecordModulesDetails view={view} horseId={horseId} goLocal={goLocal}/><EquiDataCredentialStories view={view} horseId={horseId}/></>;
}

export function EquiDataRecordModulesDetails({ view, horseId, goLocal, sectionOnly }: { view: EquiDataRuntime; horseId: number; goLocal: GoLocal; sectionOnly?: "genetics" | "competitions" }) {
  const scope = usePrincipalScope(view.user, view.permissions);
  const [revision, setRevision] = useState(0);
  return <><AccountSecuritySessionNotice platform={view.platform} locale={view.locale}/><EquiDataRecordModulesRead key={`${scope}:${horseId}:${revision}`} view={view} horseId={horseId} goLocal={goLocal} sectionOnly={sectionOnly}/>{view.user && sectionOnly !== "competitions" && <GeneticWorkbench platform={view.platform} horseId={horseId} locale={view.locale} scope={scope} onChanged={() => setRevision(value => value + 1)}/>}</>;
}

function EquiDataRecordModulesRead({ view, horseId, goLocal, sectionOnly }: { view: EquiDataRuntime; horseId: number; goLocal: GoLocal; sectionOnly?: "genetics" | "competitions" }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const principal = usePrincipalScope(view.user, view.permissions);
  const scope = `${principal}|horse:${horseId}`;
  const [state, setState] = useScopedState<HorseRecordDetails | null>(scope, null);
  const [fatal, setFatal] = useScopedState(scope, "");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setFatal("");
    loadHorseRecordDetails(view.platform, horseId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(error => { if (!controller.signal.aborted) setFatal(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [view.platform, horseId, attempt, scope]);
  const retry = () => setAttempt(value => value + 1);
  const provenance = (value: string) => ({
    demo: L("Demonstration data", "داده نمایشی"),
    user: L("User supplied", "ثبت کاربر"),
    federation: L("Source marked: federation", "منبع ثبت‌شده: فدراسیون"),
    derived: L("Derived record", "رکورد استخراج‌شده"),
  } as Record<string, string>)[value] ?? L("Source not specified", "منبع نامشخص");
  const placement = (row: CompetitionResultRecord) => Number(row.is_eliminated) === 1
    ? L("Eliminated", "حذف") : Number(row.is_withdrawn) === 1
      ? L("Withdrawn", "انصراف") : row.placement != null ? num(row.placement, view.locale) : row.placement_text || "—";
  const section = <T,>(value: RecordSection<T>, render: (data: T) => ReactNode) => value.error !== null
    ? <div role="alert" className="edx-record-error"><p>{L("This section could not be loaded. An error is not evidence that no records exist.", "بارگذاری این بخش ناموفق بود. خطا به معنی نبودِ رکورد نیست.")}</p><p dir="auto">{value.error}</p><button className="edx-button secondary" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div>
    : render(value.data);
  if (fatal) return <Panel><ErrorPanel error={fatal} /></Panel>;
  if (!state || state.horseId !== horseId) return <Panel><p role="status" className="edx-muted">{L("Loading record modules…", "در حال بارگذاری ماژول‌های رکورد…")}</p></Panel>;
  return <>
    {sectionOnly !== "genetics" && <Panel>
      <SectionTitle eyebrow={L("RECORD MODULES", "ماژول‌های رکورد")} title={L("Competition record", "سوابق مسابقات")} copy={L("Federation-recorded starts and placements for this horse. Provenance is shown for every row.", "شروعها و مقام‌های ثبت‌شده فدراسیون برای این اسب. منبع هر ردیف نمایش داده می‌شود.")} />
      {section(state.competitions, data => data.results.length
        ? <div className="edx-record-table-wrap"><table className="edx-record-table"><thead><tr><th>{L("Date", "تاریخ")}</th><th>{L("Competition", "مسابقه")}</th><th>{L("Class", "رده")}</th><th>{L("Rider", "سوارکار")}</th><th>{L("Result", "نتیجه")}</th><th>{L("Source", "منبع")}</th></tr></thead><tbody>{data.results.map(row => <tr key={row.id}>
          <td dir="auto">{row.event_date || "—"}</td>
          <td dir="auto">{row.competition_name || "—"}</td>
          <td dir="auto">{row.class_name ?? "—"}</td>
          <td dir="auto">{row.rider_name ?? "—"}</td>
          <td><strong>{placement(row)}</strong></td>
          <td>{provenance(row.provenance)}</td>
        </tr>)}</tbody></table></div>
        : <EmptyPanel title={L("No competition record", "بدون سابقه مسابقه")} copy={L("No published competition results were returned for this horse.", "نتیجه مسابقه منتشرشده‌ای برای این اسب ثبت نشده است.")} />)}
    </Panel>}
    {sectionOnly !== "competitions" && <div className={sectionOnly === "genetics" ? undefined : "edx-record-grid"}>
      <Panel>
        <SectionTitle eyebrow={L("LAB RECORDS", "رکوردهای آزمایشگاه")} title={L("Recorded genetic tests", "آزمون‌های ژنتیکی ثبت‌شده")} />
        {section(state.genetics, data => data.tests.length
          ? <div className="edx-record-table-wrap"><table className="edx-record-table"><thead><tr><th>{L("Test", "آزمون")}</th><th>{L("Reported result", "نتیجه ثبت‌شده")}</th><th>{L("Source", "منبع")}</th></tr></thead><tbody>{data.tests.map(row => <tr key={row.id}>
            <td dir="auto">{row.test_type}</td>
            <td dir="auto"><strong>{row.result}</strong>{row.verified === 1 && <small> · {L("platform-reviewed", "بررسی کارشناسان سامانه")}</small>}</td>
            <td>{provenance(row.provenance)}</td>
          </tr>)}</tbody></table></div>
          : <EmptyPanel title={L("No genetic tests", "بدون آزمون ژنتیکی")} copy={L("No genetic test is recorded for this horse yet.", "هنوز آزمون ژنتیکی برای این اسب ثبت نشده است.")} />)}
        <p className="edx-record-note">{L("Reported laboratory data, not a diagnosis and not a genomic score.", "داده آزمایشگاهی ثبت‌شده؛ نه تشخیص و نه امتیاز ژنومی.")}</p>
      </Panel>
      {!sectionOnly && <Panel>
        <SectionTitle eyebrow={L("REPRODUCTION", "تولیدمثل")} title={L("Breeding records", "سوابق تولیدمثل")} />
        {section(state.breedings, data => {
          const rows = [...data.as_sire.map(record => ({ role: L("Sire", "نر"), record })), ...data.as_dam.map(record => ({ role: L("Dam", "مادین"), record }))];
          return rows.length
            ? <div className="edx-record-table-wrap"><table className="edx-record-table"><thead><tr><th>{L("Role", "نقش")}</th><th>{L("Foal", "کره")}</th><th>{L("Recorded season", "فصل ثبت‌شده")}</th><th>{L("Source", "منبع")}</th></tr></thead><tbody>{rows.map(({ role, record }) => <tr key={`${role}-${record.id}`}>
              <td>{role}</td>
              <td>{record.foal_id != null ? <button className="edx-data-link" onClick={() => view.navigate(horseDbRoutes.horse(record.foal_id!))} dir="auto">{record.foal_name || `#${record.foal_id}`}</button> : "—"}</td>
              <td>{record.season == null ? "—" : num(record.season, view.locale)}</td>
              <td>{provenance(record.provenance)}</td>
            </tr>)}</tbody></table></div>
            : <EmptyPanel title={L("No breeding events", "بدون سابقه تولیدمثل")} copy={L("No registered covering produced a recorded row for this horse.", "جفت‌گیری ثبت‌شده‌ای برای این اسب رکوردی نساخته است.")} />;
        })}
      </Panel>}
    </div>}
  </>;
}

/**
 * F05 (R75): native marketplace flows — the same canonical market endpoints as
 * Core's MarketplacePage and Retro's Market desk, in EquiData's language. Hidden
 * prices stay hidden (`price_visible` respected); inquiries need a signed-in
 * session and are honest about it otherwise.
 */
export function EquiDataMarketPage({ view, goLocal, listingId }: { view: EquiDataRuntime; goLocal: GoLocal; listingId?: string }) {
  // Router leaf only — hooks live inside each branch (Rules of Hooks).
  if (listingId) return <EquiDataListingDetail view={view} goLocal={goLocal} id={listingId} />;
  return <EquiDataMarketList view={view} goLocal={goLocal} />;
}

function EquiDataMarketList({ view, goLocal }: { view: EquiDataRuntime; goLocal: GoLocal }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const [state, setState] = useState<{ rows: Awaited<ReturnType<EquiDataRuntime["platform"]["modules"]["market"]["list"]>>["rows"]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    view.platform.modules.market.list({ limit: 12, offset }, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setState({ rows: value.rows ?? [], total: value.total }); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [view.platform, offset, attempt]);
  const retry = () => setAttempt(value => value + 1);
  const price = (row: { asking_price_toman: number | null; price_visible: number; negotiable: number }) => row.price_visible === 0 || row.asking_price_toman == null
    ? L("Price not published", "قیمت منتشر نشده")
    : `${num(row.asking_price_toman, view.locale)} ${L("Toman", "تومان")}${row.negotiable === 1 ? ` · ${L("negotiable", "قابل مذاکره")}` : ""}`;
  return <main className="edx-content edx-page">
    <SectionTitle eyebrow={L("MARKETPLACE", "بازار")} title={L("Canonical sales listings", "آگهی‌های فروش مرجع")} copy={L("Listings come from the canonical marketplace module. Hidden prices stay hidden; nothing here is a valuation.", "آگهی‌ها از ماژول بازار مرجع می‌آیند. قیمت‌های پنهان پنهان می‌مانند؛ هیچ‌چیز اینجا ارزش‌گذاری نیست.")} />
    {view.user ? <EquiDataMarketLifecycle view={view} goLocal={goLocal} /> : null}
    {error ? <Panel><div role="alert" className="edx-record-error"><p>{L("Marketplace could not be loaded. An error is not evidence that no listings exist.", "بارگذاری بازار ناموفق بود. خطا به معنی نبودِ آگهی نیست.")}</p><p dir="auto">{error}</p><button className="edx-button secondary" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div></Panel>
      : !state ? <Panel><p role="status" className="edx-muted">{L("Loading listings…", "در حال بارگذاری آگهی‌ها…")}</p></Panel>
      : state.rows.length === 0 ? <Panel><EmptyPanel title={L("No listings", "بدون آگهی")} copy={L("No published listings right now.", "در حال حاضر آگهی منتشرشده‌ای وجود ندارد.")} /></Panel>
      : <>
        <div className="edx-market-grid">{state.rows.map(row => <article key={row.id} className="edx-market-card">
          <header>
            <strong dir="auto">{row.title || horseName({ id: row.horse_id, name_latin: row.name_latin, name_native: row.name_native } as never, view.locale)}</strong>
            <small>#{num(row.horse_id, view.locale)}{row.breed_desc ? ` · ${row.breed_desc}` : ""}{row.sex_desc ? ` · ${row.sex_desc}` : ""}</small>
          </header>
          <div className="edx-market-price">{price(row)}</div>
          <footer>
            <span className={`edx-market-status ${row.status === "active" ? "live" : ""}`}>{row.status}</span>
            <button className="edx-button secondary" onClick={() => goLocal(`/market/${encodeURIComponent(row.id)}`)}>{L("View listing", "مشاهده آگهی")}</button>
            <button className="edx-button ghost" onClick={() => view.navigate(horseDbRoutes.horse(row.horse_id))}>{L("Horse profile", "پروفایل اسب")}</button>
          </footer>
        </article>)}</div>
        <div className="edx-market-pager">
          <button className="edx-button ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 12))}>{L("Previous", "قبلی")}</button>
          <span>{L("Offset", "شروع")} {num(offset, view.locale)} · {num(state.total, view.locale)} {L("listings", "آگهی")}</span>
          <button className="edx-button ghost" disabled={offset + 12 >= state.total} onClick={() => setOffset(offset + 12)}>{L("Next", "بعدی")}</button>
        </div>
      </>}
  </main>;
}

function EquiDataListingDetail({ view, goLocal, id }: { view: EquiDataRuntime; goLocal: GoLocal; id: string }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const [state, setState] = useState<Awaited<ReturnType<EquiDataRuntime["platform"]["modules"]["market"]["detail"]>> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [inquiry, setInquiry] = useState({ name: "", contact: "", note: "" });
  const [inquiryStatus, setInquiryStatus] = useState("");
  // R88 P03: after a listing conflict, controls stay disabled until a fresh
  // version loads (detail reload via attempt bump clears stale).
  const [stale, setStale] = useState(false);
  const idemKey = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `inq-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  useEffect(() => { if (state) setStale(false); }, [state]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setState(null);
    view.platform.modules.market.detail(id, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [view.platform, id, attempt]);
  const retry = () => setAttempt(value => value + 1);
  if (error) return <main className="edx-content edx-page"><Panel><div role="alert" className="edx-record-error"><p>{L("This listing could not be loaded.", "بارگذاری این آگهی ناموفق بود.")}</p><p dir="auto">{error}</p><button className="edx-button secondary" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div></Panel></main>;
  if (!state) return <main className="edx-content edx-page"><Panel><p role="status" className="edx-muted">{L("Opening listing…", "در حال باز کردن آگهی…")}</p></Panel></main>;
  const listing = state.listing;
  // R98-N12: honest lifecycle through the shared controller — EquiData never
  // renders an expired/suspended/mandate-expired listing as live, and the
  // introduction-only disclosure travels with the inquiry surface.
  const lifecycle = listingLifecycleView({
    listing: {
      status: listing.status,
      expires_at: listing.expires_at,
      suspended: (listing as { suspended?: boolean }).suspended,
      seller_mandate_current: (listing as { seller_mandate_current?: boolean | null }).seller_mandate_current,
    },
    viewerRole: view.user && (listing as { seller_user_id?: string | null }).seller_user_id === view.user.id ? "seller" : "buyer",
  });
  const lifecycleNotice = lifecycle.suspended
    ? L("This listing is suspended by moderation; the horse's registry record is unaffected.", "این آگهی توسط مدیریت معلق شده است؛ رکورد ثبت اسب دست‌نخورده است.")
    // R108-06: malformed expiry gets an explicit localized explanation.
    : lifecycle.expiryStatus === "invalid"
      ? L("This listing's expiry date is invalid; actions are disabled until the seller corrects it.", "تاریخ انقضای این آگهی نامعتبر است؛ تا اصلاح آن توسط فروشنده امکان اقدام وجود ندارد.")
      : lifecycle.effectiveStatus === "expired"
      ? L("This listing has expired and no longer accepts new inquiries.", "این آگهی منقضی شده و درخواست جدید نمی‌پذیرد.")
      : lifecycle.effectiveStatus === "sold" || lifecycle.effectiveStatus === "withdrawn"
        ? L(`This listing is ${lifecycle.effectiveStatus}; the history stays available.`, `این آگهی ${lifecycle.effectiveStatus === "sold" ? "فروخته شده" : "برداشته شده"} است.`)
        : lifecycle.sellerMandateCurrent === false
          ? L("The seller's mandate is no longer current — new inquiries are closed.", "اعتبار فروشنده برقرار نیست — درخواست جدید بسته است.")
          : "";
  const price = listing.price_visible === 0 || listing.asking_price_toman == null
    ? L("Price not published", "قیمت منتشر نشده")
    : `${num(listing.asking_price_toman, view.locale)} ${L("Toman", "تومان")}${listing.negotiable === 1 ? ` · ${L("negotiable", "قابل مذاکره")}` : ""}`;
  const submitInquiry = async () => {
    if (!inquiry.name.trim() || !inquiry.contact.trim()) { setInquiryStatus(L("Name and contact are required.", "نام و راه ارتباطی الزامی است.")); return; }
    if (stale) return;
    setInquiryStatus(L("Sending…", "در حال ارسال…"));
    try {
      await view.platform.modules.market.inquire(id, { buyer_name: inquiry.name.trim(), buyer_contact: inquiry.contact.trim(), message: inquiry.note.trim() || null }, { idempotencyKey: idemKey.current });
      setInquiryStatus(L("Inquiry recorded in the platform. SMS/email delivery is not confirmed.", "استعلام در سامانه ثبت شد؛ تحویل پیامک یا ایمیل تأیید نشده است."));
    } catch (cause) {
      setInquiryStatus(cause instanceof Error ? cause.message : String(cause));
      const code = (cause as { code?: string }).code;
      if (code === "listing_unavailable" || code === "listing_version_conflict" || code === "idempotency_conflict") {
        setStale(true);
        setAttempt(value => value + 1);
      }
    }
  };
  return <main className="edx-content edx-page">
    <SectionTitle eyebrow={`${L("LISTING", "آگهی")} · #${id}`} title={<span dir="auto">{listing.title || horseName({ id: listing.horse_id, name_latin: listing.name_latin, name_native: listing.name_native } as never, view.locale)}</span>} copy={L("A canonical marketplace listing. Hidden prices stay hidden.", "آگهی مرجع بازار. قیمت‌های پنهان پنهان می‌مانند.")} />
    {lifecycleNotice && <Panel><p role="status" dir="auto">{lifecycleNotice}</p></Panel>}
    <div className="edx-record-grid">
      <Panel>
        <SectionTitle eyebrow={L("TERMS", "شرایط")} title={L("Listing details", "جزئیات آگهی")} />
        <dl className="edx-data-grid">
          <div><dt>{L("Asking price", "قیمت پیشنهادی")}</dt><dd><strong>{price}</strong></dd></div>
          <div><dt>{L("Status", "وضعیت")}</dt><dd dir="auto">{listing.status}</dd></div>
          <div><dt>{L("Seller", "فروشنده")}</dt><dd dir="auto">{listing.seller_contact_name || "—"}{listing.seller_city ? ` · ${listing.seller_city}` : ""}</dd></div>
          <div><dt>{L("Listed", "ثبت آگهی")}</dt><dd dir="auto">{listing.listed_at || "—"}</dd></div>
          {listing.description ? <div><dt>{L("Description", "توضیح")}</dt><dd dir="auto">{listing.description}</dd></div> : null}
        </dl>
        <div className="edx-record-actions">
          <button className="edx-button secondary" onClick={() => view.navigate(horseDbRoutes.horse(listing.horse_id))}>{L("Open horse profile", "باز کردن پروفایل اسب")}</button>
          <button className="edx-button ghost" onClick={() => goLocal("/market")}>{L("All listings", "همه آگهی‌ها")}</button>
        </div>
      </Panel>
      <Panel>
        <SectionTitle eyebrow={L("CONTACT", "ارتباط")} title={L("Send an inquiry", "ارسال استعلام")} />
        {/* R98-N12: introduction-only disclosure on every inquiry surface. */}
        <p className="edx-muted" dir="auto">{view.locale === "fa" ? MARKETPLACE_DISCLOSURE.fa : MARKETPLACE_DISCLOSURE.en}</p>
        {view.user ? <>
          <div className="edx-market-inquiry">
            <label>{L("Your name", "نام شما")}<input dir="auto" disabled={stale} value={inquiry.name} onChange={event => setInquiry(current => ({ ...current, name: event.target.value }))} /></label>
            <label>{L("Phone / email", "تلفن / ایمیل")}<input dir="ltr" disabled={stale} value={inquiry.contact} onChange={event => setInquiry(current => ({ ...current, contact: event.target.value }))} /></label>
            <label>{L("Note", "یادداشت")}<textarea dir="auto" rows={3} disabled={stale} value={inquiry.note} onChange={event => setInquiry(current => ({ ...current, note: event.target.value }))} /></label>
            <button className="edx-button primary" disabled={stale || lifecycle.sellerMandateCurrent === false || lifecycle.suspended} onClick={() => void submitInquiry()}>{stale ? L("Reloading listing…", "بارگذاری مجدد آگهی…") : L("Send inquiry", "ارسال استعلام")}</button>
            {inquiryStatus && <p role="status" dir="auto">{inquiryStatus}</p>}
          </div>
        </> : <p className="edx-muted">{L("Sign in to send an inquiry to the seller.", "برای ارسال استعلام وارد شوید.")}</p>}
        {state.pedigree?.sire || state.pedigree?.dam ? <div className="edx-market-pedigree">
          <h3>{L("Recorded parents", "والدین ثبت‌شده")}</h3>
          <dl className="edx-data-grid">
            {state.pedigree?.sire ? <div><dt>{L("Sire", "پدر")}</dt><dd dir="auto">{state.pedigree.sire.name_latin || state.pedigree.sire.name_native}</dd></div> : null}
            {state.pedigree?.dam ? <div><dt>{L("Dam", "مادر")}</dt><dd dir="auto">{state.pedigree.dam.name_latin || state.pedigree.dam.name_native}</dd></div> : null}
          </dl>
        </div> : null}
      </Panel>
    </div>
  </main>;
}

/** R117-15 (Master AI R117 handoff D19): the signed-in market lifecycle in
 * EquiData's language — the seller's own listings + received-inquiry inbox,
 * the buyer's OWN sent inquiries, and the buyer's watchlist — bound to the
 * ONE shared headless controller. Versioned writes send the row version the
 * renderer read; each sent row reports the listing's CURRENT status honestly
 * (sold/withdrawn/expired say so) while its conversation history stays
 * reachable for both participants. */
const EDX_INQUIRY_STATUS_LABEL: Record<string, [string, string]> = {
  new: ["new", "جدید"],
  contacted: ["contacted", "تماس‌گرفته‌شده"],
  closed: ["closed", "بسته"],
};

function EquiDataMarketLifecycle({ view, goLocal }: { view: EquiDataRuntime; goLocal: GoLocal }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const user = view.user;
  const scope = usePrincipalScope(user, null);
  const { mine, retry } = useMyMarketplace({ platform: view.platform, scope, userId: user?.id });
  const { sent, retry: retrySent } = useSentInquiries({ platform: view.platform, scope, userId: user?.id });
  const { watchlist, retry: retryWatchlist } = useWatchlist({ platform: view.platform, scope, userId: user?.id });
  const commands = useMarketplaceLifecycleCommands(scope);
  if (!user) return null;
  return <section className="edx-panels" data-surface="market-lifecycle" aria-label={L("My listings and inquiries", "آگهی‌ها و درخواست‌های من")}>
    <Panel>
      <SectionTitle eyebrow={L("LIFECYCLE", "چرخه")} title={L("My listings and inquiries", "آگهی‌ها و درخواست‌های من")} copy={L("The marketplace is an introduction surface — no payment, delivery or ownership transfer happens here. Status changes are versioned; a changed row is reloaded before your edit can land.", "بازار فقط سطح آشنایی است — هیچ پرداخت، تحویل یا انتقال مالکیتی اینجا انجام نمی‌شود. تغییر وضعیت نسخه‌دار است؛ ردیف تغییرکرده پیش از اعمال ویرایش شما بازخوانی می‌شود.")} />
      {mine.phase === "loading" ? <p role="status" className="edx-muted">{L("Loading your listings…", "بارگذاری آگهی‌های شما…")}</p> : null}
      {mine.phase === "forbidden" || mine.phase === "unavailable" || mine.phase === "error" ? <ErrorPanel error={mine.reason} onRetry={retry} /> : null}
      {mine.phase === "empty" ? <p className="edx-muted">{L("You have no listings and no received inquiries yet.", "هنوز آگهی یا درخواستی ندارید.")}</p> : null}
      {(mine.phase === "ready" || mine.phase === "reloading") && mine.listings.length ? <div className="edx-market-grid" data-surface="market-seller-listings">{mine.listings.map(row => {
        const lifecycle = listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at ?? null, seller_mandate_current: null }, viewerRole: "seller" });
        const allowed = (LISTING_LIFECYCLE[lifecycle.effectiveStatus] ?? []).filter((status: string) => status !== "expired");
        return <article key={row.id} className="edx-market-card" data-surface="market-seller-listing">
          <header>
            <strong dir="auto">{row.title || horseName({ id: row.horse_id, name_latin: row.name_latin, name_native: row.name_native } as never, view.locale)}</strong>
            <small>#{num(row.horse_id, view.locale)} · {lifecycle.effectiveStatus} · v{num(row.row_version ?? 0, view.locale)}</small>
          </header>
          <footer>
            <span className={`edx-market-status ${row.status === "active" ? "live" : ""}`}>{lifecycle.effectiveStatus}</span>
            <button className="edx-button secondary" onClick={() => goLocal(`/market/${encodeURIComponent(row.id)}`)}>{L("View listing", "مشاهده آگهی")}</button>
            {allowed.map((status: string) => <button key={status} className="edx-button ghost" disabled={commands.setStatus.state.phase === "submitting"} onClick={() => { void commands.setStatus.run(async () => {
              const result = await view.platform.modules.market.setStatus(row.id, status, { expectedVersion: row.row_version ?? 0 });
              retry(); return result;
            }, { successMessage: L("Listing status updated (versioned).", "وضعیت آگهی به‌روزرسانی شد (نسخه‌دار).") }); }}>{L(`Mark ${status}`, `علامت ${status}`)}</button>)}
          </footer>
        </article>;
      })}</div> : null}
      {(mine.phase === "ready" || mine.phase === "reloading") && mine.inquiries.length ? <div data-surface="market-inquiry-inbox" style={{ marginTop: "12px" }}>
        <p className="edx-eyebrow"><span />{L("Inquiries received on your listings", "درخواست‌های دریافتی روی آگهی‌های شما")}</p>
        <div className="edx-market-grid">{mine.inquiries.map((inquiry) => <EquiDataInquiryRow key={String(inquiry.id)} view={view} inquiry={inquiry} commands={commands} onDone={retry} seller />)}</div>
      </div> : null}
      {commands.setStatus.state.phase === "rejected" || commands.renew.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The listing changed elsewhere — the current version was reloaded; retry with the fresh version.", "آگهی جای دیگر تغییر کرده — نسخه فعلی بازخوانی شد؛ با نسخه تازه دوباره تلاش کنید.")}</p> : null}
    </Panel>
    <Panel data-surface="market-sent-inquiries">
      <SectionTitle eyebrow={L("SENT", "ارسالی")} title={L("My sent inquiries", "درخواست‌های ارسالی من")} copy={L("Exactly the inquiries you sent — never a seller's inbox. Each listing's current status is reported honestly.", "دقیقاً درخواست‌هایی که شما ارسال کرده‌اید — نه صندوق فروشنده. وضعیت فعلی هر آگهی صادقانه گزارش می‌شود.")} />
      {sent.phase === "loading" ? <p role="status" className="edx-muted">{L("Loading your sent inquiries…", "بارگذاری درخواست‌های ارسالی شما…")}</p> : null}
      {sent.phase === "forbidden" || sent.phase === "unavailable" || sent.phase === "error" ? <ErrorPanel error={sent.reason} onRetry={retrySent} /> : null}
      {sent.phase === "empty" ? <EmptyPanel title={L("No sent inquiries", "بدون درخواست ارسالی")} copy={L("You have not sent any inquiries yet — open a listing and ask the seller a question.", "هنوز درخواستی ارسال نکرده‌اید — یک آگهی را باز کنید و از فروشنده سؤال بپرسید.")} /> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length ? <div className="edx-market-grid">{(sent.rows as unknown as Array<Record<string, unknown>>).map(row => <EquiDataInquiryRow key={String(row.id)} view={view} inquiry={row} commands={commands} onDone={retrySent} seller={false} />)}</div> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length < sent.pagination.total ? <p className="edx-muted">{L(`Showing the newest ${sent.rows.length} of ${sent.pagination.total} sent inquiries.`, `نمایش ${sent.rows.length} درخواست آخر از ${sent.pagination.total} درخواست ارسالی.`)}</p> : null}
    </Panel>
    <Panel data-surface="market-watchlist">
      <SectionTitle eyebrow={L("WATCHLIST", "پیگیری")} title={L("My watchlist", "فهرست پیگیری من")} copy={L("Your watchlist is private research data. Watching a listing is not a reservation.", "فهرست پیگیری شما داده پژوهشی خصوصی است. دنبال‌کردن آگهی رزرو نیست.")} />
      {watchlist.phase === "loading" ? <p role="status" className="edx-muted">{L("Loading your watchlist…", "بارگذاری فهرست پیگیری شما…")}</p> : null}
      {watchlist.phase === "empty" ? <EmptyPanel title={L("Nothing saved yet", "هنوز چیزی ذخیره نشده")} copy={L("No saved listings yet — watch a listing to keep it here.", "هنوز آگهی ذخیره‌شده‌ای نیست — آگهی‌ای را دنبال کنید تا اینجا بماند.")} /> : null}
      {(watchlist.phase === "ready" || watchlist.phase === "reloading") && watchlist.rows.length ? <div className="edx-market-grid">{watchlist.rows.map((row) => <article key={String(row.listing_id ?? row.id)} className="edx-market-card" data-surface="market-watchlist-row">
        <header>
          <strong dir="auto">{view.locale === "fa" && row.name_native ? String(row.name_native) : String(row.name_latin ?? row.title ?? `#${row.listing_id ?? row.id}`)}</strong>
          <small>{L("Listing status", "وضعیت آگهی")}: {String(row.status ?? "—")}</small>
        </header>
        <footer>
          <button className="edx-button secondary" onClick={() => goLocal(`/market/${encodeURIComponent(String(row.listing_id ?? row.id))}`)}>{L("Open listing", "باز کردن آگهی")}</button>
          <button className="edx-button ghost" disabled={commands.watch.state.phase === "submitting"} onClick={() => { void commands.watch.run(async () => {
            const result = await view.platform.modules.market.unwatch(String(row.listing_id ?? row.id));
            retryWatchlist(); return result;
          }, { successMessage: L("Removed from your watchlist.", "از فهرست پیگیری شما حذف شد.") }); }}>{L("Unwatch", "حذف پیگیری")}</button>
        </footer>
      </article>)}</div> : null}
    </Panel>
  </section>;
}

/** ONE inquiry row (seller inbox or buyer sent) in EquiData's design language:
 * the participant-only conversation with reply, the versioned inquiry status
 * for the seller, and the buyer's own close action. */
function EquiDataInquiryRow({ view, inquiry, commands, onDone, seller }: {
  view: EquiDataRuntime; inquiry: Record<string, unknown>; commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void; seller: boolean;
}) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const [open, setOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const conversationPlatform = useMemo(() => ({ market: view.platform.modules.market }), [view.platform]);
  const { state: conversation } = useInquiryConversation(conversationPlatform, String(inquiry.id ?? ""));
  const id = String(inquiry.id ?? "");
  const status = String(inquiry.status ?? "new");
  const closed = status === "closed";
  const listingTitle = inquiry.listing_title ? String(inquiry.listing_title) : "";
  const horseLabel = view.locale === "fa" && inquiry.name_native ? String(inquiry.name_native) : (inquiry.name_latin ? String(inquiry.name_latin) : "");
  const listingStatus = inquiry.listing_status ? String(inquiry.listing_status) : null;
  const replyCount = Number(inquiry.reply_count ?? 0);
  return <article className="edx-market-card" data-surface="market-inquiry-row">
    <header>
      <strong dir="auto">{seller ? String(inquiry.buyer_name ?? (listingTitle || horseLabel || id)) : (listingTitle || horseLabel || id)}</strong>
      <small>{EDX_INQUIRY_STATUS_LABEL[status]?.[view.locale === "fa" ? 1 : 0] ?? status}{listingStatus ? ` · ${L("listing", "آگهی")} ${listingStatus}` : ""}{replyCount > 0 ? ` · ${replyCount} ${L("replies", "پاسخ")}` : ""}{inquiry.created_at ? ` · ${String(inquiry.created_at).slice(0, 10)}` : ""}</small>
    </header>
    <footer>
      <button className="edx-button secondary" onClick={() => setOpen(value => !value)}>{open ? L("Hide conversation", "پنهان‌کردن تبادل پیام") : L("Conversation", "تبادل پیام")}</button>
      {seller && !closed ? <button className="edx-button ghost" disabled={commands.setInquiryStatus.state.phase === "submitting"} onClick={() => { void commands.setInquiryStatus.run(async () => {
        const result = await view.platform.modules.market.setInquiryStatus(id, status === "new" ? "contacted" : "closed", { expectedVersion: Number(inquiry.row_version ?? 0) });
        onDone(); return result;
      }, { successMessage: L("Inquiry status updated (versioned).", "وضعیت درخواست به‌روزرسانی شد (نسخه‌دار).") }); }}>{status === "new" ? L("Mark contacted", "تماس‌گرفته‌شده") : L("Close inquiry", "بستن درخواست")}</button> : null}
      {!seller && !closed ? <button className="edx-button ghost" disabled={commands.closeOwnInquiry.state.phase === "submitting"} onClick={() => { void commands.closeOwnInquiry.run(async () => {
        const result = await view.platform.modules.market.closeOwnInquiry(id, { expectedVersion: Number(inquiry.row_version ?? 0) });
        onDone(); return result;
      }, { successMessage: L("Your inquiry is closed. No further replies are accepted.", "درخواست شما بسته شد. پاسخ دیگری پذیرفته نمی‌شود.") }); }}>{L("Close my inquiry", "بستن درخواست من")}</button> : null}
    </footer>
    {open ? <div data-surface="market-conversation" style={{ marginTop: "8px" }}>
      {conversation.phase === "loading" ? <p role="status" className="edx-muted">{L("Loading the conversation…", "بارگذاری تبادل پیام…")}</p> : null}
      {conversation.phase === "forbidden" ? <p role="alert" className="edx-muted">{L("Only the participants can read this conversation.", "فقط طرف‌های درخواست می‌توانند این تبادل پیام را بخوانند.")}</p> : null}
      {conversation.phase === "not_found" ? <p role="alert" className="edx-muted">{L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.")}</p> : null}
      {conversation.phase === "error" ? <ErrorPanel error={conversation.error.kind === "not_found" ? L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.") : conversation.error.message} /> : null}
      {(conversation.phase === "ready" || conversation.phase === "sending") ? (conversation.thread.entries.length ? <ul style={{ margin: "0", paddingLeft: "16px" }}>{conversation.thread.entries.map(entry => <li key={entry.id}><strong>{entry.side}</strong> <small>{entry.createdAt}</small><p dir="auto">{entry.body}</p></li>)}</ul> : <p className="edx-muted">{L("No messages yet.", "هنوز پیامی نیست.")}</p>) : null}
      {!closed ? <div>
        <label className="edx-muted">{L("Reply", "پاسخ")}<input dir="auto" maxLength={4000} value={replyBody} disabled={commands.reply.state.phase === "submitting"} onChange={event => setReplyBody(event.target.value)} /></label>
        <button className="edx-button secondary" disabled={commands.reply.state.phase === "submitting" || replyBody.trim().length < 1} onClick={() => { void commands.reply.run(async () => {
          const result = await view.platform.modules.market.reply(id, { body: replyBody.trim() });
          setReplyBody(""); onDone(); return result;
        }, { successMessage: L("Reply sent to the conversation.", "پاسخ در تبادل پیام ارسال شد.") }); }}>{L("Send reply", "ارسال پاسخ")}</button>
      </div> : <p className="edx-muted">{L("This inquiry is closed — the conversation is read-only history.", "این درخواست بسته است — تبادل پیام فقط تاریخچه خواندنی است.")}</p>}
      {commands.setInquiryStatus.state.phase === "rejected" || commands.closeOwnInquiry.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The inquiry changed elsewhere — reload its current version and retry.", "درخواست جای دیگر تغییر کرده — نسخه فعلی را بازخوانی و دوباره تلاش کنید.")}</p> : null}
    </div> : null}
  </article>;
}


/** R117-16 (Master AI R117 handoff D24): the truthful credential story on the
 * EquiData horse record — the PUBLIC read projection + verification states,
 * the member-scoped issue form, the owner-scoped revoke/supersede and the
 * PRIVATE snapshot review, bound to the ONE shared headless controller. No
 * demo badge implies real federation, ownership or laboratory approval. */
const EDX_VERIFY_STATE_LABEL: Record<string, [string, string]> = {
  current: ["Current — sources unchanged since issuance", "معتبر — منابع از زمان صدور تغییر نکرده‌اند"],
  expired: ["Expired — the validity window has passed; the recorded snapshot is preserved", "منقضی — پنجره اعتبار گذشته است؛ تصویر ثبت‌شده حفظ می‌شود"],
  revoked: ["Revoked by the issuer; the recorded snapshot is preserved", "لغوشده توسط مرجع؛ تصویر ثبت‌شده حفظ می‌شود"],
  superseded: ["Superseded by a newer attestation of the same record", "جایگزین‌شده توسط تأیید جدیدتر همان رکورد"],
  source_changed: ["Source record changed after issuance — the attested snapshot no longer matches", "رکورد منبع بعد از صدور تغییر کرده — تصویر تأییدشده دیگر منطبق نیست"],
  snapshot_tampered: ["Snapshot digest mismatch — the stored evidence fails its own integrity check", "عدم تطابق چکیده تصویر — شواهد ذخیره‌شده در بررسی یکپارچگی خودش مردود است"],
  unbound_legacy: ["Legacy record without a bound snapshot; requires review", "رکورد قدیمی بدون تصویر پیوند‌شده؛ نیازمند بررسی"],
};

function EquiDataCredentialStories({ view, horseId }: { view: EquiDataRuntime; horseId: number }) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const user = view.user;
  const scope = usePrincipalScope(user, null);
  const { stories, retry } = useHorseCredentialStories({ platform: view.platform, scope, horseId });
  const { directory } = useIssuerDirectory({ platform: view.platform, scope });
  const commands = useCredentialStoryCommands(scope);
  const [issuerId, setIssuerId] = useState("");
  const [recordKind, setRecordKind] = useState<"genetic_test" | "horse_identity">("genetic_test");
  const [recordId, setRecordId] = useState("");
  const [statement, setStatement] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  return <Panel data-surface="credential-stories" title={L("Issuer credentials", "اعتبارنامه‌های مرجع")}>
    <p className="edx-note" dir="auto">{L("Statements issued by named external issuers within a narrow approved scope. On this synthetic instance every issuer is explicitly fictional — no badge here implies real federation, ownership or laboratory approval.", "اظهارات صادره از مراجع مشخص در محدوده تأییدشده محدود. در این نمونه ساختگی همه مراجع صراحتاً خیالی‌اند — هیچ نشان اینجا به معنای فدراسیون واقعی، مالکیت یا تأیید آزمایشگاهی نیست.")}</p>
    {stories.phase === "loading" ? <p role="status">{L("Loading credentials…", "در حال بارگذاری اعتبارنامه‌ها…")}</p> : null}
    {stories.phase === "forbidden" || stories.phase === "unavailable" || stories.phase === "error" ? <ErrorPanel error={stories.reason} onRetry={retry} /> : null}
    {stories.phase === "empty" ? <EmptyPanel title={L("No issuer credentials yet", "هنوز اعتبارنامه‌ای نیست")} copy={L("No issuer credential is recorded for this horse yet. Registry data shown here is platform-reviewed at most — reviewed is not issuer-attested.", "هنوز اعتبارنامه‌ای از مرجع بیرونی برای این اسب ثبت نشده است. داده‌های اینجا حداکثر بررسی سامانه است — بررسی سامانه همان تأیید مرجع نیست.")} /> : null}
    {(stories.phase === "ready" || stories.phase === "reloading") && stories.rows.length ? <ul style={{ listStyle: "none", padding: 0, margin: 0 }} data-surface="credential-rows">{stories.rows.map(row => <EquiDataCredentialRow key={row.id} view={view} row={row} commands={commands} onChanged={retry} />)}</ul> : null}
    {user ? <div data-surface="credential-issue" style={{ borderTop: "1px solid #2b3a4a", marginTop: "10px", paddingTop: "10px" }}>
      <SectionTitle title={L("Attest under an issuer (member-scoped)", "صدور تأیید به نام یک مرجع (محدود به عضو)")} />
      <p className="edx-note">{L("You may attest only under an issuer that granted you an active membership, and only within its narrow approved scope — the server refuses anything else.", "فقط مرجعی که به شما عضویت فعال داده و فقط در محدوده تأییدشده محدود آن می‌توانید تأیید صادر کنید — سرور هر چیز دیگر را رد می‌کند.")}</p>
      <label>{L("Issuer", "مرجع")}<select value={issuerId} onChange={event => setIssuerId(event.target.value)}>
        <option value="">{L("Choose an issuer…", "یک مرجع انتخاب کنید…")}</option>
        {(directory.phase === "ready" || directory.phase === "reloading") ? directory.issuers.map(issuer => <option key={issuer.id} value={issuer.id}>{view.locale === "fa" && issuer.name_native ? issuer.name_native : issuer.name}</option>) : null}
      </select></label>
      <label>{L("Record kind", "نوع رکورد")}<select value={recordKind} onChange={event => setRecordKind(event.target.value as "genetic_test" | "horse_identity")}>
        <option value="genetic_test">{L("Reviewed genetic test", "آزمون ژنتیکی بررسی‌شده")}</option>
        <option value="horse_identity">{L("Horse identity", "هویت اسب")}</option>
      </select></label>
      <label>{L(recordKind === "horse_identity" ? "Horse id" : "Genetic test id", recordKind === "horse_identity" ? "شناسه اسب" : "شناسه آزمون ژنتیکی")}<input value={recordId} inputMode="numeric" onChange={event => setRecordId(event.target.value)} placeholder={recordKind === "horse_identity" ? String(horseId) : "980000008"} /></label>
      <label>{L("Statement (optional)", "اظهار (اختیاری)")}<input dir="auto" maxLength={2000} value={statement} onChange={event => setStatement(event.target.value)} /></label>
      <label>{L("Expires at (optional, future instant with timezone)", "اعتبار تا (اختیاری، زمان آینده با منطقه زمانی)")}<input value={expiresAt} placeholder="2026-12-31T00:00:00Z" onChange={event => setExpiresAt(event.target.value)} /></label>
      <button className="edx-btn" disabled={commands.issue.state.phase === "submitting" || !issuerId || !recordId.trim()} onClick={() => { void commands.issue.run(async () => {
        const result = await view.platform.modules.attestations.issue(issuerId, { record_kind: recordKind, record_id: recordId.trim(), statement: statement.trim() || null, expires_at: expiresAt.trim() || null });
        setStatement(""); setExpiresAt(""); retry(); return result;
      }, { successMessage: L("Credential issued with an immutable server-derived snapshot.", "اعتبارنامه با تصویر برگرفته از سرور و تغییرناپذیر صادر شد.") }); }}>{L("Issue credential", "صدور اعتبارنامه")}</button>
      {commands.issue.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The issuer refused this issuance — membership, narrow scope, record or evidence rules.", "مرجع این صدور را رد کرد — عضویت، محدوده محدود، رکورد یا قواعد شواهد.")}</p> : null}
    </div> : null}
  </Panel>;
}

/** ONE public credential row: verify panel + owner actions + private snapshot review. */
function EquiDataCredentialRow({ view, row, commands, onChanged }: {
  view: EquiDataRuntime; row: CredentialStoryRow; commands: ReturnType<typeof useCredentialStoryCommands>; onChanged: () => void;
}) {
  const L = (en: string, fa: string) => edxText(view.locale, en, fa);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [snapshot, setSnapshot] = useState<{ phase: "idle" } | { phase: "granted"; digest: string } | { phase: "refused" }>({ phase: "idle" });
  const { verification, retry: retryVerify } = useAttestationVerification({ platform: view.platform, scope: `credential:${row.id}`, attestationId: verifyOpen ? row.id : null });
  const effective = row.effective_status || row.status;
  return <li data-surface="credential-row" data-attestation-id={row.id} style={{ borderTop: "1px solid #2b3a4a", padding: "8px 0" }}>
    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
      <strong dir="auto">{view.locale === "fa" && row.issuer.name_native ? row.issuer.name_native : row.issuer.name}</strong>
      <small>{row.issuer.kind} · {row.record_kind} #{row.record_id} · {effective}{row.expires_at ? ` · ${L("valid until", "اعتبار تا")} ${row.expires_at.slice(0, 10)}` : ""}</small>
    </div>
    <p className="edx-note">{L("Public metadata only — the statement and scope stay private to authorized review.", "فقط فراداده عمومی — اظهار و محدوده برای بررسی مجاز خصوصی می‌ماند.")}</p>
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      <button className="edx-btn" onClick={() => setVerifyOpen(value => !value)}>{verifyOpen ? L("Hide verification", "پنهان‌کردن راستی‌آزمایی") : L("Verify", "راستی‌آزمایی")}</button>
      {view.user ? <button className="edx-btn" onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? L("Hide owner actions", "پنهان‌کردن اقدامات مالک") : L("Owner actions", "اقدامات مالک")}</button> : null}
      {view.user ? <button className="edx-btn" onClick={async () => { setSnapshot({ phase: "idle" }); const outcome = await runSnapshotReview(view.platform, row.id); setSnapshot(outcome.phase === "granted" ? { phase: "granted", digest: String((outcome.review.snapshot as Record<string, unknown>).content_digest ?? "") } : { phase: "refused" }); }}>{L("Review snapshot (private)", "بازبینی تصویر (خصوصی)")}</button> : null}
    </div>
    {verifyOpen ? <div data-surface="credential-verify" style={{ marginTop: "8px" }}>
      {verification.phase === "loading" ? <p role="status">{L("Verifying…", "در حال راستی‌آزمایی…")}</p> : null}
      {verification.phase === "not_found" || verification.phase === "forbidden" || verification.phase === "unavailable" || verification.phase === "error" ? <div role="alert"><p className="edx-note">{L("Verification is unavailable right now.", "راستی‌آزمایی الان در دسترس نیست.")}</p>{verification.phase !== "not_found" ? <p dir="auto" className="edx-note">{verification.reason}</p> : null}<button className="edx-btn" onClick={retryVerify}>{L("Retry", "تلاش دوباره")}</button></div> : null}
      {(verification.phase === "ready" || verification.phase === "reloading") ? <div>
        <p className="edx-note"><b>{L("State", "وضعیت")}:</b> {EDX_VERIFY_STATE_LABEL[verification.verification.verification_state]?.[view.locale === "fa" ? 1 : 0] ?? verification.verification.verification_state} · <b>{L("Effective", "مؤثر")}:</b> {verification.verification.effective_status}{verification.verification.snapshot ? <> · <b>{L("Digest", "چکیده")}:</b> <code>{verification.verification.snapshot.content_digest.slice(0, 16)}…</code></> : null}</p>
        {verification.verification.source_detail ? <p className="edx-note"><b>{L("Changed sources", "منابع تغییرکرده")}:</b> {(verification.verification.source_detail.changed_tables ?? []).join(", ")}</p> : null}
        <p className="edx-note" dir="auto">{verification.verification.note}</p>
      </div> : null}
    </div> : null}
    {actionsOpen && view.user ? <div data-surface="credential-owner-actions" style={{ marginTop: "8px" }}>
      <p className="edx-note">{L("Revocation and supersession are issuer-owner (or platform content-manager) commands. A reason is required; the recorded snapshot is never rewritten.", "لغو و جایگزینی فرمان مالک مرجع (یا مدیر محتوای سامانه) است. دلیل الزامی است؛ تصویر ثبت‌شده هرگز بازنویسی نمی‌شود.")}</p>
      <label>{L("Reason", "دلیل")}<input dir="auto" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label>{L("Replacement statement (for supersede)", "اظهار جایگزین (برای جایگزینی)")}<input dir="auto" maxLength={2000} value={replacement} onChange={event => setReplacement(event.target.value)} /></label>
      <button className="edx-btn" disabled={commands.revoke.state.phase === "submitting" || reason.trim().length < 3 || row.status !== "active"} onClick={() => { void commands.revoke.run(async () => {
        const result = await view.platform.modules.attestations.revoke(row.id, { reason: reason.trim() });
        setReason(""); onChanged(); return result;
      }, { successMessage: L("Credential revoked — the current status changed; the snapshot is preserved.", "اعتبارنامه لغو شد — وضعیت فعلی تغییر کرد؛ تصویر حفظ می‌شود.") }); }}>{L("Revoke", "لغو")}</button>
      <button className="edx-btn" disabled={commands.supersede.state.phase === "submitting" || reason.trim().length < 3 || replacement.trim().length < 1 || row.status !== "active"} onClick={() => { void commands.supersede.run(async () => {
        const result = await view.platform.modules.attestations.supersede(row.id, { reason: reason.trim(), replacement: { record_kind: row.record_kind, record_id: row.record_id, statement: replacement.trim() } });
        setReason(""); setReplacement(""); onChanged(); return result;
      }, { successMessage: L("Superseded — a replacement was issued; the history stays visible.", "جایگزین شد — اعتبارنامه جدید صادر شد؛ تاریخچه قابل مشاهده می‌ماند.") }); }}>{L("Supersede with replacement", "جایگزینی با نسخه جدید")}</button>
      {commands.revoke.state.phase === "rejected" || commands.supersede.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The command was refused — authority, state or version rules. The recorded history is unchanged.", "فرمان رد شد — قواعد اختیار، وضعیت یا نسخه. تاریخچه ثبت‌شده تغییر نکرد.")}</p> : null}
    </div> : null}
    {snapshot.phase !== "idle" ? <div data-surface="credential-snapshot-review" style={{ marginTop: "8px" }}>
      {snapshot.phase === "granted" ? <p className="edx-note">{L("Private snapshot review: authorized — full bytes stay private; digest", "بازبینی خصوصی تصویر: مجاز — بایت‌های کامل خصوصی می‌مانند؛ چکیده")} <code>{snapshot.digest.slice(0, 16)}…</code></p> : <p className="edx-note" role="alert">{L("Refused — only platform content managers or the issuer's active owner may review the full snapshot.", "رد شد — فقط مدیران محتوای سامانه یا مالک فعال مرجع می‌توانند تصویر کامل را بازبینی کنند.")}</p>}
    </div> : null}
  </li>;
}
