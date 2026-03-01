class RuntimeShadowPolicyService {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.allowTenants = this.parseList(options.allowTenants);
    this.allowRoles = this.parseList(options.allowRoles);
  }

  parseList(raw) {
    return Array.from(new Set(
      String(raw || '')
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    ));
  }

  matchesRule(value, rules) {
    if (!Array.isArray(rules) || rules.length === 0) return true;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    if (rules.includes('*')) return true;
    return rules.includes(normalized);
  }

  shouldCompare(task = {}, employee = {}) {
    if (!this.enabled) {
      return { ok: false, reason: 'shadow_disabled' };
    }
    const tenantId = String(task.tenantId || employee.tenantId || '').trim().toLowerCase();
    const role = String(employee.role || '').trim().toLowerCase();
    if (!this.matchesRule(tenantId, this.allowTenants)) {
      return { ok: false, reason: 'tenant_not_allowed', tenantId };
    }
    if (!this.matchesRule(role, this.allowRoles)) {
      return { ok: false, reason: 'role_not_allowed', role };
    }
    return { ok: true };
  }
}

module.exports = { RuntimeShadowPolicyService };

