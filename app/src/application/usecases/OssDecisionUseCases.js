const { evaluateRepos } = require('../../domain/services/OssEvaluationService');
const {
  OSS_EVALUATION_SCHEMA_VERSION,
  REQUIRED_DIMENSIONS,
  normalizeEvidenceList,
  normalizeDimensionScores,
  evaluateDimensionConsistency,
  inferDynamicThresholds,
  evaluateHardGates,
  computeWeightedScore
} = require('../../domain/services/OssEvaluationPolicyService');

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

class OssDecisionUseCases {
  constructor(store, gateway, options = {}) {
    this.store = store;
    this.gateway = gateway;
    this.dialogueGateway = options.dialogueGateway || null;
  }

  ensureCollections() {
    if (!Array.isArray(this.store.ossCases)) this.store.ossCases = [];
    if (!Array.isArray(this.store.ossCandidateEvaluations)) this.store.ossCandidateEvaluations = [];
    if (!Array.isArray(this.store.ossBuildVsBuyAssessments)) this.store.ossBuildVsBuyAssessments = [];
  }

  eventPayload(task = {}, employee = {}, extra = {}) {
    return {
      traceId: task.traceId || null,
      taskId: task.id || null,
      employeeId: employee.id || task.employeeId || null,
      ...extra
    };
  }

  extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  buildGapInferencePrompt(task, employee, outcome) {
    const skills = Array.isArray(employee && employee.linkedSkillIds) ? employee.linkedSkillIds.length : 0;
    const knowledge = Array.isArray(employee && employee.knowledge) ? employee.knowledge.length : 0;
    const capabilities = Array.isArray(employee && employee.capabilities) ? employee.capabilities.join(', ') : '';
    const runtimeEvidence = outcome && outcome.source ? String(outcome.source) : 'unknown';
    const errorMessage = outcome && outcome.error ? normalizeText(outcome.error.message || '') : '';
    return [
      '你是企业数字员工的任务内化诊断器。',
      '请基于任务执行结果判断是否存在“组织内部缺口”，并严格输出 JSON 对象，不要输出解释。',
      `任务目标: ${normalizeText(task.goal)}`,
      `任务状态: ${normalizeText(outcome && outcome.status)}`,
      `失败信息: ${errorMessage || 'none'}`,
      `执行来源: ${runtimeEvidence}`,
      `员工部门: ${normalizeText(employee && employee.department)}`,
      `员工角色: ${normalizeText(employee && employee.role)}`,
      `已绑定技能数: ${skills}`,
      `知识条目数: ${knowledge}`,
      `能力关键词: ${capabilities || 'none'}`,
      'JSON 字段：',
      'hasGap(boolean), gapType(infra_missing|product_missing|capability_missing), gapSummary(string), missingCapabilities(string[]), demandFingerprint(string), confidence(number 0-1), researchQuery(string), rationale(string)',
      '规则：如果没有明显缺口，hasGap=false，confidence<=0.4。'
    ].join('\n');
  }

  heuristicGapInference(task, employee, outcome) {
    const goal = normalizeText(task && task.goal).toLowerCase();
    const errorMessage = normalizeText(outcome && outcome.error && outcome.error.message).toLowerCase();
    const failed = String(outcome && outcome.status || '') === 'failed';
    const corrected = Boolean(outcome && outcome.corrected);
    const missingSignal = (
      errorMessage.includes('unavailable')
      || errorMessage.includes('missing')
      || errorMessage.includes('not found')
      || goal.includes('集成')
      || goal.includes('sdk')
      || goal.includes('infra')
      || goal.includes('部署')
    );
    if (!(failed || corrected || missingSignal)) {
      return {
        hasGap: false,
        gapType: 'capability_missing',
        gapSummary: '',
        missingCapabilities: [],
        demandFingerprint: '',
        confidence: 0.3,
        researchQuery: '',
        rationale: 'no_gap_signal'
      };
    }
    const gapType = goal.includes('部署') || goal.includes('infra') ? 'infra_missing' : 'capability_missing';
    const dept = normalizeText(employee && employee.department);
    const role = normalizeText(employee && employee.role);
    const fingerprint = `${dept}:${role}:${goal.slice(0, 48)}`.toLowerCase();
    return {
      hasGap: true,
      gapType,
      gapSummary: errorMessage || `任务执行暴露缺口：${normalizeText(task.goal).slice(0, 80)}`,
      missingCapabilities: [],
      demandFingerprint: fingerprint,
      confidence: corrected ? 0.82 : 0.74,
      researchQuery: `${dept} ${role} ${normalizeText(task.goal)}`.slice(0, 120),
      rationale: 'heuristic_gap_detected'
    };
  }

