const { rateConfig } = require('./config');

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function ceilToStep(value, step) {
  const s = n(step, 0.1) || 0.1;
  return Math.ceil((n(value) + 1e-9) / s) * s;
}

function normalizeTaxRate(rate) {
  const r = n(rate);
  return r > 1 ? r / 100 : r;
}

function calcDiscountUsd(input, systemPriceUsd) {
  if (input.applyDiscount === false || input.apply_discount === false || input.apply_discount === "false" || input.apply_discount === 0 || input.apply_discount === "0") return 0;
  const mode = String(input.discountMode ?? input.discount_mode ?? "percent").toLowerCase();
  const value = Math.max(0, n(input.discountValue ?? input.discount_value ?? input.discountUsd ?? input.discount_usd));
  if (mode === "percent" || mode === "percentage" || mode === "%") {
    const rate = value > 1 ? value / 100 : value;
    return Math.min(systemPriceUsd, systemPriceUsd * Math.min(rate, 1));
  }
  return Math.min(systemPriceUsd, value);
}

function priceBySize(rows, size) {
  const sorted = (rows || []).slice().sort((a, b) => n(a.size_in ?? a.size) - n(b.size_in ?? b.size));
  const s = n(size);
  const exact = sorted.find((r) => n(r.size_in ?? r.size) === s);
  if (exact) return { price: n(exact.price_usd ?? exact.price), usedSize: n(exact.size_in ?? exact.size), exact: true, manualQuote: false };
  const upper = sorted.find((r) => n(r.size_in ?? r.size) >= s);
  if (upper) return { price: n(upper.price_usd ?? upper.price), usedSize: n(upper.size_in ?? upper.size), exact: false, manualQuote: false };
  return { price: 0, usedSize: sorted.length ? n(sorted[sorted.length - 1].size_in ?? sorted[sorted.length - 1].size) : s, exact: false, manualQuote: true, warning: "超出价格表范围，需要人工报价。" };
}

function isNoLining(label) {
  return /^(unlined|no lining|without lining|none|无内衬|不需要|no)$/i.test(String(label || "").trim());
}

function shouldApplyMemoryRule(valueLabel) {
  const text = String(valueLabel || "").trim().toLowerCase();
  if (!text) return false;
  if (/without|no|none|不需要|无/.test(text)) return false;
  return true;
}

function findSelectedValue(option, selectedLabel) {
  if (!option) return { label: "", price_usd: 0, cost_rmb: 0 };
  return (option.values || []).find((v) => String(v.label) === String(selectedLabel)) || (option.values || [])[0] || { label: "", price_usd: 0, cost_rmb: 0 };
}

function isNoneLiningId(id) {
  return /^(lining_none|none|no[_-]?lining|without[_-]?lining|unlined)$/i.test(String(id || "").trim());
}

function resolveLiningForCalc(linings, hasLining, liningId, selectedLiningValue) {
  const rows = Array.isArray(linings) ? linings : [];
  const none = rows.find((l) => isNoneLiningId(l?.id) || isNoLining(l?.name)) || { id: "lining_none", name: "无内衬", width_cm: 0, price_per_m: 0 };
  if (!hasLining) return none;
  const enabledRows = rows.filter((l) => Number(l?.enabled ?? 1) !== 0);
  const byId = enabledRows.find((l) => String(l.id) === String(liningId));
  if (byId && !isNoneLiningId(byId.id) && !isNoLining(byId.name)) return byId;
  const selectedLabel = String(selectedLiningValue?.label || "").trim().toLowerCase();
  if (selectedLabel) {
    const byLabel = enabledRows.find((l) => {
      const name = String(l?.name || "").toLowerCase();
      const color = String(l?.color || "").toLowerCase();
      return !isNoneLiningId(l?.id) && !isNoLining(name) && (selectedLabel.includes(name) || (color && selectedLabel.includes(color)));
    });
    if (byLabel) return byLabel;
  }
  return enabledRows.find((l) => !isNoneLiningId(l?.id) && !isNoLining(l?.name)) || none;
}

