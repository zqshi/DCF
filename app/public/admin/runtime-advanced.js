async function api(path, options) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

let technicalPanelVisible = false;
let latestRuntimeSnapshot = null;
let latestBootstrapSnapshot = null;
let latestFrameworkSnapshot = null;

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function safeJson(value) {
  return JSON.stringify(value == null ? null : value, null, 2);
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatTime() {
  return new Date().toLocaleString();
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
  setInsightText('advancedUpdatedAt', `更新时间：${formatTime()}`);
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

async function load() {
  const [runtime, bootstrap, framework] = await Promise.all([
    api('/api/admin/runtime-status'),
    api('/api/admin/bootstrap-status'),
    api('/api/framework')
  ]);
  setText('runtimeNow', runtime.now || '-');
  setText('runtimeStorage', runtime.storage || '-');
  setText('executionEngine', framework && framework.engines ? framework.engines.execution : '-');
  latestRuntimeSnapshot = runtime;
  latestBootstrapSnapshot = bootstrap;
  latestFrameworkSnapshot = framework;
  renderBusinessInsights(runtime, bootstrap, framework);
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

(async () => {
  if (window.__adminReady) await window.__adminReady;
  bindEvents();
  await load();
  setInterval(load, 3000);
})();
