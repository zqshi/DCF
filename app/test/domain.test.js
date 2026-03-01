const test = require('node:test');
const assert = require('node:assert/strict');
const { createSkill } = require('../src/domain/entities/Skill');
const { evaluateTask } = require('../src/domain/services/TaskBootstrapService');
const {
  createCycleSnapshot,
  evaluateBootstrapGate,
  nextPhase
} = require('../src/domain/services/BootstrapCycleService');

test('domain skill validation', () => {
  assert.throws(() => createSkill({ name: 'A', type: 'domain' }), /domain is required/);
  const skill = createSkill({ name: 'HR Policy QA', type: 'domain', domain: 'hr' });
  assert.equal(skill.type, 'domain');
  assert.equal(skill.domain, 'hr');
});

test('task bootstrap correction loop', async () => {
  const task = { goal: 'abc', iteration: 1, riskLevel: 'L2' };
  const result = await evaluateTask(task);
  assert.ok(['succeeded', 'queued', 'failed'].includes(result.status));
});

test('bootstrap gate passes with threshold-compliant metrics', () => {
  const previous = createCycleSnapshot({
    totalTasks: 10,
    succeededTasks: 8,
    failedTasks: 2,
    recurrenceErrors: 2,
    skillReused: 3,
    p1Incidents: 0
  }, 'S0');
  const current = createCycleSnapshot({
    totalTasks: 12,
    succeededTasks: 11,
    failedTasks: 1,
    recurrenceErrors: 1,
    skillReused: 4,
    p1Incidents: 0
  }, 'S0');
  const gate = evaluateBootstrapGate(current, previous);
  assert.equal(gate.passed, true);
});

test('bootstrap phase transition caps at S3', () => {
  assert.equal(nextPhase('S0'), 'S1');
  assert.equal(nextPhase('S3'), 'S3');
});
