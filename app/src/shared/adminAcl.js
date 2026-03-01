const API_ACL_RULES = [
  { method: 'GET', exact: '/api/admin/runtime-status', permission: 'admin.runtime.read' },
  { method: 'GET', exact: '/api/admin/runtime/shadow-diffs', permission: 'admin.runtime.read' },
  { method: 'GET', exact: '/api/admin/runtime/shadow-policy', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/runtime/shadow-policy', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/overview', permission: 'admin.runtime.read' },
  { method: 'GET', exact: '/api/admin/runtime/retrieval-policy', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/runtime/retrieval-policy', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/runtime/skill-sedimentation-policy', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/runtime/skill-sedimentation-policy', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/runtime/knowledge-sedimentation-policy', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/runtime/knowledge-sedimentation-policy', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/strategy-center', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/strategy-center', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/prompt-center', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/prompt-center', permission: 'admin.runtime.write' },
  { method: 'POST', exact: '/api/admin/prompt-center/compile', permission: 'admin.runtime.read' },
  { method: 'GET', exact: '/api/admin/prompt-versions', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/prompt-versions/publish', permission: 'admin.runtime.write' },
  { method: 'POST', exact: '/api/admin/prompt-versions/approve', permission: 'admin.runtime.write' },
  { method: 'POST', exact: '/api/admin/prompt-versions/rollback', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/autoevolve/runs', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/autoevolve/run', permission: 'admin.runtime.write' },
  { method: 'POST', exact: '/api/admin/autoevolve/promote', permission: 'admin.runtime.write' },
  { method: 'POST', exact: '/api/admin/autoevolve/revert', permission: 'admin.runtime.write' },
  { method: 'GET', exact: '/api/admin/bootstrap-status', permission: 'admin.runtime.read' },
  { method: 'POST', exact: '/api/admin/bootstrap/run-cycle', permission: 'admin.runtime.write' },

  { method: 'GET', exact: '/api/admin/employees', permission: 'admin.employees.read' },
  { method: 'POST', exact: '/api/admin/employees/retrieval-policy/rollout', permission: 'admin.employees.write' },
  { method: 'POST', exact: '/api/admin/employees/retrieval-policy/rollback', permission: 'admin.employees.write' },
  { method: 'GET', prefix: '/api/admin/employees/', permission: 'admin.employees.read' },
  { method: 'POST', prefix: '/api/admin/employees/', permission: 'admin.employees.write' },
  { method: 'PUT', prefix: '/api/admin/employees/', permission: 'admin.employees.write' },

  { method: 'GET', exact: '/api/admin/tasks', permission: 'admin.tasks.read' },
  { method: 'GET', prefix: '/api/admin/tasks/', permission: 'admin.tasks.read' },
  { method: 'POST', exact: '/api/admin/tasks/approve', permission: 'admin.tasks.write' },
  { method: 'POST', exact: '/api/admin/tasks/rollback', permission: 'admin.tasks.write' },
  { method: 'POST', prefix: '/api/admin/tasks/', permission: 'admin.tasks.write' },

  { method: 'GET', exact: '/api/admin/logs', permission: 'admin.logs.read' },
  { method: 'GET', exact: '/api/admin/audit-status', permission: 'admin.logs.read' },
  { method: 'POST', exact: '/api/admin/audit-anchor', permission: 'admin.logs.write' },

  { method: 'GET', exact: '/api/admin/skills', permission: 'admin.skills.read' },
  { method: 'GET', prefix: '/api/admin/skills/', permission: 'admin.skills.read' },
  { method: 'POST', exact: '/api/admin/skills/import', permission: 'admin.skills.write' },
  { method: 'POST', prefix: '/api/admin/skills/', permission: 'admin.skills.write' },
  { method: 'DELETE', prefix: '/api/admin/skills/', permission: 'admin.skills.action.delete' },

  { method: 'GET', exact: '/api/admin/tools', permission: 'admin.tools.assets.read' },
  { method: 'GET', exact: '/api/admin/tools/pending', permission: 'admin.tools.approval.read' },
  { method: 'GET', prefix: '/api/admin/tools/mcp-services', permission: 'admin.tools.assets.read' },
  { method: 'POST', exact: '/api/admin/tools/mcp-services', permission: 'admin.tools.action.create-service' },
  { method: 'GET', exact: '/api/admin/tools/retrieval-policy', permission: 'admin.tools.policy.read' },
  { method: 'POST', exact: '/api/admin/tools/retrieval-policy', permission: 'admin.tools.policy.write' },
  { method: 'GET', exact: '/api/admin/tools/retrieval-metrics', permission: 'admin.tools.policy.read' },

  { method: 'GET', exact: '/api/admin/oss-findings', permission: 'admin.oss.read' },
  { method: 'GET', exact: '/api/admin/knowledge-assets', permission: 'admin.oss.read' },
  { method: 'GET', exact: '/api/admin/knowledge-candidates', permission: 'admin.oss.read' },
  { method: 'GET', exact: '/api/admin/oss-cases', permission: 'admin.oss.read' },
  { method: 'GET', exact: '/api/admin/oss-governance-policy', permission: 'admin.oss.read' },
  { method: 'POST', prefix: '/api/admin/knowledge-assets/', permission: 'admin.oss.write' },
  { method: 'POST', prefix: '/api/admin/knowledge-candidates/', permission: 'admin.oss.write' },
  { method: 'POST', exact: '/api/admin/oss-governance-policy', permission: 'admin.oss.write' },
  { method: 'GET', prefix: '/api/admin/oss-cases/', permission: 'admin.oss.read' },
  { method: 'POST', prefix: '/api/admin/oss-cases/', permission: 'admin.oss.action.approve-case' },
  { method: 'GET', exact: '/api/admin/auth/health', permission: 'admin.auth.read' },
  { method: 'GET', exact: '/api/admin/auth/users', permission: 'admin.auth.read' },
  { method: 'GET', exact: '/api/admin/auth/roles', permission: 'admin.auth.read' },
  { method: 'GET', exact: '/api/admin/auth/roles/permission-matrix-export', permission: 'admin.auth.read' },
  { method: 'POST', exact: '/api/admin/auth/users', permission: 'admin.auth.write' },
  { method: 'POST', prefix: '/api/admin/auth/users/', permission: 'admin.auth.write' },
  { method: 'POST', exact: '/api/admin/auth/roles', permission: 'admin.auth.write' },
  { method: 'POST', prefix: '/api/admin/auth/roles/', permission: 'admin.auth.write' }
];

const PAGE_ACL = [
  { path: '/admin/index.html', permission: 'admin.runtime.page.platform-overview.read' },
  { path: '/admin/runtime.html', permission: 'admin.runtime.page.overview.read' },
  { path: '/admin/runtime-health.html', permission: 'admin.runtime.page.health.read' },
  { path: '/admin/runtime-cycles.html', permission: 'admin.runtime.page.cycles.read' },
  { path: '/admin/runtime-advanced.html', permission: 'admin.runtime.page.advanced.read' },
  { path: '/admin/strategy-center.html', permission: 'admin.runtime.write' },
  { path: '/admin/prompts.html', permission: 'admin.runtime.page.prompts.read' },
  { path: '/admin/autoevolve.html', permission: 'admin.runtime.page.autoevolve.read' },

  { path: '/admin/employees.html', permission: 'admin.employees.page.overview.read' },
  { path: '/admin/employees-contracts.html', permission: 'admin.employees.page.contracts.read' },
  { path: '/admin/employees-growth.html', permission: 'admin.employees.page.growth.read' },

  { path: '/admin/skills.html', permission: 'admin.skills.page.management.read' },

  { path: '/admin/tools.html', permission: 'admin.tools.page.assets.read' },
  { path: '/admin/tools-approvals.html', permission: 'admin.tools.page.approvals.read' },

  { path: '/admin/tasks.html', permission: 'admin.tasks.page.overview.read' },
  { path: '/admin/tasks-runtime.html', permission: 'admin.tasks.page.runtime.read' },
  { path: '/admin/tasks-governance.html', permission: 'admin.tasks.page.governance.read' },
  { path: '/admin/task-detail.html', permission: 'admin.tasks.page.overview.read' },

  { path: '/admin/logs.html', permission: 'admin.logs.page.behavior.read' },
  { path: '/admin/logs-agent.html', permission: 'admin.logs.page.agent.read' },
  { path: '/admin/logs-admin.html', permission: 'admin.logs.page.admin.read' },

  { path: '/admin/oss.html', permission: 'admin.oss.page.search.read' },
  { path: '/admin/auth-users.html', permission: 'admin.auth.page.users.read' },
  { path: '/admin/auth-roles.html', permission: 'admin.auth.page.roles.read' },
  { path: '/admin/auth-members.html', permission: 'admin.auth.page.members.read' }
];

const NAV_ITEMS = [
  { path: '/admin/index.html', label: '平台总览', permission: 'admin.runtime.page.platform-overview.read', group: '平台总览', groupOrder: 1, order: 1 },

  { path: '/admin/runtime.html', label: '运行总览', permission: 'admin.runtime.page.overview.read', group: '运行管理', groupOrder: 2, order: 1 },
  { path: '/admin/strategy-center.html', label: '治理中心', permission: 'admin.runtime.write', group: '运行管理', groupOrder: 2, order: 2 },

  { path: '/admin/tasks.html', label: '任务总览', permission: 'admin.tasks.page.overview.read', group: '任务管理', groupOrder: 3, order: 1 },
  { path: '/admin/tasks-runtime.html', label: '任务运行态', permission: 'admin.tasks.page.runtime.read', group: '任务管理', groupOrder: 3, order: 2 },
  { path: '/admin/tasks-governance.html', label: '任务治理态', permission: 'admin.tasks.page.governance.read', group: '任务管理', groupOrder: 3, order: 3 },

  { path: '/admin/employees.html', label: '员工总览', permission: 'admin.employees.page.overview.read', group: '员工管理', groupOrder: 4, order: 1 },
  { path: '/admin/employees-contracts.html', label: '岗位合同', permission: 'admin.employees.page.contracts.read', group: '员工管理', groupOrder: 4, order: 2 },
  { path: '/admin/employees-growth.html', label: '员工成长', permission: 'admin.employees.page.growth.read', group: '员工管理', groupOrder: 4, order: 3 },

  { path: '/admin/skills.html', label: '技能管理', permission: 'admin.skills.page.management.read', group: '资产审计', groupOrder: 5, order: 1 },
  { path: '/admin/oss.html', label: '开源检索', permission: 'admin.oss.page.search.read', group: '资产审计', groupOrder: 5, order: 2 },
  { path: '/admin/tools.html', label: '工具资产', permission: 'admin.tools.page.assets.read', group: '工具管理', groupOrder: 6, order: 1 },
  { path: '/admin/tools-approvals.html', label: '准入审批', permission: 'admin.tools.page.approvals.read', group: '工具管理', groupOrder: 6, order: 2 },
  { path: '/admin/logs.html', label: '行为日志', permission: 'admin.logs.page.behavior.read', group: '资产审计', groupOrder: 7, order: 1 },
  { path: '/admin/logs-agent.html', label: 'Agent 行为日志', permission: 'admin.logs.page.agent.read', group: '资产审计', groupOrder: 7, order: 2 },
  { path: '/admin/logs-admin.html', label: '后台操作日志', permission: 'admin.logs.page.admin.read', group: '资产审计', groupOrder: 7, order: 3 },

  { path: '/admin/auth-members.html', label: '成员管理', permission: 'admin.auth.page.members.read', group: '权限管理', groupOrder: 8, order: 1 },
  { path: '/admin/auth-roles.html', label: '角色管理', permission: 'admin.auth.page.roles.read', group: '权限管理', groupOrder: 8, order: 2 }
];

const ACTION_ACL = [
  {
    id: 'admin.skills.debug-toggle',
    label: '技能页调试开关',
    permission: 'admin.skills.action.debug-toggle',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'low'
  },
  {
    id: 'admin.skills.unlink-employee',
    label: '技能解绑数字员工',
    permission: 'admin.skills.action.unlink-employee',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.skills.delete-skill',
    label: '删除未关联技能',
    permission: 'admin.skills.action.delete',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'critical'
  },
  {
    id: 'admin.tools.create-service',
    label: '创建工具服务',
    permission: 'admin.tools.action.create-service',
    page: '/admin/tools.html',
    scope: 'button',
    risk: 'medium'
  },
  {
    id: 'admin.tools.update-service',
    label: '编辑或启停工具服务',
    permission: 'admin.tools.action.update-service',
    page: '/admin/tools.html',
    scope: 'button',
    risk: 'medium'
  },
  {
    id: 'admin.tools.check-health',
    label: '工具服务探活',
    permission: 'admin.tools.action.check-health',
    page: '/admin/tools.html',
    scope: 'button',
    risk: 'low'
  },
  {
    id: 'admin.tools.delete-service',
    label: '删除工具服务',
    permission: 'admin.tools.action.delete-service',
    page: '/admin/tools.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.tools.approve-service',
    label: '批准工具服务注册',
    permission: 'admin.tools.action.approve-service',
    page: '/admin/tools-approvals.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.tools.reject-service',
    label: '驳回工具服务注册',
    permission: 'admin.tools.action.reject-service',
    page: '/admin/tools-approvals.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.tools.rollback-service',
    label: '回滚工具服务注册',
    permission: 'admin.tools.action.rollback-service',
    page: '/admin/tools-approvals.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.tools.resubmit-service',
    label: '将工具服务转待审',
    permission: 'admin.tools.action.resubmit-service',
    page: '/admin/tools-approvals.html',
    scope: 'button',
    risk: 'medium'
  },
  {
    id: 'admin.oss.approve-introduce',
    label: 'OSS 案例审批-引入开源',
    permission: 'admin.oss.action.approve-case',
    page: '/admin/oss.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.oss.approve-build',
    label: 'OSS 案例审批-内部自建',
    permission: 'admin.oss.action.approve-case',
    page: '/admin/oss.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.oss.reject',
    label: 'OSS 案例审批-驳回',
    permission: 'admin.oss.action.approve-case',
    page: '/admin/oss.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.oss.deploy',
    label: 'OSS 案例执行部署',
    permission: 'admin.oss.action.deploy',
    page: '/admin/oss.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.oss.verify',
    label: 'OSS 案例验收确认',
    permission: 'admin.oss.action.verify',
    page: '/admin/oss.html',
    scope: 'button',
    risk: 'medium'
  },
  {
    id: 'admin.oss.rollback',
    label: 'OSS 案例回滚',
    permission: 'admin.oss.action.rollback',
    page: '/admin/oss.html',
    scope: 'button',
    risk: 'critical'
  },
  {
    id: 'admin.skills.export',
    label: '导出技能资产',
    permission: 'admin.skills.read',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'low'
  },
  {
    id: 'admin.skills.import',
    label: '导入技能资产',
    permission: 'admin.skills.write',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'medium'
  },
  {
    id: 'admin.skills.link-employee',
    label: '关联技能与员工',
    permission: 'admin.skills.write',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'medium'
  },
  {
    id: 'admin.runtime.save-skill-sedimentation-policy',
    label: '保存技能沉淀策略',
    permission: 'admin.runtime.write',
    page: '/admin/skills.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.runtime.save-strategy-center',
    label: '保存策略中心',
    permission: 'admin.runtime.write',
    page: '/admin/strategy-center.html',
    scope: 'button',
    risk: 'high'
  },
  {
    id: 'admin.runtime.publish-prompt-version',
    label: '发布提示词版本',
    permission: 'admin.runtime.write',
    page: '/admin/strategy-center.html',
    scope: 'button',
    risk: 'high'
  }
];

const API_MATRIX_EXTRA_RULES = [
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}', permission: 'admin.tools.action.update-service' },
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}/delete', permission: 'admin.tools.action.delete-service' },
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}/check-health', permission: 'admin.tools.action.check-health' },
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}/approve', permission: 'admin.tools.action.approve-service' },
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}/reject', permission: 'admin.tools.action.reject-service' },
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}/rollback', permission: 'admin.tools.action.rollback-service' },
  { method: 'POST', template: '/api/admin/tools/mcp-services/{serviceId}/resubmit', permission: 'admin.tools.action.resubmit-service' },
  { method: 'POST', template: '/api/admin/skills/{skillId}/unlink', permission: 'admin.skills.action.unlink-employee' },
  { method: 'POST', template: '/api/admin/oss-cases/{caseId}/approve', permission: 'admin.oss.action.approve-case' },
  { method: 'POST', template: '/api/admin/oss-cases/{caseId}/deploy', permission: 'admin.oss.action.deploy' },
  { method: 'POST', template: '/api/admin/oss-cases/{caseId}/verify', permission: 'admin.oss.action.verify' },
  { method: 'POST', template: '/api/admin/oss-cases/{caseId}/rollback', permission: 'admin.oss.action.rollback' }
];

