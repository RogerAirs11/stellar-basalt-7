# Retro Astra — R25 donor transplant frontend

Retro Astra is an independent retro-office visual engine (filing-cabinet /
donor-styled) that runs on the canonical Horse DB platform contract.

## Architecture (current, R25+R32)

- **Entry**: `entry.tsx` renders `transplant/App.tsx` (the live donor transplant)
  wrapped in `.retro-astra-transplant` with `transplant/donor-scoped.css`
  (the donor stylesheet scoped via `@scope`).
- **Pages** (`transplant/pages/`): Home, Directory, Profile, Pedigree,
  PlatformDesk (people / relationships / breeding / governance), Newsroom,
  Insights.
- **Data**: `transplant/HorseDbAdapter.tsx` is the only bridge to the platform
  client — all truth flows through `runtime.platform`.
- **Routing**: own hash router (`#/`, `#/horses`, `#/horses/:id`, `#/pedigree`,
  `#/collections/:section`, `#/newsroom`, `#/insights`).
- **Host integration (R32)**: the host shell's EN/FA toggle is authoritative —
  `PreferencesProvider` receives `hostLocale` and syncs the donor language
  live; the local stored preference remains for standalone use.
- **Command palette (R32)**: `Ctrl/⌘-K` searches the live canonical registry
  through `platform.search.horses` (78k records), falling back to the
  in-memory rows while the server responds.
- **Localization**: bilingual copy in `transplant/i18n/messages.ts`; the
  platform desks and profile tabs are localized inline (R32).

## Truth boundary

No direct API calls: every read goes through `runtime.platform`. Presentation
preferences (palette, mode, fonts, language) are local-only.

## Historical note

The R23/R24 root-level recreation (`pages-*`, `workspace`, donor CSS at root)
was removed in R32; the transplant is the single source of this frontend.
