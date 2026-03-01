const {
  createCycleSnapshot,
  evaluateBootstrapGate,
  detectImprovement,
  nextPhase
} = require('../../domain/services/BootstrapCycleService');
const { decideRetrievalStage } = require('../../domain/services/RetrievalPolicyService');

function cloneMetrics(metrics) {
  return {
    totalTasks: Number(metrics.totalTasks || 0),
    succeededTasks: Number(metrics.succeededTasks || 0),
    failedTasks: Number(metrics.failedTasks || 0),
    recurrenceErrors: Number(metrics.recurrenceErrors || 0),
    skillReused: Number(metrics.skillReused || 0),
    p1Incidents: Number(metrics.p1Incidents || 0)
  };
}

class BootstrapUseCases {
  constructor(store) {
    this.store = store;
    this.retrievalPolicy = { decide: decideRetrievalStage };
    this.ensureState();
  }

  ensureRetrievalMetrics() {
    if (!this.store.metrics || typeof this.store.metrics !== 'object') this.store.metrics = {};
    if (!this.store.metrics.retrieval || typeof this.store.metrics.retrieval !== 'object') {
      this.store.metrics.retrieval = {
        busyDecisions: 0,
        idleDecisions: 0,
        internalTools: 0,
        platformContext: 0,
        externalSearch: 0,
        skippedExternal: 0,
        queuedExternal: 0
      };
    }
    return this.store.metrics.retrieval;
  }

  recordRetrievalDecision(policy, options = {}) {
    const metrics = this.ensureRetrievalMetrics();
    const mode = String(policy && policy.schedulingMode || 'idle');
    if (mode === 'busy') metrics.busyDecisions += 1;
    else metrics.idleDecisions += 1;
    const decision = String(policy && policy.decision || 'external_search');
    if (decision === 'internal_tools') metrics.internalTools += 1;
    else if (decision === 'platform_context') metrics.platformContext += 1;
    else metrics.externalSearch += 1;
    if (options.skippedExternal) metrics.skippedExternal += 1;
    if (options.queuedExternal) metrics.queuedExternal += 1;
  }

  getRetrievalPreferredMode(employee = null) {
    return undefined;
  }

  ensureState() {
    if (this.store.bootstrap) return;
    this.store.bootstrap = {
      phase: 'S0',
      mode: 'running',
      cycleCount: 0,
      consecutivePasses: 0,
      stagnantCycles: 0,
      manualReviewRequired: false,
      lastMetrics: cloneMetrics(this.store.metrics),
      history: []
    };
  }

  getStatus() {
    this.ensureState();
    return this.store.bootstrap;
  }

  metricsDelta() {
    const current = cloneMetrics(this.store.metrics);
    const previous = this.store.bootstrap.lastMetrics;
    return {
      totalTasks: Math.max(0, current.totalTasks - previous.totalTasks),
      succeededTasks: Math.max(0, current.succeededTasks - previous.succeededTasks),
      failedTasks: Math.max(0, current.failedTasks - previous.failedTasks),
      recurrenceErrors: Math.max(0, current.recurrenceErrors - previous.recurrenceErrors),
      skillReused: Math.max(0, current.skillReused - previous.skillReused),
      p1Incidents: Math.max(0, current.p1Incidents - previous.p1Incidents)
    };
  }

