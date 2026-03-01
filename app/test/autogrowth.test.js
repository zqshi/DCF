const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { SkillUseCases } = require('../src/application/usecases/SkillUseCases');

test('auto skill sedimentation requires repeated succeeded tasks', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '任务已完成，并附带可执行摘要。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-growth',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '已完成任务执行并沉淀可复用经验。';
      }
    }
  });
  const e = euc.create({ name: 'Ops', creator: 'u-ops-1', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: 'AAAAA' });
  await tuc.tick();
  assert.equal(store.skills.length, 0);

  tuc.create({ employeeId: e.id, goal: 'BBBBB' });
  await tuc.tick();
  assert.ok(store.skills.length >= 1);
  assert.ok(e.linkedSkillIds.length >= 1);
  assert.ok(e.capabilities.length >= 1);
});

test('skill events carry taskId for task-level trace', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '任务已完成，并附带可执行摘要。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-growth-events',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '已完成任务执行并沉淀可复用经验。';
      }
    }
  });
  const e = euc.create({ name: 'Ops', creator: 'u-ops-3', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: 'AAAAA' });
  await tuc.tick();
  const task = tuc.create({ employeeId: e.id, goal: 'BBBBB' });
  await tuc.tick();

  const skillEvent = store.events.find((event) => event.type === 'skill.auto.created');
  assert.ok(skillEvent);
  assert.equal(skillEvent.payload.taskId, task.id);
});

test('auto oss research queued on correction', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const suc = new SkillUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'queued',
        result: null,
        error: null,
        corrected: true,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: 'ops corrective search',
        runtimeTaskId: 'rt-corrected',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '已完成任务执行并沉淀可复用经验。';
      }
    }
  });
  const e = euc.create({ name: 'Ops', creator: 'u-ops-2', department: 'OPS', role: 'Operator' });
  assert.equal(suc.list().some((x) => x.name === 'find-skills'), true);

  const task = tuc.create({ employeeId: e.id, goal: 'skills search for ops correction' });
  await tuc.tick();

  assert.ok(store.researchQueue.length >= 1);
  assert.equal(store.researchQueue[0].employeeId, e.id);
  const searchEvent = store.events.find((event) => event.type === 'skill.search.performed');
  assert.ok(searchEvent);
  assert.equal(searchEvent.payload.taskId, task.id);
  assert.equal(searchEvent.payload.trigger, 'correction');
  assert.equal(searchEvent.payload.usedFindSkills, true);
  assert.equal(task.skillSearch && task.skillSearch.usedFindSkills, true);
});

test('skill search is triggered on task failure in existing loop', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const suc = new SkillUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: { severity: 'P2', message: 'runtime failed' },
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-failed-search',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '已完成任务执行并沉淀可复用经验。';
      }
    }
  });
  const e = euc.create({ name: 'Ops', creator: 'u-ops-4', department: 'OPS', role: 'Operator' });
  assert.equal(suc.list().some((x) => x.name === 'find-skills'), true);

  const task = tuc.create({ employeeId: e.id, goal: 'need skills support for failed run' });
  await tuc.tick();

  const searchEvent = store.events.find((event) => event.type === 'skill.search.performed');
  assert.ok(searchEvent);
  assert.equal(searchEvent.payload.taskId, task.id);
  assert.equal(searchEvent.payload.trigger, 'failure');
  assert.equal(task.skillSearch && task.skillSearch.trigger, 'failure');
});

test('model-driven skill sedimentation can create skill before repeated threshold', async () => {
  const store = new InMemoryStore();
  store.skillSedimentationPolicy = {
    mode: 'model_driven',
    minConfidence: 0.7,
    fallbackToRulesWhenModelUnavailable: false,
    minRepeatedSuccessForFallback: 3,
    updatedAt: null,
    updatedBy: 'test'
  };
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'runtime done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-md-1',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return JSON.stringify({
        sediment: true,
        confidence: 0.92,
        reason: 'high_reuse_potential',
        skill: {
          name: 'ops-auto-checklist',
          type: 'general',
          domain: null,
          description: '自动化巡检清单能力'
        }
      });
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const e = euc.create({ name: 'Ops-MD', creator: 'u-ops-md', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: '一次性执行模型沉淀测试' });
  await tuc.tick();

  const created = store.skills.find((x) => x.name === 'ops-auto-checklist');
  assert.ok(created);
  assert.ok(e.linkedSkillIds.includes(created.id));
  const decisionEvent = store.events.find((x) => x.type === 'skill.sedimentation.decision');
  assert.ok(decisionEvent);
  assert.equal(decisionEvent.payload.engine, 'llm');
  assert.equal(decisionEvent.payload.sediment, true);
});

