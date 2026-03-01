const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('auth users page hides password setup and reset actions for SSO flow', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public/admin/auth-users.html');
  const jsFile = path.resolve(__dirname, '..', 'public/admin/auth-members.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');

  assert.equal(html.includes('id="newPassword"'), false);
  assert.equal(html.includes('初始密码'), false);
  assert.equal(js.includes('data-reset-password'), false);
  assert.equal(js.includes('重置密码'), false);
});
