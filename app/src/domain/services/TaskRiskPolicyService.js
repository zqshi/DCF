function normalizeRiskLevel(level, fallback = 'L2') {
  const value = String(level || '').trim().toUpperCase();
  if (['L1', 'L2', 'L3', 'L4'].includes(value)) return value;
  return fallback;
}

function toRiskRank(level) {
  const order = { L1: 1, L2: 2, L3: 3, L4: 4 };
  return order[normalizeRiskLevel(level)] || 2;
}

function includesAnyKeyword(source, keywords = []) {
  const text = String(source || '').toLowerCase();
  if (!text) return false;
  return keywords.some((keyword) => text.includes(String(keyword || '').toLowerCase()));
}

function classifyTaskRisk(input = {}, employee = {}) {
  const requestedRiskLevel = normalizeRiskLevel(input.riskLevel || employee.riskLevel || 'L2');
  const reasons = [];
  const goal = String(input.goal || '').trim();
  const hasExternalWrite = Boolean(input.externalWrite && typeof input.externalWrite === 'object');
  const sensitiveByGoal = includesAnyKeyword(goal, [
    '外部邮箱', '公网', 'public link', 'public url',
    '导出全部', '全部客户', '隐私数据', '敏感数据',
    '批量导出', 'export all', 'customer data',
    'send to external', 'external email', 'token', 'secret', 'credential'
  ]);
  const sensitive = sensitiveByGoal || hasExternalWrite;
  if (sensitiveByGoal) reasons.push('sensitive_goal_pattern_detected');
  if (hasExternalWrite) reasons.push('external_write_contract_present');

  const requestedRank = toRiskRank(requestedRiskLevel);
  const effectiveRiskLevel = sensitive && requestedRank < toRiskRank('L4') ? 'L4' : requestedRiskLevel;
  const elevated = toRiskRank(effectiveRiskLevel) > requestedRank;

  return {
    requestedRiskLevel,
    effectiveRiskLevel,
    sensitive,
    elevated,
    reasons
  };
}

module.exports = {
  normalizeRiskLevel,
  classifyTaskRisk
};
