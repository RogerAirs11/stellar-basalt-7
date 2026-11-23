# R147 implementation and remaining work

## 1. Readiness decision

R147 is a substantial implementation candidate for technical integration and a controlled pilot. The registration, evidence, private care and data-governance capabilities are materially stronger than the supplied R146 source. It is not yet an unrestricted production release, an officially accredited registry, or completion of all four phases of the proposal.

Three different questions must remain separate:

| Question | Current answer |
| --- | --- |
| Is the behavior implemented in the supplied source? | Many previously missing capabilities now have migrations, real APIs, SDK methods, UI workflows and regression tests. See the client matrix. |
| Does it behave correctly under the tested conditions? | Actual migrated SQLite, local PostgreSQL, HTTP routes, DOM interactions and a real bilingual browser were exercised. Exact final totals and scope are in `R147_VALIDATION.md`. |
| Is it ready to operate nationally with real people, laboratories and institutions? | Not established. Production configuration, live datasets, permissions, clinical authority, MFA, complete configurable policy coverage and operational acceptance still need work. |

The input was `01-horse-registry-code.zip`, SHA-256 `e7562f56e442f644e38b181cdfa144f6e2dbfef0b0fbe0df2de7aeb089abf79c`. The supplied R146 input identified application 0.88.0, contract 2.31.0 and migrations through 0109. Several input root manifests pointed to older releases and did not match the actual files. Those stale deployment statements are not evidence of current qualification.

## 2. Audit of the smaller agent's work

R142–R146 contained useful real progress: stronger identifier matching, registration drafts, quality/scan surfaces, professional permissions, disclosure decisions, configurable rules and field-level claims. These capabilities were preserved and extended. A pristine full Vitest run of the supplied source passed 1,989 tests, with 10 skipped. A passing suite did not cover all important failure cases.

The follow-up audit found and corrected defects in live authorization, atomicity, private evidence projection, stale caching, rule subjects, calendar comparisons, import publication behavior and UI recovery. In particular:

- The new private care module does not grant access through a generic editor role or broad organization affiliation. Professional grants now require narrowly allowed permissions, exact grantees, valid supporting references and current qualifying membership. The new care paths recheck current session/grant state. Legacy genetic evidence still has a separate, broader `horse.edit` policy; P0-05 below explicitly requires its permission separation before sensitive production use.
- A publication decision, its materialized visibility flag and its audit evidence must commit together. Publication uses an expected version; a stale request cannot overwrite a newer withdrawal. Genetic intake cannot independently mark itself public.
- Selecting or reversing a source claim must use the canonical validation path and commit with its decision. Reversal checks that the selected change is still current and does not overwrite unrelated later edits. Erroneous death selection has a narrow trusted reversal mechanism that public input cannot enable. Migration 0115 prevents duplicate pending field-claim intake while preserving prior review history.
- Restricted imports retain source assertions and conflicts instead of filling existing public canonical facts. Stored visibility governs counters and audit, and guarded SQL rechecks current source permission. Full source-agreement revision serialization remains part of P0-02. A restricted field claim cannot be selected as an alternate publication path.
- A public result must not expose a withheld horse or parent through a different route. The audit covered profiles, search, counts, people, pedigree, breeding, competitions, AI research, attestations, extracts, dossiers and marketplace joins. Historical aggregates are conservatively withheld where their audience cannot be trusted.
- Revocable records bypass server edge copies and the parsed browser cache. Browser GETs for these records also bypass old HTTP cache entries. Cache clearing cannot be undone by an earlier in-flight response. The SDK's parsed newsroom cache respects response policy and lifetime. Worker editorial caching retains its own bounded TTL/stale policy; this statement does not promise immediate universal editorial withdrawal.
- Racing totals distinguish entries, confirmed starts, nonrunners and unknown start state. A nonrunner is not silently counted as a start or win. Generic competition result counts exclude unavailable linked horses.
- Registration drafts no longer keep private form data in unscoped browser storage. Real-browser testing found and fixed first-input loss; native names and normalized passport values now survive actual save and reload.

## 3. Implemented capabilities

### Registration and private documents

Migration 0110 adds birth/previous names, issuer information, passport issue/expiry dates, foreign registration identifiers and explicit lifecycle state. Existing unknown values remain unknown. Persian digits and supported identifier normalization preserve leading zeros. Passport/foreign identifiers are scoped by issuer; conflicting identity registration rolls back rather than creating a partially accepted horse.

