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

test('front messages api lists persisted user messages by conversation', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-msg-admin-${runId}`,
        name: 'Message Tester',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const conversation = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: '消息测试会话'
      })
    });
    assert.equal(conversation.status, 201);

    const task = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        goal: '请整理今日运营日报'
      })
    });
    assert.equal(task.status, 201);

    const messages = await requestJson(
      base,
      `/api/front/messages?employeeId=${encodeURIComponent(employee.body.id)}&conversationId=${encodeURIComponent(conversation.body.id)}`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(messages.status, 200);
    assert.equal(Array.isArray(messages.body), true);
    assert.equal(messages.body.length >= 1, true);
    const latestUserMessage = messages.body.find((item) => item.taskId === task.body.id && item.role === 'user');
    assert.ok(latestUserMessage);
    assert.equal(latestUserMessage.content, '请整理今日运营日报');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front messages api enforces tenant/account isolation', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const userAName = `msg_tenant_a_${runId}`;
    const userBName = `msg_tenant_b_${runId}`;
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const userA = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        username: userAName,
        displayName: 'Message Tenant A',
        role: 'ops_admin',
        password: 'tenantA123',
        tenantId: 'tenant-a',
        accountId: 'account-a'
      })
    });
    assert.equal(userA.status, 201);

    const userB = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        username: userBName,
        displayName: 'Message Tenant B',
        role: 'ops_admin',
        password: 'tenantB123',
        tenantId: 'tenant-b',
        accountId: 'account-b'
      })
    });
    assert.equal(userB.status, 201);

    const tenantACookie = await loginAndCookie(base, userAName, 'tenantA123');
    const tenantBCookie = await loginAndCookie(base, userBName, 'tenantB123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        creator: `u-msg-tenant-a-${runId}`,
        name: 'Message Scoped Employee',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const conversation = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: 'Tenant A message conversation'
      })
    });
    assert.equal(conversation.status, 201);

    const task = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tenantACookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        goal: '租户 A 专属消息'
      })
    });
    assert.equal(task.status, 201);

    const forbidden = await requestJson(
      base,
      `/api/front/messages?employeeId=${encodeURIComponent(employee.body.id)}&conversationId=${encodeURIComponent(conversation.body.id)}`,
      { headers: { Cookie: tenantBCookie } }
    );
    assert.equal(forbidden.status, 404);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front dispatch preserves user input structure in persisted messages', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base, 'admin', 'admin123');

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-msg-structure-${runId}`,
        name: 'Message Structure Tester',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(employee.status, 201);

    const conversation = await requestJson(base, '/api/front/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        title: '消息结构测试会话'
      })
    });
    assert.equal(conversation.status, 201);

    const userInput = '  第一行\n\n  第二行  \n';
    const dispatch = await requestJson(base, '/api/front/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        text: userInput
      })
    });
    assert.equal(dispatch.status, 200);

    const messages = await requestJson(
      base,
      `/api/front/messages?employeeId=${encodeURIComponent(employee.body.id)}&conversationId=${encodeURIComponent(conversation.body.id)}`,
      { headers: { Cookie: cookie } }
    );
    assert.equal(messages.status, 200);
    const latestUserMessage = messages.body.find((item) => item.taskId === dispatch.body.task.id && item.role === 'user');
    assert.ok(latestUserMessage);
    assert.equal(latestUserMessage.content, userInput);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
