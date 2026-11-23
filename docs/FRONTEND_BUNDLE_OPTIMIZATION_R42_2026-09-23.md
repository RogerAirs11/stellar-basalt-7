# Frontend Bundle Optimization — R42 Hyper-Optimization Benchmark

**Date:** 2026-09-23 · **Scope:** Core Heritage frontend (Vite entry) · **Verified:** typecheck + 6 design validators + 125 vitest + full browser route sweep (zero console errors).

## What changed

Route pages became async chunks (the same `React.lazy` pattern the codebase already used for `ParticleHorseSplash`), plus an idle prefetch for the two most-visited destinations:

1. `RegistryStatsPage`, `RegistryDeskPage`, `NewsroomPage`, `EditorialStudioPage` → `React.lazy` chunks behind a single `<React.Suspense>` boundary (quiet `route-chunk-loading` placeholder, `min-height:38vh`, no spinner flash).
2. Idle prefetch: once the shell is interactive and the browser is idle (`requestIdleCallback`, 2.5 s timeout fallback), the stats + newsroom chunks are warmed into the HTTP cache so the first navigation to them is instant. Slow connections simply skip it; no behavior depends on it.

## Bundle benchmark (vite build, sqlite preview mode)

| Metric | Before (R40) | After (R42) | Delta |
|---|---|---|---|
| Main `index.js` (raw) | 801.8 kB | 719.9 kB | **−81.9 kB (−10.2%)** |
| Main `index.js` (gzip) | 225.5 kB | 205.0 kB | **−20.5 kB (−9.1%)** |
| Initial JS to parse on `/` | 801.8 kB | 719.9 kB | −10.2% |
| Lazy route chunks | 1 (splash 95.8 kB) | 5 (splash + 4 pages, 81 kB total) | on-demand only |

### New async chunks (loaded only when their route is visited)

| Chunk | Size | Loaded on |
|---|---|---|
| `RegistryStatsPage-*.js` | 45.4 kB | `/stats` |
| `RegistryDeskPage-*.js` | 14.0 kB | `/f/heritage/desk` |
| `EditorialStudioPage-*.js` | 12.8 kB | `/newsroom/studio` |
| `NewsroomPage-*.js` | 8.6 kB | `/newsroom` |
| `ParticleHorseSplash-*.js` | 95.8 kB | splash scene (unchanged, pre-existing) |

### Local load timing (headless Chrome, vite preview, warm server)

`/` (home, first visit): DOMContentLoaded 734 ms · Load 866 ms · First Paint 752 ms.
Route switches to prefetched pages (`/stats`, `/newsroom`) are chunk-cache hits after the idle warm-up.

## Composition note (why the main bundle is still ~720 kB)

Sourcemap analysis of the pre-change bundle:
- `react-dom` client production build: 523 kB source — fixed framework cost.
- App shell code: ~818 kB source, dominated by `main.tsx` (196 kB: inline Search/Browse/Horse/Person/Admin pages + admin editor), `AppearanceStudio` (87 kB), contracts/i18n (~110 kB combined).

## Remaining opportunities (not taken this round — documented for the next pass)

1. **Extract the AdminPage family** (`AdminDashboard`/`Login`/`GuestAdminDashboard`/`AdminHorseEditor`/`HorsePicker`, ~160 lines of `main.tsx` + `AdminAiSettings` 15 kB) into `heritage/AdminPage.tsx` + `React.lazy`. Estimated additional −40–60 kB initial. Skipped this round: heavy interleaving with shared helpers (`workflowStatusLabel`, `primaryHorseName`, `localizedDigits`, `Horse` type) raises refactor risk beyond the win.
2. **Split `AppearanceStudio` (87 kB)** into a small always-present trigger + lazy settings drawer body (opens on demand). Requires restructuring a 323-line finely-tuned component.
3. **CSS** is 1,052 kB raw / 142 kB gzip — one monolithic sheet by design (tokenized design system, validator-enforced). Per-route CSS would need validator+layering rework; not recommended for the gain.
4. `react-dom` could move to a CDN-cached `<script>` (long-term stable hash) — changes the deploy story (currently single-origin assets on Cloudflare); only worth it if Cloudflare edge cache hit rate becomes a measured problem.

## Safety net that gated this change

- `tsc --noEmit` clean (root + frontend-kit + pedigree + backend-core projects).
- `validate:css`, `validate:design-systems`, `validate:visible-surfaces`, `validate:ui-42`, `validate:language`, `validate:budgets` — all PASS.
- `vitest run`: 125 passed / 0 failed.
- Browser sweep: `/`, `/stats`, `/newsroom`, `/newsroom/studio`, `/f/heritage/desk`, `/horse/1`, `/admin` — all render with expected `h1` content, zero console errors, async chunks confirmed loading (`performance.getEntriesByType('resource')`).