The ordinary registration form includes those details, related people, markings/height, typed birth/death dates and calendar/precision controls. Birth/previous names become managed aliases only through accepted canonical changes. Later changes replace those managed aliases without deleting independent source aliases. Private reviewer notes are distinct from public description.

The Heritage/Professional and Equidata administration screens now mount the same complete create/edit form. It includes names and aliases, issuer-scoped identifiers, measurements, lifecycle and five typed-date controls. Updates send only changed fields with the expected row version, so editing height does not rewrite an uncertain historical date or an unchanged legacy identifier. Staff can inspect the complete authorized canonical record. A real browser created and updated a fictional horse, verified persisted aliases/numeric values/calendar metadata, and exercised the form in English/LTR desktop and Persian/RTL mobile layouts in both consoles.

Migration 0111 supplies real request-bound evidence metadata and chunked bytes. Owners can manage only their own draft evidence; reviewers have a separate authorized path. Submission freezes owner mutation. Uploads have per-file/per-request limits, supported signature checks, full-payload idempotency, stored-byte integrity, protected downloads and tombstone semantics. Delete counters remain correct under two concurrent PostgreSQL requests. This is bounded file handling and content validation, not a complete malware-scanning service or video/object-storage pipeline.

### Private care and laboratory evidence

Migrations 0112–0114 add private clinical entries, amendments/voids, reproductive episodes, separate genetic and recipient dams, multiple offspring outcomes, sample identity/custody and immutable laboratory report facts with independent, versioned review decisions. Exact horse-scoped permissions separate writing, reading, reviewing and exporting. An administrator does not automatically receive access to the new private care module.

Commands bind authority, expected versions, operation receipts, private history and minimal general audit in a transaction. Participant locks and version checks prevent preflight assumptions from becoming stale while a command waits. Clinical and reproductive chronology checks compare typed lifecycle intervals; unknown or overlapping partial dates remain uncertain. Explicit source-backed postmortem/stored-material contexts do not bypass physical impossibilities for a live recipient or an inappropriate procedure.

Laboratory review binds the report to the actual stored sanitized evidence bytes, sample, horse, panel/method and independent reviewer. An upload is not an authentic laboratory result by itself. The report creator cannot accept their own report. No module generates a clinical diagnosis or prescribes treatment; authorized professionals can record attributed diagnoses. A `supersedes_report_id` records a correction relationship; it does not automatically withdraw an earlier accepted report. Reviewers explicitly resolve its status, and analysis refuses incompatible concurrent accepted evidence.

The added scientific outputs are intentionally bounded: MC1R/ASIP base-pigment probabilities from compatible reviewed calls, and STR trio allele compatibility. They do not infer a full coat phenotype from photographs, prove breed, calculate a forensic parentage likelihood, certify a laboratory or guarantee breeding performance. Unsupported, missing or contradictory data is reported as such.

### Supplementary metadata

Migration 0116 adds immutable field-definition versions, activation/withdrawal, typed existing-horse values, operation receipts and private history. Supported data types are bounded text, number, boolean and controlled choice. Namespaced `extra_` keys cannot replace canonical identity fields. Field privacy and type are not silently changed after creation. Old values retain the meaning of their recorded definition version.

An administrative workbench creates definitions, versions, activation decisions and existing-horse values. Public facts use an explicit public projection; controlled public choice/boolean filters require the current definition version. Session, administrator status, subject state and definition activation are rechecked at commit. Generic archive/merge operations refuse retained values until reviewed reconciliation exists.

This completes a useful metadata foundation and existing-horse curation workflow. It does not yet render all dynamic fields in owner registration, import mappings or every search frontend. The definition catalog is bounded; large catalogs and additional workflows require explicit pagination and integration.

### Interface and preserved features

Professional is an optional presentation of the existing application, not a disconnected mockup. It has a quieter bilingual home/header/footer, restrained neutral/teal styles, real search and real counts, mobile/RTL layouts and access to existing canonical navigation. Heritage and the other frontend choices remain available. Registration, private care and metadata use the real SDK and authorization paths. Synthetic local records are visibly labeled.

