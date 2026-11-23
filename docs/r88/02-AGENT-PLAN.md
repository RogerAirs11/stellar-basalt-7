# R88 -> production: implementation contract for the next agent

Date: 2026-10-03. Input package: application 0.45.0 / platform contract 2.16.0. This is the continuation plan, not a list of features already implemented. All P00-P39 tickets below are **TODO**. Read `01-AUDIT.md` and `05-RELEASE-QA.md` before modifying code. Machine-readable equivalent: `agent-tasks.json`.

## Non-negotiable rules

1. Preserve all five independent frontends: Heritage/Core, Equidata Elite, FEI Classic, Retro Astra, standalone Classic. Share domain contracts and headless behavior; do not merge their component trees, CSS scopes, theme systems or native runtimes.
2. Start with reproducibility, data/privacy correctness and transactional authorization. Do not start by adding more polished cards or an unvalidated AI breeding recommender.
3. Synthetic demo records stay in `synthetic:r88`, never in production canonical tables. Missing data is unknown, not clear/zero/verified. No scraped contact, lab report or photo may be republished without permission.
4. A private company cannot claim federation authority by giving itself an administrator role. Every verified assertion names its actual reviewer/issuer and evidence scope. Payment buys a service, never biological truth or official status.
5. Change one bounded domain at a time. Before changing behavior, add a failing regression. Afterward run the targeted tests and restored full suite. Source-string checks are useful guards, not proof of concurrency, privacy or accessibility.
6. Never fabricate passing build logs, original omitted assets, registry records, credentials, lab interpretation, delivery, sales or profitability. Keep blocked checks and disabled capabilities visible.
7. Migrations are additive first. No destructive production migration or bulk historical correction without dry-run, backup, reviewed mapping and compensating procedure. Do not renumber the 36 existing migrations; inspect the restored repository before selecting the next filename.
8. Each ticket ends with changed paths, migration notes, test commands/results, screenshots where relevant, unresolved risks and rollback. Update JSON status only after acceptance evidence exists. Commit tickets separately.

## Execution order and release gates

**Gate A - reproducible demonstrator:** P00 + P33, plus regression coverage for the R88 patch. The static demo already exists; hosted routing/CSP/storage and the original app build still need verification.

**Gate B - trustworthy registry pilot:** P01-P10, P26, P28-P31 and P39 for enabled features. Scientific interpretation may remain disabled until reviewer approval. Restore/permission tests are release gates, not optional polish.

**Gate C - paid professional/farm pilot:** P11-P20, frontend implementations, P34-P35. Do not accept automated payments until P17-P18 pass. Manual paid pilot agreements can validate demand before full billing, with real accounting and explicit fulfillment.

**Gate D - optional expansion:** P36-P38 only after evidence supports them. Native apps, social feeds, automated breeding rankings and horse escrow are not critical-path work.

Parallelize independent work after P00, but never skip dependencies. Calendar forecasts depend on staffing and waiting for agreements; person-day ranges below are rough engineering planning estimates, not Iran salary quotations, fixed-price bids, or promises. They overlap with broad client budgeting categories and must not be added to those categories a second time.

## Canonical model to implement incrementally

Reuse existing users, organizations, memberships, horses, grants, assertions and audit structures after inspecting their exact schema. Proposed new names are architectural targets, not claims that these tables exist now:

- `command_receipts(actor_id, command, target_id, idempotency_key, request_hash, result_json, created_at)`; unique scoped key. A retry with a different hash conflicts.
- `directory_people`, `directory_organizations`, `professional_profiles`, `professional_roles`, `professional_credentials`, `service_areas`, `profile_claims`. A public person is not necessarily a login user. Credential authenticity is separate from paid plan.
- `service_requests`, `service_request_events`, `notification_outbox`. Contact access is consented and grant-checked on every read. Request, booking and payment are separate resources.
- `workspace_collections`, `workspace_horses`, `workspace_tasks`. Membership is not ownership. Do not duplicate canonical horse identity inside a farm table.
- `data_sources`, `source_licenses`, `import_batches`, `import_staging_rows`, `entity_source_links`. Preserve source assertions; canonical selection is a reviewed operation.
- `billing_prices`, `orders`, `order_lines`, `payment_attempts`, `payment_events`, `entitlement_events`, `reconciliation_cases`. Financial history is append-only with compensating corrections.
- `dossier_snapshots`, `dossier_share_links`, `moderation_cases`, `consent_events`. Tokens are hashed; private share links are not public SEO URLs.

Use stable opaque IDs, foreign keys, constrained enum/state transitions, integer row versions, UTC timestamps, explicit date precision, indexed access paths and scoped uniqueness. Distinguish creation time, source event time, retrieval time and review time. Add indexes based on actual query plans. Apply the selected database provider's tested transaction semantics, not an assumed universal SQL dialect.

## API contract template

Extend `PlatformClient` and the existing response envelope rather than inventing a second client. The paths below are **proposed**; inspect current route conventions before adopting them. Every mutation requires authentication (except deliberately anonymous contact intake), appropriate CSRF/origin protection, validation, resource authorization, idempotency where retryable, row-version conflict behavior and audit.

| Proposed path | Purpose | Critical condition |
|---|---|---|
| `GET /api/directory/providers` | Cursor-paginated professional search | Public projection, bounded filters, no raw contacts |
| `GET /api/directory/providers/:id` | Published provider details | Consent/credential expiry applied |
| `POST /api/directory/claims` | Request authority to manage profile | Evidence + moderation; no immediate official badge |
| `POST /api/service-requests` | Consented request | Current published provider; idempotency; rate limit |
| `GET /api/service-requests/mine` | Requester/provider inbox | Current participant/organization authority |
| `POST /api/service-requests/:id/status` | State transition | Expected version + permitted actor transition |
| `GET /api/workspaces/:id/herd` | Private herd collection | Workspace + horse-scoped access |
| `POST /api/workspaces/:id/tasks` | User-configured task/reminder | No automatic veterinary prescription |
| `POST /api/dossiers` | Versioned permitted evidence snapshot | Explicit selection and authorization |
| `POST /api/billing/orders` | Immutable-price order | Server recomputes integer amount/currency |
| `POST /api/billing/orders/:id/pay` | Create payment attempt | One active attempt policy; trusted order identity |
| `GET /api/billing/callback/:provider` | Receive provider return | Redirect status is untrusted; verify server-side |
| `GET /api/billing/entitlements` | Current paid capabilities | Payment state does not replace resource grant |
| `POST /api/imports/:id/preview` | Non-mutating import preview | Source rights + staged checksum |
| `POST /api/imports/:id/commit` | Reviewed import operation | Preview version + authorized reviewer |

An error contract must distinguish invalid input, unauthenticated, forbidden, absent, stale version, conflict, throttled, unsupported capability, provider unavailable and internal failure. Do not turn all failures into an empty list. Return a safe correlation ID, not database traces or secrets. Dates and money units must be documented in types and fixtures.

## Five-frontend acceptance contract

Each frontend owns navigation, spacing, typography, layout and local visual components. Each consumes the same typed entity and command semantics. Per skin, verify registry search/filter/back navigation; horse identity and evidence; pedigree pan/zoom/unknown ancestry; result history; permitted genetics; listing inquiry and expiry; people/provider directory; service inbox; private workspace; honest billing status. Unimplemented production modules must be clearly unavailable, with the demo link separate.

For desktop density start with the checked-in skin-specific tokens, not one global design. Reduce redundant headers and padding first; use a 4/8/12/16/24 rhythm where it fits the skin. Avoid tiny body text as a space-saving trick. Keep touch targets approximately 44px, mobile input text 16px, readable line height, visible focus and logical RTL properties. Sticky headers must not cover focused controls. A bounded pedigree/table scroller is legitimate; a whole-page horizontal overflow is not.

Do not certify all skins from the new static workbench screenshots. Run the actual five application implementations at 360, 390, 768, 1280 and 1440 pixels, EN/FA, long/missing data, 200% zoom, keyboard, reduced motion and slow/error network states. Record intentional visual differences separately from semantic parity bugs.

## Ticket backlog

### P00 - Restore the complete repository and establish a reproducible baseline

**Status:** TODO. **Priority:** P0. **Depends on:** none. **Planning effort:** 1-3 person-days. **Gate:** all.

