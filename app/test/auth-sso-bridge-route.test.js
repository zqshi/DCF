const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function requestWithManualRedirect(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    redirect: 'manual'
  });
  return { status: res.status, headers: res.headers };
}

test('sso bridge exposes reserved capabilities and supports token-gated bridge login', async () => {
  const prev = {
    AUTH_SSO_ENABLED: process.env.AUTH_SSO_ENABLED,
    AUTH_SSO_PROVIDER: process.env.AUTH_SSO_PROVIDER,
    AUTH_SSO_AUTHORIZE_URL: process.env.AUTH_SSO_AUTHORIZE_URL,
    AUTH_SSO_CLIENT_ID: process.env.AUTH_SSO_CLIENT_ID,
    AUTH_SSO_TOKEN_EXCHANGE_URL: process.env.AUTH_SSO_TOKEN_EXCHANGE_URL,
    AUTH_SSO_CLIENT_SECRET: process.env.AUTH_SSO_CLIENT_SECRET,
    AUTH_SSO_BRIDGE_TOKEN: process.env.AUTH_SSO_BRIDGE_TOKEN,
    AUTH_SSO_BRIDGE_ALLOW: process.env.AUTH_SSO_BRIDGE_ALLOW,
    KNOWLEDGE_SSO_BRIDGE_ENABLED: process.env.KNOWLEDGE_SSO_BRIDGE_ENABLED,
    KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET: process.env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET,
    WEKNORA_WEB_URL: process.env.WEKNORA_WEB_URL
  };
  process.env.AUTH_SSO_ENABLED = '1';
  process.env.AUTH_SSO_PROVIDER = 'corp-idp';
  process.env.AUTH_SSO_AUTHORIZE_URL = 'https://sso.example.com/oauth2/authorize';
  process.env.AUTH_SSO_CLIENT_ID = 'dcf-admin-client';
  process.env.AUTH_SSO_TOKEN_EXCHANGE_URL = '';
  process.env.AUTH_SSO_CLIENT_SECRET = '';
  process.env.AUTH_SSO_BRIDGE_TOKEN = 'bridge-token-1';
  process.env.AUTH_SSO_BRIDGE_ALLOW = '1';
  process.env.KNOWLEDGE_SSO_BRIDGE_ENABLED = '1';
  process.env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET = 'dcf-knowledge-bridge-secret';
  process.env.WEKNORA_WEB_URL = 'http://127.0.0.1:19080/platform/knowledge-bases';

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const capabilities = await requestJson(base, '/api/auth/sso/capabilities');
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.enabled, true);
    assert.equal(capabilities.body.mode, 'bridge-reserved');
    assert.equal(capabilities.body.bridgeLoginEnabled, true);
    assert.equal(capabilities.body.callbackImplemented, true);
    assert.equal(capabilities.body.tokenExchangeImplemented, true);

    const authorize = await requestJson(base, '/api/auth/sso/authorize?redirectUri=https%3A%2F%2Fadmin.example.com%2Fcallback');
    assert.equal(authorize.status, 200);
    assert.match(String(authorize.body.authorizeUrl || ''), /client_id=dcf-admin-client/);

    const callbackPlaceholder = await requestJson(base, '/api/auth/sso/callback?code=a&state=b');
    assert.equal(callbackPlaceholder.status, 200);
    assert.equal(callbackPlaceholder.body.ok, true);
    assert.equal(callbackPlaceholder.body.exchangeRequired, true);
    assert.equal(callbackPlaceholder.body.tokenExchangeEndpoint, '/api/auth/sso/token-exchange');

    const adminLogin = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = String(adminLogin.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(adminCookie);

    const createSsoUser = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'sso_bridge_user',
        displayName: 'SSO Bridge User',
        role: 'ops_admin',
        ssoManaged: true,
        authProvider: 'sso'
      })
    });
    assert.equal(createSsoUser.status, 201);

    const forbiddenBridge = await requestJson(base, '/api/auth/sso/bridge-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sso_bridge_user' })
    });
    assert.equal(forbiddenBridge.status, 403);

    const forbiddenTokenExchange = await requestJson(base, '/api/auth/sso/token-exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'code-1',
        username: 'sso_bridge_user'
      })
    });
    assert.equal(forbiddenTokenExchange.status, 403);

    const bridgeLogin = await requestJson(base, '/api/auth/sso/bridge-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sso-bridge-token': 'bridge-token-1'
      },
      body: JSON.stringify({ username: 'sso_bridge_user' })
    });
    assert.equal(bridgeLogin.status, 200);
    assert.equal(bridgeLogin.body.ok, true);
    assert.equal(bridgeLogin.body.authMethod, 'sso-bridge');
    assert.ok(String(bridgeLogin.headers.get('set-cookie') || '').includes('dcf_admin_session='));

    const tokenExchangeLogin = await requestJson(base, '/api/auth/sso/token-exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sso-bridge-token': 'bridge-token-1'
      },
      body: JSON.stringify({
        code: 'code-1',
        username: 'sso_bridge_user'
      })
    });
    assert.equal(tokenExchangeLogin.status, 200);
    assert.equal(tokenExchangeLogin.body.ok, true);
    assert.equal(tokenExchangeLogin.body.authMethod, 'sso-token-exchange');
    assert.ok(String(tokenExchangeLogin.headers.get('set-cookie') || '').includes('dcf_admin_session='));

    const knowledgeBridgeUrl = await requestJson(base, '/api/auth/sso/knowledge-bridge-url?redirect=%2Fplatform%2Fknowledge-bases', {
      headers: { Cookie: adminCookie }
    });
    assert.equal(knowledgeBridgeUrl.status, 200);
    assert.match(String(knowledgeBridgeUrl.body.url || ''), /^http:\/\/127\.0\.0\.1:19080\/login\?/);
    assert.match(String(knowledgeBridgeUrl.body.url || ''), /bridge_ticket=/);
    assert.match(String(knowledgeBridgeUrl.body.url || ''), /redirect=%2Fplatform%2Fknowledge-bases/);

    const knowledgeBridgeRedirect = await requestWithManualRedirect(
      base,
      '/api/auth/sso/knowledge-bridge-login?redirect=%2Fplatform%2Fknowledge-bases',
      { headers: { Cookie: adminCookie } }
    );
    assert.equal(knowledgeBridgeRedirect.status, 302);
    assert.match(String(knowledgeBridgeRedirect.headers.get('location') || ''), /^http:\/\/127\.0\.0\.1:19080\/login\?/);
    assert.match(String(knowledgeBridgeRedirect.headers.get('location') || ''), /bridge_ticket=/);
    assert.match(String(knowledgeBridgeRedirect.headers.get('location') || ''), /redirect=%2Fplatform%2Fknowledge-bases/);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    Object.assign(process.env, prev);
  }
});

