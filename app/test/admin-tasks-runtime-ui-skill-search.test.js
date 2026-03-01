const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin tasks runtime page shows skill search column', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public/admin/tasks-runtime.html');
  const jsFile = path.resolve(__dirname, '..', 'public/admin/tasks-runtime.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');
  assert.equal(html.includes('<th>技能检索摘要</th>'), true);
  assert.equal(html.includes('<th>任务目标</th>'), true);
  assert.equal(html.includes('<th>Trace ID</th>'), true);
  assert.equal(html.includes('<th>风险等级</th>'), true);
  assert.equal(html.includes('<th>最近事件时间</th>'), true);
  assert.equal(html.includes('<th>执行耗时</th>'), true);
  assert.equal(html.includes('<th>异常信号</th>'), true);
  assert.equal(html.includes('<th>操作</th>'), true);
  assert.equal(js.includes('formatSkillSearch(task)'), true);
  assert.equal(js.includes('find-skills'), true);
  assert.equal(html.includes('id="filterSkillTrigger"'), true);
  assert.equal(html.includes('id="filterFindSkills"'), true);
  assert.equal(js.includes('readFilters()'), true);
  assert.equal(js.includes('applyFilters('), true);
  assert.equal(js.includes('function taskRuntimeConfig(task)'), true);
  assert.equal(js.includes('task && task.runtimeConfig && typeof task.runtimeConfig === \'object\''), true);
  assert.equal(js.includes('/admin/task-detail.html?taskId='), true);
});
