const { createHash } = require('crypto');
const { createKnowledgeCandidate } = require('../../domain/entities/KnowledgeCandidate');
const {
  normalizeKnowledgeSedimentationPolicy,
  decideKnowledgeCandidateOutcome
} = require('../../domain/services/KnowledgeSedimentationPolicyService');

function normalizeText(value) {
  return String(value || '').trim();
}

class KnowledgeSedimentationUseCases {
  constructor(store, knowledgeUC, options = {}) {
    this.store = store;
    this.knowledgeUC = knowledgeUC;
    this.dialogueGateway = options.dialogueGateway || null;
  }

  ensureCollections() {
    if (!Array.isArray(this.store.knowledgeCandidates)) this.store.knowledgeCandidates = [];
    if (!Array.isArray(this.store.knowledgeReviewQueue)) this.store.knowledgeReviewQueue = [];
    if (!this.store.metrics || typeof this.store.metrics !== 'object') this.store.metrics = {};
    if (!this.store.metrics.knowledgeSedimentation || typeof this.store.metrics.knowledgeSedimentation !== 'object') {
      this.store.metrics.knowledgeSedimentation = {
        autoPublished: 0,
        queuedForReview: 0,
        rejected: 0,
        reviewedApproved: 0,
        reviewedRejected: 0,
        skippedDisabled: 0,
        deduplicated: 0
      };
    }
    if (!this.store.knowledgeSedimentationPolicy || typeof this.store.knowledgeSedimentationPolicy !== 'object') {
      this.store.knowledgeSedimentationPolicy = normalizeKnowledgeSedimentationPolicy({});
    }
  }

  isEnabled() {
    return String(process.env.KNOWLEDGE_AUTO_SEDIMENTATION_ENABLED || '0').trim() === '1';
  }

  getPolicy() {
    this.ensureCollections();
    return normalizeKnowledgeSedimentationPolicy(this.store.knowledgeSedimentationPolicy || {});
  }

  buildFingerprint(input = {}) {
    const raw = [
      normalizeText(input.employeeId),
      normalizeText(input.title).toLowerCase(),
      normalizeText(input.content).slice(0, 800).toLowerCase()
    ].join('|');
    return createHash('sha1').update(raw).digest('hex');
  }

  hasDuplicateCandidate(fingerprint) {
    return this.store.knowledgeCandidates.some((item) => item && item.fingerprint === fingerprint);
  }

  hasDuplicateAsset(employeeId, title) {
    const normalizedTitle = normalizeText(title).toLowerCase();
    return (this.store.knowledgeAssets || []).some((item) => (
      item
      && item.employeeId === employeeId
      && String(item.title || '').trim().toLowerCase() === normalizedTitle
      && String(item.lifecycleStatus || 'active') !== 'retired'
    ));
  }

  async inferModelConfidence(task, employee, result) {
    if (!(this.dialogueGateway && typeof this.dialogueGateway.isEnabled === 'function' && this.dialogueGateway.isEnabled())) {
      return 0;
    }
    const prompt = [
      '你是知识沉淀质量评估器。只输出 JSON。',
      `task: ${String(task.goal || '').slice(0, 240)}`,
      `employee department: ${String((employee && employee.department) || '').slice(0, 80)}`,
      `employee role: ${String((employee && employee.role) || '').slice(0, 80)}`,
      `result: ${String(result || '').slice(0, 1200)}`,
      '输出字段：confidence(0-1), summary(string <=120), title(string <=60)'
    ].join('\n');
    const raw = await this.dialogueGateway.generateReply({
      goal: prompt,
      riskLevel: task.riskLevel,
      llmConfig: task.llmConfig || {},
      employee
    });
    const text = String(raw || '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return { confidence: 0 };
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      const confidence = Number(parsed.confidence);
      return {
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
        title: normalizeText(parsed.title).slice(0, 60),
        summary: normalizeText(parsed.summary).slice(0, 120)
      };
    } catch {
      return { confidence: 0 };
    }
  }

