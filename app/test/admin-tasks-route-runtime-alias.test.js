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

test('admin tasks routes return runtime aliases for task and employee runtime fields', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({
        creator: `route-task-runtime-alias-${runId}`,
        name: '任务路由 runtime alias 员工',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const task = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: '验证 admin tasks runtime alias',
        conversationId: `route-task-runtime-alias-conv-${runId}`,
        runtimeConfig: {
          policyId: 'policy-admin-task-runtime',
          toolScope: ['read']
        }
      })
    });
    assert.equal(task.status, 201);

    const list = await requestJson(base, '/api/admin/tasks', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(list.status, 200);
    assert.equal(Array.isArray(list.body), true);
    const row = list.body.find((item) => String((item || {}).id || '') === String(task.body.id || ''));
    assert.equal(Boolean(row), true);
    assert.equal((row.runtimeConfig || {}).policyId, 'policy-admin-task-runtime');
    assert.equal((row.runtimeConfig || {}).policyId, (row.openclaw || {}).policyId);

    const detail = await requestJson(base, `/api/admin/tasks/${task.body.id}`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(detail.status, 200);
    assert.equal((detail.body.runtimeConfig || {}).policyId, 'policy-admin-task-runtime');
    assert.equal((detail.body.runtimeConfig || {}).policyId, (detail.body.openclaw || {}).policyId);
    assert.equal(((detail.body.employee || {}).runtimeProfile || {}).agentId?.length > 0, true);
    assert.equal(
      ((detail.body.employee || {}).runtimeProfile || {}).agentId,
      ((detail.body.employee || {}).openclawProfile || {}).agentId
    );
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
