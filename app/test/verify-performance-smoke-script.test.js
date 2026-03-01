const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.resolve(__dirname, '../scripts/verify-performance-smoke.js');

test('verify-performance-smoke passes under relaxed threshold', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--tasks=80', '--max-ms=20000'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(String(result.stdout || '{}'));
  assert.equal(body.ok, true);
  assert.equal(body.tasks, 80);
});
