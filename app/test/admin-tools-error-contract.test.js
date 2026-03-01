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

test('tools routes keep stable error contracts for 400/403/404', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');

    const badRequest = await requestJson(base, '/api/admin/tools/mcp-services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ name: 'Broken Service', transport: 'http' })
    });
    assert.equal(badRequest.status, 400);
    assert.equal(String(badRequest.body.code || ''), 'TOOL_VALIDATION_ERROR');
    assert.match(String(badRequest.body.error || ''), /endpoint|服务地址|empty|required/i);

    const notFoundEntity = await requestJson(base, '/api/admin/tools/mcp-services/non-existent-service/check-health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(notFoundEntity.status, 404);
    assert.equal(String(notFoundEntity.body.code || ''), 'TOOL_NOT_FOUND');

    const forbidden = await requestJson(base, '/api/admin/tools/mcp-services', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.permission, 'admin.tools.assets.read');

    const notFound = await requestJson(base, '/api/admin/tools/unknown', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(notFound.status, 404);
    assert.equal(String(notFound.body.error || ''), 'Not Found');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
