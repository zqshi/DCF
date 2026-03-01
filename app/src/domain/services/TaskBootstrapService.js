function stripGoalEcho(text, goal) {
  const value = String(text || '').trim();
  const rawGoal = String(goal || '').trim();
  if (!value) return value;
  if (!rawGoal) return value;
  if (value === rawGoal) return '';
  if (value.includes(rawGoal)) {
    return value.replace(rawGoal, '').replace(/[：:]\s*$/, '').trim();
  }
  return value;
}

async function resolveNaturalResult(task, options = {}) {
  const gateway = options.dialogueGateway;
  if (gateway && typeof gateway.isEnabled === 'function' && gateway.isEnabled()) {
    try {
      const generated = await gateway.generateReply({
        goal: task.goal,
        riskLevel: task.riskLevel,
        llmConfig: task.llmConfig || {},
        conversationId: task.conversationId || 'default',
        employee: options.employee || null
      });
      const cleaned = stripGoalEcho(generated, task.goal);
      if (cleaned) return cleaned;
    } catch {}
  }
  const reason = gateway && gateway.lastError ? `: ${gateway.lastError}` : '';
  throw new Error(`LLM response unavailable${reason}`);
}

async function evaluateTask(task, options = {}) {
  const success = (task.goal.length + task.iteration) % 4 !== 0;
  if (success) {
    try {
      const result = await resolveNaturalResult(task, options);
      return {
        status: 'succeeded',
        result,
        error: null,
        corrected: false
      };
    } catch (error) {
      return {
        status: 'failed',
        result: null,
        error: { severity: 'P2', message: String(error.message || 'LLM response unavailable') },
        corrected: false
      };
    }
  }

  const severity = task.riskLevel === 'L4' ? 'P1' : 'P2';
  if (task.iteration < 3) {
    return {
      status: 'queued',
      result: null,
      error: { severity, message: 'Execution failed, auto-correction requeued.' },
      corrected: true
    };
  }

  return {
    status: 'failed',
    result: null,
    error: { severity, message: 'Execution failed after max retries.' },
    corrected: false
  };
}

module.exports = { evaluateTask };
