class McpServiceHealthGateway {
  async check(endpoint, options = {}) {
    const timeoutMs = Math.max(500, Math.min(10000, Number(options.timeoutMs || 2500)));
    const startAt = Date.now();
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json,text/plain,*/*' }
      });
      return {
        status: response.ok ? 'healthy' : 'degraded',
        checkedAt,
        latencyMs: Date.now() - startAt,
        httpStatus: Number(response.status || 0),
        error: ''
      };
    } catch (error) {
      const isAbort = String(error && error.name || '').toLowerCase() === 'aborterror';
      return {
        status: isAbort ? 'timeout' : 'unreachable',
        checkedAt,
        latencyMs: Date.now() - startAt,
        httpStatus: null,
        error: String(error && error.message ? error.message : 'request failed')
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { McpServiceHealthGateway };
