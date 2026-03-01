let roleOptions = [];
let permissionCatalog = [];
let permissionMatrix = [];
let usersCache = [];
let canWrite = false;
let currentUserId = '';
let activeTab = 'users';
let createUserDrawerOpen = false;
let userEditDrawerOpen = false;
let roleCreateDrawerOpen = false;
let roleEditDrawerOpen = false;
let roleEditingKey = '';
let userEditingId = '';
let userDeletePending = '';
let roleDeletePending = '';
let toastTimer = null;
const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 20;

async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = '';
    try {
      const payload = await res.json();
      detail = String((payload && (payload.error || payload.message)) || '').trim();
    } catch {}
    throw new Error(detail || `request failed (${res.status})`);
  }
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
  const node = getNode('authNotice');
  if (!node) return;
  const text = String(message || '').trim();
  node.textContent = text;
  node.classList.toggle('hidden', text.length === 0);
}

function showToast(message) {
  const node = getNode('authToast');
  const text = String(message || '').trim();
  if (!node || !text) return;
  node.textContent = text;
  node.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.add('hidden');
    toastTimer = null;
  }, 2200);
}

function setCounter(id, text) {
  const node = getNode(id);
  if (node) node.textContent = String(text);
}

function renderCounters(users, roles) {
  const totalUsers = users.length;
  const activeUsers = users.filter((x) => x.status !== 'disabled').length;
  setCounter('userCount', totalUsers);
  setCounter('activeCount', activeUsers);
  setCounter('roleCount', roles.length);
}

function toggleCreateUserDrawer(open) {
  createUserDrawerOpen = Boolean(open);
  const drawer = getNode('createUserDrawer');
  const mask = getNode('createUserDrawerMask');
  if (drawer) {
    drawer.classList.toggle('hidden', !createUserDrawerOpen);
    drawer.setAttribute('aria-hidden', createUserDrawerOpen ? 'false' : 'true');
  }
  if (mask) mask.classList.toggle('hidden', !createUserDrawerOpen);
}

function resetCreateUserForm() {
  const username = getNode('newUsername');
  const displayName = getNode('newDisplayName');
  const role = getNode('newRole');
  if (username) username.value = '';
  if (displayName) displayName.value = '';
  if (role && role.options.length) role.selectedIndex = 0;
}

function closeCreateUserDrawer(resetForm = false) {
  toggleCreateUserDrawer(false);
  if (resetForm) resetCreateUserForm();
}

function toggleUserEditDrawer(open) {
  userEditDrawerOpen = Boolean(open);
  const drawer = getNode('userEditDrawer');
  const mask = getNode('userEditDrawerMask');
  if (drawer) {
    drawer.classList.toggle('hidden', !userEditDrawerOpen);
    drawer.setAttribute('aria-hidden', userEditDrawerOpen ? 'false' : 'true');
  }
  if (mask) mask.classList.toggle('hidden', !userEditDrawerOpen);
}

function closeUserEditDrawer(resetForm = false) {
  toggleUserEditDrawer(false);
  userEditingId = '';
  if (!resetForm) return;
  const title = getNode('userEditPanelTitle');
  const username = getNode('editUsername');
  const displayName = getNode('editDisplayName');
  const role = getNode('editUserRole');
  if (title) title.textContent = '编辑';
  if (username) username.value = '';
  if (displayName) displayName.value = '';
  if (role) role.innerHTML = '';
}

function openUserEditPanel(user) {
  if (!user) return;
  const title = getNode('userEditPanelTitle');
  const username = getNode('editUsername');
  const displayName = getNode('editDisplayName');
  const role = getNode('editUserRole');
  if (!username || !displayName || !role) return;
  userEditingId = String(user.id || '').trim();
  if (!userEditingId) return;
  if (title) title.textContent = `编辑：${user.username || user.id || '-'}`;
  username.value = String(user.username || '');
  displayName.value = String(user.displayName || '');
  role.innerHTML = roleOptions
    .map((item) => {
      const selected = item.role === user.role ? 'selected' : '';
      return `<option value="${escapeHtml(item.role)}" ${selected}>${escapeHtml(item.role)}</option>`;
    })
    .join('');
  closeCreateUserDrawer(false);
  closeRoleCreateDrawer(false);
  closeRoleEditDrawer(false);
  closeDeleteRoleConfirm();
  closeDeleteUserConfirm();
  toggleUserEditDrawer(true);
}

