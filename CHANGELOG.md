# R151 — identity columns + forgiving search + pedigree scroll fix + Modern Pedigree frontend SHIPPED (0.93.0 / contract 2.35.0) — 2026-10-29

- **Registry identity columns (owner directive)**: the combined name cell shows ONLY the horse name and the owner, both rendered noticeably larger (desktop + mobile); the register (serial) number moved out of the cell and the NEW `microchip_no` public column joins the projection — both live in their own optional columns that ship HIDDEN by default (per-user toggle + reset under the column picker). `microchip_no` added to PUBLIC_HORSE_FIELDS/SEARCH/profile projections + public contract type; DATA_VISIBILITY.md annotated with the owner decision; privacy policy tests updated to the new policy (every other private field class stays forbidden).
- **Forgiving search**: per-token fuzzy candidate discovery (3 longest tokens; Postgres similarity now includes the trigram-indexed owners column), OR-relaxed recall probe when the conjunctive FTS finds nothing (mixed horse+owner queries and dropped middle names), compact spaceless matching ("peiman amanzadeh", "ir 126 187"), compact register match, fuzzy scoring against owner/breeder/place/parent tokens, all-words completion bonus ranking complete readings first. New Supabase indexes `idx_horse_search_owners_trgm` + `idx_horse_search_breeders_places_trgm` applied live and recorded in scripts/turn27-recreate-search-indexes.mjs. Recall fixture re-recorded under an append-only ordering guard (scripts/r151-regen-recall-fixture.mjs); 6 new forgiving-search tests.
- **Pedigree visualizer scroll fix**: layout height hugs the deepest card (the phantom extra row is gone); the viewport height hugs content in fit modes AND actual-size mode (fullscreen + fit-height keep the full stage); the CSS `min-height: clamp(480px,62vh,820px)!important` floor that overrode the computed height was dropped to a 340px non-important floor. The scroller can no longer travel past the last card into empty space.
- **Modern Pedigree (modern-horse) external frontend**: the owner-supplied "modern horse pedigree website" mockup ported onto the live platform as a 5th external frontend — Tailwind 4 scoped to its own container (theme + utilities, NO preflight; Heritage CSS untouched), EN/FA + Jalali dates, appearance schemes (9 colour families × light/dark/system × modern/classic), Welcome + Dashboard (live health/analytics/quality), Registry (smart search + facets + filters + pager), Horse detail (identity incl. register/microchip, family visualizer with the REAL ancestor tree, people tabs, COI), People directory, Breeding pairing study (real common-ancestor analysis), News (platform content) and Quality (public summary). Dormant areas render honest "coming with the next data phase" states — no fabricated data. Zero demo-data imports survive; photos only when a real profile image exists.
- Gates: tsc clean; vitest 2,294/0 (10 skip, +7 tests); validate:frontends (5 external frontends); production build + dist asset gate (modern-horse=0 required assets); deployed live — see DEPLOY-R151-RECORD.md.

# R149 — Gate E care/studbook policy SHIPPED (0.91.0 / contract 2.35.0) — 2026-10-29

- Task 7 (handoff Gate E) complete: care intake now evaluates the versioned registry-rule service — breed/studbook care sub-specs for reproductive method, embryo transfer, genetic/recipient dam, twins/offspring count and required evidence; NO universal twins rule (limits are explicit, versioned, overridable operator decisions); effective-period applicability added.
- Every care command captures the policy epoch and commits mutation + private history + policy decision + operation receipt + policy receipts in ONE transaction (canonical graph→policy→participant lock order; 409 with zero residue on activation/retirement/participant/breed races, including empty-set first activation); override semantics identical to canonical writes (blockers never overridable). Care subjects are an explicit opt-in applicability surface — existing registration rules can never silently start blocking care.
- Migration 0122 applied to Supabase primary AND remote D1 before deploy; live 0.91.0/2.35.0 (Worker bd615e98); pre-flight verified both databases current through 0121 and no sandbox rollback. Full report: DEPLOY-R149-RECORD.md.

# R148 — master-AI package INTEGRATED + Tasks 5+6 SHIPPED (0.90.0 / contract 2.34.0) — 2026-10-28

- Integration of the master-AI R148 package (downloaded from the delivery link; verified byte-identical, 1,901 files, tools/verify-r148-package.py) onto this repo; zero code deletions; gates re-run green.
- LIVE PRIMARY REPAIR: Supabase was missing ALL of migrations 0110-0120 (the R147 round applied them only to D1) — the cause of the observed /api/registry/metadata HTTP 500. Applied 0110-0120 via the offline renderer + statement-by-statement runbook (scripts/r148-apply-reviewed-migrations.mjs); metadata now 200 live. Analytics cohort rebuild remains queued.
- Task 5 (stale-draft contract): expected_content_revision REQUIRED on draft edits; 409 content_revision_conflict carries the current revision; the guarded update binds the EXPECTED revision; SDK + both editors propagate; unsaved-draft snapshots survive with the revision. 2 new tests.
- Task 6 (create idempotency): migration 0121 canonical_command_receipts; same key + same content replays, changed content 409 command_key_reuse, concurrent duplicates -> one horse (receipt claims the slot in the same batch; horse insert conditioned on the receipt digest); SDK mints principal-scoped command keys. 2 new tests.
- Contract 2.33.0 -> 2.34.0. Gates: vitest 2,278/0 (10 skip), python 268/268, native 801/0, tsc x4, platform audit, inventories (121 migrations/171 structures), build. Deployed Worker 1c0b3234; live-verified. Full report: DEPLOY-R148-RECORD.md.

# R148 — audited implementation candidate — 2026-10-28 (0.90.0, contract 2.33.0)

- Preserved the supplied R147 runtime, migrations, tests and tools; the prior export comparison found 1,675 unchanged files, four edited progress documents and 95 omitted historical evidence/input files. All 24 supplied image/SVG assets remain unchanged.
- Added migrations 0117–0120: atomic registry policy receipts/context checks, scoped genetic evidence operations, encrypted TOTP MFA/recovery/session assurance and exact-session private media grants.
- Closed rule activation/parent/evidence/source races, receipt-failure partial acceptance, losing draft child writes, generic genetic-role access, private snapshot/link bypasses and clinical-file leakage through ordinary registration rules.
- Added usable real-SDK security, professional-access and genetic workbenches, preserving the optional Professional presentation and existing frontend systems. Missing optional art/model/font resources now have explicit availability handling and honest fallback presentation.
- Updated current manifests, source verification tooling, hosted read-only schema preflight, offline PostgreSQL migration renderer and exact client-coverage/remaining-work documentation.
- Verification and limitations: `docs/R148_VALIDATION.md`. Remaining tasks: `docs/R148_IMPLEMENTATION_AND_REMAINING_WORK.md`. No deployment or live data changes occurred in this round. Complete proposal acceptance, clinical/institutional authority and hosted operation approval remain open.

---

# R147 — master-AI package INTEGRATED + DEPLOYED (0.89.0 / contract 2.32.0) — 2026-10-28

- Integration of the delivered R147 package onto this repository: package files take precedence over the repo tree (verified byte-identical, 1,774 files, tools/verify-r147-package.py); zero code deletions (the 93 baseline-only files are stripped binaries, not removals); repo assets restored the 16 files the package environment lacked (equidata-elite 7 + fei-classic 9).
- Gates re-run on the integrated tree: vitest 2,161/0 (10 skip), python 268/268, review-native 0 fail, tsc x4, validate:inventories (353 routes/162 structures/116 migrations), merge-inventory, admin-records, frontend-assets source+dist, production build 0.89.0 — all green.
- Remote D1 migrations 0110–0116 applied before deploy; Worker a260bba0 live: health 0.89.0/2.32.0, competitions 200, admin anon-401, care anon-404 (disabled by default). Full details: DEPLOY-R147-RECORD.md. Remaining work is the master AI's P0/P1 list, unchanged.

# R147 package (as delivered) — current implementation candidate (0.89.0 / contract 2.32.0)

The delivery notes below are preserved as received from the master AI. Read [R147_START_HERE.md](R147_START_HERE.md) and [the implementation/remaining-work handoff](docs/R147_IMPLEMENTATION_AND_REMAINING_WORK.md). Package verification was in [R147_VALIDATION.md](docs/R147_VALIDATION.md).

---

# R146 — Master-AI plan D04 + D05: bounded rules service + field claims, and the production scan feed — 2026-10-28 (0.88.0, contract 2.31.0)

- **D04 the bounded, versioned rules service (migration 0108)**: `registry_rules` + append-only `registry_rule_versions` + `registry_rule_outcomes` (every fail/override an evaluation produced on a canonical write path). Specs are typed DATA payloads validated against per-rule-type zod schemas — there is NO code path that evaluates admin-supplied SQL or JavaScript. Ordered state machine draft -> report_only -> active -> retired; preview against existing records before activation; audited policy overrides (actor + reason) with blockers never overridable; zero active rules = every write path behaves exactly as before (ships dark). Enforcement wired into createHorse/updateHorse/change-review/submission-approval/import-apply; client namespace `admin.rules`; 15 tests.
- **D05 field-level claims + conflict resolution (migration 0109)**: `field_claims` retains competing values WITH sources (a claim never mutates the canonical row); `field_claim_decisions` append-only trail records previous value + actor + reason; revert restores through the same validated mutation path; identical open claims deduped (idempotent external refresh); import apply records differing external values as pending claims instead of silently dropping them. Client namespace `admin.fieldClaims`; 11 tests.
- **E04 production scan feed COMPLETE**: full production corpus (93,896 horses, ids 1..10,121,581) scanned through the app's audited API; queue at **9,171 open issues** — scan-seeded 3,878 BIRTH_DATE_YEAR_MISMATCH + 272 SEX_ROLE_DAM_MALE + 142 SEX_ROLE_SIRE_FEMALE + 200 REGISTER_NO_DUPLICATE (group cap) + 2 PARENT_BOTH_SIDES; the pre-existing 4,628 PARENT_YEAR_CONFLICT + 27 cycles + 18 outliers + 4 self-parents untouched. Every row carries a 'detected' event (4,494).
- **Three real production scan defects found + fixed + pinned** (tests/integration/r146-scan-windowing.test.ts, 4 tests): (1) LIMIT-only keysets re-scanned the whole 95k tail per pass and blew the adapter's 8s statement deadline -> bounded ID-range windows; (2) sparse import ids (to ~10.1M) would burn thousands of passes -> one PK probe jumps empty gaps; (3) the 150-statement write batch blew the 20s batch deadline (~130ms/statement through Hyperdrive) -> 40-statement chunks, partial failure self-heals via the idempotent dedupe. Plus the catch-all handler now logs the error message (deadline errors name the statement), and the scan runbook gains ANALYZE horses first (stale planner stats seq-scanned 3k-id ranges, 4.9s -> 1.7s).
- **Inventory + policy**: route inventory 306 entries, canonical data inventory 144 structures, PlatformClient fixture updated (admin.rules + admin.fieldClaims); contract 2.31.0 capability additions documented.
- **Gates**: vitest 1,989/0 (+30 R146), python 268/268, typechecks x6, all validators, production build 0.88.0. Migrations 0108+0109 applied to Supabase (verified) and confirmed already present on remote D1. Deployed 0.88.0 (Worker version 17933d89) — live-verified: health 0.88.0, contract 2.31.0, new admin reads anon-401, competitions 200. Full details: DEPLOY-R146-RECORD.md.

# R145 — Master-AI plan E04 + C04 + C05 + C06: usable quality queue, evidence summaries, permission-aware lookup — 2026-10-28 (0.87.0, contract 2.30.0)

- **E04 the data-quality queue, made usable (migration 0107)**: `data_quality_issues` gains workflow columns (status open/assigned/resolved, assigned_to/assigned_at, source, rule_version, resolved_by) and a new append-only `data_quality_events` history table (detected/assigned/resolved/reopened/note with actor + note + time). Full reviewer loop: GET `/api/admin/quality` (status/severity/code/assigned filters, <=200 rows) with RECONCILED counts (open/assigned/resolved + by severity/code) computed from the SAME table so dashboard numbers can never drift; GET `/api/admin/quality/:id` (detail + full lifecycle history); POST `/:id/assign` (active-assignee check), `/:id/resolve` (resolution note REQUIRED >=3 chars), `/:id/reopen` (note required, history preserved, resolution never destroyed), `/:id` note; POST `/api/admin/quality/bulk-resolve` — EXPLICIT low-risk info codes only (`LOW_RISK_QUALITY_CODES` + severity='info' enforced server-side; one high-risk row refuses the whole batch); POST `/api/admin/quality/scan` — idempotent corpus scan seeding the measured R143-E01 conflicts (sire-female / dam-male role conflicts through the unified B09 classifier, register_no duplicate groups, PARENT_BOTH_SIDES, birth_date/year contradictions; per-child-link dedupe so a second conflicting child produces its own finding; re-runs create nothing new). Name-only bulk auto-merging stays unavailable by design — duplicates resolve ONLY through the versioned merge preview/commands.
- **E04 surfaces**: heritage admin quality panel upgraded from a read-only list to the workable queue (status filter, reconciled counts, Take/Resolve/Reopen per row, corpus scan, low-risk bulk action, honest bulk-policy note); EquiData governance desk gets the same verbs (counts, resolve with required reason, scan). Client: `admin.quality` (typed params + QualityQueueListResponse), `qualityDetail/qualityAssign/qualityResolve/qualityReopen/qualityNote/qualityBulkResolve/qualityScan`; contract 2.30.0 capability `quality_queue`.
- **C04 evidence summaries**: public GET `/api/horses/:id/evidence-summary` — the deliberately limited lifecycle summary: public media counted as uploaded vs platform-reviewed ONLY (documents, veterinary role, non-consented and quarantined items are excluded by the public predicate, so private presence never leaks), honest attestation states (active/revoked/superseded by record kind), only PUBLICLY DECIDED genetics counted (undisclosed presence is private), and the lifecycle vocabulary teaches reviewed ≠ attested. Marketplace verified-docs chip FIXED (Master-AI complaint): it counted `publicMediaPredicate` rows — which are photo-only — so a verified PHOTO generated a "verified docs" badge; it now counts platform-verified DOCUMENTS only, quarantine-clean.
- **C05 permission-aware search**: GET `/api/search/exact-identifier?kind=&value=` — the authorized exact chip/passport/life_number/UEL/register lookup (capability `quality.read`, editors+): minimal projection (id/name/register/birth-year/active — never the other identifier namespaces), bounded LIMIT 10, a miss is an empty result indistinguishable from a concealed record, anonymous/plain callers refused. Public browse gains evidence facets `hasPhoto` (shared_public, quarantine-clean), `hasVerifiedDoc` (platform-verified documents only) and `parentageKnown` — public-safe by construction, counts derive from the same predicate as the rows.
- **C06 provenance-driven labels**: the issuer-credentials panel no longer hard-codes "every issuer is fictional" — the fictional-issuer statement now appears ONLY when the platform itself reports the demo dataset (`demoAdminLoginAvailable`); on real data the panel says no badge implies approval beyond the named issuer's recorded scope.
- **Surfaces**: heritage attestation panel renders the evidence summary line; heritage DuplicateWorkbench gains the exact-identifier lookup tool (resolve "which horse owns this chip?" before a merge decision); EquiData horse profile renders the public evidence summary panel; presentation-parity evidence maps extended for both curated frontends.
- **Inventory + policy**: route inventory 303 entries (+9), canonical data inventory 142 structures (+data_quality_events), PlatformClient fixture updated (qualityDetail/qualityAssign/qualityResolve/qualityReopen/qualityNote/qualityBulkResolve/qualityScan/evidenceSummary/exactIdentifier). Export-test aligned to the R144 standing redaction policy (documented token formats are REDACTED in Master-AI zips, not shipped, not fatal).
- **Gates**: vitest 1,959/0 (+14 R145 tests: full queue lifecycle with preserved history, reconciled counts, child-link-aware scan idempotency, per-child findings, bulk low-risk restriction + whole-batch refusal on one high-risk row, no-merge guarantee, evidence-summary privacy (documents/veterinary/undisclosed genetics never counted), 404 on archived, exact-lookup precision/auth/empty-miss parity), python 268/268, typechecks ×5, all validators, production build 0.87.0.

# R144 — Master-AI plan D01 + D02: professional grants + versioned publication decisions — 2026-10-28 (0.86.0, contract 2.29.0)

- **D01 professional grants (migration 0105)**: a NEW horse-scoped permission register `professional_access_grants` — the ONLY non-staff path to private health data. Distinct six-permission vocabulary (`private_health_read`, `clinical_write`, `sample_submit`, `evidence_review`, `official_attestation`, `private_file_export` — never one umbrella), professional kinds (veterinarian, laboratory, farrier, physiotherapist, dentist, nutritionist, federation_official), grantee user OR organization (institution), professional-authority reference (license/accreditation) and assignment reference, basis (admin_grant/owner_consent/institution_assignment), validity windows and immediate revocation with a marker-conditioned audit row (the 0034 grant pattern, reused verbatim). A generic horse-edit capability NEVER implies private health access.
- **D01 wiring**: `/api/horses/:id/genetics` resolves the viewer's active `private_health_read` grant BEFORE the projection — a granted veterinarian/laboratory sees granted health RESULTS while lab accession, notes and editorial interpretation stay staff-private. Anonymous and ordinary viewers are unaffected; the grant lookup only runs for signed-in non-staff viewers (the public hot path pays nothing). Staff API: POST/GET `/api/admin/professional-grants` + POST `/api/admin/professional-grants/:id/revoke` (admin manages, editor reads the register; grantee existence/activeness and validity ordering enforced; double revoke = clean 409).
- **D02 versioned publication decisions (migration 0106)**: the bare 0101 `public_disclosed` boolean becomes a versioned, append-only decision log `publication_decisions` — subject record, decision (publish/withdraw), per-record monotonic decision_version (UNIQUE-guarded so two racing writers are exactly-one-winner), basis (owner_consent/staff_publication/official_basis), purpose, evidence reference, decision maker, reason, and the caller's expected_version stored for explainability. The disclosure endpoint now appends a decision and materializes the legacy boolean in the SAME transactional batch — so the SQL-boundary readers (pairing projection, attestation listing, dossier snapshot) honor withdrawal atomically. A stale `expected_decision_version` is rejected 409 `publication_decision_conflict`: a lagging client can NEVER overwrite a newer withdrawal. Repeats of the current state are clean no-ops that append nothing (idempotent replays).
- **D02 compatibility reader** (`effectiveDisclosure`): decision log wins when history exists; rows that predate 0106 keep the legacy-boolean behavior verbatim (`source: legacy_boolean`). New GET `/api/admin/genetic-tests/:id/disclosure` returns the explainable history (who/which basis/which version) plus the effective state and a materialized-matches diagnostic.
- **Client surfaces**: `genetics.disclosureHistory`, new `professionalGrants` namespace (create/list/revoke) in the platform client + typed contract types; contract 2.29.0, app 0.86.0.
- **Honesty guardrails kept**: verification is still never publication; the projection still refuses unverified rows; disclosure alone cannot leak raw data; the professional path never widens grant semantics.
- **Inventory + policy**: route inventory 294 entries (+4), canonical data inventory 141 structures (+2), horse-reference inventory 49 classified references (version 2026-10-28.1: professional_access_grants + publication_decisions classified as merge-moves). Also fixed an R143 leftover the language validator caught (deprecated Persian search term in the submission lookup replaced with the approved جست‌وجو form).
- **Gates**: vitest 1,945/0 (+24 R144 tests: unit D01 vocabulary/containment/revocation, unit D02 compatibility reader, real-database D01+D02 journey — granted-vet read with staff-private fields withheld, expiry/revocation on next request, publish→withdraw with versions, stale expected_version 409 without a losing decision row, replay no-ops, explainable history, legacy fallback), python 268/268, typechecks ×6, all validators, production build 0.86.0. Migrations 0105+0106 applied to Supabase (canonical, management SQL API) AND remote D1 before deploy.

# R142 — Master-AI R141 defect corrections B01–B09 — 2026-10-28 (0.84.0, contract 2.28.0)

# R144 — Master-AI plan D01 + D02: professional grants + versioned publication decisions — 2026-10-28 (0.86.0, contract 2.29.0)

- **D01 professional grants scoped to horse/data/purpose**: migration 0105 `professional_access_grants` — a veterinarian, laboratory or federation professional gets explicit, horse-bound permissions (private_health_read / clinical_write / sample_submit / evidence_review / official_attestation / private_file_export), each grant binding the horse + grantee (user or organization) + professional kind + professional-authority reference (license/accreditation) + assignment reference + validity window; audited revocation takes effect on the very next request (nothing caches grants). Staff API: `GET/POST /api/admin/professional-grants` + `POST /api/admin/professional-grants/:id/revoke`; `admin.professionalGrants` client namespace (create/list/revoke), honest inert offline mock. The professional `private_health_read` path is deliberately NARROW: a professional reads granted health RESULTS on the granted horse only — never the staff-private evidence fields (lab accession, notes, editorial interpretation), and never on ungranted horses.
- **D02 versioned publication decisions**: migration 0106 `publication_decisions` — the bare `public_disclosed` boolean gains an append-only, versioned decision trail (decision, decision_version UNIQUE per record, actor, reason, decided_at) with optimistic concurrency (stale expected_version → 409) and a compatibility reader for legacy rows; `GET /api/admin/genetic-tests/:id/disclosure` now serves the explainable decision history; disclosure toggle appends decisions instead of silently flipping a bit.
- **Reconciliation note (this session)**: two parallel R144 implementations existed (both 0.86.0/2.29.0). The origin WIP (D01 with `professional_access_grants` 0105 + D02 0106, already migrated to Supabase/D1) was adopted; the duplicate parallel `professional_grants` table/implementation was discarded (dropped from Supabase) and its unique contributions folded in: gate fixes (package-lock 0.86.0, client inventory fixture + disclosureHistory, marketplace version pin, deprecated Farsi term), complete inventory coverage (route rows for the 3 professional-grant routes + GET disclosure history; data-inventory rows for professional_access_grants + publication_decisions; horse-reference merge policy rows for both tables — moves), credential-recovery block re-applied, R31 secret-scanner-safe Gemini token form.
- **Gates**: vitest 1,957/0 (185 files; includes the parallel agent's 24 D01/D02 tests + full R143 suite), python 268/268, typechecks ×6, ALL validators (operational inventories reconciled to 294 routes / 141 structures), production build. Version 0.86.0, contract 2.29.0, migrations through 0106.

# R142 — Master-AI R141 defect corrections B01–B09 — 2026-10-28 (0.84.0, contract 2.28.0)

# R143 — Master-AI plan C03 + C02: resumable registration workflow — 2026-10-28 (0.85.0)

- **C03 draft state**: a successful submit (fresh create or existing draft) now clears the form, drops the edit target and shows the explicit "Register another horse" action — the next horse B can never inherit horse A's draft id or idempotency key. Withdraw uses the same reset path.
- **C03 numerals**: Persian (۰-۹) and Arabic-Indic (٠-٩) digits are normalized to ASCII BEFORE validation in every numeric field (birth year, person numbers, parent registry numbers, register/microchip identifiers). The old `/[^0-9]/g` stripper silently deleted Persian keystrokes — typing «۱۴۰۰» produced an empty field. A year in the plausible Solar-Hijri range (1100–1500) is now rejected with an honest bilingual hint (۱۴۰۲ ≈ 2023 Gregorian, exact dates keep the Solar-Hijri date field) instead of a bare "not valid".
- **C03 lookup preservation**: unsaved form data (including the active step) persists in sessionStorage and is restored on return — navigating away for a parent/person lookup no longer wipes the owner's work; a restored unsaved draft always wins over the stale server-draft hydrate.
- **C03 competition races**: the results load-more cursor request is bound to the event it was opened for (selectedRef generation guard) — a delayed page for event A is dropped once event B is selected; appended rows are deduplicated by id so an ambiguous retry cannot duplicate a result.
- **C02 resumable workflow**: the submission page is now a 4-step resumable stepper — Identity → Parents → People & evidence → Review — with per-step validation on Next (bilingual, same errors a reviewer would raise), "Save as draft" available at every step (drafts come before files/evidence), a full review grid before submit, and the step position saved/resumed across navigation. Server-draft edits hydrate into the stepper; needs_changes round-trips unchanged.
- **C02 in-place parent lookup**: the parent "existing registry horse" mode now offers in-registry name search (debounced `search.horses`, 8 results, stale responses aborted) with one-click selection and a manual number fallback — no more copying ids from another tab. Unresolved parent claims remain explicit source assertions; nothing canonical is ever auto-created.
- **Gates**: vitest 1,921/0 (+16 R143 regression tests: draft lifecycle, numerals, step validation/resume, in-place lookup, competition race guards), python 268/268, typechecks ×6, all validators, production build. Version 0.85.0.
- **Next (R144, plan order)**: D01 professional grants scoped to horse/data/purpose; D02 versioned publication decisions; E01 corpus measurement.

# R142 — Master-AI R141 defect corrections B01–B09 — 2026-10-28 (0.84.0, contract 2.28.0)

- **B01 (P0, release blocker)**: the anonymous pairing projection applied the `verified` gate but NOT the `public_disclosed` publication gate — undisclosed disease results leaked into pairing analysis as variant-copy counts, evidence IDs and 25/50/25 offspring probabilities. The disclosure filter now runs at the SQL boundary (`COALESCE(public_disclosed,0)=1` unless privileged), so an undisclosed test contributes no evidence, no probability, no identifier and no excluded-count signal. Same gate added to the public attestation listing. Policy version `r142.disclosure-gated.1`.
- **B02**: `storeEdgeCopies` is now an awaited async operation — the background revalidation path (which had no execution context) used to read fresh origin data and write ZERO cache copies. The fresh-request path still schedules it inside `ctx.waitUntil`. Disclosure-sensitive reads (`/api/horses/:id/genetics`) no longer store or serve the extended stale window (Cloudflare Cache API delete is data-center-local — no proven global withdrawal), and a disclosure toggle now best-effort purges the horse's edge copies (fresh + stale keys) in the serving colo.
- **B03**: the lifecycle event INSERT carries the same row-version precondition as the canonical horse update inside the same batch — a lost version race now commits NO death event beside its 409 (canonical state, history, receipt and audit succeed or fail together).
- **B04**: ownership creation reads its receipt id from the ownership-period insert (was the mutation-journal insert → `201 period:null` with the period persisted), and the overlap/share invariants are rechecked against the post-insert state; a violated invariant compensates (deletes the inserted row), aborts the journal and answers 409 with no misleading receipt.
- **B05**: the breeding optimizer now enforces the ancestry evidence floor PER PARENT (algorithm 1.3.0) — a fully documented parent can no longer conceal the other parent's missing ancestry (the reproduced 88.53 top-rank with one empty side); the exclusion names the weaker side and both coverages.
- **B07**: import digests separated — identity fingerprint (matching/fill-once skip) vs content checksum (ALL normalized fields + raw payload) vs raw-byte integrity; the batch replay digest is now content-bound, so changed external IDs / sex / breed / notes / parent claims create a new reviewable version instead of silently replaying receipts; JSON key order cannot change a digest.
- **B06/B08**: import apply separates private ingest from publication — a source with `redistribution_allowed=0` still ingests but its created rows start `is_active=0` (never auto-promoted to anonymous reads), every import-created horse now carries a `data_origin` token (`import:<namespace>`), and breed/sex are applied on create + fill-once on update with per-field outcomes in the audit receipt.
- **B09**: parent-assignment sex-role policy now uses the ONE shared canonical classifier (`classifyBreedingSex`) — the local substring lists missed plain "Female", which let a recorded female be assigned as sire. Unknown historical labels still pass.
- Master AI's R141 assessment + full 45-task implementation plan archived verbatim in `master-ai/` (commit e4c6a29).
- **Gates**: vitest 1,913/0 (+13 R142 regression tests; fixtures updated to record explicit disclosure), python 268/268 (clean full run — closes Master AI's outstanding item), typechecks ×5, all validators, production build. Version 0.84.0, contract 2.28.0.
- **Deferred to R143** (Master AI plan, agreed): C02 resumable registration workflow, C03 draft-state/numeral/pagination races (frontend), D01-D06 grants/publication-decisions/MFA/rules-service, E01-E04 data-quality baseline + queue, F-series clinical/lab, A01-A03 baseline+ledger. Import parent second-pass resolution review.

# R141 — Duplicate-resolution workbench: the merge commands become human-reachable — 2026-10-28 (0.83.0, contract 2.27.0)

- **Workflow completeness** (Master AI standard): the R117-19 versioned merge/preview/unmerge commands had NO client binding and NO surface — no human could ever reach them. Closed.
- **Backend**: 2 read-only admin reads — `GET /api/admin/duplicates` (standing fuzzy candidate miner: exact register_no, exact microchip, normalized-name + birth-year proximity, same both parents; bounded probes, per-call derived, no cron state) and `GET /api/admin/horse-merges` (recent versioned merge receipts, newest first, feeds the guarded unmerge). Both gate on `horse.edit`.
- **Contract**: `admin.duplicates` namespace (candidates / mergePreview / merge / unmerge / mergeHistory) + 9 typed response surfaces; mock client honestly inert offline; inventory fixture updated (methods 183→188).
- **UI**: heritage admin `DuplicateWorkbench` panel — reason filter, per-group review, kept/merge pickers, read-only preview with blockers/warnings/policy walk, audited-reason merge commit (fresh manifest digest + idempotent operation key), recent-merges list with guarded unmerge; bilingual EN/FA.
- **Gates**: vitest 1,889/0 (+4 new integration tests on the fully migrated DB), python OK, typechecks ×5, all validators (route inventory 290 entries), production build. Deployed: Worker 045fea7f (0.83.0 live, `/api/admin/duplicates` anonymous → 401 verified).

# R140 — Trust & integrity sprint + racing surfaces — 2026-10-27 (0.82.0, contract 2.26.0)

- **Privacy**: verified disease/health genetic results private-by-default (`public_disclosed`, migration 0101) across profile/marketplace/dossier surfaces; audited disclosure endpoint; summaries count only publishable rows. Unverified rows never publish.
- **Imports**: canonical write path — blank identifiers→NULL, birth-year plausibility floor (1700..now+1), unified NFKC identifier normalization, apply settles revision/analytics/counter exactly once (audit-guarded).
- **Idempotency**: `payload_digest` (migration 0102); key+content binding with 409 `idempotency_conflict`; client rotates key after every acknowledged create.
- **Optimizer**: `insufficient_ancestry` exclusion under 20% projected completeness (algorithm 1.2.0); exclusion code added to contract.
- **Racing**: 3 read-only GET endpoints + heritage Racing tab serving the asbdavani dataset with provenance blocks; identity crosswalk only; merge policy pinned in horseReferenceInventory 2026-10-27.1; migration 0104 parity DDL.
- **Fields/UI**: name_native_provenance + markings + height_cm (migration 0103); visible photo credits (heritage + equidata-elite); 7-generation pedigree selector; hero trust chips v1.
- **Deps**: zod ^4.6.6 (4.6.7). Gates: vitest 1,885/0, python 268/268, typechecks ×5, all validators, production build.

# R139b — Master AI assessment cross-verification (docs-only) — 2026-10-27

MASTER-AI-COMPARISON-R139.md: every Master AI finding re-verified against code (privacy/publication coupling, import bypasses, idempotency reuse, optimizer ranking, zod 4.4.3 — all confirmed; DNA-coverage correction accepted; their gate failures attributed to zip exclusions). Merged R140 roadmap adopted. No code changed.

# R139 — Client-proposal audit round (docs-only) — 2026-10-27

Docs release: PROPOSAL-AUDIT-R139.md — the client's 4-phase national-registry proposal scored feature-by-feature against the live 0.81.0 build, with live data-coverage numbers (93,896 horses), the unserved 122,063-result racing dataset identified as the top quick win, a scrape plan (kasilor.com / asbdavani refresh), and a prioritized 10-step next-round roadmap. No code, schema, or deploy changes.

# R137 — Chrome-economy compaction round: the match tab (and every ops tab) stops wasting the screen — 2026-10-25

## 0.81.0 (R137, 2026-10-25)

Owner directive: "some tabs still need to be compacted even more — the match tab wastes half the vertical screen; photos too big, filters too tall, margins, title and subtitle; make it compact on PC and phone, and double-check everything else."

### What changed (all non-registry ops pages: competitions / marketplace / auth)
- PAGE HEAD: one tight banner instead of a poster — padding .45rem/.8rem, h1 clamp(1.02–1.35rem), eyebrow .58rem; the subtitle <p> is dropped entirely on competitions + marketplace (the content is the page); the page-level provenance banner (demonstration note) is removed from the flow on every viewport (in-panel provenance notes stay).
- COUNT BLOCK: inline metric (strong 1.05rem, .62rem labels) instead of a stat card (was 2rem + fixed min-width).
- FILTER RAIL: single quiet row — chips 2rem tall (was 2.75rem), controls 2.05rem (was 2.75rem), the season select sits inline with a .68rem label; the rail keeps flex-wrap so nothing clips on narrow widths.
- PANELS: padding .6rem/.7rem, gap .5rem (was 16px); competitions panel margin-top 0 (the head already carries the gap).
- EVENT CARDS: inner padding .38rem/.6rem (was .8rem), date column 2.4rem with 1.02rem day digits, photo 52x38 desktop / 46x34 phone (was 64x44 / 56x40), body .9rem/.68rem lines, tags .66rem with .15rem margin, count .8rem. Card height: ~86px -> ~59px on phones, ~76px -> ~63px desktop; page head 149px -> 84px on phones, 154px -> 84px desktop.
- LEGEND: one thin line (padding .12rem/.4rem) — still teaches the hue encoding.
- DETAIL SHEET: padding .7rem/.8rem, figure capped at 168px, sheet head margins halved, results table cells 5px/8px with .62rem headers, place chips 34px, close button 30px.
- MARKETPLACE: listing cards .6rem/.7rem padding, gap .5rem, basis 220px.
- Phones (<=600px): heads drop to .35rem/.55rem with 1rem h1, eyebrow hidden, count inline; the events page keeps the opt-in filter drawer (default-collapsed) so nothing is spent until asked.

### Double-checked everything else
- Registry desk (/browse), horse profile, newsroom, directory, stats verified visually at 1440x900 and 390x844 — all already compact and untouched by regressions; screenshots in review-r137/evidence/.

### Gates
- vitest 1860/0 (marketplaceCommands version pin moved to 0.81.0), typechecks x4 clean, python 268/268, css/mobile-ux/registry-mobile/ui-42/design-systems/frontends/presentation validators green, build + dist asset validation green.
- Deployed 0.81.0 (Worker 75193689-0da3-41c9-9d1c-20a623d420a1). LIVE VERIFIED: /api/platform/meta applicationVersion 0.81.0 on iraho.ir + workers.dev.

# R135 — Phone perfection round: explorer economy, competitions repair, chrome diet, frost collapse — 2026-10-25

## 0.79.0 (R135, 2026-10-25)

Owner directive: go through the whole Core frontend on a phone and waste NOTHING — every removed margin, button, collapsible and blur layer becomes room for the content that matters, while staying accessible; plus significance-sorted explorer, serial display, Farsi terminology aligned with Iranian standards, and the depth-map backgrounds retired.

### Registry database explorer (/browse)
- INFINITE SCROLL: the Previous/Next pager is gone. Pages append as the reader scrolls (IntersectionObserver sentinel at 700px, one subscription + MutationObserver re-bind; de-dup by id; popstate always replaces). The slim footer bar reports "X of Y" and keeps an explicit "Load more" button as the keyboard/AT path. `rows` (accumulated) render; `data` keeps last-page bookkeeping.
- TITLE ROW MERGE: the Advanced-search chip and a new compact sort picker (importance/name/year/id, each with its natural direction) moved INTO the page head next to the count — icon-only at <=720px. The toolbar now holds only search + export/columns (icon chips on phones).
- VIEW TOGGLE RELOCATED: Detailed/Narrow lives in the advanced rail section "03 Phone view" (validators keep the class contract); the permanent explorer row is gone.
- SIGNIFICANCE SORT (default): new `sort=importance` — portable CASE-weighted SQL (photographed champions 64 > biography 32 > stallion 16 > sport card 8 > sport 4 > imported 2 > serial 1, ties by id), verified live: RAG NAR (121) and foundation sires BARARI/MOBARAK (115) lead. `REGISTRY_URL_DEFAULT_SORT` = importance with natural-direction serialization (`?sort=id` still clean; `?dir=asc` serializes only when reversed). Contract tests updated.
- SERIAL DISPLAY: the register number is now the PRIMARY bold line on phone cards (raw #id demoted to the small line) and a secondary line in the desktop Horse column.

### Competitions
- The filter chrome (discipline chips + season) collapses behind one quiet "Filter +" chip on <=980px (desktop keeps the always-open rail via display:contents); the encoding legend and the provenance line are phone-hidden.
- EVENT CARD OVERLAP FIXED: the photo never had a reserved grid column (3-col grid + 4th photo child shoved body/count sideways) — `:has(.h-mod-event-photo)` now reserves the 4th column at every width; phone cards tighten (56px photo, .55rem padding). Verified direction-neutral at 390px (RTL): zero interpenetrating rects.

### Chrome economy (phones)
- More panel: NO keyboard hijack on coarse pointers (desktop keyboard focus unchanged — pinned by test), compact padding/1-column groups on phones, "Change interface" entry added to the More panel AND the sidebar; the floating UI pill is hidden on phones.
- The tabs/sidebar/auto/both layout toggle is hidden on phones (same choices remain in Navigation & appearance); the language chip becomes flag-only.
- PWA: /manifest.webmanifest (standalone + icon) and the apple/mobile-web-app meta set — installed home-screen sessions run WITHOUT the browser address bar; viewport-fit=cover + safe-area bottom padding for the reader.

### Newsroom
- Phone bottom polish: feed bottom padding, last-card clearance (measured 13px), reader bottom padding = dock stack + safe-area + 20px, tighter comment bubbles.

### Frost performance (the big blur win)
- NESTED-FROST COLLAPSE: the surface binder now marks material surfaces inside another frosted surface with `data-h-frost-nested="1"`; material.css drops their backdrop-filter (a re-blur of an ALREADY blurred backdrop root — visually near-identical, one full composite pass each) and raises fill opacity instead. Measured on live /browse at 390px: 201 nested surfaces -> 0 backdrop-filter passes; only 3 top-level surfaces keep real frost (topbar, page head, panel).
- PHONE BLUR BUDGET: <=720px retunes radii (major 24->15, panel 14->10, card 8->3, control 4->0) with raised fills, and the legacy token kernel (frost/glass/popover/terminal + hero pseudo-glass) follows the same curve, so contrast never depends on blur.

### Particle horse splash
- Idle economy: 30fps draw cap when the pointer is away and the scene is settled (rAF keeps ticking; full rate resumes instantly on contact) and a morph-weight cache (sub-5ms animation steps and reduced-motion skip the CPU morph entirely).

### Depth-map backgrounds RETIRED (owner directive)
- HeritageBackgroundEngine narrows to flat|layers: the WebGL depth stage is deleted, saved "depth" prefs degrade to the parallax layers stage, the studio engine chips drop depth, and the depth .avif assets are no longer referenced. Parallax layers + flat art remain.

### Farsi terminology (researched vs asbdavani.app + feiorg.ir + horse.ir standards)
- sexLabel male: نریان -> سیلمی (the Iranian registries' term; مادیان/اخته unchanged); stats + EquiData flags + studbook legend aligned.
- Disciplines: show_jumping -> پرش با اسب (federation standard), halter -> جشنواره زیبایی (هالتر); اسب‌دوانی/درساژ/استقامت confirmed correct.
- Pedigree grandparents: پدربزرگ‌ها و مادربزرگ‌ها -> اجداد دوم.

### Gates
- vitest 1860/0 (registryUrlState contract re-pinned to the significance default; navigationPresentation matchMedia stub answers its actual query), python 268/268, typechecks x4 clean, build + dist validators green, css/mobile-ux/registry-mobile/ui-42/language/design-systems/presentation/frontends/platform/budgets/inventories validators green.
- Real-data sweep scripts/r135-phone-sweep.mjs 28/28 at 390x844 + 1440x900 (dist + live-API route-forward): zero horizontal overflow on browse/competitions/newsroom/profile, infinite scroll appends 50->100, filter drawer collapsed, card rects clean, More panel no focus steal, nested-frost 201->0. Evidence: review-r135/evidence/.
- Deployed: 0.79.0, Worker Version c293d454 (iraho.ir), health ok / 93,896 horses; /manifest.webmanifest 200; importance sort verified live.

# R134 — Responsive-speed round: edge stale-while-revalidate, route-chunk prefetch, photo caching, phone profile photos — 2026-10-25

## 0.78.0 (R134, 2026-10-25)

### The diagnosis (measured live, not guessed)
- Warm anonymous GETs are already fast (40-60ms colo-cache HITs — the R131/R132 layer works). The remaining hole is EXPIRY: once a colo copy aged past its short TTL, the next visitor paid the full cold pipeline again. Measured cold: `/api/health` 0.5-1.3s, `/api/horses/1` 2.2s, `/api/horses` browse **5.5s** (first request after TTL in a cold colo), `/api/content/posts` 2.2s, `/api/competitions` 1.3s.
- Navigation still stalled on the first visit to every page: the R132 hover layer warms the destination's DATA, but the page's JS chunk downloaded only at click time (React.lazy) — a click -> chunk download -> render waterfall on top of API latency.
- Real horse photos (`/images/horses/*`, turn-33 round) were served with NO Cache-Control — every repeat profile view revalidated or re-downloaded them.
- On phones the hero CSS hid the whole `.profile-emblem`, which also hid REAL profile photos — the hero collapsed to a bare name on exactly the screens where the photo matters most.

### Edge stale-while-revalidate (worker.ts, R134)
- Every whitelisted anonymous public GET now keeps TWO colo copies: the FRESH copy (unchanged TTLs) and a STALE copy keyed with a `__edge_stale=1` marker (ttl + 1800s). A fresh miss falls back to the stale copy: the visitor gets the expired payload in one colo round trip (~50ms) while a background `ctx.waitUntil` revalidation rebuilds both copies. Revalidation is strictly the read pipeline (no rate limiting — it can only be triggered by a prior successful anonymous response, never directly attacked); failures keep the stale copy so the next request retries. The copy SERVED from stale is re-stamped to the endpoint's normal TTL so the browser never inherits the extended stale window. All R132 fingerprint-free rules (no cookie/authorization, GET, 200-only) are unchanged.

### Route-chunk hover prefetch (main.tsx, R134)
- New module-scope `routeChunkForRoute`/`prefetchRouteChunk` map: hover/focus/pointerdown on any internal link or `data-href` navigable now also fires the destination page's `import()` (stats, newsroom, newsroom studio, competitions, market, directory, workspaces, services, auth, desk, desk-submit, horse profile) and, for `/f/<skin>/...` links, the skin entry through the frontend registry. The module registry makes these idempotent and free; the later React.lazy call resolves instantly.
- Idle prefetch extended: the horse-profile chunk (the most-visited destination type — every browse/search result click lands on it) plus competitions/directory chunks warm during idle, skipped when `navigator.connection.saveData` is set.

### `/images/*` caching (_headers, R134)
- `Cache-Control: public, max-age=604800, stale-while-revalidate=86400` for the real-photo tree (horse profiles, competition covers, article figures). Append-mostly content (existing files are never rewritten), so a 7-day window + SWR keeps fixes reachable while repeat profile views load photos from the local cache.

### Phone profile photos (app.css, R134)
- At <=720px the hero now keeps a compact 74px round photo inline-start of the name/spec block when the record HAS a photo (`:has(img.profile-photo)` gates every override — no-photo records render exactly as before, splash fallback stays hidden). Identity card spans both columns; name/tags/lineage spacing retuned. The desktop hero (round 132px emblem beside name/spec) is unchanged.
- The profile `<img>` now carries `loading="lazy" decoding="async" width height` (no CLS, no eager download of off-screen photos).

### Gates
- vitest 1860/0, tsc clean, `npm run build` + validators green, css/mobile-ux/ui-42/registry-mobile/navigation validators pass.

# R132 — Performance deep-dive: round-trip collapse, edge cache expansion, client SWR, self-hosted fonts — 2026-10-24

## 0.75.0 (R132, 2026-10-24)

### The diagnosis (measured live, not guessed)
- Live timing survey of every hot surface: `/api/horses` browse **1.1-1.5s on EVERY request** (never cached), `/api/horses/:id` profile ~2.0s, `/api/horses/:id/pedigree` **2.1-2.4s**, profile sub-resources 0.9-2.4s each, `/api/analytics/registry` 0.8s, `/api/registry/facets` 0.4s. The R131-cached endpoints (`platform/meta`, `content/posts`, `competitions`) collapse to 40-170ms on cache HITs, proving the colo-cache approach works — the remaining pain was everything NOT cached plus multi-query endpoints.
- Root cause of the multi-second endpoints: **the API was architected for D1's single-round-trip `batch`, but on Supabase every statement in a batch is a SEPARATE Hyperdrive round trip** (~0.5-1s each through the edge→Hyperdrive→eu-west-1 chain). Handlers doing query-then-batch paid 3-5 sequential round trips; `platformMeta`'s 11-statement fallback batch was up to 13 round trips.
- The pedigree endpoints walked the graph **one generation per query** (`loadAncestorGraph` root + one query per generation, `loadDescendants` chunked at 50 ids per query) — 3-7 sequential round trips per pedigree view.
- The HTML shell loaded a **render-blocking fonts.googleapis.com stylesheet** (10 families) — a third-party DNS+TLS+download round trip before first paint, worst for visitors in Iran.
- The SPA refetched everything on every navigation — no client cache, no dedup, no prefetch.

### Supabase adapter: pipelined batches (N round trips → 1)
- `db.batch` statements are now all written to the socket before any result is awaited (postgres.js pipelines them inside the transaction) — the server still executes them in order inside the same transaction, so D1's ordered-transaction semantics are preserved; only the client-side waiting changes. An 11-statement meta batch went from ~11 round trips to one.
- The integer-id catalog lookup (INSERT→RETURNING decision) previously ran once per write batch keyed on the transaction object — a fresh WeakMap key every time, so every write batch paid an extra catalog query. The set is now resolved once per batch from the pooled top-level client (where the cache actually survives) under the deadline/retry guard.

### Pedigree: one recursive-CTE query (using the R120-proven portable form)
- `loadAncestorGraph`: the whole ancestor closure loads in ONE query (`WITH RECURSIVE walk(id, depth)` — single-branch CASE form, recursive reference in a JOIN, UNION dedup on (id, depth) so cycles terminate by the depth bound exactly like the old `expanded` set; deleted parents never enter the walk; `MIN(depth)` per id reproduces the old BFS discovery order). missingParentIds/unloadedParentIds/truncated/cycleNodeIds contracts preserved (5+ round trips → 1). Every consumer benefits: display tree, coverage, coefficients, relationships, breeding.
- `loadDescendants`: same single-query treatment; the CTE's LIMIT bounds the walk (both engines stop the recursion at the limit), and the parent→child edge rule reproduces the old loader's exactly (both ends loaded AND the parent was expanded: discovery depth < safeDepth).

### Hot handlers collapsed to single batches
- `getHorse` (profile + people + aliases), `horseLifecycle`, `horseOwnership`, `horseCompetitionHistory`, `horseGenetics`, `horseBreedings`, `listHorseMedia`: every existence-check-then-query pattern is now one ordered batch — one round trip each (was 2).

### Edge cache: every hot anonymous public GET (R131 whitelist expanded)
- Added: `/api/horses` browse (60s; query-string variants cache independently), `/api/horses/:id/{pedigree,lifecycle,ownership,competitions,attestations}` (120s), `/api/horses/:id/{media,genetics,breedings}` (60s), `/api/horses/:id/pedigree/{metrics,descendant-metrics,coefficients}` + `/insights` (120s), `/api/analytics/registry` (120s), `/api/registry/facets` (120s), `/api/search/meta` (120s), `/api/content/posts/:slug` articles (300s), `/api/directory/{persons,organizations}` (60s). Same fingerprint-free rule as R131 (no cookie/authorization header, GET, 200s only); stored copies now carry `Vary: Cookie` so a browser never reuses an anonymous copy after sign-in.

### Client: stale-while-revalidate + dedup + prefetch (the "switching feels instant" layer)
- New `src/frontend-kit/cachingTransport.ts`: successful GETs on public surfaces are held in an in-memory cache (fresh 30s serve-only, stale 5min serve+background-revalidate), identical concurrent GETs share one request, any successful mutation or session change clears the cache wholesale, errors are never cached, and session/staff/AI/market/workspace surfaces are never cached (prefix allowlist). 12 unit tests.
- **Hover/focus/pointerdown prefetch:** resting the pointer on any internal link (nav anchors) or any `data-href`-tagged navigable (browse rows, mobile registry cards, profile sire/dam lineage cards, person links, pedigree repeat-leaders, lineage trails) starts the destination's data immediately — the hover window finishes the request before the click. A route→URL map mirrors each page's initial fetches exactly.
- **Idle prefetch:** after first paint, the existing chunk-prefetch slot now also warms the newsroom list and the first browse page.

### Fonts: self-hosted, preloaded, same-origin (R132 first-paint win)
- `scripts/selfhost-fonts.mjs` downloads the css2 responses for the app's and Classic's exact family/weight requests (modern-Chrome UA), fetches all 76 unique woff2 subsets (2.2MB total, browsers only download the unicode-ranges they render), rewrites the CSS to `/fonts/*` and merges it into `public/fonts/fonts.css` (181 @font-face blocks, byte-equivalent declarations to Google's — families, unicode-ranges, font-display: swap unchanged).
- `index.html` + the Classic donor (`standalone-frontends/classic-v1.4/public/index.html`, embedded output regenerated) now preload the two critical Vazirmatn variable-font subsets (arabic + latin, weights 400-800) and load the local stylesheet — the third-party fonts.googleapis.com round trip is gone from the critical path. `_headers` pins `/fonts/*.woff2` immutable (1y) and `fonts.css` to 1h.

### Two live root-cause bugs found by the investigation and fixed (0.76.1)
- **Intermittent browse 500s (40-50% on uncached sort-by-name pages; present since the Persian collation round, surfaced harder by this round's traffic):**
  1. `assertReadOnlySql` flagged the `REPLACE()` STRING FUNCTION — nested ~80x in the Persian collation-key sort expression — as the mutating `REPLACE INTO` statement. Every sort-by-name browse query was classified as a WRITE batch, which has NO retry path. A REPLACE followed by an argument list is now allowed as a function; `REPLACE INTO` stays blocked. Pinned by `tests/unit/readOnlySqlClassifier.test.ts` (function-vs-statement + the full keyword battery).
  2. The R131 isolate-scoped postgres.js client pool shared SOCKETS across Workers requests, violating the runtime's I/O model ("Cannot perform I/O on behalf of a different request", captured via a temporarily instrumented live tail + reproduced at 52% in wrangler dev). The pool never actually warmed anything — every reuse failed and read-only work silently retried on a fresh client. Removed: one request-scoped client per request (max:1, idle_timeout:0); Hyperdrive itself owns the cross-request pool. Post-fix: live hammer 50/50 clean, zero errors.
- **PG portability of the pedigree CTEs:** (a) a JOIN ON may only reference relations joined to its LEFT — the side relation now CROSS JOINs before the parent join (live 500 "missing FROM-clause entry for table side" reproduced and fixed); (b) LIMIT inside a recursive CTE is not implemented on PostgreSQL — the descendants row budget moved to the OUTER select (worst-case walk measured on live data: ~2,100 pairs at depth 6, ~0.6s). Pinned by `tests/unit/pedigreeSqlPortability.test.ts`.

### Final live measurements (0.76.1, Worker 9ccc2fb3)
- Every hot surface's edge-cache HIT: **35-74ms** (previously: browse/pedigree/profile sub-resources were NEVER cached — 0.9-2.4s per request).
- Pedigree uncached: 2.1-2.4s → **~0.6s** (single recursive-CTE query).
- Pipelined batches verified against the live PG: 11 statements in one round trip with ordered results.
- Browser-verified: browse renders 100 rows, full profile + pedigree tree renders, fonts self-hosted, zero console errors.
- 50/50 previously-failing uncached browse-by-name requests: all 200.

### Gates
- vitest **1860/0** (1836 prior + 12 cachingTransport + 5 readOnlySqlClassifier + 5 pedigreeSqlPortability + version pins), python 268/268, typechecks x4 clean, production build + dist asset validation green, classic embedded regenerated + verified, validators (syntax/frontends/content/css/navigation/heritage-boundary/equidata/design-systems) green.

# R131 — News cards un-compressed, profile tree nav, directory toolbar, matches two-layer scroll, performance pass — 2026-10-24

## 0.74.0 (R131, 2026-10-24)

### Build-breaking corruption fixed (turn-30 follow-up)
- The turn-30 rebase had left two corrupted JSX array literals in `src/web/main.tsx` (`{.birth_city,…]` / `{.keeping_city,…]` — missing `[h.`), which made the 0.73.0 tree UNCOMPILABLE and explains why 0.73.0 never reached production. Fixed; typecheck/build green.

### Profile section rail: real hierarchical TREE + the dead-nav bug (owner: "sub tabs of sub tabs not displayed in a proper hierarchical tree style" / "clicking the options does nothing")
- **Root cause of the dead clicks:** the CSS that hides the in-page rails at ≤820px keyed off `data-tab-hierarchy="docked"`, but the dock that replaces them only RENDERS when `navigationLayout!=="sidebar"` — in sidebar/both layouts a docked phone ended up with ZERO section navigation (the rail hidden, no dock mounted). The hide rules (mobile-dock + the second set in heritage.system.css) now key off a new `data-dock-active` attribute that `HeritageMobileDockProvider` sets exactly when the dock is mounted — hide-or-show and render-or-not share one source of truth. The dock-clearance paddings (`155px`/dock-stack) got the same gating so a docked-but-undocked phone no longer carries dead bottom padding.
- The rail is now a **tree**: sections are full-width rows; pedigree/record render their child views NESTED UNDER the parent (indented, connected by a branch line, tone-inherited), open only while the parent is active. One component serves the desktop sidebar portal and the in-flow tabs layout. Phone (≤820px) collapses to the 4-across tile grid with the open branch's views as a full-width horizontal chip strip.
- The position-based tone rules (`button:nth-of-type`) were replaced with `data-workspace` attribute selectors — the tree's buttons no longer share one parent, so nth-of-type would have miscolored every branch. Two extra tones assigned (competitions=sage, genetics=main).

### Newsroom feed cards: breathing room, nothing half-cropped (owner: "title cards too compressed, subtitles and photos half-assedly cropped and clipped")
- Cards rebuilt on a two-column anatomy (132px thumb + body column: kind chip → title → summary → meta) — the old row-spanning thumb + `grid-auto-rows` interaction collapsed in current Chrome (max-content contribution computed as ~0, every card squashed to 44px). The feed's `grid-auto-rows:min-content` is load-bearing and documented in-source.
- Thumb 3:2 at its natural ratio (132×88 desktop, 120×80 tablet), title/summary clamps relaxed to 3 lines at larger sizes (14.5px/12.5px), real padding. Phone ≤560px: full-width editorial card with a 16:9 top cover — photos keep their natural framing, no more square crops.
- Feed column widened (minmax(320px,.8fr)); measured live: card 179px tall, clamps 3/3, zero text clipping.

### Professionals directory toolbar (owner: "search and dropdown busted and glitched")
- Root cause: the page reused `.table-filter` — a search-input grid whose first column is a 30px ICON slot — so the `<select>` labels were squeezed into 30px and clipped ("همه دسته‌ها" showing as fragments). New `.directory-toolbar` with labeled fields (caption above control, 42px controls, custom chevron, RTL-aware), full-width fields on phones, explicit clear button.

### Matches page two-layer scroll (owner: "list of the matches should scroll separately from the results, like the news")
- Desktop ≥981px: the /competitions route gets the newsroom's height-bounded workspace chain — the event list and the results panel scroll INDEPENDENTLY (both `overflow-y:auto` inside a bounded split); picking another match never moves the results viewport. The no-detail state (`h-mod-comp-list`) is bounded the same way.
- Phone ≤980px: tapping a match swaps to the results surface (list hides), the sheet's close button returns to the calendar. `/competitions` now sets `data-page="events"` so the chain is route-scoped.

### Performance pass (owner: "load slow, change slow — is it the 10ms CPU limit?")
- Answer: NO — I/O latency, not CPU. Three real causes fixed:
  1. **Per-request Hyperdrive handshakes:** the postgres.js client was created and torn down per request (~0.6-1.5s connect+auth before the first row). Hyperdrive clients are now pooled at ISOLATE scope (`max:4`, 30s idle), deadline-tripped clients are dropped (never force-ended, sibling queries finish) and rebuilt lazily; non-Hyperdrive validation paths keep the request-scoped lifecycle. Measured API latency driver for the "everything is slow" feel.
  2. **Zero browser caching of hashed assets:** `cache-control: max-age=0` forced every visit to re-download ~2MB of JS+CSS. New `public/_headers` pins `/assets/*` to `public, max-age=31536000, immutable` (Vite content hashes guarantee freshness; index.html keeps no-cache).
  3. **No edge caching of hot public reads:** `platform/meta` measured 2.1-3.0s and `content/posts` 1.7-2.5s per view. A whitelisted colo-cache layer (caches.default) now serves anonymous GETs of `platform/meta` (30s), `content/posts` (60s), `content/comments` (20s), `competitions` (60s) and `horses/:id` (120s) — fingerprint-free requests only (no cookie/authorization), 200s only, mutations/SSE/AI never cached. `platform/meta`'s two independent lookups also parallelized.

### Qualification
- New R131 real-browser qualification (scripts/r131-round-qualification.mjs, local dist + live API route-forwarding): 22/22 ALL GREEN — tree structure/open/child-click, dock-active gate both ways, news card geometry + clamps + independent feed scroll, directory labeled fields + no clipping, matches independent scroll + phone surface swap + close-returns, zero horizontal overflow at 390px and 1440px on every touched route, zero page errors. Broad sweep: 10 routes × 2 widths, zero overflow, zero errors. VLM-reviewed screenshots (desktop newsroom/profile-tree/competitions, phone newsroom/profile-tree/directory).
- Gates: `npm run check` EXIT 0 (typechecks ×4, vitest 1836/0 +10 skip, python 268/268, all validators incl. mobile-ux/registry-mobile/design-systems/ui-42/presentation/visible-surfaces/syntax); production build + dist asset validation green.

# R130 — Modern sharp-radius retune + true full-bleed phone surfaces — 2026-10-24

## 0.72.3 (R130, 2026-10-24)

### Modern sharp-radius retune (owner: "more modern, less round corners, especially on smaller buttons")
- One systematic remap of every literal `border-radius` in the active CSS surface (heritage core + EquiData/FEI/Classic skins + frontend-kit + the embedded classic build): 575 declarations across 33 files (scale: 20→12, 16→10, 14→9, 12→8, 11→7, 10→7, 9→6, 8→5, 7→5, 6→4, 5→4). The retro-astra donor transplant is untouched — it already ships its own deliberately sharp 3/5/7px scale.
- Token kernels retuned to the same scale: `--radius-*` and `--ds-radius-*` (app.css 22/16/11/8 → 13/10/7/5), `--h-radius-control/card/panel` (11/15/20 → 7/10/12), `--h-ds-radius-panel/workspace` (20/26 → 12/15), `--h-banner-radius` (15→10), `--enc-chip-radius` (7→5), EquiData `--edx-radius-control/card/panel` (8/14/18 → 5/9/11) + nav/form radii.
- **The pill collapse:** `--h-ds-radius-pill` 999px → 7px and every literal 999px/99px capsule → 7px. Border-radius self-clamping keeps every true circle a circle (an 8×8 dot with radius ≥4px renders round regardless), and 1px divider lines keep their caps — while nav buttons, chips, badges and CTAs become crisply rectangular-rounded. Small buttons read near-square: the modern look the owner asked for.
- Verified by pixel + VLM review on phone and desktop: corners "appropriately modern/sharp", no circle broke into a square (one automated candidate was a false positive — a 4×16 accent bar).

### True full-bleed phone surfaces (owner: "complete wide cards that span the entire screen, little-to-no margins")
- **Specificity bug found and fixed:** the R129 phone-rhythm token override used `:root[data-frontend="heritage"]` (0,2,0) which silently LOSES to the token kernel's `html:root[data-frontend="heritage"]` (0,2,1) — the 8px phone gutters never actually applied; pages still rendered the base 18px. All phone token overrides now use the matched `html:root` form.
- ≤720px the page rhythm goes to zero gutters: `--h-page-inline: 0`, `--h-page-top: 0`, bottom 10px, panel inset 12px (cards keep their own inner insets so content never touches the glass).
- Every page container audited and brought to full-bleed on phone: `.browse-page` (+ the three later `!important` overrides at app.css 662/970/1152), `.stats-page` (≤760px hard-coded 9px gutters removed), `.admin-page`/`.admin-page.wide`, `.home-page`, the sidebar-layout workspace gutter (`--h-nav-page-gutter: 0` ≤860px), and the browse sheet itself — the compact-density 12px `.table-panel` inset is overridden to 0 at phone so the registry cards run 5px from the glass (list padding 4px + 1px border), pager edge-to-edge.
- Other skins: EquiData `.edx-content` goes 100% width at ≤520px; FEI `.fc-main` at ≤560px. Retro Astra keeps its own qualified mobile design.
- Phone topbar sides tightened 9px → 6px (more room for the nav buttons; zero-jam contract preserved).
- Verified end-to-end at 390px on real data (local dist + live API via route forwarding): zero horizontal overflow on every checked surface (home, browse, newsroom, stats, horse profile, all four skins), cards measured 5px from the glass, VLM review confirms "cards run fully edge-to-edge… no visual jamming or content clipping".

### Gates
- Full vitest 1832/0, typecheck clean, production build + navigation/classic-embedded/asset validators green, CSS architecture + design-system + presentation + premium-presentation + mobile-ux + registry-mobile + frontends + ui-42 + language + visible-surfaces + budgets + inventories + syntax validators all green, python suite OK.

# R129 — Newsroom phone scroll + color-coded redesign + 10px readability floor — 2026-10-24

## 0.72.2 (R129, 2026-10-24)

### Newsroom phone scroll (the "can't scroll on phone" report) — one scroller, the document
- The R124/R126a app-style height chain (`100dvh` + `overflow:hidden` + two internal scroll layers) was desktop-only by media query but still fragile on phone-class devices (dvh/toolbar quirks, nested-touch-scroller behaviour differences between iOS Safari and Android Chrome).
- **New phone contract (≤980px):** exactly ONE scroller — the document. Every member of the height/overflow chain is force-reset (`app-shell`, `h102-workspace`, `h102-content`, feed, reader, reader-scroll → `overflow:visible`, auto heights), `touch-action: pan-y` + `-webkit-overflow-scrolling: touch` restore native momentum, and the floating dock's stack height + safe-area is reserved as bottom padding so the last card / source list is never buried (same contract as the R128 pager fix).
- Desktop (≥981px) keeps the verified two-layer workspace; `100vh` fallback precedes `100dvh`, internal scrollers gain `-webkit-overflow-scrolling: touch` + `scrollbar-gutter: stable`.
- Mobile reader: the topbar hides in reading mode, the back button is sticky under the chrome (blurred panel), reading paddings are compact (14px), and the whole article reaches the bottom on every device class.

### Newsroom redesign — tokenized, color-coded, visually encoded (PC + phone)
- **Editorial kind family** joins the encoding kernel as a fourth exclusive family (`--enc-kind-news` editorial blue / `--enc-kind-article` violet / `--enc-kind-update` amber in `heritage.tokens.css`). The reserved sex pair (`--sire`) is no longer borrowed anywhere in the newsroom (was: `kind-update` chip + grounded badge).
- Feed cards speak the R128 registry-card grammar: 3px kind-hued inline-start edge → identity (2-line clamped title) → encoded kind chip → summary clamp → tabular-numeral meta line; cover thumb or kind-tinted ◆ fallback tile; hover lift + kind-tinted selection ring. Fully RTL via logical properties.
- Kind tabs carry a colored dot per kind and tint with the same hue when active — one glance teaches the color grammar.
- Reader: kind gradient identity bar caps the article, body headings carry a kind-toned side border, links tint with the kind hue, Google-grounded badge moved to the positive/status family, and sources render as encoded wrap-safe chips.
- Empty/loading states get the kind dot; count chip speaks tabular numerals.

### Readability floor — one token answers "how small may text ever be?"
- `--h-font-floor: 10px` in app.css `:root`; the R129 pass wrapped every literal `font-size` below 10px in `max(var(--h-font-floor), Npx)` across app.css + all heritage.*.css (232 declarations; 110 in app.css alone) and baked 36 sub-floor `font:` shorthand sizes to the floor (shorthands cannot take `max()` safely on older iOS). Change one token to re-floor the whole app.
- Verified live: no visible newsroom text renders below 10px.

### Anti-jam / anti-clip pass (owner: "packed and compact but never cover each other")
- Newsroom topbar: title takes its own row from the actions on phones, actions wrap freely, every control ≥38px touch target; measured `scrollWidth == clientWidth` (zero horizontal overflow) with all CTAs present.
- Lineage/compare surfaces (app.css) moved from physical `border-left/padding-left/text-align:left` to logical `inline-start` properties — sire/dam cards and compare boxes flip correctly in FA/AR and lay out properly in EN/FR.

### LTR name isolation in the explorer cards (owner: "names displayed as LTR in english and french")
- `localizedParentName` now reads native-first for FA **and** AR, Latin-first for EN/FR; when a parent record carries no name at all the UI shows the localized "Unknown" label instead of a bare numeric id (the id remains visible in the lineage-card meta and table contexts). Live-verified: Latin names inside the FA page compute `dir: ltr` + `unicode-bidi: isolate/plaintext` on every surface (table cells, phone-card lineage, lineage cards, result cards).

### True-phone rhythm (owner: "little to no margins and padding on phones")
- ≤720px: page gutters 12→8px, page top 8px, page bottom 14px, section gap 8px, panel inset 10px — one token block retunes every tab together.

### Gates + release
- `npm run check` EXIT 0 (typechecks ×4, vitest 1832/0 + 10 skip, python 268/268, all validators incl. registry-mobile + design-systems + ui-42 + presentation + visible-surfaces); production build + dist asset validation green.
- New 13-point offline newsroom qualification (API-mocked, phone 390×844 touch + desktop 1440×900): 13/13 — native document scroll, no internal scrollers, CDP touch drag, reader swap in flow, sticky back, whole-article reachability, kind encoding (edge/chip/dot), zero sub-floor text, capped desktop shell with bounded feed.
- 9/9 LIVE checks on iraho.ir production data (141 posts): touch drag scrolls, dock clearance (135px), reader to sources, back-to-feed, two-layer desktop intact, feed independently scrollable, font floor holds.
- Deployed via manual wrangler: Worker Version 89dd919c-84a8-4cee-bbda-d3e476f216a9; live health ok / 0.72.2 / 93,896 horses.

# Turn-27 — Frontend restored + sticky footers everywhere + Hyperdrive hang guard + search indexes — 2026-10-23

## 0.71.1 (turn-27 hardening on the turn-26 generation, 2026-10-23)

### The site-frontend outage (root cause + fix)
- **What the owner saw:** iraho.ir would not load — every frontend route returned a 404 with an empty body while `/api/*` kept working.
- **Root cause:** the turn-26 closeout (dcbf2ba) added `wrangler.deploy.jsonc` with `"assets": { "directory": "dist" }` — the PARENT of the client bundle. The 02:24 UTC deploy uploaded an asset root containing only `client/` and `horse_registry_nextgen/` subdirectories with no `index.html`, so the SPA fallback had nothing to serve (live evidence: `/client/` returned 200 while `/` 404'd). The generated deploy config (`dist/horse_registry_nextgen/wrangler.json`) pins the correct `../client`.
- **Fix:** rebuilt from main and redeployed through the proven redirect path; `wrangler.deploy.jsonc` corrected to `dist/client` with an incident note so the fallback config can never ship the wrong root again. Live verified: `/`, `/horse/1`, all five frontends + standalone pages 200, JS/CSS assets serving with correct content types.

### Sticky footers on every frontend (owner request: "footer should always be at bottom even if page empty")
- **Core (heritage):** the appearance system's compact-footer restyles (`heritage.system.css`, `app.css` v0.42.1/compact blocks) had overridden the load-bearing `margin-top:auto` with fixed `4/6/10/18/2px !important` gaps — on any short page (empty states, error pages, pre-data) the footer floated up. All six override sites now carry `margin-top:auto!important` (long pages still finish edge-to-edge: auto collapses to 0).
- **FEI (fei-classic):** the root `.fei-classic-ui` was never a flex column — `.fei-donor-footer{margin-top:auto}` and `.fei-content-shell{flex:1}` were dead rules (measured: the empty-search page left the footer 489px above the fold). Root is now `display:flex;flex-direction:column;min-height:100vh` with `>*{min-width:0}`; the donor footer pins to the bottom edge (mobile keeps its deliberate 66px clearance above the fixed bottom nav).
- **EquiData (equidata-elite):** replaced the fragile `.edx-page{min-height:calc(100vh - 138px)}` magic number (47px overshoot whenever the footer wrapped taller than assumed) with the root flex column + `.edx-footer{margin-top:auto}`; `.edx-page` drops the magic min-height.
- **Retro (retro-astra) and Classic (standalone + workspace)** were already correct (measured and verified: desk frame fills the viewport exactly; classic shell is a 100dvh flex column).
- **Live verification (playwright, 1440x900 + 390x844):** 17-page audit across all six surfaces — every footer sits at the viewport bottom (or at the document end on scrollable pages); VLM screenshot review confirms no gap below the FEI footer on the worst former floater.

### Hyperdrive half-open connection guard (src/db/supabaseCompat.ts)
- **Observed in production:** ~1 in 5-8 worker requests hung forever — a pooled Hyperdrive connection goes half-open (query written, no response ever arrives; wrangler tail shows the request stuck until the client cancels). Direct pooler connections stayed at ~200ms, so the database itself was healthy.
- **Fix:** every top-level D1-shaped operation now runs under a client-side deadline (8s statements / 20s batches — postgres.js 3.x has no per-query timeout). Read-only statements and batches recycle the client and retry (twice) on a fresh connection; writes and AI-reservation statements never retry — they fail fast with a typed `SupabaseQueryDeadlineError` instead of hanging (operation-receipt idempotency remains the write-safety net). The client is now re-creatable per database (`createClient`/`recycleClient`) and startup parameters set a server-side `statement_timeout: 30s` where honoured (direct/pooler validation paths).
- **Evidence:** full gates green on real PostgreSQL 18.4 (pg-parity 98/98 migrations, execution parity 42 steps 0 differences, AI-reservation barrier 5/5 incl. lost-connection recovery); live battery 30/30 requests OK (was ~80-85%), no request exceeds its deadline cascade.

### Search acceleration indexes recreated on live Supabase (lost in the turn-26 refresh)
- `horse_search_source` (93,421 rows, 75MB) had ONLY its primary key — the canonical FTS GIN index (`to_tsvector('simple', all_text)`), both trigram GIN indexes, the people trigram indexes, the functional `lower()` indexes and the horse_people covering index were all missing, so every search full-scanned the corpus computing tsvectors (search endpoint 6.5-21s; FTS query alone 2.4s+).
- All 8 missing indexes recreated with `CREATE INDEX CONCURRENTLY` (zero downtime; canonical DDL from `supabase/horse_db_public_read_schema_v1.sql`): the FTS query now uses a Bitmap Index Scan (EXPLAIN-verified, ~400ms warm incl. pooler round trip) and the search endpoint runs at 1.7-2.6s total (5-6 sequential round trips by design). Live index audit: all 20 canonical indexes present and valid.
- Durability: `scripts/turn27-recreate-search-indexes.mjs` is idempotent (skips existing, cleans up INVALID leftovers) and is the runbook if a future data refresh ever rebuilds the search source again.

### Housekeeping the gates caught (turn-26 leftovers)
- `PLATFORM_APPLICATION_VERSION` was 0.71.1 while package.json/package-lock stayed 0.71.0 — versions aligned at **0.71.1** (the platform-contract validator failed until they matched).
- `tests/unit/marketplaceCommands.test.ts` re-pinned to 0.71.1.

### Gates
- `npm run check` EXIT 0 (typechecks, full vitest 1825/0, python 268/268, all validators); production build + dist asset validation green; deployed via manual wrangler (Actions still billing-blocked): Worker Version 8e4dac2c on iraho.ir + workers.dev; live health ok / 0.71.1 / 93,421 horses / supabase_full.

# R125 — Arabic (العربية) product-wide + RTL parity across all five frontends — 2026-10-23

## 0.71.0 (R125, 2026-10-23) — the four engines speak Arabic; RTL is first-class everywhere

### Arabic becomes a native engine language (master AI R122-T04 core delivered)
- Engine locale contract: `EngineLocale = "en" | "fa" | "ar"` in the kit runtime; the host passes Arabic through to every engine (`engineUiLocale`) instead of squashing it to English — `document.documentElement` keeps `lang="ar" dir="rtl"` in every frontend; the "this design currently uses English" banner is now French-only.
- New shared seam `src/frontend-kit/domain/engineText.ts`: `kitText`/`kitEngineArabic` resolve Arabic through the engine's authored dictionary first, then the shared kit dictionary, then Core's uiCopy.ar.json — platform vocabulary stays consistent everywhere; unknown copy stays truthful English. `matchArabicTemplate` handles interpolated strings; `kitNumberTag`/`kitDigits` render Arabic-Indic digits (ar-u-nu-arab).
- Authored Arabic dictionaries (recovered from the interrupted R122 session, completed and repaired): fei-classic arabicCopy.json (1,056 entries incl. 19 newly-authored donor-header strings), equidata-elite arabicCopy.json, retro-astra arabicMessages.json + arabicInline.json, kit arabicKitCopy.json; Core uiCopy.ar.json extended to 1,310 entries (+FR mirrors).

### Typography and RTL
- Arabic webfonts wired into the Google Fonts set: IBM Plex Sans Arabic (UI) + Amiri (classical Naskh display).
- Core: `:root[data-locale="ar"]` font-var block in heritage.system.css mirrors the Farsi block (body/controls/display/data/numeric/mono stacks); app.css carries the ar-scoped typographic rules (registry table density, hero measure, letter-spacing zeroing) appended as one authoritative block; login-art + pedigree-card AR rules from the recovered session kept.
- FEI: donor base + modern layers carry ar-scoped rules (font stack, brand padding mirror, RTL form control alignment, heading line-heights) — repaired from the corrupted mid-edit splice into clean per-rule insertions.
- Classic standalone: `html[lang="ar"]` typography (IBM Plex Sans Arabic UI, Amiri display), fonts preloaded in its own index.html (incl. Noto Kufi/Naskh Arabic).

### Frontends
- Classic (embedded vanilla): three-locale contract in core.js (locale seed accepts "ar", language cycle EN -> FA -> AR -> EN, setLocale + RTL + Arabic-Indic digits), full `copy.ar` dictionary (259 keys), `L3(en, fa)` ternary funnel across every view (L3 resolves Arabic through the inline dictionary then falls back honestly), presentationState domain values localized; the R124 pedigree depth fixes (default 3, min 1, columns cap 4) were re-applied on top of the AR rewrite.
- Retro: three-locale Language contract; translate() resolves Arabic per message key; new retroText() for inline L() call sites (inline dictionary -> message dictionary -> Core); domain values (breeds, colors, statuses, countries, palettes) carry Arabic; PreferencesProvider treats ar as RTL with ar-u-nu-arab formatting.
- FEI: t() resolves Arabic through the engine dictionary + templates; donor Header nav labels resolve via the same funnel (navLabel); the locale link cycles en -> fa -> ar with the next-language label; the donor's literal `<subscript>` element normalized to the standard `<sub>` element.
- EquiData: edxText resolves Arabic (dictionary + templates); the RTL direction gate now asserts the three-locale form.
- Core heritage: sex/lifecycle/breed/color/party-role labels carry Arabic (+FR where the same helper serves them); horse names prefer the native (Arabic-script) name in ar like in fa; LayoutSwitcher title prefix and layout hints translate; demo-data notices translate.

### Migration 0098 portability repair (latent break found by the local gates)
- Migration 0098 (content_posts quadlingual) was authored with PostgreSQL's `ADD COLUMN IF NOT EXISTS` — accepted by D1's fork (and applied live there), but stock SQLite (node:sqlite + python sqlite3 — the entire local test/validator stack) cannot parse it: 563 vitest failures + 151 python errors on a fresh checkout of R124. Fixed at the root: the guard is dropped from the migration (portable across every provider; live ledgers unaffected — both recorded 0098 applied), with belt-and-suspenders dialect normalization kept in localSqlite.ts exec + tools/ensure_schema.py + the audit-regression fixture + regen-expected-schema; expected-schema probe regenerated (92 -> 98 migrations, 1,535 columns).

### Verification (all on the real demo stack, browser 143)
- Browser suites: 30/30 AR surface checks (five frontends: dir/lang/fonts/copy/no-page-errors + FA regression) + 17/17 deep checks (horse profile Arabic, FEI donor header Arabic nav + dictionary resolution + cycle link, embedded classic iframe full Arabic, EQ data surface, retro directory, zero English leakage in core nav/buttons) + 8/8 R124 regression guards (newsroom bounded scroll, both-mode nav, classic depth bounds, mobile AR: RTL + content reachable + no horizontal overflow + classic vanilla scrolls).
- Gates: npm run check EXIT 0 (vitest 1825, python 268/268, all validators incl. the updated equidata RTL gate and presentation parity engineUiLocale contract); build + dist green; classic embedded rebuilt 41/41.

# R124 — owner-directed live regression round + walkable windows (T05) — 2026-10-22

## 0.70.0 (R124, 2026-10-22) — live polish round: regressions recovered, navigation "both", paged windows

### The live regressions (owner-reported, each root-caused)
- FEI frontend: the R115 "data.fei.org donor header" (restored at 877fb82 after being lost in R102) was destroyed when the R117 package dropped its five CSS layer imports and R117-20 then deleted the orphaned files. RECOVERED from the R115 tree: Header.tsx (donor top-bar + ASP.NET-style hover menus + mobile bar/drawer, keyboard order repaired: anchors in the tab order, focus opens the submenu) + the four header CSS layers + their imports. Mobile-ux validator contract updated to the restored donor header.
- Classic Registry (standalone app): pedigree depth 0 regression — boundedDepth coerced a MISSING query param (Number(null)===0 passes Number.isInteger) so the default 3 NEVER applied. Fixed null-safe (missing/non-numeric falls back); ancestors default 3 with min 1; the depth input min is 1. Family-tree cards compacted (138-178px cards, 60px min-height, 10/12px gaps, 16px connector) and columns now follow the actual child count (capped 4) instead of a fixed 2-column split; embedded classic rebuilt + revalidated 41/41.
- Core appearance studio header: the stale R111 three-column grid (28px|1fr|44px, written for a DOM with a swatch) squeezed the title into a 28px sliver and parked the X mid-panel. One authoritative two-child rule across polish.css/appearance-studio.css (title full width, 44px close slot corner-anchored).
- Core header tool cluster: stray divider + 10px padding removed from .theme-controls; every control is 44x44 on a uniform 6px rhythm.
- Newsroom: the two-layer scroll architecture was never height-bounded (feed grew to full content height). The newsroom route now caps the shell to 100dvh and the content column becomes the bounded flex column — the feed sidebar and the article reader scroll INDEPENDENTLY and the page itself never scrolls.
- Compact rhythm (owner: "too much margins and paddings"): page tokens 16/34/22/14 -> 12/24/18/10, panel inset 16->12, reading column 1280->1440, data track 1540->1720, home 1440->1720; DEFAULT_HERITAGE_LAYOUT mirrors with the R38-style legacy-default migration for stored snapshots.

### Navigation: manual switch in plain sight + sidebar AND tabs together
- New "both" preference: the sidebar rail AND the top tab row render at the same time; the sidebar stays automatic by viewport (78rem x 30rem), the tab row never disappears.
- New LayoutSwitcherButton in the header tool cluster (popover with all four modes, live chrome glyph, four-locale labels incl. ar/fr). The buried Appearance Studio select gains the same option.
- useNavigationLayout exposes `chrome` (sidebar/tabs booleans); app-shell carries data-nav-both; both-mode header restores the three-column brand/nav/tools grid at every width.

### Walkable windows (master AI R122-T05 completion)
- competitionDetail: keyset paging on placement-rank,id (?results_cursor/?results_limit, page metadata + legacy window preserved); horseCompetitionHistory: keyset paging on event_date,id desc (?history_cursor/?history_limit); workspace tasks: the silent 300-row ceiling replaced by keyset paging with status filters and typed 400s.
- Contracts + client updated; Core UI consumes them (CompetitionsPage "Load the next results page"; WorkspacesPage full open-reminder list disclosure). 4 new integration tests on the real database (r124PagedWindows): every row exactly once, honest has_more/next_cursor, legacy shapes intact, typed 400s.

### Gates
- npm run check EXIT 0 (vitest 1835 incl. 4 new, python 268/268, validators — mobile-ux FEI contract updated to the reviewed donor header, typechecks x4+pure); build + dist green; classic embedded 41/41; r122 core-ui browser qualification re-run 26/26 ALL GREEN; live-browser audit: both-mode at 2560/1100, studio header measured (title 552px full width, X corner-anchored), newsroom two-layer scroll (shell 1080=viewport, reader scrolls independently), header cluster uniform 44x44/6px, classic depth 3 default, FEI donor header (top-bar + logo + menubar) verified on the demo stack.

# R120 — Master AI R119 remediation integrated + full-access qualification — 2026-10-22 (NOT deployed)

## 0.69.0 (R123, 2026-10-22) — Master AI R122 integration + merge-integrity release round (owner-directed deploy)

### Master AI R122 audit + Core remediation (merged)
- R122 audit findings recorded (review-r122/AUDIT.md): merge partial-commit (R122-A01), ancestor-collapse self-parent (R122-A02), missing revision/counter integration (R122-A03) — reproduced with production SQL slices
- Core frontend pass: scoped operations styling (marketplace/events/directory/workspaces/services), navigation restyle with viewport-bounded overflow menu, analytics sidebar hierarchy, appearance-owned navigation preference, bounded non-rotating ambient lighting, competition error/retry/pagination/focus
- Four-locale Core foundation: fa/en/ar/fr selector with native names, Arabic RTL, 1,303 FR/AR dictionary entries each (disclosed preview boundaries preserved)
- create/archive graph-guard extension: rejected parents are typed 409s with zero counter/revision inflation

### Merge/unmerge atomic invariant protocol (R122-T01, this session)
- migration 0097 merge_invariant_assertions: a REAL transaction-aborting invariant assertion (named CHECK constraint) — any failed final invariant rolls back the ENTIRE command on every provider
- exact moved-count and restored-state invariants; ancestry cycle guard (portable single-branch recursive CTE) makes ancestor-collapse impossible to commit
- canonical_revision + active_horse_count settle in the same transaction, exactly once per command
- typed conflicts: merge_graph_unsafe / merge_state_changed / merge_busy / unmerge_graph_unsafe / unmerge_state_changed / unmerge_busy; idempotent replay preserved

### Qualification (this session)
- full vitest 1821/0; python 268/268; npm run check EXIT 0; production build + dist assets green; classic embedded 41/41
- real PostgreSQL 18.4 two-connection barrier ALL GREEN 8/8 (scripts/r122-merge-unmerge-barrier.mjs): late reference, ancestor collapse, merge-vs-parent-edit, late FK insert, unmerge drift, create guard, archive guard, bounded lock wait
- Core UI real-browser qualification ALL GREEN 26/26 (scripts/r122-core-ui-qualification.mjs, original assets, synthetic demo)
- live containment re-verified read-only before deploy (demo payments disabled, fail-closed triple, RLS default-deny, Data API 401s)

### Live (owner-directed)
- migrations 0093-0097 live-applied (pre-migration backup recorded); 0.69.0 deployed via manual wrangler (Actions billing-blocked since 2026-10-18)


Master AI's R119 audit remediation pass (IMP-006/008/009/013/014/017/018/033/034/035/063) integrated byte-verified onto 5b8837f, plus the full-access follow-on execution their sandbox could not run.

- **Gates at this tree:** typechecks x4, full vitest 1813/0 (+11), python 263/263, r95 83/83, r108 129/129, r98 135/135, TZ x3, production build + dist with ORIGINAL assets, db:pg-parity 96/96, db:pg-execution-parity PASS.
- **New migrations 0093-0096** (0093 atomic reset claim + 0094 audit operation_id + 0095 grant provenance from the remediation; 0096 demo failure_reason CHECK widened by our gate round). Live NOT yet migrated (still 0092).
- **IMP-012 executed:** graph-wide advisory-lock serialization for pedigree mutations (direct edit, change-request apply, merge, unmerge) with real two-connection PostgreSQL 18.4 barrier evidence — the unlocked write-skew REPRODUCED, then blocked 22/22 (exactly-one-commit, no cycle, rollback release, bounded 5s wait -> 409 pedigree_edit_busy).
- **Real production bug fixed:** the parentage cycle guard's two-branch recursive CTE did not parse on PostgreSQL (latent on live since parentage edits existed — every live parentage edit would have errored); rewritten portable single-branch form, verified on both engines.
- **IMP-014 acceptance:** real-adapter failure injection 46/46 on local SQLite + the production PG adapter — any thrown statement inside the reset transaction rolls everything back; the token stays reusable.
- **Live containment (read-only + one flag):** production cannot resolve demo settlement (fail-closed triple incomplete — verified against effective Cloudflare settings); the stale live DEMO_PAYMENTS_ENABLED="1" aligned to the remediated "0"; entitlement inventory: demo=1 interval (finance review listed), no mixed histories; Supabase Data API: anonymous denied, all 15 private tables RLS default-deny (zero policies), protective rls_auto_enable event trigger confirmed.
- **IMP-063 qualified:** Retro mobile registry at 320/390/720/721 — visible + openable nonempty records with original assets (8 visible at mobile widths — the audit's exact 0->8 diagnostic), heritage's own scoped mobile design intact.

# 0.68.0 deployed LIVE — R117 full engineering round shipped — 2026-10-21

Production deploy #2 of the R117 round (supersedes the 2026-10-19 deployment): app **0.67.0 -> 0.68.0**, Worker Version `1479237c-31e6-4b10-88a6-2aa4cc479118`, live at iraho.ir + workers.dev. Owner-directed manual wrangler deploy (GitHub Actions billing-blocked since 2026-10-18 — owner action: Billing & plans). Approved SHA `fa0135b` (exact-revision variable armed). Full record: `DEPLOY-R117-RECORD.md`.

- **Shipped engineering (all previously qualified, all gate-green at their trees):** R117-29 three-layer sex classification (canonical kit classifier / recorded passthrough / structural pedigree node.side; facet-driven directory sex tabs); R117-19 reversible duplicate resolution (41-reference horse inventory + build gate, merge-preview, versioned merge/unmerge with manifest digests and per-entry value guards, migration 0092, three latent defects fixed); R117-20 CSS/route complexity reduction without behavior change (4 dead FEI CSS layers deleted, 155 provable duplicate declarations pruned, routes.ts 2,910 -> 2,000 lines verbatim extraction); R117-21 analytics schema 2.2.0 separate data-derived completeness measures (five measures, one explicit denominator, no blended score, all five skins); R117-15 buyer sent-inquiries inbox + migration 0089; R117-17 bilingual editorial workflow + migration 0090; turn-12 admin data lineage + migration 0091; R117-28 showcase rehearsal closed the last 30 PARITY rows (80/80).
- **Live schema: migrations 0089-0092 applied safely** (backup r96-live-supabase-bf10161391628b10 -> attested entrypoint/range application -> probe 1515/1515 columns 0 missing; D1 remote applied + verified). 0091 had already been applied by the data pipeline (skipped idempotently).
- **Gates at the deployed tree:** config assert + Hyperdrive freshness + typecheck 0 + vitest 1802/0 + review-native + python 263/263 + pg-parity 92/92 + pg-execution-parity 42/42 + build/dist green. Live bundle byte-identical to the approved build (index-DY8mK7JP.js md5 d122351e…).
- **Known follow-up:** the analytics `completeness` section goes live with the data pipeline's next snapshot refresh (current DB-side snapshot is the valid 2.1.0 built before the R117-21 merge). No engineering tickets remain open in R117; owner-gated external items unchanged (18-4, 22-27) plus the GitHub billing fix.


# R117-21 executed — separate, data-derived completeness measures — 2026-10-21

## R117-28 — showcase rehearsal (2026-10-21)

- Ten supervised full journeys on the named synthetic instance `r118-rehearsal` freeze the scenario-driven showcase rehearsal: record.read, record.claim, review.decide, organization.invite, nav.adaptive and sidebar.hierarchy — each across ALL FIVE skins — plus restart journey #1 (owner claim persists across a process kill/respawn), restart journey #2 (notification drain + reminder clock keep their honest scheduler-only scope), a restore journey (backup -> mutate -> restore -> exact rollback verified and served) and a connected buyer journey (inquire -> seller reply -> buyer close with CAS -> stale close 409).
- Combined 167/167 checks, 0 page errors, 0 OUTBOUND requests — every request stayed on the loopback origin; unknown data, refusals and conflicts stayed visible at every step.
- The last 30 PENDING_REAL_STACK PARITY_ACCEPTANCE rows are closed (80/80 qualified): evidence records the actual route, principal, initial data, server response and persisted API/SQLite effect per feature per skin.
- New tools: `tools/test-r117-28-story-matrix.mjs`, `tools/test-r117-28-nav-sidebar-matrix.mjs`, `tools/test-r117-28-restart-restore.mjs`, `tools/test-r117-28-connected-buyer.mjs`; evidence under `review-r117/evidence-local/rehearsal/` (README + reports + PARITY-ROWS.json + screenshots).
- Honest boundaries documented in the evidence README: the claims lifecycle has no withdraw endpoint by design (the withdraw leg runs the same record-workflow surface's correction draft -> submit -> withdraw; claim resubmission-after-decision is covered by the review seed), and the organization revoke leg is the membership revocation.
Master AI R117 handoff item R117-21 (parent D30), all four ticket actions. **NOT deployed** (engineering round; live 0.67.0 unchanged). No migrations; no endpoint, authorization or error-shape changes — the analytics payload gains one additive section and every skin renders it.

- **Producer (action 1-2):** `tools/build_analytics_snapshot.py` `_completeness_section` — analytics schema/algorithm **2.1.0 → 2.2.0**. FIVE separate measures — **identity, ancestry, evidence, media, activity** — each over the SAME explicit denominator (all non-deleted canonical horse records in this revision) with covered/total counts and coverage percent. Component breakdowns: identity (name, nativeName, sex, breed, color, birthPlace, birthYear, registration, microchip, passport, mainStrain, dnaRecord), ancestry (anyParent, bothParents, cycle-clean analytics-eligible), evidence (competitionResults, geneticTests, liveIdentifiers — status='live' only, superseded rows never count — activeAttestations — status='active' only), media (photo, document), activity (active, deceased, imported, sport, stallion, sportCard).
- **Honesty metadata (action 3):** section-level `snapshotTime` (== generatedAt), `denominatorDefinition`, `permissionScope` (public registry surface; private/owner-scoped/draft rows excluded from denominators) and an interpretation stating these are recorded-data coverage measures that **never assert verification, authenticity, or that the registry itself is complete**. No blended synthetic score exists anywhere — every measure keeps its own denominator and components. Stale/missing snapshots remain honestly labelled by the existing endpoint contract (409 `analytics_stale` / 503 `analytics_unavailable`), now pinned by test over the real worker.
- **All-skin render (action 4):** the SAME values with independent presentation — heritage stats quality section (new i18n EN/FA keys), EquiData Elite observatory DATA FIDELITY tab, FEI Classic analytics section, Retro Astra Insights report desk, vanilla Classic `analyticsView` (+ embedded rebuild, 41/41 files match). Mock client parity (`mockCompletenessSection`) keeps evidence/media honestly zero for mock data.
- **Tests:** python +2 (`tests/python/test_analytics_snapshot.py`: five measures with shared denominator, per-component expectations incl. superseded-identifier exclusion; empty database labelled 0/0 with definitions intact; same-timestamp rebuild → identical completeness section). Vitest `tests/unit/r117-21-completeness-parity.test.tsx` **6/6**: ONE fixture rendered through ALL FIVE skins asserting identical covered/total counts and snapshot time (the vanilla classic renderer executed against its real module with the app core substituted); a failed/stale analytics request stays a labelled error, never an empty registry. Integration `tests/integration/r117-21-completeness-api.test.ts` **3/3** over the real worker entrypoint: stale → 409, missing → 503, built payload passes `completeness` through unmodified.
- **Gates (all green at HEAD):** typechecks x4, FULL vitest **1802 passed / 0 failed** (+9 from R117-20), python 263/263 (+2), all validators (navigation, classic embedded, frontends, presentation, visible-surfaces, language, premium x2, admin-records, inventories, equidata, design-systems, syntax, platform, content, mobile-ux, launcher, frontend-assets source+dist, heritage-boundary, css, ui-42, stage2, budgets, merge-inventory), `npm run build` + dist asset validation green.

Remaining R117 engineering: **R117-28** (release rehearsal; prerequisites 13-21 all done). Owner/external-blocked items unchanged: R117-18 action 4 (policy expansion), R117-22 (measurement environment), R117-23 (dataset authorization), R117-24 (original assets), R117-25 (hosted target), R117-26 (Iranian Persian reviewer), R117-27 (real devices/browsers/AT).


# R117-20 executed — CSS/route complexity reduced without behavior change — 2026-10-21

Master AI R117 handoff item R117-20 (parents D33/D37/D44), all four ticket actions. **NOT deployed** (engineering round; live 0.67.0 unchanged). No migrations; endpoints, authorization order and error shapes byte-identical.

- **Action 1 — baselines:** `tools/test-r117-nav-matrix.mjs` on the pre-change tree at the fresh synthetic instance `data/demo/r117-20-css.sqlite`: **114/114, 0 page errors** (evidence `review-r117/evidence-local/r117-20/baseline-nav-matrix/`); the route baseline is the operational-inventory validator (dispatch-text derivation), green before and after.
- **Action 2 — owner map:** new `tools/fei-css-layer-map.mjs` + stable doc **`docs/FEI_CSS_LAYER_MAP.md`** + JSON evidence: per-layer selector/token inventories (live vs unreachable against rendered classes from the fei components + frontend-kit), the cross-layer overlap list in cascade order **with the winning layer per property**, and !important accounting. Post-cleanup: 953 overlapping properties across 349 selectors remain (684 decided by !important — the donor-exact vs modern cascade war), each listed with its winner as the normalization backlog. A provably-dead-rule scan (`tools/fei-css-dead-rules.mjs`; oracle = built dist JS/HTML + the header dev-harness fragments; substring match keeps composed class names alive) found **zero** whole-rule-dead selectors in the active layers — the inactive FILES were the real dead weight.
- **Action 3 — inactive layers + token normalization:** deleted the four layers never imported by `entry.tsx` (no app import, no CI-wired tooling reference): `fei-classic-header-reference.css` (631 lines), `fei-classic-header-pro.css` (535), `fei-classic-header-polish.css` (437), `fei-donor-header-exact.css` (144) — **1,747 lines / 355 rules**. The standalone header dev-harness (`tools/dev-harness/build.mjs`; not wired into any npm script or CI) now links only the layers the live app loads; its R63 fragments are marked historical. Stale cascade-contract comments repaired (`fei-classic-modern.css`). `tools/fei-css-dedupe.mjs` then removed **155 identical earlier declarations** (77 rules; 10 rules emptied and dropped) under a provable safety proof: identical selector text (same specificity), identical value INCLUDING the !important flag, and a later identical copy verified for EVERY selector fragment of the source rule (a group rule `label, .x` keeps serving `label` when the later copy targets `.x` alone). Two en-route tool defects caught by their own verification and fixed before landing: dangling `;` separators after span removal, and whole-rule removal that could merge two rules by dropping a rule without its selector. !important de-escalation beyond the provable slice is DELIBERATELY not done — the fei tree renders inline styles (`recordModules.tsx`), so a stylesheet !important can be load-bearing against them.
- **Action 4 — cohesive route extraction:** `src/api/routes.ts` **2,910 → 2,000 lines**. Three modules extracted VERBATIM (`scripts/extract-route-families.mjs`, span-cut, no rewrites): `src/api/modules/claims.ts` (243 lines: create/my/admin claims, horse-actions endpoint, grants admin/revoke, claim schemas + decision SQL), `src/api/modules/changeRequests.ts` (651: create/submit/withdraw/edit/review + load/normalize helpers + CR schemas + decision CAS SQL), `src/api/modules/registryShared.ts` (118: `assertNoLiveHorseDuplicates`, `assertValidParentAssignment`, `settleWorkflowMutation`, `settleCanonicalHorseMutation`, `audit`, `parseJsonObject/Array` — shared by both families and the remaining inline handlers; no import cycles). **Every dispatch line stays in routes.ts** in the same order with the same middleware; the operational-inventory validator (deriveRoutes) and every dispatch-pinning source-contract test remain untouched and green. The wiring locks that pin the MOVED code were re-pointed to the new module files with byte-identical assertions (no safeguard weakened): `tests/unit/horseAccess.test.ts` (2), `tests/unit/registrySubmissions.test.ts` (5), `tests/python/test_audit_regressions.py` (2 blocks), `tests/python/test_p02_revoke_audit_sql.py` (2 anchors), and `tools/validate-free-tier-budgets.mjs` (the `CHANGE_REQUEST_ITEMS_MAX` schema bound now read from the module).
- **Gates (all green at HEAD):** full `npm run check` exit 0 — all validators (281 routes + 135 structures; budgets; inventories; merge-inventory), typechecks x4 + pedigree reference, FULL vitest **1793 passed / 0 failed**, python 261/261, classic embedded 41/41; `npm run build` + dist asset validation green; nav matrix re-run after the CSS work AND on the final tree: **114/114, 0 page errors** both times; FEI fixtures nav-layout 100 cases/400 assertions and fei-layout 30/30.
- **Evidence:** `review-r117/evidence-local/r117-20/` (baseline/after/final matrices, `fei-css-layer-map.json`, `dead-rules-report.json`) + `docs/FEI_CSS_LAYER_MAP.md`.

Remaining R117 engineering: **R117-21** (data-derived completeness measures, D30) > **R117-28** (release rehearsal; prerequisites 13-20 now all done). Owner/external-blocked items unchanged: R117-18 action 4 (policy expansion), R117-22 (measurement environment), R117-23 (dataset authorization), R117-24 (original assets), R117-25 (hosted target), R117-26 (Iranian Persian reviewer), R117-27 (real devices/browsers/AT).


# R117-16 closed — the truthful credential demonstration stories qualified across all five skins — 2026-10-20

The **credential demonstration stories** (Master AI R117 handoff D24) are implemented end-to-end and qualified on the real stack: `tools/test-r117-16-credential-matrix.mjs` **54/54 checks, 0 page errors** on the fresh synthetic instance `r118-agent`, browser 143.0.7499.4, plus `tests/integration/r117-16-credential-stories.test.ts` **10/10 on the real migrated database**. App version unchanged (**0.67.0** — engineering round; NOT deployed). No migrations; the contract surface is consciously extended (client methods only).

- **Fictional seeding:** `seed_fictional_issuers` — a genetics LABORATORY (scope: `genetic_test`) and a breed FEDERATION (scope: `horse_identity`), both with `attest`+`supersede` actions, narrow approved scopes, and recorded registration evidence; demo-staff is the lab attester and demo-owner-a the lab owner (two principals); validity anchored in the past like every other demo grant. No attestation is ever pre-seeded — every credential is a genuine command transcript.
- **No new endpoints** (the T05/T06 + R98-N04/N05 trust surface was located through the route registry first): this round adds contracts (`CredentialStoryRow`, `CredentialVerificationResponse`, issue/revoke/supersede/snapshot types), the client `verify`/`issue`/`revoke`/`supersede`/`reviewSnapshot` methods with honest 501 mock boundaries, and the kit `credentialStories` controller (public read + verify projections, member-scoped issue, owner-scoped revoke/supersede, private snapshot review) exported through the supported surface.
- **All five skins** render the native credential story on the ONE shared controller: heritage (claims-pane panel rewritten onto the kit: rows + Verify + issue form + owner actions + private snapshot review), equidata-elite and fei-classic (credential sections on the horse RECORDS tabs), retro-astra (new `CredentialDesk` at `#/collections/credentials`), classic-registry (new native `CredentialDesk` host route `/f/classic-registry/credential-desk` + the `credential-desk` nav item regenerated into BOTH classic trees).
- **Acceptance pinned:** no demo badge implies real federation, ownership or laboratory approval (the disclosure renders in every skin, EN + FA); revocation/expiry changes the VISIBLE current status while the recorded snapshot digest stays byte-identical (verified before/after revoke, supersede AND a real elapsed expiry); unauthorized evidence stays private (attester/stranger snapshot review 403 in the UI and at the API; public rows are metadata-only with `scope_redacted`; the public verification never carries statement/field_scope/canonical bytes).
- **PARITY_ACCEPTANCE.csv:** all five `trust.credential` rows closed (`QUALIFIED_REAL_STACK_2026-10-20`); 35 of 80 rows now qualified.
- **Gates re-run at this tree:** full typecheck 0, vitest **1737/0** (+10 new tests; contract inventory fixture consciously updated), review validators green (syntax 418/0, frontends, navigation, classic-embedded 41, language), build + dist green, python 261 OK.


# R117-15 closed — the scoped buyer inquiry inbox and market journeys qualified across all five skins — 2026-10-20

The buyer-owned **sent-inquiry inbox** (Master AI R117 handoff D19) is implemented end-to-end and qualified on the real stack: `tools/test-r117-15-market-matrix.mjs` **117/117 checks, 0 page errors** (20 per skin × 5 + 15 shared boundary probes + 2 Persian) on the fresh synthetic instance `r118-agent`, browser 143.0.7499.4, plus `tests/integration/r117-15-buyer-inbox.test.ts` **13/13 on the real migrated database**. App version unchanged (**0.67.0** — engineering round; NOT deployed). Contract unchanged (**2.25.0**). One additive migration: **0089**.

- **Backend:** `GET /api/market/inquiries/sent` (`sentInquiries`) — a bounded, paginated, **buyer-scoped** query (`WHERE i.buyer_user_id = the caller`; limit 1–100 default 50, offset, honest total), deliberately SEPARATE from the seller's `myListings` so no inquiry/contact data crosses principals and the seller query surface is never broadened to populate the buyer screen. Each row carries the listing's CURRENT status honestly (sold/withdrawn/expired say so), the horse names via `LEFT JOIN ... AND h.deleted_at IS NULL` (an unreadable horse keeps the buyer's own row with the names absent, never fabricated), `reply_count`/`last_reply_at`, and NO seller contact fields. Out-of-range pagination parameters are refused 400, never silently clamped.
- **Contracts + kit:** `MarketSentInquiryRow`/`MarketSentInquiriesResponse`, the client `sentInquiries()`, an honest empty mock, and `useSentInquiries` (principal-scoped identity key; honest loading/empty/forbidden/unavailable/error + retry states) exported through the supported kit surface.
- **All five skins** render the signed-in market lifecycle on shared domain state: the seller's own listings with versioned transitions, the received-inquiry inbox with conversation/reply, the **buyer's own sent inquiries with close-own**, and the watchlist with unwatch — heritage (reference section extended), equidata-elite, fei-classic, retro-astra (their market pages), and classic-registry (a new native `MarketDesk` host route `/f/classic-registry/market-desk` + the `market-desk` nav item, regenerated through the navigation authority into both classic trees).
- **Real defect found and fixed by the new lost-response tests:** migration **0089** widens the `command_receipts` CHECK with `inquiry.reply` and `inquiry.buyer_close` — R98-N12 wrote those receipt commands into the handlers but never added them to the migration 0038 vocabulary, so any API caller sending an `Idempotency-Key` with a reply or a buyer close had been failing on every real database since R98-N12 (the UI paths never attach keys to those commands, which is why the gap stayed hidden). The table is rebuilt in place with identical columns; every existing row is copied verbatim.
- **PARITY_ACCEPTANCE.csv:** all fifteen market rows (`market.read`, `market.seller`, `market.buyer` × 5 skins) closed with `QUALIFIED_REAL_STACK_2026-10-20`. Inquiry SENDING is native per skin where a composer exists (heritage sheet, equidata-elite detail, fei-classic detail, classic vanilla detail); retro-astra's market desk is browse-only, so its inquiry is created through the platform API — recorded honestly in the evidence.
- **Gates re-run at this tree:** full typecheck 0, vitest **1727/0** (162 files + 1 skipped; +13 new tests), review validators green (syntax 416/0, frontends, navigation, classic-embedded 41 generated files, language), build + dist asset validation green, python 261 OK.


# R117-14 fully closed — the per-skin versioned task assignment qualified across all five skins — 2026-10-20

The last open item of the R117-14 workspace parity rows — the **versioned ASSIGN/UNASSIGN action per skin** (R114-05 had covered it on retro-astra only) — is now qualified on the real stack: `tools/test-r117-14-assign-matrix.mjs` **75/75 checks, 0 page errors** (14 per skin × 5 + 3 shared + 2 Persian) on the fresh synthetic instance `r118-agent`, browser 143.0.7499.4. App version unchanged (**0.67.0** — engineering round; NOT deployed). No migrations; contract unchanged (**2.25.0**). No product code changes were required this round: the reassign surface already existed end-to-end with the full mutation discipline (`reassignWorkspaceTask` over `reassignTaskStatements` — row lock + mutation-time `tasks_manage` predicate + CAS `row_version` + marker-gated `workspace.task_reassigned` audit + mutation-time assignee view-authority guard); this round produced its five-skin journey qualification and closed the PARITY rows.

- **Per skin (heritage team tab + the four React desks):** the assign editor renders the open rows with their live versions (`title · due · v{N}`); a real UI assign to the delegated staff member returns **200** with the audit-recorded success notice and is verified **PERSISTED after a full reload** — assignee and advanced `row_version` both on the wire (`GET /api/workspaces/:id/tasks`) and in the re-rendered form (option text `v{N+1}`).
- **The deterministic stale-version story:** a second context reads the current version; a concurrent real-API unassign advances it; the second context's UI submit then loses with **409 `task_version_conflict` carrying `current_version`**, the honest failure notice renders, and the full reload recovers the concurrent state — the concurrent write wins and is verified persisted exactly as it left it (unassigned, advanced version).
- **Honest boundaries:** assigning to a principal without workspace access (`demo-owner-b`) is refused **403 `assignee_not_authorized`** with **zero state change** — probed with the LIVE version so the guarded UPDATE can only fail on the assignee-authority predicate, never on CAS; an unrelated owner's reassign on the real id is the existence-hiding **404** (read and write).
- **Seed discipline:** every skin's journey restores the seeded assignee (`demo-owner-a`) through the real UI write and verifies it persisted after another reload; the task `row_version` advances with every versioned write by design (CAS), so evidence versions reflect the journey order.
- **Persian copy (heritage, fa):** the assign editor renders the Persian labels (انتساب یا لغو انتساب یادآور (نسخه‌دار) / انتساب به (خالی = لغو انتساب)) and the open rows carry their live versions in the fa editor too.
- **PARITY_ACCEPTANCE.csv:** all five `workspace.task` rows closed (`QUALIFIED_REAL_STACK_2026-10-20`) with routes, principals and evidence paths — every workspace parity row of the R117 ledger is now qualified on the real stack.
- **Gates re-run at this tree:** full typecheck 0, vitest 1714/0, review validators green, build + dist green, python 261.

# R117-14 journey matrix complete — four remaining parity journeys qualified across all five skins — 2026-10-19

The four remaining promised journeys of R117-14 are now qualified per skin on the named synthetic loopback instance `r118-agent`: `tools/test-r117-14-parity-matrix.mjs` **191/191 checks, 0 page errors** (36 per skin × 5 + the Persian spot checks; browser 143.0.7499.4), plus `tools/test-r117-14-export-probe.mjs` **15/15** for the registry-safe CSV export. App version unchanged (**0.67.0** — engineering round; NOT deployed). No migrations; contract unchanged (**2.25.0**).

- **Two tabs, one document (all five skins):** tab 2 saves v1→v2 through the real UI; tab 1's stale save refuses **409**, the loser sees the honest conflict story with the current version, **the draft is retained in the form**, the notice's reload button refreshes the current version while **keeping the draft**, the retry at the current version succeeds, and the winner's note is **PERSISTED after a full reload**.
- **Duplicate import (all five skins):** the first submit is interrupted at the transport layer (Playwright `route.fetch()` delivers the request to the server, then the response is hidden from the page) — the form reports the honest **unknown outcome** and **keeps its rows and durable intent key**; the user's replay with the SAME key reconciles to **already_imported with ZERO duplicates** (each row exists exactly once after a full reload); a DIFFERENT import session meeting the same occurrence reports **occurrence_exists** (skipped, never overwritten); **>200 rows refused 400**. Classic-registry's native single-row import form is driven one row per submit — both presentations reconcile identically.
- **A-B-A session switch (all five skins, one context):** signing A→B→A leaks nothing across principals — B's page, live reads (existence-hiding 404) and deep links show no trace of A's workspace or reminders, bogus ids are plain 404s, and A's persisted effects are intact and **exactly-once** after the round trip. (A persona switch with a live session presents the current session's csrf token — the server's anti-fixation rule, exercised through the real login route.)
- **Revoked membership (all five skins):** the owner revokes through the native control mid-session; the member's live recheck is a **404**, the fresh desk no longer lists the workspace, and the deep link leaks nothing.
- **Persian spot check (heritage, fa):** the import receipts render the approved Persian copy (وارد شد / مورد موجود گزارش و رد شد — هرگز بازنویسی نشد) and the document-conflict story renders its Persian paragraph with the draft retained.
- **Invite → accept lifecycle per skin:** each skin's matrix run opens with the owner inviting `demo-staff` (view + tasks_manage) through the native form and the invitee accepting in their own inbox — the staff member's live actions are verified against the server before the journeys use that access.
- **Two real defects found and fixed en route:** (1) the classic-registry desk's `L()` helper shadowed its `fa` boolean prop with the Persian string parameter — `L(en, fa) => (fa ? fa : en)` evaluated the always-truthy string, so **every `L()` string rendered Persian regardless of locale** (English users saw Persian forms); fixed in all five components of `src/web/frontends/classic-registry/WorkspaceDesk.tsx` (parameter renamed, the boolean prop now drives the choice). (2) the fei-classic and equidata-elite document rows lacked the `data-surface="workspace-document-row"` marker the other skins carry; added for cross-skin consistency.
- **Gates re-run at this tree:** full typecheck exit 0; **vitest 1714/0** (161 files + 1 skipped — same count as the first vertical's baseline, no regressions from the two fixes); review validators (syntax/frontends/language) green; **build + dist asset validation green**.
- **PARITY_ACCEPTANCE.csv:** the `workspace.document` rows (read/save/version-conflict/export/import) and the `workspace.reminder` rows (create/close/reopen; date semantics) are **closed per skin** (`QUALIFIED_REAL_STACK_2026-10-19`) with routes, principals and evidence paths recorded; the `workspace.task` rows stay open **only** for the per-skin versioned assignment action (R114-05 covered assignment on retro-astra; create/complete/reopen now have five-skin persisted-effect evidence).
- **R117-14 remainder:** the per-skin versioned task assignment journey and the R117-15 buyer-inbox dependency stay open.

# R117-14 workspace parity — task REOPEN implemented, qualified on the real stack — 2026-10-19

First vertical of R117-14 complete: the **reopen** operation — the promised `workspace.task`/`workspace.reminder` action ("Create/assign/complete/**reopen**") that did not exist anywhere in the product — is now implemented end-to-end with the same mutation discipline as every workspace write. App version unchanged (**0.67.0** — not deployed; engineering round on the live tree's successor). No migrations; contract advanced surfaces only (`reopenTask` + `WorkspaceTaskReopenResponse`; the `tasks()` status filter widens to `"done"`).

- **Backend** `POST /api/workspaces/:id/tasks/:taskId/reopen`: `reopenTaskStatements` (collection row lock + mutation-time actor predicate + CAS `expected_version` + marker-gated `workspace.task_reopened` audit). One-shot completed reminders reopen with a version advance and cleared completion markers; **recurring closures refuse honestly** with 409 `recurring_occurrence_completed` (the next occurrence already exists — reopening would leave two live occurrences); a wrong version on a still-done row is 409 `stale_version` carrying `current_version`; post-reopen stale retries resolve to the truthful `not_completed`; insufficient-action callers keep the existence-hiding 404. The new integration tests caught one real bug before it could ship: the handler initially read `meta.changes` from batch index 0 (the lock statement) instead of index 1 (the guarded UPDATE), masking version mismatches as success — fixed and pinned by a regression test.
- **Shared kit**: `useWorkspaceDoneTasks` (principal+workspace-scoped completed list with honest forbidden/unavailable/error states), a `reopenTask` command slot, bilingual copy (EN/FA), and the contract inventory fixture consciously updated.
- **All five skins** (heritage, Elite, FEI, Retro, Classic): a Completed-reminders section (`data-surface="workspace-completed"`) with a versioned Reopen control on one-shot rows and the inline explanation (no control) on closed recurring occurrences; completing a reminder now refreshes the completed list in every skin (heritage via a retry-registration ref — its dashboard and completed panel are separate components).
- **Evidence**: `tests/integration/workspace-reopen.test.ts` **8/8** on the real migrated database (happy path, CAS, honest refusals, recurring spawn integrity, cross-workspace existence hiding, staff action scoping, mid-flight revocation with zero audit leakage, validation). `tools/test-r117-14-workspace-parity.mjs` on the synthetic instance `r118-agent`: **44/44, 0 page errors** — five-skin create/complete/reopen journeys with effects verified **persisted after full reload**, recurring explanation + exactly-one next occurrence, Persian copy, staff (`view,tasks_manage`) boundary, unrelated-owner isolation incl. deep link. Evidence: `review-r117/evidence-local/workspace-parity/`.
- **Gates re-run**: full typecheck exit 0; **vitest 1714/0**; review validators green (syntax 415 files, frontends, classic-embedded 41, navigation, language); build + dist green; python **261/261**.
- **R117-14 remains open**: the two-tabs-same-document, duplicate-import, A-B-A session-switch and revoked-membership journeys per skin still need the five-skin matrix treatment; `PARITY_ACCEPTANCE.csv` rows stay `PENDING_REAL_STACK` (reopen half now evidenced in notes).

# R117 deployed LIVE at 0.67.0 (owner-approved release) — 2026-10-19

The R117-qualified tree `b559628` is now live. The owner's 2026-10-19 direction ("bring the latest version online on Cloudflare") supplied the owner release approval the R117 handoff §8 was awaiting. No version/migration bump (presentation + shared-domain round; 88 migrations unchanged; contract stays **2.25.0**).

- **Release gates re-run at the deployed tree in the deploying sandbox** (fresh `npm ci`): production config assert (supabase_full, demo admin off); Hyperdrive freshness (query caching disabled); full typecheck exit 0; **vitest 1706/0**; **review-native 795/0**; **python 261/261**; build + dist asset validation green; D1 migrations idempotent no-op; exact-revision approval gate (`R95_PRODUCTION_RELEASE_APPROVED_SHA` armed at `b559628…` via the GitHub API) re-checked clean before and after build.
- **Deployed with local wrangler 4.151.0** (Actions still billing-blocked — R116 precedent; the armed approval variable makes a post-recovery Deploy Production dispatch idempotent at the same revision). Worker Version `9e5e9235-f300-4635-91cf-3c54bb12cac4`.
- **Live verification**: `iraho.ir` + workers.dev health report `0.67.0` / **78,089 horses** / `searchReady`; served bundle **byte-identical** to the approved build (`index-yWp3VNtH.js`, md5 `bca25590…`, 630,254 bytes); DOM spot-checks across all five skins passed — **Retro Astra sidebar is the default first-paint layout** (214×783px rail, 5 group tokens), FEI compact shell zero overflow at 1440/640/390, Elite zero overflow, Classic donor iframe healthy (327 elements, nav-measure twin, sidebar control), core zero overflow; 0 uncaught page errors. Full record: `DEPLOY-R117-RECORD.md`.
- **Still open (per `review-r117/TODO.md`)**: R117-13 remainder, R117-14+ native parity tracks, release rehearsal — hosting this build does not complete their acceptance.

# R117 master-AI reviewed-source integrated + locally qualified (all gates green) — 2026-10-18

Integration round for the master AI's R117 package (based on our R116 export `a66d3cf`). App stays **0.67.0** — per the R117 handoff, no version/migration bump and no deploy until the owner approves a versioned release. No migrations (88 unchanged). Contract stays **2.25.0**.

- **Package integrity**: `DELIVERY_MANIFEST.json` baseline verified against our vault `R116_a66d3cf` export (sha256 `39a9b5b2…`); 2,479 files applied as a clean superset (2,339 identical hash-verified, 62 modified, 78 added, 0 deletions); `tools/verify-r117-delivery.py` 2,479/2,479 after apply.
- **Master AI content landed** (per their round message): compact FEI identity/action row + canonical navigation replacing the donor header; denser FEI forms/tables (4/2/1 columns, 44px coarse-pointer targets); adaptive top tabs with the ACTIVE destination inside the fitted budget (shared fitter, no append-after-fit); structured sidebars with group tokens/counts; shared `src/shared/marketplacePolicy.ts` consumed by backend + API validation + frontend domain; honest marketplace read errors (failure ≠ empty, retry controls, stale-response guard); shared horse-display labels preserving sex distinctions; Persian terminology corrections (the «شجره‌نامه» checker rule); Classic vanilla-JS fitter with nav-measure twin.
- **ONE post-delivery fix** (the full application typecheck the master AI could not run in their container): `tests/unit/r117MarketplaceReadErrors.test.tsx:11` used `document.body.append(container)` — `@cloudflare/workers-types` merges an HTMLRewriter `Element.append(content)` that shadows the DOM `ParentNode.append(...nodes)` at type level. Changed to `appendChild` (the convention used by every other test here); runtime unchanged, the 3 tests pass before and after.
- **All 15 handoff gates green in this environment** (`audit/r117/gates/`): nav-model `--check`; classic-embedded `--check` (41 generated files match the generator); typecheck frontend-kit + backend-core + FULL application (exit 0 after the one fix); **vitest 1706/0** (160 files; includes the 3 new marketplace read-error React tests + the 5,000-case policy suite the master AI could not execute); **review-native 795/0** (the 2 entrypoints that failed to load there now load); python **261/261**; nav-policy **20/0**; validate frontends/language/mobile-ux/css/frontend-assets:source (this repo carries the original assets, so the master AI's 16-path asset failure does not apply); **build + dist asset validation green**.
- **Real-app browser qualification — first slice of R117-13 + handoff §5**: `tools/test-r117-real-app.mjs` — **16/16, 0 page errors** on the named synthetic loopback instance `r117-agent` (fa + en): FEI compact-header contract (adaptive 12→4 at 640px, zero row/document overflow, hidden measure twin out of flow, More panel carries all 23 destinations, ACTIVE destination stays inside the fitted row, locale switch without route change, sidebar mode with 5 grouped counts); marketplace read-error honesty on the real server via route interception (failed list = loading failure + em-dash, never the empty state; retry recovers; failed detail explicit with retry+close; stale guard: OLD held request aborted late, NEW succeeded, final state stays the fresh result); heritage 320px zero overflow. R117 fixtures re-run locally: nav-layout 100 cases/400 assertions, fei-layout 30/30.
- **R116 harness re-run on the R117 tree: 11/15** — its 4 FEI expectations (dome centring, donor `#topMenu` fold, wide-5) are retired by the R117 FEI redesign and superseded by the new contract checks; the R116 tool is standalone, not CI-wired.
- **Findings recorded** (`review-r117/evidence-local/README.md`): `filter_too_long` (48-byte q cap → 400) surfaces through the same honest error path — a future slice may distinguish input-validation from transport failures; `registry-frontend` is a sticky shell preference (`main.tsx:271`) — cross-skin harnesses must pin it before heritage sections.
- **Remaining per the master AI's ledger**: R117-14+ (workspace/document parity, buyer inquiry API, credentials, editorial, privacy/import reversal), the rest of R117-13 (all-skin × all-width × zoom × keyboard/Escape/modified-click matrices, FEI form/table/profile/dialog screens), and the release rehearsal. This round does not deploy and does not claim release approval.

# R116 owner-directed frontend polish: adaptive tabs everywhere, Retro sidebar restored, FEI dome centred — 2026-10-18

Owner-directed presentation round (five-skin navigation parity). App **0.66.0 → 0.67.0**. No migrations (88 unchanged), no API changes. Contract stays **2.25.0**.

- **Adaptive primary tab rows in ALL five skins** (the R115 heritage pattern, now shared): the row measures itself live against the real available width and shows every canonical destination that fits — the count is no longer fixed. Overflow collapses into each skin's own "More" disclosure (which keeps the full searchable inventory); the active destination always stays on the bar; hidden/headless mounts keep every destination visible.
  - New shared kit hook `useFittingTabs` (extracted byte-for-byte from the R115 heritage implementation; heritage now consumes the kit copy through `useHeritageFittingTabs`).
  - **EquiData Elite**: the fixed trio is gone; the compact 40rem row is measured directly; grid row → flex row; "Sections" toggle relabels to "More" with an overflow count badge.
  - **Retro Astra**: the wooden tab bar fits as many destinations as the desk width allows (was Home/Horses/People + More); overflow groups land in the existing drawer.
  - **Classic Registry** (standalone donor app, vanilla JS): the same fitter algorithm implemented in `app.js` with a hidden `.nav-measure` twin; re-measures on resize, host-iframe container changes (ResizeObserver) and late webfont swaps; embedded copy rebuilt from the donor source.
  - **FEI Classic**: the donor ASP.NET menu keeps its exact five tabs on wide screens; at narrower widths trailing donor tabs fold into a final donor-styled "More" tab whose submenu lists the folded items and their children (bold group rows). The fixed 190px donor tab unit drives the measurement twin.
- **Retro Astra sidebar restored as the default layout** (`useNavigationLayout("retro-astra","sidebar")`): the desk's right-hand index rail is what first-time visitors see again; the stored Tabs preference still wins and the layout select still switches live.
- **FEI dome logo exactly centred in BOTH directions** (REAL DEFECT): the R67 absolute-centring pair in `fei-classic-modern.css` has an `[dir="rtl"]` variant whose (0,4,1) specificity out-ranked the R111 grid block's `transform:none!important` (0,3,1) — in Persian the grid-placed logo was still translated −50% (≈214px left of centre). The R116 selector raises the grid block to `[dir]` (0,4,1) and, being later in the cascade, wins in every direction; measured h1 offset **0px** in fa + en at 1440/1200/1000px.
- **Retro Astra parents column repaired** (the "incomplete" thing): the transplant's `.parent-row` (renamed donor `.table-parent`) never carried the donor rules — sire and dam rendered inline as one mashed string ("DEMO AtlasDEMO Luna"). Both selectors now share the contract; the sire/dam rows stack with their blue/terracotta keys.
- Gates at the final tree: typecheck clean; vitest **1703/0** (2 new adaptive-row contracts + the R112 Elite/FEI navigation contract updated to the reviewed R116 behaviour; 10 pre-existing skips); python **261/261**; `npm run check` FULL exit 0; build + dist asset validation green.
- Evidence: `tools/test-r116-nav-adaptive.mjs` — **15/15** browser checks on a fresh synthetic demo: heritage/elite/retro/classic tab counts shrink with width and never overflow; elite More panel carries all 22 destinations; retro defaults to the sidebar; retro parents stack (2 rows, flex); classic sidebar works from the header select (wide rail + narrow accordion); FEI dome centred (fa + en, offset 0); FEI folds to 3+More at 1000px with all folded children reachable; FEI keeps the exact 5 tabs at 1440px; zero page errors.
- Test-contract note: `tests/unit/r112EliteFeiNavigationEditors.test.tsx` moved to the R116 contract (Elite row = adaptive, toggle = "More"/"بیشتر"; FEI PrimaryNavigation keeps its trio). The FEI `PrimaryNavigation` component remains donor-era surface code (the live FEI header is the donor port) and is unchanged.

# R114-07 market story: two-principal lifecycle + StrictMode conversation fix — 2026-10-18

Master AI R113 handoff ticket R114-07 (D19, first product story). App **0.65.0 → 0.66.0**. No migrations (88 unchanged), no API changes — the R88-P03/R98-N12 backend already enforces every rule; this round completes the market lifecycle's native surface and fixes one real defect. Contract stays **2.25.0**.

- **Shared headless additions** (`marketplace.ts`): `useMyMarketplace` (principal-scoped own listings + received inquiries), `useWatchlist` (the buyer's saved list), and `useMarketplaceLifecycleCommands` (versioned setStatus / renew / setInquiryStatus / closeOwnInquiry command slots — a stale write is an honest 409 with the current version, never a blind replay).
- **Native heritage market panels**: the seller's listing rows (effective lifecycle status + row version + the lifecycle-map's allowed transitions + bounded 30-day renew), the seller's inquiry inbox (private conversation + reply + versioned inquiry status), the buyer's watchlist with unwatch, and the buyer's OWN conversation — mounted from the inquire receipt id, with reply and versioned close-own-inquiry (the buyer-side id travels with the listing view because no API lists a buyer's sent inquiries today; recorded as the honest API gap).
- **REAL DEFECT FIXED (R113 regression)**: `useInquiryConversation`'s loadKey guard defeated React StrictMode's double-invoked effects — the first effect run started the load and marked the key, the cleanup aborted the in-flight fetch, and the re-run early-returned on the stale key, leaving the panel in "loading" forever under the QA strict build. The cleanup now clears the key so every fresh effect run performs a real load; the 29 marketplace/route tests stay green.
- Gates at the final tree: typecheck clean; full `npm run check` exit 0 (including the Persian terminology gate — the new copy uses the approved تبادل پیام); python **261/261**; build + dist asset validation green.
- Evidence: `tools/test-r114-07-market.mjs` — **19/19** two-principal browser checks on a fresh synthetic demo: seller finds their own listing with its version; buyer watches + inquires (idempotent receipt); buyer reply; seller inbox + full-conversation read + reply; versioned inquiry contacted; buyer reads the seller's reply and closes their own inquiry (versioned; closed refuses new replies honestly); seller withdraws (versioned) with the honest withdrawn status; a stale status write refuses 409; the buyer's watchlist persists; zero uncaught page errors.
- **Remaining** (BACKLOG D19 stays partial): a buyer-side inquiries endpoint (no API lists a buyer's sent inquiries — an honest contract gap), the issuer/billing/newsroom stories (D24–26), and the four-skin ports of the seller panels.

# R114-06 native workspace documents + bounded import in all five frontends — 2026-10-18

Master AI R113 handoff ticket R114-06 (D23/D32–35). App **0.64.0 → 0.65.0**. No migrations (88 unchanged), no API changes — the R108-08/R108-13 backend already enforces every rule; this round completes its native surfaces in the four external skins. Contract stays **2.25.0**.

- **Shared headless additions** (`workspaceDesk.ts`): the documents snapshot (principal+workspace+view scoped — the includeArchived toggle re-keys the identity, a revoked member's read renders forbidden with no private row), honest document-command classification (409 document_version_conflict carries the CURRENT version for comparison; document_horse_immutable is the fixed-association rule; document_archived is read-only history), and the import intent-key discipline (ONE durable key per import session: an interrupted import replays to its exact accepted rows; a completed import mints a fresh key).
- **Native document sections in the four external desks** (Retro/FEI/Elite/Classic), each in its own layout over the same hooks: tracker list with row version + fixed horse association, versioned CAS edit whose 409 keeps the draft open and shows the honest reload-and-retry (the retry submits the retained draft against the fresh row version), archive to read-only history with the includeArchived toggle, the registry-safe formula-protected CSV export link, and the bounded no-overwrite reminder import (1–200 rows, per-row receipts: imported / already_imported / occurrence_exists / row_refused). Heritage Core remains the reference panel.
- Gates at the final tree: typecheck clean; vitest **1721/0** (31 new: 6 headless classification/intent + 5 document surface stories; 10 pre-existing skips); python **261/261**; `npm run check` FULL exit 0; build + dist asset validation green. Route/data inventories unchanged (274/133 — presentation only).
- Evidence: `tools/test-r114-06-documents.mjs` — **33/33** native browser checks on a fresh synthetic demo: native tracker creation; the TWO-ACCOUNT versioned edit (staff saves v1→v2; the owner's stale save refuses 409 with the current version and the draft retained in the form; reload-and-retry with the retained draft succeeds); honest archive/reload (read-only history; default view hides archived); the bounded import (first import accepts both rows; SAME-key replay reconciles to already_imported with zero duplicates; a DIFFERENT intent meeting an existing occurrence reports occurrence_exists and never overwrites; >200 rows refused); the registry-safe formula-protected CSV export (registry-safe herd fields, no private columns, no formula-injection prefixes); FEI/Elite/Classic panels render + no-overflow at 320/768; FA bilingual; zero uncaught page errors.
- **Remaining** (BACKLOG D23 stays partial): supported-content import/export round-trips beyond tracker metadata require an explicit versioned document-content contract (a filename-only round trip does not satisfy that criterion); broader two-tab browser matrices.

# R114-05 native stable workspaces in all five frontends — 2026-10-18

Master AI R113 handoff ticket R114-05 (D22/D32–35). App **0.63.0 → 0.64.0**. No migrations (88 unchanged), no API changes — the P14/R98-N05/R108-08/R108-13 backend already enforces every rule; this round completes its native surfaces in the four external skins. Contract stays **2.25.0**.

- **Shared headless module** (`src/frontend-kit/domain/workspaceDesk.ts`): principal-scoped mine lists (owned/staff/organization), a workspace+principal-scoped dashboard snapshot (late responses from a retired workspace or previous principal can never paint the selection; a 403 renders as an explicit forbidden state that masks every private row), task-bucket normalization (every open reminder exactly once; invalid dates stay visible as needing review), permission VISIBILITY derived from the server's live granted actions, invitee-inbox normalization (only unexpired rows actionable) and honest answer classification (410 expired / 409 invite_not_acceptable vs already_answered / 404 gone / unknown stays unknown) — typed against the exact contract DTOs, never widened.
- **Native desks in the four external skins**, each with its own layout and tokens over the same hooks: Retro Astra `#/workspaces` (+ `#/workspaces/<id>` deep links, route parser + titles wired), FEI Classic `/f/fei-classic/workspaces`, EquiData Elite `/f/equidata-elite/workspaces`, Classic Registry `/f/classic-registry/workspaces` (host layer, donor iframe boundary intact). Every desk carries: the working-set list with roles, honest create (free-tier limit reported as-is), the dashboard (reminders with versioned CAS completion + versioned assignment + recurrence display, working-set herd with add/remove, consent-first team with invite/revoke), the invitee's own cross-workspace inbox, and the stale-409 reload story. Heritage Core remains the reference page.
- **Canonical navigation** now declares the workspaces destination for every skin (previously Core-only); the classic donor navigation model was regenerated and the embedded classic output re-validated.
- Gates at the final tree: typecheck clean; vitest **1690/0** (30 new: 20 headless + 10 component surfaces; 10 pre-existing skips); python **261/261**; `npm run check` FULL exit 0; build + dist asset validation green. Route/data inventories unchanged (274/133 — presentation only).
- Evidence: `tools/test-r114-05-workspaces.mjs` — **39/39** native browser checks on a fresh synthetic demo: native desk render + 320/390/768/1024 no-overflow; honest free-tier 402 create refusal; seeded dashboard; native recurring reminder; native invite → invitee accept (real membership, live-recheck note); versioned assignment (CAS, row version advanced); versioned completion with exactly-one next occurrence; stale completion 409 vs already_closed distinction; staff native completion; unrelated account existence-hiding (404, no trace in their desk); revocation → live 404 recheck → masked desk; FEI/Elite/Classic native render + no-overflow; FA bilingual + reminder-draft survival across layout changes; zero uncaught page errors.
- **Remaining** (BACKLOG D22/D32–35 stay partial): calendar-view parity in the four new desks, task history/pagination, scheduler-repeat breadth, and the D23 document surfaces (R114-06 next).

# R114-13 initial bundle split (first slice) — 2026-10-18

Master AI R113 handoff ticket R114-13 (D40). App **0.62.0 → 0.63.0**. Presentation/build round only.

- **On-demand split of the initial heritage chunk** — AssistantPanel (39 kB chunk: markdown view, sound cues, entity links), AppearanceStudio (77 kB), HeritageAdminAiSettings, and the horse-page capability panels (attestations, competitions, genetics, media, breeding, claims) are now `React.lazy` with honest status fallbacks (`aria-busy`); lazy failures bubble to the existing `FrontendErrorBoundary` recovery path — navigation, drafts, authentication and the landing route (browse) are untouched and stay eager.
- **Measured**: main chunk **809 → 613 kB minified / 233.71 → 175.4 kB gzip**; the >500 kB warning remains honestly (the threshold is untouched — the remaining mass is the inline Browse/Horse/Person/Admin pages plus their shared pedigree helpers).
- **Live probe**: horse record workspace, assistant full page, admin dashboard and browse home all render with zero page errors and zero failed chunks; full `npm run check` exit 0.
- **Remaining** (recorded in BACKLOG D40): page-level extraction (shared-helper refactor) + cold/warm route transfer/parse/interaction measurement on the preview build — byte size alone is not runtime speed.

# R114-04 organization staff lifecycle in native editors — 2026-10-18

Master AI R113 handoff ticket R114-04 (D21). App **0.61.0 → 0.62.0**. No migrations (88 unchanged), no API changes — the R98-N07 backend already enforces every rule; this round completes its native surfaces. Contract stays **2.25.0**.

- **Shared headless module** (`src/frontend-kit/domain/organizationStaff.ts`): roster normalization (current/former/pending with revocation evidence), the invitee inbox (server `actionable` flag honored — pending AND unexpired only), honest answer classification (409 revoked / 410 expired / 404 gone / unknown stays unknown), scoped command slots per surface action, and `unanswerableInvitationReason` (expired vs revoked — honest for the pending-but-past state a mid-flight expiry leaves behind).
- **Native staff surfaces in ALL five skins** over the same hooks, each with its own components: heritage `OrganizationStaffPanel` (roster table with current/former markers and revocation reasons, invite form, per-row role change + revocation with reason, my-invitations inbox) plus Retro/FEI/Elite/Classic editor extensions. The roster identity combines organization + principal scope + viewer, so a membership revoked mid-session re-keys and the stale UI masks before paint; self-targeted role changes and self-revocation are blocked in the UI outright and re-enforced server-side on every request. The copy keeps user memberships distinct from person profiles and person-level officiating roles.
- **Real pre-existing defect fixed** (caught by the new no-overflow gate): the R115 tab-bar measurement twin (`.h112-primary-measure`, always fully rendered) expanded every heritage page's document scrollWidth to ~2.4x the viewport at 320–1024px. `.h112-primary-navigation` now clips the inline axis (`overflow-x: clip; overflow-y: visible`) — no scroll container, the More dropdown still drops unclipped, per-tab `offsetWidth` measurement unchanged.
- **Lockfile drift repaired**: package-lock root/workspace version fields were still **0.60.0** while the app shipped 0.61.0 (the platform-contract audit caught it; the R115 bump never regenerated the lockfile).
- Gates at the final tree: typecheck clean; vitest **1660/0** (20 new: 10 headless + 10 component; 10 pre-existing skips); python **261/261**; `npm run check` FULL exit 0; build + dist asset validation green. Route/data inventories unchanged (274/133 — presentation only).
- Evidence: `tools/test-r114-04-organizations.mjs` — **29/29** native browser checks on a fresh synthetic demo: invite 201 → invitee accept 200 (real membership) → current-staff roster → third-account 403 → role change 200 → revocation 200 → revoked-member roster 403 + profile write blocked 409 → revoked-invite answer 409 → expired-invite answer 410 → expired renders unanswerable → FA bilingual render + 320/390/768/1024 no-overflow sweeps.

# R115 owner-directed frontend polish: navigation, FEI donor restore, retro pedigree — 2026-10-18

Owner review round (sandbox rollback #11 recovered zero-loss from GitHub e7ad0d4). App **0.60.0 → 0.61.0**. No migrations, no API changes, contract stays **2.25.0**. Pure presentation/behaviour repairs across the five frontends, verified visually against a seeded local SQLite dev server (1600px/1100px viewports) plus the full gate suite.

- **Core tab bar rebuilt (owner: "more consistent, organized, ordered, nicer")** — the hard-coded trio (Home/Horses/Analytics + "Sections") is gone. The primary row now carries EVERY canonical destination in the shared group order (registry → research → business → governance → showcase) that fits the measured header width; a hidden twin measurement row keeps every label's intrinsic width observable, a ResizeObserver re-fits on viewport changes, and the active destination stays pinned on the bar even when it would overflow. Overflow collapses into a relabeled **"More"** disclosure (bilingual, with a hidden-count badge) that keeps the searchable grouped panel. Headless tests pin the new contract (all destinations render when the header cannot constrain the row).
- **Sidebar + More panel colour coding (owner: "color coded and indented… professional")** — each canonical group carries a stable hue (registry blue, research violet, business amber, governance emerald, showcase rose) applied through markers, per-group link rails, hover tints and active states in BOTH the sidebar rail and the More panel; group headings gained small-caps styling, dot markers and link counts; links are indented under their group with a tinted left rail.
- **Footer links professionalized (owner: "those 2 new tabs as text on the bottom are ugly")** — the plain "Capability demo" and "Business model" anchors were removed from ALL five skins' footers/status bars (Heritage, FEI donor footer, Retro status bar, Elite footer, Classic r88 strip). Both destinations moved into the shared navigation showcase group ("Synthetic capability demo" + new **"Pricing & business model"** external item) so every skin exposes them consistently in its More/sidebar panel; the standalone classic navigation model was regenerated from the shared source.
- **FEI donor header restored (owner: "it used to look exactly like the real original world FEI database")** — git archaeology pinned the loss to the R102 integration (five-frontend tabs/sidebar unification replaced the donor port). The exact data.fei.org donor header from the R64 port is back as the default: top bar with login/locale/layout controls, "FEI Database 2.289.2" extlink, dome logo, the ASP.NET-style hover menubar (Calendar/Results, Horses, Persons, National Federations, Rankings/Standings with disappearAfter=500ms semantics), mobile bar + drawer + bottom nav. The R102 layout preference survives: "sidebar" keeps the donor top bar and serves sections through the shared HierarchicalNavigation rail; the layout switcher lives in the donor top bar. The mobile-UX validator contract was updated to pin the donor structure.
- **Retro pedigree repaired (owner: "default depth 3 not 0, tree nicer and error free")** — three real defects fixed: (1) the default subject fell back to the raw first registry row (regularly a parentless root record), presenting the explorer as an empty tree — the seed now prefers the first record with recorded parents; (2) the stage size hook attached its ResizeObserver at mount only, but the stage renders after ancestry data arrives, freezing the measured size at 0x0 — fixed with a callback-ref attachment (the latent bug was previously masked by a 0.78 zoom floor that instead CLIPPED the deepest generations); (3) the default zoom now fits the stage (69% on the reference viewport) instead of the overflowing floor. Unrecorded ancestor slots were re-styled for readable contrast (hatched background, stronger dashed rail, no dimming).
- **FEI registry order aligned with core (owner: "database registry uses a different order than core")** — the FEI browse default changed from name-ascending to the canonical registry order (id ascending) matching Core, Elite, Retro and Classic.
- Gates at the final tree: typecheck clean; vitest **1640/0** (10 pre-existing skips); python **261/261**; `npm run check` FULL exit 0; build + dist asset validation green; navigation model + classic embedded assets regenerated drift-free.

# R114-03 staged-import operator review surface — 2026-10-17

Master AI R113 handoff ticket R114-03 (NEXT_BACKEND.md D31-A). App **0.59.0 → 0.60.0**, migration **0088** (additive — 88 total). Contract stays **2.25.0** (additive methods in the same batch).

- **Bounded read-only preview** — `GET /api/admin/imports/batches/:id/preview`: source/license header + per-row raw and normalized values side by side, the staged classification with its reason, the matched target (name/register when any) and the latest review decisions, with an explicit 500-row window. Preview never re-runs classification and never writes.
- **Blob-free review report** — `GET .../review-report`: batch counters, per-row classification/outcome and the full decision list. Raw source values are intentionally excluded from the export; the protected preview is the side-by-side surface.
- **The versioned row-review command** — `POST .../batches/:id/rows/:rowId/review`, the per-row adjudication API D31-A identified as missing. Decisions: `skip` (the row leaves the apply pool with a receipt; apply then completes the batch without it), `reclassify` (re-runs the dry-run classification against CURRENT canonical state; an unchanged result refuses honestly), and `target_override` (typed-identifier proof only — the target must hold the row's register in the source namespace or its microchip; a shared name is never evidence; merge remains the separately authorized reconciliation). One immutable receipt per caller operation key: an exact retry replays the stored response, a reused key with different content is a `409 idempotency_conflict`. The prior row state is preserved forever in `import_row_reviews`; authority is rechecked inside the guarded transition so a demoted reviewer writes nothing; completed/failed batches refuse reviews.
- Governance: route inventory 271 → **274**, data inventory 132 → **133** (drift-free), SQL bindings **777/0**, schema probe **88 migrations / 1492 columns**, 7 new real-handler tests (vitest **1640/0**), SDK methods `imports.adminBatchPreview/adminReviewReport/adminReviewRow` (offline mock refuses honestly).

# R114-02 versioned competition editing — 2026-10-17

Master AI R113 handoff ticket R114-02 (NEXT_BACKEND.md D18). App **0.58.0 → 0.59.0**, contract **2.24.0 → 2.25.0** (additive DTOs/methods), migration **0087** (additive only — 87 total). Follows the R114-01 fulfillment executor already deployed live at 0.58.0.

- **Versioned result editing** — `POST /api/admin/competitions/:id/results/:resultId/version` requires the exact `expected_version`; a stale version is a `409 version_conflict` that returns the CURRENT row for comparison (no automatic rebase; the losing editor keeps their draft). Authority is rechecked INSIDE the guarded mutation, so an editor demoted between preflight and commit writes nothing. The horse identity is immutable; class renames refuse natural-key collisions; an archived horse blocks the edit; merged content must keep every R113 placement/elimination invariant.
- **Versioned event editing** — `POST /api/admin/competitions/:id/version` with the same compare-and-set semantics; the merged event must still pass every R113 real-calendar/range invariant.
- **Versioned single-result create** — `POST /api/admin/competitions/:id/results/versioned` with a caller `operation_id`: one result, one immutable receipt (new `competition_command_receipts` table), one audit. An exact same-key retry replays the stored response; a reused key with different content is a `409 idempotency_conflict`; identical natural-key + content under a NEW key reports `created:false` with no second audit.
- **The legacy batch endpoint is now CREATE-ONLY** — the R113 unconditional natural-key upsert (which let a stale submission silently replace a newer placing) no longer overwrites: an identical replay is an idempotent 200 no-op, and a would-overwrite submission is a `409 result_conflict` carrying the current row id/version. Race-caused constraint failures are re-classified, never surfaced raw. The R113 replay test was updated to the new documented contract.
- **Bounded-history honesty** — competition detail now returns `results_window {limit:500,total,has_more}` and horse history returns `history_window {limit:200,total,has_more}` with the summary computed as a separate aggregate over the FULL history (previously the lifetime summary was computed from the bounded 200-row subset).
- Contracts/SDK: additive `CompetitionResultInput`/`CompetitionResultChange`/`CompetitionEventChange`/`CompetitionCommandReceipt`/command-response types; `competitions.adminCreateResult/adminUpdateResult/adminUpdateEvent` client methods (the offline mock refuses them honestly instead of fabricating receipts).
- Governance: route inventory 268 → **271 entries**, data inventory 131 → **132 structures** (drift-free audit), SQL bindings **758/0 problems**, expected-schema probe regenerated (**87 migrations / 1475 columns**), 18 new integration tests + updated R113 suite (29/29).

# R113 backend, privacy and native workflow completion pass — 2026-10-17

Continues R112/R111. App **0.58.0**, contract **2.24.0** and all **85 migrations** remain unchanged. The existing resolved `esbuild 0.28.2` is now a direct dev dependency for the generated Classic domain module; no resolved dependency version/integrity changed. No production deployment occurred.

- Added native service directory/composer/list/detail/lifecycle screens across all five frontends, backed by shared framework-neutral creation, authorization, status and privacy semantics.
- Repaired stale read/reconciliation ordering and privacy masking, exact-key recovery, account-scoped private state and unsent Core safety-draft retention.
- Completed selected native ownership/correction/reviewer forms with actual evidence, draft editing/submission/withdrawal, reasons, current permissions and truthful canonical effects.
- Made import staging atomic; guarded concurrent apply, current permissions/source/archive state, durable outcomes and audit/index writes. Corrected repeated structured search semantics and measured faster exact-ID/name/register queries without changing recorded results/scores.
- Rejected invalid competition dates/ranges and contradictory placement/elimination/withdrawal states. Repaired privacy-administration decision receipts, current-actor/hold races and policy history while keeping unexecuted redaction explicit.
- Preserved copied browse offsets across open/refresh/history; added readable localized directory language labels, functional Classic bare editor selection and reachable Retro/Classic management destinations.
- Fixed actual rendered heading, landmark, link-role, naming, contrast, scroll focus and responsive defects. Added stable local no-HMR audit mode and fictional service fixtures without fabricated receipts.
- Updated original criteria, precise next plan, progress, validation and source/archive manifests. See [review-r113/VALIDATION.md](review-r113/VALIDATION.md) for final results and remaining original-asset, native engineering, human/device and hosted qualification.

# R112 navigation and workflow polish — 2026-10-17

Continues the complete R111 implementation. App **0.58.0**, contract **2.24.0** and all **85 migrations** remain unchanged. No dependency change or production deployment occurred.

- Reduced crowded headers to three primary destinations with grouped Sections/More navigation; removed duplicated primary rails in sidebar mode across five frontends.
- Added a shared headless context host that preserves mounted controls, drafts, selection and focus through layout changes, with native tokenized styling for each skin.
- Reworked Core workspaces into Reminders, Horses, People and Documents, with actual herd links, separate calendar/list views, accessible section switching and preserved drafts.
- Added responsive native Core workbench forms, account and sign-out feedback, real claim target selection, entered evidence and honest request recovery.
- Completed Elite/FEI profile and organization form presentation, labels, route bindings and selected evidence tabs; consolidated Retro/Classic context navigation and Retro record composition.
- Repaired uncertain-write duplication, stale-principal completion and premature recovery acknowledgement; retained confirmed/rejected/uncertain states explicitly.
- Added mounted and real-browser regression coverage; retained initial failures and complete final evidence. Updated all current metadata, the 44-task TODO, journal and execution handoff.

See [review-r112/VALIDATION.md](review-r112/VALIDATION.md) for exact results and limitations. Broader native workflow parity, accessibility/settings/performance and release qualification remain in [TODO.md](TODO.md); the handoff distinguishes ordinary engineering from missing external inputs.

# R111 implementation — 2026-10-17

Continues the supplied R110 source and audit plan. App 0.58.0 / contract 2.24.0; migrations 0081–0085. Current source was changed locally; no production deployment occurred.

- Unified public media policy, explicit publication/withdrawal, exact private grants, image metadata handling and native controls in five interfaces.
- Added optimistic breeding correction receipts/CAS and explicit reviewed variant-evidence API/UI.
- Repaired deterministic demo IDs/dates, real local personas, checkout/outbox/callbacks, offline registry research and safe reset/read-only modes.
- Fixed responsive bilingual navigation, draft/focus and request-state issues; repaired FEI menu overlap, Retro deep links and persona-switching CSRF handling.
- Unified strict sponsored timestamp ordering and labels across SQLite/PostgreSQL; recorded actual adapter concurrency checks.
- Measured a separate generated 78,000-record API baseline and bounded a failing reference-sampling benchmark without claiming an incomplete experiment passed.
- Pinned the tested Node/npm runtime, reviewed dependency security repairs, fixed nested-source export omission, and replaced stale current metadata with R111 pointers.

See [review-r111/VALIDATION.md](review-r111/VALIDATION.md) for final counts and limits; [TODO.md](TODO.md) retains all 44 original task IDs. Original assets, real data, hosted/provider qualification, human review and explicit native-workflow engineering gaps remain.

## Historical changelog

# R98 — 2026-10-06 (N12+N16 marketplace trust + workspace collaboration complete at 0.57.0)

## R109 — 2026-10-15 (execution batch 1; review branch, NOT production)

- Master AI R109 remediation candidate integrated onto b13c849 (paid AI fails closed on unverified reservations; PostgreSQL advisory-lock admission; credential-cache scoping; per-attempt editorial governance; strict DeepSeek completion/accounting; SSE boundaries; intent recovery hardening; per-document command isolation; exporter/config repairs; aggregate data-coverage profiler; 106 focused tests).
- Integration repairs: 3 typecheck defects fixed without weakening fail-closed checks; dbWithKeys accounting double repaired; 2 R108 test contracts moved to the reviewed R109 wording.
- R109-20 real defect: paid-reservation admission on D1 could all-refuse under a concurrent burst (bare INSERT + post-hoc aggregate); the daily ceiling is now evaluated inside the conditional reservation INSERT (same atomic pattern as the Gemini path) — certified on real remote D1 (exactly the ceiling admitted) and re-certified on PostgreSQL 17.6 with the advisory lock.
- R109-33 real defects: two ungoverned generation network paths (diagnostics generate probe — which also silently never ran on default deployments — and the admin key connectivity test) now admit through the canonical ledger before any network attempt.
- Gates at main: npm run check exit 0; vitest 1300 pass / 0 fail; native review suites 793 pass; python 251/251; build + assets green. Production unchanged at the reviewed R106 deployment.


## R98-N12+N16 (2026-10-06) — trusted sale operations and stable collaboration

Two more R98 tickets close with real-database evidence. Versions move
0.56.0 -> 0.57.0; the platform contract moves 2.22.0 -> 2.23.0 (ten new
typed market client methods). Migrations 0078 and 0079 are additive-only.

**N12 — trusted horse sale and inquiry operations (migration 0078).**
The listing/inquiry infrastructure becomes a complete seller/buyer
experience with current authority and clear limitations:

- **The private reply thread** (`sales_inquiry_replies`): the opening
  inquiry message plus participant-authored replies. Reads are
  participant-only for the conversation's WHOLE life — including after the
  listing expires, is withdrawn or is sold — and staff can read only while
  triaging a moderation case that targets THAT inquiry (with the buyer's
  contact string removed from the staff view). New replies require the
  inquiry to still be open; a closed conversation keeps its history.
- **Buyer-side closure**: the buyer of record closes their own inquiry
  (versioned, guarded); the seller closes through the existing
  manage_inquiries-granted command.
- **The buyer watchlist** (`buyer_watchlist`): saved listings, bounded
  (<=25), idempotent, private research data — watching is never a
  reservation and conveys no claim.
- **Neutral participant blocks** (`marketplace_participant_blocks`):
  either side stops NEW inquiries between two accounts in BOTH directions;
  the refusal the other side receives never mentions that a block exists
  (the same honest-refusal rule as the service-request provider block);
  the blocked side's management view can never discover the block; the
  predicate lives INSIDE the inquiry INSERT so a racing block still fails
  closed; existing conversations are never touched.
- **The optional immutable dossier link** (`sales_listings.dossier_id`):
  the seller attaches an ACTIVE dossier THEY created for the SAME horse,
  under a mandate that is CURRENT inside the write itself. Another
  account's dossier, a different horse's dossier and an expired mandate all
  refuse honestly. The dossier stays a separate revocable resource — the
  listing never contains a copy, and a revoked dossier is reported as
  revoked.
- **Honest seller-mandate badge**: the public listing detail computes
  `seller_mandate_current` LIVE at read time — never a stored flag. An
  expired mandate is reported as expired (never verified ownership) and
  new inquiries are closed while it is expired.
- **Introduction-only disclosure** (EN+FA) on every listing detail and
  conversation surface: the platform introduces buyers to sellers; it does
  not escrow payments, inspect horses, verify veterinary condition or
  guarantee any transaction.
- **Moderation dispute isolation pinned**: reinstating ONE overturned
  case reinstates exactly THAT case's suspension; an independent active
  suspension from another case still hides the listing (proven by test
  with two suspensions).
- **The ONE headless marketplace controller**
  (`src/frontend-kit/domain/marketplace.ts`): the lifecycle map mirrors
  the server policy exactly (source-pinned), error states are distinct and
  actionable (409 version conflicts carry the current version; 410 mandate
  expiry is terminal and explained; the neutral 403 stays neutral), and
  ALL FIVE frontends bind it — Heritage's workbench, EquiData's market
  page, FEI Classic's market page, Retro Astra's market desk, and Classic
  Registry through the host layer — each in its own visual language.

**N16 — stable collaboration and calendar operations (migration 0079).**

- **The consent-first staff invitation lifecycle**
  (`workspace_staff_invites`): an invitation creates NOTHING until the
  invitee accepts. Acceptance re-checks the INVITER's current manage
  authority AND the staff capacity INSIDE the creating statement — a
  manager revoked between invite and accept inserts ZERO rows (409, honest
  cause). Fourteen-day expiry with the honest 410; no self-invitation; one
  open invitation per (workspace, invitee); revocation before acceptance.
- **Document organization** (`workspace_documents`): tracker rows for
  paper processes (bounded categories, optional operator-entered expiry
  that drives document_renewal reminders through date arithmetic only).
  No file bytes, no medical content. Versioned updates (stale = 409 with
  the current version), terminal archive, per-collection bound.
- **Audit-visible reassignment**: the actor's tasks_manage authority AND
  the new assignee's live view access are both re-checked inside the
  UPDATE; a marker-gated audit row records exactly the executed change.
- **No-overwrite task import**: deterministic occurrence keys; an existing
  occurrence is SKIPPED and REPORTED (reason `occurrence_exists`) — never
  replaced, never duplicated.
- **Staff departure is immediate for queued notifications too**: revoking
  staff suppresses their QUEUED workspace-task notifications at revoke
  time (`notification_outbox.status -> 'suppressed'`), in addition to the
  drain's existing live re-authorization.
- **The ONE shared calendar model**
  (`src/frontend-kit/domain/workspaceCalendar.ts`): an accessible
  calendar/list ALTERNATIVE with honest overdue states computed in each
  task's OWN timezone (never a single reference zone), wired into
  Heritage's workspace dashboard as a month-grid/list toggle.

**Evidence**: `tests/integration/r98-n12-marketplace-trust.test.ts` (11)
+ `tests/integration/r98-n16-workspace-collaboration.test.ts` (10) on the
real migrated database; `tests/unit/marketplaceController.test.ts` (17)
with the policy mirror, the disclosure mirror and five-frontend source
pins; python replay +1 (block-in-write, 22 total); full check green —
vitest 1192/0, tsc clean, python 216/216, inventories 262 routes / 128
structures drift-free, syntax 336 files, budgets green, build green.

**14 of 30 R98 tasks done.** Next: N13 (licensed data ingestion and
stewardship) and N17 (shared semantics refactor), then the frontend
journey ladder N18-N22 and the operations ladder N25-N28; the P0s N26 and
N29 close the sequence. Live charges remain disabled; real merchant and
provider accounts stay owner-gated.

---

# R98 — 2026-10-06 (N10+N11 demo showcase complete at 0.56.0)

## R98-N10+N11 (2026-10-06) — the demo showcase batch: free honest placeholders for the two owner-account-blocked P0 journeys

The two remaining P0 tasks were blocked on OWNER-PROVIDED accounts (a
Zarinpal merchant account for payments; real email/SMS provider accounts for
notifications). Per the owner's explicit request, this batch unblocks the
DEMONSTRATION of both journeys with free placeholders that run the REAL
production code and weaken nothing:

- **Demo payment gateway (N10)** — `src/commerce/payments/demoGateway.ts`
  speaks the SAME provider contract as the Zarinpal adapter (issue authority
  -> hosted pay page -> server-side verify) but settles INSIDE the
  application database (migration 0077: `demo_payment_sessions`). Every
  attempt is stored `provider='demo'`; the real merchant ALWAYS wins
  resolution; without `DEMO_PAYMENTS_ENABLED` the honest 503 is unchanged;
  the terminal-release policy for real charges is untouched. The hosted pay
  page (`public/demo-pay/`, bilingual EN/FA, CSP-clean) imitates a provider
  checkout with two actions — simulate successful payment / simulate
  cancellation — and redirects to the server callback exactly like a real
  gateway (whose status parameter the callback deliberately ignores). Four
  API routes (`GET/POST /api/demo/payments/:authority`, admin demo inbox).
  The one bounded farm offer (30 days, 1,900,000 toman, explicitly labeled a
  demonstration hypothesis) is seeded by the idempotent OPERATOR action
  `scripts/seed-demo-catalog.mjs` — pricing stays an operator decision, not a
  migration. Evidence: `r98-n10-demo-payment-journey.test.ts` (14) on the
  real migrated DB — the full journey (order -> demo settle -> server-side
  verify -> org-held entitlement -> workspace work -> renewal extends exactly
  once -> expiry read-only -> renewal restores) plus every negative (unpaid,
  cancelled, forged authority, replayed completion, replayed verification,
  expired session, disabled gateway, amount mismatch).
- **Demo email provider (N11)** — `src/notifications/demoProvider.ts`
  satisfies the SAME `EmailProvider` contract as the real HTTP adapter
  (idempotency window, request fingerprint, lease discipline) and records —
  never transmits — accepted messages in the operator demo inbox (migration
  0077: `demo_deliveries`). Acceptance is still never delivery: settlement
  exists ONLY through the real HMAC-signed callback path
  (`recordDeliveryCallback`), driven by the operator's explicit simulate
  action. The operator inbox (`GET /api/admin/notifications/demo-deliveries`)
  pairs the provider-side record with the platform-side outbox state. SMS
  (login OTP) is deliberately NOT simulated: an operator-readable OTP inbox
  would be an account-takeover vector, so the SMS channel stays honestly
  unavailable until the owner supplies a real account. Evidence:
  `r98-n11-demo-notifications.test.ts` (15): enqueue -> drain accepted ->
  signed callback delivered -> replay never regresses -> not_delivered fails
  honestly -> no-provider configuration failure stays visible -> completed
  task suppresses -> admin inbox pairing + admin-only access + secret
  required.
- **Operational inventory hygiene (closeout debt)** — the N04-N09 batches
  added routes/tables without updating the machine-checked inventories;
  `docs/RUNTIME_ROUTE_BUDGET_INVENTORY.md` (204 -> 242 entries) and
  `docs/CANONICAL_DERIVED_DATA_INVENTORY.md` (106 -> 119 structures) are now
  drift-free again (`npm run validate:inventories` PASSED).
- **Showcase documentation** — `docs/DEMO-SHOWCASE.md`: what is real vs
  simulated, the two demo walkthroughs, a suggested 10-minute script and the
  honest boundaries to state out loud while presenting.
- LIVE deployment: preflight 0 blockers; backup r96-live-supabase-1b38f2f507882b5d
  (107 tables); migration 0077 applied+verified through the owner-gated range
  runner (4 statements, fingerprint 8c8bc9b7...ff61); expected-schema
  regenerated (77 migrations/1384 columns) — live probe 0 missing; demo
  catalog seeded on Supabase + D1 (farm_workspace_monthly v1, idempotent);
  PAYMENT_CALLBACK_BASE_URL + NOTIFICATION_CALLBACK_SECRET worker secrets set;
  Deploy Production dispatched on 7623bde for 0.56.0.
- Gates: `npm run check` FULL green (platform contract 0.56.0; inventories
  242 routes / 123 structures drift-free; vitest 1154/0; tsc clean;
  sql-bindings clean; syntax; python 215; frontends + assets; build).
- Production charges remain disabled. Real merchant/provider accounts and
  the real paid cohort (N28) remain owner-gated. 12 of 30 R98 tasks done.

# R98 — 2026-10-06 (N06+N07+N08+N09 complete at 0.54.0)

## R98-N08 (2026-10-06) — credential evidence and expiry workflows (P1, migration 0076)

Generic credential badges are replaced by evidence-specific, time-aware and
disputeable records. Migration 0076 adds `credential_renewal_submissions`
(holder-submitted renewal evidence with a `subject_key` integrity check) and
`credential_expiry_reminders` (deduplicated per credential per reminder
window). The ONE current-qualification predicate lives in
`src/directory/credentialWorkflows.ts`: only `within_recorded_dates` counts —
`dates_not_recorded`, `expired`, `revoked` and `invalid_dates` never satisfy
a current-qualification filter, so absence of dates is never evidence of
currency.

The platform evidence-review queue lists unverified person AND organization
credentials with honest periods, and the claimant's own evidence is excluded
from their own queue view (write-time guard, not UI hiding). Renewal: the
HOLDER submits evidence and proposed dates; a REVIEWER approves (new dates +
evidence pointer with a version bump and audit) or rejects (the OLD dates
stand — a refused renewal never silently extends anything); the submitter can
never review their own renewal; the decision vocabulary structurally admits
only approved|rejected (issuer_attested cannot be produced by a platform
reviewer through this path, and an approval never upgrades
verification_state). Reminders fire 30/7/1 days before a recorded expiry,
once per window, never for revoked or undated credentials, and never change
qualification. The honest badge states WHAT was checked, BY WHOM, against
WHICH evidence and AT WHAT TIME, reports the live period and any revocation,
and never invents an issuer.

APIs: `GET /api/admin/directory/credentials/queue`,
`POST /api/admin/directory/credentials/expiry-scan`,
`POST /api/admin/directory/credentials/renewals/:id/review`,
`GET /api/directory/credentials/expiring/mine`,
`GET /api/directory/credentials/:subject/:id/badge`,
`POST /api/directory/credentials/:subject/:id/renewal`.

Evidence: `tests/integration/r98-n08-credential-evidence.test.ts` (7) on the
real migrated DB. vitest 1125/0, tsc clean, sql-bindings clean, syntax 329.

## R98-N07 (2026-10-06) — organization and professional onboarding (P1, migration 0075)

Organizations are finished as first-class entities without collapsing the
person/account/organization separation. Migration 0075 gives
`organization_profiles` the same integrity columns as person profiles
(`row_version`, `last_operation_id`) plus the reviewed business fields
(specialties, service areas as approved province codes, accessibility notes,
structured opening hours), and adds three tables: `organization_staff_invites`
(bounded 14-day lifecycle with audit), `organization_official_appointments`
(judge/steward/ringmaster/disciplinary-committee as PERSON-level officiating
roles bound to a CURRENT same-role credential — `dates_not_recorded`,
`expired`, `revoked` and `invalid_dates` never qualify), and
`organization_credentials` (fail-closed review states, revocation semantics,
honest periods on the public card).

The ONE command layer (`src/organizations/onboarding.ts`) pins the ticket's
acceptance: the profile write mirrors the person profile exactly (first
creation submits without expected_version — the server's 428 gate is the
proof; explicit province-scheme confirmation; private contact and INITIAL
publication consent are current-staff-only, so an editorial curator can
curate content but never see or set the contact route and never publish an
unpublished organization); staff lifecycle forbids self-escalation (no
self-invitation, no self role-change, owner-role grants need a current
owner, the last owner seat can never be demoted or revoked away); revocation
is live-predicate (a former employee loses edit, inbox and the managed view
immediately); the lead inbox is scoped per organization (one person staffing
two businesses sees each inbox strictly separately); public cards expose
consented data only, fail closed on unconfirmed locations, and report
credential periods without ever assuming currency.

ONE headless `OrganizationEditorController` (frontend-kit/domain/
organizationEditor.ts) is shared by five independent visuals: Heritage
OrganizationWorkbench (`/organizations/manage/:id`, bilingual), Classic
Registry compact editor (host layer, iframe boundary intact), EquiData
monospace governance editor, FEI Classic formal register, and Retro Astra
CRT editor — each with distinct loading/denied/unavailable/empty/ready/
saving/saved/conflict states, field-level conflict diffs, and the explicit
re-consent gate for publication consent withdrawn elsewhere.

APIs: `GET /api/directory/organizations/:id` (public card),
`GET /api/organizations/:id/manage`, `PUT /api/organizations/:id/profile`,
`GET /api/organizations/:id/staff`, `GET /api/organizations/:id/inbox`,
`POST /api/organizations/:id/staff/invites`, `GET /api/organizations/invites/mine`,
`POST /api/organizations/invites/:id`, `POST /api/organizations/:id/staff/:userId/role`,
`POST /api/organizations/:id/staff/:userId/revoke`,
`POST /api/organizations/:id/officials`,
`POST /api/organizations/:id/credentials`,
`POST /api/admin/organizations/credentials/:id/review`.

Evidence: `tests/integration/r98-n07-organization-onboarding.test.ts` (13 —
all three acceptance criteria on the real migrated DB) +
`tests/unit/organizationEditor.test.ts` (16 — incl. the five-forms source
pin and the contract-inventory fixture update). vitest 1118/0, tsc clean,
sql-bindings clean, syntax 327, frontends+assets validations green.

## R98-N09 (2026-10-06) — operator-approved privacy/holds/retention (P0, migration 0074)

The retention sweep was a timer guessing a policy; it is now an OPERATOR
operation. `privacy_retention_policies` (migration 0074) carries versioned,
audited approvals per data category (`service_request_terminal`,
`audit_dispute_record`): one approved row per category (partial unique
index), re-approval retires the previous row without rewriting history, and
the inherited numeric default (365 days) is reported as an explicit
CONFIGURATION ASSUMPTION (`policy_source: "inherited_default"`) until an
operator approves an interval. The sweep reads the effective policy, splits
into bounded chunks (10 candidates x 4 statements per atomic `db.batch` —
per-record atomicity preserved, real adapter statement limits respected,
`chunks` reported), rechecks active holds at the actual mutation and reports
per-state monitoring: `held_deferred` (a hold won the race after selection —
the record stays intact and is retried later), `unavailable_evidence` (legacy
digests are NEVER fabricated — `retainedNoteEvidence` marks them
unavailable), `already_redacted`, `suppressed_notices`. Subject redaction
requests (`subject_redaction_requests`) interact honestly with holds: a
request against a request under an ACTIVE dispute/legal hold is recorded and
DEFERRED (`deferred_active_hold`, `hold_interaction: deferred_to_release`) —
never silently executed, never dropped — and stays visible in the operator
queue until decided; a GRANT never bypasses a hold (409 `grant_blocked_by_hold`;
the operator must release through the audited path first, whose release
receipt is unique per migration 0072 — replay produces no second success
audit). Already-redacted legacy rows lose prohibited contact/location data on
the normal schedule (`province_code`/`city` cleared, `share_contact` zeroed)
with the digest preserved or honestly marked unavailable. New APIs:
`GET/POST /api/admin/privacy/retention-policies` (admin-only, versioned
approval), `POST /api/privacy/redaction-requests` (data subjects; only their
own requests), `GET /api/admin/privacy/redaction-requests` (bounded queue
with active-hold flags + status counts), `POST
/api/admin/privacy/redaction-requests/:id/decide` (grant/refuse with recorded
reason; decided requests are not re-decidable). Evidence:
`tests/integration/r98-n09-privacy-operations.test.ts` (11) on the real
migrated DB through the real module surface — the hold race is proven by a
REAL interleave (the hold commits after candidate selection and before the
mutation batch; the compare-and-set fails and `held_deferred` reports it),
the interrupted-sweep resume (chunk 1 committed, adapter error on chunk 2,
resume completes 12/12 with exactly 12 audit events and digests equal to
SHA-256 of the original notes), and the full deferred-redaction journey
(file -> queue -> 409 grant blocked -> audited release -> granted).

## R98-N06 (2026-10-06) — the real person-profile edit and claim experience (P1)

The repaired directory commands are now a usable workflow, not API-only
functionality. `src/frontend-kit/domain/profileEditor.ts` is the ONE headless
`ProfileEditorController` + claim-flow state machine shared by all five
frontends: the actual stored `row_version` populates every update while
FIRST CREATION submits without `expected_version` (the server's 428 gate
remains the proof, never a client guess); every submission with a province
carries the explicit `province_code_scheme` confirmation; an editor without
private-contact permission (staff curating, or a representation revoked
server-side) never renders or submits the private contact field — it is
absent from the draft AND the submission; on 409/428 the controller fetches
the CURRENT profile, reports FIELD-LEVEL differences against the retained
local draft, and NEVER auto-resubmits a publication choice that was
withdrawn on the server (`reconsentRequired` blocks submission until the
representative explicitly re-consents; retries carry the CURRENT fetched
version, not the stale one that caused the conflict). Distinct honest
states: loading / denied / unavailable / empty (first creation) / ready /
saving / saved / conflict. The claim flow explains the difference between
ACCOUNT VERIFICATION, PERSON REPRESENTATION and PROFESSIONAL QUALIFICATION
(EN+FA shared copy), files claims with bounded evidence notes, surfaces
status and rejection reasons, and appeals are bounded: only the claimant's
own REJECTED claims, once. Five INDEPENDENT visual implementations bind the
same controller: Heritage `ProfileWorkbench` (`/directory/manage/:id` +
`/directory/claims`, bilingual), Classic Registry compact editor (host layer
— the donor-iframe boundary stays intact), EquiData Elite's monospace
governance table, FEI Classic's formal register, and Retro Astra's CRT
terminal. The directory vocabulary (service categories, provinces, the
current scheme) is now exposed through the frontend-kit root so external
frontends never import outside the boundary. Evidence:
`tests/unit/profileEditor.test.ts` (19) — including the five-forms source
pin (each frontend's editor imports the shared controller) and the full
conflict/reconsent journey.

## Live + gates (2026-10-06)

- 0.53.0 (N04+N05) deployed ALL GREEN (run 37376234965) after the GitHub
  Actions `degraded_performance` incident cleared; live health:
  `applicationVersion 0.53.0`, supabase_full, 78,089 horses.
- Pre-0074 backup: `r96-live-supabase-8eb9cda0b8465301`; preflight 0 blockers.
- Gates at the N06+N09 closeout: vitest 1089/0 (1099 incl. skipped), tsc
  clean, python 215/215, sql-bindings 636/0, syntax 319 files / 0
  diagnostics, validate-frontends (4 external) + production-frontend-assets
  (source + dist) green, build green.

# R98 — 2026-10-05 (N04+N05 issuer trust boundary complete at 0.53.0)

## R98-N04/N05 (2026-10-05) — structured issuer scopes + immutable server-derived evidence snapshots (migration 0073)

**N04 — issuer authority, scopes and review responsibilities (P0, was open):**
`issuer_scopes` + `issuer_scope_actions` make attestation rights ENFORCEABLE
structured claims: versioned approval (a new approval supersedes the previous
live version row without deleting it — `issuer_one_live_scope` partial unique
index keeps one approved-or-suspended scope per issuer+record-kind), effective
intervals validated at write time and re-evaluated by SQL at commit time, and
suspension/revocation that keep history visible. Scope approval is
platform-only (`content.manage`) and evidence-gated: `issuers` gained
`registration_evidence` + `registration_reviewed_at/by`; a federation title,
an editorial role, a paid plan or a foreign membership never delegates
authority (pinned: a REAL paid entitlement + a super-admin without membership
both refuse with `no_membership`/`issuer_scope_required` and zero rows).
Issuance now checks membership AND the currently approved scope inside the
same conditional INSERT (`ACTIVE_ISSUER_SCOPE_SQL`, TOCTOU-safe with the
fail-fast 403 `issuer_scope_required`); supersession additionally requires
the explicit `supersede` action. Issuer suspend/resume/retire commands
(content-managed, audited) take effect on commands AND the public
effective-status projection — `effectiveAttestationStatus` now names
`issuer_suspended`/`issuer_retired` instead of a generic inactive — and
supersession under suspension is an honest 403, never a silent conflict. New
private operator queue `GET /api/admin/trust/queue` (expiring
memberships/scopes within 30 days, malformed intervals, suspended
issuers/scopes, unevidenced legacy issuers — reason codes and non-private
identifiers only) and public trust labels `GET /api/trust/labels` (the four
verification levels EN+FA, "issuer metadata does not certify every field",
extracts-are-not-certificates). Normative documentation:
`docs/trust/ISSUER-AUTHORITY.md` (who may register, accepted evidence
classes, the separated attester/issuer-manager/platform-reviewer
responsibilities).

**N05 — attestations bound to immutable server-derived evidence snapshots
(P0, was open):** `attestation_snapshots` (migration 0073) freezes the
attested facts at issuance. The server reads the ACTUAL target and evidence
rows through per-record-kind column allowlists (private free-text excluded
everywhere — hashing private text is not anonymization), serializes them with
the deterministic `stableStringify` (engine JSON key order can never leak into
a frozen document), and writes attestation + snapshot in ONE consistency
boundary with the snapshot INSERT conditioned on the winning attestation row.
Per-column commit-time guards (`COALESCE(CAST(col AS TEXT),'')` equality on
every allowlisted column of the target and evidence rows, bound as text —
node:sqlite binds JS numbers as REAL, where `CAST(55.0 AS TEXT)`='55.0' would
break INTEGER equality) refuse the whole issuance when any observed source
value changed between read and commit: a REAL interleaving is proven with a
temp trigger on the parent-row lock statement mutating the target mid-batch —
409, zero attestations, zero snapshots, zero events. The stored
`source_version` is ALWAYS the server-derived `snap:<schema>:<digest16>`
marker; the caller-supplied field is accepted for compatibility and ignored.
Public verification `GET /api/attestations/:id/verify` distinguishes
`current` / `source_changed` (with changed/removed table attribution) /
`superseded` / `revoked` / `snapshot_tampered` (defense-in-depth digest of the
stored bytes) / `unbound_legacy` (pre-snapshot history — never backfilled
with fabricated hashes) / issuer and expiry states, and exposes ONLY the
content digest, per-row version markers and lifecycle state; the canonical
bytes, statement, field scope and evidence identity stay private. The full
snapshot is reviewable only by platform content managers and the issuer's
active owner (`GET /api/admin/attestations/:id/snapshot`; unrelated users
403). Changing the horse, evidence file or publication state after issuance
provably never rewrites the issued document: the stored bytes and digest are
byte-identical before/after the mutation while verification reports the
mismatch against the ORIGINAL digest.

**Tests + gates:** `tests/integration/r98-n04-issuer-scopes.test.ts` (6) and
`tests/integration/r98-n05-snapshots.test.ts` (5) — real migrated database,
real router, real sessions/CSRF, full acceptance matrices. Existing suites
re-pinned to the new contract WITHOUT weakening any safeguard: the N01
trust suite now grants registration evidence + structured scopes before
issuing (the master AI's r98-directory-trust included suite unchanged and
green). Two production bugs found and fixed during this work: a duplicated
`?` in the retyped issuance SELECT (would have rejected every issuance) and
the SQLite SET-clause self-assignment trap in scope resume
(`status=?,status=status` silently restores the original value — SQLite
evaluates right-hand sides against the pre-update row). vitest **1059/0**
(was 1048), tsc clean, python 215/215, sql-bindings 633 checked/0 problems,
syntax 312 files, build+dist+asset validation green. Version 0.52.0 →
**0.53.0**.

---

# R98 — 2026-10-05 (master AI reviewed-source 0.52.0 merged; P0 handoff N00–N03 complete; live 0070–0072 applied + deployed)

## R98 (2026-10-05) — reviewed source integrated; HTTP/negative-permission tests, real-PG directory/trust/retention concurrency and the live migration all green

**Integration (78cad09):** R98 package (949 files; 733 unchanged + 27 modified +
189 added vs the R97 export; migrations 0070–0072) applied onto 2241b49 after
verifying the repo HEAD matched the R97 export byte-for-byte (0 content diffs);
all 949 package paths hash-verified post-apply; zero upstream deletions
(lockfile/media/seeds/docs preserved). Master AI's fixed defects: profile-insert
binding arity (11 placeholders / 10 binds — the silent `published_at` corruption),
losing-review privilege grants, editorial consent-fabrication + private-contact
authority, issuer validity intervals, attestation lifecycle/privacy, lexical SQL
translation (sqlLex.ts), private-read snapshot routing (publicSnapshotPolicy.ts
allowlist), retention/hold races, the shared province catalog
(iso3166-2:ir:2020-11-24), and the exporter replaced
(scripts/export_pure_source_zip.py + REVIEW_HANDOFF.json — lockfile preserved,
actual hashes, no inherited completion claims). Five vitest files re-pinned to
the R98 contracts WITHOUT weakening any safeguard: serviceRequests province
scheme, directoryCredentials rewritten to real-DB assertions (recorder mocks
cannot prove conditional-INSERT semantics) + new 428/409/editor-boundary
coverage, provider-fail-closed R98 snapshot routing (supabase_only is a
snapshot-only mode; split-mode private reads use canonical D1),
databaseProviderSource allowlist scan, heritageDomainSurfaces
recorded_period_status states.

**N01 (a1827d6):** tests/integration/r98-n01-directory-trust-http.test.ts
(7 tests, real router + migrated DB) on top of the included 5-test R98 suite:
duplicate claim submission leaves exactly one pending row; editor (no
claim.review) grants nothing; deleted-person claims refused; staff cannot
impersonate issuers; revoked/expired memberships refuse issuance; supersession
privacy (public list omits statement/scope/source_version); hold lifecycle
(single, audited, double-release 409); consent withdrawal unpublishes
instantly; anonymous managed-profile 401.

**N02 (892040e):** scripts/pg-r98-concurrency.mjs — 9/9 scenarios on embedded
PostgreSQL 18.4 (production supabaseCompat adapter, 72 migrations through the
translator, 5/5 flaky runs stable; R97 harness re-run 7/7): competing claim
approvals, duplicate claim create (users parent-row lock), revocation-before-
issuance refused, issuance-vs-revocation race (issuer parent lock), competing
supersessions (attester refused manage authority), profile stale-version race,
hold-blocks-sweep (deterministic + true race), duplicate hold-release. The
initial D-scenario failure was the SAFEGUARD working: a plain attester cannot
supersede (owner/admin authority required).

**N03 (c354a47):** scripts/r98-n03-rehearse.py — two independent restorations
(deterministic modulo wall-clock defaults): synthetic R97-era target with all
11 runbook adjudication classes; read-only preflight reports the 0071
duplicate-blocker; 0071 REFUSES to apply before adjudication; 11 evidence-based
dispositions; blocker-free after; ledger-controlled apply (raw ALTER re-use
refused); initializer replay-safe; columns/defaults, unique index enforced,
receipts table, integrity+FK, evidence bytes preserved.

**Live (5e13888):** read-only live preflight 0 blockers (directory/trust tables
empty in production — the R97 bind bug never corrupted live data; 78,089
horses); backup r96-live-supabase-948af850a7dfd1a9 (107 tables, per-table
SHA256 manifest committed, raw dumps out of git); 0070–0072 applied through the
owner-gated range runner (16+5+2 statements, all signature objects verified);
schema probe regenerated (72 migrations, 1222 columns, 14 required unique
indexes incl. issuer_one_active_membership) and verified against live with 0
missing. Version 0.51.0 -> 0.52.0 (package.json, PLATFORM_APPLICATION_VERSION,
marketplace test pin, lockfile). Deploy Production dispatched on 5e13888.

**Next (per R98_AGENT_TASKS):** N04 issuer authority/scopes + N05 immutable
evidence snapshots are the remaining P0 trust-boundary tasks; N06+ frontend
journeys and the paid-workspace journey follow. The five frontend forms still
need the expected_version contract wired into their edit flows (server is
enforcing since R98; forms must read the managed profile and submit its
row_version).

# R97 — 2026-10-05 (master AI reviewed-source 0.51.0 merged; P0 handoff N00–N03 complete)

## R97 (2026-10-05) — reviewed source integrated; HTTP tests, PG concurrency and the legacy upgrade rehearsal all green

**Integration (5d0b3fb):** R97 package (869 files; 41 modified + 126 added;
migration 0069) applied onto R96 00e8dd2 after verifying all 701 unchanged
paths by SHA-256 (0 mismatches); upstream lockfile/media/seeds/docs preserved
per the runbook (no wholesale replacement). Four original vitest files re-pinned
to the R97 contracts (workspace authority mock, command_actor binds, malformed
idempotency-key RangeError, generic-endpoint retry refusal + verified-Resend
same-key retry). The master AI's unverified gates now verified: full tsc, full
Vitest (1022/0), production build, r88+r96 demo reproducibility.

**N01 (b439558):** tests/integration/r97-core-http.test.ts (14 tests, real
router + real database). Found and fixed a production bug latent since R84:
createChangeRequest's INSERT had 10 columns / 12 placeholders / 9 binds — the
change-request create endpoint failed on every real database.

**N02 (56d556d):** scripts/pg-r97-concurrency.mjs — 7/7 adapter race scenarios
on real PostgreSQL (stale-version, duplicate identifiers, revoked/future-dated
mandates, last-seat staff race, competing allocation approvals), 5/5 flaky
runs. Fixed 6 more production PG breaks (bare-parameter IS NULL -> CAST(? AS
TEXT) in refundAllocation/reconciliation/imports).

**N03 (a35a349):** scripts/r97-n03-rehearse.py — R96->R97 rehearsal with all
six legacy adjudication classes; read-only preflight stop-condition, 0069
additive upgrade with byte-preserved settled evidence, evidence-based
adjudication (re-propose/re-approve, identity recovery from the historical
marker, held unknown sends, append-only review re-opening), final preflight
clean, data-loss window recorded.

**Version:** 0.50.0 -> 0.51.0 (package.json, PLATFORM_APPLICATION_VERSION,
marketplace contract pin, lockfile). Live activation remains NOT approved.

# R95g — 2026-10-04 (R95-N14: moderation deduplication, participant lifecycle + standing)

## R96 (2026-10-05) — Master AI reviewed-source 0.50.0 merged; ALL CORE TICKETS N00–N10 COMPLETE

**Merge (b141171):** R96 package (885 files, 52 modified + 195 added, migrations
0062-0064) integrated by content onto 282d911; 637 unchanged paths hash-verified;
no historical migration touched. Integration fixes: workspaces.ts parseStaffActions
union fail-closed listing (F16); platform-contract validator accepts the centralized
PLATFORM_APPLICATION_VERSION markers; data inventory +2 structures (106);
lockfile resynced 0.50.0. R95-reviewed PACKAGE-INFO archived to audit/r96/.

**N01 (b141171):** 13 vitest failures triaged to the intended R96 behavior changes
and re-pinned (never broadened): F02 retention audit discipline, F04 dispatch-time
authority (fixtures now build the published/consented/mandated world; new
revoked-mandate suppression test), F05 immediate dead-letter of non-resendable
refusals, F07 immutable-grant-interval refund policy, F08 fresh-operation gate,
F11 inquiry-observation-only (documented code+status envelope; verified:false),
F12 terminal_payment_proof_required (not-paid release 501; retry returns the SAME
attempt — one payable attempt per order), F15 501 rejection vs 503 uncertain.

**N02+N03 (5cc03e1):** scripts/pg-r96-concurrency.mjs — 5/5 production-adapter
race scenarios on real PostgreSQL (embedded PG 18 locally; postgres:15 service in
CI): duplicate refund requests, concurrent confirmations, refund-vs-renewal,
cross-case standing, consent-withdrawal-vs-dispatch. scripts/r96-n03-rehearse.py —
R95->R96 SQLite upgrade rehearsal incl. the blocked-migration stop condition.
Both added to the CI parity-postgres job behind the hr_test_ci disposable rule.
DDL parity 64/64 + execution parity 42 steps 0 diffs re-proven.

**Gates:** FULL npm run check EXIT 0 — tsc clean; vitest 946 passed / 0 failed;
r95 + r96 runtime suites; python 190; r96 operations 20; demo model; browser
offline 343; build + dist asset validation. Evidence in audit/r96/evidence-integration/.

**N04–N10 (a7da4ba..f7838c1) — the core ticket ladder completed:**

- **N04 (a7da4ba) uncertain-send handling closed:** every email send carries the outbox event key as the provider Idempotency-Key; timeout/network outcomes stay UNCERTAIN (queued, same-key retry inside the window); first_attempt_at anchor (migration 0065) makes the drain REFUSE to resend after window expiry (dead_letter, zero IO); signature-verified delivered callbacks upgrade queued/failed/dead_letter rows; provider contract documented in ONE place (docs/notifications/provider-contract.md); expected-schema regenerated for the full chain.
- **N05 (5943c9c) refund/access allocation ledger:** partial_consumed refunds require an APPROVED, versioned, immutable allocation computed against the payment's own grant-interval ledger (migration 0066); conservative default policy v1 (explicitly NOT owner-ratified); unknown/legacy intervals -> manual_review + operator override; refund_access_reviews RESOLVE with grant-specific versioned decisions; receipt totals can never be exceeded.
- **N06 (a1fe278) terminal payment-session reconciliation:** the provider_not_paid_confirmed release implemented behind the FULL proof stack (explicit new-attempt policy, TERMINAL provider inquiry REVERSED/FAILED, latest-observation, 24h settlement window, current admin operator, echoed evidence reconciling against stored rows); one batch resolves the review case + fails the attempt + records the operation receipt; late settlement after release lands in explicit review, never auto-fulfills.
- **N07 (6eb4244) dossier snapshot races closed:** the public share view's authorization and access counter commit in ONE conditional UPDATE (claimDossierViewStatements) — six sequential awaited reads replaced; the claim refuses unless EVERY condition holds at the statement's instant; the dossier bytes ride the same batch (transaction on every provider); response discipline (private no-store, neutral 404s) pinned.
- **N08 (8e9ed39) privacy/report/abuse operations:** one report per (request, reporter) FOREVER (migration 0067 unique pair); 20/day per-account bound INSIDE the insert (SQL-level); dispute/legal holds (service_request_holds, one ACTIVE per request) exclude requests from the retention sweep; hold/release are separate audited admin actions (operation-id landing-gated — tests caught a phantom-audit bug); providerResponseStats restricted at SQL level (indexed 180-day window, 5000-row scan cap, honest aggregation_note); provider_block_complaints queue (one per pair, private reason never disclosed).
- **N09 (f7838c1) the complete paid-workspace journey:** workspace_tasks.due_timezone (migration 0068, additive) — due/overdue and delivery computed in EACH task's own IANA zone; the paid-plan expiry surface (org with paid-plan history but no active entitlement = READ-ONLY: reads + CSV export stay, writes refuse with the honest renewal pointer, nothing deleted, live check so renewal restores writes next request; never-paid orgs keep the free path); enqueueDueTaskReminders (bounded 50/pass, idempotent deterministic event keys, send-time task-state recheck, HTML-ESCAPED reminder bodies with the injection pin).
- **N10 (906d976) shared state semantics in REAL components:** useDomainResource/CommandFlight mounted through react-dom/client (happy-dom): principal switch never shows the slower old principal's data (full render-trace assertion), logout aborts in-flight loads, double-click = one command, 409+current_version = recoverable conflict, 502/503-after-commit = conservatively failed, PlatformClient inventory fixture (123 methods, 233 contract types, paginated domains must carry cursor/total).

**Live-Supabase reconciliation (f931ef8):** the R96 deploy gate caught that the live
canonical database was still at the <=0051 schema (dataset-sync-built; app tables empty)
AND that expected-schema.json carried 60 FTS5 shadow columns no correct PG ever has
(the parity gate skips virtual tables — Postgres serves search via horse_search_source).
Fixed both: regen excludes the FTS family (1193-column expectation); the new consolidated
range runner (apply-range-to-supabase.mjs — production translator, one transaction per
migration, statement-level idempotency, empty-table-only data-statement guard, per-migration
owner attestation) applied 0052-0060 + 0062-0068; apply-0061 ran via its own entrypoint.
Rehearsed first on embedded PG (live-like base, SMOKE PASS, idempotent); full logical backup
taken before any write (r96-live-supabase-e0a6e67e392e41e9); post-probe: 1193/1193 columns,
0 missing; the 78,089-horse dataset untouched. Evidence: audit/r96/evidence-reconciliation/.

**R96 core gates (all ten tickets):** FULL npm run check EXIT 0 at f7838c1 — vitest 1020/0 fail, tsc clean, python 190, r95 runtime 82/82, r96 runtime 53/53, PG parity 67/67 + execution parity + concurrency 9/9 on real PG. Tickets N11+ (professional directory, marketplace, imports, pedigree, genetics, Heritage layout, Equidata, FEI nav, demo expansion, commerce scope, connections, performance, security, pricing, versioned API, release authorization) remain OPEN in review-r96/AGENT_TASKS.json — deliberately optional lanes that must not delay the reliable core (per R96-START-HERE).


- **N14 complete — the old `UNIQUE(reporter_user_id, target_table, target_id, status)` is gone (migration 0061, the F27 fix).** It allowed two simultaneously ACTIVE cases whenever their active statuses differed (one 'new' + one 'triaged' coexisted — and even the ASSIGNMENT update collided), and it BLOCKED a legitimate later report once an earlier case had already closed with the same resolved status: the operator's dismissal UPDATE hit a constraint violation and the case stayed STUCK in triage forever. Under 0061 the key is a PARTIAL unique index `uq_moderation_cases_active` over (reporter, target) WHERE status IN ('new','triaged','action_pending'): any pair of active statuses for the same reporter+target is refused by the engine, while closed history is entirely outside the key — a new incident can always be filed, and any number of closed cases (including identical resolved statuses) coexist. A second partial index `uq_moderation_appeals_one_open` makes "one OPEN appeal per case" structural, so appeal-creation races can no longer produce two open appeals.
- **The migration is a row-preserving table swap, proven on both providers.** Dropping a SQLite TABLE constraint requires rebuilding the table, and moderation_cases has three inbound FK children — so 0061 renames the old parent aside (children follow by name/oid), creates the replacement (extended status CHECK with 'resolved_merged' + merged_into_case_id, NO status-in-key constraint), copies every row verbatim, rebuilds each child against the replacement (events gain the 'standing' event type), drops the legacy parent, then runs the documented merge: every duplicate ACTIVE group folds to its OLDEST case deterministically (MIN(id) per group — order-independent, safe under both engines' UPDATE visibility), the younger actives become 'resolved_merged' with merged_into_case_id pointing at the keeper, a resolution note, and an append-only 'note' event recorded by actor 'migration_0061' (a data repair honestly recorded as such). Nothing is ever erased to satisfy an index. The vitest upgrade fixture applies <=0060, seeds ONLY old-schema-reachable states (the duplicate-ACTIVE pair via the blocked assignment; the F27-stuck dismissal), then applies 0061 and pins the outcome; scripts/r95-n14-migration-smoke.mjs replays both phases; the swap translates through the production translator and applies to real PostgreSQL (61/61 chain, 0 failures) — and D1 gets the same file on the next deploy.
- **Every mutating route now rechecks inside the write (the N14 discipline).** reportCase: marker-gated creation (last_operation_id on the INSERT; the event is gated on it) and a racing duplicate is mapped to the honest 409 case_exists (the partial index is the enforcement; SQLite "UNIQUE constraint" and PG "duplicate key" both recognized). assignCase: pre-reads the case, carries an EXPECTED-status CAS, and rechecks BOTH the ACTING administrator AND the assignee's current standing inside the UPDATE (a deactivated mid-flight admin or a non-admin assignee yields an honest 409 case_state_changed, never a write). appealCase: the seller mandate is re-checked INSIDE a mandate-conditioned INSERT..SELECT — a listing changing hands between preflight and write inserts zero rows (403 not_appellant, no appeal, no event), and the one-open-appeal index turns a race into 409 appeal_exists. decideCase/decideAppeal keep their R88 CAS + ACTIVE-admin rechecks, now as named templates shared with the parity harness.
- **The standing lifecycle landed (migration 0060's promise: "set through the moderation workflow (N14)").** src/moderation/standing.ts is the ONE matrix: 3x3 from x to cells, self-transitions refused (a no-op action is an honest 409 standing_transition_refused, never a silent write), every escalation and de-escalation allowed and provenance-recorded. `POST /api/admin/moderation/cases/:id/standing` resolves the affected account by the OWNER rule (the account that controls the reported artifact: listing -> seller, inquiry -> buyer, lead -> requester; directory_profiles honestly 422 until a reviewed profile-owner mandate exists), requires a RESOLVED non-merged case, and lands as one marker-gated batch: case stamp (rechecking the acting admin) + an INSERT..SELECT upsert CONDITIONED on the stamp marker (an active or merged case no-ops the whole batch — proven on both providers) + an append-only 'standing' event on the case. The route never auto-sanctions: hiding a listing suspends the listing; restricting an account is a separate explicit decision. `GET /api/moderation/standing` gives the account owner their OWN standing (transparency; nobody else's). The N12 create-transaction check now has a real writer, so restricted/suspended accounts are actually reachable in practice.
- **Participant privacy is a projection, not a filter (F25/F26 closed).** caseDetail: STAFF get the full append-only trail, every ACTIVE suspension reason for the target listing, the affected account and its current standing (the moderator view that explains all of them). PARTICIPANTS get a minimal summary — the reported party (seller) sees the transparent suspension reasons for THEIR listing and their OWN appeal records (including their own ruling note); the reporter sees their case status only. Never events, staff notes, reporter identity, the reporter's submitted evidence, or other parties' appeal information — pinned by serialization-level tests (the reporter id string and the reporter's details never appear in the seller's view). A bystander gets an honest 404.
- **Evidence (both providers).** vitest: +9 integration (tests/integration/moderation-lifecycle.test.ts — the full acceptance matrix through the real HTTP routes on a real database) +2 upgrade-fixture (tests/integration/moderation-upgrade.test.ts) +1 rewritten case-detail pin; python p16 +4 (cross-status duplicate refusal; the same-resolved-status multiplicity the old schema refused — three coexisting dismissed cases; merged-status/link columns; one-open-appeal structural) for 178 -> 182; runtime 79 -> 82 (dedup under any active pair, standing marker-gating incl. merged/active refusals, assignment CAS + dual standing rechecks); the Python parity sequence +12 steps (30 -> 42): the whole moderation state/standing matrix replayed on SQLite AND real PostgreSQL through the production translator — report create, duplicate-active refusal (unique_violation class on both engines), hide + suspension, the F27 same-resolved-status multiplicity, mandate-conditioned appeal creation, duplicate-open-appeal refusal, overturn lifting ONLY its own suspension, the standing batch, and the active-case refusal (0-0-0 no-op) — 0 differences (audit/r95/evidence/pg-parity-n14.txt). Ordering lesson recorded in the lib: every id-dependent INSERT happens BEFORE the first expect-error step, because a failed INSERT consumes a PG sequence number but not a SQLite rowid. scripts/apply-0061-to-supabase.mjs (owner-gated live migration): read-only preflight preview of what the merge will fold, one translated transaction, postflight verification (partial indexes present, old status-in-key unique gone), idempotent re-run; its smoke test (scripts/r95-n14-apply-smoke.mjs) caught a real bug before it could ship — the apply path initially skipped ddlNormalize, which would have produced non-identity id columns on live PG (the parity gate could not see it because a fresh chain has no duplicate actives, so the merge-events INSERT never fires there).
- **Housekeeping.** audit/r95/expected-schema.json: migrations 61, +moderation_cases.merged_into_case_id, +uq_moderation_cases_active, +uq_moderation_appeals_one_open (the live-Supabase probe; deploy stays manual-approval gated). The service policy matrix comment now records that N14 landed the moderation authority in the moderation workflow, not in the lead machine (the moderator axis stays empty by design). MODERATION vocabulary gains resolved_merged + the active-status set helpers. The FULL `npm run check` (not just the CI subset — the R82 lesson) exposed and fixed PRE-EXISTING drift the N12 round had left behind because it only ran the CI gates: tools/validate-ai-assistant.mjs still pinned PLATFORM_CONTRACT_VERSION "2.20.0" (N12 had bumped the contract to 2.21.0 — the validator stub was never updated); RUNTIME_ROUTE_BUDGET_INVENTORY.md was missing 13 routes (182 -> 195: the N12 service consent/provider-block/redact/export/privacy-policy family, the N06 refund family incl. provider-outcome, and this round's moderation standing routes); CANONICAL_DERIVED_DATA_INVENTORY.md was missing 7 tables (97 -> 104: billing_command_receipts, billing_review_cases, refund_requests, refund_events, notification_send_reservations, service_provider_blocks, service_abuse_standing). LESSON re-confirmed: the CI quality job runs only tsc/vitest/runtime/python/build — every round that ships schema or route changes must run the FULL check before push, or the drift surfaces rounds later.
- Suite: vitest 934 -> 945, python 178 -> 182, r95 runtime 79 -> 82, tsc clean, build + dist green, PG parity 61 migrations + 42 steps 0 diffs on embedded PG 18 (CI re-runs on PG 15). Deploy posture unchanged: manual exact-revision approval (R95_PRODUCTION_RELEASE_APPROVED_SHA). The live Supabase gets 0061 through the runbook step scripts/apply-0061-to-supabase.mjs; the live D1 gets it through the deploy workflow's wrangler d1 migrations apply. CI follow-up (this round's push exposed it): the concurrent-service-receipt-claim parity step is genuinely timing-dependent on PG READ COMMITTED — the racing loser either sees the winner's committed row in its guard subquery and no-ops, or races ahead of the COMMIT and is refused by the unique constraint. BOTH are the designed fail-closed refusal ("exactly one winner; the loser never a second winner"); which one occurs depends on whether the loser's statement snapshot predates the winner's COMMIT. The sequential SQLite reference deterministically takes the no-op branch, so CI (PG 15) flipped to the constraint branch and the strict transcript comparison called it a difference. pg-execution-parity now compares concurrent steps by the INVARIANT (identical winner count; the no-op refusal and the unique_violation refusal are equivalent; any other error class or a winner mismatch remains a hard failure), with the rationale documented in the harness.

# R95f — 2026-10-04 (R95-N12: service consent withdrawal + anti-abuse lifecycle)

- **N12 complete — contacting professionals now has an actual consent/retention/block/report lifecycle (migration 0060, contract 2.21.0).** Contact consent is WITHDRAWABLE after the fact: `POST /api/service-requests/:id/consent` is one-way (CAS on share_contact=1 + consent_updated_at; re-withdraw is an honest 409 already_withdrawn), removes ALL future disclosure (the read path already re-authorized per read — a revoked manager link AND a withdrawn consent both fail closed on the very next request) and marker-gated-suppresses every pending optional notice for that request (`essential=0` only — security notices are never suppressed). Withdrawing the WHOLE lead (the existing status transition) appends the same suppression statement to the transition batch, gated on the transition marker: a stale/failed CAS suppresses nothing.
- **Provider-side block with a private reason.** `service_provider_blocks(provider_person_id, blocked_requester_user_id, reason)` — the reason is operator evidence, never disclosed: the blocked account's next create gets a NEUTRAL 403 `lead_refused` ("This provider is not accepting new requests from your account.") that mentions neither the block nor the reason (pinned by test), the create outbox INSERT skips provider-blocked senders (no notification is minted for them at all), pending notices from the blocked account are suppressed, and the block is re-checked INSIDE the receipt INSERT (a late block between preflight and batch refuses the commit). The route (`POST /:id/provider-block`) requires the CURRENT verified provider-manager link (unlinked staff get an honest 404 — never an existence oracle).
- **Explicit moderation standing + transactional anti-abuse bounds.** `service_abuse_standing` (absent row = normal; restricted/suspended refuse lead creation, re-checked in the transaction; set through the moderation workflow — N14 — never blanket staff access). The receipt INSERT now also enforces: max 15 new leads per account per rolling 24h, max 5 per account+category per 24h, and duplicate-lead detection (same provider+category+note within 24h -> 409 `duplicate_lead`). Every bound is about the ACTING account only — no other requester's identity is examined or revealed. The route preflight runs AFTER the idempotency-receipt replay so a retry of an ALREADY-CREATED request is never mistaken for abuse (pinned: same-key retry still replays).
- **Statistically honest response metrics.** `providerResponseStats` (via pure `computeProviderResponseMetrics`): 180-day measurement window, disclosed denominator (`requests_in_window`), minimum cohort 5 — below it `insufficient_data: true` and NO metric (a low-volume provider shows "not enough data yet — no rating", never a synthetic star), per-requester sample cap 2 with `capped_per_requester` disclosed (one spam account cannot inflate a provider's numbers), spam/withdrawn-before-acknowledgement/never-acknowledged/outside-window all counted as exclusions. Method note + disclaimer ship in the response.
- **Redaction, export, retention and the public privacy decision table.** `POST /:id/redact` (requester-only) replaces the note body with a marker and preserves ONLY the SHA-256 digest of the original bytes (`note_digest`) as dispute evidence — message-body evidence is now structurally separate from any public provider biography. `GET /api/service-requests/export` returns the requester's own leads + blocks + reports + standing (nothing about other requesters). `GET /api/service-requests/privacy-policy` (public, no personal data) publishes the field x storage x visibility x condition x retention decision table plus the requester/provider UI flow — the completion-evidence deliverable. The retention sweep (`serviceRetentionSweep`, wired into the scheduled handler next to the notification drain) minimizes terminal leads older than 365 days (note -> marker + digest preserved, consent zeroed, still-queued optional notices suppressed), keeps status history + timestamps as the narrow dispute/audit record, and is idempotent (second sweep changes nothing; every sweep writes a summary audit event).
- **PlatformClient serviceRequests module += 5 typed methods** (withdrawConsent, providerBlock, redactNote, export, privacyPolicy; mock adapter keeps writes honest 501 — "consent is a durable record, not a simulation"). Contract 2.20.0 -> 2.21.0 (additive SDK surface).
- **Evidence.** vitest serviceRequests suite 20 -> 33: 10 new N12 acceptance tests on a REAL SQLite database (withdrawal removes disclosure + suppresses + one-way; lead withdrawal suppresses; provider block neutral refusal with the private reason pinned absent from the error; late block refuses in-transaction with no outbox row; standing refuses; category bound + duplicate + idempotent-retry-not-abuse; outbox skips blocked senders + service notices are email-only so SMS can never be exhausted by leads; redaction digest == SHA-256 of the original bytes; retention sweep scope + idempotence; export contains ONLY own data + the policy table is complete). tools/test-r95-runtime.cjs +6 (73 -> 79): consent CAS + suppression + idempotence guard, provider-block create refusal + notification skip, standing + category + duplicate refusals at command level, withdraw-transition 4-statement batch, retention sweep, pure metrics (min cohort + per-requester cap). Python parity (p01_parity_lib) +7 steps (23 -> 30): duplicate/provider-blocked/restricted-standing create refusals, consent-withdrawal batch, withdrawn transition with suppression (marker-gated), provider-block batch, retention sweep — all regex-extracted from the production SQL templates (privacy.ts constants) and replayed on both engines; the `${MAX_NEW_REQUESTS_PER_DAY}`/`${MAX_NEW_PER_CATEGORY_PER_DAY}` template literals are resolved from the ONE source of truth in privacy.ts. Two snapshot pins added (consent/redaction state per request; outbox status/last_error per event). N11 policy test updated: a withdrawal transition now builds 4 statements (the suppression is appended only for `to=withdrawn`). LESSON recorded: the local SQLite driver binds JS numbers as REAL — `CAST(901 AS TEXT)` renders '901.0' — LIKE-pattern binds must be pre-stringified (entity_id binds too); the row-id binds stay numeric for PG integer comparison.
- Suite: vitest 921 -> 934, python 171 -> 178, r95 runtime 73 -> 79, audit 18, tsc clean, validators green (platform contract 2.21.0), build + dist green. PG parity sequence 30 steps / 60 migrations (SQLite side green locally; PG side runs in CI + the approval-gated deploy). Deploy posture unchanged: manual exact-revision approval.

# R95e — 2026-10-04 (R95-N13: transactionally consistent dossier creation and sharing)

- **N13 complete — the mixed-version dossier is structurally impossible now.** The old snapshot builder ran several awaited queries; on D1/SQLite that is one consistent transaction, but the production Supabase adapter executes batches under PostgreSQL READ COMMITTED where every STATEMENT gets its own snapshot — a canonical correction landing mid-build could tear identity from sections (the Master AI's exact concern). The new builder composes ONE statement (`DOSSIER_SNAPSHOT_SELECT_SQL`, correlated scalar subqueries per included section) so every engine sees a single snapshot; the snapshot gains a `source` marker (`schema_version` + `horses.updated_at`) captured in the same statement, and excluded sections are never read at all (not read-then-redacted). JSON aggregates (`json_group_array`/`json_object` -> `jsonb_agg`/`jsonb_build_object` through the production translator) are transport only: TypeScript normalizes (string-or-parsed, empty->[]) and assembles the stored bytes, so engine key-order differences can never leak into the frozen document. Proven on embedded PostgreSQL 18: parsed-structure + scalar parity with SQLite (audit/r95/evidence/pg-parity-n13.txt, scripts/r95-n13-snapshot-parity.cjs).
- **Creation and link minting re-check the CURRENT seller mandate inside the transaction.** Both became mandate-conditioned INSERT..SELECT statements (reusing the marketplace `buildActiveGrantPredicate` — one grant-predicate source) plus marker-gated audit receipts conditioned on this call's operation id. A grant revoked, or the horse deleted, between route preflight and the batch makes the insert match zero rows — no snapshot, no share token, no audit event; the route answers an honest 409 `sharing_authority_changed`.
- **Immutable issued digest + controlled legacy validation.** Migration 0059 adds `dossier_snapshots.issued_digest` (SHA-256 over the exact snapshot_json + sections_meta_json bytes). The view recomputes it: a mismatch is a controlled 410 (tamper/corruption evidence, never altered bytes served, never a 500); pre-digest legacy rows report `digest_verified: null` honestly and keep working. `parseLegacyDossierPayload` validates historical payloads (schema version bounds, horse_id, identity, section markers) into a controlled operator-review response — and the previously UNGUARDED `JSON.parse(sections_meta_json)` (a genuine 500 vector) is now covered. New standing warning: the dossier is a platform information extract, not an official passport or guarantee; the response carries the digest with an honest note. Access logging stays BOUNDED: counter + last-access timestamp only, and the share-link column set is pinned by test so no viewer-identity column can be added quietly.
- **Evidence.** tests/integration/dossier-concurrency.test.ts (15 tests): late-revoked grant / deleted horse produce no token (command-level, bypassing preflight on purpose); the one-statement mechanism pinned with a prepare-recorder (and excluded-section no-read proof); before/after build uniformity under an interleaved correction; malformed snapshot/meta/unknown-schema-version -> controlled 410 with no stack leakage; digest tamper refused; legacy null digest still views; genetic withdrawal still kills old shares; bounded-logging column allowlist. Python p15 source-scan updated to the mint SQL's new home (and now executes the ACTUAL mandate-conditioned template with both branches). Native runtime +3 (73): one-statement pin, mandate-refusal mint, digest + legacy-validation. Parity gate: 59/59 migrations (incl. 0059), 23 execution steps 0 diffs.
- **Pre-existing CI time-bomb fixed (not N13's fault, found by this push):** the N06 refunds integration test seeded payments at a FIXED 2026-10-03 while `computeRefundPolicy` compares `daysRemaining` against the real clock — after UTC midnight a "fresh, unused" grant computed as consumed (`partial_consumed`), refusing approval. Verified failing at pre-N13 `4bcebf5`; the test now anchors `paid_at` to the real current time. Lesson recorded: tests comparing stored timestamps to `Date.now()` must seed with the real clock.
- Suite: vitest 906→921, python 171, r95 runtime 70→73, audit 18, tsc clean, validators green, build + dist green, PG parity 59 migrations + 23 steps 0 diffs. Deploy posture unchanged: manual exact-revision approval.

# R95d — 2026-10-04 (R95-N11: service provider mandates + ONE state machine)

- **N11 complete — one role-aware transition matrix (src/services/policy.ts, no migration).** The duplicated transition facts are gone: the old `SERVICE_TRANSITIONS` table in commands.ts and the hand-written route table with its broad `by: "anyone"` metadata were both replaced by `SERVICE_TRANSITION_MATRIX` (6 states x requester/provider/moderator, every cell explicit). The route's `SERVICE_REQUEST_TRANSITIONS` metadata is now DERIVED (union `to`, exact `by` actor list) and the pure command runs `serviceTransitionAllowed` from the same matrix, throwing RangeError before any SQL is built for every prohibited pair. The moderator axis exists but is EMPTY by policy — staff act through the moderation case workflow, never the lead machine (an unlinked editor or organization member gets 404 on another person's lead, re-checked live; N14 will define specific audited moderator transitions).
- **Provider mandates are one concept, separately from organization membership.** `PERSON_MANDATE_AUTHORITY_SQL` is the single SQL template behind the create self-lead refusal, the transition provider-authority arm and the notification fan-out: a verified user/person link to a live person through an active account (account/person verification). Organization affiliation authority is explicitly NOT this — `ORGANIZATION_SERVICE_LEADS.supported=false` and the route's 422 `provider_affiliation_required` derives from that constant, so organization-routed leads stay honestly disabled until a reviewed affiliation workflow exists (ordinary org membership never becomes provider authority).
- **Create-time authority is re-checked INSIDE the transaction.** The receipt INSERT now carries, besides the existing published-provider/category/block/open-quota arms, a self-lead `NOT EXISTS` (the actor holding the provider's current personal mandate cannot claim a lead to themselves) and the requester's CURRENT horse mandate (`HORSE_MANDATE_REFERENCE_SQL`: a direct active grant, or a grant to one of the actor's active organizations; referencing a horse in a lead requires a live mandate — a seller/owner relationship established by grant). A block, publication withdrawal, grant revocation or link revocation landing between route preflight and the batch makes the claim insert match zero rows — the request is never recorded and no partial state survives. The route preflight gives the honest early errors (403 `horse_mandate_required`), the transaction is the enforcement.
- **Legacy receipt conflict resolution is defined (and never duplicates a lead).** A pre-0054 receipt (global key, no durable request link) replayed with a matching digest now resolves deterministically: exactly ONE same-actor/provider/category request at-or-after the receipt time is CAS-claimed (`UPDATE ... WHERE request_id IS NULL`) and replayed as the linked request; zero or multiple candidates is an honest 409 `legacy_receipt_unresolved` directing the client to a new Idempotency-Key. The old blanket `legacy_receipt_review_required` dead-end is gone; a duplicate lead is still impossible (no new request is ever created on the replay path).
- **Evidence.** tests/unit/servicePolicy.test.ts generates ALL 108 state/actor/target pairs — route metadata, `serviceTransitionAllowed`, `serviceActorsPermitting` and the command's build-vs-RangeError decision agree with the matrix everywhere, and prohibited pairs provably never touch SQL (prepare-call recorder). tests/unit/serviceRequests.test.ts gains a real-database N11 suite (20 total in the file): requester-cannot-acknowledge / provider-cannot-withdraw, unlinked editor + org member cannot read or transition, horse mandate required at preflight and enforced at commit (no-grant, revoked-grant), late block + late unpublish refused in-transaction, self-lead refused in-transaction, legacy receipt single-candidate link + ambiguous refusal with zero duplicates. The python parity lib (tests/python/p01_parity_lib.py) gains 11 service steps extracted from the production SQL templates: full create batch, replay no-op, late-block/no-mandate/revoked-mandate/self-lead refusals, acknowledge + wrong-party + stale transitions, and two REAL-PostgreSQL races (same-key receipt claim via two connections; same-CAS transition where exactly one racer lands) — pg-execution-parity compares 23 steps with 0 differences (evidence: audit/r95/evidence/pg-parity-n11.txt; embedded PG 18). tools/test-r95-runtime.cjs +3 (self-lead, horse mandate, moderator-axis/metadata derivation).
- Suite: vitest 890→906, python 164→171, r95 runtime 67→70, audit 18, tsc clean, build + dist validation green, PG parity 23 steps / 0 diffs (58/58 migrations; no new migration — N11 is policy/query-level and reuses the 0054 receipt-link columns). Deploy posture unchanged: manual exact-revision approval.

# R94d — 2026-10-04 (R88-plan P21 production surfaces: Heritage directory / workspaces / service requests)

- **P21 production-surface half complete (b19e641).** Three Heritage-local pages wired through the canonical P20 layer: (1) **Directory** — public consent-gated professionals (category/province/name filters, cursor paging); person detail carries credential honesty (self-declared stays unverified; expired stays visible history without active state), the mediated-contact note on every surface, contact_value never read or rendered, and an explicit "an empty result is not a claim that no professionals exist". (2) **Workspaces** — auth-gated collections + dashboard (herd, overdue/due-soon/later buckets); task completion is CAS-guarded via usePlatformCommand: 409 surfaces the current version with reload-and-retry language, 5xx-unknown shows "re-open before trying again"; veterinary reminders carry the qualified-person notice; the working-set-not-ownership note ships on every surface. (3) **Service requests** — mine/inbox tabs with CAS transitions, consent-gated contact rendering exactly as the API projects it (shared vs not-shared stated), the not-a-confirmed-appointment warning and note-privacy note everywhere. Routes /directory, /directory/:id, /workspaces, /services + four nav entries + SPA page tags; visuals stay Heritage-local (h-mod class family + one scoped CSS block — no skin imports, pinned by tests). Loading/reloading/empty/forbidden/unavailable/error are distinct states via useDomainResource; failed requests are never empty records. 7 source-lock fixtures. vitest 804→811, check FULL, build + dist validation green.
- P21 remainder explicitly tracked for the next pass: extract the existing horse record-panel state onto P20 loaders, compact-metadata/collapsible-secondary-evidence density pass, and 360px/200% zoom baseline capture.

# R94b — 2026-10-04 (R88-plan P20: canonical frontend domain loaders and command hooks)

- **P20 complete (0b45d24, contract 2.20.0 / app 0.49.0).** New headless `src/frontend-kit/domain/` layer extracting shared SEMANTICS only — presentation stays in each skin: (1) `resourceState.ts` — the canonical async state model (idle/loading/reloading/ready/empty/forbidden/unavailable/error); 404/501/503 map to "unavailable" (anti-enumeration: private and absent both answer 404; fail-closed deployments stay honest), 403 to "forbidden", 429 to "error" with retry hints; empty is a DOMAIN decision via caller-supplied predicate — a failed request is never an empty record. (2) `domainLoader.ts` — DomainResourceController with a generation guard: a slower OLDER identity's response can never overwrite a newer identity's state (rapid navigation can never show the prior horse's private data); dispose() aborts and drops every late resolution (cancelled requests never update unmounted state); same-key reloads show honest "reloading" staleness; NO client cache — the platform's no-store responses ARE the privacy policy; superseded AbortErrors are normal, not errors. (3) `useDomainResource.ts` — the keyed React binding; the render before the effect swap reports loading, never the prior identity's data. (4) `commandStatus.ts` — accepted/rejected/failed command machine; 409 surfaces details.current_version (the P03 CAS story: honest reload-and-retry, never blind resubmit); this platform's documented deliberate refusals (501 feature-off, 502 provider-refused, 503 fail-closed — all "nothing happened") classify as rejected, while 500/504/network are failed-unknown (the UI must re-read). (5) `pager.ts` — cursor + offset pagination semantics. (6) `locale.ts` — bilingual EN/FA packs for directory/serviceRequests/workspaces/billing carrying the API modules' own honest phrases verbatim (never softened).
- PlatformClient contract gains four typed modules mirroring the API DTOs exactly (contact_value never in public DTOs; expired credentials keep history): directory (persons/person/organizations/claims/profile/credentials), serviceRequests (create with Idempotency-Key, mine/inbox/detail, CAS setStatus, block, report), workspaces (create/mine/dashboard/remove, horse membership + bulk, action-scoped staff assign/revoke, occurrence-keyed tasks + CAS complete, exportUrl), billing (catalog/offers/createOrder with Idempotency-Key/myOrders/order/cancel/pay/entitlements). Real adapter pins exact URLs/methods/bodies/headers; mock adapter: reads return clearly-marked demo data, EVERY write rejects 501 ("a durable record, not a simulation"), pay fails closed 503 exactly like an unconfigured real deployment — a fabricated successful transaction is impossible.
- Acceptance evidence pinned by 37 new fixtures across 3 suites: race guard (older identity dropped, newer wins), abort propagation, dispose-drops-late-resolutions, retry, empty-vs-error, dual-adapter same command/error semantics (real scripted transport + mock), wire discipline (idempotency headers, CAS bodies), locale honesty pins, and frontend-independence source scans (domain layer imports no skin, no css, no fetch/window — no global fetch hook exists; five entrypoints untouched).
- Version pins updated everywhere (validate:platform, validate-ai-assistant tokens, marketplaceCommands source-lock). vitest 767→804 (+37), python 160, check FULL pass, tsc clean, build + dist validation green.

# R94 — 2026-10-04 (pure-source export round for the Master AI; no code change)

- **R94: source-code-only export built at e113aa4 for the Master AI's next review** — same convention as R69/R87: extension allowlist over `git ls-files` (ts/tsx/mjs/css/sql/py/js/json/html/ps1/yml/txt/sh/jsonc/webmanifest + .env.example/.gitignore), path exclusions (docs/, audit/, sandbox/, public/, seed/, standalone preview bundle, lockfiles, all markdown), then PER-FILE git-blob hash verification — all 623 files byte-identical to the commit. Delta vs the R87 export the Master AI already reviewed: +114 files / −0, exactly the P02-P19 work (15 migrations 0037-0051, 16 apply scripts, src/commerce + workspaces + notifications + marketplace/genetics/security modules, 15 unit + 13 python + 3 integration test files, 11 tools, frontend density files). Deliberate exclusions beyond R87: none new except RELEASE-MANIFEST.json (their own stale R88 metadata claiming 0.45.0/2.16.0 — excluded so it cannot mislead the review of the actual 0.48.0/2.19.0 tree; PACKAGE-INFO.txt states this). Secret scan clean (the repo's own export scripts contain the scanning regexes — known-benign, R87 precedent; no live tokens; CF account ID in wrangler.jsonc is public-by-design and identical to R87). Archived: vault exports/horse-registry-pure-source_R94_e113aa4.zip + download/. Live state at export: deploy green, contract 2.19.0, 182 routes / 97 structures / 51 migrations, vitest 767 / python 160, P00-P19 complete.

# R93 part 2 — 2026-10-03 (three more plan items in the same run: P17-P19)

- **R88-plan P17 complete — billing catalog, orders and unambiguous money units (56b15ba, migration 0049).** One documented internal unit: integer minor IRR with currency='IRR' CHECK-enforced on every billing table; toman exists ONLY at display boundaries (1 toman = 10 rial via src/commerce/money.ts — never inferred from a numeric size; the acceptance pinned: a 1,900,000-toman plan is stored 19,000,000 IRR and can never be charged as 1,900,000 rial). billing_prices are IMMUTABLE VERSIONS: repricing inserts version+1 and supersedes the old row in the same batch — price_minor is never UPDATEd, and an existing order keeps its frozen price_snapshot_json + order_lines forever (python replay proves byte-identical orders after a reprice). Orders: totals ALWAYS recomputed server-side from the live catalog (the request schema accepts no client total at all); UNIQUE(buyer_user_id, order_key) makes duplicate submission create ONE order (replays return the stored order); status machine pending -> awaiting_payment -> paid / cancelled / refunded / partially_refunded with no state skipping; cancellation is a guarded state change — financial records are never deleted. payment_attempts carry the TRUSTED server-side amount, provider authority (UNIQUE per provider) and a state machine; no card credentials anywhere. economics.ts stays a planning module (nothing imports it from billing). 14 vitest + 6 python fixtures.
- **R88-plan P18 complete — verified payments, entitlements and reconciliation (29378f9, migration 0050).** The Zarinpal v4 adapter pins the official wire contract (request/verify JSON shapes, RIAL-integer amounts = the internal unit, codes 100/101 = verified/already-verified, 53/54 = amount mismatch, 51/52 = not paid) and is FAIL-CLOSED without the owner's ZARINPAL_MERCHANT_ID: /pay returns honest 503 and creates NO attempt. Verification is SERVER-SIDE with the STORED amount — the gateway redirect's Status query parameter is deliberately ignored (the callback endpoint reports the stored state and writes nothing). The verified batch lands in ONE transaction: attempt CAS -> verified, order CAS -> paid, EXACTLY ONE entitlement event (deterministic event_key + UNIQUE + ON CONFLICT DO NOTHING — concurrent callbacks and replays can never grant a second period; the loser matches zero rows everywhere), the guarded entitlement upsert/extension (renewals extend from the current expiry anchor — no gaps), and the append-only ledger row. Wrong amount = 409 + a reconciliation case, NO entitlement; not_paid/timeout/network failures leave the attempt PENDING — payment state is never guessed; an already-verified replay checks stored identity and grants nothing. Refunds are recorded compensating events (order state + cancelled entitlement + refund_reversal event + ledger row; no deletes). The reconciliation sweep expires ONLY never-verified attempts older than 24h, queues every exception for operators with traceable resolution, and notes that settlement imports + fees-separate-from-gross recording are owner-gated. 18 vitest + 8 python fixtures (the concurrency loser proven by real IntegrityError + zero-row guarded upsert).
- **R88-plan P19 complete — first paid offers and feature entitlements without harming public trust (1c38d66, migration 0051).** Exactly THREE pilot offers persisted through the billing catalog (farm_workspace_monthly, professional_tools_monthly, sponsored_visibility_monthly), each with its free-tier boundary stated in both languages, plus the free-forever floor: basic horse identity/pedigree/results, correction submission, and published safety/provenance information are never for sale. OFFER_TRUST_NOTE ships on every offer surface: payment buys conveniences only — never official approval, biological truth, evidence suppression, or access to another owner's private resources. Entitlement gates are LIVE (SQL datetime filter + JS defense-in-depth re-check) and NEVER participate in resource authorization — the pinned acceptance: a paid unrelated account still gets 404 on another user's private workspace, with zero writes on the refused path. An expired plan removes paid conveniences automatically while deleting nothing (workspace rows and entitlement history untouched). Sponsored placement: operator-set ONLY for sellers holding an ACTIVE sponsored_visibility entitlement (live check + audit + 1-90 day expiry), sorts first in the marketplace ONLY while live, and every sponsored row carries the bilingual Sponsored/تبلیغ label plus the scientific-exclusion note; the python suite source-scans the scientific modules (breeding, coefficients, insights, genetics, directory) to prove none of them read sponsored_until. 12 vitest + 5 python fixtures. Deprecated Persian term شجره replaced with تبارنامه (language validator clean).
- **R93g CI fix (a3ac278):** the unquoted colon in ci.yml's pg-execution-parity step name (P01: same seed...) made the entire workflow unparseable — every CI run since R91 failed with 0 jobs (Deploy Production was never affected). Quoted; PyYAML validates.
- Batch totals (P13-P19): 182 routes / 97 structures / 51 migrations; vitest 767 / python 160; check FULL; contract 2.19.0 / app 0.48.0; Supabase-first for 0045-0051. Payments + delivery callbacks stay fail-closed until the owner sets ZARINPAL_MERCHANT_ID + NOTIFICATION_CALLBACK_SECRET.

# R93 — 2026-10-03 (four plan items in one continuous run: P13-P16)

- **R88-plan P13 complete — transactional notifications and accurate delivery language (18e2cd9, migration 0045).** The honest delivery-state machine: `delivered` exists ONLY via signature-verified provider callbacks (HMAC-SHA256 over provider:rawBody with NOTIFICATION_CALLBACK_SECRET; forged = 401 + rejected log, zero state change); a 2xx provider reply is provider_accepted and NEVER delivery; notification_deliveries (UNIQUE event_key + ON CONFLICT DO NOTHING) is the ONLY table billing counts may use — replayed callbacks can never double-count. The outbox row lands in the SAME D1 batch as the business mutation (a rolled-back mutation emits no message; python replay pins it); bounded exponential backoff (1,2,4...min capped 24h) to dead_letter after max_attempts; the drain marks missing providers with the VISIBLE provider_unconfigured failure, never success; operator retry re-queues ONE failed/dead_letter/suppressed row and refuses delivered + provider_accepted rows (delivery state is never rewound). notification_preferences: unsubscribe/quiet-hours (local 0-23, midnight-wrapping) /monthly send caps apply ONLY to non-essential purposes — OTP/verification/reset/security are essential and never suppressed (pinned). The dishonest `delivered:true on 2xx` field was REMOVED from the email/sms adapters (renamed accepted; authExt/recovery updated to the honest provider_accepted language with 'acceptance is not delivery confirmation' notices). Masked recipients only on outbox rows; no tokens/full numbers/bodies stored. 26 vitest + 10 python fixtures.
- **R88-plan P14 complete — farm workspace collections and delegated daily work (72220ff, migration 0046).** Collections are WORKING SETS, never ownership claims: no handler writes horse_people/horse_access_grants and the python replay proves it by FULL snapshot comparison (a horse in two collections changes nothing). Staff access is action-scoped (view/tasks_manage/export allowlist) and re-authorized LIVE at every read — a revoked assignment is invisible on the next request; revocation itself is a guarded CAS with an audit event. Tasks are user-entered REMINDERS (document_renewal/farrier/veterinary_appointment/other) with mechanical recurrence only: the deterministic occurrence_key (UNIQUE) makes recurring creation and completion-time next-occurrence materialization idempotent across scheduler retries (same batch as the completion UPDATE); veterinary reminders carry the qualified-person notice everywhere and NO dosage/treatment/instruction column exists (CHECK constraint vocabulary proof). CSV export: formula-injection defense (=+-@/tab/CR cells apostrophe-prefixed; python-pinned), registry-safe fields only (no contact/genetics), no-store. Bulk membership bounded at 50/direction; soft delete retires memberships+tasks and NEVER canonical horses. first_dashboard_view_at CAS-set once = honest time-to-first-useful-herd-view instrumentation. 20 vitest + 7 python fixtures.
- **R88-plan P15 complete — shareable sale dossiers with expiry and evidence limits (f509e86, migration 0047).** dossier_snapshots: snapshot_json is FROZEN (never rewritten); every section records source + review_state + generated_at; redacted sections (genetics/contact default off) stay VISIBLE as not_shared — absence is never clean or verified; no badge status exists in the CHECK constraint. Share links: 32-byte base64url tokens shown EXACTLY ONCE (only the sha256 hash is stored); expiry 1-90 days; optional authenticated-recipient restriction; revoked/expired links return 410 with no-store + noindex headers so cached copies die with the link; revoking a dossier kills ALL its links in one batch; the immutable snapshot is retained for audit. The public view detects staleness LIVE (horse.updated_at > snapshot created_at -> stale warning) instead of silently rewriting shared bytes; standing warnings: not a title transfer / not a veterinary purchase examination. Creation requires the create_listing seller mandate. 17 vitest + 6 python fixtures.
- **R88-plan P16 complete — moderation, reporting and marketplace trust operations (2e3de41, migration 0048).** moderation_cases target marketplace/directory surfaces ONLY (horses is absent from the target CHECK — content moderation is separate from registry factual correction); reviewed reason vocabulary incl. animal_welfare; one OPEN case per reporter per target (UNIQUE); the append-only moderation_case_events trail (created/assigned/note/decision/appeal/reversal) means an overturned decision never erases the previous one (hide -> appeal -> overturn all survive; nothing updates or deletes events). hide = transparent listing_suspensions overlay: public lists exclude the listing, seller/staff still see the detail with the suspension stated, NEW inquiries are refused (404), and the HORSE PROFILE IS UNTOUCHED (python full-snapshot proof). Appeals: only the listing's seller, one open appeal per case; overturn reinstates the listing through the same overlay. Seller authority: NEW inquiries are blocked with 410 seller_authority_expired when the seller's create_listing mandate is gone (renewal was already guarded); POST confirm-availability stamps availability_confirmed_at under the CURRENT mandate and the public listing exposes the freshness with an honest not-a-reservation note. The triage queue orders severity (urgent first) then age, reports counts ONLY (no rating/GMV/sold_amount column exists anywhere — pinned) and carries the honest 'does not advertise 24/7' support-hours note. 15 vitest + 7 python fixtures.
- Totals: 169 routes / 88 structures / 48 migrations; vitest 723 / python 141; check FULL pass, tsc clean, build green; contract 2.19.0 / app 0.48.0; migrations 0045-0048 applied to Supabase canonical + remote D1 BEFORE every push; deploys live-verified via CF API.

# R92 — 2026-10-03 (five plan items in one continuous run: P08-P12)

- **R88-plan P08 complete — reproduction/calendar semantics without corrupting historical rows (309fc96).** Canonical storage rules documented (docs/r88/P08-BREEDING-DATE-SEMANTICS.md): covering_date = real Gregorian day; season = Solar Hijri 1380-1500; the two can never disagree; partial knowledge stays season-level (no invented January 1/Farvardin 1). src/genetics/seasonDisplay.ts (pure, client-safe): breedingSeasonInterval honest half-open [Nowruz, next Nowruz) spans; bilingual interval rendering ("Season 1405 SH (21 Mar 2026 – 20 Mar 2027)" / "فصل ۱۴۰۵ (۱ فروردین – ۲۹ اسفند ۱۴۰۵)"); seasonRangeForPartialDate honest ranges with the Esfand-31 spill FIXED (SH year precision ends at Esfand 29/30, never a phantom day in the next season); leap detection via day-count between consecutive Nowruz dates. tools/audit-breeding-dates.mjs: READ-ONLY (SELECT-only, no apply mode) anomaly report with 8 classes. **LIVE FINDING: 48,603/48,603 legacy breeding rows carry pre-rule GREGORIAN seasons (2004-2017)** — exactly the plan's predicted corruption; per the rollback rule they are NOT mass-converted and await human review through the new reviewed correction endpoint POST /api/admin/breeding/:id/correct (reason required; revalidated with the create rules; guarded UPDATE touching only the two calendar columns + audit row with the OLD values in one batch; lost race = 409). Out-of-range legacy seasons render verbatim with an honest "(legacy value, pending review)" label instead of throwing. 21 fixtures.
- **R88-plan P09 complete — secure evidence upload + private document delivery (2076f97, migration 0041).** Upload boundary hardened before storage: scanForActiveContent rejects PDFs carrying scriptable constructs (/JavaScript /OpenAction /Launch /EmbeddedFile /SubmitForm) and image polyglots (trailing bytes after JPEG EOI / PNG IEND / GIF trailer) with 415 — SVG/HTML stay structurally impossible; stripLocationMetadata removes EXIF(GPS)/XMP/comments from JPEG and eXIf/tEXt/iTXt/zTXt from PNG so no later projection can leak location. Publication is explicit consent (consent_state backfilled onto exactly the already-public rows; canReadMedia fails closed). Private delivery: POST /api/media/:id/access mints HMAC-SHA256 tokens bound to (media,user,expiry) with 15-min TTL + revocable media_access_grants rows; GET /api/media/file/:id?token= verifies signature AND grant AND consent at serve — revoked grants kill tokens immediately; no public permanent document URLs exist; unset MEDIA_ACCESS_TOKEN_SECRET = fail-closed 503 (secret SET on the worker via CF API and live-verified). Operator quarantine queue GET /api/admin/media/quarantine (pending age + abandoned flags, staff reasons, metadata only, nothing auto-purged). 21 fixtures.
- **R88-plan P10 complete — licensed ingestion, staging and duplicate adjudication (99eecd7, migration 0042).** import_sources = source AGREEMENT registry (scope/redistribution/retention/cadence/operator; synthetic namespaces REFUSED by the stage command — pinned). Staging = the dry run: raw rows preserved VERBATIM next to normalized copies (Persian/Arabic digits + Arabic Yeh/Kaf->Persian + Tatweel), typed-identifier matching ONLY (register-in-source-namespace + microchip; NEVER name), classification with parentage_conflict + identifier_collision review routing and skip-on-identical; ZERO canonical writes during staging (pinned); (source_id, file_sha256) UNIQUE = identical-file replay. Apply = resumable bounded writer, ONE atomic D1 batch per create (horse + identifier claims resolving the fresh id via a last_mutation_id marker + outcome + audit; lost identifier race rolls back the whole row to conflict — no orphan horse); updates fill-once NULL facts only. Merge/unmerge = reviewer commands with a REPLAYABLE 14-surface moved-reference manifest (children parents, breeding sire/dam/foal, people, genetics, competitions, media, listings, grants, ownership periods, lifecycle, attestations), identifiers archived never deleted, soft-delete + redirect alias + search-reindex fan-out; unmerge replays the manifest backwards exactly; never silently collapses name-sharers. 19 fixtures.
- **R88-plan P11 complete — professional directory: people, organizations and credentials separate from login users (54cad1a, migration 0043).** 22-category reviewed starting vocabulary (dc/judge/steward/ringmaster DISTINCT; EN+FA labels with final officiating FA terms honestly flagged for equestrian domain review) + 31 ISO 3166-2:IR approved province codes (user-entered variants never pass). directory_profiles: ONE profile per person (rider+trainer = two categories on one row — pinned); contact_value PRIVATE (never in any public DTO — pinned); publication requires explicit consent, withdrawal unpublishes instantly. person_credentials: self-declaration ALWAYS lands unverified (pinned); platform_reviewed/issuer_attested only via the staff review route; expired credentials lose is_active at read time but stay in history (pinned). directory_claims: person claims -> verified user_person_link; organization claims -> MANAGER membership; appeals must reference the claimant's own rejected claim; unrelated accounts 403 with zero writes (pinned). 9 routes; 16 fixtures.
- **R88-plan P12 complete — consented service request inbox before booking or commissions (c8673ae, migration 0044).** Leads only: explicit transition table (new->acknowledged->discussing; closed/withdrawn/spam terminal) with NO paid/booked/confirmed states anywhere (pinned — the CHECK constraint is the proof). Minimized lead form (no medical details solicited; note never public). Idempotency-Key receipts in the P03 discipline (receipt + request + audit in one batch; retry replays; different payload = 409 — pinned); <=3 open per requester-provider pair; blocked providers unreachable. Contact visibility = consent AND live re-authorization at EVERY read (revoked manager loses access immediately — pinned). Transitions: row_version CAS (stale 409 pinned), terminal stale edits 409, requester-only withdraw, provider/staff-only spam; first_response_at captured at first acknowledgement. Response stats: only real acknowledged requests, sample size + median/average + explicit exclusion counts + not-a-quality-guarantee disclaimer; zero acknowledged = null (no fake zero). Demo persons can never be targeted (provider must have a published directory profile — pinned). 8 routes; 12 fixtures.
- **Totals this run:** +27 routes (109 -> 136), +14 structures (60 -> 74), +4 migrations (0041-0044, Supabase-first applied + verified BEFORE every push; translation checks + 44-migration scratch chain clean). Gates at close: `npm run check` FULL pass; vitest 645/10 pre-skips/0 fail (+89); python 111; tsc clean; build + dist validation green; inventories drift-free. Live: five deploys verified via the Cloudflare deployments API (latest 15:01:55Z); /api/directory/persons serves an honest empty public listing; service-requests auth-gated 401; MEDIA_ACCESS_TOKEN_SECRET active (mint endpoint returns 401 not 503).
- **Ledger: R88-plan P00-P12 done. Next: P13 (transactional notifications + accurate delivery language) -> P14 (farm workspace collections) -> P15 (shareable sale dossiers) -> P16+ (see docs/r88/agent-tasks.json).**

# R91c — 2026-10-03

- **R88-plan P07 complete — pedigree quality, coefficients and breeding evidence limits.** The reference verification tool (runs inside `npm run check`) now covers eight independently-reviewed fixture families through the FULL metrics path, pinning status/completeness/integrity alongside every number: parent-offspring (A=0.5, kinship=A/2=0.25), full/half siblings, repeated-grandsire (F=0.125), **inbred common ancestor (F=0.15625 — the (1+FA) factor verified)**, missing parents under the documented founder assumption (F=0 with completeness 33.33% and 2 assumed founders — a missing ancestor can never increase displayed certainty), boundary parent references (dangling references founder-assumed), **cyclic graph (status=cycle_detected, coefficient=null, bounded — never a hang)**, depth-1 truncation (F=0 with the depth stated and parents honestly reported as assumed founders) and node-cap truncation (status=truncated, null).
- **P07 labeling rule implemented:** `zeroWithinIncompleteAncestry` on pedigree + relationship coefficient metrics (additive to contract 2.18.0) — set only when the coefficient is exactly 0 while ancestry is incomplete. EN/FA i18n strings + the Heritage coefficient panel renders "no inbreeding detected within the available pedigree — not evidence of being unrelated or safe" for that case; a fully-known zero is NOT hedged (both directions fixture-pinned). Zero never means "unrelated" or "safe".
- **Criteria mapping (ledger-documented):** every coefficient already carries method/algorithmVersion/founderAssumption/interpretation + depth + completeness + integrity flags; cycle edits are rejected before commit with descendant rechecks (R82 guard); coefficients/relationships/optimizer compute LIVE under hard bounds (matrix 1024 nodes, 512-per-horse graphs, depth caps) so parent corrections are reflected immediately by construction, and precomputed analytics are revision-gated; the optimizer is multi-objective (low-COI 0.45 + ancestor diversity + concentration + diversity preservation) with eligibility warnings, verdicts, commonAncestors and an explicit not-genetic-merit caveat — never solely low COI/color/winning ancestors.
- Gates: `npm run check` FULL pass; vitest 556/10 pre-skips/0 fail; python 111; tsc clean; production build + dist validation green.

# R91b — 2026-10-03

- **P05 live-verification FINDING: the Workers rate-limiting binding is a no-op on this account.** Production live checks (part of P05's mandate) showed /api/auth/login admitting 46 rapid+paced attempts (auth 10/min/IP + account 5/min) and /api/relationship admitting 16 requests (expensive 12/min) with zero 429s — while the Cloudflare settings API confirms all five ratelimit bindings are deployed with correct limits and the limiter code is in the deployed bundle. A minimal probe worker (limit 3/60s) returned success 7/7 — the binding admits everything on this account, far beyond its documented eventual consistency. The config looked correct and every unit test passed; only live HTTP verification could expose the gap — exactly why P05 exists.
- **FIX: D1 fixed-window enforcement layer (migration 0040).** `rate_limit_counters` (key, window_start, count): one atomic upsert per request (`INSERT .. ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END .. RETURNING count`) both records and reads usage — race-safe under D1's serialized writes, verified by real-SQL python replay (same-window increments, new-window reset, key isolation, one-row-per-key storage bound, CHECK constraint, budgets mirror wrangler config). Limits mirror the bindings: auth 10/min/IP, write 30/min/IP, expensive 12/min/IP, account login/OTP 5/min per hashed identity. Public reads stay binding-only (cheap, cache-friendly). Fail-closed doctrine (F18): a counter failure in production = honest 503; explicit dev environments pass through. The binding stays wired as layer 1.
- **LIVE VERIFIED after deploy:** 8 paced logins to one account -> 401 x5 then **429 + `Retry-After: 60`** from the 6th attempt on. The abuse throttle is now real in production.
- Evidence: 6 new HTTP fixtures through the real Worker (throttle when the binding admits everything, per-account budget independent of IP, write-class throttle, D1 failure 503/pass-dev, public reads never touch the counter) + `tests/python/test_p05_rate_limit_counters.py` (6 replays). 0040 applied to remote D1 + Supabase (chain parity; unused on Supabase at runtime) BEFORE push. Parity re-proven on the real Supabase with all 40 migrations (0 differences). Inventory: 60 structures.
- Gates: check FULL pass; vitest 556 (+6); python 111 (+6); tsc clean; build + dist validation green.

# R91 — 2026-10-03

- **R88-plan P05 complete — actual HTTP security and abuse tests (33 fixtures through the REAL Worker entrypoint).** Frame policy: SAMEORIGIN/frame-ancestors 'self' ONLY for /classic-registry + descendants; every other page and 9 path-prefix lookalikes (case/encoding/suffix/sibling variants like /classic-registryX, /classic-registry%2F..%2Fevil, /CLASSIC-REGISTRY/) are DENY. CSP: production ships no unsafe-eval and script-src 'self' only (object-src none, base-uri/form-action self); the dev-only style relaxation stays out of production; HSTS fires only at production HTTPS ingress. Mutations: cross-origin authenticated mutations 403 origin_failed; anonymous inquiries reject cross-origin Origin AND sec-fetch-site: cross-site; same-origin passes the guard; Origin-less scripted requests remain bounded by the write limiter (an origin check is not bot prevention). Abuse: exact bucket keys pinned for all four limiter classes; login protected by BOTH the per-IP auth limiter and the per-account limiter keyed by SHA-256 (login-account:/otp-account: — raw identity never in bucket keys); every 429 carries Retry-After: 60 and a generic envelope; production WITHOUT limiter bindings fails CLOSED (503 rate_limiter_unavailable) while explicit dev environments pass through. Sessions: fresh token + csrf minted per login (rotation pinned), logout revokes + clears cookie, expired sessions rejected; login responses never echo password hash or session token. No account enumeration: wrong-password and nonexistent-account produce byte-identical 401s; recovery envelopes are identical whether or not the account exists (no demo token in production). Egress: media proxy rejects off-allowlist hosts + non-https + missing u; no API path ever 3xx-redirects; oversized login/inquiry bodies 413 even without Content-Length. ALL 33 PASSED AGAINST EXISTING CODE — the security posture accumulated through R59-R90 was already correct; P05's deliverable was exactly this evidence.
- **R88-plan P01 complete — execution-level adapter parity PROVEN on the real chosen backend.** `scripts/pg-execution-parity.mjs` + `tests/python/p01_parity_lib.py`: one canonical seed + 12-step command sequence built from the production SQL templates (versioned status writes + idempotency receipts, replay lookup, same-key-different-payload conflict, stale version marker gate, expired-listing renewal, sibling reactivation unique-index, org-grant create, inquiry status, P02 marker-conditioned revocation audit, post-revocation no-op, staff branch, concurrent same-key receipt claim) executed on a real SQLite (all migrations) AND on a real PostgreSQL in an isolated disposable schema through the PRODUCTION runtime translator. Normalized transcripts (changes, rows, error classes, concurrent winners): **0 differences**. The concurrent claim raced two REAL connections on Supabase: exactly one winner + one unique_violation — the P01 acceptance "two concurrent clients cannot execute the same command twice" proven on both engines. Evidence: `audit/2026-10-03/parity/pg-execution-parity-supabase.json` (38->39 migrations version re-proven after 0039 landed; credentials never written into the report). CI parity-postgres job now runs execution parity on every non-main push. New `scripts/lib/pg-ddl.mjs` is the single source of truth for both parity gates (no drift); `tools/ts-runtime-loader.mjs` now resolves the project-local tsc so direct `node script.mjs` runs work.
- **R88-plan P01 fail-closed startup checks (7 HTTP fixtures).** Invalid DB_PROVIDER_MODE = 500 invalid_database_provider_mode; supabase/turso single-provider modes without bindings = 503 supabase_not_configured / turso_not_configured; dual-provider failover modes are read-only for canonical writes (503 database_failover_mode_read_only); the supabase-read/d1-write split is honest (writes reach the handler on D1 and fail on AUTH, unconfigured reads fail closed); unsupported combinations can never answer 200 from a silent fallback.
- **R88-plan P04 complete — privacy matrix extended (+11 fixtures) + HTTP role matrix (6 fixtures).** Extracts: source allowlist lock + whitelist-builder runtime test + REAL hardening: `buildExtractSnapshot` now projects attestations through an explicit field list (digest-compatible for existing data) so a widened SELECT can never leak lab accessions/notes into shared documents. AI tools: horse-search selects through PUBLIC_HORSE_COLUMNS_H (source-pinned) and the public runtime refuses mutation tools. Inquiry contacts: create/status command responses never echo the buyer contact (runtime sentinel) and buyer_contact appears only in the input schema, create binds and the authority-gated seller inbox (source-scoped). Cache variants: json() defaults no-store; the ONLY public cache policy is the precomputed aggregate snapshot family (health/analytics/facets/quality); media = private, no-store; media proxy caches public allowlisted images only. HTTP role matrix through the real Worker: org member with a live grant executes the versioned command with in-write authority binds; revoked grant = 403 horse_access_required with ZERO writes; unrelated user refused before grant evaluation; stale expected_version = 409 with details.current_version; staff act through the explicit bounded branch; a missing CSRF token never reaches the command layer.
- **R88-plan P06 engineering half — genetics interpretation provenance (migration 0039, contract 2.18.0 / app 0.47.0).** Append-only `interpretation_version` + `interpreted_at` + `catalog_reviewed_by` on genetic_tests (additive, nullable, zero data mutation; Supabase + remote D1 applied BEFORE push) + `POST /api/admin/genetic-tests/:id/interpretation` (horse.edit + CSRF): the guarded UPDATE touches ONLY the provenance columns — the laboratory report (result/result_interpretation/lab fields/notes) is NEVER rewritten to match a newer catalog (SQL-shape pinned); a `genetic.interpretation.recorded` audit row lands in the SAME batch with the prior provenance preserved in before_json; the response carries raw_result_unchanged + clinical_diagnosis:false + scope recorded_genotype_only. Privileged projections expose the reviewed provenance; the public projection is unchanged. `tools/audit-legacy-genetics.mjs` is the P06 read-only legacy report (no apply mode by construction): canonical Supabase results — 332 AGOUTI_ASLIP rows quarantined unchanged, 0 DUN_TMEM38, 0 CREAM_SLC36A1 (zero ambiguous cream/champagne rows), 0 uncatalogued disease rows; no global SLC36A1 rename because valid champagne records use it. 18 catalog fixtures (PSSM1/MH single-copy = AFFECTED pins per UC Davis, one-copy/two-copy genotype identities, not-tested/empty/pending never clear, NO commercial PSSM2 — source-pinned, conflict disables only that assay) + 6 endpoint fixtures. The dated qualified-reviewer sign-off of the assay table remains owner-gated.
- Gates: `npm run check` FULL pass; vitest 550/10 pre-skips/0 fail (+70: 33 P05 + 7 fail-closed + 6 role matrix + 11 matrix + 18 catalog + 6 interpretation minus version-pin updates); python 105 (+14 parity + determinism); tsc clean; production build + dist validation green; inventory 109 routes / 59 structures / 39 migrations drift-free; pg-execution-parity PARITY PROVEN (0 differences).
- Next per plan order: P07 (pedigree quality, coefficients and breeding evidence limits) -> P08 (reproduction/calendar semantics) -> P09 (secure evidence upload) -> P10+. Owner-gated items unchanged (qualified genetics reviewer sign-off, providers, prices, genetics vocabulary review, pilot timing).

# R90 — 2026-10-03

- **R88-plan P03 complete — versioned, idempotent marketplace commands (migration 0038, contract 2.17.0 / app 0.46.0).** Every mutable marketplace command (listing create/status/renew, inquiry create/status) is now ONE guarded transactional D1 statement with three guarantees the previous per-field guards could not give together: (1) optimistic concurrency — `row_version` starts at 1, every read exposes it, every mutable command increments it, edits REQUIRE `expected_version` and a stale write is a 409 `listing_version_conflict`/`inquiry_version_conflict` carrying `details.current_version`; (2) idempotency — an `Idempotency-Key` header (scoped to actor+command+target, sha256 canonical-JSON digest) claims a durable receipt in `command_receipts` persisted IN THE SAME BATCH as the write and gated on the P02 operation marker, so a receipt can only exist for an execution that happened; same key + same payload replays the stored response (`Idempotency-Replayed: true`), same key + different payload is a 409; (3) in-transaction authority — horse existence, seller identity and the live active-grant predicate (direct + organization-membership path, staff/editorial as an explicit bound branch) are evaluated inside the write, so a grant revoked or horse deleted between the guard read and the write is a zero-row no-op -> 403/404, never a success on stale permission.
- **New renewal command closes a real dead end:** `POST /api/market/listings/:id/renew` (expected_version + extend_days 7-365, default 90) extends `expires_at` from now and reactivates an EXPIRED listing to active in the same statement — previously an expired listing could only move to draft and draft->active re-checked the stale expiry, so expiry was permanent. Reactivating an expired listing whose horse already has another active listing trips the per-horse partial unique index and maps to the same clean 409 `listing_exists` as a conflicting create.
- **Doctrine pins:** a listing sold is NOT an ownership transfer (the status statement writes sales_listings only — proven by a full horses/horse_people/horse_access_grants snapshot compare in the python replay); inquiry contact fields stay private to a live manage_inquiries grant (inquiry-status response carries no contact fields; /api/market/mine filters on the CURRENT grant).
- **Client adapters (contract 2.17.0):** `MarketListingRecord.row_version`, `market.renew`, required `expectedVersion` on setStatus/setInquiryStatus, `idempotencyKey` request option -> Idempotency-Key header; mock client aligned (honest 501s + row_version). The three inquiry UIs (Heritage Marketplace, EquiData, FEI Classic) generate a per-intent idempotency key and, on a 409 conflict, disable the mutation controls and reload the listing — controls re-enable only after a fresh version has loaded.
- **Evidence:** `tests/unit/marketplaceCommands.test.ts` (36 vitest fixtures: version conflicts, replay/conflict/concurrent-claim, authority races, grant-predicate SQL mirror, source locks) + `tests/python/test_p03_marketplace_commands.py` (21 real-SQL replays on all 38 migrations, regex-extracting and executing the EXACT production templates: marker gate, racing writer cannot mint receipts, revoked grant/deleted horse zero-rows, org-grant path + membership revocation, sold != ownership transfer, receipt PK + command/status_code CHECKs). The replay caught two REAL pre-deploy bugs: SQLite (D1) requires the AS keyword for UPDATE target aliases (`UPDATE sales_listings l` was a syntax error), and the template conversion had dropped the create statement's staff branch (23 placeholders vs 24 binds).
- **Supabase-first:** migration 0038 applied + verified on the canonical Postgres (4 additive columns + command_receipts + index; 140 listing rows backfilled to row_version=1) and on remote D1 BEFORE the push — both databases in sync, no 500 window.
- Gates: `npm run check` FULL pass; vitest 480/10 pre-skips/0 fail (+36); python 91 (+20); tsc clean; production build + dist validation green; inventory 108 routes / 59 structures / 38 migrations drift-free.
- Next per plan order: P05 (actual HTTP security/abuse tests — P00+P04 done enough to start), P01 parity suite remainder, P04 matrix extension, then P06+. Owner-gated items unchanged (providers, prices, genetics vocab review, pilot timing).

# R89 — 2026-10-03

- **Master-Ai R88 audited-source merge + first execution round of their 40-ticket continuation plan (P00 done, P02 done, P01/P04 in progress).** Owner uploaded the Master AI's response (`Master-Ai-Full-Response.md`) and `horse-registry_R88_audited-source.zip` to the vault; both repos were pulled first (sandbox had rolled back to R70 again — GitHub stayed the source of truth at 2bcade2/8b1fe3d).
- **R88 merge (a0f9036, app 0.45.0 / contract 2.16.0):** verified the package base against our repo (0 unexpected diffs over 607 files), merged all 29 modified + 70 new files (docs/r88 plan + audit evidence, demo-workbench + business-model static pages, four frontend density token sets + compact layers, security/framePolicy + origin + timestamps modules, marketplace policy, genetics fixes). Then ran every gate the Master AI's environment COULD NOT run, all green: full `npm install` from lockfile, `npm run check` FULL pass (incl. the three R31 AI docs their export lacked), `tsc` clean, vitest 434/0, python 59, `test:r88` suites, 142 offline DOM assertions, production build + dist validation. Three merge fixes: route inventory 106->107, lockfile 0.45.0 sync (npm-generated), one tsc spread-cast fix in marketplace.ts media mapping.
- **R88 fixes absorbed (their 12 FIX items):** marketplace genetics through the shared privacy projection, grant/membership validity via strict timestamps, listing/inquiry state machines + CAS + origin/CSRF guards, same-origin Classic frame exception, PSSM1+MH dominant inheritance with dated UC Davis references, genotype-identity retest conflict detection, legacy locus quarantine (no history rewrite), Gregorian/Solar-Hijri breeding-season + partial-date interval honesty, delivery-language honesty, four independent frontend density layers.
- **Plan P02 DONE (e19cea9) — atomic, auditable revocation:** migration 0037 adds `last_operation_id` markers; the revoke UPDATE stamps the marker and the matching audit event is an `INSERT..SELECT` gated on THIS marker having landed, so a repeat revoke, a racing second writer or a nonexistent target can never mint a successful-revocation audit row (the old code committed an unconditional audit INSERT even when the UPDATE matched nothing). myGrants normalized to the authorization policy (datetime-normalized validity windows, deleted horses hidden). Evidence: 1 new vitest fixture + 11 python real-SQL replays on all 37 migrations (success = exactly one audit row; repeat = no-op + no second row; racing marker cannot mint; nonexistent = zero rows; myGrants future/malformed/exact-expiry/revoked/deleted parity). Supabase-first: 0037 applied + verified BEFORE push (2 additive nullable columns, 0 data changes).
- **Plan P04 in progress (dc8eed2) — whole-platform privacy matrix:** `tests/unit/privacyMatrix.test.ts` plants distinctive sentinel strings in every private field class (unpublished genotype, lab accession, staff notes, interpretation, precise address, chip/file/passport identifiers, description, raw source note) and scans every anonymous/ordinary public output path at once (horse profile, search, genetics, breeding); privileged visibility asserted as a documented boundary; source-level locks (getHorse allowlist constant, marketplace feeds projectGeneticTests, admin list is the only precise_address carrier). Remaining: exports/documents/AI-tool-response/cached-variant coverage + HTTP-level role matrix.
- **Plan P00 DONE + P01 doc half (7deb019):** `docs/r88/P00-BASELINE-EVIDENCE.md` (environment, lockfile sha256 stability, all restored-baseline gates, honest open limits, vulnerability review — prod deps 0, 7 dev-tooling advisories recorded) + `docs/r88/P01-TOPOLOGY-ADR.md` (Cloudflare Workers + Supabase Postgres canonical via Hyperdrive + D1 failover, live since R59; execution-level parity suite scoped as the open remainder). `docs/r88/agent-tasks.json` statuses updated only where acceptance evidence exists (P00/P02 done; P01/P04 in progress with notes).
- Gates this round: `npm run check` FULL pass; vitest 444/10 pre-skips/0 fail (9 new privacy-matrix fixtures); python 66+5; tsc clean; 37-migration scratch chain + 0037 translation clean; inventory 107 routes/58 structures drift-free; build green.
- Next per plan: P03 (row_version + command receipts for marketplace), P05 (HTTP security/abuse tests), P01 parity suite remainder, P04 matrix extension. Owner-gated items unchanged (providers, prices, genetics vocab review, pilot timing).

# R87 — 2026-10-03

- **Pure-source export for the reviewer AI + continuity-docs sync (no code change).** Owner asked for a zip of ALL source code (no assets, no logs, no docs, nothing non-code) to send to the reviewer AI for another review pass. Built `horse-registry-pure-source_R87_<hash>.zip` from a clean tracked-file snapshot of this commit: src/ (ts/tsx/css/json only), tests/, migrations/, tools/, scripts/, standalone-frontends/classic-v1.4/ (donor app source, no WAV), supabase/ SQL, .github/workflows CI, root configs (package.json, tsconfig x4, vite/vitest/wrangler, index.html, .env.example — blank placeholders only, zero secrets). Stripped: public/ (site assets + the embedded BUILD copy of classic-registry — its true source ships in standalone-frontends/), src image/font assets, docs/, audit/ (AI plan packages + evidence), sandbox/ (workspace scripts + derived schema dumps), seed/demo.sql, package-lock.json, Windows launchers, all markdown. A PACKAGE-INFO.txt manifest inside the zip states provenance + contents + how to verify. The zip is archived in the VAULT repo `exports/` (like the R69 and R78 exports before it), not in this repo.
- **Docs sync fix**: R86 updated the vault continuity backups but main-repo TODO.md/CHANGELOG.md/PROJECT-MEMORY.md still said R85 (missed in the R86 push). Synced all three from the vault backups (verified proper supersets first: CHANGELOG +R86 entry only, MEMORY +R86 section only, TODO R86 status block). No code, config, migration or route changes — this deploy is byte-identical in behavior to R86.

# R86 — 2026-10-03

- **Triple-check of all three AI packages (owner request) + Master-Ai T13 engineering half.** Fresh-extracted all three original zips (A1 audit-and-fixes, A2 audit-and-handoff, Master Architect-Planner packet) and re-verified every ticket/finding against the live code at 7c84c12, re-running the full gates as evidence (npm run check FULL pass). Verdict documented in `audit/2026-10-03/TRIPLE-CHECK-R85.md`: A1 (44 tickets) and A2 (40 tickets) have NOTHING implementable missing; every still-open row is owner-gated or tracked P2/post-launch, and several R76-era open rows have since closed (issuer model = T05/T06 in R81, genetic interpretation = T04/T26 in R80, seller authorization = T10 in R83). Master packet: 12/45 tasks delivered (T00-T12 + T26, plus T01 scaffolds awaiting owner sign-off), 15/28 findings closed, the 13 open findings all map to not-yet-started tasks (T13-T45) — nothing silently dropped.
- **T13 finding F17 CLOSED (email token race)**: signup verification tokens are now consumed via ONE conditional `UPDATE ... RETURNING` (`CLAIM_EMAIL_VERIFICATION_SQL`, scoped `purpose='signup'`) — the SELECT-then-UPDATE race window is gone; concurrent double-clicks/prefetchers/replays cannot both win. Password-reset tokens have their own CAS claim and are NOT consumable through /verify-email.
- **T13 finding F18 CLOSED (rate limiter fail-open)**: a missing limiter binding now fails CLOSED in production/unknown environments (honest 503 `rate_limiter_unavailable`) in BOTH `enforceRateLimit` and `enforceAccountLoginLimit`; only explicit development/test/local environments keep the permissive local posture.
- **Password recovery without staff DB access (T13 acceptance)**: `POST /api/auth/recover/request` (anti-enumeration — identical envelope for existing/unknown/disabled accounts; prior outstanding tokens voided; exactly one fresh single-use SHA-256-hashed 30-minute token in `email_verifications` purpose='password_reset' — migration 0029 already allowed it, so ZERO new migrations) + `POST /api/auth/recover/confirm` (CAS claim + password rotation + revocation of ALL sessions in one batch — a stolen session never survives a reset; replay/race losers get the same generic 400 invalid_token as unknown/expired tokens).
- **`POST /api/auth/change-password`** (authenticated + CSRF; verifies the current password first with a generic no-leak 403; rejects an unchanged password with 422; rotates and revokes every OTHER session, current stays signed in) and **`POST /api/auth/sessions/revoke`** (authenticated + CSRF device sign-out with a revoked count).
- **Provider interfaces, owner-gated activation (honest-unavailable posture unchanged)**: `src/notifications/sms.ts` = Kavenegar verify/lookup adapter (official wire contract, 8s timeout, configuration/network/timeout/provider-rejected failure taxonomy, Iranian-mobile validation) and `src/notifications/email.ts` = generic HTTPS email adapter (bearer JSON — Workers cannot do raw SMTP) with bilingual signup/reset templates and `EMAIL_PUBLIC_BASE_URL` action links. `requestOtp` REALLY sends when the owner configures Kavenegar (`delivery:'sent'`; honest 503 `sms_delivery_failed` on outage — the challenge row only lands after successful delivery) and `verifyOtp` is gated symmetrically. A demo code can NEVER appear in a production response (gated on `!isProduction && delivery==='demo'`). `register` honestly reports `delivery:'sent'` when the email provider delivers. Six new owner-gated worker secrets documented in the env d.ts.
- **Rate-limit classification**: the four new endpoints joined the strict auth class (10/min/IP + D10 per-account protection); recover/request automatically receives per-account email throttling.
- **hashPassword consolidation**: moved to `src/auth/password.ts` beside `verifyPassword` (single canonical PBKDF2-SHA256 100k implementation — deliberately equal to the Workers runtime cap; authExt re-exports for compatibility).
- **Docs**: API.md gains the recovery-workflow section + the OTP delivery-honesty contract; route inventory 102 -> 106 (validator-verified drift-free); TRIPLE-CHECK-R85.md archived in the repo.
- Gates: npm run check FULL pass (all validators; inventory 106 routes/58 structures/36 migrations); vitest 434/10 pre-skips/0 fail (36 new authRecovery fixtures); python 49; build + production asset validation green. Additive only — no migrations, no schema change, no data mutation. **T13 remainder (next batch): staff MFA (TOTP enrollment + backup codes + login enforcement) + the owner half (Kavenegar/email provider accounts and sender approval).**
# R85 — 2026-10-03

- **Master-Ai plan T12 complete: profile facts, temporal relations and dates.** Following the R84b typed-dates foundation (`src/registry/dates.ts`, precision-typed RegistryDate + jalaali conversion + honest age ranges), this batch wires the typed dates, places, ownership periods, lifecycle events and the parent-correction review path end-to-end. One additive migration (0036), no destructive change; legacy raw columns preserved (rollback per plan).
- **Migration 0036 (`migrations/0036_horse_profile_history.sql`)**: `horses` gains the typed-date column triples for birth/death/castration (value + precision + explicit calendar gregorian|solar_hijri, CHECK-guarded), the raw `birth_date_source` note, public `birth_city`/`birth_province`/`keeping_city`/`keeping_province`, and the **private** `precise_address` (never in any public projection or the reviewed-change whitelist — PII stays out of the review queue). Honest backfill: every legacy `birth_year` row (78,089 on Supabase) gained its typed projection as ('year', 'gregorian') — a year-only DOB stays a year, no invented January 1. Two new tables: `horse_ownership_periods` (historical title with optional co-ownership share_percent, evidence note + source; overlap/share rules enforced application-side because they are precision-aware) and `horse_lifecycle_events` (death/castration/retirement/export/import/other with uncertain_time honesty flag).
- **`src/registry/relations.ts` (the plan's proposed temporal-relations module)**: precision-aware ownership overlap detection (a period projects onto its CERTAIN Gregorian day-interval — a year-only start covers the whole year; two periods are flagged `definite` only when every possible dating intersects, `possible` when the facts cannot decide, and never when provably disjoint), co-ownership share-sum guard (<= 100% of a horse), lifecycle event validation, and the parent-correction submission schema (reason + evidence source mandatory, at least one parent change, null = clear).
- **Shared field rules (T07 single source)**: `birth_date`/`death_date`/`castration_date` typed-date objects and the four public place fields joined `HORSE_FIELD_SCHEMAS`; they flow through direct edits, reviewed change requests (whitelist 12 -> 19) and structured submissions with the SAME rules. `precise_address` is direct-editorial-only. The mutation builder expands a typed date into its column triple and syncs the legacy `birth_year` bucket (search/filters stay honest); setting a death date implies `is_dead=1`, clearing it never resurrects a legacy-dead horse.
- **New endpoints** (route inventory 98 -> 102, machine-checked): public `GET /api/horses/:id/lifecycle` + `GET /api/horses/:id/ownership`; editor `POST /api/admin/horses/:id/ownership-periods` (definite overlap -> 409, possible overlap reported as `possible_overlap_period_ids`, shares > 100 -> 409) and `POST /api/admin/horses/:id/lifecycle-events` (death/castration events land the canonical typed date + is_dead on the horse row in the SAME guarded batch — record and history can never disagree). `GET /api/horses/:id` now returns assembled `birth_date_typed`/`death_date_typed`/`castration_date_typed` objects plus the public places.
- **Parent-correction review path**: `POST /api/change-requests` with request_type update_horse + a structured `parent_correction` payload (kind, horse_id, father_id/mother_id as existing ids or null-to-clear, reason, source, optional conflicting_evidence). Creation, edit and approval all re-validate the asserted parents against the CURRENT pedigree graph (existence, cycles, plausibility); approval applies through the same guarded mutation service as a direct edit (cycle guard + version CAS + reindex + decision in one conditioned batch).
- **UI**: the horse profile renders typed dates in the viewer's locale calendar (Persian = Solar Hijri with Persian digits, English = Gregorian) with precision honesty labels, plus birth/keeping city-province and the typed death date; the submission form gains the typed birth date (value + precision + calendar) and the four place fields; the Heritage admin editor and the EquiData governance console edit all new fields including the private precise address (staff-only).
- **Tests**: 32 new fixtures in `tests/unit/registryRelations.test.ts` — overlap semantics (definite/possible/disjoint, open-ended periods, Solar Hijri windows), share sums, period validation, lifecycle validation (uncertain time, future dates, Esfand-30), parent-correction contract, typed-date parsing (Feb 30/month 13 refused, year-only preserved, null clears), mutation-builder column expansion + is_dead semantics. Whitelist count fixtures updated (12 -> 19). Totals: vitest 398 passed / 10 pre-existing skips / 0 failed; python 49; `npm run check` FULL pass; 36-migration scratch chain clean; 0036 Postgres translation clean; build + asset validation green.
- **Supabase-first**: 0036 applied to the canonical database BEFORE push via `scripts/apply-0036-to-supabase.mjs` (15 columns + 2 tables + 2 indexes + 3 CHECK constraints verified; 78,089/78,089 legacy year rows backfilled honestly).

# R84 — 2026-10-03

- **Master-Ai plan G2 batch 2 delivered: T11 complete new-horse submission and review.** An owner can now register a horse end-to-end without SQL and without an editor re-typing it: structured submission -> reviewed approval -> exactly one searchable canonical horse with provenance. One additive migration (0035), no destructive change, no mutation of existing rows.
- **Submission payload (`src/registry/submissions.ts` + migration 0035)**: `change_requests` gains `submission_json` (the typed payload), `review_outcome` ('needs_changes' recorded outcome), `canonical_horse_id` (set only after the created horse actually landed) and `idempotency_key`, with a PARTIAL UNIQUE index on (submitter, key) so a double-submitted request replays the original row instead of duplicating. The payload validates through the SAME T07 shared field rules (one source of truth) plus submission-specific guarantees: at least one name (native-only is fine — the Latin transliteration is optional content, never invented; when absent the NOT NULL name_latin column stores the native name verbatim while submission_json keeps the honest record); parents only as EXISTING registry ids (existence + liveness + sex-role policy checked at submit, edit AND approval time) or as explicit unresolved assertions with a source note — parent profiles are never created automatically, so duplicate parents are impossible by construction; optional breeder/current-owner person references verified against the people registry.
- **The submission state machine**: `draft` -> (submit) -> `pending` -> (`needs_changes` -> back to `draft` for editing, explanatory note mandatory) -> `approved` | `rejected`; `withdraw` exits from draft/pending. The 0001 status CHECK is deliberately NOT widened (SQLite cannot ALTER a CHECK; a table rebuild would cascade-delete every change_request_items row): needs_changes is stored as status='draft' + review_outcome='needs_changes' and surfaces as the computed `review_status` on every API response. New endpoints: `PUT/PATCH /api/change-requests/:id` (edit own draft — re-validated with the full create-path rules, an edit can never weaken the guarantees), `POST /api/change-requests/:id/submit`, `POST /api/change-requests/:id/withdraw` (both CAS-guarded, 409 unless own draft/pending). Route inventory 95 -> 98 entries, machine-checked drift-free.
- **Atomic approval — the core acceptance guarantee**: approving a create_horse submission runs ONE D1 batch (single transaction): canonical horse INSERT conditioned on the request still being undecided -> identifier claims INSIDE the same transaction with the fresh horse id resolved by subquery on last_mutation_id (no client id, no intermediate read, no follow-up batch that could leave a partial horse) -> horse_people links for the declared owner + breeder -> initial owner grant (minted ONLY when the declared current owner is a VERIFIED user_person_links link of the submitter — T10 doctrine: permission stays explicit, a data contributor gets no grant) -> approval decision conditioned on the horse actually having landed -> registry revision + live counter bumps. Any failure — a duplicate live identifier (hard partial-unique guarantee from T08), a lost review race (second approve = 409 change_request_closed; a concurrent approval batch no-ops because every effect is conditioned on the open state), a stale parent reference (409 submission_references_stale) — leaves the submission PENDING with NO partial canonical horse. `canonicalApplied: true` and `canonical_horse_id` are reported only after the created record is read back from the database. Search indexing + audit settle through the same canonical mutation journal as every other horse write (reconcilable, never silently lost).
- **Honest labeling instead of review-only approval**: summary-only create_horse requests are refused up front (422 structured_submission_required); legacy create_horse rows without a structured submission cannot be approved (422 legacy_create_horse_without_submission — they are never silently approved review-only); the ownership request type stays review-only and every approval response carries `ownership_note: ownership_via_claims_workflow` pointing title transfers at the claim + grant workflow, exactly as the plan demands.
- **UI**: new `HorseSubmissionPage` at `/f/heritage/desk/submit` (bilingual EN/FA, linked from the Registry Desk "Register a new horse" entry): the full submission form with native/Latin names, identifiers, shared fields, per-parent mode pickers (existing registry horse / unresolved source assertion / not stated), draft save, submit, withdraw, needs_changes round-trip with the reviewer's note shown, and the submitter's submission list with the created-horse link. The staff admin queue gains a "Needs changes" decision (note-prompted) and reports the created horse id on approval. The legacy desk quick-form no longer offers the now-structured create_horse type.
- **Contracts + clients**: ChangeRequestRecord gains submission/review_outcome/review_status/canonical_horse_id/submitted_by_user_id; create input gains submission/idempotency_key/submit; PlatformClient.changes gains update/submit/withdraw; admin review decision type gains needs_changes; mock client implements the full honest state machine (including 409s and the note requirement — the demo never fakes a canonical creation).
- **Supabase-first deploy discipline**: 0035 applied to the Supabase canonical database BEFORE the push via `scripts/apply-0035-to-supabase.mjs` (4 columns + 2 indexes verified; canonical_horse_id is bigint matching horses.id; the idempotency index verified as a true partial index). D1 applies 0035 automatically through the deploy workflow.
- **Tests**: 37 new vitest fixtures in `tests/unit/registrySubmissions.test.ts` — payload contract (native-only, both-parents-forms exclusivity, shared-field windows, id rejection), storage shape (no client id, native-verbatim fallback, last_mutation_id provenance), review-status surface, the atomic-batch SQL templates (conditioning, subquery id resolution, grant link verification, no unconditioned horse writes), idempotency replay, and source-anchored wiring locks (routes dispatched, structured-submission requirement, legacy refusal, needs_changes vocabulary, inventory rows, API.md). Scratch chain: all 35 migrations apply cleanly. Totals: vitest 348 passed / 10 pre-existing skips / 0 failed; python 49 passed; `npm run check` FULL pass; production build + asset validation green.

# R83 — 2026-10-03

- **Master-Ai plan G2 batch 1 delivered: T10 people, organizations and horse-scoped grants.** Closes the R59 fact-check #11/#12 gaps (F05 cluster): the account role `owner` was never a per-horse permission — owners could do nothing on their own horses, and media/listing writes were editorial-only. One additive migration (0034), no destructive change, no data mutation of existing rows.
- **Representation separation (migration 0034_representation_grants.sql)**: `user_person_links` (verified account↔person links, UNIQUE(user_id,person_id)), `organizations` (slug-identified stables/breeders/clubs/associations/services), `organization_memberships` (validity-windowed, revocable roles, UNIQUE(organization_id,user_id)), `horse_access_grants` (horse-scoped permission register: relationship owner/breeder/manager/seller, comma action list, basis claim_approval/admin_grant/organization_mandate + basis_ref provenance, validity window, full revocation audit; CHECK at least one grantee). Legal ownership (`horse_people`) stays the historical record; a grant is a permission to act — the two are deliberately distinct (a manager can hold an active grant without being the recorded legal owner).
- **Grant vocabulary + action sets (`src/access/horseAccess.ts`)**: four actions (manage_profile, upload_media, create_listing, manage_inquiries) with mandate-shaped sets — owner: all four; breeder: profile+media; manager: profile+media+inquiries; seller: listing+inquiries only. Stored action lists can only NARROW a relationship's set, never widen it (storage is defense-in-depth filtered against RELATIONSHIP_ACTION_SETS). Validity states: active/revoked/expired/not_yet_valid; revocation wins over everything.
- **Horse-scoped authorization**: `authorizeHorseAction`/`requireHorseAction` guard — editorial staff (editor/admin/super_admin) keep their platform capability (unchanged model); every other account needs an active grant covering the exact action on EXACTLY this horse. `403 horse_access_required` is the cross-account IDOR boundary: Owner A can never upload, edit, propose on, or sell Horse B. Lookup SQL resolves direct user grants + grants to organizations where the viewer holds an active membership (revoked/expired memberships contribute nothing), with a second TypeScript-level filter on grantee+horse as defense-in-depth on top of the SQL WHERE.
- **Wiring (every horse write endpoint is now grant-scoped)**: `POST /api/horses/:id/media` (uploadHorseMedia) and `POST /api/market/listings` (createListing) switched from the role-only `horse.edit` gate to `requireHorseAction(upload_media / create_listing)` — the R59 "until per-horse ownership scoping exists" interim posture is retired. Claim review approval (`reviewClaim`) now mints the owner-mandate grant in the SAME reviewed batch (R74 REV-01 discipline: INSERT conditioned on the decision having landed — a losing concurrent reviewer can never mint a permission), with `basis_ref` = the claim id as provenance; response now also reports `accessGranted` honestly (approval confers the permission even when the claim carries no person record, so no legal owner link). Change-request creation accepts the owner-role path (unchanged) OR an active manage_profile grant (managers/breeders can propose without any global permission). Media delete keeps uploader/staff rule (already correctly scoped).
- **New endpoints**: `GET /api/horses/:id/actions` (backend-computed per-horse actions for the signed-in viewer — the UI asks the backend, it never re-derives permissions from the account role; anonymous viewers get an honest empty set), `GET /api/grants/mine` (owner self-service dashboard), `GET /api/admin/grants?horse_id=N` (full grant register incl. revoked rows — staff support-access audit), `POST /api/admin/grants/:id/revoke` + `POST /api/admin/org-memberships/:id/revoke` (immediate, reason-required, audited, CAS on the open state so double-revoke is a clean 409; an org-membership revocation stops every org-mediated grant path on the next request).
- **Client + UI**: `modules.access.horseActions/myGrants` added to contracts + real client + mock (mock returns honest empty grants — the demo never fabricates permissions). Heritage media gallery now fetches the per-horse actions for signed-in non-staff viewers instead of only checking the role-based permissions hint.
- **Inventories + docs**: route inventory 91→95 entries (4 new rows + actions in the shared horseModuleMatch regex), data inventory 52→56 structures — both machine-checked drift-free; API.md workflow semantics updated (claim approval = review-only for horse DATA but mints the explicit PERMISSION; grants never legal title) + new Access-grants section.
- **Supabase-first deploy discipline (R81 lesson, R82 pattern)**: 0034 translated through the production converter (`scripts/generate-0034-postgres-ddl.mjs`) + the two inline SQLite UNIQUE constraints the converter drops appended by hand (uq_user_person_links_user_person, uq_organization_memberships_org_user), then applied to the Supabase canonical database BEFORE the push (`scripts/apply-0034-to-supabase.mjs` — verified 4 tables + 5 indexes + 3 CHECKs + 2 UNIQUEs live). D1 applies 0034 automatically via the deploy workflow.
- **Tests**: 31 new vitest fixtures in `tests/unit/horseAccess.test.ts` (vocabulary/mandates, validity windows incl. revocation-wins, action narrowing, active-only merging, IDOR boundary on viewer + authorize paths, co-ownership, delegated seller, per-horse scoping, expired/revoked immediacy, conditioned claim-approval mint, CAS revocation + audit row, mandatory reasons, org-membership revocation, slug rules, plus source-anchored wiring fixtures locking media/marketplace/routes to the grant guard and the inventories to the new routes). Scratch-chain check: all 34 migrations apply cleanly. Totals: vitest 311 passed / 10 pre-existing skips / 0 failed; python 49 passed; `npm run check` FULL pass; production build + asset validation green.

# R82 — 2026-10-03

- **Master-Ai plan G1 batch 3 delivered: T07 unified canonical horse mutations + T08 identifier integrity at commit time + T09 search invalidation & mutation observability.** Gates G1 items now complete through T09. One additive migration (0033), no destructive change, no data mutation of existing rows.
- **T07 — one typed mutation service (`src/registry/validation.ts` + `src/registry/mutations.ts`)**: direct edits, reviewed change-request applies and creates all plan through `planHorseMutation` — the reviewed path previously bound the RAW proposed_value (a name submitted as `"  Shadow  "` passed validation but stored WITH its whitespace; Zod transforms were discarded). Now only normalized parsed values are ever stored, on every path. Stale submitted base values BLOCK approval with a 409 `stale_base_values` carrying safe per-field differences (submitted old vs current; proposed values never leak) — the reviewer must explicitly reconfirm via `confirm_stale: true`; the old post-commit `staleFields` warning is gone. Sex-role policy added to `validateParentAssignment` (runs on every create/update): an explicitly female-role horse or gelding cannot be sire, an explicitly male-role horse cannot be dam; unknown/free-text sex passes (legacy data is never guessed) — EN (stallion/colt/mare/filly/gelding) + FA (نریان/مادیان/اخته) terms. Parent cycle/self-parent/invalid-parent guards unchanged and shared. Main strain / sub strain are now editable on the DIRECT paths (create + update) exactly like the reviewed path (parity requirement), with contract (`HorseCurationInput`) + EquiData governance console + admin-record-parity coverage updated.
- **T08 — identifier integrity (`src/registry/identifiers.ts` + `migrations/0033_horse_identifiers.sql`)**: new `horse_identifiers` table (kind, issuer_namespace, normalized_value, raw_value, horse_id, status live/superseded/conflict/archived, source_id) with a PARTIAL UNIQUE INDEX on (kind, issuer_namespace, normalized_value) WHERE status='live' — the old TOCTOU race (two concurrent creates both passing the application-level duplicate check) is now database-enforced "at most one accepted live identifier"; the loser's whole batch rolls back (D1 + Supabase-full batches are single transactions) and surfaces as 409 `duplicate_identifier` with the live holder for authorized operators. Persian/Arabic-Indic digits normalize to ASCII; leading zeros preserved (values never numerically coerced); registry numbers are issuer-scoped (`registry:platform` for new editorial writes; legacy import backfilled under `registry:legacy:unattributed` — the unknown legacy issuer is never guessed); microchips globally scoped. Reassignment supersedes (never deletes) the previous live row; archiving a horse retires its identifiers with it. Auto-id creates attach identifiers in a guarded follow-up batch and roll the fresh row back (conditioned on last_mutation_id) if a concurrent writer claimed the identifier. Providers that miss the 0033 migration degrade gracefully (`identifierTableReady` negative-cache probe skips identifier statements; the application-level duplicate guard still applies) — no 500 window. New `identifier_conflicts` admin queue + idempotent backfill/audit tool (`scripts/audit-identifier-conflicts.mjs`, dry-run + apply, SQLite and Postgres): production backfill applied to Supabase — 74,182 live horses scanned, 204,824 live identifier rows, 4,498 legacy collision groups recorded as 35,443 conflict rows + 35,443 admin-queue entries (kept = lowest live horse id; no horse deleted or merged, exactly as the plan requires). Scratch-DB check applies the full 33-migration chain cleanly and proves the unique index behavior (`scripts/verify-migrations-scratch.mjs`).
- **T09 — search invalidation & observability (`src/registry/impact.ts`)**: REAL BUG FIXED — a reviewed parent rename never queued the children for search reindex (the direct path did), so children's denormalized father_name/mother_name search text stayed stale forever; the shared mutation builder now queues direct children on name changes through BOTH paths (Python replay fixture added: `test_reviewed_parent_rename_queues_direct_children_for_search_reindex`). Impact computation centralized (`horseMutationImpact`); deeper pedigree/analytics caches still go through canonical_revision + analytics_stale (no unbounded synchronous recomputation). Admin dashboard gained a `mutationObservability` block: reindex queue count + oldest-job age (dialect-portable — computed in JS from MIN(queued_at), no julianday), failed mutations (last_error within 7 days), pending search/audit work, canonical revision (T09: "expose queue age, failed mutations and canonical/search revision lag; make reindex jobs idempotent" — refresh remains delete+insert idempotent with attempts+retry).
- **Supabase-first deploy discipline (R81 lesson applied)**: migration 0033 was translated with the production converter (`tools/sqlite-to-postgres-schema.mjs` via `scripts/generate-0033-postgres-ddl.mjs`) and applied to the Supabase canonical database BEFORE the code push — production never wrote to a missing table this time. Runtime SQL verified dialect-portable (CURRENT_TIMESTAMP → UTC text; no julianday/autoincrement in runtime statements; 4 new translation fixtures). D1 applies 0033 automatically via the deploy workflow; D1's horse_identifiers backfill is intentionally deferred (it fills organically from new writes; full backfill only needed if ever reverting to d1_only — documented in scripts).
- **Tests**: 42 new vitest fixtures (registryValidation 6, registryIdentifiers 13, registryMutations 12, registryImpact 11 incl. sex-role 6, translation 4) + 1 new Python replay; python review-race suite re-pointed at the shared builder's exported SQL templates (HORSE_UPDATE_SQL_TEMPLATE etc.) so source and replay cannot drift. Totals: vitest 280 passed / 10 pre-existing skips / 0 failed; python 49 passed; `npm run check` FULL pass (all validators incl. admin-record parity re-derived from HORSE_FIELD_SCHEMAS; inventory docs updated to 52 structures); production build + asset validation green.

# R81 — 2026-10-03

- **Master-Ai plan G1 batch 2 delivered: T05 issuer attestations + T06 versioned registry extracts** (findings F03 + F04 closed; the R80 interim F03 guard is now the shared `stripCallerAuthority` policy used by genetics creates). Two additive migrations (0031 trust_attestations, 0032 registry_extracts), no data mutation, no destructive change.
- **T05 (F03) issuer attestation substrate**: new `src/trust/policy.ts` + `src/trust/attestations.ts` + `migrations/0031_trust_attestations.sql` (issuers, issuer_memberships with validity windows + revocation reasons, evidence-bound attestations with field scope + revocation/supersession semantics, append-only attestation_events audit log). Four verification levels defined as distinct non-authority concepts (owner_declared < imported_unverified < platform_reviewed < issuer_attested; none is a universal quality guarantee) with EN+FA limitations text that travels with every public display. Attestation power comes ONLY from a valid issuer membership — platform staff (incl. super_admin) cannot mint or impersonate issuer attestations (403 no_membership). Self-review blocked (cannot attest media you uploaded, nor use your own upload as evidence). Horse binding derived from the record, never the caller (400 scope_mismatch on contradiction). Revoke/supersede require a reason and write the append-only event log; supersession re-runs the full issuance checks for the replacement. 16 vitest fixtures (forged provenance stripping, expired/revoked/not-yet-valid/foreign-issuer memberships, suspended issuers, self-review both paths, record-derived horse binding, reason-required revocation).
- **T06 (F04) versioned registry extracts**: new `src/trust/extracts.ts` + `migrations/0032_registry_extracts.sql`. Issuance captures a canonical, visibility-filtered JSON snapshot (public facts + attestation references + legal status; private evidence can never enter because it is never read), hashes THE PAYLOAD (stableStringify: recursive key-sort, so digests are a function of facts, not insertion order), and issues a secure random code (RX-XXXXX-XXXXX-XXXXX-XXXXX, Crockford-unambiguous, 100 bits). Verification (/api/extract/verify) replays STORED facts, checks revocation, fails closed on digest mismatch (payload_tampered), and reports changed_since_issuance with exact field paths. certificate.svg is now an honest PREVIEW of live data (or renders an exact extract via ?extract=CODE, with revoked banner + change notice); title renamed "REGISTRY INFORMATION EXTRACT" with explicit "not an official certificate; does not establish ownership" legal note in EN+FA. Legacy /api/verify kept for pre-extract codes with an honest legacy_notice (shows CURRENT data, not a snapshot). Extract revocation requires content.manage + reason; snapshots are never deleted. 17 vitest fixtures (key-order-stable digests, immutability under rename, per-code snapshots, tamper detection, revoked codes, archived horses, code entropy/uniqueness 500 draws, private-field exclusion).
- **Honest media verification vocabulary (T05)**: media verify decision accepts `platform_reviewed` (canonical; `federation_verified` kept as deprecated alias, both store the legacy CHECK-constrained token). All media DTOs now carry `verification_level`; every UI badge changed from "verified ✓" to "platform-reviewed" (EN "platform-reviewed" / FA "بررسی کارشناسان سامانه") with title text "Reviewed by platform staff — not an issuer attestation" across heritage, equidata-elite, fei-classic and both classic-UI copies. MediaPolicy documents the legacy storage token. A vocabulary-rebuild migration is deliberately deferred (parent-table rebuild risk documented in migration 0031 comments).
- **Public attestation view (T05 acceptance)**: GET /api/horses/{id}/attestations + heritage panel showing who attested what, when, in which scope, with limitations and the four-level vocabulary note; empty state explains "platform-reviewed is not issuer-attested". Client + mock client gained attestations/issueExtract/verifyExtract surfaces; contracts updated.
- **Route inventory + data inventory docs updated** (machine-checked): 91 routes / 50 migrated structures, drift-free.
- **Fixed pre-existing local-harness breakage**: tools/ts-runtime-loader.mjs stub Env lacked AI_KEY_ENCRYPTION_SECRETS/SECRET (weak-type TS2559) — test:ai-boundaries/test:ai-content (and full `npm run check`) have been failing since R75; stub fixed, **`npm run check` now fully passes end-to-end** (CI deploy gates were never affected).
- **Verification at this commit**: `npm run check` full pass (all validators + tsc + vitest 238 passed / 10 pre-existing skips / 0 failed — 33 new fixtures — + python 48 + inventories); `npm run build` + asset validation green; migrations 0031/0032 verified through the production SQLite→Postgres translator (scripts/check-migration-translation.mjs, added); python migration smoke applies the full 32-migration chain cleanly.

# R80 — 2026-10-03

- **Master-Ai plan execution started — G1 batch 1 delivered: T00 + T01 scaffolds + T03 + T04 + T26 + interim F03 guard.** All changes additive/code-only (no migrations, no schema change, no data mutation).
- **T00 BASELINE.md** (`audit/2026-10-03/BASELINE.md`): install/typecheck/vitest(205 pass, 10 pre-existing skips enumerated)/python(48)/build/deploy gates recorded with results at 23038b2 + R80 tree; independent packet harness results retained (business-model 25/25, manifest 19/19, 126k-comparison oracle); unavailable external deps truthfully listed.
- **T03 (F01) shared server-side visibility policy**: new `src/privacy/policy.ts` + `src/privacy/projections.ts`. Genetics + breedings GET now take viewer context (`getAuth`) and return allowlisted DTOs — lab accession numbers, private notes, editorial interpretation text and unpublished (unverified) tests are private by default; unverified tests are hidden from non-privileged viewers entirely. Direct API access is now exactly as restricted as UI access. 6 vitest fixtures (anonymous/plain/owner/editor/super_admin matrix).
- **T04 (F02) unvalidated genetic interpretation removed**: new `src/genetics/assayCatalog.ts`. The regex summary logic (`/clear|negative|free/` matching "not clear", `^n/[a-z]` counting dominant HYPP N/H as carrier, arbitrary genotype strings diagnosed) is DELETED. Interpretation now requires an exact two-token allele match against a catalogued assay (SCID/CA/LFS/OLWS/GBED/JEB1/JEB2/MH/PSSM1 recessive; HYPP dominant — N/H = affected); everything else keeps original lab text with `result_status: "recorded_uninterpreted"`. Distinct summary states: tested/verified/unverified/clear/carriers/affected/uninterpreted/conflicts (verified conflicting retests are reported as conflicts, never silently merged). Legacy locus identifiers (ASLIP/TMEM38/SLC36A1) are quarantined with suggested mappings (ASIP/TBX3/SLC45A2) — raw values preserved, no destructive replacement. Frontend badges now render the server's result_status (the client never re-diagnoses); "federation-verified" copy replaced with honest "verified" everywhere (heritage + equidata); demo-panel copy no longer claims federation lab uploads. 11 vitest fixtures (negation, dominant HYPP, wrong-assay tokens, unknown assays, conflicts, legacy loci).
- **T26 (F20) evidence-aware pedigree interpretation**: new `src/pedigree/interpretation.ts`; verdict builder moved there (re-exported from breeding.ts). Comparative mating labels are now gated by ancestry quality — two founder-only horses can never receive a positive "outcross" label (they get `insufficient_ancestry` with the COI-over-unobserved-ancestry caveat). Coefficient engine math untouched (all prior fixtures still pass). Policy version + thresholds exposed on every verdict (`policyVersion 2026-10-03.1`, >=2 known ancestor positions per parent AND >=25% per-parent completeness), explicitly labeled a policy choice, not scientific consensus. Optimizer's heuristic "confidence" renamed `dataQualityGrade` (confidenceGrade kept as deprecated alias for older themes); heritage/fei/equidata column headers now say "Data quality". 6 vitest fixtures (founder-only, complete pedigree, half-known, null COI, evidence fields, bands).
- **Interim F03 guard (full fix is T05, next batch)**: `adminAddGeneticTest` no longer trusts caller-supplied `verified` (always stores 0) or `provenance: "federation"` (forced to "user") — verification must come from a reviewed attestation flow, not a self-declared boolean.
- **T01 scaffold**: `docs/decisions/operator-and-data-rights.md` (independent-private-operator default, least-exposure privacy defaults, source_imports rights inventory table, open owner decisions) + `docs/decisions/commercial-scope.md` (nothing purchasable by design; integer money; payment never grants authority; owner-gated prices/providers/pilot). Both DRAFT pending owner sign-off.
- **Verification at this commit**: tsc clean; vitest 205 passed / 10 pre-existing skips / 0 failed (23 new fixtures); python 48 passed; production build + frontend asset validation green; AI stack confirmed to never touch genetic tests (no interpretation text in any AI context).

# R79 — 2026-10-03

- **Master AI packet received, verified and adopted as the execution roadmap.** Owner uploaded `Horse_Registry_Audit_and_Agent_Plan.zip` to the vault; archived in full at `audit/2026-10-03/master-ai-plan/` (+ zip). Contents: code audit (28 prioritized findings), Iran business model (competitor evidence, offers, costs, break-even, 17 cost categories), 45-task dependency-ordered implementation plan (gates G0-G5), machine-readable backlog, business-model page spec, 20 primary sources, executable evidence.
- **Independent fact-check: 13/13 tested findings CONFIRMED at f7f9113** (F01-F09, F14, F17, F18, F20, F22 — see `audit/2026-10-03/AGENT_ASSESSMENT.md` for the per-finding code citations). Their executable evidence re-run locally: pedigree oracle suite results reviewed (126k comparisons; sparse-ancestry outcross defect reproduced), reference business-model tests 25/25 PASS, package SHA256 manifest 19/19 match. The audit is factually accurate and its direction (preserve core, privacy/authority correctness first, scoped grants, entitlement-gated commerce, strict honesty rules) matches project doctrine. Verdict: READY and in agreement; nuances documented (T00 mostly pre-satisfied; T02 achievable via env-gated demo + is_demo tagging on free tier; T35 hosting is an owner decision, current architecture already satisfies one-canonical-DB).
- **Sandbox incident this round**: mid-turn reroll rolled the local clone + worklog back to R70 state while fact-checking; detected via blob-hash mismatch (local routes.ts pre-R76 vs GitHub 2da9b53e); recovered by fresh clone from GitHub (f7f9113 verified). GitHub remains the sole source of truth; nothing lost (R76-R78 all safe on GitHub + vault).
- Next: execute the packet's G1 slice starting with T00 (BASELINE.md with full gate logs), then T03 (server-side visibility projections) → T04 (remove unvalidated genetic interpretation) → T05 (issuer attestation separation) → T26 (evidence-aware pedigree interpretation), with T07/T08/T09 mutation/identifier unification after T07. No code changes in this round — assessment + archival only.

# R78 — 2026-10-03

- **Lean re-review export (owner: "strip anything not purely the actual code/features — exclude as much as you can")** — `scripts/export_backend_core_frontend_zip.sh` rewritten to LEAN spec: the package now contains ONLY the app itself — `src/` code files (worker, all API routes, AI stack, pedigree engine, db layers, contracts, frontend-kit, the five React frontends, web entry) minus ALL CSS and assets, `migrations/` (canonical data model), the Classic donor app ui (vanilla JS), `package.json` + tsconfigs + `.env.example`, plus `IMPLEMENTATION-STATUS-R76.md` (ticket matrix) and a short PACKAGE-INFO map. Newly excluded vs the R77 package: `tests/`, `scripts/`, `tools/`, `supabase/`, `.github/`, every CSS file, vite/wrangler/vitest configs, `requirements.txt`, `index.html`. Secret scan now 100% clean (the only previous hit was a test fixture, and tests are out). Reading package — the full repo still builds/verifies.

# R77 — 2026-10-03

- **Handoff-verification pass (owner: "all changes from AI 1 and AI 2 done? double-check")** — code-verified every material claim from both external packages against the tree at R76 instead of trusting changelogs (the R76 audit had already caught R75's false "F08 done" claim). Confirmed in code: F08 Classic record modules (`standalone-frontends/classic-v1.4/public/ui/views/market.js` + horse Records tab), `src/ai/core/keyEncryption.ts` (+14 vitest), `scripts/pg-parity-gate.mjs` + CI job `parity-postgres`, `src/api/changeRequestValidation.ts`, capability flip (`performance_records/market_data: true`), EXISTS-guarded conditioned atomic review batches with `409 stale_horse_version`, worker security headers (nosniff / X-Frame DENY / permissions-policy / COOP / CORP), unified `src/ai/core/modelCatalog.ts`, abortable AI streams (abortSignal through the orchestrator), `/api/horses/duplicate-check`, `/api/registry/export`, `analytics_stale`/`source_revision` reconciliation. Deploy workflow run for 9a02028: **15/15 steps success** — Cloudflare production is current with R76.
- **Nuance documented (not a defect)**: CI's `parity-postgres` job triggers on non-main pushes + PRs; pushes straight to main run the Deploy Production quality gates (typecheck/vitest/build) instead. R75/R76 parity was verified locally on PostgreSQL 17 (30/30 migrations, 7/7 probes) but did not run remotely for those two commits.
- **New: `audit/2026-10-02/IMPLEMENTATION-STATUS-R76.md`** — the ticket-by-ticket response to both AI packages: every A1 (44) + A2 (40) ticket mapped to DONE / PARTIAL / BLOCKED-OWNER / FUTURE with evidence pointers and an honest open-items summary (B04 sender creds, AI01/AI02 policy, B14 policy, B15+ issuer model, OPS-02 media blobs, token debt P2, business roadmap).
- **New export: `scripts/export_backend_core_frontend_zip.sh`** — focused re-review package (backend + core frontend only, per owner instruction): 460 code files (src minus web/assets, migrations, tests, scripts, tools, supabase, .github/workflows, classic ui source, root configs) with IMPLEMENTATION-STATUS-R76.md + PACKAGE-INFO.txt at the root. Omitted: public/ + dist/ build outputs, all binary assets, docs/, the audit bundles themselves, seed data, lockfile, sandbox tooling. Gates: file-type audit (code/text only), binary/oversize check clean, secret scan clean except the documented fake `AIzaSyD_*` keyEncryption test fixtures (format-required), byte-identical spot check 10/10. Deliverable: `horse-registry-backend-core-frontend_R76_9a02028.zip` (1.8 MB) — also archived to the vault repo `exports/`.

# R76 — 2026-10-03

- **Placeholder/capability audit (owner request: "everything we can't ship yet must at least have a demo or placeholder").** Audited every owner-gated/future item for placeholder coverage. Already honest: B04 OTP (dev demo mode surfaces the code in-UI; production stays a truthful 503 "not configured"), AI assistant (bilingual unavailable states with reason codes), EquiData Platform Coverage page (every feature live/dormant with version/stability/access), genomics dormant workspace. Found three real defects and fixed them in this batch: stale capabilities, stale "reserved" copy, and Classic never actually receiving the record modules.
- **Truth-in-advertising capability flip.** `media`, `performance_records` (federation competitions) and `market_data` (marketplace) have shipped real endpoints + UI on every frontend for batches, yet `BASE_PLATFORM_CAPABILITIES` still advertised them `false` and every manifest declared them `dormant` — so live UIs rendered "PRESERVED · OFF / NO DATASET" placeholders for working features (and the frontends validator's "live ⇒ not dormant" rule was silently kept green only by the false capabilities). Now: capabilities `true`, `PLATFORM_FEATURE_SPECS` promoted to `1.0.0 stable`, contract **2.14.0 → 2.15.0**, app **0.43.0 → 0.44.0** (package.json + lockfile + frontendRegistry aligned). `verification`, `inspections`, `breed_standards` and `genomics` stay honestly reserved.
- **F08 actually completed — Classic Registry record modules.** The R75 changelog claimed "F08 (Classic, R68/R73) already done", but the donor app had NO record-module surfaces (its horse view ended at insights/workflows). Added to `standalone-frontends/classic-v1.4`: horse profile **Records tab** (competition summary stats + results table, recorded genetic tests with verified badges + honest lab-data note, breeding ledger, published media with verification, registry certificate links FA/EN) with per-section `Promise.allSettled` error boxes (F04 doctrine: an error is not evidence that no records exist); new `views/market.js` with `#/market` (paginated listing table, `price_visible` respected, status badges) + `#/market/:id` (details, recorded parents, authenticated inquiry form with honest sign-in prompt); Market nav item + routes wired in `app.js`; `parseHash` accepts `market` ids; capability-map route links for the three newly-live features (`labs.js`); 30+ new bilingual i18n keys (`core.js`). Embedded copy rebuilt via `build-classic-embedded.mjs --force` — this also synced pre-existing drift (hostBridge.js missing, disciplines.js deletion, CSS/manifest refreshes) that had never been re-published.
- **All five manifests + curated-engine validators updated.** `media/performance_records/market_data` → `surface` (Heritage builtin + equidata/fei/retro/classic). `validate-presentation-parity.mjs` extended: Heritage evidence sources now include HorseModulesPanels/CompetitionsPage/MarketplacePage, EquiData includes recordModules.tsx, and the three features carry concrete marker rules (list/upload/fileUrl, competitions list/history, market list/inquire) — the "future-proof" rule at the bottom of that validator is what caught the gap.
- **Stale "reserved" copy corrected.** FEI's "Reserved concepts" panel claimed media/performance/market/AI were reserved while FEI itself ships all four — now lists only the genuinely reserved families (verification/inspections pending issuer model, breed standards, genomics). EquiData home Performance/Market module cards flip to live state with honest scope copy ("competition records live on the RECORDS tab — telemetry stays out of scope"; "canonical listings live — valuations stay out of scope") and CTAs (marketplace / horse records). EquiData Platform Coverage openers added for the three features.
- **Mock client demo parity.** `MOCK_CAPABILITIES` flipped for the three features, and the module mocks now return provenance-labeled demo rows (competition + results, hidden-price listing with full `MarketListingRecord` shape via shared `mockMarketListing()`, SCID test, breeding record, verified profile photo) so offline prototyping demos populated states, never fake federation data.
- **B14 placeholder surfaced.** Heritage genetics panel now carries an explicit bilingual note that structured assay documents and the historical-gelding breeding policy are pending a registry policy decision (the owner-gated remainder of B14, now visible where it will land).
- **Validator repairs (pre-existing R75 failures, not in R75's gate list).** `validate:ai` had three latent failures: hardcoded `2.14.0`/`0.43.0` contract markers (now 2.15.0/0.44.0), a stale `.hdb-ai-send{width:34px` CSS marker from before the R56d chat overhaul (now `display:inline-flex`), and the secret scan flagging `tests/unit/keyEncryption.test.ts` fixtures — which MUST be format-accurate because the key admin validates the strict `/^AIza[0-9A-Za-z_-]{30,}$/` Gemini format and the masking assertion needs the `AIzaSy` prefix; the scan now skips `tests/` (runtime source tree still fully scanned, rationale documented inline).
- Gates re-verified this session: tsc clean (all 4 configs) · vitest **182 pass / 10 skip / 0 fail** · build + `validate:frontend-assets:dist` green · validators: platform / ai / frontends / equidata / presentation / visible-surfaces / language / design-systems / css / ui-42 / mobile-ux / syntax / budgets / inventories / stage2 / premium / premium-presentation / admin-records / heritage-boundary / frontend-assets:source / launcher / content ALL pass · pedigree reference fixtures PASS · Python suite 48 OK.

# R75 — 2026-10-02

- **A19/B06 CLOSED — admin-managed AI provider keys are now encrypted at rest.** New `src/ai/core/keyEncryption.ts`: AES-256-GCM envelopes (`enc:v1:<nonce>:<ct>`) stored INSIDE the existing `ai_provider_keys.api_key` column — deliberately DDL-free (identical on D1 and Postgres; no migration, no deploy ordering). Rotation path = `AI_KEY_ENCRYPTION_SECRETS` (comma list; FIRST entry is active for writes, all entries stay decryptable) + new admin endpoint `POST /api/admin/ai/keys/rotate-encryption` which converts legacy plaintext rows and re-wraps rows still on an older secret (rows already under the active secret are counted `alreadyCurrent`, not rewritten). Writes fail closed: registering a new key without a secret is an honest 503 (same posture as B04 OTP). Reads decrypt everywhere (ring loader, masked listing, connectivity test); undecryptable rows are SURFACED in the listing (`decryption_error`, masked `—`) and skipped by the ring — never silently hidden. Duplicate detection compares decrypted plaintext (envelopes are non-deterministic). Also fixed a latent client/backend mismatch: the admin Test button posted `/api/admin/ai/keys/:id/test` while the backend only matched `/keys/:id` — both forms now accepted. Admin AI settings panel gained the encryption-status strip + per-row encrypted/plaintext/undecryptable badges + Rotate-now action. New vitest `tests/unit/keyEncryption.test.ts`: 14 cases (roundtrip, per-row nonce, GCM tamper rejection, multi-secret rotation + old-secret drop, legacy passthrough, fail-closed, ring skip, keyApi 503/201/duplicate/rotation/listing/test-through-decryption).
- **B01/TEST-01 CLOSED — automated both-provider migration parity gate.** New `scripts/pg-parity-gate.mjs` (+ `npm run db:pg-parity`): applies the ENTIRE `migrations/*.sql` chain to a disposable PostgreSQL through the production translator (`src/db/sqliteSqlToPostgres.ts`), using the same documented DDL rules as `tools/sqlite-to-postgres-schema.mjs` (INTEGER PK AUTOINCREMENT→identity, BLOB→bytea, COLLATE NOCASE stripped; FTS5 virtual tables skipped by the production mapping — Postgres serves search via `horse_search_source` tsvector/pg_trgm). Then probes the exact integrity objects R74 verified live (COALESCE expression index, phone uniqueness, `horse_claims.person_id`, `row_version`+`last_mutation_id`) + module-table existence. Verified locally on PostgreSQL 17: **30/30 migrations, 7/7 probes, 0 failures**. New CI job `parity-postgres` (postgres:15 service, matching production Supabase major) runs it on every push/PR — the SQLite side stays covered by the existing quality job + python migration smoke. Building the gate fixed a real latent bug: `stripLeadingComments` only removed the FIRST leading comment line (single-pass regex with `^`/g stops once lastIndex>0) — now loops until stable; 0011's multi-comment-led FTS5 statement was being fed to Postgres raw.
- **F04 (Heritage): module panels stop swallowing failures.** `HorseCompetitionPanel` no longer returns `null` on error (an honest error card with retry, in the panel's own chrome); `HorseGeneticsPanel` no longer `catch(() => {})`s genetics/breedings loads into silence — each surface has its own error state + retry, and a breedings-only failure is reported inside the loaded panel instead of hiding the section. Same "an error is not evidence that no records exist" doctrine as the R73 media gallery.
- **F05 (EquiData Elite): native record modules + marketplace.** Horse profile gains a RECORDS tab (competitions / recorded genetic tests / breeding records / published media + certificate links) backed by the shared typed loader (`loadHorseRecordModules`) in EquiData's own design language (new scoped `edx-record-*` CSS; shared data loading, never shared theme). Performance/Market tabs now honestly point at the real surfaces (federation-recorded results → RECORDS tab; listings → the new native `/market` page) instead of trivially declaring themselves "connected". New `/market` + `/market/:id` local routes: listing grid with `price_visible` respected, detail with recorded parents, and authenticated inquiry form (honest sign-in prompt otherwise). Nav gains Market.
- **F06 (Federation Classic): institutional record pages.** Horse profile gains a Records tab (same four modules, FEI donor components, StatePanel error rows). New `/competitions` calendar (+ `/competitions/:id` detail with results) and `/market` (+ `/market/:id` listing detail + inquiry) local routes, wired into the donor header menu (Calendar/Results → Competition Calendar; Horses → Marketplace) via two new ClassicNavKeys. New scoped CSS gives `fc-detail-grid`/`fc-inquiry-form` their first rules and `fc-inline-actions` its first real styles (previously an unstyled class). Competition/market rows display through a `recordName` helper instead of pretending to be HorseRecords.
- F07 (Retro, R73) and F08 (Classic, R68/R73) were already done — with this batch the F04–F08 record-module family is COMPLETE across all five frontends.
- Gates re-verified this session: tsc clean · vitest **182 pass / 10 skip / 0 fail** (14 new) · build + `validate:frontend-assets:dist` green · validators: frontends / equidata / css / language / visible-surfaces / mobile-ux / design-systems all pass · audit regressions 18/18 JS · Python suite 48 OK · pg-parity-gate 30/30 + 7/7 on local PostgreSQL 17.
- **Still open by design** (see TODO): B04 real SMS/email delivery (owner creds), AI01/AI02 data-policy decisions, B14 genetics write-policy polish, B15+ verification/attestation issuer model, Supabase usage/backup watch.

# R74 — 2026-10-02

- **P0 review-transaction integrity (audit tickets REV-01/REV-02 = A1 B02/B03, the top items both AIs deliberately left unpatched): a losing review can no longer produce canonical effects.** `reviewClaim` and `reviewChangeRequest` now run as fully conditioned atomic batches (D1 and Supabase full provider batches are single transactions): the claim owner-link + reindex are conditioned on THIS reviewer's decision having landed (`EXISTS(... status='approved' AND reviewed_by_user_id=?)`); the change-request horse update is version-guarded (`row_version=?`) and conditioned on the request still being undecided, and the DECISION WRITE ITSELF is conditioned on the horse update having landed (`last_mutation_id=ours`) — so a stale row_version leaves the request honestly PENDING with a `409 stale_horse_version` instead of recording an approved-but-not-applied review, and a losing concurrent reviewer's whole batch becomes a no-op. `canonicalApplied` now reports the actual committed effect (verified by re-reading the link/row), not the intent.
- **P0 proposed-value validation (REV-02): change requests can no longer store values the direct-edit path would reject** (the "not a year" birth_year counterexample). New shared module `src/api/changeRequestValidation.ts` extracts the same per-field rules as direct edits (types, trims, lengths, birth_year 1500..current+1); validated at SUBMISSION (422 `invalid_change_items` with per-field issues: duplicate_field / unsupported_field / invalid_value — no more silently-skipped unsupported fields) and re-validated at review time for legacy rows. Approve-with-invalid-items is a deterministic 422 and the review is NOT recorded (reviewer should reject instead). New `staleFields` response field flags proposed old_values that no longer match the row.
- **REV-03 (competition upsert) fully closed**: production Postgres verified LIVE via read-only probe — `uq_competition_results_entry` expression index (`COALESCE(class_name,'')`) + `uq_phone_identities_phone` + `horse_claims.person_id` + `horses.row_version/last_mutation_id` all present (4/4 PASS against the pooler; verification script preserved in sandbox `/home/z/my-project/scripts/verify_prod_pg_indexes.mjs`).
- **B12 closed** (verified: no lifetime/total claims remain anywhere — marketplace `competition_starts` is a true COUNT subquery, Retro's false lifetime totals were already removed by the R73 merge). **B05 confirmed fixed** (rate-limiter probe uses bounded `readJson`, 8KB). **B11 confirmed fixed** (ingestion is batched + `max(20)` per call, no per-result SELECT loop).
- Tests: +10 vitest (`changeRequestValidation.test.ts`, 168 total pass) · +2 SQL-translation cases (conditioned `INSERT OR IGNORE ... SELECT ... WHERE EXISTS` → `ON CONFLICT DO NOTHING` preserved; version guard intact) · +6 Python race-regression tests replaying the exact routes.ts SQL against all migrations (17 total: losing claim review creates no owner link; winning approval does; losing change review cannot overwrite the horse; stale version leaves request pending with no revision bump; rejection never touches the horse). Gates: tsc clean · vitest 168/0 fail · build+assets green · JS audit regressions 18/18 · Python 17/17.
- **Still open by design** (see TODO): B04 real SMS/email delivery (needs owner-provided sender credentials — production OTP stays honestly unavailable), A19/B06 plaintext AI-key migration, B14 genetics policy polish, F04-F08 record-module screens for EquiData/FEI/Classic/Heritage, B01 production-shaped PostgreSQL staging (the full ADR/TEST-01 gate), A2's launch-gate policy decisions.

# R73 — 2026-10-02

- **Merged `audit/r69-best-of-both` into main** (owner: "do it as you see fit, complete it and merge, make sure it's live on Cloudflare") — the verified union of both external audit packages: A2's full 32-file remediation (superset of A1's fixed findings) + 4 verifier gate repairs + A1's unique fixes (AI-key-redaction sanitizer, typed record loader, Heritage retry/permission gating, honest relay docs). Full backstory: `audit/2026-10-02/AI_PACKAGE_COMPARISON_VERDICT.md` (A2 9.2 vs A1 7.9; both factually perfect; complementary → union).
- **Nature of this batch: correctness/privacy/hardening fixes + honest-failure behavior — NO new user-facing features, NO visual/UI redesign (zero CSS files touched).** The only capability additions are internal: shared typed record loader (`src/frontend-kit/recordModules.ts`), extracted SQL translator (`src/db/sqliteSqlToPostgres.ts`), Classic same-origin host bridge (`hostBridge.js`), media/auth policy modules, audit regression tooling (18 JS groups + 42 Python checks).
- **Honest behavior changes now LIVE (intentional, fail-closed):** production/unknown-env OTP delivery returns truthful 503 instead of fake success (real sender = TODO B04); pending/rejected/archived media unavailable via public endpoint; hidden marketplace prices can no longer be inferred through filters/sorts (null ≠ free); Postgres INSERT conflicts surface instead of being silently swallowed (translation now restricts `ON CONFLICT DO NOTHING` to explicit `INSERT OR IGNORE`); AI assistant reports unavailable when the quota ledger can't be written (no unmetered fail-open spend); OTP expiry no longer bypassable via lexical ISO-vs-`CURRENT_TIMESTAMP` comparison; login compares `LOWER(email)` on both sides; breeding male-regex no longer matches "fe**male**"; Persian/Arabic digit phone input normalized; bounded request bodies + rate-limiter lifecycle.
- **Robustness/UX-quality (not redesign):** "a failed request is never an empty record" — per-module data/error/abort states with retry on Heritage gallery + Retro profile/desk (Retro competitions show real placements instead of "—" — `placement` vs `placing` mapping fixed); Classic embedded frontend honors host locale + AI-open messages; AI error envelopes redact API-key/Bearer/URL-credential patterns; `.gitignore` anchored so `tests/` and `src/db/` files are never silently untracked.
- Gates re-verified THIS session before push: `tsc --noEmit` clean · vitest **158 pass / 10 skip / 0 fail** · build + `validate:frontend-assets:dist` green · audit regressions **18/18 JS + 42/42 Python**.
- **Deliberately NOT in this batch** (open tickets, see TODO): transactional claim/change review redesign (P0 — losing-review side effects), real SMS/email delivery, plaintext AI-key migration, record-module screens for EquiData/FEI/Classic/Heritage, attestation issuer model, PostgreSQL-shaped staging gate.

# R69 — 2026-09-26

- **Classic Registry — pedigree cards stripped to what matters (owner: "no fluff info like code, just the things that matter most, like name")**: family-node cards now carry ONLY the role label (SIRE/DAM/SUBJECT — already color-encoded) + the horse name (+ Repeated/Cycle warning badges). Removed the registry-code `#id`, birth year and breed line entirely — cards get shorter and cleaner, tree gets taller-friendly. The dead `.family-meta` rules remain in CSS harmlessly.
- **Classic Registry — ancestor trees flipped (owner: "older parents on top, children on bottom")**: `familyTree()` now emits children-block FIRST and the node card BELOW for `kind==="ancestors"`, so great-grandparents render at the top and the subject sits at the bottom (descendant trees unchanged: subject on top, offspring below). Connector geometry re-anchored in the live parchment cascade block via `[data-family-kind="ancestors"]` overrides: child stems now drop from card bottoms (`bottom:-8px`), the horizontal bus sits `bottom:var(--bus-y)`, and the stub runs from the bus down to the node — bus endpoints still land exactly on first/last child centers. **Browser-verified** (headless, exact markup): flipped=true (leaves top y=32, subject bottom y=214), leaf 88px / subject 108px cards, no overflow at 1280px, connectors visually clean; mobile vertical list inherits the flip safely.
- **Retro Astra — Farsi sidebar direction fixed (owner: "labels aligned as LTR instead of RTL, text should be right and icons left")**: in `[dir='rtl']` the desk-index rows are un-flipped with `flex-direction:row-reverse` (icons keep the LEFT edge) + `text-align:right` (labels anchor to the right), the row chevron stops being mirrored (`scaleX(1)`) so it points outward at the right edge, and `.subtle-count` re-pins to the right. Fixed in `styles/rtl.css`, scoped to `.side-nav > a/button` so nothing else moves.
- **Retro Astra — horse profile particulars compacted (owner: "specs not compact, wasting so much space, forcing to scroll")**: `particulars-grid` goes 2 → **3 columns** (reverts to 2 ≤900px, 2-col mobile keeps its own rhythm), row-gap 12→6px, column-gap 20→14px, item keel 9→5px, dt margin 4→1px; profile chrome tightened to match (`profile-tab-content` 23→14px, `profile-overview` gap 25→16px, story paragraph margin 22→13px, `family-connections` 21/28→13/16px, `record-tabs` margin 26→16px, header totals/parent-line/footer keels trimmed). Type sizes untouched — density comes from geometry.
- **FEI Classic — R69 ULTRA-DENSE layer (owner, ninth time: "too spacious, way more compact and packed")**: new final layer appended to `fei-classic-modern.css` (last word of the cascade, ≥768px + extra-tight ≥1280px): page frame 14/16/30→8/10/16px, titles/keels halved again, panels 10→7/8px, table cells 4px→2/2.5px with 11px head / 12.5px body type, hero 12/16→8/12px, buttons 30→28px (small 26→24px), filter inputs 28→26px with 100px label keel, metrics 46→38px min-height, grids/gaps/pagers/footer all cut 1-3px each; data values stay ≥12.5px so packing never costs readability.
- **Core — sub-category "All views" tabs (owner: "even sub-category tabs should have an All tab, default selected")**: every stats section's sub-tab rail gains an **"All views" / "همه نماها"** entry as the FIRST tab and the DEFAULT selection (`activeSubtabs` defaults all → "all"); selecting it expands every view of that section into one continuous scroll (all 11 content gates now accept `activeSubtab==="all"`), the section copy gains localized "All views" titles/bodies, the desktop dock tertiary rail and breadcrumb trail resolve the new id, and embedded PremiumRegistryIntelligence auto-expands (`expandAll`) when the parent sub-tab is All.
- Verified: `tsc --noEmit` clean, **158 tests pass**, production build + `validate:frontend-assets:dist` green; dist greps confirm the flipped-tree logic, ancestors connector overrides, FEI ultra-dense values, Astra 3-col particulars + RTL sidebar rules, and Core "All views" strings all shipped.

# R68b — 2026-09-26

- **Classic Registry — pedigree cards: ROOT CAUSE found and fixed (owner: "ITS STILL THE SAME")**. R67/R68 compacted the wrong block: `classic.css` carries three stacked theme re-skins inside the same `@layer components`, and the **parchment theme block (last in the cascade) silently re-asserted `width:clamp(152px,12vw,210px)` nodes, `min-width:164px` branches and `minmax(164px,1fr)` columns over every earlier compact value** — so none of the previous tightening ever rendered. The live block now carries the compact geometry itself: nodes `clamp(92px,6.4vw,116px)` (subject `clamp(108px,7.6vw,132px)`, level-3+ `clamp(88px,6vw,108px)`), 3px/5px padding, zeroed internal margins, connector bus 28px → 16px drop, child tracks `minmax(94px,1fr)` with **`width:max-content`** so `1fr` tracks equalize to the widest sibling and the tree packs tight instead of stretching, per-branch gutter 9px → 4px. **Measured in a real browser** (headless, exact horse.js markup): 3-generation tree = **816px** wide (was ≈1470px with h-scroll), cards 88–108px, zero overflow at 1280px and 1024px, mobile ≤760px unchanged (full-width vertical list). Connector math re-checked: bus endpoints still land exactly on first/last child centers (`--edge = 50%/N`), stems on branch centers. Dist copy verified: new values present, old wide values 0 occurrences. The dead earlier blocks were synced to the same numbers so this trap can't recur.
- Verified: production build + `validate:frontend-assets:dist` green.

# R68 — 2026-09-26

- **Classic Registry — pedigree tree cards tightened AGAIN (owner screenshot: cards too wide, too much white)**: nodes cut a second time — standard card `clamp(118–150px)` → `clamp(104–124px)` with 4px/6px padding and no min-height floor, subject card `136–175px` → `124–148px`, deepest level-3+ cards `108–132px` → `96–114px` (11px/10.5px names, 9–9.5px meta), child gaps 8→6px, connectors re-proportioned (15px drop). A 3-generation ancestor tree now needs only ≈810–950px — fits a 1024px viewport with zero horizontal scroll. Every internal gap/line-height squeezed to remove the white.
- **EquiData Elite — horse profile: compact AND larger type (owner: "both compact and more packed but also larger font sizes and better alignment")**: new R68 density layer (desktop ≥821px). Hero: 24px padding → 14/16px, portrait 210×230 → 148×166, title up-to-54px → clamp(21–30px). KPI tiles: 100px floor removed, padding 15→10/12px, but value text ENLARGED (clamp 20–26px) and notes 10.5→11.5px. Data grids: rows 11→7px while `dd` values ENLARGED 13→14.5px and dt labels 9→10px. Tabs slimmer with larger labels; panels 22→14/16px; page chrome 26/54→18/34px. RTL mirror added for the two-column grid gutter so Farsi aligns to the same edge.
- **Parity audit (owner: "make sure its in perfect parity") — backend/Core surfaces mapped against both frontends**. Gaps found and closed: Classic Registry had NO competitions, NO marketplace, NO horse record modules; Retro Astra had the same three gaps.
- **Classic Registry parity additions** (vanilla views + routes + nav, EN/FA copy): new `#/competitions` (filterable calendar: discipline/year/season/tier/search + pagination), `#/competition/:id` (detail + results table), `#/market` (published listings with price-visibility respect), `#/market/:id` (listing detail + pedigree/competition side panel + inquiry form for signed-in users wired to `POST /api/market/listings/:id/inquiries`). Horse profile gains **Competitions** tab (starts/wins/podium/eliminations summary + results) and **Record modules** tab (genetics summary + tests, breedings as-sire/as-dam, media counts + items, official certificate link) — mirroring Core's HorseModulesPanels against `/api/horses/:id/{competitions,genetics,breedings,media,certificate.svg}`. Router now parses competition/market ids; nav adds Competitions + Market; 30+ new EN/FA dictionary keys.
- **Retro Astra parity additions**: Profile gains a fifth **Modules** tab (RecordModules: competition summary + results, genetic tests, breedings as-sire/as-dam, verified media, official certificate button via `platform.modules.registryExtras.certificateUrl`) — all module data loads through the platform client with graceful per-module fallbacks. The Collections filing cabinet gains two platform-backed desks: **Competition desk** (discipline filter, paginated calendar, results drill-down) and **Market desk** (published listings, price-visibility respected) — same donor sheet/folder visual language, EN/FA labels.
- Verified: `tsc --noEmit` clean, **158 tests pass** (incl. the raw-/api frontend-contract boundary test — all Astra module access goes through the platform client), `validate:frontends` green (4 external), production build + HTML minify + asset validation green.

# R67 — 2026-09-26

- **Federation Classic — logo centering ACTUALLY fixed (owner reported it still broken twice)**: R66 shipped two bugs that left the dome logo visibly off-centre and even made it WORSE on desktop. (a) The RTL override used `translateX(+50%)` together with `left:50%` — the box ended a full half-width (≈215px) right of centre in Farsi; (b) at ≥1200px BOTH directions got `transform:none` while still anchored at `left:50%` — again half-off at every desktop width. Replaced with one bulletproof rule at every width and direction (`left:50%!important;right:auto!important;transform:translateX(-50%)!important` — `left`/`transform` are physical, not logical, so the identical pair centres in LTR and RTL). Pixel-measured optical centre added: the donor artwork's dome spans cols 59–363 (centre 211.0) and wordmark 165–252 (centre 208.5) inside a 429px box (centre 214.5), so the image itself gets a +3.5px nudge — dome dead-centre, wordmark within 2.5px.
- **Federation Classic — COMPACT BY DEFAULT (owner: "you dont understand what compact means")**: the R66 pass only tightened ≥1280px and was too gentle. New density system applied at EVERY desktop width (≥768px): page frame 56/64px → 14/30px chrome, page-title margin 24→10px, section headings 22px→16px + 8px rhythm, panels/sections 8px margins + 10px padding, data tables 15px→11.5px head / 13px body text with 4px cells, hero band 158px min-height killed (12px padding), buttons 38px→30px (small 26px), filter-grid 26px→12px column gap, field labels 150px→116px keel + 28px controls, metric tiles 64→46px, two-col/launch/donor-grid/home-snapshot gaps tightened, profile/parent cards/pager/footer compacted. Extra-tight layer ≥1280px; ≥1600px uses room for WIDTH (1720px shell), not air. Mobile <768px keeps touch spacing.
- **Classic Registry — family default level 0 → 3 (owner bug report)**: `boundedDepth()` fed the raw query value into `Number()`; with no `?depth=` param it got `null` and `Number(null)===0` is an integer, so the intended fallback (3) was NEVER used — every ancestors/descendants tree opened at level 0 (subject only, no parents). Fixed to treat null/empty as "not provided" and return the call-site fallback → family trees now open at **3 generations** as designed (metrics tab fallback 6 restored too).
- **Classic Registry — compact horse cards, no forced horizontal scroll**: with depth 3 the ancestor tree's 8-card leaf row previously needed ≈1300–1770px (clamp(145–205px) nodes, 18px gaps) and forced left/right scrolling. Nodes shrunk (`clamp(118–150px)`, subject card 136–175px, deepest level-3+ cards 108–132px with 11px names), child gaps 18→8px, connectors re-proportioned (25px→17px drop), tree padding tightened. A 3-generation ancestor tree now fits ≈1050–1150px — no horizontal scroll on a 1200px viewport; the scroll container remains the fallback for very deep descendant trees.
- Verified: production build + HTML minify + `validate:frontend-assets:dist` green; fixes confirmed present in dist bundles (minified FEI CSS keeps the winning `translate(-50%)!important` centering rule + 3.5px nudge; dist classic-registry carries the R67 depth fix and compact tree CSS).

# R66 — 2026-09-26

- **Federation Classic (owner feedback)**: the top-bar dome logo is optically CENTERED at every viewport (the donor's hard `left:343px` sat ~42px left of the 1200px band centre and read as broken symmetry; RTL mirrored too). Menu tab labels and dropdown rows are center-aligned. The advanced search filters are hidden by default behind a donor-styled `<details>` drawer (basic identity row + export/Search/Reset stay visible). Pedigree tree visualizer rebuilt: generation column bands + labels, side-anchored sire/dam encoded edges (solid/repeat-dashed/cycle-dotted), subject/sire/dam node fills, relation chips, legend strip, RTL-safe SVG text, keyboard focus rings. Large-screen compactness pass ≥1280px (tighter panels/tables/grids; 1680px shell ≥1600px). Extra color coding: results-head keel, metric tone keels, pager active state, descendant bars, field focus tint.
- **Retro Astra (owner feedback)**: nested-scroll traps removed — modal backdrop and sidebar collection-nav are no longer scroll layers (one scroller per surface: workspace-main, sidebar, modal, pedigree stage). Pedigree stage height no longer assumes fixed chrome (viewport clamp with 280px short-screen floor; default generations already 3). Welcome hero grows with copy (min-height replaces fixed 224/168px; FA gets taller plates) so CTA rows never clip. Record/horse names wrap with a 2-line clamp instead of ellipsizing. Charts get min-height; horse-grid photos use aspect-ratio crops. Sex badges color-coded via the existing sire/dam tokens; active record tab keeps an accent keel. `documentElement` dir/lang now follow FA/EN while the frontend is mounted (native scrollbars, iOS behavior, restored on unmount).
- **Shared AI chat (Core + all frontends)**: composer textarea is no longer user-resizable — it auto-grows with the draft (132px cap, existing max-height). A "scroll to latest" pill appears when the user is behind the stream. Every finished assistant answer carries a quiet hover copy affordance.
- **Domain (iraho.ir)**: server name `horse-registry-nextgen.rogerfires10.workers.dev`; Cloudflare anycast A `104.21.79.168` / `172.67.146.156`, AAAA `2606:4700:3030::ac43:929c` / `2606:4700:3035::6815:4fa8`. Custom-domain guide delivered to the owner.
- Verified: `tsc --noEmit` clean, `validate:frontends` green (4 external), `validate:css` green, production build + minify green; Deploy Production workflow green on R66-A, R66-B/C pushed.

# R65 — 2026-09-26

- Heavy professional polish of Federation Classic (owner directive: better Farsi font, better layout/spacing, super responsive/accessible/readable, "potentially even better than the original"). New `fei-classic-modern.css` layer imported LAST; donor header geometry ≥1200px preserved byte-exact.
- **Farsi typography**: full Vazirmatn family self-hosted (400/500/600/700 + latin subset, `unicode-range`d) replaces Tahoma for the WHOLE UI — Arabic-script rules enforced (letter-spacing 0, line-height 1.8 body/1.95 home copy, kern/mark/mkmk features). English runs Source Sans 3 at 14.5px/1.55. All controls inherit the locale stack.
- **Responsive donor header fixed 768–1199px**: the hard 1200/1064px bands became fluid (`width:auto` + max-width, content-box safe), tabs flex-share the row (`#topMenu ul.level1` needs ID-specificity to beat the donor's `ul{width:auto}`), dome logo stays centered at any width, two-line tab labels ≤859px, dropdowns stretch to tab width. Zero horizontal overflow 768–1440px; ≥1200px keeps donor 190px tabs.
- **Layout/spacing**: centered symmetric fluid container (`min(1560px, 100% - clamp(16px,4vw,56px))`) replaces the asymmetric donor offsets; unified 32px controls, 34px buttons, breathing table rows (8px padding, 13px/1.5), sticky table heads with shadow, tabular numerals, real pager hit areas (30px), taller profile tabs (32px), refined fieldsets/legends/status strips.
- **Accessibility**: skip-to-content link, global focus-visible rings (theme purple), `prefers-reduced-motion` support, 44px+ mobile targets, safe-area insets (mobile bar/bottom-nav/drawer), aria-current on active tab (desktop + drawer), ≥4.5:1 text contrast fixes (labels #665f6c, permission note #7d4a81, fei-info chips #8d3f90).
- **Data readability**: years no longer group-separated ("2,022"/"۲٬۰۲۲" → "2022"/"۲۰۲۲") via new `year()` i18n helper applied across registry table, profile, person links, descendants, timeline, analytics.
- **Architecture fix**: the shared visual-encoding store moved to `src/frontend-kit/registryVisualEncoding.ts` (public kit root) — `validate:frontends` GREEN again (was failing since R64's cross-module import); `src/web/registryVisualEncoding.ts` stays as a re-export shim for core imports.
- Footer bar + back-to-top now visible on desktop too (quiet, donor-palette) for navigation; home donor rail scales down 306→260px between 1180–1000px.
- Verified: typecheck, 158 tests, validate:css / design-systems / visible-surfaces / ui-42 / mobile-ux / frontends / language / heritage-boundary / frontend-assets (fei-classic=9), production build + minify. Screenshots: EN/FA home-browse-profile at 1440/1024/390, dropdown hover, drawer.

# R64 — 2026-09-26

- Federation Classic header replaced with the EXACT data.fei.org donor port: the original CoreAppCss/MainMenuCss rules, the ASP.NET menu DOM (`#topMenu`, level1/level2 classes), the grey striped top bar, the purple "FEI Database 2.289.2" home button with its literal `<subscript>` tag, and the 429x105 dome logo overlapping the nav band. Donor images ship as lossless WebP (`public/assets/frontends/fei-classic/images/`). Sys.WebForms.Menu hover behaviour (500ms disappear, purple highlighted tab) re-implemented in React with full backend parity (same nav keys/capability gating/bilingual labels).
- New `fei-donor-header-exact.css` layer (imported last): verbatim donor rules scoped to `.fei-classic-ui`, content-box restored on the header subtree, RTL mirroring for Farsi, legacy `.fei-donor-header` chrome neutralised via an extra class.
- Registry visual encoding added (`fei-visual-encoding.css` + `SexChip`): sex identity dots (stallion/colt blue, mare/filly magenta, gelding teal, young amber) in registry tables and horse profiles, zebra + hover readability, tinted lifecycle badges, sire=blue/dam=magenta parent labels, purple coverage meters. Controlled by the shared core toggle (`registry-visual-encoding`) mirrored onto `[data-encoding]`.
- Verified: typecheck, 158 tests, build + production asset validation (fei-classic=9), platform contract audit; EN/FA desktop, hover dropdown, mobile 390px bar/drawer/bottom-nav all screenshot-checked against the donor capture.

# R31.12 — 2026-09-16

- Removed the outer Core AI marketing/banner hero entirely so `/assistant` starts directly at the chat workspace.
- Expanded the Core AI workspace height to reclaim the removed banner space on desktop and mobile.
- Made local AI setup less fragile: a configured provider key auto-enables AI only when the enable flag is omitted; an explicit `AI_ASSISTANT_ENABLED=0` still wins.
- Updated `.env.example` so copying it to `.env` only requires adding a provider key for the common local path.
- Added non-secret startup diagnostics for private `.env` presence and provider-key detection.
- Updated the mobile AI viewport regression contract for the new bannerless layout.

# R31.11 — 2026-09-16

- Merged the complete 74-file EN/FA localization repair built against exact R31.10 authority.
- Removed the AI chat title/subtitle header to reclaim conversation space; controls now live in a compact bottom strip.
- Locked message sides physically: user right, AI left, independent of EN/FA direction.
- Added regression validation for compact AI chrome and RTL-independent bubble alignment.

## R95e — N13: transactionally consistent dossiers (2026-10-04)

**Commits:** N13 (snapshot single-statement + mandate-conditioned mint + digest, migration 0059) -> docs. Ledger 13/30.

- One-statement snapshot (correlated subqueries; excluded sections never read); source marker (schema_version + horses.updated_at) captured in-statement; JSON aggregates normalized TypeScript-side (engine key order can never leak).
- Mandate-conditioned INSERT..SELECT for dossier create + link mint (buildActiveGrantPredicate reused; staff flag branch); marker-gated audit receipts; honest 409 sharing_authority_changed on the late-loss path.
- issued_digest (0059) binds exact content bytes; view recomputes -> tamper = controlled 410; legacy rows digest_verified null; sections_meta parse finally guarded; parseLegacyDossierPayload -> controlled 410 never 500.
- Bounded access logging pinned (counter + last-access only; column allowlist test).
- Fixed pre-existing refunds-test midnight time-bomb (fixed seed vs real clock; verified at 4bcebf5).
- Evidence: 15 integration tests + real-PG single-statement parity (pg-parity-n13.txt); gate 59 migrations + 23 steps 0 diffs. vitest 921 / python 171 / runtime 73.

## R95d — N11: service provider mandates + ONE state machine (2026-10-04)

**Commits:** N11 code (policy/commands/route + tests + parity scenarios) -> docs. Ledger 12/30.

- src/services/policy.ts: the single role-aware transition matrix (requester/provider/moderator x 6 states); route metadata + pure command both DERIVE from it (the duplicated SERVICE_TRANSITIONS table and the broad "by: anyone" metadata are gone; moderator axis defined but empty until N14 — no blanket staff access).
- PERSON_MANDATE_AUTHORITY_SQL: one template for the self-lead refusal, transition provider arm and outbox fan-out. Organization affiliation authority separate (ORGANIZATION_SERVICE_LEADS.supported=false -> route 422); org-routed leads stay disabled; org membership never equals provider authority.
- Create transaction re-checks self-lead, publication/category, block, open-quota AND the CURRENT horse mandate (HORSE_MANDATE_REFERENCE_SQL) — late block / unpublish / grant revocation / link revocation prevent commit (0 rows, no partial state). Route preflight: 403 horse_mandate_required.
- Legacy receipts: deterministic resolution — single matching request CAS-linked + replayed; zero/multiple candidates = honest 409 legacy_receipt_unresolved; never a duplicate lead.
- Evidence: 108 generated state/actor/target pair tests (tests/unit/servicePolicy.test.ts); real-DB N11 acceptance suite; 11 service parity steps incl. two REAL-PG races (receipt claim + CAS transition) — 23 steps 0 diffs (audit/r95/evidence/pg-parity-n11.txt). vitest 906 / python 171 / runtime 70 / tsc / build green. No new migration.

## R95c — N10 vendor callbacks + CI/build repairs (2026-10-04)

**Commits:** f449e45 (N10) -> 6e17ea3 (wrangler.jsonc comma fix). CI GREEN at 6e17ea3.

**N10 — authentic vendor callbacks + notification accounting (f449e45).**
New src/notifications/callbackAdapters.ts: vendor envelope translation into
the narrow internal event (provider, message id, event key, occurred-at,
delivery status). Kavenegar adapter translates the documented status
vocabulary (5=delivered, 6=not-delivered, 1/2/3/4/7...=intermediate — never
guessed) from JSON or form-encoded envelopes; the platform bridge envelope
stays supported verbatim for any provider name (the HMAC relay is
provider-agnostic); unparseable bodies / missing message ids are honest 400s.
recordDeliveryCallback is now adapter-aware: HMAC verification first (forged
-> rejected row + 401; oversized -> 413 before anything), then translation,
then correlation by provider + message id (+ event key when present).
VERIFIED non-delivery moves the accepted row to failed with
provider_reported_not_delivered (never a delivery row); intermediate
statuses never upgrade acceptance; raw bodies never persisted (payload hash
only). Concurrency-safe monthly cap: migration 0058
notification_send_reservations — the drain claims one slot with a conditional
increment BEFORE the provider call, so at the cap exactly one of two
simultaneous non-essential sends proceeds; a slot is consumed per attempt
(never over-send); essential traffic never reserves and is never capped.
adminOutboxQueue gains independent attempted/accepted/delivered/failed
metrics. The native runner's non-delivery expectation updated for the
evolved contract. 12 new integration tests.

**CI repairs.** cac9bd6: the ae6ecc6 CI failure was environmental — the
GitHub runner lacked openpyxl (import-time ModuleNotFoundError in
test_d1_serving_db + test_importer; local suite 164/164 green). Both
workflows now install openpyxl before test:python. 6e17ea3: the N09 commit
appended wrangler.jsonc triggers.crons after the observability object
WITHOUT a comma — wrangler's JSONC parser fails (CommaExpected) and 'npm run
build' fails. Every CI run since N09 either failed earlier or was cancelled,
so the Build step had never executed; the breakage was masked. Full local
build re-verified green (vite cloudflare bundle + html minify + dist asset
validation). **CI is GREEN at 6e17ea3** with all R95b/N10 code.

**Verification at push:** vitest 890 passed / 10 skipped; tsc clean; python
164 OK; r95 native runtime 67/0; audit regressions 18 groups; PG parity
58/58 migrations + execution parity 0 differences; build + dist validation
green; live site healthy (last approved deployment, contract 2.20.0).
Ledger R95_AGENT_TASKS.json: 11/30 done.

## R95b — N05-N08: reconciliation, refunds, membership, atomic workspaces (2026-10-04)

**Commits:** a69b143 (N05) -> 8d9b46c (N06) -> a00c9f8 (N07) -> b10f0c2 (N08).

**N05 — gateway uncertainty + reconciliation (a69b143).** The configured
gateway base must be an APPROVED origin (official live + sandbox Zarinpal
origins; operators may explicitly extend via ZARINPAL_APPROVED_ORIGINS with
clean https origins) — an unapproved origin means no provider, no charge, no
verify, reported with the problem list. New src/commerce/reconciliation.ts:
operator provider inquiry (append-only payment_events evidence with a
structured inquiry_outcome column — recorded, never a state guess);
review-case resolution that fires ONLY when the echoed evidence reconciles
with the stored attempt/order rows AND the outcome's specific proof exists
(recorded not-paid inquiry / verify receipt / verified-reference match);
provider_not_paid_confirmed releases the open attempt inside the same batch
(authority-less attempts release on operator attestation — the buyer never
had a payment URL). Read-only reconciliation scan cross-checks paid orders vs
verified attempts vs receipts vs settlement rows (violations vs honest
observations; settlement import remains owner-gated). Migration 0055; routes
POST /api/admin/billing/attempts/:id/inquiry + /api/admin/billing/review-cases/:id/resolve;
16-scenario gateway-sandbox matrix incl. no-card/contact-secrets evidence.

**N06 — truthful provider-confirmed refunds (8d9b46c).** Zarinpal has no
public refund API (docs S01/S02): refunds are merchant-panel operations, so
the provider outcome is RECORDED by an operator. Migration 0056 (next unused
number — the proposed 0055 was provisional): refund_requests with
deterministic request keys (refund:attempt:<id>:#<n>), kind
full_unused/partial_consumed, status vocabulary, entitlement_policy_json +
append-only refund_events. One ACTIVE request per verified attempt (SQL
guard) — money can never be returned twice; amount = the verified amount.
Approval of partial_consumed fails closed until the owner/accountant
proration policy (REFUND_PARTIAL_POLICY_ENABLED). 'confirmed' requires a
provider reference and applies the recorded access reversal in the SAME
batch (compensating refund_reversal event; grant history preserved); 'pending'
stays review, never success. Buyer routes: POST /api/billing/orders/:id/
refund-request + GET /api/billing/refunds/mine; the legacy instant-refund
route stays 501 by design. 8 real-DB tests.

**N07 — ONE membership policy (a00c9f8).** New
src/organizations/membershipPolicy.ts: CURRENT_MEMBERSHIP_PREDICATE (active,
unrevoked, org active, valid_from<=now, valid_until>now — future memberships
grant nothing early) + capability mapping (owner/manager = billing_manager +
workspace_manager; member = ordinary_staff). myEntitlements separates
personal (holder user:<id>) from organization entitlements shown ONLY for
current memberships with your_role/your_capabilities — no buyer-as-owner
labels; ordinary staff see products+expiries, never invoices/totals.
myWorkspaces adds an organization section (current managers only).
Write-time enforcement everywhere: org workspace authorize() requires a
CURRENT workspace-manager membership EVEN for the creating owner; org-payer
orders and entitlement gates use the same predicate (paymentCommands,
entitlementGates refactored onto it). Payer-leaves policy: org keeps its paid
service; the ex-payer loses org discovery + mutations but keeps personal
payment evidence. 7 real-DB tests incl. past/future/revoked/suspended/cross-org.

**N08 — atomic workspace mutations + exact capacities (b10f0c2).** New
src/workspaces/mutationCommands.ts: every mutation batch = stable row lock
(no-op UPDATE ... AS wc) + mutation-time actor predicate (N07-consistent) +
capacity inside the same boundary (200 horses/collection, 50 active staff —
upsert at cap allowed, free 1 / paid 25 collections via CASE-entitlement
INSERT..SELECT) + marker-gated audit rows (failed mutation = no audit trail;
retry = no duplicate). FIXED pre-existing bug: a failed staff revoke wrote a
misleading workspace.staff_revoked audit row before the 409. Archive = soft
delete; every mutation requires deleted_at IS NULL so archived workspaces
accept no new work while history is retained; export policy explicit.
Migration 0057; completeTaskStatements refactored onto the shared predicate.
9 real-DB concurrency tests; mock-to-real conversion of the offers gate +
task replay tests (N01 doctrine); python p14 source-wiring tests re-pointed.

**Verification at push:** vitest 878 passed / 10 skipped; tsc clean; python
164 OK; r95 native runtime 67/0; audit regressions 18 groups; PG parity
57/57 migrations + execution parity 0 differences; task ledger
R95_AGENT_TASKS.json updated (10/30 done).

## R95 — Master AI reviewed-source carry-over + N00-N04, N09 (2026-10-04)

**Commits:** d537d1d (merge) -> e07e0d9 (N00) -> 8d1fe1b (N01) -> dfc2737 (N02) -> 8e06f8c (N03) -> 3d8c3c4 (N04) -> 13d6a36 (N09). Main pushed at 13d6a36.

**d537d1d — R95 package carry-over.** The Master AI's R95 package (704 files, base
e113aa4/R94-export) overlaid onto R94e (7f9563e) after comparing EVERY overlapping
path: the package predated P20/P21, so 6 HEAD-supersets were restored (contracts/
platform.ts, mockPlatformClient.ts, frontend-kit index+platformClient, main.tsx,
heritage.modules.css); 3 files both sides changed identically kept as-is; 31 package
files taken verbatim incl. migrations 0052-0054 (commerce integrity, task/outbox
leases, private-workflow commands), paymentCommands/verifiedOrderStatements with
fresh operation receipts, zarinpal protocol fixes (explicit IRR, /pg/StartPay/,
negative error codes, ref-id validation), moderation appeal-only reinstatement
restricted to the appealed case's own suspension, CSV structural escaping after the
safety prefix, postgresValues int8 handling, and the manual exact-revision deploy
gate. 34 obsolete mock failures documented as the N01 scope.

**N01 — schema-backed route tests.** New shared fixture (real :memory: SQLite, all
54 migrations, FKs on, real createSession, real command modules; only gateway fetch
faked) + integration suite for the complete paid workflow. All 7 failing files
rewritten to real-DB assertions with R95 semantics; +48 net tests; the suite went
811 pass/34 fail -> 827 pass/0 fail (tsc clean; python 164, r95 runtime 67, audit
regressions 18 all green).

**N02 — real-PostgreSQL parity proven.** Embedded PostgreSQL 18 (npm
embedded-postgres, no root) on 127.0.0.1:5433; pg-parity-gate: 54/54 migrations
through the production translator with every integrity object verified;
pg-execution-parity: 12 command steps, 0 SQLite/PG differences. Runner committed
(scripts/r95-n02-pg-parity.mjs); evidence audit/r95/evidence/pg-parity-n02.log.
CI already runs both gates on every push; production Supabase execution remains a
release gate in the deploy pipeline.

**N03 — upgrade + legacy reconciliation rehearsal.** Synthetic R94-shaped legacy DB
(built from migrations 0001-0051 + legacy rows): duplicate open attempts block the
preflight (exit 1) AND migration 0052 itself (UNIQUE idx_payment_attempt_one_open);
the clean legacy DB passes with the honest legacy_paid_attempts_require_receipt_
reconciliation warning; after 0052-0054: FK clean, integrity ok, and a legacy
VERIFIED attempt can never be fulfilled twice (fresh receipt guard: 0 new receipts,
entitlement rows unchanged). scripts/r95-n03-rehearsal.py + evidence JSON.

**N04 — release bound to exact checks.** deploy-production.yml gained a postgres:15
service and runs BOTH PG parity jobs for the exact SHA being released (an approved
variable can never bypass a parity failure on a new revision); the approval gate
tool is pinned by 4 new fixtures (missing/stale/exact SHA + "approval is not test
evidence"). Owner actions recorded: production environment reviewers + the SHA
variable. Self-heal stays disabled; no scheduled DDL.

**N09 — the durable notification worker.** drainOutbox now HAS an application
caller: src/notifications/worker.ts with explicit provider routing, honest
payload_not_resendable refusals for one-time payloads (OTP codes / verification
links are never stored, never fabricated), bad_recipient + configuration as visible
failures, fixed-template notice bodies (private notes never emailed), failure
vocabulary extended additively; scheduled handler on a */5 cron resolving the
canonical WRITABLE database. 7 new fixtures. vitest 838 / tsc clean.

**Verification at push:** vitest 838 passed / 10 skipped; tsc clean; python 164;
r95 native runtime 67; audit regressions 18 groups; PG parity 54/54 + 12 steps.

## R31.10 — AI mobile scroll + provider refinements (2026-09-16)

- Fixed Core/Classic phone AI chat scrolling with thread-owned touch scrolling and proximity-aware streaming auto-follow.
- Kept DeepSeek's root system prefix immutable across agent rounds for cache-prefix reuse.
- Added selective Gemini `countTokens` preflight near real context/TPM boundaries and large replay/evidence.
- Added configurable 1.35× DeepSeek estimated-input safety margin before zero-cache spend reservation.
- Replaced fixed Gemini replay character retention with token/headroom-aware retention.
- Added one bounded transient Gemini 429 retry before paid Auto fallback when daily quota is not exhausted.
- Added protocol/mobile regression locks and R31.10 operations documentation.

## R31.9 — AI database boundaries / reusable domain adapter / safe recovery / release repair (2026-09-16)

- Separated assistant state, canonical registry reads and authentication authority into explicit capabilities. `AI_DB` owns assistant state when configured; registry research receives the request-selected canonical read DB; auth preserves the original D1 authority.
- Added semantic database request intents so AI message POSTs are treated as **AI-state write + canonical registry read**, not canonical registry mutations. Hybrid turns may use proactive read failover but are never same-request replayed after side effects begin.
- Tied request-scoped Supabase/Postgres resource cleanup to response-body completion/cancellation so long SSE research turns cannot lose their registry connection mid-stream.
- Introduced an injected `AiDomainAdapter`; Horse-specific policy, evidence links, local resolution and research tools now live under `src/ai/domain/horseRegistry/` instead of the generic orchestrator.
- Replaced all-or-nothing oversized tool-result rejection with provider-neutral per-operation compaction that keeps successful operations/evidence represented within the active context budget.
- Added bounded Gemini Interactions replay state. On provider interaction expiry, exact preserved native steps/signatures are replayed when safely available; durable semantic transcript reconstruction remains the fallback.
- Model-generated external Markdown images are click-to-load with `no-referrer`; third-party image hosts are not contacted automatically.
- Added migration `0022_ai_cost_semantics.sql`; DeepSeek runtime telemetry now distinguishes worst-case reservation from cache-aware **estimated billed cost** instead of labeling estimates as actual provider billing.
- Removed the no-op `/stop` endpoint; AbortSignal/SSE disconnect remains the actual cancellation contract.
- Made AI Newsroom generation draft-only across Core, RetroAstra and FEI Classic. Human save/review/publish is a separate action.
- Added executable R31.9 boundary and result-budget harnesses, including physically separate AI-state and registry SQLite databases.
- Dependency-light AI/runtime/frontend/content/platform/source gates pass; Python suite is 31/31. The inherited Heritage analytics typography-token warning remains unchanged from pristine R31.8. Full dependency-backed npm build/typecheck and live-provider/browser certification remain external gates.

## R31.8 — Core AI surface restoration / optimistic send / agent diagnostics / budget-safe synthesis (2026-09-16)

- Restored Core AI to the canonical Heritage surface system: the page header now reuses `premium-page-head`, the chat workspace reuses `welcome-workspace`, and the AI-specific CSS only maps shared assistant tokens onto existing Core frost/radius contracts.
- Restored normal Core page margins and rounded containers; removed the separate square/opaque AI page treatment.
- Made Core assistant chrome (toolbar, recent/new-chat row, composer, mini-chat) use the existing Heritage glass/frost variables.
- Added optimistic user-message rendering so a sent message appears immediately while the server/model is working.
- Reworked the tool-round boundary: the last allowed agent step now forces `toolChoice: none` and synthesizes from collected evidence instead of throwing `tool_round_budget_exceeded`.
- Added safe per-turn structured trace events for route/model, provider steps, tool rounds, evidence counts, usage and timings. No API keys or raw prompt text are logged.
- Added a compact in-chat diagnostics viewer with one-click **Copy all**, plus one-click **Copy diagnostic log** directly on failures. Logs persist for the current browser session.
- Centralized clipboard fallback behavior for code blocks and diagnostics, including LAN/non-secure browser contexts.
- Dependency-light gates passed: source syntax, AI architecture, frontend integration, CSS architecture, mobile UX, presentation parity, visible-surface parity, production frontend assets, platform contract, Core UI semantic gate, provider protocol, runtime policy and AI storage harnesses. A fresh dependency-backed Vite build is not claimed because this clean package has no installed `node_modules`.

## R31.7 — Core + Classic AI compact native UX / Markdown / free-tier quota defaults (2026-09-16)

- Reworks Core and Classic Registry AI into compact native workspaces while keeping a single shared assistant runtime and layout authority.
- Converts the bottom-right AI entry point into an anchored support-style mini chat rather than a page-sized overlay.
- Adds centralized safe Markdown rendering for headings, lists, tables, task lists, blockquotes, links/images, inline/fenced code, copy actions, emphasis and RTL text.
- Reduces frontend-specific AI CSS to design tokens and small variant overrides; shared structure/composer/message/Markdown behavior remains DRY in `frontend-kit`.
- Adds researched, overrideable model-specific Gemini free-tier safety defaults and per-model quota accounting; active provider limits remain an AI Studio deployment authority.
- Preserves the R31 agent/tool/provider backend, LAN-compatible client message IDs, local `.env` AI loading, and the fast Smart Launcher port probe.

## R31 — Canonical AI Research Assistant (2026-09-15)

- Application version advances to **0.43.0** and platform contract to **2.14.0**.
- Promotes `ai_assistant` from reserved to experimental capability `1.0.0`.
- Adds a provider-neutral AI runtime with Gemini 3.5 Flash-Lite default and DeepSeek V4.1 Flash paid fallback/alternate.
- Adds dynamic token-aware conversation management, Gemini RPM/TPM/RPD attempt accounting, state rebasing, and DeepSeek full-cache-miss cost protection.
- Adds four bounded read-only Horse-DB research tools covering registry search/profile, pedigree intelligence, population aggregates, and published content.
- Adds migrations `0016`–`0021` for durable conversations, usage/request ledgers, turn leases, lightweight image references, idempotent sends, and DeepSeek paid-cost reservations.
- Adds provider-neutral streaming/cancellation with safe draft reset around tool rounds.
- Adds FEI/EquiData full AI Research surfaces and a host-level contextual assistant launcher shared across frontend engines.
- Adds structured registry browsing, bounded people research, batched filtered analytics/rankings, explicit model selection, conversation history, and strict zero-call horse-ID navigation.
- Refactors newsroom generation onto shared provider infrastructure and removes the literal Gemini fallback key from source.
- Adds AI protocol, runtime-policy, live opt-in provider smoke, and real canonical data validation harnesses.
- Real-data validation passes on the exact 78,089-horse optimized serving SQLite authority; see `docs/R31_AI_REALDATA_VALIDATION_2026-09-15.md`.

## R29.30 — FEI header/dome/menu alignment correction (2026-09-15)
- Restored the supplied donor header gradient and historical logo geometry so the baked FEI dome blends seamlessly into the top chrome.
- Restored the donor navigation proportions/vertical rhythm.
- Centered fixed-width dropdown menus beneath their parent navigation items.
- Kept R29.29 mobile FEI improvements unchanged.
# R26 bilingual newsroom / AI editorial extension — 2026-09-14

- Platform contract additively advances to **2.13.0** with sourced cover-image metadata and an environment-gated one-click demo-admin login.
- Newsroom now ships with five sourced bilingual starter posts (Arabian overview, Khuzestan Asil heritage, Iran/WAHO 2025 update, pedigree-reading guide, and Horse DB update).
- Adds persistent Article/Blog, News and Update records with EN/FA title, summary and body fields, publication states, tags, sources, optimistic row versions and audit events.
- Adds an admin-only Gemini editorial desk supporting `gemini-3.8-flash` and `gemini-3.5-flash-lite`, optional Google Search grounding, structured bilingual JSON validation, source capture, draft generation and one-click generation + publication.
- Adds the RetroAstra **News & Articles / خبرها و مطالب** destination and editorial queue.
- Adds migration `0014_content_posts.sql`; no database is bundled. Existing local SQLite databases migrate on launch.

# Horse-DB-3 Supabase Provider R6

- Prefer a Cloudflare Hyperdrive binding for Supabase runtime traffic.
- Keep the Postgres.js client request-scoped; Hyperdrive owns cross-request pooling.
- Preserve `SUPABASE_DATABASE_URL` as a non-Hyperdrive validation fallback.
- Bound direct/pooler client teardown to one second instead of an unbounded `timeout: 0`.
- No schema, data, search semantics, D1, or Turso changes.


## v1.1.8 audit remediation — in progress (2026-09-05)

- Added the explicit `registry.export` permission to the shared platform authorization model (admin/super-admin only) and made all four frontends consume the permission rather than infer export authorization from role names.
- Aligned Core/Q8/EquiData/Prism live descendant/descendant-metric requests with the hardened platform-advertised <=1,000-node ceilings; compatibility-only alternate frontend changes prevent new 400 responses without redesigning those experiences.
- Re-ran the complete dependency-light release matrix after the compatibility pass: 17/17 repository validators, pedigree references, Python compilation and 11/11 Python regression tests pass.
- Added consolidated remediation status and deferred-certification checklists so Cloudflare/workerd/client-data/browser-only evidence cannot be confused with locally proven fixes.
- Backend-efficiency v4 self-audit: lightweight operational endpoints now consume runtime snapshots only while revision-fresh and otherwise take exact live fallback; archived-horse People-directory counts and active-horse-only Person-profile counts are materialized separately; registry people display-name materialization is revision-gated with exact stale fallback. Heavy scientific analytics remain unavailable until rebuilt.
- Coalesced public startup metadata and health: Core normally performs `auth/me` + `platform/meta`, with standalone `/api/health` retained as a backward-compatible fallback rather than a mandatory third startup request.
- Added commit-time recursive parent-cycle guards so simultaneous opposite parent edits cannot jointly introduce a cycle after stale pre-validation; rejected updates no longer create false analytics/reindex churn.
- Tightened optimizer eligibility semantics: known sire/dam sex-role conflicts are excluded, unknown/ambiguous historical sex remains usable with reduced confidence, exclusion reasons are returned explicitly, and Core presents eligibility warnings. Optimizer algorithm version is now 1.1.0.
- Extended the durable canonical mutation journal to owner-claim and change-request creation/review. Workflow writes and mutation intents now commit in the same D1 batch, audit failures leave reconcilable pending journal state, and duplicate/concurrent reviews are conditionally rejected instead of silently overwriting a decision. API responses/documentation now explicitly state that approval is **review-only** (`canonicalApplied: false`) until a separate canonical apply operation is deliberately implemented.
- Removed private microchip/file/passport/lab identifiers from the public search corpus and exact public-search path while retaining intentionally public registry/UEL/life identifiers through public indexing.
- Replaced fuzzy edit-distance full-matrix allocation with a banded three-row implementation with early cutoff, preserving transposition semantics while reducing per-comparison memory from quadratic to linear.
- Added a revisioned analytics `runtimeSummary`; fresh `/platform/meta`, `/registry/facets`, `/quality/summary`, and `/health` paths can use compact snapshot reads instead of repeated live registry scans/grouping.
- Tightened live graph/search parameters to strict bounded integers, capped relationship hydration at 512 nodes per side, reduced descendant-metric live scope to 1,000, and expanded the expensive-operation limiter to pedigree/relationship/insight routes.
- Reworked generic Registry free-text filtering to use the existing FTS index rather than repeated leading-wildcard scans, and made fielded smart-search terms true constraints (AND across fields, OR within repeated values) before relevance ranking.
- Converted demo horse/person fixtures to high reserved **positive** IDs so Browse/search results can open through normal production profile/pedigree routes; demo public search data no longer includes staff-only identifiers.
- Core Browse now lazy-loads facets only when Advanced Filters are opened, hides structured export during smart-search mode, and retains the earlier identity-keyed abort/demand-loaded profile hardening.
- Authentication sessions now use the documented 12-hour lifetime, bounded expired-session cleanup, a stricter 10/min auth limiter, and a 12/min expensive-operation limiter.
- Dependency-backed TypeScript/Vitest/Vite certification remains environment-blocked in this workspace because the partial npm cache lacks locked packages; dependency-light production syntax and repository validators remain the active local gate.
- Added `registry_state` migration and explicit analytics freshness semantics: canonical horse mutations mark derived analytics stale atomically; offline rebuild/reuse marks them current; stale registry/reference intelligence is no longer silently served as current.
- Reworked breeding analysis to reuse already-loaded pedigree graphs, eliminating repeated pair graph hydration; optimizer now reuses the fixed graph, checks complete bounded avoid-ancestor membership, applies COI ceiling as a hard exclusion, and ignores stale reference DPI.

- Bounded live dense pedigree relationship matrices (1,024 merged nodes; 512 per relationship side) and return explicit truncated results instead of unsafe quadratic allocation.
- Aligned full/incremental search representation: bilingual party names and horse aliases now survive runtime reindex; aliases are included in D1 data shards.
- Hardened D1 shard generation with 90 KB per-statement guard, 2 MB shard budget, SHA-256 manifest metadata, idempotent FTS rows, replay integrity checks, and a resumable deployment ledger for interrupted/free-quota imports.

- Started evidence-driven Cloudflare Free hardening from baseline archive SHA-256 `731555c06ad54e8e80d559eadaf532ff1dcc7bd8ade2cbe12a09f94b81f01eb7`.
- Fixed optimizer `archived_at`/`deleted_at` schema mismatch.
- Added D1 50-byte LIKE-pattern enforcement using UTF-8 byte length and strict integer query parsing; fixed prototype-sensitive sort lookup.
- Restricted registry bulk export to admin authentication and hid Core export actions from non-admin users; neutralized formula-leading CSV cells.
- Added streamed route-level JSON body limits and an explicit expensive breeding-request rate-limit class.
- Throttled non-authoritative session activity writes to reduce D1 Free write consumption.
- Fixed pedigree validation fail-open at the 64-generation traversal cutoff.
- Reduced synchronous search reindex batch size to a conservative maximum of 3 pending measurement.
- Set Wrangler application environment to production, added production preflight and static asset security headers.
- Blocked destructive populated-D1 replacement that previously relied on unsupported whole-database export with FTS5; added recovery runbook.
- Fixed Core decade filter precedence and hid privileged export controls appropriately.
- Added isolated Vitest configuration and repaired stale test fixtures/version expectations identified by the external audit.
- Added Python cache cleanup so project validation does not poison subsequent release-tree hygiene checks.
- Added `docs/AUDIT_REMEDIATION_PROGRESS.md` as the live remediation/evidence ledger.
## v0.42.16 Core Consolidation v1.1.8 — Persian miniature night wallpapers

- Added **4 new dark AVIF wallpapers** based on the new Persian miniature / illuminated manuscript night-series artwork.
- Each new wallpaper is integrated into the auto-discovered Heritage/Core dark wallpaper library and kept at **≤100 KB**.
- No code or behavior changes were required because the wallpaper gallery already auto-discovers shipped built-in assets.

## v0.42.16 Core Consolidation v1.1.7 — Auto-discovered AVIF wallpaper library

- Converted the generated Heritage/Core wallpaper collection to AVIF and capped every built-in wallpaper at **≤100 KB**.
- Added **44** new built-in wallpapers split into self-discovered **dark** and **light** collections under `src/web/assets/heritage-wallpapers/{dark,light}`.
- Made the background gallery auto-discover built-in wallpapers at build time instead of depending on a hand-maintained hard-coded list.
- Preserved the original curated six scene options, Adaptive Day / Night, and the custom background upload path.
- Background gallery now shows only the wallpapers appropriate to the current Dark/Light mode, keeping the picker cleaner while preserving mode separation.
- Expanded the Background gallery layout to better handle the larger wallpaper library.

## v0.42.16 Core Consolidation v1.1.6 — Approved default + Visual Assets Studio

- Made the user-approved Auto/Dark v22 preset the clean-install and fine-tuning reset default.
- Added a separate persisted Visual Assets layer so custom images do not bloat portable theme JSON.
- Added Adaptive Day/Night plus six additional built-in horse backgrounds and a custom-upload slot.
- Added background horizontal/vertical focus controls; Auto · Scene analyzes the selected background.
- Added four built-in header-logo choices plus custom logo upload and scale.
- Expanded welcome/splash art from the original two to five built-ins plus custom upload and scale; homepage arrows cycle the same gallery.
- Custom images are resized/compressed to WebP locally before storage and never leave the browser.
- Header, home splash, profile emblem and login splash consume the selected artwork consistently.

## v0.42.16 Core Consolidation v1.1.5 — Semantic Light polarity + scene-aware Auto palette

- Expanded **Mirror Dark ↔ Light tone controls** from partial brightness reversal to all ten signed tone channels, including Major/Panel/Card/Control Material shade.
- Signed Appearance Studio endpoint labels/tracks now mirror in Light mode so darker/brighter semantics remain truthful.
- Added **Auto · Scene**, a runtime palette that samples the active background image and derives restrained foundation/accent colors, warm-metal harmony and a split-complementary Ambient triad.
- Dark and Light scene palettes are analyzed/cached independently; manual recalculation is available in Appearance Studio.
- Auto palette deliberately excludes sire/dam/status semantic color authorities.
- Low-color/grayscale scenes remain near-neutral rather than receiving manufactured saturation.
- Added source regression contracts for complete Light/Dark polarity and Auto-palette ownership/derivation.

## v0.42.16 Core Consolidation v1.1.4 — Persistent Chrome stacking

- Added final-loaded `heritage.chrome.css` as the sole persistent navigation stacking authority.
- Corrected the H42-era `.app-shell>* { z-index:1 }` side effect that flattened the sticky topbar into the same stack as page content.
- Raised body-level Docked navigation above viewport overlays while preserving the isolated Ambient/Frost compositor model.
- Made Appearance Studio yield the persistent topbar band and Docked-phone bottom navigation band.
- Added Core UI regression guards for topbar/Dock/Appearance stacking ownership.

## v0.42.16 Core Consolidation v1.1.2 — Runtime load integrity hotfix

## v0.42.16 Core Consolidation v1.1.3 — Appearance Studio accordion

- Appearance Studio sections are collapsed by default.
- Exactly one section may be expanded at a time; opening another collapses the previous section.
- Clicking an expanded section collapses it.
- Closing/reopening Appearance Studio resets to the compact all-collapsed state.
- The six shortcut buttons now open/toggle accordion sections instead of relying on long-page scroll tracking.
- Added explicit accordion accessibility state and regression validation.



- Fixed a startup-blocking `ReferenceError` in extracted `AppearanceStudio.tsx`: the H42 `AMBIENT_PATTERNS` and `AMBIENT_SCOPES` constants had not been carried into module scope.
- Centralized those values as `HERITAGE_AMBIENT_PATTERNS` / `HERITAGE_AMBIENT_SCOPES` in the theme schema and reused them in preset parsing, persistence loading and Appearance Studio.
- Restored the `createPortal` import removed during `main.tsx` consolidation, preventing Docked horse-profile rendering from failing on phone.
- Restored the `TabHierarchyMode` type through the canonical schema alias.
- Fixed a latent H42 SearchPage bug by destructuring `year` from `useI18n()` before rendering suggestion birth years.
- Strengthened `validate-source-syntax.mjs`: in addition to parse diagnostics it now runs a dependency-light semantic pass over browser source and fails on TS2304/TS2552 unresolved-name diagnostics.
- Re-ran 17/17 repository validators, frontend-kit/pedigree TypeScript, 5/5 pedigree coefficient fixtures, Python compile checks and 7/7 Python tests.

## v0.42.16 Core Consolidation v1.1.1 — H42 regression verification

- Compared the consolidation directly against the exact H42 full package from Google Drive rather than relying on handoff claims.
- Confirmed backend/platform/config source and all 95 Q8/EquiData/Prism frontend files are byte-identical to H42.
- Confirmed H42-reachable non-effect Core layout geometry is unchanged after intentional Heritage-scope normalization, including pedigree/lineage/radial geometry.
- Confirmed CSS import order, live custom-property definitions and named animation/keyframe integrity.
- Found and fixed one functional regression: Appearance Studio Shine `Movement cycle` (`shineSeconds`) was persisted but no longer emitted `--h-user-shine-motion-speed`, forcing the H42 default 18s fallback.
- Added validator coverage so the Shine movement-cycle control cannot become disconnected again.
- Added `docs/H42_REGRESSION_PARITY_REPORT.md` with the parity evidence and remaining browser-certification boundary.

## v0.42.16 Core Consolidation v1.1 — Corrective hardening

- Repaired malformed Heritage document-root scoping selectors introduced by the initial Core-isolation pass, restoring H42 profile action, pager, Advanced Registry and danger-control rule matching.
- Added CSS architecture validation that rejects document-root Heritage scopes nested below another selector or duplicated in one selector.
- Made phone Docked navigation part of synchronous Appearance snapshot resolution so persisted desktop presets cannot flash Contextual/Stacked on first paint.
- Guarded empty fallback Material-role selectors before `Element.matches()`.
- Split development behavior into a fast default (`npm run dev`) and explicit React StrictMode lifecycle QA (`npm run dev:qa`).
- Archived historical H42 hotfix reports/smoke fixtures and the superseded Consolidation-v1 handoff/release bundle under `docs/history/`; active root documentation now describes the v1.1 candidate.
- Deliberately deferred deeper Material-state reshaping, legacy-motion retirement and Binder removal until after installed build/browser certification to keep the corrective delta low-risk.

## v0.42.16 Hotfix 42 — Adaptive Frost Performance + Deep Material Shade

- Reworked Core frost performance without removing recursive blur: cheaper 24/14/8/4 default depth radii, automatic dense-screen radius scaling, and removal of redundant backdrop saturation passes.
- Material Depth shade now controls the actual translucent base from -100 (pure black at the selected transparency) through neutral to +100 (white), while text, semantic color and Ambient remain independent.
- Added a visibility-density compositor budget: very dense screens keep blur everywhere but suspend low-value card Ambient and panel Shine; offscreen surfaces remain paused.
- Fixed Ambient rectangular seams by making all radial gradients fill the full oversized moving field, removing rectangular masks and reducing transform travel.
- Strengthened Appearance Studio selection states with aria-pressed semantics, visible selection rings/check badges, and clearer color-coded section overlays.
- Dithering remains attached only to the moving Ambient field and is softened so it no longer reads as a static global screen-door texture.

## v0.42.16 Hotfix 41 — Appearance Studio Information Architecture

- Rebuilt Core Appearance Studio around six explicit visual-system sections: **Foundation, Material & Frost, Ambient & Shine, Color & Meaning, Navigation, Presets & Reset**.
- Added a sticky color-coded section navigator with active-section tracking so long bilingual settings remain easy to orient and traverse.
- Replaced the cramped 2×2 Material Depth card layout with a vertical semantic hierarchy: **Outer Shell → Inner Panels → Content Cards → Interactive Controls**. Each depth keeps its four controls together with explicit examples and role labels.
- Reworded EN/FA control labels for signed brightness as **Brightness / darkness** with Darker / Neutral / Brighter scale cues and signed readouts.
- Added restrained section/depth color coding using borders, markers and badges without taking ownership of Material fill/blur or Lighting.
- Rebuilt range controls with contained cross-browser tracks/thumbs and explicit progress styling to prevent the Firefox overflow/jagged rendering visible in H40.
- Corrected Appearance Studio semantic surface roles: structural editor cards remain Card depth; sliders/checkboxes/nav are Control depth; plain setting label rows no longer masquerade as heavy glass cards.
- Moved reset/preset operations into a dedicated final section and clarified that reset restores fine tuning rather than language/page state.
- Added `heritage.appearance-studio.css` as the final Core-only UI information-architecture authority; it is forbidden from owning `backdrop-filter`. H40 Material/Lighting ownership remains intact.

## v0.42.16 Hotfix 40 — Material Depth / Efficient Lighting

- Formalized Core glass hierarchy as semantic **Material Depth** (Major / Panel / Card / Control) with independent Transparency, Material Brightness, Material Saturation and Backdrop Blur controls. Brightness/saturation grade material color only.
- Preserved recursive frost everywhere while replacing H39's full 30px-at-every-depth default with calibrated **30 / 20 / 14 / 8px** radii to reduce repeated backdrop-filter cost.
- Added `src/web/heritageSurfaceRegistry.ts` as the single runtime role registry consumed by both Material and Lighting, eliminating divergent surface inventories.
- Replaced the multi-wrapper / three-orb / dither / shine local renderer with **one effects node per illuminated surface**: Ambient on `::before`, Specular on `::after`.
- Moved ordered dither inside the moving Ambient field and changed the fresh default to Off. Still freezes it with the light; Off removes it with the light.
- Added visibility-aware effect suspension through IntersectionObserver and incremental MutationObserver binding; offscreen effects pause and drop `will-change`.
- Retired user-facing Ambient/Shine blend-mode controls and fixed both effects to the calibrated Screen composition after cross-runtime behavior proved unreliable.
- Advanced portable theme schema to **v18** with migration from legacy single-blur presets.
- Updated Core/CSS regression validators and the Visual Architecture v2 contract for the new Material Depth/performance invariants.

## v0.42.16 Hotfix 39 — Universal Recursive Frost

- Corrected the remaining Visual Architecture v2 policy mismatch: **Frosted Glass now means every semantic Material surface owns real backdrop blur**, including nested Panel, Card and Control surfaces inside already-frosted parents. Nesting intentionally compounds optical depth instead of disabling blur.
- Removed the H38 bounded/micro-frost exception model. Statistics tiles, pedigree cards, Appearance Studio blocks/controls, dense reference cells, relationship cells, governance/result rows, popovers and other registered material boxes now all follow the same master Glass Blur value.
- Expanded Material role coverage for previously legacy-painted containers/rows so translucent boxes cannot silently fall back to `backdrop-filter:none`. Raw geometry/canvas primitives remain the only intentional no-blur exclusions.
- Kept Ambient and Specular fully separate: Lighting still owns no `backdrop-filter`, material opacity or material background properties. Recursive frost therefore cannot reintroduce the earlier Ambient/Glass coupling.
- Updated the architecture validator and v2 contract documentation to enforce recursive frost as an invariant.
- Headless Chromium computed-style smoke test verifies a nested **Major → Panel → Card → Control → dense cell** chain all compute `blur(30px) saturate(1.1)` under a 30px master setting, while Solid mode resolves all five to `backdrop-filter:none`.

## v0.42.16 Hotfix 38 — Statistics Frost / Pedigree Material Parity / Verified Blend Modes

- Promoted the Statistics card family (`.stats-card`, `.stats-kpi`, ranking/category/load/data/premium metric tiles) to bounded **analytics micro-frost owners**. They now follow the master Glass Blur control with a 24px performance cap instead of remaining sharp translucent paint over the scene.
- Fixed the real Lineage parity defect: sire/dam/offspring relation tones are now bound inside the v2 **Material authority**, so Lineage rows resolve to the same semantic material colors as Map cards while retaining pedigree micro-frost. The previous Motion-layer background was correctly calculated but lost to the later Material cascade.
- Fixed Ambient/Shine blend control rendering. Blend state was reaching CSS, but applying `mix-blend-mode` to a parent composite did not affect compositor-promoted moving light children. The selected blend is now applied directly to the moving Ambient orbs/local light bodies and Specular body.
- Added headless Chromium computed-style/pixel verification: statistics cards compute real blur, father/mother Lineage rows resolve to distinct semantic fills with the same blur, and Screen/Soft-Light/Overlay/Color-Dodge now produce measurably different rendered pixels.
- Strengthened the CSS architecture validator to lock analytics frost ownership, Lineage material tint bindings, and direct light-body blend application without granting Lighting any Material properties.

## v0.42.16 Hotfix 36 — Per-Surface Ambient / Scheme Triads / Dither / Blend Controls

- Replaced the default full-page Ambient wash with **per-surface post-material lighting**. Major, panel and selected card surfaces receive independent clipped light fields; users can switch Ambient scope between **Surfaces**, **Major**, and **Global** without changing Material blur/transparency.
- Reworked **Chromatic Depth** into a true three-color split-complementary palette derived from each selected Color Scheme. Organic Drift remains tonal; Chromatic is now intentionally multi-color and scheme-coherent.
- Added optional **Ambient dithering** as a tiny ordered-noise overlay that exists only in the Lighting subsystem, reducing gradient banding without touching backgrounds or backdrop filters.
- Added independent **Ambient blend** and **Shine blend** controls (`screen`, `soft-light`, `overlay`, `color-dodge`) and persisted/exported them in preset schema **v17**.
- Moved **Specular Shine** completely off the global page plane. Shine is now clipped per Major/Panel material surface only; cards do not receive the moving sweep.
- Added a DOM surface-lighting binder so post-material effects have dedicated overlay nodes rather than competing for component `background-image` or `backdrop-filter` ownership.
- Updated Core/CSS validators to enforce the new per-surface lighting contract and reject a return of global Specular sweep or Lighting→Material coupling.

## v0.42.16 Hotfix 34 — Core Visual Architecture v2

- Rebuilt the Heritage/Core visual composition contract around explicit **Material** and **Lighting** authorities instead of another cascade override. `heritage.material.css` now owns surface fill/transparency/true frost; `heritage.lighting.css` owns post-material Ambient and Specular effects. Q8/Aspnamā, EquiData and Prism remain independent and untouched.
- Replaced the old two-state Tint Motion model with semantic **Ambient Animated / Still / Off**. Still preserves the same atmospheric light and freezes only time; Off removes only Ambient. Presets move to schema **v16** with migration from legacy `tintMotion`.
- Retired the live `heritage.ambient.css` / `heritage.runtime-ambient.css` import path and removed the temporary ambient-stage DOM. Historical `[data-tint-motion="animated"]` painters remain dormant behind a pinned compatibility attribute rather than participating in the live renderer.
- Decoupled Ambient from frost and material alpha. Ambient brightness/saturation/strength/pattern/pace now feed only the post-material lighting renderer; Glass blur and the four transparency tiers feed only Material. Historical animated-material-alpha compensation is removed.
- Corrected semantic material roles: Appearance Studio is explicitly a **Major** outer surface despite being rendered through a `document.body` portal. Nested panels/cards/controls no longer recursively own backdrop blur; explicit outer/detached true-frost owners sample the backdrop once.
- Made Specular Shine independent from Ambient state. Shine can animate with Ambient Animated, Still or Off and no longer relies on the historical tint-motion gate.
- Rewired **Halo Softness** to a real, restrained material halo instead of leaving the exposed Appearance Studio control without a final consumer.
- Fixed a latent invalid color-token reference in `heritage.refinement.css` (`--h-accent-strong` → canonical `--accent-strong` fallback), which could invalidate an entire gradient at computed-value time.
- Rewrote CSS architecture validation around v2 invariants instead of requiring obsolete GAS/local-painter strings. The validator now rejects Material↔Ambient coupling, deprecated live ambient imports, animated material-alpha compensation and loss of the portal/Major-surface contract.
- Removed redundant/dead runtime CSS-variable emissions left by earlier theme generations. A final wiring audit now finds **70/70 emitted `--h-user-*` variables with at least one CSS consumer**, eliminating the known class of “slider/state writes a variable nobody reads” defects.
- Added `docs/CORE_VISUAL_ARCHITECTURE_V2.md` as the ownership/stacking/settings contract for future Core work.
- Source-side promotion checks pass across the dependency-light validation matrix and Python checks. Dependency-backed TypeScript/Vitest/Vite build checks could not be completed in this workspace because the package registry is unreachable and the supplied code-only archive has no complete dependency tree; browser render QA remains a user/runtime promotion step rather than an unverified claim.

## v0.42.16 Hotfix 28 — True Frost / Tokenized Design System / Effect Grading / Persian Polish

- Fixed the “bloom over a sharp scene” glass regression at its source. The previous effective blur ladder plateaued far below the Appearance slider; the new role-based true-frost ladder scales through the full 10–64px input with major/panel/control/card ceilings of 64/50/36/30px while dense pedigree geometry stays compositor-safe.
- Refactored the active Heritage visual stack into explicit layers: legacy/base → **design-token kernel** → **variable-only color engine** → analytics/component paint → ambient → motion → navigation → narrow optical refinement. New `heritage.tokens.css` owns geometry/frost/motion/material roles; new `heritage.color.css` owns palette/semantic/contextual transformations; `heritage.final.css` is again component paint authority; `heritage.refinement.css` is restricted to optical corrections.
- Reduced the terminal paint file by roughly 21 KB / 260 lines by extracting scheme, semantic and contextual color processing into `heritage.color.css`. Automated architecture guards reject component selectors/pseudo-painters/keyframes in the token/color layers and reject new motion keyframes in optical refinement.
- Added independent **Ambient brightness / saturation** and **Shine brightness / saturation** controls. They grade the actual scheme-derived effect source before blending; effect Strength and Pace remain independent. Theme tuning/preset schema is v15 with migration from earlier keys.
- Retired local ambient/shine pseudo painters from nested Record, claim, breeding, premium-intelligence, desk, governance, admin and person subpanels, eliminating the tiny glowing rectangle artifact. Major workspaces own atmosphere; nested surfaces reveal it through translucency.
- Removed the extra square backing surface behind the Welcome feature grid; `.premium-features` is layout-only and the rounded `.welcome-workspace` owns clipping/material.
- Split specular composition by theme. Dark keeps a restrained scheme-colored soft-light plume; Light uses a broader/lower-energy scheme-colored normal blend to avoid the milky moving band.
- Expanded Persian presentation polish: canonical/read-only numbers, theme units/readouts, feature/generation/confidence labels, workflow statuses, breeding/reference provenance, registry analytics narratives, percent signs, sample/count labels and several technical summaries now use natural Persian presentation and Persian digits where appropriate.
- Final source-side verification: **17/17 repository validators pass**, production syntax is **120 TS/TSX files / 0 diagnostics**, and all **10 imported Heritage stylesheets parse with 0 CSS errors**. Browser pixel/render QA remains external and is not claimed here.

## v0.42.16 Hotfix 27 — Navigation Depth / Reserved Sex Colors / Connected Workspace Paths

- Reserved the exact canonical **sire/male blue** and **dam/female pink** for pedigree/sex semantics only. Non-primary navigation now uses a separate scheme-aware teal/amber/violet/copper/sage/steel vocabulary and cannot consume `--h-sire` or `--h-dam`.
- Added `src/web/styles/heritage.navigation.css`, loaded last, as a dedicated navigation-depth authority. The top global `.main-nav` is intentionally excluded.
- Unselected non-primary tabs/subtabs/dock/view-switch controls are now borderless, darker, slightly smaller and visually recessed. Hover gently restores presence without giving inactive controls a persistent rim.
- The selected branch is brighter, slightly larger and subtly animated through registered custom-property fill/glow channels. No translated sheen, GAS plate or hard sweep is attached to tab selection.
- Fixed a real cascade hazard discovered during audit: older terminal rules used high-specificity `animation:none!important` on active tabs. Hotfix 27's selected-state contract now matches terminal state specificity, so the new active breathing cannot silently exist in source while remaining visually frozen.
- Added connected workspace route trails for Horse Profile, Statistics and nested Premium Intelligence. Active tabs also emit a restrained path stem toward the controlled content, making the current navigation ancestry legible at a glance.
- Locked Appearance Studio to the **physical right side** of the viewport in both English and Persian; content direction can change without moving the settings panel to the opposite side.
- Preserved Hotfix 26 balanced ambient/specular controls, Control prominence, Map/Lineage/Radial pedigree material parity, and v0.42.15 absolute Map geometry.
- Validation: all 17 dependency-free repository validators pass; 119 production TS/TSX files parse with 0 diagnostics; all 7 imported Heritage stylesheets parse with 0 CSS errors. Browser pixel/render QA is still external and is not claimed in this workspace.

## v0.42.16 Hotfix 26 — Balanced Ambient Energy / Specular Motion / Pedigree Visual Parity

- Expanded **Ambient strength** to 0–200%. 100% remains the calibrated reference; values above 100% intentionally boost both Organic Drift and Chromatic Depth without relying on pseudo-element opacity that would clip at 1.0.
- Rebalanced ambient luminance around one midpoint in both Light and Dark themes. Lift and depth lobes now use matched geometry and matched alpha, with a soft-light composition so long-run ambient energy does not systematically brighten or darken the material.
- Strengthened **Chromatic Depth** specifically: scheme-derived bright/deep lobes and the analogous companion now have a substantially higher usable ceiling while preserving the active Color Scheme hue family.
- Added optional **Specular motion** as a separate second motion layer. One broad host-sized sheen glides side-to-side through registered gradient-centre coordinates; the canvas never translates, there is no hard sweep edge, and reduced-motion disables it. Appearance Studio adds Moving shine strength, Shine pace and Animate glass shine.
- Added **Control prominence** for tabs, dock buttons and other primary control rails. Interactive surfaces receive denser scheme-tinted material, stronger borders, clearer color and deeper active states so controls stand out from passive glass.
- Unified Heritage pedigree material across **Map, Lineage and Radial**. Sire/dam/offspring forms now consume the same semantic background strength, semantic border strength, role hue, opaque card foundation and hover depth; only geometry differs.
- Added dedicated `heritage.motion.css`, loaded after the terminal and ambient modules, so Hotfix 26 motion/interaction extensions remain isolated instead of bloating `heritage.final.css`. Theme tuning storage is v13 and portable theme JSON is v14.

## v0.42.16 Hotfix 25 — Chromatic Depth Ambient Pattern

- Added a second Ambient Pattern while preserving **Organic Drift** as the default. **Chromatic Depth** uses three independently moving, fixed-canvas gradient fields instead of replacing the established ambient language.
- The three fields are color-theory related: processed scheme hue (dominant), restrained analogous companion (secondary), and a quieter split-complementary accent (depth). Companion colors are explicitly curated per Neutral/Heritage/Midnight/Oxblood so the result stays premium rather than RGB/gaming-like.
- All three companion colors inherit the same Scheme Character, Brightness, Saturation and Contrast pipeline. Neutral remains intentionally achromatic; Heritage uses olive/gold/plum relationships; Midnight uses blue/teal/copper; Oxblood uses red/plum/teal.
- Each Chromatic Depth layer has its own registered coordinate pair, trajectory and independent cycle length derived from Ambient pace. No moving image canvas, sweep-light, screen-blend plane or neutral-white/black ambient lobe is introduced.
- Moved the optional ambient-pattern extension into dedicated `heritage.ambient.css`, loaded after the consolidated terminal paint contract and scoped only to `data-ambient-pattern="chromatic"`. The terminal `heritage.final.css` remains below its anti-bloat ceiling.
- Added Appearance Studio **Ambient pattern** choice and persisted it through `registry-ambient-pattern-v1`; theme JSON schema is now v13 and round-trips the selected ambient pattern.
- Added reduced-motion shutdown for the Chromatic Depth module and regression locks for pattern state, three-layer keyframes, seam-free host-sized canvases and independent speed channels.
- All 17 dependency-free source validation suites pass; production syntax remains 119 TS/TSX files with zero parse diagnostics.

## v0.42.16 Hotfix 24 — Full-Spectrum Scheme Ambient

- Fixed the remaining grayscale wash in animated ambient lighting. Hotfix 21 still used neutral white and neutral black lift/depth clouds that visually dominated the weaker scheme chroma.
- Replaced every global/local ambient lift and depth lobe with lighter/deeper tones derived from the fully processed Color Scheme. Heritage stays green/olive, Midnight stays blue, Oxblood stays red, and Neutral remains neutral by design.
- Scheme Character now also drives an explicit ambient scheme-character channel; Scheme Brightness, Saturation and Contrast already flow through the processed `--h-scheme-base` / `--h-scheme-chrome` tones before ambient consumes them.
- Increased the calibrated scheme-chroma/metal contribution so moving atmosphere remains recognisably colored through frosted glass instead of collapsing toward gray.
- Added regression locks that reject neutral white/black ambient lift/depth painters and require the scheme-derived lift/depth family.
- All 17 dependency-free source validation suites pass; production syntax remains 119 TS/TSX files with zero parse diagnostics.

## v0.42.16 Hotfix 23 — Independent Semantic Fill/Text + Visible Ambient Control

- Split semantic color customization into independent **Background fill** and **Text & accents** laboratories. Background fill now has its own strength, brightness and saturation; foreground semantic text has its own color strength, brightness and saturation; border/accent strength remains independently tunable.
- Removed the hidden coupling where `tintEnergy` scaled semantic card fill opacity. Semantic background visibility now owns fill opacity directly, so changing border/accent strength no longer changes card background strength.
- Added dedicated semantic background tone variables (`--h-*-bg`) so background saturation/brightness no longer alters semantic foreground text colors. Existing v11 presets migrate safely by copying the former semantic brightness/saturation into the new background controls while keeping text visibility at 100%. Persistence is now `registry-theme-tuning-v12`; JSON preset schema is v12.
- Fixed Premium Pedigree / Reference Intelligence metrics that still used an older fixed 7% gradient. Their blue/green/pink/amber/red boxes now consume the same semantic background channel as sire/dam horse cards, while their numeric/text color consumes the separate text channel.
- Extended the independent background channel to sex chips, radial sire/dam sectors, registry semantic cells, status badges, breeding/optimizer result states, governance actions and selected analytics semantic blocks.
- Promoted **Ambient strength** into the second Appearance Studio section directly below Foundation, ahead of the long Color & Meaning laboratory, so the ambient visibility control is easy to find. Ambient pace remains separate.
- Preserved Hotfix 22 preset-grid correction, bipolar seam-free ambient motion, tiered frost, professional button interactions, Smart Launcher v9 freshness and v0.42.15 pedigree geometry authority.
- All 17 dependency-free source validation suites pass; production syntax remains 119 TS/TSX files with zero parse diagnostics.

## v0.42.16 Hotfix 22 — Theme Preset Grid Crush Fix

- Fixed the Appearance Studio preset-row glitch visible as three stacked black capsules at the sidebar edge.
- Root cause: an older two-column `.theme-json-actions` grid (`auto minmax(0,1fr)`) survived the later redesign. The long portable-preset status sentence sized the `auto` track to nearly the full sidebar width and crushed Export / Import / Copy into a few pixels.
- The preset section is now a strict one-column stack with full-width, min-width-safe rows in both LTR and RTL.
- Added a CSS architecture regression lock so the preset action grid cannot fall back to the legacy two-column contract.

## v0.42.16 Hotfix 21 — Bipolar Ambient Lighting + Appearance Precision Controls

- Fixed the Appearance Studio left-edge RTL artifact by giving its scroll container a stable physical-right scrollbar and eliminating clipped edge-straddling help bubbles.
- Ambient motion now oscillates around a neutral visual midpoint: independent feathered light and shadow clouds brighten and darken glass while restrained scheme chroma moves underneath. No rectangular ambient canvas moves.
- Added `Semantic background visibility` and `Contextual background visibility` controls so colored text/accent/borders can remain visible while colored fills are independently reduced to zero or strengthened.
- Added `Reverse brightness controls in Light mode`; when enabled, positive brightness values darken and negative values brighten in Light mode only across Scheme, Semantic and Contextual channels.
- Appearance persistence moved to `registry-theme-tuning-v11`; v10 and older presets migrate safely, with new background-visibility controls defaulting to 100% and brightness reversal off. Theme JSON schema is now v11.
- Rebalanced the Color & Meaning laboratory into clean 2×2 control grids and added a dedicated checkbox treatment with clearer contextual help.
- All 17 dependency-free validation suites pass; production syntax remains 119 TS/TSX files with zero parse diagnostics.

# Changelog

## v0.42.16 Hotfix 20 — Seamless Ambient Glass / Appearance Studio Pro

- Replace Hotfix 19 moving background-image rectangles with seam-free ambient fields: each local canvas remains exactly host-sized while only the centres of large feathered radial clouds move. No moving rectangular image boundary can cross a glass surface.
- Preserve the two-layer ambient architecture: one page-wide atmosphere plus bounded local ambient fields on major/workspace glass owners; dense pedigree nodes, rows and micro-controls remain free of continuous decorative paint.
- Add independent `Ambient visibility` (0–100%) and `Ambient pace` controls.
- Rebuild Appearance as a structured **Appearance Studio** with Foundation, Color & meaning, Glass & atmosphere, Navigation layout, Material fine tuning, accessible bilingual help tooltips and clearer copy.
- Expand scheme control into independent Character, Brightness, Saturation and Contrast channels. Scheme saturation runs from monochrome through calibrated to vivid without altering semantic status meaning.
- Expand semantic color coding beyond sire/dam horse cards: info, success, warning, danger, quality/admin surfaces, registry metrics, table color cells, badges/status chips and breeding controls now consume the same semantic color laboratory. Add independent Semantic Strength, Brightness and Saturation.
- Add an independent **Contextual colored blocks** channel for non-semantic feature/metric/result/detail/analytics cards, with its own Strength, Brightness and Saturation. This separates visual grouping from meaning-bearing colors.
- Add portable theme presets: **Export JSON**, **Import JSON** with validation/range clamping, and clipboard Copy JSON. Theme preset schema and persistence are version 10 with migration from v9/v8/v7/v6/v5.
- Preserve tiered frost, professional button interactions, no-GAS/no-sweep guards, semantic pedigree geometry and all v0.42.15 map-geometry authority.

## v0.42.16 Hotfix 17 — Frosted Ambient Glass / Button Motion

- Restore real bounded backdrop blur to the consolidated Heritage glass tiers after Hotfix 16 had zeroed card/control blur during compositor cleanup.
- Use a performance-capped frost ladder: strong blur for major surfaces, medium for panels, light for cards/controls, with pedigree geometry and dense repeated leaf cells explicitly compositor-free.
- Keep one shared ambient field behind the UI, but layer it above the scene artwork and make the Appearance motion-period control map directly to its real animation period so motion is visibly alive again.
- Preserve the no-GAS/no-sweep architecture: surface backgrounds remain full-box color mixes with no animated per-card gradient canvases or travelling shine.
- Add explicit spring-like button hover/press/focus motion using small lift/compression and shadow response only; no pseudo sweep-light is introduced.
- Validate 32-state CSS behavior plus 192 representative cascade assertions across glass/solid, light/dark, animated/still and all four palettes.

## v0.42.16 Hotfix 13 — Bounded Professional Schemes / Scheme-Era Liveliness

- Reintroduce Core/Heritage Color Schemes as a new bounded paint system: Neutral, Heritage, Midnight and Oxblood.
- Keep all retired legacy scheme/GAS painter variables at zero; the new scheme channel never uses oversized gradients, cropped overlays, background-position fields or GAS pseudo painters.
- Make schemes recolor complete foundations only: base surfaces, chrome, accents, borders and scene toning.
- Keep semantic color coding independent and invariant across schemes: sire/male blue, dam/female pink, warning amber, success green, danger red and info cyan.
- Restore a separate `Scheme character` control alongside `Color-coded blocks`; scheme strength affects only complete surfaces.
- Restore the older scheme-era sense of liveliness through whole-surface chroma/depth breathing and sub-pixel major-panel float while preserving Hotfix 12's restrained highlight/halo treatment.
- Keep pedigree cards opaque/compositor-safe and preserve all v0.42.15 geometry plus donor GAS retirement.

## v0.42.16 Hotfix 11 — Neutral Base / Semantic Color Only

- Retire the Core/Heritage decorative palette system entirely: no Heritage/Oxblood/Graphite chooser, no palette state, and no `schemeEnergy` control.
- Migrate old Appearance settings to v6 while discarding saved Scheme Energy and deleting the legacy palette preference.
- Force every historical generic scheme/master-tint channel to zero so no scheme-controlled centered tint slab can render again.
- Make both light and dark Core bases achromatic while preserving the natural scene artwork.
- Keep hue only where it communicates meaning: sire/male blue, dam/female pink, warnings/repeats amber, success green, danger red, info cyan and other explicit semantic surfaces.
- Preserve donor GAS/compositor retirement and subtle glass rim/halo breathing; motion does not paint or move any color-scheme field.

## v0.42.16 Hotfix 10 — GAS Permanently Retired / Glass Rim Motion

- Preserve the user-supplied v0.42.13 GAS/compositor band fix as the terminal Core paint authority.
- Restore `animation:none!important` on the donor GAS firewall so legacy living-surface animations cannot reactivate through Animated mode.
- Replace Hotfix 9 directional inset/fill animation with non-spatial rim/halo breathing only; no background image, position, size, filter, transform, mask, or directional inset slab participates.
- Remove the Appearance `Gas softness` control, migrate any saved value to `Glass halo softness`, and explicitly delete legacy GAS CSS variables at runtime.
- Keep the scene artwork, bounded semantic fills, equal sire/dam tint math, pedigree geometry, and Smart Launcher v9 freshness protection intact.

## v0.42.16 — Core Phone / Pedigree / Semantic Motion Polish

- Force Docked hierarchy whenever Heritage enters phone geometry; compact dock rows maximize readable label size without horizontal ribbon scrolling.
- Remove residual rectangular/square animation carriers and the travelling left-to-right sheen; Core glass now has one bounded organic radial animation layer.
- Make Map, Lineage and Radial strictly exclusive; make Radial 100%/zoom-out non-scrollable.
- Replace the Family Map carrier/flow/spark stack with one moving regular-dash relationship path and strengthen branch-hover isolation.
- Centralize sire/dam colors with equal tint strength across Map, Lineage, Radial and Registry, with stronger light/dark parity.
- Reduce Appearance tint authority to Color scheme + Color-coded blocks; remove legacy semantic-strength runtime state.
- Make horizontal analytic fills locale-logical (LTR left-origin, RTL right-origin), allow tall phone welcome art to exceed its frame, and restrain button motion.
- Preserve v0.42.15 absolute pedigree node geometry and leave Q8, EquiData and Prism source unchanged.
- Application bumped to 0.42.16; Platform contract remains 2.11.1.


## v0.42.15 — Pedigree Map Geometry Authority
- Fixed the actual Core Family Map regression introduced in v0.42.9: generic living-surface CSS forced `.ped-card` from `position:absolute` to `position:relative`, while SVG connectors remained in canonical absolute graph coordinates.
- Restored Map cards to absolute positioning without changing Fit Width, layout coordinates, connector mathematics, or fit-scale behavior.
- Removed `.ped-card` only from the two generic surface-authority blocks that forced relative positioning; visual tint/glass rules remain intact.


## v0.42.15 — Surface Authority, Legacy Map Recovery & Viewport Appearance

- Separated semantic color-code strength from general scheme energy.
- Removed structural/pseudo background planes that created hard rectangular patches and added tokenized nested spacing/radius rules.
- Rebuilt Appearance mounting around a fixed body-level viewport layer.
- Restored the pre-regression v0.42.1–v0.42.5 Pedigree Map kinetic/orthogonal visual contract and neutralized later fork/carrier experiments.
- Made quality/category bars animate from zero toward their positive value with locale-correct transform origin.
- Raised the dark-theme secondary-text contrast floor while keeping Living Flow linear/dispersed.

## v0.42.12 — Geometry Recovery & No-Rectangle Living Surfaces

- Fixed the accidental global child-positioning rule that made the Database Explorer header enormous and disturbed absolute card ornaments.
- Restored continuous Pedigree Map carrier lines; kinetic flow/spark remain overlays instead of replacing readable topology.
- Removed the remaining center-rectangle pseudo layers from pedigree intelligence, premium/statistics and nested glass surfaces.
- Living Flow now animates feathered surface gradients directly with constant linear motion; Still remains edge-biased and static.
- Reasserted fixed viewport anchoring for the Appearance sidebar.

## v0.42.11 — Surgical Map Rollback & No-Square Living Glass

- Restored the Core Pedigree Map relationship connector renderer exactly to v0.42.8, including its orthogonal path geometry, kinetic flow and spark channels.
- Removed the later family-junction/fork connector experiment.
- Removed static center background imagery and legacy rectangular `::before` highlight planes from covered Heritage glass surfaces.
- Preserved animated Living Flow with fully feathered radial fields and constant linear timing; Still mode uses edge-only gradients.
- Retains v0.42.10 typography, fixed Appearance sidebar and phone-default Docked navigation.


## 0.42.10 — Preferred Typography, Viewport Appearance Sheet, Family Forks & Linear Living Flow

- Rebound Heritage legacy font aliases to the canonical locale-aware typography stacks and made Vazirmatn/Noto Serif Arabic first-class in Persian mode.
- Fixed the Appearance laboratory regression caused by the late generic glass rule forcing the body portal to `position: relative`; the sheet is now viewport-fixed from any scroll depth.
- Replaced Pedigree Map triple edge overdraw with a neutral shared family trunk and separate semantic sire/dam/offspring branches.
- Changed Living Flow and selected-tab motion to constant linear cycles, larger dispersed gas fields and staggered surface phases.
- Added a one-time phone hierarchy migration so phone layouts default to Docked while later explicit choices persist.
- Strengthened `validate:ui-42` for these contracts.

## v0.42.9 — Living Motion Restoration & Rectangular Artifact Removal

- Fixed the root cause of the Living Flow freeze: v0.42.8 animated visual properties were pinned by `!important`, so animations could run without changing the rendered gradient positions.
- Restored real motion with registered, continuously interpolated gas/shimmer coordinates on a transparent `::after` layer.
- Explicitly clears legacy pseudo-element backdrop blur, fill, border, shadow and transform so the animated layer cannot appear as a centered square/rectangle.
- Keeps Still mode as a clean, static edge-biased semantic gradient.
- Restored visibly animated semantic selection for primary/secondary/tertiary/docked tabs with typed focal coordinates.
- Added browser component probes that verify gas and tab coordinates change over time.


## v0.42.8 — Optical Safe Art, Organic Glass & Chart Discipline

- Heritage/Core-only corrective presentation release; platform contract remains 2.11.1 and canonical data/analytics semantics are unchanged.
- Replaced the Q8 splash-art resource with an optically padded cache-busting asset and a true inset safe frame so the full plaque/horse stays centered and cannot be clipped by the hero's overflow boundary.
- Removed legacy tint pseudo-plates from all tintable surface families, including home metrics and chart micro-surfaces, and moved the hero frost back onto the surface itself.
- Rebuilt Living Flow on standard `background-position` animation rather than registered custom-property interpolation. The new oversized radial gas fields fade fully before their image edges and a separate faint shine travels independently, eliminating centered square/rectangular patches.
- Kept Still mode strictly non-animated with a simple asymmetric semantic gradient.
- Rebuilt Population/category/sex/coverage bar rows into language-native logical grids: EN/LTR and FA/RTL now control label direction, bar fill origin and numeric alignment consistently, with wider useful tracks and tabular counts/percentages.
- Preserved semantic animated/static tab styling across Context, Stacked and Docked layouts.
- Bumped theme-tuning storage to v3 so stale experimental rendering parameters do not pollute the corrected defaults.
- Strengthened `validate:ui-42` for the new safe hero asset, plate retirement, organic-flow v5 and structured sex-distribution layout.

## v0.42.7 — Organic Flow, Optical Art & Semantic Tabs

- Heritage/Core-only corrective presentation release; platform contract remains 2.11.1 and canonical data/analytics semantics are unchanged.
- Replaced the v0.42.6 background-position animation with typed full-surface gradient focal coordinates. Animated gas and the travelling shine now move organically without any translated/scaled rectangular image layer or pseudo highlight plate.
- Made animated glass bases slightly clearer than Still mode so luminous tint energy does not optically reduce transparency; gas-softness now maps to cloud spread rather than a text-blurring filter.
- Optically lifted and slightly reduced the donated Q8/Aspnamā hero artwork so the visible horse/plaque sits centered with bottom breathing room and no clipping.
- Made Statistics → Quality → Field coverage labels explicitly follow EN/LTR versus FA/RTL direction and alignment.
- Unified semantic color coding across primary, secondary and tertiary tabs in Context, Stacked and Docked modes on desktop/phone. Active tabs receive a restrained moving semantic glow/shine in Flow and a static semantic gradient in Still.
- Strengthened `validate:ui-42` with direct guards for typed organic gas, transparency compensation, optical hero centering, localized chart direction and animated semantic tab selection.

## v0.42.6 — Stable Art, Living Surfaces & Mobile App Docks

- Heritage/Core-only presentation refinement; platform contract remains 2.11.1 and canonical data/analytics semantics are unchanged.
- Replaced bidi-sensitive splash arrows with physical SVG chevrons and recropped the donated Q8/Aspnamā emblem to its real alpha bounds so EN/FA share the same navigation geometry and the alternate art centers without invisible-padding clipping.
- Rebalanced Data Quality coverage rows so field labels stay compact and the horizontal coverage track consumes the available desktop width instead of leaving a large empty middle column.
- Rebuilt Flow as direct-background multi-field living glass: diffuse semantic gas fields drift and breathe while an independent shine crosses the surface; legacy pseudo highlight plates remain disabled, and Still remains a clean non-animated gradient.
- Made Master color amount the upstream tint authority for both static gradient color and animated gas, while retaining independent gas, shine, softness, speed and four-level transparency controls plus Copy Theme JSON.
- Removed inverse map-text compensation so pedigree Map typography scales naturally with Fit/zoom together with its cards.
- Stabilized Radial around a width-derived default viewport, added explicit radial zoom controls, and exposed Radial in the phone visualizer switch.
- Portal-rendered true phone Docked navigation for profile and Statistics: primary app tabs are fixed to the bottom safe area, secondary rows build above them, and Premium Intelligence tertiary tabs form the next dock layer.
- Strengthened `validate:ui-42` for physical hero arrows, cropped art, wide coverage tracks, master tint authority, scaling Map typography, stable/mobile radial and body-level app docks.

## v0.42.5 — Living Glass & Navigation Repair

- Heritage/Core-only corrective presentation release; platform contract remains 2.11.1 and canonical data/analytics semantics are unchanged.
- Rebuilt animated semantic tint as edge-faded living gas fields plus a travelling glint; legacy rectangular/square light plates are explicitly retired, while Still mode uses static gradients only.
- Added independent moving-shine and gas-softness controls to the persisted Advanced glass laboratory and made the appearance surface a body-level portal with real backdrop blur.
- Enforced strict desktop profile hierarchy in normal document flow so context copy, primary tabs and active subtabs cannot overlap or sit beside each other accidentally.
- Added a genuine third **Docked · EXP** hierarchy mode: phone primary navigation stays at the bottom and each deeper active tab tier stacks directly above it.
- Restored compact pedigree Map cards by removing the extra relation/sex header row; two-line adaptive horse names and HorseNo remain available even at micro LOD.
- Increased default transparency while preserving separate outer/panel/card/control hierarchy tuning and light/dark parity.
- Strengthened `validate:ui-42` to lock the portal sidebar, three hierarchy modes, living-gas mask, compact Map cards and Still-mode pseudo-layer removal.

## v0.42.4 — Adaptive Glass Laboratory & Pedigree Map Repair

- Heritage/Core only; platform contract remains 2.11.1 and no canonical data/analytics semantics changed.
- Added persisted advanced theme tuning for four glass hierarchy transparencies, blur, semantic tint energy and motion period, with exact Copy JSON export.
- Lowered default optical density and unified light/dark transparency authority so Welcome, Registry, Stats and profile surfaces resolve through the same centralized tokens.
- Replaced fixed-corner semantic tint blobs with bounded travelling aurora fields; expanded motion coverage to homepage metrics, statistics micro-surfaces and active hierarchical tab selections.
- Added semantic color coding to primary/secondary/tertiary selected tabs and their text/icons while retaining Still/reduced-motion modes.
- Desktop Appearance is an advanced fixed sidebar; mobile remains viewport-contained.
- Repaired the v0.42.3 pedigree Map regression by restoring compact horizontal generation columns and normal orthogonal connectors; focal-above-parent composition remains Lineage-only.
- Added sticky profile-nav/context clearance and reinforced locale-invariant mobile toolbar geometry.
- Experimental phone hierarchy supports stacked primary/secondary/tertiary bottom app rows.
- Strengthened `validate:ui-42` for the new glass laboratory, Map geometry, locale-stable toolbar, travelling tint and stacked-dock invariants.


## v0.42.3 — Explicit Navigation & Unified Glass Contract

- Made Heritage primary/secondary/tertiary tab rails deliberately obvious with hierarchy labels, stronger frosted button surfaces and explicit active markers.
- Added **ALL / همه** continuous-scroll fallback modes to horse profiles, Registry Intelligence and Premium Intelligence.
- Added persisted experimental **Context / Stacked** tab hierarchy; Stacked adds a dedicated secondary row below primary desktop tabs and above the primary phone profile dock.
- Made top-level Heritage header/navigation physical placement stable across EN/FA instead of mirroring control order.
- Rebuilt the appearance dropdown as a fixed, viewport-contained frosted glass panel that keeps its physical anchor in both locales.
- Strengthened the centralized glass contract across panel/card/control families in light and dark modes.
- Extended Flow/Still semantic tint motion to the major tinted panels, cards, navigation rails and analytical surfaces with scale-dependent motion intensity.
- Donated Q8/Aspnamā's main logo asset to Core as an optional welcome-hero emblem with low-key previous/next controls and a persistent two-state selection.
- Preserved v0.42.2 pedigree Map Fit Width, exact-fit radial, focal-above-parent Lineage/Map geometry, fullscreen and compact-footer behavior.
- Expanded `validate:ui-42` to lock ALL modes, explicit rails, locale-stable controls, viewport-safe appearance glass, centralized blur tokens, unified tint motion and donated hero-art switching.
- Application bumped to 0.42.3; Platform contract remains 2.11.1 and analytics schema/algorithm remain unchanged.

## v0.42.2 — Hierarchical Workspaces & Refined Glass

- Broke Heritage Registry Intelligence out of the monolithic scrolling page into six primary domains with focused secondary views; Premium Intelligence adds a local third-tier navigation.
- Added changing profile/stat workspace context so primary and sub-tab transitions visibly update the heading/explanation and return the user to the active workspace.
- Reworked desktop pedigree Map and Lineage geometry so the focal horse sits above sire/dam instead of consuming a dedicated horizontal column.
- Made desktop Map default to Fit Width and made fitted map height follow rendered content outside fullscreen, removing unused lower-stage space.
- Tightened radial ancestry to a near-edge outer guide and square measured host for better box utilization.
- Recalibrated light-mode nested surfaces to the same translucent glass hierarchy as dark mode.
- Consolidated appearance controls into one settings package while retaining a standalone light/dark toggle.
- Added persisted Flow / Still semantic tint motion with automatic reduced-motion fallback.
- Reduced final page/footer dead space again and preserved phone navigation collision guards.
- Updated Core/design/presentation/Stage-2 validators for the new hierarchy and geometry.
- Application bumped to 0.42.2; Platform contract remains 2.11.1 and analytics schema/algorithm remain 2.1.0 / 2.1.0 because this release is presentation/composition only.

## v0.42.1 — Core Visual QA Polish

- Converted Heritage/Core horse profiles into Pedigree / Record / Relationships / Breeding workspaces with adaptive desktop/mobile navigation.
- Fixed the phone header so all five primary destinations remain in one row, and moved the floating frontend selector above the phone profile dock.
- Added persisted Subtle / Balanced / Vivid tint-strength control.
- Made pedigree default to full-box fit with a taller centered workspace; added native fullscreen while retaining view/fit controls.
- Fixed phone pedigree controls, dark/mobile card solidity/tint, micro-scale card clipping, radial long-name fitting and radial space usage.
- Made lineage-influence trajectories container-responsive so narrow layouts cannot squeeze three columns together.
- Compacted the oversized ornamental Core footer.
- Added `validate:ui-42` and wired it into the release check chain.
- Application bumped to 0.42.1; Platform contract remains 2.11.1 and analytics schema/algorithm remain 2.1.0 / 2.1.0 because this release is Core presentation/composition only.

## v0.41.2 — Reference Sampling Calibration

- Benchmarked deterministic reference sample sizes 16/32/64/128/256 against a larger n=512 pedigree-reference baseline across six large real cohorts.
- Measured production n=32 overall MAE **0.1863 percentage points** (P90 0.5371 pp, P95 0.7009 pp); nominal-95% empirical coverage was 82.2%, proving the old interval must not be read as a guaranteed 95% empirical interval.
- Added per-horse `meanKinship.samplingPrecision` with independent high/medium/low/unavailable grading and nominal 95% half-width.
- Added semantic precision visualization to Heritage, Q8, EquiData and Prism and relabeled the interval as nominal rather than guaranteed.
- Added `tools/benchmark_reference_sampling.py`, `npm run benchmark:reference-sampling`, a precision-classifier unit fixture and calibration documentation.
- Confirmed globally raising the snapshot sample to 64+ is too expensive in the current recursive architecture, while single-horse n=256 reference calculations are fast enough in the Python feasibility benchmark to justify a future on-demand high-precision service.
- Application bumped to 0.41.2; Platform contract bumped additively to 2.11.1; snapshot schema/algorithm stay 2.1.0 because persisted calculations are unchanged.

## v0.41.1 — Premium Presentation Completeness & Semantic Polish

- Audited the v0.41 scientific DTOs against all four frontend presentations; corrected the distinction between calculation parity and field-level presentation parity.
- Added compact scientific-detail disclosures for reference-cohort membership, sampling SE/95% interval, founder assumption, pedigree completeness, P10–P90 cohort distributions, projected mating position counts, parent-unique ancestors, optimizer score components/weights/warnings and full influence trajectory context.
- Completed semantic visual encoding across Heritage, Q8, EquiData and Prism: kinship/info cyan-blue, DPI/diversity green, rarity/concentration gold-orange, COI/conflict/cycle danger tones, sire cyan, dam magenta, rising green, fading red, and explicit best/top optimizer ranking treatments.
- Added decade trajectory micro-bars for lineage influence and full tail-male/tail-female root presentations.
- Fixed EquiData/Prism audit-draft DTO aliases so UI property access matches the canonical 2.11.0 contract exactly.
- Fixed Prism premium CSS to use its real `--p-*` design tokens instead of undefined `--pu-*` aliases; retained its compact-source guardrail with a modest v0.41.1 ceiling rebase for the added scientific-detail UI.
- Added `validate:premium-presentation`, a hard cross-frontend field/presentation/semantic-color gate.
- Application bumped to 0.41.1; Platform contract remains 2.11.0 and analytics schema/algorithm remain 2.1.0 because this hotfix changes presentation completeness, not backend semantics.

## v0.41.0 — Reference Population Intelligence

- Bumped application to 0.41.0 and Platform contract to 2.11.0; analytics snapshot to 2.1.0 / 2.1.0.
- Added cycle-clean recent same-breed reference cohorts and compact per-horse reference-intelligence persistence.
- Added deterministic sampled exact pedigree mean kinship with sampling uncertainty, cohort percentiles, recorded-ancestor rarity and direct-line rarity.
- Added explainable Diversity Preservation Index (DPI) with confidence/provenance and strict non-genomic/non-merit interpretation.
- Added recorded influence trajectories with bounded descendant reach, recent/prior momentum and decade history.
- Added shared backend `breeding.optimize` candidate-ranking operation with projected pedigree COI/diversity/concentration, optional DPI, confidence adjustment and ancestor-avoidance constraints.
- Added native reference-population/influence/optimizer presentation to Heritage, Q8, EquiData and Prism without frontend-local scoring formulas.
- Added deterministic 40-full-sibling mean-kinship fixture (expected 25%) and optimizer missing-DPI weight-renormalization fixture.
- Strengthened premium, Stage-2 and Prism validators for the v0.41 capability floor.

## v0.40.0 — Premium Intelligence Foundation

- Bumped application to 0.40.0 and Platform contract to 2.10.0.
- Added analytics snapshot schema/algorithm 2.0.0 with explicit analytical eligibility/exclusion/confidence.
- Preserved raw birth-year distribution while excluding 5,209 exact `19010101` archival/default rows from premium demographic trends.
- Added sire/dam concentration (Top-N, HHI, Gini, entropy/effective counts), decade history and recent-cohort concentration.
- Added owner/breeder/importer/passport-receiver registry-link concentration.
- Added six parent/offspring generation-interval pathways and decade history.
- Added recent direct tail-male/tail-female line-survival intelligence.
- Added equivalent complete generations to registry pedigree analytics.
- Added per-horse ancestor path contribution, ancestor diversity/loss, weighted repetition burden, cross-branch repetition and concentration.
- Expanded prospective mating analysis with projected pedigree completeness/diversity/repetition/concentration and projected ancestor contributions.
- Added native premium presentation to Heritage, Q8, EquiData and Prism while preserving independent design systems.
- Added `validate:premium` cross-layer parity/trust gate and premium regression tests.

## v0.39.6 — visible parity correction

### Stage 2 — adaptive/full-parity completion

- Added the shared headless `adaptiveComposition` kernel: viewport width, usable height, aspect, interaction mode, density, navigation and composition are now explicit layout signals for Q8, EquiData and Prism.
- Added short-height and ultrawide composition behavior so the newer engines reorganize instead of merely stacking width-responsive cards.
- Completed server-side People traversal/search in all three newer frontends; no first-page-only directory is treated as complete.
- Removed audited arbitrary display caps from insights, relationship paths/common ancestors, analytics rankings and native governance queues; compact scrolling/disclosure replaces silent data loss.
- Completed all eight structured horse-insight families and the registry analytics families previously under-presented in Q8/EquiData/Prism.
- Expanded EquiData relationship analysis to expose returned common-ancestor and path-atlas detail rather than only summary KPIs.
- Corrected Core, EquiData and Prism pedigree Fit Width / Fit Height / Fit All to use real available viewport geometry, without an artificial minimum zoom overriding the requested fit.
- Reworked Core/EquiData/Prism radial pedigree sizing around the available short axis and added generation-level shade classes on top of branch/sex color semantics.
- Corrected Prism fixed-rail/content reservation and panoramic workspace sizing; compact navigation in all three newer engines preserves access to full live capability navigation.
- Added `validate:stage2`, a hard gate for all 38 live PlatformClient operations, nine required analytics families/fields, all eight insight families, paged People access, native governance, adaptive layout semantics and pedigree fit/radial behavior.

### Frontend parity hardening — native governance

- Promoted authentication, audit, admin/review and curation from host delegation to first-class native surfaces in Q8/Aspnamā, EquiData Elite and Prism Ultra.
- Added permission-scoped claim/change review, privileged quality/audit views, canonical horse create/edit/archive and maintenance reindex to each independent frontend.
- Strengthened visible/presentation/Prism validators so redirects or manifest-only declarations cannot satisfy privileged capability parity.
- Reconstructed and verified the canonical SQLite dataset from Drive, then rebuilt the disposable analytics snapshot for a runtime-ready local database.


- Corrected the definition of frontend parity: manifest/API reachability is no longer enough.
- Added a shared **headless** pedigree layout/geometry helper to Frontend Kit.
- Added real graphical ancestor/descendant pedigree viewers to EquiData and Prism.
- Added radial/circular ancestor views and compact ledger alternatives to EquiData and Prism.
- Preserved each frontend's independent rendering/design engine.
- Added `validate:visible-surfaces`, which checks concrete first-class UI evidence across live capability families.
- Strengthened EquiData/Prism/presentation validators for graphical pedigree requirements.
- Cleaned active documentation and moved historical release/legacy material to `docs/history/`.

## v0.39.5 — Prism audit/hardening

- Fixed responsive Registry channel drift, People pagination, light artwork selection, reduced-motion/View Transition handling and workflow states.
- Removed fake notification data.
- Exposed previously truncated registry analytics fields/rankings.

## v0.39.4 — Prism concept-match pass

- Expanded Prism HUD composition, holographic stage, semantic Registry channels and richer instrumentation.

## v0.39.0–v0.39.3 — Prism Ultra

- Added fourth isolated frontend.
- Added global customization kernel, progressive Registry disclosure, list/card modes, atmospheric effects and lightweight generated artwork.

## v0.38.2–v0.38.4 — platform/presentation expansion

- Expanded canonical public horse DTOs and all four people roles.
- Added stable audit/admin/curation SDK coverage.
- Added CSV/JSON Registry exports.
- Added richer analytics and structured filters.
- Strengthened multi-frontend presentation/design-system validation.

## v0.38.0–v0.38.1 — multi-frontend baseline

- Heritage + Q8 browser-tested baseline.
- Added EquiData donor frontend integration and pedigree-based breeding analysis.
- Established additive frontend integration policy and design-system guards.

Detailed historical handoffs and manifests are preserved under `docs/history/releases/`.
## v0.42.16 Hotfix 12 — Organic glass life, zero sweep light
- Removed the fake left-to-right travelling highlight from active Core/Heritage tabs.
- Restored lively glass motion with whole-element bounded color/depth breathing only.
- Added asynchronous motion phases for major panels, cards, and pedigree surfaces so the UI does not pulse in lock-step.
- Added subtle cinematic drift to the real scene artwork only; no decorative overlay travels across UI surfaces.
- Preserved Hotfix 11 neutral base + semantic-only color coding and donor GAS/compositor retirement.

### v0.42.16 Hotfix 14 — Lightweight ambient field
- Removed Hotfix 12/13 per-surface glass breathing, border/halo animation and panel float because animating many UI nodes was too expensive and did not match the older desired motion language.
- Recovered the earlier Heritage living/organic-field visual character as one lightweight page-level ambient layer, closer to YouTube Ambient Mode.
- The ambient layer uses broad radial scheme fields and animates only transform/opacity; no blur, filter, background-position animation, or per-card painter is used.
- Scene artwork is static again. Glass surfaces remain still and reveal the slowly moving ambient atmosphere beneath them.
- Professional bounded Color Schemes and independent semantic Color-coded blocks remain intact.

## v0.42.16 Hotfix 15 — true ambient-only motion
- Corrected a CSS specificity bug that allowed Hotfix 12/13 per-surface animations to survive Hotfix 14.
- Disabled continuous card/panel/pedigree/tab/tint-breathe animation at matching terminal specificity.
- Preserved functional pedigree connector dash flow.
- Preserved exactly one continuous decorative animation: the shared YouTube-like ambient field behind the UI.

## v0.42.16 Hotfix 16 — CSS architecture consolidation

- Replaced the stacked Hotfix 9–15 `heritage.final.css` cascade with one consolidated terminal visual contract.
- Fixed a real cascade defect where higher-specificity historical `background:` shorthands could reactivate retired gradient/image painters despite later `background-image:none!important`.
- Raised background, backdrop-filter and pseudo-painter authority to state-complete specificity.
- Retired all terminal per-surface decorative animations; only one page-level ambient field remains.
- Preserved bounded color schemes, independent semantic color coding, scene artwork and pedigree dash motion.
- Added `validate:css` and fixed the Core UI validator so late visual checks can actually fail validation.
- 32 mode/motion/glass/palette cascade combinations pass static cascade assertions.

## v0.42.16 Hotfix 18 — ambient motion cascade correction
- Deep CSS audit found the shared ambient keyframe was visually frozen because terminal `transform` / `opacity` were `!important` while the keyframe tried to animate those same properties.
- Ambient motion now uses registered animated custom channels consumed by the terminal important transform/opacity declarations.
- Strengthened the single shared feathered ambient field so movement remains visible through real frosted glass without reintroducing per-surface GAS painters.
- Added a regression validator for the `!important`-vs-keyframe freeze trap.

## v0.42.16 Hotfix 19 — bounded local ambient glass restored
- Serious four-stylesheet cascade audit confirmed the older lively Heritage look was produced by both a page ambient field and bounded local organic fields inside major glass hosts; consolidation had removed the local half of that system.
- Restored local ambient motion on major/workspace glass owners and secondary glass chrome while keeping dense cards, pedigree nodes/geometry, rows and micro-controls free of continuous decorative animation.
- Local fields use only soft radial clouds; no travelling shine, linear sweep, GAS blur/filter animation, or giant off-element canvas is reintroduced.
- Fixed the local motion cascade before packaging: registered coordinate channels drive terminal `background-position!important`, so keyframes cannot be frozen by important declarations.
- Added stronger CSS architecture regression checks and a selector/specificity audit report for representative Profile, Intelligence, Record, Hero and Appearance surfaces.

- Hotfix 23 ambient chroma now follows the fully processed Color Scheme (character/brightness/saturation/contrast) while semantic colors stay independent.

## v0.42.16 Hotfix 37 — Composite blend + pedigree lineage parity
- Fixed Ambient/Specular blend controls by moving `mix-blend-mode` ownership from individual light bodies to their complete post-material composite layers, so Screen / Soft Light / Overlay / Color Dodge blend against the rendered material surface.
- Preserved independent Ambient and Shine compositing; neither receives material/background/blur authority.
- Restored Lineage pedigree tint parity by binding the unified sire/dam/offspring card material rules to Visual Architecture v2 instead of the retired `data-tint-motion` channel.
- Extended the CSS architecture validator to lock composite-level blending and v2 Lineage tint ownership.

## R31.13 — Particle Splash natural hover/chimes merge — 2026-09-16

- Merged the supplied replacement-only `ParticleHorseSplash.tsx` over the exact R31.12 authority.
- Adopted the newer approved particle default, horse scale/X-offset controls, wink speed randomness and size bias, fine optical bloom, motion blur controls, and revised collision-driven hover chime behavior.
- Preserved R31.12 AI, localization, environment-readiness, and frontend work; the supplied overlay contained exactly one source file.
- Relevant source/frontend/mobile/localization validators pass. The known Heritage analytics typography-token warning remains inherited from R31.12.
