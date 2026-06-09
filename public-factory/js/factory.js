const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>\"'`]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;", "`": "&#96;" }[m]));
const fmt = (n, d = 2) => (Number(n || 0)).toFixed(d);
const usd = (n) => `$${fmt(n)}`;
const rmb = (n) => `¥${fmt(n)}`;

let paramsState = null;
let allOrdersCache = [];
let editingUserId = null;
let rates = { usdRmbRate: 6.8, paypalFeeRate: 0.044 };

async function json(url, options = {}) {
  const token = localStorage.getItem("twodrapes_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem("twodrapes_token");
    localStorage.removeItem("twodrapes_user");
    window.location.href = "/login.html";
    throw new Error("未授权");
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, type = "") {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add("hidden"), 3200);
}

function renderTable(id, headers, rows) {
  const el = $(id);
  if (!el) return;
  const empty = `<tr><td colspan="${headers.length}" class="empty-cell">暂无数据</td></tr>`;
  el.innerHTML = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : empty}</tbody>`;
}

function input(value, attrs = "") {
  return `<input ${attrs} value="${esc(value ?? "")}">`;
}

function orderStatusLabel(status) {
  const labels = { draft: "草稿", production: "待生产", shipping: "待发货", completed: "完成" };
  return labels[status] || "未知";
}

function orderStatusCls(status) {
  const cls = { draft: "muted", production: "warn", shipping: "accent", completed: "good" };
  return cls[status] || "muted";
}

function channelLabel(ch) {
  return ch === "amazon" ? "亚马逊" : "独立站";
}

function initTabs() {
  document.querySelectorAll(".tab-nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-nav button").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.querySelectorAll(".page").forEach((p) => {
        p.classList.remove("active");
        p.style.display = "none";
      });
      const target = $(`page-${btn.dataset.tab}`);
      if (target) {
        target.classList.add("active");
        target.style.display = "";
      }
      if (btn.dataset.tab === "summary") loadSummary();
      if (btn.dataset.tab === "profit") loadProfitOrderList();
      if (btn.dataset.tab === "params") loadParams();
      if (btn.dataset.tab === "users") loadUsers($("userChannelFilter")?.value || "");
    });
  });
}

async function loadSummary() {
  try {
    const rows = await json("/api/orders");
    allOrdersCache = rows;
    renderSummaryStats(rows);
    renderSummaryTable(rows);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function renderSummaryStats(orders) {
  const el = $("summaryStats");
  if (!el) return;
  const totalOrders = orders.length;
  const totalSales = orders.reduce((s, o) => s + (Number(o.total_net_sales_rmb) || 0), 0);
  const totalCost = orders.reduce((s, o) => s + (Number(o.total_cost_rmb) || 0), 0);
  const totalProfit = orders.reduce((s, o) => s + (Number(o.total_profit_rmb) || 0), 0);
  const avgRate = totalSales > 0 ? (totalProfit / totalSales * 100) : 0;
  el.innerHTML = `
    <div class="stat-card"><span class="stat-label">订单总数</span><span class="stat-value">${totalOrders}</span></div>
    <div class="stat-card"><span class="stat-label">总销售额</span><span class="stat-value">${rmb(totalSales)}</span></div>
    <div class="stat-card"><span class="stat-label">总成本</span><span class="stat-value">${rmb(totalCost)}</span></div>
    <div class="stat-card"><span class="stat-label">总利润</span><span class="stat-value">${rmb(totalProfit)}</span></div>
    <div class="stat-card"><span class="stat-label">平均利润率</span><span class="stat-value">${fmt(avgRate, 1)}%</span></div>
  `;
}

function renderSummaryTable(orders) {
  const channel = $("summaryChannelFilter")?.value || "";
  const status = $("summaryStatusFilter")?.value || "";
  const q = ($("summarySearchInput")?.value || "").toLowerCase();
  let filtered = orders;
  if (channel) filtered = filtered.filter((o) => o.channel === channel);
  if (status) filtered = filtered.filter((o) => o.status === status);
  if (q) filtered = filtered.filter((o) => `${o.order_no || ""} ${o.customer_name || ""}`.toLowerCase().includes(q));
  renderTable(
    "summaryTable",
    ["订单号", "渠道", "客户", "交期", "状态", "售价 RMB", "成本 RMB", "利润 RMB", "利润率"],
    filtered.map((o) => {
      const rate = Number(o.total_profit_rate) || 0;
      return `<tr>
        <td><strong class="order-no-link" data-view-order="${o.id}" style="cursor:pointer">${esc(o.order_no || "#" + o.id)}</strong></td>
        <td>${esc(channelLabel(o.channel))}</td>
        <td>${esc(o.customer_name || "-")}</td>
        <td>${esc(o.delivery_date || "-")}</td>
        <td><span class="pill ${orderStatusCls(o.status)}">${esc(orderStatusLabel(o.status))}</span></td>
        <td>${rmb(o.total_net_sales_rmb)}</td>
        <td>${rmb(o.total_cost_rmb)}</td>
        <td>${rmb(o.total_profit_rmb)}</td>
        <td>${fmt(rate * 100, 1)}%</td>
      </tr>`;
    })
  );
}

async function loadProfitOrderList() {
  try {
    const rows = await json("/api/orders");
    allOrdersCache = rows;
    const sel = $("profitOrderSelect");
    if (!sel) return;
    sel.innerHTML = '<option value="">请选择订单</option>' + rows.map((o) => `<option value="${o.id}">${esc(o.order_no || "#" + o.id)} - ${esc(o.customer_name || "")} (${channelLabel(o.channel)})</option>`).join("");
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function loadProfitDetail(orderId) {
  if (!orderId) {
    $("profitDetail")?.classList.add("hidden");
    return;
  }
  try {
    const order = await json(`/api/orders/${orderId}`);
    const detail = $("profitDetail");
    if (!detail) return;
    detail.classList.remove("hidden");
    const grossSales = Number(order.total_sales_usd) || 0;
    const tax = Number(order.total_tax_usd) || 0;
    const grossRmb = (grossSales + tax) * rates.usdRmbRate;
    const paypalFee = (grossSales + tax) * rates.paypalFeeRate * rates.usdRmbRate;
    const netIncome = grossRmb - paypalFee;
    const logistics = Number(order.logistics_cost_rmb) || 0;
    const totalCost = Number(order.total_cost_rmb) || 0;
    const profit = netIncome - totalCost;
    const rate = netIncome > 0 ? profit / netIncome : 0;
    detail.innerHTML = `
      <div class="profit-grid">
        <div class="profit-card"><span>实际销售 USD</span><b>${usd(grossSales + tax)}</b></div>
        <div class="profit-card"><span>实际销售 RMB</span><b>${rmb(grossRmb)}</b></div>
        <div class="profit-card"><span>PayPal 手续费</span><b>-${rmb(paypalFee)}</b></div>
        <div class="profit-card"><span>扣手续费后收入</span><b>${rmb(netIncome)}</b></div>
        <div class="profit-card"><span>物流成本</span><b>${rmb(logistics)}</b></div>
        <div class="profit-card"><span>总成本</span><b>${rmb(totalCost)}</b></div>
        <div class="profit-card highlight"><span>利润</span><b>${rmb(profit)}</b></div>
        <div class="profit-card highlight"><span>利润率</span><b>${fmt(rate * 100, 1)}%</b></div>
      </div>
      <h3 class="subsection-title">项目明细</h3>
      <div class="table-wrap"><table id="profitItemTable"></table></div>
    `;
    renderTable(
      "profitItemTable",
      ["编号", "产品", "尺寸", "数量", "面料", "售价 USD", "成本 RMB", "利润 RMB"],
      (order.items || []).map((it) => {
        const itProfit = (Number(it.sales_usd) || 0) * rates.usdRmbRate - (Number(it.final_cost_rmb) || Number(it.cost_rmb) || 0);
        return `<tr>
          <td>${esc(it.item_code)}</td>
          <td>${esc(it.product_name)}</td>
          <td>${fmt(it.width_in, 0)} x ${fmt(it.length_in, 0)}</td>
          <td>${it.qty}</td>
          <td>${esc(it.fabric_name)}</td>
          <td>${usd(it.sales_usd)}</td>
          <td>${rmb(it.final_cost_rmb || it.cost_rmb)}</td>
          <td>${rmb(itProfit)}</td>
        </tr>`;
      })
    );
  } catch (e) {
    toast(e.message, "bad");
  }
}

function pickGlobal(globals, keys, fallback = "") {
  for (const key of keys) {
    if (globals && Object.prototype.hasOwnProperty.call(globals, key) && globals[key] !== "" && globals[key] != null) {
      return globals[key];
    }
  }
  return fallback;
}

function materialId(prefix, name) {
  const base = String(name || "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${base || Date.now()}`;
}

