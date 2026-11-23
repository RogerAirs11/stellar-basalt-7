# R88 code, product, science and commercial audit

Audit date: 2026-10-03. Input: the R87 pure-source export at upstream commit `2bcade2`. Output: R88 source revision, application 0.45.0, platform contract 2.16.0. No live customer database, deployment credentials, original media library, or financial accounts were inspected.

## 1. Verdict

This is a substantial registry-first product, not an empty mockup. It already has meaningful identity, pedigree, search, authorization, moderation and record-history infrastructure. Keep that investment. The five independent presentation implementations are a legitimate architectural choice and have been preserved.

It is not yet a complete horse-industry super-app, a clinically validated breeding decision system, or a proven profitable business. A feature name, route, reserve capability flag, polished screen, or synthetic response is not an implemented, operated service. Do not attach a misleading overall completion percentage to this mixed scope.

R88 is suitable for an explicitly labeled capability demonstration. It is not a production launch certification. The new static workbench can run independently of omitted assets; the original five frontends still need the full repository, dependency installation, hosted regression tests and restored licensed assets.

The strongest opportunity is not another public pedigree directory. It is a trusted horse record connected to recurring paid farm work and consented professional relationships. This remains a product hypothesis that requires paid pilots.

## 2. What was actually examined

The source export contains 509 source/configuration files, 36 existing migrations, a Worker API, React application, standalone Classic source, multiple database adapters, a typed frontend integration kit, Python regression suites and source-validation tools. Its own PACKAGE-INFO reports 434 Vitest cases; that count is an upstream claim, not a test run performed here.

The audit traced profile/public projection, horse grants and organization memberships, marketplace reads and mutations, genetics interpretation, reproduction dates, registry calendar conversion, pedigree coefficients, browser contract adapters, five frontend entrypoints, native Classic build and framing, and operational build/validation assumptions. It also inspected schema migrations and public-versus-private record boundaries. This is a risk-prioritized audit, not a claim that every possible path or vulnerability was exhaustively checked.

Original large-file hotspots include roughly 500 KB of Heritage system CSS, 289 KB of donor-scoped CSS, 231 KB of general app CSS, 218 KB of main.tsx, and 150-166 KB frontend/page/splash files. These are source sizes, not measured compressed browser payloads. They identify maintainability hotspots; they do not prove runtime slowness by themselves.

## 3. Critical distinctions the design must preserve

- A canonical horse identity is not a listing, profile claim, database row number exposed as a credential, or a passport issued by this company.
- A historical person named as owner or breeder is not automatically a login account, present owner, legal title holder, or consented directory member.
- An organization membership alone does not confer permission to change every horse. Resource grants, membership validity and action scope must all pass.
- Owner-supplied, platform-reviewed and issuer-confirmed evidence are separate levels. Payment cannot upgrade truth.
- Pedigree COI, genomic inbreeding, parentage verification, disease genotype and clinical health are different concepts.
- A recorded inquiry is not a delivered message, qualified lead, reservation, sale or cash collection.
- Registry record count is not a count of living Iranian horses, unique customers, or paying breeders.

## 4. High-risk issues found and repaired

