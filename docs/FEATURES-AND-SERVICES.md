# Horse Registry NextGen — Features, Capabilities, Data & Info Shown to Users

> The complete map of what this platform is, what it does, and what data each kind of user sees.
> App version **0.87.0** · Platform contract **2.30.0** · Round **R145** (2026-10-28) · migrations through **0107**.
> Live worker: `https://equine-registry-live.rogerfires10.workers.dev` (R144/R145 lineage; iraho.ir pending DNS switch).
> Written for the owner at R145. This replaces the R110 edition; the old text stays in git history.

---

## A. What this platform is (the short version)

1. **One canonical horse registry** — a single authoritative, evidence-gated, auditable record of horse identity, lineage, ownership, health (genetic test results), performance and racing history. Arabian-first, but every breed is registrable. The canonical corpus currently holds **95,639 horses** (91,498 active / 4,141 inactive, measured R143-E01).
2. **Verifiable trust** — every claim (ownership, parentage, documents, attestations, genetic results) is evidence-based, versioned, and audit-logged. Nothing is trusted just because someone typed it. Reviewers, not submitters, decide what becomes canonical.
3. **Bilingual by design** — full English + فارسی (Farsi) with true RTL, for the Iranian and international horse community. Persian (۰-۹) and Arabic-Indic (٠-٩) digits are normalized automatically in every numeric field.
4. **One platform, many experiences** — five independent frontend "skins" (+ one offline standalone) on one shared backend, one contract, one permission model.
5. **Honest software** — the platform never fabricates success, never invents data, never hides a conflict. Refusals, misses and conflicts are surfaced truthfully.
6. **Cost-safe AI** — AI research/editing help is hard-governed: quota reservations first, per-credential cooldowns, honest refusal (`quota_refused`) with zero network spend.
7. **Deploy anywhere** — the same code runs on Cloudflare Workers (production), local Windows launchers, SQLite demo mode, and five database backends.

## B. Current state snapshot (R145, honest)

- **Live**: app 0.87.0, contract 2.30.0, 107 migrations applied to Supabase (canonical) + Cloudflare D1. Worker verified live.
- **Corpus measured (R143-E01)**: 95,639 horses. Identifier coverage: register number 74.85%, microchip 69.68%, passport 38.82%. Racing crosswalk: 121,799 of 122,063 racing results linked to registry horses. Pedigree completeness: gen 1 = 72.5% → gen 7 = 27.9%. Zero ancestry cycles.
- **Known data debt (tracked, seeded into the quality queue)**: 106 sire-rows recorded female / 161 dam-rows recorded male; 4,628 parent-birth-year conflicts queued for triage; analytics precompute stale at 93,896 (refresh pending).
- **Surface size**: 304 documented API routes · 142 migrated data structures · 35 platform feature keys · 5 frontends.
- **Gates**: vitest 1,959 passing / 0 failing · python 268/268 · 5–6 typecheck configs · machine-checked route/data/merge/language inventories · production build.

## C. Who it serves (roles and what each gets)

- **Anonymous visitors** — browse/search the public registry, pedigrees, competitions + racing, marketplace, newsroom, people & organization directories, public evidence summaries, quality summary, public analytics. No account needed.
- **Registered users (owners & breeders)** — claim horses, submit registrations and change requests (draftable, resumable), manage dossiers, list on the marketplace, manage inquiries/blocks/watchlist, use workspaces, request services, use the AI research assistant, control privacy (redaction requests, media publication, notification preferences).
- **Service providers** — offer services, receive platform-mediated leads with consented contact only, manage an inbox, acknowledge with CAS-safe receipts.
- **Organization staff** (stud farms, registries, clubs) — membership policy, invites, staff roles, inbox, credentials, official records, profile workbench with optimistic concurrency.
- **Issuers / authorities** — vetted organizations issuing evidence-gated attestations inside approved, version-bounded scopes; revoke/supersede lifecycle.
- **Professionals (vets, labs, farriers, physios, dentists, nutritionists, federation officials)** — horse-scoped grants (six distinct permissions) unlocking private health RESULTS on granted horses only.
- **Editors / reviewers / admins** — claims review, change-request review, duplicate merge workbench, data-quality queue, imports, media verification/quarantine, genetic interpretation + disclosure decisions, competitions management, moderation, billing, trust queues, AI settings, audit.

