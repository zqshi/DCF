const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function loginAndCookie(base, username, password) {
  const login = await requestJson(base, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('admin role management routes enforce RBAC and support role lifecycle', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const opsForbidden = await requestJson(base, '/api/admin/auth/roles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({ role: 'ops_observer', permissions: ['admin.tasks.read'] })
    });
    assert.equal(opsForbidden.status, 403);

    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const created = await requestJson(base, '/api/admin/auth/roles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ role: 'ops_observer', permissions: ['admin.tasks.read', 'admin.logs.read'] })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'ops_observer');

    const roleList = await requestJson(base, '/api/admin/auth/roles', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(roleList.status, 200);
    assert.ok(Array.isArray(roleList.body.roles));
    assert.ok(roleList.body.roles.some((x) => x.role === 'ops_observer'));
    assert.ok(Array.isArray(roleList.body.permissionMatrix));
    assert.ok(roleList.body.permissionMatrix.some((x) => x.permission === 'admin.auth.page.roles.read'));
    const authRolesPagePermission = roleList.body.permissionMatrix.find((x) => x.permission === 'admin.auth.page.roles.read');
    assert.ok(authRolesPagePermission);
    assert.ok(Array.isArray(authRolesPagePermission.pages));
    assert.ok(authRolesPagePermission.pages.some((x) => x.path === '/admin/auth-roles.html'));
    const toolsApproveActionPermission = roleList.body.permissionMatrix.find((x) => x.permission === 'admin.tools.action.approve-service');
    assert.ok(toolsApproveActionPermission);
    assert.ok(Array.isArray(toolsApproveActionPermission.apis));
    assert.ok(toolsApproveActionPermission.apis.some((x) => x.path === '/api/admin/tools/mcp-services/{serviceId}/approve'));
    const skillsUnlinkPermission = roleList.body.permissionMatrix.find((x) => x.permission === 'admin.skills.action.unlink-employee');
    assert.ok(skillsUnlinkPermission);
    assert.ok(Array.isArray(skillsUnlinkPermission.apis));
    assert.ok(skillsUnlinkPermission.apis.some((x) => x.path === '/api/admin/skills/{skillId}/unlink'));
    const skillsDeletePermission = roleList.body.permissionMatrix.find((x) => x.permission === 'admin.skills.action.delete');
    assert.ok(skillsDeletePermission);
    assert.ok(Array.isArray(skillsDeletePermission.actions));
    assert.ok(skillsDeletePermission.actions.some((x) => x.id === 'admin.skills.delete-skill'));

    const exportRes = await requestJson(base, '/api/admin/auth/roles/permission-matrix-export', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.body.schemaVersion, 'admin.permission.matrix.v1');
    assert.equal(typeof exportRes.body.generatedAt, 'string');
    assert.ok(exportRes.body.generatedAt.length > 0);
    assert.equal(typeof (exportRes.body.summary || {}).permissionCount, 'number');
    assert.equal((exportRes.body.summary || {}).moduleFilter, 'all');
    assert.equal((exportRes.body.summary || {}).actionRiskFilter, 'all');
    assert.ok(Array.isArray(exportRes.body.permissionMatrix));
    assert.ok(exportRes.body.permissionMatrix.some((x) => x.permission === 'admin.auth.page.roles.read'));
    const exportRolePermission = exportRes.body.permissionMatrix.find((x) => x.permission === 'admin.tasks.read');
    assert.ok(exportRolePermission);
    assert.equal(typeof exportRolePermission.roleUsageCount, 'number');
    assert.ok(Array.isArray(exportRolePermission.roles));

    const exportFiltered = await requestJson(base, '/api/admin/auth/roles/permission-matrix-export?module=skills&actionRisk=critical', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(exportFiltered.status, 200);
    assert.equal((exportFiltered.body.summary || {}).moduleFilter, 'skills');
    assert.equal((exportFiltered.body.summary || {}).actionRiskFilter, 'critical');
    assert.ok(Array.isArray(exportFiltered.body.permissionMatrix));
    assert.equal(exportFiltered.body.permissionMatrix.every((item) => String(item.permission || '').startsWith('admin.skills.')), true);
    assert.equal(
      exportFiltered.body.permissionMatrix.every((item) => (item.actions || []).some((action) => action.risk === 'critical')),
      true
    );

    const createdUser = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'ops_observer_user',
        displayName: '观察员',
        role: 'ops_observer',
        password: 'observer-001'
      })
    });
    assert.equal(createdUser.status, 201);
    assert.equal(createdUser.body.permissionsSource, 'role');
    assert.equal(createdUser.body.permissions.length, 2);

    const roleUpdated = await requestJson(base, '/api/admin/auth/roles/ops_observer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ permissions: ['admin.tasks.read'] })
    });
    assert.equal(roleUpdated.status, 200);
    assert.equal(roleUpdated.body.permissions.length, 1);

    const roleRenamed = await requestJson(base, '/api/admin/auth/roles/ops_observer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ roleName: 'ops_auditor', permissions: ['admin.tasks.read', 'admin.logs.read'] })
    });
    assert.equal(roleRenamed.status, 200);
    assert.equal(roleRenamed.body.role, 'ops_auditor');
    assert.equal(roleRenamed.body.previousRole, 'ops_observer');

    const usersAfterRoleUpdate = await requestJson(base, '/api/admin/auth/users', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(usersAfterRoleUpdate.status, 200);
    const observer = usersAfterRoleUpdate.body.users.find((x) => x.username === 'ops_observer_user');
    assert.ok(observer);
    assert.equal(observer.role, 'ops_auditor');
    assert.equal(observer.permissions.length, 2);

    const inUseDelete = await requestJson(base, '/api/admin/auth/roles/ops_auditor/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(inUseDelete.status, 400);
    assert.match(String(inUseDelete.body.error || ''), /role is in use/);

  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
