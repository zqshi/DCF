const test = require('node:test');
const assert = require('node:assert/strict');
const { detectRuntimeExecutionEvidence } = require('../src/application/services/RuntimeEvidenceService');

test('runtime evidence confirms shell execution with alias fields and fallback runtime task id', () => {
  const evidence = detectRuntimeExecutionEvidence(
    { goal: '扫描下载目录并整理' },
    {
      source: 'openclaw',
      runtimeTaskId: '',
      runtimeEvents: [{
        id: 'evt-shell-alias',
        type: 'task.tool.called',
        taskId: 'rt-shell-alias',
        payload: {
          tool: 'bash',
          details: {
            cmd: 'ls -la ~/Downloads',
            exit_code: 0,
            output: 'ok'
          }
        }
      }]
    }
  );
  assert.equal(evidence.verdict, 'confirmed');
  assert.equal(evidence.runtimeTaskId, 'rt-shell-alias');
  assert.equal(evidence.commandCount, 1);
  assert.equal(evidence.exitCodeCount, 1);
  assert.equal(evidence.outputCount, 1);
});

test('runtime evidence confirms delivery execution with snake_case receipt fields', () => {
  const evidence = detectRuntimeExecutionEvidence(
    { goal: '请邮件通知我处理结果' },
    {
      source: 'openclaw',
      runtimeTaskId: 'rt-delivery-alias',
      runtimeEvents: [{
        id: 'evt-delivery-alias',
        type: 'task.tool.called',
        taskId: 'rt-delivery-alias',
        payload: {
          tool_name: 'email',
          status: 'sent',
          success: true,
          details: {
            message_id: 'mail-001'
          }
        }
      }]
    }
  );
  assert.equal(evidence.verdict, 'confirmed');
  assert.equal(evidence.deliveryEventCount, 1);
  assert.equal(evidence.deliverySuccessCount, 1);
  assert.equal(evidence.deliveryReceiptCount, 1);
});

test('runtime evidence marks truly unexecuted task when no runtime id and no runtime events', () => {
  const evidence = detectRuntimeExecutionEvidence(
    { goal: '扫描下载目录' },
    {
      source: 'runtime-required',
      runtimeTaskId: null,
      runtimeEvents: []
    }
  );
  assert.equal(evidence.verdict, 'not_executed');
  assert.equal(evidence.runtimeTaskId, null);
});