Existing marketplace, workspaces, directory, editorial, AI research, competition, pedigree, imports, duplicate-resolution and privacy functions were retained. The new flows do not claim identical UI parity across every older frontend; backend permission enforcement applies independently of presentation.

## 4. Integration order for the full-access work agent

1. Create a branch/worktree from the actual current repository and record its commit. Keep a backup of uncommitted user changes. Compare it against the supplied R146 input; do not overwrite newer work with this source ZIP.
2. Verify the package digests and source manifest. Apply the R147 patch only where its baseline matches. Resolve conflicts by preserving both the user's newer behavior and the R147 invariants. Inspect every conflict in authorization, date validation, imports and migrations manually.
3. Confirm application/contract versions and whether migration numbers 0110–0116 are unused in that branch. If another migration occupies a number, renumber additively, update inventories/harnesses and rerun the full chain. Never silently reuse an already applied migration number with new content.
4. Use locked dependencies. Run typecheck, full Vitest, Python/native regressions, schema/reference inventories, frontend gates and the source-preview build. The PostgreSQL harness has a separate disposable-cluster ownership procedure; follow its runbook rather than pointing it at a live URL.
5. Restore authorized original assets and pass the normal production build. Keep source-preview mode out of production. No production gate should be changed merely to hide a missing file.
6. Rehearse all migrations and restore on a staging copy under the intended provider. Keep private care disabled. Record migration checksums, timing, indexes, foreign keys, row counts and the rollback/traffic plan.
7. Complete P0 work below. Run the client acceptance scenarios using named pilot roles and approved sample data. Only then perform the separately authorized production rollout.

## 5. P0 — required before privileged or clinical production activation

### P0-01. Complete MFA, recovery and step-up authorization

**Starting points:** authentication/session services, `src/auth`, auth API routes, platform SDK and sign-in/account UI. The current source does not implement the complete proposal's multi-factor requirement.

Choose the supported identity-provider or WebAuthn/TOTP approach with the operator. Add versioned storage for enrolled factors and recovery state. Protect TOTP secrets with the approved key-management system if that approach is used; recovery codes must be hashed, single-use and revocable. Require successful proof before activating a factor. Record authentication method, verified time and session assurance on the server.

Require a recent second factor for professional-grant changes, publication, rules/metadata activation, privileged exports, identity merge/reversal and other agreed sensitive operations. Cover password-reset, alternative provider login, invitation acceptance, recovery and administrator impersonation paths; hiding a button is not enforcement. Factor replacement/recovery must invalidate affected sessions, notify through an approved provider and leave a minimal audit trail. Add rate limits and replay protection.

**Acceptance:** password-only sessions cannot perform sensitive actions; a used/replayed OTP or recovery code fails; a stale factor/session fails; lost-factor recovery cannot silently bypass policy; concurrent recovery consumption has one winner; setup/recovery works in Persian and English. Preserve a documented break-glass process with narrowly logged authority. Do not activate clinical operations while this remains unresolved.

### P0-02. Serialize configurable policy with the canonical write

**Starting points:** `src/registry/rulesEngine.ts`, `src/api/modules/registryRules.ts`, mutation planning, reviewed change requests, imports, field claims and care integration.

Current canonical CAS protects the horse version, but it does not prove that every applicable rule, evidence item and parent fact stayed unchanged after preflight. Introduce a monotonic policy-set revision, including the case where there were no active rules and the first is activated. Bind the evaluated revision and relevant subject/evidence/parent versions to the write. Use a transaction-aware evaluator or deterministic guarded snapshot; reject stale context with a retryable 409 and reevaluate.

There is also a receipt boundary to fix: `recordRuleOutcomes` currently persists fail/override outcomes in a separate batch after accepted canonical/workflow writes in `src/api/routes.ts` and `src/api/modules/changeRequests.ts`. A receipt failure can therefore return an error after the canonical change committed. The import path in `src/api/modules/imports.ts` catches receipt errors after individual row commits, without enforcing durable retry. Commit accepted rule outcome/override receipts with the mutation, or atomically commit an idempotent outbox linked to that mutation. Pin the relevant source-agreement revision alongside the policy, subject, parent and evidence revisions. A forced receipt-storage failure must roll back acceptance or leave a durable pending receipt whose retry cannot duplicate the canonical change.

