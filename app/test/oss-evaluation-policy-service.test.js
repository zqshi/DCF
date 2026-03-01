const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OSS_EVALUATION_SCHEMA_VERSION,
  REQUIRED_DIMENSIONS,
  normalizeEvidenceList,
  evaluateDimensionConsistency,
  inferDynamicThresholds,
  evaluateHardGates
} = require('../src/domain/services/OssEvaluationPolicyService');

test('oss evaluation policy service exposes stable schema metadata', () => {
  assert.equal(OSS_EVALUATION_SCHEMA_VERSION, 'oss_evaluation_result.v1');
  assert.equal(REQUIRED_DIMENSIONS.length, 8);
});

test('oss evaluation policy service normalizes evidence and enforces required fields', () => {
  const normalized = normalizeEvidenceList([
    {
      sourceUrl: 'https://github.com/example/repo',
      capturedAt: new Date().toISOString(),
      evidenceExcerpt: 'repo stats'
    },
    {
      sourceUrl: '',
      capturedAt: '',
      evidenceExcerpt: ''
    }
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].sourceUrl, 'https://github.com/example/repo');
});

test('oss evaluation policy service checks 8-dimension consistency', () => {
  const ok = evaluateDimensionConsistency({
    technicalMaturity: 4,
    communityActivity: 4,
    codeQuality: 4,
    documentation: 4,
    licenseCompliance: 4,
    security: 4,
    performance: 3,
    maintainability: 4
  }, 8);
  assert.equal(ok.ok, true);

  const bad = evaluateDimensionConsistency({
    technicalMaturity: 4
  }, 4);
  assert.equal(bad.ok, false);
});

test('oss evaluation policy service applies dynamic thresholds and hard gates', () => {
  const thresholds = inferDynamicThresholds({
    goal: '集成 SDK 组件',
    gapType: 'capability_missing'
  });
  assert.equal(typeof thresholds.minStars, 'number');
  assert.equal(thresholds.minStars >= 300, true);

  const blocked = evaluateHardGates({
    licenseSpdx: 'GPL-3.0',
    stars: 10,
    updateAgeDays: 500,
    criticalVulnerabilities: 1
  }, thresholds);
  assert.equal(blocked.passed, false);
  assert.ok(blocked.reasons.includes('license_incompatible'));
});
