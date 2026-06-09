const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Use a temporary database for testing
const testDbPath = path.join(__dirname, '..', 'data', 'test.sqlite');
process.env.TEST_DB = testDbPath;

// Remove test db if exists
try { fs.unlinkSync(testDbPath); } catch {}

const { db, initDb, seedIfEmpty } = require('../src/db');

test('initDb creates all expected tables', () => {
  initDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const expected = ['globals', 'fabrics', 'linings', 'products', 'product_width_prices', 'product_length_prices', 'product_option_groups', 'product_option_values', 'labor_rules', 'memory_rules', 'tax_rates', 'orders', 'order_items', 'factory_feedback', 'backups'];
  for (const t of expected) {
    assert.ok(tables.includes(t), `Missing table: ${t}`);
  }
});

test('seedIfEmpty populates default data', () => {
  seedIfEmpty();
  const globals = db.prepare('SELECT COUNT(*) AS c FROM globals').get().c;
  assert.ok(globals > 0, 'Globals should be seeded');
  const fabrics = db.prepare('SELECT COUNT(*) AS c FROM fabrics').get().c;
  assert.ok(fabrics > 0, 'Fabrics should be seeded');
});

test('runMigrations completes without error', () => {
  // initDb already runs migrations
  const cols = db.prepare('PRAGMA table_info(orders)').all();
  const channelCol = cols.find(r => r.name === 'channel');
  const statusCol = cols.find(r => r.name === 'status');
  assert.ok(channelCol, 'orders.channel column should exist after migration');
  assert.ok(statusCol, 'orders.status column should exist after migration');
});

// Cleanup
test('cleanup test database', () => {
  db.close();
  try { fs.unlinkSync(testDbPath); } catch {}
});
