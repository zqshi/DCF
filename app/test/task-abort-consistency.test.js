const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');

function makeEmployee() {
  return {
    id: 'emp-abort-1',
    tenantId: 'tenant-1',
    accountId: 'acct-1',
    name: 'Abort Employee',
    employeeCode: 'DE-ABORT-1'
  };
}

function makeTask(status = 'running') {
  return {
    id: 'task-abort-1',
    taskId: 'task-abort-1',
    traceId: 'trace-abort-1',
    employeeId: 'emp-abort-1',
    tenantId: 'tenant-1',
    accountId: 'acct-1',
    parentAgentId: 'emp-abort-1',
    conversationId: 'conv-abort-1',
    goal: 'abort consistency check',
    riskLevel: 'L2',
    status,
    runtime: {
      taskId: 'rt-abort-1',
      source: 'openclaw',
      events: []
    },
    updatedAt: new Date().toISOString()
  };
}

test('task abort updates local state only after runtime abort succeeds', async () => {
  const store = new InMemoryStore();
  const employee = makeEmployee();
  const task = makeTask('running');
  store.employees.push(employee);
  store.tasks.push(task);

  const executionGateway = {
    async abortTask() {
      return { ok: true, status: 'aborted', runtimeTaskId: 'rt-abort-1' };
    }
  };
  const uc = new TaskUseCases(store, executionGateway, null);
  const result = await uc.abort(task.id);
  assert.equal(result.status, 'aborted');
  assert.equal(store.events.some((event) => event.type === 'runtime.task.abort.synced'), true);
  assert.equal(store.events.some((event) => event.type === 'task.aborted'), true);
});

test('task abort keeps local running state when runtime abort fails', async () => {
  const store = new InMemoryStore();
  const employee = makeEmployee();
  const task = makeTask('running');
  store.employees.push(employee);
  store.tasks.push(task);

  const executionGateway = {
    async abortTask() {
      return {
        ok: false,
        statusCode: 409,
        code: 'RUNTIME_ABORT_FAILED',
        message: 'runtime refused abort'
      };
    }
  };
  const uc = new TaskUseCases(store, executionGateway, null);
  await assert.rejects(
    () => uc.abort(task.id),
    /runtime refused abort/
  );
  assert.equal(task.status, 'running');
  assert.equal(store.events.some((event) => event.type === 'task.aborted'), false);
});

test('task abort does not require runtime call for pending task without runtimeTaskId', async () => {
  const store = new InMemoryStore();
  const employee = makeEmployee();
  const task = makeTask('pending');
  task.runtime = { taskId: null, source: 'openclaw', events: [] };
  store.employees.push(employee);
  store.tasks.push(task);

  let abortCalls = 0;
  const executionGateway = {
    async abortTask() {
      abortCalls += 1;
      return { ok: true, status: 'aborted', runtimeTaskId: 'rt-abort-1' };
    }
  };
  const uc = new TaskUseCases(store, executionGateway, null);
  const result = await uc.abort(task.id);
  assert.equal(result.status, 'aborted');
  assert.equal(abortCalls, 0);
});
