const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('net');

process.env.NO_AUTH = '1';
process.env.TEST_DB = require('path').join(__dirname, '..', 'data', 'test-api.sqlite');
process.env.NO_AUTO_LISTEN = '1';

const { app, factoryApp, amazonApp } = require('../server.js');
const { applyProductTemplateRows } = require('../src/services/importExport');
const { getProducts } = require('../src/services/products');
const { parseSelectedOptionsText } = require('../src/utils/orders');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function request(port, path, method = 'GET', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let appServer, factoryServer, amazonServer;
let appPort, factoryPort, amazonPort;

before(async () => {
  appPort = await getFreePort();
  factoryPort = await getFreePort();
  amazonPort = await getFreePort();
  appServer = app.listen(appPort, '127.0.0.1');
  factoryServer = factoryApp.listen(factoryPort, '127.0.0.1');
  amazonServer = amazonApp.listen(amazonPort, '127.0.0.1');
});

after(async () => {
  await new Promise(r => appServer.close(r));
  await new Promise(r => factoryServer.close(r));
  await new Promise(r => amazonServer.close(r));
  try { require('fs').unlinkSync(process.env.TEST_DB); } catch {}
});

test('health endpoint returns ok', async () => {
  const res = await request(appPort, '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('all three apps expose health endpoint without auth by default', async () => {
  const appRes = await request(appPort, '/api/health');
  const factoryRes = await request(factoryPort, '/api/health');
  const amazonRes = await request(amazonPort, '/api/health');
  assert.equal(appRes.status, 200);
  assert.equal(factoryRes.status, 200);
  assert.equal(amazonRes.status, 200);
});

test('NO_AUTH=0 requires Basic Auth for API requests', async () => {
  const previous = process.env.NO_AUTH;
  process.env.NO_AUTH = '0';
  try {
    const blocked = await request(appPort, '/api/health');
    assert.equal(blocked.status, 401);

    const auth = Buffer.from('admin:twodrapes2025').toString('base64');
    const allowed = await request(appPort, '/api/health', 'GET', undefined, { Authorization: `Basic ${auth}` });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.ok, true);
  } finally {
    process.env.NO_AUTH = previous;
  }
});

test('NO_AUTH=0 allows management JWT for management APIs', async () => {
  const previous = process.env.NO_AUTH;
  process.env.NO_AUTH = '0';
  try {
    const login = await request(factoryPort, '/api/auth/login', 'POST', {
      channel: 'shopify',
      username: 'twshop',
      password: 'twodrapes123'
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);

    const users = await request(factoryPort, '/api/users', 'GET', undefined, { Authorization: `Bearer ${login.body.token}` });
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(users.body));
  } finally {
    process.env.NO_AUTH = previous;
  }
});

test('NO_AUTH=0 keeps backup APIs admin-only', async () => {
  const previous = process.env.NO_AUTH;
  process.env.NO_AUTH = '0';
  try {
    const auth = Buffer.from('admin:twodrapes2025').toString('base64');
    const blocked = await request(appPort, '/api/backups', 'GET', undefined, { Authorization: `Basic ${auth}` });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.ok, false);
  } finally {
    process.env.NO_AUTH = previous;
  }
});

test('bootstrap returns context with globals', async () => {
  const res = await request(appPort, '/api/bootstrap');
  assert.equal(res.status, 200);
  assert.ok(res.body.globals);
  assert.ok(Array.isArray(res.body.fabrics));
});

