# Commercial scope (T01 — DRAFT, owner decisions pending)

Status: **DRAFT — nothing purchasable exists yet, by design.** Master-Ai plan
gate G0/G2/T21-T24. Business-model numbers in the packet
(`BUSINESS_MODEL.json`) are explicitly hypotheses, not client contracts.

## In force now

1. **No commercial features are enabled.** No pricing page, no payment
   provider, no subscription tiers, no paywalled analytics. All current
   features are free informational/analysis tools.
2. **Payment never grants authority.** When payments arrive (T21/T22), a
   purchase will never change a verification badge, add an issuer stamp, or
   override a failed check. Entitlements gate tool access only.
3. **Integer money.** Any future billing records amounts in integer minor
   units (Rial/Toman have no fractional unit in practice) with server-side
   idempotent verification. No floating-point currency.
4. **Honest public copy.** Public pages may not imply guaranteed leads,
   guaranteed profit, or official status. The packet's page spec
   (`05_BUSINESS_MODEL_PAGE_SPEC.md`) is the reference for the future
   pricing/trust pages.

## Decisions only the owner can make (open)

1. Approve/adjust the proposed offer tiers from `02_IRAN_BUSINESS_MODEL.md`
   (e.g., free registry lookup, breeder/professional subscription tiers).
2. Set REAL prices (packet numbers are hypotheses).
3. Approve provider accounts: Zarinpal (payment), Kavenegar (SMS) — the
   operator must register and own these accounts.
4. Decide when to run the paid-pilot interviews (T44) before broad
   commercial build-out.

## Sequence (from the packet, accepted)

Demand validation (T44 interviews) → entitlements design (T20) → billing
plumbing (T21/T22) → public pricing pages (T24). No step may be skipped:
building billing before validated demand is explicitly against the plan.
