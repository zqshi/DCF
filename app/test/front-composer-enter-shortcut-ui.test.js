const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('front composer enter shortcut mapping uses platform-specific newline modifier', () => {
  const jsFile = path.resolve(__dirname, '..', 'public', 'front.js');
  const js = fs.readFileSync(jsFile, 'utf8');

  assert.equal(js.includes('event.isComposing'), true);
  assert.equal(js.includes('navigator.platform'), true);
  assert.equal(js.includes('isMac ? event.metaKey : event.ctrlKey'), true);
  assert.equal(js.includes('setRangeText("\\n"'), true);
  assert.equal(js.includes('form.requestSubmit()'), true);
  assert.equal(js.includes('if (event.shiftKey) return;'), false);
});
