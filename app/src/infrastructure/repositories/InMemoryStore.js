const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const { INDEPENDENT_PERSONA_DECLARATION } = require('../../shared/independentPersonaDeclaration');
const { assertEventType, CRITICAL_EVENT_TYPES } = require('../../shared/EventCatalog');
const { logger } = require('../../shared/logger');

class InMemoryStore {
  constructor(options = {}) {
    this.driver = 'memory';
    this.maxEventRetention = Number(process.env.MAX_EVENT_RETENTION || options.maxEventRetention) || 10000;
    this.employees = [];
    this.conversations = [];
    this.messages = [];
    this.tasks = [];
    this.skills = [];
    this.events = [];
    this.auditAnchors = [];
    this.researchQueue = [];
    this.ossFindings = [];
    this.ossCases = [];
    this.ossCandidateEvaluations = [];
    this.ossBuildVsBuyAssessments = [];
    this.knowledgeAssets = [];
    this.knowledgeCandidates = [];
    this.knowledgeReviewQueue = [];
    this.subscriptions = [];
    this.retrievalRuns = [];
    this.briefingDeliveries = [];
    this.mcpServices = [];
    this.eventSeq = 0;
    this.metrics = {
      totalTasks: 0,
      succeededTasks: 0,
      failedTasks: 0,
      recurrenceErrors: 0,
      skillReused: 0,
      p1Incidents: 0,
      retrieval: {
        busyDecisions: 0,
        idleDecisions: 0,
        internalTools: 0,
        platformContext: 0,
        externalSearch: 0,
        skippedExternal: 0,
        queuedExternal: 0
      },
      skillSedimentation: {
        directCreated: 0,
        proposalCreated: 0,
        skipped: 0
      },
      knowledgeSedimentation: {
        autoPublished: 0,
        queuedForReview: 0,
        rejected: 0,
        reviewedApproved: 0,
        reviewedRejected: 0,
        skippedDisabled: 0,
        deduplicated: 0
      }
    };
    this.bootstrap = null;
    this.retrievalPolicy = {
      mode: 'auto',
      updatedAt: null,
      updatedBy: 'system'
    };
    this.ossGovernancePolicy = {
      mode: 'model_driven',
      decisionEngine: 'llm',
      fallbackToManualWhenModelUnavailable: true,
      updatedAt: null,
      updatedBy: 'system'
    };
    this.skillSedimentationPolicy = {
      mode: 'hybrid',
      minConfidence: 0.7,
      fallbackToRulesWhenModelUnavailable: true,
      promotionMode: 'direct',
      minRepeatedSuccessForFallback: 2,
      updatedAt: null,
      updatedBy: 'system'
    };
    this.knowledgeSedimentationPolicy = {
      mode: 'hybrid',
      promotionMode: 'proposal',
      minConfidence: 0.7,
      minQualityScoreForAutoApprove: 85,
      minQualityScoreForReviewQueue: 60,
      fallbackToRulesWhenModelUnavailable: true,
      updatedAt: null,
      updatedBy: 'system'
    };
    this.strategyCenter = {
      maxLoopSteps: 5,
      maxTaskRuntimeMs: 120000,
      blockOnHighRiskWithoutApproval: true,
      retryLimit: 2,
      retryBackoffMs: 3000,
      defaultToolScope: ['bash', 'read', 'search', 'test'],
      defaultSkillScope: ['general'],
      autoevolveMinScoreGain: 0.02,
      autoevolveRequireReplayPass: true,
      autoevolveCanaryRatio: 0.1,
      autoevolveObservationWindowMinutes: 60,
      promptPublishRequiresApproval: false,
      updatedAt: null,
      updatedBy: 'system'
    };
    this.promptCenter = {
      layers: {
        platform: {
          id: 'platform-default',
          content: [
            INDEPENDENT_PERSONA_DECLARATION,
            '',
            '你是 DCF 平台内的企业级数字员工执行体。你的首要目标不是“回答”，而是“在可治理前提下稳定交付业务结果”。',
            '',
            '【身份与职责】',
            '1. 你是受治理约束的执行单元，必须遵守平台规则、审批策略与审计要求。',
            '2. 你的输出对象主要是业务人员，表达要清晰、简洁、可执行。',
            '3. 不得暴露底层实现品牌、内部链路细节或不必要的技术术语。',
            '',
            '【核心原则】',
            '1. 结果正确优先于速度，速度优先于形式完整。',
            '2. 证据优先于结论：结论必须能被过程记录与证据支持。',
            '3. 高风险动作先校验权限与审批，未满足则阻断并说明原因。',
            '4. 信息不足时先澄清，不对关键事实做猜测。',
            '5. 每次执行都要可追溯、可复盘、可回滚。',
            '',
            '【执行流程】',
            '1. 理解目标：明确业务目标、约束、验收标准。',
            '2. 风险评估：判断风险等级与审批需求。',
            '3. 计划动作：给出最小可执行步骤。',
            '4. 执行动作：仅执行当前授权范围内动作。',
            '5. 结果归档：输出结果、证据、未决事项、下一步建议。',
            '',
            '【审计字段要求】',
            '涉及任务执行时，必须确保链路中可关联 trace_id、task_id、employee_id。',
            '',
            '【工程约束】',
            '1. 遵循 DDD-lite 分层边界，不跨层越权。',
            '2. 新行为遵循 TDD 思路：先定义预期，再执行，再验证。',
            '3. 变更必须可回滚，且不破坏现有接口兼容。'
          ].join('\n'),
          immutableRules: ['evidence_first', 'approval_gate', 'audit_required']
        },
        roleTemplates: {},
        tenantPolicies: {},
        userProfiles: {}
      },
      activeVersionId: null,
      updatedAt: null,
      updatedBy: 'system'
    };
    this.promptVersions = [];
    this.autoevolveRuns = [];
  }

