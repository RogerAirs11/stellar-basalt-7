/** Planning calculator only. These are pricing experiments, NOT live billing tariffs. */
export interface ProductAssumption {
  id: string;
  monthlyUnits: number;
  unitPriceToman: number;
  unitVariableCostToman: number;
}
export interface EconomicsInput { products: ProductAssumption[]; fixedMonthlyCostToman: number }
export interface ProductEconomics extends ProductAssumption {
  revenueToman: number;
  variableCostToman: number;
  gatewayCostToman: number;
  contributionToman: number;
}
export interface EconomicsResult {
  products: ProductEconomics[];
  revenueToman: number;
  variableCostToman: number;
  gatewayCostToman: number;
  contributionToman: number;
  fixedMonthlyCostToman: number;
  operatingSurplusBeforeTaxToman: number;
  contributionMargin: number | null;
}
function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}
function safe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Scenario exceeds safe integer precision');
  return value;
}
/** Supplier observation 2026-10-03: 0.5% capped at 16,000 + 500 toman.
 * Planning uses upward rounding. Shaparak, tax, refunds and terminal terms NOT included.
 * Zero-price products do not incur a payment transaction. Do not use this as a settlement ledger.
 */
export function estimatedGatewayFeeToman(amount: number): number {
  nonNegativeInteger(amount, 'amount');
  return amount === 0 ? 0 : Math.min(Math.ceil(amount / 200), 16_000) + 500;
}
export function calculateEconomics(input: EconomicsInput): EconomicsResult {
  nonNegativeInteger(input.fixedMonthlyCostToman, 'fixed cost');
  if (!Array.isArray(input.products) || input.products.length > 50) throw new RangeError('At most 50 product assumptions are supported');
  const seen = new Set<string>();
  const products = input.products.map((item): ProductEconomics => {
    if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) throw new RangeError('Product IDs must be unique and nonempty');
    seen.add(item.id);
    nonNegativeInteger(item.monthlyUnits, 'units');
    nonNegativeInteger(item.unitPriceToman, 'unit price');
    nonNegativeInteger(item.unitVariableCostToman, 'unit cost');
    const revenueToman = safe(item.monthlyUnits * item.unitPriceToman);
    const variableCostToman = safe(item.monthlyUnits * item.unitVariableCostToman);
    const gatewayCostToman = safe(item.monthlyUnits * estimatedGatewayFeeToman(item.unitPriceToman));
    const contributionToman = safe(revenueToman - variableCostToman - gatewayCostToman);
    return { ...item, revenueToman, variableCostToman, gatewayCostToman, contributionToman };
  });
  const sum = (key: 'revenueToman' | 'variableCostToman' | 'gatewayCostToman' | 'contributionToman') => products.reduce((total, p) => safe(total + p[key]), 0);
  const revenueToman = sum('revenueToman'), contributionToman = sum('contributionToman');
  return { products, revenueToman, variableCostToman: sum('variableCostToman'), gatewayCostToman: sum('gatewayCostToman'), contributionToman,
    fixedMonthlyCostToman: input.fixedMonthlyCostToman,
    operatingSurplusBeforeTaxToman: safe(contributionToman - input.fixedMonthlyCostToman),
    contributionMargin: revenueToman > 0 ? contributionToman / revenueToman : null };
}
/** Number of this product needed after the other products' monthly contribution. */
export function breakEvenUnits(unitPriceToman: number, unitVariableCostToman: number, fixedMonthlyCostToman: number, otherContributionToman = 0): number | null {
  nonNegativeInteger(unitPriceToman, 'unit price'); nonNegativeInteger(unitVariableCostToman, 'unit cost');
  nonNegativeInteger(fixedMonthlyCostToman, 'fixed cost');
  if (!Number.isSafeInteger(otherContributionToman)) throw new RangeError('Other contribution must be a safe integer');
  const remaining = Math.max(0, safe(fixedMonthlyCostToman - otherContributionToman));
  if (remaining === 0) return 0;
  const unitContribution = unitPriceToman - unitVariableCostToman - estimatedGatewayFeeToman(unitPriceToman);
  return unitContribution > 0 ? Math.ceil(remaining / unitContribution) : null;
}
export const DEFAULT_ECONOMICS: EconomicsInput = {
  fixedMonthlyCostToman: 110_000_000,
  products: [
    { id: 'farm', monthlyUnits: 20, unitPriceToman: 1_900_000, unitVariableCostToman: 300_000 },
    { id: 'professional', monthlyUnits: 60, unitPriceToman: 490_000, unitVariableCostToman: 75_000 },
    { id: 'promotion', monthlyUnits: 40, unitPriceToman: 290_000, unitVariableCostToman: 45_000 },
  ],
};
