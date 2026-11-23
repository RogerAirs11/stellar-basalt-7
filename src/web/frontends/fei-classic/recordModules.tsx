import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  COMPETITION_DISCIPLINES,
  loadHorseRecordDetails,
  HorseMediaPanel,
  usePrincipalScope,
  useScopedState,
  type HorseRecordDetails,
  type RecordSection,
  type CompetitionResultRecord,
  horseDbRoutes,
} from "../../../frontend-kit";
import type { ClassicRuntime } from "./adapter";
// R98-N12: the ONE shared marketplace lifecycle semantics (headless controller).
import { listingLifecycleView, LISTING_LIFECYCLE, MARKETPLACE_DISCLOSURE, useMyMarketplace, useSentInquiries, useWatchlist, useMarketplaceLifecycleCommands, useInquiryConversation, conversationThread, useHorseCredentialStories, useAttestationVerification, useIssuerDirectory, useCredentialStoryCommands, runSnapshotReview, type CredentialStoryRow } from "../../../frontend-kit";
import { Badge, PageTitle, Section, StatePanel } from "./components";
import { num, t } from "./i18n";
import { GeneticWorkbench } from "../../../frontend-kit";
import { AccountSecuritySessionNotice } from "../../../frontend-kit";

/** Competition/market rows carry optional/nullable names and a non-numeric id —
 *  display them without pretending they are HorseRecords. */
const recordName = (value: { name_latin?: string | null; name_native?: string | null; id?: number | string }, locale: "en" | "fa" | "ar"): string =>
  String((locale === "fa" ? value.name_native || value.name_latin : value.name_latin || value.name_native) ?? "") || `#${value.id ?? "—"}`;

/**
 * F06 (R75): Federation Classic's native record pages. Institutional surfaces
 * for the canonical record modules — the same typed loader and endpoints the
 * other frontends use, rendered with FEI's donor components. Every load state
 * is honest (StatePanel error rows), and hidden marketplace prices stay hidden.
 */

type FeiGoLocal = (path: string) => void;

/** Horse profile RECORDS tab: competitions, genetic tests, breedings, media, certificate. */
export function FeiHorseRecordModules({ view, horseId }: { view: ClassicRuntime; horseId: number }) {
  const scope = usePrincipalScope(view.user, view.permissions);
  const [revision, setRevision] = useState(0);
  return <><AccountSecuritySessionNotice platform={view.platform} locale={view.locale}/><HorseMediaPanel horseId={horseId} platform={view.platform} user={view.user} permissions={view.permissions} locale={view.locale} appearance="fei"/><FeiHorseRecordModulesDetails key={`${scope}:${horseId}:${revision}`} view={view} horseId={horseId}/>{view.user && <GeneticWorkbench platform={view.platform} horseId={horseId} locale={view.locale} scope={scope} onChanged={() => setRevision(value => value + 1)}/>}<FeiCredentialStories view={view} horseId={horseId}/></>;
}

function FeiHorseRecordModulesDetails({ view, horseId }: { view: ClassicRuntime; horseId: number }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const principal = usePrincipalScope(view.user, view.permissions);
  const scope = `${principal}|horse:${horseId}`;
  const [state, setState] = useScopedState<HorseRecordDetails | null>(scope, null);
  const [error, setError] = useScopedState(scope, "");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setError("");
    loadHorseRecordDetails(view.platform, horseId, controller.signal)
      .then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
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
    ? <StatePanel status="error" error={value.error} locale={view.locale} />
    : render(value.data);
  if (error) return <Section title={L("Record modules", "ماژول‌های رکورد")} tone="purple"><StatePanel status="error" error={error} locale={view.locale} /><button className="fc-btn fc-btn-purple" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></Section>;
  if (!state || state.horseId !== horseId) return <Section title={L("Record modules", "ماژول‌های رکورد")} tone="purple"><StatePanel status="loading" locale={view.locale} /></Section>;
  return <>
    <Section title={L("Competition record", "سوابق مسابقات")} tone="purple">
      {section(state.competitions, data => data.results.length
        ? <div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>{L("Date", "تاریخ")}</th><th>{L("Competition", "مسابقه")}</th><th>{L("Class", "رده")}</th><th>{L("Rider", "سوارکار")}</th><th>{L("Result", "نتیجه")}</th><th>{L("Source", "منبع")}</th></tr></thead><tbody>{data.results.map(row => <tr key={row.id}>
          <td className="nowrap">{row.event_date || "—"}</td>
          <td dir="auto">{row.competition_name || "—"}</td>
          <td dir="auto">{row.class_name ?? "—"}</td>
          <td dir="auto">{row.rider_name ?? "—"}</td>
          <td><strong>{placement(row)}</strong></td>
          <td>{provenance(row.provenance)}</td>
        </tr>)}</tbody></table></div>
        : <StatePanel status="ready" empty={L("No competition record for this horse yet.", "هنوز سابقه مسابقه‌ای برای این اسب ثبت نشده است.")} locale={view.locale} />)}
    </Section>
    <div className="fc-two-col">
      <Section title={L("Recorded genetic tests", "آزمون‌های ژنتیکی ثبت‌شده")}>
        {section(state.genetics, data => data.tests.length
          ? <div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>{L("Test", "آزمون")}</th><th>{L("Reported result", "نتیجه ثبت‌شده")}</th><th>{L("Source", "منبع")}</th></tr></thead><tbody>{data.tests.map(row => <tr key={row.id}>
            <td dir="auto">{row.test_type}</td>
            <td dir="auto"><strong>{row.result}</strong>{row.verified === 1 ? <Badge tone="active">{L("platform-reviewed", "بررسی کارشناسان سامانه")}</Badge> : null}</td>
            <td>{provenance(row.provenance)}</td>
          </tr>)}</tbody></table></div>
          : <StatePanel status="ready" empty={L("No genetic test is recorded for this horse yet.", "هنوز آزمون ژنتیکی برای این اسب ثبت نشده است.")} locale={view.locale} />)}
        <p className="fc-muted">{L("Reported laboratory data, not a diagnosis and not a genomic score.", "داده آزمایشگاهی ثبت‌شده؛ نه تشخیص و نه امتیاز ژنومی.")}</p>
      </Section>
      <Section title={L("Breeding records", "سوابق تولیدمثل")}>
        {section(state.breedings, data => {
          const rows = [...data.as_sire.map(record => ({ role: L("Sire", "نر"), record })), ...data.as_dam.map(record => ({ role: L("Dam", "مادین"), record }))];
          return rows.length
            ? <div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>{L("Role", "نقش")}</th><th>{L("Foal", "کره")}</th><th>{L("Recorded season", "فصل ثبت‌شده")}</th><th>{L("Source", "منبع")}</th></tr></thead><tbody>{rows.map(({ role, record }) => <tr key={`${role}-${record.id}`}>
              <td>{role}</td>
              <td>{record.foal_id != null ? <a href="#" onClick={event => { event.preventDefault(); view.navigate(horseDbRoutes.horse(record.foal_id!)); }} dir="auto">{record.foal_name || `#${record.foal_id}`}</a> : "—"}</td>
              <td>{record.season == null ? "—" : num(record.season, view.locale)}</td>
              <td>{provenance(record.provenance)}</td>
            </tr>)}</tbody></table></div>
            : <StatePanel status="ready" empty={L("No breeding events recorded.", "سابقه تولیدمثلی ثبت نشده است.")} locale={view.locale} />;
        })}
      </Section>
    </div>
  </>;
}