function materialPlan({ widthIn, lengthIn, qty, fullness, material, globals, panelsPerUnit = 1, active = true }) {
  const inchToCm = n(globals.inchToCm, 2.54);
  const widthCm = n(widthIn) * inchToCm;
  const heightCm = n(lengthIn) * inchToCm;
  const topAllowanceCm = n(globals.top_nonwoven_allowance_cm ?? globals.topNonwovenAllowanceCm, 10);
  const bottomAllowanceCm = n(globals.bottom_hem_allowance_cm ?? globals.bottomHemAllowanceCm, 5);
  const issueBufferCm = n(globals.material_issue_buffer_cm ?? globals.materialIssueBufferCm ?? globals.manualCutExtraCm, 50);
  const cutHeightCm = heightCm + topAllowanceCm + bottomAllowanceCm;
  const spreadWidthCm = widthCm * n(fullness, 2);
  const actualPanelQty = Math.max(1, n(qty, 1) * n(panelsPerUnit, 1));
  const rollWidthCm = n(material?.width_cm ?? material?.widthCm);
  const warnings = [];

  if (!active) {
    return {
      cutDirection: "none",
      selectedCuttingDirection: "none",
      horizontalFeasible: false,
      needSplice: false,
      spliceRequired: false,
      panelsNeeded: 0,
      verticalPieceCount: 0,
      fabricMeters: 0,
      theoreticalUsageM: 0,
      issuedUsageM: 0,
      horizontalUsageMPerPanel: 0,
      verticalUsageMPerPanel: 0,
      finishedWidthCm: widthCm,
      finishedLengthCm: heightCm,
      widthCm,
      heightCm,
      cutHeightCm,
      spreadWidthCm,
      actualPanelQty,
      heightM: heightCm / 100,
      warnings,
      description: "No material"
    };
  }

  if (rollWidthCm <= 0) {
    warnings.push("材料门幅缺失");
    return {
      cutDirection: "none",
      selectedCuttingDirection: "none",
      horizontalFeasible: false,
      needSplice: false,
      spliceRequired: false,
      panelsNeeded: 0,
      verticalPieceCount: 0,
      fabricMeters: 0,
      theoreticalUsageM: 0,
      issuedUsageM: 0,
      horizontalUsageMPerPanel: 0,
      verticalUsageMPerPanel: 0,
      finishedWidthCm: widthCm,
      finishedLengthCm: heightCm,
      widthCm,
      heightCm,
      cutHeightCm,
      spreadWidthCm,
      actualPanelQty,
      heightM: heightCm / 100,
      warnings,
      description: "材料门幅缺失"
    };
  }

  const horizontalFeasible = cutHeightCm <= rollWidthCm;
  const horizontalUsageMPerPanel = spreadWidthCm / 100;
  const verticalPieceCount = Math.max(1, Math.ceil(spreadWidthCm / rollWidthCm));
  const verticalUsageMPerPanel = verticalPieceCount * cutHeightCm / 100;
  const spliceRequired = verticalPieceCount > 1;
  const cutDirection = horizontalFeasible ? "horizontal" : "vertical";
  const selectedCuttingDirection = horizontalFeasible ? "横裁" : "纵裁";
  const usagePerPanel = horizontalFeasible ? horizontalUsageMPerPanel : verticalUsageMPerPanel;
  const theoreticalUsageM = usagePerPanel * actualPanelQty;
  const issuedUsageM = theoreticalUsageM + issueBufferCm / 100;
  const heightM = heightCm / 100;

  if (spliceRequired) warnings.push("需要拼接：幅数超过 1。");
  if (heightM >= n(globals.superHeightWarnM, 4.5)) warnings.push("超高提醒：高度超过阈值。");
  if (heightM >= n(globals.manualHeightM, 7)) warnings.push("人工报价：高度进入人工报价范围。");

  return {
    cutDirection,
    selectedCuttingDirection,
    horizontalFeasible,
    needSplice: spliceRequired,
    spliceRequired,
    panelsNeeded: verticalPieceCount,
    verticalPieceCount,
    fabricMeters: issuedUsageM,
    manualCutExtraCm: issueBufferCm,
    theoreticalUsageM,
    issuedUsageM,
    horizontalUsageMPerPanel,
    verticalUsageMPerPanel,
    finishedWidthCm: widthCm,
    finishedLengthCm: heightCm,
    widthCm,
    heightCm,
    cutHeightCm,
    spreadWidthCm,
    actualPanelQty,
    heightM,
    warnings,
    description: `${rollWidthCm}cm ${selectedCuttingDirection}${spliceRequired ? "，需拼接" : ""}`
  };
}

