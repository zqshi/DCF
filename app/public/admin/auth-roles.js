let roleOptions = [];
let permissionMatrix = [];
let roleCreateDrawerOpen = false;
let roleEditDrawerOpen = false;
let roleEditingKey = '';

async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

function getNode(id) {
  return document.getElementById(id);
}

function escapeHtml(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setNotice(message) {
  const node = getNode('roleNotice');
  if (!node) return;
  const text = String(message || '').trim();
  node.textContent = text;
  node.classList.toggle('hidden', text.length === 0);
}

function renderCounters(roles) {
  const total = roles.length;
  const system = roles.filter((x) => x.system).length;
  const custom = total - system;
  const set = (id, text) => {
    const node = getNode(id);
    if (node) node.textContent = text;
  };
  set('roleCount', String(total));
  set('systemRoleCount', String(system));
  set('customRoleCount', String(custom));
}

function getPermissionMatrix() {
  const seen = new Map();
  for (const item of Array.isArray(permissionMatrix) ? permissionMatrix : []) {
    const permission = String((item && item.permission) || '').trim();
    if (!permission) continue;
    if (seen.has(permission)) continue;
    seen.set(permission, {
      permission,
      pages: Array.isArray(item.pages) ? item.pages : [],
      apis: Array.isArray(item.apis) ? item.apis : [],
      actions: Array.isArray(item.actions) ? item.actions : []
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.permission.localeCompare(b.permission));
}

function resolvePermissionGroup(item) {
  const pages = Array.isArray(item && item.pages) ? item.pages : [];
  const actions = Array.isArray(item && item.actions) ? item.actions : [];
  if (pages.length > 0) {
    const first = String((pages[0] && pages[0].path) || '').trim();
    if (first.startsWith('/admin/runtime') || first === '/admin/index.html') return '运行管理';
    if (first.startsWith('/admin/tasks')) return '任务管理';
    if (first.startsWith('/admin/employees')) return '员工管理';
    if (first.startsWith('/admin/skills')) return '技能管理';
    if (first.startsWith('/admin/tools')) return '工具管理';
    if (first.startsWith('/admin/logs')) return '日志审计';
    if (first.startsWith('/admin/oss')) return '开源治理';
    if (first.startsWith('/admin/auth')) return '账号权限';
  }
  if (actions.length > 0) {
    const firstActionPage = String((actions[0] && actions[0].page) || '').trim();
    if (firstActionPage.startsWith('/admin/skills')) return '技能管理';
  }
  const permission = String((item && item.permission) || '').trim();
  if (permission.startsWith('admin.runtime.')) return '运行管理';
  if (permission.startsWith('admin.tasks.')) return '任务管理';
  if (permission.startsWith('admin.employees.')) return '员工管理';
  if (permission.startsWith('admin.skills.')) return '技能管理';
  if (permission.startsWith('admin.tools.')) return '工具管理';
  if (permission.startsWith('admin.logs.')) return '日志审计';
  if (permission.startsWith('admin.oss.')) return '开源治理';
  if (permission.startsWith('admin.auth.')) return '账号权限';
  return '其他';
}

function resolvePermissionModuleLabel(permission) {
  const value = String(permission || '').trim();
  if (value.startsWith('admin.runtime.')) return '运行管理';
  if (value.startsWith('admin.tasks.')) return '任务管理';
  if (value.startsWith('admin.employees.')) return '员工管理';
  if (value.startsWith('admin.skills.')) return '技能管理';
  if (value.startsWith('admin.tools.')) return '工具管理';
  if (value.startsWith('admin.logs.')) return '日志审计';
  if (value.startsWith('admin.oss.')) return '开源治理';
  if (value.startsWith('admin.auth.')) return '账号权限';
  return '系统';
}

function resolveActionLabelByPermission(permission) {
  const value = String(permission || '').trim();
  const actionMap = {
    'admin.skills.action.debug-toggle': '切换技能调试模式',
    'admin.skills.action.unlink-employee': '解绑技能与员工关联',
    'admin.skills.action.delete': '删除技能',
    'admin.tools.action.create-service': '创建工具服务',
    'admin.tools.action.update-service': '编辑或启停工具服务',
    'admin.tools.action.check-health': '执行工具服务探活',
    'admin.tools.action.delete-service': '删除工具服务',
    'admin.tools.action.approve-service': '批准工具服务注册',
    'admin.tools.action.reject-service': '驳回工具服务注册',
    'admin.tools.action.rollback-service': '回滚工具服务注册',
    'admin.tools.action.resubmit-service': '转回待审状态',
    'admin.oss.action.approve-case': '审批 OSS 案例',
    'admin.oss.action.deploy': '执行 OSS 部署',
    'admin.oss.action.verify': '确认 OSS 验收',
    'admin.oss.action.rollback': '回滚 OSS 变更'
  };
  if (actionMap[value]) return actionMap[value];
  if (value.includes('.action.')) return '执行高风险操作';
  return '';
}

function resolveApiFeatureByPath(pathname, method) {
  const path = String(pathname || '').trim();
  const verb = String(method || 'GET').toUpperCase();
  const rules = [
    { pattern: '/api/admin/auth/health', label: '查看权限服务健康状态' },
    { pattern: '/api/admin/auth/users', label: verb === 'POST' ? '维护账号用户' : '查看账号用户' },
    { pattern: '/api/admin/auth/roles', label: verb === 'POST' ? '维护角色权限配置' : '查看角色权限配置' },
    { pattern: '/api/admin/employees', label: verb === 'POST' ? '维护员工管理配置' : '查看员工管理数据' },
    { pattern: '/api/admin/tasks', label: verb === 'POST' ? '维护任务流程配置' : '查看任务管理数据' },
    { pattern: '/api/admin/logs', label: verb === 'POST' ? '维护日志审计配置' : '查看日志审计数据' },
    { pattern: '/api/admin/skills', label: verb === 'POST' ? '维护技能资产配置' : '查看技能资产数据' },
    { pattern: '/api/admin/tools', label: verb === 'POST' ? '维护工具服务配置' : '查看工具服务数据' },
    { pattern: '/api/admin/oss', label: verb === 'POST' ? '维护开源治理配置' : '查看开源治理数据' },
    { pattern: '/api/admin/runtime', label: verb === 'POST' ? '维护运行策略配置' : '查看运行态数据' }
  ];
  const matched = rules.find((item) => path.startsWith(item.pattern));
  return matched ? matched.label : '';
}

function resolveApiFeatureLabel(entry, permission) {
  const method = String((entry && entry.method) || 'GET').toUpperCase();
  const apiPath = String((entry && entry.path) || '').trim();
  const moduleLabel = resolvePermissionModuleLabel(permission);
  const actionLabel = resolveActionLabelByPermission(permission);
  if (actionLabel) return actionLabel;
  const pathBasedLabel = resolveApiFeatureByPath(apiPath, method);
  if (pathBasedLabel) return pathBasedLabel;
  if (permission === '*') return '访问全部后台能力';
  if (permission.endsWith('.read') || method === 'GET') return `查看${moduleLabel}数据`;
  if (permission.endsWith('.write')) return `维护${moduleLabel}配置`;
  if (method === 'DELETE') return `删除${moduleLabel}资源`;
  if (method === 'POST') return `执行${moduleLabel}操作`;
  return `访问${moduleLabel}能力`;
}

function resolvePageFunctionLabel(pathname) {
  const path = String(pathname || '').trim();
  const map = {
    '/admin/auth-users.html': '用户管理',
    '/admin/auth-roles.html': '角色管理',
    '/admin/auth-members.html': '成员管理',
    '/admin/runtime.html': '运行总览',
    '/admin/runtime-health.html': '健康看板',
    '/admin/runtime-cycles.html': '周期推进',
    '/admin/runtime-advanced.html': '高级诊断',
    '/admin/tasks.html': '任务总览',
    '/admin/tasks-runtime.html': '任务运行态',
    '/admin/tasks-governance.html': '任务治理态',
    '/admin/employees.html': '员工总览',
    '/admin/employees-contracts.html': '岗位合同',
    '/admin/employees-growth.html': '员工成长',
    '/admin/skills.html': '技能管理',
    '/admin/tools.html': '工具资产',
    '/admin/tools-approvals.html': '准入审批',
    '/admin/logs.html': '行为日志',
    '/admin/logs-agent.html': 'Agent 行为日志',
    '/admin/logs-admin.html': '后台操作日志',
    '/admin/oss.html': '开源检索'
  };
  return map[path] || '';
}

function renderPermissionMatrix(scope, selected = [], disabled = false) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : []);
  const matrix = getPermissionMatrix();
  if (!matrix.length) return '<div class="overview-item">暂无权限目录</div>';
  const grouped = new Map();
  for (const item of matrix) {
    const group = resolvePermissionGroup(item);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item);
  }
  return Array.from(grouped.entries()).map(([groupName, items]) => `
    <section class="permission-group">
      <h4 class="permission-group-title">${escapeHtml(groupName)}</h4>
      <div class="permission-group-items">
        ${items.map((item) => {
    const permission = String(item.permission || '').trim();
    const id = `${scope}-${permission.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const checked = selectedSet.has(permission) ? 'checked' : '';
    const disableAttr = disabled ? 'disabled' : '';
    const pages = Array.isArray(item.pages) ? item.pages : [];
    const apis = Array.isArray(item.apis) ? item.apis : [];
    const actions = Array.isArray(item.actions) ? item.actions : [];
    const pageRefs = pages.length
      ? Array.from(new Set(pages.map((entry) => {
        const pagePath = String((entry && entry.path) || '').trim();
        const fallbackLabel = resolvePageFunctionLabel(pagePath);
        const rawLabel = String((entry && entry.label) || '').trim();
        const label = (rawLabel && rawLabel !== pagePath) ? rawLabel : (fallbackLabel || pagePath);
        return `${escapeHtml(label)}${pagePath ? `（${escapeHtml(pagePath)}）` : ''}`;
      }))).join('、')
      : '不直接对应页面（接口/动作权限）';
    const pageFeatureRefs = pages.length
      ? Array.from(new Set(pages.map((entry) => {
        const pagePath = String((entry && entry.path) || '').trim();
        const fallbackLabel = resolvePageFunctionLabel(pagePath);
        const rawLabel = String((entry && entry.label) || '').trim();
        const label = (rawLabel && rawLabel !== pagePath) ? rawLabel : (fallbackLabel || pagePath);
        return `访问${label}页面`;
      }))).join('、')
      : '';
    const apiRefs = apis.length
      ? Array.from(new Set(apis.map((entry) => {
        const featureLabel = resolveApiFeatureLabel(entry, permission);
        return escapeHtml(featureLabel);
      }))).join('、')
      : (pageFeatureRefs || (permission === '*' ? '覆盖全部后台功能' : '由页面访问或按钮操作隐式覆盖'));
    const actionRefs = actions.length
      ? actions.map((entry) => {
        const label = String((entry && entry.label) || (entry && entry.id) || '').trim();
        const scopeLabel = String((entry && entry.scope) || '').trim();
        return `${escapeHtml(label)}${scopeLabel ? `（${escapeHtml(scopeLabel)}）` : ''}`;
      }).join('、')
      : '不包含按钮级权限';
    const globalHint = permission === '*' ? '<div class="permission-meta">全量权限（谨慎授予）</div>' : '';
    return `
      <div class="permission-item">
        <label class="permission-header">
          <input type="checkbox" id="${escapeHtml(id)}" data-permission-scope="${escapeHtml(scope)}" value="${escapeHtml(permission)}" ${checked} ${disableAttr} />
          <span class="mono">${escapeHtml(permission)}</span>
        </label>
        ${globalHint}
        <div class="permission-meta"><strong>页面：</strong>${pageRefs}</div>
        <div class="permission-meta"><strong>功能：</strong>${apiRefs}</div>
        <div class="permission-meta"><strong>按钮：</strong>${actionRefs}</div>
      </div>
    `;
        }).join('')}
      </div>
    </section>
  `).join('');
}

function collectSelectedPermissions(scope) {
  return Array.from(document.querySelectorAll(`input[data-permission-scope="${CSS.escape(scope)}"]:checked`))
    .map((node) => String(node.value || '').trim())
    .filter(Boolean);
}

function renderRoleRows() {
  const tbody = getNode('authRoleRows');
  if (!tbody) return;
  if (!roleOptions.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">暂无角色</td></tr>';
    return;
  }
  tbody.innerHTML = roleOptions.map((role) => {
    const canDelete = !role.system && Number(role.memberCount || 0) === 0;
    const selected = Array.isArray(role.permissions) ? role.permissions : [];
    const permissionPreview = selected.length
      ? selected.map((x) => `<span class="badge">${escapeHtml(x)}</span>`).join(' ')
      : '<span class="toolbar-note">暂无权限</span>';
    return `
      <tr>
        <td class="mono">${escapeHtml(role.role)}</td>
        <td>${Number(role.memberCount) || 0}</td>
        <td>
          <div class="permission-summary">已选 ${selected.length} 项权限</div>
          <div class="role-permission-preview">${permissionPreview}</div>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-link" data-edit-role="${escapeHtml(role.role)}" data-required-permission="admin.auth.write" ${role.system ? 'disabled' : ''}>编辑角色</button>
            <button type="button" class="btn-link" data-delete-role="${escapeHtml(role.role)}" data-required-permission="admin.auth.write" ${canDelete ? '' : 'disabled'}>删除角色</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleRoleCreateDrawer(open) {
  roleCreateDrawerOpen = Boolean(open);
  const drawer = getNode('roleCreateDrawer');
  const mask = getNode('roleCreateDrawerMask');
  if (drawer) {
    drawer.classList.toggle('hidden', !roleCreateDrawerOpen);
    drawer.setAttribute('aria-hidden', roleCreateDrawerOpen ? 'false' : 'true');
  }
  if (mask) mask.classList.toggle('hidden', !roleCreateDrawerOpen);
}

