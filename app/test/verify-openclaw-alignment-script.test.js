const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.resolve(__dirname, '../scripts/verify-openclaw-alignment.js');

function runCheck(args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    env: { ...process.env },
    encoding: 'utf8'
  });
}

test('verify-openclaw-alignment passes in current aligned codebase', () => {
  const result = runCheck();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(String(result.stdout || '{}'));
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.checks), true);
  assert.equal(body.checks.length > 0, true);
});
