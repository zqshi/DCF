const test = require('node:test');
const assert = require('node:assert/strict');
const { NAV_ITEMS, resolveApiPermission, resolvePagePermission } = require('../src/shared/adminAcl');

test('admin acl resolves api permissions by method and path', () => {
  assert.equal(resolveApiPermission('/api/admin/runtime-status', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/runtime/shadow-diffs', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/runtime/shadow-policy', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/runtime/shadow-policy', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/overview', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/runtime/retrieval-policy', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/runtime/retrieval-policy', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/strategy-center', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/strategy-center', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/prompt-center', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/prompt-center', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/prompt-center/compile', 'POST'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/prompt-versions', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/prompt-versions/publish', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/prompt-versions/approve', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/prompt-versions/rollback', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/autoevolve/runs', 'GET'), 'admin.runtime.read');
  assert.equal(resolveApiPermission('/api/admin/autoevolve/run', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/autoevolve/promote', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/autoevolve/revert', 'POST'), 'admin.runtime.write');
  assert.equal(resolveApiPermission('/api/admin/bootstrap/run-cycle', 'POST'), 'admin.runtime.write');

  assert.equal(resolveApiPermission('/api/admin/tasks/abc', 'GET'), 'admin.tasks.read');
  assert.equal(resolveApiPermission('/api/admin/employees/abc/policy', 'POST'), 'admin.employees.write');
  assert.equal(resolveApiPermission('/api/admin/employees/abc/runtime-files/AGENTS.md', 'PUT'), 'admin.employees.write');
  assert.equal(resolveApiPermission('/api/admin/employees/retrieval-policy/rollout', 'POST'), 'admin.employees.write');
  assert.equal(resolveApiPermission('/api/admin/employees/retrieval-policy/rollback', 'POST'), 'admin.employees.write');

  assert.equal(resolveApiPermission('/api/admin/skills/export', 'GET'), 'admin.skills.read');
  assert.equal(resolveApiPermission('/api/admin/skills/abc', 'GET'), 'admin.skills.read');
  assert.equal(resolveApiPermission('/api/admin/skills/import', 'POST'), 'admin.skills.write');
  assert.equal(resolveApiPermission('/api/admin/skills/abc/approve', 'POST'), 'admin.skills.write');
  assert.equal(resolveApiPermission('/api/admin/skills/abc/unlink', 'POST'), 'admin.skills.action.unlink-employee');
  assert.equal(resolveApiPermission('/api/admin/skills/abc', 'DELETE'), 'admin.skills.action.delete');

  assert.equal(resolveApiPermission('/api/admin/tools', 'GET'), 'admin.tools.assets.read');
  assert.equal(resolveApiPermission('/api/admin/tools/pending', 'GET'), 'admin.tools.approval.read');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services', 'GET'), 'admin.tools.assets.read');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/', 'GET'), 'admin.tools.assets.read');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services', 'POST'), 'admin.tools.action.create-service');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime', 'POST'), 'admin.tools.action.update-service');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime/delete', 'POST'), 'admin.tools.action.delete-service');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime/check-health', 'POST'), 'admin.tools.action.check-health');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime/approve', 'POST'), 'admin.tools.action.approve-service');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime/reject', 'POST'), 'admin.tools.action.reject-service');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime/rollback', 'POST'), 'admin.tools.action.rollback-service');
  assert.equal(resolveApiPermission('/api/admin/tools/mcp-services/mcp-openclaw-runtime/resubmit', 'POST'), 'admin.tools.action.resubmit-service');
  assert.equal(resolveApiPermission('/api/admin/tools/retrieval-policy', 'GET'), 'admin.tools.policy.read');
  assert.equal(resolveApiPermission('/api/admin/tools/retrieval-policy', 'POST'), 'admin.tools.policy.write');
  assert.equal(resolveApiPermission('/api/admin/tools/retrieval-metrics', 'GET'), 'admin.tools.policy.read');

  assert.equal(resolveApiPermission('/api/admin/audit-status', 'GET'), 'admin.logs.read');
  assert.equal(resolveApiPermission('/api/admin/audit-anchor', 'POST'), 'admin.logs.write');
  assert.equal(resolveApiPermission('/api/admin/oss-findings', 'GET'), 'admin.oss.read');
  assert.equal(resolveApiPermission('/api/admin/oss-cases', 'GET'), 'admin.oss.read');
  assert.equal(resolveApiPermission('/api/admin/oss-cases/case-1', 'GET'), 'admin.oss.read');
  assert.equal(resolveApiPermission('/api/admin/oss-cases/case-1/approve', 'POST'), 'admin.oss.action.approve-case');

  assert.equal(resolveApiPermission('/api/admin/tasks/approve', 'POST'), 'admin.tasks.write');
  assert.equal(resolveApiPermission('/api/admin/tasks/rollback', 'POST'), 'admin.tasks.write');
  assert.equal(resolveApiPermission('/api/admin/tasks/task-1/retry-compensation', 'POST'), 'admin.tasks.write');

  assert.equal(resolveApiPermission('/api/admin/auth/health', 'GET'), 'admin.auth.read');
  assert.equal(resolveApiPermission('/api/admin/auth/users', 'GET'), 'admin.auth.read');
  assert.equal(resolveApiPermission('/api/admin/auth/roles', 'GET'), 'admin.auth.read');
  assert.equal(resolveApiPermission('/api/admin/auth/roles/permission-matrix-export', 'GET'), 'admin.auth.read');
  assert.equal(resolveApiPermission('/api/admin/auth/users', 'POST'), 'admin.auth.write');
  assert.equal(resolveApiPermission('/api/admin/auth/users/u-1/reset-password', 'POST'), 'admin.auth.write');
  assert.equal(resolveApiPermission('/api/admin/auth/roles', 'POST'), 'admin.auth.write');
  assert.equal(resolveApiPermission('/api/admin/auth/roles/ops_observer', 'POST'), 'admin.auth.write');
  assert.equal(resolveApiPermission('/api/admin/auth/roles/ops_observer/delete', 'POST'), 'admin.auth.write');
  assert.equal(resolveApiPermission('/api/admin/tasks', 'POST'), null);
});

