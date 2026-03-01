const {
  normalizeRuntimeEventExtra,
  detectRuntimeExecutionEvidence
} = require('./RuntimeEvidenceService');

async function processTaskTick(ctx, task) {
  if (!['pending', 'validating', 'approved'].includes(task.status)) return;
  const employee = ctx.store.employees.find((e) => e.id === task.employeeId);
  ctx.prepareTask(task, employee);
  if (task.status !== 'approved') return;

  if (typeof ctx.precheckTaskCapabilities === 'function') {
    ctx.precheckTaskCapabilities(task, employee);
  } else {
    ctx.emitRuntimeToolCatalog(task, employee);
  }
  if (typeof ctx.appendReactTrace === 'function') {
    ctx.appendReactTrace(task, 'act', {
      action: 'runtime_execute',
      status: 'running'
    });
  }
  task.status = 'running';
  task.updatedAt = new Date().toISOString();
  ctx.store.addEvent('task.running', ctx.eventPayload(task, employee));

  const outcome = await ctx.executeTask(task, employee);
  if (employee && ctx.ossDecisionUseCases && typeof ctx.ossDecisionUseCases.inferAndHandle === 'function') {
    await ctx.ossDecisionUseCases.inferAndHandle(task, employee, outcome);
  }
  task.status = outcome.status;
  task.result = outcome.result;
  task.lastError = outcome.error;
  task.runtime = {
    taskId: outcome.runtimeTaskId || null,
    source: outcome.source || 'openclaw',
    events: Array.isArray(outcome.runtimeEvents) ? outcome.runtimeEvents.slice(0, 100) : [],
    evidence: detectRuntimeExecutionEvidence(task, outcome)
  };
  if (task.runtime.taskId) {
    ctx.store.addEvent('runtime.task.synced', ctx.eventPayload(task, employee, {
      runtimeTaskId: task.runtime.taskId,
      runtimeEventCount: task.runtime.events.length
    }));
    const emittedKeys = task.__runtimeEmittedKeys || new Set();
    for (const runtimeEvent of task.runtime.events) {
      const key = runtimeEvent && runtimeEvent.id
        ? `id:${runtimeEvent.id}`
        : `shape:${runtimeEvent ? runtimeEvent.type : 'unknown'}:${runtimeEvent ? runtimeEvent.at : ''}`;
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      const runtimeExtra = normalizeRuntimeEventExtra(runtimeEvent);
      ctx.store.addEvent('runtime.raw.event', ctx.eventPayload(task, employee, {
        runtimeTaskId: task.runtime.taskId,
        runtimeEventId: runtimeEvent.id || null,
        runtimeType: runtimeEvent.type || 'unknown',
        runtimeAt: runtimeEvent.at || null,
        ...runtimeExtra
      }));
    }
    task.__runtimeEmittedKeys = emittedKeys;
  }

  if (outcome.corrected) {
    task.iteration += 1;
    task.corrections.push({ at: new Date().toISOString(), note: 'Auto-correction applied and re-queued.' });
    ctx.store.addEvent('task.corrected', ctx.eventPayload(task, employee, {
      retryIteration: task.iteration,
      source: outcome.source
    }));
    if (employee) {
      ctx.searchSkillsForTask(task, employee, { trigger: 'correction', query: outcome.researchQuery || task.goal });
      ctx.queueOssResearch(employee, task, outcome.researchQuery);
    }
  }

  if (outcome.status === 'queued') {
    task.status = 'pending';
  }

  if (outcome.status === 'succeeded') {
    if (typeof ctx.appendReactTrace === 'function') {
      ctx.appendReactTrace(task, 'observe', {
        source: outcome.source || 'unknown',
        status: 'succeeded'
      });
    }
    try {
      task.result = await ctx.resolveNaturalResult(task, employee, outcome.result, outcome.source || 'unknown');
      if (typeof ctx.enforceAssistantTruth === 'function') {
        task.result = ctx.enforceAssistantTruth(task, task.result);
      }
      const requiresEvidence = typeof ctx.requiresExecutionEvidence === 'function'
        ? Boolean(ctx.requiresExecutionEvidence(task))
        : false;
      const evidence = task.runtime && typeof task.runtime.evidence === 'object' ? task.runtime.evidence : {};
      if (requiresEvidence && String(evidence.verdict || '') !== 'confirmed') {
        ctx.store.addEvent('task.execution.unproven', ctx.eventPayload(task, employee, {
          source: outcome.source || 'unknown',
          verdict: String(evidence.verdict || 'unknown'),
          runtimeTaskId: String(evidence.runtimeTaskId || task.runtime.taskId || '') || null,
          shellEventCount: Number(evidence.shellEventCount || 0),
          commandCount: Number(evidence.commandCount || 0),
          exitCodeCount: Number(evidence.exitCodeCount || 0),
          outputCount: Number(evidence.outputCount || 0),
          deliveryEventCount: Number(evidence.deliveryEventCount || 0),
          deliveryReceiptCount: Number(evidence.deliveryReceiptCount || 0)
        }));
        throw new Error([
          'Execution evidence unavailable',
          'Runtime execution evidence is insufficient for completion claim',
          `verdict=${String(evidence.verdict || 'unknown')}`,
          `runtimeTaskId=${String(evidence.runtimeTaskId || task.runtime.taskId || '') || 'none'}`,
          `shellEventCount=${Number(evidence.shellEventCount || 0)}`,
          `commandCount=${Number(evidence.commandCount || 0)}`,
          `exitCodeCount=${Number(evidence.exitCodeCount || 0)}`,
          `outputCount=${Number(evidence.outputCount || 0)}`,
          `deliveryEventCount=${Number(evidence.deliveryEventCount || 0)}`,
          `deliveryReceiptCount=${Number(evidence.deliveryReceiptCount || 0)}`
        ].join('; '));
      }
    } catch (error) {
      task.status = 'failed';
      task.result = null;
      task.lastError = {
        severity: 'P2',
        message: String(error.message || 'Runtime result unavailable')
      };
      ctx.store.metrics.failedTasks += 1;
      ctx.store.metrics.recurrenceErrors += 1;
      if (typeof ctx.recordAssistantMessageForTask === 'function') {
        ctx.recordAssistantMessageForTask(task, employee);
      }
      ctx.store.addEvent('task.failed', ctx.eventPayload(task, employee, {
        severity: 'P2',
        source: outcome.source || 'unknown'
      }));
      task.updatedAt = new Date().toISOString();
      if (task.__runtimeEmittedKeys) delete task.__runtimeEmittedKeys;
      return;
    }
    ctx.store.metrics.succeededTasks += 1;
    ctx.store.metrics.skillReused += 1;
    if (typeof ctx.recordAssistantMessageForTask === 'function') {
      ctx.recordAssistantMessageForTask(task, employee);
    }
    if (employee) {
      ctx.applyExternalChildren(employee, task, outcome.children);
      if (outcome.skills && outcome.skills.length) {
        ctx.normalizeExternalSkills(employee, outcome.skills, task);
      } else {
        await ctx.autoSkillize(employee, task);
      }
      const items = outcome.knowledge && outcome.knowledge.length
        ? outcome.knowledge
        : [{ id: `${task.id}-k`, title: `TaskLearning:${task.goal.slice(0, 24)}`, summary: task.result, createdAt: new Date().toISOString() }];
      for (const k of items) employee.knowledge.push(k);
      if (typeof ctx.sedimentKnowledgeFromTask === 'function') {
        try {
          await ctx.sedimentKnowledgeFromTask(task, employee);
        } catch (error) {
          ctx.store.addEvent('knowledge.sedimentation.failed', ctx.eventPayload(task, employee, {
            reason: String(error && error.message ? error.message : 'unknown').slice(0, 500)
          }));
        }
      }
    }
    ctx.store.addEvent('task.succeeded', ctx.eventPayload(task, employee, { source: outcome.source }));
    if (typeof ctx.appendReactTrace === 'function') {
      ctx.appendReactTrace(task, 'reflect', {
        next: 'task_completed'
      });
    }
    // --- 持久化对话记录到 .md 文件 ---
    if (typeof ctx.appendToRuntimeFile === 'function') {
      try {
        const heartbeatEntry = `- [${new Date().toISOString()}] ✓ TASK#${(task.id || '').slice(0,8)}: ${(task.goal || '').slice(0,60)}\n`;
        ctx.appendToRuntimeFile(task.employeeId, 'HEARTBEAT.md', heartbeatEntry);
      } catch {}
    }
    if (typeof ctx.appendToDailyMemory === 'function') {
      try {
        ctx.appendToDailyMemory(task.employeeId, {
          role: 'user', content: task.goal,
          result: task.result, status: 'succeeded'
        });
      } catch {}
    }
  }

  if (outcome.status === 'failed') {
    if (typeof ctx.appendReactTrace === 'function') {
      ctx.appendReactTrace(task, 'observe', {
        source: outcome.source || 'unknown',
        status: 'failed',
        error: String((outcome.error && outcome.error.message) || '').slice(0, 240)
      });
    }
    if (employee) ctx.searchSkillsForTask(task, employee, { trigger: 'failure', query: task.goal });
    const permissionDeniedRequest = typeof ctx.extractPermissionDeniedRequest === 'function'
      ? ctx.extractPermissionDeniedRequest(outcome)
      : null;
    if (permissionDeniedRequest && typeof ctx.requestRuntimeToolPermission === 'function') {
      ctx.requestRuntimeToolPermission(task, employee, permissionDeniedRequest);
      task.updatedAt = new Date().toISOString();
      if (task.__runtimeEmittedKeys) delete task.__runtimeEmittedKeys;
      return;
    }
    ctx.store.metrics.failedTasks += 1;
    ctx.store.metrics.recurrenceErrors += 1;
    const severity = outcome.error ? outcome.error.severity : 'P2';
    if (severity === 'P1') ctx.store.metrics.p1Incidents += 1;
    if (typeof ctx.recordAssistantMessageForTask === 'function') {
      ctx.recordAssistantMessageForTask(task, employee);
    }
    ctx.store.addEvent('task.failed', ctx.eventPayload(task, employee, { severity, source: outcome.source }));
    if (severity === 'P1' && typeof ctx.applyRollback === 'function') {
      ctx.applyRollback(task, employee, 'auto', 'P1 incident auto rollback');
    }
    if (typeof ctx.appendReactTrace === 'function') {
      ctx.appendReactTrace(task, 'reflect', {
        next: 'task_failed'
      });
    }
    // --- 持久化失败记录到 .md 文件 ---
    if (typeof ctx.appendToRuntimeFile === 'function') {
      try {
        const errMsg = (outcome.error && outcome.error.message) ? String(outcome.error.message).slice(0, 60) : 'unknown';
        const heartbeatEntry = `- [${new Date().toISOString()}] ✗ TASK#${(task.id || '').slice(0,8)}: ${(task.goal || '').slice(0,60)} [${errMsg}]\n`;
        ctx.appendToRuntimeFile(task.employeeId, 'HEARTBEAT.md', heartbeatEntry);
      } catch {}
    }
    if (typeof ctx.appendToDailyMemory === 'function') {
      try {
        const errMsg = (outcome.error && outcome.error.message) ? String(outcome.error.message).slice(0, 300) : '未知错误';
        ctx.appendToDailyMemory(task.employeeId, {
          role: 'user', content: task.goal,
          result: errMsg, status: 'failed'
        });
      } catch {}
    }
  }

  if (outcome.status === 'aborted') {
    if (typeof ctx.appendReactTrace === 'function') {
      ctx.appendReactTrace(task, 'observe', {
        source: outcome.source || 'unknown',
        status: 'aborted',
        error: String((outcome.error && outcome.error.message) || '').slice(0, 240)
      });
      ctx.appendReactTrace(task, 'reflect', {
        next: 'task_aborted'
      });
    }
    if (typeof ctx.recordAssistantMessageForTask === 'function') {
      ctx.recordAssistantMessageForTask(task, employee);
    }
    ctx.store.addEvent('task.aborted', ctx.eventPayload(task, employee, { source: outcome.source }));
    // --- 持久化中止记录到 .md 文件 ---
    if (typeof ctx.appendToRuntimeFile === 'function') {
      try {
        const heartbeatEntry = `- [${new Date().toISOString()}] ⊘ TASK#${(task.id || '').slice(0,8)}: ${(task.goal || '').slice(0,60)} [aborted]\n`;
        ctx.appendToRuntimeFile(task.employeeId, 'HEARTBEAT.md', heartbeatEntry);
      } catch {}
    }
    if (typeof ctx.appendToDailyMemory === 'function') {
      try {
        ctx.appendToDailyMemory(task.employeeId, {
          role: 'user', content: task.goal,
          result: '任务已中止', status: 'aborted'
        });
      } catch {}
    }
  }

  task.updatedAt = new Date().toISOString();
  if (task.__runtimeEmittedKeys) delete task.__runtimeEmittedKeys;
}

module.exports = {
  processTaskTick
};
