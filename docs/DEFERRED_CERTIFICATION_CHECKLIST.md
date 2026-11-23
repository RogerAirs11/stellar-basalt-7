# Deferred Certification Checklist

This checklist contains only work that should **not** be claimed complete from the current local remediation environment.

## 1. Complete locked dependency gate — DEFER-ENV

On a machine with registry/network access or a complete npm cache:

1. Start from the packaged remediated source without `node_modules`.
2. `npm ci --no-audit --no-fund`
3. `npm run typecheck:frontend-kit`
4. `npm run typecheck:pedigree`
5. `npm run typecheck`
6. `npm test`
7. `npm run build`
8. `npm run check`
9. Record Node/npm/TypeScript/Vite/Vitest/Wrangler/workerd versions and raw logs.
10. Treat any diagnostic/test/build failure as a release blocker; do not relax types/tests merely to obtain green output.

## 2. Workerd/local-D1 executable audit replay — DEFER-ENV

Re-run Astra's original executable probes against all migrations including `0007_registry_state.sql` and `0008_canonical_mutation_journal.sql`.

Required assertions:

- optimizer valid request succeeds and deleted/missing cases are controlled;
- long English/Persian LIKE inputs never cause D1 500;
- malformed numeric/sort inputs are controlled 4xx;
- auth read does not require a session UPDATE;
- horse mutation failure injection leaves durable audit/search reconciliation state;
- claim/change create/review audit failure injection leaves reconcilable journal state;
- concurrent duplicate review yields one winner;
- opposite parent-edge race cannot create a cycle;
- bounded reindex stays below provider query ceiling;
- graph/matrix truncation semantics match contracts.

## 3. Real client-data database certification — DEFER-CLIENT-DATA

Using the actual XLSX/client SQLite:

- build the final cloud-target SQLite;
- record canonical + derived table row counts;
- record source SHA-256/revision;
- record final database bytes after indexes/FTS/trigram/analytics;
- target meaningful headroom below the 500 MB D1 per-database ceiling;
- run FK/integrity/parent/search/revision verification;
- create a reviewed search relevance corpus covering Persian/Arabic variants, aliases, typos, owner/breeder phrases and structured constraints;
- use `EXPLAIN QUERY PLAN` on browse, exact lookup, counts, facets and current-role projection queries;
- only add a derived public-role projection/index if rows-read/query-plan evidence proves it worthwhile;
- evaluate exact `COUNT(*)` and deep OFFSET cost before changing pagination contracts.

## 4. Cloudflare Free staging budget certification — DEFER-CLOUDFLARE

Deploy the exact production build/config to an isolated Free account/database.

For each representative and worst supported endpoint capture:

- Worker CPU p50 / p95 / p99 / max;
- D1 binding calls and SQL statements;
- D1 rows read/written;
- response bytes;
- cache hit/miss/stale snapshot status;
- graph nodes/paths where relevant;
- errors such as exceeded CPU/memory/query quota.

Initial engineering targets:

- routine public p95 CPU about <=5 ms;
- p99 about <=7 ms;
- no supported tested case >=10 ms;
- conservative D1 query/binding margin below 50/invocation;
- expected normal traffic <= about 50% of daily Free row/read/write/request quotas to retain recovery headroom.

Required journeys:

- anonymous landing;
- Browse + filter + search + page;
- horse profile visualizer;
- on-demand intelligence;
- people profile;
- relationship analysis;
- pairing analysis;
- max supported optimizer candidate set;
- admin login/edit/review;
- bounded maintenance reindex;
- privileged export.

## 5. Import/resume/recovery rehearsal — DEFER-CLOUDFLARE

- create disposable remote D1;
- apply migrations from empty;
- import using the generated manifest/ledger;
- deliberately interrupt midway;
- resume from ledger without duplication;
- deliberately cross a planned quota window if practical and resume next window;
- verify final manifest hashes/counts;
- exercise D1 Time Travel operational recovery;
- perform a clean rebuild/restore from canonical source without depending on whole-DB FTS export;
- rebuild FTS/trigram deterministically;
- verify staff/governance preservation policy;
- record exact recovery commands and results.

## 6. Production security/browser matrix — DEFER-BROWSER / DEFER-CLOUDFLARE

Verify actual deployed responses and UI in Chromium + Firefox, desktop + phone-size layouts, English + Persian/RTL, light + dark/custom themes.

Check:

- `/`, deep profile route, JS/CSS and API response security headers;
- CSP compatibility with current React/CSSOM/runtime appearance behavior;
- HSTS and cookie flags over HTTPS;
- anonymous export denial and frontend permission visibility;
- expensive-route rate-limit responses and Retry-After behavior;
- corrupt/blocked localStorage;
- A->B delayed horse/person response race;
- keyboard/focus/Escape flows;
- reduced motion;
- Appearance Studio focus return;
- phone Docked navigation;
- pedigree/radial/descendant truncation presentation;
- stale snapshot indication where exposed.

## 7. Release acceptance artifact

Do not call the release Cloudflare-Free-ready until the above external gates are attached to the exact source/build/schema/dataset revisions. Final evidence should identify every remaining limitation rather than collapsing `PARTIAL`/`DEFERRED` into `PASS`.
