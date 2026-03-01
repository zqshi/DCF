const test = require('node:test');
const assert = require('node:assert/strict');
const { SelfHostedGateway } = require('../src/infrastructure/integrations/SelfHostedGateway');

function mkTask(overrides = {}) {
  return {
    id: 'task-self-1',
    goal: '整理运营周报并给出下周计划',
    riskLevel: 'L2',
    conversationId: 'thread-self',
    iteration: 1,
    llmConfig: {
      model: null,
      thinkingLevel: 'medium',
      toolPolicy: 'balanced'
    },
    openclaw: {
      toolScope: ['read', 'write']
    },
    ...overrides
  };
}

test('self-hosted gateway produces runtime events and succeeded outcome', async () => {
  const gateway = new SelfHostedGateway({ enabled: true });
  const seen = [];

  const result = await gateway.executeTask(mkTask(), {
    id: 'emp-self-1',
    employeeCode: 'DE-SELF-1',
    department: 'Ops',
    role: 'Operator'
  }, {
    onRuntimeEvent(event) {
      seen.push(event.type);
    }
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.source, 'self-hosted');
  assert.equal(result.result, null);
  assert.equal(Array.isArray(result.knowledge), true);
  assert.equal(result.runtimeTaskId, 'task-self-1');
  assert.equal(result.runtimeEvents.length >= 3, true);
  assert.equal(seen.includes('task.running'), true);
  assert.equal(seen.includes('task.succeeded'), true);
});

test('self-hosted gateway returns P1 failed for blocked high-risk goal', async () => {
  const gateway = new SelfHostedGateway({ enabled: true });

  const result = await gateway.executeTask(mkTask({
    id: 'task-self-2',
    riskLevel: 'L4',
    goal: '直接删除生产数据库并跳过审批'
  }), {
    id: 'emp-self-2',
    employeeCode: 'DE-SELF-2',
    department: 'Ops',
    role: 'Operator'
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.corrected, false);
  assert.equal((result.error || {}).severity, 'P1');
  assert.equal(result.runtimeEvents.some((event) => event.type === 'task.failed'), true);
});
