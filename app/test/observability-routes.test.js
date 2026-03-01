const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDefaultRetrievalMetrics,
  listEventsSince,
  handleObservabilityRoutes
} = require('../src/interfaces/http/routes/observabilityRoutes');

test('buildDefaultRetrievalMetrics returns complete zeroed shape', () => {
  const metrics = buildDefaultRetrievalMetrics();
  assert.deepEqual(metrics, {
    busyDecisions: 0,
    idleDecisions: 0,
    internalTools: 0,
    platformContext: 0,
    externalSearch: 0,
    skippedExternal: 0,
    queuedExternal: 0
  });
});

test('listEventsSince filters and sorts by seq', () => {
  const store = {
    events: [
      { seq: 3, type: 'c' },
      { seq: 1, type: 'a' },
      { seq: 2, type: 'b' }
    ]
  };
  assert.deepEqual(listEventsSince(store, 1, 10).map((x) => x.seq), [2, 3]);
  assert.deepEqual(listEventsSince(store, 0, 2).map((x) => x.seq), [3, 1]);
});

test('handleObservabilityRoutes serves metrics with default retrieval and successRate', async () => {
  const calls = [];
  const handled = await handleObservabilityRoutes({
    req: { method: 'GET' },
    res: {},
    url: new URL('http://127.0.0.1/api/metrics'),
    json: (res, status, body) => calls.push({ status, body }),
    store: {
      events: [],
      metrics: {
        totalTasks: 4,
        succeededTasks: 3
      }
    }
  });
  assert.equal(handled, true);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].body.successRate, 75);
  assert.deepEqual(calls[0].body.retrieval, buildDefaultRetrievalMetrics());
});

test('handleObservabilityRoutes serves /api/events with limit and since', async () => {
  const calls = [];
  const handled = await handleObservabilityRoutes({
    req: { method: 'GET' },
    res: {},
    url: new URL('http://127.0.0.1/api/events?since=1&limit=10'),
    json: (res, status, body) => calls.push({ status, body }),
    store: {
      events: [
        { seq: 1, type: 'a' },
        { seq: 4, type: 'd' },
        { seq: 2, type: 'b' }
      ],
      metrics: {}
    }
  });
  assert.equal(handled, true);
  assert.equal(calls[0].status, 200);
  assert.deepEqual(calls[0].body.map((x) => x.seq), [2, 4]);
});
