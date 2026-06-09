const $ = id => document.getElementById(id);
const ORDER_CHANNEL = (location.port === '8082' || (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')) ? 'amazon' : 'shopify';
let USD_RMB_RATE = 6.8;
const INCH_TO_CM = 2.54;
const state = { globals: {}, products: [], fabrics: [], linings: [], laborRules: [], memoryRules: [], taxRates: [], features: {}, currentItems: [], lastOrderId: null, preview: null, ordersSizeUnit: localStorage.getItem('twodrapes_orders_size_unit') || 'inch', profitOrderChoices: [], spliceOrderChoices: [], spliceSelectedOrderId: '', ordersCache: [], ordersPage: 1, ordersPageSize: 50, selectedOrderIds: new Set() };
const fmt = (n, d = 2) => (Number(n) || 0).toFixed(d);
const usd = n => `$${fmt(n)}`;
const rmb = n => `¥${fmt(n)}`;
const esc = s => String(s ?? '').replace(/[&<>"'`]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '`': '&#96;' }[m]));
let PAYPAL_FEE_RATE = 0.044;
const normalizeItemCode = (code) => String(code || '').replace(/^(定制-?|定制-)/, '定制-');
const optionKeyFromLabel = s => String(s || 'option').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `option_${Date.now()}`;
const today = () => new Date().toISOString().slice(0, 10);
const optionEditor = { groups: [], activeIndex: 0 };
const optionDragState = { fromIndex: null };

function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add('hidden'), 3200);
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function extractLabeledLine(raw, labels) {
  if (!raw) return '';
  const key = labels.map(escapeRegExp).join('|');
  const m = raw.match(new RegExp(`(?:^|\\n)\\s*(?:${key})\\s*[:：]\\s*([^\\n]*)`, 'im'));
  return m ? m[1].trim() : '';
}
function extractLabeledBlock(raw, labels, stopLabels) {
  if (!raw) return '';
  const key = labels.map(escapeRegExp).join('|');
  const stop = stopLabels.map(escapeRegExp).join('|');
  const m = raw.match(new RegExp(`(?:^|\\n)\\s*(?:${key})\\s*[:：]?[ \\t]*\\n?([\\s\\S]*?)(?=\\n[ \\t]*(?:${stop})\\s*[:：]?[ \\t]*(?:[^\\n]|$)|$)`, 'im'));
  return m ? m[1].trim() : '';
}
function findOrderNoFromRaw(raw) {
  const patterns = [
    /\b\d{3}-\d{7,8}-\d{6,9}\b/,
    /\b[A-Z]{1,4}-\d{4,}\b/i,
    /(?:^|\s)#\d{4,}(?:\s|$)/,
    /\b\d{8,}\b/
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && m[0]) return String(m[0]).trim();
  }
  return '';
}
function findAddressFromRaw(raw, stopLabels) {
  const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return '';
  const stop = new RegExp(`^[ \\t]*(?:${stopLabels.map(escapeRegExp).join('|')})[ \\t]*(?:[:：]|$)`, 'i');
  const inlineStop = new RegExp(`(?:${stopLabels.map(escapeRegExp).join('|')})[^\\n]*[:：]`, 'i');
  const addrLabel = /(?:收货地址|地址|shipping\s*address|ship\s*to|address)\s*[:：]\s*(.*)/i;
  const addrToken = /(省|市|区|县|镇|街道|楼|室|单元|大道|广场|大厦|号|弄|巷|公寓|栋|牌|园|里|新村|Street|St\b|Road|Rd\b|Avenue|Ave\b|Lane|Drive|Dr\b|Boulevard|Blvd\b|Apartment|Apt\b|Suite|Zip|Postal|Postcode)/i;
  const zipCode = /\b\d{5}(?:-\d{4})?\b/;
  const stateCode = /\b(?:A[LKSZRAEP]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEHINOPST]|N[CDEHJMVY]|O[ARHKRI]|P[ARW]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (stop.test(lines[i])) {
      const m = lines[i].match(addrLabel);
      if (m && m[1].trim()) { lines[i] = m[1].trim(); start = i; break; }
      continue;
    }
    if (addrToken.test(lines[i])) { start = i; break; }
    if (zipCode.test(lines[i]) && i > 0) { start = i - 1; break; }
    if (stateCode.test(lines[i]) && i > 0) { start = i - 1; break; }
  }
  if (start < 0) return '';
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (stop.test(line)) break;
    if (!line) break;
    const trimmed = line.replace(inlineStop, '').trim();
    if (trimmed) out.push(trimmed);
    if (out.length >= 5) break;
  }
  return out.join('\n').trim();
}
function parseBulkCustomerInfo(rawText) {
  const raw = String(rawText || '').replace(/\r/g, '').trim();
  if (!raw) return {};
  const labels = {
    orderNo: ['shopify订单号', 'amazon订单号', '订单号', 'order id', 'order number', 'order no', 'shopify order id', 'amazon order id', 'order#'],
    name: ['客户姓名', '姓名', '收件人', '联系人', 'name', 'customer'],
    email: ['客户邮箱', '邮箱', 'email', 'e-mail', 'mail'],
    phone: ['客户电话', '电话', '手机', 'phone', 'tel', 'telephone', 'mobile'],
    address: ['收货地址', '地址', 'shipping address', 'ship to', 'address'],
    remark: ['订单备注', '备注', 'note', 'remark', 'message']
  };
  const stopKeys = [...labels.orderNo, ...labels.name, ...labels.email, ...labels.phone, ...labels.address, ...labels.remark];
  const result = {
    orderNo: extractLabeledLine(raw, labels.orderNo),
    name: extractLabeledLine(raw, labels.name),
    email: extractLabeledLine(raw, labels.email),
    phone: extractLabeledLine(raw, labels.phone),
    address: extractLabeledBlock(raw, labels.address, stopKeys),
    remark: extractLabeledBlock(raw, labels.remark, stopKeys)
  };
  if (!result.orderNo) {
    result.orderNo = findOrderNoFromRaw(raw);
  }
  if (!result.email) {
    const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) result.email = emailMatch[0];
  }
  if (!result.phone) {
    const phoneCandidates = raw.match(/(?:\+?\d[\d\s\-()]{6,}\d)/g) || [];
    const phone = phoneCandidates.find((x) => {
      const v = String(x || '').trim();
      const digits = v.replace(/\D/g, '');
      return digits.length >= 7 && !/\d{3}-\d{7}-\d{7}/.test(v);
    });
    if (phone) result.phone = phone.trim();
  }
  if (!result.name) {
    const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);
    const labelExclude = /billing|shipping|edit|address|email|phone|order|payment|paypal/i;
    const namePattern = /^[A-Za-z一-龥][^\s]*\s+[A-Za-z一-龥][^\s]/;
    const firstNameLike = lines.find((x) =>
      x.length >= 3 && x.length <= 40 &&
      !/[锛?]/.test(x) && !/@/.test(x) &&
      !labelExclude.test(x) &&
      namePattern.test(x)
    );
    if (firstNameLike) result.name = firstNameLike;
  }
  if (!result.address) {
    result.address = findAddressFromRaw(raw, stopKeys);
  }
  return result;
}
function applyMatchedCustomerInfo() {
  const raw = $('bulkCustomerInfoInput')?.value || '';
  if (!raw.trim()) {
    toast('请先粘贴客户信息', 'bad');
    return;
  }
  const parsed = parseBulkCustomerInfo(raw);
  const targets = [
    ['orderNo', 'orderNo'],
    ['name', 'customerName'],
    ['email', 'customerEmail'],
    ['phone', 'customerPhone'],
    ['address', 'shippingAddress'],
    ['remark', 'orderRemark']
  ];
  let filled = 0;
  let skipped = 0;
  targets.forEach(([key, fieldId]) => {
    const el = $(fieldId);
    const value = parsed[key];
    if (el && value) {
      if (el.value && el.value.trim()) { skipped++; return; }
      el.value = value;
      filled++;
      el.classList.remove('field-flash');
      void el.offsetWidth;
      el.classList.add('field-flash');
      el.addEventListener('animationend', () => el.classList.remove('field-flash'), { once: true });
    }
  });
  if (!filled && !skipped) {
    toast('未识别到可填充字段，请检查文本格式', 'bad');
    return;
  }
  const msg = [];
  if (filled) msg.push(`已填充 ${filled} 项`);
  if (skipped) msg.push(`${skipped} 项已有值已跳过`);
  toast(msg.join('，'));
}
function fillSelect(el, rows, value) {
  if (!el) return;
  el.innerHTML = rows.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('');
  if (value != null) el.value = value;
}
function table(el, headers, rows) {
  if (!el) return;
  el.innerHTML = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
}
function formatOrderSizeText(item, unit = state.ordersSizeUnit) {
  const widthIn = Number(item?.width_in) || 0;
  const lengthIn = Number(item?.length_in) || 0;
  if (unit === 'cm') return `${fmt(widthIn * INCH_TO_CM, 2)} x ${fmt(lengthIn * INCH_TO_CM, 2)}`;
  return `${fmt(widthIn, 0)} x ${fmt(lengthIn, 0)}`;
}
async function loadAll() {
  document.querySelector('main')?.classList.add('loading');
  try {
    const bootstrap = await api.json('/api/bootstrap');
    state.globals = bootstrap.globals || {};
    state.products = bootstrap.products || [];
    state.fabrics = bootstrap.fabrics || [];
    state.linings = bootstrap.linings || [];
    state.laborRules = bootstrap.laborRules || [];
    state.memoryRules = bootstrap.memoryRules || [];
    state.taxRates = bootstrap.taxRates || [];
    state.features = bootstrap.features || {};
    USD_RMB_RATE = Number(bootstrap.rates?.usdRmbRate) || USD_RMB_RATE;
    PAYPAL_FEE_RATE = Number(bootstrap.rates?.paypalFeeRate) || PAYPAL_FEE_RATE;
    renderAll();
    await loadOrders();
    await loadProfitOrderList();
  } catch (e) {
    console.error('loadAll error:', e);
  } finally {
    document.querySelector('main')?.classList.remove('loading');
  }
}
function activeProduct() {
  return state.products.find(p => p.id === $('itemProduct').value) || state.products[0];
}
function resolveProductFabricId(product) {
  const enabled = state.fabrics.filter(f => f.enabled);
  const enabledIds = new Set(enabled.map(f => f.id));
  const defaultFabricId = product?.default_fabric_id || product?.defaultFabricId || '';
  if (defaultFabricId && enabledIds.has(defaultFabricId)) return defaultFabricId;
  return enabled[0]?.id || '';
}
function resolveLiningIdFromOptions(product, options) {
  const liningOption = (product?.options || []).find(o => /lining/i.test(o.option_key || o.key || o.label || ''));
  if (!liningOption) return 'lining_none';
  const key = liningOption.option_key || liningOption.key;
  const label = String(options?.[key] || '').trim();
  if (!label || /unlined|no lining|without|none|无内衬/i.test(label)) return 'lining_none';
  const candidates = state.linings.filter(l => l.enabled && l.id !== 'lining_none');
  const exact = candidates.find(l => String(l.name || '').trim() === label);
  if (exact) return exact.id;
  const fuzzy = candidates.find(l => label.includes(String(l.name || '').trim()) || String(l.name || '').trim().includes(label));
  return fuzzy?.id || candidates[0]?.id || 'lining_none';
}
function renderCostDetailModal(calc) {
  const b = calc.costBreakdown || {};
  const lines = [
    ['主面料理论用料', `${fmt(b.mainFabricTheoreticalUsageM)} m`],
    ['主面料发料用料', `${fmt(b.mainFabricIssuedUsageM)} m`],
    ['主面料单价', `${fmt(b.mainFabricUnitPriceRmb)} RMB/m`],
    ['主面料成本', rmb(calc.mainFabricCostRmb)],
    ['内衬理论用料', `${fmt(b.liningTheoreticalUsageM)} m`],
    ['内衬发料用料', `${fmt(b.liningIssuedUsageM)} m`],
    ['内衬单价', `${fmt(b.liningUnitPriceRmb)} RMB/m`],
    ['内衬成本', rmb(calc.liningCostRmb)],
    ['加工费', rmb(calc.laborCostRmb)],
    ['拼接费', rmb(calc.spliceFeeRmb)],
    ['定型费', rmb(calc.memoryCostRmb)],
    ['选项成本', rmb(calc.optionCostRmb)],
    ['物流成本', rmb(b.estimatedLogisticsRmb)],
    ['系统预计成本', rmb(calc.estimatedCostRmb ?? calc.finalCostRmb)]
  ];
  if ($('costDetailContent')) $('costDetailContent').innerHTML = `<div class="cost-grid">${lines.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>`;
}
function costSourceLabel(source) {
  if (source === 'factory_settlement') return '工厂结算';
  if (source === 'factory_cost_total') return '工厂成本合计';
  return '系统预计';
}
function optionDisplayRows(item) {
  const calc = item.calc_detail || {};
  const options = item.selected_options || {};
  const groups = calc.product?.options || [];
  const byKey = new Map(groups.map(g => [g.option_key || g.key, g]));
  return Object.entries(options).map(([key, value]) => {
    const group = byKey.get(key) || {};
    const found = (group.values || []).find(v => String(v.label) === String(value)) || {};
    return {
      itemId: item.id,
      key,
      label: group.label || key,
      value,
      values: (group.values || []).map(v => String(v.label)),
      priceUsd: found.price_usd ?? found.price ?? '',
      costRmb: found.cost_rmb ?? found.costRmb ?? ''
    };
  });
}
function orderItemModulesHtml(order, isEdit) {
  const items = order.items || [];
  if (!items.length) return '<div class="order-options-detail"><h4>项目</h4><div class="notice">暂无项目。</div></div>';

  // Edit mode: keep individual item cards with edit controls
  if (isEdit) {
    return items.map(it => {
      const productName = esc(it.product_name || '产品');
      const itemCode = esc(normalizeItemCode(it.item_code));
      const size = `${fmt(it.width_in, 0)} x ${fmt(it.length_in, 0)}`;
      const qty = Math.max(1, Number(it.qty) || 1);
      const qtySection = `<div class="item-module-qty"><span>尺寸: ${size}</span><div class="inline-logistics"><label>数量 <input type="number" min="1" step="1" value="${qty}" data-item-qty-input="${it.id}"></label><button class="btn small secondary" type="button" data-save-item-qty="${it.id}">保存数量</button></div></div>`;
      const optRows = optionDisplayRows(it);
      let optionsTable = '';
      if (optRows.length) {
        const rows = optRows.map(r => `<tr>
          <td>${esc(r.label)}</td>
          <td><select data-option-item-id="${r.itemId}" data-option-key="${esc(r.key)}">${r.values.map(v => `<option value="${esc(v)}" ${String(v) === String(r.value) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
          <td>${r.priceUsd === '' ? '' : fmt(r.priceUsd)}</td>
          <td>${r.costRmb === '' ? '' : fmt(r.costRmb)}</td>
          <td><button class="btn small secondary" data-save-option-item="${r.itemId}" data-save-option-key="${esc(r.key)}">保存</button></td>
        </tr>`).join('');
        optionsTable = `<div class="table-wrap detail-table"><table>
          <thead><tr><th>选项</th><th>选择值</th><th>售价 USD</th><th>成本 RMB</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      }
      return `<div class="order-item-module">
        <h4>${productName} <span class="item-module-code">${itemCode}</span></h4>
        ${qtySection}
        ${optionsTable}
      </div>`;
    }).join('');
  }

  // View mode: group by product name
  const groups = new Map();
  for (const it of items) {
    const name = it.product_name || '产品';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }

  return Array.from(groups.entries()).map(([productName, groupItems]) => {
    const totalCount = groupItems.length;
    const totalQty = groupItems.reduce((s, it) => s + (Math.max(1, Number(it.qty) || 1)), 0);
    const headerLabel = totalCount === 1
      ? `${totalQty}条`
      : `${totalCount}项, 共${totalQty}条`;

    const rows = groupItems.map(it => {
      const itemCode = esc(normalizeItemCode(it.item_code));
      const size = `${fmt(it.width_in, 0)}×${fmt(it.length_in, 0)}`;
      const qty = Math.max(1, Number(it.qty) || 1);
      const itemPrice = Number(it.sales_usd) || 0;
      const optRows = optionDisplayRows(it);
      const optSummary = optRows.map(r => `${esc(r.label)}: ${esc(r.value)}`).join(' / ');
      return `<div class="item-group-row">
        <span class="item-row-code">${itemCode}</span>
        <span class="item-row-size">${size}</span>
        <span class="item-row-qty">×${qty}</span>
        <span class="item-row-price">$${fmt(itemPrice)}</span>
        ${optSummary ? `<span class="item-row-opts">${optSummary}</span>` : ''}
      </div>`;
    }).join('');

    return `<div class="item-group-card">
      <div class="item-group-header">
        <span class="item-group-name">${esc(productName)}</span>
        <span class="item-group-count">${headerLabel}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');
}
async function viewOrderModal(orderId, mode) {
  try {
    const order = await api.json(`/api/orders/${orderId}`);
    const payment = orderPaymentBreakdown(order);
    const logisticsCost = Number(order.logistics_cost_rmb) || 0;
    const form = $('editOrderForm');
    const isEdit = mode === 'edit';
    $('editOrderTitle').textContent = (isEdit ? '编辑' : '查看') + '订单 ' + esc(order.order_no || '#' + order.id);

    const field = (label, value, inputType, fieldName) => {
      if (!isEdit) return `<div><label>${label}<span class="detail-value">${esc(String(value || ''))}</span></label></div>`;
      if (inputType === 'textarea') return `<div><label>${label}<textarea rows="2" data-edit-field="${fieldName}">${esc(value || '')}</textarea></label></div>`;
      if (inputType === 'date') return `<div><label>${label}<input type="date" value="${esc(value || '')}" data-edit-field="${fieldName}"></label></div>`;
      if (inputType === 'number') return `<div><label>${label}<input type="number" step="0.01" min="0" value="${fmt(value)}" data-edit-field="${fieldName}"></label></div>`;
      if (inputType === 'integer') return `<div><label>${label}<input type="number" step="1" min="0" inputmode="numeric" value="${esc(value ?? '')}" data-edit-field="${fieldName}"></label></div>`;
      return `<div><label>${label}<input value="${esc(value || '')}" data-edit-field="${fieldName}"></label></div>`;
    };

    form.innerHTML =
      '<div class="detail-grid">' +
      field('下单日期', order.order_date, 'date', 'order_date') +
      field('交期日期', order.delivery_date, 'date', 'delivery_date') +
      field('客户姓名', order.customer_name, 'text', 'customer_name') +
      field('邮箱', order.customer_email, 'text', 'customer_email') +
      field('电话', order.customer_phone, 'text', 'customer_phone') +
      field('地址', order.customer_address, 'textarea', 'customer_address') +
      field('备注', order.remark, 'text', 'remark') +
      '</div>' +
      '<div class="detail-section"><h4>物流信息</h4><div class="detail-grid">' +
      field('货代', order.logistics_provider, 'text', 'logistics_provider') +
      field('尾程派送渠道', order.delivery_channel, 'text', 'delivery_channel') +
      field('尾程追踪编码', order.tracking_number, 'text', 'tracking_number') +
      field('送达日期', order.delivered_date, 'date', 'delivered_date') +
      field('重量 KG', order.weight_kg, 'number', 'weight_kg') +
      field('物流成本 RMB', logisticsCost, 'number', 'logistics_cost_rmb') +
      '</div></div>' +
      (isEdit
        ? '<div class="actions"><button class="btn primary small" data-save-order-edit="' + order.id + '">保存修改</button></div>'
        : '<div class="actions"><button class="btn primary small" data-switch-to-edit="' + order.id + '">编辑</button></div>') +
      orderItemModulesHtml(order, isEdit);

    $('editOrderModal').classList.remove('hidden');

    // Bind close
    const closeHandler = () => $('editOrderModal').classList.add('hidden');
    $('closeEditOrderBtn').onclick = closeHandler;
    $('closeEditOrderModal').onclick = closeHandler;

    if (isEdit) {
      // Save item qty
      form.querySelectorAll('[data-save-item-qty]').forEach(btn => btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-save-item-qty');
        const input = form.querySelector('[data-item-qty-input="' + itemId + '"]');
        const qty = Number(input.value || 0);
        if (!Number.isFinite(qty) || qty <= 0) return toast('数量必须 > 0', 'bad');
        try {
          await api.json(`/api/order-items/${itemId}/qty`, { method: 'PUT', body: JSON.stringify({ qty: Math.floor(qty) }) });
          toast('数量已更新');
          await loadOrders();
        } catch (e) { toast(e.message, 'bad'); }
      }));
      // Save options
      form.querySelectorAll('[data-save-option-item]').forEach(btn => btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-save-option-item');
        const key = btn.getAttribute('data-save-option-key');
        const select = form.querySelector('select[data-option-item-id="' + itemId + '"][data-option-key="' + CSS.escape(key) + '"]');
        const value = select ? select.value : '';
        if (!value) return toast('请选择值', 'bad');
        try {
          await api.json(`/api/order-items/${itemId}/option`, { method: 'PUT', body: JSON.stringify({ key, value }) });
          toast('选项已更新');
          await loadOrders();
        } catch (e) { toast(e.message, 'bad'); }
      }));
      // Save order
      form.querySelector('[data-save-order-edit="' + order.id + '"]').addEventListener('click', async () => {
        const fields = form.querySelectorAll('[data-edit-field]');
        const payload = { order_no: order.order_no };
        const logisticsInput = form.querySelector('[data-edit-field="logistics_cost_rmb"]');
        const logisticsVal = logisticsInput ? Number(logisticsInput.value || 0) : 0;
        const weightInput = form.querySelector('[data-edit-field="weight_kg"]');
        const weightVal = weightInput ? Number(weightInput.value || 0) : 0;
        const trackingInput = form.querySelector('[data-edit-field="tracking_number"]');
        const trackingVal = trackingInput ? String(trackingInput.value || '').trim() : '';
        if (logisticsInput && (!Number.isFinite(logisticsVal) || logisticsVal < 0)) return toast('物流成本必须是非负数', 'bad');
        if (weightInput && (!Number.isFinite(weightVal) || weightVal < 0)) return toast('重量必须是非负数', 'bad');
        if (trackingVal && trackingVal.length > 50) return toast('尾程追踪编码过长', 'bad');
        fields.forEach(f => {
          if (f.dataset.editField === 'logistics_cost_rmb') payload[f.dataset.editField] = logisticsVal;
          else if (f.dataset.editField === 'weight_kg') payload[f.dataset.editField] = weightVal;
          else payload[f.dataset.editField] = f.value;
        });
        try {
          await api.json(`/api/orders/${order.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('订单信息已保存');
          $('editOrderModal').classList.add('hidden');
          await loadOrders();
        } catch (e) { toast(e.message, 'bad'); }
      });
    } else {
      // View mode: bind edit button
      const editBtn = form.querySelector('[data-switch-to-edit]');
      if (editBtn) editBtn.onclick = () => viewOrderModal(orderId, 'edit');
    }
  } catch (e) {
    toast(e.message, 'bad');
  }
}
function renderOrderFinalCostDetailModal(order) {
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const itemRows = (order.items || []).flatMap(it => {
    const c = it.calc_detail || {};
    const b = c.costBreakdown || {};
    const hasLining = Boolean(c.details?.hasLining) || Number(c.liningCostRmb || 0) > 0 || Number(b.liningTheoreticalUsageM || 0) > 0;
    const itemEstimated = Number(it.estimated_cost_rmb ?? c.estimatedCostRmb) || 0;
    const liningEstimated = Number(c.liningCostRmb) || 0;
    const mainEstimated = Math.max(0, itemEstimated - liningEstimated);
    const mainRow = `<tr>
      <td>${esc(normalizeItemCode(it.item_code))}</td>
      <td>主面料</td>
      <td>${fmt(b.mainFabricTheoreticalUsageM)}</td>
      <td>${fmt(b.mainFabricIssuedUsageM)}</td>
      <td>${fmt(c.mainFabricCostRmb)}</td>
      <td>${fmt(c.laborCostRmb)}</td>
      <td>${fmt(c.spliceFeeRmb)}</td>
      <td>${fmt(c.memoryCostRmb)}</td>
      <td>${fmt(hasLining ? mainEstimated : itemEstimated)}</td>
      <td>${fmt(it.factory_cost_total_rmb)}</td>
      <td>${it.factory_settlement_rmb == null ? '待反馈' : fmt(it.factory_settlement_rmb)}</td>
      <td>${fmt(it.final_cost_rmb ?? it.cost_rmb)}</td>
    </tr>`;
    if (!hasLining) return [mainRow];
    const liningRow = `<tr>
      <td>${esc(normalizeItemCode(it.item_code))}</td>
      <td>内衬</td>
      <td>${fmt(b.liningTheoreticalUsageM)}</td>
      <td>${fmt(b.liningIssuedUsageM)}</td>
      <td>${fmt(c.liningCostRmb)}</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>${fmt(liningEstimated)}</td>
      <td>-</td>
      <td>${it.factory_settlement_rmb == null ? '待反馈' : fmt(it.factory_settlement_rmb)}</td>
      <td>-</td>
    </tr>`;
    return [mainRow, liningRow];
  }).join('');
  const finalItems = (order.items || []).reduce((sum, it) => sum + (Number(it.final_cost_rmb) || Number(it.cost_rmb) || 0), 0);
  const estimatedItems = (order.items || []).reduce((sum, it) => sum + (Number(it.estimated_cost_rmb) || Number(it.calc_detail?.estimatedCostRmb) || 0), 0);
  if ($('costDetailContent')) $('costDetailContent').innerHTML = `<div class="cost-grid">
    <div><b>系统预计成本</b><span>${fmt(estimatedItems + logistics)}</span></div>
    <div><b>项目最终成本</b><span>${fmt(finalItems)}</span></div>
    <div><b>物流成本</b><span>${fmt(logistics)}</span></div>
    <div><b>最终成本合计</b><span>${fmt(finalItems + logistics)}</span></div>
  </div>
  <div class="table-wrap detail-table"><table>
    <thead><tr><th>品名/编号</th><th>材料类型</th><th>预计用料米数</th><th>发料用料米数</th><th>材料成本</th><th>加工</th><th>拼接</th><th>定型</th><th>系统预计成本</th><th>工厂实际成本</th><th>工厂结算</th><th>最终成本</th></tr></thead>
    <tbody>${itemRows || '<tr><td colspan="12" class="empty-cell">暂无成本数据。</td></tr>'}</tbody>
  </table></div>`;
}
function orderCostDiagnosticHtml(order) {
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const estimatedItems = (order.items || []).reduce((sum, it) => sum + (Number(it.estimated_cost_rmb) || Number(it.calc_detail?.estimatedCostRmb) || 0), 0);
  const finalItems = (order.items || []).reduce((sum, it) => sum + (Number(it.final_cost_rmb) || Number(it.cost_rmb) || 0), 0);
  const factoryTotal = (order.items || []).reduce((sum, it) => sum + (Number(it.factory_cost_total_rmb) || 0), 0);
  const factorySettlement = (order.items || []).reduce((sum, it) => sum + (Number(it.factory_settlement_rmb) || 0), 0);
  const estimated = estimatedItems + logistics;
  const finalCost = finalItems + logistics;
  const diff = finalCost - estimated;
  const diffRate = estimated > 0 ? diff / estimated : 0;
  const source = (order.items || []).some(it => it.final_cost_source === 'factory_settlement')
    ? 'factory_settlement'
    : (order.items || []).some(it => it.final_cost_source === 'factory_cost_total')
      ? 'factory_cost_total'
      : 'estimated';
  const rows = (order.items || []).map(it => {
    const c = it.calc_detail || {};
    const b = c.costBreakdown || {};
    return `<tr>
      <td>${esc(normalizeItemCode(it.item_code))}</td>
      <td>${fmt(b.mainFabricTheoreticalUsageM)}</td>
      <td>${fmt(b.mainFabricIssuedUsageM)}</td>
      <td>${fmt(b.mainFabricUnitPriceRmb)}</td>
      <td>${fmt(c.mainFabricCostRmb)}</td>
      <td>${fmt(b.liningTheoreticalUsageM)}</td>
      <td>${fmt(b.liningIssuedUsageM)}</td>
      <td>${fmt(b.liningUnitPriceRmb)}</td>
      <td>${fmt(c.liningCostRmb)}</td>
      <td>${fmt(c.laborCostRmb)}</td>
      <td>${fmt(c.spliceFeeRmb)}</td>
      <td>${fmt(c.memoryCostRmb)}</td>
      <td>${fmt(c.optionCostRmb)}</td>
      <td>${fmt(it.estimated_cost_rmb ?? c.estimatedCostRmb)}</td>
      <td>${fmt(it.factory_cost_total_rmb)}</td>
      <td>${fmt(it.factory_settlement_rmb)}</td>
      <td>${fmt(it.final_cost_rmb ?? it.cost_rmb)}</td>
    </tr>`;
  }).join('');
  return `
    <div class="cost-diagnostic">
      <h4>成本诊断</h4>
      <div class="detail-grid">
        <div><b>系统预计成本</b><span>${fmt(estimated)}</span></div>
        <div><b>工厂成本合计</b><span>${fmt(factoryTotal)}</span></div>
        <div><b>工厂结算</b><span>${fmt(factorySettlement)}</span></div>
        <div><b>最终采用成本</b><span>${fmt(finalCost)}</span></div>
        <div><b>最终成本来源</b><span>${esc(costSourceLabel(source))}</span></div>
        <div><b>偏差金额</b><span>${fmt(diff)}</span></div>
        <div><b>偏差比例</b><span>${fmt(diffRate * 100, 1)}%</span></div>
        <div><b>物流成本</b><span>${fmt(logistics)}</span></div>
      </div>
      <div class="table-wrap detail-table"><table>
        <thead><tr><th>品名/编号</th><th>主面料理论m</th><th>主面料发料m</th><th>主面料单价</th><th>主面料成本</th><th>内衬理论m</th><th>内衬发料m</th><th>内衬单价</th><th>内衬成本</th><th>加工</th><th>拼接</th><th>定型</th><th>选项</th><th>系统预计</th><th>工厂成本</th><th>工厂结算</th><th>最终成本</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}
function orderPaymentBreakdown(order) {
  const usdRmb = USD_RMB_RATE;
  const salesUsd = Number(order.total_sales_usd) || 0;
  const taxUsd = Number(order.total_tax_usd) || 0;
  const grossUsd = salesUsd + taxUsd;
  const paypalFeeUsd = grossUsd * PAYPAL_FEE_RATE;
  const incomeAfterFeeUsd = grossUsd - paypalFeeUsd;
  const grossRmb = grossUsd * usdRmb;
  const incomeRmb = incomeAfterFeeUsd * usdRmb;
  const logisticsRmb = Number(order.logistics_cost_rmb) || 0;
  const incomeAfterLogisticsRmb = incomeRmb - logisticsRmb;
  return { salesUsd, taxUsd, grossUsd, grossRmb, paypalFeeUsd, incomeAfterFeeUsd, incomeRmb, logisticsRmb, incomeAfterLogisticsRmb };
}
function renderOrderSalesDetailModal(order) {
  const b = orderPaymentBreakdown(order);
  const hasOverride = order.sales_override_usd != null || order.tax_override_usd != null;
  const content = $('costDetailContent');
  if (!content) return;
  content.innerHTML = `<div class="cost-grid">
    <div><b>销售 USD（不含税）</b><span>${fmt(b.salesUsd)}</span></div>
    <div><b>税费 USD</b><span>${fmt(b.taxUsd)}</span></div>
    <div><b>实际销售 USD（含税）</b><span>${fmt(b.grossUsd)}</span></div>
    <div><b>扣手续费后收入 USD</b><span>${fmt(b.incomeAfterFeeUsd)}</span></div>
    <div><b>扣手续费后收入 RMB</b><span>${fmt(b.incomeRmb)}</span></div>
    <div><b>物流成本 RMB</b><span>${fmt(b.logisticsRmb)}</span></div>
    <div><b>手续费与物流后收入 RMB</b><span>${fmt(b.incomeAfterLogisticsRmb)}</span></div>
  </div>
  <div class="financial-edit">
    <h4>金额修正${hasOverride ? '（已启用）' : ''}</h4>
    <div class="form-grid">
      <label>销售 USD（不含税）<input type="number" step="0.01" min="0" value="${fmt(b.salesUsd)}" data-financial-sales="${order.id}"></label>
      <label>税费 USD<input type="number" step="0.01" min="0" value="${fmt(b.taxUsd)}" data-financial-tax="${order.id}"></label>
    </div>
    <div class="actions">
      <button class="btn small primary" type="button" data-save-financial="${order.id}">保存金额修正</button>
      <button class="btn small secondary" type="button" data-clear-financial="${order.id}">恢复系统计算</button>
    </div>
  </div>`;
  const saveBtn = content.querySelector(`[data-save-financial="${order.id}"]`);
  const clearBtn = content.querySelector(`[data-clear-financial="${order.id}"]`);
  if (saveBtn) saveBtn.onclick = async () => {
    const sales = Number(content.querySelector(`[data-financial-sales="${order.id}"]`)?.value || 0);
    const tax = Number(content.querySelector(`[data-financial-tax="${order.id}"]`)?.value || 0);
    if (!Number.isFinite(sales) || sales < 0 || !Number.isFinite(tax) || tax < 0) {
      toast('销售金额和税费必须是非负数字', 'bad');
      return;
    }
    const res = await api.json(`/api/orders/${order.id}/financial`, {
      method: 'PUT',
      body: JSON.stringify({ sales_usd: sales, tax_usd: tax })
    });
    renderOrderSalesDetailModal(res.order);
    await loadOrders();
    toast('金额修正已保存');
  };
  if (clearBtn) clearBtn.onclick = async () => {
    const res = await api.json(`/api/orders/${order.id}/financial`, {
      method: 'PUT',
      body: JSON.stringify({ clear: true })
    });
    renderOrderSalesDetailModal(res.order);
    await loadOrders();
    toast('已恢复系统计算金额');
  };
}
function selectedOptions(product) {
  const out = {};
  (product?.options || []).forEach(o => out[o.option_key || o.key] = $(`opt_${o.option_key || o.key}`)?.value || '');
  return out;
}
function selectedOptionRows(product) {
  return (product?.options || []).map(o => {
    const key = o.option_key || o.key;
    const value = $(`opt_${key}`)?.value || '';
    const found = (o.values || []).find(v => String(v.label) === String(value)) || {};
    return {
      key,
      label: o.label || key,
      value,
      priceUsd: Number(found.price_usd ?? found.price ?? 0)
    };
  });
}
function renderOptionQuoteList(product = activeProduct()) {
  const list = $('optionQuoteList');
  if (!list) return;
  const rows = selectedOptionRows(product).filter(r => r.value);
  const total = rows.reduce((sum, r) => sum + r.priceUsd, 0);
  if ($('optionQuoteTotal')) $('optionQuoteTotal').textContent = usd(total);
  if (!rows.length) {
    list.innerHTML = '<div class="option-quote-empty">选择产品后显示选项报价</div>';
    return;
  }
  list.innerHTML = rows.map(r => `
    <div class="option-quote-row">
      <div>
        <b>${esc(r.label)}</b>
        <span>${esc(r.value)}</span>
      </div>
      <strong>${usd(r.priceUsd)}</strong>
    </div>
  `).join('');
}
function itemPayload() {
  const p = activeProduct();
  const useDiscount = $('applyDiscountToggle')?.checked;
  const options = selectedOptions(p);
  return {
    product_id: p?.id,
    qty: Number($('itemQty').value) || 1,
    width_in: Number($('itemWidth').value) || 0,
    length_in: Number($('itemLength').value) || 0,
    fabric_id: resolveProductFabricId(p),
    lining_id: resolveLiningIdFromOptions(p, options),
    fullness: Number($('itemFullness').value) || p?.default_fullness || 2,
    selected_options: options,
    actual_paid_usd: Number($('actualPaidUsd').value) || 0,
    apply_discount: useDiscount,
    discount_mode: $('discountMode')?.value || 'percent',
    discount_value: Number($('discountUsd').value) || 0,
    tax_rate: 0,
    room_label: '',
    remark: $('itemRemark')?.value || ''
  };
}
async function updatePreview() {
  try {
    const payload = itemPayload();
    if (!payload.product_id || !payload.width_in || !payload.length_in) return;
    const res = await api.json('/api/calc/item', { method: 'POST', body: JSON.stringify(payload) });
    state.preview = res;
    const discountEnabled = $('applyDiscountToggle')?.checked;
    const discountMode = $('discountMode')?.value || 'percent';
    const discountInput = Number($('discountUsd')?.value) || 0;
    const discountAmount = discountEnabled ? (discountMode === 'percent' ? res.systemPriceUsd * discountInput / 100 : discountInput) : 0;
    const discountedPrice = Math.max(0, res.systemPriceUsd - discountAmount);
    if ($('previewPrice')) $('previewPrice').textContent = usd(res.systemPriceUsd);
    if ($('previewDiscountedPrice')) $('previewDiscountedPrice').textContent = usd(discountedPrice);
  } catch (e) {
    toast(e.message, 'bad');
  }
}
function renderOrderForm() {
  if ($('itemProduct')) fillSelect($('itemProduct'), state.products.filter(p => p.enabled !== false).map(p => ({ value: p.id, label: p.name })));
  if ($('spFabric')) fillSelect($('spFabric'), state.fabrics.filter(f => f.enabled).map(f => ({ value: f.id, label: f.name })));
  if ($('spLining')) fillSelect($('spLining'), [{ value: '', label: '无内衬' }, ...state.linings.filter(l => l.enabled).map(l => ({ value: l.id, label: l.name }))]);
  if ($('applyTaxToggle')) $('applyTaxToggle').checked = false;
  if ($('applyDiscountToggle')) $('applyDiscountToggle').checked = false;
  if ($('orderDate') && !$('orderDate').value) $('orderDate').value = today();
  if ($('deliveryDate') && $('orderDate')?.value) $('deliveryDate').value = addDays($('orderDate').value, 4);
  renderDynamicOptions();
}
function renderDynamicOptions() {
  const p = activeProduct();
  if ($('itemFullness')) $('itemFullness').value = p?.default_fullness || p?.defaultFullness || 2;
  if ($('dynamicOptions')) $('dynamicOptions').innerHTML = (p?.options || []).map(o => {
    const key = o.option_key || o.key;
    const opts = (o.values || []).map(v => `<option value="${esc(v.label)}">${esc(v.label)}${Number(v.price_usd || v.price) ? ` (+$${fmt(v.price_usd || v.price)})` : ''}</option>`).join('');
    return `<label>${esc(o.label)}<select id="opt_${esc(key)}">${opts}</select></label>`;
  }).join('');
  (p?.options || []).forEach(o => $(`opt_${o.option_key || o.key}`)?.addEventListener('change', () => {
    renderOptionQuoteList(p);
    updatePreview();
  }));
  renderOptionQuoteList(p);
  updatePreview();
}

function renderCurrentItems() {
  const items = state.currentItems || [];
  const table = $('orderItemsTable');
  const countEl = $('currentCount');
  if (!table) return;
  if (!items.length) {
    table.innerHTML = '<thead><tr><th>品名</th><th>尺寸</th><th>数量</th><th>系统售价</th><th>操作</th></tr></thead><tbody><tr><td colspan="5" class="empty-cell">暂无项目</td></tr></tbody>';
    if (countEl) countEl.textContent = '0 项';
    return;
  }
  const rows = items.map((it, idx) => {
    const p = state.products.find(pp => pp.id === it.payload.product_id) || {};
    const calc = it.calc || {};
    const name = esc(p.name || it.payload.product_id || '-');
    const w = it.payload.width_in || 0;
    const l = it.payload.length_in || 0;
    const size = w && l ? (w + ' x ' + l + ' inch') : '-';
    const priceUsd = Number(calc.systemPriceUsd) || 0;
    const priceRmb = priceUsd * USD_RMB_RATE;
    return '<tr>' +
      '<td>' + name + '</td>' +
      '<td>' + size + '</td>' +
      '<td>' + (it.payload.qty || 1) + '</td>' +
      '<td>' + usd(priceUsd) + ' / ' + rmb(priceRmb) + '</td>' +
      '<td><button class="btn small danger" onclick="state.currentItems.splice(' + idx + ', 1); renderCurrentItems();">删除</button></td>' +
    '</tr>';
  }).join('');
  const totalQty = items.reduce((s, it) => s + (it.payload.qty || 1), 0);
  table.innerHTML = '<thead><tr><th>品名</th><th>尺寸</th><th>数量</th><th>系统售价</th><th>操作</th></tr></thead><tbody>' + rows +
    '<tr class="order-summary-row"><td colspan="2"><b>合计</b></td><td>' + totalQty + '</td><td></td><td></td></tr></tbody>';
  if (countEl) countEl.textContent = items.length + ' 项';
}

async function addItem() {
  await updatePreview();
  if (!state.preview) return toast('请先完成项目计算', 'bad');
  state.currentItems.push({ payload: itemPayload(), calc: state.preview });
  renderCurrentItems();
  const continueEntry = confirm('已添加到当前订单。\n\n是否继续录入下一个产品？\n\n点击“确定”继续录入（仅清空尺寸），点击“取消”结束录入。');
  if (continueEntry) {
    if ($('itemWidth')) $('itemWidth').value = '';
    if ($('itemLength')) $('itemLength').value = '';
    if ($('itemRemark')) $('itemRemark').value = '';
    updatePreview();
  } else {
    ['itemWidth','itemLength','itemRemark'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('itemQty').value = 1;
    document.getElementById('actualPaidUsd').value = 0;
    document.getElementById('discountMode').value = 'percent';
    document.getElementById('discountUsd').value = 0;
    const applyDiscountToggle = document.getElementById('applyDiscountToggle');
    if (applyDiscountToggle) applyDiscountToggle.checked = false;
    document.querySelectorAll('#dynamicOptions select').forEach(sel => { if (sel.options.length) sel.selectedIndex = 0; });
    document.getElementById('discountMode').dispatchEvent(new Event('change'));
    updatePreview();
  }
}
async function saveOrder() {
  if (!state.currentItems.length) {
    await updatePreview();
    if (state.preview) state.currentItems = [{ payload: itemPayload(), calc: state.preview }];
  }
  if (!state.currentItems.length) return toast('当前订单没有项目', 'bad');
  const btn = $('saveOrderBtn');
  btn?.classList.add('loading');
  btn.disabled = true;
  try {
    const body = {
      channel: ORDER_CHANNEL,
      order_no: $('orderNo').value,
      order_date: $('orderDate').value,
      delivery_date: $('deliveryDate').value,
      customer_name: $('customerName').value,
      customer_email: $('customerEmail').value,
      customer_phone: $('customerPhone').value,
      customer_address: $('shippingAddress').value,
      remark: $('orderRemark').value,
      items: state.currentItems.map(x => x.payload)
    };
    const res = await api.json('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    state.lastOrderId = res.order.id;
    state.currentItems = [];
    localStorage.removeItem('twodrapes_order_draft');
    renderCurrentItems();
    await loadOrders();
    toast('订单已保存，并已同步到管理端');

    // 清空下单页面
    ['orderNo','customerName','customerEmail','customerPhone','shippingAddress','orderRemark','itemWidth','itemLength','itemRemark'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if ($('orderDate')) $('orderDate').value = today();
    if ($('deliveryDate') && $('orderDate')?.value) $('deliveryDate').value = addDays($('orderDate').value, 4);
    document.getElementById('itemQty').value = 1;
    document.getElementById('actualPaidUsd').value = 0;
    document.getElementById('discountMode').value = 'percent';
    document.getElementById('discountUsd').value = 0;
    const applyDiscountToggle = document.getElementById('applyDiscountToggle');
    if (applyDiscountToggle) applyDiscountToggle.checked = false;
    document.querySelectorAll('#dynamicOptions select').forEach(sel => { if (sel.options.length) sel.selectedIndex = 0; });
    document.getElementById('discountMode').dispatchEvent(new Event('change'));
    updatePreview();
  } finally {
    btn?.classList.remove('loading');
    btn.disabled = false;
  }
}
function orderStatusInfo(order) {
  const map = {
    draft: { label: '草稿', cls: 'muted' },
    production: { label: '待生产', cls: 'warn' },
    shipping: { label: '待发货', cls: 'ship' },
    completed: { label: '完成', cls: 'good' }
  };
  const key = order.status || 'draft';
  return { key, ...(map[key] || { label: '未知', cls: 'muted' }) };
}
function profitClass(rate, profit) {
  if ((Number(profit) || 0) < 0 || (Number(rate) || 0) < .1) return 'bad';
  if ((Number(rate) || 0) < .3) return 'warn';
  return 'good';
}
function orderSearchText(order) {
  const items = order.items || [];
  return [
    order.order_no,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.order_date,
    order.delivery_date,
    ...items.flatMap(it => [it.item_code, it.product_name, it.fabric_name, it.lining_name, it.room_label, it.remark])
  ].join(' ').toLowerCase();
}
function currentOrderFilters() {
  return {
    q: ($('ordersSearchInput')?.value || '').trim().toLowerCase(),
    from: $('ordersDateFrom')?.value || '',
    to: $('ordersDateTo')?.value || '',
    status: $('ordersStatusFilter')?.value || '',
    product: $('ordersProductFilter')?.value || ''
  };
}
function filteredOrders() {
  const f = currentOrderFilters();
  return (state.ordersCache || []).filter(order => {
    const status = orderStatusInfo(order);
    if (f.q && !orderSearchText(order).includes(f.q)) return false;
    if (f.from && String(order.order_date || '') < f.from) return false;
    if (f.to && String(order.order_date || '') > f.to) return false;
    if (f.status && status.key !== f.status) return false;
    if (f.product && !(order.items || []).some(it => String(it.product_id || it.product_name || '') === f.product)) return false;
    return true;
  });
}
function populateOrdersProductFilter() {
  const select = $('ordersProductFilter');
  if (!select) return;
  const current = select.value;
  const products = new Map();
  (state.ordersCache || []).forEach(order => (order.items || []).forEach(it => {
    const key = String(it.product_id || it.product_name || '').trim();
    if (key) products.set(key, it.product_name || key);
  }));
  select.innerHTML = '<option value="">全部产品</option>' + Array.from(products.entries())
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if (products.has(current)) select.value = current;
}
function renderOrdersBulkBar() {
  const selected = Array.from(state.selectedOrderIds || []);
  if ($('ordersSelectedCount')) $('ordersSelectedCount').textContent = `已选 ${selected.length} 项`;
  $('ordersBulkBar')?.classList.toggle('hidden', selected.length === 0);
}
function exportSelectedOrdersCsv() {
  const ids = new Set(state.selectedOrderIds || []);
  const rows = (state.ordersCache || []).filter(o => ids.has(String(o.id)));
  if (!rows.length) return toast('请先选择订单', 'bad');
  const headers = ['订单号', '客户', '下单日期', '交期', '销售RMB', '成本RMB', '状态'];
  const csvRows = [headers, ...rows.map(o => {
    const status = orderStatusInfo(o);
    return [o.order_no || o.id, o.customer_name || '', o.order_date || '', o.delivery_date || '', fmt(o.total_net_sales_rmb), fmt(o.total_cost_rmb), status.label];
  })].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csvRows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-selected-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function renderOrdersPanel() {
  populateOrdersProductFilter();
  const all = filteredOrders();
  const totalPages = Math.max(1, Math.ceil(all.length / state.ordersPageSize));
  state.ordersPage = Math.min(Math.max(1, state.ordersPage), totalPages);
  const start = (state.ordersPage - 1) * state.ordersPageSize;
  const pageRows = all.slice(start, start + state.ordersPageSize);
  const headers = [
    '<input type="checkbox" id="ordersCheckAll">',
    '订单',
    '客户',
    '下单日期',
    '交期',
    '项目',
    '小计',
    '状态'
  ];
  const body = pageRows.length ? pageRows.flatMap((o, i) => {
    const items = o.items || [];
    const totalCount = items.length;
    const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const summaryText = totalCount ? `${totalCount}项 / ${totalQty || 0}条` : '无项目';
    const status = orderStatusInfo(o);
    const profitRate = Number(o.total_profit_rate) || 0;
    const profitCls = profitClass(profitRate, o.total_profit_rmb);
    const checked = state.selectedOrderIds.has(String(o.id)) ? ' checked' : '';
    const salesUsd = Number(o.total_sales_usd || 0);
    const itemSummary = items.length ? `<div class="order-items-list">${items.map(it => {
      const name = esc(it.product_name || '产品');
      const fabric = esc(it.fabric_name || '');
      const opts = it.selected_options || {};
      const prod = state.products.find(p => p.id === it.product_id) || {};
      const colorGroup = (prod.options || []).find(g => g.label === 'Color');
      const color = colorGroup ? (opts[colorGroup.option_key] || '') : '';
      const w = fmt(Number(it.width_in) || 0);
      const l = fmt(Number(it.length_in) || 0);
      const qty = Number(it.qty) || 1;
      const qtyLabel = qty > 1 ? ` x${qty}` : '';
      const details = [];
      if (color) details.push(`<span>颜色: ${esc(color)}</span>`);
      if (fabric) details.push(`<span>面料: ${fabric}</span>`);
      details.push(`<span>尺寸: ${w} x ${l} inch</span>`);
      return `<div class="order-item-expand"><span class="order-item-name">${name}${qtyLabel}</span><div class="order-item-detail">${details.join('')}</div></div>`;
    }).join('')}</div>` : '<span class="order-count-muted">无项目</span>';
    const headerRow = `<tr class="order-group-header" data-order-id="${o.id}">
      <td data-label="选择" class="order-select-cell"><input class="order-select-box" type="checkbox" data-order-check="${o.id}"${checked}></td>
      <td data-label="订单">
        <div class="order-primary">
          <strong class="order-no-link" data-view-modal="${o.id}"${totalCount ? '' : ' disabled'} style="cursor:pointer">${esc(o.order_no || '#' + o.id)}</strong>
        </div>
      </td>
      <td data-label="客户"><span class="order-customer">${esc(o.customer_name || '-')}</span></td>
      <td data-label="下单日期"><span class="order-date">${o.order_date || '-'}</span></td>
      <td data-label="交期"><span class="order-date">${o.delivery_date || '-'}</span></td>
      <td data-label="项目">${itemSummary}</td>
      <td data-label="小计"><span class="order-money">${usd(salesUsd)}</span></td>
      <td data-label="状态">
        <select class="order-status-select ${status.cls}" data-order-status="${o.id}">
          <option value="draft"${status.key === 'draft' ? ' selected' : ''}>草稿</option>
          <option value="production"${status.key === 'production' ? ' selected' : ''}>待生产</option>
          <option value="shipping"${status.key === 'shipping' ? ' selected' : ''}>待发货</option>
          <option value="completed"${status.key === 'completed' ? ' selected' : ''}>完成</option>
        </select>
      </td>
    </tr>`;
    return [headerRow];
  }) : ['<tr><td colspan="8" class="empty-cell">未找到匹配的订单</td></tr>'];
  table($('ordersTable'), headers, body);
  const visibleIds = pageRows.map(o => String(o.id));
  if ($('ordersCheckAll')) {
    $('ordersCheckAll').checked = visibleIds.length > 0 && visibleIds.every(id => state.selectedOrderIds.has(id));
    $('ordersCheckAll').onchange = () => {
      visibleIds.forEach(id => $('ordersCheckAll').checked ? state.selectedOrderIds.add(id) : state.selectedOrderIds.delete(id));
      document.querySelectorAll('[data-order-check]').forEach(input => { input.checked = $('ordersCheckAll').checked; });
      renderOrdersBulkBar();
    };
  }
  document.querySelectorAll('[data-order-check]').forEach(input => {
    input.onchange = () => {
      const id = String(input.dataset.orderCheck);
      input.checked ? state.selectedOrderIds.add(id) : state.selectedOrderIds.delete(id);
      renderOrdersBulkBar();
      if ($('ordersCheckAll')) $('ordersCheckAll').checked = visibleIds.length > 0 && visibleIds.every(x => state.selectedOrderIds.has(x));
    };
  });
  document.querySelectorAll('[data-order-status]').forEach(select => {
    select.onchange = async () => {
      const orderId = select.dataset.orderStatus;
      const newStatus = select.value;
      const label = orderStatusInfo({ status: newStatus }).label;
      const cached = (state.ordersCache || []).find(o => String(o.id) === String(orderId));
      const prevStatus = cached ? cached.status : null;
      if (cached) cached.status = newStatus;
      renderOrdersPanel();
      try {
        await api.json(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
        toast(`状态已更新为「${label}」`);
      } catch (e) {
        if (cached && prevStatus) cached.status = prevStatus;
        renderOrdersPanel();
        toast(e.message, 'bad');
      }
    };
  });
  document.querySelectorAll('[data-view-modal]').forEach(btn => {
    btn.onclick = () => viewOrderModal(btn.dataset.viewModal, 'view');
  });
  if ($('ordersPager')) {
    $('ordersPager').innerHTML = `
      <span>共 ${all.length} 条</span>
      <button class="btn small secondary" id="ordersPrevPage" type="button"${state.ordersPage <= 1 ? ' disabled' : ''}>上一页</button>
      <span>第 ${state.ordersPage} / ${totalPages} 页</span>
      <button class="btn small secondary" id="ordersNextPage" type="button"${state.ordersPage >= totalPages ? ' disabled' : ''}>下一页</button>
      <label>每页 <select id="ordersPageSize"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select> 条</label>
    `;
    $('ordersPageSize').value = String(state.ordersPageSize);
    $('ordersPrevPage').onclick = () => { state.ordersPage -= 1; loadOrders(); };
    $('ordersNextPage').onclick = () => { state.ordersPage += 1; loadOrders(); };
    $('ordersPageSize').onchange = () => { state.ordersPageSize = Number($('ordersPageSize').value) || 50; state.ordersPage = 1; loadOrders(); };
  }
  renderOrdersBulkBar();
}
async function loadOrders() {
  const rows = await api.json(`/api/orders?channel=${ORDER_CHANNEL}`);
  state.ordersCache = rows;
  const validIds = new Set(state.ordersCache.map(o => String(o.id)));
  state.selectedOrderIds = new Set(Array.from(state.selectedOrderIds || []).filter(id => validIds.has(String(id))));
  renderOrdersPanel();

}
let profitCurrentOrder = null;
let profitCurrentDetails = null;
function profitOrderLabel(order) {
  if (!order) return '';
  return `${order.order_no || '#' + order.id} - ${order.customer_name || '未知'} - ${order.order_date || ''}`;
}
function profitOrderSearchText(order) {
  return [
    order.id,
    order.order_no,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.order_date
  ].filter(Boolean).join(' ').toLowerCase();
}
function closeProfitOrderResults() {
  const results = $('profitOrderSearchResults');
  if (results) results.classList.add('hidden');
}
function selectProfitOrder(order) {
  const sel = $('profitOrderSelect');
  const input = $('profitOrderSearchInput');
  if (!sel || !input) return;
  sel.value = order ? String(order.id) : '';
  input.value = order ? profitOrderLabel(order) : '';
  closeProfitOrderResults();
}
function renderProfitOrderSearchResults(query = '') {
  const results = $('profitOrderSearchResults');
  if (!results) return;
  const q = String(query || '').trim().toLowerCase();
  const matches = state.profitOrderChoices
    .filter(order => !q || profitOrderSearchText(order).includes(q))
    .slice(0, 30);

  if (!matches.length) {
    results.innerHTML = '<div class="profit-order-empty">未找到匹配订单</div>';
    results.classList.remove('hidden');
    return;
  }

  results.innerHTML = matches.map(order => `
    <button type="button" class="profit-order-option" data-profit-order-id="${order.id}" role="option">
      <span>${esc(order.order_no || '#' + order.id)}</span>
      <small>${esc(order.customer_name || '未知')} | ${esc(order.order_date || '')}</small>
    </button>
  `).join('');
  results.classList.remove('hidden');
  results.querySelectorAll('[data-profit-order-id]').forEach(btn => {
    btn.onclick = () => selectProfitOrder(state.profitOrderChoices.find(order => String(order.id) === btn.dataset.profitOrderId));
  });
}
async function loadProfitOrderList() {
  const orders = await api.json(`/api/orders?channel=${ORDER_CHANNEL}`);
  const sel = $('profitOrderSelect');
  if (!sel) return;
  const previous = sel.value;
  state.profitOrderChoices = orders;
  sel.innerHTML = '<option value="">选择值订单...</option>' +
    orders.map(o => `<option value="${o.id}">${esc(profitOrderLabel(o))}</option>`).join('');
  const selected = orders.find(o => String(o.id) === String(previous));
  selectProfitOrder(selected || null);
}
async function loadProfitDetail() {
  const orderId = $('profitOrderSelect')?.value;
  if (!orderId) { toast('请先选择一个订单', 'warn'); return; }
  const order = await api.json(`/api/orders/${orderId}`);
  profitCurrentOrder = order;
  profitCurrentDetails = order;
  if ($('profitOrderLabel')) {
    $('profitOrderLabel').textContent = order.order_no || '#' + order.id;
    $('profitOrderLabel').className = 'pill';
  }
  const payment = orderPaymentBreakdown(order);
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const totalCost = Number(order.total_cost_rmb) || 0;
  const totalProfit = Number(order.total_profit_rmb) || 0;
  const profitRate = Number(order.total_profit_rate) || 0;
  const items = order.items || [];
  const hasActualCost = items.some(it => it.final_cost_source === 'factory_settlement' || it.final_cost_source === 'factory_cost_total');
  const costLabel = hasActualCost ? '实际成本' : '预计成本';
  const profitLabel = hasActualCost ? '实际利润' : '预计利润';
  const rateLabel = hasActualCost ? '实际利润率' : '预计利润率';
  $('profitDetailEmpty')?.classList.add('hidden');
  $('profitDetailContent')?.classList.remove('hidden');
  if ($('profitDetailContent')) $('profitDetailContent').innerHTML =
    '<div class="metrics">' +
    '<div><label>实际销售（USD）</label><b>' + usd(payment.grossUsd) + '</b></div>' +
    '<div><label>PayPal 手续费（USD）</label><b>' + usd(payment.paypalFeeUsd) + '</b></div>' +
    '<div><label>扣除手续费后收入（USD）</label><b>' + usd(payment.incomeAfterFeeUsd) + '</b></div>' +
    '<div><label>物流成本（RMB）</label><b>' + rmb(logistics) + '</b></div>' +
    '<div><label>' + costLabel + '（RMB）</label><b>' + rmb(totalCost) + '</b></div>' +
    '<div><label>' + profitLabel + '（RMB）</label><b>' + rmb(totalProfit) + '</b></div>' +
    '<div><label>' + rateLabel + '</label><b>' + fmt(profitRate * 100, 1) + '%</b></div>' +
    '</div>';
  if (items.length) {
    $('profitItemsCard')?.classList.remove('hidden');
    const itemRows = items.map(it => {
      const itSalesUsd = Number(it.sales_usd) || 0;
      const itCostRmb = Number(it.final_cost_rmb) || Number(it.cost_rmb) || 0;
      const itProfit = (itSalesUsd * USD_RMB_RATE) - itCostRmb;
      const itRate = itSalesUsd * USD_RMB_RATE > 0 ? itProfit / (itSalesUsd * USD_RMB_RATE) : 0;
      return `<tr>
        <td>${esc(normalizeItemCode(it.item_code))}</td>
        <td>${fmt(it.width_in, 0)} x ${fmt(it.length_in, 0)}</td>
        <td>${it.qty || 1}</td>
        <td>${usd(itSalesUsd)}</td>
        <td>${fmt(itCostRmb)}</td>
        <td>${fmt(itProfit)}</td>
        <td>${fmt(itRate * 100, 1)}%</td>
      </tr>`;
    });
    table($('profitItemsTable'), ['品名/编号', '尺寸 inch', '数量', '销售 USD', '成本 RMB', '利润 RMB', '利润率'], itemRows);
  } else {
    $('profitItemsCard')?.classList.add('hidden');
  }
  renderProfitAdjustForm(order, payment);
}
function renderProfitAdjustForm(order, payment) {
  const logistics = Number(order.logistics_cost_rmb) || 0;
  const salesOverride = order.sales_override_usd != null ? Number(order.sales_override_usd) : '';
  const taxOverride = order.tax_override_usd != null ? Number(order.tax_override_usd) : '';
  const form = $('profitAdjustForm');
  if (!form) return;
  form.innerHTML =
    '<div class="form-grid compact">' +
    '<label>物流成本 RMB<input type="number" id="profitAdjLogistics" step="0.01" min="0" value="' + fmt(logistics) + '"></label>' +
    '<label>销售 USD 覆盖<input type="number" id="profitAdjSales" step="0.01" min="0" value="' + salesOverride + '" placeholder="留空使用系统值"></label>' +
    '<label>税费 USD 覆盖<input type="number" id="profitAdjTax" step="0.01" min="0" value="' + taxOverride + '" placeholder="留空使用系统值"></label>' +
    '</div>' +
    '<div class="actions"><button class="btn primary small" id="profitRecalcBtn">重新计算利润</button></div>';
  $('profitRecalcBtn').onclick = async () => {
    const newLogistics = Number($('profitAdjLogistics').value || 0);
    const salesVal = $('profitAdjSales').value.trim();
    const taxVal = $('profitAdjTax').value.trim();
    try {
      await api.json(`/api/orders/${order.id}/logistics`, { method: 'PUT', body: JSON.stringify({ logistics_cost_rmb: newLogistics }) });
      if (salesVal !== '' || taxVal !== '') {
        const payload = { sales_usd: salesVal !== '' ? Number(salesVal) : 0, tax_usd: taxVal !== '' ? Number(taxVal) : 0 };
        if (salesVal === '' && taxVal !== '') payload.sales_usd = Number(payment.salesUsd);
        if (taxVal === '' && salesVal !== '') payload.tax_usd = Number(payment.taxUsd);
        await api.json(`/api/orders/${order.id}/financial`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      toast('利润已重新计算');
      await loadProfitDetail();
    } catch (e) { toast(e.message, 'bad'); }
  };
}
function spliceNeedText(plan) {
  if (!plan) return '-';
  return plan.needSplice ? '需要拼接' : '无需拼接';
}
function spliceCutDirectionText(direction) {
  if (direction === 'horizontal') return '横裁';
  if (direction === 'vertical') return '纵裁';
  if (direction === 'none') return '无';
  return direction || '-';
}
function spliceSummaryHtml(items, note = '') {
  return `<div class="splice-summary-grid">${items.map(item => `
    <div class="splice-summary-item">
      <b>${esc(item.label)}</b>
      <span>${esc(item.value)}</span>
    </div>`).join('')}</div>${note ? `<div class="splice-summary-note">${esc(note)}</div>` : ''}`;
}
function spliceOrderLabel(order) {
  if (!order) return '';
  return `${order.order_no || '#' + order.id} - ${order.customer_name || '未知客户'}`;
}
function syncSpliceOrderSelect(orderId) {
  const sel = $('spliceOrderSelect');
  if (!sel) return;
  const value = String(orderId || '');
  if (!value) {
    sel.value = '';
    return;
  }
  if (!Array.from(sel.options).some(opt => opt.value === value)) {
    const order = state.spliceOrderChoices.find(o => String(o.id) === value);
    sel.add(new Option(order ? spliceOrderLabel(order) : value, value));
  }
  sel.value = value;
}
function clearSpliceOrderSelection() {
  state.spliceSelectedOrderId = '';
  syncSpliceOrderSelect('');
  if ($('spliceOrderSearchInput')) $('spliceOrderSearchInput').value = '';
  if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = '未选择订单';
  $('spliceOrderItems')?.classList.add('hidden');
  $('spliceOrderResults')?.classList.add('hidden');
  updateSpliceSelectionState();
}
function selectSpliceOrder(order) {
  if (!order) {
    clearSpliceOrderSelection();
    return;
  }
  state.spliceSelectedOrderId = String(order.id);
  syncSpliceOrderSelect(order.id);
  if ($('spliceOrderSearchInput')) $('spliceOrderSearchInput').value = spliceOrderLabel(order);
  $('spliceOrderSearchResults')?.classList.add('hidden');
  loadSpliceOrderItems();
}
async function loadSpliceOrderList() {
  const currentId = state.spliceSelectedOrderId || $('spliceOrderSelect')?.value || '';
  try {
    const rows = await api.json(`/api/orders?channel=${ORDER_CHANNEL}`);
    state.spliceOrderChoices = Array.isArray(rows) ? rows : [];
    const sel = $('spliceOrderSelect');
    if (sel) {
      sel.innerHTML = '<option value="">选择订单...</option>' + state.spliceOrderChoices.map(o => `<option value="${esc(o.id)}">${esc(spliceOrderLabel(o))}</option>`).join('');
    }
    const current = state.spliceOrderChoices.find(o => String(o.id) === String(currentId));
    if (current) {
      state.spliceSelectedOrderId = String(current.id);
      syncSpliceOrderSelect(current.id);
      if ($('spliceOrderSearchInput')) $('spliceOrderSearchInput').value = spliceOrderLabel(current);
      await loadSpliceOrderItems();
    } else if (!currentId) {
      clearSpliceOrderSelection();
    } else {
      clearSpliceOrderSelection();
    }
  } catch (e) {
    toast('加载订单列表失败: ' + e.message, 'bad');
  }
}
function renderManualSpliceSummary(res) {
  const plans = [res.mainPlan, res.liningPlan].filter(Boolean);
  const totalMeters = plans.reduce((sum, p) => sum + (Number(p.fabricMeters) || 0), 0);
  const spliceCount = plans.filter(p => p.needSplice).length;
  if ($('manualSpliceSummary')) $('manualSpliceSummary').textContent = spliceCount ? `${spliceCount} 项需拼接` : '无需拼接';
  if ($('manualSpliceResult')) {
    $('manualSpliceResult').classList.remove('empty');
    $('manualSpliceResult').innerHTML = spliceSummaryHtml([
      { label: '主面料', value: spliceNeedText(res.mainPlan) },
      { label: '内衬', value: res.liningPlan ? spliceNeedText(res.liningPlan) : '无内衬' },
      { label: '合计用料', value: `${fmt(totalMeters)} m` },
      { label: '提示', value: `${(res.warnings || []).length} 条` }
    ], res.mainPlan?.description || '');
  }
}
function updateSpliceSelectionState() {
  const all = Array.from(document.querySelectorAll('.splice-item-check'));
  const checked = all.filter(cb => cb.checked);
  if ($('spliceSelectedCount')) $('spliceSelectedCount').textContent = `已选 ${checked.length} / ${all.length} 项`;
  if ($('spliceCheckAll')) $('spliceCheckAll').checked = all.length > 0 && checked.length === all.length;
  if ($('spliceSelectAllBtn')) $('spliceSelectAllBtn').textContent = checked.length === all.length && all.length ? '取消全选' : '全选';
}
async function calcSplice() {
  const fabricEl = $('spFabric');
  const widthEl = $('spWidth');
  const lengthEl = $('spLength');
  const qtyEl = $('spQty');
  const fullnessEl = $('spFullness');
  const liningEl = $('spLining');
  if (!fabricEl || !widthEl || !lengthEl || !qtyEl || !fullnessEl) return;
  const liningId = liningEl?.value || '';
  const hasLining = !!liningId && liningId !== 'lining_none';
  const btn = $('calcSpliceBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await api.json('/api/calc/splice', { method: 'POST', body: JSON.stringify({ fabric_id: fabricEl.value, width_in: widthEl.value, length_in: lengthEl.value, qty: qtyEl.value, fullness: fullnessEl.value, has_lining: hasLining, lining_id: liningId }) });
    renderManualSpliceSummary(res);
    const rows = [['主面料', res.mainPlan], ['内衬', res.liningPlan]].filter(x => x[1]).map(([name, p]) => `<tr><td>${name}</td><td>${spliceCutDirectionText(p.cutDirection)}</td><td>${p.needSplice ? '是' : '否'}</td><td>${p.panelsNeeded}</td><td>${fmt(p.fabricMeters)}</td><td>${esc(p.description)}</td></tr>`);
    table($('manualSpliceTable'), ['材料', '裁法', '是否拼接', '幅数', '用料 m', '说明'], rows);
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function loadSpliceOrderItems() {
  const orderId = state.spliceSelectedOrderId || $('spliceOrderSelect')?.value;
  if (!orderId) {
    $('spliceOrderItems')?.classList.add('hidden');
    $('spliceOrderResults')?.classList.add('hidden');
    if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = '未选择订单';
    updateSpliceSelectionState();
    return;
  }
  try {
    state.spliceSelectedOrderId = String(orderId);
    syncSpliceOrderSelect(orderId);
    const order = await api.json(`/api/orders/${orderId}`);
    const items = order.items || [];
    if ($('spliceOrderSummary')) $('spliceOrderSummary').textContent = `${order.order_no || '#' + order.id} / ${items.length} 项`;
    if (!items.length) { $('spliceOrderItems')?.classList.add('hidden'); toast('该订单无项目', 'warn'); updateSpliceSelectionState(); return; }
    $('spliceOrderItems')?.classList.remove('hidden');
    $('spliceOrderResults')?.classList.add('hidden');
    const rows = items.map((it, idx) => {
      const checked = ' checked';
      return `<tr>
        <td><input type="checkbox" class="splice-item-check" data-splice-idx="${idx}"${checked}></td>
        <td>${esc(it.item_code || '')}</td>
        <td>${esc(it.product_name || '')}</td>
        <td>${fmt(Number(it.width_in) || 0, 0)} x ${fmt(Number(it.length_in) || 0, 0)}</td>
        <td>${it.qty || 1}</td>
        <td>${esc(it.fabric_name || '')}</td>
        <td>${esc(it.lining_name || '无内衬')}</td>
      </tr>`;
    });
    table($('spliceOrderItemsTable'), ['<input type="checkbox" id="spliceCheckAll" checked>', '编号', '产品', '尺寸 inch', '数量', '面料', '内衬'], rows);
    $('spliceCheckAll').onchange = () => {
      document.querySelectorAll('.splice-item-check').forEach(cb => { cb.checked = $('spliceCheckAll').checked; });
      updateSpliceSelectionState();
    };
    document.querySelectorAll('.splice-item-check').forEach(cb => {
      cb.onchange = () => {
        updateSpliceSelectionState();
      };
    });
    updateSpliceSelectionState();
  } catch (e) { toast('加载订单项目失败: ' + e.message, 'bad'); }
}
async function calcSpliceForOrder() {
  const orderId = state.spliceSelectedOrderId || $('spliceOrderSelect')?.value;
  if (!orderId) return toast('请先选择订单', 'warn');
  const btn = $('spliceCalcOrderBtn');
  if (btn) btn.disabled = true;
  try {
    const order = await api.json(`/api/orders/${orderId}`);
    const items = order.items || [];
    const checks = document.querySelectorAll('.splice-item-check');
    const selectedIdxs = Array.from(checks).filter(cb => cb.checked).map(cb => Number(cb.dataset.spliceIdx));
    if (!selectedIdxs.length) return toast('请至少选择一个项目', 'warn');
    const selectedItems = selectedIdxs.map(i => items[i]).filter(Boolean);
    const results = [];
    for (const it of selectedItems) {
      const fabricId = it.fabric_id || '';
      const liningId = it.lining_id || '';
      const hasLining = !!liningId && liningId !== 'lining_none';
      const calc = it.calc_detail || {};
      const fullness = Number(it.fullness) || Number(calc.fullness) || 2;
      try {
        const res = await api.json('/api/calc/splice', { method: 'POST', body: JSON.stringify({ fabric_id: fabricId, width_in: it.width_in, length_in: it.length_in, qty: it.qty, fullness, has_lining: hasLining, lining_id: liningId }) });
        results.push({ item: it, mainPlan: res.mainPlan, liningPlan: res.liningPlan, warnings: res.warnings || [] });
      } catch (e) {
        results.push({ item: it, error: e.message });
      }
    }
    $('spliceOrderResults')?.classList.remove('hidden');
    const allWarnings = results.flatMap(r => r.warnings || []);
    const validResults = results.filter(r => !r.error);
    const plans = validResults.flatMap(r => [r.mainPlan, r.liningPlan].filter(Boolean));
    const totalMeters = plans.reduce((sum, p) => sum + (Number(p.fabricMeters) || 0), 0);
    const splicePlans = plans.filter(p => p.needSplice).length;
    let html = '<div class="splice-summary">' + spliceSummaryHtml([
      { label: '选中项目', value: `${selectedItems.length} 项` },
      { label: '需拼接材料', value: `${splicePlans} 项` },
      { label: '合计用料', value: `${fmt(totalMeters)} m` },
      { label: '提示', value: `${allWarnings.length} 条` }
    ], allWarnings.length ? allWarnings.join('；') : '计算完成，无额外提示。') + '</div>';
    const rows = results.flatMap(r => {
      if (r.error) return [`<tr><td colspan="6">${esc(r.item.item_code || '')}</td><td colspan="5" class="bad">计算失败: ${esc(r.error)}</td></tr>`];
      return [['主面料', r.mainPlan], ['内衬', r.liningPlan]].filter(x => x[1]).map(([name, p]) => `<tr><td>${esc(r.item.item_code || '')}</td><td>${name}</td><td>${spliceCutDirectionText(p.cutDirection)}</td><td>${p.needSplice ? '是' : '否'}</td><td>${p.panelsNeeded}</td><td>${fmt(p.fabricMeters)}</td><td>${esc(p.description)}</td></tr>`);
    });
    if ($('spliceOrderResultContent')) $('spliceOrderResultContent').innerHTML = html;
    table($('spliceOrderResultTable'), ['编号', '材料', '裁法', '是否拼接', '幅数', '用料 m', '说明'], rows);
  } catch (e) {
    toast('订单拼接计算失败: ' + e.message, 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}
function renderProductEditor() {
  if ($('editProductSelect')) fillSelect($('editProductSelect'), state.products.map(p => ({ value: p.id, label: p.name })), $('editProductSelect').value || state.products[0]?.id);
  if ($('editDefaultFabric')) fillSelect($('editDefaultFabric'), state.fabrics.map(f => ({ value: f.id, label: f.name })));
  loadProductEditor();
}
function priceRows(tableId, rows = []) {
  table($(tableId), ['尺寸 inch', '价格 USD', '操作'], rows.map(r => `<tr><td><input type="number" step="0.01" value="${r.size_in ?? r.size ?? ''}"></td><td><input type="number" step="0.01" value="${r.price_usd ?? r.price ?? 0}"></td><td><button class="btn small danger" onclick="this.closest('tr').remove()">删除</button></td></tr>`));
}
function loadProductEditor() {
  const p = state.products.find(x => x.id === $('editProductSelect')?.value) || state.products[0];
  if (!p) return;
  if ($('editName')) $('editName').value = p.name || '';
  if ($('editDefaultFabric')) $('editDefaultFabric').value = p.default_fabric_id || p.defaultFabricId || '';
  if ($('editBasePrice')) $('editBasePrice').value = p.base_price || p.basePrice || 0;
  if ($('widthPriceTable')) priceRows('widthPriceTable', p.width_prices || p.widthPrices);
  if ($('lengthPriceTable')) priceRows('lengthPriceTable', p.length_prices || p.lengthPrices);
  renderOptionGroups(p.options || []);
}
function collectPriceRows(tableId) {
  const el = $(tableId);
  if (!el) return [];
  return Array.from(el.querySelectorAll('tbody tr')).map(tr => ({ size_in: Number(tr.children[0]?.querySelector('input')?.value), price_usd: Number(tr.children[1]?.querySelector('input')?.value) })).filter(r => r.size_in > 0);
}
function renderOptionGroups(options) {
  optionEditor.groups = (options || []).map((o, idx) => ({
    option_key: o.option_key || o.key || `option_${idx + 1}`,
    label: o.label || '',
    type: 'dropdown',
    factory: true,
    required: true,
    priceable: true,
    costable: true,
    values: (o.values || []).map(v => ({
      label: v.label || '',
      price_usd: Number(v.price_usd ?? v.price) || 0,
      cost_rmb: Number(v.cost_rmb ?? v.costRmb) || 0
    }))
  }));
  optionEditor.activeIndex = Math.min(optionEditor.activeIndex || 0, Math.max(optionEditor.groups.length - 1, 0));
  renderOptionGroupsEditor();
}
function renderOptionGroupsEditor() {
  const root = $('optionGroupsEditor');
  if (!root) return;
  const list = optionEditor.groups.map((g, i) => `
    <div class="option-group-list-item ${i === optionEditor.activeIndex ? 'active' : ''}" data-option-group="${i}" draggable="true">
      <button class="btn small secondary option-drag-handle" type="button" data-option-drag-handle="${i}" title="拖动排序">⠿</button>
      <input class="option-group-label" data-option-label="${i}" value="${esc(g.label || '')}" placeholder="选项组名称">
      <div class="option-group-actions">
        <button class="btn small secondary" type="button" data-option-select="${i}">编辑</button>
        <button class="btn small danger" type="button" data-option-del-group="${i}">删除</button>
      </div>
    </div>
  `).join('');
  root.innerHTML = `
    <div class="option-group-list">${list || '<div class="option-group-detail-empty">暂无选项组</div>'}</div>
    <div class="option-group-detail">${renderOptionValuesEditor()}</div>
  `;
  root.querySelectorAll('[data-option-label]').forEach(input => {
    input.addEventListener('input', e => {
      const idx = Number(e.target.dataset.optionLabel);
      if (optionEditor.groups[idx]) optionEditor.groups[idx].label = e.target.value;
    });
  });
  root.querySelectorAll('[data-option-select]').forEach(btn => {
    btn.onclick = () => {
      optionEditor.activeIndex = Number(btn.dataset.optionSelect);
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-del-group]').forEach(btn => {
    btn.onclick = () => {
      if (!confirm('确认删除此选项组？')) return;
      const idx = Number(btn.dataset.optionDelGroup);
      optionEditor.groups.splice(idx, 1);
      if (optionEditor.activeIndex >= optionEditor.groups.length) optionEditor.activeIndex = Math.max(optionEditor.groups.length - 1, 0);
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-add-value]').forEach(btn => {
    btn.onclick = () => {
      const group = optionEditor.groups[optionEditor.activeIndex];
      if (!group) return;
      group.values.push({ label: '', price_usd: 0, cost_rmb: 0 });
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-del-value]').forEach(btn => {
    btn.onclick = () => {
      const group = optionEditor.groups[optionEditor.activeIndex];
      const row = Number(btn.dataset.optionDelValue);
      if (!group) return;
      group.values.splice(row, 1);
      renderOptionGroupsEditor();
    };
  });
  root.querySelectorAll('[data-option-value-field]').forEach(input => {
    input.addEventListener('input', e => {
      const group = optionEditor.groups[optionEditor.activeIndex];
      if (!group) return;
      const row = Number(e.target.dataset.optionRow);
      const field = e.target.dataset.optionValueField;
      if (!group.values[row]) return;
      if (field === 'label') group.values[row].label = e.target.value;
      if (field === 'price_usd') group.values[row].price_usd = Number(e.target.value) || 0;
      if (field === 'cost_rmb') group.values[row].cost_rmb = Number(e.target.value) || 0;
    });
  });
  root.querySelectorAll('.option-group-list-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      const idx = Number(item.dataset.optionGroup);
      optionDragState.fromIndex = idx;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
      }
    });
    item.addEventListener('dragend', () => {
      optionDragState.fromIndex = null;
      item.classList.remove('dragging');
      root.querySelectorAll('.option-group-list-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const toIndex = Number(item.dataset.optionGroup);
      const fromIndex = optionDragState.fromIndex == null ? Number(e.dataTransfer?.getData('text/plain')) : optionDragState.fromIndex;
      if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex) || fromIndex === toIndex) return;
      const [moved] = optionEditor.groups.splice(fromIndex, 1);
      optionEditor.groups.splice(toIndex, 0, moved);
      if (optionEditor.activeIndex === fromIndex) optionEditor.activeIndex = toIndex;
      else if (fromIndex < optionEditor.activeIndex && optionEditor.activeIndex <= toIndex) optionEditor.activeIndex -= 1;
      else if (toIndex <= optionEditor.activeIndex && optionEditor.activeIndex < fromIndex) optionEditor.activeIndex += 1;
      renderOptionGroupsEditor();
    });
  });
}
function renderOptionValuesEditor() {
  const group = optionEditor.groups[optionEditor.activeIndex];
  if (!group) return '<div class="option-group-detail-empty">请选择或新增选项组</div>';
  const rows = (group.values || []).map((v, i) => `<tr>
      <td><input data-option-value-field="label" data-option-row="${i}" value="${esc(v.label || '')}" placeholder="选项值"></td>
      <td><input data-option-value-field="price_usd" data-option-row="${i}" type="number" step="0.01" value="${Number(v.price_usd || 0)}"></td>
      <td><input data-option-value-field="cost_rmb" data-option-row="${i}" type="number" step="0.01" value="${Number(v.cost_rmb || 0)}"></td>
      <td><button class="btn small danger" type="button" data-option-del-value="${i}">删除</button></td>
    </tr>`).join('');
  return `
    <div class="option-values-toolbar">
      <button class="btn small secondary" type="button" data-option-add-value="1">新增选项值</button>
    </div>
    <div class="table-wrap option-values-table">
      <table>
         <thead><tr><th>选项</th><th>售价 USD</th><th>成本 RMB</th><th>操作</th></tr></thead>
         <tbody>${rows || '<tr><td colspan="4">暂无选项值</td></tr>'}</tbody>
      </table>
    </div>
  `;
}
function collectOptions() {
  return optionEditor.groups.map(g => {
    const labelText = String(g.label || '').trim();
    return {
      option_key: g.option_key || optionKeyFromLabel(labelText),
      label: labelText,
      type: 'dropdown',
      factory: true,
      required: true,
      priceable: true,
      costable: true,
      values: (g.values || []).map(v => ({
        label: String(v.label || '').trim(),
        price_usd: Number(v.price_usd) || 0,
        cost_rmb: Number(v.cost_rmb) || 0
      })).filter(v => v.label)
    };
  }).filter(o => o.label);
}
async function saveProduct() {
  try {
    const id = $('editProductSelect')?.value;
    if (!id) return;
    const existing = state.products.find(x => x.id === id) || {};
    const body = { id, name: $('editName')?.value || '', factory_name: $('editName')?.value || '', default_fabric_id: $('editDefaultFabric')?.value || '', base_price: Number($('editBasePrice')?.value) || 0, default_fullness: existing.default_fullness || existing.defaultFullness || 2, enabled: true, width_prices: collectPriceRows('widthPriceTable'), length_prices: collectPriceRows('lengthPriceTable'), options: collectOptions() };
    await api.json(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    await loadAll();
    if ($('editProductSelect')) $('editProductSelect').value = id;
    toast('产品已保存');
  } catch (e) {
    toast(e.message, 'bad');
  }
}
function renderAll() {
  try { renderOrderForm(); } catch(e) { console.error('renderOrderForm', e); }
  try { renderProductEditor(); } catch(e) { console.error('renderProductEditor', e); }
  try { if ($('optionGroupsEditor')) renderOptionGroupsEditor(); } catch(e) { console.error('renderOptionGroupsEditor', e); }
}
function bind() {
  document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('nav button').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const targetPage = $(`page-${btn.dataset.tab}`);
    document.querySelectorAll('.page').forEach(p => {
      p.classList.remove('active');
      p.style.display = 'none';
    });
    if (targetPage) {
      targetPage.classList.add('active');
      targetPage.style.display = '';
    }
    if (btn.dataset.tab === 'orders') loadOrders();
    if (btn.dataset.tab === 'profit') loadProfitOrderList();
    if (btn.dataset.tab === 'splice') loadSpliceOrderList();
  });
  if ($('orderDate')) $('orderDate').onchange = () => { if ($('orderDate').value && $('deliveryDate')) $('deliveryDate').value = addDays($('orderDate').value, 4); updatePreview(); };
  const updateDiscountLabel = () => {
    const percent = $('discountMode')?.value === 'percent';
    if ($('discountUsd')) { $('discountUsd').step = percent ? '0.1' : '0.01'; $('discountUsd').max = percent ? '100' : ''; }
    updatePreview();
  };
  if ($('toggleInfoMatcherBtn')) $('toggleInfoMatcherBtn').onclick = () => {
    const panel = $('infoMatcherPanel');
    if (!panel) return;
    const nowHidden = panel.classList.toggle('hidden');
    $('toggleInfoMatcherBtn').setAttribute('aria-expanded', String(!nowHidden));
    if (!nowHidden) $('bulkCustomerInfoInput')?.focus();
  };
  if ($('pasteFromClipboardBtn')) $('pasteFromClipboardBtn').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        $('bulkCustomerInfoInput').value = text;
        applyMatchedCustomerInfo();
      }
    } catch { toast('无法访问剪贴板，请手动粘贴', 'warn'); }
  };
  if ($('clearInfoMatcherBtn')) $('clearInfoMatcherBtn').onclick = () => {
    if ($('bulkCustomerInfoInput')) $('bulkCustomerInfoInput').value = '';
  };
  if ($('applyInfoMatcherBtn')) $('applyInfoMatcherBtn').onclick = applyMatchedCustomerInfo;
  ['itemProduct', 'itemQty', 'itemWidth', 'itemLength', 'itemFullness', 'itemRemark', 'discountUsd', 'applyDiscountToggle'].forEach(id => {
    const el = $(id);
    if (!el) return;
    const handler = id === 'itemProduct' ? renderDynamicOptions : updatePreview;
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
  if ($('discountMode')) $('discountMode').addEventListener('change', updateDiscountLabel);
  if ($('viewCostDetailBtn')) $('viewCostDetailBtn').onclick = async () => {
    await updatePreview();
    if (state.preview) renderCostDetailModal(state.preview);
    $('costDetailModal')?.classList.remove('hidden');
  };
  if ($('closeCostDetailBtn')) $('closeCostDetailBtn').onclick = () => $('costDetailModal')?.classList.add('hidden');
  if ($('closeCostDetailModal')) $('closeCostDetailModal').onclick = () => $('costDetailModal')?.classList.add('hidden');
  if ($('addItemBtn')) $('addItemBtn').onclick = addItem;
  if ($('saveOrderBtn')) $('saveOrderBtn').onclick = saveOrder;
  if ($('clearOrderBtn')) $('clearOrderBtn').onclick = () => { if (!confirm('确认清空当前订单所有项目？')) return; state.currentItems = []; renderCurrentItems(); localStorage.removeItem('twodrapes_order_draft'); };
  if ($('syncSpliceBtn')) $('syncSpliceBtn').onclick = () => {
    const p = activeProduct();
    $('spWidth').value = $('itemWidth').value;
    $('spLength').value = $('itemLength').value;
    $('spQty').value = $('itemQty').value;
    $('spFullness').value = $('itemFullness').value;
    $('spFabric').value = resolveProductFabricId(p);
    toast('已同步到拼接计算器');
  };
  if ($('resetItemBtn')) $('resetItemBtn').onclick = () => {
    ['itemWidth', 'itemLength', 'itemRemark'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('itemQty').value = 1;
    $('actualPaidUsd').value = 0;
    $('discountMode').value = 'percent';
    $('discountUsd').value = 0;
    $('applyDiscountToggle').checked = false;
    document.querySelectorAll('#dynamicOptions select').forEach(sel => { if (sel.options.length) sel.selectedIndex = 0; });
    updateDiscountLabel();
    updatePreview();
    toast('当前项目已清空');
  };
  if ($('closeEditOrderBtn')) $('closeEditOrderBtn').onclick = () => $('editOrderModal')?.classList.add('hidden');
  if ($('closeEditOrderModal')) $('closeEditOrderModal').onclick = () => $('editOrderModal')?.classList.add('hidden');
  if ($('calcSpliceBtn')) $('calcSpliceBtn').onclick = calcSplice;
  // Splice order search
  if ($('spliceOrderSearchInput')) {
    const renderSpliceOrderResults = (query = '') => {
      const results = $('spliceOrderSearchResults');
      if (!results) return;
      const q = query.trim().toLowerCase();
      const orders = state.spliceOrderChoices.length ? state.spliceOrderChoices : state.ordersCache;
      const matches = (orders || []).filter(o => {
        const text = `${o.id || ''} ${o.order_no || ''} ${o.customer_name || ''} ${o.order_date || ''}`.toLowerCase();
        return !q || text.includes(q);
      });
      if (!matches.length) { results.innerHTML = '<div class="profit-order-empty">未找到匹配订单</div>'; results.classList.remove('hidden'); return; }
      results.innerHTML = matches.slice(0, 10).map(o => `<button type="button" class="profit-order-option" data-splice-order-id="${o.id}" role="option"><span>${esc(o.order_no || '#' + o.id)}</span><small>${esc(o.customer_name || '未知')} | ${esc(o.order_date || '')}</small></button>`).join('');
      results.classList.remove('hidden');
      results.querySelectorAll('[data-splice-order-id]').forEach(btn => {
        btn.onclick = () => {
          const o = matches.find(x => String(x.id) === btn.dataset.spliceOrderId);
          selectSpliceOrder(o);
        };
      });
    };
    const ensureSpliceOrders = async () => {
      if (!state.spliceOrderChoices.length) await loadSpliceOrderList();
    };
    $('spliceOrderSearchInput').addEventListener('input', async () => { await ensureSpliceOrders(); renderSpliceOrderResults($('spliceOrderSearchInput').value); });
    $('spliceOrderSearchInput').addEventListener('focus', async () => { await ensureSpliceOrders(); renderSpliceOrderResults($('spliceOrderSearchInput').value); });
    $('spliceOrderSearchInput').addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        $('spliceOrderSearchResults')?.classList.add('hidden');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        await ensureSpliceOrders();
        const q = $('spliceOrderSearchInput').value.trim().toLowerCase();
        const first = state.spliceOrderChoices.find(o => `${o.id || ''} ${o.order_no || ''} ${o.customer_name || ''} ${o.order_date || ''}`.toLowerCase().includes(q));
        if (first) selectSpliceOrder(first);
      }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.profit-order-search')) $('spliceOrderSearchResults')?.classList.add('hidden'); });
  }
  if ($('spliceCalcOrderBtn')) $('spliceCalcOrderBtn').onclick = calcSpliceForOrder;
  if ($('spliceSelectAllBtn')) $('spliceSelectAllBtn').onclick = () => {
    const all = Array.from(document.querySelectorAll('.splice-item-check'));
    const checkedCount = all.filter(cb => cb.checked).length;
    const nextChecked = checkedCount !== all.length;
    all.forEach(cb => { cb.checked = nextChecked; });
    updateSpliceSelectionState();
  };
  if ($('profitOrderSearchInput')) {
    $('profitOrderSearchInput').addEventListener('input', () => {
      if ($('profitOrderSelect')) $('profitOrderSelect').value = '';
      renderProfitOrderSearchResults($('profitOrderSearchInput').value);
    });
    $('profitOrderSearchInput').addEventListener('focus', () => {
      renderProfitOrderSearchResults($('profitOrderSearchInput').value);
    });
    $('profitOrderSearchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeProfitOrderResults();
        return;
      }
      if (e.key === 'Enter') {
        const q = $('profitOrderSearchInput').value.trim().toLowerCase();
        const first = state.profitOrderChoices.find(order => !q || profitOrderSearchText(order).includes(q));
        if (first) {
          e.preventDefault();
          selectProfitOrder(first);
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.profit-order-search')) closeProfitOrderResults();
    });
  }
  $('profitLoadBtn').onclick = loadProfitDetail;
  $('refreshOrdersBtn').onclick = loadOrders;
  ['ordersSearchInput', 'ordersDateFrom', 'ordersDateTo', 'ordersStatusFilter', 'ordersProductFilter'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(id === 'ordersSearchInput' ? 'input' : 'change', () => {
      state.ordersPage = 1;
      loadOrders();
    });
  });
  if ($('ordersBulkExportBtn')) $('ordersBulkExportBtn').onclick = exportSelectedOrdersCsv;
  if ($('ordersBulkRecalcBtn')) $('ordersBulkRecalcBtn').onclick = async () => {
    const ids = Array.from(state.selectedOrderIds || []);
    if (!ids.length) return toast('请先选择订单', 'bad');
    for (const id of ids) await api.json(`/api/orders/${id}/recalculate`, { method: 'POST' });
    toast(`已重算 ${ids.length} 个订单`);
    await loadOrders();
  };
  if ($('ordersBulkDeleteBtn')) $('ordersBulkDeleteBtn').onclick = async () => {
    const ids = Array.from(state.selectedOrderIds || []);
    if (!ids.length) return toast('请先选择订单', 'bad');
    if (!confirm(`确认删除 ${ids.length} 个订单？此操作不可撤销。`)) return;
    for (const id of ids) await api.json(`/api/orders/${id}`, { method: 'DELETE' });
    state.selectedOrderIds.clear();
    toast(`已删除 ${ids.length} 个订单`);
    await loadOrders();
  };
  if ($('downloadOrderImportTemplateBtn')) $('downloadOrderImportTemplateBtn').onclick = () => location.href = '/api/export/order-import-template-csv';
  if ($('ordersTable')) $('ordersTable').addEventListener('click', e => { const el = e.target.closest('.order-item-expand'); if (el) el.classList.toggle('open'); });
  if ($('ordersImportCsvInput')) {
    $('ordersImportCsvInput').onchange = async () => {
      const file = $('ordersImportCsvInput').files[0];
      if (!file) return;
      try {
        const res = await api.upload('/api/import/orders-csv', file);
        $('ordersImportStatus').textContent = `导入完成：${file.name}，新增订单 ${res.importedOrders || 0} 个，新增项目 ${res.importedItems || 0} 条，跳过 ${res.skippedRows || 0} 行。`;
        if (res.errors?.length) $('ordersImportStatus').textContent += ` 错误示例：${res.errors.slice(0, 3).join('；')}`;
        $('ordersImportCsvInput').value = '';
        await loadOrders();
        toast('订单 CSV 导入完成');
      } catch (e) {
        $('ordersImportStatus').textContent = `导入失败：${e.message}`;
        toast(e.message, 'bad');
      }
    };
  }
  if ($('exportFactoryBtn')) $('exportFactoryBtn').onclick = () => state.lastOrderId ? location.href = `/api/export/factory-order/${state.lastOrderId}` : toast('请先保存或选中一个订单', 'bad');
  if ($('exportCostBtn')) $('exportCostBtn').onclick = () => state.lastOrderId ? location.href = `/api/export/cost-record/${state.lastOrderId}` : toast('请先保存或选中一个订单', 'bad');
  if ($('recalcOrderBtn')) $('recalcOrderBtn').onclick = async () => {
    if (!state.lastOrderId) {
      await updatePreview();
      return toast('当前项目预览已刷新，保存订单后可重算数据库订单');
    }
    try {
      await api.json(`/api/orders/${state.lastOrderId}/recalculate`, { method: 'POST' });
      await loadOrders();
      toast('当前订单已重算');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
  if ($('editProductSelect')) $('editProductSelect').onchange = loadProductEditor;
  if ($('addProductBtn')) $('addProductBtn').onclick = () => {
    const modal = $('newProductModal');
    const nameInput = $('newProductName');
    if (!modal || !nameInput) return;
    nameInput.value = '';
    modal.classList.remove('hidden');
    nameInput.focus();
    const doCreate = async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      modal.classList.add('hidden');
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'product_' + Date.now();
      const body = { id, name, factory_name: name, default_fabric_id: '', base_price: 0, default_fullness: 2, enabled: true, width_prices: [], length_prices: [], options: [] };
      try {
        await api.json('/api/products/' + id, { method: 'PUT', body: JSON.stringify(body) });
        await loadAll();
        if ($('editProductSelect')) $('editProductSelect').value = id;
        loadProductEditor();
        toast('产品已创建');
      } catch (e) { toast(e.message, 'bad'); }
    };
    $('confirmNewProductBtn').onclick = doCreate;
    $('cancelNewProductBtn').onclick = () => modal.classList.add('hidden');
    $('closeNewProductModal').onclick = () => modal.classList.add('hidden');
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') modal.classList.add('hidden'); };
  };
  if ($('saveProductBtn')) $('saveProductBtn').onclick = saveProduct;
  if ($('copyProductBtn')) $('copyProductBtn').onclick = async () => { await api.json(`/api/products/${$('editProductSelect').value}/copy`, { method: 'POST' }); await loadAll(); toast('产品已复制'); };
  if ($('deleteProductBtn')) $('deleteProductBtn').onclick = async () => { if (confirm('确认删除产品？')) { await api.json(`/api/products/${$('editProductSelect').value}`, { method: 'DELETE' }); await loadAll(); } };
  document.querySelectorAll('[data-add-price]').forEach(b => b.onclick = () => { const t = $(b.dataset.addPrice === 'width' ? 'widthPriceTable' : 'lengthPriceTable'); if (t?.querySelector('tbody')) t.querySelector('tbody').insertAdjacentHTML('beforeend', '<tr><td><input type="number" step="0.01"></td><td><input type="number" step="0.01" value="0"></td><td><button class="btn small danger" onclick="this.closest(\'tr\').remove()">删除</button></td></tr>'); });
  if ($('addOptionGroupBtn')) $('addOptionGroupBtn').onclick = () => {
    optionEditor.groups.push({
      option_key: `option_${Date.now()}`,
      label: `新选项组 ${optionEditor.groups.length + 1}`,
      type: 'dropdown',
      factory: true,
      required: true,
      priceable: true,
      costable: true,
      values: [{ label: '选项 1', price_usd: 0, cost_rmb: 0 }]
    });
    optionEditor.activeIndex = optionEditor.groups.length - 1;
    renderOptionGroupsEditor();
  };
  if ($('importEasifyBtn')) $('importEasifyBtn').onclick = async () => { const f = $('easifyCsvInput')?.files[0]; if (!f) return toast('请选择 CSV', 'bad'); const r = await api.upload('/api/import/easify-csv', f); await loadAll(); toast(`Easify 已导入：${r.productCount} 产品 / ${r.optionCount} 选项`); };
  if ($('importProductTemplateBtn')) $('importProductTemplateBtn').onclick = async () => { const f = $('productTemplateInput')?.files[0]; if (!f) return toast('请选择 CSV', 'bad'); await api.upload('/api/import/product-csv', f); await loadAll(); toast('产品 CSV 已导入'); };
  if ($('exportAllProductsBtn')) $('exportAllProductsBtn').onclick = () => location.href = '/api/export/product-template-csv';
  // Ensure preview panel has an initial binding-refresh even if some controls did not emit input events yet.
  updatePreview();

  // Global Escape key closes any visible modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
  });
}
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('twodrapes_token');
  if (token) {
    try {
      const res = await api.json('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
      if (!res.ok) throw new Error();
    } catch { window.location.href = '/login.html'; return; }
  }
  bind();
  try { await loadAll(); renderCurrentItems(); await calcSplice(); toast('已连接服务器数据库'); } catch (e) { toast(e.message, 'bad'); }
});
