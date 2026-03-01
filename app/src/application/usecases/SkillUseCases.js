const { createSkill, canTransitionSkillStatus } = require('../../domain/entities/Skill');
const {
  OSS_EVALUATION_SCHEMA_VERSION,
  REQUIRED_DIMENSIONS,
  normalizeEvidenceList,
  normalizeDimensionScores,
  evaluateDimensionConsistency,
  computeWeightedScore
} = require('../../domain/services/OssEvaluationPolicyService');

const PRELOADED_SKILLS = [
  {
    name: 'find-skills',
    type: 'general',
    version: '1.0.0',
    source: 'preloaded',
    description: '搜索并匹配可复用技能，输出候选技能、适用场景与调用建议',
    structure: {
      summary: '在任务执行中基于关键词快速检索技能资产',
      trigger: ['find skills', 'skill search', '技能搜索', '查找技能'],
      steps: [
        '读取任务目标和上下文关键词',
        '检索技能目录并计算匹配度',
        '输出候选技能与调用建议'
      ],
      inputs: ['任务目标', '关键词', '上下文'],
      outputs: ['候选技能列表', '匹配理由', '调用建议']
    }
  }
];

const ESSENTIAL_SKILL_CATALOG = [
  {
    name: 'find-skills',
    type: 'general',
    version: '1.0.0',
    source: 'preloaded',
    description: '技能导航与检索入口，帮助快速发现与安装可复用技能',
    structure: {
      summary: '搜索技能目录并给出安装与更新建议',
      trigger: ['find skills', 'skill search', '技能搜索', '查找技能'],
      steps: [
        '识别用户目标与场景关键词',
        '检索候选技能并排序',
        '输出推荐项与安装建议'
      ],
      inputs: ['用户目标', '关键词', '上下文'],
      outputs: ['候选技能', '安装建议', '更新建议'],
      prompt: '你是技能导航助手。先识别用户场景，再搜索候选技能，返回推荐理由、安装命令、更新命令。',
      skillMarkdown: [
        '# Find Skills',
        '',
        '## 定位',
        '- 作为元技能帮助发现、安装、更新其他技能。',
        '',
        '## 常用命令',
        '- `openclaw skills search <keyword>`',
        '- `npx clawhub@latest install <skill-slug>`',
        '- `npx skills check`',
        '- `npx skills update <skill-slug>`',
        '',
        '## 输出要求',
        '- 返回候选技能列表、适用场景、安装步骤、更新建议。'
      ].join('\n')
    }
  },
  {
    name: 'tavily-search',
    type: 'general',
    version: '1.0.0',
    source: 'preloaded',
    description: '面向实时联网检索的结构化搜索技能，支持深度与新闻检索场景',
    structure: {
      summary: '为实时信息检索提供结构化结果，适合资讯与专题调研',
      trigger: ['tavily search', '联网搜索', '实时资讯'],
      steps: [
        '识别检索目标与时效要求',
        '执行标准/深度/新闻搜索',
        '输出结构化结果并附来源'
      ],
      inputs: ['问题描述', '时间范围', '深度模式参数'],
      outputs: ['结构化结果', '来源链接', '关键结论'],
      prompt: '优先返回高相关、可核验信息。每条结果包含标题、摘要、来源链接。',
      skillMarkdown: [
        '# Tavily Search',
        '',
        '## 定位',
        '- 面向 AI 的结构化联网检索能力。',
        '',
        '## 常用命令',
        '- `openclaw skills configure tavily-search`',
        '- `openclaw chat "用tavily-search --deep 搜索 <query>"`',
        '- `openclaw chat "用tavily-search --news 搜索 <query>"`',
        '',
        '## 输出要求',
        '- 每条结果应包含标题、摘要、来源。'
      ].join('\n')
    }
  },
  {
    name: 'multi-search-engine',
    type: 'general',
    version: '1.0.0',
    source: 'preloaded',
    description: '多搜索引擎聚合检索能力，适合多来源交叉验证',
    structure: {
      summary: '聚合多搜索引擎结果，适用于对比验证与隐私检索',
      trigger: ['multi search engine', '多源验证', '隐私搜索'],
      steps: [
        '确定检索问题与对比维度',
        '按引擎执行多源搜索',
        '输出差异对比与交叉结论'
      ],
      inputs: ['检索问题', '目标引擎', '比较维度'],
      outputs: ['多源结果', '对比分析', '可信结论'],
      prompt: '至少给出 3 个来源并标注差异，避免单源结论。',
      skillMarkdown: [
        '# Multi Search Engine',
        '',
        '## 定位',
        '- 多引擎聚合搜索能力，支持交叉验证。',
        '',
        '## 常用命令',
        '- `openclaw chat "用multi-search-engine搜索 <query>"`',
        '- `openclaw chat "用multi-search-engine --engine duckduckgo 搜索 <query>"`',
        '- `openclaw chat "用multi-search-engine --engine wolframalpha 计算 <expr>"`',
        '',
        '## 输出要求',
        '- 给出来源差异与一致结论。'
      ].join('\n')
    }
  },
  {
    name: 'office-automation',
    type: 'general',
    version: '1.0.0',
    source: 'preloaded',
    description: '办公自动化技能，覆盖文档、邮件、日程与表格处理场景',
    structure: {
      summary: '处理周报、邮件、日程、表格等高频办公任务',
      trigger: ['office automation', '周报生成', '邮件处理', '日程管理'],
      steps: [
        '识别办公任务类型与约束',
        '执行文档/邮件/日程/表格流程',
        '输出结果并保存到指定路径'
      ],
      inputs: ['任务目标', '文件路径', '邮箱/日程配置'],
      outputs: ['文档产物', '邮件结果', '日程结果', '处理日志'],
      prompt: '保持输出清晰可复用。涉及邮件和日程时校验配置与权限。',
      skillMarkdown: [
        '# Office Automation',
        '',
        '## 定位',
        '- 面向办公场景的自动化执行技能。',
        '',
        '## 常用命令',
        '- `openclaw skills configure office-automation`',
        '- `openclaw chat "用office-automation生成本周工作周报 ..."`',
        '- `openclaw chat "用office-automation发送邮件 ..."`',
        '- `openclaw chat "用office-automation处理 <excel-path> ..."`',
        '',
        '## 输出要求',
        '- 结果应包含保存路径、执行状态、失败重试建议。'
      ].join('\n')
    }
  }
];

