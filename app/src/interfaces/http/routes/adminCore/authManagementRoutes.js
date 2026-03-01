const PROTECTED_ROLE_PERMISSIONS = new Set(['admin.skills.delete', 'admin.skills.action.delete', '*']);

function hasProtectedPermission(list = []) {
  if (!Array.isArray(list)) return false;
  return list.some((item) => PROTECTED_ROLE_PERMISSIONS.has(String(item || '').trim()));
}

function resolvePermissionModule(permission) {
  const value = String(permission || '').trim().toLowerCase();
  if (value === '*') return 'all';
  if (!value.startsWith('admin.')) return 'other';
  const parts = value.split('.');
  return String(parts[1] || 'other').trim() || 'other';
}

function normalizeExportModule(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value || value === 'all') return 'all';
  return value;
}

function normalizeActionRisk(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value || value === 'all') return 'all';
  if (['low', 'medium', 'high', 'critical'].includes(value)) return value;
  return 'all';
}

function buildRoleUsageCounter(roles = []) {
  const counter = new Map();
  for (const role of Array.isArray(roles) ? roles : []) {
    const roleName = String((role && role.role) || '').trim();
    const permissions = Array.isArray(role && role.permissions) ? role.permissions : [];
    for (const permission of permissions) {
      const key = String(permission || '').trim();
      if (!key) continue;
      if (!counter.has(key)) counter.set(key, { count: 0, roles: [] });
      const entry = counter.get(key);
      entry.count += 1;
      if (roleName) entry.roles.push(roleName);
    }
  }
  return counter;
}

function filterPermissionMatrix(matrix = [], options = {}) {
  const moduleFilter = normalizeExportModule(options.module);
  const actionRiskFilter = normalizeActionRisk(options.actionRisk);
  return (Array.isArray(matrix) ? matrix : []).filter((item) => {
    const permission = String((item && item.permission) || '').trim();
    if (!permission) return false;
    if (moduleFilter !== 'all' && resolvePermissionModule(permission) !== moduleFilter) return false;
    if (actionRiskFilter !== 'all') {
      const actions = Array.isArray(item.actions) ? item.actions : [];
      return actions.some((action) => String((action && action.risk) || '').trim().toLowerCase() === actionRiskFilter);
    }
    return true;
  });
}

