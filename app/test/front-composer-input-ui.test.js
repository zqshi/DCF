const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('front composer supports multiline and upload controls without screenshot button', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public/front.html');
  const jsFile = path.resolve(__dirname, '..', 'public/front.js');
  const cssFile = path.resolve(__dirname, '..', 'public/styles.css');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');
  const css = fs.readFileSync(cssFile, 'utf8');

  assert.equal(html.includes('<textarea'), true);
  assert.equal(html.includes('id="goalInput"'), true);
  assert.equal(html.includes('id="uploadAttachmentBtn"'), true);
  assert.equal(html.includes('id="captureScreenshotBtn"'), false);
  assert.equal(html.includes('id="attachmentInput"'), true);
  assert.equal(html.includes('type="file"'), true);
  assert.equal(html.includes('.pdf'), true);
  assert.equal(html.includes('.docx'), true);
  assert.equal(html.includes('.xlsx'), true);
  assert.equal(html.includes('.pptx'), true);
  assert.equal(html.includes('application/pdf'), true);
  assert.equal(html.includes('id="composerAttachments"'), true);

  assert.equal(js.includes('setupComposerInputBehavior()'), true);
  assert.equal(js.includes('setupComposerAttachmentTools()'), true);
  assert.equal(js.includes('buildAttachmentPromptSuffix()'), true);
  assert.equal(js.includes('appendComposerAttachments('), true);

  assert.equal(css.includes('.composer-attachments'), true);
  assert.equal(css.includes('.msg-content'), true);
});