Keep definition, applicability, severity, override rules and recorded outcomes explicit. Outcome/override receipts must identify the versions actually applied. Avoid retroactively relabeling old outcomes when a definition changes. Extend rules to breed/studbook, event type, twins, embryo transfer and care-event requirements; current physical chronology checks are not that full configurable policy system.

**Acceptance:** actual two-connection PostgreSQL barriers cover rule activation/retirement, evidence withdrawal, parent correction and empty-to-active policy during create, direct update, reviewed update, import, field-claim selection/reversal and care intake. Either the write uses a consistent permitted context or it fails without any canonical/receipt/audit residue. Do not call this complete on the basis of a preflight-only unit test.

### P0-03. Establish clinical and institutional authority

The operator must identify the legal data custodian, permitted registration/passport/parentage authorities, participating laboratories, clinical record controllers and approval responsibilities. Obtain approved role/record/field access rules, publication/withdrawal basis, retention, incident response and dispute handling. A configuration string or administrator role is not accreditation.

Build a signed pilot roster and issue the minimum current horse-scoped grants. Include at least an owner, unaffiliated viewer, veterinarian, laboratory submitter, independent reviewer, institutional manager and administrator. Verify that organization membership alone does not grant institutional managerial authority and that clinical write does not imply read/export.

**Acceptance:** each scenario passes against the staged system; grant expiry/revocation/demotion takes effect on the next operation; sample/report evidence is reviewed independently; exports are explicitly permitted; public output contains no private finding or private evidence-presence signal. Record approval evidence before setting `approved_production`.

### P0-04. Hosted-stack rollout, recovery and security verification

Restore the original assets; use CI's supported runtime; build the actual Worker. Rehearse on the selected hosted database and connection layer, not just local SQLite/PostgreSQL. Verify migration transactions, timeout behavior, lock waits, bytea/blob handling, query bindings, foreign keys, session revocation, cache behavior and request limits.

Take an authorized encrypted backup, restore it into a different staging target and compare schema plus selected table/relationship/receipt counts. Choose and measure recovery time/data-loss targets with the operator. Keep feature flags off until restore and access tests pass. Run representative-volume query plans and load tests; current cache bypass is a privacy correction whose latency cost must be measured.

Use an approved independent security review for authorization, IDOR, upload handling, session/reset/MFA, injection and private exports. Configure production monitoring and alerts without clinical payloads or credentials. Test the actual SMTP/SMS/payment providers only with approved test accounts and provider environments.

**Acceptance:** normal build passes; target provider regression and rollback/restore evidence exists; no unresolved critical authorization defect; performance budgets are agreed and measured; explicit release approval references the exact source revision, schema and artifact digests. Preserve durable private histories during rollback.

### P0-05. Separate legacy genetic evidence permissions from ordinary registry editing

**Starting points:** `src/privacy/policy.ts`, `src/privacy/projections.ts`, `src/api/modules/genetics.ts`, `src/api/modules/marketplace.ts`, `src/genetics/pairingProjection.ts`, professional-grant contracts and issuance/revocation services.

The new care module has narrower permissions, but the preserved legacy genetics system still grants privileged genetic evidence access through `horse.edit` (editor/admin/super_admin). This is an existing policy boundary, not a claim that new care grants have solved every legacy medical-data permission. The affected paths are:

| Existing path | Current boundary requiring redesign |
| --- | --- |
| `GET /api/horses/:id/genetics` | `horse.edit` can read unverified/undisclosed tests, lab accession, notes, interpretation and review provenance. Horse-scoped `private_health_read` adds limited verified-result visibility and still strips those staff-private fields. |
| `GET /api/market/listings/:id` | Legacy genetic projection receives the authenticated role; it does not resolve professional grants as a complete alternative authorization path. |
| `GET /api/breeding/pairing-evidence` | Privileged legacy pairing includes withheld parents/undisclosed evidence through `horse.edit`; it does not resolve independent grants on both subjects. |
| `POST /api/horses/:id/genetics` | Legacy genetic intake uses `horse.edit`. |
| `POST /api/admin/genetic-tests/:id/interpretation`, `/pairing-review`, `/disclosure` | Interpretation, legacy assay review and publication use `horse.edit`; disclosure history separately requires `audit.read`. |

