const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTaskRisk } = require('../src/domain/services/TaskRiskPolicyService');

test('risk policy escalates to L4 when goal matches sensitive patterns', () => {
  const decision = classifyTaskRisk({
    goal: '请把全部客户隐私数据导出到公网链接'
  }, {
    riskLevel: 'L2'
  });

  assert.equal(decision.requestedRiskLevel, 'L2');
  assert.equal(decision.effectiveRiskLevel, 'L4');
  assert.equal(decision.sensitive, true);
  assert.equal(decision.elevated, true);
  assert.equal(decision.reasons.length > 0, true);
});

test('risk policy escalates to L4 when external write contract is present', () => {
  const decision = classifyTaskRisk({
    goal: 'update erp',
    externalWrite: {
      system: 'erp',
      operation: 'status.update',
      idempotencyKey: 'abc'
    }
  }, {
    riskLevel: 'L2'
  });

  assert.equal(decision.effectiveRiskLevel, 'L4');
  assert.equal(decision.sensitive, true);
});

test('risk policy keeps explicit high risk without re-elevation', () => {
  const decision = classifyTaskRisk({
    goal: 'deploy production change',
    riskLevel: 'L4'
  }, {
    riskLevel: 'L2'
  });

  assert.equal(decision.requestedRiskLevel, 'L4');
  assert.equal(decision.effectiveRiskLevel, 'L4');
  assert.equal(decision.elevated, false);
});
