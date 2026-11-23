# Database Sync & Failover Runbook

> How the Horse-DB provider fleet (Cloudflare D1 · Turso · Supabase · local SQLite)
> stays in sync, how drift is detected, and how failover is armed.
> Companion tool: `scripts/db-sync.mjs`. Added R46 (2026-09-23).

## 1. The architecture (why this is the reliable pattern)

```
                     ┌──────────────────────────┐
  canonical writes ─►│  Cloudflare D1 (prod)    │   single write primary
   (admin, imports, │  horse-registry           │   mode: d1_only
    change requests) └────────────┬─────────────┘
                                  │  one-way replication only
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
         ┌────────────┐   ┌────────────┐    ┌────────────┐
         │   Turso    │   │  Supabase  │    │ local      │
         │ read       │   │  (PG)      │    │ SQLite     │
         │ failover + │   │  public-   │    │ (dev /     │
         │ dev-rebuild│   │  read only │    │  offline)  │
         └────────────┘   └────────────┘    └────────────┘
          └───────── all pinned to one serving generation ─────────┘
```

**Rules that make it safe:**

1. **One writer.** All canonical writes go to D1 in a single-provider mode
   (`d1_only`). Dual-provider modes are read-only by design (enforced in
   `src/db/provider.ts`) — replicas can never diverge through use, they can
   only fall behind.
2. **One direction.** Replication is always D1 → replica, never replica → D1.
   A replica is refreshed from the canonical source or it is not trusted.
3. **Generation fencing.** Every provider must prove the same serving
   generation before serving a single read:
   `horses = 78,089 · source_sha256 = fd7122… · import = complete ·
   412 filter counts · canonical_revision = 0 · analytics = sha256:a540…`.
   The runtime gate (`assertCompleteDataset`) fail-closes on ANY mismatch —
   a stale replica can never silently serve production traffic.
4. **Blue-green replica swaps.** Replicas are rebuilt onto a fresh database,
   verified against the generation stamps, and only then pointed at. Never
   in-place hot-swapped.

## 2. The tool

```bash
node scripts/db-sync.mjs status [--json]     # drift detector (exit 1 on drift)
node scripts/db-sync.mjs d1-dump [--out F]   # D1 → SQL dump (needs CLOUDFLARE_API_TOKEN)
node scripts/db-sync.mjs apply --target t --file dump.sql [--drop-first]
                                             # t = local | turso | file:/… | libsql:/…
npm run db:sync                              # shortcut for status
```

- `status` probes every *reachable* provider natively (production via its
  public `/api/health`; local/Turso via libsql; Supabase via `postgres`) and
  compares each against the pinned generation. Cron-friendly: exit 0 = all
  in sync, exit 1 = drift.
- `apply` is chunked (250 statements/call) and **resumable** — a sidecar
  ledger (`<dump>.<target>.applied.json`) records progress; rerun the same
  command after any interruption. `--drop-first` replaces exactly the tables
  the dump creates (reverse dependency order).
- Credentials are env-only (never committed): `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `TOK` (Turso DB token), `SUPABASE_DATABASE_URL`.

## 3. When to resync (the discipline)

| Event | Action |
|---|---|
| Any canonical write batch on D1 (import, admin change-request applied, maintenance/reconcile) | run `d1-dump` → `apply` to each replica → `status` until green |
| Scheduled drift check (recommended daily) | `node scripts/db-sync.mjs status` — exit 1 pages/alerts |
| Sandbox rollback / local wipe | replicas unaffected (they live in the cloud); local SQLite rebuilds per `sandbox/README-RECOVERY.md` |
| Suspicion of drift | `status --json` gives machine-readable stamps per provider |

## 4. Arming Turso as the production read failover

Read-failover is a **config change**, not a code change:

1. Mint a fresh Turso DB token for
   `horse-registry-v5-serving-optimized-20260909` (org `rogerairs11`).
2. Sync check: `TOK=<token> node scripts/db-sync.mjs status` — Turso must
   report **IN SYNC** before proceeding (generation fence).
3. Set production secrets (needs the Cloudflare token):
   `wrangler secret put TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
4. Change `DB_PROVIDER_MODE` in `wrangler.jsonc` from `d1_only` to
   `d1_with_turso_read_failover`, then `npm run build && npx wrangler deploy`.
5. Verify: `/api/health` → `database.mode = d1_with_turso_read_failover`.
   Failover behavior: probe fail → circuit opens 30 s → eligible public reads
   serve from Turso; writes stay D1-only; failback is automatic on recovery.

**Supabase path (later):** provision PG with
`supabase/horse_db_public_read_schema_v1.sql`, load the generation, verify
with `SUPABASE_DATABASE_URL=… node scripts/db-sync.mjs status`, then either
`supabase_only` (public-read deployment) or `d1_with_supabase_read_failover`.
Note the PG schema is native (GIN FTS, trigram) — a D1 SQL dump needs the
dedicated transform before `apply`; that transform is its own batch when
Supabase is actually provisioned.

## 5. Known limits (honest list)

- D1 export of the full ~160 MB database may hit wrangler time limits; if so,
  fall back to sharded SELECT export (mirror of `scripts/d1-upload-resume.mjs`,
  inverted). Not yet needed — no dump has been taken since R43.
- The production public probe covers horses/analytics/import stamps; the
  full stamp set (source SHA, canonical revision) needs the Cloudflare token
  via wrangler, or a one-off admin probe.
- Turso's 2026-09 token set was revoked — mint fresh before arming failover.