/** Institutional competition calendar: list + detail with results. */
export function FeiCompetitionsPage({ view, goLocal, competitionId }: { view: ClassicRuntime; goLocal: FeiGoLocal; competitionId?: number }) {
  if (competitionId) return <FeiCompetitionDetail view={view} goLocal={goLocal} id={competitionId} />;
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const [rows, setRows] = useState<Awaited<ReturnType<ClassicRuntime["platform"]["modules"]["competitions"]["list"]>>["rows"] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [discipline, setDiscipline] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    view.platform.modules.competitions.list({ limit: 20, offset, discipline: discipline || undefined }, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setRows(value.rows); setTotal(value.total); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [view.platform, offset, discipline]);
  const retry = () => { setRows(null); setOffset(0); };
  return <main className="fc-main fei-fade-in">
    <PageTitle title={L("Competition calendar", "تقویم مسابقات")} subtitle={L("Federation-recorded competitions and results from the canonical registry.", "مسابقات و نتایج ثبت‌شده فدراسیون از سامانه ثبت مرجع.")} />
    <div className="fc-inline-actions">
      <label className="fc-muted">{L("Discipline", "رشته")} <select value={discipline} onChange={event => { setDiscipline(event.target.value); setOffset(0); }}><option value="">{L("All", "همه")}</option>{COMPETITION_DISCIPLINES.map(item => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
    </div>
    {error ? <StatePanel status="error" error={error} locale={view.locale} /> : !rows ? <StatePanel status="loading" locale={view.locale} /> : rows.length === 0 ? <StatePanel status="ready" empty={L("No competitions recorded.", "مسابقه‌ای ثبت نشده است.")} locale={view.locale} /> : <>
      <div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>{L("Competition", "مسابقه")}</th><th>{L("Discipline", "رشته")}</th><th>{L("Date", "تاریخ")}</th><th>{L("Venue", "محل")}</th><th className="num">{L("Results", "نتایج")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td><a className="fc113-table-link" href={`/f/fei-classic/competitions/${row.id}`} onClick={event => { if(event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); goLocal(`/competitions/${row.id}`); } }} dir="auto">{recordName(row, view.locale)}</a></td>
        <td>{row.discipline ?? "—"}</td>
        <td className="nowrap">{row.event_date ?? "—"}</td>
        <td dir="auto">{[row.venue, row.city].filter(Boolean).join(" · ") || "—"}</td>
        <td className="num">{num(row.result_count ?? 0, view.locale)}</td>
      </tr>)}</tbody></table></div>
      <div className="fc-pagination"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{L("Previous", "قبلی")}</button><span>{L("Offset", "شروع")} {num(offset, view.locale)} · {num(total, view.locale)}</span><button disabled={offset + 20 >= total} onClick={() => setOffset(offset + 20)}>{L("Next", "بعدی")}</button></div>
    </>}
    {error && <div className="fc-inline-actions"><button className="btn-search" onClick={retry}>{L("Retry", "تلاش دوباره")}</button></div>}
  </main>;
}

function FeiCompetitionDetail({ view, goLocal, id }: { view: ClassicRuntime; goLocal: FeiGoLocal; id: number }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const [state, setState] = useState<Awaited<ReturnType<ClassicRuntime["platform"]["modules"]["competitions"]["detail"]>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setState(null);
    view.platform.modules.competitions.detail(id, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [view.platform, id]);
  if (error) return <main className="fc-main"><PageTitle title={L("Competition", "مسابقه")} /><StatePanel status="error" error={error} locale={view.locale} /><div className="fc-inline-actions"><button className="btn-search" onClick={() => goLocal("/competitions")}>{L("Back to calendar", "بازگشت به تقویم")}</button></div></main>;
  if (!state) return <main className="fc-main"><PageTitle title={L("Competition", "مسابقه")} /><StatePanel status="loading" locale={view.locale} /></main>;
  const competition = state.competition;
  const results = state.results;
  return <main className="fc-main fei-fade-in">
    <PageTitle title={recordName(competition, view.locale)} subtitle={`${L("Competition", "مسابقه")} · #${competition.id}`} action={<div className="fc-title-buttons"><button className="fc-btn fc-btn-purple" onClick={() => goLocal("/competitions")}>{L("Back to calendar", "بازگشت به تقویم")}</button></div>} />
    <div className="fc-metric-grid">
      <div className="fc-metric"><span>{L("Discipline", "رشته")}</span><strong>{competition.discipline ?? "—"}</strong></div>
      <div className="fc-metric"><span>{L("Date", "تاریخ")}</span><strong className="nowrap">{competition.event_date ?? "—"}</strong></div>
      <div className="fc-metric"><span>{L("Venue", "محل")}</span><strong dir="auto">{[competition.venue, competition.city].filter(Boolean).join(" · ") || "—"}</strong></div>
      <div className="fc-metric"><span>{L("Tier", "سطح")}</span><strong>{competition.tier ?? "—"}</strong></div>
    </div>
    {results.length ? <Section title={L("Results", "نتایج")}><div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>{L("Placing", "مقام")}</th><th>{L("Horse", "اسب")}</th><th>{L("Rider", "سوارکار")}</th></tr></thead><tbody>{results.map(row => <tr key={row.id}>
      <td><strong>{row.placement ?? row.placement_text ?? "—"}</strong></td>
      <td>{row.horse_id ? <a href="#" onClick={event => { event.preventDefault(); view.navigate(horseDbRoutes.horse(row.horse_id!)); }} dir="auto">{recordName(row, view.locale)}</a> : <span dir="auto">{row.name_latin || row.name_native || "—"}</span>}</td>
      <td dir="auto">{row.rider_name ?? "—"}</td>
    </tr>)}</tbody></table></div></Section> : <StatePanel status="ready" empty={L("No results recorded for this competition.", "نتیجه‌ای برای این مسابقه ثبت نشده است.")} locale={view.locale} />}
  </main>;
}

