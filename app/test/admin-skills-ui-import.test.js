const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin skills import supports zip bundle payload', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/skills.js');
  const js = fs.readFileSync(file, 'utf8');
  assert.equal(js.includes("endsWith('.zip')"), true);
  assert.equal(js.includes('Content-Type\': \'application/zip\''), true);
  assert.equal(js.includes('/api/admin/skills/import?mode=merge&bundleName='), true);
});
