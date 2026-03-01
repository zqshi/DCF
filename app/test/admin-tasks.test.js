const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { AdminUseCases } = require('../src/application/usecases/AdminUseCases');
const { SkillUseCases } = require('../src/application/usecases/SkillUseCases');

test('admin can list tasks and task detail', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const auc = new AdminUseCases(store);

  const e = euc.create({ name: 'Ops', creator: 'u-ops-t', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'AAAAA' });
  await tuc.tick();

  const all = auc.listTasks();
  assert.equal(all.length, 1);
  assert.equal(Boolean(all[0].runtimeConfig && typeof all[0].runtimeConfig === 'object'), true);
  assert.equal(Boolean(all[0].openclaw && typeof all[0].openclaw === 'object'), true);
  const detail = auc.getTaskDetail(t.id);
  assert.equal(detail.id, t.id);
  assert.equal(Boolean(detail.runtimeConfig && typeof detail.runtimeConfig === 'object'), true);
  assert.equal(Boolean(detail.openclaw && typeof detail.openclaw === 'object'), true);
  assert.equal(detail.employee.id, e.id);
  assert.equal(Boolean(detail.employee.runtimeProfile && typeof detail.employee.runtimeProfile === 'object'), true);
  assert.equal(Boolean(detail.employee.openclawProfile && typeof detail.employee.openclawProfile === 'object'), true);
  assert.ok(Array.isArray(detail.logs));
});

test('admin task detail includes runtime contract snapshot when openclaw runtime returns ids/events', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'ok',
        error: null,
        corrected: false,
        runtimeTaskId: 'rt-123',
        runtimeEvents: [{ id: 'e1', type: 'task.running' }, { id: 'e2', type: 'task.succeeded' }],
        source: 'openclaw',
        children: [],
        skills: [],
        knowledge: []
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const auc = new AdminUseCases(store);

  const e = euc.create({ name: 'Ops', creator: 'u-ops-rt', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Runtime contract test' });
  await tuc.tick();

  const detail = auc.getTaskDetail(t.id);
  assert.equal(detail.runtime.taskId, 'rt-123');
  assert.equal(detail.runtime.source, 'openclaw');
  assert.equal(detail.runtime.events.length, 2);
  const rawRuntimeEvents = detail.logs.filter((x) => x.type === 'runtime.raw.event');
  assert.equal(rawRuntimeEvents.length, 2);
  assert.equal(rawRuntimeEvents[0].payload.runtimeType ? true : false, true);
});

test('admin can export rollback replay report by task id', async () => {
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
        error: { severity: 'P2', message: 'simulated failure' },
        corrected: false,
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const auc = new AdminUseCases(store);

  const e = euc.create({ name: 'Ops', creator: 'u-ops-rb', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Rollback replay test' });
  await tuc.tick();
  tuc.rollback(t.id, 'manual drill');

  const report = auc.getRollbackReport({ taskId: t.id });
  assert.equal(report.taskId, t.id);
  assert.equal(report.traceId, t.traceId);
  assert.ok(Array.isArray(report.rollbackEvents));
  assert.ok(Array.isArray(report.timeline));
});

test('admin can export rollback package with manifest hashes', async () => {
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
        error: { severity: 'P2', message: 'simulated failure' },
        corrected: false,
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const auc = new AdminUseCases(store);

  const e = euc.create({ name: 'Ops', creator: 'u-ops-pack', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Rollback package test' });
  await tuc.tick();
  tuc.rollback(t.id, 'manual drill');

  const pkg = auc.getRollbackPackage({ taskId: t.id });
  assert.equal(pkg.report.taskId, t.id);
  assert.ok(pkg.manifest.reportHash);
  assert.ok(pkg.manifest.timelineHash);
  assert.ok(Array.isArray(pkg.timelineHashes));
});

test('runtime raw events are emitted during execution callback without duplication', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask(task, employee, callbacks = {}) {
      callbacks.onRuntimeEvent({
        id: 'ev-cb-1',
        type: 'task.tool.called',
        at: '2026-01-01T00:00:00.000Z',
        payload: { toolName: 'bash', action: 'execute', message: 'running command' }
      }, 'rt-cb-1');
      callbacks.onRuntimeEvent({
        id: 'ev-cb-2',
        type: 'task.message.delta',
        at: '2026-01-01T00:00:00.500Z',
        payload: { action: 'delta', message: 'step output chunk', details: { chunkIndex: 2, done: false } }
      }, 'rt-cb-1');
      callbacks.onRuntimeEvent({
        id: 'ev-cb-3',
        type: 'task.succeeded',
        at: '2026-01-01T00:00:01.000Z',
        payload: { message: 'done' }
      }, 'rt-cb-1');
      return {
        status: 'succeeded',
        result: 'ok',
        error: null,
        corrected: false,
        runtimeTaskId: 'rt-cb-1',
        runtimeEvents: [
          { id: 'ev-cb-1', type: 'task.tool.called' },
          { id: 'ev-cb-2', type: 'task.message.delta' },
          { id: 'ev-cb-3', type: 'task.succeeded' }
        ],
        source: 'openclaw',
        children: [],
        skills: [],
        knowledge: []
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const auc = new AdminUseCases(store);

  const e = euc.create({ name: 'Ops', creator: 'u-ops-cb', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Runtime callback dedupe test' });
  await tuc.tick();

  const detail = auc.getTaskDetail(t.id);
  const rawRuntimeEvents = detail.logs.filter((x) => x.type === 'runtime.raw.event');
  assert.equal(rawRuntimeEvents.length, 3);
  assert.deepEqual(
    rawRuntimeEvents.map((x) => x.payload.runtimeEventId).sort(),
    ['ev-cb-1', 'ev-cb-2', 'ev-cb-3']
  );
  const called = rawRuntimeEvents.find((x) => x.payload.runtimeEventId === 'ev-cb-1');
  assert.equal(called.payload.runtimeToolName, 'bash');
  assert.equal(called.payload.runtimeAction, 'execute');
  assert.equal(called.payload.runtimeMessage, 'running command');
  const delta = rawRuntimeEvents.find((x) => x.payload.runtimeEventId === 'ev-cb-2');
  assert.equal(delta.payload.runtimeAction, 'delta');
  assert.equal(delta.payload.runtimeMessage, 'step output chunk');
  assert.equal(delta.payload.runtimeChunkIndex, 2);
  assert.equal(delta.payload.runtimeDone, false);
});

test('admin task detail includes skill search context when runtime loop triggers find-skills', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const suc = new SkillUseCases(store);
  const executionGateway = {
    isEnabled() {
      return true;
    },
    async executeTask() {
      return {
        status: 'queued',
        result: null,
        error: null,
        corrected: true,
        runtimeTaskId: 'rt-search-1',
        runtimeEvents: [],
        source: 'openclaw',
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: 'skills support for correction'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const auc = new AdminUseCases(store);

  assert.equal(suc.list().some((item) => item.name === 'find-skills'), true);
  const e = euc.create({ name: 'Ops', creator: 'u-ops-search', department: 'OPS', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Need skills support for correction flow' });
  await tuc.tick();

  const detail = auc.getTaskDetail(t.id);
  assert.ok(detail.skillSearch);
  assert.equal(detail.skillSearch.trigger, 'correction');
  assert.equal(detail.skillSearch.usedFindSkills, true);
  assert.ok(Array.isArray(detail.skillSearch.top));
  assert.equal(detail.skillSearch.top.some((item) => item.name === 'find-skills'), true);
  const searchEvents = detail.logs.filter((event) => event.type === 'skill.search.performed');
  assert.equal(searchEvents.length >= 1, true);
});
