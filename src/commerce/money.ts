/**
 * R88 agent plan P17 — unambiguous money for billing.
 *
 * ONE documented internal unit: IRR (Iranian rial), stored as safe integer
 * minor units (the rial has no practical subdivision; 1 minor unit = 1 rial).
 * Toman is a DISPLAY/boundary convenience ONLY: 1 toman = 10 rial. Every
 * amount crossing a boundary carries its currency explicitly — a numeric
 * size never implies a unit.
 *
 * The acceptance pinned by tests: a 1,900,000-TOMAN plan is stored and
 * charged as 19,000,000 IRR. It can never become 1,900,000 rial.
 */

/** The one internal currency. Every stored billing amount uses this. */
export const INTERNAL_CURRENCY = "IRR" as const;

/** 1 toman = 10 rial (fixed, documented). */
export const TOMAN_IN_RIAL = 10;

export interface Money {
  /** Minor units of `currency` (for IRR: rials). Always a safe integer. */
  minor: number;
  currency: typeof INTERNAL_CURRENCY;
}

export function money(minor: number): Money {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError("money requires a non-negative safe integer minor amount");
  }
  return { minor, currency: INTERNAL_CURRENCY };
}

/** Convert a toman amount (integer) to internal minor IRR. Display boundary ONLY. */
export function tomanToIrr(toman: number): Money {
  if (!Number.isSafeInteger(toman) || toman < 0) {
    throw new RangeError("toman amount must be a non-negative safe integer");
  }
  return money(toman * TOMAN_IN_RIAL);
}

/** Convert internal minor IRR to a toman display value (integer rials / 10). */
export function irrToToman(amount: Money): number {
  assertInternalCurrency(amount);
  if (amount.minor % TOMAN_IN_RIAL !== 0) {
    throw new RangeError("sub-toman rial amounts cannot be displayed in whole toman");
  }
  return amount.minor / TOMAN_IN_RIAL;
}

/** Explicit-currency guard: comparing or combining mixed currencies is a bug. */
export function assertInternalCurrency(amount: { currency: string }): void {
  if (amount.currency !== INTERNAL_CURRENCY) {
    throw new RangeError(`expected ${INTERNAL_CURRENCY}, got ${amount.currency} — currency must never be inferred or mixed`);
  }
}

/** Add two internal-currency amounts. */
export function addMoney(a: Money, b: Money): Money {
  assertInternalCurrency(a);
  assertInternalCurrency(b);
  return money(a.minor + b.minor);
}

/** Multiply an amount by a quantity (bounded by the caller). */
export function multiplyMoney(amount: Money, quantity: number): Money {
  assertInternalCurrency(amount);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError("quantity must be a non-negative safe integer");
  }
  return money(amount.minor * quantity);
}

/**
 * Parse a human-entered toman price into internal minor IRR. Used ONLY at
 * admin catalog boundaries; rejects fractions (no half-toman prices).
 */
export function parseTomanInput(input: string | number): Money {
  const text = String(input).trim().replace(/[,،\s]/g, "");
  if (!/^\d{1,12}$/.test(text)) {
    throw new RangeError("toman price must be 1-12 digits (whole toman)");
  }
  return tomanToIrr(Number(text));
}

/** Bilingual display string: toman for humans, IRR never hidden. */
export function formatToman(amount: Money): { en: string; fa: string; toman: number; irr: number } {
  const toman = irrToToman(amount);
  return {
    en: `${toman.toLocaleString("en-US")} toman`,
    fa: `${toman.toLocaleString("fa-IR")} تومان`,
    toman,
    irr: amount.minor,
  };
}

/**
 * The explicit order status machine (P17): pending -> awaiting_payment ->
 * paid; pending/awaiting_payment -> cancelled; paid -> refunded /
 * partially_refunded (via recorded compensating events only). No transition
 * skips states, and paid is never re-entered.
 */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["refunded", "partially_refunded"],
  cancelled: [],
  refunded: [],
  partially_refunded: [],
};

export function isOrderTransition(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}
