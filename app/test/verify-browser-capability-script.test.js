const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('verify-browser-capability script enforces browser tool scope and runtime polling', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/verify-browser-capability.sh');
  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.equal(content.includes('/runtime/tasks'), true);
  assert.equal(content.includes('/runtime/tasks/$runtime_task_id/events'), true);
  assert.equal(content.includes('"toolScope":["browser"]'), true);
  assert.equal(content.includes('DCF_BROWSER_VERIFY_URL'), true);
  assert.equal(content.includes('DCF_BROWSER_EXPECT_TEXT'), true);
});
