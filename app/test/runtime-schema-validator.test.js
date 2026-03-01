const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRuntimeSubmit,
  validateRuntimeStatus,
  validateRuntimeEvent,
  normalizeRuntimeStatus,
  normalizeRuntimeEvent
} = require('../src/shared/runtime/RuntimeSchemaValidator');

test('runtime schema validator validates submit payload', () => {
  assert.equal(validateRuntimeSubmit({
    taskId: 't-1',
    goal: 'run',
    riskLevel: 'L2',
    toolScope: ['read', 'write']
  }, { strict: true }), true);
  assert.throws(() => validateRuntimeSubmit({ goal: '', riskLevel: 'L2' }, { strict: true }), /task.goal is required/);
  assert.throws(() => validateRuntimeSubmit({ goal: 'x', riskLevel: 'L9' }, { strict: true }), /riskLevel/);
});

test('runtime schema validator normalizes and validates status payload', () => {
  const status = normalizeRuntimeStatus({ status: 'running' }, 'rt-1');
  assert.equal(status.taskId, 'rt-1');
  assert.equal(status.status, 'running');
  assert.equal(validateRuntimeStatus(status), true);
  assert.throws(() => validateRuntimeStatus({ taskId: 'rt-1', status: 'bad' }), /runtime status is invalid/);
});

test('runtime schema validator normalizes and validates event payload', () => {
  const event = normalizeRuntimeEvent({ type: 'task.running', payload: {} }, 'rt-1');
  assert.equal(event.taskId, 'rt-1');
  assert.equal(event.type, 'task.running');
  assert.equal(validateRuntimeEvent(event), true);
  const skillsEvent = normalizeRuntimeEvent({ type: 'task.running', taskId: 'rt-2', source: 'skills_runtime' });
  assert.equal(skillsEvent.source, 'skills-runtime');
  assert.throws(() => validateRuntimeEvent({ type: '', taskId: 'rt-1' }, { strict: true }), /runtime event type is required/);
});