1. Obtain an approved matrix distinguishing result reading, accession/source-note reading, intake, independent evidence review and publication. Identify the institution and horse/report scope for each operation.
2. Add explicit proposed permission classes for these legacy operations across storage constraints, runtime enum/validator, contracts, SDK, grant UI and transaction guards. Reuse the current scoped-grant architecture while keeping laboratory review and public disclosure distinct. The existing new-care `evidence_review` permission is not a complete replacement for all legacy reads/writes.
3. Add one current-state authorization resolver used by every affected route, marketplace projection, pairing path, export and analysis. Pair analysis must authorize each parent independently. Never accept a client-supplied access-context boolean.
4. On staging, onboard approved reviewers with explicit grants before removing the old role fallback. Do not grant every former editor broad medical permissions as an automatic migration. Preserve immutable source history and show truthful permission errors in reviewer UI.
5. Remove the role-only fallback after the staged workflow is usable. Bind session, assignment, institution and subject versions at sensitive writes; record minimal private audit without leaking report contents.

**Acceptance:** generic editor/admin with no scoped grant cannot read private genetic evidence or alter its interpretation/publication; a result reader cannot inspect accession/notes or review evidence; a reviewer cannot independently publish without that authority; a write-only actor does not gain read permission; expired/revoked grants fail across profile, marketplace, pairing, exports and direct HTTP calls. Include actual PostgreSQL revocation races and paired-parent mixed-permission cases. This must be completed before sensitive production activation; simply changing one projection predicate would strand existing reviewer workflows and leave write authorization inconsistent.

## 6. P1 — finish the client's remaining product workflows

### P1-01. Dynamic metadata from owner intake through search

Connect the versioned definitions to registration forms, draft validation, review, imports and search UI. Save the exact definition version in every submitted value and import mapping. Changing an option label must not reinterpret a historical submission. Make private fields unavailable in anonymous catalogs, queries, counts and exports. Add bounded cursor pagination for definition/version catalogs before institutional catalogs exceed current limits.

Acceptance scenarios: an administrator creates a draft field; it is absent from owner forms until activation; an owner submits it; its definition changes before review; review preserves or explicitly remaps the old meaning; two administrators race activation; an old-version filter cannot match a redefined option; private field names never appear in public metadata. Test Persian labels, zero/false/null and clearing a value separately.

### P1-02. Public audience-specific aggregates and search refresh

Rebuild materializations from an explicit public cohort and record audience, source generation, rule/privacy revision and computation time. A private or synthetic horse must not inflate a public population, person, parent, ranking or evidence count. Current conservative gates may make old snapshots unavailable; fix their producer and validation instead of removing the gate.

Check event result totals, person statistics, breeding candidate summaries, public quality dashboards, search indexes/facets, AI broker output and cached snapshots. Test withdrawal after materialization and after cache warming. For each metric, document its numerator, denominator, excluded records and stale-state behavior. Publish both completeness and missing-data measures; zero observed inbreeding in an incomplete pedigree is not proof of zero biological relatedness.

### P1-03. Governed horse publication and identity reconciliation

Restricted imported horses need an explicit reviewed publication workflow. Bind the current source agreement, horse/version, permitted fields and evidence to an approval decision. Withdrawal must immediately remove current public projections and initiate the historical cache/artifact handling plan. Imported status must never become an official badge automatically. Legacy extracts containing private identifiers or an unbound attestation scope require reviewed reissuance; do not restore unsafe artifact visibility just to preserve an old download link.

Generic merge/archive now refuses care, metadata and unrevoked professional grants, including expired grants awaiting explicit disposition. Build a preview that enumerates every retained reference, its owner/authority and proposed disposition. Reconcile clinical records, specimens, report subject identity, grants and supplementary definition versions explicitly; retain originals and immutable decisions. Apply sorted locks, expected versions and an atomic receipt. A generic foreign-key rewrite is insufficient.

Acceptance: duplicate identity with two different clinical histories; conflicting sample identity; old report withdrawal; one restricted and one public horse; institution/grant mismatch; simultaneous care creation during merge. Reversal must restore only effects of its own current operation and must not resurrect revoked access or overwritten evidence.

### P1-04. Scientific and laboratory completion

