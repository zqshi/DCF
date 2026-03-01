const test = require('node:test');
const assert = require('node:assert/strict');
const { handleFrontRoutes } = require('../src/interfaces/http/routes/frontRoutes');

function createBaseContext(overrides = {}) {
  const writes = { status: 0, body: null };
  const context = {
    req: {
      method: 'POST',
      headers: {},
    },
    res: {},
    url: new URL('http://127.0.0.1/api/front/oss-cases/case-1/confirm'),
    json(_res, status, body) {
      writes.status = status;
      writes.body = body;
    },
    parseBody: async () => ({ confirm: true, note: 'ok' }),
    currentSession: () => ({
      user: {
        id: 'u-front-1',
        role: 'ops_admin',
        tenantId: 'tenant-a',
        accountId: 'account-a',
      }
    }),
    allowedFrontApprovalRoles: () => [],
    allowedFrontRejectRoles: () => [],
    frontConfiguredModels: [],
    employeeUC: {},
    taskUC: {
      list() {
        return [{ id: 'task-1' }];
      }
    },
    skillUC: {},
    ossUC: {},
    ossDecisionUC: {
      getCaseById() {
        return { id: 'case-1', taskId: 'task-1' };
      },
      confirmCaseByUser(caseId, input, actor) {
        return { id: caseId, status: input.confirm === false ? 'rejected' : 'approved_introduce', actorId: actor.userId };
      }
    },
    ...overrides
  };
  return { context, writes };
}

test('front route accepts oss case confirmation for visible task', async () => {
  const { context, writes } = createBaseContext();
  const handled = await handleFrontRoutes(context);
  assert.equal(handled, true);
  assert.equal(writes.status, 200);
  assert.equal(writes.body.id, 'case-1');
  assert.equal(writes.body.status, 'approved_introduce');
});

test('front route forbids oss case confirmation when task is out of scope', async () => {
  const { context, writes } = createBaseContext({
    taskUC: {
      list() {
        return [{ id: 'task-2' }];
      }
    }
  });
  const handled = await handleFrontRoutes(context);
  assert.equal(handled, true);
  assert.equal(writes.status, 403);
  assert.match(String(writes.body.error || ''), /无权确认/);
});

test('front route returns external knowledge config enabled by default', async () => {
  const writes = { status: 0, body: null };
  const context = {
    req: { method: 'GET', headers: {} },
    res: {},
    url: new URL('http://127.0.0.1/api/front/knowledge/config'),
    json(_res, status, body) {
      writes.status = status;
      writes.body = body;
    },
    parseBody: async () => ({}),
    currentSession: () => null,
    allowedFrontApprovalRoles: () => [],
    allowedFrontRejectRoles: () => [],
    frontConfiguredModels: [],
    employeeUC: {},
    conversationUC: {},
    messageUC: {},
    taskUC: {},
    skillUC: {},
    ossUC: {},
    ossDecisionUC: {},
    knowledgeUC: {}
  };
  const handled = await handleFrontRoutes(context);
  assert.equal(handled, true);
  assert.equal(writes.status, 200);
  assert.equal(writes.body.enabled, true);
  assert.equal(writes.body.entryUrl, 'http://127.0.0.1:19080');
  assert.equal(writes.body.useSsoBridge, false);
});

test('front route returns external knowledge entry when configured', async () => {
  const originalUrl = process.env.WEKNORA_WEB_URL;
  const originalMode = process.env.FRONT_KNOWLEDGE_ENTRY_MODE;
  const originalBridgeEnabled = process.env.KNOWLEDGE_SSO_BRIDGE_ENABLED;
  const originalBridgeSecret = process.env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET;
  process.env.FRONT_KNOWLEDGE_ENTRY_MODE = 'external';
  process.env.WEKNORA_WEB_URL = 'http://127.0.0.1:8080';
  process.env.KNOWLEDGE_SSO_BRIDGE_ENABLED = '1';
  process.env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET = 'bridge-secret';
  const writes = { status: 0, body: null };
  const context = {
    req: { method: 'GET', headers: {} },
    res: {},
    url: new URL('http://127.0.0.1/api/front/knowledge/config'),
    json(_res, status, body) {
      writes.status = status;
      writes.body = body;
    },
    parseBody: async () => ({}),
    currentSession: () => null,
    allowedFrontApprovalRoles: () => [],
    allowedFrontRejectRoles: () => [],
    frontConfiguredModels: [],
    employeeUC: {},
    conversationUC: {},
    messageUC: {},
    taskUC: {},
    skillUC: {},
    ossUC: {},
    ossDecisionUC: {},
    knowledgeUC: {}
  };
  try {
    const handled = await handleFrontRoutes(context);
    assert.equal(handled, true);
    assert.equal(writes.status, 200);
    assert.equal(writes.body.entryUrl, 'http://127.0.0.1:8080');
    assert.equal(writes.body.useSsoBridge, true);
  } finally {
    process.env.WEKNORA_WEB_URL = originalUrl;
    process.env.FRONT_KNOWLEDGE_ENTRY_MODE = originalMode;
    process.env.KNOWLEDGE_SSO_BRIDGE_ENABLED = originalBridgeEnabled;
    process.env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET = originalBridgeSecret;
  }
});

