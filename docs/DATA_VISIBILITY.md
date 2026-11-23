# Horse DB Data Visibility Policy

This is a security boundary, not a CSS decision. A field hidden visually but returned by a public API is exposed.

## Public Registry/horse data

The public `HorseRecord` contract includes registry identity/display fields and supported descriptive metadata needed for browsing, pedigree and analytics, including names, registration, birth/breed/sex/color/strain descriptors, parent links/display names, public registry-role names, lifecycle/registry flags, safe import/export registry descriptors and public DNA/status descriptors approved by the current contract.

The exact allowlist is defined by typed DTO/server projection, not `SELECT *`.

## Staff/curation-only data

Sensitive/internal source fields remain privileged, including raw source JSON and source-specific identifiers/notes that have not been approved for public exposure (for example microchip, file/lab numbers, unrestricted descriptions/notes and other curation-only source detail).

Detailed internal quality issue records are staff workflow data; public surfaces use aggregate/approved quality semantics.

## Search

The server may use normalized/private index material for ranking, but internal normalized corpus/search documents are not returned to the browser.

## Source sentinels

Placeholder artifacts such as repeated dashes, `NULL`, `N/A` and equivalent source sentinels remain preserved in canonical/source provenance where necessary but are normalized away at public presentation/facet boundaries; they must not appear as legitimate registry values.

## Rule for new fields

Before adding a field to a public DTO define: provenance, semantic meaning, privacy/visibility, search behavior, mutation authority, and frontend presentation requirements. Prefer withholding uncertain fields to accidental publication.
