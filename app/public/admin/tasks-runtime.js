async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

const state = {
  selectedTaskId: null,
  detailByTaskId: new Map(),
  loadingDetails: new Set(),
  taskById: new Map()
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

function copyButton(value, label = '复制') {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return `<button class="btn-link copy-btn" data-copy="${escapeHtml(raw)}">${escapeHtml(label)}</button>`;
}

function formatDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDurationMs(start, end) {
  const startMs = Date.parse(String(start || ''));
  const endMs = Date.parse(String(end || ''));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '-';
  const delta = endMs - startMs;
  if (delta < 1000) return `${delta}ms`;
  if (delta < 60000) return `${Math.round(delta / 1000)}s`;
  const minutes = Math.floor(delta / 60000);
  const seconds = Math.round((delta % 60000) / 1000);
  return `${minutes}m${seconds}s`;
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

function formatSkillSearch(task) {
  const skillSearch = getSkillSearch(task);
  if (!skillSearch) return '未触发技能检索';
  const top = Array.isArray(skillSearch.top) ? skillSearch.top : [];
  const topText = top.slice(0, 2).map((item) => `${item.name}(${item.score})`).join(', ');
  const triggerText = skillSearch.trigger === 'correction'
    ? '纠错后触发'
    : skillSearch.trigger === 'failure'
      ? '失败后触发'
      : (skillSearch.trigger || '运行过程触发');
  const modeText = skillSearch.usedFindSkills ? '精准检索(find-skills)' : '通用检索';
  return `${triggerText} | ${modeText}${topText ? ` | 推荐: ${topText}` : ''}`;
}

function getSkillSearch(task) {
  return task && task.skillSearch && typeof task.skillSearch === 'object' ? task.skillSearch : null;
}

function taskRuntimeConfig(task) {
  if (task && task.runtimeConfig && typeof task.runtimeConfig === 'object') return task.runtimeConfig;
  if (task && task.openclaw && typeof task.openclaw === 'object') return task.openclaw;
  return {};
}

function readFilters() {
  const triggerNode = document.getElementById('filterSkillTrigger');
  const findSkillsNode = document.getElementById('filterFindSkills');
  return {
    trigger: triggerNode ? String(triggerNode.value || 'all') : 'all',
    usedFindSkills: findSkillsNode ? String(findSkillsNode.value || 'all') : 'all'
  };
}

function applyFilters(tasks, filters) {
  return tasks.filter((task) => {
    const skillSearch = getSkillSearch(task);
    if (filters.trigger === 'none' && skillSearch) return false;
    if (filters.trigger !== 'all' && filters.trigger !== 'none') {
      if (!skillSearch) return false;
      if (String(skillSearch.trigger || '') !== filters.trigger) return false;
    }
    if (filters.usedFindSkills === 'yes') {
      if (!skillSearch || skillSearch.usedFindSkills !== true) return false;
    }
    if (filters.usedFindSkills === 'no') {
      if (skillSearch && skillSearch.usedFindSkills === true) return false;
    }
    return true;
  });
}

function runtimeLastEventAt(task) {
  const runtime = task && task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
  const events = Array.isArray(runtime.events) ? runtime.events : [];
  if (!events.length) return task.updatedAt || task.createdAt || null;
  const latest = events
    .map((event) => (event && event.at ? String(event.at) : ''))
    .filter(Boolean)
    .sort()
    .pop();
  return latest || task.updatedAt || task.createdAt || null;
}

function resolveSignals(task) {
  const badges = [];
  const status = String((task && task.status) || '').trim().toLowerCase();
  if (status === 'failed') badges.push({ tone: 'fail', label: '执行失败' });
  if (task && task.lastError && String(task.lastError.severity || '').trim().toUpperCase() === 'P1') badges.push({ tone: 'fail', label: 'P1' });
  if (status === 'rolled_back' || task.rollback) badges.push({ tone: 'warn', label: '已回滚' });
  const comp = String((((task || {}).compensation || {}).status || '')).trim().toLowerCase();
  if (['queued', 'running', 'failed', 'dead_letter', 'deferred'].includes(comp)) badges.push({ tone: comp === 'running' ? 'info' : 'warn', label: `补偿:${comp}` });
  if (!badges.length) badges.push({ tone: 'ok', label: '正常' });
  return badges;
}

function renderBadges(items) {
  return items.map((item) => `<span class="badge ${escapeHtml(item.tone || '')}">${escapeHtml(item.label || '-')}</span>`).join(' ');
}

function filterTimelineLogs(logs = []) {
  return logs
    .filter((event) => String((event && event.type) || '').startsWith('task.'))
    .sort((a, b) => Date.parse(String(a.at || '')) - Date.parse(String(b.at || '')));
}

function renderRuntimeEvents(task) {
  const runtime = task && task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
  const events = Array.isArray(runtime.events) ? runtime.events : [];
  if (!events.length) return '<div class="toolbar-note">无 runtime 原始事件</div>';
  const rows = events.slice(-12).map((event) => {
    const type = String((event && event.type) || 'unknown');
    const at = formatDateTime(event && event.at);
    const ref = String((event && event.id) || '').trim();
    return `<tr><td>${escapeHtml(at)}</td><td>${escapeHtml(type)}</td><td class="mono">${escapeHtml(ref || '-')}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>事件时间</th><th>事件类型</th><th>payload_ref</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderStatusTimeline(detailTask) {
  const logs = filterTimelineLogs(Array.isArray(detailTask.logs) ? detailTask.logs : []);
  if (!logs.length) return '<div class="toolbar-note">无状态机事件记录</div>';
  const rows = logs.slice(-12).map((event) => {
    const type = String(event.type || '-');
    const at = formatDateTime(event.at);
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
    const reason = String(payload.note || payload.reason || payload.message || '').trim() || '-';
    return `<tr><td>${escapeHtml(at)}</td><td>${escapeHtml(type)}</td><td>${escapeHtml(reason)}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>时间</th><th>状态事件</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderApprovals(detailTask) {
  const approval = detailTask && detailTask.approval && typeof detailTask.approval === 'object' ? detailTask.approval : {};
  const approvals = Array.isArray(approval.approvals) ? approval.approvals : [];
  const summary = detailTask && detailTask.requiresApproval
    ? `审批进度：${approvals.length}/${Number(approval.requiredApprovals || 0)}`
    : '自动审批';
  if (!approvals.length) return `<div>${escapeHtml(summary)}</div>`;
  const rows = approvals.slice(-8).map((item) => (
    `<tr><td>${escapeHtml(item.approverRole || '-')}</td><td>${escapeHtml(item.approverId || '-')}</td><td>${escapeHtml(formatDateTime(item.approvedAt))}</td></tr>`
  )).join('');
  return `<div>${escapeHtml(summary)}</div><div class="table-wrap" style="margin-top:8px;"><table><thead><tr><th>角色</th><th>审批人</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function inlineDetailMarkup(task, detailTask = null) {
  const current = detailTask || task;
  const runtime = current.runtime || {};
  const cfg = taskRuntimeConfig(current);
  const result = current.result && typeof current.result === 'object' ? current.result : {};
  const evidenceCount = Array.isArray(result.evidence) ? result.evidence.length : 0;
  const referenceCount = Array.isArray(result.references) ? result.references.length : 0;
  const timeline = renderStatusTimeline(current);
  const runtimeEvents = renderRuntimeEvents(current);
  return `
    <div class="detail-grid2">
      <div class="detail-section">
        <h4>审计主键</h4>
        <div class="mono">task_id: ${escapeHtml(current.id || '-')} ${copyButton(current.id)}</div>
        <div class="mono">trace_id: ${escapeHtml(current.traceId || '-')} ${copyButton(current.traceId)}</div>
        <div class="mono">employee_id: ${escapeHtml(current.employeeId || '-')} ${copyButton(current.employeeId)}</div>
        <div class="mono">parent_agent_id: ${escapeHtml(current.parentAgentId || '-')}</div>
      </div>
      <div class="detail-section">
        <h4>运行时快照</h4>
        <div>runtime.taskId: <span class="mono">${escapeHtml(runtime.taskId || '-')}</span></div>
        <div>runtime.source: ${escapeHtml(runtime.source || '-')}</div>
        <div>agent_id: ${escapeHtml(cfg.agentId || '-')}</div>
        <div>policy_id: ${escapeHtml(cfg.policyId || '-')}</div>
        <div>tool_scope: ${escapeHtml((Array.isArray(cfg.toolScope) ? cfg.toolScope.join(', ') : '') || '-')}</div>
      </div>
    </div>
    <div class="detail-grid2">
      <div class="detail-section">
        <h4>状态机时间线</h4>
        ${timeline}
      </div>
      <div class="detail-section">
        <h4>执行事件流</h4>
        ${runtimeEvents}
      </div>
    </div>
    <div class="detail-grid2">
      <div class="detail-section">
        <h4>结果与证据</h4>
        <div>evidence: ${evidenceCount}</div>
        <div>references: ${referenceCount}</div>
        <div>cost.tokens: ${escapeHtml(String((((result || {}).cost || {}).tokens) || '-'))}</div>
        <div>cost.compute_ms: ${escapeHtml(String((((result || {}).cost || {}).compute_ms) || '-'))}</div>
        <div>error: ${escapeHtml(current.lastError ? JSON.stringify(current.lastError) : '-')}</div>
      </div>
      <div class="detail-section">
        <h4>审批链</h4>
        ${renderApprovals(current)}
      </div>
    </div>
    <div class="detail-section">
      <h4>技能检索</h4>
      <div>${escapeHtml(formatSkillSearch(current))}</div>
    </div>
  `;
}

function renderRows(rows) {
  const tbody = document.getElementById('rows');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="14" class="empty">暂无接入执行引擎的任务</td></tr>';
    return;
  }
  let html = '';
  rows.forEach((task) => {
    const taskId = String(task.id || '');
    const runtime = task.runtime || {};
    const selected = state.selectedTaskId === taskId;
    const lastEventAt = runtimeLastEventAt(task);
    const duration = formatDurationMs(task.createdAt, String(task.status || '').toLowerCase() === 'running' ? new Date().toISOString() : (task.updatedAt || task.createdAt));
    const signals = renderBadges(resolveSignals(task));
    html += `
      <tr data-task-id="${escapeHtml(taskId)}" ${selected ? 'class="row-selected"' : ''}>
        <td class="mono">${escapeHtml(shortId(task.id, 8))}<div class="toolbar-note">${copyButton(task.id)}</div></td>
        <td class="mono">${escapeHtml(shortId(task.traceId, 10))}<div class="toolbar-note">${copyButton(task.traceId)}</div></td>
        <td>${escapeHtml(task.employeeName || '-')}<div class="toolbar-note mono">${escapeHtml(task.employeeId || '-')}</div></td>
        <td title="${escapeHtml(task.goal || '-')}">${escapeHtml(task.goal || '-')}</td>
        <td>${escapeHtml(formatTaskStatus(task))}</td>
        <td>${escapeHtml(task.riskLevel || '-')}</td>
        <td class="mono">${escapeHtml(shortId(runtime.taskId, 12))}</td>
        <td>${escapeHtml(runtime.source || '本地执行')}</td>
        <td>${escapeHtml(taskRuntimeConfig(task).agentId || '-')}</td>
        <td>${escapeHtml(formatDateTime(lastEventAt))}</td>
        <td>${escapeHtml(duration)}</td>
        <td>${signals}</td>
        <td title="${escapeHtml(formatSkillSearch(task))}">${escapeHtml(formatSkillSearch(task))}</td>
        <td>
          <a class="btn-link" href="/admin/task-detail.html?taskId=${encodeURIComponent(taskId)}">查看详情</a>
          <button class="btn-link toggle-detail" data-task-id="${escapeHtml(taskId)}" style="margin-left:8px;">${selected ? '收起' : '展开'}</button>
        </td>
      </tr>
    `;
    if (selected) {
      const detail = state.detailByTaskId.get(taskId);
      const detailContent = detail
        ? inlineDetailMarkup(task, detail)
        : '<div class="toolbar-note">正在加载任务详情...</div>';
      html += `<tr class="governance-detail-row"><td colspan="14"><div class="governance-inline-detail">${detailContent}</div></td></tr>`;
    }
  });
  tbody.innerHTML = html;
  bindRowActions(rows);
}

async function loadDetail(taskId) {
  if (!taskId || state.detailByTaskId.has(taskId) || state.loadingDetails.has(taskId)) return;
  state.loadingDetails.add(taskId);
  try {
    const detail = await api(`/api/admin/tasks/${encodeURIComponent(taskId)}`);
    if (detail && typeof detail === 'object') state.detailByTaskId.set(taskId, detail);
  } catch {
    // detail load errors are rendered as fallback text in list
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

async function load() {
  const tbody = document.getElementById('rows');
  try {
    const tasks = await api('/api/admin/tasks');
    const list = Array.isArray(tasks) ? tasks : [];
    const runtimeBound = list.filter((x) => x.runtime && x.runtime.taskId);
    state.taskById.clear();
    runtimeBound.forEach((task) => state.taskById.set(String(task.id || ''), task));

    const filters = readFilters();
    const filtered = applyFilters(runtimeBound, filters);
    const totalRuntimeEvents = runtimeBound.reduce((sum, x) => sum + (Array.isArray((x.runtime || {}).events) ? x.runtime.events.length : 0), 0);
    const agents = new Set(runtimeBound.map((x) => taskRuntimeConfig(x).agentId).filter(Boolean));

    setText('runtimeBoundCount', runtimeBound.length);
    setText('runtimeEventCount', totalRuntimeEvents);
    setText('agentCount', agents.size);

    if (state.selectedTaskId && !filtered.some((item) => String(item.id || '') === state.selectedTaskId)) {
      state.selectedTaskId = null;
    }
    renderRows(filtered);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="14" class="empty">加载失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  const triggerNode = document.getElementById('filterSkillTrigger');
  const findSkillsNode = document.getElementById('filterFindSkills');
  if (triggerNode) triggerNode.addEventListener('change', () => { load().catch(() => {}); });
  if (findSkillsNode) findSkillsNode.addEventListener('change', () => { load().catch(() => {}); });
  await load();
  setInterval(load, 2500);
})();