test('calc item endpoint returns computed values', async () => {
  const bootstrap = await request(appPort, '/api/bootstrap');
  const product = bootstrap.body.products[0];
  const fabric = bootstrap.body.fabrics[0];
  const res = await request(appPort, '/api/calc/item', 'POST', {
    product_id: product.id,
    fabric_id: fabric.id,
    width_in: 50,
    length_in: 84,
    qty: 1,
    selectedOptions: { lining: 'Unlined' }
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.finalCostRmb > 0);
  assert.ok(res.body.salesUsd > 0);
});

test('orders CRUD works', async () => {
  const create = await request(appPort, '/api/orders', 'POST', {
    order_no: 'TEST-001',
    customer_name: 'Test User',
    items: [{
      product_id: 'lucie_linen_blend_curtain',
      width_in: 50,
      length_in: 84,
      qty: 1,
      selectedOptions: { lining: 'Unlined' }
    }]
  });
  assert.equal(create.status, 200);
  assert.ok(create.body.order);
  const orderId = create.body.order.id;

  const get = await request(appPort, `/api/orders/${orderId}`);
  assert.equal(get.status, 200);
  assert.equal(get.body.order_no, 'TEST-001');
  assert.equal(get.body.status, 'production');

  const status = await request(appPort, `/api/orders/${orderId}/status`, 'PUT', { status: 'shipping' });
  assert.equal(status.status, 200);
  assert.equal(status.body.order.status, 'shipping');

  const update = await request(appPort, `/api/orders/${orderId}`, 'PUT', {
    order_no: 'TEST-002',
    customer_name: 'Updated User',
    items: [{
      product_id: 'lucie_linen_blend_curtain',
      width_in: 60,
      length_in: 96,
      qty: 2,
      selectedOptions: { lining: 'Unlined' }
    }]
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.order.order_no, 'TEST-002');
  assert.equal(update.body.order.items.length, 1);

  const metadataUpdate = await request(appPort, `/api/orders/${orderId}`, 'PUT', {
    order_no: 'TEST-003',
    customer_name: 'Metadata Only',
    logistics_provider: 'UPS/FedEx-代理',
    delivery_channel: '尾程-A+B',
    tracking_number: '1234567890',
    weight_kg: 4.5,
    logistics_cost_rmb: 123
  });
  assert.equal(metadataUpdate.status, 200);
  assert.equal(metadataUpdate.body.order.order_no, 'TEST-003');
  assert.equal(metadataUpdate.body.order.items.length, 1);
  assert.equal(metadataUpdate.body.order.logistics_cost_rmb, 123);
  assert.equal(metadataUpdate.body.order.logistics_provider, 'UPS/FedEx-代理');
  assert.equal(metadataUpdate.body.order.delivery_channel, '尾程-A+B');
  assert.equal(metadataUpdate.body.order.tracking_number, '1234567890');
  assert.equal(metadataUpdate.body.order.weight_kg, 4.5);
  assert.ok(metadataUpdate.body.order.total_cost_rmb > 123);

  const del = await request(appPort, `/api/orders/${orderId}`, 'DELETE');
  assert.equal(del.status, 200);
});

test('common invalid API inputs return stable 400 or 404 responses', async () => {
  const missingOrder = await request(appPort, '/api/orders/999999');
  assert.equal(missingOrder.status, 404);
  assert.equal(missingOrder.body.ok, false);
  assert.equal(missingOrder.body.error, '订单不存在');

  const missingProduct = await request(appPort, '/api/products/no_such_product');
  assert.equal(missingProduct.status, 404);
  assert.equal(missingProduct.body.ok, false);
  assert.equal(missingProduct.body.error, '产品不存在');

  const badQty = await request(appPort, '/api/order-items/999999/qty', 'PUT', { qty: 0 });
  assert.equal(badQty.status, 400);
  assert.equal(badQty.body.ok, false);
  assert.equal(badQty.body.error, '数量必须大于 0');

  const badLogistics = await request(appPort, '/api/orders/999999/logistics', 'PUT', { logistics_cost_rmb: -1 });
  assert.equal(badLogistics.status, 400);
  assert.equal(badLogistics.body.ok, false);
  assert.equal(badLogistics.body.error, '物流成本不能为负数');
});

test('factory feedback CSV export works', async () => {
  const res = await request(factoryPort, '/api/factory/feedback/export-csv');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body, 'string');
  assert.ok(res.body.length > 0);
});

test('factory feedback import requires an uploaded file', async () => {
  const res = await request(factoryPort, '/api/factory/feedback/import', 'POST', {});
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, '请选择文件');
});

test('factory feedback delete requires explicit ids', async () => {
  const res = await request(factoryPort, '/api/factory/feedback', 'DELETE', {});
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, '请选择要删除的反馈记录');
});

test('backup list does not expose server file paths', async () => {
  const manual = await request(appPort, '/api/backups/manual', 'POST', { note: 'test backup' });
  assert.equal(manual.status, 200);

  const list = await request(appPort, '/api/backups');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body));
  assert.ok(list.body.length > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(list.body[0], 'file_path'), false);
  assert.ok(Object.prototype.hasOwnProperty.call(list.body[0], 'filename'));
});

test('factory params can add and delete fabrics and linings', async () => {
  const beforeSave = await request(factoryPort, '/api/factory/params');
  assert.equal(beforeSave.status, 200);

  const addedFabric = {
    id: 'fabric_test_factory',
    name: '测试面料',
    series: '测试系列',
    width_cm: 300,
    price_per_m: 18,
    enabled: 1
  };
  const addedLining = {
    id: 'lining_test_factory',
    name: '测试内衬',
    color: '测试颜色',
    width_cm: 280,
    price_per_m: 12,
    enabled: 1
  };
  const add = await request(factoryPort, '/api/factory/params', 'PUT', {
    globals: beforeSave.body.globals,
    fabrics: [...beforeSave.body.fabrics, addedFabric],
    linings: [...beforeSave.body.linings, addedLining],
    laborRules: beforeSave.body.laborRules,
    memoryRules: beforeSave.body.memoryRules
  });
  assert.equal(add.status, 200);
  assert.ok(add.body.fabrics.some(f => f.id === addedFabric.id));
  assert.ok(add.body.linings.some(l => l.id === addedLining.id));

  const remove = await request(factoryPort, '/api/factory/params', 'PUT', {
    globals: add.body.globals,
    fabrics: add.body.fabrics.filter(f => f.id !== addedFabric.id),
    linings: add.body.linings.filter(l => l.id !== addedLining.id),
    laborRules: add.body.laborRules,
    memoryRules: add.body.memoryRules
  });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.fabrics.some(f => f.id === addedFabric.id), false);
  assert.equal(remove.body.linings.some(l => l.id === addedLining.id), false);
});

test('product template import accepts header aliases', () => {
  const productName = `Alias Import ${Date.now()}`;
  const result = applyProductTemplateRows([{
    'Product Name': productName,
    'Default Fabric': '涤麻大肚',
    'Base Price USD': '59.99',
    'Width Prices': '20:7.99|22:8.99',
    'Length Prices': '30:9.99|32:10.99',
    'Option Groups': 'Color=Natural:0:0|White:0:0'
  }]);

  assert.equal(result.changed, 1);
  const product = getProducts().find((p) => p.name === productName);
  assert.ok(product);
  assert.equal(Number(product.base_price), 59.99);
  assert.equal(product.width_prices.length, 2);
  assert.equal(product.length_prices.length, 2);
  assert.equal(product.options.length, 1);
});

test('selected option parser keeps colons in values', () => {
  const result = parseSelectedOptionsText('note:Red:Special|color:Snow White');
  assert.equal(result.note, 'Red:Special');
  assert.equal(result.color, 'Snow White');
});
