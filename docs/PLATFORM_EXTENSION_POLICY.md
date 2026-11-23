# Horse DB — Platform Extension Policy

Use this when a frontend requests behavior/data that the current platform contract does not support.

## Principle

> A good frontend may teach the platform a new capability. It does not get a private backend fork.

## Decision gates

Before platform/backend work, answer:

1. Is it really domain/backend behavior rather than presentation?
2. Is the useful concept generalizable beyond one UI?
3. Does required data already exist?
4. If data is new, where does it come from and who owns/proves it?
5. Is it canonical truth or derived computation/cache?
6. Are visibility/privacy/permissions/provenance defined?
7. Can SQLite and D1 behave equivalently?
8. Can it evolve additively/versionably?
9. Can mock/test fixtures represent it for future frontend agents?
10. Is the maintenance cost justified?

## Derived analytics rule

Analytics computed from canonical registry data are **derived**, not canonical truth. Before adding an analytics capability:

- define integrity prerequisites and behavior on anomalous pedigrees
- define algorithm name/version and parameters/depth
- expose coverage/provenance when interpretation depends on missing data
- benchmark live computation before materializing caches/tables
- prefer deterministic versioned snapshots for heavy registry-wide work
- keep derived stores disposable/rebuildable
- never present a project-specific score as objective biological fact

For pedigree science specifically, follow `docs/PEDIGREE_ANALYTICS_ARCHITECTURE.md`.

## Existing-data computation path

```text
frontend requirement
 -> canonical service/algorithm
 -> edge-case tests
 -> API implementation
 -> PlatformClient DTO/method
 -> feature key + version/stability/access
 -> mock implementation
 -> frontend opt-in
```

Do not duplicate canonical algorithms in a frontend to avoid backend work.

## New-data path

```text
requirement
 -> source/provenance design
 -> canonical schema + migration
 -> import/backfill/capture path
 -> privacy/visibility + permissions
 -> indexes/integrity rules
 -> domain service
 -> API
 -> PlatformClient DTO/method
 -> feature metadata
 -> mock/test data
 -> frontend opt-in
```

Migration requirements:

- additive where practical
- deterministic/re-runnable data handling
- preserve existing canonical horse/person IDs
- explicit null/unknown semantics
- query-path indexes
- SQLite/D1 parity
- FK/integrity verification
- rollback or documented forward-fix strategy
- state/source-mapping documentation

## Experimental capability lifecycle

```text
frontend-local experiment
 -> repeated/valuable concept
 -> experimental platform capability
 -> real consumers + tests
 -> stable semantics
 -> stable capability
 -> optional later core promotion if truly foundational
```

Do not promote an unstable idea just to avoid temporary duplication.

## Naming/ownership

Reject concepts such as:

- `/api/q8-special-*`
- `/api/frontend-7-*`
- `q8_media_table`

Prefer domain names such as:

- media
- verification
- inspections
- timelines
- influence analytics
- change requests
- exports

The frontend that introduces a feature is the **first consumer**, not its owner.

## Breaking evolution

When semantics must break:

- bump that capability's feature major
- preserve old behavior during a migration window when feasible
- let manifests cap supported major versions
- update mock + tests + docs together
- never silently reinterpret existing fields

Global platform-contract major bumps are reserved for genuinely cross-cutting breaking changes.


## Worked example — EquiData Elite Breeding Lab

The blind EquiData Elite mockup arrived with a foal simulator containing invented genomic traits and market projections. Integration classified the ideas rather than deleting or blindly implementing them:

- sire × dam pedigree-risk context -> **generalizable existing-data computation** -> promoted to canonical `breeding_analysis 0.1.0`;
- genomic trait inheritance -> **new-data candidate** -> preserved but dormant because no validated genomic source/model exists;
- performance projections -> **new-data candidate** -> preserved but dormant;
- market-value projections -> **new-data candidate** -> preserved but dormant;
- scripted fake AI answers -> **frontend-local mock behavior** -> preserved in the original archive but not exposed as canonical intelligence.

This is the preferred pattern: preserve creative surface area, promote only truthful reusable domain behavior, and never fabricate missing canonical data to make a mockup look complete.
