const { createHash } = require('crypto');
const { INDEPENDENT_PERSONA_DECLARATION } = require('../../shared/independentPersonaDeclaration');

const BASELINE_SYSTEM_PROMPT = `${INDEPENDENT_PERSONA_DECLARATION}

你是 DCF 平台内的企业级数字员工执行体。你的首要目标不是“回答”，而是“在可治理前提下稳定交付业务结果”。

# 一、身份与职责
1. 你是受治理约束的执行单元，必须遵守平台规则、审批策略与审计要求。
2. 你的输出对象主要是业务人员，表达要清晰、简洁、可执行。
3. 不得暴露底层实现品牌、内部链路细节或不必要的技术术语。

# 二、核心原则
1. 结果正确优先于速度，速度优先于形式完整。
2. 证据优先于结论：结论必须能被过程记录与证据支持。
3. 高风险动作先校验权限与审批，未满足则阻断并说明原因。
4. 信息不足时先澄清，不对关键事实做猜测。
5. 每次执行都要可追溯、可复盘、可回滚。

# 三、治理与安全边界
1. 对外部写入、系统变更、潜在破坏性动作默认谨慎。
2. 若命中高风险且审批链不足：停止执行，返回阻断原因与所需审批条件。
3. 若执行失败：优先输出“失败事实、影响范围、建议补救动作”。
4. 不绕过策略，不伪造结果，不隐瞒不确定性。

# 四、执行流程（强制）
按以下最小流程组织行为：
1. 理解目标：明确业务目标、约束、验收标准。
2. 风险评估：判断风险等级与审批需求。
3. 计划动作：给出最小可执行步骤。
4. 执行动作：仅执行当前授权范围内动作。
5. 结果归档：输出结果、证据、未决事项、下一步建议。

# 五、输出规范
默认采用以下结构：
1. 结论（1-2 句）
2. 关键依据（最多 3 条）
3. 建议动作（立即/短期）
4. 风险与前置条件（如有）

# 六、审计字段要求
涉及任务执行时，必须确保链路中可关联以下字段：
- trace_id
- task_id
- employee_id

# 七、工程约束（平台标准）
1. 遵循 DDD-lite 分层边界，不跨层越权。
2. 新行为遵循 TDD 思路：先定义预期，再执行，再验证。
3. 变更必须可回滚，且不破坏现有接口兼容。

# 八、持续演化要求
1. 允许在运行中学习高频模式，但不得突破本 Prompt 的治理边界。
2. 任何策略偏移必须通过平台治理流程沉淀，不得私自固化。
3. 始终将“可控、可审计、可恢复”作为演化前提。`;

class AdminUseCases {
  constructor(store) {
    this.store = store;
  }

  ensureGovernanceCenters() {
    if (!this.store.strategyCenter || typeof this.store.strategyCenter !== 'object') {
      this.store.strategyCenter = {
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
    }
    if (!this.store.promptCenter || typeof this.store.promptCenter !== 'object') {
      this.store.promptCenter = {
        layers: {
          platform: {
            id: 'platform-default',
            content: '',
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
    }
    if (!Array.isArray(this.store.promptVersions)) this.store.promptVersions = [];
    if (!Array.isArray(this.store.autoevolveRuns)) this.store.autoevolveRuns = [];
  }

  normalizeStrategyCenter(input = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const maxLoopSteps = Number(src.maxLoopSteps);
    const maxTaskRuntimeMs = Number(src.maxTaskRuntimeMs);
    const retryLimit = Number(src.retryLimit);
    const retryBackoffMs = Number(src.retryBackoffMs);
    const normalizeScope = (value, itemMax = 40, fallback = []) => {
      const list = Array.isArray(value)
        ? value
        : String(value || '')
          .split(',')
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      const mapped = list
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
        .map((item) => item.slice(0, itemMax));
      return mapped.length ? Array.from(new Set(mapped)).slice(0, 20) : fallback.slice();
    };
    const autoevolveMinScoreGain = Number(src.autoevolveMinScoreGain);
    const autoevolveCanaryRatio = Number(src.autoevolveCanaryRatio);
    const autoevolveObservationWindowMinutes = Number(src.autoevolveObservationWindowMinutes);
    return {
      maxLoopSteps: Number.isFinite(maxLoopSteps) ? Math.max(1, Math.min(20, Math.round(maxLoopSteps))) : 5,
      maxTaskRuntimeMs: Number.isFinite(maxTaskRuntimeMs) ? Math.max(1000, Math.min(3600000, Math.round(maxTaskRuntimeMs))) : 120000,
      blockOnHighRiskWithoutApproval: Boolean(src.blockOnHighRiskWithoutApproval !== false),
      retryLimit: Number.isFinite(retryLimit) ? Math.max(0, Math.min(10, Math.round(retryLimit))) : 2,
      retryBackoffMs: Number.isFinite(retryBackoffMs) ? Math.max(0, Math.min(120000, Math.round(retryBackoffMs))) : 3000,
      defaultToolScope: normalizeScope(src.defaultToolScope, 40, ['bash', 'read', 'search', 'test']),
      defaultSkillScope: normalizeScope(src.defaultSkillScope, 80, ['general']),
      autoevolveMinScoreGain: Number.isFinite(autoevolveMinScoreGain)
        ? Math.max(0, Math.min(1, autoevolveMinScoreGain))
        : 0.02,
      autoevolveRequireReplayPass: Boolean(src.autoevolveRequireReplayPass !== false),
      autoevolveCanaryRatio: Number.isFinite(autoevolveCanaryRatio)
        ? Math.max(0, Math.min(1, autoevolveCanaryRatio))
        : 0.1,
      autoevolveObservationWindowMinutes: Number.isFinite(autoevolveObservationWindowMinutes)
        ? Math.max(5, Math.min(1440, Math.round(autoevolveObservationWindowMinutes)))
        : 60,
      promptPublishRequiresApproval: Boolean(src.promptPublishRequiresApproval === true),
      updatedAt: src.updatedAt || null,
      updatedBy: src.updatedBy || 'system'
    };
  }

  getStrategyCenter() {
    this.ensureGovernanceCenters();
    return this.normalizeStrategyCenter(this.store.strategyCenter);
  }

  updateStrategyCenter(input = {}, actor = {}) {
    this.ensureGovernanceCenters();
    const previous = this.getStrategyCenter();
    const next = this.normalizeStrategyCenter({
      ...previous,
      ...input,
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor.userId || actor.actorId || 'system')
    });
    this.store.strategyCenter = next;
    this.store.addEvent('strategy.center.updated', {
      actorId: next.updatedBy,
      from: previous,
      to: next
    });
    return next;
  }

  normalizePromptLayerMap(raw = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const [key, value] of Object.entries(src)) {
      const id = String(key || '').trim();
      if (!id) continue;
      const row = value && typeof value === 'object' ? value : {};
      out[id] = {
        id,
        content: String(row.content || '').trim().slice(0, 16000),
        updatedAt: row.updatedAt || null,
        updatedBy: row.updatedBy || 'system'
      };
    }
    return out;
  }

  normalizePromptCenter(input = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const layers = src.layers && typeof src.layers === 'object' ? src.layers : {};
    const platform = layers.platform && typeof layers.platform === 'object' ? layers.platform : {};
    const rawPlatformContent = String(platform.content || '').trim().slice(0, 20000);
    const platformContent = this.normalizePlatformPrompt(rawPlatformContent);
    return {
      layers: {
        platform: {
          id: String(platform.id || 'platform-default').trim() || 'platform-default',
          content: platformContent,
          immutableRules: Array.isArray(platform.immutableRules)
            ? platform.immutableRules.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 50)
            : ['evidence_first', 'approval_gate', 'audit_required']
        },
        roleTemplates: this.normalizePromptLayerMap(layers.roleTemplates || {}),
        tenantPolicies: this.normalizePromptLayerMap(layers.tenantPolicies || {}),
        userProfiles: this.normalizePromptLayerMap(layers.userProfiles || {})
      },
      activeVersionId: String(src.activeVersionId || '').trim() || null,
      updatedAt: src.updatedAt || null,
      updatedBy: src.updatedBy || 'system'
    };
  }

  normalizePromptText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  isLegacyPlatformPrompt(content) {
    const text = this.normalizePromptText(content);
    if (!text) return false;
    const hasLoop = /Plan\s*->\s*Act\s*->\s*Observe\s*->\s*Reflect\s*->\s*Loop/i.test(text);
    if (!hasLoop) return false;
    const hasOutputShape = /假设\s*、\s*动作\s*、\s*证据\s*、\s*判断\s*、\s*下一步/.test(text);
    const hasApprovalGate = /高风险动作?.{0,20}审批策略/.test(text);
    return hasOutputShape || hasApprovalGate;
  }

  normalizePlatformPrompt(content) {
    if (!this.isLegacyPlatformPrompt(content)) return String(content || '').trim();
    return BASELINE_SYSTEM_PROMPT;
  }

  getPromptCenter() {
    this.ensureGovernanceCenters();
    return this.normalizePromptCenter(this.store.promptCenter);
  }

  updatePromptCenter(input = {}, actor = {}) {
    this.ensureGovernanceCenters();
    const previous = this.getPromptCenter();
    const sourceLayers = input.layers && typeof input.layers === 'object'
      ? input.layers
      : previous.layers;
    const next = this.normalizePromptCenter({
      ...previous,
      layers: sourceLayers,
      activeVersionId: Object.prototype.hasOwnProperty.call(input, 'activeVersionId')
        ? input.activeVersionId
        : previous.activeVersionId,
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor.userId || actor.actorId || 'system')
    });
    this.store.promptCenter = next;
    this.store.addEvent('prompt.center.updated', {
      actorId: next.updatedBy,
      activeVersionId: next.activeVersionId
    });
    return next;
  }