function materialRow(row, type) {
  const metaField = type === "fabric" ? "series" : "color";
  const namePlaceholder = type === "fabric" ? "面料名称" : "内衬名称";
  const metaPlaceholder = type === "fabric" ? "系列" : "颜色";
  const canDelete = row.id !== "lining_none";
  return `<tr data-id="${esc(row.id || "")}" data-type="${type}">
    <td>${input(row.name || "", `data-field="name" placeholder="${namePlaceholder}"`)}</td>
    <td>${input(row[metaField] || "", `data-field="${metaField}" placeholder="${metaPlaceholder}"`)}</td>
    <td>${input(row.width_cm, 'type="number" step="0.01" data-field="width_cm"')}</td>
    <td>${input(row.price_per_m, 'type="number" step="0.01" data-field="price_per_m"')}</td>
    <td><button type="button" class="icon-btn danger" data-action="delete-material"${canDelete ? "" : " disabled"}>删除</button></td>
  </tr>`;
}

function nextMaterialName(type) {
  const tableId = type === "fabric" ? "fabricTable" : "liningTable";
  const prefix = type === "fabric" ? "新面料" : "新内衬";
  const table = $(tableId);
  if (!table) return `${prefix}${Date.now()}`;
  const names = [...table.querySelectorAll('tbody [data-field="name"]')].map((el) => String(el.value || "").trim());
  let idx = 1;
  while (names.includes(`${prefix}${idx}`)) idx++;
  return `${prefix}${idx}`;
}

