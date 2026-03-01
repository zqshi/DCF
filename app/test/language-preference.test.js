const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLanguagePreference, buildLanguageInstruction } = require('../src/shared/languagePreference');

test('resolve language preference returns zh for chinese input', () => {
  assert.equal(resolveLanguagePreference('请帮我总结今天异常', []), 'zh');
  assert.equal(buildLanguageInstruction('zh').includes('简体中文'), true);
});

test('resolve language preference returns en for english input', () => {
  assert.equal(resolveLanguagePreference('Please summarize today incidents', []), 'en');
  assert.equal(buildLanguageInstruction('en').includes('reply in English'), true);
});

test('resolve language preference prefers latest user turn in history', () => {
  const preference = resolveLanguagePreference('请继续', [
    { role: 'user', content: '请先中文说明' },
    { role: 'assistant', content: '好的' },
    { role: 'user', content: 'Switch to English and continue' }
  ]);
  assert.equal(preference, 'en');
});