  normalizeInference(inference, task, employee) {
    const data = (inference && typeof inference === 'object') ? inference : {};
    const gapType = ['infra_missing', 'product_missing', 'capability_missing'].includes(String(data.gapType || ''))
      ? String(data.gapType)
      : 'capability_missing';
    const confidence = Math.max(0, Math.min(1, toNumber(data.confidence, 0)));
    const demandFingerprint = normalizeText(data.demandFingerprint)
      || `${normalizeText(employee.department)}:${normalizeText(employee.role)}:${normalizeText(task.goal).slice(0, 48)}`.toLowerCase();
    return {
      hasGap: Boolean(data.hasGap),
      gapType,
      gapSummary: normalizeText(data.gapSummary).slice(0, 240),
      missingCapabilities: Array.isArray(data.missingCapabilities)
        ? data.missingCapabilities.map((x) => normalizeText(x)).filter(Boolean).slice(0, 8)
        : [],
      demandFingerprint,
      confidence,
      researchQuery: normalizeText(data.researchQuery).slice(0, 120),
      rationale: normalizeText(data.rationale).slice(0, 500) || 'inferred'
    };
  }

  async inferCapabilityGap(task, employee, outcome) {
    let parsed = null;
    if (this.dialogueGateway && typeof this.dialogueGateway.isEnabled === 'function' && this.dialogueGateway.isEnabled()) {
      const raw = await this.dialogueGateway.generateReply({
        goal: this.buildGapInferencePrompt(task, employee, outcome),
        employee
      });
      parsed = this.extractJsonObject(raw);
    }
    const normalized = this.normalizeInference(parsed || this.heuristicGapInference(task, employee, outcome), task, employee);
    return normalized;
  }

  hasCaseForIteration(task) {
    return this.store.ossCases.some((x) => x.taskId === task.id && Number(x.iteration || 0) === Number(task.iteration || 0));
  }

  createCase(task, employee, inference) {
    this.ensureCollections();
    const now = new Date().toISOString();
    const created = {
      id: `${task.id}-oss-case-${Date.now()}`,
      taskId: task.id,
      employeeId: employee.id,
      iteration: Number(task.iteration || 0),
      gapType: inference.gapType,
      gapSummary: inference.gapSummary || normalizeText(task.goal).slice(0, 120),
      demandFingerprint: inference.demandFingerprint,
      status: 'identified',
      recommendation: 'defer',
      rationale: inference.rationale || '',
      confidence: inference.confidence,
      userConfirmation: {
        required: false,
        status: 'not_required',
        requestedAt: null,
        requestedBy: null,
        confirmedAt: null,
        confirmedBy: null,
        note: ''
      },
      review: {
        nextReviewAt: new Date(Date.now() + 90 * 86400000).toISOString(),
        lifecycleStatus: 'active',
        retireReason: null,
        reviewedAt: null
      },
      createdAt: now,
      updatedAt: now
    };
    this.store.ossCases.unshift(created);
    this.store.ossCases = this.store.ossCases.slice(0, 300);
    this.store.addEvent('oss.case.identified', this.eventPayload(task, employee, {
      caseId: created.id,
      gapType: created.gapType,
      demandFingerprint: created.demandFingerprint,
      confidence: created.confidence
    }));
    return created;
  }

  requestUserConfirmation(caseItem, task = {}, employee = {}, requestedBy = 'system:auto') {
    if (!caseItem || !['introduce_oss', 'build_in_house'].includes(String(caseItem.recommendation || ''))) return;
    const now = new Date().toISOString();
    if (!caseItem.userConfirmation || typeof caseItem.userConfirmation !== 'object') {
      caseItem.userConfirmation = {};
    }
    const alreadyPending = caseItem.userConfirmation.required === true
      && String(caseItem.userConfirmation.status || '') === 'pending';
    caseItem.userConfirmation.required = true;
    caseItem.userConfirmation.status = 'pending';
    caseItem.userConfirmation.requestedAt = caseItem.userConfirmation.requestedAt || now;
    caseItem.userConfirmation.requestedBy = requestedBy;
    caseItem.userConfirmation.note = normalizeText(caseItem.rationale || '').slice(0, 500);
    caseItem.updatedAt = now;
    if (alreadyPending) return;
    this.store.addEvent('oss.case.user_confirmation.required', this.eventPayload(task, employee, {
      caseId: caseItem.id,
      recommendation: caseItem.recommendation,
      rationale: caseItem.rationale || '',
      gapType: caseItem.gapType || '',
      gapSummary: caseItem.gapSummary || '',
      confidence: Number(caseItem.confidence || 0)
    }));
  }

