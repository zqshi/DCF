const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimePolicyService } = require('../src/application/services/RuntimePolicyService');

test('runtime policy service filters tool scope by allow and deny rules', () => {
  const policy = new RuntimePolicyService({
    allowedTools: 'read,write,search,test',
    deniedTools: 'browser,bash',
    defaultToolScope: 'read,test'
  });
  const scope = policy.resolveToolScope(['read', 'browser', 'bash', 'test']);
  assert.deepEqual(scope, ['read', 'test']);
});

test('runtime policy service enforces host allowlist', () => {
  const policy = new RuntimePolicyService({
    allowedHosts: '127.0.0.1,localhost',
    requireAuth: false
  });
  assert.throws(
    () => policy.validateNetworkIsolation('http://10.10.10.10:18789'),
    /host is not allowed/
  );
});

test('runtime policy service enforces auth and L4 policyId', () => {
  const policy = new RuntimePolicyService({
    allowedHosts: '*',
    requireAuth: true,
    enforcePolicyForL4: true
  });
  assert.throws(
    () => policy.enforceSecurityPolicy(
      { riskLevel: 'L2' },
      { policyId: '' },
      { baseUrl: 'http://127.0.0.1:18789', apiKey: '', gatewayToken: '' }
    ),
    /OpenClaw auth is required/
  );
  assert.throws(
    () => policy.enforceSecurityPolicy(
      { riskLevel: 'L4' },
      { policyId: '' },
      { baseUrl: 'http://127.0.0.1:18789', apiKey: 'k', gatewayToken: '' }
    ),
    /L4 task requires openclaw policyId/
  );
});

test('runtime policy service defaults include bash tool access', () => {
  const policy = new RuntimePolicyService();
  const scope = policy.resolveToolScope([]);
  assert.equal(scope.includes('bash'), true);
});