function curtainCutPlan(args) {
  return materialPlan(args);
}

function normalizeLayer(hasLining) {
  return hasLining ? "double" : "single";
}

function laborUnitPriceDefault(layer, heightM) {
  if (layer === "double") {
    if (heightM <= 3.4) return 10;
    if (heightM <= 5) return 15;
    return 20;
  }
  if (heightM <= 3.4) return 8;
  if (heightM <= 5) return 12;
  return 16;
}

function memoryBasePriceDefault(heightM) {
  if (heightM <= 3.2) return 6;
  if (heightM <= 4.5) return 12;
  if (heightM <= 5.5) return 25;
  if (heightM <= 7) return 45;
  return 0;
}

function inRange(heightM, minM, maxM) {
  const min = n(minM, 0);
  const maxRaw = maxM === "" || maxM == null ? null : n(maxM, null);
  const max = Number.isFinite(maxRaw) ? maxRaw : null;
  if (heightM < min) return false;
  if (max != null && heightM > max) return false;
  return true;
}

function laborUnitPriceByRules(layer, heightM, laborRules) {
  const rows = (laborRules || [])
    .filter((r) => String(r.layer || "single") === layer)
    .sort((a, b) => n(a.min_m) - n(b.min_m));
  const hit = rows.find((r) => inRange(heightM, r.min_m, r.max_m));
  if (hit) return { price: n(hit.rate_rmb_per_m, 0), source: "rule" };
  return { price: laborUnitPriceDefault(layer, heightM), source: "default" };
}

function memoryRuleByHeight(heightM, memoryRules) {
  const rows = (memoryRules || []).slice().sort((a, b) => n(a.min_m) - n(b.min_m));
  return rows.find((r) => inRange(heightM, r.min_m, r.max_m)) || null;
}

function calcSystemPrice(product, widthIn, lengthIn, selectedOptions) {
  const warnings = [];
  const width = priceBySize(product.width_prices || product.widthPrices, widthIn);
  const length = priceBySize(product.length_prices || product.lengthPrices, lengthIn);
  if (width.manualQuote) warnings.push(`Width ${widthIn}: ${width.warning}`);
  if (length.manualQuote) warnings.push(`Length ${lengthIn}: ${length.warning}`);
  let optionPrice = 0;
  for (const opt of product.options || []) {
    const value = findSelectedValue(opt, selectedOptions[opt.option_key || opt.key]);
    optionPrice += n(value.price_usd ?? value.price);
  }
  const unitPriceUsd = n(product.base_price ?? product.basePrice) + width.price + length.price + optionPrice;
  return { unitPriceUsd, totalPriceUsd: unitPriceUsd, widthPrice: width, lengthPrice: length, optionPriceUsd: optionPrice, warnings };
}

