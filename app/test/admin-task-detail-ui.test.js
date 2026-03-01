const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin task detail page exposes rollback export actions', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public/admin/task-detail.html');
  const jsFile = path.resolve(__dirname, '..', 'public/admin/task-detail.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');

  assert.equal(html.includes('任务详情'), true);
  assert.equal(html.includes('data-required-permission="admin.tasks.page.overview.read"'), true);
  assert.equal(html.includes('id="downloadRollbackReportBtn"'), true);
  assert.equal(html.includes('id="downloadRollbackPackageBtn"'), true);
  assert.equal(js.includes('/api/admin/tasks/'), true);
  assert.equal(js.includes('/rollback-report'), true);
  assert.equal(js.includes('/rollback-package'), true);
});
