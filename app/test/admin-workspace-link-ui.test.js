const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('workspace link uses 用户工作台 label and sits above user box', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/auth.js');
  const js = fs.readFileSync(file, 'utf8');

  assert.equal(js.includes("workspaceLink.textContent = '用户工作台';"), true);
  assert.equal(js.includes('sidebar.insertBefore(workspaceLink, userBox);'), true);
  assert.equal(js.includes("'前台工作台'"), false);
});

test('workspace link style follows front-side fs-link visual language', () => {
  const frontCssFile = path.resolve(__dirname, '..', 'public', 'styles.css');
  const adminCssFile = path.resolve(__dirname, '..', 'public/admin', 'layout.css');
  const frontCss = fs.readFileSync(frontCssFile, 'utf8');
  const adminCss = fs.readFileSync(adminCssFile, 'utf8');

  assert.equal(frontCss.includes('.fs-link {'), true);
  assert.equal(frontCss.includes('background: #f0f3f8;'), true);
  assert.equal(frontCss.includes('border-radius: 8px;'), true);

  assert.equal(adminCss.includes('.sidebar-workspace-link {'), true);
  assert.equal(adminCss.includes('background: #f0f3f8;'), true);
  assert.equal(adminCss.includes('border-radius: 8px;'), true);
  assert.equal(adminCss.includes('text-align: center;'), true);
});
