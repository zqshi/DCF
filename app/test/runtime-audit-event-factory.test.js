const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeAuditEvent } = require('../src/shared/runtime/RuntimeAuditEventFactory');

test('runtime audit event factory injects required audit fields', () => {
  const event = createRuntimeAuditEvent({
    taskId: 'task-1',
    traceId: 'trace-1',
    employeeId: 'emp-1',
    type: 'task.running',
    source: 'self-hosted',
    payload: { message: 'running' }
  });
  assert.equal(event.taskId, 'task-1');
  assert.equal(event.type, 'task.running');
  assert.equal(event.source, 'self-hosted');
  assert.equal(event.payload.trace_id, 'trace-1');
  assert.equal(event.payload.task_id, 'task-1');
  assert.equal(event.payload.employee_id, 'emp-1');
  assert.equal(typeof event.payload.timestamp, 'string');
});

