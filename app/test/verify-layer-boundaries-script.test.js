const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const scriptPath = path.resolve(__dirname, '../scripts/verify-layer-boundaries.js');

function runScript(args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    env: { ...process.env },
    encoding: 'utf8'
  });
}

test('verify-layer-boundaries passes for current project', () => {
  const result = runScript();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(String(result.stdout || '{}'));
  assert.equal(body.ok, true);
  assert.ok(Number(body.checkedFiles || 0) > 0);
});

test('verify-layer-boundaries reports violation for interfaces importing domain directly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-layers-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'interfaces'), { recursive: true });
  fs.mkdirSync(path.join(src, 'domain'), { recursive: true });
  fs.writeFileSync(path.join(src, 'domain', 'entities.js'), 'module.exports = { ok: true };', 'utf8');
  fs.writeFileSync(
    path.join(src, 'interfaces', 'bad.js'),
    "const x = require('../domain/entities'); module.exports = x;",
    'utf8'
  );

  const result = runScript([`--root=${root}`]);
  assert.equal(result.status, 1);
  const body = JSON.parse(String(result.stderr || '{}'));
  assert.equal(body.ok, false);
  assert.ok(Array.isArray(body.violations));
  assert.equal(body.violations.some((x) => x.fromLayer === 'interfaces' && x.toLayer === 'domain'), true);
});