  evaluateCandidateSignals(candidate, thresholds) {
    const risks = [];
    const license = String(candidate.license || 'UNKNOWN').toUpperCase();
    if (!license || license === 'UNKNOWN' || license === 'NOASSERTION') risks.push('license_unknown');
    const days = Math.max(0, Math.round((Date.now() - Date.parse(candidate.updatedAt || new Date().toISOString())) / 86400000));
    if (days > 365) risks.push('stale_maintenance');
    const compatibility = candidate.score && candidate.score.keyword > 0 ? 78 : 62;
    const security = risks.includes('license_unknown') ? 50 : 75;
    const operability = days > 180 ? 58 : 74;
    const tco = risks.length > 1 ? 55 : 72;
    const hardGate = evaluateHardGates({
      licenseSpdx: candidate.license,
      stars: candidate.stars,
      updateAgeDays: candidate.updateAgeDays || days,
      criticalVulnerabilities: candidate.criticalVulnerabilities || 0
    }, thresholds);
    return {
      risks,
      compatibility,
      security,
      operability,
      tco,
      hardGate
    };
  }

  classifyMaintenanceStatus(updateAgeDays) {
    const days = Math.max(0, Number(updateAgeDays) || 0);
    if (days <= 30) return 'active';
    if (days <= 180) return 'stable';
    if (days <= 365) return 'aging';
    return 'stale';
  }

  evaluateCandidates(caseItem, candidates = [], context = {}) {
    this.ensureCollections();
    const createdAt = new Date().toISOString();
    const thresholds = inferDynamicThresholds({
      goal: context.goal || '',
      gapType: caseItem.gapType || ''
    });
    const evaluated = candidates.slice(0, 5).map((candidate, index) => {
      const extra = this.evaluateCandidateSignals(candidate, thresholds);
      const dimensions = normalizeDimensionScores({
        technicalMaturity: candidate.score.freshness >= 60 ? 4 : 3,
        communityActivity: candidate.stars >= thresholds.minStars ? 4 : 2,
        codeQuality: candidate.score.total >= 70 ? 4 : 3,
        documentation: candidate.score.keyword > 0 ? 4 : 3,
        licenseCompliance: extra.hardGate.reasons.includes('license_incompatible') ? 1 : 4,
        security: extra.hardGate.reasons.includes('critical_vulnerabilities_present') ? 1 : 4,
        performance: candidate.score.total >= 70 ? 4 : 3,
        maintainability: extra.hardGate.reasons.includes('stale_maintenance') ? 2 : 4
      });
      const consistency = evaluateDimensionConsistency(dimensions, REQUIRED_DIMENSIONS.length);
      const weightedScore = computeWeightedScore(dimensions);
      const evidence = normalizeEvidenceList([
        {
          sourceUrl: candidate.url,
          capturedAt: createdAt,
          evidenceExcerpt: `stars=${candidate.stars}, updatedAt=${candidate.updatedAt}, license=${candidate.license}`,
          confidence: 0.8
        }
      ]);
      const scoreBreakdown = {
        total: candidate.score.total,
        popularity: candidate.score.popularity,
        freshness: candidate.score.freshness,
        security: extra.security,
        compatibility: extra.compatibility,
        operability: extra.operability,
        tco: extra.tco,
        dimensions,
        weightedScore
      };
      const decisionHint = scoreBreakdown.total >= 75 && extra.risks.length <= 1 ? 'fit' : (scoreBreakdown.total >= 60 ? 'partial_fit' : 'not_fit');
      return {
        id: `${caseItem.id}-candidate-${index + 1}`,
        caseId: caseItem.id,
        repoFullName: candidate.name,
        repoUrl: candidate.url,
        repoDescription: String(candidate.description || '').slice(0, 300),
        licenseSpdx: candidate.license,
        stars: Number(candidate.stars || 0),
        updatedAt: candidate.updatedAt || null,
        updateAgeDays: Number(candidate.updateAgeDays || 0),
        maintenanceStatus: this.classifyMaintenanceStatus(candidate.updateAgeDays || 0),
        scoreTotal: scoreBreakdown.total,
        scoreBreakdown,
        evidence,
        consistency,
        risks: extra.risks,
        hardGate: extra.hardGate,
        deployPlanSummary: `Deploy ${candidate.name} in staging, validate task ${caseItem.taskId} acceptance flow.`,
        decisionHint,
        createdAt
      };
    });
    this.store.ossCandidateEvaluations = this.store.ossCandidateEvaluations.filter((x) => x.caseId !== caseItem.id);
    this.store.ossCandidateEvaluations.unshift(...evaluated);
    this.store.ossCandidateEvaluations = this.store.ossCandidateEvaluations.slice(0, 800);
    return evaluated;
  }

