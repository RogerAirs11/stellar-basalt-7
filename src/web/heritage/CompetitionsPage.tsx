import { HERITAGE_DECORATION } from "../assetCatalog";
import React, { useEffect, useRef, useState } from "react";
import type { CompetitionRecord, CompetitionDetailResponse, PlatformClient } from "../../contracts/platform";
import { useI18n } from "../i18n";
import { uiText } from "../../shared/uiLocale";
import { localizedDigits } from "./presentationLocale";
import { COMPETITION_PAGE_SIZE, MAX_COMPETITION_OFFSET, competitionId, persianYearAt } from "./competitionPresentation";

const DISCIPLINE_LABEL: Record<string, readonly [string, string]> = {
  show_jumping: ["Show jumping", "پرش با اسب"],
  dressage: ["Dressage", "درساژ"],
  endurance: ["Endurance", "استقامت"],
  racing: ["Racing", "اسب‌دوانی"],
  eventing: ["Eventing", "سه‌روزه"],
  halter: ["Beauty show (halter)", "جشنواره زیبایی (هالتر)"],
  freestyle: ["Freestyle", "نمایش آزاد"],
};
const TIER_LABEL: Record<string, readonly [string, string]> = {
  local: ["Local", "محلی"], regional: ["Regional", "استانی"],
  national: ["National", "کشوری"], international: ["International", "بین‌المللی"],
};

/** R126a semantic visual encoding — one stable hue per discipline (the nav-group
 *  hue family), medal metals for placements, and gold intensity for tier
 *  prestige. All of it is expressed through data-discipline / data-tier /
 *  data-place attributes so the CSS owns the palette and light/dark tuning. */
function placeClass(placement: number | null, eliminated: number, withdrawn: number): string {
  if (placement == null) {
    if (Number(eliminated) === 1) return "eliminated";
    if (Number(withdrawn) === 1) return "withdrawn";
    return "";
  }
  if (placement === 1) return "gold";
  if (placement === 2) return "silver";
  if (placement === 3) return "bronze";
  return "";
}

