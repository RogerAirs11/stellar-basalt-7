# Horse Registry V5 — Future Reference / Deployment Cookbook

## 1. Release authority and artifact discipline

- Always freeze a **single exact candidate** by:
  - filename
  - size
  - SHA-256
- Never casually overwrite a validated artifact.
- Preserve:
  - authoritative historical baseline
  - frozen prior candidates/evidence
  - exact current release candidate
- Treat unknown remote resources as **protected** until positively identified.
- Never use a historical certification database as a scratch/showcase target.

## 2. What “production-built” means

Frontend:
- Build with Vite in production mode.
- Bundle + minify JS/CSS.
- Disable public source maps.
- Do not expose `.ts`, `.tsx`, `.map`, `.sqlite`, `.db`, `.zip`, `.env`, source repositories, or internal evidence.

Backend:
- Cloudflare Worker TypeScript is bundled for deployment.
- Backend code is not sent to browser visitors.
- D1 stays server-side.
- Secrets/API tokens must never be embedded in frontend code.

Important:
- Minification is **not true copy protection**.
- Any browser-delivered frontend can eventually be reverse-engineered.
- The strongest protection is architectural: keep valuable logic/data server-side.
- Heavy frontend obfuscation should be selective, not default; it can hurt performance, debugging, and reliability.

## 3. CSP / security-header lesson

A strict CSP can accidentally break valid React UI.

Problem found:
- The UI legitimately used React `style={...}` attributes for dynamic pedigree/chart positioning.
- Production CSP blocked inline style attributes.

Safe fix:
- Allow only style attributes with:
  - `style-src-attr 'unsafe-inline'`
- Keep scripts strict:
  - no `unsafe-inline`
  - no `unsafe-eval`

Also preserve:
- HSTS
- `X-Content-Type-Options: nosniff`
- frame protection / `frame-ancestors`
- Referrer Policy
- Permissions Policy
- API/admin `noindex` rules

## 4. Cloudflare Vite deployment lesson

For a project using the Cloudflare Vite plugin:

**The deployment config must be selected at Vite BUILD time.**

Do not:
- build with one Wrangler config
- then pass a different config only to `wrangler deploy`

Correct flow:
1. Select the intended Wrangler config before/during `vite build`.
2. Let the Cloudflare Vite plugin generate the deployment config.
3. Verify the generated config points to the exact intended Worker/D1.
4. Deploy using that generated output.

This was a real Stage-1 deployment-tooling failure.

## 5. Cloudflare resource safety

Before any mutation:

Inventory:
- account ID
- Worker names
- D1 names
- D1 IDs
- bindings
- public URLs
- apparent role/history
- data counts
- migration state
- quota state

Classify:
- `HISTORICAL_PROTECTED`
- `SAFE_NON_AUTHORITATIVE_SHOWCASE`
- `SCRATCH_PARTIAL`
- `UNKNOWN_PROTECTED`

Rules:
- Unknown = protected.
- Never auto-select a D1 merely by name.
- Never auto-create and silently bind without recording identity.
- Require exact Worker name + D1 name + D1 ID.
- Verify the remote identity read-only immediately before mutation.

## 6. Cloudflare API-token permissions

A token may be strong enough for D1 but still fail Worker deployment.

For Worker upload/deploy, ensure the token includes:
- `Workers Scripts Write`

Never:
- paste tokens into source files
- save them in bundles/reports
- echo them in logs
- return them in agent messages

Use environment variables only.

## 7. D1 Free-tier reality

Important Free-tier constraints encountered:
- D1 writes are limited daily.
- Index writes also count.
- Full canonical imports can consume far more write quota than row counts alone suggest.
- When limits are exceeded, D1 queries/writes can hard-stop until quota reset.

Implication:
- A 78k-row registry may require staged/resumable import across quota windows.
- Do not assume “78k records” means only 78k writes.
- FTS, trigram tables, derived tables, indexes, summaries, and analytics all increase write cost.

For showcase work:
- Prefer an existing safe full DB if one exists.
- Otherwise use a clearly labeled demo dataset rather than abusing historical DBs or paid capacity.

## 8. Demo-mode strategy

A small demo database is acceptable when:
- the UI clearly labels it as demo
- it is not presented as the full client registry
- all important product flows still work

Our successful demo included:
- horses
- people
- horse-person relationships
- pedigree links
- search source
- FTS
- trigram search
- analytics
- registry state
- precomputed filter counts

This allowed a fully functional public showcase while the full canonical registry stayed protected/offline.

## 9. D1 import/export lessons