async function handleAuthManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    buildPermissionMatrix,
    authUC,
    addAuditEvent
  } = context;

  if (url.pathname === '/api/admin/auth/health' && req.method === 'GET') {
    json(res, 200, authUC.getHealthStatus());
    return true;
  }
  if (url.pathname === '/api/admin/auth/users' && req.method === 'GET') {
    json(res, 200, {
      users: authUC.listUsers(),
      roles: authUC.listRoles()
    });
    return true;
  }
  if (url.pathname === '/api/admin/auth/roles' && req.method === 'GET') {
    const permissionMatrix = buildPermissionMatrix(authUC.listPermissionCatalog());
    const permissions = permissionMatrix.map((item) => item.permission);
    json(res, 200, {
      roles: authUC.listRoles(),
      permissions,
      permissionMatrix
    });
    return true;
  }
  if (url.pathname === '/api/admin/auth/roles/permission-matrix-export' && req.method === 'GET') {
    const session = currentSession(req);
    const roleList = authUC.listRoles();
    const fullPermissionMatrix = buildPermissionMatrix(authUC.listPermissionCatalog());
    const moduleFilter = normalizeExportModule(url.searchParams.get('module'));
    const actionRiskFilter = normalizeActionRisk(url.searchParams.get('actionRisk'));
    const usageCounter = buildRoleUsageCounter(roleList);
    const permissionMatrix = filterPermissionMatrix(fullPermissionMatrix, {
      module: moduleFilter,
      actionRisk: actionRiskFilter
    }).map((item) => {
      const permission = String((item && item.permission) || '').trim();
      const usage = usageCounter.get(permission) || { count: 0, roles: [] };
      return {
        ...item,
        roleUsageCount: Number(usage.count || 0),
        roles: Array.isArray(usage.roles) ? usage.roles.slice().sort((a, b) => a.localeCompare(b)) : []
      };
    });
    const now = new Date().toISOString();
    const payload = {
      schemaVersion: 'admin.permission.matrix.v1',
      generatedAt: now,
      generatedBy: {
        userId: session && session.user ? session.user.id : 'unknown',
        username: session && session.user ? session.user.username : '',
        role: session && session.user ? session.user.role : ''
      },
      summary: {
        permissionCount: permissionMatrix.length,
        pageRefCount: permissionMatrix.reduce((sum, item) => sum + (Array.isArray(item.pages) ? item.pages.length : 0), 0),
        apiRefCount: permissionMatrix.reduce((sum, item) => sum + (Array.isArray(item.apis) ? item.apis.length : 0), 0),
        actionRefCount: permissionMatrix.reduce((sum, item) => sum + (Array.isArray(item.actions) ? item.actions.length : 0), 0),
        moduleFilter,
        actionRiskFilter,
        totalRoleCount: roleList.length
      },
      permissionMatrix
    };
    addAuditEvent('auth.role.permission_matrix.exported', req, session, {
      actorUserId: session && session.user ? session.user.id : 'unknown',
      actorRole: session && session.user ? session.user.role : 'unknown',
      permissionCount: payload.summary.permissionCount,
      pageRefCount: payload.summary.pageRefCount,
      apiRefCount: payload.summary.apiRefCount,
      actionRefCount: payload.summary.actionRefCount,
      audit_action: 'auth.role.permission_matrix.export',
      audit_resource: 'permission-matrix',
      audit_result: 'succeeded'
    });
    json(res, 200, payload);
    return true;
  }
  if (url.pathname === '/api/admin/auth/users' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const inheritedTenantId = session && session.user ? String(session.user.tenantId || '').trim() : '';
    const inheritedAccountId = session && session.user ? String(session.user.accountId || '').trim() : '';
    const created = authUC.createUser({
      ...body,
      tenantId: body && Object.prototype.hasOwnProperty.call(body, 'tenantId')
        ? body.tenantId
        : (inheritedTenantId || null),
      accountId: body && Object.prototype.hasOwnProperty.call(body, 'accountId')
        ? body.accountId
        : (inheritedAccountId || null)
    });
    addAuditEvent('auth.user.created', req, session, {
      actorUserId: session ? session.user.id : 'unknown',
      actorRole: session ? session.user.role : 'unknown',
      userId: created.id,
      username: created.username,
      role: created.role,
      audit_action: 'auth.user.create',
      audit_resource: `user:${created.id}`,
      audit_result: 'succeeded'
    });
    json(res, 201, created);
    return true;
  }
  if (url.pathname === '/api/admin/auth/roles' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    if (session && session.user && session.user.role !== 'super_admin' && hasProtectedPermission(body.permissions)) {
      json(res, 403, { error: '仅超级管理员可授予高风险权限', permission: 'admin.skills.action.delete' });
      return true;
    }
    const created = authUC.createRole(body);
    addAuditEvent('auth.role.created', req, session, {
      actorUserId: session ? session.user.id : 'unknown',
      actorRole: session ? session.user.role : 'unknown',
      role: created.role,
      permissionCount: created.permissions.length,
      audit_action: 'auth.role.create',
      audit_resource: `role:${created.role}`,
      audit_result: 'succeeded'
    });
    json(res, 201, created);
    return true;
  }
  if (url.pathname.startsWith('/api/admin/auth/roles/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const role = decodeURIComponent(parts[4] || '');
    const action = parts[5] || '';
    const session = currentSession(req);
    const body = await parseBody(req);
    if (action === 'delete') {
      const deleted = authUC.deleteRole(role);
      addAuditEvent('auth.role.deleted', req, session, {
        actorUserId: session ? session.user.id : 'unknown',
        actorRole: session ? session.user.role : 'unknown',
        role,
        audit_action: 'auth.role.delete',
        audit_resource: `role:${role}`,
        audit_result: 'succeeded'
      });
      json(res, 200, deleted);
      return true;
    }
    if (session && session.user && session.user.role !== 'super_admin' && hasProtectedPermission(body.permissions)) {
      json(res, 403, { error: '仅超级管理员可授予高风险权限', permission: 'admin.skills.action.delete' });
      return true;
    }
    const updated = authUC.updateRole(role, body);
    addAuditEvent('auth.role.updated', req, session, {
      actorUserId: session ? session.user.id : 'unknown',
      actorRole: session ? session.user.role : 'unknown',
      role: updated.role,
      previousRole: updated.previousRole || updated.role,
      permissionCount: updated.permissions.length,
      audit_action: 'auth.role.update',
      audit_resource: `role:${updated.role}`,
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname.startsWith('/api/admin/auth/users/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const userId = parts[4];
    const action = parts[5] || '';
    const session = currentSession(req);
    const body = await parseBody(req);
    if (action === 'delete') {
      if (session && session.user && session.user.id === userId) {
        json(res, 400, { error: 'cannot delete current session user' });
        return true;
      }
      const deleted = authUC.deleteUser(userId);
      addAuditEvent('auth.user.deleted', req, session, {
        actorUserId: session ? session.user.id : 'unknown',
        actorRole: session ? session.user.role : 'unknown',
        userId: deleted.user.id,
        username: deleted.user.username,
        role: deleted.user.role,
        audit_action: 'auth.user.delete',
        audit_resource: `user:${deleted.user.id}`,
        audit_result: 'succeeded'
      });
      json(res, 200, deleted);
      return true;
    }
    if (action === 'reset-password') {
      const updated = authUC.resetPassword(userId, body.password);
      addAuditEvent('auth.user.password.reset', req, session, {
        actorUserId: session ? session.user.id : 'unknown',
        actorRole: session ? session.user.role : 'unknown',
        userId: updated.id,
        username: updated.username,
        audit_action: 'auth.user.reset_password',
        audit_resource: `user:${updated.id}`,
        audit_result: 'succeeded'
      });
      json(res, 200, updated);
      return true;
    }
    const target = authUC.listUsers().find((x) => x.id === userId);
    if (!target) {
      json(res, 404, { error: 'user not found' });
      return true;
    }
    if (session && target.id === session.user.id && Object.prototype.hasOwnProperty.call(body, 'status') && body.status === 'disabled') {
      json(res, 400, { error: 'cannot disable current session user' });
      return true;
    }
    const updated = authUC.updateUser(userId, body);
    addAuditEvent('auth.user.updated', req, session, {
      actorUserId: session ? session.user.id : 'unknown',
      actorRole: session ? session.user.role : 'unknown',
      userId: updated.id,
      username: updated.username,
      role: updated.role,
      status: updated.status,
      audit_action: 'auth.user.update',
      audit_resource: `user:${updated.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }

  return false;
}

module.exports = {
  handleAuthManagementRoutes
};
