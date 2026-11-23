# Horse-DB-3 R8 — Cloudflare Node compatibility regression fix

R8 is based on the independently generation-gated R7 candidate.

Change scope is intentionally narrow:

- `wrangler.jsonc`: add `compatibility_flags: ["nodejs_compat"]`.
- `wrangler.staging.jsonc`: add the same compatibility flag.
- `tests/unit/worker-compat-config.test.ts`: regression check that both deployment configs preserve this requirement.

Reason: the three-provider bundle statically imports the Supabase adapter; `postgres` pulls Node compatibility modules into the Worker bundle even when runtime mode is `turso_only`. A Worker deployed from a config without `nodejs_compat` can fail during module initialization before the Turso-only health path executes.

No database data, schema, provider-selection logic, failover logic, generation-gate logic, Turso adapter logic, Supabase adapter SQL behavior, API routes, or frontend behavior is changed in R8.
