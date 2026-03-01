const { randomUUID, createHash } = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || '').trim();
}

class RuntimeTaskEntity {
  static create(input = {}) {
    const goal = normalizeString(input.goal);
    if (!goal) throw new Error('runtime task goal is required');
    const ts = nowIso();
    return {
      taskId: normalizeString(input.taskId) || randomUUID(),
      employeeId: normalizeString(input.employeeId) || null,
      conversationId: normalizeString(input.conversationId) || null,
      goal,
      riskLevel: normalizeString(input.riskLevel || 'L2').toUpperCase(),
      status: 'queued',
      iteration: 1,
      result: null,
      lastError: null,
      createdAt: ts,
      updatedAt: ts
    };
  }

  static buildIdempotencyKey(input = {}) {
    const payload = {
      taskId: normalizeString(input.taskId),
      employeeId: normalizeString(input.employeeId),
      conversationId: normalizeString(input.conversationId),
      goal: normalizeString(input.goal),
      riskLevel: normalizeString(input.riskLevel || 'L2').toUpperCase()
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

module.exports = { RuntimeTaskEntity };

