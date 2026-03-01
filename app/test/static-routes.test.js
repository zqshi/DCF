const test = require('node:test');
const assert = require('node:assert/strict');
const { handleStaticRoutes } = require('../src/interfaces/http/routes/staticRoutes');

test('handleStaticRoutes redirects unauthenticated admin page request to login', async () => {
  const writes = [];
  const req = { url: '/admin/index.html' };
  const res = {
    writeHead(status, headers) {
      writes.push({ status, headers });
    },
    end() {}
  };
  const handled = await handleStaticRoutes({
    req,
    res,
    url: new URL('http://127.0.0.1/admin/index.html'),
    json: () => {},
    serveStatic: () => {
      throw new Error('serveStatic should not be called');
    },
    publicDir: '/tmp',
    currentSession: () => null,
    resolvePagePermission: () => null,
    authUC: { canAccess: () => false }
  });
  assert.equal(handled, true);
  assert.equal(writes[0].status, 302);
  assert.equal(writes[0].headers.Location, '/admin/login.html');
});

test('handleStaticRoutes redirects unauthenticated front page request to front login', async () => {
  const writes = [];
  const req = { url: '/front.html' };
  const res = {
    writeHead(status, headers) {
      writes.push({ status, headers });
    },
    end() {}
  };
  const handled = await handleStaticRoutes({
    req,
    res,
    url: new URL('http://127.0.0.1/front.html'),
    json: () => {},
    serveStatic: () => {
      throw new Error('serveStatic should not be called');
    },
    publicDir: '/tmp',
    currentSession: () => null,
    resolvePagePermission: () => null,
    authUC: { canAccess: () => false }
  });
  assert.equal(handled, true);
  assert.equal(writes[0].status, 302);
  assert.equal(writes[0].headers.Location, '/front-login.html?next=%2Ffront.html');
});

test('handleStaticRoutes returns API 404 for unknown api path', async () => {
  const calls = [];
  const handled = await handleStaticRoutes({
    req: { url: '/api/unknown' },
    res: {},
    url: new URL('http://127.0.0.1/api/unknown'),
    json: (res, status, body) => calls.push({ status, body }),
    serveStatic: () => {
      throw new Error('serveStatic should not be called');
    },
    publicDir: '/tmp',
    currentSession: () => null,
    resolvePagePermission: () => null,
    authUC: { canAccess: () => false }
  });
  assert.equal(handled, true);
  assert.equal(calls[0].status, 404);
  assert.equal(calls[0].body.error, 'Not Found');
});
