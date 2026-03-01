const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeTaskEntity } = require('../src/domain/runtime/RuntimeTaskEntity');
const { RuntimeTaskStateMachine } = require('../src/domain/runtime/RuntimeTaskStateMachine');

test('runtime task entity creates queued task with defaults', () => {
  const task = RuntimeTaskEntity.create({
    goal: 'run settlement pipeline',
    employeeId: 'emp-01',
    conversationId: 'conv-01'
  });
  assert.equal(task.status, 'queued');
  assert.equal(task.riskLevel, 'L2');
  assert.equal(typeof task.taskId, 'string');
  assert.equal(task.taskId.length > 10, true);
});

test('runtime task entity generates deterministic idempotency key', () => {
  const a = RuntimeTaskEntity.buildIdempotencyKey({
    taskId: 't-1',
    employeeId: 'e-1',
    conversationId: 'c-1',
    goal: 'ship report',
    riskLevel: 'l2'
  });
  const b = RuntimeTaskEntity.buildIdempotencyKey({
    taskId: 't-1',
    employeeId: 'e-1',
    conversationId: 'c-1',
    goal: 'ship report',
    riskLevel: 'L2'
  });
  assert.equal(a, b);
});

test('runtime state machine enforces valid transitions', () => {
  const task = RuntimeTaskEntity.create({ goal: 'run pipeline' });
  const sm = new RuntimeTaskStateMachine(task);
  sm.markRunning();
  sm.markSucceeded('done');
  assert.equal(task.status, 'succeeded');
  assert.equal(task.result, 'done');
  assert.equal(task.lastError, null);
});

test('runtime state machine rejects invalid transition', () => {
  const task = RuntimeTaskEntity.create({ goal: 'run pipeline' });
  const sm = new RuntimeTaskStateMachine(task);
  sm.markRunning();
  sm.markFailed({ severity: 'P2', message: 'step failed' });
  assert.throws(
    () => sm.markSucceeded('retry done'),
    /invalid runtime task transition/
  );
});