  assessBuildVsBuy(caseItem, candidateEvaluations) {
    this.ensureCollections();
    const nowTs = Date.now();
    const within30d = this.store.ossCases.filter((x) => (
      x.demandFingerprint === caseItem.demandFingerprint
      && (nowTs - Date.parse(x.createdAt || 0)) <= 30 * 86400000
    ));
    const demandCount30d = within30d.length;
    const top = candidateEvaluations[0] || null;
    const hasStrongCandidate = Boolean(top && top.scoreTotal >= 75 && top.decisionHint === 'fit');
    const recommendation = demandCount30d >= 3 ? 'build_in_house' : (hasStrongCandidate ? 'introduce_oss' : 'defer');
    const assessment = {
      id: `${caseItem.id}-build-vs-buy`,
      caseId: caseItem.id,
      demandCount30d,
      estimatedBuildWeeks: demandCount30d >= 3 ? 3 : 6,
      estimatedIntroduceDays: hasStrongCandidate ? 3 : 7,
      maintenanceCostLevel: demandCount30d >= 3 ? 'medium' : 'low',
      recommendation,
      rationale: demandCount30d >= 3
        ? 'multiple_projects_share_same_demand_fingerprint'
        : (hasStrongCandidate ? 'top_candidate_fit_and_fast_introduction' : 'no_strong_candidate_yet'),
      createdAt: new Date().toISOString()
    };
    this.store.ossBuildVsBuyAssessments = this.store.ossBuildVsBuyAssessments.filter((x) => x.caseId !== caseItem.id);
    this.store.ossBuildVsBuyAssessments.unshift(assessment);
    this.store.ossBuildVsBuyAssessments = this.store.ossBuildVsBuyAssessments.slice(0, 400);
    return assessment;
  }

