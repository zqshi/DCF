const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin overview main content should avoid cross-page entry links', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/index.html');
  const html = fs.readFileSync(file, 'utf8');
  const mainMatch = html.match(/<main class="content">([\s\S]*?)<\/main>/);
  assert.ok(mainMatch, 'main content block should exist');
  const main = mainMatch[1];

  assert.equal(main.includes('关键入口'), false);
  assert.equal(main.includes('管理动作入口'), false);
  assert.equal(/<div class="quick-links">[\s\S]*?<a href="\/admin\//.test(main), false);
  assert.equal(main.includes('治理态势'), true);
  assert.equal(main.includes('审批待处理'), true);
  assert.equal(main.includes('补偿待处理'), true);
  assert.equal(main.includes('风险与稳定'), true);
});