  getPromptCompileContext(input = {}) {
    const context = input && typeof input === 'object' ? input : {};
    const employeeId = String(context.employeeId || '').trim();
    if (!employeeId) {
      return {
        role: String(context.role || '').trim(),
        tenantId: String(context.tenantId || '').trim(),
        userId: String(context.userId || '').trim()
      };
    }
    const employee = this.store.employees.find((item) => String(item.id || '') === employeeId) || null;
    return {
      role: employee ? String(employee.role || '').trim() : String(context.role || '').trim(),
      tenantId: employee ? String(employee.tenantId || '').trim() : String(context.tenantId || '').trim(),
      userId: String(context.userId || '').trim()
    };
  }

  compilePrompt(input = {}) {
    this.ensureGovernanceCenters();
    const center = this.getPromptCenter();
    const ctx = this.getPromptCompileContext(input);
    const segments = [];
    const usedLayers = [];
    if (center.layers.platform && center.layers.platform.content) {
      segments.push(center.layers.platform.content);
      usedLayers.push({ level: 'platform', id: center.layers.platform.id });
    }
    const roleLayer = center.layers.roleTemplates[ctx.role];
    if (roleLayer && roleLayer.content) {
      segments.push(roleLayer.content);
      usedLayers.push({ level: 'role', id: roleLayer.id });
    }
    const tenantLayer = center.layers.tenantPolicies[ctx.tenantId];
    if (tenantLayer && tenantLayer.content) {
      segments.push(tenantLayer.content);
      usedLayers.push({ level: 'tenant', id: tenantLayer.id });
    }
    const userLayer = center.layers.userProfiles[ctx.userId];
    if (userLayer && userLayer.content) {
      segments.push(userLayer.content);
      usedLayers.push({ level: 'user', id: userLayer.id });
    }
    return {
      content: segments.join('\n\n').trim(),
      usedLayers
    };
  }

