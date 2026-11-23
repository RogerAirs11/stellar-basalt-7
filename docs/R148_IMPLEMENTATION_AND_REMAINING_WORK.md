# R148 implementation, audit and remaining work

## Readiness decision

R148 is a materially stronger implementation candidate for integration and a controlled pilot. It is not an unrestricted production release, an accredited national registry, an authenticated laboratory service, or completion of all four proposal phases. The code has been changed in the supplied source workspace. The live site was not changed in this turn.

The smaller agent preserved the earlier work correctly: comparing the prior EXPORT_MANIFEST's 1,774 entries found 1,675 identical files, four changed progress documents, and 95 omitted old review/input evidence files. No prior runtime code, migration, test, tool or script in that inventory was lost. The agent's own deployment record says it integrated R147 and restored 16 missing FEI/Equidata assets, but did not implement the five P0 engineering tasks. This round audited those statements and completed significant parts of those tasks.

The supplied archive was `01-horse-registry-code-r147-integrated.zip`, SHA-256 `f3139e6430010a3c53831757f8fecee91a07baaec835f121cabf5e58c695c726`. The local baseline commit is `5f1e0ef162c091cfb5468456a49a57da80a2b43d`; it is not an assumed external repository commit. The reattached client proposal has the same SHA-256 as before: `54522fb4568afb0c9c5e069979d880b191d8d75ea45cb70080d686591bff7314`.

### Observed live behavior

A public read-only probe on 2026-10-28 reported application 0.89.0, contract 2.32.0, 89,859 public active horses and 89,859 corresponding search rows. It reported primary/active Supabase, configured `supabase_full`, no fallback, `analyticsReady:false`, `snapshotStale:true` and unspecified dataset provenance. The public `/api/registry/metadata` endpoint returned HTTP 500. These are narrow observations, not a private database audit or a count of scientifically verified horses. The exact report is preserved with the validation evidence.

The deployment record's migration discussion mentions D1. It does not prove that the Supabase primary has the same schema. Missing or divergent primary migrations are a plausible explanation for the metadata HTTP 500, not a confirmed diagnosis. The operator must inspect the selected primary's schema and sanitized error log rather than guess or blindly rerun migrations.

## What R148 implements and repairs

### 1. Authenticator setup, recovery and sensitive-action verification

Migration 0119 adds encrypted TOTP factors, hash-only recovery codes, bearer/session/factor-bound recent assurance, a minimal private security history and transaction-aborting authority checks. The implementation uses RFC 6238 TOTP with six-digit codes, 30-second steps and one neighboring step on either side. Accepted steps cannot be reused. Failed verification is limited per account; five failures cause a 15-minute lockout. The existing stricter HTTP authentication limiter also applies.

Secrets use AES-GCM under a versioned server keyring. Authenticated encryption binds each secret to the account and factor version. A pending enrollment must be proved before it becomes active. Replacement leaves the old factor active until the new factor is proved. The key and recovery codes appear only in the current setup response/UI memory, not in browser persistence or general audit.

Ten high-entropy recovery codes are issued and stored only as hashes. Recovery requires the current password, consumes one code atomically, revokes other sessions and clears assurance. It grants a short-lived factor-replacement permit, not ordinary privileged access. Current password plus a fresh authenticator is required for normal replacement, disabling or recovery-code regeneration. Password reset preserves the factor and revokes sessions.

Successful account-security commands rotate the current cookie and CSRF token. A 15-minute recent proof is bound to the exact bearer hash, session and factor version. Mutation checks run in the same database transaction as the protected mutation. Privileged reads use current checks too; care/genetic/private-media projections additionally bind their own scope at the data query. The wrapper preserves the PostgreSQL pedigree advisory marker at batch index 0 and the caller's result indexes. This was specifically checked with observed database lock waits.

MFA configuration modes are explicit. Optional mode supports staged enrollment. The current request guard covers authenticated business mutations, selected privileged reads and explicit scoped private reads; required mode blocks those operations without an enrolled/current factor. Consequently, rollout affects owners, sellers and other ordinary writers as well as staff. Login/logout and factor setup/recovery keep their own authentication flow; public browsing stays available. Disabling new enrollment does not bypass enrolled factors or prevent existing-factor verification/recovery when keys remain available. Production private care now requires `MFA_MODE=required` in addition to its agreement gate. Shared DB/AUTH_DB/AI_DB bindings retain guarded writes; split-database AI administration fails closed because it cannot promise same-transaction authentication authority.

