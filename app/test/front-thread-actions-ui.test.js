const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('front thread list renders more menu for pin and delete actions', () => {
  const jsFile = path.resolve(__dirname, '..', 'public', 'front.js');
  const cssFile = path.resolve(__dirname, '..', 'public', 'styles.css');
  const js = fs.readFileSync(jsFile, 'utf8');
  const css = fs.readFileSync(cssFile, 'utf8');

  assert.equal(js.includes('threadMenuOpenId'), true);
  assert.equal(js.includes('data-thread-menu-toggle-id="${t.id}"'), true);
  assert.equal(js.includes('class="thread-action-menu ${menuOpen ? "open" : ""}"'), true);
  assert.equal(css.includes('.thread-more-btn'), true);
  assert.equal(css.includes('.thread-action-menu.open'), true);
});
