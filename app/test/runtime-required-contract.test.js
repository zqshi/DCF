const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

test('task defaults to runtime-required execution', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Runtime Required', creator: 'u-rt-default', department: 'Ops', role: 'Operator' });
  const task = tuc.create({
    employeeId: employee.id,
    goal: '执行周报同步'
  });
  assert.equal(Boolean(((task.llmConfig || {}).requireRuntimeExecution)), true);
});

test('task fails when runtime gateway is unavailable', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store, null, null, {});
  const employee = euc.create({ name: 'Runtime Down', creator: 'u-rt-down', department: 'Ops', role: 'Operator' });
  const task = tuc.create({
    employeeId: employee.id,
    goal: '执行报表发送'
  });
  await tuc.tick();
  assert.equal(task.status, 'failed');
  assert.equal((task.runtime || {}).source, 'runtime-required');
});
