async function api(path) {
  if (window.adminApi) return window.adminApi(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

const HEALTH_THRESHOLDS = {
  highQueue: 50,
  highBacklog: 20,
  mediumBacklog: 10,
  queueToDoneRatio: 3
};

const CHECK_META = {
  successPass: {
    failedReason: '执行成功率未达到阈值',
    action: '优先排查失败任务并修复高频失败路径。'
  },
  noP1: {
    failedReason: '出现 P1 风险事件',
    action: '立即处理 P1 事件并完成风险复盘。'
  },
  recurrenceDown: {
    failedReason: '复发错误未下降',
    action: '识别重复故障根因，优先做去重治理。'
  },
  reuseUp: {
    failedReason: '技能复用未上升',
    action: '补齐高频任务的技能沉淀，提升复用率。'
  }
};

let technicalPanelVisible = false;
let latestRuntimeSnapshot = null;
let latestBootstrapSnapshot = null;
let latestFrameworkSnapshot = null;

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function setHtml(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = String(html);
}

function formatTime() {
  return new Date().toLocaleString();
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeJson(value) {
  return JSON.stringify(value == null ? null : value, null, 2);
}

function renderBootstrapSummary(runtime, bootstrap) {
  const b = bootstrap || runtime.bootstrap || {};
  return `
    <div><span>运行阶段</span><strong>${b.phase || '-'}</strong></div>
    <div><span>调度模式</span><strong>${b.mode || '-'}</strong></div>
    <div><span>诊断周期</span><strong>${b.cycleCount || 0}</strong></div>
    <div><span>连续停滞</span><strong>${b.stagnantCycles || 0}</strong></div>
    <div><span>人工介入需求</span>${b.manualReviewRequired ? '<span class="badge fail">需要人工介入</span>' : '<span class="badge ok">无需人工介入</span>'}</div>
  `;
}

function assessHealth(status) {
  const queue = status.queue || {};
  const counters = status.counters || {};
  const queued = Number(queue.researchQueued || 0);
  const done = Number(queue.researchDone || 0);
  const runtimeEnabled = status.runtimeEnabled === true;
  const dialogueEnabled = !!(status.llm && status.llm.dialogueEnabled);
  const backlog = Math.max(queued - done, 0);
  const riskItems = [];

  let score = 0;
  let summary = '运行稳定，当前可以维持自动处理。';
  let action = '继续观察，并保持自动运行。';

  if (!runtimeEnabled) {
    score += 100;
    riskItems.push('Runtime 未启用，自动处理链路不可用。');
  }

  if (runtimeEnabled && !dialogueEnabled) {
    score += 100;
    riskItems.push('对话网关未启用，任务交互可能失败。');
  }

  if (runtimeEnabled && dialogueEnabled) {
    if (
      queued >= HEALTH_THRESHOLDS.highQueue ||
      backlog >= HEALTH_THRESHOLDS.highBacklog ||
      (done > 0 && queued > done * HEALTH_THRESHOLDS.queueToDoneRatio)
    ) {
      score += 50;
      riskItems.push(`当前任务积压 ${backlog}，可能影响周期推进效率。`);
    } else if (backlog >= HEALTH_THRESHOLDS.mediumBacklog) {
      score += 20;
      riskItems.push(`当前任务积压 ${backlog}，建议持续观察。`);
    }
  }

  if (queued > 0 && done === 0) {
    riskItems.push('存在待处理任务但暂无完成记录，请排查执行链路。');
  }

  if (counters.tasks > 0 && counters.skills === 0) {
    riskItems.push('任务规模已形成但技能沉淀为 0，复用效率可能偏低。');
  }

  if (!riskItems.length) riskItems.push('当前未发现显著风险点。');

  let level = 'ok';
  if (score >= 100) {
    level = 'fail';
    summary = '当前存在高风险，自动推进能力不足。';
    action = '立即人工介入，先恢复关键链路后再观察。';
  } else if (score >= 20) {
    level = 'warn';
    summary = '当前存在中等风险，系统进入重点观察状态。';
    action = '建议观察 1 个周期；若未缓解，转人工处理。';
  }

  return { level, summary, action, riskItems };
}

function applyHealthConclusion(assessment) {
  const badge = document.getElementById('healthBadge');
  if (badge) {
    badge.className = `badge ${assessment.level === 'ok' ? 'ok' : assessment.level === 'warn' ? 'warn' : 'fail'}`;
    badge.textContent = assessment.level === 'ok' ? '正常' : assessment.level === 'warn' ? '关注' : '告警';
  }
  setText('healthSummary', assessment.summary);
  setText('healthAction', `建议动作：${assessment.action}`);
  setText('healthUpdatedAt', `更新时间：${formatTime()}`);
  setHtml('healthRiskList', assessment.riskItems.map((item) => `<li>${item}</li>`).join(''));
}

function deriveFailureReason(latest) {
  const checks = latest && latest.gate && latest.gate.checks ? latest.gate.checks : {};
  if (checks.noP1 === false) return CHECK_META.noP1.failedReason;
  if (checks.successPass === false) return CHECK_META.successPass.failedReason;
  if (checks.recurrenceDown === false) return CHECK_META.recurrenceDown.failedReason;
  if (checks.reuseUp === false) return CHECK_META.reuseUp.failedReason;
  return '门槛信息不足，建议检查周期采集数据';
}

function collectFailedChecks(latest) {
  const checks = latest && latest.gate && latest.gate.checks ? latest.gate.checks : {};
  const order = ['noP1', 'successPass', 'recurrenceDown', 'reuseUp'];
  return order
    .filter((key) => checks[key] === false)
    .map((key) => ({ key, ...CHECK_META[key] }));
}

function setFailedChecksList(latest) {
  const node = document.getElementById('cycleFailedChecks');
  if (!node) return;
  const failed = collectFailedChecks(latest);
  if (!failed.length) {
    node.innerHTML = '<li>本周期关键检查项均已通过。</li>';
    return;
  }
  node.innerHTML = failed.map((item) => `<li>${item.failedReason}</li>`).join('');
}

function applyCycleDecision(bootstrap) {
  const history = Array.isArray(bootstrap.history) ? bootstrap.history : [];
  const latest = history.length ? history[history.length - 1] : null;
  const manualReviewRequired = !!bootstrap.manualReviewRequired;
  const passed = !!(latest && latest.gate && latest.gate.passed);
  const badge = document.getElementById('cycleDecisionBadge');
  const reason = passed ? '已满足自动推进门槛' : deriveFailureReason(latest);

  if (badge) {
    let level = 'warn';
    let label = '观察';
    if (passed && !manualReviewRequired) {
      level = 'ok';
      label = '通过';
    } else if (!passed && manualReviewRequired) {
      level = 'fail';
      label = '未通过';
    }
    badge.className = `badge ${level}`;
    badge.textContent = label;
  }

  setText('cycleDecisionSummary', passed ? '本周期可自动推进。' : '本周期未通过自动推进。');
  setText('cycleDecisionReason', `主因：${reason}`);
  const failedChecks = collectFailedChecks(latest);
  const failedAction = failedChecks.length ? failedChecks[0].action : '保持当前策略并持续观测。';
  setText('cycleDecisionAction', passed ? '建议动作：继续自动推进，并观察下一周期表现。' : `建议动作：${failedAction}`);
  setText('cycleUpdatedAt', `更新时间：${formatTime()}`);
  setFailedChecksList(latest);
}

function phaseExplain(phase) {
  const key = String(phase || '').toLowerCase();
  if (key === 'stabilizing') return '系统处于稳定化阶段，关注持续性。';
  if (key === 'exploring') return '系统处于探索阶段，允许一定波动。';
  if (key === 'optimizing') return '系统处于优化阶段，关注效率提升。';
  return `当前阶段：${phase || '未知'}。`;
}

function setInsightText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value || '-');
}

function renderBusinessInsights(runtime, bootstrap, framework) {
  const queue = runtime && runtime.queue ? runtime.queue : {};
  const policy = runtime && runtime.skillSedimentationPolicy ? runtime.skillSedimentationPolicy : {};
  const runtimeEnabled = runtime && runtime.runtimeEnabled === true;
  const dialogueEnabled = !!(runtime && runtime.llm && runtime.llm.dialogueEnabled);
  const queued = asNumber(queue.researchQueued);
  const done = asNumber(queue.researchDone);
  const backlog = Math.max(queued - done, 0);

  let runtimeHealth = '正常：关键链路可用';
  if (!runtimeEnabled) runtimeHealth = '告警：Runtime 未启用';
  else if (!dialogueEnabled) runtimeHealth = '告警：对话网关不可用';
  else if (backlog >= 20) runtimeHealth = '关注：任务积压偏高';

  let queuePressure = `低：待处理 ${queued}`;
  if (backlog >= 20 || queued >= 50) queuePressure = `高：积压 ${backlog}，需关注吞吐`;
  else if (backlog >= 10) queuePressure = `中：积压 ${backlog}`;

  const manualExplain = bootstrap && bootstrap.manualReviewRequired
    ? '建议人工介入：当前周期存在不可自动放行因素'
    : '自动可控：当前无需人工介入';

  const execution = framework && framework.engines ? framework.engines.execution : '-';
  const engineExplain = execution && execution !== '-'
    ? `当前执行引擎：${execution}`
    : '执行引擎信息缺失';

  const minConfidence = asNumber(policy.minConfidence, 0.7);
  const fallback = policy.fallbackToRulesWhenModelUnavailable === false ? '关闭' : '开启';
  let policyRisk = '低：当前策略平衡';
  if (minConfidence < 0.6) policyRisk = '中：置信度阈值偏低，可能引入噪声';
  if (minConfidence >= 0.9 && fallback === '关闭') policyRisk = '高：策略过严且无回退，可能阻塞沉淀';

  setInsightText('advRuntimeHealth', runtimeHealth);
  setInsightText('advQueuePressure', queuePressure);
  setInsightText('advPhaseExplain', phaseExplain(bootstrap && bootstrap.phase));
  setInsightText('advManualExplain', manualExplain);
  setInsightText('advEngineExplain', engineExplain);
  setInsightText('advPolicyRisk', policyRisk);
  setText('advancedUpdatedAt', `更新时间：${formatTime()}`);
}

function renderTechnicalSnapshotsIfVisible() {
  if (!technicalPanelVisible) return;
  const runtimeNode = document.getElementById('runtimeJson');
  const bootstrapNode = document.getElementById('bootstrapJson');
  const frameworkNode = document.getElementById('frameworkJson');
  if (runtimeNode) runtimeNode.textContent = safeJson(latestRuntimeSnapshot);
  if (bootstrapNode) bootstrapNode.textContent = safeJson(latestBootstrapSnapshot);
  if (frameworkNode) frameworkNode.textContent = safeJson(latestFrameworkSnapshot);
}

function setTechnicalPanelVisible(visible) {
  technicalPanelVisible = !!visible;
  const panel = document.getElementById('advancedTechnicalPanel');
  const toggleBtn = document.getElementById('toggleTechnicalDetailsBtn');
  if (panel) panel.classList.toggle('hidden', !technicalPanelVisible);
  if (toggleBtn) toggleBtn.textContent = technicalPanelVisible ? '隐藏技术快照' : '查看技术快照（只读）';
  renderTechnicalSnapshotsIfVisible();
}

function bindEvents() {
  const toggleTechBtn = document.getElementById('toggleTechnicalDetailsBtn');
  if (toggleTechBtn) {
    toggleTechBtn.addEventListener('click', () => {
      setTechnicalPanelVisible(!technicalPanelVisible);
    });
  }
  const hideTechBtn = document.getElementById('hideTechnicalDetailsBtn');
  if (hideTechBtn) {
    hideTechBtn.addEventListener('click', () => setTechnicalPanelVisible(false));
  }
}

function applySectionFromQuery() {
  const params = new URLSearchParams(window.location.search || '');
  const section = String(params.get('section') || '').trim().toLowerCase();
  const sectionIdMap = {
    health: 'section-health',
    cycle: 'section-cycle',
    advanced: 'section-advanced'
  };
  const targetId = sectionIdMap[section];
  if (!targetId) return;
  const node = document.getElementById(targetId);
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyLoadError(message) {
  const text = String(message || 'unknown error');
  setText('manualValue', '数据异常');
  setHtml('bootstrapSummary', `<span class="badge fail">${text}</span>`);
  applyHealthConclusion({
    level: 'fail',
    summary: '健康状态拉取失败，当前无法判定自动运行安全性。',
    action: '建议检查运行状态接口与网络可达性。',
    riskItems: [text]
  });
  setText('cycleDecisionSummary', '周期状态拉取失败，当前无法给出放行判断。');
  setText('cycleDecisionReason', `主因：${text}`);
  setText('cycleDecisionAction', '建议动作：检查 bootstrap 状态接口后重试。');
  setText('cycleUpdatedAt', `更新时间：${formatTime()}`);
  setText('advRuntimeHealth', `异常：${text}`);
  setText('advancedUpdatedAt', `更新时间：${formatTime()}`);
}

async function load() {
  try {
    const [runtimeResult, bootstrapResult, frameworkResult] = await Promise.allSettled([
      api('/api/admin/runtime-status'),
      api('/api/admin/bootstrap-status'),
      api('/api/framework')
    ]);

    if (runtimeResult.status !== 'fulfilled') throw runtimeResult.reason;
    if (bootstrapResult.status !== 'fulfilled') throw bootstrapResult.reason;

    const runtime = runtimeResult.value;
    const bootstrap = bootstrapResult.value;
    const framework = frameworkResult.status === 'fulfilled' ? frameworkResult.value : {};

    const b = bootstrap || runtime.bootstrap || {};
    setText('phaseValue', b.phase || '-');
    setText('cycleValue', String(b.cycleCount || 0));
    setText('manualValue', b.manualReviewRequired ? '需要介入' : '自动可控');
    setHtml('bootstrapSummary', renderBootstrapSummary(runtime, bootstrap));

    applyHealthConclusion(assessHealth(runtime));
    applyCycleDecision(bootstrap);

    latestRuntimeSnapshot = runtime;
    latestBootstrapSnapshot = bootstrap;
    latestFrameworkSnapshot = framework;
    renderBusinessInsights(runtime, bootstrap, framework);
    renderTechnicalSnapshotsIfVisible();
  } catch (error) {
    applyLoadError(error && error.message ? error.message : String(error || '加载失败'));
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  bindEvents();
  await load();
  applySectionFromQuery();
  setInterval(load, 3000);
})();
