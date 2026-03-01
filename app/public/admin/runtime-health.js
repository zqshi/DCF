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

  if (!riskItems.length) {
    riskItems.push('当前未发现显著风险点。');
  }

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

async function load() {
  try {
    const status = await api('/api/admin/runtime-status');
    setText('runtimeEnabled', status.runtimeEnabled ? 'YES' : 'NO');
    setText('runtimeProvider', status.runtimeProvider || '-');
    setText('dialogueEnabled', status.llm && status.llm.dialogueEnabled ? 'ON' : 'OFF');
    setText('researchQueued', status.queue ? status.queue.researchQueued : 0);
    setText('researchDone', status.queue ? status.queue.researchDone : 0);
    setText('employeesCount', status.counters ? status.counters.employees : 0);
    setText('tasksCount', status.counters ? status.counters.tasks : 0);
    setText('skillsCount', status.counters ? status.counters.skills : 0);
    setText('eventsCount', status.counters ? status.counters.events : 0);
    applyHealthConclusion(assessHealth(status));
  } catch (error) {
    applyHealthConclusion({
      level: 'fail',
      summary: '健康状态拉取失败，当前无法判定自动运行安全性。',
      action: '建议检查运行状态接口与网络可达性。',
      riskItems: [String(error && error.message ? error.message : 'unknown error')]
    });
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  await load();
  setInterval(load, 3000);
})();
