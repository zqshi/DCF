const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { AdminUseCases } = require('../src/application/usecases/AdminUseCases');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

test('admin can update retrieval policy mode with audit event', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  const before = auc.getRetrievalPolicy();
  assert.equal(before.mode, 'auto');

  const updated = auc.updateRetrievalPolicy({ mode: 'busy' }, { userId: 'u-admin-1' });
  assert.equal(updated.mode, 'busy');
  assert.equal(updated.updatedBy, 'u-admin-1');
  const event = store.events.find((x) => x.type === 'retrieval.policy.mode.updated');
  assert.ok(event);
  assert.equal(event.payload.fromMode, 'auto');
  assert.equal(event.payload.toMode, 'busy');
});

test('task retrieval decision applies forced busy mode from platform config', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  auc.updateRetrievalPolicy({ mode: 'busy' }, { userId: 'u-admin-1' });
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Ops', creator: 'u-rpm-1', department: 'Ops', role: 'Operator' });
  const task = tuc.create({ employeeId: employee.id, goal: '校验 busy 模式策略' });
  const queued = tuc.queueOssResearch(employee, task);
  assert.ok(queued);
  const event = store.events.find((x) => x.type === 'retrieval.policy.decided');
  assert.ok(event);
  assert.equal(event.payload.retrievalSchedulingMode, 'busy');
});

test('task retrieval decision applies employee retrieval mode override', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  auc.updateRetrievalPolicy({ mode: 'auto' }, { userId: 'u-admin-1' });
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({ name: 'Ops2', creator: 'u-rpm-2', department: 'Ops', role: 'Operator' });
  euc.updateProfile(employee.id, { retrievalPolicy: { mode: 'idle' } }, 'u-admin-1');
  const task = tuc.create({ employeeId: employee.id, goal: '校验员工级策略覆盖' });
  const queued = tuc.queueOssResearch(employee, task);
  assert.ok(queued);
  const event = store.events.find((x) => x.type === 'retrieval.policy.decided');
  assert.ok(event);
  assert.equal(event.payload.retrievalSchedulingMode, 'idle');
});

test('admin can update skill sedimentation policy with audit event', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  const before = auc.getSkillSedimentationPolicy();
  assert.equal(before.mode, 'hybrid');

  const updated = auc.updateSkillSedimentationPolicy({
    mode: 'model_driven',
    promotionMode: 'proposal',
    minConfidence: 0.82,
    fallbackToRulesWhenModelUnavailable: false,
    minRepeatedSuccessForFallback: 3
  }, { userId: 'u-admin-2' });
  assert.equal(updated.mode, 'model_driven');
  assert.equal(updated.promotionMode, 'proposal');
  assert.equal(updated.minConfidence, 0.82);
  assert.equal(updated.fallbackToRulesWhenModelUnavailable, false);
  assert.equal(updated.minRepeatedSuccessForFallback, 3);
  assert.equal(updated.updatedBy, 'u-admin-2');

  const event = store.events.find((x) => x.type === 'skill.sedimentation.policy.updated');
  assert.ok(event);
  assert.equal(event.payload.fromMode, 'hybrid');
  assert.equal(event.payload.toMode, 'model_driven');
  assert.equal(event.payload.fromPromotionMode, 'direct');
  assert.equal(event.payload.toPromotionMode, 'proposal');
});

test('admin can update runtime shadow policy with audit event', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  const before = auc.getRuntimeShadowPolicy();
  assert.equal(before.enabled, false);

  const updated = auc.updateRuntimeShadowPolicy({
    enabled: true,
    targetEngine: 'openclaw',
    allowTenants: 'tenant-a,tenant-b',
    allowRoles: 'operator,auditor'
  }, { userId: 'u-admin-shadow' });
  assert.equal(updated.enabled, true);
  assert.equal(updated.targetEngine, 'openclaw');
  assert.deepEqual(updated.allowTenants, ['tenant-a', 'tenant-b']);
  assert.deepEqual(updated.allowRoles, ['operator', 'auditor']);
  assert.equal(updated.updatedBy, 'u-admin-shadow');
  const event = store.events.find((x) => x.type === 'runtime.shadow.policy.updated');
  assert.ok(event);
  assert.equal(event.payload.fromEnabled, false);
  assert.equal(event.payload.toEnabled, true);
});
