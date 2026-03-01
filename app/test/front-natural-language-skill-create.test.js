const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

test('front task mentioning skill creation still goes through runtime execution', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  let calls = 0;
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      calls += 1;
      return {
        status: 'succeeded',
        result: 'runtime handled skill-related request',
        source: 'runtime'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway);
  const employee = euc.create({
    name: 'Ops-Front-Runtime',
    creator: 'u-front-runtime',
    department: 'OPS',
    role: 'Operator'
  });

  const task = tuc.create({
    employeeId: employee.id,
    goal: '请帮我创建一个 skill，名称为 ops-weekly-check'
  });
  await tuc.tick();

  assert.equal(calls, 1);
  assert.equal(task.status, 'succeeded');
  assert.equal(task.result, 'runtime handled skill-related request');
  assert.equal(store.skills.length, 0);
  assert.equal(store.events.some((event) => event.type === 'skill.user.requested'), false);
});

test('dialogue gateway does not shortcut front skill creation intent', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  let runtimeCalls = 0;
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      runtimeCalls += 1;
      return {
        status: 'succeeded',
        result: 'runtime only',
        source: 'runtime'
      };
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return JSON.stringify({
        createSkill: true,
        promotionMode: 'proposal',
        reason: 'should_not_be_used',
        skill: {
          name: 'oss-health-check',
          type: 'general',
          domain: null,
          description: 'should not apply'
        }
      });
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const employee = euc.create({
    name: 'Ops-Front-NoShortcut',
    creator: 'u-front-no-shortcut',
    department: 'OPS',
    role: 'Operator'
  });

  tuc.create({
    employeeId: employee.id,
    goal: '我想把这套巡检流程沉淀成技能供后续复用。'
  });
  await tuc.tick();

  assert.equal(runtimeCalls, 1);
  assert.equal(store.skills.length, 0);
});
