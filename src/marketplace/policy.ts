import { HttpError } from "../api/http";
import { isExpiredTimestamp } from "../security/timestamps";

import { LISTING_TRANSITIONS, INQUIRY_TRANSITIONS, type ListingStatus, type InquiryStatus } from "../shared/marketplacePolicy";
export { LISTING_STATUSES, LISTING_TRANSITIONS, INQUIRY_STATUSES, type ListingStatus, type InquiryStatus } from "../shared/marketplacePolicy";

/** Terminal sales cannot silently be resurrected; relisting starts a new review cycle. */
export function assertListingTransition(current: string, next: ListingStatus, expiresAt?: string | null, now = Date.now()): void {
  const allowed = Object.hasOwn(LISTING_TRANSITIONS, current) ? LISTING_TRANSITIONS[current as ListingStatus] : undefined;
  if (!allowed || (current !== next && !allowed.includes(next))) {
    throw new HttpError(409, "invalid_listing_transition", "This listing cannot move to the requested status", { current, requested: next, allowed: allowed ?? [] });
  }
  if ((next === "active" || next === "pending_sale") && isExpiredTimestamp(expiresAt, now)) {
    throw new HttpError(409, "listing_expired", "An expired listing must be renewed before publication");
  }
}

export function isActiveListingConflict(cause: unknown): boolean {
  const error = cause as { message?: string; constraint?: string; cause?: { message?: string; constraint?: string } } | null;
  const message = [error?.message, error?.constraint, error?.cause?.message, error?.cause?.constraint].filter(Boolean).join(" ");
  return /uq_sales_listings_active_horse/i.test(message) || /UNIQUE constraint failed:\s*sales_listings\.horse_id/i.test(message);
}

export function assertInquiryTransition(current: string, next: InquiryStatus): void {
  const allowed: Readonly<Record<string, readonly string[]>> = INQUIRY_TRANSITIONS;
  if (!Object.hasOwn(allowed, current) || !allowed[current] || (current !== next && !allowed[current].includes(next))) {
    throw new HttpError(409, "invalid_inquiry_transition", "This inquiry cannot move to the requested status");
  }
}