This is a working TOTP system, not a claim of phishing-resistant passkeys, universal identity proofing or formal NIST compliance. Approved out-of-band security notifications, a reviewed break-glass process and live key/restore operations remain rollout work.

### 2. Consistent registry policy decisions and atomic receipts

Migration 0117 introduces a singleton policy revision even when no active rules exist, immutable policy/context receipts, outcome links and draft content revisions. Direct create/update, reviewed create/update, lifecycle death/castration, imports and field-claim selection/reversal now bind the evaluated rules and relevant parent/evidence/source context to commit.

Rule activation, retirement and editing share a serialization boundary with canonical admission. Exact rule definitions are also pinned, so a direct administrative SQL edit cannot evade the guard merely by forgetting the epoch. Separate post-lock check statements account for PostgreSQL READ COMMITTED behavior after a wait. Policy outcomes and overrides commit with the canonical change. Forced receipt storage failure rolls back acceptance; it is no longer an error reported after an unreceipted successful mutation.

The review workflow pins the exact loaded proposal revision. Losing draft edits cannot independently delete or insert child items. Imports capture policy even when the active set is empty, retain per-row acceptance semantics and stop on stale context instead of swallowing receipt failures. Previously accepted rows remain explicitly receipted; retry must reconcile them rather than claim whole-file rollback.

Ordinary registration evidence rules now exclude veterinary files and files bound to genetic or care records, including historical bindings. The same predicate applies to count, captured context and commit recheck. This prevents private clinical evidence from satisfying a generic rule or leaking through its pass/fail result. Policy/outcome subject references are explicitly classified as immutable history; merge previews distinguish horse IDs from review/import namespaces.

Configurable breed/studbook/event/twin/embryo-transfer policies for care intake are still not implemented. Existing physical chronology validation is preserved and must not be represented as completion of that wider policy system.

### 3. Explicit genetic intake, evidence reading, review and publication

Migration 0118 and shared contracts add `genetic_evidence_read`, `genetic_intake`, `genetic_review` and `genetic_publish`. Each requires an explicit current horse-scoped professional grant with an allowed professional kind and current organization membership where applicable. Generic editor/admin status no longer grants private genetic evidence or review/publication authority. No migration automatically grants former editors medical access.

The existing `private_health_read` permission retains limited verified-result semantics; it does not reveal private accession numbers, raw notes or unreviewed evidence. Profile, marketplace and pairing reads use current SQL permissions. Parent permissions are evaluated independently, so permission over one parent cannot expose the other parent's withheld identity or private tests/counts.

Intake is usable as a write-only operation and returns a payload-free receipt. It cannot self-verify or publish. Independent record review now supports explicit confirmation, correction and withdrawal with expected versions, operation IDs, references and reasons. Known submitters cannot positively review their own evidence. Unknown historical submitters remain unknown and require explicit acknowledgement, not an invented identity. Withdrawal preserves prior positive interpretation provenance. Assay mapping for pairing has its own versioned review.

Confirmation of an unverified row cannot exploit a stale public flag to publish without publication authority. Confirmation/withdrawal performs a protective publication withdrawal where necessary; a fresh publication decision is required. Review is labeled as local record review, not issuer attestation, clinical diagnosis or official DNA certification. Historical genetic reasons are hidden from general audit; private history remains available through scoped review.

Private genetic attestation snapshot export also requires scoped evidence reading; generic content managers and issuer owners cannot use it as an alternate private export. Known submitters are excluded from attesting their own submitted genetic record at both preflight and commit. Existing issuer scope/authority requirements remain separate.

### 4. Private files and signed-link authorization

Migration 0120 binds private media grants to the signed-in session and bearer token. Private metadata and bytes recheck current session, MFA and applicable role/grant authority in the data query. A signed URL is a convenience for an authorized current reader; it is not anonymous authorization. Other-session, logged-out, rotated-bearer, revoked, expired and legacy unbound private links fail closed. Public photographs retain their existing public-consent behavior.

