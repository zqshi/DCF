const fs = require('fs');
const path = require('path');
const {
  createEmployee,
  defaultOpenClawSystemPrompt,
  normalizeApprovalPolicy,
  normalizeJobPolicy,
  normalizeRuntimeProfile,
  normalizeOpenClawProfile,
  normalizeRetrievalPolicy
} = require('../../domain/entities/Employee');
const { normalizeAccessContext, matchAccessScope, matchActorScope } = require('../../shared/tenantAccess');

const MANDATORY_DEFAULT_TOOLS = ['bash', 'read', 'search', 'test'];
const DEFAULT_RUNTIME_MANAGED_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md'
];

class EmployeeUseCases {
  constructor(store, options = {}) {
    this.store = store;
    this.dialogueGateway = options.dialogueGateway || null;
    this.provisioningGateway = options.provisioningGateway || null;
    this.runtimeProvisioningEnabled = options.runtimeProvisioningEnabled === true;
    this.runtimeWorkspaceRoot = String(
      options.runtimeWorkspaceRoot
      || process.env.OPENCLAW_EMPLOYEE_WORKSPACE_ROOT
      || path.join(process.cwd(), 'data', 'openclaw-workspaces')
    ).trim();
    this.runtimeAgentStateRoot = String(
      options.runtimeAgentStateRoot
      || process.env.OPENCLAW_EMPLOYEE_AGENT_ROOT
      || path.join(process.cwd(), 'data', 'openclaw-agents')
    ).trim();
    this.runtimeBaseUrlTemplate = String(
      options.runtimeBaseUrlTemplate
      || process.env.OPENCLAW_EMPLOYEE_RUNTIME_BASE_URL_TEMPLATE
      || ''
    ).trim();
    this.runtimeManagedFiles = Array.from(new Set(
      (Array.isArray(options.runtimeManagedFiles) ? options.runtimeManagedFiles : DEFAULT_RUNTIME_MANAGED_FILES)
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ));
  }

  ensureRuntimeProfileAliases(employee) {
    if (!employee || typeof employee !== 'object') return employee;
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    employee.runtimeProfile = runtimeProfile;
    employee.openclawProfile = runtimeProfile;
    return employee;
  }

  list(accessContext = null) {
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    const rows = !ctx
      ? this.store.employees
      : this.store.employees.filter((employee) => (
        matchAccessScope(employee, ctx)
        && matchActorScope(employee, ctx, { strict: true })
      ));
    return rows.map((employee) => this.ensureRuntimeProfileAliases(employee));
  }

  getById(employeeId, accessContext = null) {
    const employee = this.store.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error('employee not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (ctx && (!matchAccessScope(employee, ctx) || !matchActorScope(employee, ctx, { strict: true }))) {
      throw new Error('employee not found');
    }
    return this.ensureRuntimeProfileAliases(employee);
  }

  getPlatformBaselinePrompt() {
    const center = this.store && this.store.promptCenter && typeof this.store.promptCenter === 'object'
      ? this.store.promptCenter
      : null;
    const layers = center && center.layers && typeof center.layers === 'object' ? center.layers : {};
    const platform = layers.platform && typeof layers.platform === 'object' ? layers.platform : {};
    return String(platform.content || '').trim();
  }

  buildGeneratedSystemPrompt(input = {}) {
    // Minimal — let OpenClaw workspace files drive persona.
    // Only pass organizational context as a lightweight hint.
    const employeePrompt = defaultOpenClawSystemPrompt(input);
    return employeePrompt || null;
  }

