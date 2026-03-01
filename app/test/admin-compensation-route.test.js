const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: options.headers || {}
  });
  const body = await res.json();
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

test('admin compensation routes are blocked when recovery chain is disabled', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({
        creator: 'u-admin-comp-route',
        name: 'Comp Route Tester',
        department: 'Finance',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const task = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: 'Create payment update',
        externalWrite: {
          system: 'erp',
          operation: 'payment.update',
          idempotencyKey: 'erp-payment-admin-route-1',
          compensation: { action: 'payment.revert' }
        }
      })
    });
    assert.equal(task.status, 201);

    const rollback = await requestJson(base, '/api/admin/tasks/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({
        taskId: task.body.id,
        reason: 'route rollback'
      })
    });
    assert.equal(rollback.status, 409);
    assert.equal(rollback.body.code, 'RECOVERY_CHAIN_DISABLED');

    const retry = await requestJson(base, `/api/admin/tasks/${task.body.id}/retry-compensation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({ reason: 'manual retry trigger' })
    });
    assert.equal(retry.status, 409);
    assert.equal(retry.body.code, 'RECOVERY_CHAIN_DISABLED');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
