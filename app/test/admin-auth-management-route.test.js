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

test('admin auth management routes enforce RBAC and support lifecycle', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const forbidden = await requestJson(base, '/api/admin/auth/users', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(forbidden.status, 403);

    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const health = await requestJson(base, '/api/admin/auth/health', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(health.status, 200);
    assert.equal(typeof health.body.healthy, 'boolean');

    const before = await requestJson(base, '/api/admin/auth/users', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(before.status, 200);
    const beforeCount = before.body.users.length;

    const ssoAuthorized = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'sso_auth_1',
        displayName: 'SSO授权用户',
        role: 'ops_admin',
        ssoManaged: true,
        authProvider: 'sso'
      })
    });
    assert.equal(ssoAuthorized.status, 201);
    assert.equal(ssoAuthorized.body.ssoManaged, true);

    const created = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'ops_plus',
        displayName: '运营扩展账号',
        role: 'ops_admin',
        password: 'ops-plus-001',
        position: '运营专员'
      })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.username, 'ops_plus');
    assert.equal(created.body.position, '运营专员');

    const autoNamed = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        displayName: '自动编号账号',
        role: 'ops_admin',
        ssoManaged: true,
        authProvider: 'sso'
      })
    });
    assert.equal(autoNamed.status, 201);
    assert.match(String(autoNamed.body.username || ''), /^u_[a-z0-9]{12}$/);

    const canLogin = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ops_plus', password: 'ops-plus-001' })
    });
    assert.equal(canLogin.status, 200);
    const cookie = String(canLogin.headers.get('set-cookie') || '').split(';')[0];
    const me = await requestJson(base, '/api/auth/me', {
      method: 'GET',
      headers: { Cookie: cookie }
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.position, '运营专员');

    const disabled = await requestJson(base, `/api/admin/auth/users/${created.body.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ status: 'disabled' })
    });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.status, 'disabled');

    const disabledLogin = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ops_plus', password: 'ops-plus-001' })
    });
    assert.equal(disabledLogin.status, 401);

    const reactivate = await requestJson(base, `/api/admin/auth/users/${created.body.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ status: 'active' })
    });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.status, 'active');

    const reset = await requestJson(base, `/api/admin/auth/users/${created.body.id}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ password: 'ops-plus-002' })
    });
    assert.equal(reset.status, 200);

    const oldPasswordLogin = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ops_plus', password: 'ops-plus-001' })
    });
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ops_plus', password: 'ops-plus-002' })
    });
    assert.equal(newPasswordLogin.status, 200);

    const removed = await requestJson(base, `/api/admin/auth/users/${created.body.id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.deleted, true);
    assert.equal(removed.body.user.id, created.body.id);

    const removedAuto = await requestJson(base, `/api/admin/auth/users/${autoNamed.body.id}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(removedAuto.status, 200);
    assert.equal(removedAuto.body.deleted, true);

    const after = await requestJson(base, '/api/admin/auth/users', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(after.status, 200);
    assert.equal(after.body.users.length, beforeCount + 1);
    assert.ok(Array.isArray(after.body.roles));
    assert.ok(after.body.roles.some((x) => x.role === 'super_admin'));
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
