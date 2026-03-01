const test = require('node:test');
const assert = require('node:assert/strict');
const { SkillRuntimeService } = require('../src/application/services/SkillRuntimeService');

test('skill runtime service resolves prioritized skills', () => {
  const service = new SkillRuntimeService({ maxSkills: 3 });
  const skills = [
    { id: 's1', name: 'finance-reconcile', type: 'domain', domain: 'finance', version: '1.2.0', description: 'finance reconcile' },
    { id: 's2', name: 'general-ops', type: 'general', version: '1.0.0', description: 'ops automation' },
    { id: 's3', name: 'invoice-check', type: 'domain', domain: 'finance', version: '1.1.0', description: 'invoice process' }
  ];
  const task = {
    id: 't1',
    goal: 'finance invoice reconcile',
    skillRuntime: { preferredSkills: ['invoice-check'] }
  };
  const employee = { id: 'e1', linkedSkillIds: ['s1'] };
  const selected = service.resolveSkills(task, employee, skills);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].name, 'invoice-check');
  assert.equal(selected.some((x) => x.type === 'domain'), true);
});

test('skill runtime service builds execution envelope', () => {
  const service = new SkillRuntimeService({ defaultTimeoutMs: 15000 });
  const envelope = service.buildExecutionEnvelope(
    { id: 'task-2', goal: 'ops check', riskLevel: 'l3', traceId: 'trace-2' },
    { id: 'emp-2', linkedSkillIds: [] },
    [{ id: 'g1', name: 'general-ops', type: 'general', version: '1.0.0', description: 'ops check' }]
  );
  assert.equal(envelope.engine, 'skills-runtime-v1');
  assert.equal(envelope.taskId, 'task-2');
  assert.equal(envelope.employeeId, 'emp-2');
  assert.equal(envelope.timeoutMs, 15000);
  assert.equal(envelope.metadata.riskLevel, 'L3');
  assert.equal(envelope.selectedSkills.length, 1);
});