**Paths:** `PACKAGE-INFO.txt`; `package.json`; `package-lock.json (restore from original repository)`; `public/ (restore licensed original assets)`; `docs/ (restore original operational documents)`.

**Implementation sequence**

1. Work on a branch. Preserve the supplied R87 baseline and this R88 patch. Do not replace the new public directory wholesale when restoring assets; merge it and preserve demo-workbench and business-model.
2. Restore the original exact lockfile from upstream commit 2bcade2 or the actual matching release. Do not generate a new lockfile and describe it as the original. Obtain the original media/seed files through authorized channels; never copy production secrets into the source ZIP.
3. Run npm ci in an unrestricted isolated CI runner. Record Node, npm, OS, dependency resolution and vulnerability review. Run the original npm run check without disabling failing gates. Separate pre-existing failures, omitted files and R88 regressions.
4. Restore the three omitted AI architecture/operations/real-data documents referenced by validate-ai-assistant. If unavailable, explicitly revise the documentation contract in its own reviewed change; never create empty pass-through stubs.

**Acceptance evidence**

- Clean checkout installs identically twice with the same lockfile checksum.
- Full build, full TypeScript and full Vitest have logs; no gate is marked green solely because its script was skipped.
- All original licensed asset URLs resolve; no uploaded secret or font binary is added to public distribution without a separately authorized asset delivery process.

**Rollback:** Revert environment/lockfile changes as a unit; retain audit logs and R88 source. Do not change application semantics while restoring the baseline.

### P01 - Choose one production topology and prove database adapter behavior

**Status:** TODO. **Priority:** P0. **Depends on:** P00. **Planning effort:** 3-6 person-days. **Gate:** production.

**Paths:** `src/db/types.ts`; `src/db/provider.ts`; `src/db/localSqlite.ts`; `src/db/tursoCompat.ts`; `src/db/supabaseCompat.ts`; `src/db/sqliteSqlToPostgres.ts`; `scripts/pg-parity-gate.mjs`; `tests/integration/db-parity.test.ts (new)`.

**Implementation sequence**

1. Write an architecture decision with the actual launch runtime, database, object store, region, secrets manager and backup target. A Liara price quotation is not proof that the Worker application runs unmodified there.
2. Define a portable command boundary that returns affected-row count and transaction result. Execute fixtures against the real chosen backend and SQLite reference; exercise Postgres/Turso only if those adapters remain supported for launch.
3. Pin uniqueness error classification, timestamp normalization, transaction rollback and affected-row metadata. Do not infer database conflicts by matching every error containing the word unique.
4. Fail startup on unsupported provider/capability combinations. Document deliberately unsupported adapters instead of silently falling back to mock or a different source of truth.

**Acceptance evidence**

- The same seed and command sequence produce equivalent rows and errors on every supported provider.
- Injected failure between record and audit writes leaves neither committed.
- Two concurrent clients cannot both claim an exclusive record or execute the same command twice.

**Rollback:** Keep the previously selected provider active; schema changes remain additive. Do not dual-write production data until replay/reconciliation has been demonstrated.

### P02 - Make grant and organization membership revocation atomic and auditable

**Status:** TODO. **Priority:** P0. **Depends on:** P01. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/access/horseAccess.ts`; `src/audit/mutationJournal.ts`; `migrations/ (new additive migration)`; `tests/integration/grant-commands.test.ts (new)`.

**Implementation sequence**

1. Trace revokeHorseGrant and revokeOrganizationMembership: conditional UPDATE followed by unconditional audit INSERT must be replaced. Assign an immutable operation_id to the command.
2. Execute authorized state change and matching audit event in one transaction. If the adapter only offers atomic batch, use a proven operation-nonce design where audit INSERT SELECT is conditional on the exact successful operation marker; do not rely on connection-local changes() across pooled adapters.
3. Repeated revocation returns a documented no-op or conflict, never a second successful-revocation event. Include actor, target, prior/new state and timestamp without leaking private notes.
4. Normalize myGrants to the same direct-user and organization-membership start/end/revocation policy as actual authorization. Ignore deleted horses and disabled organizations.

**Acceptance evidence**

- Revoking a non-existent, already-revoked or unauthorized grant creates zero success audit rows.
- A second writer revoking the same grant yields one successful mutation and one audit event.
- Future-start, malformed-date, exact-expiry and revoked-membership cases match direct authorization and myGrants.

**Rollback:** Disable grant mutations using a server feature flag if transactional safety fails; preserve existing read authorization. Never roll back by deleting the audit trail.

### P03 - Close permission-to-write races and add versioned marketplace commands

**Status:** TODO. **Priority:** P0. **Depends on:** P02. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `src/api/modules/marketplace.ts`; `src/marketplace/policy.ts`; `src/contracts/platform.ts`; `src/frontend-kit/platformClient.ts`; `migrations/ (row_version and command receipts)`.

**Implementation sequence**

1. Add integer row_version >= 1 to listings and inquiries, incremented on every mutable command. Read responses expose it. Require expectedVersion on edits; return 409 with the current version on a stale write.
2. Use a unique idempotency key scoped to actor + command + target. Persist a request digest and stable result; replaying the same key with a different payload returns conflict.
3. Evaluate horse existence, seller authority, relevant active organization grant and listing state in the same transactional command as the write. Preserve administrator authorization as an explicit separate branch.
4. Apply the same model to listing expiry/renewal and inquiry status. Sold listing is not ownership transfer. Inquiry contact fields remain private after grant revocation.
5. Add new contract fields compatibly, bump contract version and update all client adapters. Disable mutation controls until a fresh version is loaded after conflict.

**Acceptance evidence**

- Revoke grant concurrently with edit/inquiry update; no edit may commit after the transaction observes the revoked authority.
- Two edits with one version produce exactly one success.
- Network retry creates one inquiry and one audit/notification event.
- Expired, hidden, deleted-horse, self-inquiry and invalid transition scenarios fail without side effects.

**Rollback:** Feature-flag new writes off; retain new version columns and receipts. Do not downgrade to a weaker write endpoint as a fallback.

### P04 - Enforce one public/private projection policy across every output

**Status:** TODO. **Priority:** P0. **Depends on:** P00. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `src/privacy/policy.ts`; `src/privacy/projections.ts`; `src/db/publicProjection.ts`; `src/api/modules/marketplace.ts`; `src/api/modules/genetics.ts`; `src/api/modules/media.ts`; `src/ai/tools/registry.ts`; `tests/integration/privacy-matrix.test.ts (new)`.

**Implementation sequence**

1. Inventory horse detail, marketplace detail, search snippets, offspring, comparisons, exports, documents, assistant tool results and cached responses. Classify each field by visibility and consent.
2. Use centralized projection functions rather than deleting a few fields locally. Add explicit projection types so a public response cannot contain the full private database object.
3. Create one fixture with distinctive sentinel strings in unpublished genotype, accession, contact, notes, exact location and private document fields. Scan every anonymous output and AI tool response for those sentinels.
4. Vary cache keys by allowed public dataset/version, never cache private variants publicly. Redact structured logs; mask contact from analytics events.

**Acceptance evidence**

- Anonymous, unrelated user, owner, organization member, revoked member, reviewer and administrator each match the expected field matrix.
- Changing visibility removes the field from subsequent public responses and invalidates public caches.
- No private sentinel appears in HTML, JSON, exports, search, AI output or public logs.

**Rollback:** Temporarily disable affected public endpoints/exports rather than reverting to unfiltered serialization.

### P05 - Run actual HTTP security and abuse tests

**Status:** TODO. **Priority:** P0. **Depends on:** P00, P04. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/worker.ts`; `src/security/framePolicy.ts`; `src/security/origin.ts`; `src/auth/`; `src/api/routes.ts`; `tests/integration/http-security.test.ts (new)`.

**Implementation sequence**

1. Run the Worker in the selected runtime over HTTP. Verify SAMEORIGIN + frame-ancestors self only for /classic-registry and descendants; all other application pages remain unframeable.
2. Test CSRF on authenticated mutations and Origin/Fetch-Metadata on anonymous inquiries. Origin-less scripted requests need rate limits and validation; an Origin check alone is not bot prevention.
3. Add configurable request/body limits and per-account plus privacy-preserving IP rate limits for signup, OTP, login, search, inquiry and upload. Return Retry-After for throttles.
4. Test session rotation, logout/revocation, password recovery, brute force controls, safe redirects, HSTS at actual HTTPS ingress and CSP without broad unsafe allowances.

