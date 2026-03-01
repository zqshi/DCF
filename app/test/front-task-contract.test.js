const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
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

test('front task api rejects invalid externalWrite contract', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-contract-${runId}`,
        name: 'Contract Tester',
        department: 'Finance',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);
    assert.equal(((employee.body.runtimeProfile || {}).agentId || '').length > 0, true);
    assert.equal(
      (employee.body.runtimeProfile || {}).agentId,
      (employee.body.openclawProfile || {}).agentId
    );

    const invalidTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: 'Create ERP invoice',
        externalWrite: {
          system: 'erp',
          operation: 'invoice.create'
        }
      })
    });
    assert.equal(invalidTask.status, 400);
    assert.match(String(invalidTask.body.error || ''), /idempotencyKey/i);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front employee create auto-generates email when omitted', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');
    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-auto-email-${runId}`,
        name: 'Auto Mail',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);
    assert.match(String(employee.body.email || ''), /@dcf\.local$/);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front task api returns POLICY_DENIED when risk exceeds employee boundary policy', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-boundary-${runId}`,
        name: 'Boundary Tester',
        department: 'Finance',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);
    assert.equal(((employee.body.runtimeProfile || {}).agentId || '').length > 0, true);
    assert.equal(
      (employee.body.runtimeProfile || {}).agentId,
      (employee.body.openclawProfile || {}).agentId
    );

    const updatePolicy = await requestJson(base, `/api/admin/employees/${employee.body.id}/policy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({ maxRiskLevel: 'L2' })
    });
    assert.equal(updatePolicy.status, 200);

    const denied = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        goal: 'Run high risk operation',
        riskLevel: 'L3'
      })
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'POLICY_DENIED');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front task api derives sessionKey from conversationId by default', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-session-contract-${runId}`,
        name: 'Front Session Contract Tester',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);
    assert.equal(((employee.body.runtimeProfile || {}).agentId || '').length > 0, true);
    assert.equal(
      (employee.body.runtimeProfile || {}).agentId,
      (employee.body.openclawProfile || {}).agentId
    );

    const conversation = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: '会话到运行时路由'
      })
    });
    assert.equal(conversation.status, 201);

    const createdTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        goal: '验证会话路由'
      })
    });
    assert.equal(createdTask.status, 201);
    assert.equal(createdTask.body.conversationId, conversation.body.id);
    assert.equal(Boolean(((createdTask.body || {}).llmConfig || {}).requireRealLlm), true);
    assert.equal(
      String(((createdTask.body || {}).runtimeConfig || {}).sessionKey || ''),
      `agent:${employee.body.runtimeProfile.agentId}:conv:${conversation.body.id}`
    );
    assert.equal(
      String(((createdTask.body || {}).openclaw || {}).sessionKey || ''),
      `agent:${employee.body.openclawProfile.agentId}:conv:${conversation.body.id}`
    );
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front employees/tasks list keeps runtime aliases compatible for both runtime and legacy payloads', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');

    const runtimeEmployee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-runtime-${runId}`,
        name: `Front Runtime ${runId}`,
        department: 'Ops',
        role: 'Operator',
        runtimeProfile: {
          agentId: `runtime-agent-${runId}`,
          systemPrompt: 'runtime profile only',
          toolScope: ['read', 'bash']
        }
      })
    });
    assert.equal(runtimeEmployee.status, 201);
    assert.equal(
      (runtimeEmployee.body.runtimeProfile || {}).agentId,
      (runtimeEmployee.body.openclawProfile || {}).agentId
    );

    const legacyEmployee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-legacy-${runId}`,
        name: `Front Legacy ${runId}`,
        department: 'Ops',
        role: 'Operator',
        openclawProfile: {
          agentId: `legacy-agent-${runId}`,
          systemPrompt: 'legacy profile only',
          toolScope: ['read']
        }
      })
    });
    assert.equal(legacyEmployee.status, 201);
    assert.equal(
      (legacyEmployee.body.runtimeProfile || {}).agentId,
      (legacyEmployee.body.openclawProfile || {}).agentId
    );

    const employees = await requestJson(base, '/api/front/employees', {
      headers: { Cookie: cookie }
    });
    assert.equal(employees.status, 200);
    const listedRuntimeEmployee = (employees.body || []).find((item) => item.id === runtimeEmployee.body.id);
    const listedLegacyEmployee = (employees.body || []).find((item) => item.id === legacyEmployee.body.id);
    assert.ok(listedRuntimeEmployee);
    assert.ok(listedLegacyEmployee);
    assert.equal(
      (listedRuntimeEmployee.runtimeProfile || {}).agentId,
      (listedRuntimeEmployee.openclawProfile || {}).agentId
    );
    assert.equal(
      (listedLegacyEmployee.runtimeProfile || {}).agentId,
      (listedLegacyEmployee.openclawProfile || {}).agentId
    );

    const runtimeTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: runtimeEmployee.body.id,
        conversationId: `conv-runtime-${runId}`,
        goal: 'runtime task',
        runtimeConfig: {
          policyId: `policy-runtime-${runId}`,
          toolScope: ['read']
        }
      })
    });
    assert.equal(runtimeTask.status, 201);
    assert.equal(
      (runtimeTask.body.runtimeConfig || {}).policyId,
      (runtimeTask.body.openclaw || {}).policyId
    );

    const legacyTask = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: legacyEmployee.body.id,
        conversationId: `conv-legacy-${runId}`,
        goal: 'legacy task',
        openclaw: {
          policyId: `policy-legacy-${runId}`,
          toolScope: ['read']
        }
      })
    });
    assert.equal(legacyTask.status, 201);
    assert.equal(
      (legacyTask.body.runtimeConfig || {}).policyId,
      (legacyTask.body.openclaw || {}).policyId
    );

    const tasks = await requestJson(base, '/api/front/tasks', {
      headers: { Cookie: cookie }
    });
    assert.equal(tasks.status, 200);
    const listedRuntimeTask = (tasks.body || []).find((item) => item.id === runtimeTask.body.id);
    const listedLegacyTask = (tasks.body || []).find((item) => item.id === legacyTask.body.id);
    assert.ok(listedRuntimeTask);
    assert.ok(listedLegacyTask);
    assert.equal((listedRuntimeTask.runtimeConfig || {}).policyId, (listedRuntimeTask.openclaw || {}).policyId);
    assert.equal((listedLegacyTask.runtimeConfig || {}).policyId, (listedLegacyTask.openclaw || {}).policyId);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
