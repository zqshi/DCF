async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

const state = {
  selectedTaskId: null,
  detailByTaskId: new Map(),
  loadingDetails: new Set()
};

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function escapeHtml(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortId(id, size = 8) {
  const value = String(id || '').trim();
  if (!value) return '-';
  return value.length > size ? value.slice(0, size) : value;
}

function copyButton(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return `<button class="btn-link copy-btn" data-copy="${escapeHtml(raw)}">复制</button>`;
}

function formatDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatTaskStatus(task) {
  const status = String((task && task.status) || '').trim().toLowerCase();
  if (status === 'pending') return '待校验';
  if (status === 'validating') return '校验中';
  if (status === 'approved') return '审批通过，待执行';
  if (status === 'running') return '执行中';
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '执行失败';
  if (status === 'rolled_back') return '已回滚';
  if (status === 'aborted') return '已中止';
  return status || '-';
}

function toText(value, fallback = '-') {
  const text = String(value || '').trim();
  return text || fallback;
}

function approvalProgress(task) {
  const approval = task && task.approval && typeof task.approval === 'object' ? task.approval : {};
  const done = Array.isArray(approval.approvals) ? approval.approvals.length : 0;
  const required = Number(approval.requiredApprovals || 0);
  const roles = Array.isArray(approval.requiredAnyRoles) && approval.requiredAnyRoles.length
    ? `；需角色：${approval.requiredAnyRoles.join(' / ')}`
    : '';
  if (!task.requiresApproval) return '自动审批';
  return `人工审批 ${done}/${required}${roles}`;
}

function compensationStatusText(task) {
  const status = String((((task || {}).compensation || {}).status || '')).trim().toLowerCase();
  if (!status) return '无补偿';
  const map = {
    queued: '排队中',
    running: '执行中',
    succeeded: '已完成',
    failed: '失败',
    dead_letter: '死信',
    deferred: '待重试'
  };
  return map[status] || status;
}

function getOwnerRole(task) {
  const status = String((task && task.status) || '').trim().toLowerCase();
  const approval = task && task.approval && typeof task.approval === 'object' ? task.approval : {};
  const roles = Array.isArray(approval.requiredAnyRoles) ? approval.requiredAnyRoles.filter(Boolean) : [];
  const compensationStatus = String((((task || {}).compensation || {}).status || '')).trim().toLowerCase();
  if (task && task.requiresApproval && ['validating', 'approved'].includes(status)) return roles.length ? roles.join(' / ') : '治理审批';
  if (['queued', 'running', 'failed', 'dead_letter', 'deferred'].includes(compensationStatus)) return '补偿处理';
  if (task && task.rollback) return '治理Owner';
  return '-';
}

function getGovernanceLastActionAt(task, detailTask = null) {
  const source = detailTask || task;
  const logs = Array.isArray((source || {}).logs) ? source.logs : [];
  const governanceTypes = new Set([
    'task.approval.required',
    'task.approved',
    'task.rollback.triggered',
    'task.rolled_back',
    'integration.compensation.queued',
    'integration.compensation.running',
    'integration.compensation.succeeded',
    'integration.compensation.retry_scheduled',
    'integration.compensation.dead_lettered',
    'integration.compensation.deferred',
    'integration.compensation.retry_requested'
  ]);
  const latest = logs
    .filter((event) => governanceTypes.has(String((event && event.type) || '').trim()))
    .map((event) => String(event.at || '').trim())
    .filter(Boolean)
    .sort()
    .pop();
  return latest || task.updatedAt || task.createdAt || null;
}

function describeGoal(task) {
  const goal = toText(task && task.goal, '-');
  const goalLower = goal.toLowerCase();
  let interpreted = '';
  if (goalLower.includes('create payment update')) interpreted = '更新支付/财务记录';
  else if (goalLower.includes('high risk reject flow')) interpreted = '高风险任务在前台被驳回并触发治理流程';
  else if (goalLower.includes('high risk approval flow')) interpreted = '高风险任务走人工审批后执行';
  else if (goalLower.includes('payment')) interpreted = '涉及支付或财务变更';
  else if (goalLower.includes('approval')) interpreted = '涉及审批流程';
  else if (goalLower.includes('reject')) interpreted = '涉及驳回/回滚流程';
  const interpretationText = interpreted ? interpreted : '常规业务任务';
  const mode = task && task.requiresApproval ? '需人工审批流程' : '自动审批流程';
  return `业务意图：${interpretationText}（${mode}）`;
}

function describeGoalRaw(task) {
  return `原始目标：${toText(task && task.goal, '-')}`;
}

function describeWhatHappened(task) {
  const status = String((task && task.status) || '').trim().toLowerCase();
  if (status === 'rolled_back') return '任务执行后已触发回滚，结果已撤销';
  if (status === 'failed') return '任务执行失败，未达到预期结果';
  if (status === 'running') return '任务正在执行中';
  if (status === 'validating') return '任务处于校验/审批阶段';
  if (status === 'approved') return '审批已通过，等待执行';
  if (status === 'succeeded') return '任务执行成功并完成';
  if (status === 'aborted') return '任务被人工中止';
  return '任务状态更新中';
}

function describeWhyHappened(task) {
  const rollbackReason = toText(task && task.rollback && task.rollback.reason, '');
  if (rollbackReason) return `回滚原因：${rollbackReason}`;
  const err = toText(task && task.lastError && task.lastError.message, '');
  if (err) return `失败原因：${err}`;
  if (task && task.requiresApproval) {
    const approval = task.approval && typeof task.approval === 'object' ? task.approval : {};
    const requiredRoles = Array.isArray(approval.requiredAnyRoles) ? approval.requiredAnyRoles.filter(Boolean) : [];
    if (requiredRoles.length) return `治理策略要求人工审批角色：${requiredRoles.join(' / ')}`;
    return '治理策略要求人工审批后才能执行';
  }
  return '未触发异常，按默认流程执行';
}

function describeRollback(task) {
  if (!task || !task.rollback) return '未触发回滚';
  const reason = toText(task.rollback.reason, '未记录回滚原因');
  const modeText = toText(task.rollback.mode, 'manual');
  const by = task.rollback.by && typeof task.rollback.by === 'object' ? task.rollback.by : {};
  const role = toText(by.role, '');
  const userId = toText(by.userId, '');
  const actor = role || userId ? `；执行人：${toText(role, 'role?')}${userId ? `@${userId}` : ''}` : '';
  return `已回滚（模式：${modeText}；原因：${reason}${actor}）`;
}

function describeCompensation(task) {
  const compensation = task && task.compensation && typeof task.compensation === 'object' ? task.compensation : null;
  if (!compensation) return '无补偿动作（未涉及外部写入或无需反向修复）';
  const status = String(compensation.status || '').trim().toLowerCase();
  const action = toText(compensation.action, '未记录动作');
  const system = toText(compensation.system, '未知系统');
  const operation = toText(compensation.operation, '未知操作');
  const attempts = Number(compensation.attempts || 0);
  const nextRetryAt = compensation.nextRetryAt ? `；下次重试：${formatDateTime(compensation.nextRetryAt)}` : '';
  const error = compensation.lastError ? `；失败原因：${toText(compensation.lastError)}` : '';
  if (status === 'queued') return `补偿排队中：将执行 ${action}（系统：${system}，操作：${operation}）${nextRetryAt}${error}`;
  if (status === 'running') return `补偿执行中：正在执行 ${action}（系统：${system}，操作：${operation}），已尝试 ${attempts} 次`;
  if (status === 'succeeded') return `补偿已完成：已执行 ${action}（系统：${system}，操作：${operation}）`;
  if (status === 'dead_letter') return `补偿失败并进入人工处理队列：动作 ${action}（已尝试 ${attempts} 次）${error}`;
  if (status === 'failed') return `补偿失败：动作 ${action}${error}`;
  return `补偿状态 ${status || '-'}：动作 ${action}${error}`;
}

function incidentSignals(task) {
  const tags = [];
  const status = String((task && task.status) || '').trim().toLowerCase();
  if (task && task.requiresApproval && ['validating', 'approved'].includes(status)) {
    tags.push({ label: '待审批', tone: 'warn', priority: 2 });
  }
  if (status === 'failed') tags.push({ label: '执行失败', tone: 'fail', priority: 3 });
  if (task && task.rollback) tags.push({ label: '已回滚', tone: 'warn', priority: 3 });
  const compensationStatus = String((((task || {}).compensation || {}).status || '')).trim().toLowerCase();
  if (['queued', 'running', 'failed', 'dead_letter', 'deferred'].includes(compensationStatus)) {
    if (compensationStatus === 'dead_letter') tags.push({ label: '补偿死信', tone: 'fail', priority: 4 });
    else if (compensationStatus === 'failed') tags.push({ label: '补偿失败', tone: 'fail', priority: 4 });
    else if (compensationStatus === 'queued') tags.push({ label: '补偿排队', tone: 'warn', priority: 2 });
    else if (compensationStatus === 'running') tags.push({ label: '补偿处理中', tone: 'info', priority: 1 });
    else tags.push({ label: '补偿待重试', tone: 'warn', priority: 2 });
  }
  if (!tags.length) tags.push({ label: '正常', tone: 'ok', priority: 0 });
  return tags;
}

function taskPriority(task) {
  const signals = incidentSignals(task);
  return signals.reduce((max, item) => Math.max(max, Number(item.priority || 0)), 0);
}

function toTimestamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function sortByPriority(rows) {
  return rows.slice().sort((a, b) => {
    const p = taskPriority(b) - taskPriority(a);
    if (p !== 0) return p;
    return toTimestamp(getGovernanceLastActionAt(b)) - toTimestamp(getGovernanceLastActionAt(a));
  });
}

function readFilters() {
  const incidentNode = document.getElementById('filterIncidentFocus');
  const approvalNode = document.getElementById('filterApprovalType');
  const compensationNode = document.getElementById('filterCompensationStatus');
  return {
    incidentFocus: incidentNode ? String(incidentNode.value || 'attention') : 'attention',
    approvalType: approvalNode ? String(approvalNode.value || 'all') : 'all',
    compensationStatus: compensationNode ? String(compensationNode.value || 'all') : 'all'
  };
}

function needsAttention(task) {
  const status = String((task && task.status) || '').trim().toLowerCase();
  if (['failed', 'rolled_back', 'aborted', 'validating', 'running', 'approved'].includes(status)) return true;
  const compensationStatus = String((((task || {}).compensation || {}).status || '').trim().toLowerCase());
  if (['queued', 'running', 'failed', 'dead_letter', 'deferred'].includes(compensationStatus)) return true;
  if (task && task.rollback) return true;
  return false;
}

function applyFilters(tasks, filters) {
  return tasks.filter((task) => {
    if (filters.incidentFocus === 'attention' && !needsAttention(task)) return false;
    if (filters.approvalType === 'manual' && !task.requiresApproval) return false;
    if (filters.approvalType === 'auto' && task.requiresApproval) return false;
    const compensationStatus = String(((task.compensation || {}).status || '')).trim().toLowerCase();
    if (filters.compensationStatus === 'none') return !compensationStatus;
    if (filters.compensationStatus !== 'all' && filters.compensationStatus !== compensationStatus) return false;
    return true;
  });
}

function renderApprovalChain(detailTask) {
  const approval = detailTask && detailTask.approval && typeof detailTask.approval === 'object' ? detailTask.approval : {};
  const approvals = Array.isArray(approval.approvals) ? approval.approvals : [];
  if (!approvals.length) return '<div class="toolbar-note">暂无审批动作</div>';
  const rows = approvals.map((item) => (
    `<tr><td>${escapeHtml(item.approverRole || '-')}</td><td>${escapeHtml(item.approverId || '-')}</td><td>${escapeHtml(formatDateTime(item.approvedAt))}</td><td>${escapeHtml(item.note || '-')}</td></tr>`
  )).join('');
  return `<div class="table-wrap"><table><thead><tr><th>角色</th><th>审批人</th><th>时间</th><th>意见</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderGovernanceEvents(detailTask) {
  const logs = Array.isArray(detailTask.logs) ? detailTask.logs : [];
  const types = new Set([
    'task.approval.required',
    'task.approved',
    'task.rollback.triggered',
    'task.rolled_back',
    'integration.compensation.queued',
    'integration.compensation.running',
    'integration.compensation.succeeded',
    'integration.compensation.retry_scheduled',
    'integration.compensation.dead_lettered',
    'integration.compensation.deferred',
    'integration.compensation.retry_requested'
  ]);
  const rows = logs
    .filter((event) => types.has(String(event.type || '')))
    .sort((a, b) => Date.parse(String(a.at || '')) - Date.parse(String(b.at || '')))
    .slice(-12)
    .map((event) => {
      const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
      const note = String(payload.note || payload.reason || payload.message || '').trim() || '-';
      return `<tr><td>${escapeHtml(formatDateTime(event.at))}</td><td>${escapeHtml(event.type || '-')}</td><td>${escapeHtml(note)}</td></tr>`;
    })
    .join('');
  if (!rows) return '<div class="toolbar-note">暂无治理事件</div>';
  return `<div class="table-wrap"><table><thead><tr><th>时间</th><th>治理事件</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function inlineDetailMarkup(task, detailTask = null) {
  const current = detailTask || task;
  return `
    <div class="detail-grid2">
      <div class="detail-section">
        <h4>发生了什么</h4>
        <div>${escapeHtml(describeWhatHappened(current))}</div>
      </div>
      <div class="detail-section">
        <h4>为什么发生</h4>
        <div>${escapeHtml(describeWhyHappened(current))}</div>
      </div>
    </div>
    <div class="detail-grid2">
      <div class="detail-section">
        <h4>审批与回滚</h4>
        <div>${escapeHtml(approvalProgress(current))}</div>
        <div style="margin-top:6px;">${escapeHtml(describeRollback(current))}</div>
      </div>
      <div class="detail-section">
        <h4>补偿处置</h4>
        <div>${escapeHtml(describeCompensation(current))}</div>
      </div>
    </div>
    <div class="detail-grid2">
      <div class="detail-section">
        <h4>审批链明细</h4>
        ${renderApprovalChain(current)}
      </div>
      <div class="detail-section">
        <h4>治理事件流</h4>
        ${renderGovernanceEvents(current)}
      </div>
    </div>
    <div class="detail-section">
      <h4>审计主键</h4>
      <div class="mono">task_id: ${escapeHtml(current.id || '-')} ${copyButton(current.id)}</div>
      <div class="mono">trace_id: ${escapeHtml(current.traceId || '-')} ${copyButton(current.traceId)}</div>
      <div class="mono">employee_id: ${escapeHtml(current.employeeId || '-')} ${copyButton(current.employeeId)}</div>
    </div>
    <div class="detail-section">
      <h4>任务原文</h4>
      <div>${escapeHtml(describeGoalRaw(current))}</div>
    </div>
  `;
}

async function loadDetail(taskId) {
  if (!taskId || state.detailByTaskId.has(taskId) || state.loadingDetails.has(taskId)) return;
  state.loadingDetails.add(taskId);
  try {
    const detail = await api(`/api/admin/tasks/${encodeURIComponent(taskId)}`);
    if (detail && typeof detail === 'object') state.detailByTaskId.set(taskId, detail);
  } catch {
    // keep page usable
  } finally {
    state.loadingDetails.delete(taskId);
  }
}

function bindRowActions(rows) {
  const tbody = document.getElementById('rows');
  tbody.querySelectorAll('.toggle-detail').forEach((node) => {
    node.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const taskId = String(node.getAttribute('data-task-id') || '').trim();
      state.selectedTaskId = state.selectedTaskId === taskId ? null : taskId;
      renderRows(rows);
      if (state.selectedTaskId) {
        await loadDetail(state.selectedTaskId);
        renderRows(rows);
      }
    });
  });
  tbody.querySelectorAll('.copy-btn').forEach((node) => {
    node.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = String(node.getAttribute('data-copy') || '').trim();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        node.textContent = '已复制';
        setTimeout(() => { node.textContent = '复制'; }, 1200);
      } catch {}
    });
  });
}

