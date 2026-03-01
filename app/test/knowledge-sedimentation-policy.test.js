const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeKnowledgeSedimentationPolicy,
  decideKnowledgeCandidateOutcome
} = require('../src/domain/services/KnowledgeSedimentationPolicyService');

test('knowledge sedimentation policy normalizes defaults and bounds', () => {
  const policy = normalizeKnowledgeSedimentationPolicy({
    mode: 'unknown',
    promotionMode: 'x',
    minConfidence: 2,
    minQualityScoreForAutoApprove: 300,
    minQualityScoreForReviewQueue: -5
  });

  assert.equal(policy.mode, 'hybrid');
  assert.equal(policy.promotionMode, 'proposal');
  assert.equal(policy.minConfidence, 1);
  assert.equal(policy.minQualityScoreForAutoApprove, 100);
  assert.equal(policy.minQualityScoreForReviewQueue, 0);
});

test('knowledge sedimentation decision returns approved pending_review rejected', () => {
  const policy = normalizeKnowledgeSedimentationPolicy({
    minConfidence: 0.6,
    minQualityScoreForAutoApprove: 80,
    minQualityScoreForReviewQueue: 50
  });

  assert.equal(decideKnowledgeCandidateOutcome({ qualityScore: 90, confidence: 0.7 }, policy).status, 'approved');
  assert.equal(decideKnowledgeCandidateOutcome({ qualityScore: 70, confidence: 0.1 }, policy).status, 'pending_review');
  assert.equal(decideKnowledgeCandidateOutcome({ qualityScore: 40, confidence: 0.9 }, policy).status, 'rejected');
});
