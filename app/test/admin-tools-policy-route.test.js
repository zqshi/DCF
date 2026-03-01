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

test('tools policy routes support read/write with scoped permissions', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');

    const metrics = await requestJson(base, '/api/admin/tools/retrieval-metrics', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(metrics.status, 200);
    assert.ok(metrics.body.retrievalPolicy);
    assert.ok(metrics.body.retrieval);

    const updated = await requestJson(base, '/api/admin/tools/retrieval-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ mode: 'busy' })
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.mode, 'busy');

    const readForbidden = await requestJson(base, '/api/admin/tools/retrieval-metrics', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(readForbidden.status, 403);

    const writeForbidden = await requestJson(base, '/api/admin/tools/retrieval-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({ mode: 'idle' })
    });
    assert.equal(writeForbidden.status, 403);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
