const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

test('api v1 routes are backward-compatible aliases', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const v1 = await fetch(`${base}/api/v1/health`);
    assert.equal(v1.status, 503);
    assert.equal(v1.headers.get('x-api-version'), 'v1');
    const body = await v1.json();
    assert.equal(body.ok, false);

    const legacy = await fetch(`${base}/api/health`);
    assert.equal(legacy.status, 503);
    assert.equal(legacy.headers.get('x-api-version'), null);

    const queryHealth = await fetch(`${base}/api/v1/health?probe=1`);
    assert.equal(queryHealth.status, 503);
    assert.equal(queryHealth.headers.get('x-api-version'), 'v1');

    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('x-api-version'), 'v1');

    const notFound = await fetch(`${base}/api/v1/not-found`);
    assert.equal(notFound.status, 404);
    assert.equal(notFound.headers.get('x-api-version'), 'v1');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
