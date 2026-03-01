const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tools approvals actions expose button-level permission guards', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'public/admin/tools-approvals.js'), 'utf8');
  assert.equal(js.includes('data-required-permission="admin.tools.action.approve-service"'), true);
  assert.equal(js.includes('data-required-permission="admin.tools.action.reject-service"'), true);
  assert.equal(js.includes('data-required-permission="admin.tools.action.rollback-service"'), true);
  assert.equal(js.includes('data-required-permission="admin.tools.action.resubmit-service"'), true);
  assert.equal(js.includes('window.adminApplyActionAclForRoot'), true);
});
