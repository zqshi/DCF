const { randomUUID } = require('crypto');

const SUPPORTED_ATTACHMENT_MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const SUPPORTED_ATTACHMENT_MIME_SET = new Set(Object.values(SUPPORTED_ATTACHMENT_MIME_BY_EXT));

function attachmentExtFromName(name = '') {
  const raw = String(name || '').trim().toLowerCase();
  const index = raw.lastIndexOf('.');
  if (index <= 0 || index === raw.length - 1) return '';
  return raw.slice(index + 1);
}

function normalizeAttachmentMimeType(mimeType = '', name = '') {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_ATTACHMENT_MIME_SET.has(normalized)) return normalized;
  return SUPPORTED_ATTACHMENT_MIME_BY_EXT[attachmentExtFromName(name)] || '';
}

function inferAttachmentType(mimeType = '') {
  return String(mimeType || '').startsWith('image/') ? 'image' : 'file';
}

function normalizeExternalWrite(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const system = String(input.system || '').trim();
  const operation = String(input.operation || '').trim();
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!system || !operation || !idempotencyKey) {
    throw new Error('externalWrite requires system, operation and idempotencyKey');
  }
  const compensationRaw = (input.compensation && typeof input.compensation === 'object')
    ? input.compensation
    : null;
  const compensationAction = compensationRaw ? String(compensationRaw.action || '').trim() : '';
  return {
    system: system.slice(0, 80),
    operation: operation.slice(0, 120),
    resource: String(input.resource || '').trim().slice(0, 120) || null,
    idempotencyKey: idempotencyKey.slice(0, 200),
    compensation: compensationAction
      ? { action: compensationAction.slice(0, 120) }
      : null
  };
}

function normalizeRuntimeTaskConfig(input = {}, employee = {}) {
  const base = (employee && employee.runtimeProfile && typeof employee.runtimeProfile === 'object')
    ? employee.runtimeProfile
    : ((employee && employee.openclawProfile && typeof employee.openclawProfile === 'object')
      ? employee.openclawProfile
      : {});
  const rawRuntime = (input && input.runtimeConfig && typeof input.runtimeConfig === 'object')
    ? input.runtimeConfig
    : null;
  const raw = rawRuntime || ((input && input.openclaw && typeof input.openclaw === 'object')
    ? input.openclaw
    : {});
  const explicitSessionKey = Object.prototype.hasOwnProperty.call(input || {}, 'runtimeConfig')
    && Object.prototype.hasOwnProperty.call(raw || {}, 'sessionKey');
  const toolScopeSource = Array.isArray(raw.toolScope)
    ? raw.toolScope
    : (Array.isArray(base.toolScope) ? base.toolScope : []);
  const toolScope = toolScopeSource
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 40));
  return {
    agentId: String(raw.agentId || base.agentId || '').trim().slice(0, 80) || null,
    runtimeBaseUrl: String(raw.runtimeBaseUrl || base.runtimeBaseUrl || '').trim().slice(0, 500) || null,
    systemPrompt: String(raw.systemPrompt || base.systemPrompt || '').trim().slice(0, 4000) || null,
    extraSystemPrompt: String(raw.extraSystemPrompt || '').trim().slice(0, 4000) || null,
    policyId: String(raw.policyId || '').trim().slice(0, 120) || null,
    toolScope: Array.from(new Set(toolScope)),
    workspacePath: String(raw.workspacePath || base.workspacePath || '').trim().slice(0, 500) || null,
    agentDir: String(raw.agentDir || base.agentDir || '').trim().slice(0, 500) || null,
    sessionKey: explicitSessionKey
      ? (String(raw.sessionKey || '').trim().slice(0, 160) || null)
      : (String(raw.sessionKey || base.sessionKey || '').trim().slice(0, 160) || null)
  };
}

