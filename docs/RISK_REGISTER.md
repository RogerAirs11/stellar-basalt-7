# Risk Register

| ID | Risk | Likelihood | Impact | Mitigation / trigger |
|---|---|---:|---:|---|
| R1 | D1 free initial write/index quota slows full import | High | Medium | Local-first validation; shard import; FTS last; switch to Turso if staging is impractical |
| R2 | Search feels fuzzy but returns wrong horses | Medium | High | Build real benchmark set with client; weighted deterministic scoring; regression tests |
| R3 | Spreadsheet identifiers contain formatting corruption | High | Medium | Store identifiers as TEXT; preserve raw fields; quality flags; never coerce microchips to JS numbers |
| R4 | Pedigree cycles crash UI/API | Known | High | Path-based cycle detection and depth caps already implemented |
| R5 | Owner edit damages official lineage | Medium | High | Change-request/approval architecture; direct canonical edits reserved for staff |
| R6 | Client expects race results not present in this workbook | Medium | Medium | Treat current source as registry/pedigree; request separate race/result source later |
| R7 | UI copied by competitor | Medium | Medium | Keep value-bearing algorithms/data server-side; minify/no sourcemaps; accept visible UI can be recreated |
| R8 | Database scraped through legitimate search | Medium | High | bounded results, edge/application rate limits, enumeration detection, field visibility policy |
| R9 | Admin account compromise | Medium | High | strong passwords now; MFA/shorter privileged sessions before production |
| R10 | New XLSX export changes columns | Medium | Medium | mapping validation, unknown-field preservation, import diff/report before applying |
| R11 | Public demo leaks private client fields | Medium | High | explicit visibility allowlist; Access gate for demo; raw_json never public |
| R12 | Free provider changes quota/pricing | Medium | Medium | portable SQLite-ish schema; provider adapter boundary; deployment docs record assumptions |
| R13 | Concurrent admins overwrite edits | Low demo / higher later | High | `row_version` optimistic concurrency implemented; verify 409 behavior in browser/API smoke test |
| R14 | Full XLSX import performance varies by Windows machine | Low/Medium | Low | Full import is ~61s in current environment; keep it an offline build step and add progress UI only if operator feedback shows a need |

| R15 | Parent/person display-name edit leaves denormalized search documents stale | Medium | Medium | parent-name edits enqueue dependent horses; process reindex queue; person-edit workflow must use the same pattern when added |
| R16 | Unknown free-text source notes are accidentally published | Medium | High | `description` and `raw_json` default admin/server-only until client privacy review |
