const { RUNTIME_EVENT_SOURCES_SET } = require('../constants');
const RUNTIME_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'aborted']);
const RUNTIME_EVENT_SOURCES = RUNTIME_EVENT_SOURCES_SET;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  return String(value || '').trim();
}

function normalizeRuntimeEventSource(input) {
  const source = asString(input).toLowerCase();
  if (source === 'skills_runtime') return 'skills-runtime';
  if (source === 'self_hosted') return 'self-hosted';
  return source;
}

function validateRuntimeSubmit(payload, options = {}) {
  const strict = options.strict !== false;
  const data = isObject(payload) ? payload : {};
  const goal = asString(data.goal);
  if (!goal) throw new Error('task.goal is required');
  const riskLevel = asString(data.riskLevel || 'L2').toUpperCase();
  if (!/^L[1-4]$/.test(riskLevel)) throw new Error('riskLevel must match L1-L4');
  if (Object.prototype.hasOwnProperty.call(data, 'toolScope')) {
    if (!Array.isArray(data.toolScope)) throw new Error('toolScope must be array');
    if (data.toolScope.length > 20) throw new Error('toolScope max length is 20');
    for (const item of data.toolScope) {
      if (!asString(item)) throw new Error('toolScope item must be non-empty string');
    }
  }
  if (strict && Object.prototype.hasOwnProperty.call(data, 'taskId') && !asString(data.taskId)) {
    throw new Error('taskId must be non-empty string');
  }
  return true;
}

function normalizeRuntimeStatus(payload, runtimeTaskId = '') {
  const data = isObject(payload) ? payload : {};
  return {
    taskId: asString(data.taskId) || asString(runtimeTaskId),
    status: asString(data.status || 'queued').toLowerCase(),
    iteration: Number.isInteger(data.iteration) && data.iteration > 0 ? data.iteration : 1,
    result: Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : null,
    lastError: Object.prototype.hasOwnProperty.call(data, 'lastError') ? data.lastError : null,
    updatedAt: asString(data.updatedAt) || new Date().toISOString()
  };
}

function validateRuntimeStatus(payload, options = {}) {
  const strict = options.strict === true;
  const data = normalizeRuntimeStatus(payload);
  if (!data.taskId) throw new Error('runtime status taskId is required');
  if (!RUNTIME_STATUSES.has(data.status)) throw new Error('runtime status is invalid');
  if (strict) {
    if (!Number.isInteger(data.iteration) || data.iteration < 1) throw new Error('runtime status iteration is invalid');
    if (!asString(data.updatedAt)) throw new Error('runtime status updatedAt is required');
  }
  return true;
}

function normalizeRuntimeEvent(payload, runtimeTaskId = '') {
  const data = isObject(payload) ? payload : {};
  const source = normalizeRuntimeEventSource(data.source || 'openclaw');
  return {
    id: asString(data.id) || `${asString(runtimeTaskId)}-${Date.now()}-${Math.random()}`,
    type: asString(data.type || 'runtime.event'),
    taskId: asString(data.taskId) || asString(runtimeTaskId),
    payload: isObject(data.payload) ? data.payload : {},
    at: asString(data.at) || new Date().toISOString(),
    source: RUNTIME_EVENT_SOURCES.has(source) ? source : 'openclaw'
  };
}

function validateRuntimeEvent(payload, options = {}) {
  const strict = options.strict === true;
  const rawType = isObject(payload) ? asString(payload.type) : '';
  const rawTaskId = isObject(payload) ? asString(payload.taskId) : '';
  const data = normalizeRuntimeEvent(payload);
  if (!data.type) throw new Error('runtime event type is required');
  if (!data.taskId) throw new Error('runtime event taskId is required');
  if (strict) {
    if (!rawType) throw new Error('runtime event type is required');
    if (!rawTaskId) throw new Error('runtime event taskId is required');
    if (!data.id) throw new Error('runtime event id is required');
    if (!data.at) throw new Error('runtime event at is required');
  }
  return true;
}

module.exports = {
  RUNTIME_STATUSES,
  validateRuntimeSubmit,
  validateRuntimeStatus,
  validateRuntimeEvent,
  normalizeRuntimeStatus,
  normalizeRuntimeEvent
};
