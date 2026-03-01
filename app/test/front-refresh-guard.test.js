const test = require('node:test');
const assert = require('node:assert/strict');

const { createRequestGuard } = require('../public/front-refresh-guard.js');

test('request guard only accepts the latest issued token', () => {
  const guard = createRequestGuard();
  const first = guard.issue();
  const second = guard.issue();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test('latest token stays current until a new token is issued', () => {
  const guard = createRequestGuard();
  const token = guard.issue();

  assert.equal(guard.isCurrent(token), true);
  assert.equal(guard.isCurrent(token), true);
});