function resolveToolsWritePermission(pathname) {
  if (pathname === '/api/admin/tools/mcp-services') return 'admin.tools.action.create-service';
  if (!pathname.startsWith('/api/admin/tools/mcp-services/')) return null;
  const parts = pathname.split('/').filter(Boolean);
  const action = String(parts[5] || '');
  if (action === 'approve') return 'admin.tools.action.approve-service';
  if (action === 'reject') return 'admin.tools.action.reject-service';
  if (action === 'rollback') return 'admin.tools.action.rollback-service';
  if (action === 'resubmit') return 'admin.tools.action.resubmit-service';
  if (action === 'delete') return 'admin.tools.action.delete-service';
  if (action === 'check-health') return 'admin.tools.action.check-health';
  return 'admin.tools.action.update-service';
}

function resolveSkillsWritePermission(pathname) {
  if (!pathname.startsWith('/api/admin/skills/')) return null;
  if (pathname.endsWith('/unlink')) return 'admin.skills.action.unlink-employee';
  return null;
}

function resolveOssWritePermission(pathname) {
  if (!pathname.startsWith('/api/admin/oss-cases/')) return null;
  const parts = pathname.split('/').filter(Boolean);
  const action = String(parts[4] || '');
  if (action === 'deploy') return 'admin.oss.action.deploy';
  if (action === 'verify') return 'admin.oss.action.verify';
  if (action === 'rollback') return 'admin.oss.action.rollback';
  if (action === 'approve') return 'admin.oss.action.approve-case';
  return 'admin.oss.write';
}

function resolveApiPermission(pathname, method) {
  if (method === 'POST') {
    const toolsWritePermission = resolveToolsWritePermission(pathname);
    if (toolsWritePermission) return toolsWritePermission;
    const skillsWritePermission = resolveSkillsWritePermission(pathname);
    if (skillsWritePermission) return skillsWritePermission;
    const ossWritePermission = resolveOssWritePermission(pathname);
    if (ossWritePermission) return ossWritePermission;
  }
  const item = API_ACL_RULES.find((rule) => {
    if (rule.method !== method) return false;
    if (rule.exact) return pathname === rule.exact;
    if (rule.prefix) return pathname.startsWith(rule.prefix);
    return false;
  });
  return item ? item.permission : null;
}

function resolvePagePermission(pathname) {
  const item = PAGE_ACL.find((x) => x.path === pathname);
  return item ? item.permission : null;
}

module.exports = {
  API_ACL_RULES,
  API_MATRIX_EXTRA_RULES,
  PAGE_ACL,
  NAV_ITEMS,
  ACTION_ACL,
  resolveApiPermission,
  resolvePagePermission
};
