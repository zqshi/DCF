const { SkillRuntimeService } = require('../../application/services/SkillRuntimeService');
const { createRuntimeAuditEvent } = require('../../shared/runtime/RuntimeAuditEventFactory');

class SkillsRuntimeGateway {
  constructor(options = {}) {
    const envEnabled = String(process.env.SKILLS_RUNTIME_ENABLED || '').trim().toLowerCase();
    this.enabled = typeof options.enabled === 'boolean'
      ? options.enabled
      : (envEnabled === '1' || envEnabled === 'true' || envEnabled === 'yes');
    this.service = options.service || new SkillRuntimeService(options);
    this.getAvailableSkills = typeof options.getAvailableSkills === 'function'
      ? options.getAvailableSkills
      : (() => []);
  }

  isEnabled() {
    return this.enabled;
  }

  emit(runtimeEvents, taskId, employee, traceId, type, payload, onRuntimeEvent) {
    const runtimeEvent = createRuntimeAuditEvent({
      taskId,
      employeeId: employee && employee.id,
      traceId,
      source: 'skills-runtime',
      type,
      payload
    });
    runtimeEvents.push(runtimeEvent);
    if (typeof onRuntimeEvent === 'function') onRuntimeEvent(runtimeEvent, taskId);
  }

  async executeTask(task, employee, callbacks = {}) {
    if (!this.isEnabled()) return null;
    const runtimeEvents = [];
    const taskId = String((task && task.id) || `${Date.now()}-${Math.random()}`);
    const traceId = String((task && task.traceId) || taskId);
    const onRuntimeEvent = callbacks && typeof callbacks.onRuntimeEvent === 'function'
      ? callbacks.onRuntimeEvent
      : null;
    const availableSkills = this.getAvailableSkills(task, employee);
    const envelope = this.service.buildExecutionEnvelope(task, employee, availableSkills);
    this.emit(runtimeEvents, taskId, employee, traceId, 'task.running', {
      mode: 'skills-runtime-v1',
      selectedSkills: envelope.selectedSkills.map((x) => x.name)
    }, onRuntimeEvent);

    const result = null;

    this.emit(runtimeEvents, taskId, employee, traceId, 'task.succeeded', {
      result,
      selectedSkills: envelope.selectedSkills
    }, onRuntimeEvent);

    return {
      status: 'succeeded',
      result,
      error: null,
      corrected: false,
      children: [],
      skills: envelope.selectedSkills.map((x) => ({
        name: x.name,
        type: x.type,
        domain: x.domain,
        version: x.version
      })),
      knowledge: [],
      researchQuery: null,
      runtimeTaskId: taskId,
      runtimeEvents,
      source: 'skills-runtime'
    };
  }
}

module.exports = { SkillsRuntimeGateway };
