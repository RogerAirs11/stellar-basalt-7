# V5 Dual Database Provider Implementation Worklog — 2026-09-09

## Scope

Productionize the previously isolated Turso/libSQL experiment in the latest V5 optimized-serving release while keeping Cloudflare D1 support intact and avoiding active-active writes.

## Starting authority

- Source candidate: `Horse-Registry-v1.1.8-V5-Full-Real-Data-D1-Serving-Optimized-Final-Candidate-2026-09-08.zip`
- Source SHA-256: `939f9257c3d0271a63cd418fed463647539ad8a38a4fe54c5fb2f796a3f3ae9c`
- Optimized serving SQLite SHA-256: `8006638e7b952ca077ac0659e15db210574d1d53cce4ea1f73e167a537eab544`
- Serving rows: 78,089 horses / 26,646 people / 110,469 horse-person links.

The starting candidate remains immutable. All work was performed in a derived tree.

## Prior Turso evidence reused

The September 6 isolated benchmark had already established that the full canonical SQLite could be raw-uploaded to Turso/libSQL with exact canonical counts, FTS/trigram compatibility, production journey parity, browser parity, and write/concurrency/recovery correctness after adapter hardening.

Important compatibility findings retained in this implementation:

1. Do not share a Turso compat client across concurrent Worker requests; create one per request.
2. Explicitly enable SQLite foreign-key enforcement for writes.
3. Normalize both named/object and positional result-row shapes.
4. Preserve D1 `meta.last_row_id` behavior where possible.
5. Keep write batches atomic.
6. Do not create a second ORM/business-logic implementation.

## Implementation changes

### 1. Turso D1 compatibility adapter

Added `src/db/tursoCompat.ts`.

It exposes the D1-style subset already consumed by the application:

- `prepare()` / `bind()`
- `first()`
- `all()`
- `run()`
- `batch()`
- `exec()`

Rules:

- `@tursodatabase/serverless/compat` version is pinned to `1.4.0`.
- a new client is constructed for each request/provider resolution;
- `PRAGMA foreign_keys=ON` is executed before transactional write batches, not from inside the transaction;
- `lastInsertRowid` is normalized to D1 `meta.last_row_id`, with `last_insert_rowid()` retained as a compatibility fallback;
- read/write result metadata is normalized to the D1 result shape;
- D1 `exec()` maps to compat `executeMultiple()`.

### 2. Database provider resolver

Added `src/db/provider.ts`.

Supported modes:

- `d1_only`
- `turso_only`
- `d1_with_turso_read_failover`
- `turso_with_d1_read_failover`

`d1_only` and `turso_only` are normal writable single-authority modes.

The two failover modes are deliberately read-only HA modes for public-serving traffic. Database mutations are refused while automatic failover is enabled. This prevents a primary from advancing while an unsynchronized standby remains eligible.

### 3. Automatic failover eligibility

Automatic switching is limited to public `GET`/`HEAD` reads and excludes:

- auth routes;
- admin routes;
- claims;
- change requests;
- registry exports.

A fallback must prove the expected serving generation before use:

- 78,089 active horses by default;
- expected canonical workbook/source SHA-256;
- complete source import;
- 412 filter-count rows;
- valid canonical revision.

If a recent primary revision was observed, fallback must match it.

### 4. Availability behavior

Added:

- bounded health probe (default 2.5 s);
- short healthy-provider cache (default 2 s);
- in-isolate failed-primary circuit breaker (default 30 s);
- same-request retry against the eligible fallback when an actual public DB read fails after a successful/cached primary probe.

Validation/auth/product `HttpError`s are never retried against another provider.

### 5. Runtime observability

`/api/health` now optionally exposes non-secret database routing state:

- configured mode;
- primary;
- fallback;
- active provider;
- whether failover was used.

Turso credentials are Worker-only secrets and are never included in the response contract.

### 6. Configuration

Added environment support for:

- `DB_PROVIDER_MODE`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `DB_HEALTH_TIMEOUT_MS`
- `DB_HEALTH_CACHE_MS`
- `DB_FAILOVER_COOLDOWN_MS`
- `DB_FAILOVER_REQUIRED_SOURCE_SHA256`
- `DB_FAILOVER_REQUIRED_HORSE_COUNT`

Default Wrangler mode remains `d1_only`, so adding this feature does not silently change the existing deployment backend.

## Latest Turso upload image

A separate Turso-ready copy was generated from the optimized serving SQLite; the authoritative optimized serving DB was not modified.

- File: `horse-registry-v5-turso-serving-upload.sqlite`
- Size: 196,677,632 bytes
- SHA-256: `20d5fc704b097852fd07a4161ccf21cf9090924e1db80343d7bce2b34eee5603`
- page size: 4096
- journal mode: WAL
- auto_vacuum: 0
- encoding: UTF-8
- integrity: ok
- FK violations: 0
- horses: 78,089
- people: 26,646
- horse_people: 110,469
- search source / main FTS / main trigram: 78,089 each
- role trigram: 57,777
- DQI: 4,677
- filter counts: 412

## Local validation completed

Dependency-independent project validators completed successfully:

- platform contract
- launcher freshness
- frontend integration
- Heritage public-read boundary
- EquiData integration
- design systems
- CSS architecture
- Core UI semantic regression
- presentation parity
- visible-surface parity
- admin-record parity
- Stage 2 adaptive parity
- premium analytics parity
- premium presentation completeness
- current-document hygiene
- production source syntax
- Prism Ultra
- free-tier budgets
- operational inventories

Python regression suite: **31/31 PASS**.

The first document-hygiene run correctly caught a generated `tools/__pycache__`; the cache was deleted and the hygiene check passed. No generated caches are retained in the candidate.

## Current-package API verification

The current official `@tursodatabase/serverless` 1.4.0 compat source was checked during implementation. It still supports:

- `createClient()`;
- `execute()`;
- `executeMultiple()`;
- `batch(stmts, "read"|"write"|...)`;
- full `ResultSet` with `rows`, `columns`, `rowsAffected`, and `lastInsertRowid`.

This confirms the adapter targets the current package surface rather than relying only on the older September 6 experiment.

## External validation remaining

The local environment could not complete a healthy `npm ci`; dependency installation stalled and left an incomplete `node_modules`, which was removed before packaging.

Therefore the exact candidate still requires an external clean gate:

1. `npm ci --no-audit --no-fund`
2. `npm run check`
3. `npm run build`

Luna B is assigned only this external dependency/type/test/build validation.

## Turso external task

Luna A is assigned only external Turso provisioning/upload/verification for a new DB:

`horse-registry-v5-serving-optimized-20260909`

The task uses the exact WAL-ready 196.7 MB serving copy and must verify the full registry before any Worker is pointed at it.

## D1 state

The partially imported full-serving D1 remains preserved and untouched:

- D1 ID: `97f2bb27-65f3-4f27-b75c-bc81347ff00b`
- checkpoint: 33 / 1,932 statements
- 4,362 horses currently uploaded

It is intentionally ineligible as a failover provider until its full import is completed and verified.

## Promotion rule

Do not change the public showcase backend until BOTH are true:

1. exact dual-provider candidate passes the clean Node/TypeScript/Vitest/build gate;
2. new optimized Turso DB passes exact remote data/search/integrity verification.

Then deploy an isolated validation Worker in `turso_only`, run black-box parity, and only afterward switch the public showcase.
