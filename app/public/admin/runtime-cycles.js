async function api(path) {
  if (window.adminApi) return window.adminApi(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

const CHECK_META = {
  successPass: {
    label: '执行成功率达到阈值（>=85%）',
    failedReason: '执行成功率未达到阈值',
    action: '优先排查失败任务并修复高频失败路径。'
  },
  noP1: {
    label: 'P1 风险事件为 0',
    failedReason: '出现 P1 风险事件',
    action: '立即处理 P1 事件并完成风险复盘。'
  },
  recurrenceDown: {
    label: '复发错误下降',
    failedReason: '复发错误未下降',
    action: '识别重复故障根因，优先做去重治理。'
  },
  reuseUp: {
    label: '技能复用上升',
    failedReason: '技能复用未上升',
    action: '补齐高频任务的技能沉淀，提升复用率。'
  }
};

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function formatTime() {
  return new Date().toLocaleString();
}

function passBadge(ok) {
  if (ok === true) return '<span class="badge ok">通过</span>';
  if (ok === false) return '<span class="badge fail">未通过</span>';
  return '<span class="badge warn">无数据</span>';
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function renderGateChecks(bootstrap) {
  const latest = Array.isArray(bootstrap.history) && bootstrap.history.length ? bootstrap.history[bootstrap.history.length - 1] : null;
  if (!latest || !latest.gate || !latest.gate.checks) return '<div>暂无周期门槛判定数据</div>';
  const checks = latest.gate.checks;
  return `
    <div class="gate-row"><span>${CHECK_META.successPass.label}</span>${passBadge(checks.successPass)}</div>
    <div class="gate-row"><span>${CHECK_META.noP1.label}</span>${passBadge(checks.noP1)}</div>
    <div class="gate-row"><span>${CHECK_META.recurrenceDown.label}</span>${passBadge(checks.recurrenceDown)}</div>
    <div class="gate-row"><span>${CHECK_META.reuseUp.label}</span>${passBadge(checks.reuseUp)}</div>
    <div class="gate-row"><span>自动推进总判定</span>${passBadge(latest.gate.passed)}</div>
  `;
}

function formatTrend(current, previous) {
  const curr = asNumber(current);
  if (previous == null) return '—';
  const prev = asNumber(previous);
  const diff = curr - prev;
  if (diff > 0) return `↑ ${diff.toFixed(1)}`;
  if (diff < 0) return `↓ ${Math.abs(diff).toFixed(1)}`;
  return '→ 0';
}

function renderCycleRows(bootstrap) {
  const rowsEl = document.getElementById('cycleRows');
  const historyAll = Array.isArray(bootstrap.history) ? bootstrap.history : [];
  const history = historyAll.slice(-5).reverse();
  if (!history.length) {
    rowsEl.innerHTML = '<tr><td colspan="8" class="empty">暂无周期记录</td></tr>';
    return;
  }
  rowsEl.innerHTML = history.map((item, index) => `
    <tr>
      <td>${(bootstrap.cycleCount || history.length) - index}</td>
      <td>${item.phase || '-'}</td>
      <td>${asNumber(item.successRate).toFixed(1)}%</td>
      <td>${item.delta ? asNumber(item.delta.p1Incidents) : 0}</td>
      <td>${item.delta ? asNumber(item.delta.recurrenceErrors) : 0}</td>
      <td>${item.delta ? asNumber(item.delta.skillReused) : 0}</td>
      <td>${item.gate && item.gate.passed ? '<span class="badge ok">自动推进</span>' : '<span class="badge warn">纠偏处理</span>'}</td>
      <td>${formatTrend(item.successRate, history[index + 1] ? history[index + 1].successRate : null)}</td>
    </tr>
  `).join('');
}

async function load() {
  try {
    const bootstrap = await api('/api/admin/bootstrap-status');
    setText('cycleCount', bootstrap.cycleCount || 0);
    setText('phase', bootstrap.phase || '-');
    setText('manualReview', bootstrap.manualReviewRequired ? '需要介入' : '自动可控');
    applyCycleDecision(bootstrap);
    document.getElementById('gateChecks').innerHTML = renderGateChecks(bootstrap);
    renderCycleRows(bootstrap);
  } catch (error) {
    const message = String(error && error.message ? error.message : 'unknown error');
    setText('cycleDecisionSummary', '周期状态拉取失败，当前无法给出放行判断。');
    setText('cycleDecisionReason', `主因：${message}`);
    setText('cycleDecisionAction', '建议动作：检查 bootstrap 状态接口后重试。');
    setText('cycleUpdatedAt', `更新时间：${formatTime()}`);
    document.getElementById('gateChecks').innerHTML = `<span class="badge fail">${message}</span>`;
    document.getElementById('cycleRows').innerHTML = '<tr><td colspan="8" class="empty">周期数据加载失败</td></tr>';
    document.getElementById('cycleFailedChecks').innerHTML = `<li>${message}</li>`;
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  await load();
  setInterval(load, 3000);
})();