function toggleRoleEditDrawer(open) {
  roleEditDrawerOpen = Boolean(open);
  const drawer = getNode('roleEditDrawer');
  const mask = getNode('roleEditDrawerMask');
  if (drawer) {
    drawer.classList.toggle('hidden', !roleEditDrawerOpen);
    drawer.setAttribute('aria-hidden', roleEditDrawerOpen ? 'false' : 'true');
  }
  if (mask) mask.classList.toggle('hidden', !roleEditDrawerOpen);
}

function resetCreateRoleForm() {
  const roleName = getNode('newRoleName');
  if (roleName) roleName.value = '';
  document.querySelectorAll('input[data-permission-scope="create-role"]').forEach((node) => {
    if (node instanceof HTMLInputElement) node.checked = false;
  });
}

function closeRoleCreateDrawer(resetForm = false) {
  toggleRoleCreateDrawer(false);
  if (resetForm) resetCreateRoleForm();
}

function closeRoleEditDrawer() {
  toggleRoleEditDrawer(false);
  roleEditingKey = '';
  const roleName = getNode('editRoleName');
  const list = getNode('editRolePermissionList');
  if (roleName) roleName.value = '';
  if (list) list.innerHTML = '';
}

function renderCreateRolePermissionList() {
  const list = getNode('createRolePermissionList');
  if (!list) return;
  list.innerHTML = renderPermissionMatrix('create-role');
}