Deployment-fix bugs found earlier:
1. Migration-preparation code was not retry-safe for repeated `ALTER TABLE ... ADD COLUMN`.
2. A generated analytics INSERT exceeded the statement-size safety limit.

Fix principles:
- Make migration application idempotency-safe.
- Skip only already-existing `ADD COLUMN` operations; keep the rest of the migration.
- Keep statement-size guard intact.
- Chunk oversized payloads rather than raising safety limits.
- Make imports retry-safe and idempotent.

Validated exporter properties:
- deterministic shards
- statement-size cap
- repeat replay safe
- newer analytics payload correctly replaces old state

## 10. Partial-import recovery pattern

Never blindly wipe and restart after a partial import.

Better recovery:
1. Inspect current remote table counts.
2. Detect which shards/tables are already complete.
3. Skip complete shards.
4. Resume incomplete work.
5. Execute one statement at a time when diagnosing.
6. Journal after every successful statement.
7. On failure record:
   - global statement number
   - shard
   - local statement number
   - SQL prefix
   - exact remote error
   - whether failure looks quota-related

This made the Stage-2 recovery safe and deterministic.

## 11. Validation strategy

Stop endless broad testing.

Use staged gates:

### Before release
- unit/integration tests
- build
- schema retry
- data parity
- replay/idempotency
- targeted performance
- security/source-map audit

### After release
Only test the real deployed URL:
- landing/assets
- health
- browse/search
- filters
- profiles
- people
- pedigree/descendants
- mobile/basic responsive behavior
- security headers/CSP
- source-map exposure
- two-user paced concurrency
- basic latency

Once public smoke passes:
- freeze the release
- stop testing unless a real user-visible defect appears

## 12. Agent division of labor

### AI2 / main coding agent
Own:
- all code changes
- architecture decisions
- release decisions
- deployment configuration
- target selection
- bug fixes
- final release freeze

### External-access agents (Luna A/B)
Use only when they have tool/network access the main agent lacks.

Good tasks:
- read-only Cloudflare inventory
- remote API verification
- executing exact prewritten deployment scripts
- independent black-box public testing

Do not delegate to them:
- architecture decisions
- source edits
- ad-hoc fixes
- choosing remote resources
- changing billing
- improvising deployment configuration

For independence:
- use one agent for deployment/external access
- use another for final public black-box validation

## 13. Good deployment sequence

1. Freeze exact candidate hash.
2. Audit production build/security exposure.
3. Inventory Cloudflare read-only.
4. Choose/create a **safe non-authoritative** Worker + D1.
5. Apply schema.
6. Deploy Worker with exact binding.
7. Verify public shell/health/CSP.
8. Import demo/full data using deterministic resumable payload.
9. Verify exact remote counts + analytics/search state.
10. Run public smoke.
11. Independent black-box review.
12. Freeze:
    - source SHA
    - Worker name/version
    - D1 name/ID
    - registry revision
    - public URL
    - smoke result

## 14. Common mistakes to avoid

- Re-testing the entire project after every tiny release-only change.
- Treating local success as proof of remote deployment success.
- Assuming a token with D1 access can deploy Workers.
- Passing a custom Wrangler config only at deploy time in a Vite-plugin project.
- Mutating historical certification resources.
- Trusting resource names without IDs.
- Importing full production-scale data into Free D1 without write-budget planning.
- Clearing a partially imported DB before understanding the failure.
- Raising SQL-size guards instead of chunking data.
- Enabling source maps in public production.
- Assuming minification makes frontend code impossible to steal.
- Heavy obfuscation before the release is stable.
- Letting external agents improvise code or deployment decisions.

## 15. Current showcase release reference

Public showcase:

`https://horse-registry-v5-showcase-20260908.rogerfires10.workers.dev`

Showcase Worker:

`horse-registry-v5-showcase-20260908`

Showcase D1:

`horse-registry-v5-showcase-db-20260908`

D1 ID:

`20d69730-e7ff-4902-bbd4-3e55da2e2008`

Final hardened candidate SHA-256:

`8b1d2008e5c6d968e04a86b53c2180e474eb08b9ae20e026a8dd4d02c7cfe1b7`

Protected historical Agent-A D1:

`9d31f217-a5d7-48a2-8bee-2e3e14310406`

Do not mutate the protected historical DB.

---

## Short rule of thumb

**Protect history, hash everything, keep backend/data server-side, build/minify without source maps, verify Cloudflare identities before writes, make imports resumable, use external agents only for access—not decisions—and stop testing once the real public release passes.**
