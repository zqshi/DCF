const DEFAULT_MCP_SERVICES = [
  {
    id: 'mcp-openclaw-runtime',
    name: 'OpenClaw Runtime',
    transport: 'http',
    endpoint: 'http://127.0.0.1:8092/mcp',
    description: '默认运行时 MCP 服务入口',
    enabled: true
  },
  {
    id: 'mcp-enterprise-bridge',
    name: 'Enterprise Bridge',
    transport: 'http',
    endpoint: 'https://example.enterprise.local/mcp',
    description: '企业系统桥接 MCP 服务（占位）',
    enabled: false
  }
];

const TOOL_REGISTRATION_STATUSES = new Set(['pending', 'approved', 'rejected', 'rollback']);
const TOOL_STATUS_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['rollback'],
  rejected: ['pending'],
  rollback: ['pending']
};
const TOOL_STATUS_ROLE_POLICY = {
  pending: ['skill_admin', 'super_admin'],
  approved: ['skill_admin', 'super_admin'],
  rejected: ['skill_admin', 'super_admin'],
  rollback: ['super_admin']
};

function normalizeService(input = {}, now = new Date().toISOString()) {
  const registrationStatus = String(input.registrationStatus || 'approved').trim().toLowerCase();
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim(),
    transport: String(input.transport || 'http').trim() || 'http',
    endpoint: String(input.endpoint || '').trim(),
    description: String(input.description || '').trim(),
    enabled: Boolean(input.enabled),
    registrationStatus: TOOL_REGISTRATION_STATUSES.has(registrationStatus) ? registrationStatus : 'pending',
    registrationSource: String(input.registrationSource || 'internal').trim() || 'internal',
    registrant: String(input.registrant || '').trim() || null,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    updatedBy: input.updatedBy || 'system'
  };
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

class ToolUseCases {
  constructor(store, options = {}) {
    this.store = store;
    this.healthGateway = options.healthGateway || null;
    if (!Array.isArray(this.store.mcpServices)) this.store.mcpServices = [];
    if (!this.store.mcpServices.length) {
      const now = new Date().toISOString();
      this.store.mcpServices = DEFAULT_MCP_SERVICES.map((x) => normalizeService(x, now));
    }
  }

  listMcpServices() {
    return this.store.mcpServices.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  listPendingMcpServices() {
    return this.listMcpServices().filter((x) => String(x.registrationStatus || '') === 'pending');
  }

  listToolEvents(limit = 50) {
    const n = Math.max(1, Math.min(200, Number(limit || 50)));
    return (this.store.events || [])
      .filter((x) => String(x.type || '').startsWith('admin.tools.mcp.'))
      .slice(0, n);
  }

  createMcpService(input = {}, options = {}) {
    const now = new Date().toISOString();
    const actor = String(options.actor || 'system');
    const baseId = slugify(input.id || input.name || '');
    const id = baseId || `mcp-service-${Date.now()}`;
    if (this.store.mcpServices.some((x) => x.id === id)) {
      throw new Error('mcp service id already exists');
    }
    const service = normalizeService({
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor
    }, now);
    if (!service.name) throw new Error('name is required');
    if (!service.endpoint) throw new Error('endpoint is required');
    this.store.mcpServices.push(service);
    return service;
  }

  updateMcpService(serviceId, input = {}, options = {}) {
    const id = String(serviceId || '').trim();
    if (!id) throw new Error('serviceId is required');
    const idx = this.store.mcpServices.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('mcp service not found');

    const current = this.store.mcpServices[idx];
    const now = new Date().toISOString();
    const actor = String(options.actor || 'system');
    const next = {
      ...current,
      name: Object.prototype.hasOwnProperty.call(input, 'name') ? String(input.name || '').trim() : current.name,
      transport: Object.prototype.hasOwnProperty.call(input, 'transport') ? String(input.transport || '').trim() : current.transport,
      endpoint: Object.prototype.hasOwnProperty.call(input, 'endpoint') ? String(input.endpoint || '').trim() : current.endpoint,
      description: Object.prototype.hasOwnProperty.call(input, 'description') ? String(input.description || '').trim() : current.description,
      enabled: Object.prototype.hasOwnProperty.call(input, 'enabled') ? Boolean(input.enabled) : current.enabled,
      updatedAt: now,
      updatedBy: actor
    };

    if (!next.name) throw new Error('name is required');
    if (!next.endpoint) throw new Error('endpoint is required');

    this.store.mcpServices[idx] = next;
    return next;
  }

  deleteMcpService(serviceId) {
    const id = String(serviceId || '').trim();
    if (!id) throw new Error('serviceId is required');
    const idx = this.store.mcpServices.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('mcp service not found');
    const removed = this.store.mcpServices[idx];
    this.store.mcpServices.splice(idx, 1);
    return removed;
  }

  async checkMcpServiceHealth(serviceId, options = {}) {
    const id = String(serviceId || '').trim();
    if (!id) throw new Error('serviceId is required');
    const idx = this.store.mcpServices.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('mcp service not found');

    const service = this.store.mcpServices[idx];
    let endpoint;
    try {
      endpoint = new URL(service.endpoint);
    } catch {
      const now = new Date().toISOString();
      const health = {
        status: 'invalid_endpoint',
        checkedAt: now,
        latencyMs: 0,
        httpStatus: null,
        error: 'invalid endpoint url'
      };
      this.store.mcpServices[idx] = { ...service, health };
      return this.store.mcpServices[idx];
    }

    if (!this.healthGateway || typeof this.healthGateway.check !== 'function') {
      throw new Error('mcp service health gateway is unavailable');
    }
    const health = await this.healthGateway.check(endpoint.toString(), options);

    const next = { ...service, health };
    this.store.mcpServices[idx] = next;
    return next;
  }

  changeMcpServiceRegistrationStatus(serviceId, targetStatus, options = {}) {
    const id = String(serviceId || '').trim();
    if (!id) throw new Error('serviceId is required');
    const status = String(targetStatus || '').trim().toLowerCase();
    if (!TOOL_REGISTRATION_STATUSES.has(status)) throw new Error(`unsupported registration status: ${status}`);
    const idx = this.store.mcpServices.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('mcp service not found');

    const role = String(options.role || '').trim();
    const allowedRoles = TOOL_STATUS_ROLE_POLICY[status] || [];
    if (!allowedRoles.includes(role)) {
      const error = new Error(`role is not allowed for tool status transition: ${role} -> ${status}`);
      error.statusCode = 403;
      throw error;
    }

    const current = this.store.mcpServices[idx];
    const fromStatus = String(current.registrationStatus || 'pending');
    const nextSet = TOOL_STATUS_TRANSITIONS[fromStatus] || [];
    if (!nextSet.includes(status)) {
      throw new Error(`invalid tool status transition: ${fromStatus} -> ${status}`);
    }

    const actor = String(options.actor || 'system');
    const now = new Date().toISOString();
    const next = {
      ...current,
      registrationStatus: status,
      updatedAt: now,
      updatedBy: actor
    };
    this.store.mcpServices[idx] = next;
    return {
      service: next,
      fromStatus,
      toStatus: status
    };
  }
}

module.exports = {
  ToolUseCases
};
