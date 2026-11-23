import { timestampMillis } from "../security/timestamps";

// Master-Ai plan T05: the verification vocabulary. These four levels are
// DISTINCT concepts; conflating them is how a platform review ended up
// masquerading as an external authority badge (finding F03). None of the
// levels is a universal horse-quality guarantee — the limitations text must
// travel with every public display of a level.

export type VerificationLevel =
  | "owner_declared"
  | "imported_unverified"
  | "platform_reviewed"
  | "issuer_attested";

export interface VerificationLevelMeta {
  rank: number;
  isAuthorityClaim: boolean;
  en: string;
  fa: string;
}

export const VERIFICATION_LEVELS: Record<VerificationLevel, VerificationLevelMeta> = {
  owner_declared: {
    rank: 1,
    isAuthorityClaim: false,
    en: "Owner-declared — stated by the horse's owner or an importer on their behalf; not independently checked.",
    fa: "اظهار مالک — توسط مالک اسب یا به نمایندگی از او ثبت شده و به‌طور مستقل بررسی نشده است.",
  },
  imported_unverified: {
    rank: 2,
    isAuthorityClaim: false,
    en: "Imported from a legacy system — carried over during migration; not re-verified by this registry.",
    fa: "داده مهاجرت‌یافته — از سامانه قبلی انتقال یافته و توسط این سامانه مجدداً راستی‌آزمایی نشده است.",
  },
  platform_reviewed: {
    rank: 3,
    isAuthorityClaim: false,
    en: "Reviewed by platform staff for completeness and consistency. A platform review is editorial, NOT an attestation by an external issuer.",
    fa: "بررسی‌شده توسط کارشناسان سامانه از نظر کامل بودن و سازگاری. بررسی سامانه یک بررسی تحریریه است، نه تأیید یک مرجع بیرونی.",
  },
  issuer_attested: {
    rank: 4,
    isAuthorityClaim: false,
    en: "Attested by a member of the named issuer within the attestation's scope and validity dates. Scope and limitations are shown with the record.",
    fa: "تأییدشده توسط عضو مرجع مشخص‌شده، در محدوده و بازه اعتبار اعلام‌شده. محدوده و محدودیت‌ها همراه رکورد نمایش داده می‌شود.",
  },
};

/**
 * Legacy storage vocabulary mapping: horse_media.verification stores
 * 'federation_verified' as a CHECK-constrained token, but no external
 * federation integration has ever existed — every such value was set by
 * platform staff review. The honest public name is platform_reviewed.
 */
export const LEGACY_MEDIA_VERIFIED_TOKEN = "federation_verified";

export function mediaVerificationToLevel(verification: string | null | undefined): VerificationLevel {
  if (verification === LEGACY_MEDIA_VERIFIED_TOKEN) return "platform_reviewed";
  return "owner_declared";
}

/**
 * Resolve the verification level of a record from DATABASE state only.
 * Caller-supplied flags never participate (see stripCallerAuthority).
 */
export function resolveVerificationLevel(input: {
  platformVerified: boolean;
  provenance: string | null | undefined;
  activeIssuerAttestations: number;
}): VerificationLevel {
  if (input.activeIssuerAttestations > 0) return "issuer_attested";
  if (input.platformVerified) return "platform_reviewed";
  if (input.provenance === "demo" || input.provenance === "import") return "imported_unverified";
  return "owner_declared";
}

// ---------------------------------------------------------------------------
// Issuer membership validity (pure date logic over stored rows).

export interface MembershipRow {
  issuer_id: string;
  user_id: string;
  role: string;
  status: string;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
}

export type MembershipValidity = "active" | "revoked" | "expired" | "not_yet_valid" | "invalid";

export function membershipValidity(
  membership: MembershipRow | null | undefined,
  now: Date = new Date(),
): MembershipValidity {
  if (!membership) return "revoked"; // no membership at all is handled by callers as forbidden
  if (membership.status !== "active" || membership.revoked_at) return "revoked";
  const nowMs = now.getTime();
  const start = timestampMillis(membership.valid_from);
  const end = membership.valid_until === null ? null : timestampMillis(membership.valid_until);
  if (!Number.isFinite(nowMs) || start === null || (membership.valid_until !== null && end === null)
    || (end !== null && end <= start)) return "invalid";
  if (start > nowMs) return "not_yet_valid";
  if (end !== null && end <= nowMs) return "expired";
  return "active";
}

export type AttestationDenyReason =
  | "no_membership"
  | "issuer_inactive"
  | "membership_invalid"
  | "issuer_suspended"
  | "issuer_retired"
  | "membership_revoked"
  | "membership_expired"
  | "membership_not_yet_valid"
  | "membership_issuer_mismatch"
  | "insufficient_role";

export interface AttestationCheck {
  ok: boolean;
  reason?: AttestationDenyReason;
}

/**
 * Can this actor attest under the given issuer right now? A platform role
 * alone NEVER grants attestation power — only a valid issuer membership does
 * (plan T05 step 4: platform staff can review, not impersonate an issuer).
 */
export function canAttest(input: {
  issuerId: string;
  issuerStatus: string;
  membership: MembershipRow | null;
  now?: Date;
}): AttestationCheck {
  if (input.issuerStatus === "suspended") return { ok: false, reason: "issuer_suspended" };
  if (input.issuerStatus === "retired") return { ok: false, reason: "issuer_retired" };
  if (input.issuerStatus !== "active") return { ok: false, reason: "issuer_inactive" };
  if (!input.membership) return { ok: false, reason: "no_membership" };
  if (input.membership.issuer_id !== input.issuerId) return { ok: false, reason: "membership_issuer_mismatch" };
  if (!["owner", "attester"].includes(input.membership.role)) return { ok: false, reason: "insufficient_role" };
  const validity = membershipValidity(input.membership, input.now);
  if (validity !== "active") return { ok: false, reason: `membership_${validity}` as AttestationDenyReason };
  return { ok: true };
}

/**
 * Plan T05 step 5: prevent self-review for protected evidence. The person who
 * uploaded a media item can never be the one who attests it, even if they
 * legitimately hold an issuer membership.
 */
export function isSelfReview(input: {
  attesterUserId: string;
  evidenceUploaderId: string | null | undefined;
}): boolean {
  return Boolean(input.evidenceUploaderId && input.evidenceUploaderId === input.attesterUserId);
}

// ---------------------------------------------------------------------------
// Caller-authority stripping (formalizes the R80 interim F03 guard).

export interface AuthorityStripped {
  verified: 0;
  provenance: "user" | "demo";
}

/**
 * Ordinary create endpoints accept data, not authority. Any caller-supplied
 * verification flag or federation provenance is discarded: verification is
 * derived from platform review and issuer attestations, never self-declared.
 */
export function stripCallerAuthority(provenance: string | null | undefined): AuthorityStripped {
  return { verified: 0, provenance: provenance === "demo" ? "demo" : "user" };
}