  heuristicQualityScore(result = '') {
    const text = String(result || '').trim();
    if (!text) return 0;
    let score = 40;
    if (text.length >= 80) score += 20;
    if (text.length >= 180) score += 10;
    if (/根据|依据|evidence|risk|建议|下一步|步骤/i.test(text)) score += 15;
    if (/TODO|unknown|无法|不确定/i.test(text)) score -= 15;
    return Math.max(0, Math.min(100, score));
  }

  buildCandidate(task, employee, result, model = {}) {
    const baseTitle = `TaskLearning:${String(task.goal || '').trim().slice(0, 48)}`;
    const title = normalizeText(model.title) || baseTitle;
    const summary = normalizeText(model.summary) || String(result || '').trim().slice(0, 200);
    const confidence = Number.isFinite(Number(model.confidence)) ? Number(model.confidence) : 0;
    const qualityScore = this.heuristicQualityScore(result);
    const fingerprint = this.buildFingerprint({ employeeId: employee.id, title, content: result });
    return createKnowledgeCandidate({
      employeeId: employee.id,
      taskId: task.id,
      traceId: task.traceId || null,
      title,
      content: String(result || '').trim(),
      summary,
      sourceType: 'task_result',
      confidence,
      qualityScore,
      evidence: [{ source: `task://${task.id}`, capturedAt: new Date().toISOString() }],
      fingerprint
    });
  }

  eventPayload(task, employee, extra = {}) {
    return {
      traceId: task.traceId || null,
      taskId: task.id,
      employeeId: employee.id,
      tenantId: task.tenantId || employee.tenantId || null,
      accountId: task.accountId || employee.accountId || null,
      ...extra
    };
  }

  async publishCandidate(candidate, task, employee, actorUserId = 'system') {
    if (!(this.knowledgeUC && typeof this.knowledgeUC.ingestManual === 'function')) {
      return { published: false, reason: 'knowledge_uc_unavailable' };
    }
    const published = await this.knowledgeUC.ingestManual({
      employeeId: candidate.employeeId,
      taskId: candidate.taskId,
      traceId: candidate.traceId,
      title: candidate.title,
      content: candidate.content,
      status: 'publish',
      qualityScore: candidate.qualityScore,
      curatedBy: actorUserId,
      actorUserId,
      department: employee.department,
      role: employee.role
    });
    candidate.knowledgeAssetId = published && published.asset ? String(published.asset.id || '') : null;
    return { published: true, result: published };
  }