test('admin acl resolves page permissions', () => {
  assert.equal(resolvePagePermission('/admin/index.html'), 'admin.runtime.page.platform-overview.read');
  assert.equal(resolvePagePermission('/admin/skills.html'), 'admin.skills.page.management.read');
  assert.equal(resolvePagePermission('/admin/tools.html'), 'admin.tools.page.assets.read');
  assert.equal(resolvePagePermission('/admin/tools-approvals.html'), 'admin.tools.page.approvals.read');
  assert.equal(resolvePagePermission('/admin/runtime-health.html'), 'admin.runtime.page.health.read');
  assert.equal(resolvePagePermission('/admin/runtime-cycles.html'), 'admin.runtime.page.cycles.read');
  assert.equal(resolvePagePermission('/admin/runtime-advanced.html'), 'admin.runtime.page.advanced.read');
  assert.equal(resolvePagePermission('/admin/strategy-center.html'), 'admin.runtime.write');
  assert.equal(resolvePagePermission('/admin/prompts.html'), 'admin.runtime.page.prompts.read');
  assert.equal(resolvePagePermission('/admin/autoevolve.html'), 'admin.runtime.page.autoevolve.read');
  assert.equal(resolvePagePermission('/admin/tasks-runtime.html'), 'admin.tasks.page.runtime.read');
  assert.equal(resolvePagePermission('/admin/tasks-governance.html'), 'admin.tasks.page.governance.read');
  assert.equal(resolvePagePermission('/admin/task-detail.html'), 'admin.tasks.page.overview.read');
  assert.equal(resolvePagePermission('/admin/logs-agent.html'), 'admin.logs.page.agent.read');
  assert.equal(resolvePagePermission('/admin/logs-admin.html'), 'admin.logs.page.admin.read');
  assert.equal(resolvePagePermission('/admin/employees-contracts.html'), 'admin.employees.page.contracts.read');
  assert.equal(resolvePagePermission('/admin/employees-growth.html'), 'admin.employees.page.growth.read');
  assert.equal(resolvePagePermission('/admin/auth-users.html'), 'admin.auth.page.users.read');
  assert.equal(resolvePagePermission('/admin/auth-roles.html'), 'admin.auth.page.roles.read');
  assert.equal(resolvePagePermission('/admin/auth-members.html'), 'admin.auth.page.members.read');
  assert.equal(resolvePagePermission('/admin/unknown.html'), null);
});

test('admin nav places 开源检索 before 工具管理', () => {
  const ossIndex = NAV_ITEMS.findIndex((item) => item.path === '/admin/oss.html');
  const toolsIndex = NAV_ITEMS.findIndex((item) => item.path === '/admin/tools.html');
  assert.ok(ossIndex >= 0);
  assert.ok(toolsIndex >= 0);
  assert.ok(ossIndex < toolsIndex);
});

test('admin nav includes tools second-level sections', () => {
  assert.ok(NAV_ITEMS.some((item) => item.path === '/admin/tools-approvals.html'));
  assert.ok(NAV_ITEMS.every((item) => item.path !== '/admin/tools-policy.html'));
  assert.ok(NAV_ITEMS.every((item) => item.path !== '/admin/tools-audit.html'));
});