function appendMaterialRow(type) {
  const tableId = type === "fabric" ? "fabricTable" : "liningTable";
  const table = $(tableId);
  if (!table) return false;
  const tbody = table.tBodies[0] || table.createTBody();
  const defaultName = nextMaterialName(type);
  tbody.insertAdjacentHTML(
    "beforeend",
    materialRow({ id: materialId(type, defaultName), name: defaultName, enabled: 1, width_cm: type === "fabric" ? 340 : 280, price_per_m: 0 }, type)
  );
  return true;
}

function renderParams(p) {
  paramsState = p;
  const labels = [
    { key: "top_nonwoven_allowance_cm", label: "上包衬余量 cm" },
    { key: "bottom_hem_allowance_cm", label: "底边余量 cm" },
    { key: "material_issue_buffer_cm", label: "发料安全余量 cm" },
    { key: "roundingStepM", label: "用料进位 m" },
    { key: "spliceFeePerM", label: "拼接费 / m" },
    { key: "superHeightWarnM", label: "超高提醒 m" },
    { key: "manualHeightM", label: "人工报价高度 m" }
  ];
  const summary = $("paramsSummary");
  if (summary) {
    summary.innerHTML = labels.map((field) => {
      const value = pickGlobal(p.globals, [field.key], "");
      return `<label class="param-field"><span>${esc(field.label)}</span>${input(value, `type="number" step="0.01" data-global="${field.key}"`)}</label>`;
    }).join("");
  }
  const content = $("paramsContent");
  if (content) {
    content.innerHTML = `
      <div class="params-section">
        <h3>面料</h3>
        <div class="toolbar"><button class="btn small secondary" data-action="add-material" data-type="fabric">+ 添加面料</button></div>
        <div class="table-wrap"><table id="fabricTable"></table></div>
      </div>
      <div class="params-section">
        <h3>内衬</h3>
        <div class="toolbar"><button class="btn small secondary" data-action="add-material" data-type="lining">+ 添加内衬</button></div>
        <div class="table-wrap"><table id="liningTable"></table></div>
      </div>
      <div class="params-section">
        <h3>加工费规则</h3>
        <div class="table-wrap"><table id="laborTable"></table></div>
      </div>
      <div class="params-section">
        <h3>定型费规则</h3>
        <div class="table-wrap"><table id="memoryTable"></table></div>
      </div>
    `;
  }
  if ($("fabricTable")) renderTable("fabricTable", ["面料", "系列", "门幅 cm", "单价", "操作"], p.fabrics.map((f) => materialRow(f, "fabric")));
  if ($("liningTable")) renderTable("liningTable", ["内衬", "颜色", "门幅 cm", "单价", "操作"], p.linings.map((l) => materialRow(l, "lining")));
  if ($("laborTable")) renderTable("laborTable", ["层数", "下限 m", "上限 m", "单价"], p.laborRules.map((r, i) => `<tr data-row-index="${i}"><td><select data-field="layer"><option value="single"${r.layer === "single" ? " selected" : ""}>single</option><option value="double"${r.layer === "double" ? " selected" : ""}>double</option></select></td><td>${input(r.min_m, 'type="number" step="0.01" data-field="min_m"')}</td><td>${input(r.max_m ?? "", 'type="number" step="0.01" data-field="max_m"')}</td><td>${input(r.rate_rmb_per_m, 'type="number" step="0.01" data-field="rate_rmb_per_m"')}</td></tr>`));
  if ($("memoryTable")) renderTable("memoryTable", ["下限 m", "上限 m", "单层价", "双层系数"], p.memoryRules.map((r, i) => `<tr data-row-index="${i}"><td>${input(r.min_m, 'type="number" step="0.01" data-field="min_m"')}</td><td>${input(r.max_m ?? "", 'type="number" step="0.01" data-field="max_m"')}</td><td>${input(r.single_rate_rmb, 'type="number" step="0.01" data-field="single_rate_rmb"')}</td><td>${input(r.double_coef, 'type="number" step="0.01" data-field="double_coef"')}</td></tr>`));
}