Obtain de-identified sample reports from the actual participating laboratories: raw marker names/alleles, panel/version, assay method, quality flags, missing-call conventions, horse/sample identifiers, retest/amendment process and expected review outcome. Have the chosen equine geneticist approve the supported assays and reference fixtures.

Keep STR compatibility distinct from formal/statistical parentage. A likelihood or exclusion probability requires a validated method, marker normalization and appropriate population frequencies. Extend coat genetics only with validated variants, allele semantics, dominance/phase/penetrance and breed applicability; the current two-locus base-pigment model is deliberately narrower. Disease-risk support must bind the actual disease assay, inheritance model and applicable breed/evidence; never infer a disease call from an STR profile or a photo.

The existing legacy assay/pairing engine already supports bounded reviewed disease evidence; retain it. Implement an explicit, versioned and consent-aware bridge from independently accepted care disease reports into that engine. Bind the exact report, assay/variant, applicable breed, review state and publication scope; withdrawal or correction must invalidate the derived result without destroying prior evidence. Do not silently copy raw care calls into a public or legacy result table.

Add a bilingual analysis workspace over the existing real scientific APIs, showing evidence, model/version, assumptions, missing loci, conflicts and access limits. Require independent expert fixture approval before clinical/official use. Acceptance includes known Mendelian families, incompatible/ambiguous profiles, missing locus, mismatched panel, duplicate/withdrawn report and permission revocation during analysis.

### P1-05. Competition and ranking completion

Preserve each source's event, race, participant and result identifiers plus revision. Implement the remaining organizer workflows for entries/start lists/judges, protests/corrections and official confirmation. Rider/trainer/owner/club histories must follow reviewed identity links. Define rankings separately by discipline, class, season and age/region with versioned official formulae and tie/withdrawal/elimination handling.

Acceptance: importing the same event twice is idempotent; corrected source results retain prior history; a nonrunner does not become a start; a name collision does not auto-link to a canonical horse; an event correction invalidates/recomputes the affected ranking; source-observed and organizer-confirmed labels remain distinct. The existing racing/competition reader is not proof that this entire phase is finished.

### P1-06. Files, clinical usability and secondary frontend parity

For larger documents/video, add the selected private object store, quarantine state, actual scanning, upload completion receipts, immutable stored-byte digest and controlled download authorization. Failed or abandoned multipart uploads need cleanup; legal/clinical retention must prevent deletion of retained evidence. Do not claim the current signature checks are antivirus.

Add any agreed structured medication/allergy/exam fields, practitioner workflows and reminders with specialist input. Current clinical records preserve attributed entries; they are not a complete electronic medical-record specification. Verify the client's approximate-date/range and missing-status-date requirements explicitly; typed year/month/day dates do not automatically represent every arbitrary estimated range.

Keep older frontends functional and make an explicit choice about which new workflows each must expose. Test mobile keyboard/focus, slow connections, long Persian names, error recovery and accessible contrast. Current real-browser evidence covers Chromium, two languages and two widths; add Safari/Firefox and actual pilot devices before claiming full browser/accessibility acceptance.

### P1-07. Connect farm calendars, reminders and private costs

**Starting points:** the existing workspace/task/reminder services, private care and reproduction APIs, delivery outbox and professional authorization resolver. Preserve the existing general workspace features.

Define the commissioned calendar events: practitioner-entered follow-up, vaccination due date, reproductive examination, expected foaling, document expiry and general farm tasks. Store the source entity/version, responsible authorized actor, configured timezone, due date and permitted notification summary. Do not infer a medical schedule from a diagnosis or invent a treatment recommendation. Corrections and voids must reschedule or cancel derived tasks; current death status, access revocation and withdrawn source evidence must prevent inappropriate future reminders.

Use stable delivery keys and the existing outbox for retries. Resolve authorization again at delivery, and keep private findings out of email/SMS subject lines or public calendars. A successful delivery needs a provider receipt; an enqueued task is not proof a person received it. Provider onboarding and test recipients must be authorized before external messages are sent.

Add the agreed private cost ledger only after defining currency/unit conventions, categories, attribution to horse/farm/event, attachments, adjustment/reversal rules and report visibility. Keep exact decimal amounts and explicit currency units; do not silently treat different rial/toman representations as equal. Financial rollups need documented denominators and correction history.

