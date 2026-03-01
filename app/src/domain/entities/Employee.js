const { randomUUID } = require('crypto');
const DEFAULT_ATOMIC_CAPABILITIES = [
  'bash-execution',
  'file-read-write',
  'internal-external-search',
  'tool-api-calling',
  'test-and-logging'
];

function inferEmail(name) {
  const slug = String(name).trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.\-_]/g, '');
  return `${slug || 'digital.employee'}@dcf.local`;
}

function normalizeApprovalPolicy(input = {}) {
  const rawByRisk = (input && input.byRisk && typeof input.byRisk === 'object') ? input.byRisk : {};
  const defaults = {
    L1: { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false },
    L2: { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false },
    L3: { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false },
    L4: { requiredApprovals: 2, requiredAnyRoles: ['auditor', 'super_admin'], distinctRoles: true }
  };

  const byRisk = {};
  for (const key of ['L1', 'L2', 'L3', 'L4']) {
    const src = rawByRisk[key] || {};
    const base = defaults[key];
    byRisk[key] = {
      requiredApprovals: Number.isFinite(Number(src.requiredApprovals))
        ? Math.max(0, Number(src.requiredApprovals))
        : base.requiredApprovals,
      requiredAnyRoles: Array.isArray(src.requiredAnyRoles) ? src.requiredAnyRoles.slice() : base.requiredAnyRoles.slice(),
      distinctRoles: typeof src.distinctRoles === 'boolean' ? src.distinctRoles : base.distinctRoles
    };
  }
  return { byRisk };
}

function normalizeJobPolicy(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const maxRiskLevel = String(raw.maxRiskLevel || '').trim().toUpperCase();
  return {
    allow: Array.isArray(raw.allow) ? raw.allow.slice() : [],
    deny: Array.isArray(raw.deny) ? raw.deny.slice() : [],
    strictAllow: raw.strictAllow === true,
    allowedDepartments: Array.isArray(raw.allowedDepartments) ? raw.allowedDepartments.slice() : [],
    allowedRoles: Array.isArray(raw.allowedRoles) ? raw.allowedRoles.slice() : [],
    maxRiskLevel: ['L1', 'L2', 'L3', 'L4'].includes(maxRiskLevel) ? maxRiskLevel : null,
    kpi: Array.isArray(raw.kpi) ? raw.kpi.slice() : [],
    escalationRule: typeof raw.escalationRule === 'string' ? raw.escalationRule : '',
    shutdownRule: typeof raw.shutdownRule === 'string' ? raw.shutdownRule : ''
  };
}

function normalizeRuntimeProfile(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const toolScope = Array.isArray(raw.toolScope)
    ? raw.toolScope
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => item.slice(0, 40))
    : [];
  return {
    agentId: String(raw.agentId || '').trim().slice(0, 80) || null,
    runtimeBaseUrl: String(raw.runtimeBaseUrl || '').trim().slice(0, 500) || null,
    systemPrompt: String(raw.systemPrompt || '').trim().slice(0, 4000) || null,
    toolScope: Array.from(new Set(toolScope)),
    sessionKey: String(raw.sessionKey || '').trim().slice(0, 160) || null,
    workspacePath: String(raw.workspacePath || '').trim().slice(0, 500) || null,
    agentDir: String(raw.agentDir || '').trim().slice(0, 500) || null,
    provisionStatus: String(raw.provisionStatus || '').trim().slice(0, 40) || null,
    provisionError: String(raw.provisionError || '').trim().slice(0, 500) || null,
    provisionedAt: String(raw.provisionedAt || '').trim().slice(0, 80) || null
  };
}

function normalizeOpenClawProfile(input = {}) {
  return normalizeRuntimeProfile(input);
}

function normalizeRetrievalPolicy(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const hasMode = Object.prototype.hasOwnProperty.call(raw, 'mode');
  const mode = String(raw.mode || '').trim().toLowerCase();
  if (hasMode && !['inherit', 'auto', 'busy', 'idle'].includes(mode)) {
    throw new Error('retrievalPolicy.mode must be one of inherit|auto|busy|idle');
  }
  return {
    mode: ['inherit', 'auto', 'busy', 'idle'].includes(mode) ? mode : 'inherit'
  };
}

function defaultOpenClawAgentId(seq) {
  return `dcf-agent-${String(seq).padStart(4, '0')}`;
}

function defaultOpenClawSystemPrompt(input = {}) {
  // No preset persona — OpenClaw workspace files (SOUL.md, IDENTITY.md, BOOTSTRAP.md)
  // drive the agent's identity through natural conversation.
  // Only pass minimal organizational context as supplementary info.
  const name = String(input.name || '').trim();
  const department = String(input.department || '').trim();
  const role = String(input.role || '').trim();
  const riskLevel = String(input.riskLevel || 'L2').trim().toUpperCase();
  const parts = [];
  if (name || department || role) {
    parts.push(`[Organizational context: ${[name, department, role].filter(Boolean).join(' / ')}; risk level: ${riskLevel}]`);
  }
  return parts.length ? parts.join('\n') : null;
}

function createEmployee(input, seq) {
  if (!input.name || !input.department || !input.role || !input.creator) {
    throw new Error('name, department, role, creator are required');
  }
  const tenantId = String(input.tenantId || '').trim();
  const accountId = String(input.accountId || '').trim();
  if (!tenantId || !accountId) {
    throw new Error('tenantId and accountId are required');
  }
  const riskLevel = input.riskLevel || 'L2';
  const runtimeProfile = normalizeRuntimeProfile(input.runtimeProfile || input.openclawProfile || input.openclaw || {});
  if (!runtimeProfile.agentId) runtimeProfile.agentId = defaultOpenClawAgentId(seq);
  if (!runtimeProfile.systemPrompt) {
    runtimeProfile.systemPrompt = defaultOpenClawSystemPrompt({
      name: input.name,
      department: input.department,
      role: input.role,
      riskLevel
    });
  }

  return {
    id: randomUUID(),
    employeeCode: `DE-${String(seq).padStart(4, '0')}`,
    agentType: 'parent',
    parentEmployeeId: null,
    name: input.name,
    tenantId,
    accountId,
    actorUserId: input.actorUserId ? String(input.actorUserId) : null,
    email: input.email || inferEmail(input.name),
    creator: input.creator,
    department: input.department,
    role: input.role,
    riskLevel,
    jobPolicy: normalizeJobPolicy(input.jobPolicy || {}),
    approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy || {}),
    runtimeProfile,
    openclawProfile: runtimeProfile,
    defaultSkillScope: Array.isArray(input.defaultSkillScope)
      ? input.defaultSkillScope.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
      : [],
    retrievalPolicy: normalizeRetrievalPolicy(input.retrievalPolicy || {}),
    status: 'active',
    knowledge: [],
    capabilities: Array.isArray(input.capabilities) && input.capabilities.length
      ? input.capabilities.slice()
      : DEFAULT_ATOMIC_CAPABILITIES.slice(),
    childAgents: [],
    linkedSkillIds: [],
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  createEmployee,
  defaultOpenClawSystemPrompt,
  normalizeRuntimeProfile,
  normalizeApprovalPolicy,
  normalizeJobPolicy,
  normalizeOpenClawProfile,
  normalizeRetrievalPolicy,
  DEFAULT_ATOMIC_CAPABILITIES
};
