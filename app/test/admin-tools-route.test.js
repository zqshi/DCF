const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

test('admin tools route supports mcp service list and toggle with rbac', async () => {
  const healthServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => healthServer.listen(0, '127.0.0.1', resolve));
  const healthAddress = healthServer.address();

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const list = await requestJson(base, '/api/admin/tools/mcp-services', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.length > 0);

    const aliasList = await requestJson(base, '/api/admin/tools', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(aliasList.status, 200);
    assert.ok(Array.isArray(aliasList.body));

    const created = await requestJson(base, '/api/admin/tools/mcp-services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({
        name: 'BI Gateway',
        transport: 'http',
        endpoint: `http://127.0.0.1:${healthAddress.port}/mcp`,
        description: 'BI MCP gateway',
        enabled: true
      })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'BI Gateway');
    assert.ok(created.body.id);

    const target = created.body;
    const toggled = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(target.id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ enabled: !target.enabled })
    });
    assert.equal(toggled.status, 200);
    assert.equal(toggled.body.id, target.id);
    assert.equal(toggled.body.enabled, !target.enabled);
    assert.equal(toggled.body.updatedBy, 'skill');

    const updated = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(target.id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({
        name: 'BI Gateway v2',
        endpoint: `http://127.0.0.1:${healthAddress.port}/mcp`,
        description: 'BI MCP gateway updated'
      })
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, 'BI Gateway v2');
    assert.equal(updated.body.endpoint, `http://127.0.0.1:${healthAddress.port}/mcp`);

    const checked = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(target.id)}/check-health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(checked.status, 200);
    assert.ok(checked.body.health);
    assert.equal(checked.body.health.status, 'healthy');

    const events = await requestJson(base, '/api/admin/logs', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(events.status, 200);
    assert.ok(Array.isArray(events.body));
    const toolEvents = events.body.filter((x) => String(x.type || '').startsWith('admin.tools.mcp.'));
    assert.ok(toolEvents.some((x) => x.type === 'admin.tools.mcp.created'));
    assert.ok(toolEvents.some((x) => x.type === 'admin.tools.mcp.health_checked'));
    const createdEvent = toolEvents.find((x) => x.type === 'admin.tools.mcp.created');
    assert.equal(Boolean(createdEvent && createdEvent.payload && createdEvent.payload.actor_id), true);
    assert.equal(Boolean(createdEvent && createdEvent.payload && createdEvent.payload.ip), true);
    assert.equal(createdEvent.payload.audit_module, '工具管理');
    assert.equal(createdEvent.payload.audit_page, '工具资产');
    assert.equal(createdEvent.payload.audit_action, 'tools.mcp.create');
    assert.equal(createdEvent.payload.audit_result, 'succeeded');

    const deleted = await requestJson(base, `/api/admin/tools/mcp-services/${encodeURIComponent(target.id)}/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.id, target.id);

    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const opsForbidden = await requestJson(base, '/api/admin/tools/mcp-services', {
      method: 'GET',
      headers: { Cookie: opsCookie }
    });
    assert.equal(opsForbidden.status, 403);
  } finally {
    await new Promise((resolve, reject) => healthServer.close((error) => (error ? reject(error) : resolve())));
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
