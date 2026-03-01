const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function startServer(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

test('external registry routes require configured token', async () => {
  const previous = process.env.REGISTRY_API_KEYS;
  delete process.env.REGISTRY_API_KEYS;
  const server = await createApp();
  let started = false;

  try {
    await startServer(server);
    started = true;
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const res = await requestJson(base, '/api/registry/tools/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'External Tool',
        endpoint: 'http://127.0.0.1:9000/mcp'
      })
    });
    assert.equal(res.status, 503);
    assert.match(String(res.body.error || ''), /registry is disabled/i);
  } finally {
    await server.shutdown();
    if (started) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    if (typeof previous === 'string') process.env.REGISTRY_API_KEYS = previous;
    else delete process.env.REGISTRY_API_KEYS;
  }
});

test('external registry routes enforce token and create pending registrations', async () => {
  const previous = process.env.REGISTRY_API_KEYS;
  process.env.REGISTRY_API_KEYS = 'reg-key-1';
  const server = await createApp();
  let started = false;

  try {
    await startServer(server);
    started = true;
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const forbidden = await requestJson(base, '/api/registry/skills/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'external-skill-1',
        type: 'general'
      })
    });
    assert.equal(forbidden.status, 401);

    const toolRegistered = await requestJson(base, '/api/registry/tools/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer reg-key-1',
        'X-Registrant-Id': 'erp-sync-bot',
        'X-Source-System': 'erp'
      },
      body: JSON.stringify({
        name: 'ERP MCP Bridge',
        transport: 'http',
        endpoint: 'http://127.0.0.1:9101/mcp',
        description: 'ERP bridge from external registry'
      })
    });
    assert.equal(toolRegistered.status, 202);
    assert.equal(toolRegistered.body.enabled, false);
    assert.equal(toolRegistered.body.registrationStatus, 'pending');
    assert.equal(toolRegistered.body.registrationSource, 'erp');
    assert.equal(toolRegistered.body.registrant, 'erp-sync-bot');

    const skillRegistered = await requestJson(base, '/api/registry/skills/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer reg-key-1',
        'X-Registrant-Id': 'erp-sync-bot',
        'X-Source-System': 'erp'
      },
      body: JSON.stringify({
        name: 'erp-invoice-reconcile',
        type: 'domain',
        domain: 'finance',
        description: 'External skill registration for invoice reconcile'
      })
    });
    assert.equal(skillRegistered.status, 202);
    assert.equal(skillRegistered.body.status, 'pending');
    assert.match(String(skillRegistered.body.source || ''), /external-registry:erp/);
    assert.equal(skillRegistered.body.proposal.proposedBy, 'erp-sync-bot');
  } finally {
    await server.shutdown();
    if (started) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    if (typeof previous === 'string') process.env.REGISTRY_API_KEYS = previous;
    else delete process.env.REGISTRY_API_KEYS;
  }
});