## D. The five frontends (+1 offline)

All five share one backend, one contract (2.30.0), one permission model. Each is an independent visual engine with its own manifest and feature negotiation:

1. **Heritage Registry (Core)** — the canonical glass/registry experience and the most complete surface: Registry Desk, Stats, Directory, Competitions (+ Racing tab), Marketplace, Newsroom, Editorial Studio, Workspaces, Service Requests, Studbook Preview, Horse Submission (resumable 4-step wizard), Profile & Organization workbenches, Admin panels (quality queue, duplicates, imports, AI settings…), Appearance Studio, phone Docked navigation.
2. **Federation Classic (FEI)** — institutional, dense registry tables, pedigree intelligence, workflows, analytics, administration and curation surfaces.
3. **EquiData Elite** — intelligence console: analytics-dense views, favorites, compare, rankings, AI assistant, governance desk with the quality queue, evidence summary panels, directory & service requests.
4. **Retro Astra · Reference Desk** — the exact RetroAstra donor app transplanted onto the canonical platform through a thin runtime adapter (read desks, breeding desk, insights, governance, collections, assistant).
5. **Classic Registry** — compact bilingual registry with full current contract coverage; also shipped offline as `standalone-frontends/classic-v1.4`.

## E. Features & capabilities (the full tree, updated to R145)

