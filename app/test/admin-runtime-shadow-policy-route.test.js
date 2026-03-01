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

test('runtime shadow policy route supports read and write for runtime admin', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const auditorCookie = await loginAndCookie(base, 'auditor', 'audit123');

    const read = await requestJson(base, '/api/admin/runtime/shadow-policy', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(read.status, 200);
    assert.equal(typeof read.body.enabled, 'boolean');

    const write = await requestJson(base, '/api/admin/runtime/shadow-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        enabled: true,
        targetEngine: 'openclaw',
        allowTenants: 'tenant-a,tenant-b',
        allowRoles: 'operator,auditor'
      })
    });
    assert.equal(write.status, 200);
    assert.equal(write.body.enabled, true);
    assert.equal(write.body.targetEngine, 'openclaw');
    assert.deepEqual(write.body.allowTenants, ['tenant-a', 'tenant-b']);
    assert.deepEqual(write.body.allowRoles, ['operator', 'auditor']);

    const forbidden = await requestJson(base, '/api/admin/runtime/shadow-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: auditorCookie
      },
      body: JSON.stringify({
        enabled: false,
        targetEngine: 'openclaw',
        allowTenants: '*',
        allowRoles: '*'
      })
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
