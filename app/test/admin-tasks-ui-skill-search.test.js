const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin tasks detail renderer includes skill search section', () => {
  const file = path.resolve(__dirname, '..', 'public/admin/tasks.js');
  const js = fs.readFileSync(file, 'utf8');
  assert.equal(js.includes('【技能搜索】'), true);
  assert.equal(js.includes('skillSearch.trigger'), true);
  assert.equal(js.includes('skillSearch.query'), true);
  assert.equal(js.includes('skillSearch.topSkills'), true);
  assert.equal(js.includes('Session Key'), false);
  assert.equal(js.includes('SessionKey：'), false);
  assert.equal(js.includes('runtime.sessionKey:'), false);
  assert.equal(js.includes('function resolveEmployeeRuntimeProfile(task)'), true);
  assert.equal(js.includes('function sanitizeTaskPayloadForDisplay(task = {})'), true);
  assert.equal(js.includes('task.runtimeConfig && typeof task.runtimeConfig === \'object\''), true);
  assert.equal(js.includes('if (employee.runtimeProfile && typeof employee.runtimeProfile === \'object\') return employee.runtimeProfile;'), true);
});
