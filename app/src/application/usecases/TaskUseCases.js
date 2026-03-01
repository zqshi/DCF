const { randomUUID } = require('crypto');
const { createTask } = require('../../domain/entities/Task');
const { createSkill } = require('../../domain/entities/Skill');
const { classifyTaskRisk } = require('../../domain/services/TaskRiskPolicyService');
const {
  inferCapability,
  evaluateChildAgentPlan,
  shouldSedimentSkill
} = require('../../domain/services/GrowthPolicyService');
const { decideRetrievalStage } = require('../../domain/services/RetrievalPolicyService');
const {
  normalizeRuntimeEventExtra
} = require('../services/RuntimeEvidenceService');
const { RuntimeShadowPolicyService } = require('../services/RuntimeShadowPolicyService');
const {
  OSS_EVALUATION_SCHEMA_VERSION,
  REQUIRED_DIMENSIONS
} = require('../../domain/services/OssEvaluationPolicyService');
const { processTaskTick } = require('../services/TaskTickService');
const {
  normalizeSearchKeywords,
  calculateSkillSearchScore,
  isEchoResult,
  isSyntheticRuntimeResult
} = require('../services/TaskTextService');
const { enforceAssistantTruth } = require('../services/TruthfulnessGuardService');
const governanceService = require('../services/TaskGovernanceService');
const failurePolicyService = require('../services/TaskFailurePolicyService');
const compensationService = require('../services/TaskCompensationService');
const { normalizeAccessContext, matchAccessScope, matchActorScope } = require('../../shared/tenantAccess');

function inferSkillSeed(goal, capability) {
  const g = (goal || '').toLowerCase();
  if (g.includes('hr') || g.includes('入职')) return { name: 'hr-task-handler', type: 'domain', domain: 'hr' };
  if (g.includes('财务') || g.includes('invoice')) return { name: 'finance-task-handler', type: 'domain', domain: 'finance' };
  return { name: capability, type: 'general', domain: null };
}

function sanitizeSkillName(value, fallback = 'general-ops') {
  const raw = String(value || '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || fallback).slice(0, 80);
}

function sanitizeSessionSegment(value, fallback = 'default') {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || fallback).slice(0, 80);
}

function requiresExplicitBashPermission(goal = '') {
  const text = String(goal || '').toLowerCase();
  return [
    '下载', '文件夹', '扫描', '目录', 'shell', 'bash', 'terminal', 'scan', 'folder', 'downloads'
  ].some((keyword) => text.includes(keyword));
}

