function applyRollback(ctx, task, employee, mode, reason, actor = {}) {
  const rollbackByUserId = actor && actor.userId ? String(actor.userId) : null;
  const rollbackByRole = actor && actor.role ? String(actor.role) : null;
  const rollbackEvent = ctx.store.addEvent('task.rollback.triggered', ctx.eventPayload(task, employee, {
    reason: String(reason || '').slice(0, 500),
    mode,
    rollbackByUserId,
    rollbackByRole
  }));
  task.status = 'rolled_back';
  task.rollback = {
    at: new Date().toISOString(),
    reason: String(reason || '').slice(0, 500),
    mode,
    by: {
      userId: rollbackByUserId,
      role: rollbackByRole
    },
    evidence: {
      triggerEventId: rollbackEvent.id,
      triggerEventHash: rollbackEvent.event_hash
    }
  };
  task.updatedAt = new Date().toISOString();
  ctx.store.addEvent('task.rolled_back', ctx.eventPayload(task, employee, {
    reason: task.rollback.reason,
    mode: task.rollback.mode,
    rollbackByUserId,
    rollbackByRole
  }));
  queueCompensation(ctx, task, employee);
}

function queueCompensation(ctx, task, employee) {
  const externalWrite = task.externalWrite || null;
  const compensation = externalWrite && externalWrite.compensation ? externalWrite.compensation : null;
  if (!compensation || !compensation.action || task.compensation) return;
  task.compensation = {
    status: 'queued',
    action: compensation.action,
    queuedAt: new Date().toISOString(),
    system: externalWrite.system,
    operation: externalWrite.operation,
    idempotencyKey: externalWrite.idempotencyKey
  };
  ctx.store.addEvent('integration.compensation.queued', ctx.eventPayload(task, employee, {
    compensationStatus: task.compensation.status,
    compensationAction: task.compensation.action,
    externalWriteSystem: task.compensation.system,
    externalWriteOperation: task.compensation.operation,
    idempotencyKey: task.compensation.idempotencyKey
  }));
}

const COMPENSATION_STALE_MS = 5 * 60 * 1000; // 5 minutes

async function processCompensations(ctx, limit = 10) {
  const now = Date.now();

  // Crash recovery: reset stuck 'running' compensations that exceeded stale threshold
  for (const task of ctx.store.tasks) {
    if (!task || !task.compensation || task.compensation.status !== 'running') continue;
    const startedAt = Date.parse(String(task.compensation.startedAt || ''));
    if (!Number.isFinite(startedAt) || (now - startedAt) < COMPENSATION_STALE_MS) continue;
    task.compensation.status = 'queued';
    task.compensation.startedAt = null;
    const employee = ctx.store.employees.find((e) => e.id === task.employeeId) || null;
    ctx.store.addEvent('integration.compensation.crash_recovered', ctx.eventPayload(task, employee, {
      compensationAction: task.compensation.action,
      staleSinceMs: now - startedAt,
      externalWriteSystem: task.compensation.system,
      externalWriteOperation: task.compensation.operation
    }));
  }

  const queuedTasks = ctx.store.tasks.filter((task) => (
    task
    && task.compensation
    && task.compensation.status === 'queued'
    && (!task.compensation.nextRetryAt || Date.parse(task.compensation.nextRetryAt) <= now)
  )).slice(0, Math.max(1, Number(limit) || 10));

  for (const task of queuedTasks) {
    const employee = ctx.store.employees.find((e) => e.id === task.employeeId) || null;
    await executeCompensationForTask(ctx, task, employee);
  }
}

