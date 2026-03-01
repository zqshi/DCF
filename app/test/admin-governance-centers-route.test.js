const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
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

test('governance centers routes support runtime read/write boundaries', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const auditorCookie = await loginAndCookie(base, 'auditor', 'audit123');

    const strategyRead = await requestJson(base, '/api/admin/strategy-center', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(strategyRead.status, 200);
    assert.equal(typeof strategyRead.body.maxLoopSteps, 'number');

    const strategyWrite = await requestJson(base, '/api/admin/strategy-center', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        maxLoopSteps: 7,
        maxTaskRuntimeMs: 180000,
        retryLimit: 3,
        retryBackoffMs: 4500,
        defaultToolScope: 'read,search,test',
        defaultSkillScope: 'general,ops',
        autoevolveMinScoreGain: 0.05,
        autoevolveCanaryRatio: 0.2,
        autoevolveObservationWindowMinutes: 120,
        promptPublishRequiresApproval: true,
        blockOnHighRiskWithoutApproval: true
      })
    });
    assert.equal(strategyWrite.status, 200);
    assert.equal(strategyWrite.body.maxLoopSteps, 7);
    assert.equal(strategyWrite.body.promptPublishRequiresApproval, true);

    const compilePreview = await requestJson(base, '/api/admin/prompt-center/compile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(compilePreview.status, 200);
    assert.equal(typeof compilePreview.body.content, 'string');

    const centerUpdated = await requestJson(base, '/api/admin/prompt-center', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        layers: {
          platform: {
            id: 'platform-default',
            content: 'platform-layer-updated'
          },
          roleTemplates: {
            Operator: {
              id: 'Operator',
              content: 'role-operator-layer'
            }
          },
          tenantPolicies: {},
          userProfiles: {}
        }
      })
    });
    assert.equal(centerUpdated.status, 200);
    assert.equal(String((((centerUpdated.body || {}).layers || {}).platform || {}).content || ''), 'platform-layer-updated');

    const publish = await requestJson(base, '/api/admin/prompt-versions/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ name: 'governance-test-version' })
    });
    assert.equal(publish.status, 201);
    assert.ok(String(publish.body.id || '').startsWith('prompt-v-'));
    assert.equal(publish.body.status, 'pending_approval');

    const approved = await requestJson(base, '/api/admin/prompt-versions/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ versionId: publish.body.id })
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'active');

    const versions = await requestJson(base, '/api/admin/prompt-versions', {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(versions.status, 200);
    assert.equal(Array.isArray(versions.body.items), true);
    assert.equal(versions.body.items.length >= 1, true);

    const rollback = await requestJson(base, '/api/admin/prompt-versions/rollback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ versionId: versions.body.items[0].id })
    });
    assert.equal(rollback.status, 200);

    const createRun = await requestJson(base, '/api/admin/autoevolve/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ scoreGain: 0.08, replayPassed: true })
    });
    assert.equal(createRun.status, 201);
    const runId = createRun.body.id;
    assert.ok(runId);

    const promote = await requestJson(base, '/api/admin/autoevolve/promote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ runId })
    });
    assert.equal(promote.status, 200);
    assert.equal(promote.body.run.status, 'promoted');

    const forbiddenWrite = await requestJson(base, '/api/admin/strategy-center', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: auditorCookie
      },
      body: JSON.stringify({ maxLoopSteps: 8 })
    });
    assert.equal(forbiddenWrite.status, 403);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('prompt center upgrades legacy platform prompt to baseline prompt', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');
    const legacyPrompt = [
      '你是企业数字员工，必须遵循 Plan->Act->Observe->Reflect->Loop。',
      '每轮输出必须包含：假设、动作、证据、判断、下一步。',
      '先证据后结论；高风险动作必须满足审批策略。'
    ].join('\n');
    const updated = await requestJson(base, '/api/admin/prompt-center', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        layers: {
          platform: {
            id: 'platform-default',
            content: legacyPrompt
          }
        }
      })
    });
    assert.equal(updated.status, 200);
    const upgradedContent = String((((updated.body || {}).layers || {}).platform || {}).content || '');
    assert.equal(upgradedContent.includes('Plan->Act->Observe->Reflect->Loop'), false);
    assert.equal(upgradedContent.includes('你是 DCF 平台内的企业级数字员工执行体'), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
