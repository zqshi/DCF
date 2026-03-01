const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

test('p1 failure triggers automatic rollback', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: { severity: 'P1', message: 'high risk failure' },
        corrected: false,
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const e = euc.create({ name: 'Ops', creator: 'u-gov-1', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Critical flow', riskLevel: 'L2' });

  await tuc.tick();
  assert.equal(t.status, 'rolled_back');
  assert.equal(store.metrics.p1Incidents, 1);
  assert.ok(t.rollback);
  assert.equal(t.rollback.mode, 'auto');
  assert.ok(t.rollback.evidence.triggerEventId);
  assert.ok(t.rollback.evidence.triggerEventHash);
});

test('p1 failure does not rollback when recovery chain is disabled', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: { severity: 'P1', message: 'high risk failure' },
        corrected: false,
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    recoveryChainEnabled: false
  });
  const e = euc.create({ name: 'Ops', creator: 'u-gov-2', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Critical flow no rollback', riskLevel: 'L2' });

  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.equal(store.metrics.p1Incidents, 1);
  assert.equal(Boolean(t.rollback), false);
  const skipped = store.events.find((event) => (
    event.type === 'task.rollback.skipped'
    && (event.payload || {}).task_id === t.id
  ));
  assert.ok(skipped);
});

test('audit event payload contains normalized audit fields', () => {
  const store = new InMemoryStore();
  store.addEvent('demo', { taskId: 't1', traceId: 'tr1', employeeId: 'e1', parentAgentId: 'p1' });
  const event = store.events[0];
  assert.equal(event.payload.task_id, 't1');
  assert.equal(event.payload.trace_id, 'tr1');
  assert.equal(event.payload.employee_id, 'e1');
  assert.equal(event.payload.parent_agent_id, 'p1');
  const verify = store.verifyAuditChain();
  assert.equal(verify.ok, true);
});

test('audit chain detects tampering', () => {
  const store = new InMemoryStore();
  store.addEvent('demo', { taskId: 't1', traceId: 'tr1', employeeId: 'e1' });
  store.addEvent('demo2', { taskId: 't2', traceId: 'tr2', employeeId: 'e1' });
  store.events[0].payload.task_id = 'tampered';
  const verify = store.verifyAuditChain();
  assert.equal(verify.ok, false);
});

test('audit anchor can be created and verified', () => {
  const store = new InMemoryStore();
  store.addEvent('demo', { taskId: 't1', traceId: 'tr1', employeeId: 'e1' });
  const anchor = store.createAuditAnchor('u-admin', 'release checkpoint');
  assert.ok(anchor.signature);
  const verify = store.verifyLatestAnchor();
  assert.equal(verify.ok, true);
  assert.equal(verify.anchored, true);
});

test('events are assigned increasing sequence numbers', () => {
  const store = new InMemoryStore();
  const e1 = store.addEvent('a', { taskId: 't1' });
  const e2 = store.addEvent('b', { taskId: 't1' });
  assert.equal(typeof e1.seq, 'number');
  assert.equal(typeof e2.seq, 'number');
  assert.equal(e2.seq > e1.seq, true);
});

test('action-required task fails when runtime evidence is not confirmed', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask() {
      return {
        status: 'succeeded',
        result: '好的，邮件已发送。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-no-proof',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const e = euc.create({ name: 'Ops-Proof', creator: 'u-proof-1', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '请发邮件通知值班同事' });

  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.match(String((t.lastError || {}).message || ''), /Execution evidence unavailable/i);
  const unproven = store.events.find((event) => (
    event.type === 'task.execution.unproven'
    && (event.payload || {}).task_id === t.id
  ));
  assert.ok(unproven);
});

test('chat-only task can succeed without confirmed runtime evidence', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask() {
      return {
        status: 'succeeded',
        result: '我是 Contract Tester，负责处理你的任务。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-chat-only',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const e = euc.create({ name: 'Contract Tester', creator: 'u-proof-2', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你是谁？' });

  await tuc.tick();
  assert.equal(t.status, 'succeeded');
  assert.equal(String(t.result || '').includes('Contract Tester'), true);
});