function renderRows(rows) {
  const tbody = document.getElementById('rows');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">当前筛选条件下暂无治理台账任务</td></tr>';
    return;
  }
  let html = '';
  rows.forEach((task) => {
    const taskId = String(task && task.id || '');
    const selected = state.selectedTaskId === taskId;
    const signals = incidentSignals(task);
    const signalText = signals.map((item) => item.label).join(' / ');
    const signalBadges = signals
      .map((item) => `<span class="badge ${item.tone || ''}">${escapeHtml(item.label)}</span>`)
      .join(' ');
    const lastActionAt = getGovernanceLastActionAt(task, state.detailByTaskId.get(taskId));
    html += `
      <tr data-task-id="${escapeHtml(taskId)}" ${selected ? 'class="row-selected"' : ''}>
        <td class="mono" data-label="任务编号">${escapeHtml(shortId(taskId, 8))}<div class="toolbar-note">${copyButton(taskId)}</div></td>
        <td class="mono" data-label="Trace ID">${escapeHtml(shortId(task.traceId, 10))}<div class="toolbar-note">${copyButton(task.traceId)}</div></td>
        <td data-label="执行人">${escapeHtml(task.employeeName || '-')}</td>
        <td data-label="任务概览" title="${escapeHtml(describeGoal(task))}">${escapeHtml(describeGoal(task))}</td>
        <td data-label="当前状态">${escapeHtml(formatTaskStatus(task))}</td>
        <td data-label="风险等级">${escapeHtml(task.riskLevel || '-')}</td>
        <td data-label="审批进度">${escapeHtml(approvalProgress(task))}</td>
        <td data-label="补偿状态">${escapeHtml(compensationStatusText(task))}</td>
        <td data-label="待处理信号" title="${escapeHtml(signalText)}">${signalBadges}</td>
        <td data-label="最近治理动作">${escapeHtml(formatDateTime(lastActionAt))}</td>
        <td data-label="责任角色">${escapeHtml(getOwnerRole(task))}</td>
        <td data-label="操作">
          <a class="btn-link" href="/admin/task-detail.html?taskId=${encodeURIComponent(taskId)}">查看详情</a>
          <button class="btn-link toggle-detail" data-task-id="${escapeHtml(taskId)}" style="margin-left:8px;">${selected ? '收起' : '展开'}</button>
        </td>
      </tr>
    `;
    if (selected) {
      const detail = state.detailByTaskId.get(taskId);
      const detailMarkup = detail
        ? inlineDetailMarkup(task, detail)
        : '<div class="toolbar-note">正在加载任务详情...</div>';
      html += `
        <tr class="governance-detail-row">
          <td colspan="12">
            <div class="governance-inline-detail">
              ${detailMarkup}
            </div>
          </td>
        </tr>
      `;
    }
  });
  tbody.innerHTML = html;
  bindRowActions(rows);
}