async function loadParams() {
  try {
    const p = await json("/api/factory/params");
    renderParams(p);
    if ($("paramsStatus")) {
      $("paramsStatus").textContent = "参数已加载。";
      $("paramsStatus").classList.remove("hidden");
    }
  } catch (e) {
    if ($("paramsStatus")) {
      $("paramsStatus").textContent = `加载失败：${e.message}`;
      $("paramsStatus").classList.remove("hidden");
    }
    toast(e.message, "bad");
  }
}

function collectMaterialRows(tableId, type) {
  const table = $(tableId);
  if (!table) return [];
  const source = type === "fabric" ? (paramsState?.fabrics || []) : (paramsState?.linings || []);
  return [...table.querySelectorAll("tbody tr")].map((tr) => {
    const name = tr.querySelector('[data-field="name"]').value.trim();
    const metaField = type === "fabric" ? "series" : "color";
    const id = tr.dataset.id || materialId(type, name);
    const original = source.find((row) => row.id === id);
    tr.dataset.id = id;
    return {
      id,
      name,
      [metaField]: tr.querySelector(`[data-field="${metaField}"]`).value.trim(),
      width_cm: tr.querySelector('[data-field="width_cm"]').value,
      price_per_m: tr.querySelector('[data-field="price_per_m"]').value,
      enabled: original?.enabled ?? 1
    };
  }).filter((row) => row.name);
}

function collectRuleRows(tableId) {
  const table = $(tableId);
  if (!table) return [];
  const source = tableId === "laborTable" ? (paramsState?.laborRules || []) : (paramsState?.memoryRules || []);
  return [...table.querySelectorAll("tbody tr")].map((tr) => {
    const idx = Number(tr.dataset.rowIndex);
    const original = Number.isFinite(idx) ? source[idx] : null;
    const row = {};
    tr.querySelectorAll("[data-field]").forEach((el) => { row[el.dataset.field] = el.value; });
    row.note = original?.note || "";
    if (tableId === "memoryTable") row.manual_quote = original?.manual_quote ?? 0;
    return row;
  });
}

