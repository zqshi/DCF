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

test('tools policy routes stay compatible with runtime policy routes', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const runtimeBefore = await requestJson(base, '/api/admin/runtime/retrieval-policy', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    const toolsBefore = await requestJson(base, '/api/admin/tools/retrieval-policy', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(runtimeBefore.status, 200);
    assert.equal(toolsBefore.status, 200);
    assert.equal(runtimeBefore.body.mode, toolsBefore.body.mode);

    const updatedByTools = await requestJson(base, '/api/admin/tools/retrieval-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ mode: 'idle' })
    });
    assert.equal(updatedByTools.status, 200);
    assert.equal(updatedByTools.body.mode, 'idle');

    const runtimeAfter = await requestJson(base, '/api/admin/runtime/retrieval-policy', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(runtimeAfter.status, 200);
    assert.equal(runtimeAfter.body.mode, 'idle');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
