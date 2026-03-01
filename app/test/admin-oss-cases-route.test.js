const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, routePath, options = {}) {
  const res = await fetch(`${base}${routePath}`, options);
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

test('admin oss cases routes enforce rbac and expose transition endpoints', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const forbidden = await requestJson(base, '/api/admin/oss-cases', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(forbidden.status, 403);

    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const list = await requestJson(base, '/api/admin/oss-cases', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));

    const filtered = await requestJson(base, '/api/admin/oss-cases?status=completed&evidenceComplete=true', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(filtered.status, 200);
    assert.ok(Array.isArray(filtered.body));

    const write = await requestJson(base, '/api/admin/oss-cases/not-found/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({ decision: 'introduce_oss' })
    });
    assert.ok([403, 404].includes(write.status));
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin oss governance policy routes enforce rbac and reject manual update', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const forbiddenRead = await requestJson(base, '/api/admin/oss-governance-policy', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(forbiddenRead.status, 403);

    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const current = await requestJson(base, '/api/admin/oss-governance-policy', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(current.status, 200);
    assert.equal(current.body.mode, 'model_driven');
    assert.equal(current.body.decisionEngine, 'llm');

    const updated = await requestJson(base, '/api/admin/oss-governance-policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({
        mode: 'assist',
        fallbackToManualWhenModelUnavailable: true
      })
    });
    assert.equal(updated.status, 405);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
