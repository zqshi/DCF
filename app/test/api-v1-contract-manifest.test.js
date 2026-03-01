const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/interfaces/http/createApp');

test('api v1 critical contract manifest routes stay reachable', async () => {
  const manifestPath = path.resolve(__dirname, '../contracts/api-v1-critical.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, 'v1');
  assert.equal(Array.isArray(manifest.routes), true);

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    for (const route of manifest.routes) {
      const method = String(route.method || 'GET');
      const pathName = String(route.path || '');
      const response = await fetch(`${base}${pathName}`, { method });
      assert.notEqual(response.status, 404, `${method} ${pathName} should not be 404`);
      assert.equal(response.headers.get('x-api-version'), 'v1', `${method} ${pathName} should expose x-api-version=v1`);
    }
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