  publishPromptVersion(input = {}, actor = {}) {
    this.ensureGovernanceCenters();
    const strategy = this.getStrategyCenter();
    const compiled = this.compilePrompt(input.compileContext || {});
    const now = new Date().toISOString();
    const requiresApproval = Boolean(input.requiresApproval === true || strategy.promptPublishRequiresApproval);
    const version = {
      id: `prompt-v-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: String(input.name || '').trim() || `Prompt ${now.slice(0, 19)}`,
      content: String(compiled.content || '').slice(0, 30000),
      usedLayers: compiled.usedLayers,
      compileContext: input.compileContext && typeof input.compileContext === 'object' ? input.compileContext : {},
      createdAt: now,
      createdBy: String(actor.userId || actor.actorId || 'system'),
      source: String(input.source || 'manual').trim() || 'manual',
      status: requiresApproval ? 'pending_approval' : 'active',
      approvedAt: null,
      approvedBy: null
    };
    if (!requiresApproval) {
      for (const item of this.store.promptVersions) {
        if (item && typeof item === 'object' && item.status === 'active') item.status = 'archived';
      }
    }
    this.store.promptVersions.unshift(version);
    this.store.promptVersions = this.store.promptVersions.slice(0, 200);
    if (!requiresApproval) {
      this.store.promptCenter = this.normalizePromptCenter({
        ...this.store.promptCenter,
        activeVersionId: version.id,
        updatedAt: now,
        updatedBy: version.createdBy
      });
    }
    this.store.addEvent('prompt.version.published', {
      actorId: version.createdBy,
      promptVersionId: version.id,
      source: version.source,
      requiresApproval
    });
    return version;
  }

  listPromptVersions(limit = 50) {
    this.ensureGovernanceCenters();
    const n = Math.max(1, Math.min(200, Number(limit || 50) || 50));
    return this.store.promptVersions.slice(0, n);
  }

  rollbackPromptVersion(versionId, actor = {}) {
    this.ensureGovernanceCenters();
    const targetId = String(versionId || '').trim();
    if (!targetId) throw new Error('versionId is required');
    const found = this.store.promptVersions.find((item) => String(item.id || '') === targetId);
    if (!found) {
      const error = new Error('prompt version not found');
      error.statusCode = 404;
      throw error;
    }
    const now = new Date().toISOString();
    for (const item of this.store.promptVersions) {
      if (!item || typeof item !== 'object') continue;
      item.status = item.id === targetId ? 'active' : 'archived';
    }
    this.store.promptCenter = this.normalizePromptCenter({
      ...this.store.promptCenter,
      activeVersionId: targetId,
      updatedAt: now,
      updatedBy: String(actor.userId || actor.actorId || 'system')
    });
    this.store.addEvent('prompt.version.rolled_back', {
      actorId: this.store.promptCenter.updatedBy,
      promptVersionId: targetId
    });
    return found;
  }

  approvePromptVersion(versionId, actor = {}) {
    this.ensureGovernanceCenters();
    const targetId = String(versionId || '').trim();
    if (!targetId) throw new Error('versionId is required');
    const found = this.store.promptVersions.find((item) => String(item.id || '') === targetId);
    if (!found) {
      const error = new Error('prompt version not found');
      error.statusCode = 404;
      throw error;
    }
    if (String(found.status || '') !== 'pending_approval') {
      const error = new Error('prompt version is not pending approval');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    for (const item of this.store.promptVersions) {
      if (!item || typeof item !== 'object') continue;
      item.status = item.id === targetId ? 'active' : 'archived';
    }
    found.approvedAt = now;
    found.approvedBy = String(actor.userId || actor.actorId || 'system');
    this.store.promptCenter = this.normalizePromptCenter({
      ...this.store.promptCenter,
      activeVersionId: targetId,
      updatedAt: now,
      updatedBy: found.approvedBy
    });
    this.store.addEvent('prompt.version.approved', {
      actorId: found.approvedBy,
      promptVersionId: targetId
    });
    return found;
  }

  listAutoevolveRuns(limit = 50) {
    this.ensureGovernanceCenters();
    const n = Math.max(1, Math.min(200, Number(limit || 50) || 50));
    return this.store.autoevolveRuns.slice(0, n);
  }

  createAutoevolveRun(input = {}, actor = {}) {
    this.ensureGovernanceCenters();
    const now = new Date().toISOString();
    const center = this.getPromptCenter();
    const activeVersionId = String(center.activeVersionId || '').trim() || null;
    const activeVersion = activeVersionId
      ? this.store.promptVersions.find((item) => String(item.id || '') === activeVersionId) || null
      : null;
    const baseContent = activeVersion ? String(activeVersion.content || '') : String(this.compilePrompt({}).content || '');
    const delta = String(input.delta || '').trim()
      || '新增约束：每轮反思需明确是否满足验收标准，若不满足必须声明下一步最小动作。';
    const candidateContent = `${baseContent}\n\n${delta}`.trim();
    const strategy = this.getStrategyCenter();
    const scoreGain = Number(input.scoreGain);
    const finalScoreGain = Number.isFinite(scoreGain) ? scoreGain : 0.03;
    const replayPassed = input.replayPassed !== false;
    const validated = (!strategy.autoevolveRequireReplayPass || replayPassed)
      && finalScoreGain >= Number(strategy.autoevolveMinScoreGain || 0);
    const run = {
      id: `autoevolve-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      status: validated ? 'validated' : 'rejected',
      baseVersionId: activeVersionId,
      candidate: {
        content: candidateContent.slice(0, 30000),
        delta: delta.slice(0, 2000)
      },
      quality: {
        replayPassed,
        scoreGain: finalScoreGain,
        rejectReason: validated ? '' : 'below_strategy_threshold'
      },
      rollout: {
        canaryRatio: Number(strategy.autoevolveCanaryRatio || 0.1),
        observationWindowMinutes: Number(strategy.autoevolveObservationWindowMinutes || 60)
      },
      createdAt: now,
      createdBy: String(actor.userId || actor.actorId || 'system'),
      promotedVersionId: null
    };
    this.store.autoevolveRuns.unshift(run);
    this.store.autoevolveRuns = this.store.autoevolveRuns.slice(0, 200);
    this.store.addEvent('autoevolve.run.created', {
      actorId: run.createdBy,
      runId: run.id,
      baseVersionId: activeVersionId
    });
    return run;
  }

  promoteAutoevolveRun(runId, actor = {}) {
    this.ensureGovernanceCenters();
    const id = String(runId || '').trim();
    if (!id) throw new Error('runId is required');
    const run = this.store.autoevolveRuns.find((item) => String(item.id || '') === id);
    if (!run) {
      const error = new Error('autoevolve run not found');
      error.statusCode = 404;
      throw error;
    }
    if (String(run.status || '') !== 'validated') {
      const error = new Error('autoevolve run is not promotable');
      error.statusCode = 400;
      throw error;
    }
    const version = this.publishPromptVersion({
      name: `Autoevolve ${new Date().toISOString().slice(0, 19)}`,
      source: 'autoevolve',
      compileContext: {},
    }, actor);
    version.content = String(run.candidate && run.candidate.content || version.content);
    run.status = 'promoted';
    run.promotedVersionId = version.id;
    run.promotedAt = new Date().toISOString();
    this.store.addEvent('autoevolve.run.promoted', {
      actorId: String(actor.userId || actor.actorId || 'system'),
      runId: run.id,
      promptVersionId: version.id
    });
    return {
      run,
      version
    };
  }

  revertAutoevolveRun(runId, actor = {}) {
    this.ensureGovernanceCenters();
    const id = String(runId || '').trim();
    if (!id) throw new Error('runId is required');
    const run = this.store.autoevolveRuns.find((item) => String(item.id || '') === id);
    if (!run) {
      const error = new Error('autoevolve run not found');
      error.statusCode = 404;
      throw error;
    }
    run.status = 'reverted';
    run.revertedAt = new Date().toISOString();
    run.revertedBy = String(actor.userId || actor.actorId || 'system');
    this.store.addEvent('autoevolve.run.reverted', {
      actorId: run.revertedBy,
      runId: run.id
    });
    return run;
  }

  normalizeEmployeeRuntimeAliases(employee) {
    if (!employee || typeof employee !== 'object') return employee;
    const runtimeProfile = employee.runtimeProfile && typeof employee.runtimeProfile === 'object'
      ? employee.runtimeProfile
      : (employee.openclawProfile && typeof employee.openclawProfile === 'object' ? employee.openclawProfile : {});
    employee.runtimeProfile = runtimeProfile;
    employee.openclawProfile = runtimeProfile;
    return employee;
  }

  normalizeTaskRuntimeAliases(task) {
    if (!task || typeof task !== 'object') return task;
    const runtimeConfig = task.runtimeConfig && typeof task.runtimeConfig === 'object'
      ? task.runtimeConfig
      : (task.openclaw && typeof task.openclaw === 'object' ? task.openclaw : {});
    task.runtimeConfig = runtimeConfig;
    task.openclaw = runtimeConfig;
    return task;
  }

  getRetrievalPolicy() {
    const policy = this.store.retrievalPolicy && typeof this.store.retrievalPolicy === 'object'
      ? this.store.retrievalPolicy
      : { mode: 'auto', updatedAt: null, updatedBy: 'system' };
    return {
      mode: ['auto', 'busy', 'idle'].includes(String(policy.mode || '')) ? String(policy.mode) : 'auto',
      updatedAt: policy.updatedAt || null,
      updatedBy: policy.updatedBy || 'system'
    };
  }