function isCapabilityBaselineToolScope(tools = []) {
  const baseline = new Set(['bash', 'read', 'search', 'test']);
  const normalized = Array.from(new Set(
    (Array.isArray(tools) ? tools : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  if (normalized.length !== baseline.size) return false;
  return normalized.every((item) => baseline.has(item));
}

class TaskUseCases {
  constructor(store, executionGateway = null, enterpriseGateway = null, options = {}) {
    this.store = store;
    this.executionGateway = executionGateway;
    this.enterpriseGateway = enterpriseGateway;
    this.dialogueGateway = options.dialogueGateway || null;
    this.requireLlmResponse = typeof options.requireLlmResponse === 'boolean'
      ? options.requireLlmResponse
      : String(process.env.REQUIRE_LLM_RESPONSE || '0') === '1';
    this.compensationMaxAttempts = Math.max(1, Number(
      options.compensationMaxAttempts || process.env.COMPENSATION_MAX_ATTEMPTS || 3
    ));
    this.compensationBackoffMs = Math.max(1, Number(
      options.compensationBackoffMs || process.env.COMPENSATION_BACKOFF_MS || 1000
    ));
    this.recoveryChainEnabled = typeof options.recoveryChainEnabled === 'boolean'
      ? options.recoveryChainEnabled
      : String(process.env.TASK_RECOVERY_CHAIN_ENABLED || '1').trim() === '1';
    this.runningAutoRequeueStaleMs = Math.max(1000, Number(
      options.runningAutoRequeueStaleMs || process.env.TASK_RUNNING_AUTO_REQUEUE_STALE_MS || 5 * 60 * 1000
    ));
    this.retrievalPolicy = options.retrievalPolicy || { decide: decideRetrievalStage };
    this.ossDecisionUseCases = options.ossDecisionUseCases || null;
    this.knowledgeSedimentationUseCases = options.knowledgeSedimentationUseCases || null;
    this.shadowCompareEnabled = typeof options.shadowCompareEnabled === 'boolean'
      ? options.shadowCompareEnabled
      : String(process.env.RUNTIME_SHADOW_COMPARE_ENABLED || '0').trim() === '1';
    this.shadowCompareTarget = String(options.shadowCompareTarget || process.env.RUNTIME_SHADOW_COMPARE_TARGET || 'openclaw')
      .trim()
      .toLowerCase();
    this.shadowPolicyProvider = typeof options.shadowPolicyProvider === 'function'
      ? options.shadowPolicyProvider
      : null;
    this.shadowPolicyService = options.shadowPolicyService || new RuntimeShadowPolicyService({
      enabled: this.shadowCompareEnabled,
      allowTenants: options.shadowAllowTenants || process.env.RUNTIME_SHADOW_ALLOW_TENANTS || '*',
      allowRoles: options.shadowAllowRoles || process.env.RUNTIME_SHADOW_ALLOW_ROLES || '*'
    });
    this.employeeUseCases = options.employeeUseCases || null;
  }

  appendToRuntimeFile(employeeId, fileName, appendContent) {
    if (this.employeeUseCases && typeof this.employeeUseCases.appendToRuntimeFile === 'function') {
      return this.employeeUseCases.appendToRuntimeFile(employeeId, fileName, appendContent, 'task-tick');
    }
    return null;
  }

  appendToDailyMemory(employeeId, entry) {
    if (this.employeeUseCases && typeof this.employeeUseCases.appendToDailyMemory === 'function') {
      return this.employeeUseCases.appendToDailyMemory(employeeId, entry, 'task-tick');
    }
    return null;
  }

  enforceAssistantTruth(task, content) {
    const verdict = enforceAssistantTruth(task, content);
    if (verdict && verdict.rewritten) {
      this.store.addEvent('assistant.claim.rewritten', this.eventPayload(task, null, {
        reason: verdict.reason
      }));
    }
    return verdict && typeof verdict.content === 'string' ? verdict.content : String(content || '').trim();
  }

  ensureRetrievalMetrics() {
    if (!this.store.metrics || typeof this.store.metrics !== 'object') this.store.metrics = {};
    if (!this.store.metrics.retrieval || typeof this.store.metrics.retrieval !== 'object') {
      this.store.metrics.retrieval = {
        busyDecisions: 0,
        idleDecisions: 0,
        internalTools: 0,
        platformContext: 0,
        externalSearch: 0,
        skippedExternal: 0,
        queuedExternal: 0
      };
    }
    return this.store.metrics.retrieval;
  }

  ensureSkillSedimentationMetrics() {
    if (!this.store.metrics || typeof this.store.metrics !== 'object') this.store.metrics = {};
    if (!this.store.metrics.skillSedimentation || typeof this.store.metrics.skillSedimentation !== 'object') {
      this.store.metrics.skillSedimentation = {
        directCreated: 0,
        proposalCreated: 0,
        skipped: 0
      };
    }
    return this.store.metrics.skillSedimentation;
  }

  recordRetrievalDecision(policy, options = {}) {
    const metrics = this.ensureRetrievalMetrics();
    const mode = String(policy && policy.schedulingMode || 'idle');
    if (mode === 'busy') metrics.busyDecisions += 1;
    else metrics.idleDecisions += 1;
    const decision = String(policy && policy.decision || 'external_search');
    if (decision === 'internal_tools') metrics.internalTools += 1;
    else if (decision === 'platform_context') metrics.platformContext += 1;
    else metrics.externalSearch += 1;
    if (options.skippedExternal) metrics.skippedExternal += 1;
    if (options.queuedExternal) metrics.queuedExternal += 1;
  }

  resolveConfiguredModelDefault() {
    const direct = String(process.env.LLM_MODEL || process.env.OPENAI_MODEL || '').trim();
    const listRaw = String(process.env.FRONT_LLM_MODELS || process.env.OPENAI_MODELS || process.env.LLM_MODELS || '').trim();
    if (listRaw) {
      const fromList = listRaw
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .find((item) => !/^openclaw:/i.test(item));
      if (fromList) return fromList;
    }
    return direct || null;
  }

  isAgentOrchestrationV2Enabled() {
    return String(process.env.AGENT_ORCHESTRATION_V2_ENABLED || '0').trim() === '1';
  }

  routeSubAgents(task, employee, childAgentPlan = null) {
    if (!this.isAgentOrchestrationV2Enabled()) return [];
    const plan = childAgentPlan || evaluateChildAgentPlan(task);
    const routes = [{
      subAgentType: 'retrieval-agent',
      enabled: true,
      reason: 'knowledge_and_tool_retrieval'
    }, {
      subAgentType: 'knowledge-curator-agent',
      enabled: true,
      reason: 'knowledge_sedimentation_and_review'
    }, {
      subAgentType: 'oss-research-agent',
      enabled: true,
      reason: 'oss_research_on_failure_or_correction'
    }];
    task.subAgentRoutes = routes;
    this.store.addEvent('agent.route.decided', this.eventPayload(task, employee, {
      routeCount: routes.length,
      routes: routes.map((item) => item.subAgentType),
      childAgentPlanned: Boolean(plan && plan.planned)
    }));
    return routes;
  }

  getRetrievalPreferredMode(employee = null) {
    const employeeMode = String((((employee || {}).retrievalPolicy || {}).mode) || '').trim().toLowerCase();
    if (employeeMode === 'busy' || employeeMode === 'idle') return employeeMode;
    const platformMode = String((((this.store || {}).retrievalPolicy || {}).mode) || '').trim().toLowerCase();
    if (platformMode === 'busy' || platformMode === 'idle') return platformMode;
    return undefined;
  }

  ensureRuntimeConfigAliases(task) {
    if (!task || typeof task !== 'object') return task;
    const runtimeConfig = task.runtimeConfig && typeof task.runtimeConfig === 'object'
      ? task.runtimeConfig
      : ((task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    task.runtimeConfig = runtimeConfig;
    task.openclaw = runtimeConfig;
    return task;
  }

  matchTaskActorScope(task, accessContext = null) {
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (!ctx) return true;
    if (matchActorScope(task, ctx, { strict: true })) return true;
    const employee = this.store.employees.find((item) => item.id === task.employeeId);
    if (!employee) return false;
    return matchActorScope(employee, ctx, { strict: true });
  }

  list(accessContext = null) {
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (!ctx) return this.store.tasks.slice().reverse().map((task) => this.ensureRuntimeConfigAliases(task));
    return this.store.tasks
      .filter((task) => matchAccessScope(task, ctx) && this.matchTaskActorScope(task, ctx))
      .slice()
      .reverse()
      .map((task) => this.ensureRuntimeConfigAliases(task));
  }

  getTask(taskId, accessContext = null, options = {}) {
    const task = this.store.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('task not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    const allowActorBypass = options && options.allowActorBypass === true;
    if (ctx && (!matchAccessScope(task, ctx) || (!allowActorBypass && !this.matchTaskActorScope(task, ctx)))) {
      throw new Error('task not found');
    }
    return this.ensureRuntimeConfigAliases(task);
  }

  ensureConversationStore() {
    if (!Array.isArray(this.store.conversations)) this.store.conversations = [];
    return this.store.conversations;
  }

  ensureMessageStore() {
    if (!Array.isArray(this.store.messages)) this.store.messages = [];
    return this.store.messages;
  }

  appendMessage(input = {}) {
    const now = new Date().toISOString();
    const role = String(input.role || 'system').trim().toLowerCase();
    const content = String(input.content || '');
    if (!content.trim()) return null;
    const normalizedRole = ['user', 'assistant', 'system'].includes(role) ? role : 'system';
    const message = {
      id: String(input.id || `msg-${randomUUID()}`),
      employeeId: String(input.employeeId || '').trim() || null,
      tenantId: input.tenantId || null,
      accountId: input.accountId || null,
      conversationId: String(input.conversationId || '').trim() || 'default',
      taskId: String(input.taskId || '').trim() || null,
      role: normalizedRole,
      content: content.slice(0, 12000),
      createdAt: String(input.createdAt || now),
      updatedAt: now,
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
    };
    this.ensureMessageStore().push(message);
    return message;
  }

  upsertTaskMessage(task, employee, role, content, meta = {}) {
    const messageStore = this.ensureMessageStore();
    const normalizedRole = String(role || '').trim().toLowerCase();
    const text = String(content || '');
    if (!text.trim()) return null;
    const existing = messageStore.find((item) => (
      item
      && item.taskId === task.id
      && item.conversationId === task.conversationId
      && item.employeeId === task.employeeId
      && String(item.role || '').toLowerCase() === normalizedRole
    ));
    const now = new Date().toISOString();
    if (existing) {
      existing.content = text.slice(0, 12000);
      existing.updatedAt = now;
      existing.meta = { ...(existing.meta || {}), ...(meta || {}) };
      return existing;
    }
    return this.appendMessage({
      employeeId: task.employeeId,
      tenantId: task.tenantId || (employee ? employee.tenantId : null),
      accountId: task.accountId || (employee ? employee.accountId : null),
      conversationId: task.conversationId || 'default',
      taskId: task.id,
      role: normalizedRole,
      content: text,
      meta
    });
  }

  recordUserMessageForTask(task, employee) {
    const attachmentCount = Array.isArray(task.attachments) ? task.attachments.length : 0;
    return this.upsertTaskMessage(task, employee, 'user', task.goal, {
      source: 'task.goal',
      riskLevel: task.riskLevel,
      attachmentCount
    });
  }

  buildConversationHistory(task, employee, limit = 12) {
    const employeeId = String((task && task.employeeId) || (employee && employee.id) || '').trim();
    const conversationId = String((task && task.conversationId) || '').trim();
    if (!employeeId || !conversationId) return [];
    const cap = Math.max(1, Number(limit) || 12);
    return this.ensureMessageStore()
      .filter((item) => (
        item
        && String(item.employeeId || '') === employeeId
        && String(item.conversationId || '') === conversationId
        && ['user', 'assistant', 'system'].includes(String(item.role || '').trim().toLowerCase())
      ))
      .slice()
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      .slice(-cap)
      .map((item) => ({
        role: String(item.role || '').trim().toLowerCase(),
        content: String(item.content || '').trim().slice(0, 1000)
      }))
      .filter((item) => item.content);
  }

  syncTaskDialogueContext(task, employee) {
    if (!task || typeof task !== 'object') return;
    const history = this.buildConversationHistory(task, employee, 12);
    task.dialogueContext = {
      history,
      updatedAt: new Date().toISOString()
    };
  }

  buildAssistantContent(task, fallback = '') {
    if (task.status === 'succeeded') return String(task.result || '').trim();
    if (task.status === 'failed') {
      const message = String(task.lastError && task.lastError.message ? task.lastError.message : '').trim();
      if (message) {
        const normalized = message.toLowerCase();
        const isModelBillingIssue = /overdue-payment|account is in good standing|access denied/.test(normalized)
          || /模型服务欠费|欠费|账户状态|账号状态|额度|配额/.test(message)
          || /free tier of the model has been exhausted|allocationquota\.freetieronly|quota/i.test(normalized);
        if (isModelBillingIssue) {
          return '执行失败：模型服务当前不可用（疑似欠费或账户状态异常），请处理账单或更换可用模型后重试。';
        }
        const isNetworkIssue = /network_error|timeout|econnrefused|enotfound|eai_again|self[-_ ]signed/i.test(normalized);
        if (isNetworkIssue) {
          return '执行失败：模型服务网络不可达或响应超时，请检查 OPENAI_BASE_URL、网络连通性与代理配置后重试。';
        }
        return `执行失败：${message}`;
      }
      return String(fallback || '').trim();
    }
    if (task.status === 'rolled_back') {
      const reason = String(task.rollback && task.rollback.reason ? task.rollback.reason : '').trim();
      return reason ? `任务已回滚：${reason}` : '任务已回滚';
    }
    if (task.status === 'aborted') return '任务已中止';
    return String(fallback || '').trim();
  }

  recordAssistantMessageForTask(task, employee, fallback = '') {
    const content = this.buildAssistantContent(task, fallback);
    if (!content) return null;
    return this.upsertTaskMessage(task, employee, 'assistant', content, {
      status: task.status
    });
  }

  resolveConversationTitleFromGoal(goal, fallback = '新会话') {
    const text = String(goal || '').trim();
    if (!text) return fallback;
    return text.slice(0, 30);
  }

  syncConversationByTask(task, employee) {
    const conversations = this.ensureConversationStore();
    const conversationId = String((task && task.conversationId) || '').trim();
    if (!conversationId) return;
    const now = new Date().toISOString();
    let conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      conversation = {
        id: conversationId,
        employeeId: employee.id,
        tenantId: task.tenantId || employee.tenantId,
        accountId: task.accountId || employee.accountId,
        title: '新会话',
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        lastTaskId: task.id
      };
      conversations.push(conversation);
      this.store.addEvent('conversation.created', {
        traceId: task.traceId,
        taskId: task.id,
        employeeId: employee.id,
        tenantId: conversation.tenantId,
        accountId: conversation.accountId,
        conversationId: conversation.id,
        title: conversation.title
      });
    } else {
      if (conversation.employeeId !== employee.id) {
        throw new Error('conversation belongs to another employee');
      }
      conversation.updatedAt = now;
      conversation.lastMessageAt = now;
      conversation.lastTaskId = task.id;
    }

    const currentTitle = String(conversation.title || '').trim();
    if (!currentTitle || currentTitle === '新会话') {
      conversation.title = this.resolveConversationTitleFromGoal(task.goal, currentTitle || '新会话');
      conversation.updatedAt = now;
    }
  }

  eventPayload(task, employee, extra = {}) {
    const e = employee || this.store.employees.find((x) => x.id === task.employeeId) || null;
    return {
      traceId: task.traceId,
      taskId: task.id,
      employeeId: task.employeeId,
      tenantId: task.tenantId || (e ? e.tenantId : null),
      accountId: task.accountId || (e ? e.accountId : null),
      conversationId: task.conversationId || null,
      parentAgentId: task.parentAgentId,
      employeeCode: e ? e.employeeCode : undefined,
      ...extra
    };
  }

  ensureReactTrace(task) {
    if (!task || typeof task !== 'object') return [];
    if (!Array.isArray(task.reactTrace)) task.reactTrace = [];
    return task.reactTrace;
  }

  appendReactTrace(task, phase, detail = {}) {
    if (!task || typeof task !== 'object') return null;
    const trace = this.ensureReactTrace(task);
    const entry = {
      id: `react-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      at: new Date().toISOString(),
      round: Number(task.iteration || 1),
      phase: String(phase || '').trim() || 'observe',
      detail: detail && typeof detail === 'object' ? detail : {}
    };
    trace.push(entry);
    if (trace.length > 300) task.reactTrace = trace.slice(-300);
    return entry;
  }

  isHighRisk(task) {
    return task.riskLevel === 'L4';
  }

  validateApprovalRoles(task) {
    const approvals = task.approval && Array.isArray(task.approval.approvals) ? task.approval.approvals : [];
    const roles = new Set(approvals.map((x) => x.approverRole).filter(Boolean));
    if (task.approval && task.approval.distinctRoles && roles.size < approvals.length) return false;
    const requiredAnyRoles = (task.approval && Array.isArray(task.approval.requiredAnyRoles))
      ? task.approval.requiredAnyRoles
      : [];
    if (requiredAnyRoles.length > 0 && !requiredAnyRoles.some((r) => roles.has(r))) return false;
    return true;
  }

  toRiskRank(level) {
    return governanceService.toRiskRank(level);
  }

  makePolicyDenied(message) {
    return governanceService.makePolicyDenied(message);
  }

  textContains(source, keyword) {
    return governanceService.textContains(source, keyword);
  }

  enforceTaskBoundaries(employee, input, task) {
    governanceService.enforceTaskBoundaries(employee, input, task);
  }

  create(input, accessContext = null) {
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (!input.employeeId) throw new Error('employeeId is required');
    const employee = this.store.employees.find((e) => e.id === input.employeeId);
    if (!employee) throw new Error('employee not found');
    if (ctx && (!matchAccessScope(employee, ctx) || !matchActorScope(employee, ctx, { strict: true }))) {
      throw new Error('employee not found');
    }
    if (employee.agentType !== 'parent') throw new Error('task can only be assigned to parent digital employee');

    const riskDecision = classifyTaskRisk(input, employee);
    const promptVersionRef = String((((this.store || {}).promptCenter || {}).activeVersionId) || '').trim() || null;
    const requestedModel = String((((input || {}).llmConfig || {}).model) || '').trim();
    const defaultModel = this.resolveConfiguredModelDefault();
    const task = createTask(employee, {
      ...input,
      llmConfig: {
        ...((input && input.llmConfig && typeof input.llmConfig === 'object') ? input.llmConfig : {}),
        model: requestedModel || defaultModel || null
      },
      riskLevel: riskDecision.effectiveRiskLevel,
      promptVersionRef
    });
    if (requiresExplicitBashPermission(task.goal)) {
      const runtimeConfig = task.runtimeConfig && typeof task.runtimeConfig === 'object'
        ? task.runtimeConfig
        : ((task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
      const nextScope = Array.isArray(runtimeConfig.toolScope)
        ? runtimeConfig.toolScope.filter((item) => String(item || '').trim().toLowerCase() !== 'bash')
        : [];
      const nextRuntimeConfig = {
        ...runtimeConfig,
        toolScope: Array.from(new Set(nextScope))
      };
      task.runtimeConfig = nextRuntimeConfig;
      task.openclaw = nextRuntimeConfig;
    }
    task.requestedByUserId = String(input.requestedByUserId || '').trim() || 'unknown';
    task.requestedByRole = String(input.requestedByRole || '').trim() || 'unknown';
    task.actorUserId = String(employee.actorUserId || (ctx && ctx.actorUserId) || '').trim() || null;
    task.requestChannel = String(input.requestChannel || '').trim() || 'api';
    this.applyFrontConversationSessionKey(task, employee, input);
    task.governance = {
      riskMode: 'default_allow_except_sensitive',
      requestedRiskLevel: riskDecision.requestedRiskLevel,
      effectiveRiskLevel: riskDecision.effectiveRiskLevel,
      sensitive: riskDecision.sensitive,
      riskReasons: riskDecision.reasons.slice()
    };
    this.enforceTaskBoundaries(employee, input, task);
    if (task.externalWrite && this.hasDuplicatedExternalWrite(employee.id, task.externalWrite)) {
      throw new Error('idempotency key already exists for this external action');
    }
    const childAgentPlan = evaluateChildAgentPlan(task);
    task.childAgentPlan = childAgentPlan;
    this.routeSubAgents(task, employee, childAgentPlan);
    const childAgent = childAgentPlan.planned ? {
      id: `${task.id}-child-${task.iteration}`,
      name: `worker-${task.id.slice(0, 6)}`,
      status: 'active',
      goal: task.goal,
      createdAt: new Date().toISOString()
    } : null;
    if (childAgent) employee.childAgents.push(childAgent);

    this.syncConversationByTask(task, employee);
    this.store.tasks.push(task);
    this.recordUserMessageForTask(task, employee);
    this.syncTaskDialogueContext(task, employee);
    this.store.metrics.totalTasks += 1;
    this.store.addEvent('task.risk.classified', this.eventPayload(task, employee, {
      requestedRiskLevel: riskDecision.requestedRiskLevel,
      effectiveRiskLevel: riskDecision.effectiveRiskLevel,
      sensitive: riskDecision.sensitive,
      elevated: riskDecision.elevated,
      riskReasons: riskDecision.reasons.slice()
    }));
    this.store.addEvent('task.created', this.eventPayload(task, employee, {
      goal: task.goal,
      attachmentCount: Array.isArray(task.attachments) ? task.attachments.length : 0,
      conversationId: task.conversationId,
      childAgentId: childAgent ? childAgent.id : null,
      childAgentPlanned: Boolean(childAgent),
      childAgentReasons: Array.isArray(childAgentPlan.reasons) ? childAgentPlan.reasons : [],
      externalWriteSystem: task.externalWrite ? task.externalWrite.system : null,
      externalWriteOperation: task.externalWrite ? task.externalWrite.operation : null,
      idempotencyKey: task.externalWrite ? task.externalWrite.idempotencyKey : null,
      model: task.llmConfig ? task.llmConfig.model : null,
      thinkingLevel: task.llmConfig ? task.llmConfig.thinkingLevel : 'medium',
      toolPolicy: task.llmConfig ? task.llmConfig.toolPolicy : 'balanced'
    }));
    return task;
  }

  applyFrontConversationSessionKey(task, employee, input = {}) {
    const requestChannel = String(task && task.requestChannel || '').trim().toLowerCase();
    if (requestChannel !== 'front') return;
    const conversationId = String(task && task.conversationId || '').trim();
    if (!conversationId || conversationId === 'default') return;

    const rawRuntimeConfig = (
      input
      && (
        (input.runtimeConfig && typeof input.runtimeConfig === 'object')
        || (input.openclaw && typeof input.openclaw === 'object')
      )
    )
      ? (input.runtimeConfig || input.openclaw)
      : null;
    if (rawRuntimeConfig && Object.prototype.hasOwnProperty.call(rawRuntimeConfig, 'sessionKey')) return;

    const runtimeConfig = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const employeeProfile = (employee && employee.runtimeProfile && typeof employee.runtimeProfile === 'object')
      ? employee.runtimeProfile
      : ((employee && employee.openclawProfile && typeof employee.openclawProfile === 'object') ? employee.openclawProfile : {});
    const agentId = String(runtimeConfig.agentId || employeeProfile.agentId || '').trim();
    if (!agentId) return;

    const sessionKey = `agent:${sanitizeSessionSegment(agentId, 'main')}:conv:${sanitizeSessionSegment(conversationId, 'default')}`.slice(0, 160);
    const nextRuntimeConfig = {
      ...runtimeConfig,
      sessionKey
    };
    task.runtimeConfig = nextRuntimeConfig;
    task.openclaw = nextRuntimeConfig;
  }

  hasDuplicatedExternalWrite(employeeId, externalWrite) {
    return governanceService.hasDuplicatedExternalWrite(this.store, employeeId, externalWrite);
  }

  searchSkillsForTask(task, employee, options = {}) {
    const trigger = String(options.trigger || 'runtime').trim() || 'runtime';
    const query = String(options.query || task.goal || '').trim();
    const keywords = normalizeSearchKeywords(query);
    const ranked = (this.store.skills || [])
      .map((skill) => ({ skill, score: calculateSkillSearchScore(skill, keywords) }))
      .filter((item) => !query || item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String((a.skill && a.skill.name) || '').localeCompare(String((b.skill && b.skill.name) || ''));
      })
      .slice(0, 5)
      .map((item) => ({
        id: item.skill.id,
        name: item.skill.name,
        type: item.skill.type,
        domain: item.skill.domain || null,
        source: item.skill.source || 'manual',
        score: item.score,
        structure: (() => {
          const structure = item.skill && item.skill.structure && typeof item.skill.structure === 'object'
            ? item.skill.structure
            : {};
          const skillMarkdown = String(structure.skillMarkdown || '').replaceAll('\r\n', '\n').trim();
          return {
            summary: String(structure.summary || '').trim(),
            prompt: String(structure.prompt || '').trim(),
            skillMarkdown: skillMarkdown ? skillMarkdown.slice(0, 8000) : '',
            resources: structure.resources && typeof structure.resources === 'object'
              ? structure.resources
              : undefined
          };
        })()
      }));
    const usedFindSkills = ranked.some((item) => String(item.name || '') === 'find-skills');
    task.skillSearch = {
      query,
      trigger,
      keywords,
      total: ranked.length,
      usedFindSkills,
      searchedAt: new Date().toISOString(),
      top: ranked
    };
    this.store.addEvent('skill.search.performed', this.eventPayload(task, employee, {
      trigger,
      query,
      keywordCount: keywords.length,
      matchedCount: ranked.length,
      topSkillId: ranked[0] ? ranked[0].id : null,
      topSkillName: ranked[0] ? ranked[0].name : null,
      usedFindSkills
    }));
    return task.skillSearch;
  }

  buildDialogueContext(task, employee) {
    const conversationId = String((task && task.conversationId) || 'default');
    const employeeId = String((employee && employee.id) || (task && task.employeeId) || '');
    const recentTurns = this.store.tasks
      .filter((item) => (
        item
        && item.id !== task.id
        && String(item.employeeId || '') === employeeId
        && String(item.conversationId || 'default') === conversationId
        && String(item.status || '') === 'succeeded'
      ))
      .slice(-3)
      .map((item) => ({
        goal: String(item.goal || '').slice(0, 300),
        result: String(item.result || '').slice(0, 800)
      }));
    const memory = Array.isArray((employee || {}).knowledge)
      ? employee.knowledge.slice(-5).map((entry) => ({
        title: String((entry && entry.title) || '').slice(0, 120),
        summary: String((entry && entry.summary) || '').slice(0, 500)
      }))
      : [];
    return { recentTurns, memory };
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

  matchSedimentationOverride(scope = {}, employee = {}) {
    const checks = [
      ['tenantId', String(employee.tenantId || '')],
      ['accountId', String(employee.accountId || '')],
      ['department', String(employee.department || '')],
      ['role', String(employee.role || '')],
      ['employeeId', String(employee.id || '')]
    ];
    let score = 0;
    for (const [key, value] of checks) {
      const expected = String(scope[key] || '').trim();
      if (!expected) continue;
      if (expected !== value) return 0;
      score += 1;
    }
    return score;
  }

  resolveSkillSedimentationOverride(overrides = [], employee = {}) {
    let best = null;
    let bestScore = 0;
    for (const item of overrides) {
      const score = this.matchSedimentationOverride(item.scope || {}, employee);
      if (score <= 0) continue;
      if (!best || score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  normalizeSkillSedimentationPolicy(employee = null) {
    const src = this.store && this.store.skillSedimentationPolicy && typeof this.store.skillSedimentationPolicy === 'object'
      ? this.store.skillSedimentationPolicy
      : {};
    const mode = String(src.mode || '').trim().toLowerCase();
    const promotionMode = String(src.promotionMode || '').trim().toLowerCase();
    const minConfidenceRaw = Number(src.minConfidence);
    const minRepeatedRaw = Number(src.minRepeatedSuccessForFallback);
    const normalizedOverrides = Array.isArray(src.overrides) ? src.overrides : [];
    const matchedOverride = employee ? this.resolveSkillSedimentationOverride(normalizedOverrides, employee) : null;
    const effectiveMode = String(matchedOverride && matchedOverride.mode || mode).trim().toLowerCase();
    const effectiveMinConfidenceRaw = Number(matchedOverride ? matchedOverride.minConfidence : minConfidenceRaw);
    const effectiveMinRepeatedRaw = Number(matchedOverride ? matchedOverride.minRepeatedSuccessForFallback : minRepeatedRaw);
    const effectiveFallback = matchedOverride
      ? Boolean(matchedOverride.fallbackToRulesWhenModelUnavailable !== false)
      : Boolean(src.fallbackToRulesWhenModelUnavailable !== false);
    return {
      mode: ['rules', 'model_driven', 'hybrid'].includes(effectiveMode) ? effectiveMode : 'hybrid',
      promotionMode: ['direct', 'proposal'].includes(promotionMode) ? promotionMode : 'direct',
      minConfidence: Number.isFinite(effectiveMinConfidenceRaw)
        ? Math.max(0, Math.min(1, effectiveMinConfidenceRaw))
        : 0.7,
      fallbackToRulesWhenModelUnavailable: effectiveFallback,
      minRepeatedSuccessForFallback: Number.isFinite(effectiveMinRepeatedRaw)
        ? Math.max(1, Math.round(effectiveMinRepeatedRaw))
        : 2,
      scopeOverrideId: matchedOverride ? String(matchedOverride.id || '') : null
    };
  }

  countSucceededCapabilityTasks(employeeId, capability) {
    return (this.store.tasks || []).filter((x) => (
      x
      && x.employeeId === employeeId
      && x.status === 'succeeded'
      && inferCapability(x.goal) === capability
    )).length;
  }

  buildSkillSedimentationPrompt(task, employee, capability, seed, repeatedSuccessCount, policy) {
    return [
      '你是数字员工技能沉淀决策器。',
      '请判断这次任务是否沉淀技能，并只输出 JSON 对象，不要解释。',
      `任务目标: ${String(task.goal || '').slice(0, 300)}`,
      `任务风险等级: ${String(task.riskLevel || 'L2')}`,
      `员工部门: ${String((employee && employee.department) || '').slice(0, 80)}`,
      `员工角色: ${String((employee && employee.role) || '').slice(0, 80)}`,
      `推断能力标签: ${capability}`,
      `规则候选技能: ${seed.name}|${seed.type}|${seed.domain || 'none'}`,
      `历史成功次数(同能力): ${repeatedSuccessCount}`,
      `平台最低置信度要求: ${policy.minConfidence}`,
      '输出字段:',
      'sediment(boolean), confidence(number 0-1), reason(string), skill(object),',
      'skill.name(string), skill.type(general|domain), skill.domain(string|null), skill.description(string)',
      '约束：若不应沉淀，sediment=false。若 sediment=true 必须给 skill.name 和 skill.type。'
    ].join('\n');
  }

  normalizeModelSedimentationDecision(raw, seed) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const sediment = Boolean(data.sediment);
    const confidenceRaw = Number(data.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    const incomingSkill = data.skill && typeof data.skill === 'object' ? data.skill : {};
    const type = String(incomingSkill.type || '').trim().toLowerCase() === 'domain' ? 'domain' : 'general';
    const fallbackName = seed && seed.name ? seed.name : 'general-ops';
    const name = sanitizeSkillName(incomingSkill.name, sanitizeSkillName(fallbackName, 'general-ops'));
    const domainRaw = String(incomingSkill.domain || '').trim().toLowerCase();
    const domain = type === 'domain'
      ? sanitizeSkillName(domainRaw || String(seed.domain || '').trim().toLowerCase() || 'general')
      : null;
    const description = String(incomingSkill.description || data.reason || `${name}（模型驱动沉淀）`).trim().slice(0, 500);
    return {
      sediment,
      confidence,
      reason: String(data.reason || '').trim().slice(0, 500) || 'model_decision',
      skill: {
        name,
        type,
        domain,
        description
      }
    };
  }

  async decideModelDrivenSedimentation(task, employee, capability, seed, repeatedSuccessCount, policy) {
    if (!(this.dialogueGateway && typeof this.dialogueGateway.isEnabled === 'function' && this.dialogueGateway.isEnabled())) {
      return null;
    }
    const raw = await this.dialogueGateway.generateReply({
      goal: this.buildSkillSedimentationPrompt(task, employee, capability, seed, repeatedSuccessCount, policy),
      riskLevel: task.riskLevel,
      llmConfig: task.llmConfig || {},
      employee
    });
    return this.normalizeModelSedimentationDecision(this.extractJsonObject(raw), seed);
  }

  buildSedimentSkillMarkdown(task, employee, skill, options = {}) {
    const goal = String((task && task.goal) || '').trim();
    const name = String((skill && skill.name) || '').trim();
    const type = String((skill && skill.type) || '').trim().toLowerCase() === 'domain' ? 'domain' : 'general';
    const domain = type === 'domain' ? String((skill && skill.domain) || '').trim() : '';
    const description = String((skill && skill.description) || '').trim();
    const decisionEngine = String(options.decisionEngine || '').trim() || 'rules';
    const decisionReason = String(options.decisionReason || '').trim();
    const department = String((employee && employee.department) || '').trim();
    const role = String((employee && employee.role) || '').trim();
    const lines = [
      `# ${name || 'skill'}`,
      '',
      '## 定位',
      `- ${description || `${name} 技能沉淀`}`,
      '',
      '## 元数据',
      `- type: ${type}`,
      `- domain: ${domain || 'none'}`,
      `- decision_engine: ${decisionEngine}`,
      `- owner_department: ${department || 'unknown'}`,
      `- owner_role: ${role || 'unknown'}`,
      '',
      '## 来源任务',
      `- goal: ${goal || 'n/a'}`,
      `- reason: ${decisionReason || 'n/a'}`,
      '',
      '## 执行规范',
      '- 先澄清目标与边界，再执行关键步骤。',
      '- 输出可复用结论与下一步建议。',
      '- 若涉及外部系统写操作，必须携带可核验回执。'
    ];
    return lines.join('\n').trim();
  }

  buildSedimentSkillStructure(task, employee, inputSkill = {}, options = {}) {
    const sourceStructure = inputSkill.structure && typeof inputSkill.structure === 'object' ? inputSkill.structure : {};
    const prompt = String(
      inputSkill.prompt
      || inputSkill.systemPrompt
      || sourceStructure.prompt
      || sourceStructure.systemPrompt
      || ''
    ).trim();
    const skillMarkdown = String(
      inputSkill.skillMarkdown
      || inputSkill.markdown
      || sourceStructure.skillMarkdown
      || sourceStructure.markdown
      || this.buildSedimentSkillMarkdown(task, employee, inputSkill, options)
    ).replaceAll('\r\n', '\n').trim();
    return {
      ...(sourceStructure && typeof sourceStructure === 'object' ? sourceStructure : {}),
      prompt,
      skillMarkdown,
      resources: sourceStructure.resources && typeof sourceStructure.resources === 'object'
        ? sourceStructure.resources
        : undefined
    };
  }

  applySedimentedSkill(employee, task, inputSkill = {}, options = {}) {
    const source = String(options.source || 'auto-derived');
    const promotionMode = String(options.promotionMode || 'direct');
    const decisionReason = String(options.decisionReason || '').slice(0, 500);
    const decisionEngine = String(options.decisionEngine || '').trim() || 'rules';
    const type = String(inputSkill.type || '').trim().toLowerCase() === 'domain' ? 'domain' : 'general';
    const fallbackName = inferSkillSeed(task.goal, inferCapability(task.goal)).name;
    const name = sanitizeSkillName(inputSkill.name, sanitizeSkillName(fallbackName, 'general-ops'));
    const domain = type === 'domain'
      ? sanitizeSkillName(inputSkill.domain, sanitizeSkillName(String(employee.department || 'general').toLowerCase(), 'general'))
      : null;
    const description = String(inputSkill.description || `${name}（任务自动沉淀）`).trim().slice(0, 500);
    const structure = this.buildSedimentSkillStructure(task, employee, {
      ...inputSkill,
      name,
      type,
      domain,
      description
    }, options);
    if (!String(structure.skillMarkdown || '').trim()) {
      this.store.addEvent('skill.sedimentation.rejected', this.eventPayload(task, employee, {
        name,
        type,
        domain,
        reason: 'skill_markdown_missing'
      }));
      return null;
    }
    const existing = this.store.skills.find((s) => s.name === name && s.type === type && s.domain === domain);
    const shouldCreateProposal = promotionMode === 'proposal' && !existing;
    const skill = existing || createSkill(shouldCreateProposal
      ? {
        name,
        type,
        domain,
        source: 'auto-proposal',
        description,
        status: 'pending',
        structure
      }
      : {
        name,
        type,
        domain,
        source,
        description,
        structure
      });
    if (!existing) {
      if (shouldCreateProposal) {
        const now = new Date().toISOString();
        const proposedBy = String(
          options.proposedBy
          || task.requestedByUserId
          || 'runtime'
        );
        skill.proposal = {
          proposedBy,
          proposedAt: now,
          decisionEngine,
          confidence: Number.isFinite(Number(options.confidence)) ? Math.max(0, Math.min(1, Number(options.confidence))) : 0.8,
          policySnapshot: options.policySnapshot && typeof options.policySnapshot === 'object'
            ? options.policySnapshot
            : null,
          evaluation: {
            schemaVersion: OSS_EVALUATION_SCHEMA_VERSION,
            dimensions: Object.fromEntries(REQUIRED_DIMENSIONS.map((key) => [key, 3])),
            summaryDimensionCount: REQUIRED_DIMENSIONS.length,
            hardGate: { passed: true, reasons: [] },
            evidence: [{
              sourceUrl: `task://${task.id}`,
              capturedAt: now,
              evidenceExcerpt: String(task.goal || '').slice(0, 200),
              confidence: 0.7
            }]
          },
          history: [{
            from: null,
            to: 'pending',
            note: decisionReason || 'auto proposal created by runtime',
            at: now,
            actorId: proposedBy
          }]
        };
      }
      this.store.skills.push(skill);
      const sedimentMetrics = this.ensureSkillSedimentationMetrics();
      if (shouldCreateProposal) sedimentMetrics.proposalCreated += 1;
      else sedimentMetrics.directCreated += 1;
      this.store.addEvent(shouldCreateProposal ? 'skill.auto.proposed' : 'skill.auto.created', this.eventPayload(task, employee, {
        skillId: skill.id,
        name: skill.name,
        source: shouldCreateProposal ? 'auto-proposal' : source,
        status: skill.status,
        decisionEngine,
        promotionMode
      }));
    }
    if (['active', 'approved'].includes(String(skill.status || '')) && !employee.linkedSkillIds.includes(skill.id)) {
      employee.linkedSkillIds.push(skill.id);
      this.store.addEvent('skill.auto.linked', this.eventPayload(task, employee, {
        skillId: skill.id
      }));
    }
    return skill;
  }

  async resolveNaturalResult(task, employee, rawResult, source = 'unknown') {
    const candidates = [];
    if (typeof rawResult === 'string') candidates.push(String(rawResult || '').trim());
    if (rawResult && typeof rawResult === 'object') {
      candidates.push(
        String(rawResult.result || '').trim(),
        String(rawResult.message || '').trim(),
        String(rawResult.output || '').trim(),
        String(rawResult.summary || '').trim(),
        String(rawResult.text || '').trim()
      );
    }
    for (const text of candidates) {
      if (!text) continue;
      if (isEchoResult(text, task.goal)) continue;
      if (isSyntheticRuntimeResult(text, source)) continue;
      return text;
    }
    throw new Error('Runtime result unavailable');
  }

  async generateLlmDirectReply(task, employee) {
    if (!(this.dialogueGateway && typeof this.dialogueGateway.isEnabled === 'function' && this.dialogueGateway.isEnabled())) {
      return '';
    }
    try {
      const raw = await this.dialogueGateway.generateReply({
        goal: task.goal,
        riskLevel: task.riskLevel,
        llmConfig: task.llmConfig || {},
        conversationId: task.conversationId || 'default',
        employee
      });
      const text = String(raw || '').trim();
      if (!text) return '';
      if (isEchoResult(text, task.goal)) return '';
      return text;
    } catch {
      return '';
    }
  }

  hasGrantedTool(employee, toolName) {
    const runtimeProfile = employee && employee.runtimeProfile && typeof employee.runtimeProfile === 'object'
      ? employee.runtimeProfile
      : (employee && employee.openclawProfile && typeof employee.openclawProfile === 'object'
        ? employee.openclawProfile
        : {});
    const scope = Array.isArray(runtimeProfile.toolScope) ? runtimeProfile.toolScope : [];
    return scope.some((item) => String(item || '').trim().toLowerCase() === String(toolName || '').trim().toLowerCase());
  }

  grantToolPermission(employee, task, toolName) {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (!normalized) return;
    const runtimeProfile = employee && employee.runtimeProfile && typeof employee.runtimeProfile === 'object'
      ? employee.runtimeProfile
      : (employee && employee.openclawProfile && typeof employee.openclawProfile === 'object'
        ? employee.openclawProfile
        : {});
    const employeeScope = Array.isArray(runtimeProfile.toolScope) ? runtimeProfile.toolScope.slice() : [];
    if (!employeeScope.some((item) => String(item || '').trim().toLowerCase() === normalized)) {
      employeeScope.push(normalized);
    }
    const nextRuntimeProfile = {
      ...runtimeProfile,
      toolScope: Array.from(new Set(employeeScope))
    };
    employee.runtimeProfile = nextRuntimeProfile;
    employee.openclawProfile = nextRuntimeProfile;
    const taskRuntime = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const taskScope = Array.isArray(taskRuntime.toolScope) ? taskRuntime.toolScope.slice() : [];
    if (!taskScope.some((item) => String(item || '').trim().toLowerCase() === normalized)) {
      taskScope.push(normalized);
    }
    const nextTaskRuntime = {
      ...taskRuntime,
      toolScope: Array.from(new Set(taskScope))
    };
    task.runtimeConfig = nextTaskRuntime;
    task.openclaw = nextTaskRuntime;
  }

  inferDeniedToolName(outcome = {}) {
    return failurePolicyService.inferDeniedToolName(outcome);
  }

  extractPermissionDeniedRequest(outcome = {}) {
    return failurePolicyService.extractPermissionDeniedRequest(outcome);
  }

  requiresExecutionEvidence(task = null) {
    if (!task || typeof task !== 'object') return false;
    if (task.externalWrite && typeof task.externalWrite === 'object') return true;
    const evidence = task.runtime && typeof task.runtime.evidence === 'object'
      ? task.runtime.evidence
      : {};
    const deliveryIntent = Boolean(evidence.deliveryIntent);
    const dialogueEnabled = Boolean(
      this.dialogueGateway
      && typeof this.dialogueGateway.isEnabled === 'function'
      && this.dialogueGateway.isEnabled()
    );
    return deliveryIntent && !dialogueEnabled;
  }

  requestRuntimeToolPermission(task, employee, request = {}) {
    const tool = String(request.tool || '').trim().toLowerCase() || 'unknown';
    const reason = String(request.reason || 'runtime tool permission denied').slice(0, 500);
    task.runtimePermission = {
      type: 'runtime_tool_permission',
      status: 'requested',
      tool,
      reason,
      requestedAt: new Date().toISOString(),
      approvals: []
    };
    task.status = 'validating';
    task.updatedAt = new Date().toISOString();
    this.store.addEvent('permission.requested', this.eventPayload(task, employee, {
      permissionType: task.runtimePermission.type,
      permissionTool: tool,
      reason
    }));
    this.store.addEvent('task.approval.required', this.eventPayload(task, employee, {
      riskLevel: task.riskLevel,
      approvalType: task.runtimePermission.type,
      permissionTool: tool
    }));
  }

  emitRuntimeToolCatalog(task, employee) {
    const builtin = ['bash', 'read', 'write', 'http', 'search', 'test'];
    const services = Array.isArray(this.store.mcpServices) ? this.store.mcpServices : [];
    const managed = services
      .filter((item) => item && item.enabled === true && String(item.registrationStatus || '') === 'approved')
      .map((item) => String(item.name || item.serviceName || item.id || '').trim().toLowerCase())
      .filter(Boolean);
    const availableTools = Array.from(new Set([...builtin, ...managed]));
    const grantedTools = Array.isArray((((employee || {}).runtimeProfile || {}).toolScope))
      ? employee.runtimeProfile.toolScope.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : (Array.isArray((((employee || {}).openclawProfile || {}).toolScope))
        ? employee.openclawProfile.toolScope.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : []);
    this.store.addEvent('runtime.tools.discovered', this.eventPayload(task, employee, {
      availableTools,
      grantedTools
    }));
    return {
      availableTools,
      grantedTools
    };
  }

  shouldRunCapabilityPrecheck(task) {
    const currentIteration = Number(task && task.iteration || 0);
    const snapshot = task && task.capabilityPrecheck && typeof task.capabilityPrecheck === 'object'
      ? task.capabilityPrecheck
      : null;
    if (!snapshot) return true;
    if (!snapshot.checkedAt) return true;
    return Number(snapshot.iteration || 0) !== currentIteration;
  }

  precheckTaskCapabilities(task, employee) {
    if (!task || !employee) return null;
    if (!this.shouldRunCapabilityPrecheck(task)) return task.capabilityPrecheck;

    const toolCatalog = this.emitRuntimeToolCatalog(task, employee);
    const skillSearch = this.searchSkillsForTask(task, employee, {
      trigger: 'precheck',
      query: task.goal
    });
    const hasReusableSkill = Number(skillSearch && skillSearch.total || 0) > 0;
    const grantedTools = Array.isArray(toolCatalog && toolCatalog.grantedTools)
      ? toolCatalog.grantedTools
      : [];
    const hasGrantedTool = grantedTools.length > 0 && !isCapabilityBaselineToolScope(grantedTools);
    const research = (!hasReusableSkill && !hasGrantedTool)
      ? this.queueOssResearch(employee, task, null, { reason: 'task_precheck' })
      : null;

    const snapshot = {
      iteration: Number(task.iteration || 0),
      checkedAt: new Date().toISOString(),
      matchedSkillCount: Number(skillSearch && skillSearch.total || 0),
      hasReusableSkill,
      availableToolCount: Array.isArray(toolCatalog && toolCatalog.availableTools) ? toolCatalog.availableTools.length : 0,
      grantedToolCount: Array.isArray(toolCatalog && toolCatalog.grantedTools) ? toolCatalog.grantedTools.length : 0,
      hasGrantedTool,
      queuedResearch: Boolean(research),
      researchQueueId: research ? research.id : null
    };
    task.capabilityPrecheck = snapshot;
    this.appendReactTrace(task, 'plan', {
      summary: 'task capability precheck',
      matchedSkillCount: snapshot.matchedSkillCount,
      grantedToolCount: snapshot.grantedToolCount
    });
    this.appendReactTrace(task, 'act', {
      action: 'capability_precheck',
      queuedResearch: snapshot.queuedResearch
    });
    this.appendReactTrace(task, 'observe', {
      evidence: {
        hasReusableSkill: snapshot.hasReusableSkill,
        hasGrantedTool: snapshot.hasGrantedTool
      }
    });
    this.appendReactTrace(task, 'reflect', {
      next: snapshot.queuedResearch ? 'external_research_queued' : 'execution_ready'
    });
    this.store.addEvent('task.capability.prechecked', this.eventPayload(task, employee, snapshot));
    return snapshot;
  }

  run(taskId, accessContext = null) {
    const task = this.getTask(taskId, accessContext);
    if (task.status === 'running') throw new Error('task already running');
    task.status = 'pending';
    task.updatedAt = new Date().toISOString();
    this.store.addEvent('task.requeued', this.eventPayload(task, null));
    return task;
  }

  approve(taskId, approverId, note = '', approverRole = '', accessContext = null) {
    const task = this.getTask(taskId, accessContext, { allowActorBypass: true });
    if (task.status !== 'validating') throw new Error('task is not waiting for approval');
    if (!approverId) throw new Error('approverId is required');
    const role = String(approverRole || '').trim();
    if (!role) throw new Error('approverRole is required for high-risk approval');
    const runtimePermission = task.runtimePermission && task.runtimePermission.status === 'requested'
      ? task.runtimePermission
      : null;
    if (!task.requiresApproval && !runtimePermission) throw new Error('approval is not required for this task');
    const approver = String(approverId);
    if (runtimePermission) {
      const already = (runtimePermission.approvals || []).some((x) => x.approverId === approver);
      if (already) throw new Error('approver already approved this task');
      runtimePermission.approvals.push({
        approverId: approver,
        approverRole: role,
        approvedAt: new Date().toISOString(),
        note: String(note || '').slice(0, 500)
      });
      runtimePermission.status = 'granted';
      runtimePermission.grantedAt = new Date().toISOString();
      const employee = this.store.employees.find((e) => e.id === task.employeeId) || null;
      if (!employee) throw new Error('employee not found');
      this.grantToolPermission(employee, task, runtimePermission.tool);
      task.status = 'pending';
      task.updatedAt = new Date().toISOString();
      this.store.addEvent('permission.granted', this.eventPayload(task, employee, {
        permissionType: runtimePermission.type,
        permissionTool: runtimePermission.tool,
        approverId: approver,
        approverRole: role,
        note: String(note || '').slice(0, 500)
      }));
      this.store.addEvent('task.requeued', this.eventPayload(task, employee, {
        reason: 'runtime_tool_permission_granted',
        permissionTool: runtimePermission.tool
      }));
      return task;
    }

    const already = (task.approval.approvals || []).some((x) => x.approverId === approver);
    if (already) throw new Error('approver already approved this task');
    task.approval.approvals.push({
      approverId: approver,
      approverRole: role,
      approvedAt: new Date().toISOString(),
      note: String(note || '').slice(0, 500)
    });
    task.approval.approved = (
      task.approval.approvals.length >= Number(task.approval.requiredApprovals || 2)
      && this.validateApprovalRoles(task)
    );
    if (task.approval.approved) task.approval.approvedAt = new Date().toISOString();
    task.status = task.approval.approved ? 'approved' : 'validating';
    task.updatedAt = new Date().toISOString();
    this.store.addEvent('task.approved', this.eventPayload(task, null, {
      approverId: approver,
      approverRole: role,
      note: String(note || '').slice(0, 500),
      approvalsCount: task.approval.approvals.length,
      requiredApprovals: task.approval.requiredApprovals
    }));
    return task;
  }

  rollback(taskId, reason = 'manual rollback', actor = {}, accessContext = null) {
    const task = this.getTask(taskId, accessContext, { allowActorBypass: true });
    if (!this.isRecoveryChainEnabled()) {
      const error = new Error('task recovery chain is disabled');
      error.statusCode = 409;
      error.code = 'RECOVERY_CHAIN_DISABLED';
      throw error;
    }
    if (!['failed', 'running', 'approved', 'validating', 'pending'].includes(task.status)) {
      throw new Error('task status cannot be rolled back');
    }
    const employee = this.store.employees.find((e) => e.id === task.employeeId) || null;
    this.applyRollback(task, employee, 'manual', String(reason || 'manual rollback'), actor);
    return task;
  }

  async abort(taskId, accessContext = null) {
    const task = this.getTask(taskId, accessContext);
    const employee = this.store.employees.find((e) => e.id === task.employeeId) || null;
    if (task.status === 'aborted') return task;
    if (['succeeded', 'failed', 'rolled_back'].includes(task.status)) {
      const error = new Error(`task status cannot be aborted: ${task.status}`);
      error.statusCode = 409;
      error.code = 'TASK_ABORT_STATUS_INVALID';
      throw error;
    }
    const runtime = task && task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
    const runtimeTaskId = String(runtime.taskId || task.runtimeTaskId || '').trim();
    const requiresRuntimeAbort = task.status === 'running' || Boolean(runtimeTaskId);
    if (requiresRuntimeAbort) {
      if (!this.executionGateway || typeof this.executionGateway.abortTask !== 'function') {
        const error = new Error('runtime abort is unavailable');
        error.statusCode = 503;
        error.code = 'RUNTIME_ABORT_UNAVAILABLE';
        throw error;
      }
      const runtimeResult = await this.executionGateway.abortTask(task, employee);
      if (!runtimeResult || runtimeResult.ok !== true) {
        const error = new Error(String((runtimeResult && runtimeResult.message) || 'runtime abort failed'));
        error.statusCode = Number((runtimeResult && runtimeResult.statusCode) || 409);
        error.code = String((runtimeResult && runtimeResult.code) || 'RUNTIME_ABORT_FAILED');
        throw error;
      }
      this.store.addEvent('runtime.task.abort.synced', this.eventPayload(task, employee, {
        source: 'openclaw',
        runtimeTaskId: String(runtimeResult.runtimeTaskId || runtimeTaskId || '').trim() || null,
        runtimeStatus: String(runtimeResult.status || 'aborted').trim().toLowerCase() || 'aborted'
      }));
    }
    task.status = 'aborted';
    task.updatedAt = new Date().toISOString();
    this.recordAssistantMessageForTask(task, employee);
    this.store.addEvent('task.aborted', this.eventPayload(task, null, {
      source: 'openclaw',
      runtimeTaskId: runtimeTaskId || null
    }));
    return task;
  }

  normalizeExternalSkills(employee, items, task) {
    for (const s of items || []) {
      const type = s.type === 'domain' ? 'domain' : 'general';
      const domain = type === 'domain' ? (s.domain || employee.department.toLowerCase()) : null;
      const existing = this.store.skills.find((x) => x.name === s.name && x.type === type && x.domain === domain);
      const skill = existing || createSkill({
        name: s.name,
        type,
        domain,
        source: 'openclaw-derived',
        description: s.description || `${s.name}（OpenClaw沉淀）`
      });
      if (!existing) {
        this.store.skills.push(skill);
        this.store.addEvent('skill.auto.created', this.eventPayload(task, employee, {
          skillId: skill.id,
          name: skill.name,
          source: 'openclaw'
        }));
      }
      if (!employee.linkedSkillIds.includes(skill.id)) {
        employee.linkedSkillIds.push(skill.id);
        this.store.addEvent('skill.auto.linked', this.eventPayload(task, employee, {
          skillId: skill.id,
        }));
      }
    }
  }

  async autoSkillize(employee, task) {
    const capability = inferCapability(task.goal);
    if (!employee.capabilities.includes(capability)) employee.capabilities.push(capability);
    const policy = this.normalizeSkillSedimentationPolicy(employee);
    const repeatedSuccessCount = this.countSucceededCapabilityTasks(employee.id, capability);
    const seed = inferSkillSeed(task.goal, capability);
    const canSedimentByBaseRules = shouldSedimentSkill({
      task,
      employeeId: employee.id,
      allTasks: this.store.tasks
    });
    const canSedimentByRules = canSedimentByBaseRules
      && repeatedSuccessCount >= policy.minRepeatedSuccessForFallback;
    const fallbackAllowed = repeatedSuccessCount >= policy.minRepeatedSuccessForFallback;

    if (policy.mode === 'rules') {
      if (!canSedimentByRules) {
        this.ensureSkillSedimentationMetrics().skipped += 1;
        this.store.addEvent('skill.sedimentation.skipped', this.eventPayload(task, employee, {
          capability,
          reason: 'insufficient_repeated_success'
        }));
        return;
      }
      this.applySedimentedSkill(employee, task, {
        ...seed,
        description: `${seed.name}（任务自动沉淀）`
      }, {
        source: 'auto-derived',
        promotionMode: policy.promotionMode,
        decisionEngine: 'rules',
        decisionReason: 'rules_threshold_met'
      });
      this.store.addEvent('skill.sedimentation.decision', this.eventPayload(task, employee, {
        capability,
        mode: policy.mode,
        engine: 'rules',
        sediment: true,
        confidence: 1,
        reason: 'rules_threshold_met',
        repeatedSuccessCount,
        policySnapshot: policy,
        policyOverrideId: policy.scopeOverrideId
      }));
      return;
    }

    let decision = null;
    try {
      decision = await this.decideModelDrivenSedimentation(task, employee, capability, seed, repeatedSuccessCount, policy);
    } catch (error) {
      this.store.addEvent('skill.sedimentation.model.error', this.eventPayload(task, employee, {
        capability,
        reason: String(error.message || 'model_decision_failed').slice(0, 500)
      }));
      decision = null;
    }

    const modelAccepted = Boolean(
      decision
      && decision.sediment
      && decision.confidence >= policy.minConfidence
      && decision.skill
      && decision.skill.name
    );
    if (modelAccepted) {
      this.applySedimentedSkill(employee, task, decision.skill, {
        source: 'model-derived',
        promotionMode: policy.promotionMode,
        decisionEngine: 'llm',
        decisionReason: decision.reason,
        confidence: decision.confidence,
        policySnapshot: policy
      });
      this.store.addEvent('skill.sedimentation.decision', this.eventPayload(task, employee, {
        capability,
        mode: policy.mode,
        engine: 'llm',
        sediment: true,
        confidence: decision.confidence,
        reason: decision.reason,
        repeatedSuccessCount,
        policySnapshot: policy,
        policyOverrideId: policy.scopeOverrideId
      }));
      return;
    }

    const fallbackEnabled = policy.mode === 'hybrid'
      || (policy.mode === 'model_driven' && policy.fallbackToRulesWhenModelUnavailable);
    if (fallbackEnabled && fallbackAllowed && canSedimentByRules) {
      this.applySedimentedSkill(employee, task, {
        ...seed,
        description: `${seed.name}（任务自动沉淀）`
      }, {
        source: 'auto-derived',
        promotionMode: policy.promotionMode,
        decisionEngine: 'rules-fallback',
        decisionReason: decision ? `model_not_accepted:${decision.reason}` : 'model_unavailable_fallback',
        confidence: decision ? decision.confidence : 0,
        policySnapshot: policy
      });
      this.store.addEvent('skill.sedimentation.decision', this.eventPayload(task, employee, {
        capability,
        mode: policy.mode,
        engine: 'rules-fallback',
        sediment: true,
        confidence: decision ? decision.confidence : 0,
        reason: decision ? `model_not_accepted:${decision.reason}` : 'model_unavailable_fallback',
        repeatedSuccessCount,
        policySnapshot: policy,
        policyOverrideId: policy.scopeOverrideId
      }));
      return;
    }

    const skipReason = decision
      ? (decision.confidence < policy.minConfidence ? 'model_confidence_too_low' : 'model_rejected')
      : (fallbackEnabled ? 'insufficient_repeated_success' : 'model_unavailable');
    this.ensureSkillSedimentationMetrics().skipped += 1;
    this.store.addEvent('skill.sedimentation.skipped', this.eventPayload(task, employee, {
      capability,
      reason: skipReason,
      mode: policy.mode,
      repeatedSuccessCount,
      minConfidence: policy.minConfidence,
      policyOverrideId: policy.scopeOverrideId
    }));
    this.store.addEvent('skill.sedimentation.decision', this.eventPayload(task, employee, {
      capability,
      mode: policy.mode,
      engine: decision ? 'llm' : 'none',
      sediment: false,
      confidence: decision ? decision.confidence : 0,
      reason: decision ? decision.reason : 'model_unavailable',
      repeatedSuccessCount,
      policySnapshot: policy,
      policyOverrideId: policy.scopeOverrideId
    }));
  }

  queueOssResearch(employee, task, explicitQuery = null, options = {}) {
    const reason = String(options.reason || 'task_correction').trim() || 'task_correction';
    const approvedToolCount = (this.store.mcpServices || []).filter((x) => (
      x
      && x.enabled === true
      && String(x.registrationStatus || 'approved') === 'approved'
    )).length;
    const activeTaskCount = this.store.tasks.filter((x) => (
      x && ['pending', 'validating', 'approved', 'running'].includes(String(x.status || ''))
    )).length;
    const queueBacklog = this.store.researchQueue.filter((x) => String(x.status || '') === 'queued').length;
    const policy = this.retrievalPolicy.decide({
      reason,
      linkedSkillsCount: Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds.length : 0,
      knowledgeCount: Array.isArray(employee.knowledge) ? employee.knowledge.length : 0,
      approvedToolCount,
      activeTaskCount,
      queueBacklog,
      preferredMode: this.getRetrievalPreferredMode(employee)
    });
    this.store.addEvent('retrieval.policy.decided', this.eventPayload(task, employee, {
      reason,
      retrievalOrder: policy.order,
      retrievalSchedulingMode: policy.schedulingMode,
      retrievalDecision: policy.decision,
      retrievalRationale: policy.rationale,
      retrievalMetrics: policy.metrics
    }));
    if (policy.decision !== 'external_search') {
      this.recordRetrievalDecision(policy, { skippedExternal: true });
      this.store.addEvent('oss.research.skipped', this.eventPayload(task, employee, {
        reason: 'policy_preferred_non_external',
        retrievalSchedulingMode: policy.schedulingMode,
        retrievalDecision: policy.decision,
        retrievalRationale: policy.rationale
      }));
      return null;
    }
    const query = (explicitQuery || `${employee.department} ${employee.role} ${task.goal}`).slice(0, 120);
    const item = {
      id: `${task.id}-research-${Date.now()}`,
      taskId: task.id,
      employeeId: employee.id,
      tenantId: task.tenantId || employee.tenantId || null,
      accountId: task.accountId || employee.accountId || null,
      query,
      goal: task.goal,
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    this.store.researchQueue.push(item);
    this.recordRetrievalDecision(policy, { queuedExternal: true });
    this.store.addEvent('oss.research.queued', this.eventPayload(task, employee, { query }));
    return item;
  }

  applyExternalChildren(employee, task, children) {
    for (const c of children || []) {
      const childAgent = {
        id: c.id || `${task.id}-child-${Math.random()}`,
        name: c.name || `worker-${task.id.slice(0, 6)}`,
        status: c.status || 'active',
        goal: c.goal || task.goal,
        createdAt: c.createdAt || new Date().toISOString()
      };
      employee.childAgents.push(childAgent);
      this.store.addEvent('child.agent.created', this.eventPayload(task, employee, {
        childAgentId: childAgent.id,
        childAgentName: childAgent.name
      }));
    }
  }

  normalizeComparableResult(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 2000);
  }

  computeShadowDiff(primaryOutcome = {}, shadowOutcome = {}) {
    const primaryStatus = String(primaryOutcome.status || '').trim().toLowerCase();
    const shadowStatus = String(shadowOutcome.status || '').trim().toLowerCase();
    const primaryResult = this.normalizeComparableResult(primaryOutcome.result);
    const shadowResult = this.normalizeComparableResult(shadowOutcome.result);
    const primaryEvents = Array.isArray(primaryOutcome.runtimeEvents) ? primaryOutcome.runtimeEvents.length : 0;
    const shadowEvents = Array.isArray(shadowOutcome.runtimeEvents) ? shadowOutcome.runtimeEvents.length : 0;
    const statusScore = primaryStatus && shadowStatus && primaryStatus === shadowStatus ? 1 : 0;
    const resultScore = primaryResult && shadowResult && primaryResult === shadowResult ? 1 : 0;
    const eventScore = primaryEvents === shadowEvents
      ? 1
      : (Math.max(primaryEvents, shadowEvents) > 0
        ? Number((1 - (Math.abs(primaryEvents - shadowEvents) / Math.max(primaryEvents, shadowEvents))).toFixed(3))
        : 1);
    const overallScore = Number(((statusScore * 0.4) + (resultScore * 0.4) + (eventScore * 0.2)).toFixed(3));
    return {
      statusMatch: statusScore === 1,
      resultMatch: resultScore === 1,
      eventCountMatch: primaryEvents === shadowEvents,
      scores: {
        status: statusScore,
        result: resultScore,
        event: eventScore,
        overall: overallScore
      },
      primaryResultPreview: primaryResult.slice(0, 200),
      shadowResultPreview: shadowResult.slice(0, 200)
    };
  }

  async runShadowComparison(task, employee, primaryOutcome) {
    const runtimePolicy = this.shadowPolicyProvider ? this.shadowPolicyProvider() : null;
    const shadowEnabled = this.shadowCompareEnabled || Boolean(runtimePolicy && runtimePolicy.enabled);
    if (!shadowEnabled) return;
    const hasRuntimePolicy = Boolean(runtimePolicy && typeof runtimePolicy === 'object');
    const runtimePolicyPersisted = hasRuntimePolicy && Boolean(runtimePolicy.updatedAt);
    const runtimePolicyExplicitEnabled = hasRuntimePolicy && runtimePolicy.enabled === true;
    const shouldUseRuntimePolicy = hasRuntimePolicy
      && (runtimePolicyPersisted || runtimePolicyExplicitEnabled || !this.shadowCompareEnabled);
    const policyService = shouldUseRuntimePolicy
      ? new RuntimeShadowPolicyService({
        enabled: Boolean(runtimePolicy.enabled),
        allowTenants: Array.isArray(runtimePolicy.allowTenants)
          ? runtimePolicy.allowTenants.join(',')
          : (runtimePolicy.allowTenants || '*'),
        allowRoles: Array.isArray(runtimePolicy.allowRoles)
          ? runtimePolicy.allowRoles.join(',')
          : (runtimePolicy.allowRoles || '*')
      })
      : this.shadowPolicyService;
    const configuredTargetEngine = shouldUseRuntimePolicy && runtimePolicy.targetEngine
      ? String(runtimePolicy.targetEngine).trim().toLowerCase()
      : this.shadowCompareTarget;
    const targetEngine = configuredTargetEngine || this.shadowCompareTarget;
    const policy = policyService.shouldCompare(task, employee);
    if (!policy.ok) {
      this.store.addEvent('runtime.shadow.skipped', this.eventPayload(task, employee, {
        targetEngine,
        reason: policy.reason || 'policy_blocked'
      }));
      return;
    }
    if (!this.executionGateway || typeof this.executionGateway.executeTaskWithEngine !== 'function') return;
    if (!targetEngine) return;
    try {
      const shadow = await this.executionGateway.executeTaskWithEngine(task, employee, targetEngine, {});
      if (!shadow) {
        const fallbackShadow = {
          status: 'unavailable',
          result: '',
          source: targetEngine,
          runtimeTaskId: null,
          runtimeEvents: []
        };
        const diff = this.computeShadowDiff(primaryOutcome, fallbackShadow);
        this.store.addEvent('runtime.shadow.compared', this.eventPayload(task, employee, {
          targetEngine,
          primary: {
            source: primaryOutcome.source || null,
            status: primaryOutcome.status || null,
            runtimeTaskId: primaryOutcome.runtimeTaskId || null,
            runtimeEventCount: Array.isArray(primaryOutcome.runtimeEvents) ? primaryOutcome.runtimeEvents.length : 0
          },
          shadow: {
            source: fallbackShadow.source || null,
            status: fallbackShadow.status || null,
            runtimeTaskId: null,
            runtimeEventCount: 0
          },
          diff,
          reason: 'target_runtime_unavailable'
        }));
        return;
      }
      const primaryResult = this.normalizeComparableResult(primaryOutcome.result);
      const shadowResult = this.normalizeComparableResult(shadow.result);
      const diff = this.computeShadowDiff(primaryOutcome, shadow);
      this.store.addEvent('runtime.shadow.compared', this.eventPayload(task, employee, {
        targetEngine,
        primary: {
          source: primaryOutcome.source || null,
          status: primaryOutcome.status || null,
          runtimeTaskId: primaryOutcome.runtimeTaskId || null,
          runtimeEventCount: Array.isArray(primaryOutcome.runtimeEvents) ? primaryOutcome.runtimeEvents.length : 0
        },
        shadow: {
          source: shadow.source || null,
          status: shadow.status || null,
          runtimeTaskId: shadow.runtimeTaskId || null,
          runtimeEventCount: Array.isArray(shadow.runtimeEvents) ? shadow.runtimeEvents.length : 0
        },
        diff
      }));
    } catch (error) {
      this.store.addEvent('runtime.shadow.failed', this.eventPayload(task, employee, {
        targetEngine,
        reason: String((error && error.message) || error || 'shadow compare failed').slice(0, 500)
      }));
    }
  }

  async executeTask(task, employee) {
    const requireRuntimeExecution = true;
    this.appendReactTrace(task, 'plan', {
      summary: String(task.goal || '').slice(0, 300),
      riskLevel: task.riskLevel
    });

    if (!(this.executionGateway && this.executionGateway.isEnabled && this.executionGateway.isEnabled())) {
      return {
        status: 'failed',
        result: null,
        error: {
          severity: 'P2',
          message: 'Runtime execution required but execution gateway is unavailable'
        },
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: 'execution_runtime_unavailable',
        runtimeTaskId: null,
        runtimeEvents: [],
        source: 'runtime-required'
      };
    }

    const emittedKeys = task.__runtimeEmittedKeys || new Set();
    task.__runtimeEmittedKeys = emittedKeys;
    const external = await this.executionGateway.executeTask(task, employee, {
      onRuntimeEvent: (runtimeEvent, runtimeTaskId) => {
        const key = runtimeEvent && runtimeEvent.id
          ? `id:${runtimeEvent.id}`
          : `shape:${runtimeEvent ? runtimeEvent.type : 'unknown'}:${runtimeEvent ? runtimeEvent.at : ''}`;
        if (emittedKeys.has(key)) return;
        emittedKeys.add(key);
        const runtimeExtra = normalizeRuntimeEventExtra(runtimeEvent);
        this.store.addEvent('runtime.raw.event', this.eventPayload(task, employee, {
          runtimeTaskId: runtimeTaskId || null,
          runtimeEventId: runtimeEvent ? (runtimeEvent.id || null) : null,
          runtimeType: runtimeEvent ? (runtimeEvent.type || 'unknown') : 'unknown',
          runtimeAt: runtimeEvent ? (runtimeEvent.at || null) : null,
          ...runtimeExtra
        }));
      }
    });
    if (external) {
      this.appendReactTrace(task, 'observe', {
        source: external.source || 'runtime',
        status: external.status || 'unknown'
      });
      await this.runShadowComparison(task, employee, external);
      this.appendReactTrace(task, 'reflect', {
        next: external.status === 'succeeded' ? 'finalize_success' : 'handle_failure'
      });
      return external;
    }
    return {
      status: 'failed',
      result: null,
      error: {
        severity: 'P2',
        message: 'Runtime execution returned no outcome'
      },
      corrected: false,
      children: [],
      skills: [],
      knowledge: [],
      researchQuery: 'runtime_no_execution_outcome',
      runtimeTaskId: null,
      runtimeEvents: [],
      source: 'runtime-required'
    };
  }

  prepareTask(task, employee) {
    if (task.status === 'pending') {
      task.status = 'validating';
      task.updatedAt = new Date().toISOString();
      this.store.addEvent('task.validating', this.eventPayload(task, employee));
    }

    if (task.status !== 'validating') return task.status;
    if (task.requiresApproval && !(task.approval && task.approval.approved)) {
      this.store.addEvent('task.approval.required', this.eventPayload(task, employee, {
        riskLevel: task.riskLevel,
        requiredApprovals: Number(((task.approval || {}).requiredApprovals) || 0),
        requiredAnyRoles: Array.isArray(((task.approval || {}).requiredAnyRoles))
          ? task.approval.requiredAnyRoles.slice()
          : []
      }));
      return task.status;
    }
    if (!(task.approval && task.approval.approved)) {
      task.approval = {
        required: false,
        requiredApprovals: 0,
        requiredAnyRoles: [],
        distinctRoles: false,
        approvals: [{
          approverId: 'system:auto',
          approverRole: 'system',
          approvedAt: new Date().toISOString(),
          note: 'Auto-approved for non-high-risk task.'
        }],
        approved: true,
        approvedAt: new Date().toISOString()
      };
    }
    task.status = 'approved';
    task.updatedAt = new Date().toISOString();
    this.store.addEvent('task.approved', this.eventPayload(task, employee, {
      approverId: 'system:auto',
      note: 'auto approval for non-high-risk task',
      approvalsCount: Array.isArray((task.approval || {}).approvals) ? task.approval.approvals.length : 0,
      requiredApprovals: Number(((task.approval || {}).requiredApprovals) || 0)
    }));
    return task.status;
  }

  applyRollback(task, employee, mode, reason, actor = {}) {
    if (!this.isRecoveryChainEnabled()) {
      this.store.addEvent('task.rollback.skipped', this.eventPayload(task, employee, {
        mode: String(mode || '').trim() || 'manual',
        reason: String(reason || '').slice(0, 500),
        policy: 'recovery_chain_disabled'
      }));
      return false;
    }
    compensationService.applyRollback(this, task, employee, mode, reason, actor);
    this.recordAssistantMessageForTask(task, employee, `任务已回滚：${String(reason || '').trim() || '策略触发回滚'}`);
    return true;
  }

  queueCompensation(task, employee) {
    if (!this.isRecoveryChainEnabled()) return;
    compensationService.queueCompensation(this, task, employee);
  }

  async processCompensations(limit = 10) {
    if (!this.isRecoveryChainEnabled()) return;
    await compensationService.processCompensations(this, limit);
  }

  async executeCompensationForTask(task, employee) {
    if (!this.isRecoveryChainEnabled()) return;
    await compensationService.executeCompensationForTask(this, task, employee);
  }

  retryCompensation(taskId, actor = {}) {
    if (!this.isRecoveryChainEnabled()) {
      const error = new Error('task recovery chain is disabled');
      error.statusCode = 409;
      error.code = 'RECOVERY_CHAIN_DISABLED';
      throw error;
    }
    return compensationService.retryCompensation(this, taskId, actor);
  }

  isRecoveryChainEnabled() {
    return Boolean(this.recoveryChainEnabled);
  }

  shouldAutoRequeueRunningTask(task) {
    if (!task || task.status !== 'running') return false;
    const updatedAtMs = Date.parse(String(task.updatedAt || task.createdAt || ''));
    if (!Number.isFinite(updatedAtMs)) return true;
    return (Date.now() - updatedAtMs) >= this.runningAutoRequeueStaleMs;
  }

  autoRequeueRunningTask(task) {
    const employee = this.store.employees.find((e) => e.id === task.employeeId) || null;
    task.status = 'pending';
    task.updatedAt = new Date().toISOString();
    task.autoRequeueCount = Number(task.autoRequeueCount || 0) + 1;
    this.store.addEvent('task.requeued', this.eventPayload(task, employee, {
      reason: 'running_stale_auto_requeue',
      autoRequeueCount: task.autoRequeueCount
    }));
  }

  async tick() {
    if (this._tickInFlight) return;
    this._tickInFlight = true;
    try {
      // Phase 1: synchronous auto-requeue scan
      for (const task of this.store.tasks) {
        if (this.shouldAutoRequeueRunningTask(task)) {
          this.autoRequeueRunningTask(task);
        }
      }

      // Phase 2: collect eligible tasks for concurrent processing
      const eligible = this.store.tasks.filter((t) =>
        t && ['pending', 'validating', 'approved'].includes(t.status) && !t._processing
      );

      const concurrency = Number(process.env.TASK_TICK_CONCURRENCY) || 5;
      const executing = new Set();

      for (const task of eligible) {
        task._processing = true;
        const p = processTaskTick(this, task)
          .catch(() => {})
          .finally(() => {
            task._processing = false;
            executing.delete(p);
          });
        executing.add(p);

        if (executing.size >= concurrency) {
          await Promise.race(executing);
        }
      }

      if (executing.size > 0) {
        await Promise.all(executing);
      }
    } finally {
      this._tickInFlight = false;
    }
  }

  async sedimentKnowledgeFromTask(task, employee) {
    if (!(this.knowledgeSedimentationUseCases
      && typeof this.knowledgeSedimentationUseCases.processTaskSuccess === 'function')) return null;
    return this.knowledgeSedimentationUseCases.processTaskSuccess({
      task,
      employee,
      result: task.result
    });
  }

}

module.exports = { TaskUseCases };