async function load() {
  const tbody = document.getElementById('rows');
  try {
    const tasks = await api('/api/admin/tasks');
    const list = Array.isArray(tasks) ? tasks : [];
    const governance = list.filter((task) => {
      const status = String((task && task.status) || '').trim().toLowerCase();
      return task.requiresApproval || task.rollback || task.compensation || ['failed', 'rolled_back', 'aborted', 'validating', 'approved', 'running'].includes(status);
    });

    const approvalTaskCount = governance.filter((x) => x.requiresApproval && ['validating', 'approved'].includes(String(x.status || '').toLowerCase())).length;
    const rollbackCount = governance.filter((x) => x.rollback || String(x.status || '').toLowerCase() === 'rolled_back').length;
    const compensationQueueCount = governance.filter((x) => {
      const status = String(((x.compensation || {}).status || '')).toLowerCase();
      return ['queued', 'running', 'deferred'].includes(status);
    }).length;

    setText('approvalTaskCount', approvalTaskCount);
    setText('rollbackCount', rollbackCount);
    setText('compensationQueueCount', compensationQueueCount);

    const filtered = sortByPriority(applyFilters(governance, readFilters()));
    if (state.selectedTaskId && !filtered.some((task) => String(task.id || '') === state.selectedTaskId)) {
      state.selectedTaskId = null;
    }
    renderRows(filtered);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty">加载失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  const filterNodes = ['filterIncidentFocus', 'filterApprovalType', 'filterCompensationStatus']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  filterNodes.forEach((node) => {
    node.addEventListener('change', () => { load().catch(() => {}); });
  });
  await load();
  setInterval(load, 2500);
})();
