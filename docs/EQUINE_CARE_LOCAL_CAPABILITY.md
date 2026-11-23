# Private equine care capability

This is a local implementation of private care intake, evidence review and bounded scientific calculations. It does not establish a federation agreement, practitioner accreditation, a laboratory identity, a legally valid medical record service, or official parentage confirmation. No production records or external laboratory service were used to develop or test it.

## Activation

The default is disabled. The authenticated capabilities endpoint remains available and returns the current mode and the caller's horse-specific permissions.

For a local review environment, use `APP_ENV=test`, `development`, `local` or `preview` together with `EQUINE_CARE_MODE=local_review`. A production environment cannot activate local review mode. Production activation requires `EQUINE_CARE_MODE=approved_production` and an `EQUINE_CARE_AGREEMENT_REF` of at least eight characters. That reference records the operator's external approval decision; the software cannot independently establish its validity. Do not set it until institutional agreement, professional assignments, privacy, retention, operational support and clinical governance have been reviewed.

Migrations 0112–0114 are additive. Apply the complete ordered migration chain to a disposable database first. Do not activate the feature against an incomplete schema. Local SQLite tests run all migrations, enforce foreign keys and use real session cookies and CSRF tokens. A separate disposable PostgreSQL 18.4 rehearsal also executed all 116 migrations and actual Worker commands through the production adapter, as described below. Neither rehearsal establishes staging performance, clinical acceptance or a production rollout.

## Permission boundaries

| Action | Required current horse permission |
| --- | --- |
| Read a clinical record, episode, sample, report or private history | `private_health_read` |
| Create or amend clinical/reproductive records | `clinical_write` |
| Register a sample, append custody or submit a lab report | `sample_submit` |
| Accept a report | `evidence_review` and `private_file_export`, with an independent reviewer |
| Reject a pending report | `evidence_review`, with an independent reviewer |
| Withdraw a pending or accepted report | `evidence_review` |
| Read/export a linked veterinary document | Separate media policy; a care link does not grant file access |

An editor or administrator receives no automatic care permission. Professional grant validity, grantee identity, organization membership/role, allowed practitioner kind and current active account are checked by the shared professional-access module. A writer does not automatically acquire read access. Save responses contain only an operation receipt, so clients must not misreport a successful save as failed when a subsequent read is denied.

The reproductive episode belongs to the genetic dam named in the URL. A recipient is a separate clinical subject. Both genetic-dam and recipient clinical scopes are required to write an episode. Amending the recipient also requires the previous recipient's scope. Current read scopes for the recorded recipient are required for display; historical recipients require their current read scopes when history is requested. A public identity reference to a reported sire or offspring never authorizes reading that horse's unrelated care records.

All JSON is private and non-cacheable. Global audit entries contain operation identifiers, resource kind and version, rather than findings, report results or medical reasons. Sensitive snapshots remain in the scoped care history.

## Transaction and identity safeguards

Every write requires a UUID `operation_id` and a meaningful reason. Retry the same intent with the same operation and body. Change the operation UUID when changing the intent. Receipts bind actor, horse, command/target and the complete normalized request digest. An operation reused with different data returns 409. Successful retries do not append another audit or history entry.

Clinical and reproductive amendments and report decisions require the current `expected_version`. A stale writer cannot replace offspring or change a decision. The entity, normalized offspring, immutable history, operation receipt and audit commit in one database batch. Conditional side effects depend on the winning operation marker. A failed statement rolls back the complete batch.

Care operations acquire sorted, separate horse row locks before guarded mutation statements. Reproduction locks the genetic dam, old/new recipients, sire and linked foals. Following statements recheck live subject, session, assignment and evidence conditions. Reproductive participant row versions bind preflight sex/identity validation to the subsequent guard. This ordering serializes covered operations with protected identity merge/archive operations; local PostgreSQL tests exercise actual simultaneous requests and blocked row locks. Production acceptance still requires rehearsal on the intended hosted stack and operational configuration.

Generic merge/reversal/archive must use the protected identity guard. The care helper `careIdentityMergeGuard` blocks either identity when an operational care, reproduction, sample or report reference exists. Generic merges never transfer physical-sample identity, clinical history or private grants. Resolving such a block needs a separately designed, reviewed medical identity-reconciliation procedure. The horse-reference inventory classifies care operation/history references as immutable and operational references as requiring a companion operation.

## Clinical entries

Supported categories are examination, vaccination, diagnosis, procedure, medication, allergy and other. Entries record a title, findings, source reference, optional exact Gregorian observation date, optional private evidence, and optional product/batch/next-due details. Observation dates cannot be in the future. An unknown observation date stays null; the server does not fabricate a day. A next-due date cannot precede an observed event.

