const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.resolve(__dirname, '../scripts/verify-composite-consistency.js');

test('verify composite consistency script passes for current baseline', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(String(result.stdout || '{}'));
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.checks), true);
  assert.equal(body.checks.length >= 4, true);
});
