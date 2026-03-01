const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tools page uses drawer pattern for mcp service create/edit', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/tools.html');
  const jsFile = path.resolve(__dirname, '..', 'public/admin/tools.js');
  const html = fs.readFileSync(file, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');
  assert.equal(html.includes('id="mcpEditorDrawer"'), true);
  assert.equal(html.includes('id="mcpDrawerMask"'), true);
  assert.equal(html.includes('id="mcpRows"'), true);
  assert.equal(html.includes('id="createMcpBtn" type="button" class="primary" data-required-permission="admin.tools.action.create-service"'), true);
  assert.equal(html.includes('id="mcpSaveBtn" type="button" class="primary" data-required-permission="admin.tools.assets.write"'), true);
  assert.equal(html.includes('相关页面'), false);
  assert.equal(html.includes('/admin/tools-approvals.html'), false);
  assert.equal(html.includes('/admin/tools-policy.html'), false);
  assert.equal(html.includes('/admin/tools-audit.html'), false);
  assert.equal(html.includes('id="mcpEditor" class="card'), false);
  assert.equal(js.includes('data-required-permission="admin.tools.action.update-service"'), true);
  assert.equal(js.includes('data-required-permission="admin.tools.action.check-health"'), true);
  assert.equal(js.includes('data-required-permission="admin.tools.action.delete-service"'), true);
  assert.equal(js.includes('window.adminApplyActionAclForRoot'), true);
});

test('tools approval page contains pending table and action script', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/tools-approvals.html');
  const html = fs.readFileSync(file, 'utf8');
  assert.equal(html.includes('id="pendingRows"'), true);
  assert.equal(html.includes('/admin/tools-approvals.js'), true);
});
