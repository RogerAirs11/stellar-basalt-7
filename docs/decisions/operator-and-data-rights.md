# Operator, rights and product boundaries (T01 — DRAFT, owner decisions pending)

Status: **DRAFT — operating defaults below are in force until the owner
records different decisions.** Master-Ai plan gate G0. Nothing here grants
authority the operator does not actually hold.

## Operating defaults in force now

1. **Independent private operator.** This registry is run by an independent
   private operator with NO federation affiliation, NO issuing powers and NO
   claimed studbook authority. No official logos, federation copy or
   affiliation APIs are enabled. Any `federation` provenance claim supplied
   by an API caller is rejected/overwritten (R80 interim guard; full issuer
   model arrives with T05/T06).
2. **No fabricated verification.** Caller-supplied "verified" flags are
   ignored on ordinary create endpoints; verification must come from a
   reviewed flow, not a self-declared boolean. UI copy says "verified",
   never "federation-verified".
3. **Privacy defaults are least-exposure.** Lab accession numbers, lab
   documents, private notes, editorial interpretation text and unpublished
   (unverified) tests are private by default (R80/T03 projection). Exact
   stable location, phone numbers and ownership evidence stay out of public
   DTOs.
4. **Unknown ≠ negative ≠ free.** Genetic results without a validated
   assay-specific rule keep their original laboratory text and a
   `recorded_uninterpreted` status (R80/T04). Sparse pedigrees get an honest
   `insufficient_ancestry` notice, never a positive "outcross" label (R80/T26).

## source_imports dataset inventory (to be completed by the data steward)

| Dataset | Owner / rights holder | License/consent evidence | Publishable fields | Update rights | Revocation contact | Last verified |
|---|---|---|---|---|---|---|
| Legacy import (horses/pedigree) | **UNKNOWN — quarantined-by-default posture** | none recorded | structural pedigree facts only, as currently published | none (read-only source) | TBD | never |
| Demo fixtures | this project | n/a (synthetic) | all (labeled demo) | n/a | n/a | n/a |

Until rights are recorded, no NEW imported dataset may be published, and the
existing legacy import remains published only in its current, already-public
structural form. Unknown-rights data is quarantined, not re-exported.

## Decisions only the owner can make (open)

1. Confirm or reject the independent-operator default (item 1 above).
2. Identify the rights holder and license terms for the legacy import;
   decide keep-public / restrict / remove.
3. Approve the publishable-field inventory (which fields are public on a
   horse profile; current default = the R80 projection allowlist).
4. Choose the single production frontend (currently Heritage/Core is the
   reference theme; others are experiments) and the canonical database mode
   (Supabase Postgres primary + D1/Turso failover as built).
5. Approve privacy defaults, review responsibility and launch gates for the
   commercial layer (see commercial-scope.md).

## Consequences

With these defaults, the registry truthfully presents itself as a
private-record-keeping and pedigree-analysis service. It does not claim
official status, federation authority or laboratory affiliation anywhere in
its UI, API or certificates (certificate terminology change is T06, next
batch).
