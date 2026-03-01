const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: options.headers || {}
  });
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

test('front subscriptions routes support create/list/pause/resume', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const username = `sub_user_${runId}`;
    const user = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        username,
        displayName: 'Subscription User',
        role: 'ops_admin',
        password: 'subUser123',
        tenantId: 'tenant-sub',
        accountId: 'account-sub'
      })
    });
    assert.equal(user.status, 201);

    const cookie = await loginAndCookie(base, username, 'subUser123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-sub-${runId}`,
        name: '订阅员工',
        department: 'Research',
        role: 'Analyst'
      })
    });
    assert.equal(employee.status, 201);

    const created = await requestJson(base, '/api/front/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        sourceUrl: 'https://tisi.org/',
        topic: 'AI',
        category: 'ai',
        intervalMinutes: 30
      })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'active');

    const inferred = await requestJson(base, '/api/front/subscriptions/nl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        text: '帮我订阅 https://tisi.org/ 的 AI 最新动态，每3小时推送摘要'
      })
    });
    assert.equal(inferred.status, 201);
    assert.equal(inferred.body.subscription.employeeId, employee.body.id);
    assert.equal(inferred.body.subscription.sourceUrl, 'https://tisi.org/');
    assert.equal(inferred.body.subscription.intervalMinutes, 180);

    const listed = await requestJson(base, '/api/front/subscriptions', {
      headers: { Cookie: cookie }
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 2);

    const managed = await requestJson(base, '/api/front/subscriptions/nl/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        text: '把 tisi 的 AI 订阅改为每4小时推送一次'
      })
    });
    assert.equal(managed.status, 200);
    assert.equal(managed.body.status, 'updated');
    assert.equal(Number(managed.body.subscription.intervalMinutes), 240);

    const paused = await requestJson(base, `/api/front/subscriptions/${created.body.id}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ reason: 'manual pause' })
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.status, 'paused');

    const resumed = await requestJson(base, `/api/front/subscriptions/${created.body.id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({})
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.status, 'active');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
