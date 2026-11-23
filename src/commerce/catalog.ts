/**
 * R88 agent plan P19 — the first paid offers, with public trust protected.
 *
 * THE FREE FOREVER FLOOR (never sold, never degraded):
 *   - basic horse identity (public profile, pedigree, results),
 *   - correction submission,
 *   - safety/provenance information where licensed for publication.
 * A paid plan NEVER buys: official approval, federation authority,
 * biological truth, suppression of adverse evidence, or access to another
 * owner's private resources.
 *
 * The three pilot offers (prices live in billing_prices; these are the
 * capability mappings and honest boundaries):
 *   1. farm_workspace_monthly — more than the free single workspace.
 *   2. professional_tools_monthly — provider response-tool conveniences
 *      (response-time statistics on the directory profile).
 *   3. sponsored_visibility_monthly — clearly-labeled featured placement in
 *      the marketplace list. NEVER in scientific breeding rankings, pedigree
 *      quality metrics or credential authenticity (those surfaces do not
 *   read placement data at all).
 */

/** The pilot offer skus (must exist as billing_prices rows to be purchasable). */
export const PILOT_OFFERS = [
  {
    sku: "farm_workspace_monthly",
    capability: "workspace_collections",
    name_en: "Farm workspace",
    name_fa: "فضای کار مزرعه",
    free_tier_en: "One private workspace collection is free forever.",
    free_tier_fa: "یک مجموعه کاری خصوصی برای همیشه رایگان است.",
    paid_en: "Additional workspace collections and delegated staff work.",
    paid_fa: "مجموعه‌های کاری بیشتر و واگذاری کار به کارکنان.",
  },
  {
    sku: "professional_tools_monthly",
    capability: "professional_response_tools",
    name_en: "Professional response tools",
    name_fa: "ابزارهای پاسخ حرفه‌ای",
    free_tier_en: "Receiving and answering service requests is free forever.",
    free_tier_fa: "دریافت و پاسخ به درخواست‌های خدمت برای همیشه رایگان است.",
    paid_en: "Response-time statistics surfaced on your published directory profile.",
    paid_fa: "نمایش آمار زمان پاسخ‌دهی در نمایه منتشرشده شما.",
  },
  {
    sku: "sponsored_visibility_monthly",
    capability: "sponsored_listing_placement",
    name_en: "Sponsored visibility",
    name_fa: "دیدمان تبلیغاتی",
    free_tier_en: "Ordinary listing placement is free and unranked.",
    free_tier_fa: "درج معمولی آگهی رایگان و بدون رتبه‌بندی است.",
    paid_en: "A clearly labeled Sponsored badge and top-of-list placement in the marketplace only.",
    paid_fa: "نشان مشخص «تبلیغ» و قرارگیری در ابتدای فهرست بازارچه.",
  },
] as const;

export type PilotSku = (typeof PILOT_OFFERS)[number]["sku"];

/** The free workspace tier: everyone gets one, forever. */
export const FREE_WORKSPACE_LIMIT = 1;

/** Bilingual sponsored labels — every sponsored surface must carry them. */
export const SPONSORED_LABELS = { en: "Sponsored", fa: "تبلیغ" } as const;

/** The standing trust note attached to every offer surface. */
export const OFFER_TRUST_NOTE =
  "Payment buys conveniences only. Basic horse identity, correction submission and published safety/provenance information stay free. A paid plan never confers official status, biological truth, or the ability to suppress adverse evidence, and never grants access to another owner's private resources.";