test('front route knowledge probe returns available when external health passes', async () => {
  const originalUrl = process.env.WEKNORA_WEB_URL;
  const originalMode = process.env.FRONT_KNOWLEDGE_ENTRY_MODE;
  const originalFetch = global.fetch;
  process.env.FRONT_KNOWLEDGE_ENTRY_MODE = 'external';
  process.env.WEKNORA_WEB_URL = 'http://127.0.0.1:19080/platform/knowledge-bases';
  global.fetch = async () => ({ ok: true, status: 200 });
  const writes = { status: 0, body: null };
  const context = {
    req: { method: 'GET', headers: {} },
    res: {},
    url: new URL('http://127.0.0.1/api/front/knowledge/probe'),
    json(_res, status, body) {
      writes.status = status;
      writes.body = body;
    },
    parseBody: async () => ({}),
    currentSession: () => null,
    allowedFrontApprovalRoles: () => [],
    allowedFrontRejectRoles: () => [],
    frontConfiguredModels: [],
    employeeUC: {},
    conversationUC: {},
    messageUC: {},
    taskUC: {},
    skillUC: {},
    ossUC: {},
    ossDecisionUC: {},
    knowledgeUC: {}
  };
  try {
    const handled = await handleFrontRoutes(context);
    assert.equal(handled, true);
    assert.equal(writes.status, 200);
    assert.equal(writes.body.available, true);
  } finally {
    global.fetch = originalFetch;
    process.env.WEKNORA_WEB_URL = originalUrl;
    process.env.FRONT_KNOWLEDGE_ENTRY_MODE = originalMode;
  }
});

test('front route knowledge probe returns 503 when external health fails', async () => {
  const originalUrl = process.env.WEKNORA_WEB_URL;
  const originalMode = process.env.FRONT_KNOWLEDGE_ENTRY_MODE;
  const originalFetch = global.fetch;
  process.env.FRONT_KNOWLEDGE_ENTRY_MODE = 'external';
  process.env.WEKNORA_WEB_URL = 'http://127.0.0.1:19080/platform/knowledge-bases';
  global.fetch = async () => ({ ok: false, status: 503 });
  const writes = { status: 0, body: null };
  const context = {
    req: { method: 'GET', headers: {} },
    res: {},
    url: new URL('http://127.0.0.1/api/front/knowledge/probe'),
    json(_res, status, body) {
      writes.status = status;
      writes.body = body;
    },
    parseBody: async () => ({}),
    currentSession: () => null,
    allowedFrontApprovalRoles: () => [],
    allowedFrontRejectRoles: () => [],
    frontConfiguredModels: [],
    employeeUC: {},
    conversationUC: {},
    messageUC: {},
    taskUC: {},
    skillUC: {},
    ossUC: {},
    ossDecisionUC: {},
    knowledgeUC: {}
  };
  try {
    const handled = await handleFrontRoutes(context);
    assert.equal(handled, true);
    assert.equal(writes.status, 503);
    assert.equal(writes.body.available, false);
    assert.match(String(writes.body.error || ''), /健康检查失败|未启动/);
  } finally {
    global.fetch = originalFetch;
    process.env.WEKNORA_WEB_URL = originalUrl;
    process.env.FRONT_KNOWLEDGE_ENTRY_MODE = originalMode;
  }
});
