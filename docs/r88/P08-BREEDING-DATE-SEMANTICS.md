# P08 — Breeding date semantics (canonical storage rules)

**Status:** complete. **Plan:** R88 02-AGENT-PLAN P08 ("Repair reproduction/calendar semantics without corrupting historical rows").

## Canonical storage rules

These rules are enforced by `src/genetics/breedingDates.ts` on every write path
(create + correction) and are restated here as the reviewer-facing contract.

1. **`breeding_records.covering_date` is an ISO Gregorian day.** Always
   `YYYY-MM-DD`, always the Gregorian calendar, always a REAL day (Feb 30,
   month 13, non-leap Feb 29 are rejected by `parseRegistryDate`). An English
   UI form submits the same Gregorian date a Persian UI form does — the stored
   calendar is never guessed from the interface language.
2. **`breeding_records.season` is a Solar Hijri year (1380–1500).** It is
   never a Gregorian year. A stored `2019` is an anomaly (see below), not
   "season 2019".
3. **A covering date and an explicit season cannot disagree.** If both are
   provided, the Solar Hijri year derived from the Gregorian covering date
   must equal the explicit season (`season_date_mismatch` otherwise). The
   derivation is the jalaali break-table algorithm shared with
   `src/registry/dates.ts` (roundtrips pinned across 1900–2100).
4. **Partial knowledge is season-level, never an invented day.** A year-only
   or month-only covering date is stored as the Solar Hijri season(s) it may
   belong to (`seasonRangeForPartialDate` in `src/genetics/seasonDisplay.ts`),
   with `covering_date` left NULL. No January 1 / Farvardin 1 is ever invented.
5. **Display is interval-aware and bilingual from the same stored fact**
   (`formatBreedingSeason`):
   - EN: `Season 1405 SH (21 Mar 2026 – 20 Mar 2027)` — Gregorian span.
   - FA: `فصل ۱۴۰۵ (۱ فروردین – ۲۹ اسفند ۱۴۰۵)` — native span (Esfand 30 in
     leap seasons).
   - Partial horse dates (e.g. Gregorian year-only `2019`) render through the
     shared `formatRegistryDate`: `2019` in EN, `۱۳۹۷–۱۳۹۸` in FA.

## Historical rows are never mass-converted

Rows that predate these rules (e.g. seasons stored as Gregorian years) are
NEVER rewritten in bulk (plan rollback rule). The workflow is:

1. **Report** — `tools/audit-breeding-dates.mjs` (READ-ONLY, SELECT-only by
   construction, no apply mode) against the Supabase canonical database.
   Anomaly classes: `season_not_solar_hijri`, `season_missing`,
   `no_temporal_anchor`, `covering_date_invalid`, `season_date_mismatch`,
   `covering_before_parent_birth`, `foal_birth_before_covering`,
   `implausible_gestation` (gestation window 280–400 days; day-precision
   comparisons only; typed birth dates are compared as honest intervals, so a
   year-only parent birth can never produce a false "before birth" anomaly).
2. **Human review** — each anomaly is adjudicated by an operator.
3. **Reviewed correction** — `POST /api/admin/breeding/:id/correct`
   (`horse.edit` + CSRF + reason ≥ 10 chars). The corrected values are
   revalidated with the SAME rules as create; the guarded `UPDATE` and an
   `audit_events` row land in ONE D1 batch; `before_json` carries the OLD
   `covering_date`/`season`; `after_json` carries the new values + reason.

## Where validation runs (write paths)

| Path | Validation |
| --- | --- |
| `POST /api/horses/:id/breedings` (create) | zod schema + `resolveBreedingSeason` |
| `POST /api/admin/breeding/:id/correct` (correction) | zod schema + `resolveBreedingSeason` re-run on merged values |
| `POST /api/horses/:id/genetics` (tested_at) | `validateGregorianDay` (same Gregorian day rules) |
| Horse typed dates (all five date-entry surfaces: Heritage submission form, Heritage admin editor, EquiData governance editor, genetic-test entry, breeding entry) | shared `parseRegistryDate` precision/calendar validation (T12) + the P08 season rules above |

The structured xlsx import (`tools/import_xlsx.py`) does not write
breeding_records; when ingestion moves to the P10 staging pipeline, raw
imported values + transformation rules will be recorded per staged row there.

## Evidence

- **LIVE RUN (2026-10-03, production Supabase canonical):** the anomaly
  report scanned **48,603 breeding records** and found **48,603 anomalies**,
  all `season_not_solar_hijri` — the legacy dataset stores GREGORIAN years
  (2004–2017 range observed) in the `season` column, exactly the corruption
  class the plan predicted. No other anomaly class fired (no invalid
  covering days, no date/season mismatches among in-range rows, no
  before-birth orderings). Per the plan's rollback rule these rows are NOT
  mass-converted: they await human review through the correction endpoint
  (one row at a time, audit + old value). Until reviewed, the UI renders
  them verbatim with an honest `(legacy value, pending review)` label —
  never a silent conversion to Solar Hijri.
- `tests/unit/breedingDateSemantics.test.ts` — 21 fixtures: Nowruz boundary
  (1404/1405), leap seasons 1399/1403/1408 (Esfand 30) vs common 1404/1405,
  honest half-open season intervals, bilingual interval displays for 2019
  (Gregorian) and 1405 (Solar Hijri), partial-date season ranges, invalid
  leap/day/month rejections, legacy-season pending-review display, the
  reviewed-correction endpoint (audit row with old value; write touches only
  the two calendar columns; 400/403/404 boundaries), and the read-only lock
  on the audit tool (no INSERT/UPDATE/DELETE/ALTER/DROP, no apply mode,
  every anomaly class present).
- `docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md` — 110 routes, drift-free
  (`tools/validate-operational-inventories.mjs`).
