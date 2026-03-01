const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, routePath, options = {}) {
  const res = await fetch(`${base}${routePath}`, options);
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

async function loginAndCookie(base, username, password) {
  const login = await requestJson(base, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('admin skill proposal routes support propose/approve/rollback/reject', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const superCookie = await loginAndCookie(base, 'admin', 'admin123');

    const proposed = await requestJson(base, '/api/admin/skills/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({
        name: 'ops-evidence-kit',
        type: 'domain',
        domain: 'ops',
        description: 'Evidence preparation for rollback governance',
        evaluation: {
          summaryDimensionCount: 8,
          dimensions: {
            technicalMaturity: 4,
            communityActivity: 4,
            codeQuality: 4,
            documentation: 4,
            licenseCompliance: 4,
            security: 4,
            performance: 3,
            maintainability: 4
          },
          hardGate: { passed: true, reasons: [] },
          evidence: [{
            sourceUrl: 'https://github.com/example/ops-evidence-kit',
            capturedAt: new Date().toISOString(),
            evidenceExcerpt: 'manual proposal evidence'
          }]
        }
      })
    });
    assert.equal(proposed.status, 201);
    assert.equal(proposed.body.status, 'pending');

    const approved = await requestJson(base, `/api/admin/skills/${proposed.body.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({ note: 'approve proposal' })
    });
    assert.equal(approved.status, 403);
    assert.match(String(approved.body.error || ''), /approver must be different from proposer/);

    const approvedBySuper = await requestJson(base, `/api/admin/skills/${proposed.body.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superCookie },
      body: JSON.stringify({ note: 'approve proposal by super admin' })
    });
    assert.equal(approvedBySuper.status, 200);
    assert.equal(approvedBySuper.body.status, 'approved');

    const rolledBack = await requestJson(base, `/api/admin/skills/${proposed.body.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({ reason: 'rework needed' })
    });
    assert.equal(rolledBack.status, 403);
    assert.match(rolledBack.body.error, /role is not allowed/);

    const rolledBackBySuper = await requestJson(base, `/api/admin/skills/${proposed.body.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superCookie },
      body: JSON.stringify({ reason: 'rework needed' })
    });
    assert.equal(rolledBackBySuper.status, 200);
    assert.equal(rolledBackBySuper.body.status, 'rollback');

    const resubmit = await requestJson(base, `/api/admin/skills/${proposed.body.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({ note: 'should fail transition' })
    });
    assert.equal(resubmit.status, 400);
    assert.match(resubmit.body.error, /invalid skill status transition/);

    const invalidReject = await requestJson(base, `/api/admin/skills/${proposed.body.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({ reason: 'reject after rollback requires pending first' })
    });
    assert.equal(invalidReject.status, 400);
    assert.match(invalidReject.body.error, /invalid skill status transition/);

    const proposed2 = await requestJson(base, '/api/admin/skills/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({
        name: 'ops-reject-case',
        type: 'domain',
        domain: 'ops',
        evaluation: {
          summaryDimensionCount: 8,
          dimensions: {
            technicalMaturity: 4,
            communityActivity: 3,
            codeQuality: 3,
            documentation: 3,
            licenseCompliance: 4,
            security: 3,
            performance: 3,
            maintainability: 3
          },
          hardGate: { passed: true, reasons: [] },
          evidence: [{
            sourceUrl: 'https://github.com/example/ops-reject-case',
            capturedAt: new Date().toISOString(),
            evidenceExcerpt: 'manual proposal evidence'
          }]
        }
      })
    });
    assert.equal(proposed2.status, 201);
    assert.equal(proposed2.body.status, 'pending');

    const rejected = await requestJson(base, `/api/admin/skills/${proposed2.body.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: skillCookie },
      body: JSON.stringify({ reason: 'does not meet readiness bar' })
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'rejected');
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
