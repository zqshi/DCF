const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');

test('employee retrieval policy rollout updates matched employees by filters', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const e1 = euc.create({ name: 'Ops-1', creator: 'u-1', department: 'Ops', role: 'Dispatcher' });
  const e2 = euc.create({ name: 'Ops-2', creator: 'u-2', department: 'Ops', role: 'Dispatcher' });
  const e3 = euc.create({ name: 'Fin-1', creator: 'u-3', department: 'Finance', role: 'Analyst' });

  euc.updateProfile(e2.id, { status: 'paused' }, 'u-admin-1');
  const result = euc.rolloutRetrievalPolicy({
    mode: 'busy',
    filters: { department: 'Ops', status: 'active' }
  }, 'u-admin-1');

  assert.equal(result.mode, 'busy');
  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.employeeIds, [e1.id]);
  assert.equal(euc.getById(e1.id).retrievalPolicy.mode, 'busy');
  assert.equal(euc.getById(e2.id).retrievalPolicy.mode, 'inherit');
  assert.equal(euc.getById(e3.id).retrievalPolicy.mode, 'inherit');

  const event = store.events.find((item) => item.type === 'employee.retrieval_policy.rollout');
  assert.ok(event);
  assert.equal((event.payload || {}).mode, 'busy');
});

test('employee retrieval policy rollback resets matched employees to inherit', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const e1 = euc.create({ name: 'Ops-1', creator: 'u-1', department: 'Ops', role: 'Dispatcher' });
  const e2 = euc.create({ name: 'Ops-2', creator: 'u-2', department: 'Ops', role: 'Dispatcher' });
  euc.rolloutRetrievalPolicy({ mode: 'idle', filters: { department: 'Ops' } }, 'u-admin-1');

  const result = euc.rollbackRetrievalPolicy({
    reason: 'incident rollback',
    filters: { employeeIds: [e1.id] }
  }, 'u-admin-2');

  assert.equal(result.mode, 'inherit');
  assert.equal(result.reason, 'incident rollback');
  assert.equal(result.matchedCount, 1);
  assert.equal(euc.getById(e1.id).retrievalPolicy.mode, 'inherit');
  assert.equal(euc.getById(e2.id).retrievalPolicy.mode, 'idle');

  const event = store.events.find((item) => item.type === 'employee.retrieval_policy.rollback');
  assert.ok(event);
  assert.equal((event.payload || {}).actorId, 'u-admin-2');
});

test('employee retrieval policy rollout rejects invalid mode', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  euc.create({ name: 'Ops-1', creator: 'u-1', department: 'Ops', role: 'Dispatcher' });
  assert.throws(
    () => euc.rolloutRetrievalPolicy({ mode: 'inherit' }, 'u-admin-1'),
    /rollout mode must be one of auto\|busy\|idle/
  );
});
