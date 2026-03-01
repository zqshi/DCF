const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tasks entry redirects but runtime entry is a first-class overview page', () => {
  const tasksFile = path.resolve(__dirname, '..', 'public/admin/tasks.html');
  const runtimeFile = path.resolve(__dirname, '..', 'public/admin/runtime.html');
  const tasksHtml = fs.readFileSync(tasksFile, 'utf8');
  const runtimeHtml = fs.readFileSync(runtimeFile, 'utf8');

  assert.equal(tasksHtml.includes("window.location.replace('/admin/tasks-runtime.html');"), true);
  assert.equal(tasksHtml.includes('http-equiv="refresh"'), true);
  assert.equal(tasksHtml.includes('/admin/tasks-runtime.html'), true);

  assert.equal(runtimeHtml.includes("window.location.replace('/admin/runtime-health.html');"), false);
  assert.equal(runtimeHtml.includes('http-equiv="refresh"'), false);
  assert.equal(runtimeHtml.includes('<h1 class="page-title">运行总览</h1>'), true);
  assert.equal(runtimeHtml.includes('id="bootstrapSummary"'), true);
});

test('auth members entry redirects to auth users page', () => {
  const authMembersFile = path.resolve(__dirname, '..', 'public/admin/auth-members.html');
  const html = fs.readFileSync(authMembersFile, 'utf8');
  assert.equal(html.includes("window.location.replace('/admin/auth-users.html');"), true);
  assert.equal(html.includes('http-equiv="refresh"'), true);
});

test('logs entry redirects to agent logs page', () => {
  const logsFile = path.resolve(__dirname, '..', 'public/admin/logs.html');
  const html = fs.readFileSync(logsFile, 'utf8');
  assert.equal(html.includes("window.location.replace('/admin/logs-agent.html');"), true);
  assert.equal(html.includes('http-equiv="refresh"'), true);
});

test('runtime diagnostic secondary pages redirect to runtime overview sections', () => {
  const healthFile = path.resolve(__dirname, '..', 'public/admin/runtime-health.html');
  const cyclesFile = path.resolve(__dirname, '..', 'public/admin/runtime-cycles.html');
  const advancedFile = path.resolve(__dirname, '..', 'public/admin/runtime-advanced.html');
  const healthHtml = fs.readFileSync(healthFile, 'utf8');
  const cyclesHtml = fs.readFileSync(cyclesFile, 'utf8');
  const advancedHtml = fs.readFileSync(advancedFile, 'utf8');

  assert.equal(healthHtml.includes("window.location.replace('/admin/runtime.html?section=health');"), true);
  assert.equal(cyclesHtml.includes("window.location.replace('/admin/runtime.html?section=cycle');"), true);
  assert.equal(advancedHtml.includes("window.location.replace('/admin/runtime.html?section=advanced');"), true);
});

test('prompts and autoevolve pages redirect to strategy center', () => {
  const promptsFile = path.resolve(__dirname, '..', 'public/admin/prompts.html');
  const autoevolveFile = path.resolve(__dirname, '..', 'public/admin/autoevolve.html');
  const promptsHtml = fs.readFileSync(promptsFile, 'utf8');
  const autoevolveHtml = fs.readFileSync(autoevolveFile, 'utf8');
  assert.equal(promptsHtml.includes("window.location.replace('/admin/strategy-center.html#prompt-center');"), true);
  assert.equal(autoevolveHtml.includes("window.location.replace('/admin/strategy-center.html');"), true);
});

test('strategy center prompt area includes rollback controls', () => {
  const strategyFile = path.resolve(__dirname, '..', 'public/admin/strategy-center.html');
  const strategyJsFile = path.resolve(__dirname, '..', 'public/admin/strategy-center.js');
  const html = fs.readFileSync(strategyFile, 'utf8');
  const js = fs.readFileSync(strategyJsFile, 'utf8');

  assert.equal(html.includes('Prompt 回滚设置'), true);
  assert.equal(html.includes('id="promptVersionRows"'), true);
  assert.equal(html.includes('id="refreshPromptVersionsBtn"'), false);
  assert.equal(html.includes('id="strategyToast" class="admin-toast hidden"'), true);
  assert.equal(js.includes('showToast('), true);
  assert.equal(js.includes('rollbackPromptVersion('), true);
  assert.equal(js.includes('/api/admin/prompt-versions/rollback'), true);
  assert.equal(js.includes('/api/admin/prompt-versions/publish'), true);
  assert.equal(js.includes('未检测到变更，无需保存'), true);
  assert.equal(js.includes('基准 Prompt 不能为空'), true);
});
