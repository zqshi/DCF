const OSS_EVALUATION_SCHEMA_VERSION = 'oss_evaluation_result.v1';

const REQUIRED_DIMENSIONS = [
  'technicalMaturity',
  'communityActivity',
  'codeQuality',
  'documentation',
  'licenseCompliance',
  'security',
  'performance',
  'maintainability'
];

const RISK_BY_REASON = {
  license_incompatible: 'high',
  critical_vulnerabilities_present: 'high',
  stale_maintenance: 'high',
  no_recent_release_signal: 'medium',
  weak_community_signal: 'medium'
};

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampScore(value, fallback = 1) {
  return Math.max(1, Math.min(5, Math.round(toNumber(value, fallback))));
}

function normalizeEvidenceItem(item) {
  const row = item && typeof item === 'object' ? item : {};
  const sourceUrl = normalizeText(row.sourceUrl || row.url || '');
  const capturedAt = normalizeText(row.capturedAt || row.captured_at || '');
  const evidenceExcerpt = normalizeText(row.evidenceExcerpt || row.excerpt || '');
  if (!sourceUrl || !capturedAt || !evidenceExcerpt) return null;
  return {
    sourceUrl: sourceUrl.slice(0, 500),
    capturedAt,
    evidenceExcerpt: evidenceExcerpt.slice(0, 500),
    confidence: Math.max(0, Math.min(1, toNumber(row.confidence, 0.6)))
  };
}

function normalizeEvidenceList(evidence = []) {
  if (!Array.isArray(evidence)) return [];
  return evidence.map((item) => normalizeEvidenceItem(item)).filter(Boolean).slice(0, 60);
}

function normalizeDimensionScores(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const next = {};
  for (const key of REQUIRED_DIMENSIONS) {
    next[key] = clampScore(src[key], 3);
  }
  return next;
}

function evaluateDimensionConsistency(scores = {}, summaryDimensionCount = REQUIRED_DIMENSIONS.length) {
  const normalized = normalizeDimensionScores(scores);
  const present = REQUIRED_DIMENSIONS.filter((key) => Number.isFinite(Number(normalized[key]))).length;
  return {
    ok: present === REQUIRED_DIMENSIONS.length && Number(summaryDimensionCount) === REQUIRED_DIMENSIONS.length,
    requiredDimensions: REQUIRED_DIMENSIONS.slice(),
    presentDimensions: present,
    expectedDimensions: REQUIRED_DIMENSIONS.length,
    summaryDimensionCount: Number(summaryDimensionCount) || 0
  };
}

function inferDynamicThresholds(context = {}) {
  const goal = normalizeText(context.goal).toLowerCase();
  const gapType = normalizeText(context.gapType).toLowerCase();
  const isNiche = goal.includes('sdk') || goal.includes('插件') || goal.includes('plugin');
  const isInfra = gapType === 'infra_missing' || goal.includes('infra') || goal.includes('部署');
  return {
    minStars: isNiche ? 300 : (isInfra ? 800 : 500),
    maxUpdateAgeDays: isInfra ? 240 : 300,
    allowedLicenses: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0', 'ISC'],
    maxCriticalVulnerabilities: 0
  };
}

function evaluateHardGates(candidate = {}, thresholds = inferDynamicThresholds()) {
  const reasons = [];
  const license = normalizeText(candidate.licenseSpdx || candidate.license || '').toUpperCase();
  const stars = Math.max(0, Math.round(toNumber(candidate.stars, 0)));
  const updateAgeDays = Math.max(0, Math.round(toNumber(candidate.updateAgeDays, 0)));
  const criticalVulnerabilities = Math.max(0, Math.round(toNumber(candidate.criticalVulnerabilities, 0)));

  const allowed = (thresholds.allowedLicenses || []).map((x) => normalizeText(x).toUpperCase()).filter(Boolean);
  if (!license || !allowed.includes(license)) reasons.push('license_incompatible');
  if (criticalVulnerabilities > Math.max(0, Math.round(toNumber(thresholds.maxCriticalVulnerabilities, 0)))) {
    reasons.push('critical_vulnerabilities_present');
  }
  if (updateAgeDays > Math.max(1, Math.round(toNumber(thresholds.maxUpdateAgeDays, 365)))) {
    reasons.push('stale_maintenance');
  }
  if (stars < Math.max(0, Math.round(toNumber(thresholds.minStars, 0)))) {
    reasons.push('weak_community_signal');
  }
  return {
    passed: reasons.length === 0,
    reasons,
    riskLevel: reasons.length === 0
      ? 'low'
      : (reasons.some((x) => RISK_BY_REASON[x] === 'high') ? 'high' : 'medium')
  };
}

function computeWeightedScore(scores = {}, weights = null) {
  const normalized = normalizeDimensionScores(scores);
  const w = (weights && typeof weights === 'object') ? weights : {};
  let totalWeight = 0;
  let weighted = 0;
  for (const key of REQUIRED_DIMENSIONS) {
    const weight = Math.max(0, toNumber(w[key], 1));
    totalWeight += weight;
    weighted += normalized[key] * weight;
  }
  const avg = totalWeight > 0 ? (weighted / totalWeight) : 0;
  return Number(avg.toFixed(2));
}

module.exports = {
  OSS_EVALUATION_SCHEMA_VERSION,
  REQUIRED_DIMENSIONS,
  normalizeEvidenceList,
  normalizeDimensionScores,
  evaluateDimensionConsistency,
  inferDynamicThresholds,
  evaluateHardGates,
  computeWeightedScore
};