**Acceptance evidence**

- Same-origin Classic works; unrelated embedding fails; path-prefix lookalikes receive no exception.
- Cross-origin form/fetch mutations fail; permitted same-origin calls succeed.
- Repeated inquiry/login/OTP requests are bounded without account enumeration.

**Rollback:** Roll back only the offending configuration; preserve stricter protections. Provide a documented operator recovery path before enabling throttles.

### P06 - Version and review the genetics catalog and historic interpretations

**Status:** TODO. **Priority:** P0. **Depends on:** P00, P04. **Planning effort:** 3-6 person-days. **Gate:** production.

**Paths:** `src/genetics/assayCatalog.ts`; `src/privacy/projections.ts`; `src/api/modules/genetics.ts`; `src/web/heritage/HorseModulesPanels.tsx`; `migrations/ (catalog interpretation provenance)`; `tools/audit-legacy-genetics.mjs (new)`.

**Implementation sequence**

1. Have a qualified equine genetics reviewer sign a dated assay table: gene, variant, aliases, inheritance, accepted notation, species/breed scope, source and interpretation version. R88 corrects PSSM1/MH but is not clinical validation.
2. Add append-only interpretation_version, interpreted_at and raw_lab_result preservation. Never overwrite a laboratory report to match a new catalog. Distinguish report authenticity review from scientific interpretation and from clinical diagnosis.
3. Build a read-only report of legacy ASLIP, TMEM38 and cream_SLC36A1 rows. Quarantine ambiguous cream/champagne records pending original-report review; do not globally rename SLC36A1 because valid champagne records use it.
4. Preserve one-copy/two-copy differences and conflicting retests. An unresolved conflict disables downstream recommendation for that assay, not the entire horse profile.
5. Do not add commercial PSSM2 predictions or treat not-tested as clear. Keep medical advice and breeding fitness decisions outside automated verdicts.

**Acceptance evidence**

- PSSM1/MH/HYPP single-copy variants are never described as unaffected recessive carriers.
- All valid genotype notations and unknown/uninterpretable inputs have reviewed fixtures.
- Legacy ambiguous rows are counted and left unchanged by dry-run.
- Public projections cannot leak report accession/private attachment/notes.

**Rollback:** Disable interpretation display for unreviewed assays; retain raw results privately with provenance. Never delete scientific history to hide a mistake.

### P07 - Validate pedigree quality, coefficients and breeding evidence limits

**Status:** TODO. **Priority:** P0. **Depends on:** P06. **Planning effort:** 3-6 person-days. **Gate:** production.

**Paths:** `src/pedigree/engine.ts`; `src/pedigree/coefficients.ts`; `src/pedigree/breeding.ts`; `src/pedigree/integrity.ts`; `src/pedigree/interpretation.ts`; `tools/verify-pedigree-coefficients.mjs`.

**Implementation sequence**

1. Keep the existing coefficient engine. Extend independently reviewed reference pedigrees for founder, half/full siblings, parent-offspring, repeated ancestors, inbred common ancestor, missing parents, cycles and depth truncation.
2. Display algorithm version, graph depth, source version, completeness and assumptions next to every number. Label zero with incomplete ancestry as no inbreeding detected within available pedigree, not unrelated or safe.
3. Reject self-parent/cycle edits before commit and recheck affected descendants. Parentage proof, registry parentage assertion and DNA-confirmed parentage must remain different evidence types.
4. Cache by graph/source revision + algorithm version + depth. Invalidate affected descendant/pair results after a parent correction. Bound depth, nodes, runtime and output size.
5. Publish explanations and common ancestors before any ranking. Do not optimize a breeding recommendation solely for low COI, color or winning ancestors.

**Acceptance evidence**

- Independent fixtures match expected coefficients and definitions.
- A missing ancestor cannot increase displayed certainty.
- Pedigree correction invalidates dependent cached calculations.
- Pathological/cyclic/wide graphs return bounded error or partial-evidence state rather than hanging.

**Rollback:** Disable numerical/recommendation panels independently of registry browsing if scientific checks fail; preserve raw family edges.

### P08 - Repair reproduction/calendar semantics without corrupting historical rows

**Status:** TODO. **Priority:** P0. **Depends on:** P06. **Planning effort:** 2-3 person-days. **Gate:** production.

**Paths:** `src/genetics/breedingDates.ts`; `src/registry/dates.ts`; `src/api/modules/genetics.ts`; `tools/audit-breeding-dates.mjs (new)`; `tests/unit/registryDates.test.ts`.

**Implementation sequence**

1. Document canonical event date storage: ISO Gregorian date + precision, and a separately defined Solar Hijri breeding season. Never interpret an English UI locale as a different stored calendar.
2. Generate a read-only anomaly report for Gregorian-looking season values, invalid days, event before birth, date/season mismatch, implausible order and missing precision. Require human review for corrections.
3. Use a reviewed leap-year/boundary fixture set around Nowruz, year-only and month-only dates. Preserve uncertain dates as intervals, not invented January 1 values.
4. Add type/schema validation to imports, API commands and all five frontend forms. Record raw imported value and transformation rule.

**Acceptance evidence**

- 2019 and 1405 partial dates produce interval-aware displays in both languages.
- Invalid leap/day/month values fail consistently.
- Dry-run cannot write; reviewed correction has audit and old value.

**Rollback:** Disable only suspect reproductive imports/edits; do not mass-convert stored seasons.

### P09 - Implement secure evidence upload and private document delivery

**Status:** TODO. **Priority:** P0. **Depends on:** P01, P04. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/api/modules/media.ts`; `src/api/modules/mediaPolicy.ts`; `src/api/mediaProxy.ts`; `src/contracts/media.ts`; `src/storage/ (new adapters as needed)`.

**Implementation sequence**

1. Create upload intent with actor/resource grant, maximum size, content-type allowlist and random object key. Never accept user-supplied storage paths or trust browser MIME alone.
2. Quarantine uploads; inspect magic bytes, scan supported files for malware, strip image EXIF/location, generate safe thumbnails and reject active HTML/SVG unless safely transformed.
3. Serve private documents through short-lived authorization-checked access. Do not put public permanent document URLs in public horse responses. Record expiry, evidence class, consent and issuer separately.
4. Delete abandoned uploads on retention schedule; account for storage/egress. Provide an operator quarantine queue and failure reason without rendering malicious payload.

**Acceptance evidence**

- Oversized, mismatched MIME, traversal, HTML/SVG script and unauthorized upload/read tests fail.
- Revoked access prevents obtaining new URLs; existing URL lifetime is bounded and documented.
- Private metadata does not survive thumbnail/public projection.

**Rollback:** Disable new uploads while retaining existing verified evidence. Revoke signed URLs/rotate signing keys if access policy fails; do not purge evidence without retention review.

### P10 - Create licensed ingestion, staging and duplicate adjudication

**Status:** TODO. **Priority:** P1. **Depends on:** P02, P07, P08, P09. **Planning effort:** 5-9 person-days. **Gate:** production.

**Paths:** `tools/import_xlsx.py`; `src/registry/identifiers.ts`; `src/registry/impact.ts`; `migrations/ (source and staging additions)`; `src/api/modules/imports.ts (new)`.

**Implementation sequence**

1. Create source agreement registry with issuer, scope, retention, redistribution permission, update cadence and responsible operator. Publicly visible data is not automatically reusable.
2. Stage raw rows with source_id, external_id, retrieved_at, checksum and mapping version. Dry-run must report proposed creates/updates/conflicts with no canonical writes.
3. Normalize Persian/Arabic letter variants and digits while preserving originals. Treat registry+issuer and microchip as typed identifiers; do not globally deduplicate by horse name.
4. Provide reviewer merge and unmerge workflow with redirect aliases, provenance and downstream pedigree recalculation. Never silently collapse two horses sharing a name.
5. Batch imports resumably with row-level outcomes, transaction boundaries and retry receipts. Expose outstanding conflicts and operator minutes per accepted record.

**Acceptance evidence**

- Reimporting identical file creates no duplicate horses or evidence.
- Conflicting parentage and identifier collisions enter review instead of overwriting trusted fields.
- Merge/unmerge preserves source assertions, listings, offspring links and audit history.
- Synthetic namespace cannot be selected as a production canonical source.

**Rollback:** Stop import worker, retain staged files and roll back by import operation identifiers using a reviewed compensating process; never delete unrelated later edits.

### P11 - Model people, organizations and professional credentials separately

**Status:** TODO. **Priority:** P1. **Depends on:** P02, P04. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/contracts/platform.ts`; `src/api/modules/directory.ts (new)`; `src/directory/ (new domain)`; `migrations/ (directory schema)`; `src/frontend-kit/platformClient.ts`.

