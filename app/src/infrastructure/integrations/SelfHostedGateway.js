const { createRuntimeAuditEvent } = require('../../shared/runtime/RuntimeAuditEventFactory');

class SelfHostedGateway {
  constructor(options = {}) {
    const envEnabled = String(process.env.SELF_HOSTED_RUNTIME_ENABLED || '0').trim();
    this.enabled = typeof options.enabled === 'boolean' ? options.enabled : envEnabled !== '0';
    this.latencyMs = Math.max(0, Number(options.latencyMs || process.env.SELF_HOSTED_RUNTIME_LATENCY_MS || 0));
  }

  isEnabled() {
    return this.enabled;
  }

  async sleep(ms) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  emitRuntimeEvent(runtimeEvents, taskId, type, payload, onRuntimeEvent) {
    const runtimeEvent = createRuntimeAuditEvent({
      taskId,
      type,
      source: 'self-hosted',
      payload
    });
    runtimeEvents.push(runtimeEvent);
    if (typeof onRuntimeEvent === 'function') onRuntimeEvent(runtimeEvent, taskId);
  }

  inferSkills(goal = '') {
    const text = String(goal || '').toLowerCase();
    if (text.includes('财务') || text.includes('invoice') || text.includes('finance')) {
      return [{ name: 'finance-task-handler', type: 'domain', domain: 'finance' }];
    }
    if (text.includes('hr') || text.includes('入职')) {
      return [{ name: 'hr-task-handler', type: 'domain', domain: 'hr' }];
    }
    return [{ name: 'general-ops', type: 'general' }];
  }

  inferDangerousGoal(goal = '') {
    const text = String(goal || '').toLowerCase();
    const blockedHints = ['删除生产数据库', 'drop database', 'truncate', '绕过审批', 'skip approval'];
    return blockedHints.some((item) => text.includes(item));
  }

  buildKnowledge(task, result) {
    return [{
      id: `${task.id}-self-hosted-kb`,
      title: `SelfHosted Delivery: ${String(task.goal || '').slice(0, 24)}`,
      summary: String(result || '').slice(0, 500),
      createdAt: new Date().toISOString()
    }];
  }

  async executeTask(task, employee, callbacks = {}) {
    if (!this.isEnabled()) return null;

    const runtimeTaskId = String((task && task.id) || `${Date.now()}-${Math.random()}`);
    const traceId = String((task && task.traceId) || runtimeTaskId);
    const runtimeEvents = [];
    const onRuntimeEvent = callbacks && typeof callbacks.onRuntimeEvent === 'function'
      ? callbacks.onRuntimeEvent
      : null;
    const runtimeConfig = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : (((task || {}).openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const toolScope = Array.isArray((runtimeConfig || {}).toolScope)
      ? runtimeConfig.toolScope.slice(0, 20)
      : [];
    const llmConfig = ((task || {}).llmConfig || {});

    this.emitRuntimeEvent(runtimeEvents, runtimeTaskId, 'task.running', {
      trace_id: traceId,
      employee_id: employee ? employee.id : null,
      employeeId: employee ? employee.id : null,
      employeeCode: employee ? employee.employeeCode : null,
      conversationId: (task && task.conversationId) || null
    }, onRuntimeEvent);
    this.emitRuntimeEvent(runtimeEvents, runtimeTaskId, 'task.plan.generated', {
      trace_id: traceId,
      employee_id: employee ? employee.id : null,
      model: llmConfig.model || null,
      thinkingLevel: llmConfig.thinkingLevel || 'medium',
      toolPolicy: llmConfig.toolPolicy || 'balanced'
    }, onRuntimeEvent);
    if (toolScope.length > 0) {
      this.emitRuntimeEvent(runtimeEvents, runtimeTaskId, 'task.tool.called', {
        trace_id: traceId,
        employee_id: employee ? employee.id : null,
        toolScope
      }, onRuntimeEvent);
    }
    await this.sleep(this.latencyMs);

    const blocked = this.inferDangerousGoal(task && task.goal);
    if (blocked && String((task && task.riskLevel) || '').toUpperCase() === 'L4') {
      const error = {
        severity: 'P1',
        message: 'Self-hosted runtime blocked dangerous high-risk operation.'
      };
      this.emitRuntimeEvent(runtimeEvents, runtimeTaskId, 'task.failed', {
        trace_id: traceId,
        employee_id: employee ? employee.id : null,
        severity: error.severity,
        message: error.message
      }, onRuntimeEvent);
      return {
        status: 'failed',
        result: null,
        error,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId,
        runtimeEvents,
        source: 'self-hosted'
      };
    }

    const result = null;
    this.emitRuntimeEvent(runtimeEvents, runtimeTaskId, 'task.succeeded', {
      trace_id: traceId,
      employee_id: employee ? employee.id : null,
      result
    }, onRuntimeEvent);

    return {
      status: 'succeeded',
      result,
      error: null,
      corrected: false,
      children: [],
      skills: this.inferSkills(task && task.goal),
      knowledge: this.buildKnowledge(task || { id: runtimeTaskId, goal: '' }, result),
      researchQuery: null,
      runtimeTaskId,
      runtimeEvents,
      source: 'self-hosted'
    };
  }
}

module.exports = { SelfHostedGateway };
