const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { KnowledgeSedimentationUseCases } = require('../src/application/usecases/KnowledgeSedimentationUseCases');

function makeTask(id = 'task-1') {
  return {
    id,
    traceId: `trace-${id}`,
    employeeId: 'emp-1',
    goal: '输出巡检报告并给出后续建议',
    result: '',
    riskLevel: 'L2'
  };
}

function makeEmployee() {
  return {
    id: 'emp-1',
    tenantId: 'tenant-1',
    accountId: 'account-1',
    department: 'OPS',
    role: 'Operator'
  };
}

test('knowledge auto sedimentation skips when disabled', async () => {
  const prev = process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED;
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = '0';

  const store = new InMemoryStore();
  const uc = new KnowledgeSedimentationUseCases(store, {
    async ingestManual() {
      throw new Error('should not call when disabled');
    }
  });

  const result = await uc.processTaskSuccess({
    task: makeTask(),
    employee: makeEmployee(),
    result: '这是一次任务结果，有依据、有风险说明和下一步建议。'
  });

  assert.equal(result.skipped, true);
  assert.equal(store.metrics.knowledgeSedimentation.skippedDisabled, 1);
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = prev;
});

test('knowledge auto sedimentation can auto publish in direct mode', async () => {
  const prev = process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED;
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = '1';

  const store = new InMemoryStore();
  store.knowledgeSedimentationPolicy = {
    mode: 'rules',
    promotionMode: 'direct',
    minConfidence: 0,
    minQualityScoreForAutoApprove: 10,
    minQualityScoreForReviewQueue: 5,
    fallbackToRulesWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'test'
  };
  const uc = new KnowledgeSedimentationUseCases(store, {
    async ingestManual() {
      return {
        knowledgeBaseId: 'kb-test',
        asset: { id: 'knowledge-asset-1' }
      };
    }
  });

  const result = await uc.processTaskSuccess({
    task: makeTask('task-2'),
    employee: makeEmployee(),
    result: '这是一次高质量任务结果，包含执行依据、风险点、建议和下一步动作。'
  });

  assert.equal(result.published, true);
  assert.equal(store.metrics.knowledgeSedimentation.autoPublished, 1);
  assert.equal(store.knowledgeCandidates.length, 1);
  assert.equal(store.knowledgeCandidates[0].status, 'approved');
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = prev;
});

test('knowledge auto sedimentation queues for review and supports manual rejection', async () => {
  const prev = process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED;
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = '1';

  const store = new InMemoryStore();
  store.tasks.push(makeTask('task-3'));
  store.employees.push(makeEmployee());
  store.knowledgeSedimentationPolicy = {
    mode: 'rules',
    promotionMode: 'proposal',
    minConfidence: 0,
    minQualityScoreForAutoApprove: 95,
    minQualityScoreForReviewQueue: 30,
    fallbackToRulesWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'test'
  };
  const uc = new KnowledgeSedimentationUseCases(store, {
    async ingestManual() {
      return {
        knowledgeBaseId: 'kb-test',
        asset: { id: 'knowledge-asset-2' }
      };
    }
  });

  const created = await uc.processTaskSuccess({
    task: makeTask('task-3'),
    employee: makeEmployee(),
    result: '任务结果具备复用价值，包含步骤和后续建议。'
  });
  assert.equal(created.published, false);
  assert.equal(store.knowledgeCandidates.length, 1);
  assert.equal(store.knowledgeCandidates[0].status, 'pending_review');
  assert.equal(store.knowledgeReviewQueue.length, 1);

  const reviewed = await uc.reviewCandidate(store.knowledgeCandidates[0].id, {
    action: 'rejected'
  }, { userId: 'u-review' });

  assert.equal(reviewed.status, 'rejected');
  assert.equal(store.knowledgeReviewQueue.length, 0);
  assert.equal(store.metrics.knowledgeSedimentation.reviewedRejected, 1);
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = prev;
});

test('knowledge auto sedimentation deduplicates repeated content', async () => {
  const prev = process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED;
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = '1';

  const store = new InMemoryStore();
  store.knowledgeSedimentationPolicy = {
    mode: 'rules',
    promotionMode: 'proposal',
    minConfidence: 0,
    minQualityScoreForAutoApprove: 95,
    minQualityScoreForReviewQueue: 10,
    fallbackToRulesWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'test'
  };
  const uc = new KnowledgeSedimentationUseCases(store, {
    async ingestManual() {
      return { knowledgeBaseId: 'kb-test', asset: { id: 'knowledge-asset-3' } };
    }
  });

  await uc.processTaskSuccess({
    task: makeTask('task-4'),
    employee: makeEmployee(),
    result: '同一条可复用沉淀内容。'
  });
  const second = await uc.processTaskSuccess({
    task: makeTask('task-5'),
    employee: makeEmployee(),
    result: '同一条可复用沉淀内容。'
  });

  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'deduplicated');
  assert.equal(store.metrics.knowledgeSedimentation.deduplicated, 1);
  process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED = prev;
});