**Implementation sequence**

1. Create public directory persons and organizations separately from login users. One person may hold multiple roles or work for multiple organizations; an organization has authorized managers.
2. Add professional profiles, service categories, coarse service areas, contact preference, publication consent, languages and availability text. Use the 22 demo categories as a reviewed starting vocabulary, not evidence that all credentials exist.
3. Credentials store issuer, role, identifier, issue/expiry date, evidence reference and verification state. DC, judge, steward and ringmaster are distinct; translate labels with an equestrian domain reviewer.
4. Implement claim/represent profile request with evidence, moderation and an appeal path. User self-declaration must never become federation verification. Expose only consented public fields.
5. Create cursor-paginated directory search by category/province/city/name; exact stable city/province codes must come from an approved dataset, not user-entered variants.

**Acceptance evidence**

- One person with rider and trainer roles is not duplicated.
- Expired credential loses active badge while history remains.
- Unrelated account cannot claim or change an organization.
- Public contact visibility follows consent and revocation.

**Rollback:** Feature-flag directory writes/publication; retain private claims for review, do not publish raw migrated contacts.

### P12 - Build a consented service request inbox before booking or commissions

**Status:** TODO. **Priority:** P1. **Depends on:** P03, P11. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/api/modules/serviceRequests.ts (new)`; `src/directory/requestPolicy.ts (new)`; `src/contracts/platform.ts`; `migrations/ (service requests and transitions)`.

**Implementation sequence**

1. Implement request create/read/list/status using provider ID, category, coarse location, optional horse ID and a minimized note. Do not solicit medical details in a public lead form.
2. Use states new, acknowledged, discussing, closed, withdrawn, spam with an explicit role transition table. A service request is not a confirmed appointment and never displays paid or booked.
3. Contact sharing requires explicit user consent. Only requester and current authorized provider manager can see it. Allow blocking, reporting and withdrawal; rate-limit repeated targeting.
4. Add row versions, idempotency, timestamps and audit. Reuse command semantics, not marketplace-specific fields that conflate a horse seller with a veterinarian.
5. Implement provider response-time statistics only from real eligible requests, with sample size and exclusions. Do not create synthetic ratings or invented response badges.

**Acceptance evidence**

- Revoked provider manager loses contact access immediately.
- Retry creates one request; terminal transitions reject stale edits.
- User can withdraw and block without exposing the note publicly.
- Demo requests never reach production APIs.

**Rollback:** Disable request creation and show read-only directory; preserve pending real requests and notify operators of interruption.

### P13 - Introduce transactional notifications and accurate delivery language

**Status:** TODO. **Priority:** P1. **Depends on:** P03, P12. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `src/notifications/email.ts`; `src/notifications/sms.ts`; `src/notifications/outbox.ts (new)`; `src/api/modules/authExt.ts`; `migrations/ (outbox)`.

**Implementation sequence**

1. Replace ambiguous delivered=true on HTTP acceptance with explicit queued, provider_accepted, delivered, failed states. A 2xx provider reply alone is not recipient delivery.
2. Write outbox event in the same transaction as the request/state mutation. Use unique logical event key; retry with bounded exponential backoff and dead-letter queue.
3. Use provider-specific adapters with tested request and response schema, verified callback signatures where supported, and allowlisted purpose templates. Keep OTP separate from marketing consent.
4. Add unsubscribe/quiet-hour handling for non-essential notifications and per-tenant spending limits. Do not log tokens, full phone numbers or message bodies unnecessarily.
5. UI distinguishes request recorded from provider notified. Support receives actionable undelivered queue; no real emergency-dispatch promise.

**Acceptance evidence**

- Simulated provider acceptance does not set delivered.
- Repeated callback/retry cannot duplicate delivery records or billing counts.
- A database rollback emits no message.
- Missing provider configuration is visible and never shown as success.

**Rollback:** Pause outbox consumers, preserve queue and use operator follow-up; never reset delivery state to resend every event.

### P14 - Add farm workspace collections and delegated daily work

**Status:** TODO. **Priority:** P1. **Depends on:** P02, P04, P10. **Planning effort:** 5-8 person-days. **Gate:** production.

**Paths:** `src/api/modules/workspaces.ts (new)`; `src/workspaces/ (new domain)`; `src/contracts/platform.ts`; `migrations/ (workspace collections and tasks)`.

**Implementation sequence**

1. Use existing organizations/grants where appropriate; a private herd collection is not proof of ownership. Add stable workspace, collection membership and staff assignment relations.
2. Create recurring reminders and tasks for user-entered events such as document renewal, farrier visit or planned veterinary appointment; medical schedules must be configured by a qualified person, not generated as instructions.
3. Show private herd dashboard with due/overdue, recently changed evidence, assigned staff and incomplete records. Make staff permissions action-specific and test revocation.
4. Add bulk safe operations, CSV export with formula-injection protection, and import onboarding using P10. Instrument time to first useful herd view.
5. Build one complete paid workflow before adding broad accounting, feed inventory or an ERP. Avoid paid ownership of the canonical record.

**Acceptance evidence**

- A horse in two private collections does not change its ownership assertion.
- Staff sees only granted horse/task data; revoked access disappears.
- Recurring task creation is idempotent across scheduler retries.
- Export obeys privacy and cannot execute spreadsheet formulas from user text.

**Rollback:** Disable workspace mutations and keep read/export available according to grants. Do not remove canonical horses when deleting a collection.

### P15 - Assemble shareable sale dossiers with expiry and evidence limits

**Status:** TODO. **Priority:** P1. **Depends on:** P04, P07, P09, P14. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `src/api/modules/dossiers.ts (new)`; `src/marketplace/`; `src/contracts/platform.ts`; `migrations/ (share links and snapshots)`.

**Implementation sequence**

1. Create a versioned snapshot of permitted identity, pedigree, results and explicitly selected documents. List source, review state and generated_at for every evidence section.
2. Generate a revocable, high-entropy share token with expiry and optional authenticated recipient restriction. Store token hash rather than token in logs/database.
3. Display snapshot age, revoked/expired state and a clear warning that the dossier is neither title transfer nor a veterinary purchase examination.
4. Allow sellers to redact private contact/genetics while keeping the absence visible as not shared rather than clear. Paid formatting does not buy a verification badge.

**Acceptance evidence**

- Revoked/expired link cannot reveal old cached private data.
- Snapshot does not silently change when the canonical record changes.
- Source correction marks affected dossier stale; public link exposes only approved fields.

**Rollback:** Revoke dossier links and disable creation; retain immutable snapshots under retention policy for audit.

### P16 - Add moderation, reporting and marketplace trust operations

**Status:** TODO. **Priority:** P1. **Depends on:** P03, P09, P12. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/api/modules/marketplace.ts`; `src/api/modules/moderation.ts (new)`; `src/moderation/ (new)`; `migrations/ (reports and cases)`.

**Implementation sequence**

1. Implement report reasons, case ownership, evidence, decision, appeal and transparent listing suspension status. Separate content moderation from registry factual correction.
2. Require current seller mandate and a meaningful expiry/renewal policy; expose last confirmed availability. Remove unsupported delivery, escrow and guaranteed-vetting language.
3. Protect contact from bulk harvesting; document allowable lead volume. Allow user blocking and spam action without deleting investigation records.
4. Use a triaged queue with severity, age and assigned operator. Establish response hours and escalation contacts; do not advertise 24/7 support without staffing.
5. Keep sale price asking/private/negotiable distinct from completed transaction value. Do not report marketplace GMV from listing prices.

