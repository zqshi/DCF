const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin sidebar renders runtime/tasks/auth as expandable groups with second-level entries', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/auth.js');
  const js = fs.readFileSync(file, 'utf8');

  assert.equal(js.includes("navContainer.className = 'sidebar-nav'"), true);
  assert.equal(js.includes("data-sidebar-group-toggle=\"runtime\""), true);
  assert.equal(js.includes("{ path: '/admin/runtime.html', label: '总览', permission: 'admin.runtime.read' }"), false);
  assert.equal(js.includes("{ path: '/admin/runtime-health.html', label: '健康看板'"), false);
  assert.equal(js.includes("{ path: '/admin/runtime-cycles.html', label: '周期推进'"), false);
  assert.equal(js.includes("{ path: '/admin/runtime-advanced.html', label: '高级诊断'"), false);
  assert.equal(js.includes('/admin/strategy-center.html'), true);
  assert.equal(js.includes("{ path: '/admin/prompts.html', label: '提示词中心'"), false);
  assert.equal(js.includes("{ path: '/admin/autoevolve.html', label: '自治演进'"), false);
  assert.equal(js.includes('>运行管理</button>'), true);
  assert.equal(js.includes('data-sidebar-group-panel="runtime"'), true);

  assert.equal(js.includes("data-sidebar-group-toggle=\"tasks\""), true);
  assert.equal(js.includes('/admin/tasks-runtime.html'), true);
  assert.equal(js.includes('/admin/tasks-governance.html'), true);
  assert.equal(js.includes('data-sidebar-group-panel="tasks"'), true);
  assert.equal(js.includes("{ path: '/admin/tasks.html', label: '总览', permission: 'admin.tasks.read' }"), false);

  assert.equal(js.includes("data-sidebar-group-toggle=\"tools\""), true);
  assert.equal(js.includes('/admin/tools.html'), true);
  assert.equal(js.includes('/admin/tools-approvals.html'), true);
  assert.equal(js.includes('/admin/tools-policy.html'), false);
  assert.equal(js.includes('/admin/tools-audit.html'), false);
  assert.equal(js.includes('data-sidebar-group-panel="tools"'), true);

  assert.equal(js.includes("data-sidebar-group-toggle=\"auth\""), true);
  assert.equal(js.includes('/admin/auth-users.html'), true);
  assert.equal(js.includes('/admin/auth-roles.html'), true);
  assert.equal(js.includes('data-sidebar-group-panel="auth"'), true);

  assert.equal(js.includes("data-sidebar-group-toggle=\"logs\""), true);
  assert.equal(js.includes('/admin/logs-agent.html'), true);
  assert.equal(js.includes('/admin/logs-admin.html'), true);
  assert.equal(js.includes('data-sidebar-group-panel="logs"'), true);
  assert.equal(js.includes('function applyActionAclForRoot(root, user)'), true);
  assert.equal(js.includes('window.adminCanAccess = function adminCanAccess(permission)'), true);
  assert.equal(js.includes('window.adminApplyActionAclForRoot = function adminApplyActionAclForRoot(root = document)'), true);
});

test('admin sidebar layout keeps brand fixed and nav list scrollable', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/layout.css');
  const css = fs.readFileSync(file, 'utf8');
  assert.equal(css.includes('.sidebar-nav'), true);
  assert.equal(css.includes('flex: 0 0 auto;'), true);
  assert.equal(css.includes('overflow: hidden;'), true);
  assert.equal(css.includes('overflow: auto;'), true);
});