  updateRetrievalPolicy(input = {}, actor = {}) {
    const mode = String(input.mode || '').trim().toLowerCase();
    if (!['auto', 'busy', 'idle'].includes(mode)) {
      const error = new Error('retrieval policy mode must be one of auto|busy|idle');
      error.statusCode = 400;
      throw error;
    }
    const previous = this.getRetrievalPolicy();
    const next = {
      mode,
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor.userId || actor.actorId || 'system')
    };
    this.store.retrievalPolicy = next;
    this.store.addEvent('retrieval.policy.mode.updated', {
      actorId: next.updatedBy,
      fromMode: previous.mode,
      toMode: next.mode
    });
    return next;
  }

  normalizeOssGovernancePolicy(policy) {
    const src = policy && typeof policy === 'object' ? policy : {};
    const rawMode = String(src.mode || '').toLowerCase();
    const mode = rawMode === 'autonomous' ? 'model_driven' : rawMode;
    return {
      mode: ['assist', 'model_driven'].includes(mode) ? mode : 'model_driven',
      decisionEngine: 'llm',
      fallbackToManualWhenModelUnavailable: Boolean(src.fallbackToManualWhenModelUnavailable !== false),
      updatedAt: src.updatedAt || null,
      updatedBy: src.updatedBy || 'system'
    };
  }

  getOssGovernancePolicy() {
    return this.normalizeOssGovernancePolicy(this.store.ossGovernancePolicy || null);
  }

  updateOssGovernancePolicy(input = {}, actor = {}) {
    const error = new Error('oss governance policy is managed by model-driven runtime and cannot be manually updated');
    error.statusCode = 405;
    throw error;
  }

  normalizeSkillSedimentationPolicy(policy) {
    const src = policy && typeof policy === 'object' ? policy : {};
    const mode = String(src.mode || '').trim().toLowerCase();
    const promotionMode = String(src.promotionMode || '').trim().toLowerCase();
    const minConfidenceRaw = Number(src.minConfidence);
    const minRepeatedRaw = Number(src.minRepeatedSuccessForFallback);
    const rawOverrides = Array.isArray(src.overrides) ? src.overrides : [];
    const overrides = rawOverrides
      .map((item, index) => {
        const row = item && typeof item === 'object' ? item : {};
        const rowMode = String(row.mode || '').trim().toLowerCase();
        const rowConfidenceRaw = Number(row.minConfidence);
        const rowRepeatedRaw = Number(row.minRepeatedSuccessForFallback);
        const scope = row.scope && typeof row.scope === 'object' ? row.scope : {};
        const normalizedScope = {
          tenantId: String(scope.tenantId || '').trim() || null,
          accountId: String(scope.accountId || '').trim() || null,
          department: String(scope.department || '').trim() || null,
          role: String(scope.role || '').trim() || null,
          employeeId: String(scope.employeeId || '').trim() || null
        };
        return {
          id: String(row.id || `sediment-scope-${index + 1}`),
          scope: normalizedScope,
          mode: ['rules', 'model_driven', 'hybrid'].includes(rowMode) ? rowMode : 'hybrid',
          minConfidence: Number.isFinite(rowConfidenceRaw)
            ? Math.max(0, Math.min(1, rowConfidenceRaw))
            : 0.7,
          fallbackToRulesWhenModelUnavailable: Boolean(row.fallbackToRulesWhenModelUnavailable !== false),
          minRepeatedSuccessForFallback: Number.isFinite(rowRepeatedRaw)
            ? Math.max(1, Math.round(rowRepeatedRaw))
            : 2
        };
      })
      .filter((item) => (
        item.scope.tenantId
        || item.scope.accountId
        || item.scope.department
        || item.scope.role
        || item.scope.employeeId
      ));
    return {
      mode: ['rules', 'model_driven', 'hybrid'].includes(mode) ? mode : 'hybrid',
      promotionMode: ['direct', 'proposal'].includes(promotionMode) ? promotionMode : 'direct',
      minConfidence: Number.isFinite(minConfidenceRaw)
        ? Math.max(0, Math.min(1, minConfidenceRaw))
        : 0.7,
      fallbackToRulesWhenModelUnavailable: Boolean(src.fallbackToRulesWhenModelUnavailable !== false),
      minRepeatedSuccessForFallback: Number.isFinite(minRepeatedRaw)
        ? Math.max(1, Math.round(minRepeatedRaw))
        : 2,
      overrides,
      updatedAt: src.updatedAt || null,
      updatedBy: src.updatedBy || 'system'
    };
  }

  getSkillSedimentationPolicy() {
    return this.normalizeSkillSedimentationPolicy(this.store.skillSedimentationPolicy || null);
  }

  updateSkillSedimentationPolicy(input = {}, actor = {}) {
    const mode = String(input.mode || '').trim().toLowerCase();
    if (!['rules', 'model_driven', 'hybrid'].includes(mode)) {
      const error = new Error('skill sedimentation policy mode must be one of rules|model_driven|hybrid');
      error.statusCode = 400;
      throw error;
    }
    const promotionModeRaw = String(input.promotionMode || '').trim().toLowerCase();
    if (promotionModeRaw && !['direct', 'proposal'].includes(promotionModeRaw)) {
      const error = new Error('skill sedimentation policy promotionMode must be one of direct|proposal');
      error.statusCode = 400;
      throw error;
    }

    const minConfidenceRaw = Number(input.minConfidence);
    if (!Number.isFinite(minConfidenceRaw) || minConfidenceRaw < 0 || minConfidenceRaw > 1) {
      const error = new Error('minConfidence must be a number between 0 and 1');
      error.statusCode = 400;
      throw error;
    }

    const minRepeatedRaw = Number(input.minRepeatedSuccessForFallback);
    if (!Number.isFinite(minRepeatedRaw) || minRepeatedRaw < 1) {
      const error = new Error('minRepeatedSuccessForFallback must be >= 1');
      error.statusCode = 400;
      throw error;
    }

    const previous = this.getSkillSedimentationPolicy();
    const rawOverrides = Array.isArray(input.overrides) ? input.overrides : [];
    const overrides = this.normalizeSkillSedimentationPolicy({
      overrides: rawOverrides
    }).overrides;
    const next = {
      mode,
      promotionMode: ['direct', 'proposal'].includes(promotionModeRaw)
        ? promotionModeRaw
        : (previous.promotionMode || 'direct'),
      minConfidence: Math.max(0, Math.min(1, minConfidenceRaw)),
      fallbackToRulesWhenModelUnavailable: Boolean(input.fallbackToRulesWhenModelUnavailable !== false),
      minRepeatedSuccessForFallback: Math.max(1, Math.round(minRepeatedRaw)),
      overrides,
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor.userId || actor.actorId || 'system')
    };
    this.store.skillSedimentationPolicy = next;
    this.store.addEvent('skill.sedimentation.policy.updated', {
      actorId: next.updatedBy,
      fromMode: previous.mode,
      toMode: next.mode,
      fromPromotionMode: previous.promotionMode,
      toPromotionMode: next.promotionMode,
      fromMinConfidence: previous.minConfidence,
      toMinConfidence: next.minConfidence,
      fromFallback: previous.fallbackToRulesWhenModelUnavailable,
      toFallback: next.fallbackToRulesWhenModelUnavailable,
      fromMinRepeatedSuccessForFallback: previous.minRepeatedSuccessForFallback,
      toMinRepeatedSuccessForFallback: next.minRepeatedSuccessForFallback,
      fromOverrideCount: Array.isArray(previous.overrides) ? previous.overrides.length : 0,
      toOverrideCount: Array.isArray(next.overrides) ? next.overrides.length : 0
    });
    return next;
  }

  normalizeKnowledgeSedimentationPolicy(policy) {
    const src = policy && typeof policy === 'object' ? policy : {};
    const mode = String(src.mode || '').trim().toLowerCase();
    const promotionMode = String(src.promotionMode || '').trim().toLowerCase();
    const minConfidenceRaw = Number(src.minConfidence);
    const minAutoRaw = Number(src.minQualityScoreForAutoApprove);
    const minReviewRaw = Number(src.minQualityScoreForReviewQueue);
    return {
      mode: ['rules', 'model_driven', 'hybrid'].includes(mode) ? mode : 'hybrid',
      promotionMode: ['direct', 'proposal'].includes(promotionMode) ? promotionMode : 'proposal',
      minConfidence: Number.isFinite(minConfidenceRaw)
        ? Math.max(0, Math.min(1, minConfidenceRaw))
        : 0.7,
      minQualityScoreForAutoApprove: Number.isFinite(minAutoRaw)
        ? Math.max(0, Math.min(100, minAutoRaw))
        : 85,
      minQualityScoreForReviewQueue: Number.isFinite(minReviewRaw)
        ? Math.max(0, Math.min(100, minReviewRaw))
        : 60,
      fallbackToRulesWhenModelUnavailable: Boolean(src.fallbackToRulesWhenModelUnavailable !== false),
      updatedAt: src.updatedAt || null,
      updatedBy: src.updatedBy || 'system'
    };
  }

  getKnowledgeSedimentationPolicy() {
    return this.normalizeKnowledgeSedimentationPolicy(this.store.knowledgeSedimentationPolicy || null);
  }

  updateKnowledgeSedimentationPolicy(input = {}, actor = {}) {
    const mode = String(input.mode || '').trim().toLowerCase();
    if (!['rules', 'model_driven', 'hybrid'].includes(mode)) {
      const error = new Error('knowledge sedimentation policy mode must be one of rules|model_driven|hybrid');
      error.statusCode = 400;
      throw error;
    }

    const promotionModeRaw = String(input.promotionMode || '').trim().toLowerCase();
    if (promotionModeRaw && !['direct', 'proposal'].includes(promotionModeRaw)) {
      const error = new Error('knowledge sedimentation policy promotionMode must be one of direct|proposal');
      error.statusCode = 400;
      throw error;
    }

    const minConfidenceRaw = Number(input.minConfidence);
    if (!Number.isFinite(minConfidenceRaw) || minConfidenceRaw < 0 || minConfidenceRaw > 1) {
      const error = new Error('minConfidence must be a number between 0 and 1');
      error.statusCode = 400;
      throw error;
    }
    const minAutoRaw = Number(input.minQualityScoreForAutoApprove);
    if (!Number.isFinite(minAutoRaw) || minAutoRaw < 0 || minAutoRaw > 100) {
      const error = new Error('minQualityScoreForAutoApprove must be a number between 0 and 100');
      error.statusCode = 400;
      throw error;
    }
    const minReviewRaw = Number(input.minQualityScoreForReviewQueue);
    if (!Number.isFinite(minReviewRaw) || minReviewRaw < 0 || minReviewRaw > 100) {
      const error = new Error('minQualityScoreForReviewQueue must be a number between 0 and 100');
      error.statusCode = 400;
      throw error;
    }
    if (minReviewRaw > minAutoRaw) {
      const error = new Error('minQualityScoreForReviewQueue must be <= minQualityScoreForAutoApprove');
      error.statusCode = 400;
      throw error;
    }

    const previous = this.getKnowledgeSedimentationPolicy();
    const next = {
      mode,
      promotionMode: ['direct', 'proposal'].includes(promotionModeRaw)
        ? promotionModeRaw
        : (previous.promotionMode || 'proposal'),
      minConfidence: Math.max(0, Math.min(1, minConfidenceRaw)),
      minQualityScoreForAutoApprove: Math.max(0, Math.min(100, minAutoRaw)),
      minQualityScoreForReviewQueue: Math.max(0, Math.min(100, minReviewRaw)),
      fallbackToRulesWhenModelUnavailable: Boolean(input.fallbackToRulesWhenModelUnavailable !== false),
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor.userId || actor.actorId || 'system')
    };
    this.store.knowledgeSedimentationPolicy = next;
    this.store.addEvent('knowledge.sedimentation.policy.updated', {
      actorId: next.updatedBy,
      fromMode: previous.mode,
      toMode: next.mode,
      fromPromotionMode: previous.promotionMode,
      toPromotionMode: next.promotionMode,
      fromMinConfidence: previous.minConfidence,
      toMinConfidence: next.minConfidence,
      fromMinQualityScoreForAutoApprove: previous.minQualityScoreForAutoApprove,
      toMinQualityScoreForAutoApprove: next.minQualityScoreForAutoApprove,
      fromMinQualityScoreForReviewQueue: previous.minQualityScoreForReviewQueue,
      toMinQualityScoreForReviewQueue: next.minQualityScoreForReviewQueue
    });
    return next;
  }

  normalizeRuntimeShadowPolicy(policy) {
    const src = policy && typeof policy === 'object' ? policy : {};
    const enabled = typeof src.enabled === 'boolean' ? src.enabled : false;
    const normalizeList = (value, fallback = ['*']) => {
      const list = Array.from(new Set(
        String(value || '')
          .split(',')
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      ));
      return list.length > 0 ? list : fallback.slice();
    };
    return {
      enabled,
      targetEngine: 'openclaw',
      allowTenants: normalizeList(src.allowTenants, ['*']),
      allowRoles: normalizeList(src.allowRoles, ['*']),
      updatedAt: src.updatedAt || null,
      updatedBy: src.updatedBy || 'system'
    };
  }

  getRuntimeShadowPolicy() {
    return this.normalizeRuntimeShadowPolicy(this.store.runtimeShadowPolicy || null);
  }

  updateRuntimeShadowPolicy(input = {}, actor = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const targetEngine = String(src.targetEngine || '').trim().toLowerCase();
    if (targetEngine && targetEngine !== 'openclaw') {
      const error = new Error('runtime shadow targetEngine must be openclaw');
      error.statusCode = 400;
      throw error;
    }
    const asList = (value, fieldName) => {
      const list = Array.from(new Set(
        String(value || '')
          .split(',')
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      ));
      if (list.length === 0) {
        const error = new Error(`${fieldName} must provide at least one item`);
        error.statusCode = 400;
        throw error;
      }
      return list;
    };
    const previous = this.getRuntimeShadowPolicy();
    const next = {
      enabled: Boolean(src.enabled),
      targetEngine: 'openclaw',
      allowTenants: asList(src.allowTenants, 'allowTenants'),
      allowRoles: asList(src.allowRoles, 'allowRoles'),
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor.userId || actor.actorId || 'system')
    };
    this.store.runtimeShadowPolicy = next;
    this.store.addEvent('runtime.shadow.policy.updated', {
      actorId: next.updatedBy,
      fromEnabled: previous.enabled,
      toEnabled: next.enabled,
      fromTargetEngine: previous.targetEngine,
      toTargetEngine: next.targetEngine,
      fromAllowTenants: previous.allowTenants,
      toAllowTenants: next.allowTenants,
      fromAllowRoles: previous.allowRoles,
      toAllowRoles: next.allowRoles
    });
    return this.getRuntimeShadowPolicy();
  }

  bumpCount(map, key) {
    const normalized = String(key || '').trim();
    if (!normalized) return;
    map[normalized] = (Number(map[normalized] || 0) + 1);
  }

  sortCountMap(map = {}) {
    return Object.entries(map)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .map(([key, count]) => ({ key, count: Number(count || 0) }));
  }

  computeTaskSummary(tasks = []) {
    const byStatus = {
      pending: 0,
      validating: 0,
      approved: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      rolled_back: 0,
      aborted: 0
    };
    const byRisk = { L1: 0, L2: 0, L3: 0, L4: 0 };
    let requiresApprovalCount = 0;
    let waitingApprovalCount = 0;
    let rollbackCount = 0;

    for (const task of tasks) {
      const status = String(task.status || '');
      const risk = String(task.riskLevel || '');
      if (Object.prototype.hasOwnProperty.call(byStatus, status)) byStatus[status] += 1;
      if (Object.prototype.hasOwnProperty.call(byRisk, risk)) byRisk[risk] += 1;
      if (task.requiresApproval) requiresApprovalCount += 1;
      if (task.requiresApproval && status === 'validating') waitingApprovalCount += 1;
      if (task.rollback) rollbackCount += 1;
    }

    const total = tasks.length;
    const succeeded = byStatus.succeeded;
    const successRate = total > 0 ? Number(((succeeded / total) * 100).toFixed(1)) : 0;

    return {
      total,
      byStatus,
      byRisk,
      requiresApprovalCount,
      waitingApprovalCount,
      rollbackCount,
      successRate
    };
  }

  computeGovernanceSummary(logs = [], tasks = []) {
    const riskTypes = new Set([
      'task.failed',
      'task.rollback.triggered',
      'task.rolled_back',
      'task.aborted',
      'task.approval.required',
      'task.corrective.requeued'
    ]);
    const riskyActions = logs.filter((log) => riskTypes.has(log.type));
    const p1Incidents = tasks.filter((task) => (
      task.lastError && String(task.lastError.severity || '') === 'P1'
    )).length;

    return {
      auditEventCount: logs.length,
      runtimeEventCount: logs.filter((log) => log.type === 'runtime.raw.event').length,
      approvalEventCount: logs.filter((log) => log.type === 'task.approved').length,
      rollbackEventCount: logs.filter((log) => log.type === 'task.rollback.triggered' || log.type === 'task.rolled_back').length,
      failedEventCount: logs.filter((log) => log.type === 'task.failed').length,
      p1IncidentCount: p1Incidents,
      recentRiskEvents: riskyActions.slice(0, 8).map((log) => ({
        id: log.id,
        type: log.type,
        at: log.at,
        taskId: (log.payload || {}).task_id || (log.payload || {}).taskId || null,
        severity: (log.payload || {}).severity || null
      }))
    };
  }

  computeGrowthSummary(employee, skills = []) {
    const skillTypeCount = { general: 0, domain: 0 };
    for (const skill of skills) {
      if (skill.type === 'domain') skillTypeCount.domain += 1;
      else skillTypeCount.general += 1;
    }
    const childAgents = Array.isArray(employee.childAgents) ? employee.childAgents : [];
    return {
      capabilityCount: Array.isArray(employee.capabilities) ? employee.capabilities.length : 0,
      knowledgeCount: Array.isArray(employee.knowledge) ? employee.knowledge.length : 0,
      linkedSkillCount: Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds.length : 0,
      relatedSkillCount: skills.length,
      skillTypeCount,
      childAgentCount: childAgents.length,
      activeChildAgentCount: childAgents.filter((child) => String(child.status || '') === 'active').length
    };
  }

  computeRuntimeUsage(tasks = []) {
    const byAgentId = {};
    const byPolicyId = {};
    const byToolScope = {};
    let runtimeBoundCount = 0;
    let promptConfiguredCount = 0;

    for (const task of tasks) {
      const runtimeCfg = task && task.runtimeConfig && typeof task.runtimeConfig === 'object'
        ? task.runtimeConfig
        : (task && task.openclaw && typeof task.openclaw === 'object' ? task.openclaw : {});
      const hasRuntimeBinding = Boolean(runtimeCfg.agentId || runtimeCfg.policyId || (Array.isArray(runtimeCfg.toolScope) && runtimeCfg.toolScope.length > 0));
      if (hasRuntimeBinding) runtimeBoundCount += 1;
      if (runtimeCfg.systemPrompt || runtimeCfg.extraSystemPrompt) promptConfiguredCount += 1;
      this.bumpCount(byAgentId, runtimeCfg.agentId || 'default');
      this.bumpCount(byPolicyId, runtimeCfg.policyId || 'none');
      const scopes = Array.isArray(runtimeCfg.toolScope) && runtimeCfg.toolScope.length ? runtimeCfg.toolScope : ['default'];
      for (const tool of scopes) this.bumpCount(byToolScope, tool);
    }

    return {
      runtimeBoundCount,
      promptConfiguredCount,
      byAgentId: this.sortCountMap(byAgentId),
      byPolicyId: this.sortCountMap(byPolicyId),
      byToolScope: this.sortCountMap(byToolScope)
    };
  }

  getOverview(context = {}) {
    const tasks = Array.isArray(this.store.tasks) ? this.store.tasks : [];
    const metrics = this.store.metrics && typeof this.store.metrics === 'object' ? this.store.metrics : {};
    const queue = context && context.queue && typeof context.queue === 'object' ? context.queue : {};
    const bootstrap = context && context.bootstrap && typeof context.bootstrap === 'object' ? context.bootstrap : {};
    const runtimeEnabled = context && context.runtimeEnabled === true;
    const dialogueEnabled = !!(context && context.dialogueEnabled);

    const inProgressStatus = new Set(['pending', 'validating', 'approved', 'running']);
    const compensationPendingStatus = new Set(['queued', 'running', 'deferred', 'failed', 'dead_letter']);

    const inProgressTasks = tasks.filter((task) => inProgressStatus.has(String(task.status || ''))).length;
    const waitingApprovalTasks = tasks.filter((task) => task.requiresApproval && String(task.status || '') === 'validating').length;
    const rollbackTasks = tasks.filter((task) => task.rollback || String(task.status || '') === 'rolled_back').length;
    const compensationPendingTasks = tasks.filter((task) => {
      const compensation = task && task.compensation && typeof task.compensation === 'object' ? task.compensation : {};
      const status = String(compensation.status || '').trim().toLowerCase();
      return compensationPendingStatus.has(status);
    }).length;
    const highRiskActiveTasks = tasks.filter((task) => (
      String(task.riskLevel || '') === 'L4'
      && inProgressStatus.has(String(task.status || ''))
    )).length;

    const totalTasks = Math.max(0, Number(metrics.totalTasks || tasks.length || 0));
    const succeededTasks = Math.max(0, Number(metrics.succeededTasks || 0));
    const failedTasks = Math.max(0, Number(metrics.failedTasks || 0));
    const successRate = totalTasks > 0 ? Math.round((succeededTasks / totalTasks) * 100) : 0;
    const p1IncidentsByTask = tasks.filter((task) => (
      task && task.lastError && String(task.lastError.severity || '') === 'P1'
    )).length;
    const p1Incidents = Math.max(Number(metrics.p1Incidents || 0), p1IncidentsByTask);

    const queueQueued = Math.max(0, Number(queue.researchQueued || 0));
    const queueDone = Math.max(0, Number(queue.researchDone || 0));
    const backlog = Math.max(queueQueued - queueDone, 0);

    return {
      generatedAt: new Date().toISOString(),
      delivery: {
        employeesTotal: Array.isArray(this.store.employees) ? this.store.employees.length : 0,
        totalTasks,
        succeededTasks,
        failedTasks,
        inProgressTasks,
        successRate
      },
      governance: {
        waitingApprovalTasks,
        compensationPendingTasks,
        rollbackTasks,
        p1Incidents,
        highRiskActiveTasks,
        riskCount: waitingApprovalTasks + compensationPendingTasks + p1Incidents
      },
      assets: {
        skillsTotal: Array.isArray(this.store.skills) ? this.store.skills.length : 0,
        findingsTotal: Array.isArray(this.store.ossFindings) ? this.store.ossFindings.length : 0,
        skillReused: Math.max(0, Number(metrics.skillReused || 0)),
        recurrenceErrors: Math.max(0, Number(metrics.recurrenceErrors || 0)),
        skillSedimentation: metrics.skillSedimentation && typeof metrics.skillSedimentation === 'object'
          ? metrics.skillSedimentation
          : { directCreated: 0, proposalCreated: 0, skipped: 0 }
      },
      runtime: {
        runtimeEnabled,
        dialogueEnabled,
        queueQueued,
        queueDone,
        backlog,
        phase: String(bootstrap.phase || '-'),
        cycleCount: Math.max(0, Number(bootstrap.cycleCount || 0)),
        manualReviewRequired: !!bootstrap.manualReviewRequired
      },
      focus: [
        inProgressTasks > 0
          ? `交付跟进：当前有 ${inProgressTasks} 项任务在执行链路中。`
          : '交付跟进：当前无进行中任务，可安排新一轮任务编排。',
        waitingApprovalTasks + compensationPendingTasks + p1Incidents > 0
          ? `治理态势：审批待处理 ${waitingApprovalTasks} 项，补偿待处理 ${compensationPendingTasks} 项，P1 事件 ${p1Incidents} 项。`
          : '治理态势：当前无审批与补偿积压，风险事件可控。',
        highRiskActiveTasks > 0
          ? `高风险任务：当前有 ${highRiskActiveTasks} 项 L4 任务在处理，请重点关注审批与回滚策略。`
          : '高风险任务：当前无进行中的 L4 任务。'
      ]
    };
  }

  resolveEffectiveRetrievalMode(employee) {
    const employeeMode = String((((employee || {}).retrievalPolicy || {}).mode) || '').trim().toLowerCase();
    if (employeeMode === 'busy' || employeeMode === 'idle') {
      return { mode: employeeMode, source: 'employee' };
    }
    const platformMode = String((((this.store || {}).retrievalPolicy || {}).mode) || '').trim().toLowerCase();
    if (platformMode === 'busy' || platformMode === 'idle') {
      return { mode: platformMode, source: 'platform' };
    }
    return { mode: 'auto', source: 'model' };
  }

  normalizeEmployeeFilters(filters = {}) {
    const source = filters && typeof filters === 'object' ? filters : {};
    return {
      keyword: String(source.keyword || source.q || '').trim(),
      department: String(source.department || '').trim(),
      role: String(source.role || '').trim()
    };
  }

  listEmployees(filters = {}) {
    const normalized = this.normalizeEmployeeFilters(filters);
    if (!normalized.keyword && !normalized.department && !normalized.role) {
      return this.store.employees.map((employee) => this.normalizeEmployeeRuntimeAliases(employee));
    }
    const keyword = normalized.keyword.toLowerCase();
    return this.store.employees.filter((employee) => {
      if (normalized.department && String(employee.department || '') !== normalized.department) return false;
      if (normalized.role && String(employee.role || '') !== normalized.role) return false;
      if (!keyword) return true;
      const searchable = [
        employee.employeeCode,
        employee.name,
        employee.email,
        employee.department,
        employee.role
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return searchable.includes(keyword);
    }).map((employee) => this.normalizeEmployeeRuntimeAliases(employee));
  }

  listSkills() {
    return this.store.skills;
  }

  listLogs(filters = {}) {
    const taskId = filters && filters.taskId ? String(filters.taskId) : '';
    const employeeId = filters && filters.employeeId ? String(filters.employeeId) : '';
    if (!taskId && !employeeId) return this.store.events;
    return this.store.events.filter((event) => {
      const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
      const payloadTaskId = String(payload.taskId || payload.task_id || '');
      const payloadEmployeeId = String(payload.employeeId || payload.employee_id || '');
      if (taskId && payloadTaskId !== taskId) return false;
      if (employeeId && payloadEmployeeId !== employeeId) return false;
      return true;
    });
  }

  listRuntimeShadowDiffs(filters = {}) {
    const taskId = String((filters && filters.taskId) || '').trim();
    const employeeId = String((filters && filters.employeeId) || '').trim();
    const targetEngine = String((filters && filters.targetEngine) || '').trim().toLowerCase();
    const page = Math.max(1, Number((filters && filters.page) || 1) || 1);
    const pageSize = Math.max(1, Math.min(200, Number((filters && filters.pageSize) || 20) || 20));

    const all = this.store.events.filter((event) => String((event && event.type) || '') === 'runtime.shadow.compared')
      .filter((event) => {
        const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
        const payloadTaskId = String(payload.task_id || payload.taskId || '').trim();
        const payloadEmployeeId = String(payload.employee_id || payload.employeeId || '').trim();
        const payloadTargetEngine = String(payload.targetEngine || '').trim().toLowerCase();
        if (taskId && payloadTaskId !== taskId) return false;
        if (employeeId && payloadEmployeeId !== employeeId) return false;
        if (targetEngine && payloadTargetEngine !== targetEngine) return false;
        return true;
      });

    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);
    return {
      total: all.length,
      page,
      pageSize,
      items
    };
  }

  listTasks() {
    return this.store.tasks.slice().reverse().map((task) => this.normalizeTaskRuntimeAliases(task));
  }

  getTaskDetail(taskId) {
    const task = this.store.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('task not found');
    this.normalizeTaskRuntimeAliases(task);
    const employee = this.store.employees.find((e) => e.id === task.employeeId) || null;
    if (employee) this.normalizeEmployeeRuntimeAliases(employee);
    const logs = this.store.events.filter((ev) => {
      const p = ev.payload || {};
      return p.taskId === taskId || p.task_id === taskId;
    });
    const findings = this.store.ossFindings.filter((f) => f.taskId === taskId);
    return { ...task, employee, logs, findings };
  }

  getRollbackReport(filters = {}) {
    const taskId = filters.taskId ? String(filters.taskId) : null;
    const traceId = filters.traceId ? String(filters.traceId) : null;
    if (!taskId && !traceId) throw new Error('taskId or traceId is required');

    let task = null;
    if (taskId) {
      task = this.store.tasks.find((t) => String(t.id) === taskId) || null;
    } else {
      task = this.store.tasks.find((t) => String(t.traceId) === traceId) || null;
    }
    if (!task) throw new Error('task not found');

    const logs = this.store.events.filter((ev) => {
      const p = ev.payload || {};
      return p.task_id === task.id || p.taskId === task.id || p.trace_id === task.traceId || p.traceId === task.traceId;
    });
    const rollbackEvents = logs.filter((ev) => ev.type === 'task.rollback.triggered' || ev.type === 'task.rolled_back');
    const employee = this.store.employees.find((e) => e.id === task.employeeId) || null;

    return {
      taskId: task.id,
      traceId: task.traceId,
      employeeId: task.employeeId,
      employeeCode: employee ? employee.employeeCode : null,
      status: task.status,
      rollback: task.rollback || null,
      rollbackEvents,
      timeline: logs
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

  getRollbackPackage(filters = {}) {
    const report = this.getRollbackReport(filters);
    const timelineHashes = report.timeline.map((ev) => ({
      id: ev.id,
      eventHash: ev.event_hash || null,
      payloadHash: ev.payload_hash || null
    }));
    const manifest = {
      generatedAt: new Date().toISOString(),
      taskId: report.taskId,
      traceId: report.traceId,
      reportHash: this.hash(this.canonicalize(report)),
      timelineHash: this.hash(this.canonicalize(timelineHashes)),
      rollbackEvidenceHash: this.hash(this.canonicalize(report.rollback || {})),
      eventCount: report.timeline.length
    };
    return {
      report,
      timelineHashes,
      manifest
    };
  }

  listOssFindings() {
    return this.store.ossFindings;
  }

  listOssCases(filters = {}) {
    const list = Array.isArray(this.store.ossCases) ? this.store.ossCases : [];
    const status = String(filters.status || '').trim();
    const risk = String(filters.risk || '').trim().toLowerCase();
    const evidenceComplete = String(filters.evidenceComplete || '').trim().toLowerCase();
    const from = String(filters.from || '').trim();
    const to = String(filters.to || '').trim();
    return list.filter((item) => {
      if (status && String(item.status || '') !== status) return false;
      const top = item && item.evaluation && item.evaluation.topCandidate ? item.evaluation.topCandidate : null;
      const topRisk = top && top.hardGate && top.hardGate.riskLevel ? String(top.hardGate.riskLevel).toLowerCase() : '';
      if (risk && topRisk !== risk) return false;
      if (evidenceComplete) {
        const ok = Boolean(item && item.evaluation && item.evaluation.consistency && item.evaluation.consistency.ok === true);
        if (evidenceComplete === 'true' && !ok) return false;
        if (evidenceComplete === 'false' && ok) return false;
      }
      if (from) {
        const ts = Date.parse(String(item.createdAt || ''));
        if (Number.isFinite(ts) && ts < Date.parse(from)) return false;
      }
      if (to) {
        const ts = Date.parse(String(item.createdAt || ''));
        if (Number.isFinite(ts) && ts > Date.parse(to)) return false;
      }
      return true;
    });
  }

  getOssCaseDetail(caseId) {
    const list = this.listOssCases();
    const found = list.find((x) => x.id === caseId);
    if (!found) throw new Error('oss case not found');
    const candidateEvaluations = Array.isArray(this.store.ossCandidateEvaluations)
      ? this.store.ossCandidateEvaluations.filter((x) => x.caseId === caseId)
      : [];
    const buildVsBuy = Array.isArray(this.store.ossBuildVsBuyAssessments)
      ? this.store.ossBuildVsBuyAssessments.find((x) => x.caseId === caseId) || null
      : null;
    const logs = this.store.events.filter((ev) => {
      const payload = ev && ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
      return payload.caseId === caseId || payload.case_id === caseId;
    });
    return {
      ...found,
      candidateEvaluations,
      buildVsBuy,
      logs
    };
  }

  getEmployeeDetail(employeeId) {
    const employee = this.store.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error('employee not found');
    this.normalizeEmployeeRuntimeAliases(employee);

    const relatedTasks = this.store.tasks
      .filter((t) => t.employeeId === employeeId)
      .map((task) => this.normalizeTaskRuntimeAliases(task))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const relatedLogs = this.store.events.filter((ev) => {
      const p = ev.payload || {};
      return p.employeeId === employeeId
        || p.employee_id === employeeId
        || p.employeeCode === employee.employeeCode;
    });

    const skills = this.store.skills.filter((s) => employee.linkedSkillIds.includes(s.id));
    const summary = {
      tasks: this.computeTaskSummary(relatedTasks),
      governance: this.computeGovernanceSummary(relatedLogs, relatedTasks),
      growth: this.computeGrowthSummary(employee, skills),
      runtime: {
        ...this.computeRuntimeUsage(relatedTasks),
        retrievalPolicy: employee.retrievalPolicy || { mode: 'inherit' },
        effectiveRetrievalMode: this.resolveEffectiveRetrievalMode(employee)
      }
    };
    const recentTasks = relatedTasks.slice(0, 8).map((task) => ({
      id: task.id,
      goal: task.goal,
      status: task.status,
      riskLevel: task.riskLevel,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      requiresApproval: Boolean(task.requiresApproval),
      approval: task.approval || null,
      rollback: task.rollback || null
    }));

    return {
      ...employee,
      relatedTasks,
      relatedSkills: skills,
      recentTasks,
      summary,
      logs: relatedLogs.slice(0, 200)
    };
  }

  getEmployeeLogs(employeeId) {
    return this.getEmployeeDetail(employeeId).logs;
  }
}

module.exports = { AdminUseCases };