**Acceptance evidence**

- Reported item can be hidden without deleting the horse profile.
- Appeal and reversal retain previous decision trail.
- Expired seller authority prevents renewal and access to new inquiries.
- No synthetic rating or sold amount enters production metrics.

**Rollback:** Pause new listings/requests while keeping published moderation outcomes and support intake available.

### P17 - Implement billing catalog, orders and unambiguous money units

**Status:** TODO. **Priority:** P1. **Depends on:** P01, P14. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/commerce/ (extend beyond economics.ts)`; `src/api/modules/billing.ts (new)`; `src/contracts/platform.ts`; `migrations/ (billing tables)`.

**Implementation sequence**

1. Keep economics.ts a planning module, not a ledger. Add immutable price versions, order line items, discounts, tax handling policy, period and payer organization.
2. Store all amounts as safe integer minor units with an explicit currency. For Iran choose one documented internal unit, preferably IRR, and convert toman exactly at display/provider boundaries. Never infer unit from a numeric size.
3. Orders use pending, awaiting_payment, paid, cancelled, refunded/partially_refunded with tested transitions. Persist a price snapshot so future repricing cannot change an existing payable order.
4. Add payment_attempt with provider, unique authority/reference, trusted amount, currency, state and verification timestamps. Do not store card credentials.
5. Require accountant/legal review of invoice, tax, merchant and cancellation requirements for the actual company; do not encode unverifiable legal assumptions as constants.

**Acceptance evidence**

- A 1,900,000-toman plan cannot be charged as 1,900,000 rial.
- Changing catalog price does not mutate an existing order.
- Duplicate order submission with same key creates one order.
- Client-supplied total is ignored and recalculated from server catalog.

**Rollback:** Disable checkout, preserve read-only invoices/orders; never delete financial records as rollback.

### P18 - Integrate verified payments, entitlements and reconciliation

**Status:** TODO. **Priority:** P1. **Depends on:** P13, P17. **Planning effort:** 5-8 person-days. **Gate:** production.

**Paths:** `src/commerce/payments/ (new provider adapter)`; `src/commerce/entitlements.ts (new)`; `src/api/modules/billing.ts (new)`; `migrations/ (ledger and reconciliation)`.

**Implementation sequence**

1. Implement provider request/verify using current official merchant documentation and sandbox credentials. Verify the stored amount and authority server-side; never trust redirect query status.
2. Within a transaction write verified payment and exactly one entitlement event keyed by payment/order. Already-verified provider responses must be checked against stored identity and cannot grant a second period.
3. Model entitlement activation, expiry, cancellation and refund separately from order status. No automatic recurring debit unless merchant/product explicitly supports it; use renewal invoices initially.
4. Add daily reconciliation of provider settlements against attempts and ledger, alert unresolved mismatches, record fees separately and support accountant export.
5. Test charge/refund/timeout/manual-review failures; use least-privilege secrets and audit admin adjustments. Do not enable commissions or escrow in this phase.

**Acceptance evidence**

- Forged callback, wrong amount, wrong authority and replay produce no entitlement.
- Concurrent callbacks create one payment/entitlement event.
- Provider timeout remains pending verification rather than paid/failed by guess.
- Refund/reconciliation exceptions enter operator queue with a traceable resolution.

**Rollback:** Disable new payment requests; continue safe verification/reconciliation of existing attempts. Never roll back paid entitlements without a recorded compensating event.

### P19 - Design the first paid offers and feature entitlements without harming public trust

**Status:** TODO. **Priority:** P1. **Depends on:** P14, P15, P18. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/commerce/catalog.ts (new)`; `src/frontend-kit/capabilities.ts`; `src/contracts/platform.ts`; `public/business-model/`; `docs/r88/03-BUSINESS-MODEL-IRAN.md`.

**Implementation sequence**

1. Pilot three offers only: farm workspace, professional response tools and explicitly sponsored visibility. Treat R88 prices as hypotheses; persist actual offers/renewal terms in the billing catalog.
2. Keep basic horse identity, correction submission and safety/provenance information free where licensed for publication. Never sell official approval, biological truth or suppression of adverse evidence.
3. Gate features on server entitlements and resource authorization; a paid plan does not confer access to someone else's horse or organization.
4. Label ads and featured placement clearly. Exclude sponsored boost from scientific breeding rankings and credential authenticity.
5. Meter actual support/data cost by offer and cap unlimited promises. Provide export and straightforward cancellation.

**Acceptance evidence**

- Expired plan removes paid conveniences without deleting customer records or public truth.
- Paid unrelated account still gets 403 on private resources.
- Sponsored results are visibly labeled in both languages and all frontends.

**Rollback:** Pause new sales while honoring existing contracted access or issuing reviewed refunds; retain free core browsing.

### P20 - Create canonical frontend domain loaders and command hooks

**Status:** TODO. **Priority:** P1. **Depends on:** P03, P11, P12, P14. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/contracts/platform.ts`; `src/frontend-kit/platformClient.ts`; `src/frontend-kit/mockPlatformClient.ts`; `src/frontend-kit/recordModules.ts`; `src/frontend-kit/domain/ (new headless modules)`.

**Implementation sequence**

1. Extract shared semantics only: data loading, normalized errors, abort/race handling, pagination, capability checks and command status. Keep presentation components in each frontend.
2. Expose explicit loading, empty, forbidden, unavailable, error and stale states. Mock provider should return 501 for unimplemented real capability, not a fabricated successful transaction.
3. Add typed directory, serviceRequest, workspace and billing modules. Put shared field labels/date semantics in locale resources but permit each skin its own page composition.
4. Implement one module end-to-end with contract tests before moving another. No global fetch hook that hides cache/privacy policy or an all-purpose themed component with dozens of booleans.

**Acceptance evidence**

- Same command/error semantics pass against real and explicit demo adapters.
- Navigating rapidly cannot show the prior horse's private data.
- Cancelled requests do not update unmounted state.
- Five frontend entrypoints and style roots remain independent.

**Rollback:** Revert one extracted module at a time; keep contracts backward compatible until all consumers migrate.

### P21 - Refine Heritage/Core without imposing another frontend design

**Status:** TODO. **Priority:** P2. **Depends on:** P20. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/web/main.tsx`; `src/web/heritage/`; `src/web/frontendRegistry.ts`.

**Implementation sequence**

1. Capture approved baseline at 360/390/768/1280/1440 in FA and EN. Preserve the existing visual identity and information hierarchy.
2. Extract large record-panel state into Heritage-local components plus P20 headless loaders. Keep visual components out of the shared domain kit.
3. Add production directory/workspace/service inbox navigation only when corresponding APIs exist. Distinguish unavailable versus empty records.
4. Use compact metadata rows and collapsible secondary evidence instead of shrinking all fonts. Preserve table navigation and pedigree pan/zoom.

**Acceptance evidence**

- Profile, search, pedigree, listing and service request complete with keyboard in FA and EN.
- No unintended viewport overflow at 360px/200% zoom; intentional table/graph scrollers are labeled.
- No visual import from another skin.

**Rollback:** Revert Heritage-only component changes; shared API behavior remains available.

### P22 - Consolidate Equidata density tokens and remove temporary overrides

**Status:** TODO. **Priority:** P2. **Depends on:** P20. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/web/frontends/equidata-elite/density.tokens.json`; `src/web/frontends/equidata-elite/density-tokens.css`; `src/web/frontends/equidata-elite/compact-r88.css`; `src/web/frontends/equidata-elite/entry.tsx`; `src/web/frontends/equidata-elite/recordModules.tsx`.

**Implementation sequence**

1. Measure computed spacing before editing. Assign Equidata-owned tokens to page gutter, section gap, panel padding, row height, type scale, border and focus treatment.
2. Move approved compact-r88 overrides into their owning selectors, then delete the temporary overrides. Do not add another compact-r89.css layer.
3. Use a dense desktop table/list with explicit columns, a readable mobile card/list adaptation, sticky local tabs and a compact filter drawer. Preserve 44px project touch targets.
4. Replace repeated inline presentation values only inside Equidata. Check its dark/light contrast separately from other skins.

**Acceptance evidence**

- Generated token file matches JSON; no divergent duplicate source.
- Before/after visual diff reviewed at all target widths and both directions.
- Long Persian owner names, unknown dates, 20 result rows and no-photo states remain readable.

**Rollback:** Revert Equidata stylesheet/component changes only; do not alter other frontend tokens.

### P23 - Consolidate FEI Classic spacing and readable data composition

**Status:** TODO. **Priority:** P2. **Depends on:** P20. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/web/frontends/fei-classic/entry.tsx`; `src/web/frontends/fei-classic/recordModules.tsx`; `src/web/frontends/fei-classic/density.tokens.json`; `src/web/frontends/fei-classic/compact-r88.css`.

