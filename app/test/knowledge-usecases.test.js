const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { KnowledgeUseCases } = require('../src/application/usecases/KnowledgeUseCases');

test('knowledge usecase ingests manual content and auto-creates employee knowledge base', async () => {
  const store = new InMemoryStore();
  const gateway = {
    async createKnowledgeBase() {
      return {
        data: {
          id: 'kb-100',
          name: 'Ops KB',
          description: 'ops knowledge'
        }
      };
    },
    async createManualKnowledge() {
      return {
        data: {
          id: 'doc-200',
          title: '排障流程',
          description: 'SOP',
          parse_status: 'pending',
          enable_status: 'disabled'
        }
      };
    },
    async searchKnowledge() {
      return { data: [] };
    }
  };
  const uc = new KnowledgeUseCases(store, gateway);

  const result = await uc.ingestManual({
    employeeId: 'emp-1',
    taskId: 'task-1',
    traceId: 'trace-1',
    title: '排障流程',
    content: '先看Redis，再看上游限流。',
    curatedBy: 'u-admin'
  });

  assert.equal(result.knowledgeBaseId, 'kb-100');
  assert.equal(result.asset.externalId, 'doc-200');
  assert.equal(store.knowledgeAssets.filter((x) => x.assetType === 'knowledge_base').length, 1);
  assert.equal(store.knowledgeAssets.filter((x) => x.assetType === 'knowledge_item').length, 1);
  assert.ok(store.events.some((x) => x.type === 'knowledge.base.created'));
  assert.ok(store.events.some((x) => x.type === 'knowledge.ingest.completed'));
});

test('knowledge usecase reuses existing employee knowledge base when ingesting again', async () => {
  const store = new InMemoryStore();
  let kbCreateCount = 0;
  let docSeq = 0;
  const uc = new KnowledgeUseCases(store, {
    async createKnowledgeBase() {
      kbCreateCount += 1;
      return { data: { id: 'kb-reuse-1', name: 'Reuse KB', description: '' } };
    },
    async createManualKnowledge() {
      docSeq += 1;
      return { data: { id: `doc-${docSeq}`, title: `t-${docSeq}` } };
    },
    async searchKnowledge() {
      return { data: [] };
    }
  });

  await uc.ingestManual({
    employeeId: 'emp-reuse',
    taskId: 'task-1',
    traceId: 'trace-1',
    title: 't1',
    content: 'c1'
  });
  await uc.ingestManual({
    employeeId: 'emp-reuse',
    taskId: 'task-2',
    traceId: 'trace-2',
    title: 't2',
    content: 'c2'
  });

  assert.equal(kbCreateCount, 1);
  assert.equal(store.knowledgeAssets.filter((x) => x.assetType === 'knowledge_item').length, 2);
});

test('knowledge usecase searches by employee mapped knowledge base', async () => {
  const store = new InMemoryStore();
  const uc = new KnowledgeUseCases(store, {
    async createKnowledgeBase() {
      return { data: { id: 'kb-1', name: 'KB', description: '' } };
    },
    async createManualKnowledge() {
      return { data: { id: 'doc-1', title: 'Doc 1' } };
    },
    async searchKnowledge() {
      return {
        data: [
          {
            id: 'chunk-1',
            knowledge_id: 'doc-1',
            knowledge_title: 'Doc 1',
            content: '排障步骤',
            score: 0.9
          }
        ]
      };
    }
  });
  await uc.ingestManual({
    employeeId: 'emp-search',
    taskId: 'task-search',
    traceId: 'trace-search',
    title: 'Doc 1',
    content: '排障步骤'
  });

  const result = await uc.search({
    employeeId: 'emp-search',
    taskId: 'task-search',
    traceId: 'trace-search',
    query: '排障'
  });
  assert.equal(result.knowledgeBaseId, 'kb-1');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].knowledgeId, 'doc-1');
  assert.ok(store.events.some((x) => x.type === 'knowledge.search.completed'));
});

test('knowledge usecase review validates state and records event', () => {
  const store = new InMemoryStore();
  store.knowledgeAssets = [{
    id: 'asset-1',
    assetType: 'knowledge_item',
    externalId: 'doc-1',
    employeeId: 'emp-1',
    taskId: 'task-1',
    traceId: 'trace-1',
    title: 'Doc',
    reviewStatus: 'pending',
    lifecycleStatus: 'active',
    qualityScore: null
  }];
  const uc = new KnowledgeUseCases(store, {});

  const updated = uc.reviewAsset('asset-1', {
    reviewStatus: 'approved',
    qualityScore: 92
  }, { userId: 'u-reviewer' });

  assert.equal(updated.reviewStatus, 'approved');
  assert.equal(updated.qualityScore, 92);
  assert.equal(updated.reviewedBy, 'u-reviewer');
  assert.ok(store.events.some((x) => x.type === 'knowledge.asset.reviewed'));
});
