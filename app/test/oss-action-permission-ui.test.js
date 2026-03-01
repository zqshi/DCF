const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('oss detail actions expose button-level permission guards', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'public/admin/oss.js'), 'utf8');
  assert.equal(js.includes('id="approveIntroduceBtn" type="button" data-required-permission="admin.oss.action.approve-case"'), true);
  assert.equal(js.includes('id="approveBuildBtn" type="button" data-required-permission="admin.oss.action.approve-case"'), true);
  assert.equal(js.includes('id="rejectBtn" type="button" data-required-permission="admin.oss.action.approve-case"'), true);
  assert.equal(js.includes('id="deployBtn" type="button" data-required-permission="admin.oss.action.deploy"'), true);
  assert.equal(js.includes('id="verifyBtn" type="button" data-required-permission="admin.oss.action.verify"'), true);
  assert.equal(js.includes('id="rollbackBtn" type="button" data-required-permission="admin.oss.action.rollback"'), true);
  assert.equal(js.includes('window.adminApplyActionAclForRoot'), true);
});