**Implementation sequence**

1. Keep FEI Classic branding independent. Replace oversized hero/panel whitespace with compact page headers, aligned metadata and progressive disclosure.
2. Merge temporary density overrides into FEI-owned rules after screenshot approval. Avoid global element selectors that leak into host or sibling frontends.
3. Use logical padding/margin and bidi-safe identifiers. Tables should preserve headers and horizontal scrolling without clipping action controls.
4. Add clear source/review labels and unknown/partial evidence states rather than badge-only meaning.

**Acceptance evidence**

- Keyboard focus order follows reading order; focused controls are not hidden under sticky elements.
- FA/EN long text fits 360px without global overflow.
- Color is not the only indicator of verification, risk or listing status.

**Rollback:** Revert FEI-only styles and local layouts; preserve domain contracts.

### P24 - Refactor Retro Astra locally and normalize density safely

**Status:** TODO. **Priority:** P2. **Depends on:** P20. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/web/frontends/retro-astra/entry.tsx`; `src/web/frontends/retro-astra/transplant/components/Shell.tsx`; `src/web/frontends/retro-astra/transplant/density.tokens.json`; `src/web/frontends/retro-astra/transplant/compact-r88.css`.

**Implementation sequence**

1. Preserve the transplanted frontend boundary. Identify repeated shell/sidebar/card recipes within Retro Astra and extract local components, not cross-skin JSX.
2. Consolidate approved density into owning styles; remove dead competing spacing rules one group at a time with screenshot checks.
3. Make navigation usable with touch and keyboard, visible current section and return-to-results state. Mobile drawer must trap focus and return it to trigger.
4. Keep decorative effects from reducing contrast or readability; respect reduced-motion preference.

**Acceptance evidence**

- Mobile nav opens/closes/Escape/focus-return correctly in FA and EN.
- Search state survives profile/back navigation.
- No cross-frontend CSS selector or component dependency added.

**Rollback:** Revert the Retro Astra extraction commit independently; keep original rendering fallback during migration.

### P25 - Harden standalone Classic embedding and native integration

**Status:** TODO. **Priority:** P1. **Depends on:** P05, P20. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `standalone-frontends/classic-v1.4/public/`; `src/web/frontends/classic-registry/entry.tsx`; `src/web/frontends/classic-registry/classic-registry.css`; `tools/build-classic-embedded.mjs`.

**Implementation sequence**

1. Run native Classic as its own runtime. Keep host wrapper, iframe and generated public/classic-registry output separate from the React skins.
2. Validate any postMessage bridge with exact origin, expected source window and schema. Do not accept arbitrary height/navigation/auth commands.
3. Use responsive min-height:0/flex sizing and a measured height strategy; avoid restoring hard-coded 680px minima. Preserve intentional internal scrolling with a descriptive iframe title.
4. Consolidate native density tokens and update its independent DOM templates to use production directory/inbox contracts where supported. Never directly reuse React components.
5. Pin build inputs/output hashes so stale embedded JS cannot be delivered after a source edit.

**Acceptance evidence**

- Hosted same-origin embed renders without framing violation; attacker origin messages ignored.
- Small viewport and long profile do not create trapped nested scrolling.
- Native version/contract matches host; build freshness check catches stale output.

**Rollback:** Disable Classic host route with an honest unavailable screen if bridge/framing security fails; retain native source for repair.

### P26 - Add cross-frontend accessibility and responsive journey tests

**Status:** TODO. **Priority:** P1. **Depends on:** P21, P22, P23, P24, P25. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `tests/e2e/frontend-journeys.spec.ts (new)`; `tests/e2e/accessibility.spec.ts (new)`; `tools/test-r88-browser.py`; `src/web/frontends/`.

**Implementation sequence**

1. Use a real hosted build in an unrestricted runner, not the offline DOM harness. Matrix: five frontends x EN/FA x phone/tablet/desktop for critical paths; prioritize pairwise visual coverage if full screenshot count becomes excessive.
2. Test registry search/filter/profile/pedigree, login/error, listing inquiry, provider request, workspace and paywall/cancellation. Use deterministic authorized fixtures and no external paid side effects.
3. Run automated accessibility checks plus manual keyboard and screen-reader review. Test headings, labels, error associations, dialog focus, skip link, 200% zoom and reduced motion.
4. Project targets: touch controls at least 44px where practical; AA contrast and keyboard access; no page overflow at 360px except explicitly bounded graph/table regions. These are targets, not a current certification.
5. Attach screenshots, failure recordings and measured performance to release evidence. Do not describe source-pattern validators as accessibility testing.

**Acceptance evidence**

- All critical journeys pass in each frontend in both languages.
- No critical/serious automated accessibility issue remains without documented justified review.
- Manual focus/reader checks have named reviewer and reproducible notes.

**Rollback:** Block release of the affected frontend without disabling the entire backend; preserve last approved skin build.

### P27 - Improve search, disambiguation and linkable navigation

**Status:** TODO. **Priority:** P1. **Depends on:** P10, P11, P20. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `src/search/normalize.ts`; `src/registry/identifiers.ts`; `src/frontend-kit/registrySearch.ts`; `src/frontend-kit/registryUrlState.ts`; `src/api/modules/directory.ts (new)`.

**Implementation sequence**

1. Keep typed horse, person, organization, event and service results separate even when using a universal search box. Include entity icon/label, stable ID, source and disambiguating fields.
2. Normalize Persian/Arabic letter and digit variants, whitespace and aliases; preserve exact identifier search. Do not fuzzy-match a microchip into a different horse.
3. Persist filter/sort/page state in URLs, validate query params and support keyboard clear/apply. Add father/mother, age interval, location and evidence filters only where backed by indexed data.
4. Use cursor pagination and bounded query plans; measure real dataset search before adopting a separate search engine. Unknown age or location must not be treated as zero/default city.
5. Add accessible result counts and no-results suggestions without fabricated matches.

**Acceptance evidence**

- Equivalent Persian/Arabic spellings and digit sets return the same canonical record.
- Two horses with one name remain distinct.
- Back/forward restores search state.
- Query budget and privacy hold for large result sets.

**Rollback:** Keep exact identifier/name search available while disabling expensive optional filters.

### P28 - Build source-attributed event/results intake and correction

**Status:** TODO. **Priority:** P1. **Depends on:** P10, P11. **Planning effort:** 3-6 person-days. **Gate:** production.

**Paths:** `src/api/modules/competitions.ts`; `src/contracts/platform.ts`; `src/api/modules/imports.ts (new)`; `migrations/ (event source/revision fields)`.

**Implementation sequence**

1. Model event, edition, discipline/class and result separately. Store rider, horse, organizer, source/external ID, published_at and revision with appropriate public attribution.
2. Import only agreed organizer/feed data into staging; support manual entry for smaller events. Do not imply a live federation connection until a contract and working integration exist.
3. Distinguish placing, points, time, elimination, withdrawal and unknown result. Never coerce all disciplines into one numeric rank.
4. Provide correction and duplicate-result review. Recompute summaries when source revisions arrive, with visible update date.

**Acceptance evidence**

- Reimport of same event revision is idempotent.
- Rider with identical name does not auto-merge without identifiers.
- Disqualified/withdrawn results are not shown as winners or zero-time records.

**Rollback:** Pause imports and display last known source/revision; do not silently remove historical results.

### P29 - Create an operator console for data quality and customer operations

**Status:** TODO. **Priority:** P1. **Depends on:** P10, P12, P16, P18. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `src/api/modules/operations.ts (new)`; `src/web/heritage/ (admin area)`; `src/auth/capabilities.ts`; `src/audit/mutationJournal.ts`.

**Implementation sequence**

1. Unify queues for identity claims, conflicting parentage, duplicate records, document review, reported listings, undelivered requests and payment reconciliation without merging their permission models.
2. Each queue item needs owner, priority, age, evidence, next action and append-only decision. Bulk actions require preview and a reason; destructive actions need scoped confirmation.
3. Add data freshness metrics, review throughput, correction turnaround and data cost per accepted record. Distinguish demo counters from actual analytics.
4. Use least-privilege support roles; log privileged private-record access and redact exports.

**Acceptance evidence**

- Support agent cannot access raw genetics or payment secrets merely by having moderation rights.
- Queue decisions update the domain through the same tested commands, not direct SQL in UI.
- Overdue/conflicting records are visible and assigned.

**Rollback:** Disable affected bulk actions; continue individual reviewed domain commands and audit retention.

### P30 - Add backups, restore drills, incident response and production observability

**Status:** TODO. **Priority:** P0. **Depends on:** P01, P09. **Planning effort:** 4-7 person-days. **Gate:** production.

**Paths:** `scripts/ (deployment/backup tooling)`; `src/worker.ts`; `src/db/provider.ts`; `docs/operations/ (new runbooks)`.

**Implementation sequence**

1. Inventory canonical database, object evidence, configuration and secrets. Encrypt backups, isolate credentials and set retention/deletion rules consistent with the selected deployment.
2. Choose measurable RPO/RTO targets with the operator; proposed initial targets are 24h/4h until stronger commitments are funded. Restore into an isolated environment and verify row counts, referential links, evidence hashes and app queries.
3. Add structured request IDs, latency/error rates, permission-denied anomalies, queue depth, payment mismatch and backup-age alerts. Do not log private content.
4. Document incident owner, secret rotation, rollback, customer notification decision process and vendor outage behavior. Test degraded read-only operation without silently switching to demo data.
5. Rehearse one database loss and one expired provider credential before launch.

**Acceptance evidence**

- A documented restore produces a usable application within the agreed target.
- Backup failure alerts an actual operator.
- No production page changes source to synthetic data during outage.

**Rollback:** Use the tested deployment rollback and read-only mode; restore data only through a reviewed recovery procedure, never blind overwrite.

### P31 - Implement operational privacy, retention and consent controls

**Status:** TODO. **Priority:** P0. **Depends on:** P04, P09, P11. **Planning effort:** 3-6 person-days. **Gate:** production.

**Paths:** `src/privacy/`; `src/api/modules/privacyRequests.ts (new)`; `migrations/ (consent and retention events)`; `docs/operations/privacy.md (new)`.

**Implementation sequence**

1. Map data classes and purposes: historical registry assertions, account contact, private farm notes, lab reports, inquiries, payments and demo data. Set a reviewed retention/deletion policy for each.
2. Provide contact-publication opt-in, consent revocation, data correction/export and account closure workflows. Closure must not automatically erase legally/contractually retained records or falsify pedigree history.
3. Record consent text version, scope, time and actor; minimize precise location and personal contact exposure. Separate public ownership assertion from self-service contact profile.
4. Have local counsel assess actual company obligations and data agreements. Do not make unsupported claims that a checkbox makes all processing lawful.

**Acceptance evidence**

- Revocation updates public projection and caches.
- Account export omits other users' private data.
- Deletion job respects holds and emits an auditable outcome.
- Synthetic fixtures cannot be mistaken for consented real profiles.

**Rollback:** Pause affected processing/publication; retain minimal audit evidence and involve the designated data operator.

### P32 - Put AI assistance behind evidence, privacy and cost boundaries

**Status:** TODO. **Priority:** P1. **Depends on:** P04, P06, P07, P30. **Planning effort:** 3-5 person-days. **Gate:** production.

**Paths:** `src/ai/application/assistantService.ts`; `src/ai/tools/registry.ts`; `src/ai/evidence/builder.ts`; `src/ai/runtime/costGovernor.ts`; `src/ai/runtime/quotaGovernor.ts`.

**Implementation sequence**

1. Allow assistant answers only from authorized tools and explicitly identified evidence. Treat imported descriptions/documents as untrusted content, not instructions.
2. No AI-created ownership, credential, parentage, medical diagnosis or payment claim may enter canonical records without the relevant reviewed command.
3. Surface uncertainty, source age and unavailable fields. Refuse to infer clear genetics from missing tests and do not fabricate breeder/rider contact details.
4. Bound token/query cost per account and per request, redact logs, provide deterministic search fallback when provider is unavailable and keep AI optional for core tasks.
5. Re-run existing AI suites after restoring original docs/assets. Evaluate Persian responses with domain reviewers, not only English protocol tests.

**Acceptance evidence**

- Prompt injection in horse description cannot reveal private fields or run unauthorized commands.
- Unavailable provider leaves registry/service workflows usable.
- Cost limit is enforced server-side and reported honestly.

**Rollback:** Disable external AI providers and keep deterministic registry search; do not remove core browsing.

### P33 - Keep demo data isolated and make the walkthrough reproducible

**Status:** TODO. **Priority:** P1. **Depends on:** P00. **Planning effort:** 1-3 person-days. **Gate:** production.

**Paths:** `src/demo/seed-r88.mjs`; `tools/generate-r88-demo.mjs`; `public/demo-workbench/`; `public/business-model/`; `docs/r88/04-DEMO-DATA-POLICY.md`.

**Implementation sequence**

1. Keep synthetic IDs, is_demo flags and local-only requests. Preserve the R88 deterministic integrity/freshness checks; extend them for new entities, chronologies and source mappings.
2. Run actual hosted browser tests in an unrestricted environment for both pages; inspect CSP, noindex, history routing, reload persistence, storage-denied and keyboard dialog behavior.
3. Add demo reset and export-of-demo-state only if needed for presentations. Never copy simulated inbox messages into production request tables.
4. Preserve visible provenance on every entity screen, not just homepage. Replace artwork with licensed assets only after consent/license record; no scraped horse photographs or fake endorsements.
5. Record a short operator script: search horse 17, open family, compare full siblings 9/10, request a synthetic service, show local inbox, then show a loss-making business scenario.

**Acceptance evidence**

- Generator is deterministic and all generated artifacts match source.
- No request leaves the demo namespace or reaches live SMS/payment.
- Every entity detail clearly identifies synthetic data.
- Actual hosted tests pass separately from offline harness.

**Rollback:** Disable public demo routes without touching canonical APIs; clear only namespaced demo storage.

### P34 - Run paid discovery and measure retention before expanding the product

**Status:** TODO. **Priority:** P1. **Depends on:** P11, P12, P14. **Planning effort:** 3-6 person-days. **Gate:** commercial.

**Paths:** `docs/business/pilot-protocol.md (new)`; `docs/r88/03-BUSINESS-MODEL-IRAN.md`; `src/analytics/ (new privacy-safe events)`.

**Implementation sequence**

1. Recruit 20 consenting interviews across farms, breeders, clubs, professionals and buyers in one or two reachable regions. Record current task, frequency, cost, existing tools and purchase authority; do not count praise as demand.
2. Offer a small paid pilot to five farms and ten professionals with clearly written scope and renewal terms. Human onboarding is permitted; record operator minutes and costs.
3. Measure activation (real herd imported or valid provider request), weekly meaningful use, qualified requests, response rate, retained monthly contribution and second payment. Never use synthetic activity as pilot evidence.
4. Proposed continue gate: at least three of five farms renew after two paid months, and direct support/data cost remains compatible with contribution. These thresholds are a decision proposal, not an industry benchmark.
5. If adoption fails, narrow workflow/offer and interview reasons before adding native apps, social feed, AI rankings or commission checkout.

**Acceptance evidence**

- A pilot report includes signed/paid evidence, anonymized cohort counts, dates and cost basis.
- All rejected offers and churn reasons are recorded, not just successes.
- Revenue projections are labeled assumptions until actual cohorts replace them.

**Rollback:** Stop acquisition spend and new feature scope if the gate fails; support/export existing customer data and honor refunds/terms.

### P35 - Add attribution-safe product analytics and subscription economics

**Status:** TODO. **Priority:** P1. **Depends on:** P18, P19, P34. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/analytics/ (new)`; `src/commerce/economics.ts`; `src/api/modules/operations.ts (new)`; `public/business-model/`.

