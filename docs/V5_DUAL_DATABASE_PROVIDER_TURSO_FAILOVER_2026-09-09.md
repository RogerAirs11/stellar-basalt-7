# V5 Dual Database Provider / Turso Failover — 2026-09-09

## Goal

Support Cloudflare D1 and Turso/libSQL behind the existing D1-compatible persistence seam without creating two writable authorities.

## Runtime modes

`DB_PROVIDER_MODE` accepts:

- `d1_only`
- `turso_only`
- `d1_with_turso_read_failover`
- `turso_with_d1_read_failover`

Changing this Worker environment setting is the intentional manual provider switch. Provider status is surfaced in public health metadata; credentials and tokens are never exposed.

## Write-authority rule

`d1_only` and `turso_only` are the only modes that permit database mutations.

The two `*_read_failover` modes are deliberately read-only HA/showcase modes. Any request that can mutate database state is refused with `database_failover_mode_read_only`. The POST-shaped breeding optimizer is exempt because it performs a calculation and does not mutate the database.

This is stricter than merely pinning writes to the primary: without an explicit replication protocol, allowing writes while a standby can later serve reads could silently expose stale state after failover. There is no active-active or multi-master behavior in this release.

## Automatic read failover safety

Automatic failover is limited to public `GET`/`HEAD` requests. Authenticated/auth, admin, claims, change requests and registry exports never switch providers automatically.

Before either provider can be treated as a complete serving dataset by the automatic HA path it must match:

- expected active horse count (default `78,089`),
- expected canonical source SHA-256,
- `source_imports.status='complete'`,
- all `412` precomputed filter-count rows,
- a valid non-negative `registry_state.canonical_revision`.

When a recently observed primary revision is available, fallback must match that canonical revision as well. This rejects the currently partial full-serving D1 and prevents a known older standby from being used after an observed generation change.

## Health cache, circuit breaker and same-request retry

- Primary health probes are time bounded (default 2.5 seconds).
- A short in-isolate healthy cache (default 2 seconds) avoids adding a Turso network probe to every public request.
- A failed primary probe opens an in-isolate circuit for a short cooldown (default 30 seconds).
- If an actual public route query fails after a successful/cached primary probe (for example a D1 quota rejection), the Worker marks the primary circuit open and retries that same public read once against an eligible fallback.
- `HttpError` validation/auth/product errors are never reissued against another database.

## Turso adapter rules retained from the A1 benchmark

- `@tursodatabase/serverless/compat` is used for edge/serverless access.
- A new Turso client is created per Worker request; do not share one compat client across concurrent requests.
- FK enforcement is explicit for writes and is enabled **before** the transactional write batch begins.
- D1 result shapes are normalized.
- batched writes retain atomic semantics.
- `last_insert_rowid()` is retained as a compatibility fallback for D1-style `meta.last_row_id`; current serverless compat ResultSets also expose `lastInsertRowid` directly.
- D1-style `exec()` maps to compat `executeMultiple()`.

## Required Worker configuration

Secrets/vars for Turso:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Optional provider controls:

- `DB_PROVIDER_MODE`
- `DB_HEALTH_TIMEOUT_MS`
- `DB_HEALTH_CACHE_MS`
- `DB_FAILOVER_COOLDOWN_MS`
- `DB_FAILOVER_REQUIRED_SOURCE_SHA256`
- `DB_FAILOVER_REQUIRED_HORSE_COUNT`

The browser never receives Turso credentials.

## Recommended deployment order

1. Upload and verify the latest optimized serving SQLite on a fresh Turso database.
2. Deploy the dual-provider candidate to an isolated validation Worker in `turso_only` mode.
3. Run API/search/pedigree/browser parity against the full Turso database.
4. Keep the current partially imported D1 untouched; it is not eligible as fallback.
5. If the D1 import is later completed and verified, test `turso_with_d1_read_failover` and `d1_with_turso_read_failover` in an isolated Worker.
6. Use a single-provider mode whenever admin/write workflows are required until explicit replication is implemented.

## Non-goals

- no automatic write failover;
- no bidirectional replication;
- no multi-master writes;
- no silent provider switching for authenticated/admin state;
- no provider-control state stored inside either application database.
