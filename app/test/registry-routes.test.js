const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveRegistryTokens,
  parseRegistryToken,
  requireRegistryAccess
} = require('../src/interfaces/http/routes/registryRoutes');

test('resolveRegistryTokens parses comma-separated tokens', () => {
  const prev = process.env.REGISTRY_API_KEYS;
  process.env.REGISTRY_API_KEYS = ' key-1, ,key-2  ,';
  try {
    assert.deepEqual(resolveRegistryTokens(), ['key-1', 'key-2']);
  } finally {
    if (typeof prev === 'string') process.env.REGISTRY_API_KEYS = prev;
    else delete process.env.REGISTRY_API_KEYS;
  }
});

test('parseRegistryToken supports bearer and x-registry-token header', () => {
  assert.equal(parseRegistryToken({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
  assert.equal(parseRegistryToken({ headers: { 'x-registry-token': 'tok-1' } }), 'tok-1');
});

test('requireRegistryAccess rejects when registry token config is absent', () => {
  const prev = process.env.REGISTRY_API_KEYS;
  delete process.env.REGISTRY_API_KEYS;
  const calls = [];
  try {
    const result = requireRegistryAccess({ headers: {} }, {}, (res, status, body) => {
      calls.push({ status, body });
    });
    assert.equal(result, null);
    assert.equal(calls[0].status, 503);
    assert.match(String(calls[0].body.error || ''), /disabled/i);
  } finally {
    if (typeof prev === 'string') process.env.REGISTRY_API_KEYS = prev;
    else delete process.env.REGISTRY_API_KEYS;
  }
});

test('requireRegistryAccess validates token and derives registrant fallback', () => {
  const prev = process.env.REGISTRY_API_KEYS;
  process.env.REGISTRY_API_KEYS = 'reg-1';
  const calls = [];
  try {
    const denied = requireRegistryAccess({ headers: {} }, {}, (res, status, body) => calls.push({ status, body }));
    assert.equal(denied, null);
    assert.equal(calls[0].status, 401);

    const access = requireRegistryAccess({
      headers: {
        authorization: 'Bearer reg-1',
        'x-source-system': 'erp'
      }
    }, {}, () => {});
    assert.equal(access.sourceSystem, 'erp');
    assert.match(String(access.registrantId), /^registry-/);
  } finally {
    if (typeof prev === 'string') process.env.REGISTRY_API_KEYS = prev;
    else delete process.env.REGISTRY_API_KEYS;
  }
});
