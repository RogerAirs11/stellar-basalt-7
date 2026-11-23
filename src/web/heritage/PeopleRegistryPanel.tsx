import { uiText } from "../../shared/uiLocale";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PeopleListResponse, PersonSummary, PlatformClient } from "../../contracts/platform";
import { useI18n } from "../i18n";

/**
 * Heritage People Registry — the canonical people directory surface.
 *
 * A tokenized, responsive data-table registry for owners, breeders, importers
 * and passport receivers. Desktop renders a sticky-header grid table; phone
 * renders compact registry cards. All typography and spacing flow from the
 * Heritage design tokens (--h-font-*, --h-registry-*) so the surface stays in
 * lockstep with the rest of the core frontend.
 */
export function PeopleRegistryPanel({
  platform,
  platformMeta,
  navigate,
  variant = "desk",
}: {
  platform: PlatformClient;
  platformMeta: import("../../contracts/platform").PlatformMetaResponse | null;
  navigate: (path: string) => void;
  variant?: "desk" | "page";
}) {
  const { t, n, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"horses" | "owner" | "breeder" | "name">("horses");
  const [people, setPeople] = useState<PeopleListResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = variant === "desk" ? 30 : 60;
  const loadIdRef = useRef(0);

  useEffect(() => { setOffset(0); }, [query, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const loadId = ++loadIdRef.current;
      setBusy(true);
      platform.people.list(
        { q: query.trim() || undefined, limit, offset },
        { signal: controller.signal },
      ).then((value) => {
        if (loadId !== loadIdRef.current) return;
        setPeople(value);
        setError("");
      }).catch((cause) => {
        if (loadId !== loadIdRef.current || (cause as Error).name === "AbortError") return;
        setError((cause as Error).message);
      }).finally(() => {
        if (loadId === loadIdRef.current) setBusy(false);
      });
    }, 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [platform, query, offset, limit]);

  const sorted = useMemo(() => {
    const rows = [...(people?.people ?? [])];
    const byName = (person: PersonSummary) => (locale === "fa" ? person.name_native || person.name_latin : person.name_latin || person.name_native) || "";
    if (sort === "name") rows.sort((a, b) => byName(a).localeCompare(byName(b), locale === "fa" ? "fa" : "en"));
    else if (sort === "owner") rows.sort((a, b) => b.owner_count - a.owner_count || b.horse_count - a.horse_count);
    else if (sort === "breeder") rows.sort((a, b) => b.breeder_count - a.breeder_count || b.horse_count - a.horse_count);
    else rows.sort((a, b) => b.horse_count - a.horse_count);
    return rows;
  }, [people, sort, locale]);

  const personName = (person: PersonSummary) =>
    locale === "fa" ? (person.name_native || person.name_latin || `#${person.id}`) : (person.name_latin || person.name_native || `#${person.id}`);
  const personSub = (person: PersonSummary) =>
    locale === "fa" ? (person.name_latin && person.name_native ? person.name_latin : "") : (person.name_native && person.name_latin ? person.name_native : "");

  const canPrev = offset > 0;
  const nextOffset = people?.nextOffset === undefined ? (people?.people.length === limit ? offset + limit : null) : people.nextOffset;
  const canNext = nextOffset !== null && !busy && !error;
  const totalLabel = people?.people.length === 0 ? n(0) : people ? `${n(offset + 1)}–${n(offset + people.people.length)}` : "…";

  const sortOptions: Array<{ id: typeof sort; label: string }> = [
    { id: "horses", label: uiText(locale, "Most horses", "بیشترین اسب") },
    { id: "owner", label: uiText(locale, "Ownership", "مالکیت") },
    { id: "breeder", label: uiText(locale, "Breeding", "پرورش") },
    { id: "name", label: uiText(locale, "Name (A–Z)", "نام (الفبا)") },
  ];

  return <div className={`people-registry${variant === "page" ? " people-registry--page" : ""}${busy ? " is-busy" : ""}`} data-h-surface-role="card">
    <div className="people-registry-toolbar">
      <label className="people-registry-search">
        <span aria-hidden>⌕</span>
        <input
          dir="auto"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setError(""); }}
          placeholder={t("desk.peopleSearch")}
          aria-label={t("desk.peopleSearch")}
        />
        {query && <button type="button" className="people-registry-clear" onClick={() => setQuery("")} aria-label={uiText(locale, "Clear", "پاک کردن")}>×</button>}
      </label>
      <div className="people-registry-sort" role="group" aria-label={uiText(locale, "Sort", "ترتیب")}>
        {sortOptions.map((option) => (
          <button key={option.id} type="button" className={sort === option.id ? "active" : ""} onClick={() => setSort(option.id)}>{option.label}</button>
        ))}
      </div>
    </div>

    {error ? <div className="people-registry-state people-registry-state--error" role="alert">{error}</div>
      : !people ? <div className="people-registry-state">{uiText(locale, "Loading the people directory…", "در حال بارگذاری فهرست افراد…")}</div>
      : sorted.length === 0 ? <div className="people-registry-state">{uiText(locale, "No people matched this search.", "هیچ فردی یافت نشد.")}</div>
      : <div className="people-registry-body" data-count={sorted.length}>
        <div className="people-registry-header" role="row">
          <span className="col-name">{uiText(locale, "Name", "نام")}</span>
          <span className="col-id">#</span>
          <span className="col-count" title={uiText(locale, "Ownership", "مالکیت")}>{uiText(locale, "Own", "مالک")}</span>
          <span className="col-count" title={uiText(locale, "Breeding", "پرورش")}>{uiText(locale, "Bred", "پرورش")}</span>
          <span className="col-count col-importer" title={uiText(locale, "Importer", "واردکننده")}>{uiText(locale, "Imp", "وارد")}</span>
          <span className="col-count" title={uiText(locale, "Passport receiver", "گیرنده گذرنامه")}>{uiText(locale, "Pass", "گذرنامه")}</span>
          <span className="col-count col-horses" title={uiText(locale, "Total horses", "کل اسب‌ها")}>{uiText(locale, "Horses", "اسب")}</span>
        </div>
        <div className="people-registry-rows">
          {sorted.map((person, index) => (
            <button
              key={person.id}
              type="button"
              className="people-registry-row"
              style={{ "--row-index": index } as React.CSSProperties}
              onClick={() => navigate(`/person/${person.id}`)}
            >
              <span className="col-name"><strong dir="auto">{personName(person)}</strong>{personSub(person) && <small dir="auto">{personSub(person)}</small>}</span>
              <span className="col-id">{n(person.id)}</span>
              <span className="col-count" data-title={uiText(locale, "Own", "مالک")} data-zero={person.owner_count === 0 || undefined}>{n(person.owner_count)}</span>
              <span className="col-count" data-title={uiText(locale, "Bred", "پرورش")} data-zero={person.breeder_count === 0 || undefined}>{n(person.breeder_count)}</span>
              <span className="col-count col-importer" data-title={uiText(locale, "Imp", "وارد")} data-zero={person.importer_count === 0 || undefined}>{n(person.importer_count)}</span>
              <span className="col-count" data-title={uiText(locale, "Pass", "گذرنامه")} data-zero={person.passport_receiver_count === 0 || undefined}>{n(person.passport_receiver_count)}</span>
              <span className="col-count col-horses" data-title={uiText(locale, "Horses", "اسب")}>{n(person.horse_count)}</span>
            </button>
          ))}
        </div>
      </div>}

    <div className="people-registry-footer">
      <span className="people-registry-count">{totalLabel}{people ? ` · ${n(people.people.length)} ${uiText(locale, "shown", "نتیجه")}` : ""}</span>
      <div className="people-registry-pager">
        <button type="button" disabled={!canPrev} onClick={() => setOffset(Math.max(0, offset - limit))} aria-label={uiText(locale, "Previous page", "صفحه قبل")}>‹</button>
        <button type="button" disabled={!canNext} onClick={() => setOffset(nextOffset ?? offset)} aria-label={uiText(locale, "Next page", "صفحه بعد")}>›</button>
      </div>
      {!platformMeta && <small className="people-registry-hint">{uiText(locale, "Open any person for the full registry profile.", "برای جزئیات روی هر فرد کلیک کنید.")}</small>}
    </div>
  </div>;
}