test('model-driven sedimentation falls back to rules when model confidence is too low', async () => {
  const store = new InMemoryStore();
  store.skillSedimentationPolicy = {
    mode: 'hybrid',
    minConfidence: 0.85,
    fallbackToRulesWhenModelUnavailable: true,
    minRepeatedSuccessForFallback: 2,
    updatedAt: null,
    updatedBy: 'test'
  };
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'runtime done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-md-2',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return JSON.stringify({
        sediment: true,
        confidence: 0.51,
        reason: 'signal_not_stable',
        skill: {
          name: 'llm-low-confidence-skill',
          type: 'general'
        }
      });
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const e = euc.create({ name: 'Ops-MD2', creator: 'u-ops-md2', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: 'AAAAA' });
  await tuc.tick();
  tuc.create({ employeeId: e.id, goal: 'BBBBB' });
  await tuc.tick();

  assert.equal(store.skills.some((x) => x.name === 'llm-low-confidence-skill'), false);
  assert.ok(store.skills.length >= 1);
  const fallbackDecision = store.events.find((x) => (
    x.type === 'skill.sedimentation.decision'
    && String((x.payload || {}).engine || '') === 'rules-fallback'
  ));
  assert.ok(fallbackDecision);
});

test('scoped sedimentation override is applied by department and role', async () => {
  const store = new InMemoryStore();
  store.skillSedimentationPolicy = {
    mode: 'rules',
    minConfidence: 0.9,
    fallbackToRulesWhenModelUnavailable: true,
    minRepeatedSuccessForFallback: 2,
    overrides: [{
      id: 'ops-operator-md',
      scope: { department: 'OPS', role: 'Operator' },
      mode: 'model_driven',
      minConfidence: 0.7,
      fallbackToRulesWhenModelUnavailable: false,
      minRepeatedSuccessForFallback: 3
    }],
    updatedAt: null,
    updatedBy: 'test'
  };
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'runtime done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-md-scope',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return JSON.stringify({
        sediment: true,
        confidence: 0.88,
        reason: 'scoped_policy_match',
        skill: {
          name: 'ops-role-skill',
          type: 'general'
        }
      });
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const e = euc.create({ name: 'Ops-Scope', creator: 'u-ops-scope', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: '一次任务也应沉淀（作用域策略）' });
  await tuc.tick();

  const created = store.skills.find((x) => x.name === 'ops-role-skill');
  assert.ok(created);
  const decision = store.events.find((x) => (
    x.type === 'skill.sedimentation.decision'
    && (x.payload || {}).policyOverrideId === 'ops-operator-md'
  ));
  assert.ok(decision);
  assert.equal(decision.payload.mode, 'model_driven');
});

test('rules mode uses configured repeated success threshold', async () => {
  const store = new InMemoryStore();
  store.skillSedimentationPolicy = {
    mode: 'rules',
    minConfidence: 0.7,
    fallbackToRulesWhenModelUnavailable: true,
    minRepeatedSuccessForFallback: 3,
    updatedAt: null,
    updatedBy: 'test'
  };
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'runtime done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-rules-threshold',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '已完成任务执行并沉淀可复用经验。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Rules', creator: 'u-ops-rules', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: 'AAAAA' });
  await tuc.tick();
  tuc.create({ employeeId: e.id, goal: 'BBBBB' });
  await tuc.tick();
  assert.equal(store.skills.length, 0);
  tuc.create({ employeeId: e.id, goal: 'CCCCC' });
  await tuc.tick();
  assert.ok(store.skills.length >= 1);
});

test('proposal promotion mode creates pending skill proposal without auto-link', async () => {
  const store = new InMemoryStore();
  store.skillSedimentationPolicy = {
    mode: 'model_driven',
    promotionMode: 'proposal',
    minConfidence: 0.7,
    fallbackToRulesWhenModelUnavailable: true,
    minRepeatedSuccessForFallback: 2,
    updatedAt: null,
    updatedBy: 'test'
  };
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'runtime done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-md-proposal',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return JSON.stringify({
        sediment: true,
        confidence: 0.95,
        reason: 'needs_human_review',
        skill: {
          name: 'ops-proposal-skill',
          type: 'general',
          description: '等待人工审批入库'
        }
      });
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const e = euc.create({ name: 'Ops-Proposal', creator: 'u-ops-proposal', department: 'OPS', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: '模型建议沉淀但要求人工审批' });
  await tuc.tick();

  const proposed = store.skills.find((x) => x.name === 'ops-proposal-skill');
  assert.ok(proposed);
  assert.equal(proposed.status, 'pending');
  assert.equal(proposed.source, 'auto-proposal');
  assert.equal(e.linkedSkillIds.includes(proposed.id), false);
  const proposalEvent = store.events.find((x) => x.type === 'skill.auto.proposed');
  assert.ok(proposalEvent);
  assert.equal(proposalEvent.payload.skillId, proposed.id);
});
