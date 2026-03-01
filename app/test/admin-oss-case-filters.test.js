const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { AdminUseCases } = require('../src/application/usecases/AdminUseCases');

test('admin can filter oss cases by status risk and evidence completeness', () => {
  const store = new InMemoryStore();
  store.ossCases = [
    {
      id: 'case-1',
      status: 'completed',
      createdAt: '2026-02-20T00:00:00.000Z',
      evaluation: {
        consistency: { ok: true },
        topCandidate: { hardGate: { riskLevel: 'low' } }
      }
    },
    {
      id: 'case-2',
      status: 'pending_approval',
      createdAt: '2026-02-21T00:00:00.000Z',
      evaluation: {
        consistency: { ok: false },
        topCandidate: { hardGate: { riskLevel: 'high' } }
      }
    }
  ];
  const auc = new AdminUseCases(store);
  const filtered = auc.listOssCases({
    status: 'pending_approval',
    risk: 'high',
    evidenceComplete: 'false'
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'case-2');
});
