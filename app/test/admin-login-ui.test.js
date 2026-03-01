const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin login page supports bridge-first login in testing phase', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public', 'admin', 'login.html');
  const jsFile = path.resolve(__dirname, '..', 'public', 'admin', 'login.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');

  assert.equal(html.includes('id="tabBridge"'), true);
  assert.equal(html.includes('id="tabAuthorize"'), true);
  assert.equal(html.includes('id="bridgeLoginForm"'), true);
  assert.equal(html.includes('id="authorizePanel"'), true);
  assert.equal(html.includes('id="ssoAuthorizeBtn"'), true);
  assert.equal(html.includes('id="bridgeLoginBtn"'), true);
  assert.equal(html.includes('账号密码登录'), true);
  assert.equal(html.includes('SSO Bridge Token（桥接模式）'), true);
  assert.equal(js.includes('/api/auth/login'), true);
  assert.equal(js.includes('/api/auth/sso/bridge-login'), true);
  assert.equal(js.includes('/api/auth/sso/authorize'), true);
});