function keyForSkill(skill) {
  return [skill.name, skill.type, skill.domain || '', skill.version || '1.0.0'].join('|');
}

function sanitizeRuntimeSkillName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const SKILL_STATUS_ROLE_POLICY = {
  pending: ['skill_admin', 'super_admin'],
  approved: ['skill_admin', 'super_admin'],
  rejected: ['skill_admin', 'super_admin'],
  rollback: ['super_admin']
};

function makeHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class SkillUseCases {
  constructor(store, options = {}) {
    this.store = store;
    this.bundleImporter = options.bundleImporter || null;
    this.essentialPreloaded = false;
    this.ensureReady();
  }

  normalizeSkillSafe(item) {
    try {
      const normalized = createSkill(item);
      return {
        ...item,
        ...normalized,
        proposal: item && item.proposal ? item.proposal : undefined
      };
    } catch {
      return item;
    }
  }

  normalizeStore() {
    this.store.skills = this.store.skills.map((item) => this.normalizeSkillSafe(item));
  }

  ensureReady() {
    this.normalizeStore();
    this.ensurePreloadedSkills();
    this.ensureEssentialPreloaded();
    this.normalizeStore();
  }

  ensureEssentialPreloaded() {
    if (this.essentialPreloaded) return;
    this.preloadEssentialSkills({ overwrite: true });
    this.essentialPreloaded = true;
  }

  ensurePreloadedSkills() {
    const removedPreloadedKeys = this.getRemovedPreloadedKeys();
    const existing = new Map(this.store.skills.map((s) => [keyForSkill(s), s]));
    for (const seed of PRELOADED_SKILLS) {
      const normalized = createSkill(seed);
      const key = keyForSkill(normalized);
      if (removedPreloadedKeys.has(key)) continue;
      if (existing.has(key)) continue;
      this.store.skills.push(normalized);
      this.store.addEvent('skill.preloaded', {
        skillId: normalized.id,
        name: normalized.name,
        type: normalized.type,
        source: normalized.source
      });
    }
  }

  preloadEssentialSkills(options = {}) {
    const overwrite = Boolean(options.overwrite === true);
    const deletedSkillKeys = this.getDeletedSkillKeys();
    this.normalizeStore();
    this.ensurePreloadedSkills();
    const result = {
      total: ESSENTIAL_SKILL_CATALOG.length,
      created: 0,
      updated: 0,
      skipped: 0,
      skills: []
    };

    const existingByKey = new Map(this.store.skills.map((item) => [keyForSkill(this.normalizeSkillSafe(item)), item]));
    for (const seed of ESSENTIAL_SKILL_CATALOG) {
      const normalized = createSkill(seed);
      const key = keyForSkill(normalized);
      if (deletedSkillKeys.has(key)) {
        result.skipped += 1;
        continue;
      }
      const existing = existingByKey.get(key);
      if (!existing) {
        this.store.skills.push(normalized);
        this.store.addEvent('skill.preloaded', {
          skillId: normalized.id,
          name: normalized.name,
          type: normalized.type,
          source: normalized.source
        });
        result.created += 1;
        result.skills.push(normalized);
        existingByKey.set(key, normalized);
        continue;
      }
      if (!overwrite) {
        result.skipped += 1;
        result.skills.push(this.normalizeSkillSafe(existing));
        continue;
      }
      existing.description = normalized.description;
      existing.structure = normalized.structure;
      existing.source = normalized.source;
      existing.version = normalized.version;
      existing.updatedAt = new Date().toISOString();
      result.updated += 1;
      result.skills.push(this.normalizeSkillSafe(existing));
    }
    this.store.addEvent('skill.essential.preloaded', {
      total: result.total,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped
    });
    return result;
  }

  getRemovedPreloadedKeys() {
    const removed = new Set();
    const events = Array.isArray(this.store.events) ? this.store.events : [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      const preloadedKey = String(payload.preloadedKey || '').trim();
      if (!preloadedKey) continue;
      if (event.type === 'skill.preloaded.deleted') {
        removed.add(preloadedKey);
      }
      if (event.type === 'skill.preloaded.restored') {
        removed.delete(preloadedKey);
      }
    }
    return removed;
  }

  getDeletedSkillKeys() {
    const removed = new Set();
    const events = Array.isArray(this.store.events) ? this.store.events : [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      const skillKey = String(payload.skillKey || '').trim();
      if (skillKey && event.type === 'skill.deleted') removed.add(skillKey);
      if (skillKey && event.type === 'skill.restored') removed.delete(skillKey);
      const preloadedKey = String(payload.preloadedKey || '').trim();
      if (preloadedKey && event.type === 'skill.preloaded.deleted') removed.add(preloadedKey);
      if (preloadedKey && event.type === 'skill.preloaded.restored') removed.delete(preloadedKey);
    }
    return removed;
  }

  normalizeSearchKeywords(input = '') {
    return String(input || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5_-]+/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  calculateSearchScore(skill, keywords) {
    if (!keywords.length) return 0;
    const fields = [
      String(skill.name || ''),
      String(skill.description || ''),
      String(skill.type || ''),
      String(skill.domain || ''),
      String(skill.source || '')
    ];
    const structure = skill.structure && typeof skill.structure === 'object' ? skill.structure : {};
    const structuredText = []
      .concat(Array.isArray(structure.trigger) ? structure.trigger : [])
      .concat(Array.isArray(structure.steps) ? structure.steps : [])
      .concat(Array.isArray(structure.inputs) ? structure.inputs : [])
      .concat(Array.isArray(structure.outputs) ? structure.outputs : []);
    const bag = fields.concat(structuredText).join(' ').toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (String(skill.name || '').toLowerCase().includes(kw)) score += 40;
      if (String(skill.description || '').toLowerCase().includes(kw)) score += 20;
      if (bag.includes(kw)) score += 10;
    }
    return score;
  }

  search(input = {}) {
    this.ensureReady();
    const query = String(input.query || input.q || '').trim();
    const type = String(input.type || '').trim();
    const status = String(input.status || '').trim();
    const limit = Math.max(1, Math.min(50, Number(input.limit || 10) || 10));
    const keywords = this.normalizeSearchKeywords(query);
    const ranked = this.store.skills
      .map((s) => this.normalizeSkillSafe(s))
      .filter((s) => !type || s.type === type)
      .filter((s) => !status || s.status === status)
      .map((s) => ({ ...s, matchScore: this.calculateSearchScore(s, keywords) }))
      .filter((s) => !query || s.matchScore > 0)
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return String(a.name || '').localeCompare(String(b.name || ''));
      })
      .slice(0, limit);
    return {
      query,
      keywords,
      total: ranked.length,
      items: ranked
    };
  }

  list(filter = {}) {
    this.ensureReady();
    return this.store.skills
      .filter((s) => !filter.type || s.type === filter.type)
      .filter((s) => !filter.status || s.status === filter.status)
      .map((s) => this.normalizeSkillSafe(s));
  }

  buildSkillDetail(skill) {
    const linkedEmployees = this.store.employees
      .filter((employee) => Array.isArray(employee.linkedSkillIds) && employee.linkedSkillIds.includes(skill.id))
      .map((employee) => ({
        id: employee.id,
        employeeCode: employee.employeeCode || '',
        name: employee.name || '',
        department: employee.department || '',
        role: employee.role || ''
      }));
    return {
      ...this.normalizeSkillSafe(skill),
      linkedEmployees
    };
  }

  getById(skillId) {
    this.ensureReady();
    const found = this.store.skills.find((s) => String(s.id) === String(skillId));
    if (!found) throw new Error('skill not found');
    return this.buildSkillDetail(found);
  }

  getByIdRef(skillId) {
    this.ensureReady();
    const found = this.store.skills.find((s) => String(s.id) === String(skillId));
    if (!found) throw new Error('skill not found');
    return found;
  }

  create(input) {
    const skill = createSkill(input);
    this.store.skills.push(skill);
    this.store.addEvent('skill.created', { skillId: skill.id, type: skill.type, name: skill.name });
    return skill;
  }

  propose(input = {}, actor = {}) {
    const skill = createSkill({
      ...input,
      source: input.source || 'proposal',
      status: 'pending'
    });
    const proposedBy = String(actor.userId || actor.actorId || 'unknown');
    const now = new Date().toISOString();
    skill.proposal = {
      proposedBy,
      proposedAt: now,
      decisionEngine: String(input.decisionEngine || 'manual').slice(0, 80),
      confidence: Number.isFinite(Number(input.confidence))
        ? Math.max(0, Math.min(1, Number(input.confidence)))
        : 0.6,
      policySnapshot: input.policySnapshot && typeof input.policySnapshot === 'object'
        ? input.policySnapshot
        : null,
      evaluation: this.normalizeProposalEvaluation(input.evaluation || {}),
      history: [{
        from: null,
        to: 'pending',
        note: String(input.note || 'proposal created'),
        at: now,
        actorId: proposedBy
      }]
    };
    this.store.skills.push(skill);
    this.store.addEvent('skill.proposed', {
      skillId: skill.id,
      type: skill.type,
      name: skill.name,
      status: skill.status,
      proposedBy
    });
    return skill;
  }

  normalizeProposalEvaluation(input = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const evidence = normalizeEvidenceList(src.evidence || []);
    const dimensions = normalizeDimensionScores(src.dimensions || {});
    const consistency = evaluateDimensionConsistency(dimensions, Number(src.summaryDimensionCount || REQUIRED_DIMENSIONS.length));
    const weightedScore = computeWeightedScore(dimensions);
    const hardGate = src.hardGate && typeof src.hardGate === 'object' ? src.hardGate : {};
    const passed = hardGate.passed !== false;
    const reasons = Array.isArray(hardGate.reasons) ? hardGate.reasons.map((x) => String(x)).filter(Boolean) : [];
    return {
      schemaVersion: String(src.schemaVersion || OSS_EVALUATION_SCHEMA_VERSION),
      dimensions,
      weightedScore,
      evidence,
      evidenceCount: evidence.length,
      consistency: {
        ok: Boolean(consistency.ok),
        expectedDimensions: consistency.expectedDimensions,
        presentDimensions: consistency.presentDimensions
      },
      hardGate: {
        passed: Boolean(passed),
        reasons
      }
    };
  }

  changeProposalStatus(skillId, targetStatus, actor = {}) {
    const allowed = ['pending', 'approved', 'rejected', 'rollback'];
    if (!allowed.includes(targetStatus)) throw new Error(`unsupported proposal status: ${targetStatus}`);
    const actorRole = String(actor.role || '').trim();
    const allowedRoles = SKILL_STATUS_ROLE_POLICY[targetStatus] || [];
    if (!allowedRoles.includes(actorRole)) {
      throw makeHttpError(`role is not allowed for skill status transition: ${actorRole} -> ${targetStatus}`, 403);
    }

    const skill = this.getByIdRef(skillId);
    if (!canTransitionSkillStatus(skill.status, targetStatus)) {
      throw new Error(`invalid skill status transition: ${skill.status} -> ${targetStatus}`);
    }

    const fromStatus = skill.status;
    const now = new Date().toISOString();
    const actorId = String(actor.userId || actor.actorId || 'unknown');
    const note = String(actor.note || actor.reason || '').trim();
    const proposal = skill.proposal && typeof skill.proposal === 'object' ? skill.proposal : {};
    const proposedBy = String(proposal.proposedBy || '').trim();

    if (targetStatus === 'approved' && proposedBy && proposedBy === actorId) {
      throw makeHttpError('proposal approver must be different from proposer', 403);
    }

    if (targetStatus === 'approved') {
      const evaluation = this.normalizeProposalEvaluation(proposal.evaluation || {});
      if (evaluation.evidenceCount < 1) {
        throw makeHttpError('proposal approval requires at least one evidence item', 400);
      }
      if (!evaluation.consistency.ok) {
        throw makeHttpError('proposal approval requires complete 8-dimension evaluation', 400);
      }
      if (evaluation.hardGate.passed === false) {
        throw makeHttpError('proposal approval blocked by hard gate', 400);
      }
      proposal.evaluation = evaluation;
      skill.proposal = proposal;
    }

    skill.status = targetStatus;
    skill.updatedAt = now;
    if (!skill.proposal || typeof skill.proposal !== 'object') skill.proposal = { proposedBy: 'unknown', proposedAt: now, history: [] };
    if (!Array.isArray(skill.proposal.history)) skill.proposal.history = [];
    skill.proposal.lastDecision = {
      from: fromStatus,
      to: targetStatus,
      at: now,
      actorId,
      note
    };
    skill.proposal.history.push({
      from: fromStatus,
      to: targetStatus,
      at: now,
      actorId,
      note
    });

    this.store.addEvent('skill.status.changed', {
      skillId: skill.id,
      fromStatus,
      toStatus: targetStatus,
      actorId,
      note
    });

    return skill;
  }

  linkToEmployee(input = {}) {
    const employeeId = String(input.employeeId || '');
    const skillId = String(input.skillId || '');
    if (!employeeId || !skillId) throw new Error('employeeId and skillId are required');
    const employee = this.store.employees.find((x) => String(x.id) === employeeId);
    if (!employee) throw new Error('employee not found');
    const skill = this.getById(skillId);
    if (!employee.linkedSkillIds.includes(skill.id)) employee.linkedSkillIds.push(skill.id);
    this.store.addEvent('skill.linked', {
      employeeId: employee.id,
      skillId: skill.id
    });
    return {
      employeeId: employee.id,
      skillId: skill.id,
      linkedSkillIds: employee.linkedSkillIds.slice()
    };
  }

  unlinkFromEmployee(input = {}) {
    const employeeId = String(input.employeeId || '');
    const skillId = String(input.skillId || '');
    if (!employeeId || !skillId) throw new Error('employeeId and skillId are required');
    const employee = this.store.employees.find((x) => String(x.id) === employeeId);
    if (!employee) throw new Error('employee not found');
    const skill = this.getById(skillId);
    const before = Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds.slice() : [];
    employee.linkedSkillIds = before.filter((id) => String(id) !== String(skill.id));
    this.store.addEvent('skill.unlinked', {
      employeeId: employee.id,
      skillId: skill.id
    });
    return {
      employeeId: employee.id,
      skillId: skill.id,
      linkedSkillIds: employee.linkedSkillIds.slice()
    };
  }

  deleteSkill(skillId) {
    this.ensureReady();
    const id = String(skillId || '').trim();
    if (!id) throw new Error('skillId is required');
    const detail = this.getById(id);
    if (detail.linkedEmployees.length > 0) {
      throw makeHttpError(`skill is linked by ${detail.linkedEmployees.length} employees, unlink first`, 409);
    }
    const beforeCount = this.store.skills.length;
    this.store.skills = this.store.skills.filter((item) => String(item.id) !== id);
    if (this.store.skills.length === beforeCount) throw new Error('skill not found');
    this.store.addEvent('skill.deleted', {
      skillId: id,
      skillKey: keyForSkill(detail),
      name: detail.name,
      type: detail.type,
      source: detail.source || ''
    });
    if (String(detail.source || '') === 'preloaded') {
      this.store.addEvent('skill.preloaded.deleted', {
        skillId: id,
        preloadedKey: keyForSkill(detail),
        name: detail.name,
        type: detail.type
      });
    }
    return {
      deleted: true,
      skillId: id
    };
  }

  restoreSkill(skillId) {
    this.ensureReady();
    const id = String(skillId || '').trim();
    if (!id) throw new Error('skillId is required');
    const deletedKeys = this.getDeletedSkillKeys();
    const deletedPreloaded = this.getDeletedPreloadedKeys();
    const events = Array.isArray(this.store.events) ? this.store.events : [];
    const deleteEvent = events.find((e) =>
      e && e.type === 'skill.deleted'
      && e.payload && String(e.payload.skillId || '') === id
    );
    if (!deleteEvent) throw new Error('no delete record found for this skill');
    const skillKey = String(deleteEvent.payload.skillKey || '');
    if (!deletedKeys.has(skillKey)) throw new Error('skill is not in deleted state');
    this.store.addEvent('skill.restored', {
      skillId: id,
      skillKey,
      name: deleteEvent.payload.name || '',
      type: deleteEvent.payload.type || '',
      source: deleteEvent.payload.source || ''
    });
    if (deletedPreloaded.has(skillKey)) {
      this.store.addEvent('skill.preloaded.restored', {
        skillId: id,
        preloadedKey: skillKey,
        name: deleteEvent.payload.name || '',
        type: deleteEvent.payload.type || ''
      });
    }
    return { restored: true, skillId: id, skillKey };
  }

  exportAll() {
    this.ensureReady();
    const skills = this.store.skills.map((s) => this.normalizeSkillSafe(s));
    return {
      schemaVersion: 'skills.export.v1',
      exportedAt: new Date().toISOString(),
      count: skills.length,
      skills
    };
  }

  importBatch(input = {}, options = {}) {
    const body = Array.isArray(input) ? { mode: 'merge', skills: input } : input;
    const syncMode = Boolean(options.fromRuntimeSync === true);
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    if (!Array.isArray(body.skills)) throw new Error('skills must be an array');

    this.ensureReady();
    if (mode === 'replace') this.store.skills = [];

    const current = new Map(this.store.skills.map((s, index) => [keyForSkill(s), index]));
    let created = 0;
    let updated = 0;
    const invalid = [];

    for (let i = 0; i < body.skills.length; i += 1) {
      const raw = body.skills[i];
      try {
        const normalized = createSkill(raw);
        const key = keyForSkill(normalized);
        if (current.has(key)) {
          const targetIndex = current.get(key);
          const existing = this.store.skills[targetIndex];
          this.store.skills[targetIndex] = {
            ...normalized,
            id: existing.id,
            createdAt: existing.createdAt
          };
          updated += 1;
        } else {
          this.store.skills.push(normalized);
          current.set(key, this.store.skills.length - 1);
          created += 1;
        }
      } catch (error) {
        invalid.push({ index: i, error: error.message });
      }
    }

    if (!syncMode) {
      this.ensurePreloadedSkills();
      this.preloadEssentialSkills({ overwrite: true });
    }
    this.normalizeStore();

    this.store.addEvent('skill.imported', {
      mode,
      total: body.skills.length,
      created,
      updated,
      invalid: invalid.length
    });

    return {
      mode,
      total: body.skills.length,
      created,
      updated,
      invalid
    };
  }

  async importBundle(input = {}) {
    if (!this.bundleImporter || typeof this.bundleImporter.readArchive !== 'function') {
      throw new Error('bundle importer is not configured');
    }
    const body = input && typeof input === 'object' ? input : {};
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const archive = body.archive && typeof body.archive === 'object' ? body.archive : {};
    const parsed = await this.bundleImporter.readArchive(archive);
    const skills = Array.isArray(parsed && parsed.skills) ? parsed.skills : [];
    if (!skills.length) throw new Error('archive does not contain importable skills');
    const result = this.importBatch({
      mode,
      skills
    });
    return {
      ...result,
      archive: {
        fileName: String((parsed && parsed.fileName) || archive.fileName || ''),
        skillCount: skills.length
      }
    };
  }

  syncFromRuntimeCatalog(input = {}) {
    const body = input && typeof input === 'object' ? input : {};
    const engine = String(body.engine || 'openclaw').trim().toLowerCase() || 'openclaw';
    const source = String(body.source || `runtime:${engine}`).trim() || `runtime:${engine}`;
    const onlyReady = body.onlyReady !== false;
    const pruneMissing = body.pruneMissing === true;
    const fetchedAt = String(body.fetchedAt || '').trim() || null;
    const items = Array.isArray(body.items) ? body.items : [];
    const mapped = [];
    const runtimeMetaByKey = new Map();
    const deletedSkillKeys = this.getDeletedSkillKeys();
    let skipped = 0;
    let skippedDeleted = 0;

    for (const raw of items) {
      const row = raw && typeof raw === 'object' ? raw : {};
      const runtimeStatus = String(row.status || '').trim().toLowerCase();
      const status = runtimeStatus || 'ready';
      if (onlyReady && status && status !== 'ready' && status !== 'active' && status !== 'enabled') {
        skipped += 1;
        continue;
      }
      const runtimeType = String(row.type || '').trim().toLowerCase();
      const type = runtimeType === 'domain' ? 'domain' : 'general';
      const typeInferred = runtimeType !== 'domain' && runtimeType !== 'general';
      const name = sanitizeRuntimeSkillName(row.slug || row.name || row.id || '');
      if (!name) {
        skipped += 1;
        continue;
      }
      const runtimeDomain = String(row.domain || '').trim();
      const domain = type === 'domain'
        ? sanitizeRuntimeSkillName(runtimeDomain || 'runtime')
        : null;
      const domainInferred = type === 'domain' && !runtimeDomain;
      const description = String(row.description || row.summary || '').trim();
      const version = String(row.version || '').trim();
      const rowStructure = row.structure && typeof row.structure === 'object' ? row.structure : {};
      const rowResources = row.resources && typeof row.resources === 'object' ? row.resources : null;
      const runtimeStructure = {
        ...(rowStructure && typeof rowStructure === 'object' ? rowStructure : {}),
        prompt: String(
          row.prompt
          || row.systemPrompt
          || rowStructure.prompt
          || rowStructure.systemPrompt
          || ''
        ).trim(),
        skillMarkdown: String(
          row.skillMarkdown
          || row.markdown
          || rowStructure.skillMarkdown
          || rowStructure.markdown
          || ''
        ).replaceAll('\r\n', '\n')
      };
      if (rowResources && typeof rowResources === 'object') runtimeStructure.resources = rowResources;
      const next = {
        name,
        type,
        domain,
        source,
        description: description.slice(0, 500),
        version,
        status: 'active',
        structure: runtimeStructure
      };
      const nextKey = keyForSkill(next);
      if (deletedSkillKeys.has(nextKey)) {
        skippedDeleted += 1;
        continue;
      }
      mapped.push(next);
      runtimeMetaByKey.set(nextKey, {
        engine,
        source,
        fetchedAt,
        runtime: {
          slug: String(row.slug || row.name || row.id || '').trim(),
          title: String(row.title || row.displayName || '').trim(),
          status,
          type: runtimeType,
          domain: runtimeDomain,
          version,
          description,
          raw: row.raw && typeof row.raw === 'object' ? row.raw : row
        },
        platformInference: {
          typeInferred,
          domainInferred,
          versionInferred: !version,
          descriptionInferred: !description,
          platformStatus: 'active'
        }
      });
    }

    const imported = this.importBatch({
      mode: 'merge',
      skills: mapped
    }, { fromRuntimeSync: true });
    for (const skill of this.store.skills) {
      if (!skill || typeof skill !== 'object') continue;
      if (String(skill.source || '') !== source) continue;
      const key = keyForSkill(skill);
      if (!runtimeMetaByKey.has(key)) continue;
      skill.runtimeMeta = runtimeMetaByKey.get(key);
      skill.updatedAt = new Date().toISOString();
    }
    const incomingKeySet = new Set(mapped.map((skill) => keyForSkill(skill)));
    let pruned = 0;
    let pruneSkippedLinked = 0;
    if (pruneMissing) {
      const linkedSkillIdSet = new Set(
        (Array.isArray(this.store.employees) ? this.store.employees : [])
          .flatMap((employee) => (Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds : []))
          .map((id) => String(id || ''))
      );
      const next = [];
      for (const skill of this.store.skills) {
        const row = skill && typeof skill === 'object' ? skill : {};
        const rowSource = String(row.source || '').trim();
        if (rowSource !== source) {
          next.push(skill);
          continue;
        }
        const rowKey = keyForSkill(this.normalizeSkillSafe(row));
        if (incomingKeySet.has(rowKey)) {
          next.push(skill);
          continue;
        }
        if (linkedSkillIdSet.has(String(row.id || ''))) {
          pruneSkippedLinked += 1;
          next.push(skill);
          continue;
        }
        pruned += 1;
      }
      this.store.skills = next;
    }

    this.store.addEvent('skill.runtime.synced', {
      engine,
      source,
      totalRuntime: items.length,
      accepted: mapped.length,
      skipped,
      skippedDeleted,
      pruned,
      pruneSkippedLinked,
      created: imported.created,
      updated: imported.updated
    });

    return {
      engine,
      source,
      totalRuntime: items.length,
      accepted: mapped.length,
      skipped,
      skippedDeleted,
      pruned,
      pruneSkippedLinked,
      ...imported
    };
  }
}

module.exports = { SkillUseCases };
