const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { BootstrapUseCases } = require('../src/application/usecases/BootstrapUseCases');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');

test('bootstrap cycle auto-advances phase when gate passes', () => {
  const store = new InMemoryStore();
  const bootstrapUC = new BootstrapUseCases(store);

  store.metrics.totalTasks = 10;
  store.metrics.succeededTasks = 9;
  store.metrics.failedTasks = 1;
  store.metrics.recurrenceErrors = 1;
  store.metrics.skillReused = 5;
  store.metrics.p1Incidents = 0;

  const status = bootstrapUC.runCycle();
  assert.equal(status.phase, 'S1');
  assert.equal(status.mode, 'auto_advanced');
  assert.equal(status.manualReviewRequired, false);
  assert.equal(status.history.length, 1);
  assert.equal(status.history[0].gate.passed, true);
  assert.equal(status.history[0].gate.checks.successPass, true);
});

test('bootstrap cycle triggers corrective requeue and manual review after stagnation', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const bootstrapUC = new BootstrapUseCases(store);
  const employee = euc.create({ name: 'Ops-Worker', creator: 'u-bootstrap-1', department: 'OPS', role: 'Operator' });

  const failedTask = {
    id: 'task-failed-1',
    employeeId: employee.id,
    employeeName: employee.name,
    conversationId: 'thread-1',
    goal: 'Recover failed workflow',
    riskLevel: 'L4',
    status: 'failed',
    iteration: 3,
    corrections: [],
    result: null,
    lastError: { severity: 'P1', message: 'failure' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.tasks.push(failedTask);

  store.metrics.totalTasks = 4;
  store.metrics.succeededTasks = 2;
  store.metrics.failedTasks = 2;
  store.metrics.recurrenceErrors = 3;
  store.metrics.skillReused = 0;
  store.metrics.p1Incidents = 1;
  bootstrapUC.runCycle();
  assert.equal(failedTask.status, 'pending');

  failedTask.status = 'failed';
  store.metrics.totalTasks = 8;
  store.metrics.succeededTasks = 3;
  store.metrics.failedTasks = 5;
  store.metrics.recurrenceErrors = 7;
  store.metrics.skillReused = 0;
  store.metrics.p1Incidents = 2;
  const status = bootstrapUC.runCycle();

  assert.equal(status.mode, 'corrective');
  assert.equal(status.manualReviewRequired, true);
});

test('bootstrap retrieval decision does not use employee or global preferred mode', () => {
  const store = new InMemoryStore();
  store.retrievalPolicy = { mode: 'busy' };
  const euc = new EmployeeUseCases(store);
  const bootstrapUC = new BootstrapUseCases(store);
  const employee = euc.create({ name: 'Ops-Worker', creator: 'u-bootstrap-2', department: 'OPS', role: 'Operator' });
  euc.updateProfile(employee.id, { retrievalPolicy: { mode: 'idle' } }, 'u-admin');
  const task = { id: 'task-bootstrap-1', goal: 'diagnose' };
  let captured = null;
  bootstrapUC.retrievalPolicy = {
    decide(input) {
      captured = input;
      return {
        order: ['internal_tools', 'platform_context', 'external_search'],
        schedulingMode: 'idle',
        decision: 'external_search',
        rationale: 'test',
        metrics: {}
      };
    }
  };

  bootstrapUC.enqueueResearchForTask(task, employee);
  assert.ok(captured);
  assert.equal(captured.preferredMode, undefined);
});