/** Marketplace: listings grid + detail + inquiry (hidden prices stay hidden). */
export function FeiMarketPage({ view, goLocal, listingId }: { view: ClassicRuntime; goLocal: FeiGoLocal; listingId?: string }) {
  if (listingId) return <FeiListingDetail view={view} goLocal={goLocal} id={listingId} />;
  return <FeiMarketList view={view} goLocal={goLocal} />;
}

function FeiMarketList({ view, goLocal }: { view: ClassicRuntime; goLocal: FeiGoLocal }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const [rows, setRows] = useState<Awaited<ReturnType<ClassicRuntime["platform"]["modules"]["market"]["list"]>>["rows"] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    view.platform.modules.market.list({ limit: 12, offset }, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setRows(value.rows ?? []); setTotal(value.total); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [view.platform, offset]);
  const price = (row: { asking_price_toman: number | null; price_visible: number; negotiable: number }) => row.price_visible === 0 || row.asking_price_toman == null
    ? L("Price not published", "قیمت منتشر نشده")
    : `${num(row.asking_price_toman, view.locale)} ${L("Toman", "تومان")}${row.negotiable === 1 ? ` · ${L("negotiable", "قابل مذاکره")}` : ""}`;
  return <main className="fc-main fei-fade-in">
    <PageTitle title={L("Marketplace", "بازار")} subtitle={L("Canonical sales listings. Hidden prices stay hidden; nothing here is a valuation.", "آگهی‌های فروش مرجع. قیمت‌های پنهان پنهان می‌مانند؛ هیچ‌چیز اینجا ارزش‌گذاری نیست.")} />
    {view.user ? <FeiMarketLifecycle view={view} goLocal={goLocal} /> : null}
    {error ? <StatePanel status="error" error={error} locale={view.locale} /> : !rows ? <StatePanel status="loading" locale={view.locale} /> : rows.length === 0 ? <StatePanel status="ready" empty={L("No listings right now.", "در حال حاضر آگهی‌ای وجود ندارد.")} locale={view.locale} /> : <>
      <div className="fc-person-links">{rows.map(row => <button key={row.id} onClick={() => goLocal(`/market/${encodeURIComponent(row.id)}`)}>
        <strong dir="auto">{row.title || recordName(row, view.locale)}</strong>
        <span className="fc-muted">#{num(row.horse_id, view.locale)}{row.breed_desc ? ` · ${row.breed_desc}` : ""}{row.sex_desc ? ` · ${row.sex_desc}` : ""}</span>
        <em>{price(row)}</em>
        {<Badge>{listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at }, viewerRole: "public" }).effectiveStatus}</Badge>}
      </button>)}</div>
      <div className="fc-pagination"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 12))}>{L("Previous", "قبلی")}</button><span>{L("Offset", "شروع")} {num(offset, view.locale)} · {num(total, view.locale)}</span><button disabled={offset + 12 >= total} onClick={() => setOffset(offset + 12)}>{L("Next", "بعدی")}</button></div>
    </>}
  </main>;
}