Physical event dates cannot be wholly before a known birth interval or wholly after a known death interval. Explicit Gregorian and Solar Hijri dates use their actual day/month/year intervals; an unknown calendar/precision or overlapping interval remains uncertain. No historical bucket year is guessed into a precise lifecycle date. Independently, current deceased status prohibits future planned physical reproductive events even when the death date is unknown; documented compatible stored material remains possible. Clinical writes bind the inspected horse row version after the horse lock, so a concurrent lifecycle correction forces revalidation.

An optional `lifecycle_context` records a `postmortem` examination/diagnosis/procedure/other event or a `record_review` diagnosis/allergy/other entry, with a source evidence reference and justification. These contexts cannot relabel vaccination or medication as permissible postmortem treatment. Postmortem tissue samples and later laboratory report/review dates remain possible; report issuance is not a live-animal procedure. A contradictory historical clinical entry remains voidable with its prior history intact.

Amendments preserve each prior snapshot. Voiding is explicit and terminal for that entry. A corrected replacement can cite its predecessor in its source reference. No feature generates diagnoses, chooses medication or calculates doses. Recorded clinical content is supplied by the assigned professional and remains private.

## Reproductive episodes

Genetic dam and recipient dam occupy different fields. A recipient requires embryo transfer or ICSI. Covering/insemination, transfer and outcome dates have basic chronology checks. A foaled outcome requires an observed outcome date and one or more offspring outcomes. Up to eight offspring can be recorded in one bounded request, with optional registered foal IDs, sex at birth and individual live/stillborn/died-after-birth outcomes. Unregistered offspring remain unlinked; the system does not invent a canonical horse.

The episode never rewrites canonical sire/dam columns. Existing registered foal references are checked for self-parent, recorded-sex contradiction and ancestry-cycle concerns. A recorded gelding may legitimately be a historical sire; current fertility is a separate question. A recipient is never substituted for the genetic dam in pedigree calculations. Current clinical modules do not provide fertility prediction, automated treatment planning or official breeding certificates.

Lifecycle checks follow physical roles. Covering checks the genetic parents; transfer and gestation outcomes check the recipient when one is recorded. A genetic parent's death after conception/transfer does not prohibit later recipient foaling. Explicit `stored_material` entries identify the donor, semen/embryo/oocyte kind, optional exact collection date, evidence reference and justification. Semen requires the recorded sire and an assisted method; embryos/oocytes require the genetic dam and a recipient, with oocytes restricted to ICSI. These exceptions do not excuse a recipient's impossible live-animal dates or permit natural cover after known death. Material cannot be collected after its recorded use; an explicit postmortem recovery is not rejected by an invented elapsed-time rule. Breed/studbook admissibility and comprehensive reproductive/clinical policy integration remain separate work.

## Samples, custody and laboratory reports

Samples capture a sample reference, specimen type, optional observed collection date, documented identity-check category and source. A claimed matched microchip must match the canonical identifier after shared Unicode-digit/identifier normalization; leading zeros are preserved. `not_checked` remains explicit and prevents report acceptance as reviewed identity evidence. Sample facts are immutable. Custody events append with an explicit UTC/offset instant, custodian and source reference; they do not overwrite the collection record. A correction is a new sourced event.

A report must reference a sample for the same horse. It records laboratory and accession references, a report revision, issue date, panel version, assay method and raw typed calls. The issue date cannot precede a known collection date. A correction may reuse the accession with a different `report_revision` and link `supersedes_report_id`. That link does not silently invalidate or replace an accepted result.

The report must link an accessible, same-horse, private veterinary document. The supplied SHA-256 is checked against the bytes actually stored by the media service. Use the stored-byte digest returned by upload; image sanitation can change the original file's bytes. Evidence must remain unquarantined and unrejected. The intake endpoint never fetches an arbitrary external URL.

Reports start pending. An independent reviewer accepts or rejects a pending report. Acceptance requires evidence-review and file-export scopes, an identity-checked sample, an accessible matching evidence document, and explicit identity/authenticity/scope checks plus a review reference. These checks record a local human decision; they do not authenticate an external lab or confer official authority. Pending/accepted results can be withdrawn with a reason, including after evidence quarantine. Corrected or conflicting accepted evidence must be explicitly reconciled; there is no “latest result wins” rule.

Disease/other report calls can be stored and reviewed with provenance, but this module does not automatically copy them into legacy genetic-test tables or assert a disease interpretation. That integration needs an approved assay/variant map and additional acceptance fixtures.

