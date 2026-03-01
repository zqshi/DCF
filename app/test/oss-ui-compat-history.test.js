const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isNotFoundError,
  resolveLegacyFindingsVisible,
  buildCaseRowsSignature,
  scenarioExplanationText,
  buildVsBuyRationaleText,
  autonomySummary,
  retrievalStatusText,
  recommendationRationaleText
} = require('../public/admin/oss.js');

test('legacy findings 404 should be treated as non-fatal compatibility absence', () => {
  assert.equal(isNotFoundError(new Error('Not Found')), true);
  assert.equal(isNotFoundError(new Error('request failed with 404')), true);
  assert.equal(isNotFoundError(new Error('forbidden')), false);
});

test('legacy findings section is visible only when feature is supported and has rows', () => {
  assert.equal(resolveLegacyFindingsVisible([], true), false);
  assert.equal(resolveLegacyFindingsVisible([{ id: 'f1' }], false), false);
  assert.equal(resolveLegacyFindingsVisible([{ id: 'f1' }], true), true);
});

test('case rows signature remains stable when case list and selection are unchanged', () => {
  const cases = [
    {
      id: 'case-1',
      taskId: 'task-1',
      gapType: 'skill_gap',
      status: 'pending_approval',
      recommendation: 'introduce_oss',
      updatedAt: '2026-02-24T01:00:00.000Z'
    }
  ];
  const current = buildCaseRowsSignature(cases, 'case-1');
  const next = buildCaseRowsSignature(cases, 'case-1');
  assert.equal(next, current);
});

test('case rows signature changes when rendered row fields change', () => {
  const cases = [
    {
      id: 'case-1',
      taskId: 'task-1',
      gapType: 'skill_gap',
      status: 'pending_approval',
      recommendation: 'introduce_oss',
      updatedAt: '2026-02-24T01:00:00.000Z'
    }
  ];
  const current = buildCaseRowsSignature(cases, 'case-1');
  const changed = buildCaseRowsSignature(
    [{ ...cases[0], updatedAt: '2026-02-24T01:05:00.000Z' }],
    'case-1'
  );
  assert.notEqual(changed, current);
});

test('scenario explanation merges scene, reason and confidence for non-technical users', () => {
  const text = scenarioExplanationText({
    gapSummary: '任务执行中缺少日志采集能力',
    rationale: 'heuristic_gap_detected',
    gapType: 'capability_missing',
    confidence: 0.82
  });
  assert.equal(text.includes('触发场景：任务执行中缺少日志采集能力。'), true);
  assert.equal(text.includes('触发原因：系统根据失败信号识别到能力缺口。'), true);
  assert.equal(text.includes('检索必要性：当前问题涉及技能能力缺口，检索是为快速找到可验证方案，避免重复建设与效率损失。'), true);
  assert.equal(text.includes('系统判断置信度 82%。'), true);
});

test('build-vs-buy rationale is localized to readable chinese text', () => {
  const text = buildVsBuyRationaleText('top_candidate_fit_and_fast_introduction');
  assert.equal(text, '已发现匹配度较高且落地周期短的方案，优先引入更高效。');
});

test('autonomy summary is readable for business users', () => {
  const text = autonomySummary({
    decision: 'introduce_oss',
    status: 'proposed_for_user_confirmation',
    autoDeploy: false,
    autoVerify: false
  });
  assert.equal(
    text,
    '建议引入开源方案；当前状态：已发起用户确认；自动部署：否，自动验收：否。'
  );
});

test('defer rationale explains that search happened but should not proceed', () => {
  const item = {
    recommendation: 'defer',
    evaluation: {
      candidateCount: 2,
      hardGate: { passed: false }
    }
  };
  assert.equal(retrievalStatusText(item), '已发起检索，找到 2 个候选，但门禁未通过');
  assert.equal(
    recommendationRationaleText(item),
    '已完成检索，虽然存在候选项目，但未通过安全/合规门禁，因此建议暂缓。'
  );
});

test('defer rationale does not claim no candidates when high-score candidate exists', () => {
  const item = {
    recommendation: 'defer',
    candidateEvaluations: [
      {
        scoreTotal: 100,
        hardGate: { passed: true }
      }
    ]
  };
  const text = recommendationRationaleText(item);
  assert.equal(text.includes('未找到可直接落地的候选方案'), false);
  assert.equal(text, '已完成检索，存在高匹配候选，但当前治理策略或证据不足，暂不直接推进。');
});
