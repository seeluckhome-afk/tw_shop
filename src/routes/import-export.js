const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parseCsvBuffer, sendCsv, sendHtmlXls } = require('../utils/helpers');
const { makeBackup, pruneAutoBackups } = require('../services/backups');
const { configRows, productTemplateRows, applyProductTemplateRows, applyConfigRows, parseEasifyRows } = require('../services/importExport');
const { getProduct } = require('../services/products');
const { parseOrderImportRows } = require('../utils/orders');
const { orderRows } = require('../utils/orders');
const { notFound, requireAdmin, requireFile, route, sendOk } = require('../utils/api');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 导入路由
router.post('/import/easify-csv', requireAdmin, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', 'Easify CSV 导入前');
  const result = parseEasifyRows(parseCsvBuffer(req));
  pruneAutoBackups();
  sendOk(res, result);
}));

router.post('/import/config-csv', requireAdmin, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', '配置 CSV 导入前');
  const result = applyConfigRows(parseCsvBuffer(req));
  pruneAutoBackups();
  sendOk(res, result);
}));

router.post('/import/product-csv', requireAdmin, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', '产品模板 CSV 导入前');
  const result = applyProductTemplateRows(parseCsvBuffer(req));
  pruneAutoBackups();
  sendOk(res, result);
}));

router.post('/import/orders-csv', requireAdmin, upload.single('file'), route((req, res) => {
  requireFile(req);
  makeBackup('auto', '订单 CSV 导入前');
  const result = parseOrderImportRows(parseCsvBuffer(req));
  pruneAutoBackups();
  sendOk(res, result);
}));

// 导出路由
router.get('/export/product-template-csv', requireAdmin, (req, res) => {
  sendCsv(res, 'TWODRAPES_产品导入模板.csv', productTemplateRows());
});

router.get('/export/config-csv', requireAdmin, (req, res) => {
  sendCsv(res, 'TWODRAPES_完整配置.csv', configRows());
});

router.get('/export/product-csv/:id', requireAdmin, route((req, res) => {
  const p = getProduct(req.params.id);
  if (!p) notFound('产品不存在');
  sendCsv(res, `${p.name}_产品配置.csv`, configRows([p]));
}));

router.get('/export/order-import-template-csv', (req, res) => {
  sendCsv(res, 'TWODRAPES_订单导入模板.csv', [{
    channel: 'shopify',
    order_no: 'TW-TEST-001',
    order_date: '2026-05-26',
    delivery_date: '2026-05-30',
    customer_name: 'Alice',
    customer_email: 'alice@example.com',
    customer_phone: '123456',
    customer_address: 'Shanghai',
    tax_state_code: 'CA',
    tax_rate: '8.25',
    remark: '手动导入示例',
    product_id: '',
    product_name: 'Lucie DMDD',
    qty: '1',
    width_in: '52',
    length_in: '84',
    fabric_id: '',
    lining_id: 'lining_none',
    fullness: '2',
    selected_options: 'color:Snow White|memory_shaped:Without memory training',
    actual_paid_usd: '0',
    room_label: 'Living Room',
    item_remark: ''
  }]);
});

router.get('/export/factory-order/:orderId', route((req, res) => {
  const o = orderRows(req.params.orderId);
  if (!o) notFound('订单不存在');
  sendHtmlXls(res, `工厂生产单-${o.order_no || o.id}.xls`, require('../services/exports').factoryRows(o));
}));

router.get('/export/cost-record/:orderId', route((req, res) => {
  const o = orderRows(req.params.orderId);
  if (!o) notFound('订单不存在');
  sendCsv(res, `订单成本记录_${o.order_no || o.id}.csv`, require('../services/exports').costRows(o));
}));

module.exports = router;