  async create(input, accessContext = null) {
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    const tenantId = ctx ? ctx.tenantId : String((input && input.tenantId) || 'tenant-default');
    const accountId = ctx ? ctx.accountId : String((input && input.accountId) || 'account-default');
    const actorUserId = ctx ? ctx.actorUserId : String((input && input.actorUserId) || '') || null;
    const actorRole = String((ctx && ctx.actorRole) || '').trim().toLowerCase();
    const canDelegateCreator = ['super_admin', 'ops_owner', 'ops_admin'].includes(actorRole);
    const creator = canDelegateCreator
      ? (String((input && input.creator) || '').trim() || String(actorUserId || '').trim())
      : (String(actorUserId || '').trim() || String((input && input.creator) || '').trim());
    const existing = this.store.employees.find((e) => (
      String(e.creator || '') === creator
      && e.agentType === 'parent'
      && String(e.tenantId || '') === String(tenantId || '')
      && String(e.accountId || '') === String(accountId || '')
    ));
    if (existing) {
      throw new Error('each creator can only create one parent digital employee');
    }

    const strategyCenter = this.store && this.store.strategyCenter && typeof this.store.strategyCenter === 'object'
      ? this.store.strategyCenter
      : {};
    const incomingRuntimeProfile = input.runtimeProfile || input.openclawProfile || input.openclaw || {};
    const incomingScope = Array.isArray(incomingRuntimeProfile.toolScope)
      ? incomingRuntimeProfile.toolScope
      : [];
    const defaultToolScope = Array.isArray(strategyCenter.defaultToolScope)
      ? strategyCenter.defaultToolScope
      : [];
    const mergedToolScope = Array.from(new Set([
      ...defaultToolScope.map((item) => String(item || '').trim()).filter(Boolean),
      ...incomingScope.map((item) => String(item || '').trim()).filter(Boolean),
      ...MANDATORY_DEFAULT_TOOLS
    ])).slice(0, 20);
    const incomingPrompt = String(incomingRuntimeProfile.systemPrompt || '').trim();
    const generatedPrompt = incomingPrompt || this.buildGeneratedSystemPrompt({
      name: input.name,
      department: input.department,
      role: input.role,
      riskLevel: input.riskLevel || 'L2'
    });

    const employee = createEmployee({
      ...input,
      creator,
      runtimeProfile: {
        ...incomingRuntimeProfile,
        systemPrompt: generatedPrompt,
        toolScope: mergedToolScope
      },
      defaultSkillScope: Array.isArray(input.defaultSkillScope) && input.defaultSkillScope.length
        ? input.defaultSkillScope
        : (Array.isArray(strategyCenter.defaultSkillScope) ? strategyCenter.defaultSkillScope : []),
      tenantId,
      accountId,
      actorUserId
    }, this.store.employees.length + 1);
    await this.applyRuntimeProvisioning(employee, {
      tenantId,
      accountId,
      actorUserId,
      creator
    });
    this.store.employees.push(employee);
    this.ensureRuntimeProfileAliases(employee);
    this.store.addEvent('employee.created', {
      employeeId: employee.id,
      name: employee.name,
      creator: employee.creator,
      tenantId: employee.tenantId,
      accountId: employee.accountId
    });
    return employee;
  }

