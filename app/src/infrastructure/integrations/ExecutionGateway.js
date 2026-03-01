const { OpenClawGateway } = require('./OpenClawGateway');
const { SelfHostedGateway } = require('./SelfHostedGateway');
const { SkillsRuntimeGateway } = require('./SkillsRuntimeGateway');

class ExecutionGateway {
  constructor(options = {}) {
    this.engine = this.normalizeEngine(options.engine || process.env.EXECUTION_ENGINE || 'openclaw');
    this.openclawRuntime = options.openclawRuntime || new OpenClawGateway(options.openclaw || {});
    this.selfHostedRuntime = options.selfHostedRuntime || new SelfHostedGateway(options.selfHosted || {});
    this.skillsRuntime = options.skillsRuntime || new SkillsRuntimeGateway(options.skills || {});
  }

  normalizeEngine(input) {
    const engine = String(input || '').trim().toLowerCase();
    if (engine === 'openclaw') return 'openclaw';
    if (engine === 'self_hosted' || engine === 'self-hosted') return 'self_hosted';
    if (engine === 'skills_runtime' || engine === 'skills-runtime') return 'skills_runtime';
    return 'auto';
  }

  canUse(runtime) {
    return Boolean(runtime && typeof runtime.isEnabled === 'function' && runtime.isEnabled());
  }

  runtimeForEngine(engine) {
    const normalized = this.normalizeEngine(engine);
    if (normalized === 'openclaw') return this.canUse(this.openclawRuntime) ? this.openclawRuntime : null;
    if (normalized === 'self_hosted') {
      if (this.canUse(this.openclawRuntime)) return this.openclawRuntime;
      return this.canUse(this.selfHostedRuntime) ? this.selfHostedRuntime : null;
    }
    if (normalized === 'skills_runtime') {
      if (this.canUse(this.openclawRuntime)) return this.openclawRuntime;
      return this.canUse(this.skillsRuntime) ? this.skillsRuntime : null;
    }
    return null;
  }

  resolveRuntime() {
    if (this.engine === 'openclaw') return this.canUse(this.openclawRuntime) ? this.openclawRuntime : null;
    if (this.engine === 'self_hosted') return this.runtimeForEngine('self_hosted');
    if (this.engine === 'skills_runtime') return this.runtimeForEngine('skills_runtime');
    if (this.engine === 'auto') return this.canUse(this.openclawRuntime) ? this.openclawRuntime : null;
    return this.canUse(this.openclawRuntime) ? this.openclawRuntime : null;
  }

  isEnabled() {
    return Boolean(this.resolveRuntime());
  }

  providerLabel() {
    if (!this.isEnabled()) return 'runtime-unavailable';
    const runtime = this.resolveRuntime();
    if (runtime === this.skillsRuntime) return 'skills-runtime';
    if (runtime === this.selfHostedRuntime) return 'self-hosted-runtime';
    return 'managed-runtime';
  }

  async executeTask(task, employee, callbacks = {}) {
    const runtime = this.resolveRuntime();
    if (!runtime || typeof runtime.executeTask !== 'function') return null;
    return runtime.executeTask(task, employee, callbacks);
  }

  async executeTaskWithEngine(task, employee, engine, callbacks = {}) {
    const runtime = this.runtimeForEngine(engine);
    if (!runtime || typeof runtime.executeTask !== 'function') return null;
    return runtime.executeTask(task, employee, callbacks);
  }

  async abortTask(task, employee) {
    const runtime = this.resolveRuntime();
    if (!runtime || typeof runtime.abortTask !== 'function') {
      return {
        ok: false,
        statusCode: 503,
        code: 'RUNTIME_ABORT_UNSUPPORTED',
        message: 'runtime abort is unavailable'
      };
    }
    return runtime.abortTask(task, employee);
  }

  async listInstalledSkills(options = {}) {
    const runtime = this.resolveRuntime();
    if (!runtime) return { source: 'runtime-unavailable', enabled: false, items: [] };
    if (typeof runtime.listInstalledSkills !== 'function') {
      return { source: this.providerLabel(), enabled: true, items: [] };
    }
    return runtime.listInstalledSkills(options);
  }

  async runtimeSkillCommand(action, input = {}) {
    const runtime = this.resolveRuntime();
    if (!runtime) return { ok: false, enabled: false, error: 'runtime unavailable' };
    if (typeof runtime.runtimeSkillCommand !== 'function') {
      return { ok: false, enabled: true, error: 'runtime skill command not supported' };
    }
    return runtime.runtimeSkillCommand(action, input);
  }
}

module.exports = { ExecutionGateway };
