const test = require('node:test');
const assert = require('node:assert/strict');
const { SqliteSnapshotStore } = require('../src/infrastructure/repositories/SqliteSnapshotStore');
const { PostgresSnapshotStore } = require('../src/infrastructure/repositories/PostgresSnapshotStore');

function setNestedMetrics(store) {
  store.metrics = {
    totalTasks: 3,
    retrieval: { queuedExternal: 2 },
    skillSedimentation: { directCreated: 1, skipped: 4 },
    knowledgeSedimentation: { autoPublished: 5, deduplicated: 2 }
  };
}

test('sqlite snapshot store flattens nested metrics namespaces', () => {
  const store = new SqliteSnapshotStore('/tmp/dcf-metrics-test.sqlite');
  setNestedMetrics(store);
  const flat = store.flattenMetrics();
  assert.equal(flat.totalTasks, 3);
  assert.equal(flat['retrieval.queuedExternal'], 2);
  assert.equal(flat['skillSedimentation.directCreated'], 1);
  assert.equal(flat['skillSedimentation.skipped'], 4);
  assert.equal(flat['knowledgeSedimentation.autoPublished'], 5);
  assert.equal(flat['knowledgeSedimentation.deduplicated'], 2);
});

test('postgres snapshot store flattens nested metrics namespaces', () => {
  const store = new PostgresSnapshotStore('postgres://localhost/not-used');
  setNestedMetrics(store);
  const flat = store.flattenMetrics();
  assert.equal(flat.totalTasks, 3);
  assert.equal(flat['retrieval.queuedExternal'], 2);
  assert.equal(flat['skillSedimentation.directCreated'], 1);
  assert.equal(flat['skillSedimentation.skipped'], 4);
  assert.equal(flat['knowledgeSedimentation.autoPublished'], 5);
  assert.equal(flat['knowledgeSedimentation.deduplicated'], 2);
});
