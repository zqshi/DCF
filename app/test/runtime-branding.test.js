const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_FILES = [
  'public/front.html',
  'public/front.js',
  'public/admin/runtime.html',
  'public/admin/runtime.js',
  'public/admin/employees.html',
  'public/admin/employees.js',
  'public/admin/tasks.html',
  'public/admin/tasks.js',
  'public/admin/index.html',
  'public/admin/index.js'
];

test('public runtime surfaces avoid provider branding exposure', () => {
  const appRoot = path.resolve(__dirname, '..');
  for (const rel of PUBLIC_FILES) {
    const full = path.join(appRoot, rel);
    const text = fs.readFileSync(full, 'utf8');
    assert.equal(text.includes('OpenClaw'), false, `provider branding leaked in ${rel}`);
  }
});
