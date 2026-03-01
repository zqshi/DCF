const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { captureLoopError } = require('../src/interfaces/http/createApp');

test('background loop errors are captured as audit events', () => {
  const store = new InMemoryStore();
  captureLoopError(store, 'task.tick', new Error('tick failed'));

  const event = store.events.find((item) => item.type === 'runtime.loop.error');
  assert.ok(event);
  assert.equal(event.payload.loopName, 'task.tick');
  assert.equal(event.payload.message, 'tick failed');
  assert.equal(event.payload.trace_id, null);
  assert.equal(event.payload.task_id, null);
  assert.equal(event.payload.employee_id, null);
});
