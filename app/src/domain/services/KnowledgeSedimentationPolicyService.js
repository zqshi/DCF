function normalizeKnowledgeSedimentationPolicy(policy = {}) {
  const src = policy && typeof policy === 'object' ? policy : {};
  const mode = String(src.mode || '').trim().toLowerCase();
  const promotionMode = String(src.promotionMode || '').trim().toLowerCase();
  const minConfidenceRaw = Number(src.minConfidence);
  const autoApproveRaw = Number(src.minQualityScoreForAutoApprove);
  const reviewRaw = Number(src.minQualityScoreForReviewQueue);

  return {
    mode: ['rules', 'model_driven', 'hybrid'].includes(mode) ? mode : 'hybrid',
    promotionMode: ['direct', 'proposal'].includes(promotionMode) ? promotionMode : 'proposal',
    minConfidence: Number.isFinite(minConfidenceRaw) ? Math.max(0, Math.min(1, minConfidenceRaw)) : 0.7,
    minQualityScoreForAutoApprove: Number.isFinite(autoApproveRaw) ? Math.max(0, Math.min(100, autoApproveRaw)) : 85,
    minQualityScoreForReviewQueue: Number.isFinite(reviewRaw) ? Math.max(0, Math.min(100, reviewRaw)) : 60,
    fallbackToRulesWhenModelUnavailable: Boolean(src.fallbackToRulesWhenModelUnavailable !== false),
    updatedAt: src.updatedAt || null,
    updatedBy: src.updatedBy || 'system'
  };
}

function decideKnowledgeCandidateOutcome(candidate = {}, policy = {}) {
  const normalized = normalizeKnowledgeSedimentationPolicy(policy);
  const qualityScore = Number(candidate.qualityScore || 0);
  const confidence = Number(candidate.confidence || 0);
  if (qualityScore >= normalized.minQualityScoreForAutoApprove && confidence >= normalized.minConfidence) {
    return { status: 'approved', reason: 'auto_approved_by_score' };
  }
  if (qualityScore >= normalized.minQualityScoreForReviewQueue) {
    return { status: 'pending_review', reason: 'queued_for_review' };
  }
  return { status: 'rejected', reason: 'below_review_threshold' };
}

module.exports = {
  normalizeKnowledgeSedimentationPolicy,
  decideKnowledgeCandidateOutcome
};
