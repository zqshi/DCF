const { randomUUID } = require('crypto');

const SKILL_STRUCTURE_SCHEMA = 'skills.v1';
const SKILL_STATUSES = ['active', 'pending', 'approved', 'rejected', 'rollback'];
const SKILL_STATUS_TRANSITIONS = {
  active: ['rollback'],
  pending: ['approved', 'rejected'],
  approved: ['rollback'],
  rejected: ['pending'],
  rollback: ['pending']
};

function toString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function toMultilineString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replaceAll('\r\n', '\n');
}

function toStringList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback.slice();
  return value.map((x) => toString(x)).filter(Boolean);
}

function normalizeResourceItem(item) {
  if (!item || typeof item !== 'object') return null;
  const type = toString(item.type).toLowerCase();
  const normalized = {
    type,
    name: toString(item.name),
    path: toString(item.path),
    description: toString(item.description),
    command: toString(item.command),
    entry: toString(item.entry),
    contentType: toString(item.contentType),
    content: toMultilineString(item.content),
    size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0
  };
  if (!normalized.type && !normalized.name && !normalized.path && !normalized.command && !normalized.entry) {
    return null;
  }
  return normalized;
}

function normalizeResourceGroups(input) {
  const empty = {
    scripts: [],
    templates: [],
    references: [],
    assets: [],
    examples: [],
    tools: [],
    others: []
  };
  if (!input) return empty;

  const pushByType = (item) => {
    if (!item) return;
    if (item.type === 'script') empty.scripts.push(item);
    else if (item.type === 'template') empty.templates.push(item);
    else if (item.type === 'reference') empty.references.push(item);
    else if (item.type === 'asset') empty.assets.push(item);
    else if (item.type === 'example') empty.examples.push(item);
    else if (item.type === 'tool') empty.tools.push(item);
    else empty.others.push(item);
  };

  if (Array.isArray(input)) {
    input.forEach((raw) => pushByType(normalizeResourceItem(raw)));
    return empty;
  }

  const raw = input && typeof input === 'object' ? input : {};
  const mapGroup = (value, groupType) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          return normalizeResourceItem({ ...entry, type: toString(entry.type, groupType) });
        }
        const path = toString(entry);
        if (!path) return null;
        return normalizeResourceItem({ type: groupType, path });
      })
      .filter(Boolean);
  };

  empty.scripts = mapGroup(raw.scripts, 'script');
  empty.templates = mapGroup(raw.templates, 'template');
  empty.references = mapGroup(raw.references, 'reference');
  empty.assets = mapGroup(raw.assets, 'asset');
  empty.examples = mapGroup(raw.examples, 'example');
  empty.tools = mapGroup(raw.tools, 'tool');
  empty.others = mapGroup(raw.others, 'other');
  return empty;
}

function normalizeStructure(input, baseName, baseDescription, fallbackPrompt = '') {
  const raw = input && typeof input === 'object' ? input : {};
  const steps = toStringList(raw.steps, [
    `理解任务目标：${baseName}`,
    '执行任务步骤并记录关键输出',
    '复盘并更新可复用经验'
  ]);
  const prompt = toString(raw.prompt || raw.systemPrompt, toString(fallbackPrompt));
  return {
    schema: SKILL_STRUCTURE_SCHEMA,
    summary: toString(raw.summary, baseDescription || `${baseName} 的标准化执行技能`),
    trigger: toStringList(raw.trigger, [baseName]),
    steps,
    inputs: toStringList(raw.inputs, ['任务目标', '上下文信息']),
    outputs: toStringList(raw.outputs, ['执行结果', '复盘结论']),
    prompt,
    skillMarkdown: toMultilineString(raw.skillMarkdown || raw.markdown || ''),
    resources: normalizeResourceGroups(raw.resources)
  };
}

function createSkill(input) {
  if (!input || typeof input !== 'object') throw new Error('skill input is required');
  if (!input.name || !input.type) throw new Error('name and type are required');
  if (!['general', 'domain'].includes(input.type)) throw new Error('type must be general or domain');
  if (input.type === 'domain' && !input.domain) throw new Error('domain is required for domain skill');

  const status = input.status || 'active';
  if (!SKILL_STATUSES.includes(status)) {
    throw new Error(`invalid skill status: ${status}`);
  }

  const name = toString(input.name);
  const description = toString(input.description, `${name} skill`);
  const type = input.type;
  const domain = type === 'domain' ? toString(input.domain) : null;

  const createdAt = input.createdAt ? new Date(input.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = input.updatedAt ? new Date(input.updatedAt).toISOString() : createdAt;
  const numericRisk = Number(input.riskScore);
  const riskScore = Number.isFinite(numericRisk)
    ? Math.min(100, Math.max(0, Math.round(numericRisk)))
    : 0;

  return {
    id: input.id || randomUUID(),
    name,
    description,
    type,
    domain,
    version: toString(input.version, '1.0.0'),
    source: input.source || 'manual',
    riskScore,
    status,
    createdAt,
    updatedAt,
    structure: normalizeStructure(input.structure, name, description, toString(input.prompt || input.systemPrompt))
  };
}

function canTransitionSkillStatus(fromStatus, toStatus) {
  if (!SKILL_STATUSES.includes(fromStatus) || !SKILL_STATUSES.includes(toStatus)) return false;
  const next = SKILL_STATUS_TRANSITIONS[fromStatus] || [];
  return next.includes(toStatus);
}

module.exports = {
  createSkill,
  SKILL_STRUCTURE_SCHEMA,
  SKILL_STATUSES,
  SKILL_STATUS_TRANSITIONS,
  canTransitionSkillStatus
};