**Implementation sequence**

1. Define events and metric formulas: registry activation, workspace weekly activity, qualified inquiry, provider acknowledgement, paid conversion, renewal, churn, support minutes and contribution.
2. Exclude demo namespace, staff QA, bots and refunded orders. Avoid collecting private notes or full contact fields in analytics.
3. Distinguish revenue, cash received, MRR, one-off promotions, gateway fees, support costs and net operating result. Do not annualize a one-month spike as proven ARR.
4. Replace calculator assumptions with actual observed cohorts only with date/sample-size labels; keep public scenario calculator free of private company/customer accounts.
5. Calculate acquisition payback from realized contribution; do not present LTV = margin/churn as reliable with a tiny or immature cohort.

**Acceptance evidence**

- Refunded/duplicated payments do not inflate revenue.
- Promotion transactions are excluded from MRR.
- Synthetic visits and local requests cannot affect production dashboards.

**Rollback:** Disable analytics collection while retaining billing ledger; reconstruct metrics from documented events after repair.

### P36 - Add licensed SEO and distribution without leaking private or synthetic data

**Status:** TODO. **Priority:** P2. **Depends on:** P10, P11, P16, P31. **Planning effort:** 2-4 person-days. **Gate:** production.

**Paths:** `src/worker.ts`; `src/web/`; `public/robots.txt (review/create)`; `src/seo/ (new)`.

