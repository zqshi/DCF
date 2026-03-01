const test = require('node:test');
const assert = require('node:assert/strict');
const { rewriteApiV1Request } = require('../src/interfaces/http/apiVersioning');

test('rewriteApiV1Request rewrites v1 path and keeps query', () => {
  const headers = {};
  const res = {
    setHeader(key, value) {
      headers[key] = value;
    }
  };
  const out = rewriteApiV1Request('/api/v1/health?probe=1', res);
  assert.equal(out.rewritten, true);
  assert.equal(out.url, '/api/health?probe=1');
  assert.equal(headers['X-API-Version'], 'v1');
});

test('rewriteApiV1Request keeps non-v1 path untouched', () => {
  const out = rewriteApiV1Request('/api/health');
  assert.equal(out.rewritten, false);
  assert.equal(out.url, '/api/health');
});