  sanitizePathSegment(input, fallback = 'default') {
    const normalized = String(input || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  buildRuntimePaths(employee, context = {}) {
    const tenantSeg = this.sanitizePathSegment(context.tenantId || employee.tenantId || 'tenant-default', 'tenant-default');
    const accountSeg = this.sanitizePathSegment(context.accountId || employee.accountId || 'account-default', 'account-default');
    const employeeSeg = this.sanitizePathSegment(employee.id || 'employee', 'employee');
    const workspacePath = path.resolve(this.runtimeWorkspaceRoot, tenantSeg, accountSeg, employeeSeg, 'workspace');
    const agentDir = path.resolve(this.runtimeAgentStateRoot, tenantSeg, accountSeg, employeeSeg, 'agent');
    return { workspacePath, agentDir };
  }

  buildRuntimeAgentName(employee) {
    const idPart = this.sanitizePathSegment(employee.id || 'employee', 'employee');
    return `dcf-${idPart}`.slice(0, 80);
  }

  buildRuntimeBaseUrl(employee, context = {}, agentId = '') {
    const template = String(this.runtimeBaseUrlTemplate || '').trim();
    if (!template) return null;
    const replacements = {
      '{tenantId}': this.sanitizePathSegment(context.tenantId || employee.tenantId || 'tenant-default', 'tenant-default'),
      '{accountId}': this.sanitizePathSegment(context.accountId || employee.accountId || 'account-default', 'account-default'),
      '{employeeId}': this.sanitizePathSegment(employee.id || 'employee', 'employee'),
      '{employeeCode}': this.sanitizePathSegment(employee.employeeCode || 'employee-code', 'employee-code'),
      '{agentId}': this.sanitizePathSegment(agentId || this.buildRuntimeAgentName(employee), 'agent')
    };
    let resolved = template;
    for (const [token, value] of Object.entries(replacements)) {
      resolved = resolved.split(token).join(value);
    }
    resolved = String(resolved || '').trim().replace(/\/$/, '');
    if (!resolved) return null;
    try {
      return new URL(resolved).toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  resolveRuntimeManagedFileName(fileName) {
    const normalized = String(fileName || '').trim().toLowerCase();
    const matched = this.runtimeManagedFiles.find((item) => String(item || '').trim().toLowerCase() === normalized);
    if (!matched) throw new Error('runtime file is not allowed');
    return matched;
  }

  ensureWorkspacePath(profile = {}) {
    const workspacePath = String(profile.workspacePath || '').trim();
    if (!workspacePath) throw new Error('employee runtime workspace is not provisioned');
    return path.resolve(workspacePath);
  }

  resolveRuntimeFilePath(workspacePath, fileName) {
    const canonicalName = this.resolveRuntimeManagedFileName(fileName);
    const root = path.resolve(workspacePath);
    const target = path.resolve(root, canonicalName);
    if (target !== path.join(root, canonicalName)) {
      throw new Error('runtime file path is invalid');
    }
    return { canonicalName, target };
  }

  async applyRuntimeProvisioning(employee, context = {}) {
    if (!this.runtimeProvisioningEnabled) {
      const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
      runtimeProfile.provisionStatus = 'disabled';
      runtimeProfile.provisionedAt = null;
      employee.runtimeProfile = runtimeProfile;
      employee.openclawProfile = runtimeProfile;
      return employee;
    }
    const useAsync = this.provisioningGateway && typeof this.provisioningGateway.provisionEmployeeRuntime === 'function';
    if (!useAsync && !(this.provisioningGateway && typeof this.provisioningGateway.provisionEmployeeRuntimeSync === 'function')) {
      throw new Error('runtime provisioning gateway is unavailable');
    }
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const paths = this.buildRuntimePaths(employee, context);
    const agentId = String(runtimeProfile.agentId || this.buildRuntimeAgentName(employee)).trim().slice(0, 80) || this.buildRuntimeAgentName(employee);
    const provisionInput = {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      agentId,
      workspacePath: paths.workspacePath,
      agentDir: paths.agentDir,
      managedFiles: this.runtimeManagedFiles.slice(),
      tenantId: context.tenantId || employee.tenantId,
      accountId: context.accountId || employee.accountId,
      actorUserId: context.actorUserId || employee.actorUserId || null
    };
    const result = useAsync
      ? (await this.provisioningGateway.provisionEmployeeRuntime(provisionInput) || {})
      : (this.provisioningGateway.provisionEmployeeRuntimeSync(provisionInput) || {});
    runtimeProfile.agentId = String(result.agentId || agentId).trim().slice(0, 80) || agentId;
    const templateRuntimeBaseUrl = this.buildRuntimeBaseUrl(employee, context, runtimeProfile.agentId);
    runtimeProfile.runtimeBaseUrl = String(result.runtimeBaseUrl || runtimeProfile.runtimeBaseUrl || templateRuntimeBaseUrl || '').trim() || null;
    runtimeProfile.workspacePath = String(result.workspacePath || paths.workspacePath).trim();
    runtimeProfile.agentDir = String(result.agentDir || paths.agentDir).trim();
    runtimeProfile.provisionStatus = 'ready';
    runtimeProfile.provisionedAt = new Date().toISOString();
    runtimeProfile.provisionError = null;
    employee.runtimeProfile = runtimeProfile;
    employee.openclawProfile = runtimeProfile;
    this.store.addEvent('employee.runtime.provisioned', {
      employeeId: employee.id,
      agentId: runtimeProfile.agentId,
      runtimeBaseUrl: runtimeProfile.runtimeBaseUrl,
      workspacePath: runtimeProfile.workspacePath,
      agentDir: runtimeProfile.agentDir
    });
    return employee;
  }

  async provisionRuntime(employeeId, actorId = 'system', accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    await this.applyRuntimeProvisioning(employee, {
      tenantId: employee.tenantId,
      accountId: employee.accountId,
      actorUserId: employee.actorUserId || null
    });
    employee.updatedAt = new Date().toISOString();
    this.store.addEvent('employee.runtime.reprovisioned', {
      employeeId: employee.id,
      actorId: String(actorId || 'system'),
      agentId: String((((employee || {}).runtimeProfile || {}).agentId) || '')
    });
    return employee;
  }

  listRuntimeFiles(employeeId, accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const workspacePath = this.ensureWorkspacePath(runtimeProfile);
    if (this.provisioningGateway && typeof this.provisioningGateway.listEmployeeRuntimeFilesSync === 'function') {
      const listed = this.provisioningGateway.listEmployeeRuntimeFilesSync({
        employeeId: employee.id,
        workspacePath,
        managedFiles: this.runtimeManagedFiles.slice()
      }) || {};
      return {
        employeeId: employee.id,
        agentId: String(runtimeProfile.agentId || '').trim() || null,
        workspacePath,
        files: Array.isArray(listed.files) ? listed.files : []
      };
    }
    const files = this.runtimeManagedFiles.map((name) => {
      const filePath = path.join(workspacePath, name);
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {}
      return {
        name,
        path: filePath,
        exists: Boolean(stat),
        size: stat ? Number(stat.size || 0) : 0,
        updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : null
      };
    });
    return {
      employeeId: employee.id,
      agentId: String(runtimeProfile.agentId || '').trim() || null,
      workspacePath,
      files
    };
  }

  getRuntimeFile(employeeId, fileName, accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const workspacePath = this.ensureWorkspacePath(runtimeProfile);
    const canonicalName = this.resolveRuntimeManagedFileName(fileName);
    if (this.provisioningGateway && typeof this.provisioningGateway.readEmployeeRuntimeFileSync === 'function') {
      return this.provisioningGateway.readEmployeeRuntimeFileSync({
        employeeId: employee.id,
        workspacePath,
        fileName: canonicalName
      });
    }
    const resolved = this.resolveRuntimeFilePath(workspacePath, canonicalName);
    const content = fs.readFileSync(resolved.target, 'utf8');
    const stat = fs.statSync(resolved.target);
    return {
      employeeId: employee.id,
      name: canonicalName,
      path: resolved.target,
      content,
      size: Number(stat.size || 0),
      updatedAt: new Date(stat.mtimeMs).toISOString()
    };
  }

  updateRuntimeFile(employeeId, fileName, content, actorId = 'system', accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const workspacePath = this.ensureWorkspacePath(runtimeProfile);
    const canonicalName = this.resolveRuntimeManagedFileName(fileName);
    const nextContent = String(content || '').replace(/\r\n/g, '\n').slice(0, 200000);
    let updated;
    if (this.provisioningGateway && typeof this.provisioningGateway.writeEmployeeRuntimeFileSync === 'function') {
      updated = this.provisioningGateway.writeEmployeeRuntimeFileSync({
        employeeId: employee.id,
        workspacePath,
        fileName: canonicalName,
        content: nextContent
      });
    } else {
      const resolved = this.resolveRuntimeFilePath(workspacePath, canonicalName);
      fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
      fs.writeFileSync(resolved.target, nextContent, 'utf8');
      const stat = fs.statSync(resolved.target);
      updated = {
        employeeId: employee.id,
        name: canonicalName,
        path: resolved.target,
        content: nextContent,
        size: Number(stat.size || 0),
        updatedAt: new Date(stat.mtimeMs).toISOString()
      };
    }
    employee.updatedAt = new Date().toISOString();
    this.store.addEvent('employee.runtime.file.updated', {
      employeeId: employee.id,
      actorId: String(actorId || 'system'),
      fileName: canonicalName,
      size: Number((updated && updated.size) || nextContent.length || 0)
    });
    return updated;
  }

  updateJobPolicy(employeeId, policyInput = {}, actorId = 'system', accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    employee.jobPolicy = normalizeJobPolicy(policyInput);
    employee.updatedAt = new Date().toISOString();
    this.store.addEvent('employee.policy.updated', {
      employeeId: employee.id,
      actorId: String(actorId || 'system'),
      allowCount: employee.jobPolicy.allow.length,
      denyCount: employee.jobPolicy.deny.length,
      kpiCount: employee.jobPolicy.kpi.length
    });
    return employee;
  }

  updateApprovalPolicy(employeeId, policyInput = {}, actorId = 'system', accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    employee.approvalPolicy = normalizeApprovalPolicy(policyInput);
    employee.updatedAt = new Date().toISOString();
    this.store.addEvent('employee.approval_policy.updated', {
      employeeId: employee.id,
      actorId: String(actorId || 'system')
    });
    return employee;
  }

  updateProfile(employeeId, profileInput = {}, actorId = 'system', accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    const input = profileInput && typeof profileInput === 'object' ? profileInput : {};
    const next = {};
    const currentRuntimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const immutableFields = ['employeeCode', 'email', 'creator', 'capabilities', 'knowledge', 'childAgents', 'linkedSkillIds'];
    for (const field of immutableFields) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        throw new Error(`${field} is immutable`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('name is required');
      next.name = name.slice(0, 80);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'department')) {
      const department = String(input.department || '').trim();
      if (!department) throw new Error('department is required');
      next.department = department.slice(0, 80);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'role')) {
      const role = String(input.role || '').trim();
      if (!role) throw new Error('role is required');
      next.role = role.slice(0, 80);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'riskLevel')) {
      const riskLevel = String(input.riskLevel || '').trim().toUpperCase();
      if (!['L1', 'L2', 'L3', 'L4'].includes(riskLevel)) throw new Error('riskLevel must be one of L1/L2/L3/L4');
      next.riskLevel = riskLevel;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'status')) {
      const status = String(input.status || '').trim().toLowerCase();
      if (!['active', 'paused', 'inactive'].includes(status)) throw new Error('status must be one of active/paused/inactive');
      next.status = status;
    }
    if (
      Object.prototype.hasOwnProperty.call(input, 'runtimeProfile')
      || Object.prototype.hasOwnProperty.call(input, 'openclawProfile')
      || Object.prototype.hasOwnProperty.call(input, 'openclaw')
    ) {
      const rawRuntimeProfile = input.runtimeProfile || input.openclawProfile || input.openclaw || {};
      const normalizedRuntimeProfile = normalizeRuntimeProfile(rawRuntimeProfile);
      const nextRuntimeProfile = { ...currentRuntimeProfile };
      const hasAgentIdInput = Object.prototype.hasOwnProperty.call(rawRuntimeProfile, 'agentId');

      if (hasAgentIdInput) {
        const currentAgentId = currentRuntimeProfile.agentId || null;
        const requestedAgentId = normalizedRuntimeProfile.agentId || null;
        if (currentAgentId && requestedAgentId !== currentAgentId) {
          throw new Error('openclawProfile.agentId is immutable');
        }
        nextRuntimeProfile.agentId = requestedAgentId;
      }

      if (Object.prototype.hasOwnProperty.call(rawRuntimeProfile, 'systemPrompt')) {
        nextRuntimeProfile.systemPrompt = normalizedRuntimeProfile.systemPrompt;
      }
      if (Object.prototype.hasOwnProperty.call(rawRuntimeProfile, 'toolScope')) {
        nextRuntimeProfile.toolScope = normalizedRuntimeProfile.toolScope;
      }
      if (Object.prototype.hasOwnProperty.call(rawRuntimeProfile, 'sessionKey')) {
        nextRuntimeProfile.sessionKey = normalizedRuntimeProfile.sessionKey;
      }
      if (Object.prototype.hasOwnProperty.call(rawRuntimeProfile, 'runtimeBaseUrl')) {
        nextRuntimeProfile.runtimeBaseUrl = normalizedRuntimeProfile.runtimeBaseUrl;
      }
      next.runtimeProfile = nextRuntimeProfile;
      next.openclawProfile = nextRuntimeProfile;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'retrievalPolicy')) {
      next.retrievalPolicy = normalizeRetrievalPolicy(input.retrievalPolicy);
    }