**Acceptance:** a corrected care date changes one task without duplicate delivery; access is revoked between scheduling and delivery; a deceased horse's incompatible future task is cancelled; a failed provider retry produces one final receipt; two farms cannot read each other's events/costs; reversing a cost preserves the original and updates the correct permitted report.

### P1-08. Close the remaining identity, search and media acceptance gaps

Agree a field-by-field fixture with the client for estimated birth intervals, missing-status dates, breed/sub-breed fields and standardized identity imagery. Current year/month/day precision is useful but does not encode every arbitrary estimated date range. Add an interval model only with explicit bounds/calendar/precision semantics and conservative chronology comparisons; avoid turning an estimate into an exact day.

Map each requested search filter to a precise stored fact or derived definition: former names, authorized identifiers, scoped trust status, source-reviewed parentage, publicly disclosable laboratory/health evidence, recorded offspring, results and seven-generation completeness. Define seven-generation completeness in the presence of repeated ancestors, unknown parents and withheld nodes. Keep private evidence-presence filters and counts unavailable to unauthorized viewers, including combinations that reveal small hidden cohorts.

For photographs, distinguish left side, right side, head and identifying markings, record source/consent and review, and preserve originals when a new image is supplied. Image similarity may suggest a duplicate review candidate; it must not merge identity or confirm a coat/genetic fact automatically. Verify actual video and larger-file support through the storage/scanning work in P1-06.

**Acceptance:** every agreed field and filter has a positive, negative, unknown, conflicting and unauthorized example; an archived/withheld ancestor does not become evidence of complete public pedigree; a previous-name correction updates search without deleting independently sourced aliases; replacing a photograph does not erase its prior review history. The client accepts the exact terminology and visual status labels in Persian and English.

## 7. Data acquisition and enrichment plan

Public data can enrich source assertions, names, pedigree claims and published performance. It cannot supply an unperformed genetic test, prove sample identity, grant owner consent, establish official authority or create a genuine clinical history. Do not generate missing horse facts or photographs as evidence.

| Source | Useful next step | Boundary |
| --- | --- | --- |
| Existing authorized database and scraper repository | Obtain an approved snapshot plus the actual ingestion code/raw manifests; audit what is already present before collecting more. | Source-package counts are historical assertions, not current measured coverage. |
| Asbdavani | Public horse/performance and racecard pages are accessible; seek a supported export/API or agreed incremental feed, then compare with existing importer/crosswalk. | A public page is not a verified bulk API or a redistribution agreement. |
| Sheyhe | Pedigree/name/source-claim comparison through an authorized export or agreed collector. | Its own site describes manual compilation and possible errors; keep attributed claims and human reconciliation. |
| Kasilor / FEI | Establish an approved institutional lookup/export arrangement and run a small mapping pilot. | This retrieval could not verify a reliable bulk feed; Kasilor timed out and FEI horse search returned403. Do not work around access controls. |
| Owners, breeders, clubs and laboratories | Collect original scans, identity evidence, permissions, corrected dates, sample-linked reports and official results through structured intake. | Submitted material remains attributed/unreviewed until the proper authority reviews it. |

### Exact collector/import sequence

