async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

function escapeHtml(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value || '-');
}

function formatDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function parseTaskId() {
  const params = new URLSearchParams(window.location.search || '');
  return String(params.get('taskId') || '').trim();
}

function formatJson(value) {
  if (!value) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderSummary(task) {
  const runtime = task && task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
  const runtimeCfg = task && task.runtimeConfig && typeof task.runtimeConfig === 'object' ? task.runtimeConfig : {};
  const cards = [
    ['trace_id', task.traceId || '-'],
    ['employee_id', task.employeeId || '-'],
    ['parent_agent_id', task.parentAgentId || '-'],
    ['runtime.taskId', runtime.taskId || '-'],
    ['runtime.source', runtime.source || '-'],
    ['agent_id', runtimeCfg.agentId || '-'],
    ['policy_id', runtimeCfg.policyId || '-'],
    ['tool_scope', Array.isArray(runtimeCfg.toolScope) ? runtimeCfg.toolScope.join(', ') : '-']
  ];
  const html = cards.map(([label, value]) => (
    `<div class="insight-item"><span class="mono">${escapeHtml(label)}</span><strong class="mono">${escapeHtml(value)}</strong></div>`
  )).join('');
  const grid = document.getElementById('summaryGrid');
  if (grid) grid.innerHTML = html;
}

function renderTimeline(task) {
  const tbody = document.getElementById('timelineRows');
  const logs = Array.isArray(task.logs) ? task.logs : [];
  const timeline = logs
    .filter((event) => String((event && event.type) || '').startsWith('task.'))
    .sort((a, b) => Date.parse(String(a.at || '')) - Date.parse(String(b.at || '')));
  if (!timeline.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">无状态机记录</td></tr>';
    return;
  }
  tbody.innerHTML = timeline.slice(-80).map((event) => {
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
    const note = String(payload.note || payload.reason || payload.message || '').trim() || '-';
    return `<tr><td>${escapeHtml(formatDateTime(event.at))}</td><td>${escapeHtml(event.type || '-')}</td><td>${escapeHtml(note)}</td></tr>`;
  }).join('');
}

function renderRuntime(task) {
  const tbody = document.getElementById('runtimeRows');
  const runtime = task && task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
  const events = Array.isArray(runtime.events) ? runtime.events : [];
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">无 runtime 事件</td></tr>';
    return;
  }
  tbody.innerHTML = events.slice(-120).map((event) => (
    `<tr><td>${escapeHtml(formatDateTime(event && event.at))}</td><td>${escapeHtml((event && event.type) || '-')}</td><td class="mono">${escapeHtml((event && event.id) || '-')}</td></tr>`
  )).join('');
}

function renderApproval(task) {
  const wrap = document.getElementById('approvalWrap');
  const approval = task && task.approval && typeof task.approval === 'object' ? task.approval : {};
  const approvals = Array.isArray(approval.approvals) ? approval.approvals : [];
  if (!approvals.length) {
    wrap.innerHTML = '<div class="toolbar-note">暂无审批记录</div>';
    return;
  }
  const rows = approvals.map((item) => (
    `<tr><td>${escapeHtml(item.approverRole || '-')}</td><td>${escapeHtml(item.approverId || '-')}</td><td>${escapeHtml(formatDateTime(item.approvedAt))}</td><td>${escapeHtml(item.note || '-')}</td></tr>`
  )).join('');
  wrap.innerHTML = `<table><thead><tr><th>角色</th><th>审批人</th><th>时间</th><th>意见</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCompensation(task) {
  const pre = document.getElementById('compensationPre');
  pre.textContent = formatJson(task.compensation || null);
}

async function main() {
  const taskId = parseTaskId();
  if (!taskId) {
    document.getElementById('summaryGrid').innerHTML = '<div class="empty">缺少 taskId 参数</div>';
    return;
  }
  const task = await api(`/api/admin/tasks/${encodeURIComponent(taskId)}`);
  setText('taskIdStat', task.id || '-');
  setText('taskStatusStat', task.status || '-');
  setText('riskLevelStat', task.riskLevel || '-');
  renderSummary(task);
  renderTimeline(task);
  renderRuntime(task);
  renderApproval(task);
  renderCompensation(task);

  const reportBtn = document.getElementById('downloadRollbackReportBtn');
  const packageBtn = document.getElementById('downloadRollbackPackageBtn');
  if (reportBtn) {
    reportBtn.addEventListener('click', async () => {
      const data = await api(`/api/admin/tasks/${encodeURIComponent(taskId)}/rollback-report`);
      downloadJson(data, `rollback-report-${taskId}.json`);
    });
  }
  if (packageBtn) {
    packageBtn.addEventListener('click', async () => {
      const data = await api(`/api/admin/tasks/${encodeURIComponent(taskId)}/rollback-package`);
      downloadJson(data, `rollback-package-${taskId}.json`);
    });
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  try {
    await main();
  } catch (error) {
    document.getElementById('summaryGrid').innerHTML = `<div class="empty">加载失败：${escapeHtml(error.message)}</div>`;
  }
})();
