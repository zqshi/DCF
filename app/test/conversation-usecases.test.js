const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { ConversationUseCases } = require('../src/application/usecases/ConversationUseCases');

function seedEmployee(store, id = 'e-1') {
  store.employees.push({
    id,
    employeeCode: 'DE-001',
    name: 'Tester',
    department: 'Ops',
    role: 'Operator',
    tenantId: 'tenant-a',
    accountId: 'account-a',
    agentType: 'parent',
    knowledge: [],
    linkedSkillIds: [],
    childAgents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

test('conversation delete is soft and does not clear messages immediately', () => {
  const store = new InMemoryStore();
  seedEmployee(store);
  const uc = new ConversationUseCases(store, { softDeleteRetentionDays: 7 });
  const conversation = uc.create({ employeeId: 'e-1', title: 'soft delete test' });
  store.messages.push({
    id: 'm-1',
    employeeId: 'e-1',
    conversationId: conversation.id,
    role: 'user',
    content: 'hello',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const deleted = uc.delete(conversation.id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.mode, 'soft');
  assert.equal(store.conversations.length, 1);
  assert.equal(store.conversations[0].isDeleted, true);
  assert.equal(store.messages.length, 1);
  assert.equal(uc.listByEmployee('e-1').length, 0);
});

test('expired soft-deleted conversations are purged with messages', () => {
  const store = new InMemoryStore();
  seedEmployee(store);
  const uc = new ConversationUseCases(store, { softDeleteRetentionDays: 0 });
  const conversation = uc.create({ employeeId: 'e-1', title: 'purge test' });
  store.messages.push({
    id: 'm-1',
    employeeId: 'e-1',
    conversationId: conversation.id,
    role: 'assistant',
    content: 'result',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  uc.delete(conversation.id);
  uc.purgeExpiredSoftDeleted();

  assert.equal(store.conversations.length, 0);
  assert.equal(store.messages.length, 0);
});

test('conversation delete never mutates employee memory, tasks or skills', () => {
  const store = new InMemoryStore();
  seedEmployee(store);
  store.employees[0].knowledge.push({ id: 'k-1', title: 'memory', summary: 'learned' });
  store.skills.push({ id: 's-1', name: 'ops-skill', type: 'general', status: 'approved' });
  store.tasks.push({ id: 't-1', employeeId: 'e-1', conversationId: 'conv-x', status: 'succeeded' });
  const uc = new ConversationUseCases(store, { softDeleteRetentionDays: 0 });
  const conversation = uc.create({ employeeId: 'e-1', title: 'keep memory' });
  store.messages.push({
    id: 'm-1',
    employeeId: 'e-1',
    conversationId: conversation.id,
    role: 'assistant',
    content: 'chat',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const beforeKnowledge = JSON.stringify(store.employees[0].knowledge);
  const beforeSkillIds = store.skills.map((x) => x.id).join(',');
  const beforeTaskIds = store.tasks.map((x) => x.id).join(',');

  uc.delete(conversation.id);
  uc.purgeExpiredSoftDeleted();

  assert.equal(JSON.stringify(store.employees[0].knowledge), beforeKnowledge);
  assert.equal(store.skills.map((x) => x.id).join(','), beforeSkillIds);
  assert.equal(store.tasks.map((x) => x.id).join(','), beforeTaskIds);
});
