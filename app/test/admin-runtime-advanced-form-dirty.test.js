const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('runtime advanced page removes skill sedimentation policy section', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public/admin/runtime-advanced.html');
  const jsFile = path.resolve(__dirname, '..', 'public/admin/runtime-advanced.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');
  assert.equal(html.includes('技能沉淀策略'), false);
  assert.equal(html.includes('id="sedimentationReadonlyMode"'), false);
  assert.equal(html.includes('id="sedimentationReadonlyModeExplain"'), false);
  assert.equal(html.includes('href="/admin/skills.html"'), false);
  assert.equal(html.includes('id="saveSedimentationPolicyBtn"'), false);
  assert.equal(js.includes("setText('sedimentationReadonlyMode'"), false);
  assert.equal(js.includes('setPolicyForm('), false);
  assert.equal(js.includes('saveSedimentationPolicyBtn'), false);
});
