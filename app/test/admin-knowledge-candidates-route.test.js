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

test('admin knowledge candidates route supports listing and strict review validation', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const cookie = await loginAndCookie(base, 'admin', 'admin123');

    const listed = await requestJson(base, '/api/admin/knowledge-candidates', {
      method: 'GET',
      headers: { Cookie: cookie }
    });
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body), true);

    const missing = await requestJson(base, '/api/admin/knowledge-candidates/non-exists/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({ action: 'rejected' })
    });
    assert.equal(missing.status, 404);
    assert.match(String(missing.body.error || ''), /candidate not found/i);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