export function HeritageCompetitionsPage({ navigate, platform, initialId }: {
  navigate: (path: string) => void; platform: PlatformClient; initialId?: number;
}) {
  const { locale, n } = useI18n();
  const L = (en: string, fa: string) => uiText(locale, en, fa);
  const [rows, setRows] = useState<CompetitionRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState(false);
  const [listRetry, setListRetry] = useState(0);
  const [detailError, setDetailError] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [offset, setOffset] = useState(0);
  const [discipline, setDiscipline] = useState("");
  const [season, setSeason] = useState("");
  const [selected, setSelected] = useState<number | null>(() => competitionId(initialId));
  const [detail, setDetail] = useState<CompetitionDetailResponse | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // R143-C03: request-generation guard for the results load-more — if the
  // user switches events while a cursor page is in flight, the stale
  // response must never land under the new event.
  const selectedRef = useRef<number | null>(selected);
  selectedRef.current = selected;
  const detailGeneration = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  // R135: the filter chrome starts collapsed on phones (CSS decides which
  // viewport sees the drawer) — the calendar itself is the content.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const shouldReveal = useRef(false);
  const currentYear = persianYearAt();
  const label = (labels: Record<string, readonly [string, string]>, value: string) => {
    const pair = labels[value];
    return pair ? L(pair[0], pair[1]) : value;
  };

  useEffect(() => { setSelected(competitionId(initialId)); }, [initialId]);
  useEffect(() => {
    const controller = new AbortController();
    setRows(null); setListError(false);
    platform.modules.competitions.list({
      discipline: discipline || undefined, season: season ? Number(season) : undefined,
      limit: COMPETITION_PAGE_SIZE, offset,
    }, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        if (offset > 0 && value.total === 0) { setOffset(0); return; }
        if (offset > 0 && value.total > 0 && offset >= value.total) {
          setOffset(Math.floor((value.total - 1) / COMPETITION_PAGE_SIZE) * COMPETITION_PAGE_SIZE);
          return;
        }
        setRows(value.rows); setTotal(value.total);
      })
      .catch(() => { if (!controller.signal.aborted) setListError(true); });
    return () => controller.abort();
  }, [discipline, season, offset, platform, listRetry]);

  useEffect(() => {
    detailGeneration.current += 1;
    moreController.current?.abort();
    moreController.current = null;
    setDetail(null); setDetailError(false); setMoreError(false); setLoadingMore(false);
    if (selected == null) return;
    const controller = new AbortController();
    platform.modules.competitions.detail(selected, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setDetail(value); })
      .catch(() => { if (!controller.signal.aborted) setDetailError(true); });
    return () => { controller.abort(); moreController.current?.abort(); };
  }, [selected, platform, detailRetry]);

  // R124 (R122-T05): walk the keyset pages so the event detail shows the
  // COMPLETE result list instead of a disclosed 500-row window.
  // R143-C03: the cursor request is bound to the event it was opened for —
  // a delayed response for event A is dropped once event B is selected, and
  // appended rows are deduplicated by id so an ambiguous retry can never
  // duplicate a result row.
  const loadMoreResults = () => {
    if (selected == null || detail == null || loadingMore) return;
    const requestedId = selected;
    const generation = detailGeneration.current;
    const cursor = detail.results_page?.next_cursor;
    if (!cursor) return;
    const controller = new AbortController();
    moreController.current = controller;
    const isCurrent = () => !controller.signal.aborted && selectedRef.current === requestedId && detailGeneration.current === generation;
    setLoadingMore(true); setMoreError(false);
    platform.modules.competitions.detail(selected, { resultsCursor: cursor, resultsLimit: 200, signal: controller.signal })
      .then(next => {
        if (!isCurrent() || next.competition.id !== requestedId) return;
        setDetail(previous => {
          if (previous == null || previous.competition?.id !== requestedId) return previous;
          const seen = new Set(previous.results.map(row => row.id));
          const fresh = next.results.filter(row => {
            if (row.competition_id !== requestedId || seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
          });
          return { ...previous, results: [...previous.results, ...fresh], results_page: next.results_page };
        });
      })
      .catch(() => { if (isCurrent()) setMoreError(true); })
      .finally(() => { if (isCurrent()) { setLoadingMore(false); moreController.current = null; } });
  };

  useEffect(() => {
    if (selected == null || !shouldReveal.current) return;
    shouldReveal.current = false;
    const frame = requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  const closeDetail = () => {
    setSelected(null);
    requestAnimationFrame(() => { if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: false }); });
  };
  const pages = Math.max(1, Math.ceil(total / COMPETITION_PAGE_SIZE));
  const nextOffset = offset + COMPETITION_PAGE_SIZE;

  return <main className={`page h-mod-competitions-page${selected != null ? " has-detail" : ""}`}>
    <header className="h-mod-page-head premium-page-head" data-h-surface-role="major">
      <div>
        <div className="eyebrow"><span className="eyebrow-rule"/>{L("COMPETITIONS", "مسابقات")}</div>
        <h1>{L("Competition calendar & results", "تقویم و نتایج مسابقات")}</h1>
        <p>{L("Explore events, open the results, and follow each horse back to its registry record.", "رویدادها و نتایج را بررسی کنید و رکورد هر اسب را در سامانه ثبت ببینید.")}</p>
      </div>
      <div className="h-mod-count" data-discipline={discipline || undefined}><small>{L("matching events", "رویدادهای مطابق")}</small><strong>{rows === null || listError ? "—" : n(total)}</strong><span>{L("in the calendar", "در تقویم")}</span></div>
      <img className="page-head-ornament" src={HERITAGE_DECORATION.divider} alt=""/>
    </header>
    <p className="h-mod-provenance page-level">{rows?.length && rows.every(row => row.provenance === "demo")
      ? L("These events are synthetic examples. They are not official competition results.", "این رویدادها نمونه‌های آزمایشی هستند و نتایج رسمی مسابقات نیستند.")
      : L("Each event shows its recorded source. An entry in this calendar does not by itself confirm official approval.", "منبع ثبت‌شده هر رویداد نمایش داده می‌شود. حضور در این تقویم به‌تنهایی به معنی تأیید رسمی نیست.")}</p>
    <section className="h-mod-panel h-mod-competitions-panel" data-h-surface-role="panel">
      {/* R135: filter chrome collapses behind one quiet chip row on phones;
          desktop keeps the always-open rail. The legend is phone-hidden —
          the chips themselves carry the hue encoding. */}
      {/* R126a: the discipline filter is a hue-coded chip rail — each discipline
          keeps one stable colour everywhere on the page (filter, list, detail)
          so the encoding is learnable, not decorative. The season stays a
          select because numeric years have no natural hue. */}
      <div className={`h-mod-filter-drawer${filtersOpen ? " open" : ""}`}>
        <button type="button" className="h-mod-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>
          <span aria-hidden="true">⚙</span>
          <span>{L("Filter", "فیلتر")}</span>
          <b aria-hidden="true">{filtersOpen ? "−" : "+"}</b>
        </button>
        <div className="h-mod-filter-body">
      <div className="h-mod-filters">
        <div className="h-mod-chip-rail" role="group" aria-label={L("Filter by discipline", "فیلتر بر اساس رشته")}>
          <button type="button" className={`h-mod-chip h-mod-chip-all${discipline === "" ? " active" : ""}`} aria-pressed={discipline === ""} onClick={() => { setDiscipline(""); setOffset(0); }}>
            <span className="chip-dot" aria-hidden="true"/>
            <span>{L("All disciplines", "همه رشته‌ها")}</span>
          </button>
          {Object.keys(DISCIPLINE_LABEL).map(key => <button type="button" key={key} className={`h-mod-chip${discipline === key ? " active" : ""}`} data-discipline={key} aria-pressed={discipline === key} onClick={() => { setDiscipline(key); setOffset(0); }}>
            <span className="chip-dot" aria-hidden="true"/>
            <span>{label(DISCIPLINE_LABEL, key)}</span>
          </button>)}
        </div>
        <label className="h-mod-season-filter"><span>{L("Season (Persian year)", "فصل (سال هجری شمسی)")}</span><select value={season} onChange={event => { setSeason(event.target.value); setOffset(0); }}>
          <option value="">{L("All seasons", "همه فصل‌ها")}</option>
          {currentYear != null && Array.from({ length: 8 }, (_, i) => currentYear - i).map(year => <option key={year} value={year}>{localizedDigits(year, locale)}</option>)}
        </select></label>
      </div>
      {/* R128: the encoding legend makes the hue system LEARNABLE — one quiet
          line that teaches discipline hues, tier gold intensity and placement
          metals, so the colors read as information instead of decoration. */}
      <p className="h-mod-legend" aria-label={L("Color legend", "راهنمای رنگ‌ها")}>
        <span className="legend-part"><i className="legend-dot" aria-hidden="true"/><i className="legend-dot" aria-hidden="true"/><i className="legend-dot" aria-hidden="true"/>{L("one hue per discipline, everywhere on the page", "هر رشته یک رنگ ثابت در سراسر صفحه")}</span>
        <span className="legend-sep" aria-hidden="true">·</span>
        <span className="legend-part"><span className="h-mod-tier" data-tier="local">{L("tier", "سطح")}</span><span className="h-mod-tier" data-tier="national">{L("deepens with prestige", "با اعتبار بیشتر")}</span></span>
        <span className="legend-sep" aria-hidden="true">·</span>
        <span className="legend-part"><span className="h-mod-place gold">1</span><span className="h-mod-place silver">2</span><span className="h-mod-place bronze">3</span>{L("placement medals", "مدال رتبه‌ها")}</span>
      </p>
        </div>{/* /.h-mod-filter-body */}
      </div>{/* /.h-mod-filter-drawer */}
      <div className={selected != null ? "h-mod-comp-split" : "h-mod-comp-list"}>
        <div className="h-mod-events" aria-busy={rows === null && !listError}>
          {listError ? <div className="h-mod-error" role="alert">
            <p>{L("Events could not be loaded. This is not an empty calendar.", "بارگذاری رویدادها ممکن نشد. این پیام به معنی خالی بودن تقویم نیست.")}</p>
            <button type="button" onClick={() => setListRetry(value => value + 1)}>{L("Try again", "تلاش دوباره")}</button>
          </div> : rows === null ? <div className="h-mod-loading" role="status">{L("Loading events…", "در حال بارگذاری رویدادها…")}</div>
          : rows.length === 0 ? <div className="h-mod-empty" role="status">
            <p>{L("No events match these filters.", "رویدادی با این فیلترها یافت نشد.")}</p>
            {(discipline || season) && <button type="button" onClick={() => { setDiscipline(""); setSeason(""); setOffset(0); }}>{L("Clear filters", "پاک کردن فیلترها")}</button>}
          </div> : rows.map(event => <button type="button" key={event.id} className={`h-mod-event ${selected === event.id ? "selected" : ""}`} data-discipline={event.discipline} data-tier={event.tier}
            aria-pressed={selected === event.id} onClick={click => {
              openerRef.current = click.currentTarget;
              if (selected === event.id) { detailRef.current?.focus(); detailRef.current?.scrollIntoView({ block: "start" }); }
              else { shouldReveal.current = true; setSelected(event.id); }
            }}>
            {/* R136: Chromium quirk — a <button> grid container's content does
                not contribute to grid track sizing, so the event rows collapsed
                onto each other. The button is a plain block; this single inner
                wrapper carries the card grid. */}
            <div className="h-mod-event-inner">
            <div className="h-mod-event-date"><b>{localizedDigits(String(event.event_date).slice(8, 10), locale)}</b><small>{localizedDigits(String(event.event_date).slice(0, 7), locale)}</small></div>
            {event.image_url && <img className="h-mod-event-photo" src={event.image_url} alt="" loading="lazy" referrerPolicy="no-referrer"/>}
            <div className="h-mod-event-body">
              <strong dir="auto">{event.name_native}</strong>
              <span className="h-mod-event-tags">
                <span className="h-mod-discipline" data-discipline={event.discipline}>{label(DISCIPLINE_LABEL, event.discipline)}</span>
                <span className="h-mod-tier" data-tier={event.tier}>{label(TIER_LABEL, event.tier)}</span>
                <span className="h-mod-event-loc" dir="auto">{event.city ?? event.venue}</span>
              </span>
            </div>
            <div className="h-mod-event-count">{n(event.result_count ?? 0)}<small>{L("results", "نتیجه")}</small></div>
            </div>{/* /.h-mod-event-inner */}
          </button>)}
          {!listError && rows !== null && total > COMPETITION_PAGE_SIZE && <nav className="h-mod-pager" aria-label={L("Event pages", "صفحه‌های رویداد")}>
            <button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - COMPETITION_PAGE_SIZE))}>{L("Previous", "قبلی")}</button>
            <span aria-live="polite" dir="ltr">{n(Math.floor(offset / COMPETITION_PAGE_SIZE) + 1)} / {n(pages)}</span>
            <button type="button" disabled={nextOffset >= total || nextOffset > MAX_COMPETITION_OFFSET} onClick={() => setOffset(nextOffset)}>{L("Next", "بعدی")}</button>
          </nav>}
          {nextOffset > MAX_COMPETITION_OFFSET && total > nextOffset && <p className="h-mod-note">{L("Narrow the filters to access more events.", "برای دسترسی به رویدادهای بیشتر، فیلترها را دقیق‌تر کنید.")}</p>}
        </div>
        {selected != null && <section ref={detailRef} tabIndex={-1} className="h-mod-event-detail" data-h-surface-role="major" aria-label={L("Event results", "نتایج رویداد")} aria-busy={detail === null && !detailError}>
          <header className="h-mod-sheet-head">
            {detail?.competition.image_url && <figure className="h-mod-event-figure"><img src={detail.competition.image_url} alt="" referrerPolicy="no-referrer"/>{detail.competition.image_credit && <figcaption>{L("Photo", "عکس")}: {detail.competition.image_credit}</figcaption>}</figure>}
            <div><span className="h-mod-kicker">{L("EVENT RESULTS", "نتایج رویداد")}</span>
              <h2 dir="auto">{detail?.competition.name_native ?? L("Event results", "نتایج رویداد")}</h2>
              {detail && <div className="h-mod-event-tags detail-tags">
                <span className="h-mod-discipline" data-discipline={detail.competition.discipline}>{label(DISCIPLINE_LABEL, detail.competition.discipline)}</span>
                <span className="h-mod-tier" data-tier={detail.competition.tier}>{label(TIER_LABEL, detail.competition.tier)}</span>
              </div>}
              {detail && <p dir="auto">{detail.competition.venue}{detail.competition.organizer ? ` · ${detail.competition.organizer}` : ""}</p>}
            </div>
            <button type="button" className="h-mod-close" onClick={closeDetail} aria-label={L("Close results", "بستن نتایج")}>×</button>
          </header>
          {detailError ? <div className="h-mod-error" role="alert">
            <p>{L("The results could not be loaded.", "بارگذاری نتایج ممکن نشد.")}</p>
            <button type="button" onClick={() => setDetailRetry(value => value + 1)}>{L("Try again", "تلاش دوباره")}</button>
          </div> : detail === null ? <div className="h-mod-loading" role="status">{L("Loading results…", "در حال بارگذاری نتایج…")}</div>
          : detail.results.length === 0 ? <p className="h-mod-empty">{L("No results have been published for this event.", "هنوز نتیجه‌ای برای این رویداد منتشر نشده است.")}</p>
          : <>
            {detail.results_page?.has_more
              ? <p className="h-mod-note" role="status">
                  {L("Results shown", "نتایج نمایش‌داده‌شده")}: {n(detail.results.length)} / {n(detail.results_page.total)}.{" "}
                  <button type="button" className="h-mod-load-more" onClick={loadMoreResults} disabled={loadingMore}>
                    {loadingMore ? L("Loading more results…", "بارگذاری نتایج بیشتر…") : L("Load the next results page", "بارگذاری صفحه بعدی نتایج")}
                  </button>
                  {moreError && <span role="alert"> {L("Loading failed — try again.", "بارگذاری ناموفق بود؛ دوباره تلاش کنید.")}</span>}
                </p>
              : detail.results_window?.has_more ? <p className="h-mod-note" role="status">
                {L("Results shown", "نتایج نمایش‌داده‌شده")}: {n(detail.results.length)} / {n(detail.results_window.total)}.{" "}
                {L("This is a limited results window, not the complete event history.", "این بخش فقط بخشی از نتایج است، نه تاریخچه کامل رویداد.")}
              </p> : null}
            <div className="h-mod-table-wrap" tabIndex={0} role="region" aria-label={L("Event results table", "جدول نتایج رویداد")}>
              <table className="h-mod-table">
                <thead><tr><th scope="col">{L("Place", "رتبه")}</th><th scope="col">{L("Horse", "اسب")}</th><th scope="col">{L("Class", "رده")}</th><th scope="col">{L("Rider", "سوارکار")}</th><th scope="col">{L("Result", "نتیجه")}</th><th scope="col">{L("Score", "امتیاز")}</th></tr></thead>
                <tbody>{detail.results.map(row => {
                  const medal = placeClass(row.placement, row.is_eliminated, row.is_withdrawn);
                  return <tr key={row.id} className={medal ? `place-row ${medal}` : undefined}>
                  <td><span className={`h-mod-place ${medal}`}>{row.placement == null ? (Number(row.is_eliminated) === 1 ? L("Eliminated", "حذف") : Number(row.is_withdrawn) === 1 ? L("Withdrawn", "انصراف") : "—") : localizedDigits(row.placement, locale)}</span></td>
                  <td><button type="button" className="h-mod-link" onClick={() => navigate(`/horse/${row.horse_id}`)}><b dir="auto">{locale === "fa" && row.name_native ? row.name_native : row.name_latin ?? row.name_native}</b><small>#{localizedDigits(row.horse_id, locale)}</small></button></td>
                  <td dir="auto">{row.class_name ?? "—"}</td><td dir="auto">{row.rider_name ?? "—"}</td>
                  <td dir="auto">{row.placement_text ?? (row.placement != null ? localizedDigits(row.placement, locale) : "—")}</td><td dir="auto">{row.score ?? "—"}</td>
                </tr>;})}</tbody>
              </table>
            </div>
          </>}
        </section>}
      </div>
    </section>
  </main>;
}
