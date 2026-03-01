const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { ToolUseCases } = require('../src/application/usecases/ToolUseCases');

test('tool usecases checks mcp health via infrastructure gateway adapter', async () => {
  const store = new InMemoryStore();
  let called = 0;
  let endpointUsed = null;
  const gateway = {
    async check(endpoint) {
      called += 1;
      endpointUsed = endpoint;
      return {
        status: 'healthy',
        checkedAt: '2026-02-23T00:00:00.000Z',
        latencyMs: 12,
        httpStatus: 200,
        error: ''
      };
    }
  };
  const uc = new ToolUseCases(store, { healthGateway: gateway });
  const created = uc.createMcpService({
    name: 'Check Endpoint',
    endpoint: 'http://127.0.0.1:9191/mcp',
    transport: 'http'
  });

  const checked = await uc.checkMcpServiceHealth(created.id);
  assert.equal(called, 1);
  assert.equal(endpointUsed, 'http://127.0.0.1:9191/mcp');
  assert.equal(checked.id, created.id);
  assert.equal(checked.health.status, 'healthy');
  assert.equal(checked.health.httpStatus, 200);
});

test('tool usecases default runtime mcp endpoint uses 8092 baseline', () => {
  const store = new InMemoryStore();
  const uc = new ToolUseCases(store, {});
  const rows = uc.listMcpServices();
  const runtime = rows.find((x) => x.id === 'mcp-openclaw-runtime');
  assert.equal(Boolean(runtime), true);
  assert.equal(runtime.endpoint, 'http://127.0.0.1:8092/mcp');
});
