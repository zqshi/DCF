const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function waitForShadowDiff(base, cookie, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await requestJson(base, '/api/admin/runtime/shadow-diffs?page=1&pageSize=20', {
      headers: { Cookie: cookie }
    });
    if (res.status === 200 && Array.isArray(res.body.items) && res.body.items.length > 0) {
      return res.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timeout waiting for runtime shadow diff events');
}

test('admin runtime shadow diffs route returns paged diff entries', async () => {
  const envBackup = {
    EXECUTION_ENGINE: process.env.EXECUTION_ENGINE,
    RUNTIME_SHADOW_COMPARE_ENABLED: process.env.RUNTIME_SHADOW_COMPARE_ENABLED,
    RUNTIME_SHADOW_COMPARE_TARGET: process.env.RUNTIME_SHADOW_COMPARE_TARGET,
    SKILLS_RUNTIME_ENABLED: process.env.SKILLS_RUNTIME_ENABLED,
    SELF_HOSTED_RUNTIME_ENABLED: process.env.SELF_HOSTED_RUNTIME_ENABLED,
    RUNTIME_SHADOW_ALLOW_TENANTS: process.env.RUNTIME_SHADOW_ALLOW_TENANTS,
    RUNTIME_SHADOW_ALLOW_ROLES: process.env.RUNTIME_SHADOW_ALLOW_ROLES
  };
  process.env.EXECUTION_ENGINE = 'self_hosted';
  process.env.RUNTIME_SHADOW_COMPARE_ENABLED = '1';
  process.env.RUNTIME_SHADOW_COMPARE_TARGET = 'openclaw';
  process.env.SKILLS_RUNTIME_ENABLED = '1';
  process.env.SELF_HOSTED_RUNTIME_ENABLED = '1';
  process.env.RUNTIME_SHADOW_ALLOW_TENANTS = '*';
  process.env.RUNTIME_SHADOW_ALLOW_ROLES = '*';

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const creatorId = `u-shadow-route-${Date.now()}`;
    const conversationId = `thread-shadow-route-${Date.now()}`;
    const login = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(login.status, 200);
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: creatorId,
        name: 'ShadowRoute',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const task = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: 'run shadow compare route check',
        conversationId
      })
    });
    assert.equal(task.status, 201);

    const list = await waitForShadowDiff(base, cookie);
    assert.equal(typeof list.total, 'number');
    assert.equal(Array.isArray(list.items), true);
    const first = list.items[0];
    assert.equal(String(first.type), 'runtime.shadow.compared');
    assert.equal(typeof (((first || {}).payload || {}).diff || {}).scores?.overall, 'number');

    const byTask = await requestJson(base, `/api/admin/runtime/shadow-diffs?taskId=${encodeURIComponent(task.body.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(byTask.status, 200);
    assert.equal(Array.isArray(byTask.body.items), true);
    assert.equal(byTask.body.items.every((ev) => String((ev.payload || {}).task_id || '') === task.body.id), true);
  } finally {
    process.env.EXECUTION_ENGINE = envBackup.EXECUTION_ENGINE;
    process.env.RUNTIME_SHADOW_COMPARE_ENABLED = envBackup.RUNTIME_SHADOW_COMPARE_ENABLED;
    process.env.RUNTIME_SHADOW_COMPARE_TARGET = envBackup.RUNTIME_SHADOW_COMPARE_TARGET;
    process.env.SKILLS_RUNTIME_ENABLED = envBackup.SKILLS_RUNTIME_ENABLED;
    process.env.SELF_HOSTED_RUNTIME_ENABLED = envBackup.SELF_HOSTED_RUNTIME_ENABLED;
    process.env.RUNTIME_SHADOW_ALLOW_TENANTS = envBackup.RUNTIME_SHADOW_ALLOW_TENANTS;
    process.env.RUNTIME_SHADOW_ALLOW_ROLES = envBackup.RUNTIME_SHADOW_ALLOW_ROLES;
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