async function saveParams() {
  if (!paramsState) return;
  if (!confirm("确定保存生产参数？")) return;
  try {
    const globals = {};
    document.querySelectorAll("[data-global]").forEach((el) => { globals[el.dataset.global] = el.value; });
    const body = {
      globals,
      fabrics: collectMaterialRows("fabricTable", "fabric"),
      linings: collectMaterialRows("liningTable", "lining"),
      laborRules: collectRuleRows("laborTable"),
      memoryRules: collectRuleRows("memoryTable")
    };
    const saved = await json("/api/factory/params", { method: "PUT", body: JSON.stringify(body) });
    renderParams(saved);
    if ($("paramsStatus")) {
      $("paramsStatus").textContent = "生产参数已保存。";
      $("paramsStatus").classList.remove("hidden");
    }
    toast("参数已保存");
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function loadUsers(channelFilter) {
  try {
    const url = channelFilter ? `/api/users?channel=${channelFilter}` : "/api/users";
    const rows = await json(url);
    const body = rows.map((u) => `<tr>
      <td>${u.id}</td>
      <td>${channelLabel(u.channel)}</td>
      <td><strong class="user-name">${esc(u.username)}</strong></td>
      <td>${u.enabled ? '<span class="pill good">启用</span>' : '<span class="pill bad">停用</span>'}</td>
      <td class="users-action-cell">
        <div class="users-action-group">
          <button class="btn tiny secondary" data-action="edit" data-id="${u.id}" data-channel="${u.channel}" data-username="${esc(u.username)}">编辑</button>
          <button class="btn tiny danger" data-action="delete" data-id="${u.id}">删除</button>
        </div>
      </td>
    </tr>`);
    renderTable("usersTable", ["ID", "渠道", "用户名", "状态", "操作"], body);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function showUserForm(channel = "shopify", username = "") {
  const form = $("userForm");
  if (!form) return;
  form.classList.remove("hidden");
  $("userFormChannel").value = channel;
  $("userFormChannel").disabled = Boolean(username);
  $("userFormUsername").value = username;
  $("userFormUsername").disabled = false;
  $("userFormPassword").value = "";
  $("userFormPassword").placeholder = username ? "留空则不修改" : "登录密码";
  if (!username) editingUserId = null;
}

function hideUserForm() {
  $("userForm")?.classList.add("hidden");
  editingUserId = null;
}

function initUsers() {
  $("userChannelFilter")?.addEventListener("change", () => loadUsers($("userChannelFilter").value));
  $("addUserBtn")?.addEventListener("click", () => {
    editingUserId = null;
    showUserForm("shopify", "");
  });
  $("userFormCancelBtn")?.addEventListener("click", hideUserForm);
  $("userFormSaveBtn")?.addEventListener("click", async () => {
    const channel = $("userFormChannel").value;
    const username = $("userFormUsername").value.trim();
    const password = $("userFormPassword").value;
    if (!username) return toast("请输入用户名", "bad");
    try {
      if (editingUserId) {
        const body = { username, display_name: username, role: "admin", enabled: 1 };
        if (password) body.password = password;
        await json(`/api/users/${editingUserId}`, { method: "PUT", body: JSON.stringify(body) });
        toast("用户已更新");
      } else {
        if (!password) return toast("请输入密码", "bad");
        await json("/api/users", { method: "POST", body: JSON.stringify({ channel, username, password, display_name: username, role: "operator" }) });
        toast("用户已创建");
      }
      hideUserForm();
      loadUsers($("userChannelFilter")?.value || "");
    } catch (e) {
      toast(e.message, "bad");
    }
  });

  $("usersTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const username = btn.dataset.username || "";
    if (action === "edit") {
      editingUserId = id;
      showUserForm(btn.dataset.channel, username);
      return;
    }
    if (action === "delete") {
      if (!confirm(`确定删除用户 ${username}？`)) return;
      try {
        await json(`/api/users/${id}`, { method: "DELETE" });
        toast("用户已删除");
        loadUsers($("userChannelFilter")?.value || "");
      } catch (err) {
        toast(err.message, "bad");
      }
    }
  });
}

function normalizeItemCode(code) {
  return String(code || "").replace(/^(定制-?|定制-)/, "定制-");
}

function optionDisplayRows(item) {
  const calc = item.calc_detail || {};
  const options = item.selected_options || {};
  const groups = calc.product?.options || [];
  const byKey = new Map(groups.map((g) => [g.option_key || g.key, g]));
  return Object.entries(options).map(([key, value]) => {
    const group = byKey.get(key) || {};
    const found = (group.values || []).find((v) => String(v.label) === String(value)) || {};
    return {
      itemId: item.id,
      key,
      label: group.label || key,
      value,
      priceUsd: found.price_usd ?? found.price ?? "",
      costRmb: found.cost_rmb ?? found.costRmb ?? ""
    };
  });
}

function orderItemModulesHtml(order) {
  const items = order.items || [];
  if (!items.length) return '<div class="notice">暂无项目。</div>';

  // Group by product name
  const groups = new Map();
  for (const it of items) {
    const name = it.product_name || "产品";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(it);
  }

  return Array.from(groups.entries()).map(([productName, groupItems]) => {
    const totalCount = groupItems.length;
    const totalQty = groupItems.reduce((s, it) => s + (Math.max(1, Number(it.qty) || 1)), 0);
    const headerLabel = totalCount === 1
      ? `${totalQty}条`
      : `${totalCount}项, 共${totalQty}条`;

    const rows = groupItems.map((it) => {
      const itemCode = esc(normalizeItemCode(it.item_code));
      const size = `${fmt(it.width_in, 0)}×${fmt(it.length_in, 0)}`;
      const qty = Math.max(1, Number(it.qty) || 1);
      const itemPrice = Number(it.sales_usd) || 0;
      const optRows = optionDisplayRows(it);
      const optSummary = optRows.map(r => `${esc(r.label)}: ${esc(r.value)}`).join(" / ");
      return `<div class="item-group-row">
        <span class="item-row-code">${itemCode}</span>
        <span class="item-row-size">${size}</span>
        <span class="item-row-qty">×${qty}</span>
        <span class="item-row-price">$${fmt(itemPrice)}</span>
        ${optSummary ? `<span class="item-row-opts">${optSummary}</span>` : ""}
      </div>`;
    }).join("");

    return `<div class="item-group-card">
      <div class="item-group-header">
        <span class="item-group-name">${esc(productName)}</span>
        <span class="item-group-count">${headerLabel}</span>
      </div>
      ${rows}
    </div>`;
  }).join("");
}

async function viewOrderModal(orderId) {
  try {
    const order = await json(`/api/orders/${orderId}`);
    const title = $("orderDetailTitle");
    const content = $("orderDetailContent");
    if (!title || !content) return;
    title.textContent = "订单 " + esc(order.order_no || "#" + order.id);
    const logisticsCost = Number(order.logistics_cost_rmb) || 0;
    const field = (label, value) => `<div><label>${label}<span class="detail-value">${esc(String(value || ""))}</span></label></div>`;
    content.innerHTML =
      '<div class="detail-grid">' +
      field("下单日期", order.order_date) +
      field("交期日期", order.delivery_date) +
      field("客户姓名", order.customer_name) +
      field("邮箱", order.customer_email) +
      field("电话", order.customer_phone) +
      field("地址", order.customer_address) +
      field("备注", order.remark) +
      '</div>' +
      '<div class="detail-section"><h4>物流信息</h4><div class="detail-grid">' +
      field("货代", order.logistics_provider) +
      field("尾程派送渠道", order.delivery_channel) +
      field("尾程追踪编码", order.tracking_number) +
      field("重量 KG", order.weight_kg) +
      field("物流成本 RMB", logisticsCost) +
      '</div></div>' +
      '<div class="detail-section"><h4>项目</h4>' +
      orderItemModulesHtml(order) +
      '</div>';
    $("orderDetailModal").classList.remove("hidden");
    const closeHandler = () => $("orderDetailModal").classList.add("hidden");
    $("closeOrderDetailBtn").onclick = closeHandler;
    $("closeOrderDetailModal").onclick = closeHandler;
  } catch (e) {
    toast(e.message, "bad");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();

  try {
    const boot = await json("/api/bootstrap");
    if (boot.rates) rates = boot.rates;
  } catch (e) {
    /* use defaults */
  }

  $("summaryChannelFilter")?.addEventListener("change", () => renderSummaryTable(allOrdersCache));
  $("summaryStatusFilter")?.addEventListener("change", () => renderSummaryTable(allOrdersCache));
  $("summarySearchInput")?.addEventListener("input", () => renderSummaryTable(allOrdersCache));
  $("summaryRefreshBtn")?.addEventListener("click", () => loadSummary());
  $("summaryTable")?.addEventListener("click", (e) => {
    const link = e.target.closest("[data-view-order]");
    if (link) viewOrderModal(link.dataset.viewOrder);
  });

  $("profitOrderSelect")?.addEventListener("change", (e) => loadProfitDetail(e.target.value));
  $("profitRefreshBtn")?.addEventListener("click", () => loadProfitOrderList());

  $("refreshParamsBtn")?.addEventListener("click", () => loadParams());
  $("saveParamsBtn")?.addEventListener("click", () => saveParams());
  document.addEventListener("click", (e) => {
    if (e.target?.dataset?.action === "add-material") appendMaterialRow(e.target.dataset.type);
    if (e.target?.dataset?.action === "delete-material") { if (confirm('确认删除此材料？')) e.target.closest("tr")?.remove(); }
  });

  initUsers();
  if ($("paramsStatus")) loadParams();
  else loadSummary();
});
