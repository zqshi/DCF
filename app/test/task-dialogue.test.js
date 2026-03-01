const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTask } = require('../src/domain/services/TaskBootstrapService');

test('task bootstrap fails when no llm dialogue gateway is available', async () => {
  const task = { goal: '你能做什么？', iteration: 1, riskLevel: 'L2' };
  const result = await evaluateTask(task);
  assert.equal(result.status, 'failed');
  assert.equal(result.result, null);
  assert.match(String(result.error && result.error.message || ''), /LLM response unavailable/);
});

test('task reply prefers llm dialogue gateway when available', async () => {
  const task = { goal: '帮我总结今天客服异常', iteration: 1, riskLevel: 'L2' };
  let called = 0;
  const mockGateway = {
    isEnabled: () => true,
    async generateReply(input) {
      called += 1;
      assert.equal(input.goal, task.goal);
      return '我先按异常类型聚合，再给你三段式结论和优先处理建议。';
    }
  };
  const result = await evaluateTask(task, { dialogueGateway: mockGateway });
  assert.equal(result.status, 'succeeded');
  assert.equal(called, 1);
  assert.equal(result.result, '我先按异常类型聚合，再给你三段式结论和优先处理建议。');
});

test('task fails when llm dialogue gateway returns empty text', async () => {
  const task = { goal: '请输出项目复盘模板', iteration: 1, riskLevel: 'L2' };
  const mockGateway = {
    isEnabled: () => true,
    async generateReply() {
      return '';
    }
  };
  const result = await evaluateTask(task, { dialogueGateway: mockGateway });
  assert.equal(result.status, 'failed');
  assert.equal(result.result, null);
  assert.match(String(result.error && result.error.message || ''), /LLM response unavailable/);
});