**Implementation sequence**

1. Create canonical stable public horse/provider URLs and licensed public sitemap with language alternates. Noindex private areas, search combinations that create traps, demos and business planning page.
2. Use honest structured data for the actual entity and offer; do not fabricate aggregate ratings, sold prices, credentials or product availability.
3. Publish permissioned educational/discovery content with date/source and human domain review. Offer embeddable profile/result links to partner clubs rather than copying their entire databases.
4. Create consented referral and attribution codes with disclosure. Validate distribution through actual partner usage, not purchased fake followers.

**Acceptance evidence**

- Sitemap excludes synthetic, unpublished, deleted and private entities.
- Public metadata contains no hidden private fields.
- FA/EN canonical/alternate links do not form loops.

**Rollback:** Remove affected sitemap/metadata and request reindexing; do not change canonical horse IDs to repair SEO.

### P37 - Evaluate later booking, merchant and organizer modules behind demand gates

**Status:** TODO. **Priority:** P3. **Depends on:** P16, P18, P34, P35. **Planning effort:** 2-4 person-days. **Gate:** expansion.

**Paths:** `docs/business/expansion-gates.md (new)`; `src/contracts/platform.ts`; `src/commerce/`.

**Implementation sequence**

1. Write separate discovery briefs for equipment merchant campaigns, event-organizer result tools, laboratory intake and appointment scheduling. Validate each with a paying/design partner before implementation.
2. Booking requires provider availability, timezones, cancellations, no-show rules and capacity conflicts. A contact request is not an appointment; do not relabel it to imply completed functionality.
3. Equipment commerce requires SKU/stock, seller terms, shipping/refund support and payment reconciliation. Begin with clearly sponsored leads/catalogs if those workflows are not funded.
4. Do not launch horse escrow, financial products, emergency dispatch or success-fee collection merely by adding a button. They require independent operational/legal/vendor readiness.
5. Defer native apps until responsive usage shows an unmet need such as offline yard work or reliable push, and fund ongoing two-platform maintenance.

**Acceptance evidence**

- Each expansion has a named buyer, tested workflow, measurable economics and go/no-go gate.
- No production capability flag enables a module whose fulfillment/support does not exist.

**Rollback:** Keep feature flags off and retain research only.

### P38 - Add advanced breeding only after scientific and commercial review

**Status:** TODO. **Priority:** P3. **Depends on:** P06, P07, P08, P09, P34. **Planning effort:** 10-20 person-days. **Gate:** expansion.

**Paths:** `src/genetics/`; `src/pedigree/`; `src/api/modules/genetics.ts`; `docs/science/ (new validation protocol)`.

**Implementation sequence**

1. Separate reproductive event tracking, pedigree-based calculations, laboratory interpretations and recommendation research into independent capabilities.
2. For new assays, obtain lab-defined marker/build/notation and consent; distinguish DNA parentage exclusion/confirmation from phenotype tests. Genomic inbreeding is not the same metric as pedigree COI.
3. Implement transparent filtering/explanations before weighted rankings. Record objective, constraints, evidence completeness and reasons a pair cannot be evaluated.
4. Have equine genetics/veterinary experts review fixtures and UI language. Test out-of-distribution breeds and missing data; never advertise guaranteed healthy offspring or ideal mating.
5. Price a specialist pilot only after identifying repeat professional use and liability/support cost. No paid scientific ranking based on sponsorship.

**Acceptance evidence**

- Independent validation protocol and reviewer sign-off exist.
- Unknown/conflicting tests never become clear or safe.
- Recommendation output exposes assumptions and evidence, with no diagnosis or guaranteed outcome.

**Rollback:** Disable advanced scoring while retaining reviewed pedigree reports and raw lab evidence.

### P39 - Execute release, rollback and first-customer acceptance gates

**Status:** TODO. **Priority:** P0. **Depends on:** P03, P04, P05, P06, P07, P08, P09, P26, P29, P30, P31, P33. **Planning effort:** 2-4 person-days. **Gate:** all.

**Paths:** `docs/operations/release-checklist.md (new)`; `audit/ (new dated release evidence)`; `package.json`.

**Implementation sequence**

1. Freeze release scope and the five supported skins. Every claimed capability must map to an endpoint, permission rule, persistence model, owner and passing scenario.
2. Run restored full checks, migration rehearsal, hosted E2E/accessibility, selected-provider parity, security tests, data import dry-run and backup restore. Record blocked gates explicitly.
3. Use a staging demonstration with synthetic data and a separate production smoke test with authorized minimal records. Never migrate the demo seed into production to make screens look full.
4. Validate operational ownership: support inbox, data reviewer, payment reconciliation, security incident contact and scientific reviewer. Verify required merchant/data agreements before enabling those features.
5. Roll out to a small invited cohort, observe real logs/errors and keep kill switches for mutations/payments/AI. Commercial launch additionally requires P18/P19/P34/P35; registry-only launch must not claim those features.

**Acceptance evidence**

- No open P0 gate for enabled capabilities.
- A rollback rehearsal preserves customer data, audits and financial events.
- Client acceptance script passes in the chosen frontend(s), with limitations documented.

**Rollback:** Use the rehearsed prior build/read-only mode; pause affected writes and notify the responsible operator, not a silent fallback to synthetic state.

## First agent session: exact working sequence

1. Read README-R88, this plan, the audit, QA log summary and demo-data policy. Run `git status` and preserve user changes.
2. Run `npm run test:r88`, `npm run test:python`, `npm run validate:syntax`, `npm run typecheck:pedigree`, `npm run verify:pedigree:reference`, `npm run validate:r88:density`. Record environment and outputs before edits.
3. Complete P00. Do not spend the first session polishing UI while the original build is unverified.
4. Start P01/P02: write a failing execution-level concurrent revocation/audit fixture against the chosen provider. Implement the smallest transactional repair, rerun all authorization regressions and attach SQL/migration evidence.
5. Follow P03/P04. Only then parallelize service/farm domain work and per-skin UI refactoring against stable contracts.
6. Update `agent-tasks.json` with status, evidence paths and actual hours. A ticket whose hosted test is blocked remains `blocked` or `implemented_unverified`, not `done`.
7. At each handoff state what works now, what remains simulated, what is unsafe to enable, and the next dependency-ready ticket. Include the complete source, lockfile when restored, migration notes and test logs. Never include secrets or font binaries in the handoff package.

## Definition of done for a capability

A feature is done only when a real authorized user can complete the intended workflow; persisted data is correct and recoverable; private data remains private; retries and concurrent edits behave correctly; all supported frontends expose honest states; the chosen production deployment passes tests; an operator owns failures and ongoing cost; and any claimed revenue is distinguishable from a calculator assumption. Screen count, TODO count and code volume are not a completion metric.
