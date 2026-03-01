const test = require('node:test');
const assert = require('node:assert/strict');
const { decideRetrievalStage, resolveSchedulingMode, RETRIEVAL_ORDER } = require('../src/domain/services/RetrievalPolicyService');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

test('retrieval policy defaults to external search with ordered stages', () => {
  const decision = decideRetrievalStage({
    reason: 'task_correction',
    linkedSkillsCount: 0,
    knowledgeCount: 0,
    approvedToolCount: 2
  });
  assert.deepEqual(decision.order, RETRIEVAL_ORDER);
  assert.equal(decision.schedulingMode, 'idle');
  assert.equal(decision.decision, 'external_search');
  assert.equal(decision.rationale, 'realtime_task_correction_prefers_external');
});

test('retrieval policy prefers platform context in idle corrective mode when context is sufficient', () => {
  const decision = decideRetrievalStage({
    reason: 'bootstrap_corrective',
    linkedSkillsCount: 2,
    knowledgeCount: 3,
    approvedToolCount: 1,
    preferredMode: 'idle'
  });
  assert.equal(decision.schedulingMode, 'idle');
  assert.equal(decision.decision, 'platform_context');
  assert.equal(decision.rationale, 'idle_mode_prefers_internal_context');
});

test('retrieval scheduler resolves busy mode from workload', () => {
  const mode = resolveSchedulingMode({
    activeTaskCount: 5,
    queueBacklog: 1
  });
  assert.equal(mode, 'busy');
});

test('task usecase queues external research and emits policy decision event', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Ops', creator: 'u-rp-1', department: 'Ops', role: 'Operator' });
  const task = tuc.create({ employeeId: employee.id, goal: 'Investigate integration SDK options' });

  const queued = tuc.queueOssResearch(employee, task, 'ops sdk');
  assert.ok(queued);
  assert.equal(store.researchQueue.length, 1);
  assert.equal(store.researchQueue[0].query, 'ops sdk');
  const policyEvent = store.events.find((x) => x.type === 'retrieval.policy.decided');
  assert.ok(policyEvent);
  assert.equal(policyEvent.payload.task_id, task.id);
  assert.equal(policyEvent.payload.retrievalDecision, 'external_search');
});

test('task usecase skips external research when policy selects non-external stage', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store, null, null, {
    retrievalPolicy: {
      decide() {
        return {
          order: RETRIEVAL_ORDER.slice(),
          schedulingMode: 'idle',
          decision: 'platform_context',
          rationale: 'forced_for_test',
          metrics: {
            linkedSkillsCount: 2,
            knowledgeCount: 3,
            approvedToolCount: 0
          }
        };
      }
    }
  });
  const employee = euc.create({ name: 'Ops', creator: 'u-rp-2', department: 'Ops', role: 'Operator' });
  employee.linkedSkillIds.push('skill-a', 'skill-b');
  employee.knowledge.push({ id: 'k1' }, { id: 'k2' }, { id: 'k3' });
  const task = tuc.create({ employeeId: employee.id, goal: '复盘历史问题并给出治理建议' });

  const queued = tuc.queueOssResearch(employee, task);
  assert.equal(queued, null);
  assert.equal(store.researchQueue.length, 0);
  const skipEvent = store.events.find((x) => x.type === 'oss.research.skipped');
  assert.ok(skipEvent);
  assert.equal(skipEvent.payload.task_id, task.id);
  assert.equal(skipEvent.payload.retrievalDecision, 'platform_context');
});

test('task usecase resolves preferredMode with employee-over-platform precedence', () => {
  const store = new InMemoryStore();
  store.retrievalPolicy = { mode: 'busy' };
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Ops3', creator: 'u-rp-3', department: 'Ops', role: 'Operator' });
  euc.updateProfile(employee.id, { retrievalPolicy: { mode: 'idle' } }, 'u-admin-1');
  assert.equal(tuc.getRetrievalPreferredMode(employee), 'idle');

  euc.updateProfile(employee.id, { retrievalPolicy: { mode: 'inherit' } }, 'u-admin-1');
  assert.equal(tuc.getRetrievalPreferredMode(employee), 'busy');
});

test('task capability precheck queues external research when no skill or granted tool', () => {
  const store = new InMemoryStore();
  store.strategyCenter = {
    ...(store.strategyCenter || {}),
    defaultToolScope: []
  };
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Ops4', creator: 'u-rp-4', department: 'Ops', role: 'Operator' });
  const task = tuc.create({ employeeId: employee.id, goal: 'Need SDK integration acceleration' });

  const snapshot = tuc.precheckTaskCapabilities(task, employee);
  assert.ok(snapshot);
  assert.equal(snapshot.hasReusableSkill, false);
  assert.equal(snapshot.hasGrantedTool, false);
  assert.equal(snapshot.queuedResearch, true);
  assert.equal(store.researchQueue.length, 1);

  const policyEvent = store.events.find((x) => x.type === 'retrieval.policy.decided');
  assert.ok(policyEvent);
  assert.equal(policyEvent.payload.reason, 'task_precheck');
});

test('task capability precheck skips external research when employee already has granted tool', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Ops5', creator: 'u-rp-5', department: 'Ops', role: 'Operator' });
  employee.runtimeProfile = {
    ...(employee.runtimeProfile || {}),
    toolScope: ['search']
  };
  employee.openclawProfile = employee.runtimeProfile;
  const task = tuc.create({ employeeId: employee.id, goal: 'Need SDK integration acceleration' });

  const snapshot = tuc.precheckTaskCapabilities(task, employee);
  assert.ok(snapshot);
  assert.equal(snapshot.hasGrantedTool, true);
  assert.equal(snapshot.queuedResearch, false);
  assert.equal(store.researchQueue.length, 0);
});
