const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPermissionDeniedRequest
} = require('../src/application/services/TaskFailurePolicyService');

test('task failure policy extracts permission denied request from runtime failures', () => {
  const request = extractPermissionDeniedRequest({
    status: 'failed',
    error: { message: 'permission denied for tool edit-file' },
    runtimeEvents: [{
      type: 'runtime.tool.denied',
      payload: { toolName: 'edit-file', reason: 'not allowed by policy' }
    }]
  });
  assert.equal(Boolean(request), true);
  assert.equal(request.tool, 'edit-file');
});
