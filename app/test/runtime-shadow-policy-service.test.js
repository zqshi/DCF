const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeShadowPolicyService } = require('../src/application/services/RuntimeShadowPolicyService');

test('runtime shadow policy allows when tenant and role match', () => {
  const policy = new RuntimeShadowPolicyService({
    enabled: true,
    allowTenants: 'tenant-a,tenant-b',
    allowRoles: 'operator,auditor'
  });
  const verdict = policy.shouldCompare({ tenantId: 'tenant-a' }, { role: 'Operator' });
  assert.equal(verdict.ok, true);
});

test('runtime shadow policy blocks unmatched tenant/role', () => {
  const policy = new RuntimeShadowPolicyService({
    enabled: true,
    allowTenants: 'tenant-a',
    allowRoles: 'operator'
  });
  const tenantBlocked = policy.shouldCompare({ tenantId: 'tenant-x' }, { role: 'operator' });
  assert.equal(tenantBlocked.ok, false);
  assert.equal(tenantBlocked.reason, 'tenant_not_allowed');
  const roleBlocked = policy.shouldCompare({ tenantId: 'tenant-a' }, { role: 'admin' });
  assert.equal(roleBlocked.ok, false);
  assert.equal(roleBlocked.reason, 'role_not_allowed');
});