function normalizeTaskAttachments(input = []) {
  const list = Array.isArray(input) ? input : [];
  const normalized = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim();
    const mimeType = normalizeAttachmentMimeType(item.mimeType, name);
    if (!mimeType) continue;
    const content = String(item.content || '').trim();
    if (!content) continue;
    normalized.push({
      type: inferAttachmentType(mimeType),
      name: name.slice(0, 120) || null,
      mimeType: mimeType.slice(0, 120),
      content: content.slice(0, 2_000_000)
    });
    if (normalized.length >= 6) break;
  }
  return normalized;
}

function createTask(employee, input) {
  if (!input.goal) throw new Error('goal is required');
  const now = new Date().toISOString();
  const taskId = randomUUID();
  const traceId = input.traceId || randomUUID();
  const riskLevel = input.riskLevel || employee.riskLevel;
  const policy = (input.approvalPolicy && input.approvalPolicy.byRisk) ? input.approvalPolicy : (employee.approvalPolicy || { byRisk: {} });
  const riskPolicy = (policy.byRisk && policy.byRisk[riskLevel]) ? policy.byRisk[riskLevel] : { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false };
  const requiresApproval = Number(riskPolicy.requiredApprovals || 0) > 0;
  const llmConfig = {
    model: String(((input.llmConfig || {}).model || '')).trim() || null,
    thinkingLevel: String(((input.llmConfig || {}).thinkingLevel || '')).trim() || 'medium',
    toolPolicy: String(((input.llmConfig || {}).toolPolicy || '')).trim() || 'balanced',
    // Enforce real model dialogue for all task replies.
    requireRealLlm: true,
    requireRuntimeExecution: true
  };
  const externalWrite = normalizeExternalWrite(input.externalWrite || null);
  const runtimeConfig = normalizeRuntimeTaskConfig(input, employee);
  const attachments = normalizeTaskAttachments(input.attachments);
  return {
    id: taskId,
    taskId,
    traceId,
    employeeId: employee.id,
    tenantId: employee.tenantId,
    accountId: employee.accountId,
    employeeName: employee.name,
    parentAgentId: input.parentAgentId || employee.id,
    conversationId: input.conversationId || 'default',
    goal: input.goal,
    attachments,
    riskLevel,
    permissionTicket: input.permissionTicket || null,
    constraints: {
      timeBudgetMs: Number((input.constraints || {}).timeBudgetMs || 0),
      costBudget: Number((input.constraints || {}).costBudget || 0),
      allowedTools: Array.isArray((input.constraints || {}).allowedTools) ? input.constraints.allowedTools : []
    },
    llmConfig,
    runtimeConfig,
    openclaw: runtimeConfig,
    externalWrite,
    requiresApproval,
    approval: requiresApproval ? {
      required: true,
      requiredApprovals: Number(riskPolicy.requiredApprovals || 0),
      requiredAnyRoles: Array.isArray(riskPolicy.requiredAnyRoles) ? riskPolicy.requiredAnyRoles.slice() : [],
      distinctRoles: Boolean(riskPolicy.distinctRoles),
      approvals: [],
      approved: false,
      approvedAt: null
    } : {
      required: false,
      requiredApprovals: 0,
      requiredAnyRoles: [],
      distinctRoles: false,
      approvals: [{
        approverId: 'system:auto',
        approverRole: 'system',
        approvedAt: now,
        note: 'Auto-approved for non-high-risk task.'
      }],
      approved: true,
      approvedAt: now,
    },
    status: 'pending',
    iteration: 1,
    corrections: [],
    reactTrace: [],
    decisionTrace: [],
    capabilityPrecheck: null,
    promptVersionRef: String(input.promptVersionRef || '').trim() || null,
    result: null,
    lastError: null,
    compensation: null,
    rollback: null,
    runtime: {
      taskId: null,
      source: 'openclaw',
      events: []
    },
    runtimePermission: null,
    createdAt: now,
    updatedAt: now
  };
}

module.exports = { createTask };
