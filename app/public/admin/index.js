async function api(path) {
  if (window.adminApi) return window.adminApi(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function toPercent(value) {
  return `${Math.max(0, Number(value || 0))}%`;
}

function isNotFoundError(error) {
  const msg = String(error && error.message ? error.message : '').toLowerCase();
  return msg.includes('not found') || msg.includes('404');
}

function buildOverviewFromLegacy(runtime = {}, bootstrap = {}, metrics = {}) {
  const counters = runtime.counters || {};
  const queue = runtime.queue || {};
  const b = bootstrap || runtime.bootstrap || {};
  const tasksTotal = Number(counters.tasks || metrics.totalTasks || 0);
  const succeeded = Number(metrics.succeededTasks || 0);
  const failed = Number(metrics.failedTasks || 0);
  const inProgress = Math.max(0, tasksTotal - succeeded - failed);
  const waitingApprovalTasks = 0;
  const compensationPendingTasks = 0;
  const rollbackTasks = 0;
  const p1Incidents = Number(metrics.p1Incidents || 0);
  return {
    delivery: {
      employeesTotal: Number(counters.employees || 0),
      totalTasks: tasksTotal,
      succeededTasks: succeeded,
      failedTasks: failed,
      inProgressTasks: inProgress,
      successRate: Number(metrics.successRate || 0)
    },
    governance: {
      waitingApprovalTasks,
      compensationPendingTasks,
      rollbackTasks,
      p1Incidents
    },
    assets: {
      skillsTotal: Number(counters.skills || 0),
      findingsTotal: Number(counters.findings || 0),
      skillReused: Number(metrics.skillReused || 0),
      recurrenceErrors: Number(metrics.recurrenceErrors || 0)
    },
    runtime: {
      runtimeEnabled: runtime.runtimeEnabled === true,
      dialogueEnabled: !!(runtime.llm && runtime.llm.dialogueEnabled),
      queueQueued: Number(queue.researchQueued || 0),
      queueDone: Number(queue.researchDone || 0),
      backlog: Math.max(Number(queue.researchQueued || 0) - Number(queue.researchDone || 0), 0),
      phase: String(b.phase || '-'),
      cycleCount: Number(b.cycleCount || 0),
      manualReviewRequired: !!b.manualReviewRequired
    },
    focus: [
      inProgress > 0
        ? `交付跟进：当前有 ${inProgress} 项任务在执行链路中。`
        : '交付跟进：当前无进行中任务，可安排新一轮任务编排。',
      `治理态势：审批待处理 ${waitingApprovalTasks} 项，补偿待处理 ${compensationPendingTasks} 项，P1 事件 ${p1Incidents} 项。`,
      Number(metrics.skillReused || 0) > 0
        ? `能力复用：技能已复用 ${Number(metrics.skillReused || 0)} 次，建议继续沉淀高频模式。`
        : '能力复用：尚未形成有效复用记录，建议优先固化高频技能。'
    ]
  };
}

async function loadOverview() {
  try {
    return await api('/api/admin/overview');
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    const [runtime, bootstrap, metrics] = await Promise.all([
      api('/api/admin/runtime-status'),
      api('/api/admin/bootstrap-status'),
      api('/api/metrics')
    ]);
    return buildOverviewFromLegacy(runtime, bootstrap, metrics);
  }
}

function renderList(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<div class="overview-item">暂无数据</div>';
    return;
  }
  el.innerHTML = items.map((item) => `<div class="overview-item">${item}</div>`).join('');
}

(async () => {
  try {
    if (window.__adminReady) await window.__adminReady;
    const overview = await loadOverview();
    const delivery = overview.delivery || {};
    const governance = overview.governance || {};
    const assets = overview.assets || {};
    const runtime = overview.runtime || {};

    setText('employeesTotal', delivery.employeesTotal || 0);
    setText('tasksTotal', delivery.totalTasks || 0);
    setText('successRate', toPercent(delivery.successRate || 0));
    setText('approvalPendingTotal', governance.waitingApprovalTasks || 0);

    setText('tasksInProgress', delivery.inProgressTasks || 0);
    setText('compensationPending', governance.compensationPendingTasks || 0);
    setText('rollbackCount', governance.rollbackTasks || 0);
    setText('p1IncidentCount', governance.p1Incidents || 0);

    const summary = [
      `当前共有 ${delivery.employeesTotal || 0} 位数字员工参与执行，累计处理 ${delivery.totalTasks || 0} 项任务。`,
      `任务交付成功率 ${toPercent(delivery.successRate || 0)}，当前进行中 ${delivery.inProgressTasks || 0} 项。`,
      `已沉淀技能 ${assets.skillsTotal || 0} 项，开源候选 ${assets.findingsTotal || 0} 项。`
    ].join(' ');
    setText('summary', summary);

    const manualReview = runtime.manualReviewRequired ? '需要人工介入' : '可自动推进';
    const headline = `阶段 ${runtime.phase || '-'} · 周期 ${runtime.cycleCount || 0} · ${manualReview}`;
    setText('bootstrapHeadline', headline);

    renderList('bootstrapChecklist', [
      `运行链路：Runtime ${runtime.runtimeEnabled ? '已启用' : '未启用'} / 对话网关 ${runtime.dialogueEnabled ? '已启用' : '未启用'}`,
      `研究队列：待处理 ${runtime.queueQueued || 0} / 已完成 ${runtime.queueDone || 0} / 积压 ${runtime.backlog || 0}`,
      `治理风险：审批待处理 ${governance.waitingApprovalTasks || 0} / 补偿待处理 ${governance.compensationPendingTasks || 0}`
    ]);

    const qualityItems = [
      `成功任务：${delivery.succeededTasks || 0}，失败任务：${delivery.failedTasks || 0}`,
      `复发错误累计：${Number(assets.recurrenceErrors || 0)}`,
      `技能复用次数：${Number(assets.skillReused || 0)}`,
      `P1 风险事件累计：${Number(governance.p1Incidents || 0)}`
    ];
    renderList('qualityList', qualityItems);

    renderList('focusList', Array.isArray(overview.focus) ? overview.focus : []);
  } catch (error) {
    setText('summary', '数据加载失败，请检查登录状态或权限配置。');
    setText('bootstrapHeadline', String(error && error.message ? error.message : '加载失败'));
    renderList('bootstrapChecklist', []);
    renderList('qualityList', []);
    renderList('focusList', []);
  }
})();