| ID | R87 finding / concrete consequence | R88 implementation | Verification and residual risk |
|---|---|---|---|
| FIX-01 | Marketplace detail selected genetics directly, bypassing the profile privacy projection. Unpublished tests and private notes/accessions could escape. | `src/privacy/projections.ts` now owns shared `projectGeneticTests`; `src/api/modules/marketplace.ts` uses it. Owner status does not unlock unpublished laboratory records. | Actual projection runtime tests pass. Full HTTP integration still required. |
| FIX-02 | Grant and membership time handling mixed SQL and ISO string forms; malformed/future/expired records could be evaluated inconsistently. | `src/security/timestamps.ts` validates instants; `grantValidity` fails closed; production grant SQL normalizes validity, checks active organization and current membership. | Ten SQL replay tests apply all 36 migrations. Supabase/Postgres and live provider parity remain unverified. |
| FIX-03 | Being original listing seller was treated too much like permanent authorization; inbox visibility did not consistently recheck current resource grants. | Listing mutations require present resource action; seller inbox filters with bounded `horseIdsWithAction`; private inquiry-state method added. | Runtime/policy and source-wiring checks pass. Transaction-level revocation races remain a launch blocker. |
| FIX-04 | Listing lifecycle and expiry were insufficiently constrained. Races could create confusing conflicts and inquiries could target unavailable listings. | Explicit listing/inquiry state machines, expiry checks, compare-and-set old status, narrow active-listing uniqueness conflict handling, atomic availability predicate on inquiry INSERT. | Policy tests pass. Full row-version/idempotency/audit transaction work remains. |
| FIX-05 | Inquiry authentication failures could be swallowed as anonymous flow; public write origin protections were insufficient. | Same-origin browser mutation guard; authenticated CSRF enforced; auth/storage failures propagate; self-inquiries rejected. | Request/policy tests pass. This is not bot/spam protection or verified phone delivery. |
| FIX-06 | Global framing headers blocked the intentionally embedded Classic Registry. | `src/security/framePolicy.ts` permits only same-origin framing under `/classic-registry`; other routes remain DENY / frame-ancestors none. | Boundary paths tested. Hosted parent/iframe CSP and postMessage still need browser validation. |
| FIX-07 | PSSM1 and MH were labeled recessive in the assay catalog, risking an incorrect unaffected-carrier interpretation. | Corrected to dominant, versioned assay metadata and source references. Clinical diagnosis explicitly false in interpreted DTO metadata. | Source runtime tests pass; university veterinary references SCI-01/02. No claim of clinical validation. |
| FIX-08 | Retest conflict detection could collapse different genotypes into the same broad affected bucket. | `assayGenotypeIdentity` distinguishes allele count and aliases; N/H and H/H no longer disappear as identical evidence. | HYPP retest regression passes. No automated overwrite of lab records. |
| FIX-09 | Legacy coat-locus symbols included ASLIP, TMEM38 and cream_SLC36A1 ambiguity. | Quarantined legacy labels with review guidance. Corrected new-entry locus choices; valid champagne/SLC36A1 remains valid. | Tests cover exact ambiguous cases. Original report review is required; no blind historical data rewrite. |
| FIX-10 | Gregorian covering year was mixed with Solar Hijri season, and partial birth years could be rendered as a falsely precise converted year. | `src/genetics/breedingDates.ts` validates dates and derives Hijri season; registry date formatter converts interval endpoints, preserving uncertainty. | 2019 becomes a 1397-1398 range; Hijri 1405 spans 2026-2027. Tests updated. Existing inconsistent rows need human review. |
| FIX-11 | Some UI success messages implied delivery that the backend had not confirmed. | Copy now says recorded in platform, not confirmed SMS/email delivery. | Source changes made in affected native modules. Notification outbox remains future work. |
| FIX-12 | Alternate frontend spacing wasted room; visual systems had no small consistent compact token vocabulary. | Four separate density-token sets, generator and scoped compact styles; mobile type sizes, coarse-pointer targets, focus and reduced motion handled. | Independent-frontend/style boundary validators pass. Original skins have not had hosted screenshot QA in this environment. |

The compatibility enum `affected` remains in the API to avoid a blind schema rewrite; the improved UI and new DTO metadata describe a risk-associated genotype, not an animal's clinical diagnosis. A future contract migration should replace ambiguous legacy terminology after client compatibility is established.

## 5. Client requirements: what exists versus what remains

Status vocabulary: **implemented foundation** means meaningful source exists; **partial workflow** means an end-to-end operating product is incomplete; **demo only** means synthetic/static simulation; **reserved** means a contract or future concept, not available functionality.

| Client requirement | R87/R88 state | Remaining acceptance requirement |
|---|---|---|
| Name, identity, breed, sex, birth, coat, owner, breeder, location | Implemented foundation with richer history/identifier models | Sample licensed records, precise public/private policy, merged-duplicate redirect and ownership dispute tests |
| Dedicated horse page, parents, ancestors and offspring | Implemented foundation | Bounded large-family tests, mobile tree/list parity, source and date clarity on every skin |
| Profile photos and documents | Implemented foundation / partial operations | Object storage, quarantine/scanning, EXIF policy, thumbnails, expiring private access, deletion/backup procedure |
| Owner-entered versus authoritative facts | Implemented foundation in claims, submissions, trust and grants | Source-backed issuer confirmation workflow and staff runbook; no generic federation badge |
| Search by names, identifiers, breed, sex, parent, people and other fields | Strong implemented foundation | Cross-script fixtures, temporal-age filtering, index consistency under mutation, performance on restored dataset |
| Competition records | Implemented modules and tables | Licensed input feed/import, identity reconciliation, source revision/supersession, horse/rider link completeness |
| Owner, breeder, public and staff accounts | Implemented authentication/grant foundation | Self-service organization membership workflow, revocation race tests, abuse controls and recovery verification |
| Full management panel | Implemented foundation | Complete moderation queues, operational ownership, concurrent review/revocation audit safety, review-time metrics |
| Duplicate prevention | Identifiers and integrity checks exist | Evidence-based candidate review, merge/split history, no fuzzy-name auto-merge |
| Horse sales | Implemented listings and inquiry collection | Seller workbench completeness, moderation/reporting, idempotency, expiry renewal, notifications, fraud response; NOT a checkout/escrow |
| Reproduction history | Implemented records, dates repaired | Foaling outcomes, permissions, event revisions, embryo/donor/recipient distinctions and breed-rule applicability |
| Pedigree COI and common ancestors | Implemented bounded calculation | Independent scientific review, confidence/coverage policy, versioned input hash, backtesting on curated licensed pedigrees |
| Genetic results | Implemented storage and partial assay interpretation, R88 hardening | Consent, chain of custody, specimen/report version, authorized release, assay catalog review and conflicting report queue |
| Suggested mating / decision support | Pedigree analysis exists, genomic prediction reserved | Explainable constraints and vet/geneticist-reviewed scope; no fertility/performance/safety guarantee |
| Responsive mobile | Independent responsive foundations; compact layers added | Full five-skin EN/FA keyboard/touch/zoom/assistive-tech matrix with restored assets |
| Professional service ecosystem | Connected R88 synthetic demo with 22 categories | Real provider/credential/service-area API, consented contact, request workflow, provider controls and verified demand |
| Monetization and profitability explanation | New working scenario calculator and documented hypotheses | Actual paid pilots, collection/renewal data, provider merchant approval, accounting and support costs |
| Android/iOS | No validated native product required for phase 1 | Keep responsive web first; assess install/offline needs from actual usage, not feature count |

## 6. The new workbench is separate, deliberately

`/demo-workbench/` is a lightweight capability demonstrator, not a sixth replacement design system and not a hidden production mock provider. It connects 28 synthetic horses, 8 people, 22 provider categories, 4 competitions, 16 results, 10 horse listings, 4 supply examples and 196 precomputed pair analyses from the real pedigree engine. It includes search, linked profiles, saved horses, provider discovery, local simulated inquiries and a status inbox.

`/business-model/` is a real interactive calculator, not real billing. It imports generated JavaScript from the same tested pure TypeScript economics module. Both pages have English/Persian text, RTL, source/assumption warnings and noindex metadata. Navigation links were added to all five existing frontends. Simulated data is not written to a canonical database, authenticated account or live supplier.

This is valuable for the first demonstration but does not satisfy production service-directory, payment or messaging requirements. The continuation plan explicitly converts demonstrated workflows into canonical domain APIs instead of teaching each frontend to make up its own data.

## 7. Architecture: keep versus refactor

Keep `PlatformClient`, domain modules, per-resource grants, centralized public projection, registry query compiler, date precision model, bounded pedigree engine, source/import provenance and mutation journal. These are useful boundaries, not clutter to delete.

Do not merge the five frontend component trees, their CSS, theme providers, routing identities or native Classic runtime. Share typed data loaders, command validation, response state, formatting semantics, capability checks and accessibility test scenarios. A shared semantic contract is not a shared visual implementation.

