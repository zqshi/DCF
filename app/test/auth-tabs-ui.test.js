const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('auth users page no longer renders users/roles tab controls', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/auth-users.html');
  const html = fs.readFileSync(file, 'utf8');
  assert.equal(html.includes('data-auth-tab="users"'), false);
  assert.equal(html.includes('id="authTabUsers"'), false);
  assert.equal(html.includes('id="authTabRoles"'), false);
});
