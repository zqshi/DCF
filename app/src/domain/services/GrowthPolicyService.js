const COMPLEXITY_HINTS = [
  '并',
  '同时',
  '先',
  '再',
  '复盘',
  '对账',
  '报表',
  '计划',
  'summary',
  'report',
  'workflow'
];

function normalizeGoal(goal) {
  return String(goal || '').trim().toLowerCase();
}

function inferCapability(goal) {
  const g = normalizeGoal(goal);
  if (g.includes('hr') || g.includes('入职')) return 'hr-workflow';
  if (g.includes('report') || g.includes('报表')) return 'reporting';
  if (g.includes('财务') || g.includes('invoice')) return 'finance-ops';
  return 'general-ops';
}

function evaluateChildAgentPlan(task) {
  const g = normalizeGoal(task.goal);
  const longGoal = g.length >= 28;
  const hasComplexHint = COMPLEXITY_HINTS.some((x) => g.includes(x));
  const riskDriven = task.riskLevel === 'L4';
  const broadToolScope = Array.isArray(task.constraints && task.constraints.allowedTools)
    && task.constraints.allowedTools.length >= 3;
  const reasons = [];
  if (riskDriven) reasons.push('high_risk_l4');
  if (longGoal) reasons.push('long_goal');
  if (hasComplexHint) reasons.push('complexity_keyword');
  if (broadToolScope) reasons.push('broad_tool_scope');
  return {
    planned: reasons.length > 0,
    reasons
  };
}

function shouldCreateChildAgent(task) {
  return evaluateChildAgentPlan(task).planned;
}

function shouldSedimentSkill({ task, employeeId, allTasks }) {
  const capability = inferCapability(task.goal);
  const succeededSameCapability = (allTasks || []).filter((x) => (
    x.employeeId === employeeId
    && x.status === 'succeeded'
    && inferCapability(x.goal) === capability
  )).length;
  return succeededSameCapability >= 2;
}

module.exports = {
  inferCapability,
  evaluateChildAgentPlan,
  shouldCreateChildAgent,
  shouldSedimentSkill
};
