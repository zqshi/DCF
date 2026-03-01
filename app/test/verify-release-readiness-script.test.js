const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSteps, parseArgs } = require('../scripts/verify-release-readiness');

test('verify-release-readiness includes tests by default', () => {
  const args = parseArgs([]);
  const steps = buildSteps(args);
  assert.equal(args.skipTests, false);
  assert.equal(Array.isArray(steps), true);
  assert.equal(steps[0].name, 'unit-and-integration-tests');
  assert.equal(steps.some((x) => x.name === 'openclaw-alignment'), true);
  assert.equal(steps.some((x) => x.name === 'composite-consistency'), true);
});

test('verify-release-readiness allows skipping tests explicitly', () => {
  const args = parseArgs(['--skip-tests']);
  const steps = buildSteps(args);
  assert.equal(args.skipTests, true);
  assert.equal(Array.isArray(steps), true);
  assert.equal(steps.some((x) => x.name === 'unit-and-integration-tests'), false);
});

test('verify-release-readiness can include browser capability gate when enabled', () => {
  const prevBase = process.env.OPENCLAW_BASE_URL;
  const prevFlag = process.env.DCF_VERIFY_BROWSER_CAPABILITY;
  process.env.OPENCLAW_BASE_URL = 'http://127.0.0.1:18789';
  process.env.DCF_VERIFY_BROWSER_CAPABILITY = '1';
  try {
    const args = parseArgs([]);
    const steps = buildSteps(args);
    assert.equal(steps.some((x) => x.name === 'openclaw-contract'), true);
    assert.equal(steps.some((x) => x.name === 'browser-capability'), true);
  } finally {
    if (typeof prevBase === 'undefined') delete process.env.OPENCLAW_BASE_URL;
    else process.env.OPENCLAW_BASE_URL = prevBase;
    if (typeof prevFlag === 'undefined') delete process.env.DCF_VERIFY_BROWSER_CAPABILITY;
    else process.env.DCF_VERIFY_BROWSER_CAPABILITY = prevFlag;
  }
});
