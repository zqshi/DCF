const ALLOWED_TRANSITIONS = Object.freeze({
  queued: ['running', 'aborted'],
  running: ['succeeded', 'failed', 'aborted'],
  succeeded: [],
  failed: [],
  aborted: []
});

function nowIso() {
  return new Date().toISOString();
}

class RuntimeTaskStateMachine {
  constructor(task) {
    if (!task || typeof task !== 'object') throw new Error('runtime task is required');
    if (!task.status) throw new Error('runtime task status is required');
    this.task = task;
  }

  canTransition(nextStatus) {
    const current = String(this.task.status || '').trim();
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(nextStatus);
  }

  transition(nextStatus, patch = {}) {
    if (!this.canTransition(nextStatus)) {
      throw new Error(`invalid runtime task transition: ${this.task.status} -> ${nextStatus}`);
    }
    this.task.status = nextStatus;
    if (Object.prototype.hasOwnProperty.call(patch, 'result')) this.task.result = patch.result;
    if (Object.prototype.hasOwnProperty.call(patch, 'lastError')) this.task.lastError = patch.lastError;
    if (nextStatus === 'running') this.task.iteration = Math.max(1, Number(this.task.iteration || 1));
    this.task.updatedAt = nowIso();
    return this.task;
  }

  markRunning() {
    return this.transition('running');
  }

  markSucceeded(result) {
    return this.transition('succeeded', { result: String(result || ''), lastError: null });
  }

  markFailed(error = {}) {
    const severity = String(error.severity || 'P2').toUpperCase() === 'P1' ? 'P1' : 'P2';
    const message = String(error.message || 'runtime task failed').slice(0, 400);
    return this.transition('failed', {
      result: null,
      lastError: { severity, message }
    });
  }

  markAborted() {
    return this.transition('aborted', { result: null });
  }
}

module.exports = { RuntimeTaskStateMachine, ALLOWED_TRANSITIONS };

