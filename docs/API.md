# Horse DB API / Platform Surface — v0.46.0 / Core Consolidation v1.1.8

The browser-facing frontend contract is `PlatformClient`; raw HTTP routes are host implementation detail. This document records the current server families for maintainers.

## Public/read families

- `/api/platform/meta` — contract/capability/source metadata
- `/api/health`
- `/api/search` and `/api/search/meta`
- `/api/horses` and horse profile/pedigree/insight subroutes
- `/api/people` and person profiles
- `/api/registry/facets`
- `/api/registry/export` — **privileged, bounded** filtered CSV/JSON export; not a public dump surface. Authorization uses the shared semantic permission `registry.export` (granted to admin/super-admin by the role→permission mapping; frontends expose the entry point on the same capability). Each synchronous request returns at most `REGISTRY_EXPORT_ROWS_MAX = 500` rows (`registryExportRowsMax` in `/api/platform/meta` limits); requests above the ceiling are bounded by the shared registry query helper. Whole-registry dump remains a future offline/resumable workflow, never a synchronous endpoint.
- `/api/analytics/registry`
- `/api/quality/summary`
- `/api/relationship` and relationship coefficients
- `/api/breeding/pairing-analysis`
- `/api/breeding/optimizer` — bounded, explainable pedigree candidate ranking

Structured search/Registry filters include horse name/ID/registration, breed, sex, lifecycle, place, color, strain, years, parents, owner, breeder, importer, passport receiver and supported registry flags.

## Authentication / user workflow