function openRoleEditPanel(role) {
  if (!role || role.system) return;
  roleEditingKey = String(role.role || '').trim();
  if (!roleEditingKey) return;
  const roleName = getNode('editRoleName');
  const list = getNode('editRolePermissionList');
  if (roleName) roleName.value = roleEditingKey;
  if (list) list.innerHTML = renderPermissionMatrix('edit-role', role.permissions || []);
  closeRoleCreateDrawer(false);
  toggleRoleEditDrawer(true);
}

async function reload() {
  const [rolesData, usersData] = await Promise.all([
    api('/api/admin/auth/roles'),
    api('/api/admin/auth/users')
  ]);
  roleOptions = Array.isArray(rolesData.roles) ? rolesData.roles : [];
  permissionMatrix = Array.isArray(rolesData.permissionMatrix) ? rolesData.permissionMatrix : [];
  renderCounters(roleOptions);
  renderRoleRows();
  renderCreateRolePermissionList();
  if (roleEditingKey) {
    const current = roleOptions.find((item) => item.role === roleEditingKey);
    if (current) openRoleEditPanel(current);
    else closeRoleEditDrawer();
  }
  setNotice(`已加载 ${roleOptions.length} 个角色、${(usersData.users || []).length} 个成员。`);
}

function collectCreateRoleForm() {
  return {
    role: String((getNode('newRoleName') || {}).value || '').trim(),
    permissions: collectSelectedPermissions('create-role')
  };
}