### E1. Registry & identity
- **Horse profiles** — stable lifetime IDs, bilingual names (Latin + native), ~60 catalogued fields per horse (see §F1), aliases, person links, profile photo with visible credit.
- **Resumable registration workflow** (R143) — 4-step wizard: Identity → Parents → People & evidence → Review. Per-step bilingual validation, save-as-draft at every step, review grid before submit, step position resumed across navigation, unsaved work survives lookup navigation (sessionStorage). After submit: clean reset + "Register another horse" (horse B can never inherit horse A's draft or idempotency key).
- **In-place parent lookup** (R143) — search the registry by name inside the form (debounced, 8 results, stale responses aborted), one-click select, manual number fallback. Unresolved parent claims stay explicit source assertions — nothing canonical is auto-created.
- **Duplicate check before registration** — public `/api/horses/duplicate-check`.
- **Duplicate workbench** (R141) — admin miner for candidate duplicate groups (exact register no, exact microchip, normalized name + birth-year proximity, same parents), kept/merge pickers, read-only merge preview with blockers/warnings, audited-reason merge commit (versioned receipts, idempotent operation keys), recent-merges list with **guarded unmerge**. Name-only bulk auto-merge deliberately unavailable — duplicates resolve only through the versioned merge flow.
- **Owner claims** — authenticated, one pending claim per target, reviewable (`claim.review`).
- **Change requests** — bounded 24-item ceiling, versioned, draft/submit/withdraw, reviewer decisions.
- **Lifecycle & ownership** — ownership periods (overlap/share invariants server-enforced), lifecycle events (birth→death, castration), typed dates with precision + calendar, row-version optimistic concurrency everywhere.
- **Import staging** (admin) — sources with provenance, staged batches, per-row review, preview + review-report, apply with content/identity digest separation, birth-year plausibility floor (1700..now+1), NFKC identifier normalization, fill-once breed/sex, `data_origin` token per horse; non-redistributable sources ingest but never auto-publish (rows start inactive).
- **Bounded privileged export** — 500 rows/request, semantic `registry.export` permission; export tooling redacts documented token formats by policy.
- **Studbook preview & registration statistics** — public pages.

### E2. Search & discovery
- Full-text + structured search with facets: breed, sex, color, place, main strain, imported-from, lifecycle status, year, plus R145 **evidence facets**: `hasPhoto` (public, quarantine-clean), `hasVerifiedDoc` (platform-verified documents only — a verified photo can never satisfy it), `parentageKnown`.
- Browse URL query-state round-tripping (shareable/filterable views), sort options (id/name/year/breed/sex/place/importance × asc/desc).
- `/api/search/meta` describes the searchable structure publicly.
- **Exact-identifier lookup** (R145, editors+) — authorized exact chip / passport / life_number / UEL / register-number lookup for staff workflows ("which horse owns this chip?"); minimal projection (id/name/register/birth-year/active only), LIMIT 10, and a miss is indistinguishable from a concealed record.
- Fuzzy matching, normalization, reindex tooling (`maintenance/reindex`).

### E3. Pedigree & breeding intelligence
- Ancestor trees (up to **7 generations** selectable, R140) and descendant trees.
- Pedigree metrics, paths, and coefficients — inbreeding/relationship (COI/R) engine.
- Relationship calculator between any two horses (`/api/relationship`, `/coefficients`).
- Horse insights (experimental, data-driven observations per horse).
- **Breeding optimizer + pairing analysis** (experimental) — algorithm 1.3.0 with a **per-parent ancestry evidence floor**: under 20% projected completeness the candidate is excluded with `insufficient_ancestry`, naming the weaker side and both coverages. One documented parent can no longer hide the other parent's empty side.
- **Arabian pairing evidence** — health-panel-aware pairing advice, disclosure-gated at the SQL boundary since R142: undisclosed disease results contribute no evidence, no probabilities, no identifiers.
- Pedigree visualization (Heritage): Map / Lineage / Radial views with exclusivity rules, sire = blue / dam = pink semantics.

### E4. Health, genetics & privacy of results
- Assay catalog for the four core Arabian genetic disorders: **CA, LFS, SCID, OAAM**; carrier-status-aware pairing evidence.
- **Verified genetic results are private by default** (R140, `public_disclosed` 0101) — across profile, marketplace and dossier surfaces. Unverified rows never publish, disclosure alone never leaks raw data.
- **Versioned publication decisions** (R144, 0106 `publication_decisions`) — publish/withdraw is an append-only decision trail with per-record monotonic versions, basis (owner_consent / staff_publication / official_basis), purpose, evidence reference, actor and reason. Stale `expected_version` → 409 (a lagging client can never overwrite a newer withdrawal). Repeats of the current state are clean no-ops. `GET /api/admin/genetic-tests/:id/disclosure` returns the explainable history (who/which basis/which version) + effective state; legacy rows keep legacy-boolean behavior.
- **Professional grants** (R144, 0105 `professional_access_grants`) — the ONLY non-staff path to private health data. Six distinct permissions (`private_health_read`, `clinical_write`, `sample_submit`, `evidence_review`, `official_attestation`, `private_file_export`), professional kinds (veterinarian, laboratory, farrier, physiotherapist, dentist, nutritionist, federation_official), grantee user OR institution, authority reference (license/accreditation) + assignment reference, validity windows, immediate audited revocation (effective on the very next request, nothing cached). A granted professional reads health RESULTS on the granted horse only — never lab accession, notes, or editorial interpretation, and never on ungranted horses. A generic horse-edit capability NEVER implies private health access.
- Staff: genetic interpretation write, pairing review, breeding correction editor (with audit).

### E5. Competitions & racing
- Public competitions directory + detail; admin competition management with **versioned results** (per-result and per-event versions).
- **Racing tab** (R140) — read-only racing dataset (asbdavani) served with provenance blocks; identity crosswalk only (121,799/122,063 results linked); merge policy pinned in the horse-reference inventory.
- Competition results pagination is generation-guarded (a delayed page for event A is dropped once event B is selected; appended rows deduplicated).
- Performance records capability (stable v1.0.0); rankings and side-by-side horse comparison across skins.

### E6. Marketplace & commerce
- Market listings with blocks and personal watchlist; listing status/renew; seller **dossier attach** and **confirm-availability** mandate (create_listing entitlement current at call time).
- Inquiries with consented contact only, replies, close; buyer "sent" list.
- **Verified-docs chip counts DOCUMENTS only** (R145 fix) — a platform-verified photo can never generate a "verified documents" badge; quarantine-clean by construction.
- Commerce offers; billing catalog, orders, entitlements, payment callback/verification, refunds + refund-request workflow with admin allocation proposals/approvals; **demo payments only** — real charges stay disabled behind the owner gate.
- Admin: prices, refunds, attempts inquiry, review cases, sponsored listings.

### E7. Workspaces & organizations
- Workspaces — collaborative task areas with invites, membership, task identity, reminders; bounded no-overwrite task import with durable intent keys and per-row receipts.
- Workspace documents — versioned CAS editing, immutable horse association, archive, honest stale-version conflicts.
- Organizations — onboarding, membership policy, invites, staff roles (owner-managed), official records, credentials, staff inbox; profile workbench with `expected_version` optimistic concurrency.
- Dossiers — create/link/revoke; public viewing by opaque token (40–60 chars) with optional recipient session; marketplace listings can mandate a dossier.

### E8. Trust, attestations & credentials
- Issuer registry — evidence-gated registration, structured versioned interval-bound scopes, one-live-scope enforcement, suspend/resume/retire, supersession.
- Attestations with immutable server-derived snapshots (`source_version` digests); verify endpoint; revoke/supersede lifecycle; full snapshot bytes gated to platform managers + issuer owner.
- **Provenance-driven labels** (R145 C06) — the "fictional issuer" wording appears ONLY when the platform itself reports the demo dataset; on real data the panel says no badge implies approval beyond the named issuer's recorded scope.
- **Evidence summary** (R145 C04) — public per-horse lifecycle summary at `/api/horses/:id/evidence-summary`: public media counted as uploaded vs platform-reviewed ONLY (documents, veterinary-role, non-consented and quarantined items are excluded — private presence never leaks), honest attestation states (active/revoked/superseded), only PUBLICLY DECIDED genetics counted, and the vocabulary teaches **reviewed ≠ attested**.
- Directory claims & credentials — workflows, expiry scans, renewals review, public badge endpoint, person/organization response stats.
- Extract verification (`/api/extract/verify`) + extract revoke.

### E9. Data quality & integrity (new workstream E)
- **Data-quality queue** (R145 E04, migration 0107) — `data_quality_issues` with workflow columns (open/assigned/resolved, assignee, source, rule_version) + append-only `data_quality_events` history (detected/assigned/resolved/reopened/note with actor + note + time). Full reviewer loop: filtered list (status/severity/code, ≤200 rows) with **reconciled counts computed from the same table** (dashboard numbers can never drift), detail + full lifecycle history, assign (active-assignee check), resolve (resolution note REQUIRED ≥3 chars), reopen (history preserved, resolution never destroyed), note, **low-risk-only bulk resolve** (explicit code allowlist + severity='info' enforced server-side; one high-risk row refuses the whole batch), and an **idempotent corpus scan** seeding the measured conflicts (sire-female / dam-male through the unified sex-role classifier, register_no duplicate groups, PARENT_BOTH_SIDES, birth date/year contradictions; per-child-link dedupe — re-runs create nothing new).
- Public quality summary (`/api/quality/summary`).
- Mutation journal + reconcile-mutations maintenance; privileged audit trail over every state change; idempotency keys with `payload_digest` content binding (R140) — same key + different content = 409 `idempotency_conflict`; client rotates keys after acknowledged creates.
- Merge policy inventory (49 horse references classified) machine-checked.

### E10. Privacy & compliance
- Redaction requests (user-initiated + admin decide/fulfill queue); retention policies with race-safe sweeps; privacy holds (single, audited; double-release refused 409).
- Privacy-scoped projections; public-snapshot allowlist routing; service-request privacy policy; consent withdrawal unpublishes instantly.
- Media publication controls — original uploader + current owner/staff manage publication state; access grants can be revoked.
- Export tooling redacts documented token formats (R144 standing policy).

### E11. Moderation & service desk
- Moderation reports, cases (reporter/staff views), appeals (seller of record), standing, admin queue.
- Service requests — inbox/mine/export, status transitions, neutral blocks (never disclosed to the blocked party), block complaints + resolution, abuse reporting.
- Durable uncertain-write intent recovery — a lost response freezes the form honestly; same-key retry replays the receipt; nothing fabricates success.

### E12. Content & newsroom
- Bilingual newsroom with sourced posts, cover-image provenance, comments (public read, public post + admin moderation).
- Editorial Studio with AI editorial agent and consent boundaries; admin generation, preview, publish/retract, revisions.

### E13. AI services (quota- and cost-governed)
- **AI Research Assistant** (capability `ai_assistant` 1.0.0, experimental): provider-neutral runtime — **Gemini Flash-Lite** default, **DeepSeek** paid alternate/fallback, offline provider for demo/local. Four bounded research tools over canonical registry/pedigree/analytics/content services. Durable conversations, request/usage ledger, per-conversation turn lease, lightweight vision references, no fixed turn-count memory cutoff.
- Admission control everywhere: every generation path reserves through the ledger FIRST; refusal = zero network calls, honest `quota_refused`. Per-credential cooldowns, shared edit/chat accounting, per-project Gemini quotas.
- Admin AI settings: encrypted keyring, governed key connectivity tests, model catalog, diagnostics probe (token-gated).

### E14. Notifications, media, personalization
- Notifications: email + SMS channel adapters, durable outbox worker with retry, user preferences, demo provider + admin demo-delivery monitoring/callbacks.
- Media: proxy, policy enforcement, per-file access grants, admin quarantine + verify, public photo credits (heritage + equidata).
- **Appearance Studio** (Heritage): Dark/Light tone polarities with mirroring, Auto·Scene palette derived from the active wallpaper, 48 built-in AVIF wallpapers (24 dark / 24 light, ≤100 KB each), custom upload/focus, theme preset schema v22, Material Depth semantics (Major→Panel→Card→Control), recursive frost + ambient lighting, particle splash, single-open accordion navigation.

## F. The data users actually see

### F1. Horse record (~60 public fields)
Identity & names: id, name (Latin + native), aliases (typed, sourced), name-native provenance. Lineage: sire/dam names (+ native), pedigree endpoints. People: owner, breeder, importer, passport receiver (+ native), person links with roles and current flags. Registry: register no, microchip, passport no + dates, life number, UELN, horse serial no, company code, book version, originality, strain (main/sub). Body: breed type, sex code, color code, **markings, height cm** (R140), birth date/place (city + province; private address never appears), keeping city/province. Dates: birth/death/castration with **value + precision + calendar** (Gregorian / Solar-Hijri). Flags: is_active, is_dead, is_stallion, is_sport, is_imported, is_register_sport, has_sport_card, allow_stallion. Import: imported date/from (code + desc), import register no, export certificate. DNA status + description. Death date. Profile image + credit. Search score + matched-by.

### F2. What is deliberately NOT public
Private addresses; non-disclosed genetic results (private by default, publication is a versioned decision); unverified genetic rows; staff-private evidence fields (lab accession, notes, editorial interpretation) — even professionals with grants never see these; quarantined and non-consented media (excluded from every public count); concealed records (a lookup miss is indistinguishable from a concealment).

### F3. Per-horse panels a user can open
Profile (full record + aliases + people) · Pedigree (7-gen tree + metrics + paths + coefficients) · Descendants (+ descendant metrics) · Relationship checker · Insights (experimental) · Lifecycle events · Ownership history · Competitions results · Media (photos with credits) · Genetics/pairing evidence (disclosure-gated) · **Evidence summary** (R145: uploaded vs reviewed counts, attestation states, publicly decided genetics) · Racing identity crosswalk · Dossier links (authorized) .

### F4. Directory & people data
Persons and organizations (public profiles), person profile editing (verified link or staff), credentials with expiry + renewals + public badges, response stats, organization staff/inbox/officials (staff-only).

### F5. System-level info pages
Registry stats dashboards (snapshot-backed), studbook preview, registry analytics (experimental), quality summary, search meta, platform meta (contract + application version + capability catalog + demo-admin availability), AI status/models (public), health endpoint.

## G. Platform governance

- **Versioned capability catalog** — 35 platform feature keys, each with version, stability (core/stable/experimental/reserved) and access class (public/authenticated/privileged). Frontends must account for every key; visible surfaces are validator-checked. Reserved (contracted, not live): verification, inspections, breed_standards, genomics.
- **Platform contract 2.30.0** — the compatibility boundary; frontends declare min/max versions and fail honestly instead of silently misbehaving.
- **Canonical permissions** — authorization is never inferred from role names; every privileged route names its permission (e.g. `horse.edit`, `content.manage`, `claim.review`, `change.review`, `maintenance.run`, `registry.export`, `quality.read`).
- **Machine-checked inventories** — route budget inventory (304), canonical/derived data inventory (142), horse-reference merge inventory (49), language validator, platform-contract audit — all wired into `npm run check`.

## H. Security (always on)

- Password hashing, OTP flows, email verification, account recovery (anti-enumeration), per-session revocation, change-password.
- CSRF on every privileged write; security headers (CSP, DENY framing, no-referrer, HSTS, COOP/CORP); noindex on restricted surfaces.
- Rate limiting by class: public 300/min/IP, auth 5/min, writes 30/min, expensive (breeding/pedigree) class, 429s carry `Retry-After: 60`.
- Encrypted AI keyring; secrets never in source; credential-pattern export guards; principal isolation (account switches can never leak the previous principal's data).
- Threat model + risk register docs; independent audit rounds R88→R145 lineage.

## I. Infrastructure & operations

- **Runtime**: Cloudflare Workers (`equine-registry-live.rogerfires10.workers.dev`; iraho.ir DNS pending), prebuilt minified `dist` deploy, wrangler prod/staging configs.
- **Databases (5 adapters)**: SQLite (local/demo), PostgreSQL (advisory locks), Supabase (canonical production, PG 17), Cloudflare D1 (write-quota-aware), Turso (failover). Lexical SQL translation + expected-schema probes.
- **CI/CD**: GitHub Actions — build → test → minified deploy on push to main. Code ships minified to protect IP.
- **Local ops**: Windows launchers (`.bat`/`.ps1`), SQLite-from-XLSX refresh, Turso sync tool, demo mode with synthetic fixtures, one-click demo admin (disabled in production unless explicitly enabled).
- **Scale of testing**: vitest 1,959 tests/0 failures, python 268/268, 5–6 typecheck configs, presentation-parity validators for curated frontends, real-database integration journeys (grants, publication decisions, quality queue, merges).

## J. Honest status & what's next

- **Live**: 0.87.0 / 2.30.0 deployed and verified (worker version recorded in the R145 deploy round; R144 live verification: health 0.86.0, anon 401s on all new privileged reads).
- **Not yet real**: payments (demo only), Turso leg untested in production, iraho.ir DNS switch pending at the registrar.
- **Next (R146, Master-AI plan order)**: D04 rules engine (registration numbering + studbook admission); F01 minimum private clinical record ONLY after federation/vet agreement; run the quality-queue corpus scan on production and triage the seeded conflicts; queued: kasilor scrape, asbdavani re-scrape + RATINGS, admin user/vocabulary CRUD, PWA, honest color predictor, analytics precompute refresh (93,896 → current), pilot triage of the 4,628 parent-year conflicts through the merge flow.
- **Standing rules**: health-module expansion gated on federation/vet agreement; close tasks on acceptance evidence, not merged code; heritage stays the one primary frontend until core acceptance passes.
