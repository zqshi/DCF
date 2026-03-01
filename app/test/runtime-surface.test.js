const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

test('framework and runtime status endpoints use provider-neutral naming', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    const framework = await requestJson(base, '/api/framework');
    assert.equal(framework.status, 200);
    assert.equal(String(framework.body.engines.execution || '').toLowerCase().includes('openclaw'), false);

    const login = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie);

    const runtime = await requestJson(base, '/api/admin/runtime-status', {
      headers: { Cookie: cookie }
    });
    assert.equal(runtime.status, 200);
    assert.equal(typeof runtime.body.runtimeEnabled, 'boolean');
    assert.equal(typeof runtime.body.openClawEnabled, 'undefined');
    assert.equal(String(runtime.body.runtimeProvider || '').includes('openclaw'), false);
    assert.equal(typeof runtime.body.skillSedimentationPolicy, 'object');
    assert.equal(runtime.body.skillSedimentationPolicy.mode, 'hybrid');
    assert.equal(typeof runtime.body.skillSedimentationMetrics, 'object');
    assert.equal(typeof runtime.body.runtimeShadow, 'object');
    assert.equal(typeof runtime.body.runtimeShadow.comparedCount, 'number');

    const overview = await requestJson(base, '/api/admin/overview', {
      headers: { Cookie: cookie }
    });
    assert.equal(overview.status, 200);
    assert.equal(typeof overview.body.delivery, 'object');
    assert.equal(typeof overview.body.governance, 'object');
    assert.equal(typeof overview.body.assets, 'object');
    assert.equal(typeof overview.body.runtime, 'object');
    assert.equal(Array.isArray(overview.body.focus), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