This closes both a factor-verification bypass and a gap between an initial permission check and a later unguarded blob read. It does not add antivirus, large-file object storage, video processing or a clinical document-retention policy.

### 5. Usable bilingual staff controls and a reproducible visual fallback

The new account-security, professional-grant and genetic workbenches use the real SDK. They handle exact horse scope, independent permissions, versions, operation receipts, stale principals, aborted/ambiguous requests and explicit reconciliation. Acknowledged success is not replaced by failure wording just because refreshing the screen failed. An uncertain security update remains visible in a nonprivate shell while the user reloads current account state. No OTP or sensitive command is automatically retried.

Heritage/Professional, Equidata, Retro and FEI receive the applicable controls. The existing optional quieter Professional frontend and existing useful marketplace/workspace/directory/editorial/AI/pedigree/competition functions remain. The final limited real-browser smoke passed eight public cases across Core/Professional, Persian/English and desktop/mobile, plus six authenticated follow-up checks. Enrollment and activation also succeeded. This is not a claim of identical workflow parity in every historical shell, full accessibility certification or visual acceptance on every browser.

The archive still omitted extensive original artwork/fonts despite the 16 restored FEI/Equidata files. Production builds exposed both a missing Heritage AVIF import and the omitted optional 3D horse model. Three Retro texture references also pointed away from their supplied assets; those paths now use the original files. R148 makes optional scene packs discoverable only when complete, omits the particle splash option when its original model is absent, and supplies neutral non-photographic fallback assets. All 24 supplied images/SVGs remain byte-identical; no replacement model or horse photograph was fabricated. Existing provided imagery remains intact. Missing horse photographs are labeled as missing, not replaced with fabricated photographs. System fonts replace absent downloadable fonts. Original artwork/font fidelity still requires restoration from the client's actual full repository or approved asset archive.

## What must happen next, in order

### Gate A — reconcile the real repository and deployment evidence

Create an isolated branch/worktree from the smaller agent's actual current HEAD. Record that SHA and uncommitted-change backup. Compare the patch against the attached R147 baseline before applying it. Do not use a deletion-based directory overlay. Preserve newer unrelated work and all real artwork/fonts. Review changed security/contract files together; copying only the new UI or only the migrations leaves an inconsistent system.

Confirm migration numbers 0117–0120 are unused. If a concurrent branch used one, renumber this unapplied migration, update references/inventories and rerun the chain. Do not change the contents of a number already applied to a real database. Rebuild with the pinned Node 24.19.0 and committed lockfile. Obtain a final clean source SHA and attach the corresponding tests and asset inventory.

Acceptance: the exact integration commit builds from a clean checkout; its application/contract versions match 0.90.0/2.33.0; all 120 numbered migrations, 363 route entries, 170 structures and 67 classified horse-reference entries are accounted for; current root manifests point to R148 rather than absent R147 evidence.

### Gate B — repair/verify the live primary schema and stale analytics

Use only the operator's explicitly selected Supabase project, database and schema. Record nonsecret target identity and migration ledger/digests. Run `tools/r148-hosted-schema-preflight.sql` read-only; it lists 26 required columns and deliberately exits with an error if any is absent. For a pre-R148 production schema, absence of new columns is expected until the reviewed rollout; absence of R147 metadata/care/evidence structures explains a more urgent integration gap.

Correlate the metadata HTTP 500 with a sanitized Worker error and the selected primary's missing table/column or actual failing SQL. Do not infer completeness from D1 migrations. Render only an identified pending migration with `tools/render-r148-postgres-migrations.mjs --migration=NNNN --out=/absolute/reviewed/NNNN.sql`; this tool never connects or applies. Inspect its source digest, translated statements and transaction. The old range runner is not automatically suitable for new singleton initialization/data statements. Preserve the existing migration approval/backup gates and record each applied checksum in the selected migration system.

Rehearse the pending sequence on a restored staging copy before production. Apply additive schema before deploying code that reads it. If an apply fails, investigate its transaction and ledger; do not mark it applied or blindly rerun unrelated migrations. Verify API metadata, registration/evidence, genetics/private files, policy receipt, account setup and migration replay through the actual hosted adapter.

