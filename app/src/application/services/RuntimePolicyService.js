class RuntimePolicyService {
  constructor(options = {}) {
    this.allowedTools = this.parseToolList(
      options.allowedTools ?? 'bash,read,write,search,test,browser,cron,nodes,canvas,gateway,discord,slack,telegram,whatsapp'
    );
    this.deniedTools = this.parseToolList(options.deniedTools ?? '');
    this.defaultToolScope = this.parseToolList(
      options.defaultToolScope ?? 'bash,read,write,search,test,browser,cron,nodes,canvas,gateway,discord,slack,telegram,whatsapp'
    );
    this.allowedHosts = this.parseHostList(options.allowedHosts ?? '*');
    this.requireAuth = this.parseBoolean(options.requireAuth ?? true);
    this.enforcePolicyForL4 = this.parseBoolean(options.enforcePolicyForL4 ?? true);
  }

  parseToolList(raw) {
    return Array.from(new Set(
      String(raw || '')
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    ));
  }

  parseHostList(raw) {
    return Array.from(new Set(
      String(raw || '')
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    ));
  }

  parseBoolean(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) return false;
    return !['0', 'false', 'off', 'no'].includes(value);
  }

  resolveToolScope(incoming = []) {
    const seed = Array.isArray(incoming) && incoming.length > 0 ? incoming : this.defaultToolScope;
    const normalized = Array.from(new Set(seed
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)));
    const allowed = this.allowedTools.length > 0
      ? normalized.filter((item) => this.allowedTools.includes(item))
      : normalized;
    const denied = this.deniedTools.length > 0
      ? allowed.filter((item) => !this.deniedTools.includes(item))
      : allowed;
    return denied.slice(0, 20);
  }

  validateNetworkIsolation(baseUrl) {
    if (!baseUrl) return;
    try {
      const parsed = new URL(baseUrl);
      const host = String(parsed.hostname || '').trim().toLowerCase();
      if (this.allowedHosts.length > 0 && !this.allowedHosts.includes('*') && !this.allowedHosts.includes(host)) {
        throw new Error(`openclaw host is not allowed: ${host}`);
      }
    } catch (error) {
      throw new Error(`invalid OPENCLAW_BASE_URL: ${error.message}`);
    }
  }

  enforceSecurityPolicy(task = {}, command = {}, context = {}) {
    this.validateNetworkIsolation(context.baseUrl || '');
    if (this.requireAuth) {
      const apiKey = String(context.apiKey || '').trim();
      const gatewayToken = String(context.gatewayToken || '').trim();
      if (!apiKey && !gatewayToken) {
        throw new Error('OpenClaw auth is required');
      }
    }
    const riskLevel = String(task.riskLevel || '').trim().toUpperCase();
    const policyId = String(command.policyId || '').trim();
    if (this.enforcePolicyForL4 && riskLevel === 'L4' && !policyId) {
      throw new Error('L4 task requires openclaw policyId');
    }
    return { task, command, context };
  }
}

module.exports = { RuntimePolicyService };
