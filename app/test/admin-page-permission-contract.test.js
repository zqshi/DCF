const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PAGE_ACL } = require('../src/shared/adminAcl');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractRequiredPermission(html) {
  const matched = String(html || '').match(/<body[^>]*data-required-permission="([^"]+)"/i);
  return matched ? String(matched[1] || '').trim() : '';
}

test('admin pages keep body required permission aligned with PAGE_ACL', () => {
  const webRoot = path.resolve(__dirname, '..', 'public');
  const aclMap = new Map(PAGE_ACL.map((item) => [item.path, item.permission]));

  for (const [pagePath, expectedPermission] of aclMap.entries()) {
    const filePath = path.resolve(webRoot, `.${pagePath}`);
    assert.equal(fs.existsSync(filePath), true, `missing admin page file: ${pagePath}`);
    const html = readFile(filePath);
    const requiredPermission = extractRequiredPermission(html);
    assert.equal(
      requiredPermission,
      expectedPermission,
      `body data-required-permission mismatch for ${pagePath}`
    );
  }
});