  enqueueResearchForTask(task, employee) {
    const approvedToolCount = (this.store.mcpServices || []).filter((x) => (
      x
      && x.enabled === true
      && String(x.registrationStatus || 'approved') === 'approved'
    )).length;
    const activeTaskCount = this.store.tasks.filter((x) => (
      x && ['pending', 'validating', 'approved', 'running'].includes(String(x.status || ''))
    )).length;
    const queueBacklog = this.store.researchQueue.filter((x) => String(x.status || '') === 'queued').length;
    const policy = this.retrievalPolicy.decide({
      reason: 'bootstrap_corrective',
      linkedSkillsCount: Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds.length : 0,
      knowledgeCount: Array.isArray(employee.knowledge) ? employee.knowledge.length : 0,
      approvedToolCount,
      activeTaskCount,
      queueBacklog,
      preferredMode: this.getRetrievalPreferredMode(employee)
    });
    this.store.addEvent('retrieval.policy.decided', {
      taskId: task.id,
      employeeId: employee.id,
      reason: 'bootstrap_corrective',
      retrievalOrder: policy.order,
      retrievalSchedulingMode: policy.schedulingMode,
      retrievalDecision: policy.decision,
      retrievalRationale: policy.rationale,
      retrievalMetrics: policy.metrics
    });
    if (policy.decision !== 'external_search') {
      this.recordRetrievalDecision(policy, { skippedExternal: true });
      this.store.addEvent('oss.research.skipped', {
        taskId: task.id,
        employeeId: employee.id,
        reason: 'policy_preferred_non_external',
        retrievalSchedulingMode: policy.schedulingMode,
        retrievalDecision: policy.decision,
        retrievalRationale: policy.rationale
      });
      return null;
    }
    const item = {
      id: `${task.id}-research-${Date.now()}`,
      taskId: task.id,
      employeeId: employee.id,
      query: `${employee.department} ${employee.role} ${task.goal}`.slice(0, 120),
      goal: task.goal,
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    this.store.researchQueue.push(item);
    this.recordRetrievalDecision(policy, { queuedExternal: true });
    this.store.addEvent('oss.research.queued', {
      taskId: task.id,
      employeeId: employee.id,
      query: item.query,
      source: 'bootstrap'
    });
    return item;
  }

  triggerCorrectiveActions(limit = 3) {
    const failed = this.store.tasks
      .filter((task) => task.status === 'failed')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);

    for (const task of failed) {
      const employee = this.store.employees.find((e) => e.id === task.employeeId);
      if (!employee) continue;
      task.iteration += 1;
      task.status = 'pending';
      task.updatedAt = new Date().toISOString();
      task.corrections.push({
        at: new Date().toISOString(),
        note: 'Bootstrap auto-correction requeued this task.'
      });
      this.store.addEvent('task.corrective.requeued', {
        taskId: task.id,
        employeeId: task.employeeId,
        traceId: task.traceId || task.id,
        retryIteration: task.iteration
      });
      this.enqueueResearchForTask(task, employee);
    }

    return failed.length;
  }

  runCycle() {
    this.ensureState();
    const state = this.store.bootstrap;
    const delta = this.metricsDelta();
    if (delta.totalTasks <= 0) return state;

    state.cycleCount += 1;
    const previous = state.history[state.history.length - 1] || null;
    const snapshot = createCycleSnapshot(delta, state.phase);
    const gate = evaluateBootstrapGate(snapshot, previous);
    const improved = detectImprovement(snapshot, previous);

    if (gate.passed) {
      state.consecutivePasses += 1;
      state.stagnantCycles = 0;
      state.mode = 'auto_advanced';
      const next = nextPhase(state.phase);
      if (next !== state.phase) {
        const from = state.phase;
        state.phase = next;
        this.store.addEvent('bootstrap.phase.advanced', {
          cycle: state.cycleCount,
          fromPhase: from,
          toPhase: state.phase,
          successRate: snapshot.successRate
        });
      }
    } else {
      state.consecutivePasses = 0;
      state.mode = 'corrective';
      state.stagnantCycles = improved ? 0 : state.stagnantCycles + 1;
      const correctiveCount = this.triggerCorrectiveActions(3);
      this.store.addEvent('bootstrap.corrective.triggered', {
        cycle: state.cycleCount,
        phase: state.phase,
        successRate: snapshot.successRate,
        checks: gate.checks,
        correctiveCount
      });
      if (state.stagnantCycles >= 2 && !state.manualReviewRequired) {
        state.manualReviewRequired = true;
        this.store.addEvent('bootstrap.manual.review.required', {
          cycle: state.cycleCount,
          phase: state.phase
        });
      }
    }

    snapshot.gate = gate;
    snapshot.improved = improved;
    state.history.push(snapshot);
    state.history = state.history.slice(-20);
    state.lastMetrics = cloneMetrics(this.store.metrics);
    return state;
  }
}

module.exports = { BootstrapUseCases };
