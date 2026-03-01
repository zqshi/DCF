const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { SqliteSnapshotStore } = require('../src/infrastructure/repositories/SqliteSnapshotStore');
const { PostgresSnapshotStore } = require('../src/infrastructure/repositories/PostgresSnapshotStore');

test('snapshot stores do not override audit hash algorithm', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(SqliteSnapshotStore.prototype, 'hash'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(PostgresSnapshotStore.prototype, 'hash'), false);

  const store = new InMemoryStore();
  const digest = store.hash('dcf-audit-check');
  assert.equal(digest.length, 64);
});
