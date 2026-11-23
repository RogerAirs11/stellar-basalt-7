# EquiData Elite — Horse DB frontend

This folder is the third independent Horse DB frontend, integrated from a blind external mockup.

## Original mockup

The imported mockup archive and its extracted source are not included in this repository. Production Horse DB code must never import or depend on that mockup source.

Production Horse DB code does **not** delete or rewrite unsupported mock-only features. It activates only capabilities that the platform truthfully advertises.

## Production integration

- `manifest.ts` — contract/capability declaration
- `adapter.ts` — canonical DTO -> EquiData presentation seam
- `entry.tsx` — Horse DB host entry + namespaced routing
- `pages.tsx` — production data-aware experiences
- `governance.tsx` / `governance.css` — native permission-scoped authentication, audit, review, curation and maintenance
- `components.tsx` / `hooks.ts` / `format.ts` — frontend-local presentation utilities
- `equidata.css` — fully scoped visual system
- `FRONTEND_INTEGRATION_STATUS.md` — feature-by-feature decisions

The production frontend imports Horse DB services only from `../../../frontend-kit` and receives the real backend via `runtime.platform`.

## Identity

EquiData Elite intentionally keeps the imported dark sci-fi / cyan-gold intelligence-console identity. It is **not** a Heritage/Q8 theme.

The production adapter deliberately carries forward the original mockup's **Orbitron + Rajdhani** typography, abyss/grid canvas, flowing horse artwork, holographic dossier, ticker, four-discipline tabbed module composition, scanline/glow language and cyan/gold edge treatment. Persian falls back to Vazirmatn rather than an OS-default Arabic font.

The original mockup remains the visual/product reference: backend integration must not flatten EquiData into a generic Horse DB shell.

## Local-only state

Watchlist/favorites stay in browser local storage because they are personal presentation state, not canonical registry truth.

## Scientific guardrails

Pedigree coverage is not genetic diversity. Pedigree COI/kinship are not genomic similarity. The Breeding Lab reports a prospective pedigree COI from parental kinship with depth, integrity and provenance; it does not predict disease, fertility, performance or market value.