  normalizeAuditPayload(payload = {}) {
    const p = payload || {};
    return {
      ...p,
      trace_id: p.trace_id || p.traceId || null,
      task_id: p.task_id || p.taskId || null,
      employee_id: p.employee_id || p.employeeId || null,
      tenant_id: p.tenant_id || p.tenantId || null,
      account_id: p.account_id || p.accountId || null,
      conversation_id: p.conversation_id || p.conversationId || null,
      parent_agent_id: p.parent_agent_id || p.parentAgentId || null,
      child_agent_id: p.child_agent_id || p.childAgentId || null,
      actor_id: p.actor_id || p.actorId || p.actorUserId || null,
      actor_name: p.actor_name || p.actorName || null,
      actor_role: p.actor_role || p.actorRole || null,
      audit_module: p.audit_module || p.auditModule || null,
      audit_page: p.audit_page || p.auditPage || null,
      audit_action: p.audit_action || p.auditAction || p.action || null,
      audit_resource: p.audit_resource || p.auditResource || p.resource || null,
      audit_result: p.audit_result || p.auditResult || p.result || null,
      request_path: p.request_path || p.requestPath || null,
      request_method: p.request_method || p.requestMethod || null
    };
  }

  hash(value) {
    return createHash('sha256').update(String(value)).digest('hex');
  }

