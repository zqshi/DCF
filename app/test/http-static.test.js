const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serveStatic } = require('../src/shared/http');

function serve(publicDir, urlPath) {
  return new Promise((resolve) => {
    const req = { url: urlPath };
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers || {};
      },
      end(payload = '') {
        this.body = String(payload);
        resolve(this);
      }
    };
    serveStatic(publicDir, req, res);
  });
}

test('serveStatic resolves file path without query string', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-static-'));
  fs.mkdirSync(path.join(dir, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'admin', 'login.html'), '<html>login</html>', 'utf8');

  const res = await serve(dir, '/admin/login.html?next=%2Fadmin%2Fskills.html');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /login/);
});
