import assert from 'node:assert/strict';
import { sourceRuntime } from './r88-test-runtime.mjs';
const runtime = sourceRuntime();
try {
  const { calculateEconomics: calc, estimatedGatewayFeeToman: fee, breakEvenUnits, DEFAULT_ECONOMICS: input } = runtime.load('src/commerce/economics.ts');
  let count = 0;
  const test = (name, fn) => { fn(); console.log(`PASS ${name}`); count++; };
  test('supplier fee has cap plus fixed fee', () => { assert.equal(fee(490000),2950); assert.equal(fee(100000000),16500); assert.equal(fee(0),0); });
  test('pilot loses money despite gross revenue', () => { const x=calc(input); assert.equal(x.revenueToman,79000000); assert.equal(x.gatewayCostToman,455000); assert.equal(x.operatingSurplusBeforeTaxToman,-43755000); });
  test('growth scenario is explicitly conditional', () => { const x=calc({...input, products:input.products.map((p,i)=>({...p,monthlyUnits:[60,120,100][i]}))}); assert.equal(x.revenueToman,201800000); assert.equal(x.operatingSurplusBeforeTaxToman,59151000); });
  for (const value of [-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1]) test(`invalid money rejected ${value}`,()=>assert.throws(()=>fee(value),RangeError));
  test('empty revenue does not invent margin',()=>assert.equal(calc({fixedMonthlyCostToman:1,products:[]}).contributionMargin,null));
  test('duplicate products rejected',()=>assert.throws(()=>calc({...input,products:[input.products[0],input.products[0]]}),RangeError));
  test('unsafe multiplication rejected',()=>assert.throws(()=>calc({...input,products:[{...input.products[0],monthlyUnits:Number.MAX_SAFE_INTEGER}]}),RangeError));
  test('break-even units cover fixed overhead',()=>assert.equal(breakEvenUnits(1900000,300000,110000000),70));
  test('negative-margin product cannot break even',()=>assert.equal(breakEvenUnits(1000,2000,100000),null));
  test('other revenue can already cover fixed overhead',()=>assert.equal(breakEvenUnits(1000,2000,100000,110000),0));
  test('free products with support consume contribution',()=>assert.equal(calc({fixedMonthlyCostToman:0,products:[{id:'free',monthlyUnits:10,unitPriceToman:0,unitVariableCostToman:100}]}).contributionToman,-1000));
  console.log(`${count} economics checks passed; no prices or profitability are validated demand.`);
} finally { runtime.cleanup(); }
