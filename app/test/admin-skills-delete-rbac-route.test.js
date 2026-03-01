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

test('admin skills delete/unlink routes enforce RBAC', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const created = await requestJson(base, '/api/admin/skills/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({
        mode: 'merge',
        skills: [{ name: 'rbac-delete-test', type: 'general' }]
      })
    });
    assert.equal(created.status, 200);

    const list = await requestJson(base, '/api/admin/skills', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(list.status, 200);
    const target = (list.body || []).find((item) => item.name === 'rbac-delete-test');
    assert.ok(target);

    const forbiddenDelete = await requestJson(base, `/api/admin/skills/${encodeURIComponent(target.id)}`, {
      method: 'DELETE',
      headers: { Cookie: skillCookie }
    });
    assert.equal(forbiddenDelete.status, 403);

    const forbiddenUnlink = await requestJson(base, `/api/admin/skills/${encodeURIComponent(target.id)}/unlink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ employeeId: 'e-mock' })
    });
    assert.equal(forbiddenUnlink.status, 403);

    const deleted = await requestJson(base, `/api/admin/skills/${encodeURIComponent(target.id)}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