  async processTaskSuccess({ task, employee, result }) {
    this.ensureCollections();
    if (!this.isEnabled()) {
      this.store.metrics.knowledgeSedimentation.skippedDisabled += 1;
      return { skipped: true, reason: 'disabled' };
    }
    const text = String(result || '').trim();
    if (!text) return { skipped: true, reason: 'empty_result' };

    let model = { confidence: 0 };
    try {
      model = await this.inferModelConfidence(task, employee, text);
    } catch {
      model = { confidence: 0 };
    }

    const candidate = this.buildCandidate(task, employee, text, model);
    if (this.hasDuplicateCandidate(candidate.fingerprint) || this.hasDuplicateAsset(employee.id, candidate.title)) {
      this.store.metrics.knowledgeSedimentation.deduplicated += 1;
      this.store.addEvent('knowledge.sedimentation.deduplicated', this.eventPayload(task, employee, {
        title: candidate.title,
        fingerprint: candidate.fingerprint
      }));
      return { skipped: true, reason: 'deduplicated' };
    }

    this.store.knowledgeCandidates.unshift(candidate);
    this.store.knowledgeCandidates = this.store.knowledgeCandidates.slice(0, 5000);
    this.store.addEvent('knowledge.sedimentation.candidate.created', this.eventPayload(task, employee, {
      candidateId: candidate.id,
      qualityScore: candidate.qualityScore,
      confidence: candidate.confidence,
      title: candidate.title
    }));

    const policy = this.getPolicy();
    const decision = decideKnowledgeCandidateOutcome(candidate, policy);
    candidate.status = decision.status;
    candidate.decisionReason = decision.reason;
    candidate.updatedAt = new Date().toISOString();

    if (decision.status === 'approved' && policy.promotionMode === 'direct') {
      const publish = await this.publishCandidate(candidate, task, employee, 'system:auto');
      if (publish.published) {
        this.store.metrics.knowledgeSedimentation.autoPublished += 1;
        this.store.addEvent('knowledge.sedimentation.auto.published', this.eventPayload(task, employee, {
          candidateId: candidate.id,
          knowledgeAssetId: candidate.knowledgeAssetId,
          qualityScore: candidate.qualityScore,
          confidence: candidate.confidence
        }));
        return { candidate, decision, published: true };
      }
    }

    if (decision.status === 'approved' || decision.status === 'pending_review') {
      candidate.status = 'pending_review';
      const exists = this.store.knowledgeReviewQueue.some((item) => (
        item && String(item.id || '') === String(candidate.id || '')
      ));
      if (!exists) {
        this.store.knowledgeReviewQueue.unshift({
          id: candidate.id,
          candidateId: candidate.id,
          employeeId: candidate.employeeId,
          taskId: candidate.taskId,
          createdAt: new Date().toISOString()
        });
        this.store.knowledgeReviewQueue = this.store.knowledgeReviewQueue.slice(0, 5000);
      }
      this.store.metrics.knowledgeSedimentation.queuedForReview += 1;
      this.store.addEvent('knowledge.sedimentation.review.queued', this.eventPayload(task, employee, {
        candidateId: candidate.id,
        qualityScore: candidate.qualityScore,
        confidence: candidate.confidence,
        reason: decision.reason
      }));
      return { candidate, decision, published: false };
    }

    this.store.metrics.knowledgeSedimentation.rejected += 1;
    this.store.addEvent('knowledge.sedimentation.rejected', this.eventPayload(task, employee, {
      candidateId: candidate.id,
      qualityScore: candidate.qualityScore,
      confidence: candidate.confidence,
      reason: decision.reason
    }));
    return { candidate, decision, published: false };
  }

  listCandidates(filters = {}) {
    this.ensureCollections();
    const employeeId = normalizeText(filters.employeeId);
    const status = normalizeText(filters.status);
    return this.store.knowledgeCandidates.filter((item) => {
      if (employeeId && item.employeeId !== employeeId) return false;
      if (status && item.status !== status) return false;
      return true;
    });
  }

  async reviewCandidate(candidateId, input = {}, actor = {}) {
    this.ensureCollections();
    const id = normalizeText(candidateId);
    const candidate = this.store.knowledgeCandidates.find((item) => item.id === id);
    if (!candidate) {
      const error = new Error('knowledge candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const action = String(input.action || input.reviewStatus || '').trim().toLowerCase();
    if (!['approved', 'rejected'].includes(action)) {
      const error = new Error('action must be approved or rejected');
      error.statusCode = 400;
      throw error;
    }

    const task = this.store.tasks.find((item) => item.id === candidate.taskId) || { id: candidate.taskId, traceId: candidate.traceId };
    const employee = this.store.employees.find((item) => item.id === candidate.employeeId) || { id: candidate.employeeId };
    const actorUserId = normalizeText(actor.userId || actor.actorId || 'system');

    candidate.reviewedBy = actorUserId;
    candidate.reviewedAt = new Date().toISOString();
    candidate.updatedAt = candidate.reviewedAt;

    if (action === 'approved') {
      const publish = await this.publishCandidate(candidate, task, employee, actorUserId);
      if (publish.published) {
        candidate.status = 'approved';
        this.store.metrics.knowledgeSedimentation.reviewedApproved += 1;
      }
    } else {
      candidate.status = 'rejected';
      this.store.metrics.knowledgeSedimentation.reviewedRejected += 1;
    }

    this.store.knowledgeReviewQueue = this.store.knowledgeReviewQueue.filter((item) => (
      String((item && item.candidateId) || (item && item.id) || '') !== String(candidate.id || '')
    ));
    this.store.addEvent('knowledge.sedimentation.reviewed', this.eventPayload(task, employee, {
      candidateId: candidate.id,
      status: candidate.status,
      reviewedBy: actorUserId
    }));
    return candidate;
  }
}

module.exports = {
  KnowledgeSedimentationUseCases
};