async function createRole() {
  const payload = collectCreateRoleForm();
  await api('/api/admin/auth/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  setNotice(`角色 ${payload.role} 创建成功`);
  await reload();
}

async function saveRole(role) {
  const permissions = collectSelectedPermissions('edit-role');
  await api(`/api/admin/auth/roles/${encodeURIComponent(role)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions })
  });
  setNotice(`角色 ${role} 已更新`);
  await reload();
}

async function deleteRole(role) {
  const confirmed = window.confirm(`确认删除角色 ${role}？`);
  if (!confirmed) return;
  await api(`/api/admin/auth/roles/${encodeURIComponent(role)}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  setNotice(`角色 ${role} 已删除`);
  await reload();
}

function bindActions() {
  const openCreateRoleDrawerBtn = getNode('openCreateRoleDrawerBtn');
  const closeCreateRoleDrawerBtn = getNode('closeCreateRoleDrawerBtn');
  const cancelCreateRoleDrawerBtn = getNode('cancelCreateRoleDrawerBtn');
  const roleCreateDrawerMask = getNode('roleCreateDrawerMask');
  const createRoleBtn = getNode('createRoleBtn');

  const closeRoleEditDrawerBtn = getNode('closeRoleEditDrawerBtn');
  const cancelRoleEditBtn = getNode('cancelRoleEditBtn');
  const roleEditDrawerMask = getNode('roleEditDrawerMask');
  const saveRoleEditBtn = getNode('saveRoleEditBtn');

  if (openCreateRoleDrawerBtn) {
    openCreateRoleDrawerBtn.addEventListener('click', () => toggleRoleCreateDrawer(true));
  }
  if (closeCreateRoleDrawerBtn) {
    closeCreateRoleDrawerBtn.addEventListener('click', () => closeRoleCreateDrawer(false));
  }
  if (cancelCreateRoleDrawerBtn) {
    cancelCreateRoleDrawerBtn.addEventListener('click', () => closeRoleCreateDrawer(true));
  }
  if (roleCreateDrawerMask) {
    roleCreateDrawerMask.addEventListener('click', () => closeRoleCreateDrawer(false));
  }
  if (createRoleBtn) {
    createRoleBtn.addEventListener('click', () => {
      createRole()
        .then(() => closeRoleCreateDrawer(true))
        .catch((error) => setNotice(`创建角色失败: ${error.message}`));
    });
  }

  if (closeRoleEditDrawerBtn) {
    closeRoleEditDrawerBtn.addEventListener('click', () => closeRoleEditDrawer());
  }
  if (cancelRoleEditBtn) {
    cancelRoleEditBtn.addEventListener('click', () => closeRoleEditDrawer());
  }
  if (roleEditDrawerMask) {
    roleEditDrawerMask.addEventListener('click', () => closeRoleEditDrawer());
  }
  if (saveRoleEditBtn) {
    saveRoleEditBtn.addEventListener('click', () => {
      if (!roleEditingKey) return;
      saveRole(roleEditingKey)
        .then(() => closeRoleEditDrawer())
        .catch((error) => setNotice(`保存角色失败: ${error.message}`));
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (roleCreateDrawerOpen) closeRoleCreateDrawer(false);
    if (roleEditDrawerOpen) closeRoleEditDrawer();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const editBtn = target.closest('[data-edit-role]');
    if (editBtn) {
      const roleName = String(editBtn.getAttribute('data-edit-role') || '').trim();
      const detail = roleOptions.find((item) => item.role === roleName);
      if (!detail) return;
      openRoleEditPanel(detail);
      return;
    }

    const deleteBtn = target.closest('[data-delete-role]');
    if (deleteBtn) {
      const role = deleteBtn.getAttribute('data-delete-role');
      deleteRole(role).catch((error) => setNotice(`删除角色失败: ${error.message}`));
    }
  });
}

(async () => {
  try {
    if (window.__adminReady) await window.__adminReady;
    bindActions();
    await reload();
  } catch (error) {
    setNotice(`加载失败: ${error && error.message ? error.message : 'unknown error'}`);
  }
})();
