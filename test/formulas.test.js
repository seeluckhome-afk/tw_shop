const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../src/formulas');

const globals = {
  usdRmb: 7.2,
  defaultPackaging: 8,
  curtainWasteRate: 1.08,
  sideHemAllowanceCm: 20,
  verticalCutAllowanceCm: 30,
  manualCutExtraCm: 50,
  superHeightWarnM: 4.5,
  manualHeightM: 7,
  profitWarnRate: 0.4,
  inchToCm: 2.54,
  roundingStepM: 0.1,
  factorySettlementMultiplier: 1.2,
  spliceFeePerM: 3,
  salesAmountMode: 'pretax',
  laborUseFlatWidth: false
};
const product = {
  id: 'p1',
  name: 'Test Curtain',
  base_price: 10,
  default_fullness: 2,
  width_prices: [{ size_in: 50, price_usd: 20 }, { size_in: 100, price_usd: 40 }],
  length_prices: [{ size_in: 96, price_usd: 30 }, { size_in: 160, price_usd: 60 }],
  options: [
    { option_key: 'lining', label: 'Lining Type', values: [{ label: 'Unlined', price_usd: 0, cost_rmb: 0 }, { label: 'Blackout 100%', price_usd: 50, cost_rmb: 0 }] },
    { option_key: 'memory_shaped', label: 'Memory Shaped', values: [{ label: 'Without memory training', price_usd: 0, cost_rmb: 0 }, { label: 'Add memory training', price_usd: 80, cost_rmb: 0 }] },
    { option_key: 'tieback', label: 'Matching Tieback', values: [{ label: 'No Need', price_usd: 0, cost_rmb: 0 }, { label: 'Yes', price_usd: 1, cost_rmb: 8 }] }
  ]
};
const ctx = {
  globals,
  fabrics: [{ id: 'fabric', name: '涤麻大肚', width_cm: 340, price_per_m: 26.14 }],
  linings: [{ id: 'lining_none', name: '无内衬', width_cm: 0, price_per_m: 0 }, { id: 'lining', name: '遮光内衬白色', width_cm: 280, price_per_m: 12 }],
  products: [product],
  laborRules: [
    { layer: 'single', min_m: 0, max_m: 3.4, rate_rmb_per_m: 8 },
    { layer: 'single', min_m: 3.4, max_m: 5, rate_rmb_per_m: 12 },
    { layer: 'single', min_m: 5, max_m: null, rate_rmb_per_m: 16 },
    { layer: 'double', min_m: 0, max_m: 3.4, rate_rmb_per_m: 10 },
    { layer: 'double', min_m: 3.4, max_m: 5, rate_rmb_per_m: 15 },
    { layer: 'double', min_m: 5, max_m: null, rate_rmb_per_m: 20 }
  ],
  memoryRules: [
    { min_m: 0, max_m: 3.2, single_rate_rmb: 6, double_coef: 1.5, manual_quote: 0 },
    { min_m: 3.2, max_m: 4.5, single_rate_rmb: 12, double_coef: 1.5, manual_quote: 0 },
    { min_m: 4.5, max_m: 5.5, single_rate_rmb: 25, double_coef: 1.5, manual_quote: 0 },
    { min_m: 5.5, max_m: 7, single_rate_rmb: 45, double_coef: 1.5, manual_quote: 0 },
    { min_m: 7, max_m: null, single_rate_rmb: 0, double_coef: 1.5, manual_quote: 1 }
  ]
};
function item(overrides = {}) {
  return formulas.calcItem({
    product,
    fabricId: 'fabric',
    liningId: 'lining',
    widthIn: 100,
    lengthIn: 96,
    qty: 1,
    fullness: 2,
    taxRate: 7.25,
    selectedOptions: { lining: 'Unlined', memory_shaped: 'Without memory training', tieback: 'No Need' },
    ...overrides
  }, ctx);
}

test('single layer pretax item calculates cost, tax and profit', () => {
  const r = item();
  assert.equal(r.details.hasLining, false);
  assert.equal(r.taxRate, 0.0725);
  assert.equal(r.taxUsd, r.salesUsd * 0.0725);
  assert.ok(r.finalCostRmb > 0);
});

test('double layer item includes lining and memory costs', () => {
  const r = item({ selectedOptions: { lining: 'Blackout 100%', memory_shaped: 'Add memory training', tieback: 'Yes' } });
  assert.equal(r.details.hasLining, true);
  assert.ok(r.liningCostRmb > 0);
  assert.ok(r.memoryCostRmb > 0);
  assert.ok(r.optionCostRmb >= 8);
});

