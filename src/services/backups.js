const fs = require('fs');
const path = require('path');
const { db, backupDir } = require('../db');
const { getProducts } = require('./products');

function now() { return new Date().toISOString(); }

const VALID_TABLES = new Set(['globals','fabrics','linings','products','product_width_prices','product_length_prices','product_option_groups','product_option_values','labor_rules','memory_rules','tax_rates','orders','order_items','factory_feedback','backups','users']);
function all(table, order = '1') {
  if (!VALID_TABLES.has(table)) throw new Error('Invalid table name');
  if (!/^[a-zA-Z0-9_,\s]+$/.test(order)) throw new Error('Invalid order clause');
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
}
function exportBackupPayload() {
  return {
    schema: 'twodrapes_factory_tool_sqlite_v1',
    exportedAt: now(),
    data: {
      globals: all('globals', 'key'),
      fabrics: all('fabrics', 'name'),
      linings: all('linings', 'name'),
      products: getProducts(),
      laborRules: all('labor_rules', 'sort_order,id'),
      memoryRules: all('memory_rules', 'sort_order,id'),
      taxRates: all('tax_rates', 'code'),
      orders: all('orders', 'id'),
      orderItems: all('order_items', 'id')
    }
  };
}
function makeBackup(type = 'auto', note = '') {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now().replace(/[:.]/g, '-');
  const filePath = path.join(backupDir, `twodrapes_${type}_${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(exportBackupPayload(), null, 2), 'utf8');
  const info = db.prepare('INSERT INTO backups(backup_type,file_path,created_at,note) VALUES(?,?,?,?)').run(type, filePath, now(), note);
  return db.prepare('SELECT * FROM backups WHERE id=?').get(info.lastInsertRowid);
}
function pruneAutoBackups() {
  const rows = db.prepare("SELECT * FROM backups WHERE backup_type='auto' ORDER BY created_at DESC").all();
  rows.slice(10).forEach(r => {
    try { if (fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); } catch {}
    db.prepare('DELETE FROM backups WHERE id=?').run(r.id);
  });
}
function importBackupPayload(payload) {
  const data = payload.data || payload;
  const tx = db.transaction(() => {
    for (const table of ['order_items', 'orders', 'product_option_values', 'product_option_groups', 'product_width_prices', 'product_length_prices', 'products', 'fabrics', 'linings', 'labor_rules', 'memory_rules', 'tax_rates', 'globals']) db.prepare(`DELETE FROM ${table}`).run();
    (data.globals || []).forEach(g => db.prepare('INSERT INTO globals(key,value,value_type,note,updated_at) VALUES(?,?,?,?,?)').run(g.key, g.value, g.value_type || 'text', g.note || '', g.updated_at || now()));
    (data.fabrics || []).forEach(f => db.prepare('INSERT INTO fabrics(id,name,series,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(f.id, f.name, f.series, f.width_cm, f.price_per_m, f.enabled, f.created_at || now(), f.updated_at || now()));
    (data.linings || []).forEach(l => db.prepare('INSERT INTO linings(id,name,color,width_cm,price_per_m,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(l.id, l.name, l.color, l.width_cm, l.price_per_m, l.enabled, l.created_at || now(), l.updated_at || now()));
    const { upsertProduct } = require('./products');
    (data.products || []).forEach(upsertProduct);
    (data.taxRates || []).forEach(t => db.prepare('INSERT INTO tax_rates(code,state,rate,note) VALUES(?,?,?,?)').run(t.code, t.state, t.rate, t.note || ''));
    (data.laborRules || []).forEach((r, i) => db.prepare('INSERT INTO labor_rules(layer,min_m,max_m,rate_rmb_per_m,note,sort_order) VALUES(?,?,?,?,?,?)').run(r.layer, r.min_m, r.max_m, r.rate_rmb_per_m, r.note || '', r.sort_order ?? i));
    (data.memoryRules || []).forEach((r, i) => db.prepare('INSERT INTO memory_rules(min_m,max_m,single_rate_rmb,double_coef,manual_quote,note,sort_order) VALUES(?,?,?,?,?,?,?)').run(r.min_m, r.max_m, r.single_rate_rmb, r.double_coef, r.manual_quote, r.note || '', r.sort_order ?? i));
  });
  tx();
}

module.exports = { makeBackup, exportBackupPayload, importBackupPayload, pruneAutoBackups };
