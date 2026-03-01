const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('agent logs keeps details expand state across auto refresh and only toggles on click', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/logs.js');
  const js = fs.readFileSync(file, 'utf8');

  assert.equal(js.includes('expandedRowKeys: new Set()'), true);
  assert.equal(js.includes("addEventListener('toggle'"), true);
  assert.equal(js.includes('data-row-key'), true);
  assert.equal(js.includes('openAttr'), true);
});
