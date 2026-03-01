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

async function waitForTask(base, taskId, predicate, cookie, timeoutMs = 5000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const tasks = await requestJson(base, '/api/front/tasks', {
      headers: { Cookie: cookie }
    });
    const task = (tasks.body || []).find((x) => x.id === taskId);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  throw new Error(`timeout waiting for task ${taskId}`);
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

test('front route can approve high-risk task with role-diverse approvals', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        creator: 'u-front-approval',
        name: 'Front Approval Tester',
        department: 'OPS',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const createdTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: 'High risk approval flow in front',
        riskLevel: 'L4'
      })
    });
    assert.equal(createdTask.status, 201);

    const validatingTask = await waitForTask(base, createdTask.body.id, (task) => task.status === 'validating', adminCookie);
    assert.equal(validatingTask.requiresApproval, true);

    const unauthApprove = await requestJson(base, `/api/front/tasks/${createdTask.body.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approverRole: 'ops_admin'
      })
    });
    assert.equal(unauthApprove.status, 401);

    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');

    const firstApproval = await requestJson(base, `/api/front/tasks/${createdTask.body.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({
        approverRole: 'ops_admin',
        note: 'first role approval'
      })
    });
    assert.equal(firstApproval.status, 200);
    assert.equal(firstApproval.body.status, 'validating');

    const auditorCookie = await loginAndCookie(base, 'auditor', 'audit123');

    const secondApproval = await requestJson(base, `/api/front/tasks/${createdTask.body.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: auditorCookie },
      body: JSON.stringify({
        approverRole: 'auditor',
        note: 'second role approval'
      })
    });
    assert.equal(secondApproval.status, 200);
    assert.ok(['approved', 'running', 'succeeded'].includes(secondApproval.body.status));
    assert.equal(secondApproval.body.approval.approved, true);
    assert.equal(secondApproval.body.approval.approvals.length, 2);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front reject route requires privileged role and is blocked when recovery chain is disabled', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        creator: 'u-front-reject',
        name: 'Front Reject Tester',
        department: 'OPS',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const createdTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: 'High risk reject flow in front',
        riskLevel: 'L4'
      })
    });
    assert.equal(createdTask.status, 201);

    await waitForTask(base, createdTask.body.id, (task) => task.status === 'validating', adminCookie);

    const unauthReject = await requestJson(base, `/api/front/tasks/${createdTask.body.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'not allowed unauth' })
    });
    assert.equal(unauthReject.status, 401);

    const auditorCookie = await loginAndCookie(base, 'auditor', 'audit123');
    const auditorReject = await requestJson(base, `/api/front/tasks/${createdTask.body.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: auditorCookie },
      body: JSON.stringify({ reason: 'auditor reject attempt' })
    });
    assert.equal(auditorReject.status, 403);

    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const opsReject = await requestJson(base, `/api/front/tasks/${createdTask.body.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: opsCookie },
      body: JSON.stringify({ reason: 'ops reject approved' })
    });
    assert.equal(opsReject.status, 409);
    assert.equal(opsReject.body.code, 'RECOVERY_CHAIN_DISABLED');

    const events = await requestJson(base, '/api/events?limit=300');
    assert.equal(events.status, 200);
    const rollbackTriggered = (events.body || []).find((event) => event.type === 'task.rollback.triggered');
    assert.equal(Boolean(rollbackTriggered), false);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