function openDeleteUserConfirm(user) {
  const userId = user && user.id ? String(user.id) : '';
  if (!userId) return;
  userDeletePending = userId;
  const modal = getNode('userDeleteConfirmModal');
  const text = getNode('userDeleteConfirmText');
  const label = user && user.username ? `${user.username}（${userId}）` : userId;
  if (text) text.textContent = `确认删除账号 ${label}？删除后不可恢复。`;
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteUserConfirm() {
  userDeletePending = '';
  const modal = getNode('userDeleteConfirmModal');
  if (modal) modal.classList.add('hidden');
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

function resetCreateRoleForm() {
  const roleInput = getNode('newRoleName');
  if (roleInput) roleInput.value = '';
  document.querySelectorAll('input[data-permission-scope="create-role"]').forEach((node) => {
    if (node instanceof HTMLInputElement) node.checked = false;
  });
}

function closeRoleCreateDrawer(resetForm = false) {
  toggleRoleCreateDrawer(false);
  if (resetForm) resetCreateRoleForm();
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

function closeRoleEditDrawer(resetForm = false) {
  toggleRoleEditDrawer(false);
  roleEditingKey = '';
  if (!resetForm) return;
  const roleName = getNode('editRoleName');
  const permissionNode = getNode('editRolePermissionList');
  if (roleName) roleName.value = '';
  if (permissionNode) permissionNode.innerHTML = '';
}

function openRoleEditPanel(role) {
  const title = getNode('roleEditPanelTitle');
  const roleName = getNode('editRoleName');
  const permissionNode = getNode('editRolePermissionList');
  if (!roleName || !permissionNode || !role) return;
  const editable = canWrite && !role.system;
  closeUserEditDrawer(false);
  closeDeleteUserConfirm();
  closeRoleCreateDrawer(false);
  roleEditingKey = String(role.role || '');
  if (title) title.textContent = `编辑角色：${roleEditingKey}`;
  roleName.value = roleEditingKey;
  roleName.disabled = !editable;
  permissionNode.innerHTML = renderPermissionMatrix('role-edit', role.permissions || [], !editable);
  toggleRoleEditDrawer(true);
}

function openDeleteRoleConfirm(role) {
  roleDeletePending = String(role || '').trim();
  if (!roleDeletePending) return;
  const modal = getNode('roleDeleteConfirmModal');
  const text = getNode('roleDeleteConfirmText');
  if (text) text.textContent = `确认删除角色 ${roleDeletePending}？删除后不可恢复。`;
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteRoleConfirm() {
  roleDeletePending = '';
  const modal = getNode('roleDeleteConfirmModal');
  if (modal) modal.classList.add('hidden');
}

function applyTab(tab) {
  const rolesPanel = getNode('rolesPanel');
  const hasRolesPanel = Boolean(rolesPanel);
  activeTab = hasRolesPanel && tab === 'roles' ? 'roles' : 'users';
  const usersBtn = getNode('authTabUsers');
  const rolesBtn = getNode('authTabRoles');
  const usersPanel = getNode('usersPanel');
  if (usersBtn) usersBtn.classList.toggle('primary', activeTab === 'users');
  if (rolesBtn) rolesBtn.classList.toggle('primary', activeTab === 'roles');
  if (usersPanel) usersPanel.classList.toggle('hidden', activeTab !== 'users');
  if (rolesPanel) rolesPanel.classList.toggle('hidden', activeTab !== 'roles');
  if (activeTab !== 'users') {
    closeCreateUserDrawer(false);
    closeUserEditDrawer(false);
    closeDeleteUserConfirm();
  }
  if (activeTab !== 'roles') {
    closeRoleCreateDrawer(false);
    closeRoleEditDrawer(true);
    closeDeleteRoleConfirm();
  }
}

function renderRoleOptions() {
  const newRole = getNode('newRole');
  if (!newRole) return;
  newRole.innerHTML = roleOptions
    .map((item) => `<option value="${escapeHtml(item.role)}">${escapeHtml(item.role)}</option>`)
    .join('');
}

function getPermissionMatrix() {
  const validMatrix = Array.isArray(permissionMatrix) && permissionMatrix.length
    ? permissionMatrix
    : permissionCatalog.map((permission) => ({ permission, pages: [], apis: [] }));
  const unique = new Map();
  for (const item of validMatrix) {
    const permission = String((item && item.permission) || '').trim();
    if (!permission) continue;
    if (!unique.has(permission)) {
      unique.set(permission, {
        permission,
        pages: Array.isArray(item.pages) ? item.pages : [],
        apis: Array.isArray(item.apis) ? item.apis : [],
        actions: Array.isArray(item.actions) ? item.actions : []
      });
    }
  }
  return Array.from(unique.values()).sort((a, b) => a.permission.localeCompare(b.permission));
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
      ? pages.map((entry) => {
        const label = String((entry && entry.label) || (entry && entry.path) || '').trim();
        const path = String((entry && entry.path) || '').trim();
        return `${escapeHtml(label)}${path ? `（${escapeHtml(path)}）` : ''}`;
      }).join('、')
      : '无';
    const apiRefs = apis.length
      ? apis.map((entry) => {
        const method = String((entry && entry.method) || 'GET').toUpperCase();
        const endpoint = String((entry && entry.path) || '').trim();
        return `${escapeHtml(method)} ${escapeHtml(endpoint)}`;
      }).join('、')
      : '无';
    const globalHint = permission === '*' ? '<div class="permission-meta">全量权限（谨慎授予）</div>' : '';
    const actionRefs = actions.length
      ? actions.map((entry) => {
        const label = String((entry && entry.label) || (entry && entry.id) || '').trim();
        const scope = String((entry && entry.scope) || '').trim();
        return `${escapeHtml(label)}${scope ? `（${escapeHtml(scope)}）` : ''}`;
      }).join('、')
      : '无';
    return `
      <div class="permission-item">
        <label class="permission-header">
          <input type="checkbox" id="${escapeHtml(id)}" data-permission-scope="${escapeHtml(scope)}" value="${escapeHtml(permission)}" ${checked} ${disableAttr} />
          <span class="mono">${escapeHtml(permission)}</span>
        </label>
        ${globalHint}
        <div class="permission-meta"><strong>页面：</strong>${pageRefs}</div>
        <div class="permission-meta"><strong>接口：</strong>${apiRefs}</div>
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

function applyActionAcl(root = document) {
  if (typeof window.adminApplyActionAclForRoot === 'function') {
    window.adminApplyActionAclForRoot(root);
  }
}

function renderCreateRolePermissionList() {
  const node = getNode('createRolePermissionList');
  if (!node) return;
  node.innerHTML = renderPermissionMatrix('create-role', [], !canWrite);
}

function getDisplayNameCharLength(displayName) {
  return Array.from(String(displayName || '').trim()).length;
}

function generateAutoUsername() {
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function renderUserRows() {
  const tbody = getNode('authUserRows');
  if (!tbody) return;
  if (!usersCache.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
    return;
  }
  tbody.innerHTML = usersCache.map((user) => {
    const sourceLabel = user.permissionsSource === 'custom' ? '自定义授权' : '角色继承';
    const statusLabel = user.status === 'disabled' ? '已禁用' : '允许登录';
    const isSuperAdmin = String(user.role || '') === 'super_admin';
    const editable = canWrite && !isSuperAdmin;
    const deletable = canWrite && !isSuperAdmin && user.id !== currentUserId;
    const actions = isSuperAdmin
      ? '<span class="toolbar-note">超级管理员不可编辑</span>'
      : `
            <button type="button" class="btn-link" data-edit-user="${escapeHtml(user.id)}" data-required-permission="admin.auth.write" ${editable ? '' : 'disabled'}>编辑</button>
            <button type="button" class="btn-link" data-delete-user="${escapeHtml(user.id)}" data-required-permission="admin.auth.write" ${deletable ? '' : 'disabled'}>删除授权</button>
        `;
    return `
      <tr>
        <td class="mono">${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.displayName || '-')}</td>
        <td><span class="badge">${escapeHtml(user.role)}</span></td>
        <td>${escapeHtml(statusLabel)}</td>
        <td>${Array.isArray(user.permissions) ? user.permissions.length : 0}（${sourceLabel}）</td>
        <td>
          <div class="row-actions">
            ${actions}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  applyActionAcl(tbody);
}

function renderRoleRows() {
  const tbody = getNode('authRoleRows');
  if (!tbody) return;
  if (!roleOptions.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">暂无角色</td></tr>';
    return;
  }
  tbody.innerHTML = roleOptions.map((role) => {
    const editable = canWrite && !role.system;
    const memberCount = Number(role.memberCount || 0);
    const canDelete = editable && memberCount === 0;
    const selected = Array.isArray(role.permissions) ? role.permissions : [];
    const roleNameUi = `${escapeHtml(role.role)}`;
    const permissionPreview = selected.length ? selected.map((x) => `<span class="badge">${escapeHtml(x)}</span>`).join(' ') : '<span class="toolbar-note">暂无权限</span>';
    return `
      <tr>
        <td>${roleNameUi}</td>
        <td>${memberCount}</td>
        <td>
          <div class="permission-summary">已选 ${selected.length} 项权限</div>
          <div class="role-permission-preview">${permissionPreview}</div>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-link" data-edit-role="${escapeHtml(role.role)}" data-required-permission="admin.auth.write" ${editable ? '' : 'disabled'}>编辑</button>
            <button
              type="button"
              class="btn-link"
              data-delete-role="${escapeHtml(role.role)}"
              data-required-permission="admin.auth.write"
              data-delete-role-member-count="${memberCount}"
              data-delete-role-system="${role.system ? 'true' : 'false'}"
              ${canWrite ? '' : 'disabled'}
            >删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  applyActionAcl(tbody);
}

function setWriteControls(enabled) {
  const openCreateUserDrawerBtn = getNode('openCreateUserDrawerBtn');
  const createUserBtn = getNode('createUserBtn');
  const openCreateRoleDrawerBtn = getNode('openCreateRoleDrawerBtn');
  const createRoleBtn = getNode('createRoleBtn');
  if (openCreateUserDrawerBtn) openCreateUserDrawerBtn.disabled = !enabled;
  if (createUserBtn) createUserBtn.disabled = !enabled;
  if (openCreateRoleDrawerBtn) openCreateRoleDrawerBtn.disabled = !enabled;
  if (createRoleBtn) createRoleBtn.disabled = !enabled;
  ['newDisplayName', 'newRole', 'cancelCreateUserDrawerBtn', 'closeCreateUserDrawerBtn', 'editUserRole', 'cancelUserEditBtn', 'closeUserEditDrawerBtn', 'saveUserEditBtn', 'closeUserDeleteConfirmBtn', 'cancelUserDeleteConfirmBtn', 'confirmUserDeleteBtn', 'newRoleName', 'cancelCreateRoleDrawerBtn', 'closeCreateRoleDrawerBtn', 'editRoleName', 'cancelRoleEditBtn', 'closeRoleEditDrawerBtn', 'saveRoleEditBtn', 'closeRoleDeleteConfirmBtn', 'cancelRoleDeleteConfirmBtn', 'confirmRoleDeleteBtn'].forEach((id) => {
    const node = getNode(id);
    if (node) node.disabled = !enabled;
  });
  if (!enabled) {
    closeCreateUserDrawer(false);
    closeUserEditDrawer(false);
    closeDeleteUserConfirm();
    closeRoleCreateDrawer(false);
    closeRoleEditDrawer(true);
    closeDeleteRoleConfirm();
  }
}

async function reload() {
  const [usersData, rolesData, health] = await Promise.all([
    api('/api/admin/auth/users'),
    api('/api/admin/auth/roles'),
    api('/api/admin/auth/health')
  ]);
  usersCache = Array.isArray(usersData.users) ? usersData.users : [];
  roleOptions = Array.isArray(rolesData.roles) ? rolesData.roles : [];
  permissionCatalog = Array.isArray(rolesData.permissions) ? rolesData.permissions : [];
  permissionMatrix = Array.isArray(rolesData.permissionMatrix) ? rolesData.permissionMatrix : [];
  renderCounters(usersCache, roleOptions);
  renderRoleOptions();
  renderCreateRolePermissionList();
  renderUserRows();
  renderRoleRows();
  if (roleEditingKey) {
    const current = roleOptions.find((x) => x.role === roleEditingKey);
    if (current) openRoleEditPanel(current);
    else closeRoleEditDrawer(true);
  }
  const healthOk = health && health.healthy;
  if (!healthOk) setNotice(`鉴权健康异常（source=${health ? health.userSource : 'unknown'}）`);
  else setNotice('');
}

function collectCreateUserForm() {
  const displayName = String((getNode('newDisplayName') || {}).value || '').trim();
  return {
    username: generateAutoUsername(),
    displayName,
    role: String((getNode('newRole') || {}).value || '').trim(),
    ssoManaged: true,
    authProvider: 'sso'
  };
}

function validateCreateUserForm(payload) {
  const displayName = String((payload && payload.displayName) || '').trim();
  const role = String((payload && payload.role) || '').trim();
  if (!displayName) return '姓名不能为空';
  const displayNameLength = getDisplayNameCharLength(displayName);
  if (displayNameLength < DISPLAY_NAME_MIN_LENGTH || displayNameLength > DISPLAY_NAME_MAX_LENGTH) {
    return `姓名需为 ${DISPLAY_NAME_MIN_LENGTH}-${DISPLAY_NAME_MAX_LENGTH} 个字符`;
  }
  if (!role) return '角色不能为空';
  return '';
}

function collectCreateRoleForm() {
  return {
    role: String((getNode('newRoleName') || {}).value || '').trim(),
    permissions: collectSelectedPermissions('create-role')
  };
}

async function createUser() {
  const payload = collectCreateUserForm();
  const usernameNode = getNode('newUsername');
  if (usernameNode) usernameNode.value = payload.username;
  const validationError = validateCreateUserForm(payload);
  if (validationError) {
    showToast(validationError);
    throw new Error(validationError);
  }
  await api('/api/admin/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  setNotice(`用户 ${payload.username} 已授权登录`);
  await reload();
}

function collectUserEditForm() {
  return {
    role: String((getNode('editUserRole') || {}).value || '').trim()
  };
}

async function saveUser(userId) {
  const payload = collectUserEditForm();
  await api(`/api/admin/auth/users/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  setNotice(`用户 ${userId} 授权信息已更新`);
  await reload();
}

async function deleteUser(userId) {
  await api(`/api/admin/auth/users/${encodeURIComponent(userId)}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  setNotice(`用户 ${userId} 已删除授权`);
  closeDeleteUserConfirm();
  if (userEditingId === userId) closeUserEditDrawer(true);
  await reload();
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
  const roleNameInput = getNode('editRoleName');
  const roleName = String(roleNameInput ? roleNameInput.value : role).trim();
  const permissions = collectSelectedPermissions('role-edit');
  const payload = { permissions };
  if (roleName && roleName !== role) payload.roleName = roleName;
  await api(`/api/admin/auth/roles/${encodeURIComponent(role)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  setNotice(`角色 ${role}${roleName !== role ? ` 已更名为 ${roleName}` : ''} 并更新成功`);
  await reload();
}

async function deleteRole(role) {
  await api(`/api/admin/auth/roles/${encodeURIComponent(role)}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  setNotice(`角色 ${role} 已删除`);
  closeDeleteRoleConfirm();
  if (roleEditingKey === role) closeRoleEditDrawer(true);
  await reload();
}

function bindTabs() {
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-auth-tab');
      applyTab(tab);
    });
  });
}

function bindActions() {
  const openCreateUserDrawerBtn = getNode('openCreateUserDrawerBtn');
  const closeCreateUserDrawerBtn = getNode('closeCreateUserDrawerBtn');
  const cancelCreateUserDrawerBtn = getNode('cancelCreateUserDrawerBtn');
  const createUserDrawerMask = getNode('createUserDrawerMask');
  const userEditDrawerMask = getNode('userEditDrawerMask');
  const closeUserEditDrawerBtn = getNode('closeUserEditDrawerBtn');
  const cancelUserEditBtn = getNode('cancelUserEditBtn');
  const saveUserEditBtn = getNode('saveUserEditBtn');
  const userDeleteConfirmModal = getNode('userDeleteConfirmModal');
  const closeUserDeleteConfirmBtn = getNode('closeUserDeleteConfirmBtn');
  const cancelUserDeleteConfirmBtn = getNode('cancelUserDeleteConfirmBtn');
  const confirmUserDeleteBtn = getNode('confirmUserDeleteBtn');
  const createUserBtn = getNode('createUserBtn');
  const openCreateRoleDrawerBtn = getNode('openCreateRoleDrawerBtn');
  const closeCreateRoleDrawerBtn = getNode('closeCreateRoleDrawerBtn');
  const cancelCreateRoleDrawerBtn = getNode('cancelCreateRoleDrawerBtn');
  const roleCreateDrawerMask = getNode('roleCreateDrawerMask');
  const roleEditDrawerMask = getNode('roleEditDrawerMask');
  const closeRoleEditDrawerBtn = getNode('closeRoleEditDrawerBtn');
  const cancelRoleEditBtn = getNode('cancelRoleEditBtn');
  const saveRoleEditBtn = getNode('saveRoleEditBtn');
  const closeRoleDeleteConfirmBtn = getNode('closeRoleDeleteConfirmBtn');
  const cancelRoleDeleteConfirmBtn = getNode('cancelRoleDeleteConfirmBtn');
  const confirmRoleDeleteBtn = getNode('confirmRoleDeleteBtn');
  const roleDeleteConfirmModal = getNode('roleDeleteConfirmModal');
  const createRoleBtn = getNode('createRoleBtn');
  if (openCreateUserDrawerBtn) {
    openCreateUserDrawerBtn.addEventListener('click', () => {
      if (!canWrite) return;
      closeRoleCreateDrawer(false);
      closeRoleEditDrawer(false);
      closeDeleteRoleConfirm();
      toggleCreateUserDrawer(true);
    });
  }
  if (closeCreateUserDrawerBtn) {
    closeCreateUserDrawerBtn.addEventListener('click', () => closeCreateUserDrawer(false));
  }
  if (cancelCreateUserDrawerBtn) {
    cancelCreateUserDrawerBtn.addEventListener('click', () => closeCreateUserDrawer(true));
  }
  if (createUserDrawerMask) {
    createUserDrawerMask.addEventListener('click', () => closeCreateUserDrawer(false));
  }
  if (closeUserEditDrawerBtn) {
    closeUserEditDrawerBtn.addEventListener('click', () => closeUserEditDrawer(false));
  }
  if (cancelUserEditBtn) {
    cancelUserEditBtn.addEventListener('click', () => closeUserEditDrawer(true));
  }
  if (saveUserEditBtn) {
    saveUserEditBtn.addEventListener('click', () => {
      if (!canWrite || !userEditingId) return;
      saveUser(userEditingId)
        .then(() => closeUserEditDrawer(true))
        .catch((error) => setNotice(`保存用户授权失败: ${error.message}`));
    });
  }
  if (userEditDrawerMask) {
    userEditDrawerMask.addEventListener('click', () => closeUserEditDrawer(false));
  }
  if (closeUserDeleteConfirmBtn) {
    closeUserDeleteConfirmBtn.addEventListener('click', () => closeDeleteUserConfirm());
  }
  if (cancelUserDeleteConfirmBtn) {
    cancelUserDeleteConfirmBtn.addEventListener('click', () => closeDeleteUserConfirm());
  }
  if (confirmUserDeleteBtn) {
    confirmUserDeleteBtn.addEventListener('click', () => {
      if (!canWrite || !userDeletePending) return;
      deleteUser(userDeletePending).catch((error) => setNotice(`删除用户失败: ${error.message}`));
    });
  }
  if (userDeleteConfirmModal) {
    userDeleteConfirmModal.addEventListener('click', (event) => {
      if (event.target === userDeleteConfirmModal) closeDeleteUserConfirm();
    });
  }
  if (createUserBtn) {
    createUserBtn.addEventListener('click', () => {
      if (!canWrite) return;
      createUser()
        .then(() => closeCreateUserDrawer(true))
        .catch((error) => setNotice(`添加用户失败: ${error.message}`));
    });
  }
  if (openCreateRoleDrawerBtn) {
    openCreateRoleDrawerBtn.addEventListener('click', () => {
      if (!canWrite) return;
      closeUserEditDrawer(false);
      closeDeleteUserConfirm();
      closeRoleEditDrawer(false);
      toggleRoleCreateDrawer(true);
    });
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
      if (!canWrite) return;
      createRole()
        .then(() => closeRoleCreateDrawer(true))
        .catch((error) => setNotice(`创建角色失败: ${error.message}`));
    });
  }
  if (cancelRoleEditBtn) {
    cancelRoleEditBtn.addEventListener('click', () => closeRoleEditDrawer(true));
  }
  if (saveRoleEditBtn) {
    saveRoleEditBtn.addEventListener('click', () => {
      if (!canWrite || !roleEditingKey) return;
      saveRole(roleEditingKey)
        .then(() => closeRoleEditDrawer(true))
        .catch((error) => setNotice(`保存角色失败: ${error.message}`));
    });
  }
  if (closeRoleEditDrawerBtn) {
    closeRoleEditDrawerBtn.addEventListener('click', () => closeRoleEditDrawer(false));
  }
  if (roleEditDrawerMask) {
    roleEditDrawerMask.addEventListener('click', () => closeRoleEditDrawer(false));
  }
  if (closeRoleDeleteConfirmBtn) {
    closeRoleDeleteConfirmBtn.addEventListener('click', () => closeDeleteRoleConfirm());
  }
  if (cancelRoleDeleteConfirmBtn) {
    cancelRoleDeleteConfirmBtn.addEventListener('click', () => closeDeleteRoleConfirm());
  }
  if (confirmRoleDeleteBtn) {
    confirmRoleDeleteBtn.addEventListener('click', () => {
      if (!canWrite || !roleDeletePending) return;
      deleteRole(roleDeletePending).catch((error) => setNotice(`删除角色失败: ${error.message}`));
    });
  }
  if (roleDeleteConfirmModal) {
    roleDeleteConfirmModal.addEventListener('click', (event) => {
      if (event.target === roleDeleteConfirmModal) closeDeleteRoleConfirm();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (createUserDrawerOpen) closeCreateUserDrawer(false);
    if (userEditDrawerOpen) closeUserEditDrawer(false);
    if (userDeletePending) closeDeleteUserConfirm();
    if (roleCreateDrawerOpen) closeRoleCreateDrawer(false);
    if (roleEditDrawerOpen) closeRoleEditDrawer(false);
    if (roleDeletePending) closeDeleteRoleConfirm();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const editUserBtn = target.closest('[data-edit-user]');
    if (editUserBtn) {
      if (!canWrite) return;
      const userId = String(editUserBtn.getAttribute('data-edit-user') || '').trim();
      const detail = usersCache.find((x) => x.id === userId);
      if (!detail) return;
      openUserEditPanel(detail);
      return;
    }

    const deleteUserBtn = target.closest('[data-delete-user]');
    if (deleteUserBtn) {
      if (!canWrite) return;
      const userId = String(deleteUserBtn.getAttribute('data-delete-user') || '').trim();
      const detail = usersCache.find((x) => x.id === userId);
      if (!detail) return;
      openDeleteUserConfirm(detail);
      return;
    }

    const editRoleBtn = target.closest('[data-edit-role]');
    if (editRoleBtn) {
      if (!canWrite) return;
      const role = editRoleBtn.getAttribute('data-edit-role');
      const detail = roleOptions.find((x) => x.role === role);
      if (!detail) return;
      openRoleEditPanel(detail);
      return;
    }

    const deleteRoleBtn = target.closest('[data-delete-role]');
    if (deleteRoleBtn) {
      if (!canWrite) return;
      const role = deleteRoleBtn.getAttribute('data-delete-role');
      const memberCount = Number(deleteRoleBtn.getAttribute('data-delete-role-member-count') || '0');
      const isSystem = deleteRoleBtn.getAttribute('data-delete-role-system') === 'true';
      if (isSystem) {
        showToast('系统角色不可删除');
        return;
      }
      if (memberCount > 0) {
        showToast(`角色 ${role} 已有关联用户，无法删除`);
        return;
      }
      openDeleteRoleConfirm(role);
    }
  });
}

function resolveDefaultTab() {
  const params = new URLSearchParams(window.location.search || '');
  const tab = String(params.get('tab') || '').trim().toLowerCase();
  if (tab === 'roles') return 'roles';
  return 'users';
}

(async () => {
  try {
    let session = null;
    if (window.__adminReady) session = await window.__adminReady;
    currentUserId = session && session.user && session.user.id ? String(session.user.id) : '';
    const permissions = session && session.user && Array.isArray(session.user.permissions)
      ? session.user.permissions
      : [];
    canWrite = permissions.includes('*') || permissions.includes('admin.auth.write');
    setWriteControls(canWrite);
    bindTabs();
    bindActions();
    applyTab(resolveDefaultTab());
    await reload();
  } catch (error) {
    setNotice(`加载失败: ${error && error.message ? error.message : 'unknown error'}`);
  }
})();