For analytics, inspect canonical revision versus snapshot source revision. Rebuild public-cohort materializations with audience, source generation, privacy/rule revision, computation time, numerators/denominators and excluded records. A private/synthetic/archived horse must not inflate public counts. Rebuild the search materialization and show no unexplained delta. Do not turn off stale/public-audience gates to make health appear green.

Acceptance: metadata returns a valid response; schema/ledger match the approved commit on the active primary; analytics are current or explicitly unavailable with a documented cause; withdrawal invalidates affected public search/counts/caches; no unexplained difference between canonical/public/source counts.

### Gate C — activate account security with an operational recovery path

Generate a cryptographically random 32-byte AES key in protected operator storage. Create the documented JSON keyring with an explicit active key ID. Store it as the Worker secret `MFA_KEYRING_JSON`, never a `VITE_` variable, repository file, browser asset, log or shared chat message. Keep prior read keys during rotation until every retained encrypted factor/backup has a supported key.

Use staging and fictional accounts first. Exercise setup, incorrect code, pending expiry/cancel, normal verification, replay, cross-session use, five failures/lockout, password reset, code regeneration, factor replacement and lost-factor recovery. Confirm recovery permits replacement only. Check that disabling new enrollment still allows existing-factor verification. Test an account with a factor whose decryption key is unavailable: it must not silently become password-only.

Enroll each pilot actor who will write records or use protected reads, including ordinary owners and sellers as well as staff; confirm they have safely stored their recovery codes, then set `MFA_MODE=required`. Test a newly registered owner reaching Account security and completing enrollment before their first record mutation. Keep a separately protected approved recovery operator process with two-person authorization, identity checks, minimal event evidence and session revocation; do not add a general bypass flag. Add out-of-band factor-change/recovery notifications through the approved provider/outbox with no codes or secrets in messages. Verify actual delivery only using explicitly authorized recipients. Add passkeys/WebAuthn later if phishing-resistant authentication is commissioned.

Rehearse restoration of database plus the separate keyring. Clear restored sessions and assurance. Account for consumed recovery codes that may have reverted to unused state in an older snapshot; invalidate/reissue those credentials under the approved recovery procedure. Do not remove factors because a key was omitted from the restore. Measure time to restore and the actual data-loss window against agreed RTO/RPO.

Acceptance: every sensitive API path rejects password-only and stale proof; key/factor/session changes invalidate the intended authority; real hosted lock waits cannot admit a stale mutation; recovery succeeds without a hidden administrator bypass; messages have real provider receipts; a restored stack passes the same negative matrix.

### Gate D — onboard real professional/institutional authority

The client/operator must name the data custodian, registration/passport/parentage authorities, laboratories, clinical controllers, reviewers and publication decision owners. Obtain the actual agreements and policy covering record/field access, permitted reuse, consent/publication/withdrawal, retention, disputes and incident response. A configuration reference or a role label is not accreditation.

Prepare a signed pilot roster: owner, unaffiliated viewer, intake-only actor, verified-result reader, private-evidence reader, independent reviewer, publisher, veterinarian, laboratory submitter, institution manager and generic administrator. Assign only the exact current horses, profession, actions, validity dates, assignment and supporting authority. Review and evidence reading require separate explicit permissions; they may be present in the same valid grant or in separate valid grants. No broad automatic migration of editor access is allowed.

Execute direct HTTP negative tests for each actor across profile, marketplace, both pairing parents, review/history, disclosure, attestation snapshot and private-file delivery. Test expired membership/grant, mid-request revocation and stale links. Check own-submission denial and unknown historical origin acknowledgement. Verify a publisher cannot create an issuer attestation or diagnose a horse merely through publication permission.

Acceptance: the steward signs the permission matrix and pilot result; generic admin without clinical/genetic grant sees no private result; one parent's grant never exposes the other; corrections/withdrawals leave accurate private history and no general-audit leak.

### Gate E — extend configurable policy to the remaining care/studbook requirements

Starting points: `src/registry/rulesEngine.ts`, `ruleCommit.ts`, the rule contracts, `src/equineCare` services and migrations 0112–0117. Add declarative event applicability and approved breed/studbook policy types for reproductive method, embryo transfer, genetic/recipient dam, twins/offspring count and required evidence. Do not encode a universal 'twins forbidden' rule. Version the definitions, allowed overrides, severity and effective period.

