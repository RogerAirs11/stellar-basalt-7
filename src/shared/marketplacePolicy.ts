/** Shared serializable marketplace vocabulary. The backend STILL owns
 * authorization, expiry, concurrency and every write. Frontends only use
 * these constants to describe permitted attempts; they cannot authorize them. */
export const LISTING_STATUSES = ["draft", "active", "pending_sale", "sold", "withdrawn", "expired"] as const;
export type ListingStatus = typeof LISTING_STATUSES[number];
export const LISTING_TRANSITIONS: Readonly<Record<ListingStatus, readonly ListingStatus[]>> = Object.freeze({
  draft: Object.freeze(["active", "withdrawn"] as const),
  active: Object.freeze(["pending_sale", "sold", "withdrawn", "expired"] as const),
  pending_sale: Object.freeze(["active", "sold", "withdrawn", "expired"] as const),
  sold: Object.freeze([]),
  withdrawn: Object.freeze(["draft"] as const),
  expired: Object.freeze(["draft"] as const),
});

export const INQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type InquiryStatus = typeof INQUIRY_STATUSES[number];
export const INQUIRY_TRANSITIONS: Readonly<Record<InquiryStatus, readonly InquiryStatus[]>> = Object.freeze({
  new: Object.freeze(["contacted", "closed"] as const),
  contacted: Object.freeze(["closed"] as const),
  closed: Object.freeze([]),
});

export const MARKETPLACE_DISCLOSURE = Object.freeze({
  role: "introduction_only" as const,
  en: "This platform introduces buyers to sellers. It does not escrow payments, inspect horses, verify veterinary condition or guarantee any transaction. Buyers and sellers perform their own due diligence.",
  fa: "این پلتفرم فقط خریداران را به فروشندگان معرفی می‌کند. هیچ پرداخت امانی نمی‌گیرد، اسب را معاینه نمی‌کند و هیچ معامله‌ای را تضمین نمی‌کند. بررسی دقیق بر عهده طرفین است.",
});
