# Federation Classic

A production Horse DB adoption of the supplied federation-style donor interface. It retains the donor's dense purple/orange official-database grammar while replacing all FEI identity, fake results, athlete, federation, calendar and session data with canonical Horse DB platform capabilities.

Integration boundary: only `../../../frontend-kit` plus frontend-local modules. No direct API, database, provider or auth transport coupling. No new runtime dependencies.

## R23 strict platform parity hardening

Federation Classic now owns native surfaces for the complete current non-reserved Horse DB frontend contract, including Management/Admin/Audit/Curation, full registry analytics and horse intelligence, descendant metrics, authenticated claims/change workflows, exports, pedigree relationships/coefficient tooling, breeding pair analysis and candidate optimization. Privileged calls are gated only by canonical `runtime.permissions` plus advertised provider capabilities; role names are never used to infer authority.

Reserved platform families (`media`, `verification`, `inspections`, `breed_standards`, `genomics`, `performance_records`, `market_data`) remain intentionally dormant. `ai_assistant` is a canonical platform capability: FEI exposes the full AI Research surface and the shared host launcher while all registry truth continues through `runtime.platform`; Federation Classic has no direct provider/database coupling.

## R24 donor-faithful adoption

R24 makes the supplied `recreate-and-enhance-website-ui-FEI-FrontEnd.zip` the explicit visual/layout/component authority rather than merely reproducing its general style. The donor header topology, central reflected logo dome, desktop navigation/dropdowns, mobile drawer, Home split layout and vertical tiles, search panels, form controls, pagination, striped database tables, tabs, standalone login composition, responsive breakpoints and exact purple/orange palette are translated into dependency-free, `.fei-classic-ui`-scoped Horse DB components.

Donor semantics that do not exist in Horse DB (FEI identity, competition/results/performance, athletes as a separate entity, national federations, sporting rankings/calendar, fake FEI session IDs, and fabricated genomics/market data) are not carried over. Their visual structures are repurposed only for canonical registry, people, pedigree, analytics, quality, workflow and management data.

R24 also corrects the runtime manifest contract inherited from R23: `relationships` and `registry_analytics` are required platform features in `requiresPlatform` and are not duplicated in `optionalPlatform`; the existing versioned feature requirements remain intact.
