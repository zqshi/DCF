const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function loginAndCookie(base) {
  const login = await requestJson(base, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('front dispatch routes action intent to task creation', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base);

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-dispatch-${runId}`,
        name: 'Front Dispatch',
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
        title: 'dispatch-action'
      })
    });
    assert.equal(conversation.status, 201);

    const dispatch = await requestJson(base, '/api/front/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        text: '请帮我生成今日运营日报'
      })
    });
    assert.equal(dispatch.status, 200);
    assert.equal(dispatch.body.mode, 'action');
    assert.equal(dispatch.body.intent, 'action');
    assert.equal(Boolean((((dispatch.body || {}).task || {}).llmConfig || {}).requireRealLlm), true);
    assert.equal(Boolean((((dispatch.body || {}).task || {}).llmConfig || {}).requireRuntimeExecution), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front dispatch treats follow-up execution phrase as action task', async () => {
  const keyBackup = process.env.OPENAI_API_KEY;
  const llmKeyBackup = process.env.LLM_API_KEY;
  process.env.OPENAI_API_KEY = '';
  process.env.LLM_API_KEY = '';
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base);

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-dispatch-followup-${runId}`,
        name: 'Front Dispatch Followup',
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
        title: 'dispatch-followup'
      })
    });
    assert.equal(conversation.status, 201);

    const dispatch = await requestJson(base, '/api/front/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        text: '发到当前会话即可'
      })
    });
    assert.equal(dispatch.status, 200);
    assert.equal(dispatch.body.mode, 'action');
    assert.equal(dispatch.body.intent, 'action');
  } finally {
    process.env.OPENAI_API_KEY = keyBackup;
    process.env.LLM_API_KEY = llmKeyBackup;
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front dispatch still creates action task when llm api key is unavailable', async () => {
  const keyBackup = process.env.OPENAI_API_KEY;
  const llmKeyBackup = process.env.LLM_API_KEY;
  process.env.OPENAI_API_KEY = '';
  process.env.LLM_API_KEY = '';

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base);

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-dispatch-chat-${runId}`,
        name: 'Front Dispatch Chat',
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
        title: 'dispatch-chat'
      })
    });
    assert.equal(conversation.status, 201);

    const dispatch = await requestJson(base, '/api/front/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        text: '你是谁？'
      })
    });
    assert.equal(dispatch.status, 200);
    assert.equal(dispatch.body.mode, 'action');
    assert.equal(dispatch.body.intent, 'action');
  } finally {
    process.env.OPENAI_API_KEY = keyBackup;
    process.env.LLM_API_KEY = llmKeyBackup;
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front dispatch preserves image attachments in created task', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base);

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-dispatch-attachments-${runId}`,
        name: 'Front Dispatch Attachment',
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
        title: 'dispatch-attachments'
      })
    });
    assert.equal(conversation.status, 201);

    const dispatch = await requestJson(base, '/api/front/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        text: '请结合附件截图做处理',
        attachments: [{
          type: 'image',
          name: 'capture.png',
          mimeType: 'image/png',
          content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
        }]
      })
    });
    assert.equal(dispatch.status, 200);
    assert.equal(Array.isArray(((dispatch.body || {}).task || {}).attachments), true);
    assert.equal(dispatch.body.task.attachments.length, 1);
    assert.equal(dispatch.body.task.attachments[0].type, 'image');
    assert.equal(dispatch.body.task.attachments[0].mimeType, 'image/png');
    assert.equal(dispatch.body.task.attachments[0].name, 'capture.png');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front dispatch preserves pdf attachments in created task', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const cookie = await loginAndCookie(base);

    const employee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        creator: `u-front-dispatch-pdf-${runId}`,
        name: 'Front Dispatch Pdf Attachment',
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
        title: 'dispatch-attachments-pdf'
      })
    });
    assert.equal(conversation.status, 201);

    const dispatch = await requestJson(base, '/api/front/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        employeeId: employee.body.id,
        conversationId: conversation.body.id,
        text: '请参考附件文档',
        attachments: [{
          type: 'file',
          name: 'brief.pdf',
          mimeType: 'application/pdf',
          content: 'JVBERi0xLjQKJcTl8uXrp'
        }]
      })
    });
    assert.equal(dispatch.status, 200);
    assert.equal(Array.isArray(((dispatch.body || {}).task || {}).attachments), true);
    assert.equal(dispatch.body.task.attachments.length, 1);
    assert.equal(dispatch.body.task.attachments[0].type, 'file');
    assert.equal(dispatch.body.task.attachments[0].mimeType, 'application/pdf');
    assert.equal(dispatch.body.task.attachments[0].name, 'brief.pdf');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
