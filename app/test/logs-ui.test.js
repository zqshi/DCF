const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('logs entry redirects and split log pages keep structured columns', () => {
  const entryFile = path.resolve(__dirname, '..', 'public/admin/logs.html');
  const agentFile = path.resolve(__dirname, '..', 'public/admin/logs-agent.html');
  const adminFile = path.resolve(__dirname, '..', 'public/admin/logs-admin.html');
  const entryHtml = fs.readFileSync(entryFile, 'utf8');
  const agentHtml = fs.readFileSync(agentFile, 'utf8');
  const adminHtml = fs.readFileSync(adminFile, 'utf8');

  assert.equal(entryHtml.includes("window.location.replace('/admin/logs-agent.html');"), true);
  assert.equal(entryHtml.includes('http-equiv="refresh"'), true);
  assert.equal(agentHtml.includes('data-log-scope'), true);
  assert.equal(adminHtml.includes('data-log-scope'), true);
  assert.equal(agentHtml.includes('id="logDisplayLimit"'), false);
  assert.equal(agentHtml.includes('id="logModuleFilter"'), false);
  assert.equal(agentHtml.includes('id="logPageFilter"'), false);
  assert.equal(agentHtml.includes('id="logOperationFilter"'), true);
  assert.equal(agentHtml.includes('id="logSearchKeyword"'), false);
  assert.equal(agentHtml.includes('class="toolbar-group"'), true);
  assert.equal(agentHtml.includes('id="topLogType"'), false);
  assert.equal(agentHtml.includes('<label for="logOperationFilter">操作</label>'), true);
  assert.equal(adminHtml.includes('id="logDisplayLimit"'), false);
  assert.equal(adminHtml.includes('id="logModuleFilter"'), true);
  assert.equal(adminHtml.includes('id="logPageFilter"'), true);
  assert.equal(adminHtml.includes('id="logOperationFilter"'), true);
  assert.equal(adminHtml.includes('id="logSearchKeyword"'), false);
  assert.equal(adminHtml.includes('id="topLogType"'), false);
  assert.equal(agentHtml.includes('<th>业务模块</th>'), true);
  assert.equal(agentHtml.includes('<th>行为摘要</th>'), true);
  assert.equal(agentHtml.includes('<th>关联对象</th>'), true);
  assert.equal(adminHtml.includes('<th>详情</th>'), true);
});

test('logs pages support module/page/operation cascade filters', () => {
  const jsFile = path.resolve(__dirname, '..', 'public/admin/logs.js');
  const js = fs.readFileSync(jsFile, 'utf8');
  assert.equal(js.includes('viewState.page = resolvePageFilter(viewState.scope);'), true);
  assert.equal(js.includes('viewState.operation = resolveOperationFilter(viewState.scope);'), true);
  assert.equal(js.includes('function filterLogsByPage(rows = [], page = \'all\')'), true);
  assert.equal(js.includes('function filterLogsByOperation(rows = [], operation = \'all\')'), true);
  assert.equal(js.includes('function syncAdminFilterOptions(scopedRows = [])'), true);
  assert.equal(js.includes('function syncAgentFilterOptions(scopedRows = [])'), true);
});
