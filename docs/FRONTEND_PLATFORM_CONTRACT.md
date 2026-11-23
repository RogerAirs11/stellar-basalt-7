# Horse DB Frontend Platform Contract

Status: **canonical architecture**  
Application: **v0.41.1**  
Platform contract: **2.11.0**

> **One canonical platform. Many distinct ways to experience it.**

## Supported boundary

External frontends may depend on their own folder plus the public `src/frontend-kit/index.ts` surface. They must not couple to SQL/database/runtime internals or raw `/api/*` transport.

```text
frontend-local UI/rendering
          ↓
FrontendRuntime + Frontend Kit
          ↓
     PlatformClient
          ↓
host transport adapter
          ↓
canonical services/API/database
```

`FrontendRuntimeProps` supplies route/navigation, locale, user/permissions, health/meta, typed `PlatformClient`, and presentation assets.

## Capability catalog

Each feature declares version, stability (`core|stable|experimental|reserved`), access (`public|authenticated|privileged`) and runtime availability.

Each frontend must account for every platform feature as:

- `surface` — real first-class frontend presentation
- `host` — deliberately delegated to an allowed shared host-owned workflow
- `dormant` — unsupported because the platform capability is unavailable/reserved

A live normal domain capability cannot be hidden behind `host` merely to avoid implementation work.

## Visible-surface rule

**`surface` is a presentation promise, not a manifest label.**

A qualifying surface needs a discoverable route/action and an actual usable UI. Merely calling the SDK, rendering a capability matrix, or presenting a generic list where the feature is inherently graphical does not satisfy parity.

`tools/validate-visible-surface-parity.mjs` enforces concrete source/UI evidence across Registry, horse, people, pedigree, relationships, breeding, Intelligence, quality/workflows, governance reachability and provenance.

## Headless shared helpers

Frontends may share stable semantic/client algorithms through Frontend Kit while retaining independent rendering. `pedigreeLayout.ts` is the current pedigree example: layout geometry is shared; CSS/components are not.

## Current 2.9 capability additions

- filtered CSV/JSON Registry export
- owner/breeder/importer/passport-receiver Registry/search roles
- all four people roles in browse/export/analytics projections
- stable change requests, audit, admin and curation integration

## Reserved features

Media, verification, inspections, breed standards, genomics, performance records, market data and AI assistant currently have no canonical dataset/workflow. They remain unavailable and frontend concepts stay dormant rather than emitting synthetic data.

## Compatibility

Older frontends are not automatically made unloadable when the backend grows. Additive platform growth can create explicit parity debt; release validation must resolve that debt before promotion.

## Authentication / authorization

Frontends consume canonical permissions and typed auth methods. They never infer authorization from role strings, own session/CSRF transport, or receive database credentials.

## Error contract

`PlatformClientError` provides stable status/code/message/details semantics so each independent engine can implement its own consistent loading/error/auth states.