Refactor one hotspot at a time: extract a page/state hook without altering output; pin behavior with tests; then extract visual recipes within that same frontend. Avoid a one-shot global CSS rewrite, find-and-replace across all skins, or a universal component with dozens of theme flags.

R88 compact layers are intentionally transitional. They reduce visible waste but do not eliminate the older winning declarations. After screenshot approval, merge each override back into the correct owning rule and delete the override. Do not pile R89/R90 override layers on top indefinitely.

## 8. Unresolved high-risk items

**Transaction safety.** Grant revocation currently batches a conditional update with an unconditional audit INSERT; a failed/repeated operation can leave an inaccurate audit event. Listing and inquiry status use old-status CAS but not a full client row version. Permission can change between guard and write. Resolve with portable transactional command primitives and per-operation identifiers; do not pretend a string assertion proves concurrent behavior.

**Backend equivalence.** D1 SQLite, local SQLite, Turso and Postgres adapters require execution-level parity tests, including timestamp parsing, uniqueness errors, affected-row metadata, rollback and concurrent writes. SQLite replay cannot certify Postgres translation. Choose the actual launch topology and test it; do not multiply deployment paths just because adapters exist.

**Data operations.** Source ingestion, correction review, licensed result feeds, duplicate adjudication, document review and support require named operators and budgets. They are not an annual hosting fee. The historical dataset omitted from this export must not be replaced by synthetic authority claims.

**Marketplace operation.** Need reporting/blocking, consented contact, anti-spam/rate limits, response history, expiry/renewal, seller mandate enforcement, versioned evidence snapshots and dispute handling. A horse's sale status must never mutate ownership title automatically.

**Payments.** No production orders, invoices, attempts, idempotent verification, entitlement ledger, refunds, reconciliation or revenue reporting were implemented in R88. Never treat the new calculator as billing code.

**Privacy.** Re-audit all contact/document/genetics routes, exports and AI tool responses against the same policy; enforce retention, private attachment access, redaction and audit of privileged access. Historic public records and new self-service contact profiles need different consent models.

**Operational restoration.** Backups must have a restore drill, not just a scheduled export. Asset/database versions must match. Public and privileged read paths need outage behavior that does not silently change the claimed source of truth. Full builds, dependency security review and live routing still remain.

## 9. Testing evidence

See `05-RELEASE-QA.md` and `audit/r88/logs/`. R88 has 59 passing Python tests; 40 boundary checks, 26 science/date checks and 15 economics checks; passing pedigree TypeScript/reference fixtures; 241 production TypeScript/TSX files pass source syntax/name validation; frontend separation and CSS architecture validators pass.

The new pages pass 142 offline Chromium DOM checks with fixtures and URL/storage test doubles. This proves useful rendering/DOM behavior, not HTTP/CSP, real browser reload persistence, actual provider delivery or the original five app skins.

Full dependency-backed build, full TypeScript check, full Vitest and hosted browser E2E were not run successfully here. NPM package retrieval was unavailable; Chromium's managed URL policy blocks navigation. The existing AI validator also reports three prior AI documents omitted from the source export. These limitations are explicit release gates, not replaced by stubbed green checks.

## 10. Product omissions and missed opportunities worth prioritizing

The high-value missing layer is a farm's daily work: private herd collections, recurring due dates, delegated staff access, traceable records and a sale dossier assembled from permitted evidence. Professional discovery becomes monetizable when paired with a consented inquiry inbox and measurable response quality, not merely another list of phone numbers.

Additional promising, gated opportunities are paid migration/onboarding, event-organizer results tools, laboratory report intake under contract, clearly sponsored stud visibility, restricted aggregate benchmarks from licensed data, and equipment merchant campaigns. Review authenticity, emergency-vet dispatch, insurance sales, cross-border transactions and commission-based horse checkout should not be first-release promises.

The next agent should execute the launch blockers and first paid workflow in `02-AGENT-PLAN.md` before expanding the visual surface area again.
