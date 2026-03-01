function nowIso() {
  return new Date().toISOString();
}

function createRuntimeAuditEvent(input = {}) {
  const taskId = String(input.taskId || '').trim() || `task-${Date.now()}`;
  const traceId = String(input.traceId || '').trim() || `trace-${taskId}`;
  const employeeId = String(input.employeeId || '').trim() || 'unknown';
  const timestamp = nowIso();
  const payload = input && input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? { ...input.payload }
    : {};
  payload.trace_id = traceId;
  payload.task_id = taskId;
  payload.employee_id = employeeId;
  payload.timestamp = timestamp;
  return {
    id: String(input.id || `${taskId}-${Date.now()}-${Math.random()}`),
    type: String(input.type || 'runtime.event'),
    taskId,
    payload,
    at: timestamp,
    source: String(input.source || 'openclaw')
  };
}

module.exports = { createRuntimeAuditEvent };

