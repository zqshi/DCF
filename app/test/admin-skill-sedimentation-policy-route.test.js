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

test('runtime skill sedimentation policy route supports read and write for runtime admin', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const auditorCookie = await loginAndCookie(base, 'auditor', 'audit123');

    const read = await requestJson(base, '/api/admin/runtime/skill-sedimentation-policy', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.mode, 'hybrid');

    const write = await requestJson(base, '/api/admin/runtime/skill-sedimentation-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        mode: 'model_driven',
        promotionMode: 'proposal',
        minConfidence: 0.8,
        fallbackToRulesWhenModelUnavailable: false,
        minRepeatedSuccessForFallback: 3,
        overrides: [
          {
            id: 'ops-operator',
            scope: { department: 'OPS', role: 'Operator' },
            mode: 'hybrid',
            minConfidence: 0.75,
            fallbackToRulesWhenModelUnavailable: true,
            minRepeatedSuccessForFallback: 2
          }
        ]
      })
    });
    assert.equal(write.status, 200);
    assert.equal(write.body.mode, 'model_driven');
    assert.equal(write.body.promotionMode, 'proposal');
    assert.equal(write.body.minConfidence, 0.8);
    assert.equal(Array.isArray(write.body.overrides), true);
    assert.equal(write.body.overrides.length, 1);
    assert.equal(write.body.overrides[0].id, 'ops-operator');

    const forbidden = await requestJson(base, '/api/admin/runtime/skill-sedimentation-policy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: auditorCookie
      },
      body: JSON.stringify({
        mode: 'rules',
        minConfidence: 0.6,
        fallbackToRulesWhenModelUnavailable: true,
        minRepeatedSuccessForFallback: 2
      })
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
