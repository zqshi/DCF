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

test('admin logs endpoint supports filtering by taskId and employeeId', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const login = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(login.status, 200);
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];

    const employeeA = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ creator: 'u-log-a', name: 'LogA', department: 'Ops', role: 'Operator' })
    });
    const employeeB = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ creator: 'u-log-b', name: 'LogB', department: 'Ops', role: 'Operator' })
    });
    assert.equal(employeeA.status, 201);
    assert.equal(employeeB.status, 201);

    const taskA = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ employeeId: employeeA.body.id, goal: 'Task A', conversationId: 'thread-a' })
    });
    const taskB = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ employeeId: employeeB.body.id, goal: 'Task B', conversationId: 'thread-b' })
    });
    assert.equal(taskA.status, 201);
    assert.equal(taskB.status, 201);

    const byTask = await requestJson(base, `/api/admin/logs?taskId=${encodeURIComponent(taskA.body.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(byTask.status, 200);
    assert.ok(byTask.body.length > 0);
    assert.equal(byTask.body.every((ev) => String((ev.payload || {}).task_id || '') === taskA.body.id), true);

    const byEmployee = await requestJson(base, `/api/admin/logs?employeeId=${encodeURIComponent(employeeB.body.id)}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(byEmployee.status, 200);
    assert.ok(byEmployee.body.length > 0);
    assert.equal(byEmployee.body.every((ev) => String((ev.payload || {}).employee_id || '') === employeeB.body.id), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