- `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`
- `/api/claims`, `/api/claims/mine`
- `/api/change-requests`, `/api/change-requests/mine`
- `/api/grants/mine` (Master-Ai T10: the caller's active horse access grants)
- `GET /api/horses/:id/actions` (T10: backend-computed per-horse actions for the signed-in viewer)

### Password recovery, rotation and session control (Master-Ai T13)

- `POST /api/auth/recover/request` — `{ email }`. Anti-enumeration contract: the
  response envelope is identical whether or not the account exists (also for
  disabled accounts). When an active account matches, all outstanding reset
  tokens are voided and exactly one fresh single-use token (SHA-256 hashed at
  rest, 30-minute expiry, `email_verifications.purpose='password_reset'`) is
  issued. Delivery: sent as an emailed link when the owner-configured email
  provider is active; otherwise production reports nothing token-shaped and
  local dev surfaces a demo link.
- `POST /api/auth/recover/confirm` — `{ token, new_password }`. One
  compare-and-set UPDATE claims and consumes the token (concurrent replays and
  double-clicks cannot both win; losers receive the same generic 400
  `invalid_token` as unknown/expired tokens). On success the password is
  rotated and **all** sessions for the account are revoked — sign in again.
- `POST /api/auth/change-password` — authenticated + CSRF, `{ current_password,
  new_password }`. Verifies the current password first (generic 403 on
  mismatch, no account-state leak), rejects an unchanged password with 422,
  then rotates and revokes every **other** session (the current session stays
  signed in).
- `POST /api/auth/sessions/revoke` — authenticated + CSRF. Signs out every
  other session/device; reports how many were revoked.

OTP delivery honesty (T13): `POST /api/auth/otp/request` either actually sends
through the owner-configured SMS provider (`delivery:"sent"`) or keeps the
honest 503 unavailable posture in production; a demo code never appears in a
production response. `POST /api/auth/otp/verify` is gated symmetrically.
Provider credentials (Kavenegar API key + approved verification template;
HTTPS email API endpoint/key/sender) are owner-gated worker secrets — nothing
activates without them and nothing fabricates delivery.

Change-request creation accepts at most `CHANGE_REQUEST_ITEMS_MAX = 24` items per submission (`changeRequestItemsMax` in `/api/platform/meta` limits); over-sized submissions are rejected with a controlled 400 validation error and items are never silently truncated.

### New-horse submissions (Master-Ai T11)

`POST /api/change-requests` with `request_type: "create_horse"` now requires a **structured `submission` object** (a summary-only create request is refused with `422 structured_submission_required`). The submission carries: a native name and/or a Latin name (native-only is fine — a Latin transliteration is never invented; when absent the canonical `name_latin` column stores the native name verbatim), shared horse fields (register/microchip numbers, birth year/place, breed, sex, color, strains, description), parents as **existing registry horse ids** or as **explicit unresolved assertions** (`father_unresolved`/`mother_unresolved` with at least a name — parent profiles are never created automatically from free text), and optional breeder/current-owner person references. Optional `idempotency_key` (per-submitting-user unique) makes double-submitted requests replay the original row (`idempotent_replay: true`) instead of creating duplicates; `submit: false` stores the request as a `draft` first.

The submission state machine: `draft` → (submit) → `pending` → (`needs_changes` → back to `draft` for editing) → `approved` | `rejected`; the submitter can `withdraw` from draft/pending. Endpoints:

- `POST /api/change-requests` — create (optionally as draft via `submit: false`)
- `PUT/PATCH /api/change-requests/:id` — edit own draft content (re-validated with the full create-path rules)
- `POST /api/change-requests/:id/submit` — draft → pending
- `POST /api/change-requests/:id/withdraw` — draft/pending → withdrawn
- `POST /api/admin/change-requests/:id/review` — decision `approved` | `rejected` | `needs_changes` (needs_changes requires an explanatory note)

**Approving a create_horse submission is one atomic transaction**: the canonical horse insert (conditioned on the request still being undecided), the identifier claims (register/microchip, subquery-resolved horse id), the permitted relationships (declared owner + breeder in `horse_people`), the initial owner grant (only when the declared current owner is a **verified** `user_person_links` link of the submitter — T10 doctrine keeps permission and title explicit), the approval decision (conditioned on the horse actually landing) and the revision/counter bumps. Any failure — a duplicate live identifier, a lost review race, a stale reference — leaves the submission `pending` with **no partial canonical horse**. `canonicalApplied: true` and `canonical_horse_id` are reported only after the created record is read back from the database. Approving twice returns `409 change_request_closed`; a second concurrent approval batch cannot create a duplicate horse because every effect statement is conditioned on the request still being open. Legacy summary-only create_horse rows cannot be approved (`422 legacy_create_horse_without_submission`) — they are labeled, never silently approved review-only. Ownership-type requests stay review-only and are labeled with an `ownership_note` pointing at the claim + grant workflow.

Mutations are permission/session/CSRF protected by the host transport/security layer.

### Workflow semantics

Ownership claims and change requests are **review workflows**, not automatic canonical-data mutation paths. A status of `approved` means an authorized reviewer accepted the submitted assertion/request for the workflow record; it does **not** by itself alter canonical horse fields or apply proposed change-request items (responses still expose `workflowEffect: "review_only"` for the horse-data effect — with two reviewed exceptions: `update_horse` approvals apply whitelisted field changes, and since T11 `create_horse` submissions create the canonical record atomically as described above). What claim approval DOES do since Master-Ai T10: it mints an explicit **horse access grant** (owner mandate: manage_profile / upload_media / create_listing / manage_inquiries) in the same reviewed batch — the permission to act on that horse for the claimant. Grants are permissions, never legal title: `horse_people` remains the legal-record layer, and the account role is never a global per-horse edit permission. Horse-scoped writes (`POST /api/horses/:id/media`, `POST /api/market/listings`) require either editorial staff capability or an active grant covering the exact action on that horse; anything else is a `403 horse_access_required` (the cross-account IDOR boundary).

Claim/change-request create and review writes use the durable canonical mutation journal with `search_status=not_applicable`, so a committed workflow decision remains auditable/reconcilable even if the user-facing audit-row write later fails. Review updates are conditional on an open state; concurrent/duplicate decisions return `409` rather than overwriting an already closed decision.

### Profile facts, temporal relations and typed dates (Master-Ai T12)

Every temporal registry fact is now stored as a **typed date**: `value` (ISO-shaped, truncated to its precision) + `precision` (`day` | `month` | `year`) + **explicit `calendar`** (`gregorian` | `solar_hijri`). A year-only date of birth stays exactly a year — storage never invents a January 1 (or Farvardin 1). The Persian UI renders Solar Hijri and the English UI renders Gregorian, both converted losslessly from the SAME stored fact (jalaali break-table mathematics, roundtrip-pinned across 1900-2100). The legacy `birth_year` column remains the Gregorian **bucket year** used by search/filters and is kept in sync by every typed write; age presentation uses honest **ranges** for imprecise dates, never a false exact age.

New public reads:

- `GET /api/horses/:id/lifecycle` — dated lifecycle history (`death`, `castration`, `retirement`, `export`, `import`, `other`) with per-event `date_value`/`date_precision`/`date_calendar`, the explicit `uncertain_time` honesty flag, note and source reference.
- `GET /api/horses/:id/ownership` — historical **ownership periods** (title facts, never permissions — grants live in `horse_access_grants` per T10): owner person + names, typed start/end (open end = ongoing), optional `share_percent` co-ownership share, evidence note and source.

The horse profile (`GET /api/horses/:id`) now also returns `birth_date_typed`, `death_date_typed`, `castration_date_typed` (assembled `{value, precision, calendar}` objects) plus the public places: `birth_city`, `birth_province`, `keeping_city`, `keeping_province`. The **private precise address** (`precise_address`) and the raw birth-date source note are staff-only and never appear in any public projection.

Privileged writes (editor):

- `POST /api/admin/horses/:id/ownership-periods` — records a historical title period. Overlap detection is **precision-aware**: a *definite* overlap (provable from the stored facts) is rejected with `409 ownership_overlap`; a merely *possible* overlap (year-precision ambiguity) is recorded and reported as `possible_overlap_period_ids` — the registry never claims more than the facts prove, and never hides what it cannot rule out. Stated co-ownership shares of overlapping periods must sum to <= 100 (`409 ownership_share_sum_exceeded`).
- `POST /api/admin/horses/:id/lifecycle-events` — records a dated lifecycle event. A `death` or `castration` event also lands the canonical typed date on the horse row (and `is_dead`) **in the same guarded batch**, so the searchable record can never disagree with the history; other event types are history-only.

Typed dates on the shared field rules: `birth_date`, `death_date` and `castration_date` are writable through direct edits (`PUT /api/horses/:id`), reviewed change requests (item field names) and structured submissions, always as `{value, precision, calendar}` objects (or `null` to clear the typed fact). Setting a death date implies `is_dead = 1`; clearing it never resurrects a horse flagged dead by a legacy fact. All calendar mathematics — Feb 30, month 13, Esfand 30 in common years, future dates — is refused with a structured 422 by the shared parser (`src/registry/dates.ts`).

### Parent corrections (Master-Ai T12)

Parent changes through the reviewed path are **structured submissions**, never item lists: `POST /api/change-requests` with `request_type: "update_horse"` and a `parent_correction` object (`kind: "parent_correction"`, the target `horse_id`, at least one of `father_id`/`mother_id` as an existing registry id or `null` to clear, a substantive `reason` and a named evidence `source`, optional `conflicting_evidence`). At creation and again at approval, the asserted parents are validated against the **current** pedigree graph (existence, cycles, plausibility) exactly like a direct edit. Approval applies the parents through the same guarded mutation service — pedigree cycle guard, optimistic row version CAS, search reindex and decision all in one conditioned batch; any failure leaves the request pending with no partial change.

### Access grants (Master-Ai T10)

- `GET /api/grants/mine` — active grants for the caller (owner self-service).
- `GET /api/admin/grants?horse_id=N` — full grant register including revoked rows (staff audit).
- `POST /api/admin/grants/:id/revoke` — immediate, reason-required, audited revocation; takes effect on the next request.
- `POST /api/admin/org-memberships/:id/revoke` — revoking an organization membership stops every organization-mediated grant path immediately.
- Grant rows carry relationship (owner/breeder/manager/seller), an action list (storage can only narrow a mandate, never widen it), basis + provenance (`claim_approval` records the claim id), validity windows, and revocation audit fields.

### Marketplace versioned commands and idempotency (Master-Ai R88 plan P03)

Every mutable marketplace command — `POST /api/market/listings` (create), `POST /api/market/listings/:id/status`, `POST /api/market/listings/:id/renew` (new), `POST /api/market/listings/:id/inquiries` (create), `POST /api/market/inquiries/:id/status` — is a single guarded transactional statement with three guarantees:

1. **Optimistic concurrency.** Listings and inquiries carry `row_version` (starts at 1, exposed by every read, incremented by every mutable command). Status/renewal/inquiry-status edits REQUIRE `expected_version` in the body; a stale write is `409 listing_version_conflict` / `409 inquiry_version_conflict` carrying `details.current_version` so the losing editor reloads. Contract 2.17.0; all client adapters send the version they read.
2. **Idempotency.** Mutation requests may send an `Idempotency-Key` header (8-128 URL-safe chars). The key is scoped to (actor, command, target); the server persists a request digest + the stable response in `command_receipts` **in the same D1 batch as the write**, gated on the operation marker — a receipt can only exist for an execution that actually happened. Replaying the same key with the same payload replays the stored response (`Idempotency-Replayed: true`); the same key under a different payload is `409 idempotency_conflict`. The inquiry form uses this to make double submits harmless.
3. **Authority inside the transaction.** Horse existence, seller identity and the active grant are evaluated IN the write statement (explicit staff branch OR seller + live grant covering the action on that horse). A grant revoked between the guard read and the write turns the command into a zero-row no-op → `403 horse_access_required`, never a success on stale permission.

Renewal semantics: `extend_days` 7-365 (default 90) extends `expires_at` from now; an **expired** listing reactivates to `active` in the same statement (this closes the previous dead end: expired → draft → active was impossible because draft → active re-checked the stale `expires_at`). `sold` is terminal and is **never** an ownership transfer — the statement writes `sales_listings` only; `horses`, `horse_people` and `horse_access_grants` are untouched (python replay `test_p03_marketplace_commands.py`). Inquiry contact fields stay private to a live `manage_inquiries` grant: the inquiry-status response carries no contact fields, and `GET /api/market/mine` filters inquiries on the CURRENT grant, so a revoked seller's list is immediately empty.

## Privileged families

- `/api/admin/dashboard`
- `/api/admin/audit`
- `/api/admin/quality`
- `/api/admin/claims`
- `/api/admin/change-requests`
- horse curation operations
- `/api/admin/maintenance/reindex`

Portable privileged operations are exposed through the typed `PlatformClient` admin/audit/curation namespaces; frontends should not call these routes directly.

### R88 plan P06: reviewed genetic interpretation provenance

`POST /api/admin/genetic-tests/:id/interpretation` (`horse.edit` + CSRF) records a
structured, catalog-versioned interpretation review. The body is
`{ result_status: "clear" | "carrier" | "affected" | "recorded_uninterpreted", note?: string }`.
The write is provenance-only: `interpretation_version` (the assay catalog version used),
`interpreted_at` and `catalog_reviewed_by` are set on `genetic_tests` and an append-only
`audit_events` row (`genetic.interpretation.recorded`, with the prior provenance in
`before_json`) lands in the same batch. The laboratory report itself (`result`,
`result_interpretation`, lab fields, notes) is NEVER modified — reports are never
rewritten to match a newer catalog, and re-review keeps the full history in the audit
trail. Report authenticity (issuer attestations) and clinical diagnosis (never
automated; the public projection always carries `clinical_diagnosis: false`) remain
separate concerns. The response carries the updated row, the review record with
`raw_result_unchanged`, and the honest scope `recorded_genotype_only`.

Legacy locus rows (`AGOUTI_ASLIP`, `DUN_TMEM38`, `CREAM_SLC36A1`) stay quarantined —
never auto-remapped; `tools/audit-legacy-genetics.mjs` is the read-only report of those
rows (run against the canonical Supabase; it cannot modify data).

### R88 plan P08: reviewed breeding date corrections

`POST /api/admin/breeding/:id/correct` (`horse.edit` + CSRF) is the ONLY reviewed
correction path for reproduction/calendar facts. The body is
`{ covering_date?: string | null, season?: number | null, reason: string }` — at least
one of `covering_date`/`season` must be present, and `reason` (10–500 chars) records
the human review decision. Corrected values are revalidated with the same rules as
create (`covering_date` is a real Gregorian day; `season` is a Solar Hijri year
1380–1500; a covering date and an explicit season cannot disagree), the guarded
`UPDATE` (touching ONLY `covering_date`/`season`) and an `audit_events` row
(`breeding.record.corrected`, with the OLD values in `before_json`) land in one batch,
and a lost race returns `409 correction_conflict`. Historical seasons are corrected one
row at a time — never mass-converted; `tools/audit-breeding-dates.mjs` is the read-only
anomaly report (Gregorian-looking seasons, invalid days, date/season mismatches,
covering-before-parent-birth, foal-before-covering, implausible gestation) that feeds
this workflow. Season display is interval-aware in both languages from the same stored
fact (`Season 1405 SH (21 Mar 2026 – 20 Mar 2027)` / `فصل ۱۴۰۵ (۱ فروردین – ۲۹ اسفند
۱۴۰۵)`); see `docs/r88/P08-BREEDING-DATE-SEMANTICS.md`.

### R88 plan P09: secure evidence upload + private document delivery

Uploads are grant-scoped (`requireHorseAction upload_media`), size-capped (3 MB),
MIME-allowlisted AND magic-byte verified — browser MIME is never trusted. Two
P09 hygiene layers run before anything is stored: `scanForActiveContent` rejects
PDFs carrying scriptable constructs (`/JavaScript`, `/OpenAction`, `/Launch`,
`/EmbeddedFile`, `/SubmitForm`) and image polyglots (trailing bytes after the
JPEG EOI / PNG IEND / GIF trailer) with `415 media_active_content`; SVG and HTML
are structurally impossible (not in the allowlist, no signature check passes).
`stripLocationMetadata` removes EXIF (GPS), XMP and text chunks from JPEG/PNG
bytes BEFORE storage, so no later list/serve/thumbnail projection can ever leak
location or device metadata.

Publication is an EXPLICIT consent fact (migration 0041): `horse_media.consent_state`
is `private` by default; the honest backfill marked exactly the rows the legacy
public predicate already served as `shared_public` — nothing became more
visible. `canReadMedia` fails closed on unknown consent and rejected media never
re-enters the public set.

**Private document delivery:** `POST /api/media/:id/access` (authenticated + CSRF,
read authorization re-checked) mints a short-lived signed URL — an HMAC-SHA256
token bound to (media, user, expiry) with a 15-minute TTL, recorded as a
revocable `media_access_grants` row carrying expiry, evidence class and grantor.
`GET /api/media/file/:id?token=...` verifies the signature AND the grant row
(`revoked_at IS NULL AND expires_at > now`) AND the consent state at serve time,
so a revoked grant kills existing tokens immediately and lost read access means
no new URL can be minted. There are NO public permanent document URLs in any
public horse response. When `MEDIA_ACCESS_TOKEN_SECRET` is unset the mint
endpoint fails closed (503) and the session read path keeps working.

**Operator quarantine queue:** `GET /api/admin/media/quarantine` (`horse.edit`)
lists pending uploads (with age and abandoned flag, >30 days) and quarantined/
rejected items with their staff reason — metadata only, payloads never rendered.
Nothing is auto-purged; deletion stays an explicit operator action via
`DELETE /api/media/:id`.

### R88 plan P10: licensed ingestion, staging and duplicate adjudication

**Sources (agreements first):** `POST/GET /api/admin/imports/sources` (`horse.edit`).
Every ingestion source carries its issuer namespace, scope, redistribution
permission, retention rule, update cadence and responsible operator — publicly
visible data is not automatically reusable. Synthetic/demo namespaces
(`is_synthetic`) are refused by the staging command (`400
synthetic_source_forbidden`) and can never feed production canonical data.

**Staging (the dry run):** `POST /api/admin/imports/stage` stages raw rows
verbatim next to normalized copies (Persian/Arabic digits unified; Arabic
Yeh/Kaf/Tatweel unified for names) with per-row checksums and a
create/update/conflict/skip classification. Matching runs on TYPED identifiers
only (register numbers in the source's issuer namespace, microchips) — horses
are never deduplicated by name. Conflicting parentage and identifiers that
resolve to different horses enter review (`parentage_conflict`,
`identifier_collision`), identical content is `skip`. NOTHING canonical is
written during staging. `(source_id, file_sha256)` is unique: reimporting an
identical file REPLAYS the same batch (`idempotent_replay: true`).

**Apply (resumable, per-row transactional):** `POST /api/admin/imports/batches/:id/apply`
processes at most 50 pending rows per call; call again to continue. Each
create is ONE atomic D1 batch: the horse INSERT carries a unique
`import:{batch}:{row}` marker, the typed-identifier claims resolve the fresh
horse id through that marker, and the staging outcome + audit land in the same
transaction — a lost identifier race rolls back the whole row (no orphan
horse) and routes it to conflict review instead of overwriting the holder.
Updates are fill-once (only NULL canonical identity facts). Batches finalize
as `completed` or `partial` (with outstanding conflicts); `GET
/api/admin/imports/batches/:id` reports per-row outcomes, outstanding
conflicts and operator effort.

**Merge/unmerge (reviewer adjudication):** `POST /api/admin/horses/:id/merge`
(`{ merge_horse_id, reason }`) moves every FK reference from the merged horse
to the kept one across 14 surfaces (children parent links, breeding
sire/dam/foal, people, genetics, competitions, media, listings, grants,
ownership periods, lifecycle, attestations), archives (never deletes) the
merged horse's live identifiers, soft-deletes the merged horse, records a
permanent `horse_redirect_aliases` row, queues search reindexing for the kept
horse and every moved child, and stores the full moved-reference manifest.
`POST /api/admin/horse-merges/:id/unmerge` replays that manifest backwards
exactly (FK restores to the original horse, identifiers un-archived to their
original owner, alias cleared). Two horses sharing a name are NEVER silently
collapsed — merge is an explicit reviewed command with a mandatory reason.

### R88 plan P11: professional directory (people, organizations, credentials)

Public directory reads: `GET /api/directory/persons` (cursor-paginated, filters
`category`/`province`/`city`/`name`), `GET /api/directory/persons/:id`,
`GET /api/directory/organizations`. Only profiles with explicit
`publication_consent=1` are listed; withdrawing consent unpublishes instantly
(`404 not_published`). `contact_value` is NEVER part of any public DTO — only
the mediated `contact_preference` travels. Service areas use the approved
31-province ISO 3166-2:IR code vocabulary; city is canonical text within a
province. One person holding rider AND trainer categories is ONE profile row
with two categories — never duplicated.

**Credentials** (`POST /api/directory/persons/:id/credentials`, requires a
verified person link): role (from the 22-item reviewed starting vocabulary —
dc / judge / steward / ringmaster are distinct), issuer, identifier, dates and
evidence. Self-declared credentials always land `unverified`; only staff
review (`POST /api/admin/directory/credentials/:id/review`) or issuer
attestation raises the state, and every public DTO carries the honest
`verification_level`. Expired credentials lose `is_active` at read time but
remain in the credential history.

**Claims & moderation** (`POST /api/directory/claims`,
`GET /api/directory/claims/mine`,
`POST /api/admin/directory/claims/:id/review`): representation requests carry
evidence and sit `pending` until a staff review. Approving a PERSON claim
verifies the `user_person_link`; approving an ORGANIZATION claim grants a
MANAGER `organization_memberships` row (organization changes require an active
manager). Appeals must reference the claimant's own rejected claim. An
unrelated account gets `403 directory_claim_required` on profile/credential
writes — claims never auto-publish and never auto-verify.

### R88 plan P12: consented service request inbox

A service request is a LEAD — never a confirmed appointment; no paid/booked
states exist in the state machine (the CHECK constraint is the proof).
`POST /api/service-requests` (authenticated + CSRF + mandatory
`Idempotency-Key` header) sends a minimized lead: provider (published
directory person), category (reviewed vocabulary), coarse location (approved
province code + city), optional horse and a short note — no medical details
are solicited. The receipt lands in the same batch as the request (P03
discipline): a retry replays the stored response, the same key with a
different payload is a 409, and at most 3 open requests per requester-provider
pair are allowed (429). Demo/synthetic persons can never be targeted — the
provider must have a published directory profile.

States: `new -> acknowledged -> discussing`; `closed` / `withdrawn` / `spam`
are terminal. Transitions run through the explicit table with row-version
optimistic concurrency (stale = 409; terminal stale edits = 409). Only the
requester may withdraw; only the provider side (or staff) may mark spam.
`POST /api/service-requests/:id/block` lets the requester block a provider
(the note stays private); `POST /api/service-requests/:id/report` files an
abuse report.

**Contact sharing is consent-gated AND re-authorized at every read**: the
requester's contact route is visible only to the requester and the CURRENT
authorized provider manager (verified person link or active manager
membership) — a revoked manager loses access on the very next request.
`GET /api/service-requests/mine` (requester view), `GET
/api/service-requests/inbox` (provider view), `GET /api/service-requests/:id`.

`GET /api/directory/persons/:id/response-stats` reports provider response
times computed ONLY from real acknowledged requests (exact
`first_response_at` timestamps), with sample size, explicit exclusions
(withdrawn-before-acknowledgement, spam, never-acknowledged), a method note
and a not-a-quality-guarantee disclaimer. No synthetic ratings or invented
badges exist.

## Security / visibility

Public DTOs are explicit allowlists. Sensitive source/staff fields remain behind curation/admin boundaries. `raw_json`, microchip/file/lab identifiers and unrestricted source notes are never exposed merely because they exist in the canonical SQLite.

## Premium/reference intelligence

`analytics.registry()` includes trust-aware premium population analytics, reference-population benchmarks and recorded influence trajectories when snapshot 2.1.0 is present. `analytics.horseInsights()` may include per-horse `referencePopulation` intelligence. `breeding.optimize()` ranks an explicit candidate set using the shared backend method; frontends must not implement independent scoring formulas.

### Rate limiting (two layers, R91)

Abuse throttling runs BEFORE routing in the Worker entrypoint. Layer 1 is the
Cloudflare rate-limiting binding (auth 10/min/IP, write 30/min/IP, expensive
12/min/IP, public reads 300/min; per-account login/OTP 5/min keyed by
SHA-256 identity). A controlled live probe (2026-10-03) proved the binding
currently admits every request on this account, so layer 2 — a D1
fixed-window counter (`rate_limit_counters`, migration 0040) — is the ACTUAL
enforcement for the abuse-critical classes: one atomic upsert per request
both records and returns the usage; public reads stay binding-only. Every 429
carries `Retry-After: 60` and a generic envelope (no account-existence
signal). Fail-closed doctrine (F18): production without the binding, or with
a failing D1 counter, answers an honest 503 rather than running unthrottled.

## Runtime snapshot freshness

Lightweight public operational endpoints (`/api/platform/meta`, `/api/registry/facets`, `/api/quality/summary`, and `/api/health`) consume the runtime-summary snapshot only while its revision is current. After a newer canonical edit, they fall back to exact live SQL until the derived models are rebuilt; they do not present last-known snapshot counts/facets as current. `snapshotStale` on health reports the derived-snapshot freshness state, not that the returned live counts are stale.

Scientific registry analytics are different: `/api/analytics/registry` does **not** present stale analytical results as current and returns `analytics_stale` until the offline analytics generation is rebuilt and marked current.
