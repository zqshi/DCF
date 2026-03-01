const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: options.headers || {}
  });
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

test('front routes isolate employees and tasks by tenant/account', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const createUserA = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'tenant_user_a',
        displayName: 'Tenant A User',
        role: 'ops_admin',
        password: 'tenantA123',
        tenantId: 'tenant-a',
        accountId: 'account-a'
      })
    });
    assert.equal(createUserA.status, 201);

    const createUserB = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'tenant_user_b',
        displayName: 'Tenant B User',
        role: 'ops_admin',
        password: 'tenantB123',
        tenantId: 'tenant-b',
        accountId: 'account-b'
      })
    });
    assert.equal(createUserB.status, 201);

    const tenantACookie = await loginAndCookie(base, 'tenant_user_a', 'tenantA123');
    const tenantBCookie = await loginAndCookie(base, 'tenant_user_b', 'tenantB123');

    const createdEmployeeByTenantA = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        creator: 'front-tenant-a',
        name: 'Tenant A Employee',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(createdEmployeeByTenantA.status, 201);

    const createdTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        employeeId: createdEmployeeByTenantA.body.id,
        goal: 'Tenant A task'
      })
    });
    assert.equal(createdTask.status, 201);

    const listByTenantA = await requestJson(base, '/api/front/tasks', {
      headers: { Cookie: tenantACookie }
    });
    assert.equal(listByTenantA.status, 200);
    assert.equal(listByTenantA.body.some((x) => x.id === createdTask.body.id), true);

    const listByTenantB = await requestJson(base, '/api/front/tasks', {
      headers: { Cookie: tenantBCookie }
    });
    assert.equal(listByTenantB.status, 200);
    assert.equal(listByTenantB.body.some((x) => x.id === createdTask.body.id), false);

    const crossTenantCreate = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantBCookie },
      body: JSON.stringify({
        employeeId: createdEmployeeByTenantA.body.id,
        goal: 'Cross tenant task should fail'
      })
    });
    assert.equal(crossTenantCreate.status, 404);
    assert.match(String(crossTenantCreate.body.error || ''), /employee not found/i);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front routes reject missing tenant/account binding in session', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const createUnscopedUser = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'tenant_unscoped',
        displayName: 'Tenant Unscoped',
        role: 'ops_admin',
        password: 'tenantUnscoped123'
      })
    });
    assert.equal(createUnscopedUser.status, 201);

    const unscopedCookie = await loginAndCookie(base, 'tenant_unscoped', 'tenantUnscoped123');
    const res = await requestJson(base, '/api/front/tasks', {
      headers: { Cookie: unscopedCookie }
    });
    assert.equal(res.status, 403);
    assert.match(String(res.body.error || ''), /not bound to tenant\/account/i);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front routes isolate employees and tasks by actor user under same tenant/account', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const userAName = `same_scope_user_a_${runId}`;
    const userBName = `same_scope_user_b_${runId}`;

    const createUserA = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: userAName,
        displayName: 'Same Scope User A',
        role: 'ops_admin',
        password: 'sameScopeA123',
        tenantId: 'tenant-shared',
        accountId: 'account-shared'
      })
    });
    assert.equal(createUserA.status, 201);

    const createUserB = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: userBName,
        displayName: 'Same Scope User B',
        role: 'ops_admin',
        password: 'sameScopeB123',
        tenantId: 'tenant-shared',
        accountId: 'account-shared'
      })
    });
    assert.equal(createUserB.status, 201);

    const cookieA = await loginAndCookie(base, userAName, 'sameScopeA123');
    const cookieB = await loginAndCookie(base, userBName, 'sameScopeB123');

    const createdEmployeeByA = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        creator: 'force-creator-a',
        name: 'Same Scope Employee A',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(createdEmployeeByA.status, 201);

    const listEmployeesByA = await requestJson(base, '/api/front/employees', {
      headers: { Cookie: cookieA }
    });
    assert.equal(listEmployeesByA.status, 200);
    assert.equal(listEmployeesByA.body.some((item) => item.id === createdEmployeeByA.body.id), true);

    const listEmployeesByB = await requestJson(base, '/api/front/employees', {
      headers: { Cookie: cookieB }
    });
    assert.equal(listEmployeesByB.status, 200);
    assert.equal(listEmployeesByB.body.some((item) => item.id === createdEmployeeByA.body.id), false);

    const createTaskByA = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        employeeId: createdEmployeeByA.body.id,
        goal: 'Owner A task'
      })
    });
    assert.equal(createTaskByA.status, 201);

    const listTasksByB = await requestJson(base, '/api/front/tasks', {
      headers: { Cookie: cookieB }
    });
    assert.equal(listTasksByB.status, 200);
    assert.equal(listTasksByB.body.some((item) => item.id === createTaskByA.body.id), false);

    const crossUserCreateTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({
        employeeId: createdEmployeeByA.body.id,
        goal: 'Cross user task should fail'
      })
    });
    assert.equal(crossUserCreateTask.status, 404);
    assert.match(String(crossUserCreateTask.body.error || ''), /employee not found/i);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