    Object.assign(employee, next);
    employee.updatedAt = new Date().toISOString();
    this.store.addEvent('employee.profile.updated', {
      employeeId: employee.id,
      actorId: String(actorId || 'system'),
      updatedFields: Object.keys(next)
    });
    return employee;
  }

  normalizeBatchFilters(filters = {}) {
    const src = filters && typeof filters === 'object' ? filters : {};
    const employeeIds = Array.isArray(src.employeeIds)
      ? src.employeeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    return {
      department: String(src.department || '').trim(),
      role: String(src.role || '').trim(),
      status: String(src.status || '').trim().toLowerCase(),
      employeeIds
    };
  }

  selectEmployeesByFilters(filters = {}, accessContext = null) {
    const normalized = this.normalizeBatchFilters(filters);
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    return this.store.employees.filter((employee) => {
      if (ctx && !matchAccessScope(employee, ctx)) return false;
      if (ctx && !matchActorScope(employee, ctx, { strict: true })) return false;
      if (normalized.employeeIds.length > 0 && !normalized.employeeIds.includes(String(employee.id || '').trim())) return false;
      if (normalized.department && String(employee.department || '') !== normalized.department) return false;
      if (normalized.role && String(employee.role || '') !== normalized.role) return false;
      if (normalized.status && String(employee.status || '').toLowerCase() !== normalized.status) return false;
      return true;
    });
  }

  rolloutRetrievalPolicy(input = {}, actorId = 'system', accessContext = null) {
    const mode = String(input.mode || '').trim().toLowerCase();
    if (!['auto', 'busy', 'idle'].includes(mode)) {
      throw new Error('rollout mode must be one of auto|busy|idle');
    }
    const filters = this.normalizeBatchFilters(input.filters || {});
    const targets = this.selectEmployeesByFilters(filters, accessContext);
    const now = new Date().toISOString();
    for (const employee of targets) {
      employee.retrievalPolicy = normalizeRetrievalPolicy({ mode });
      employee.updatedAt = now;
    }
    const actor = String(actorId || 'system');
    this.store.addEvent('employee.retrieval_policy.rollout', {
      actorId: actor,
      mode,
      filters,
      matchedCount: targets.length,
      employeeIds: targets.map((employee) => employee.id)
    });
    return {
      mode,
      filters,
      matchedCount: targets.length,
      employeeIds: targets.map((employee) => employee.id),
      updatedAt: now,
      updatedBy: actor
    };
  }

  rollbackRetrievalPolicy(input = {}, actorId = 'system', accessContext = null) {
    const filters = this.normalizeBatchFilters(input.filters || {});
    const reason = String(input.reason || 'manual retrieval policy rollback').trim() || 'manual retrieval policy rollback';
    const targets = this.selectEmployeesByFilters(filters, accessContext);
    const now = new Date().toISOString();
    for (const employee of targets) {
      employee.retrievalPolicy = normalizeRetrievalPolicy({ mode: 'inherit' });
      employee.updatedAt = now;
    }
    const actor = String(actorId || 'system');
    this.store.addEvent('employee.retrieval_policy.rollback', {
      actorId: actor,
      reason,
      filters,
      matchedCount: targets.length,
      employeeIds: targets.map((employee) => employee.id)
    });
    return {
      mode: 'inherit',
      reason,
      filters,
      matchedCount: targets.length,
      employeeIds: targets.map((employee) => employee.id),
      updatedAt: now,
      updatedBy: actor
    };
  }

  formatRuleList(items = [], fallback = '未配置') {
    const list = Array.isArray(items) ? items.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (!list.length) return [`- ${fallback}`];
    return list.map((item) => `- ${item}`);
  }

  formatApprovalRules(approvalPolicy = {}) {
    const byRisk = approvalPolicy && approvalPolicy.byRisk && typeof approvalPolicy.byRisk === 'object'
      ? approvalPolicy.byRisk
      : {};
    return ['L1', 'L2', 'L3', 'L4'].map((level) => {
      const config = byRisk[level] && typeof byRisk[level] === 'object' ? byRisk[level] : {};
      const requiredApprovals = Math.max(0, Number(config.requiredApprovals || 0));
      if (requiredApprovals === 0) {
        return `- ${level}: 自动放行（无需人工审批）`;
      }
      const roles = Array.isArray(config.requiredAnyRoles) && config.requiredAnyRoles.length
        ? config.requiredAnyRoles.join(', ')
        : '未限定角色';
      const distinct = Boolean(config.distinctRoles) ? '审批角色必须互异' : '审批角色可重复';
      return `- ${level}: 需 ${requiredApprovals} 人审批；可审批角色：${roles}；${distinct}`;
    });
  }

  buildOptimizedPolicyPrompt(input = {}) {
    const employee = input.employee && typeof input.employee === 'object' ? input.employee : {};
    const jobPolicy = input.jobPolicy && typeof input.jobPolicy === 'object' ? input.jobPolicy : {};
    const approvalPolicy = input.approvalPolicy && typeof input.approvalPolicy === 'object' ? input.approvalPolicy : {};
    const runtimeProfile = input.runtimeProfile && typeof input.runtimeProfile === 'object' ? input.runtimeProfile : {};
    const narrative = String(input.narrative || '').trim();

    const employeeName = String(employee.name || '数字员工').trim();
    const department = String(employee.department || '未命名部门').trim();
    const role = String(employee.role || '执行岗位').trim();
    const riskLevel = String(employee.riskLevel || 'L2').trim().toUpperCase();
    const maxRiskLevel = String(jobPolicy.maxRiskLevel || '').trim().toUpperCase() || '未设置';
    const strictAllow = Boolean(jobPolicy.strictAllow) ? '开启（未命中职责范围将拒绝）' : '关闭（职责范围用于指导）';
    const escalationRule = String(jobPolicy.escalationRule || '').trim() || '未配置';
    const shutdownRule = String(jobPolicy.shutdownRule || '').trim() || '未配置';
    const baselinePrompt = String(runtimeProfile.systemPrompt || '').trim();

    const sections = [
      `你是 ${employeeName}，隶属 ${department}，岗位是 ${role}。`,
      `默认风险等级：${riskLevel}。若任务风险高于岗位上限，必须拒绝执行。`,
      '',
      '【执行边界（必须遵守）】',
      `- 岗位风险上限：${maxRiskLevel}`,
      `- 严格职责模式：${strictAllow}`,
      '- 职责范围（Allow）：',
      ...this.formatRuleList(jobPolicy.allow, '未配置（按上级指令并结合岗位常识执行）'),
      '- 禁止边界（Deny）：',
      ...this.formatRuleList(jobPolicy.deny, '未配置（仍需遵守合规与最小权限原则）'),
      '',
      '【结果标准】',
      '- KPI 目标：',
      ...this.formatRuleList(jobPolicy.kpi, '未配置（默认输出可执行结果+证据）'),
      '',
      '【审批与风险控制】',
      ...this.formatApprovalRules(approvalPolicy),
      '',
      '【异常处置】',
      `- 升级规则：${escalationRule}`,
      `- 停机规则：${shutdownRule}`,
      '',
      '【输出规范】',
      '- 回答必须包含：关键结论、执行依据、风险点、下一步动作。',
      '- 未取得外部系统成功回执时，不得声称“已完成外部动作”。',
      '- 当规则冲突时，优先级：禁止边界 > 审批规则 > 职责范围 > 结果优化。',
      ''
    ];
    if (narrative) {
      sections.push('【管理员补充说明（自然语言）】');
      sections.push(`- ${narrative.slice(0, 1200)}`);
      sections.push('');
    }
    if (baselinePrompt) {
      sections.push('【原始系统提示（参考）】');
      sections.push(baselinePrompt.slice(0, 2000));
      sections.push('');
    }
    return sections.join('\n').trim();
  }

  appendToRuntimeFile(employeeId, fileName, appendContent, actorId = 'system') {
    const employee = this.store.employees.find((e) => e.id === employeeId);
    if (!employee) return null;
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const workspacePath = String(runtimeProfile.workspacePath || '').trim();
    if (!workspacePath) return null;
    const resolvedWorkspace = path.resolve(workspacePath);
    const canonicalName = String(fileName || '').trim();
    if (!canonicalName) return null;
    const target = path.resolve(resolvedWorkspace, canonicalName);
    if (!target.startsWith(resolvedWorkspace)) return null;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let existing = '';
      try { existing = fs.readFileSync(target, 'utf8'); } catch {}
      const next = existing + String(appendContent || '');
      fs.writeFileSync(target, next.slice(0, 200000), 'utf8');
      this.store.addEvent('employee.runtime.file.appended', {
        employeeId: employee.id,
        actorId: String(actorId || 'system'),
        fileName: canonicalName
      });
      return { employeeId: employee.id, name: canonicalName, path: target };
    } catch {
      return null;
    }
  }

  appendToDailyMemory(employeeId, entry, actorId = 'system') {
    const employee = this.store.employees.find((e) => e.id === employeeId);
    if (!employee) return null;
    const runtimeProfile = normalizeRuntimeProfile(employee.runtimeProfile || employee.openclawProfile || {});
    const workspacePath = String(runtimeProfile.workspacePath || '').trim();
    if (!workspacePath) return null;
    const resolvedWorkspace = path.resolve(workspacePath);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19);
    const memoryDir = path.resolve(resolvedWorkspace, 'memory');
    const target = path.resolve(memoryDir, `${dateStr}.md`);
    if (!target.startsWith(resolvedWorkspace)) return null;
    try {
      fs.mkdirSync(memoryDir, { recursive: true });
      let existing = '';
      try { existing = fs.readFileSync(target, 'utf8'); } catch {}
      if (!existing.trim()) {
        existing = `# ${dateStr} 对话记忆\n\n`;
      }
      const status = String((entry && entry.status) || 'unknown');
      const statusIcon = status === 'succeeded' ? '✓' : status === 'failed' ? '✗' : '○';
      const role = String((entry && entry.role) || '').trim();
      const content = String((entry && entry.content) || '').trim().slice(0, 200);
      const result = String((entry && entry.result) || '').trim().slice(0, 300);
      let line = `\n### [${timeStr}] ${statusIcon} 任务\n`;
      if (role && content) line += `- **用户指令**: ${content}\n`;
      if (result) line += `- **执行结果**: ${result}\n`;
      line += `- **状态**: ${status}\n`;
      const next = existing + line;
      fs.writeFileSync(target, next.slice(0, 200000), 'utf8');
      this.store.addEvent('employee.daily_memory.appended', {
        employeeId: employee.id,
        actorId: String(actorId || 'system'),
        date: dateStr,
        status
      });
      return { employeeId: employee.id, date: dateStr, path: target };
    } catch {
      return null;
    }
  }

  optimizePolicyForLlm(employeeId, input = {}, actorId = 'system', accessContext = null) {
    const employee = this.getById(employeeId, accessContext);
    const body = input && typeof input === 'object' ? input : {};
    const jobPolicy = normalizeJobPolicy(body.jobPolicy || employee.jobPolicy || {});
    const approvalPolicy = normalizeApprovalPolicy(body.approvalPolicy || employee.approvalPolicy || {});
    const runtimeProfile = normalizeRuntimeProfile(body.runtimeProfile || employee.runtimeProfile || employee.openclawProfile || {});
    const narrative = String(body.narrative || body.description || '').trim().slice(0, 1200);
    const optimizedPrompt = this.buildOptimizedPolicyPrompt({
      employee,
      jobPolicy,
      approvalPolicy,
      runtimeProfile,
      narrative
    });
    const generatedAt = new Date().toISOString();
    this.store.addEvent('employee.policy.optimized', {
      employeeId: employee.id,
      actorId: String(actorId || 'system'),
      source: 'rule-based',
      generatedAt,
      narrativeProvided: Boolean(narrative)
    });
    return {
      employeeId: employee.id,
      optimizedPrompt,
      source: 'rule-based',
      generatedAt
    };
  }
}

module.exports = { EmployeeUseCases };
