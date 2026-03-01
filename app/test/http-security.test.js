const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');
const { hashPasswordForStorage } = require('../src/application/usecases/AuthUseCases');

function withEnv(patch, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('production auth cookie is secure and cors origin is explicit', async () => {
  const pepper = 'http-sec-pepper';
  const users = [{
    id: 'u-root-1',
    username: 'root_owner',
    displayName: 'Root Owner',
    role: 'super_admin',
    passwordHash: hashPasswordForStorage('root-pass-001', pepper)
  }];

  await withEnv({
    NODE_ENV: 'production',
    AUTH_USERS_JSON: JSON.stringify(users),
    AUTH_PASSWORD_PEPPER: pepper,
    AUTH_REQUIRE_EXTERNAL_USERS: '1',
    AUTH_FORBID_DEMO_USERS: '1',
    CORS_ALLOW_ORIGIN: 'https://admin.example.com'
  }, async () => {
    const server = await createApp();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    try {
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://admin.example.com' },
        body: JSON.stringify({ username: 'root_owner', password: 'root-pass-001' })
      });
      assert.equal(login.status, 200);
      const cookie = String(login.headers.get('set-cookie') || '');
      assert.ok(cookie.includes('Secure'));
      assert.equal(login.headers.get('access-control-allow-origin'), 'https://admin.example.com');

      const preflight = await fetch(`${base}/api/framework`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://admin.example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://admin.example.com');
    } finally {
      await server.shutdown();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
