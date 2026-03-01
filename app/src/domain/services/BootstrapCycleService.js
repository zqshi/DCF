const PHASES = ['S0', 'S1', 'S2', 'S3'];

function safeRate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function createCycleSnapshot(metricsDelta, currentPhase) {
  const successRate = safeRate(metricsDelta.succeededTasks, metricsDelta.totalTasks);
  return {
    at: new Date().toISOString(),
    phase: currentPhase,
    delta: metricsDelta,
    successRate
  };
}

function evaluateBootstrapGate(current, previous = null) {
  const recurrenceDown = previous ? current.delta.recurrenceErrors <= previous.delta.recurrenceErrors : true;
  const reuseUp = previous ? current.delta.skillReused >= previous.delta.skillReused : true;
  const noP1 = current.delta.p1Incidents === 0;
  const successPass = current.successRate >= 85;

  return {
    passed: successPass && noP1 && recurrenceDown && reuseUp,
    checks: {
      successPass,
      noP1,
      recurrenceDown,
      reuseUp
    }
  };
}

function detectImprovement(current, previous = null) {
  if (!previous) return false;
  if (current.successRate > previous.successRate) return true;
  if (current.delta.recurrenceErrors < previous.delta.recurrenceErrors) return true;
  if (current.delta.skillReused > previous.delta.skillReused) return true;
  return false;
}

function nextPhase(currentPhase) {
  const idx = PHASES.indexOf(currentPhase);
  if (idx === -1) return PHASES[0];
  if (idx >= PHASES.length - 1) return currentPhase;
  return PHASES[idx + 1];
}

module.exports = {
  createCycleSnapshot,
  evaluateBootstrapGate,
  detectImprovement,
  nextPhase
};
