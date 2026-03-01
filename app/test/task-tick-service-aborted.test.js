const test = require('node:test');
const assert = require('node:assert/strict');
const { processTaskTick } = require('../src/application/services/TaskTickService');

test('task tick records task.aborted and assistant message when runtime returns aborted', async () => {
  const events = [];
  const traces = [];
  let assistantRecorded = 0;
  const employee = { id: 'emp-1' };
  const task = {
    id: 'task-1',
    employeeId: employee.id,
    status: 'approved',
    goal: 'send a message',
    correction: [],
    corrections: [],
    iteration: 0
  };
  const ctx = {
    store: {
      employees: [employee],
      metrics: { failedTasks: 0, recurrenceErrors: 0, p1Incidents: 0, succeededTasks: 0, skillReused: 0 },
      addEvent(type, payload) {
        events.push({ type, payload });
      }
    },
    prepareTask() {},
    precheckTaskCapabilities() {},
    appendReactTrace(_task, phase, detail) {
      traces.push({ phase, detail });
    },
    executeTask: async () => ({
      status: 'aborted',
      result: null,
      error: { severity: 'P2', message: 'This operation was aborted' },
      corrected: false,
      runtimeTaskId: 'rt-1',
      runtimeEvents: [],
      source: 'openclaw'
    }),
    eventPayload(_task, _employee, extra = {}) {
      return { task_id: task.id, employee_id: employee.id, ...extra };
    },
    recordAssistantMessageForTask() {
      assistantRecorded += 1;
    }
  };

  await processTaskTick(ctx, task);

  assert.equal(task.status, 'aborted');
  assert.equal(assistantRecorded, 1);
  assert.equal(events.some((event) => event.type === 'task.aborted'), true);
  assert.equal(traces.some((item) => item.phase === 'reflect' && item.detail.next === 'task_aborted'), true);
});