  async finalizeCaseDecision(caseItem, candidates, assessment) {
    const top = candidates[0] || null;
    let recommendation = 'defer';
    let rationale = 'insufficient_signal';
    if (assessment.recommendation === 'build_in_house') {
      recommendation = 'build_in_house';
      rationale = 'repeated_multi_project_demand';
    } else if (top && top.hardGate && top.hardGate.passed !== true) {
      recommendation = 'defer';
      rationale = `hard_gate_blocked:${(top.hardGate.reasons || []).join(',')}`;
      this.store.addEvent('oss.hard_gate.blocked', {
        taskId: caseItem.taskId,
        employeeId: caseItem.employeeId,
        caseId: caseItem.id,
        reasons: top.hardGate.reasons || [],
        riskLevel: top.hardGate.riskLevel || 'high'
      });
    } else if (top && top.scoreTotal >= 75 && !top.risks.includes('license_unknown')) {
      recommendation = 'introduce_oss';
      rationale = `top_candidate_fit:${top.repoFullName}`;
    }
    caseItem.status = recommendation === 'defer' ? 'completed' : 'pending_approval';
    caseItem.recommendation = recommendation;
    caseItem.rationale = rationale;
    caseItem.updatedAt = new Date().toISOString();
    this.store.addEvent('oss.case.decision.completed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      recommendation,
      rationale
    });
    await this.applyGovernanceAutomation(caseItem, candidates, assessment);
    if (caseItem.status === 'pending_approval') {
      this.requestUserConfirmation(caseItem, { id: caseItem.taskId, traceId: null }, { id: caseItem.employeeId }, 'system:oss-decision');
    }
    return caseItem;
  }

  resolveGovernancePolicy() {
    const src = this.store && this.store.ossGovernancePolicy && typeof this.store.ossGovernancePolicy === 'object'
      ? this.store.ossGovernancePolicy
      : {};
    const rawMode = String(src.mode || '').toLowerCase();
    const mode = rawMode === 'autonomous' ? 'model_driven' : rawMode;
    return {
      mode: ['assist', 'model_driven'].includes(mode) ? mode : 'assist',
      fallbackToManualWhenModelUnavailable: Boolean(src.fallbackToManualWhenModelUnavailable !== false)
    };
  }

  buildGovernanceDecisionPrompt(caseItem, topCandidate, assessment) {
    return [
      '你是数字员工自治治理决策器。',
      '平台不设固定阈值，你必须基于上下文自主推理并输出 JSON，不要解释。',
      `case_id: ${caseItem.id}`,
      `task_id: ${caseItem.taskId}`,
      `gap_type: ${caseItem.gapType || 'unknown'}`,
      `gap_summary: ${caseItem.gapSummary || ''}`,
      `recommendation_from_assessment: ${caseItem.recommendation || 'defer'}`,
      `confidence: ${Number(caseItem.confidence || 0)}`,
      `top_candidate: ${topCandidate ? `${topCandidate.repoFullName}|score=${topCandidate.scoreTotal}|risks=${(topCandidate.risks || []).join(',')}` : 'none'}`,
      `top_candidate_hard_gate_passed: ${topCandidate && topCandidate.hardGate ? Boolean(topCandidate.hardGate.passed) : false}`,
      `top_candidate_risk_level: ${topCandidate && topCandidate.hardGate ? String(topCandidate.hardGate.riskLevel || 'unknown') : 'unknown'}`,
      `build_vs_buy: demand_30d=${assessment && assessment.demandCount30d ? assessment.demandCount30d : 0}, recommendation=${assessment && assessment.recommendation ? assessment.recommendation : 'unknown'}`,
      '输出字段：',
      'decision(introduce_oss|build_in_house|reject|defer), requiresUserConfirmation(boolean), autoDeploy(boolean), autoVerify(boolean), reason(string)',
      '约束：必须与上下文一致，若信息不足可 decision=defer。'
    ].join('\n');
  }

  normalizeGovernanceDecision(raw, caseItem) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const decision = String(data.decision || '').trim();
    const allowed = ['introduce_oss', 'build_in_house', 'reject', 'defer'];
    return {
      decision: allowed.includes(decision) ? decision : String(caseItem.recommendation || 'defer'),
      requiresUserConfirmation: data.requiresUserConfirmation !== false,
      autoDeploy: Boolean(data.autoDeploy),
      autoVerify: Boolean(data.autoVerify),
      reason: normalizeText(data.reason || 'model_driven_decision').slice(0, 500)
    };
  }

  shouldRequireUserConfirmation(decision, topCandidate) {
    if (decision && typeof decision.requiresUserConfirmation === 'boolean') {
      return decision.requiresUserConfirmation;
    }
    if (!topCandidate || !topCandidate.hardGate) return true;
    const hardGatePassed = topCandidate.hardGate.passed === true;
    const riskLevel = String(topCandidate.hardGate.riskLevel || '').toLowerCase();
    if (!hardGatePassed) return true;
    return !['low', 'medium'].includes(riskLevel);
  }

  async decideGovernanceAction(caseItem, candidates, assessment) {
    const top = candidates && candidates[0] ? candidates[0] : null;
    if (!(this.dialogueGateway && typeof this.dialogueGateway.isEnabled === 'function' && this.dialogueGateway.isEnabled())) {
      return null;
    }
    const raw = await this.dialogueGateway.generateReply({
      goal: this.buildGovernanceDecisionPrompt(caseItem, top, assessment),
      employee: { department: 'governance', role: 'decision-engine', employeeCode: 'DE-GOV' }
    });
    const parsed = this.extractJsonObject(raw);
    return this.normalizeGovernanceDecision(parsed, caseItem);
  }

  recordAutonomyDecision(caseItem, payload = {}) {
    caseItem.autonomyDecision = {
      engine: 'llm',
      mode: 'model_driven',
      decision: String(payload.decision || 'defer'),
      autoDeploy: Boolean(payload.autoDeploy),
      autoVerify: Boolean(payload.autoVerify),
      reason: normalizeText(payload.reason || 'model_driven_decision').slice(0, 500),
      status: String(payload.status || 'proposed'),
      at: new Date().toISOString()
    };
    caseItem.updatedAt = caseItem.autonomyDecision.at;
  }

  async applyGovernanceAutomation(caseItem, candidates, assessment) {
    const policy = this.resolveGovernancePolicy();
    if (policy.mode !== 'model_driven') return;
    if (!['pending_approval', 'completed'].includes(String(caseItem.status || ''))) return;

    const decision = await this.decideGovernanceAction(caseItem, candidates, assessment);
    if (!decision) {
      const error = new Error('oss governance model unavailable');
      error.code = 'OSS_GOVERNANCE_MODEL_UNAVAILABLE';
      throw error;
    }
    if (decision.decision === 'defer') {
      this.recordAutonomyDecision(caseItem, { ...decision, status: 'deferred' });
      this.store.addEvent('oss.case.auto.deferred', {
        taskId: caseItem.taskId,
        employeeId: caseItem.employeeId,
        caseId: caseItem.id,
        reason: decision.reason
      });
      return;
    }

    if (!['introduce_oss', 'build_in_house', 'reject'].includes(String(decision.decision || ''))) return;
    const top = candidates && candidates[0] ? candidates[0] : null;
    const requiresUserConfirmation = this.shouldRequireUserConfirmation(decision, top);
    if (decision.decision !== 'reject') {
      caseItem.recommendation = decision.decision;
    }
    caseItem.status = 'pending_approval';
    caseItem.rationale = normalizeText(decision.reason || caseItem.rationale || '').slice(0, 500);
    this.recordAutonomyDecision(caseItem, {
      ...decision,
      status: requiresUserConfirmation ? 'proposed_for_user_confirmation' : 'auto_execute_without_user_confirmation'
    });
    this.store.addEvent('oss.case.auto.proposed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      recommendation: decision.decision,
      requiresUserConfirmation,
      policyMode: policy.mode
    });
    if (requiresUserConfirmation) {
      this.requestUserConfirmation(caseItem, { id: caseItem.taskId, traceId: null }, { id: caseItem.employeeId }, 'policy-engine');
      return;
    }

    const actor = { userId: 'policy-engine', role: 'oss-policy' };
    if (decision.decision === 'reject') {
      this.approveCase(caseItem.id, { decision: 'reject', reason: decision.reason }, actor);
      this.store.addEvent('oss.case.auto.rejected', {
        taskId: caseItem.taskId,
        employeeId: caseItem.employeeId,
        caseId: caseItem.id,
        reason: decision.reason,
        policyMode: policy.mode
      });
      return;
    }
    this.approveCase(caseItem.id, { decision: decision.decision, note: decision.reason }, actor);
    this.store.addEvent('oss.case.auto.approved', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      recommendation: decision.decision,
      policyMode: policy.mode
    });

    if (!decision.autoDeploy) return;
    this.deployCase(caseItem.id, actor);
    this.store.addEvent('oss.deploy.auto.started', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      policyMode: policy.mode
    });

    if (!decision.autoVerify) return;
    this.verifyCase(caseItem.id, {
      note: `auto_verified_by_policy:${policy.mode}`
    }, actor);
    this.store.addEvent('oss.verify.auto.completed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      policyMode: policy.mode
    });
  }

  async runCasePipeline(caseItem, query, goal) {
    caseItem.status = 'researching';
    caseItem.updatedAt = new Date().toISOString();
    this.store.addEvent('oss.research.queued', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      query
    });
    const repos = await this.gateway.searchRepositories(query);
    const ranked = evaluateRepos(repos, goal);
    const candidates = this.evaluateCandidates(caseItem, ranked, { goal });
    const evaluation = {
      schemaVersion: OSS_EVALUATION_SCHEMA_VERSION,
      caseId: caseItem.id,
      generatedAt: new Date().toISOString(),
      query,
      dimensions: REQUIRED_DIMENSIONS,
      candidateCount: candidates.length,
      consistency: {
        ok: candidates.every((item) => item.consistency && item.consistency.ok === true),
        expectedDimensions: REQUIRED_DIMENSIONS.length
      },
      hardGate: {
        passed: candidates.some((item) => item.hardGate && item.hardGate.passed === true),
        blockedCandidates: candidates
          .filter((item) => item.hardGate && item.hardGate.passed !== true)
          .map((item) => ({
            repoFullName: item.repoFullName,
            reasons: item.hardGate.reasons || []
          }))
      },
      topCandidate: candidates[0]
        ? {
          repoFullName: candidates[0].repoFullName,
          scoreTotal: candidates[0].scoreTotal,
          hardGate: candidates[0].hardGate
        }
        : null
    };
    caseItem.evaluation = evaluation;
    const topLegacy = ranked.slice(0, 5);
    this.store.ossFindings.unshift({
      id: `${caseItem.id}-finding`,
      employeeId: caseItem.employeeId,
      taskId: caseItem.taskId,
      query,
      candidates: topLegacy,
      createdAt: new Date().toISOString()
    });
    this.store.ossFindings = this.store.ossFindings.slice(0, 300);
    this.store.addEvent('oss.evaluate.completed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      candidateCount: candidates.length,
      evaluationSchemaVersion: evaluation.schemaVersion,
      consistencyOk: evaluation.consistency.ok,
      hardGatePassed: evaluation.hardGate.passed
    });
    const assessment = this.assessBuildVsBuy(caseItem, candidates);
    this.store.addEvent('oss.assessment.build_vs_buy.completed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      recommendation: assessment.recommendation,
      demandCount30d: assessment.demandCount30d
    });
    return await this.finalizeCaseDecision(caseItem, candidates, assessment);
  }

  async inferAndHandle(task, employee, outcome) {
    this.ensureCollections();
    if (!task || !employee || !outcome) return null;
    if (this.hasCaseForIteration(task)) return null;
    const inference = await this.inferCapabilityGap(task, employee, outcome);
    if (!inference.hasGap || inference.confidence < 0.7) return null;
    const caseItem = this.createCase(task, employee, inference);
    try {
      await this.runCasePipeline(
        caseItem,
        inference.researchQuery || `${employee.department} ${employee.role} ${task.goal}`.slice(0, 120),
        task.goal
      );
    } catch (error) {
      caseItem.status = 'rolled_back';
      caseItem.updatedAt = new Date().toISOString();
      caseItem.rationale = `pipeline_failed:${String(error.message || 'unknown')}`.slice(0, 240);
      this.store.addEvent('oss.research.failed', {
        taskId: caseItem.taskId,
        employeeId: caseItem.employeeId,
        caseId: caseItem.id,
        error: String(error.message || 'unknown')
      });
    }
    return caseItem;
  }

  getCaseById(caseId) {
    this.ensureCollections();
    const found = this.store.ossCases.find((x) => x.id === caseId);
    if (!found) {
      const error = new Error('oss case not found');
      error.statusCode = 404;
      throw error;
    }
    return found;
  }

  requireStatus(caseItem, allowed = [], action = 'transition') {
    if (!allowed.includes(caseItem.status)) {
      const error = new Error(`invalid oss case status transition for ${action}: ${caseItem.status}`);
      error.statusCode = 400;
      throw error;
    }
  }

  approveCase(caseId, input = {}, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    const decision = String(input.decision || '').trim();
    this.requireStatus(caseItem, ['pending_approval', 'completed'], 'approve');
    if (!['introduce_oss', 'build_in_house', 'reject'].includes(decision)) {
      const error = new Error('decision must be one of introduce_oss|build_in_house|reject');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    if (decision === 'reject') {
      caseItem.status = 'rejected';
      caseItem.recommendation = 'defer';
      caseItem.rationale = normalizeText(input.note || input.reason || caseItem.rationale || 'rejected_by_admin').slice(0, 500);
      caseItem.updatedAt = now;
      if (caseItem.userConfirmation && typeof caseItem.userConfirmation === 'object') {
        caseItem.userConfirmation.required = false;
        caseItem.userConfirmation.status = 'rejected';
        caseItem.userConfirmation.confirmedAt = now;
        caseItem.userConfirmation.confirmedBy = String(actor.userId || 'unknown');
        caseItem.userConfirmation.note = caseItem.rationale;
      }
      this.store.addEvent('oss.case.rejected', {
        taskId: caseItem.taskId,
        employeeId: caseItem.employeeId,
        caseId: caseItem.id,
        actorId: String(actor.userId || 'unknown'),
        actorRole: String(actor.role || ''),
        reason: caseItem.rationale
      });
      return caseItem;
    }
    caseItem.status = decision === 'introduce_oss' ? 'approved_introduce' : 'approved_build';
    caseItem.recommendation = decision;
    caseItem.rationale = normalizeText(input.note || input.reason || caseItem.rationale || '').slice(0, 500);
    caseItem.updatedAt = now;
    if (caseItem.userConfirmation && typeof caseItem.userConfirmation === 'object') {
      caseItem.userConfirmation.required = false;
      caseItem.userConfirmation.status = 'confirmed';
      caseItem.userConfirmation.confirmedAt = now;
      caseItem.userConfirmation.confirmedBy = String(actor.userId || 'unknown');
      caseItem.userConfirmation.note = caseItem.rationale;
    }
    this.store.addEvent('oss.case.approved', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || ''),
      recommendation: caseItem.recommendation
    });
    return caseItem;
  }

  confirmCaseByUser(caseId, input = {}, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    const confirmed = input.confirm !== false;
    const note = normalizeText(input.note || input.reason || '').slice(0, 500);
    if (confirmed) {
      const suggested = String(caseItem.recommendation || '').trim();
      if (!['introduce_oss', 'build_in_house'].includes(suggested)) {
        const error = new Error('oss case recommendation is not confirmable');
        error.statusCode = 400;
        throw error;
      }
      const updated = this.approveCase(caseId, { decision: suggested, note: note || 'confirmed by user from IM' }, actor);
      this.store.addEvent('oss.case.user.confirmed', {
        taskId: updated.taskId,
        employeeId: updated.employeeId,
        caseId: updated.id,
        actorId: String(actor.userId || 'unknown'),
        actorRole: String(actor.role || ''),
        recommendation: updated.recommendation
      });
      return updated;
    }
    const updated = this.approveCase(caseId, { decision: 'reject', reason: note || 'rejected by user from IM' }, actor);
    this.store.addEvent('oss.case.user.rejected', {
      taskId: updated.taskId,
      employeeId: updated.employeeId,
      caseId: updated.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || '')
    });
    return updated;
  }

  deployCase(caseId, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    this.requireStatus(caseItem, ['approved_introduce', 'approved_build'], 'deploy');
    caseItem.status = 'deploying';
    caseItem.updatedAt = new Date().toISOString();
    this.store.addEvent('oss.deploy.started', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || ''),
      recommendation: caseItem.recommendation
    });
    return caseItem;
  }

  verifyCase(caseId, input = {}, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    this.requireStatus(caseItem, ['deploying'], 'verify');
    caseItem.status = 'completed';
    caseItem.updatedAt = new Date().toISOString();
    if (input && (input.note || input.result)) {
      caseItem.rationale = normalizeText(input.note || input.result || caseItem.rationale || '').slice(0, 500);
    }
    this.store.addEvent('oss.verify.completed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || '')
    });
    return caseItem;
  }

  rollbackCase(caseId, input = {}, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    this.requireStatus(caseItem, [
      'pending_approval',
      'approved_introduce',
      'approved_build',
      'deploying',
      'completed'
    ], 'rollback');
    caseItem.status = 'rolled_back';
    caseItem.updatedAt = new Date().toISOString();
    caseItem.rationale = normalizeText(input.reason || input.note || 'manual rollback').slice(0, 500);
    this.store.addEvent('oss.rollback.completed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || ''),
      reason: caseItem.rationale
    });
    return caseItem;
  }

  reviewCase(caseId, input = {}, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    const now = new Date().toISOString();
    if (!caseItem.review || typeof caseItem.review !== 'object') {
      caseItem.review = {
        nextReviewAt: now,
        lifecycleStatus: 'active',
        retireReason: null,
        reviewedAt: null
      };
    }
    caseItem.review.reviewedAt = now;
    caseItem.review.nextReviewAt = String(input.nextReviewAt || new Date(Date.now() + 90 * 86400000).toISOString());
    caseItem.review.lifecycleStatus = String(input.lifecycleStatus || caseItem.review.lifecycleStatus || 'active');
    caseItem.updatedAt = now;
    this.store.addEvent('oss.case.reviewed', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || ''),
      lifecycleStatus: caseItem.review.lifecycleStatus,
      nextReviewAt: caseItem.review.nextReviewAt
    });
    return caseItem;
  }

  retireCase(caseId, input = {}, actor = {}) {
    const caseItem = this.getCaseById(caseId);
    const reason = normalizeText(input.reason || input.note || 'retired_by_admin').slice(0, 500);
    const now = new Date().toISOString();
    if (!caseItem.review || typeof caseItem.review !== 'object') {
      caseItem.review = {
        nextReviewAt: null,
        lifecycleStatus: 'retired',
        retireReason: reason,
        reviewedAt: now
      };
    } else {
      caseItem.review.lifecycleStatus = 'retired';
      caseItem.review.retireReason = reason;
      caseItem.review.reviewedAt = now;
      caseItem.review.nextReviewAt = null;
    }
    caseItem.updatedAt = now;
    this.store.addEvent('oss.case.retired', {
      taskId: caseItem.taskId,
      employeeId: caseItem.employeeId,
      caseId: caseItem.id,
      actorId: String(actor.userId || 'unknown'),
      actorRole: String(actor.role || ''),
      reason
    });
    return caseItem;
  }
}

module.exports = { OssDecisionUseCases };