function FeiListingDetail({ view, goLocal, id }: { view: ClassicRuntime; goLocal: FeiGoLocal; id: string }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const [state, setState] = useState<Awaited<ReturnType<ClassicRuntime["platform"]["modules"]["market"]["detail"]>> | null>(null);
  const [error, setError] = useState("");
  const [inquiry, setInquiry] = useState({ name: "", contact: "", note: "" });
  const [inquiryStatus, setInquiryStatus] = useState("");
  // R88 P03: after a listing conflict, controls stay disabled until a fresh
  // version loads (detail reload via reloadToken bump clears stale).
  const [stale, setStale] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
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
  }, [view.platform, id, reloadToken]);
  if (error) return <main className="fc-main"><PageTitle title={L("Listing", "آگهی")} /><StatePanel status="error" error={error} locale={view.locale} /><div className="fc-inline-actions"><button className="btn-search" onClick={() => goLocal("/market")}>{L("Back to marketplace", "بازگشت به بازار")}</button></div></main>;
  if (!state) return <main className="fc-main"><PageTitle title={L("Listing", "آگهی")} /><StatePanel status="loading" locale={view.locale} /></main>;
  const listing = state.listing;
  // R98-N12: honest lifecycle through the shared controller — FEI Classic never
  // renders an expired/suspended/mandate-expired listing as live, and the
  // introduction-only disclosure travels with the inquiry surface.
  const lifecycle = listingLifecycleView({
    listing: {
      status: listing.status,
      expires_at: listing.expires_at,
      suspended: (listing as { suspended?: boolean }).suspended,
      seller_mandate_current: (listing as { seller_mandate_current?: boolean | null }).seller_mandate_current,
    },
    viewerRole: "buyer",
  });
  const lifecycleNotice = lifecycle.suspended
    ? L("This listing is suspended by moderation; the horse's registry record is unaffected.", "این آگهی توسط مدیریت معلق شده است؛ رکورد ثبت اسب دست‌نخورده است.")
    // R108-06: malformed expiry gets an explicit localized explanation.
    : lifecycle.expiryStatus === "invalid"
      ? L("This listing's expiry date is invalid; actions are disabled until the seller corrects it.", "تاریخ انقضای این آگهی نامعتبر است؛ تا اصلاح آن توسط فروشنده امکان اقدام وجود ندارد.")
      : lifecycle.effectiveStatus === "expired"
      ? L("This listing has expired and no longer accepts new inquiries.", "این آگهی منقضی شده و درخواست جدید نمی‌پذیرد.")
      : lifecycle.effectiveStatus === "sold" || lifecycle.effectiveStatus === "withdrawn"
        ? L(`This listing is ${lifecycle.effectiveStatus}.`, "وضعیت این آگهی تغییر کرده است.")
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
        setReloadToken(value => value + 1);
      }
    }
  };
  return <main className="fc-main fei-fade-in">
    <PageTitle title={listing.title || recordName(listing, view.locale)} subtitle={`${L("Listing", "آگهی")} · #${id}`} action={<div className="fc-title-buttons"><button className="fc-btn fc-btn-purple" onClick={() => view.navigate(horseDbRoutes.horse(listing.horse_id))}>{L("Horse profile", "پروفایل اسب")}</button><button className="fc-btn" onClick={() => goLocal("/market")}>{L("Back to marketplace", "بازگشت به بازار")}</button></div>} />
    {lifecycleNotice ? <div className="fc-alert fc-alert-warning" role="status" dir="auto">{lifecycleNotice}</div> : null}
    <div className="fc-two-col">
      <Section title={L("Listing details", "جزئیات آگهی")}>
        <dl className="fc-detail-grid">
          <div><dt>{L("Asking price", "قیمت پیشنهادی")}</dt><dd><strong>{price}</strong></dd></div>
          <div><dt>{L("Status", "وضعیت")}</dt><dd>{lifecycle.effectiveStatus}</dd></div>
          <div><dt>{L("Seller", "فروشنده")}</dt><dd dir="auto">{listing.seller_contact_name || "—"}{listing.seller_city ? ` · ${listing.seller_city}` : ""}</dd></div>
          <div><dt>{L("Listed", "ثبت آگهی")}</dt><dd className="nowrap">{listing.listed_at || "—"}</dd></div>
          {listing.description ? <div><dt>{L("Description", "توضیح")}</dt><dd dir="auto">{listing.description}</dd></div> : null}
        </dl>
        {state.pedigree?.sire || state.pedigree?.dam ? <div className="fc-subhead">{L("Recorded parents", "والدین ثبت‌شده")}<div className="fc-detail-grid">
          {state.pedigree?.sire ? <div><dt>{L("Sire", "پدر")}</dt><dd dir="auto">{state.pedigree.sire.name_latin || state.pedigree.sire.name_native}</dd></div> : null}
          {state.pedigree?.dam ? <div><dt>{L("Dam", "مادر")}</dt><dd dir="auto">{state.pedigree.dam.name_latin || state.pedigree.dam.name_native}</dd></div> : null}
        </div></div> : null}
      </Section>
      <Section title={L("Send an inquiry", "ارسال استعلام")}>
        {/* R98-N12: the introduction-only disclosure travels with every inquiry surface. */}
        <p className="fc-muted" dir="auto">{view.locale === "fa" ? MARKETPLACE_DISCLOSURE.fa : MARKETPLACE_DISCLOSURE.en}</p>
        {view.user ? <div className="fc-inquiry-form">
          <label>{L("Your name", "نام شما")}<input dir="auto" disabled={stale} value={inquiry.name} onChange={event => setInquiry(current => ({ ...current, name: event.target.value }))} /></label>
          <label>{L("Phone / email", "تلفن / ایمیل")}<input dir="ltr" disabled={stale} value={inquiry.contact} onChange={event => setInquiry(current => ({ ...current, contact: event.target.value }))} /></label>
          <label>{L("Note", "یادداشت")}<textarea dir="auto" rows={3} disabled={stale} value={inquiry.note} onChange={event => setInquiry(current => ({ ...current, note: event.target.value }))} /></label>
          <button className="btn-search" disabled={stale || lifecycle.sellerMandateCurrent === false || lifecycle.suspended} onClick={() => void submitInquiry()}>{stale ? L("Reloading listing…", "بارگذاری مجدد آگهی…") : L("Send inquiry", "ارسال استعلام")}</button>
          {inquiryStatus && <p role="status" dir="auto">{inquiryStatus}</p>}
        </div> : <p className="fc-muted">{L("Sign in to send an inquiry to the seller.", "برای ارسال استعلام وارد شوید.")}</p>}
      </Section>
    </div>
  </main>;
}

/** R117-15 (Master AI R117 handoff D19): the signed-in market lifecycle —
 * the seller's own listings + received-inquiry inbox, the buyer's OWN sent
 * inquiries, and the buyer's watchlist — bound to the ONE shared headless
 * controller (never a per-skin reimplementation). Versioned writes send the
 * row version the renderer read, so a stale write is an honest 409, never a
 * blind overwrite; each sent row reports the listing's CURRENT status
 * honestly (sold/withdrawn/expired say so) while its conversation history
 * stays reachable for both participants. */
const FEI_INQUIRY_STATUS_LABEL: Record<string, [string, string]> = {
  new: ["new", "جدید"],
  contacted: ["contacted", "تماس‌گرفته‌شده"],
  closed: ["closed", "بسته"],
};

