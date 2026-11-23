# Professional interface and private workflows

## Selecting the optional interface

Use the existing **Interface / UI** selector and choose **Professional** (فارسی: **حرفه‌ای**). The same selector can restore **Heritage Registry** or select any existing compatible interface. Within Heritage, changing presentation preserves the current route and mounted workflow. The new presentation reuses the existing platform client, authorization, canonical navigation and registry features.

When Heritage is the active interface, `/?presentation=professional` selects the presentation on page load. The saved preference contains only the presentation choice. It does not contain horse records or private drafts.

The new header exposes the common tasks directly and the complete canonical navigation through **All sections**. Search results come from the connected registry. Counts describe the connected dataset; synthetic and empty datasets are labeled explicitly. No invented horse records or illustrative identity photos are part of this interface.

Persian/RTL and English/LTR have been exercised in real Chromium at 1440px desktop and 390px mobile widths. The original other interface choices remain available. This local check does not substitute for broader accessibility and device acceptance.

## Registering a horse

The existing four-step route remains `/f/heritage/desk/submit`:

1. **Identity:** names and previous names, registered identifiers, passport and issuer, typed dates, place, breed/sex/appearance, height/markings and lifecycle. A deceased horse can have a typed death date; an unknown date remains blank. Year-only or month-only dates retain that precision and the selected Gregorian or Solar Hijri calendar.
2. **Parents:** select a real registry record or record an unresolved source assertion. An unresolved name never creates a canonical parent automatically.
3. **People & evidence:** search real people without leaving the form, keep public profile text separate from private reviewer notes, and attach private evidence to a saved request.
4. **Review:** check the actual submitted values, save a draft or send the request for review.

Persian and Arabic-Indic digits are normalized before validation. A server draft is the durable copy: save before refreshing or signing out. Unsaved contents live only in memory for the current account and browser tab, survive normal in-app navigation, and are cleared on reload/signout/account change. An old unscoped session-storage draft is discarded rather than attributed to an unknown account.

The first save creates a draft before the final submission or any upload. Ambiguous create/upload responses retain their operation identity for recovery. Evidence files are private and request-bound, and their presence does not establish verification or official certification. Pending requests expose readable evidence but no attachment edit controls.

## Private care

Open a horse profile and choose **Private care**. The institution must have configured the service and assigned the specific current permission for that horse. Anonymous, disabled, unauthorized and failed-loading states are distinct. The interface never activates the feature or grants itself permission.

The four sections use the actual `platform.care` service:

| Section | Available workflow |
| --- | --- |
| Clinical | Record observations; preserve source, product/batch and optional dates/evidence; amend with version and reason; void without deleting history. |
| Reproduction | Keep genetic dam and recipient separate; record method/dates/outcome and each foal; amend with version and reason without changing canonical parentage. |
| Samples & custody | Document collection and identity evidence; append dated custody events with an explicit timezone; inspect the retained chain. |
| Laboratory reports | Attach a private source document, transcribe typed calls and panel/method/version, submit for independent review, and record explicit acceptance/rejection/withdrawal decisions. |

A write permission does not grant read access. The interface accepts a successful operation receipt even if the writer cannot read the list afterward. Account, horse or permission changes clear private snapshots. An ambiguous command freezes its body and operation UUID for an identical retry.

Clinical create and amendment forms distinguish an ordinary event from a sourced postmortem examination/procedure or review of existing records. An exception requires its own reference and professional explanation. Vaccination and medication cannot use either exception. The original context is shown in private record details and preserved on amendment unless the professional explicitly changes it.

Reproductive records can include up to three documented stored-material entries. Each identifies its donor, semen/embryo/oocyte type, optional exact collection date, source and professional explanation. The form binds semen to the selected sire and an assisted method; embryos to the genetic dam, recipient and transfer/ICSI; and oocytes to the genetic dam, recipient and ICSI. Unknown dates remain unknown. These are attributed statements, not certificates or changes to parentage, and the service still enforces date, lifecycle and authorization rules. Changing the method does not silently discard or reassign existing material.

The laboratory report uses the digest returned for the **stored, sanitized document bytes**. It never substitutes a browser checksum of the original file. Acceptance requires a different reviewer, appropriate file access, documented sample identity and three explicit review checks. It is internal evidence review, not laboratory accreditation or official registry/parentage certification.

The source includes bounded scientific analysis endpoints described in [EQUINE_CARE_LOCAL_CAPABILITY.md](EQUINE_CARE_LOCAL_CAPABILITY.md). Their existence is not a claim of a complete clinical or breeding planning interface, and the care feature remains disabled until institutional configuration is supplied.

## Supplementary information

Public, versioned supplementary facts appear in the normal Record workspace. Registry administrators can curate definitions and existing-horse values from the Registry Desk. Core identity and clinical/genetic records keep their dedicated schemas and authorization. The supplementary editor is not a replacement for the registration form or laboratory workflow.

## Staff record curation

The Heritage/Professional admin console and Equidata governance console use one complete typed create/edit form. It covers the 35 backend-editable fields: current/birth/previous names, registration identifiers and issuing authorities, parents and strains, appearance and measurements, lifecycle, five typed dates, places and private staff information. Parent lookup searches actual registry records. Names are sent as an array, height as a number, and dates retain their explicit calendar and year/month/day precision.

An edit sends only changed fields with the loaded row version. Opening a legacy record does not rewrite its untouched identifiers or invent absent date metadata. Clearing an existing date sends an explicit null; reversing a recorded death requires the reviewed lifecycle-correction workflow. A stale-version response retains the draft for reconciliation. Draft contents are local component state scoped to the account and loaded record.

The shared public profile map includes birth/previous names, height, markings and life status already permitted by the server's public projection. Passport numbers/issuers, issue/expiry date details, foreign registration and precise addresses appear in the separate privileged staff ledger. The curation form does not grant publication authority.

Local acceptance includes ten focused curation tests and a sixteen-check real Chromium proof against the guarded synthetic database: canonical create, row-versioned changed-only update, persisted arrays/numbers/partial dates, both consoles and verified English desktop/Persian mobile views. Production acceptance still requires the institution's staging data and authorizations.

The same four curation views received a final contrast check for field values, labels, help text and placeholders. Equidata's dark governance surface now gives the shared fields explicit dark backgrounds and readable foreground colors; Heritage help text uses full opacity. The minimum measured ratio across those categories was 5.54:1. This bounded check uses computed solid background colors and does not replace broader theme, device or accessibility acceptance.

When a legacy breeding response masks an unavailable parent or foal, the Heritage and Retro displays show an unavailable label without a fabricated record link or stale linked name. Four focused DOM regressions cover null/omitted IDs and preserve valid public navigation.

## Verification and release boundaries

The focused interaction suite covers registration/draft recovery, competition request races, private uploads, care permission boundaries, review/retry/version behavior, supplementary metadata scope changes and Professional navigation/search. The implementation handoff includes real Chromium screenshots and a real-HTTP synthetic draft/reload proof.

The source export does not include all original binary artwork. The existing source-preview mode is local-only and visibly labeled. Normal production asset checks remain in place; restore the authorized original assets for a production release. Clinical/institutional agreements, assigned practitioners, authorized data, staging deployment, backups/restore and user acceptance remain separate release gates.
