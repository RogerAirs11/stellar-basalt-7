# Issuer authority, scopes and review responsibilities (R98-N04/N05)

This document defines who may register an issuer, what documentary evidence
establishes its authority, how structured scopes make attestation rights
enforceable, and how the three review responsibilities are kept distinct. It
is the normative reference for the trust boundary implemented in
`src/trust/scopes.ts`, `src/trust/attestationStore.ts` and
`src/trust/snapshotSerializer.ts` (migration 0073).

## 1. Who may register an issuer

Only platform content managers (`content.manage`) may register an issuer, and
every registration MUST record its documentary evidence
(`issuers.registration_evidence`, minimum substance enforced by the API) along
with the reviewer identity and review timestamp. The creating manager attests
that they have seen and archived this evidence.

Accepted classes of documentary evidence:

- an official letter, board resolution or license issued by the authority;
- a verifiable entry in an external registry (federation, laboratory
  accreditation body, government authority) identifying the organization;
- a signed agreement with the platform operator naming the authorized scope.

What NEVER establishes delegated authority on its own:

- a federation title written in a profile or biography (free text);
- an editorial platform role (editors review content, they do not delegate
  external authority);
- a paid subscription or entitlement (money buys workspace capability, never
  issuer powers);
- an issuer membership in a DIFFERENT issuer.

Legacy issuers registered before this policy carry `registration_evidence IS
NULL` and REQUIRE platform review before any scope may be approved for them;
the scope-approval command refuses with `issuer_evidence_required` (422) until
the evidence is recorded.

## 2. Structured scopes as enforceable access rules

Free-text scope strings on attestations are declarative metadata only. What a
member of an issuer may attest is governed by `issuer_scopes` rows:

- one live scope per (issuer, record kind) — `approved` or `suspended`
  (partial unique index `issuer_one_live_scope`);
- explicit permitted actions in `issuer_scope_actions` — `attest` and/or
  `supersede`; a scope row alone never implies supersession rights;
- versioned approval — approving a new version supersedes the previous live
  row (`status='superseded'`, `superseded_by` chain) without deleting it;
- effective intervals — `valid_from` / `valid_until`, validated at write time
  and re-evaluated by SQL at commit time (`datetime()` comparisons, the same
  discipline as membership validity);
- suspension — `suspended` keeps visible history while blocking commands for
  that kind; `resume` restores it; `revoke` is permanent for that version.

Scope approval is a PLATFORM responsibility (content managers only). The
issuer's own owner manages memberships but cannot approve the issuer's own
authority — that would be self-delegation.

Issuance commands check BOTH the current membership AND the current approved
scope inside the same conditional INSERT (`ACTIVE_ISSUER_SCOPE_SQL`), so a
revoked membership, a suspended scope, an expired interval or a mid-flight
scope change each produce zero rows — never a partially authorized document.

## 3. The three review responsibilities

| Responsibility | Held by | Powers | Explicitly cannot |
|---|---|---|---|
| Attester | an issuer member (`attester`/`owner` role) with an approved scope for the record kind | issue attestations within the scope's record kind and interval; self-review of own uploads is blocked | supersede without the `supersede` action; approve scopes; review their own evidence |
| Issuer manager | the issuer's active owner membership | grant/revoke memberships under that issuer; supersede/revoke its attestations; read full private snapshots | approve the issuer's own scopes; attain authority without a membership |
| Platform reviewer | platform staff with `content.manage` | register issuers with evidence; approve/suspend/revoke scopes; suspend/retire issuers; read full private snapshots; operate the trust queue | mint an attestation (no membership = no issuance, ever); use a paid plan as authority |

## 4. Operator queue and trust labels

`GET /api/admin/trust/queue` (content managers) surfaces expiring
memberships (30-day window), malformed intervals, suspended issuers and
scopes, and unevidenced legacy issuers — reason codes and non-private
identifiers only; contact data and evidence notes never appear.

`GET /api/trust/labels` (public) explains the four verification levels
(owner-declared, imported-unverified, platform-reviewed, issuer-attested) in
plain language (English and Farsi), states that issuer metadata does not
certify every field on a horse profile, and distinguishes Registry
Information Extracts from official certificates or passports.

## 5. Immutable evidence snapshots (R98-N05)

Every issuance derives its evidence snapshot SERVER-SIDE through a fixed
per-record-kind column allowlist (private free-text excluded everywhere:
hashing private text is not anonymization). The attestation and its snapshot
are written in one consistency boundary; every allowlisted column of the
target and evidence rows is re-verified inside the INSERT, so a source change
between read and commit refuses the issuance. The stored
`attestations.source_version` is always the server-derived
`snap:<schema>:<digest16>` marker; caller-supplied versions are accepted for
compatibility and ignored.

Public verification (`GET /api/attestations/:id/verify`) exposes only the
digest, per-row version markers and lifecycle state
(`current` / `source_changed` / `superseded` / `revoked` /
`snapshot_tampered` / `unbound_legacy` / issuer and expiry states). The
canonical bytes remain private; the full snapshot is reviewable only by
platform content managers and the issuer's active owner.

Legacy attestations issued before snapshots exist are preserved as unbound
historical records (`unbound_legacy`) requiring review — no digest is ever
backfilled or fabricated for them.