## Scientific scope

### Base pigment

The `mendelian-mc1r-asip-v1` helper accepts only explicit supported MC1R `E/E`, `E/e`, `e/e` and ASIP `A/A`, `A/a`, `a/a` calls for both parents. It enumerates Mendelian transmission and applies recessive epistasis for base chestnut, black and bay probabilities. It does not predict complete visible coat color: gray, cream and other dilution/pattern alleles, additional variants, age and expression are not modeled. Missing tests are not inferred from a coat label, breed, photograph or pedigree.

### STR screening

The `diploid-trio-transmission-v1` helper checks whether each passing child-marker allele pair can receive one allele from the proposed sire and one from the proposed dam. Homozygous children must still be compatible with both parents. Panels and allele nomenclature must match. Duplicate, missing, uncertain or failed calls are not silently imputed.

The local engineering policy uses twelve comparable passing markers before returning a positive compatibility-at-tested-markers statement. This number is not presented as an accredited standard. Incompatible markers are reported for laboratory review; the app does not issue a final exclusion. A compatible trio is not proof that no alternative parent is possible. No probability of parentage is computed, and `official_parentage_confirmed` is always false. Population frequencies, validated panel-specific likelihood models, mutation handling and official laboratory acceptance remain outside this module.

### Reviewed-record analysis

The private analysis endpoints require a current read scope on every participant. They load the complete bounded set of accepted reports for each requested result type. Conflicting reports, incompatible profile sets, unavailable evidence or more than 100 active accepted reports stop inference. They do not select a favorable caller-supplied record or silently discard a conflicting accepted test. Outputs identify the report versions used. Revocation of a caller's read scope stops the next read; withdrawing a sole accepted report or quarantining required evidence stops the next analysis.

## Verification completed locally

- `tests/integration/equineCareR147.test.ts`: real migrations, sessions, dispatcher, permission separation, operation collision/replay, stale amendments, revoke-before-batch, forced rollback, recipient privacy, two offspring, sample/custody, stored-byte hashing, independent report review, corrections, conflicts/quarantine, real STR report analysis and participant state races.
- `tests/integration/derivedHorseVisibilityR147.test.ts`: withheld roots/ancestor IDs/descendants/candidates, parent selector restrictions, historical gelding paternity, racing entry/run-status aggregates and hidden crosswalk rows.
- `tests/unit/equineGeneticScreensR147.test.ts`: independent Mendelian ratios, recessive epistasis, trio allele transmission, homozygosity, missing/QC/panel/duplicate handling.
- Existing pedigree/breeding tests and published numerical reference families remain passing locally. Those fixtures verify finite recorded-pedigree arithmetic; they do not validate real laboratory records or the unprovided production dataset.
- `tests/integration/equineCareLifecycleR147.test.ts`: ten actual-route cases cover birth/death boundaries, Solar Hijri/unknown/partial dates, sourced postmortem and record-review contexts, tissue samples, voiding historical errors, reproductive roles, stored material and a lifecycle update after preflight. The focused care/visibility/science bundle passed 30/30 tests after this change.
- `tools/test-r147-postgres.mjs`: twelve substantial checks passed on a newly created loopback PostgreSQL 18.4 cluster and random owned schema. All 116 migrations ran through the production translator; three SQLite-only FTS declarations were intentionally skipped by the established PostgreSQL mapping. Actual Worker routes used the production adapter and real sessions. Tests cover private scopes, simultaneous identical operations, competing clinical/metadata revisions, transaction rollback, reproduction/offspring, typed lifecycle/stored material, clinical and participant drift after real lock waits, private bytea report evidence, reviewed color/STR analysis, registration/evidence counters, and archive versus a new offspring reference. The observed identity race admitted care and refused archive; the fixture does not claim exhaustive race-order coverage. The schema was dropped and the disposable server stopped after verification.

The PostgreSQL rehearsal accepts only an explicit private receipt from an owned local test cluster via `--cluster-state`; it never reads an environment database URL. Its JSON report records each check and cleanup. The verification used fictional data and does not cover hosted Supabase/Hyperdrive behavior, load, clinical/laboratory authority or real-data completeness.

## External and product acceptance still needed

Institutional agreements and named clinical governance; practitioner/laboratory onboarding and verified authority; real sample chain-of-identity validation; consent/retention/access reviews; corrected or duplicate-identity care reconciliation; migration and concurrency acceptance on the intended hosted database/runtime; representative private-file and report volumes; bilingual professional acceptance; comprehensive coat genetics and panel-specific statistical parentage if commissioned. Keep the production capability off until the corresponding gates have evidence.