Care commands must capture the same policy epoch, participant versions, consent/evidence/source facts and relevant event versions; recheck them after locks, then commit the care mutation, private history, policy decision and operation receipt together. Standardize graph/policy/participant lock order with existing canonical commands. An empty policy set becoming active during care intake must be detected.

Acceptance: two-connection hosted/PostgreSQL barriers cover activation, retirement, parent/date correction, evidence withdrawal, recipient change and concurrent care insertion. Show exactly one allowed outcome or a conflict with no partial care/history/receipt residue. Keep physical impossibility checks distinct from configurable registry policy and from uncertain/partial-date warnings.

## Remaining product work by proposal area

### First: finish two explicit editing and retry contracts

**Drafts opened before another edit.** R148 protects the content loaded by a review command until its commit. It does not yet expose a universal browser form-start revision contract. Start in `src/api/modules/changeRequests.ts`, the corresponding request contracts and `src/frontend-kit/platformClient.ts`. Return `content_revision` with the editable draft, require `expected_content_revision` on every draft replacement, and compare it in the guarded parent update. Child item deletion/insertion must retain the winning command marker. Propagate the version through the registration wizard and every supported editor. On a conflict, retain the local draft, show the current server version, and ask the user to review the differences; never silently resubmit against a freshly fetched revision. Acceptance: open two independent tabs, save tab A, then save stale tab B. B receives a conflict and neither the approved parent nor its children change; a stale review also cannot approve B's content. Test draft-versus-approval in both orders on the actual Worker and on PostgreSQL.

**Ambiguous direct creation.** Imports and new genetic commands have tested replay semantics. A minimal direct horse creation is not universally idempotent without a stable client command key. Start in `src/registry/mutations.ts`, the create route, contracts and SDK. Define an actor-scoped command UUID plus canonical request digest and durable receipt, with a unique constraint. Capture and return the canonical horse ID, result and original policy decision atomically. An exact retry returns the same receipt; reusing the key for different content returns a conflict. Never deduplicate by horse name. Persist only the minimal principal-scoped reconciliation metadata in the client, with no evidence or clinical payload in browser storage. Acceptance: simulate a committed request whose response is lost, retry with the same key, and prove one horse, one identifier set, one policy receipt and one audit fact. Race two independent connections and test changed-payload reuse. Until this is implemented, the client must stop on an ambiguous create and reconcile through current records rather than automatically replaying POST.

These are remaining engineering tasks, not missing credentials or approvals. The current package does not claim they are solved.

### Proposal workflows

1. **Dynamic metadata throughout intake/import/search.** Existing-horse field curation works, but owner registration, review, source mappings and every search shell still need immutable definition-version references. Add bounded catalog pagination, historical label preservation, private-field omission and explicit zero/false/null/clear semantics. Acceptance includes definition changes between draft and review, activation races and private-field inference through combined counts.
2. **Reviewed publication and identity reconciliation.** Restricted source assertions need a source-version-bound publication decision. Build merge preview/disposition for clinical histories, samples, reports, grants and supplementary values; generic merge must continue to block unsafe cases. Record original and resulting identity links, approval, reasons and reversal constraints. Do not rewrite clinical identity or resurrect revoked access through a generic foreign-key move.
3. **Laboratory integration and scientific models.** Obtain de-identified actual reports, panel/marker/allele versions, missing-call conventions, quality flags, identifiers, correction rules and expert fixtures. Keep STR compatibility distinct from statistical/official parentage. The present MC1R/ASIP model is base pigment, not a complete coat-phenotype predictor; STR is not a disease/color test. Build a reviewed consent-aware bridge from accepted care disease reports to the existing legacy pairing engine; withdrawal must invalidate derived output. Add a bilingual analysis workspace with exact evidence/model/scope/uncertainty. Expert approval is a separate acceptance gate.
4. **Competitions and ranking.** Finish organizer entries, start lists, judges, protest/correction and official confirmation workflows. Preserve source event/result IDs and revisions. Add discipline/class/season/region/age-specific versioned ranking formulae and tie/withdrawal/elimination semantics. Link rider/trainer/owner/club identities only through reviewed evidence. Replay/correction must be idempotent; nonrunners must not become starts; name collisions must not auto-merge.
5. **Files and clinical usability.** Select private object storage for large documents/video, actual quarantine/scanning, immutable digests, upload completion receipts, abandoned-upload cleanup, authorization at download and retention controls. Signature checks are not antivirus. Agree structured medication/allergy/exam fields and practitioner usability with clinicians; do not invent medical schedules. Add browser/device/accessibility acceptance in Persian RTL and English LTR, including slow/failed requests.
6. **Farm calendars, reminders and costs.** Derive tasks from explicitly entered follow-up/vaccine/document/reproduction events with source version, responsible actor and timezone. Corrections/voids cancel or replace one derived task; recheck access at delivery. Use stable outbox delivery keys and real receipts. Keep sensitive findings out of subjects/public calendars. Define an exact-money private ledger with explicit rial/toman/currency units, adjustment/reversal and farm/horse scopes; no cross-farm disclosure.
7. **Identity/search/media acceptance.** Agree estimated date intervals and missing-status dates; existing year/month/day precision is not every arbitrary range. Map each requested filter to a precise stored or derived fact, including scoped trust, reviewed parentage, public health evidence, offspring/results and seven-generation completeness. Define repeated ancestors, withheld nodes and unknowns. Standardize left/right/head/marking images with provenance, consent and review. Similarity suggests review; it must not confirm genetic facts or merge horses.
8. **National reporting and conservation.** Specify public versus authorized research cohorts and a validated population model. Preserve small-cohort privacy, completeness/uncertainty and reproducible metric versions. Do not infer genomic diversity or breeding value from incomplete pedigree or unassessed STR data.

