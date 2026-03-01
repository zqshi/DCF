const RETRIEVAL_ORDER = ['internal_tools', 'platform_context', 'external_search'];
const SCHEDULER_MODES = new Set(['busy', 'idle']);

function normalizeCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function resolveSchedulingMode(input = {}) {
  const preferred = String(input.preferredMode || '').trim().toLowerCase();
  if (SCHEDULER_MODES.has(preferred)) return preferred;
  const activeTaskCount = normalizeCount(input.activeTaskCount);
  const queueBacklog = normalizeCount(input.queueBacklog);
  if (activeTaskCount >= 3 || queueBacklog >= 5) return 'busy';
  return 'idle';
}

function decideRetrievalStage(input = {}) {
  const linkedSkillsCount = normalizeCount(input.linkedSkillsCount);
  const knowledgeCount = normalizeCount(input.knowledgeCount);
  const approvedToolCount = normalizeCount(input.approvedToolCount);
  const reason = String(input.reason || 'general').trim() || 'general';
  const schedulingMode = resolveSchedulingMode(input);

  const platformReady = linkedSkillsCount >= 2 || knowledgeCount >= 3;
  const internalReady = approvedToolCount > 0;

  let decision = 'external_search';
  let rationale = 'default_external_fallback';

  if (reason === 'task_correction') {
    decision = 'external_search';
    rationale = 'realtime_task_correction_prefers_external';
  } else if (platformReady && schedulingMode === 'idle') {
    decision = 'platform_context';
    rationale = 'idle_mode_prefers_internal_context';
  } else if (reason === 'runtime_health' && internalReady) {
    decision = 'internal_tools';
    rationale = 'runtime_health_prefers_internal';
  }

  return {
    order: RETRIEVAL_ORDER.slice(),
    schedulingMode,
    decision,
    rationale,
    metrics: {
      linkedSkillsCount,
      knowledgeCount,
      approvedToolCount
    }
  };
}

module.exports = {
  RETRIEVAL_ORDER,
  resolveSchedulingMode,
  decideRetrievalStage
};