test('sso user can create and reuse digital employee across re-login sessions', async () => {
  const prev = {
    AUTH_SSO_ENABLED: process.env.AUTH_SSO_ENABLED,
    AUTH_SSO_PROVIDER: process.env.AUTH_SSO_PROVIDER,
    AUTH_SSO_AUTHORIZE_URL: process.env.AUTH_SSO_AUTHORIZE_URL,
    AUTH_SSO_CLIENT_ID: process.env.AUTH_SSO_CLIENT_ID,
    AUTH_SSO_TOKEN_EXCHANGE_URL: process.env.AUTH_SSO_TOKEN_EXCHANGE_URL,
    AUTH_SSO_CLIENT_SECRET: process.env.AUTH_SSO_CLIENT_SECRET,
    AUTH_SSO_BRIDGE_TOKEN: process.env.AUTH_SSO_BRIDGE_TOKEN,
    AUTH_SSO_BRIDGE_ALLOW: process.env.AUTH_SSO_BRIDGE_ALLOW
  };
  process.env.AUTH_SSO_ENABLED = '1';
  process.env.AUTH_SSO_PROVIDER = 'corp-idp';
  process.env.AUTH_SSO_AUTHORIZE_URL = 'https://sso.example.com/oauth2/authorize';
  process.env.AUTH_SSO_CLIENT_ID = 'dcf-admin-client';
  process.env.AUTH_SSO_TOKEN_EXCHANGE_URL = '';
  process.env.AUTH_SSO_CLIENT_SECRET = '';
  process.env.AUTH_SSO_BRIDGE_TOKEN = 'bridge-token-2';
  process.env.AUTH_SSO_BRIDGE_ALLOW = '1';

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await requestJson(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = String(adminLogin.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(adminCookie);

    const createSsoUser = await requestJson(base, '/api/admin/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        username: 'sso_employee_user',
        displayName: 'SSO Employee User',
        role: 'ops_admin',
        ssoManaged: true,
        authProvider: 'sso'
      })
    });
    assert.equal(createSsoUser.status, 201);
    assert.equal(createSsoUser.body.tenantId, 'tenant-default');
    assert.equal(createSsoUser.body.accountId, 'account-default');

    const firstLogin = await requestJson(base, '/api/auth/sso/bridge-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sso-bridge-token': 'bridge-token-2'
      },
      body: JSON.stringify({ username: 'sso_employee_user' })
    });
    assert.equal(firstLogin.status, 200);
    const firstCookie = String(firstLogin.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(firstCookie);

    const me = await requestJson(base, '/api/auth/me', {
      headers: { Cookie: firstCookie }
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'sso_employee_user');
    assert.equal(me.body.user.tenantId, 'tenant-default');
    assert.equal(me.body.user.accountId, 'account-default');

    const createdEmployee = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: firstCookie
      },
      body: JSON.stringify({
        creator: 'spoofed-creator-will-be-ignored',
        name: 'SSO员工数字体',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(createdEmployee.status, 201);
    const employeeId = createdEmployee.body.id;
    assert.ok(employeeId);

    const secondCreate = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: firstCookie
      },
      body: JSON.stringify({
        creator: 'another-spoofed-creator',
        name: 'SSO员工数字体-2',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(secondCreate.status, 400);
    assert.match(String(secondCreate.body.error || ''), /only create one parent digital employee/i);

    const relogin = await requestJson(base, '/api/auth/sso/bridge-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sso-bridge-token': 'bridge-token-2'
      },
      body: JSON.stringify({ username: 'sso_employee_user' })
    });
    assert.equal(relogin.status, 200);
    const secondCookie = String(relogin.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(secondCookie);

    const listAfterRelogin = await requestJson(base, '/api/front/employees', {
      headers: { Cookie: secondCookie }
    });
    assert.equal(listAfterRelogin.status, 200);
    assert.equal(Array.isArray(listAfterRelogin.body), true);
    assert.equal(listAfterRelogin.body.length, 1);
    assert.equal(listAfterRelogin.body[0].id, employeeId);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    Object.assign(process.env, prev);
  }
});