async function executeCompensationForTask(ctx, task, employee) {
  const compensation = task.compensation;
  if (!compensation || compensation.status !== 'queued') return;
  compensation.status = 'running';
  compensation.startedAt = new Date().toISOString();
  compensation.attempts = Number(compensation.attempts || 0) + 1;
  ctx.store.addEvent('integration.compensation.running', ctx.eventPayload(task, employee, {
    compensationAction: compensation.action,
    compensationAttempt: compensation.attempts,
    externalWriteSystem: compensation.system,
    externalWriteOperation: compensation.operation,
    idempotencyKey: compensation.idempotencyKey
  }));

  const gateway = ctx.enterpriseGateway;
  if (!gateway || typeof gateway.isEnabled !== 'function' || !gateway.isEnabled()) {
    compensation.status = 'queued';
    compensation.lastError = 'enterprise gateway unavailable';
    ctx.store.addEvent('integration.compensation.deferred', ctx.eventPayload(task, employee, {
      compensationAction: compensation.action,
      compensationAttempt: compensation.attempts,
      reason: compensation.lastError
    }));
    return;
  }

  try {
    const outcome = await gateway.executeCompensation({ compensation, task, employee });
    if (outcome && outcome.status === 'succeeded') {
      compensation.status = 'succeeded';
      compensation.finishedAt = new Date().toISOString();
      compensation.result = outcome.result || null;
      compensation.lastError = null;
      ctx.store.addEvent('integration.compensation.succeeded', ctx.eventPayload(task, employee, {
        compensationAction: compensation.action,
        compensationAttempt: compensation.attempts,
        externalWriteSystem: compensation.system,
        externalWriteOperation: compensation.operation,
        idempotencyKey: compensation.idempotencyKey
      }));
      return;
    }
    throw new Error((outcome && outcome.error && outcome.error.message) || 'compensation execution failed');
  } catch (error) {
    compensation.lastError = String(error.message || 'compensation execution failed');
    const attempts = Number(compensation.attempts || 0);
    if (attempts >= ctx.compensationMaxAttempts) {
      compensation.status = 'dead_letter';
      compensation.finishedAt = new Date().toISOString();
      compensation.deadLetterAt = compensation.finishedAt;
      compensation.nextRetryAt = null;
      ctx.store.addEvent('integration.compensation.dead_lettered', ctx.eventPayload(task, employee, {
        compensationAction: compensation.action,
        compensationAttempt: attempts,
        reason: compensation.lastError,
        externalWriteSystem: compensation.system,
        externalWriteOperation: compensation.operation,
        idempotencyKey: compensation.idempotencyKey
      }));
      return;
    }
    const delayMs = ctx.compensationBackoffMs * Math.pow(2, Math.max(0, attempts - 1));
    compensation.status = 'queued';
    compensation.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    ctx.store.addEvent('integration.compensation.retry_scheduled', ctx.eventPayload(task, employee, {
      compensationAction: compensation.action,
      compensationAttempt: attempts,
      retryAfterMs: delayMs,
      nextRetryAt: compensation.nextRetryAt,
      reason: compensation.lastError,
      externalWriteSystem: compensation.system,
      externalWriteOperation: compensation.operation,
      idempotencyKey: compensation.idempotencyKey
    }));
  }
}

function retryCompensation(ctx, taskId, actor = {}) {
  const task = ctx.getTask(taskId);
  if (!task.compensation) throw new Error('compensation not found');
  const current = String(task.compensation.status || '');
  if (!['failed', 'dead_letter', 'deferred', 'queued'].includes(current)) {
    throw new Error('compensation cannot be retried in current status');
  }
  task.compensation.status = 'queued';
  task.compensation.nextRetryAt = new Date().toISOString();
  task.compensation.finishedAt = null;
  task.compensation.deadLetterAt = null;
  ctx.store.addEvent('integration.compensation.retry_requested', ctx.eventPayload(task, null, {
    compensationAction: task.compensation.action,
    reason: String((actor && actor.reason) || 'manual retry').slice(0, 500),
    requestedByUserId: actor && actor.userId ? String(actor.userId) : null,
    requestedByRole: actor && actor.role ? String(actor.role) : null
  }));
  return task;
}

module.exports = {
  applyRollback,
  queueCompensation,
  processCompensations,
  executeCompensationForTask,
  retryCompensation
};