function calcItem(input, ctx) {
  const globals = ctx.globals || {};
  const product = input.product;
  const qty = Math.max(1, Math.floor(n(input.qty, 1)));
  const widthIn = n(input.widthIn);
  const lengthIn = n(input.lengthIn);
  if (widthIn <= 0 || lengthIn <= 0) throw new Error("Width / Length must be > 0");

  const panelsPerUnit = Math.max(1, n(product.panels_per_unit ?? product.panelsPerUnit, 1));
  const fullness = n(input.fullness, product.default_fullness ?? product.defaultFullness ?? 2);
  const selectedOptions = input.selectedOptions || {};
  const quote = calcSystemPrice(product, widthIn, lengthIn, selectedOptions);

  const liningOption = (product.options || []).find((o) => /lining/i.test(o.option_key || o.key || o.label));
  const selectedLiningValue = findSelectedValue(liningOption, selectedOptions[liningOption?.option_key || liningOption?.key]);
  const hasLiningByLabel = !isNoLining(selectedLiningValue.label);
  const liningIdText = String(input.liningId || "").trim().toLowerCase();
  const hasLiningById = !isNoneLiningId(liningIdText);
  const hasLining = liningOption ? hasLiningByLabel : hasLiningById;

  const fabric = (ctx.fabrics || []).find((f) => f.id === input.fabricId) || (ctx.fabrics || [])[0] || {};
  const legacyLining = hasLining
    ? ((ctx.linings || []).find((l) => l.id === input.liningId) || (ctx.linings || []).find((l) => l.id !== "lining_none") || {})
    : ((ctx.linings || []).find((l) => l.id === "lining_none") || { id: "lining_none", name: "无内衬", width_cm: 0, price_per_m: 0 });

  const lining = resolveLiningForCalc(ctx.linings || [], hasLining, input.liningId, selectedLiningValue) || legacyLining;
  const mainPlan = materialPlan({ widthIn, lengthIn, qty, fullness, material: fabric, globals, panelsPerUnit, active: true });
  const liningPlan = hasLining
    ? materialPlan({ widthIn, lengthIn, qty, fullness, material: lining, globals, panelsPerUnit, active: true })
    : materialPlan({ widthIn, lengthIn, qty, fullness, material: lining, globals, panelsPerUnit, active: false });

  const warnings = [...quote.warnings, ...mainPlan.warnings, ...liningPlan.warnings];
  const widthCm = mainPlan.widthCm;
  const heightM = mainPlan.heightM;
  const actualPanelQty = mainPlan.actualPanelQty;
  const billingWidthM = (widthCm / 100) * actualPanelQty;
  const layer = normalizeLayer(hasLining);

  const mainFabricUnitPriceRmb = n(fabric.price_per_m);
  const liningUnitPriceRmb = hasLining ? n(lining.price_per_m) : 0;
  const estimatedMainFabricCostRmb = mainPlan.issuedUsageM * mainFabricUnitPriceRmb;
  let estimatedLiningCostRmb = 0;
  let estimatedCostReliable = true;
  if (hasLining) {
    if (liningUnitPriceRmb <= 0) {
      warnings.push("需要人工报价：内衬价格缺失");
      estimatedCostReliable = false;
    }
    estimatedLiningCostRmb = liningPlan.issuedUsageM * liningUnitPriceRmb;
  }

  const laborPriceResult = laborUnitPriceByRules(layer, heightM, ctx.laborRules || []);
  const laborPrice = laborPriceResult.price;
  const estimatedLaborRmb = billingWidthM * laborPrice;
  const spliceUnitPrice = n(globals.spliceFeePerM, 3) || 3;
  const estimatedSpliceRmb = mainPlan.spliceRequired ? billingWidthM * spliceUnitPrice : 0;

  let estimatedOptionCostRmb = 0;
  let memoryRequired = false;
  for (const opt of product.options || []) {
    const key = opt.option_key || opt.key;
    if (!Object.prototype.hasOwnProperty.call(selectedOptions, key)) continue;
    const value = findSelectedValue(opt, selectedOptions[key]);
    estimatedOptionCostRmb += n(value.cost_rmb ?? value.costRmb, 0) * qty;
    if (/memory/i.test(key) && shouldApplyMemoryRule(value.label)) memoryRequired = true;
  }

  let memoryUnitPrice = 0;
  let estimatedMemoryRmb = 0;
  if (memoryRequired) {
    const memoryRule = memoryRuleByHeight(heightM, ctx.memoryRules || []);
    if (memoryRule && Number(memoryRule.manual_quote || 0) === 1) {
      warnings.push("Memory shaping requires manual quote.");
      estimatedCostReliable = false;
    }
    const base = memoryRule ? n(memoryRule.single_rate_rmb, 0) : memoryBasePriceDefault(heightM);
    const doubleCoef = memoryRule ? n(memoryRule.double_coef, 1) : 1.5;
    if (base <= 0) {
      warnings.push("Memory shaping requires manual quote.");
      estimatedCostReliable = false;
    } else {
      memoryUnitPrice = layer === "double" ? base * doubleCoef : base;
      estimatedMemoryRmb = billingWidthM * memoryUnitPrice;
    }
  }

  const estimatedLogisticsRmb = n(input.logisticsCostRmb ?? input.logistics_cost_rmb, 0);
  const estimatedCostRmb =
    estimatedMainFabricCostRmb +
    estimatedLiningCostRmb +
    estimatedLaborRmb +
    estimatedSpliceRmb +
    estimatedMemoryRmb +
    estimatedOptionCostRmb +
    estimatedLogisticsRmb;

  const systemPriceUsd = quote.unitPriceUsd * qty;
  const actualPaidUsd = n(input.actualPaidUsd);
  const discountMode = String(input.discountMode ?? input.discount_mode ?? "percent").toLowerCase();
  const discountValue = Math.max(0, n(input.discountValue ?? input.discount_value ?? input.discountUsd ?? input.discount_usd));
  const discountUsd = calcDiscountUsd(input, systemPriceUsd);
  const salesUsd = actualPaidUsd > 0 ? actualPaidUsd : Math.max(0, systemPriceUsd - discountUsd);

  const taxRate = normalizeTaxRate(input.taxRate);
  let taxUsd;
  let netSalesUsd;
  if ((globals.salesAmountMode || "pretax") === "tax_included") {
    taxUsd = salesUsd * taxRate / (1 + taxRate);
    netSalesUsd = salesUsd - taxUsd;
  } else {
    taxUsd = salesUsd * taxRate;
    netSalesUsd = salesUsd;
  }

  const netSalesRmb = netSalesUsd * rateConfig().usdRmbRate;
  const finalCostRmb = estimatedCostRmb;
  const profitRmb = netSalesRmb - finalCostRmb;
  const profitRate = netSalesRmb > 0 ? profitRmb / netSalesRmb : 0;
  if (profitRate < n(globals.profitWarnRate, 0.4)) warnings.push("Low profit warning.");

  const costBreakdown = {
    topNonwovenAllowanceCm: n(globals.top_nonwoven_allowance_cm ?? globals.topNonwovenAllowanceCm, 10),
    bottomHemAllowanceCm: n(globals.bottom_hem_allowance_cm ?? globals.bottomHemAllowanceCm, 5),
    materialIssueBufferCm: n(globals.material_issue_buffer_cm ?? globals.materialIssueBufferCm ?? globals.manualCutExtraCm, 50),
    widthCm,
    heightCm: mainPlan.heightCm,
    cutHeightCm: mainPlan.cutHeightCm,
    spreadWidthCm: mainPlan.spreadWidthCm,
    actualPanelQty,
    billingWidthM,
    layer,
    mainFabricTheoreticalUsageM: mainPlan.theoreticalUsageM,
    mainFabricIssuedUsageM: mainPlan.issuedUsageM,
    mainFabricUnitPriceRmb,
    estimatedMainFabricCostRmb,
    liningTheoreticalUsageM: liningPlan.theoreticalUsageM,
    liningIssuedUsageM: liningPlan.issuedUsageM,
    liningUnitPriceRmb,
    estimatedLiningCostRmb,
    laborUnitPriceRmb: laborPrice,
    estimatedLaborRmb,
    spliceRequired: mainPlan.spliceRequired,
    spliceUnitPrice,
    estimatedSpliceRmb,
    memoryRequired,
    memoryUnitPriceRmb: memoryUnitPrice,
    estimatedMemoryRmb,
    estimatedOptionCostRmb,
    estimatedLogisticsRmb,
    estimatedCostRmb,
    estimatedCostReliable
  };

  return {
    product,
    qty,
    widthIn,
    lengthIn,
    panelsPerUnit,
    actualPanelQty,
    fullness,
    fabric,
    lining,
    selectedOptions,
    hasManualQuote: warnings.some((w) => /manual quote|out of price table|人工报价|缺失/i.test(w)),
    estimatedCostReliable,
    systemPriceUsd,
    actualPaidUsd,
    discountMode,
    discountValue,
    discountUsd,
    salesUsd,
    taxRate,
    taxUsd,
    netSalesUsd,
    netSalesRmb,
    rawCostRmb: estimatedCostRmb,
    estimatedCostRmb,
    finalCostRmb,
    profitRmb,
    profitRate,
    mainPlan,
    liningPlan,
    mainFabricCostRmb: estimatedMainFabricCostRmb,
    liningCostRmb: estimatedLiningCostRmb,
    laborCostRmb: estimatedLaborRmb,
    optionCostRmb: estimatedOptionCostRmb,
    memoryCostRmb: estimatedMemoryRmb,
    packagingCostRmb: 0,
    spliceFeeRmb: estimatedSpliceRmb,
    costBreakdown,
    quote,
    warnings,
    details: { fabricName: fabric?.name || "", liningName: hasLining ? lining?.name || "" : "无内衬", hasLining, layer, color: selectedOptions.color || "" }
  };
}

module.exports = { n, ceilToStep, normalizeTaxRate, priceBySize, curtainCutPlan, calcSystemPrice, calcDiscountUsd, calcItem };