function FeiMarketLifecycle({ view, goLocal }: { view: ClassicRuntime; goLocal: FeiGoLocal }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const user = view.user;
  const scope = usePrincipalScope(user, null);
  const { mine, retry } = useMyMarketplace({ platform: view.platform, scope, userId: user?.id });
  const { sent, retry: retrySent } = useSentInquiries({ platform: view.platform, scope, userId: user?.id });
  const { watchlist, retry: retryWatchlist } = useWatchlist({ platform: view.platform, scope, userId: user?.id });
  const commands = useMarketplaceLifecycleCommands(scope);
  if (!user) return null;
  return <section className="fc-section" data-surface="market-lifecycle" aria-label={L("My listings and inquiries", "آگهی‌ها و درخواست‌های من")}>
    <Section title={L("My listings and inquiries", "آگهی‌ها و درخواست‌های من")}>
      <p className="fc-muted" dir="auto">{L("The marketplace is an introduction surface — no payment, delivery or ownership transfer happens here. Status changes are versioned; a changed row is reloaded before your edit can land.", "بازار فقط سطح آشنایی است — هیچ پرداخت، تحویل یا انتقال مالکیتی اینجا انجام نمی‌شود. تغییر وضعیت نسخه‌دار است؛ ردیف تغییرکرده پیش از اعمال ویرایش شما بازخوانی می‌شود.")}</p>
      {mine.phase === "loading" ? <StatePanel status="loading" locale={view.locale} /> : null}
      {mine.phase === "forbidden" || mine.phase === "unavailable" || mine.phase === "error" ? <StatePanel status="error" error={mine.reason} locale={view.locale} /> : null}
      {mine.phase === "empty" ? <p className="fc-muted">{L("You have no listings and no received inquiries yet.", "هنوز آگهی یا درخواستی ندارید.")}</p> : null}
      {(mine.phase === "ready" || mine.phase === "reloading") && mine.listings.length ? <div className="fc-person-links" data-surface="market-seller-listings">{mine.listings.map(row => {
        const lifecycle = listingLifecycleView({ listing: { status: row.status, expires_at: row.expires_at ?? null, seller_mandate_current: null }, viewerRole: "seller" });
        const allowed = (LISTING_LIFECYCLE[lifecycle.effectiveStatus] ?? []).filter((status: string) => status !== "expired");
        return <div key={row.id} className="fc-detail-grid" data-surface="market-seller-listing" style={{ border: "1px solid #d8d2c3", padding: "8px", borderRadius: "4px" }}>
          <div><dt>{L("Listing", "آگهی")}</dt><dd dir="auto"><strong>{row.title || recordName(row, view.locale)}</strong></dd></div>
          <div><dt>{L("Status", "وضعیت")}</dt><dd>{lifecycle.effectiveStatus} · v{num(row.row_version ?? 0, view.locale)}</dd></div>
          <div><dt>{L("Horse", "اسب")}</dt><dd>#{num(row.horse_id, view.locale)}</dd></div>
          <div className="fc-inline-actions">
            <button className="fc-btn" onClick={() => goLocal(`/market/${encodeURIComponent(row.id)}`)}>{L("View listing", "دیدن آگهی")}</button>
            {allowed.map((status: string) => <button key={status} className="fc-btn" disabled={commands.setStatus.state.phase === "submitting"} onClick={() => { void commands.setStatus.run(async () => {
              const result = await view.platform.modules.market.setStatus(row.id, status, { expectedVersion: row.row_version ?? 0 });
              retry(); return result;
            }, { successMessage: L("Listing status updated (versioned).", "وضعیت آگهی به‌روزرسانی شد (نسخه‌دار).") }); }}>{L(`Mark ${status}`, `علامت ${status}`)}</button>)}
          </div>
        </div>;
      })}</div> : null}
      {(mine.phase === "ready" || mine.phase === "reloading") && mine.inquiries.length ? <div data-surface="market-inquiry-inbox" style={{ marginTop: "12px" }}>
        <div className="fc-subhead">{L("Inquiries received on your listings", "درخواست‌های دریافتی روی آگهی‌های شما")}</div>
        <ul className="fc-person-links">{mine.inquiries.map((inquiry) => <FeiInquiryRow key={String(inquiry.id)} view={view} inquiry={inquiry} commands={commands} onDone={retry} seller />)}</ul>
      </div> : null}
      {commands.setStatus.state.phase === "rejected" || commands.renew.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The listing changed elsewhere — the current version was reloaded; retry with the fresh version.", "آگهی جای دیگر تغییر کرده — نسخه فعلی بازخوانی شد؛ با نسخه تازه دوباره تلاش کنید.")}</p> : null}
    </Section>
    <Section title={L("My sent inquiries", "درخواست‌های ارسالی من")}>
      {sent.phase === "loading" ? <StatePanel status="loading" locale={view.locale} /> : null}
      {sent.phase === "forbidden" || sent.phase === "unavailable" || sent.phase === "error" ? <StatePanel status="error" error={sent.reason} locale={view.locale} /> : null}
      {sent.phase === "empty" ? <p className="fc-muted">{L("You have not sent any inquiries yet — open a listing and ask the seller a question.", "هنوز درخواستی ارسال نکرده‌اید — یک آگهی را باز کنید و از فروشنده سؤال بپرسید.")}</p> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length ? <ul className="fc-person-links" data-surface="market-sent-inquiries">{(sent.rows as unknown as Array<Record<string, unknown>>).map(row => <FeiInquiryRow key={String(row.id)} view={view} inquiry={row} commands={commands} onDone={retrySent} seller={false} />)}</ul> : null}
      {(sent.phase === "ready" || sent.phase === "reloading") && sent.rows.length < sent.pagination.total ? <p className="fc-muted">{L(`Showing the newest ${sent.rows.length} of ${sent.pagination.total} sent inquiries.`, `نمایش ${sent.rows.length} درخواست آخر از ${sent.pagination.total} درخواست ارسالی.`)}</p> : null}
    </Section>
    <Section title={L("My watchlist", "فهرست پیگیری من")}>
      {watchlist.phase === "loading" ? <StatePanel status="loading" locale={view.locale} /> : null}
      {watchlist.phase === "empty" ? <p className="fc-muted">{L("No saved listings yet — watch a listing to keep it here.", "هنوز آگهی ذخیره‌شده‌ای نیست — آگهی‌ای را دنبال کنید تا اینجا بماند.")}</p> : null}
      {(watchlist.phase === "ready" || watchlist.phase === "reloading") && watchlist.rows.length ? <ul className="fc-person-links" data-surface="market-watchlist">{watchlist.rows.map((row) => <li key={String(row.listing_id ?? row.id)} data-surface="market-watchlist-row">
        <div className="fc-detail-grid">
          <div><dt>{L("Watching", "در حال پیگیری")}</dt><dd dir="auto"><strong>{view.locale === "fa" && row.name_native ? String(row.name_native) : String(row.name_latin ?? row.title ?? `#${row.listing_id ?? row.id}`)}</strong></dd></div>
          <div><dt>{L("Listing status", "وضعیت آگهی")}</dt><dd>{String(row.status ?? "—")}</dd></div>
          <div className="fc-inline-actions">
            <button className="fc-btn" onClick={() => goLocal(`/market/${encodeURIComponent(String(row.listing_id ?? row.id))}`)}>{L("Open listing", "باز کردن آگهی")}</button>
            <button className="fc-btn" disabled={commands.watch.state.phase === "submitting"} onClick={() => { void commands.watch.run(async () => {
              const result = await view.platform.modules.market.unwatch(String(row.listing_id ?? row.id));
              retryWatchlist(); return result;
            }, { successMessage: L("Removed from your watchlist.", "از فهرست پیگیری شما حذف شد.") }); }}>{L("Unwatch", "حذف پیگیری")}</button>
          </div>
        </div>
      </li>)}</ul> : null}
    </Section>
  </section>;
}

/** ONE inquiry row (seller inbox or buyer sent): the participant-only
 * conversation with reply, the versioned inquiry status for the seller, and
 * the buyer's own close action. */
function FeiInquiryRow({ view, inquiry, commands, onDone, seller }: {
  view: ClassicRuntime; inquiry: Record<string, unknown>; commands: ReturnType<typeof useMarketplaceLifecycleCommands>; onDone: () => void; seller: boolean;
}) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
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
  return <li data-surface="market-inquiry-row" style={{ border: "1px solid #d8d2c3", padding: "8px", borderRadius: "4px", listStyle: "none" }}>
    <div className="fc-detail-grid">
      <div><dt>{seller ? L("Buyer", "خریدار") : L("Listing", "آگهی")}</dt><dd dir="auto"><strong>{seller ? String(inquiry.buyer_name ?? (listingTitle || horseLabel || id)) : (listingTitle || horseLabel || id)}</strong></dd></div>
      <div><dt>{L("Inquiry", "درخواست")}</dt><dd>{FEI_INQUIRY_STATUS_LABEL[status]?.[view.locale === "fa" ? 1 : 0] ?? status}{listingStatus ? ` · ${L("listing", "آگهی")} ${listingStatus}` : ""}{replyCount > 0 ? ` · ${replyCount} ${L("replies", "پاسخ")}` : ""}{inquiry.created_at ? ` · ${String(inquiry.created_at).slice(0, 10)}` : ""}</dd></div>
      <div className="fc-inline-actions">
        <button className="fc-btn" onClick={() => setOpen(value => !value)}>{open ? L("Hide conversation", "پنهان‌کردن تبادل پیام") : L("Conversation", "تبادل پیام")}</button>
        {seller && !closed ? <button className="fc-btn" disabled={commands.setInquiryStatus.state.phase === "submitting"} onClick={() => { void commands.setInquiryStatus.run(async () => {
          const result = await view.platform.modules.market.setInquiryStatus(id, status === "new" ? "contacted" : "closed", { expectedVersion: Number(inquiry.row_version ?? 0) });
          onDone(); return result;
        }, { successMessage: L("Inquiry status updated (versioned).", "وضعیت درخواست به‌روزرسانی شد (نسخه‌دار).") }); }}>{status === "new" ? L("Mark contacted", "تماس‌گرفته‌شده") : L("Close inquiry", "بستن درخواست")}</button> : null}
        {!seller && !closed ? <button className="fc-btn" disabled={commands.closeOwnInquiry.state.phase === "submitting"} onClick={() => { void commands.closeOwnInquiry.run(async () => {
          const result = await view.platform.modules.market.closeOwnInquiry(id, { expectedVersion: Number(inquiry.row_version ?? 0) });
          onDone(); return result;
        }, { successMessage: L("Your inquiry is closed. No further replies are accepted.", "درخواست شما بسته شد. پاسخ دیگری پذیرفته نمی‌شود.") }); }}>{L("Close my inquiry", "بستن درخواست من")}</button> : null}
      </div>
    </div>
    {open ? <div data-surface="market-conversation" style={{ marginTop: "8px" }}>
      {conversation.phase === "loading" ? <StatePanel status="loading" locale={view.locale} /> : null}
      {conversation.phase === "forbidden" ? <p role="alert" className="fc-muted">{L("Only the participants can read this conversation.", "فقط طرف‌های درخواست می‌توانند این تبادل پیام را بخوانند.")}</p> : null}
      {conversation.phase === "not_found" ? <p role="alert" className="fc-muted">{L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.")}</p> : null}
      {conversation.phase === "error" ? <StatePanel status="error" error={conversation.error.kind === "not_found" ? L("This inquiry is no longer available.", "این درخواست دیگر در دسترس نیست.") : conversation.error.message} locale={view.locale} /> : null}
      {(conversation.phase === "ready" || conversation.phase === "sending") ? (conversation.thread.entries.length ? <ul className="fc-person-links">{conversation.thread.entries.map(entry => <li key={entry.id}><strong>{entry.side}</strong> <small>{entry.createdAt}</small><p dir="auto">{entry.body}</p></li>)}</ul> : <p className="fc-muted">{L("No messages yet.", "هنوز پیامی نیست.")}</p>) : null}
      {!closed ? <div className="fc-inquiry-form">
        <label>{L("Reply", "پاسخ")}<input dir="auto" maxLength={4000} value={replyBody} disabled={commands.reply.state.phase === "submitting"} onChange={event => setReplyBody(event.target.value)} /></label>
        <button className="btn-search" disabled={commands.reply.state.phase === "submitting" || replyBody.trim().length < 1} onClick={() => { void commands.reply.run(async () => {
          const result = await view.platform.modules.market.reply(id, { body: replyBody.trim() });
          setReplyBody(""); onDone(); return result;
        }, { successMessage: L("Reply sent to the conversation.", "پاسخ در تبادل پیام ارسال شد.") }); }}>{L("Send reply", "ارسال پاسخ")}</button>
      </div> : <p className="fc-muted">{L("This inquiry is closed — the conversation is read-only history.", "این درخواست بسته است — تبادل پیام فقط تاریخچه خواندنی است.")}</p>}
      {commands.setInquiryStatus.state.phase === "rejected" || commands.closeOwnInquiry.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The inquiry changed elsewhere — reload its current version and retry.", "درخواست جای دیگر تغییر کرده — نسخه فعلی را بازخوانی و دوباره تلاش کنید.")}</p> : null}
    </div> : null}
  </li>;
}


/** R117-16 (Master AI R117 handoff D24): the truthful credential story on the
 * FEI horse record — the PUBLIC read projection + PUBLIC verification states,
 * the member-scoped issue form, the owner-scoped revoke/supersede and the
 * PRIVATE snapshot review, bound to the ONE shared headless controller. No
 * demo badge implies real federation, ownership or laboratory approval. */
const FEI_VERIFY_STATE_LABEL: Record<string, [string, string]> = {
  current: ["Current — sources unchanged since issuance", "معتبر — منابع از زمان صدور تغییر نکرده‌اند"],
  expired: ["Expired — the validity window has passed; the recorded snapshot is preserved", "منقضی — پنجره اعتبار گذشته است؛ تصویر ثبت‌شده حفظ می‌شود"],
  revoked: ["Revoked by the issuer; the recorded snapshot is preserved", "لغوشده توسط مرجع؛ تصویر ثبت‌شده حفظ می‌شود"],
  superseded: ["Superseded by a newer attestation of the same record", "جایگزین‌شده توسط تأیید جدیدتر همان رکورد"],
  source_changed: ["Source record changed after issuance — the attested snapshot no longer matches", "رکورد منبع بعد از صدور تغییر کرده — تصویر تأییدشده دیگر منطبق نیست"],
  snapshot_tampered: ["Snapshot digest mismatch — the stored evidence fails its own integrity check", "عدم تطابق چکیده تصویر — شواهد ذخیره‌شده در بررسی یکپارچگی خودش مردود است"],
  unbound_legacy: ["Legacy record without a bound snapshot; requires review", "رکورد قدیمی بدون تصویر پیوند‌شده؛ نیازمند بررسی"],
};

function FeiCredentialStories({ view, horseId }: { view: ClassicRuntime; horseId: number }) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
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
  return <section className="fc-section" data-surface="credential-stories" aria-label={L("Issuer credentials", "اعتبارنامه‌های مرجع")}>
    <Section title={L("Issuer credentials", "اعتبارنامه‌های مرجع")} tone="purple">
      <p className="fc-muted" dir="auto">{L("Statements issued by named external issuers within a narrow approved scope. On this synthetic instance every issuer is explicitly fictional — no badge here implies real federation, ownership or laboratory approval.", "اظهارات صادره از مراجع مشخص در محدوده تأییدشده محدود. در این نمونه ساختگی همه مراجع صراحتاً خیالی‌اند — هیچ نشان اینجا به معنای فدراسیون واقعی، مالکیت یا تأیید آزمایشگاهی نیست.")}</p>
      {stories.phase === "loading" ? <StatePanel status="loading" locale={view.locale} /> : null}
      {stories.phase === "forbidden" || stories.phase === "unavailable" || stories.phase === "error" ? <StatePanel status="error" error={stories.reason} locale={view.locale} /> : null}
      {stories.phase === "empty" ? <p className="fc-muted">{L("No issuer credential is recorded for this horse yet. Registry data shown here is platform-reviewed at most — reviewed is not issuer-attested.", "هنوز اعتبارنامه‌ای از مرجع بیرونی برای این اسب ثبت نشده است. داده‌های اینجا حداکثر توسط کارشناسان سامانه بررسی شده است — بررسی سامانه همان تأیید مرجع نیست.")}</p> : null}
      {(stories.phase === "ready" || stories.phase === "reloading") && stories.rows.length ? <ul className="fc-person-links" data-surface="credential-rows">{stories.rows.map(row => <FeiCredentialRow key={row.id} view={view} row={row} commands={commands} onChanged={retry} />)}</ul> : null}
      {user ? <div className="fc-detail-grid" data-surface="credential-issue" style={{ border: "1px solid #d8d2c3", padding: "8px", borderRadius: "4px", marginTop: "10px" }}>
        <div className="fc-subhead">{L("Attest under an issuer (member-scoped)", "صدور تأیید به نام یک مرجع (محدود به عضو)")}</div>
        <p className="fc-muted">{L("You may attest only under an issuer that granted you an active membership, and only within its narrow approved scope — the server refuses anything else.", "فقط مرجعی که به شما عضویت فعال داده و فقط در محدوده تأییدشده محدود آن می‌توانید تأیید صادر کنید — سرور هر چیز دیگر را رد می‌کند.")}</p>
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
        <div className="fc-inline-actions">
          <button className="fc-btn fc-btn-purple" disabled={commands.issue.state.phase === "submitting" || !issuerId || !recordId.trim()} onClick={() => { void commands.issue.run(async () => {
            const result = await view.platform.modules.attestations.issue(issuerId, { record_kind: recordKind, record_id: recordId.trim(), statement: statement.trim() || null, expires_at: expiresAt.trim() || null });
            setStatement(""); setExpiresAt(""); retry(); return result;
          }, { successMessage: L("Credential issued with an immutable server-derived snapshot.", "اعتبارنامه با تصویر برگرفته از سرور و تغییرناپذیر صادر شد.") }); }}>{L("Issue credential", "صدور اعتبارنامه")}</button>
        </div>
        {commands.issue.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The issuer refused this issuance — membership, narrow scope, record or evidence rules.", "مرجع این صدور را رد کرد — عضویت، محدوده محدود، رکورد یا قواعد شواهد.")}</p> : null}
      </div> : null}
    </Section>
  </section>;
}

/** ONE public credential row: verify panel + owner actions + private snapshot review. */
function FeiCredentialRow({ view, row, commands, onChanged }: {
  view: ClassicRuntime; row: CredentialStoryRow; commands: ReturnType<typeof useCredentialStoryCommands>; onChanged: () => void;
}) {
  const L = (en: string, fa: string) => t(view.locale, en, fa);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [snapshot, setSnapshot] = useState<{ phase: "idle" } | { phase: "granted"; digest: string } | { phase: "refused" }>({ phase: "idle" });
  const { verification, retry: retryVerify } = useAttestationVerification({ platform: view.platform, scope: `credential:${row.id}`, attestationId: verifyOpen ? row.id : null });
  const effective = row.effective_status || row.status;
  return <li data-surface="credential-row" data-attestation-id={row.id} style={{ border: "1px solid #d8d2c3", padding: "8px", borderRadius: "4px", listStyle: "none" }}>
    <div className="fc-detail-grid">
      <div><dt>{L("Issuer", "مرجع")}</dt><dd dir="auto"><strong>{view.locale === "fa" && row.issuer.name_native ? row.issuer.name_native : row.issuer.name}</strong> <small>{row.issuer.kind}</small></dd></div>
      <div><dt>{L("Record", "رکورد")}</dt><dd>{row.record_kind} · #{row.record_id}</dd></div>
      <div><dt>{L("Status", "وضعیت")}</dt><dd>{effective}{row.expires_at ? ` · ${L("valid until", "اعتبار تا")} ${row.expires_at.slice(0, 10)}` : ""}</dd></div>
      <div><dt>{L("Issued", "صدور")}</dt><dd>{row.issued_at.slice(0, 10)}</dd></div>
    </div>
    <p className="fc-muted">{L("Public metadata only — the statement and scope stay private to authorized review.", "فقط فراداده عمومی — اظهار و محدوده برای بررسی مجاز خصوصی می‌ماند.")}</p>
    <div className="fc-inline-actions">
      <button className="fc-btn" onClick={() => setVerifyOpen(value => !value)}>{verifyOpen ? L("Hide verification", "پنهان‌کردن راستی‌آزمایی") : L("Verify", "راستی‌آزمایی")}</button>
      {view.user ? <button className="fc-btn" onClick={() => setActionsOpen(value => !value)}>{actionsOpen ? L("Hide owner actions", "پنهان‌کردن اقدامات مالک") : L("Owner actions", "اقدامات مالک")}</button> : null}
      {view.user ? <button className="fc-btn" onClick={async () => { setSnapshot({ phase: "idle" }); const outcome = await runSnapshotReview(view.platform, row.id); setSnapshot(outcome.phase === "granted" ? { phase: "granted", digest: String((outcome.review.snapshot as Record<string, unknown>).content_digest ?? "") } : { phase: "refused" }); }}>{L("Review snapshot (private)", "بازبینی تصویر (خصوصی)")}</button> : null}
    </div>
    {verifyOpen ? <div data-surface="credential-verify" style={{ marginTop: "8px" }}>
      {verification.phase === "loading" ? <StatePanel status="loading" locale={view.locale} /> : null}
      {verification.phase === "not_found" || verification.phase === "forbidden" || verification.phase === "unavailable" || verification.phase === "error" ? <div role="alert"><p className="fc-muted">{L("Verification is unavailable right now.", "راستی‌آزمایی الان در دسترس نیست.")}</p>{verification.phase !== "not_found" ? <p dir="auto" className="fc-muted">{verification.reason}</p> : null}<button className="fc-btn" onClick={retryVerify}>{L("Retry", "تلاش دوباره")}</button></div> : null}
      {(verification.phase === "ready" || verification.phase === "reloading") ? <div className="fc-detail-grid">
        <div><dt>{L("State", "وضعیت")}</dt><dd>{FEI_VERIFY_STATE_LABEL[verification.verification.verification_state]?.[view.locale === "fa" ? 1 : 0] ?? verification.verification.verification_state}</dd></div>
        <div><dt>{L("Effective status", "وضعیت مؤثر")}</dt><dd>{verification.verification.effective_status}</dd></div>
        {verification.verification.snapshot ? <div><dt>{L("Snapshot digest", "چکیده تصویر")}</dt><dd><code>{verification.verification.snapshot.content_digest.slice(0, 16)}…</code></dd></div> : null}
        {verification.verification.source_detail ? <div><dt>{L("Changed sources", "منابع تغییرکرده")}</dt><dd>{(verification.verification.source_detail.changed_tables ?? []).join(", ")}</dd></div> : null}
        <p className="fc-muted" dir="auto">{verification.verification.note}</p>
      </div> : null}
    </div> : null}
    {actionsOpen && view.user ? <div data-surface="credential-owner-actions" style={{ marginTop: "8px" }}>
      <p className="fc-muted">{L("Revocation and supersession are issuer-owner (or platform content-manager) commands. A reason is required; the recorded snapshot is never rewritten.", "لغو و جایگزینی فرمان مالک مرجع (یا مدیر محتوای سامانه) است. دلیل الزامی است؛ تصویر ثبت‌شده هرگز بازنویسی نمی‌شود.")}</p>
      <label>{L("Reason", "دلیل")}<input dir="auto" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label>{L("Replacement statement (for supersede)", "اظهار جایگزین (برای جایگزینی)")}<input dir="auto" maxLength={2000} value={replacement} onChange={event => setReplacement(event.target.value)} /></label>
      <div className="fc-inline-actions">
        <button className="fc-btn" disabled={commands.revoke.state.phase === "submitting" || reason.trim().length < 3 || row.status !== "active"} onClick={() => { void commands.revoke.run(async () => {
          const result = await view.platform.modules.attestations.revoke(row.id, { reason: reason.trim() });
          setReason(""); onChanged(); return result;
        }, { successMessage: L("Credential revoked — the current status changed; the snapshot is preserved.", "اعتبارنامه لغو شد — وضعیت فعلی تغییر کرد؛ تصویر حفظ می‌شود.") }); }}>{L("Revoke", "لغو")}</button>
        <button className="fc-btn" disabled={commands.supersede.state.phase === "submitting" || reason.trim().length < 3 || replacement.trim().length < 1 || row.status !== "active"} onClick={() => { void commands.supersede.run(async () => {
          const result = await view.platform.modules.attestations.supersede(row.id, { reason: reason.trim(), replacement: { record_kind: row.record_kind, record_id: row.record_id, statement: replacement.trim() } });
          setReason(""); setReplacement(""); onChanged(); return result;
        }, { successMessage: L("Superseded — a replacement was issued; the history stays visible.", "جایگزین شد — اعتبارنامه جدید صادر شد؛ تاریخچه قابل مشاهده می‌ماند.") }); }}>{L("Supersede with replacement", "جایگزینی با نسخه جدید")}</button>
      </div>
      {commands.revoke.state.phase === "rejected" || commands.supersede.state.phase === "rejected" ? <p role="alert" dir="auto">{L("The command was refused — authority, state or version rules. The recorded history is unchanged.", "فرمان رد شد — قواعد اختیار، وضعیت یا نسخه. تاریخچه ثبت‌شده تغییر نکرد.")}</p> : null}
    </div> : null}
    {snapshot.phase !== "idle" ? <div data-surface="credential-snapshot-review" style={{ marginTop: "8px" }}>
      {snapshot.phase === "granted" ? <p className="fc-muted">{L("Private snapshot review: authorized — full bytes stay private; digest", "بازبینی خصوصی تصویر: مجاز — بایت‌های کامل خصوصی می‌مانند؛ چکیده")} <code>{snapshot.digest.slice(0, 16)}…</code></p> : <p className="fc-muted" role="alert">{L("Refused — only platform content managers or the issuer's active owner may review the full snapshot.", "رد شد — فقط مدیران محتوای سامانه یا مالک فعال مرجع می‌توانند تصویر کامل را بازبینی کنند.")}</p>}
    </div> : null}
  </li>;
}