1. Record the source owner, allowed access method, allowed fields, storage/display/export/derived-use rights, imagery permissions, effective dates, attribution and withdrawal process. Set public redistribution off while unresolved.
2. Audit the current authorized corpus with an as-of snapshot and aggregate-only report. Split canonical/public/private/archived/synthetic/placeholders; reconcile identifier namespaces, source generations, parent completeness, duplicate queues and racing links. Never report an old configured count as a new measurement. The new `tools/r147-readonly-data-coverage.sql` supplies 13 bounded aggregate sections for schema 0116, with a PostgreSQL read-only repeatable-snapshot command and timeouts in its header. It was verified on empty and synthetic migrated SQLite databases in query-only mode with no changes; it has not been run against the user's actual database or PostgreSQL. Its counts describe stored state, not validity or permission sufficiency, and belong only in the authorized operator report. Use the existing `tools/audit-data-coverage.py` on an approved restored SQLite snapshot for complementary cohort/coverage analysis. Run from the repository root (or use an absolute `\i` path), verify schema 0116 and the intended SELECT/RLS scope, and record database/schema identity plus source/migration/audit-file digests. Preserve all 13 results, the as-of receipt and exit status. A partial-visibility database role must label that scope; do not bypass RLS to make counts look complete. Keep every section with the same snapshot receipt; any error makes the report incomplete. This supplement does not establish placeholder quality, synthetic-corpus separation or racing crosswalk completeness; qualify those separately.
3. Select a small representative pilot, for example 100–300 permission-covered records: Persian/Latin aliases, imported horses, missing dates, conflicting parents, duplicate names, corrections and nonrunners. This is a proposed engineering pilot size, not a statistical accuracy guarantee.
4. Store permitted raw snapshots or stable references, source namespace/external ID, retrieval time, content digest, parser/version, exact source calendar and units. Normalize into a separate stage. Preserve original strings and precision.
5. Match exact typed identifiers within issuer scope first. Source IDs identify source records, not automatically canonical horses. Name-only matches enter a review queue. Retain competing field claims and identify which source supports each parent edge.
6. Replay the same batch and prove no duplicate canonical rows/receipts. Exercise a source correction, parser format drift, mid-run failure, license withdrawal and partial retry. A parser must stop on structural drift rather than silently filling empty/default values.
7. Sample-check against source records and report denominator-based accuracy/coverage, unmatched/conflicting counts, source freshness and reviewed identity links. Have the actual data steward accept the pilot before increasing volume.
8. Schedule bounded approved refresh with rate limits, conditional retrieval, checkpoints, dead-letter handling and withdrawal monitoring. Separate collection, private retention and public publication decisions.

## 8. Client acceptance checklist

Use fictional fixtures until approved pilot data is available. Every test records actor, initial versions, action, expected response and database/audit effects.

1. Owner registers a horse with Persian and Latin/previous names, scoped passport and private scans; saves/reloads; submits; cannot edit frozen evidence.
2. A conflicting identifier fails without a partially accepted horse. Different issuers with equal numbers follow the approved namespace policy.
3. Reviewer approves the intended fields; document presence is not displayed as official authentication. A parent correction detects cycles and clearly impossible chronology.
4. An unrelated viewer, expired professional and demoted institutional member cannot read/write/export private care. A writer can receive a success receipt without acquiring read access.
5. A veterinarian records/amends/voids an entry; a concurrent amendment conflicts; a forced later failure rolls back state and history.
6. An embryo-transfer episode links genetic dam, recipient and two offspring separately; it does not rewrite canonical pedigree as a side effect. Known impossible physical dates fail while explicit legitimate stored-material cases retain their basis.
7. A sample/report binds exact stored evidence, horse, panel and custody; the submitter cannot self-approve. Missing/conflicting calls do not produce an unsupported scientific conclusion.
8. Publication followed by withdrawal disappears from every audited public route and subsequent browser request; no private evidence count remains.
9. Restricted imports preserve source assertions without publishing canonical facts; a repeated import is idempotent; a changed assertion creates a reviewable conflict.
10. Public/private supplementary fields retain version meaning; activation races and stale writes fail; private definitions/values stay out of public catalogs and filters.
11. A result correction, withdrawal and nonrunner retain source history and correct aggregate meanings. Official ranking is accepted only with its approved discipline formula.
12. Restore, provider outage, revoked credential, lost MFA factor, slow network and failed upload leave recoverable, truthful states. The client signs off on the real staged workflows and the exact remaining limitations.

## 9. Reference material

Primary methodological references checked during this work:

- [UC Davis VGL parent verification](https://vgl.ucdavis.edu/test/parentage-genetic-marker-report-horse): sample-linked marker comparison, analyst review and confirmation of exclusions.
- [UC Davis equine coat genetics](https://vgl.vetmed.ucdavis.edu/resources/horse-coat-color): MC1R/ASIP base color and the broader coat-genetics distinction.
- [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html): enrollment, factor replacement, recovery and sensitive-operation considerations.
- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/): data-center-local cache deletion is not a global withdrawal guarantee.
- [Asbdavani horse performance](https://asbdavani.app/performance/horses) and [racecards](https://asbdavani.app/racecards).
- [Sheyhe pedigree information](https://sheyhe.com/horses) and [its published terms](https://sheyhe.com/terms-of-service).

No cited website has been treated as granting this project unrestricted collection or republication rights. No bulk collection, live database change or institutional agreement was performed in this source implementation.
