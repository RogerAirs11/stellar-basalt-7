# Security & Anti-Extraction Threat Model

## Security objectives

1. Prevent unauthorized mutation of registry records.
2. Make bulk theft of the registry materially harder than ordinary website scraping.
3. Keep privileged backend/search logic and secrets server-side.
4. Preserve accountability for every authorized modification.
5. Limit the blast radius of compromised user/admin credentials.

## Reality constraint: UI secrecy

Browser-delivered HTML/CSS/JavaScript cannot be made secret. Minification, chunking and disabled source maps increase reverse-engineering cost but are not access control.

Therefore the valuable parts stay server-side:

- database
- fuzzy ranking/weights
- registry validation
- relationship algorithms that do not need client rendering
- permission logic
- exports
- audit/revision logic
- secrets

## Primary threats and controls

| Threat | Baseline controls | Later controls |
|---|---|---|
| Database dump theft | privileged, bounded synchronous export exists (registry.export permission, 500 rows/request); unrestricted dump does not; DB binding only in Worker | export permissions, admin MFA, backup access controls |
| Search scraping | max 50 results; no deep bulk endpoint | rate limits, account budgets, enumeration detection, bot rules |
| SQL injection | parameterized D1 queries; safe dynamic-field allowlist | automated API security tests |
| Credential stuffing | generic login errors | edge + application login throttling, MFA for admin |
| CSRF | SameSite=Strict + CSRF header + Origin check | rotate CSRF/session on privilege elevation |
| XSS | React escaping + CSP baseline | CSP tightening, dependency scanning |
| Broken access control | server-side RBAC on writes | object ownership + policy tests |
| Accidental destructive edit | soft-delete, audit | revision snapshots and revert UI |
| Malicious owner pedigree edit | owner change-request model | evidence, review, dual approval for sensitive fields |
| Session theft | HttpOnly, Secure production cookie, 12h expiry | admin MFA, shorter privileged session, device/session list |
| Source-code theft | server logic separated; production sourcemaps off | optional JS obfuscation only if worth maintenance cost |
| Data exfil via admin | limited result/export APIs | export audit, watermarking, per-role export limits |

## Data classification

Classify before public launch:

- Public registry fields: client must explicitly approve.
- Authenticated-only fields: client must explicitly approve.
- Admin-only/internal fields: logs, raw source metadata, moderation fields.
- Secrets: passwords, tokens, provider credentials — never database-searchable or browser-visible.

Until client approves field visibility, default unknown/raw source fields to server/admin-only.

## Anti-scraping design rules

- No `GET /api/horses?offset=0&limit=100000`.
- No sequential unrestricted `HorseNo` enumeration endpoint returning rich records without policy.
- Search result caps and bounded query lengths.
- Public profile/search/pedigree use explicit provisional field allowlists; `raw_json` and search internals are excluded. Client approval is still required before public launch.
- Heavy graph expansion has depth/node caps.
- Detect repeated sequential IDs, alphabet crawling, and sustained high-cardinality queries.
- Do not rely on robots.txt as a security boundary.

## Write invariants

- Admin/editor writes require authenticated server-side role check.
- Canonical/workflow mutation intent is committed durably through the canonical mutation journal; the final audit row and search settlement may be briefly pending after a failure and are reconciled by the documented maintenance route (`POST /api/admin/maintenance/reconcile-mutations`). "Every write has an audit event" therefore means durable intent plus reconcilable settlement, not a synchronous guarantee.
- Rate limiting is classified per route family: auth (login, 10/min/IP + per-account 5/min), expensive (12/min), dedicated write limiter for state-changing non-expensive routes (30/min/IP), public reads (300/min/IP); every 429 carries `Retry-After: 60`.
- `row_version` optimistic concurrency is enforced on horse updates; stale writes return a conflict.
- Parent IDs must exist.
- self-parent is rejected for new edits even if legacy source contains such anomalies.
- owner users submit changes; they do not directly rewrite canonical parent links by default.
