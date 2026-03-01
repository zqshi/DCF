const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin tasks governance page includes readable ledger fields and filters', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public/admin/tasks-governance.html');
  const jsFile = path.resolve(__dirname, '..', 'public/admin/tasks-governance.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');
  assert.equal(html.includes('任务治理台账'), true);
  assert.equal(html.includes('id="filterIncidentFocus"'), true);
  assert.equal(html.includes('id="filterApprovalType"'), true);
  assert.equal(html.includes('id="filterCompensationStatus"'), true);
  assert.equal(html.includes('<th>任务概览</th>'), true);
  assert.equal(html.includes('<th>待处理信号</th>'), true);
  assert.equal(html.includes('<th>详情</th>'), false);
  assert.equal(html.includes('<th>Trace ID</th>'), true);
  assert.equal(html.includes('<th>审批进度</th>'), true);
  assert.equal(html.includes('<th>补偿状态</th>'), true);
  assert.equal(html.includes('<th>最近治理动作</th>'), true);
  assert.equal(html.includes('<th>责任角色</th>'), true);
  assert.equal(html.includes('<th>操作</th>'), true);
  assert.equal(js.includes('readFilters()'), true);
  assert.equal(js.includes('applyFilters('), true);
  assert.equal(js.includes('needsAttention(task)'), true);
  assert.equal(js.includes('renderRows(rows)'), true);
  assert.equal(js.includes('inlineDetailMarkup('), true);
  assert.equal(js.includes('data-task-id'), true);
  assert.equal(js.includes('data-task-detail'), false);
  assert.equal(js.includes('sortByPriority('), true);
  assert.equal(js.includes('taskPriority(task)'), true);
  assert.equal(js.includes('approvalProgress(task)'), true);
  assert.equal(js.includes('业务意图'), true);
  assert.equal(js.includes('describeWhyHappened(task)'), true);
  assert.equal(js.includes('describeCompensation(task)'), true);
  assert.equal(js.includes('/admin/task-detail.html?taskId='), true);
});

test('admin html pages use unified admin-select class for dropdowns', () => {
  const files = [
    'employees.html',
    'auth-users.html',
    'tools.html',
    'runtime-advanced.html',
    'logs-admin.html',
    'logs-agent.html',
    'tasks-runtime.html',
    'tasks-governance.html'
  ].map((name) => path.resolve(__dirname, '..', 'public/admin', name));
  files.forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');
    const selectMatches = html.match(/<select\b/g) || [];
    const classMatches = html.match(/<select class="admin-select"/g) || [];
    assert.equal(classMatches.length, selectMatches.length, `select class mismatch in ${path.basename(file)}`);
  });
});
