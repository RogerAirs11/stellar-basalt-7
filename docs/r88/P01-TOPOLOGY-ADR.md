# P01 — Production topology ADR (R88 plan)

Date: 2026-10-03. Status: **decision recorded; execution-level parity tests remain open**.

## Decision

The production topology was already selected and is running live (since R59,
re-confirmed R81–R87). This ADR records it as the P01 architecture decision so
the plan's "choose one topology" item has a written answer, and scopes the
parity work that remains.

| Layer | Selection | Notes |
|---|---|---|
| Compute/runtime | **Cloudflare Workers** (single Worker `horse-registry-nextgen`) | Push to `main` auto-deploys via GitHub Actions + wrangler |
| Canonical database | **Supabase Postgres** via Hyperdrive (`supabase_full` mode) | All 37 migrations applied; migrations are translated SQLite→Postgres and applied Supabase-first BEFORE each deploy (R81 lesson: no 500 window) |
| Failover layer | **D1** (Cloudflare SQLite) + optional Turso | D1 kept in sync by the migration pipeline + sync tooling |
| Local dev | Local SQLite via the shared adapter boundary | `src/db/*` adapter family |
| Object storage | Platform media table (D1/Postgres) today; R2 remains owner-gated | Master plan T14 media objects is future work |
| Secrets | Cloudflare worker secrets (`wrangler secret`) | Never in the repository; `.env.example` is blank placeholders |
| Backup | Supabase managed backups + D1 export tooling; restore drill = P30 | Explicitly NOT yet verified by a drill |

## Why not a new topology

- The Iran business-model doc's Liara IaaS reference is a **supplier price
  observation**, not a portability proof (the R88 audit says the same). Moving
  the Worker architecture to a VM provider would trade a running, migrated,
  37-migration-deep production database for an unproven redeployment.
- Adapters exist for D1/local-SQLite/Turso/Supabase, but per the audit we do
  NOT multiply supported paths: **Supabase Postgres is the only canonical
  production database**; D1 is failover; Turso is not in the launch path.

## Open parity work (P01's remaining test half, tracked as TODO)

1. Execution-level adapter equivalence suite (uniqueness error classification,
   timestamp parsing, rollback semantics, affected-row metadata) against the
   REAL Supabase instance — SQLite replay (now 66 Python tests) does not
   certify Postgres behavior.
2. Concurrent-writer tests: two clients cannot both claim an exclusive record
   or execute one command twice (P02's marker design is the building block;
   P03's command receipts complete it for marketplace writes).
3. Fail-closed startup on unsupported provider/capability combinations.

## Consequences

- Migration discipline stays **Supabase-first** (apply + verify before push),
  additive-first, no destructive migration without dry-run + backup + reviewed
  mapping + compensating procedure (plan rule 7).
- The Postgres translation gate (`check-migration-translation.mjs`) and the
  37-migration scratch chain remain release gates for every future migration.
- Any future topology change (e.g., Liara) requires a NEW ADR with a
  demonstrated migration rehearsal, not a price comparison.
