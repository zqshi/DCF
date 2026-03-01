const test = require('node:test');
const assert = require('node:assert/strict');
const { isSyntheticRuntimeResult } = require('../src/application/services/TaskTextService');

test('does not treat onboarding wording as synthetic runtime result', () => {
  const text = 'Hey. I just came online. Who am I? Who are you?';
  assert.equal(isSyntheticRuntimeResult(text, 'openclaw'), false);
});