test('double layer labor and memory are based on billing width and finished height', () => {
  const r = item({ selectedOptions: { lining: 'Blackout 100%', memory_shaped: 'Add memory training', tieback: 'No Need' } });
  const heightM = (r.lengthIn * globals.inchToCm) / 100;
  const laborRule = ctx.laborRules.find(rule => rule.layer === 'double' && heightM >= rule.min_m && (rule.max_m == null || heightM <= rule.max_m));
  const memoryRule = ctx.memoryRules.find(rule => heightM >= rule.min_m && (rule.max_m == null || heightM <= rule.max_m));
  const expectedLabor = r.costBreakdown.billingWidthM * laborRule.rate_rmb_per_m;
  const expectedMemory = r.costBreakdown.billingWidthM * memoryRule.single_rate_rmb * memoryRule.double_coef;
  assert.equal(Math.round(r.laborCostRmb * 100) / 100, Math.round(expectedLabor * 100) / 100);
  assert.equal(Math.round(r.memoryCostRmb * 100) / 100, Math.round(expectedMemory * 100) / 100);
});

test('cut plans cover horizontal, vertical no splice, and vertical splice', () => {
  const horizontal = formulas.curtainCutPlan({ widthIn: 30, lengthIn: 80, qty: 1, fullness: 2, material: ctx.fabrics[0], globals });
  const verticalNoSplice = formulas.curtainCutPlan({ widthIn: 40, lengthIn: 140, qty: 1, fullness: 2, material: ctx.fabrics[0], globals });
  const verticalSplice = formulas.curtainCutPlan({ widthIn: 100, lengthIn: 140, qty: 1, fullness: 2, material: ctx.fabrics[0], globals });
  assert.equal(horizontal.cutDirection, 'horizontal');
  assert.equal(verticalNoSplice.cutDirection, 'vertical');
  assert.equal(verticalNoSplice.needSplice, false);
  assert.equal(verticalSplice.needSplice, true);
});

test('height warnings and manual quote warnings fire', () => {
  const high = item({ lengthIn: 180 });
  const manual = item({ lengthIn: 280, selectedOptions: { lining: 'Blackout 100%', memory_shaped: 'Add memory training', tieback: 'No Need' } });
  assert.ok(high.warnings.some(w => /超高|高度/.test(w)));
  assert.ok(manual.warnings.some(w => /人工报价/.test(w)));
});

test('actual paid overrides system price and tax included mode extracts tax', () => {
  const actual = item({ actualPaidUsd: 500 });
  const included = formulas.calcItem({ product, fabricId: 'fabric', liningId: 'lining', widthIn: 100, lengthIn: 96, qty: 1, fullness: 2, actualPaidUsd: 500, taxRate: 10, selectedOptions: { lining: 'Unlined' } }, { ...ctx, globals: { ...globals, salesAmountMode: 'tax_included' } });
  assert.equal(actual.salesUsd, 500);
  assert.equal(Math.round(included.taxUsd * 100) / 100, 45.45);
});

test('discount reduces system sales when actual paid is empty', () => {
  const base = item();
  const discounted = item({ discountUsd: 20 });
  assert.equal(Math.round((base.salesUsd - discounted.salesUsd) * 100) / 100, 20);
});

test('percent discount is calculated from system price', () => {
  const base = item();
  const discounted = item({ discountMode: 'percent', discountValue: 10 });
  assert.equal(Math.round(discounted.discountUsd * 100) / 100, Math.round(base.systemPriceUsd * 10) / 100);
  assert.equal(Math.round((base.salesUsd - discounted.salesUsd) * 100) / 100, Math.round(base.systemPriceUsd * 10) / 100);
});

test('discount can be excluded from calculation', () => {
  const base = item();
  const ignored = item({ applyDiscount: false, discountMode: 'percent', discountValue: 50 });
  assert.equal(ignored.discountUsd, 0);
  assert.equal(ignored.salesUsd, base.salesUsd);
});

test('price over max requires manual quote instead of using last tier', () => {
  const r = item({ widthIn: 500 });
  assert.equal(r.quote.widthPrice.manualQuote, true);
  assert.ok(r.warnings.some(w => /超出价格表/.test(w)));
});

test('manual cutting extra adds 50cm to fabric usage by default', () => {
  const withExtra = formulas.curtainCutPlan({ widthIn: 30, lengthIn: 80, qty: 1, fullness: 2, material: ctx.fabrics[0], globals });
  const withoutExtra = formulas.curtainCutPlan({ widthIn: 30, lengthIn: 80, qty: 1, fullness: 2, material: ctx.fabrics[0], globals: { ...globals, manualCutExtraCm: 0 } });
  assert.ok(withExtra.fabricMeters > withoutExtra.fabricMeters);
  assert.equal(withExtra.manualCutExtraCm, 50);
});
