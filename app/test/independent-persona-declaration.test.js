const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultOpenClawSystemPrompt } = require('../src/domain/entities/Employee');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { INDEPENDENT_PERSONA_DECLARATION } = require('../src/shared/independentPersonaDeclaration');

test('employee default system prompt embeds independent persona declaration', () => {
  const prompt = defaultOpenClawSystemPrompt({
    name: 'Checker',
    department: 'Ops',
    role: 'Operator',
    riskLevel: 'L2'
  });
  assert.equal(prompt.includes('【系统声明：独立人格行为范式】'), true);
  assert.equal(prompt.includes('禁止编造结果'), true);
});

test('platform default prompt center includes independent persona declaration', () => {
  const store = new InMemoryStore();
  const content = String((((store.promptCenter || {}).layers || {}).platform || {}).content || '');
  assert.equal(content.includes(INDEPENDENT_PERSONA_DECLARATION), true);
});
