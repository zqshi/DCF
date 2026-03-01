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

test('front conversations api can create and list conversations by employee', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-conv-admin-${runId}`,
        name: 'Conversation Tester',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const created = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: '日常运营会话'
      })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.employeeId, employee.body.id);
    assert.equal(created.body.title, '日常运营会话');

    const listed = await requestJson(base, `/api/front/conversations?employeeId=${encodeURIComponent(employee.body.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body), true);
    assert.equal(listed.body.some((item) => item.id === created.body.id), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front conversations api supports pin/unpin and delete', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-conv-pin-${runId}`,
        name: 'Conversation Pin Tester',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const first = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: 'first conversation'
      })
    });
    assert.equal(first.status, 201);

    const second = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: 'second conversation'
      })
    });
    assert.equal(second.status, 201);

    const pinned = await requestJson(base, `/api/front/conversations/${encodeURIComponent(first.body.id)}/pin`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.id, first.body.id);
    assert.equal(pinned.body.isPinned, true);

    const listedAfterPin = await requestJson(base, `/api/front/conversations?employeeId=${encodeURIComponent(employee.body.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(listedAfterPin.status, 200);
    assert.equal(listedAfterPin.body[0].id, first.body.id);
    assert.equal(listedAfterPin.body[0].isPinned, true);

    const unpinned = await requestJson(base, `/api/front/conversations/${encodeURIComponent(first.body.id)}/unpin`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(unpinned.status, 200);
    assert.equal(unpinned.body.isPinned, false);

    const removed = await requestJson(base, `/api/front/conversations/${encodeURIComponent(second.body.id)}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.deleted, true);
    assert.equal(removed.body.id, second.body.id);

    const listedAfterDelete = await requestJson(base, `/api/front/conversations?employeeId=${encodeURIComponent(employee.body.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(listedAfterDelete.status, 200);
    assert.equal(listedAfterDelete.body.some((item) => item.id === second.body.id), false);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front conversations api enforces tenant/account isolation', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const userA = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        displayName: 'Conv Tenant A',
        role: 'ops_admin',
        password: 'tenantA123',
        tenantId: 'tenant-a',
        accountId: 'account-a'
      })
    });
    assert.equal(userA.status, 201, `create userA failed: ${JSON.stringify(userA.body)}`);

    const userB = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        displayName: 'Conv Tenant B',
        role: 'ops_admin',
        password: 'tenantB123',
        tenantId: 'tenant-b',
        accountId: 'account-b'
      })
    });
    assert.equal(userB.status, 201, `create userB failed: ${JSON.stringify(userB.body)}`);

    const tenantACookie = await loginAndCookie(base, userA.body.username, 'tenantA123');
    const tenantBCookie = await loginAndCookie(base, userB.body.username, 'tenantB123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        creator: `u-conv-tenant-a-${runId}`,
        name: 'Conversation Scoped Employee',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const created = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: 'Tenant A private conversation'
      })
    });
    assert.equal(created.status, 201);

    const crossTenantList = await requestJson(base, `/api/front/conversations?employeeId=${encodeURIComponent(employee.body.id)}`, {
      headers: { Cookie: tenantBCookie }
    });
    assert.equal(crossTenantList.status, 404);

    const crossTenantCreate = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantBCookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: 'Cross tenant should fail'
      })
    });
    assert.equal(crossTenantCreate.status, 404);

    const crossTenantPin = await requestJson(base, `/api/front/conversations/${encodeURIComponent(created.body.id)}/pin`, {
      method: 'POST',
      headers: { Cookie: tenantBCookie }
    });
    assert.equal(crossTenantPin.status, 404);

    const crossTenantDelete = await requestJson(base, `/api/front/conversations/${encodeURIComponent(created.body.id)}`, {
      method: 'DELETE',
      headers: { Cookie: tenantBCookie }
    });
    assert.equal(crossTenantDelete.status, 404);

    const crossTenantDeletePost = await requestJson(base, `/api/front/conversations/${encodeURIComponent(created.body.id)}/delete`, {
      method: 'POST',
      headers: { Cookie: tenantBCookie }
    });
    assert.equal(crossTenantDeletePost.status, 404);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
