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

async function startServer(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

test('admin tools pending list and status transitions are governed by role policy', async () => {
  const previous = process.env.REGISTRY_API_KEYS;
  process.env.REGISTRY_API_KEYS = 'reg-key-1';
  const server = await createApp();
  let started = false;

  try {
    await startServer(server);
    started = true;
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');

    const registered = await requestJson(base, '/api/registry/tools/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer reg-key-1',
        'X-Registrant-Id': 'erp-sync-bot',
        'X-Source-System': 'erp'
      },
      body: JSON.stringify({
        name: 'ERP Registry Bridge',
        transport: 'http',
        endpoint: 'http://127.0.0.1:9101/mcp'
      })
    });
    assert.equal(registered.status, 202);
    assert.equal(registered.body.registrationStatus, 'pending');

    const pending = await requestJson(base, '/api/admin/tools/pending', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(pending.status, 200);
    assert.ok(Array.isArray(pending.body));
    assert.ok(pending.body.some((x) => x.id === registered.body.id));

    const opsForbidden = await requestJson(base, '/api/admin/tools/pending', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(opsForbidden.status, 403);

    const approved = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(registered.body.id)}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ note: 'approve from skill admin' })
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.registrationStatus, 'approved');

    const rollbackBySkill = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(registered.body.id)}/rollback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ reason: 'rework' })
    });
    assert.equal(rollbackBySkill.status, 403);
    assert.match(String(rollbackBySkill.body.error || ''), /role is not allowed/i);

    const rollbackBySuper = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(registered.body.id)}/rollback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ reason: 'rework' })
    });
    assert.equal(rollbackBySuper.status, 200);
    assert.equal(rollbackBySuper.body.registrationStatus, 'rollback');

    const resubmit = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(registered.body.id)}/resubmit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(resubmit.status, 200);
    assert.equal(resubmit.body.registrationStatus, 'pending');

    const rejected = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(registered.body.id)}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.registrationStatus, 'rejected');
  } finally {
    await server.shutdown();
    if (started) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    if (typeof previous === 'string') process.env.REGISTRY_API_KEYS = previous;
    else delete process.env.REGISTRY_API_KEYS;
  }
});