Each item needs an owner, a reviewed schema/contract delta, fixture-based acceptance and the exact source/hosted verification receipt. The four-phase proposal should be accepted against these observable workflows rather than a percentage based on screen count.

## Data acquisition and enrichment

Audit the approved current corpus before collecting more. The public health count is not a completeness report. Use the retained `tools/r147-readonly-data-coverage.sql` on the selected authorized snapshot and `tools/audit-data-coverage.py` on a permitted restored SQLite copy. Preserve the as-of snapshot, database/schema identity, query/source digests, visibility scope and all aggregate sections; a partial run is not a complete report.

Asbdavani currently exposes public racing tables and horse/person performance surfaces; investigate a permitted supported feed or export before building a collector. Sheyhe can supply attributed pedigree/name claims through an agreed export/collection route. FEI describes institution/service-provider web services; access should follow the relevant federation/provider agreement. The UELN page now says its earlier exchange-hub project was abandoned and points to Horselink; do not commission the discontinued hub from an old search snippet. WBFSH/FEI exchange may suit an eligible participating studbook. Actual laboratory/owner/institution feeds remain necessary for authentic identity, permissions, clinical history and sample-linked results.

For every source, record allowed access, fields, storage/display/export/derived uses, imagery rights, attribution, effective dates and withdrawal process. Unresolved redistribution stays disabled. Begin with an agreed representative 100–300-record engineering pilot, not bulk scraping. Preserve raw permitted snapshot/reference, external namespace/ID, retrieval timestamp, digest, parser version, original calendar/unit/precision. Stage normalization separately. Match typed identifiers within issuer namespace first; name-only matches become review candidates. Retain conflicting field claims and parent-edge provenance.

Acceptance must replay the same batch without duplicates, correct an existing source record, reject structural parser drift, resume after interruption, withdraw a source agreement and handle partial acceptance. Measure reviewed linkage accuracy and coverage against explicit denominators; obtain steward acceptance before scaling. Collection cannot create an unperformed genetic test, owner consent, official authority or missing clinical history.

### Primary research references

- RFC 6238 TOTP: https://www.rfc-editor.org/rfc/rfc6238
- Current NIST digital authentication guidance: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP MFA lifecycle/recovery guidance: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- Asbdavani public service: https://asbdavani.app/
- Sheyhe public service: https://sheyhe.com/
- UELN current exchange status: https://www.ueln.net/data-exchanges
- WBFSH/FEI exchange: https://prod.wbfsh.com/fei-wbfsh-data-exchange
- FEI service-provider requirements: https://inside.fei.org/system/files/Jumping%20requirements_v2b.pdf

No authenticated source was accessed, no new real dataset was scraped, and no live/private production changes were made for this implementation pass.
