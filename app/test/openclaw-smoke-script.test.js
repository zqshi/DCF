const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('openclaw smoke script requires login cookie flow before front APIs', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/openclaw-smoke.sh');
  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.equal(content.includes('/api/auth/login'), true);
  assert.equal(content.includes('-c "$COOKIE_JAR"'), true);
  assert.equal(content.includes('-b "$COOKIE_JAR" -X POST "$BASE_URL/api/front/employees"'), true);
  assert.equal(content.includes('-b "$COOKIE_JAR" -X POST "$BASE_URL/api/front/tasks"'), true);
  assert.equal(content.includes('SMOKE_ACCEPT_FAILED="${DCF_SMOKE_ACCEPT_FAILED:-0}"'), true);
  assert.equal(content.includes('expected final_status=succeeded'), true);
});
