class EnterpriseSystemGateway {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || process.env.ENTERPRISE_SYSTEM_BASE_URL || '').replace(/\/$/, '');
    this.compensationPath = options.compensationPath || process.env.ENTERPRISE_COMPENSATION_PATH || '/api/compensations';
    this.apiKey = options.apiKey || process.env.ENTERPRISE_SYSTEM_API_KEY || '';
    this.timeoutMs = Number(options.timeoutMs || process.env.ENTERPRISE_SYSTEM_TIMEOUT_MS || 8000);
  }

  isEnabled() {
    return Boolean(this.baseUrl);
  }

  async executeCompensation({ compensation, task, employee }) {
    if (!this.isEnabled()) {
      return {
        status: 'failed',
        error: { message: 'enterprise gateway is disabled' }
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${this.compensationPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          taskId: task.id,
          traceId: task.traceId,
          employeeId: employee ? employee.id : task.employeeId,
          action: compensation.action,
          idempotencyKey: compensation.idempotencyKey,
          source: {
            system: compensation.system,
            operation: compensation.operation
          }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          status: 'failed',
          error: { message: `enterprise compensation failed: ${response.status}` }
        };
      }
      const body = await response.json();
      return {
        status: 'succeeded',
        result: body
      };
    } catch (error) {
      return {
        status: 'failed',
        error: { message: error.message }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { EnterpriseSystemGateway };
