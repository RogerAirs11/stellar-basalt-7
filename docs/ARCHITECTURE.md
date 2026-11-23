> **R104 review status:** Package 0.57.0; platform contract 2.23.0; five maintained frontend kits. The architecture below contains historical version/status claims. See [the current audit and validation](../review-r104/README.md) before release or provider promotion. R104 is a source candidate, not production approval.

# Horse DB Architecture — v0.41.1

Platform contract: **2.11.0**

## Principle

> **One canonical platform. Many independent frontend interpretations.**

```text
canonical XLSX / registry truth
          ↓
     SQLite / D1
          ↓
   domain + API layer
          ↓
 typed PlatformClient contract
          ↓
 FrontendRuntime / Frontend Kit
          ↓
 ┌──────────┬──────────┬──────────┬──────────┐
 │ Heritage │ Q8       │ EquiData │ Prism    │
 └──────────┴──────────┴──────────┴──────────┘
```

## Ownership by layer

### Canonical backend owns

- schema, integrity, provenance and visibility
- search and structured-search semantics
- Registry browse/facets/export query behavior
- people/horse relationship truth
- pedigree traversal, integrity, metrics, paths and coefficients
- relationship and breeding computations
- registry analytics and quality truth
- authentication, permissions, claims/change requests, audit/admin/curation

### Platform contract / Frontend Kit owns

- versioned semantic DTOs and feature catalog
- `PlatformClient`
- compatibility/capability negotiation
- stable frontend-neutral routing helpers
- mock client contract
- carefully selected **headless** reusable algorithms

`src/frontend-kit/pedigreeLayout.ts` is an example: it owns traversal-to-layout geometry, but no CSS, DOM or frontend branding.

### Each frontend owns

- navigation/composition
- density and responsive behavior
- typography, colors, materials and tokens
- local interaction model
- animation/art direction
- graphical rendering of shared semantics

No frontend may import another frontend's visual implementation.

## Current frontend engines

- Heritage Registry
- Q8 / Aspnamā Ledger
- EquiData Elite
- Prism Ultra

## Parity model

There are three separate gates:

1. **Contract parity** — capability exists in `PlatformClient` and manifest accounting is truthful.
2. **Feature reachability** — the frontend can navigate to/use the capability.
3. **Visible presentation parity** — the feature is a first-class usable experience with comparable semantic depth.

The third gate is mandatory. A hidden API call, generic capability console or page title without the actual experience does not qualify.

For pedigree, for example, a full frontend must provide real graphical ancestor/descendant exploration plus integrity/metrics/path/coefficient context. A column of cards is not considered equivalent merely because it calls the ancestor endpoint.

## Capability policy

Stable/current portable capabilities include search, structured search, Registry/facets/export, horse/people profiles, pedigree ancestry/descendants/metrics/paths/coefficients, relationships, horse insights, registry analytics, quality, claims, change requests, audit/admin/curation and breeding analysis.

Reserved/dormant because the canonical platform lacks truthful datasets/workflows: media, verification, inspections, breed standards, genomics, performance records, market data and AI assistant.

## New frontend feature decision

```text
new frontend idea
      │
      ├─ presentation only ─────────→ frontend-local
      ├─ same semantics, repeated ──→ optional headless shared helper
      ├─ reusable domain compute ───→ canonical platform capability
      ├─ new persistent truth ──────→ schema + provenance + API + SDK
      └─ unsupported/no data ───────→ preserve dormant; never fabricate
```

## Runtime targets

Local Windows: browser → Vite host → same-origin API bridge → D1-compatible local SQLite adapter.  
Production: browser → deployed SPA/Worker → Cloudflare D1.

Contract semantics should be equivalent across both runtimes.