  canonicalize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.canonicalize(v)).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.canonicalize(value[k])}`).join(',')}}`;
  }

  verifyAuditChain() {
    const ordered = this.events.slice().reverse();
    let prevHash = 'GENESIS';
    for (const event of ordered) {
      const payloadHash = this.hash(this.canonicalize(event.payload || {}));
      const calc = this.hash(`${event.id}|${event.type}|${event.at}|${prevHash}|${payloadHash}`);
      if (event.prev_hash !== prevHash) return { ok: false, brokenAt: event.id, reason: 'prev_hash mismatch' };
      if (event.payload_hash !== payloadHash) return { ok: false, brokenAt: event.id, reason: 'payload_hash mismatch' };
      if (event.event_hash !== calc) return { ok: false, brokenAt: event.id, reason: 'event_hash mismatch' };
      prevHash = event.event_hash;
    }
    return { ok: true, count: ordered.length, head: this.events[0] ? this.events[0].event_hash : 'GENESIS' };
  }

  createAuditAnchor(creator = 'system', note = '') {
    const chain = this.verifyAuditChain();
    if (!chain.ok) throw new Error(`audit chain is broken: ${chain.reason || 'unknown'}`);
    const createdAt = new Date().toISOString();
    const previous = this.auditAnchors[0] || null;
    const previousSignature = previous ? previous.signature : 'GENESIS';
    const secret = String(process.env.AUDIT_ANCHOR_SECRET || 'dcf-default-anchor-secret');
    const anchor = {
      id: `anchor-${Date.now()}-${Math.random()}`,
      createdAt,
      creator: String(creator || 'system'),
      note: String(note || '').slice(0, 500),
      eventCount: chain.count || 0,
      headHash: chain.head || 'GENESIS',
      previousSignature,
      signature: this.hash(`${chain.head || 'GENESIS'}|${chain.count || 0}|${createdAt}|${creator || 'system'}|${previousSignature}|${secret}`)
    };
    this.auditAnchors.unshift(anchor);
    this.auditAnchors = this.auditAnchors.slice(0, 200);
    this.appendAnchorToLedger(anchor);
    this.addEvent('audit.anchor.created', {
      traceId: null,
      taskId: null,
      employeeId: null,
      creator: anchor.creator,
      anchorId: anchor.id,
      headHash: anchor.headHash,
      eventCount: anchor.eventCount
    });
    return anchor;
  }

  appendAnchorToLedger(anchor) {
    const ledgerPath = process.env.AUDIT_ANCHOR_LEDGER_PATH || '';
    if (!ledgerPath) return;
    const absolute = path.resolve(ledgerPath);
    const dir = path.dirname(absolute);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(absolute, `${JSON.stringify(anchor)}\n`, 'utf8');
  }

  verifyLatestAnchor() {
    const latest = this.auditAnchors[0];
    if (!latest) return { ok: true, anchored: false, reason: 'no anchor yet' };
    const currentChainOk = this.verifyAuditChain();
    if (!currentChainOk.ok) return { ok: false, anchored: false, reason: currentChainOk.reason, brokenAt: currentChainOk.brokenAt };
    const found = this.events.some((ev) => ev.event_hash === latest.headHash) || latest.headHash === 'GENESIS';
    if (!found) return { ok: false, anchored: false, reason: 'anchor head hash not found in event chain', anchorId: latest.id };
    const secret = String(process.env.AUDIT_ANCHOR_SECRET || 'dcf-default-anchor-secret');
    const expectedSig = this.hash(`${latest.headHash}|${latest.eventCount}|${latest.createdAt}|${latest.creator}|${latest.previousSignature || 'GENESIS'}|${secret}`);
    if (expectedSig !== latest.signature) return { ok: false, anchored: false, reason: 'anchor signature mismatch', anchorId: latest.id };
    return { ok: true, anchored: true, anchorId: latest.id, headHash: latest.headHash, eventCount: latest.eventCount };
  }

  verifyAnchorChain() {
    if (!this.auditAnchors.length) return { ok: true, count: 0 };
    for (let i = 0; i < this.auditAnchors.length; i += 1) {
      const current = this.auditAnchors[i];
      const expectedPrev = i + 1 < this.auditAnchors.length ? this.auditAnchors[i + 1].signature : 'GENESIS';
      if ((current.previousSignature || 'GENESIS') !== expectedPrev) {
        return { ok: false, brokenAt: current.id, reason: 'anchor previousSignature mismatch' };
      }
    }
    return { ok: true, count: this.auditAnchors.length };
  }

  syncEventSeq() {
    const maxSeq = this.events.reduce((max, ev) => {
      const n = Number(ev && ev.seq ? ev.seq : 0);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    this.eventSeq = maxSeq;
  }

  addEvent(type, payload) {
    assertEventType(type);
    const normalizedPayload = this.normalizeAuditPayload(payload);
    const at = new Date().toISOString();
    const id = `${Date.now()}-${Math.random()}`;
    const previousHash = this.events[0] ? this.events[0].event_hash : 'GENESIS';
    const payloadHash = this.hash(this.canonicalize(normalizedPayload));
    const eventHash = this.hash(`${id}|${type}|${at}|${previousHash}|${payloadHash}`);
    this.eventSeq += 1;
    const event = {
      id,
      seq: this.eventSeq,
      type,
      payload: normalizedPayload,
      at,
      prev_hash: previousHash,
      payload_hash: payloadHash,
      event_hash: eventHash
    };
    this.events.unshift(event);
    if (this.events.length > this.maxEventRetention) {
      const lastKept = this.events[this.maxEventRetention - 1];
      if (lastKept && lastKept.event_hash) {
        this._lastTruncationAnchor = {
          hash: lastKept.event_hash,
          seq: lastKept.seq,
          at: lastKept.at,
          truncatedCount: this.events.length - this.maxEventRetention
        };
      }
      this.events = this.events.slice(0, this.maxEventRetention);
    }
    if (CRITICAL_EVENT_TYPES.includes(type)) {
      this.onCriticalEvent(event);
    }
    return event;
  }

  onCriticalEvent(event) {
    const taskId = (event.payload || {}).taskId || (event.payload || {}).task_id || '';
    const employeeId = (event.payload || {}).employeeId || (event.payload || {}).employee_id || '';
    logger.error('critical event', { eventType: event.type, taskId, employeeId, at: event.at });
  }
}

module.exports = { InMemoryStore };
