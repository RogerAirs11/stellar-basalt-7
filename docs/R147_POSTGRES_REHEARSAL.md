# R147 disposable PostgreSQL rehearsal

The R147 implementation was exercised on a newly created PostgreSQL 18.4 server with fictional fixtures. The actual Worker, session implementation, SQL translator and production PostgreSQL adapter handled each tested request. No hosted database, existing database credentials or real horse records were used.

## Observed result

All 116 numbered migrations applied successfully in a newly owned random `hr_test_*` schema. Three SQLite FTS declarations were deliberately skipped by the existing PostgreSQL migration mapping. This does not verify hosted search extensions or search performance.

Twelve checks passed:

| Check | Evidence established |
| --- | --- |
| Complete migration chain | Real PostgreSQL DDL execution, including migrations 0110–0116 |
| Private care scopes | Real sessions separate read/write/review authority; generic administrator has no private care bypass; finding bodies stay out of the global audit |
| Simultaneous identical command | Two actual requests pass preflight together; one entity, receipt and history commit, with identical returned receipts |
| Competing clinical amendment | Two requests use the same expected version; one succeeds and one conflicts |
| Transaction rollback | An intentionally failing later statement removes the earlier entity write and leaves no receipt/history |
| Reproduction | Genetic dam, recipient, historical sire and two offspring persist without canonical pedigree mutation |
| Typed lifecycle and stored material | Postdeath vaccination/natural foaling fail; sourced postmortem diagnosis and compatible stored semen succeed; a clinical writer waiting for a canonical death update rejects its stale lifecycle snapshot |
| Participant drift | An independent connection holds a sire update uncommitted; the care writer waits on its row lock, then rejects the stale sex/version snapshot after the update commits |
| Private laboratory evidence and science | Actual bytea evidence passes stored-byte SHA-256 checks; sample/report/review routes feed expected two-locus pigment and bounded STR results |
| Supplementary metadata | Competing value versions have one winner; a definition activation change held by another connection prevents a stale write; retained values prevent generic archive |
| Registration and evidence | Private draft bytes, unrelated-reader denial, scoped passport identity and aliases; simultaneous deletion of one evidence object decrements counters only once |
| Archive versus new reproductive reference | Actual archive and care requests both wait on a third connection's foal lock; care succeeds and archive conflicts, leaving no archived care subject |

The last test observed one race ordering, not every possible ordering. The tests do not establish clinical validity, institutional approval, real-data completeness, hosted Supabase/Hyperdrive behavior, load tolerance or a production deployment.

The owned schema was dropped after the run. The owned PostgreSQL process was stopped and its generated credential receipt removed. The deliberately injected missing-table error is the expected rollback probe.

## Runtime provenance

The isolated runtime used the official [PostgreSQL Ubuntu package repository](https://www.postgresql.org/download/linux/ubuntu/). The repository's signed release metadata and package-index digest were verified before extracting packages; each package digest matched the verified index. Extraction used `dpkg-deb -x`, without installing packages or running maintainer scripts.

| Package | Pinned version | SHA-256 |
| --- | --- | --- |
| postgresql-18 | 18.4-1.pgdg24.04+1 | `13f382b7c876ffafd98a43431007697827197da78a86dd01b4e5a3da5e3de5eb` |
| postgresql-client-18 | 18.4-1.pgdg24.04+1 | `ff3fb9af478e4bdada47168681d9987917fd3170b043c612d6d01f0c923469c2` |
| libpq5 | 18.4-1.pgdg24.04+1 | `632e63bd7e66c3a5a1b539f77dbc76a823f63b9d99fb2ac67bb334c84e4b8a17` |
| liburing2 | 2.5-1build1 | `c2aef62accee92a06263c3ad4ef46132c13e409b54296c44792a20491830a7b0` |

The small `liburing2` runtime dependency came from the official Ubuntu archive, with its signed metadata and package digest verified separately. Repository key fingerprints and nonsecret runtime/cleanup receipts are retained in the implementation evidence bundle. Binaries and generated database credentials are not application dependencies.

The server ran as unprivileged uid 65534, listened only on `127.0.0.1`, used a randomly selected local port and newly generated SCRAM credentials, and had a new empty data directory. Existing workspace permissions and database environment variables were not changed.

## Repeating the application harness

The source harness is `tools/test-r147-postgres.mjs`. It does not provision PostgreSQL, accept an environment database URL or use an existing hosted database. Provision a new disposable local PostgreSQL 18.x runtime first, using a verified distribution appropriate to the host. This implementation's extracted Ubuntu binaries are specific to that local Ubuntu environment.

Write a private mode-0600 JSON receipt for that newly owned cluster. The required fields are `owned_runtime` equal to `r147-disposable-postgres`, `base` with a generated basename matching `hr_test_r147_pg_[a-z0-9_]+`, `data` equal to `base + '/data'`, `host` equal to `127.0.0.1`, a local `port`, `database` and `user` equal to `postgres`, and a newly generated `password` of at least 32 characters. Do not put that credential receipt in source control or the evidence bundle. The marker records ownership by the test operator; it is not a way to establish ownership of an existing database.

From the repository root, run:

```sh
node tools/test-r147-postgres.mjs --cluster-state=/absolute/path/to/private-cluster-receipt.json --report=/absolute/path/to/r147-postgres.json
```

The harness creates one random schema without `IF NOT EXISTS`, records ownership only after successful creation, and removes only that schema in cleanup. It keeps the application's database-backed rate limiter enabled; fictional actors use documentation-only IP addresses to avoid conflating all actors into one missing-header bucket. Cloudflare rate-limiter bindings use a local success stub and unused asset handling uses a local placeholder. The application handlers, authentication and database execution are real. A pre-batch barrier and independent real PostgreSQL connection create the tested interleavings; the rollback check intentionally injects a failing SQL statement.

Inspect `success`, all `checks`, `owned_schema_removed` and any `cleanup_error` in the JSON result. Stop only the newly owned server after use and remove its generated credential receipt. Rehearse the intended hosted deployment separately before production activation.
