const test = require('node:test');
const assert = require('node:assert/strict');
const { SkillsRuntimeGateway } = require('../src/infrastructure/integrations/SkillsRuntimeGateway');

test('skills runtime gateway can be disabled', async () => {
  const gw = new SkillsRuntimeGateway({ enabled: false });
  assert.equal(gw.isEnabled(), false);
  const result = await gw.executeTask({ id: 't1', goal: 'x' }, { id: 'e1' });
  assert.equal(result, null);
});

test('skills runtime gateway executes with selected skills and audit events', async () => {
  const gw = new SkillsRuntimeGateway({
    enabled: true,
    getAvailableSkills: () => ([
      { id: 's1', name: 'finance-reconcile', type: 'domain', domain: 'finance', version: '1.0.0', description: 'finance reconcile' },
      { id: 's2', name: 'general-ops', type: 'general', version: '1.0.0', description: 'ops runbook' }
    ])
  });
  const result = await gw.executeTask(
    { id: 't2', traceId: 'trace-t2', goal: 'finance reconcile settlement' },
    { id: 'e2', linkedSkillIds: ['s1'] }
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.source, 'skills-runtime');
  assert.equal(result.skills.length >= 1, true);
  assert.equal(result.runtimeEvents.length >= 2, true);
  const ev = result.runtimeEvents[0];
  assert.equal(ev.source, 'skills-runtime');
  assert.equal(ev.payload.trace_id, 'trace-t2');
  assert.equal(ev.payload.task_id, 't2');
  assert.equal(ev.payload.employee_id, 'e2');
});
