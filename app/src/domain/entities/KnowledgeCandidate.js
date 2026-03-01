const { randomUUID } = require('crypto');

function normalizeText(value, maxLen = 2000) {
  return String(value || '').trim().slice(0, maxLen);
}

function normalizeScore(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function normalizeConfidence(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function createKnowledgeCandidate(input = {}) {
  const employeeId = normalizeText(input.employeeId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const title = normalizeText(input.title, 160);
  const content = normalizeText(input.content, 12000);
  if (!employeeId) throw new Error('employeeId is required for knowledge candidate');
  if (!taskId) throw new Error('taskId is required for knowledge candidate');
  if (!title) throw new Error('title is required for knowledge candidate');
  if (!content) throw new Error('content is required for knowledge candidate');

  const now = new Date().toISOString();
  return {
    id: String(input.id || `knowledge-candidate-${randomUUID()}`),
    employeeId,
    taskId,
    traceId: normalizeText(input.traceId, 120) || null,
    title,
    content,
    summary: normalizeText(input.summary, 500),
    sourceType: normalizeText(input.sourceType, 40) || 'task_result',
    confidence: normalizeConfidence(input.confidence, 0),
    qualityScore: normalizeScore(input.qualityScore, 0),
    status: normalizeText(input.status, 40) || 'candidate',
    decisionReason: normalizeText(input.decisionReason, 500) || '',
    evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 10) : [],
    fingerprint: normalizeText(input.fingerprint, 120) || null,
    reviewedBy: normalizeText(input.reviewedBy, 80) || null,
    reviewedAt: normalizeText(input.reviewedAt, 40) || null,
    knowledgeAssetId: normalizeText(input.knowledgeAssetId, 120) || null,
    createdAt: normalizeText(input.createdAt, 40) || now,
    updatedAt: normalizeText(input.updatedAt, 40) || now
  };
}

module.exports = {
  createKnowledgeCandidate,
  normalizeScore,
  normalizeConfidence
};
