async function api(path) {
  if (window.adminApi) return window.adminApi(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

let drawerOpen = false;
let currentTasks = [];

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function shortId(id) {
  return String(id || '').slice(0, 8);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const CHILD_AGENT_REASON_LABELS = {
  high_risk_l4: '高风险任务（L4）',
  long_goal: '目标较长，需要拆解',
  complexity_keyword: '命中复杂任务关键词',
  broad_tool_scope: '工具/系统范围较广'
};

const SKILL_SKIP_REASON_LABELS = {
  insufficient_repeated_success: '同类任务成功次数不足（需至少2次）'
};

function mapReasonLabels(reasons, dictionary) {
  return (Array.isArray(reasons) ? reasons : [])
    .map((reason) => dictionary[reason] || reason);
}

function growthSummaryCell(task) {
  const plan = task && task.childAgentPlan && typeof task.childAgentPlan === 'object'
    ? task.childAgentPlan
    : { planned: false, reasons: [] };
  const reasonLabels = mapReasonLabels(plan.reasons, CHILD_AGENT_REASON_LABELS);
  const status = plan.planned
    ? '<span class="badge ok">子Agent：触发</span>'
    : '<span class="badge warn">子Agent：未触发</span>';
  const reasonText = reasonLabels.length ? reasonLabels.join('、') : '无触发条件';
  return `${status}<div class="toolbar-note">${escapeHtml(reasonText)}</div>`;
}

function runtimeLabel(task) {
  if (!task.runtime || !task.runtime.taskId) return '-';
  return shortId(task.runtime.taskId);
}

function runtimeEventCount(task) {
  if (!task.runtime || !Array.isArray(task.runtime.events)) return 0;
  return task.runtime.events.length;
}

function runtimeRouteCell(task) {
  const cfg = taskRuntimeConfig(task);
  const agent = cfg.agentId ? `Agent: ${cfg.agentId}` : 'Agent: -';
  const policy = cfg.policyId ? `Policy: ${cfg.policyId}` : 'Policy: -';
  const toolScope = Array.isArray(cfg.toolScope) ? cfg.toolScope.slice(0, 3) : [];
  const scopeText = toolScope.length ? toolScope.join(', ') : '-';
  return `<div class="toolbar-note">${escapeHtml(agent)}</div><div class="toolbar-note">${escapeHtml(policy)}</div><div class="toolbar-note">Tools: ${escapeHtml(scopeText)}</div>`;
}

function taskRuntimeConfig(task) {
  if (task && task.runtimeConfig && typeof task.runtimeConfig === 'object') return task.runtimeConfig;
  if (task && task.openclaw && typeof task.openclaw === 'object') return task.openclaw;
  return {};
}

function resolveEmployeeRuntimeProfile(task) {
  const employee = task && task.employee && typeof task.employee === 'object' ? task.employee : {};
  if (employee.runtimeProfile && typeof employee.runtimeProfile === 'object') return employee.runtimeProfile;
  if (employee.openclawProfile && typeof employee.openclawProfile === 'object') return employee.openclawProfile;
  return {};
}

function getTaskAgent(task) {
  return String(taskRuntimeConfig(task).agentId || 'default').trim();
}

function getTaskPolicy(task) {
  return String(taskRuntimeConfig(task).policyId || 'none').trim();
}

function getTaskTools(task) {
  const tools = normalizeTools(taskRuntimeConfig(task).toolScope);
  return tools.length ? tools : ['default'];
}

function normalizeTools(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function resolveConfigSource(taskValue, employeeValue, hasTaskOverrideHint = false) {
  const tv = String(taskValue || '').trim();
  const ev = String(employeeValue || '').trim();
  if (!tv) return '未配置';
  if (hasTaskOverrideHint) return '任务覆盖';
  if (ev && tv === ev) return '员工默认';
  if (!ev) return '任务覆盖';
  return '任务覆盖';
}

function resolveToolScopeSource(taskScope, employeeScope) {
  const taskList = normalizeTools(taskScope);
  const employeeList = normalizeTools(employeeScope);
  if (!taskList.length) return '未配置';
  if (employeeList.length && taskList.join('|') === employeeList.join('|')) return '员工默认';
  if (!employeeList.length) return '任务覆盖';
  return '任务覆盖';
}

function renderRuntimeSummary(task) {
  const runtime = task.runtime || { taskId: null, source: 'openclaw', events: [] };
  const cfg = taskRuntimeConfig(task);
  const employeeRuntime = resolveEmployeeRuntimeProfile(task);
  const toolScope = normalizeTools(cfg.toolScope);
  const hasTaskExtraPrompt = Boolean(String(cfg.extraSystemPrompt || '').trim());
  const hasTaskPolicy = Boolean(String(cfg.policyId || '').trim());
  const items = [
    `Runtime来源：${runtime.source || 'openclaw'}`,
    `Runtime Task：${runtime.taskId || '-'}`,
    `Runtime事件数：${Array.isArray(runtime.events) ? runtime.events.length : 0}`,
    `Agent：${cfg.agentId || '-'}（${resolveConfigSource(cfg.agentId, employeeRuntime.agentId)}）`,
    `Policy：${cfg.policyId || '-'}（${hasTaskPolicy ? '任务覆盖' : '未配置'}）`,
    `ToolScope：${toolScope.length ? toolScope.join(', ') : '-'}（${resolveToolScopeSource(cfg.toolScope, employeeRuntime.toolScope)}）`,
    `SystemPrompt：${cfg.systemPrompt ? '已配置' : '未配置'}（${resolveConfigSource(cfg.systemPrompt ? 'configured' : '', employeeRuntime.systemPrompt ? 'configured' : '')}）`,
    `ExtraPrompt：${cfg.extraSystemPrompt ? '已配置' : '未配置'}（${hasTaskExtraPrompt ? '任务覆盖' : '未配置'}）`
  ];
  const pickDisplay = (value) => String(value || '').trim() || '-';
  const compareRows = [
    {
      label: 'Agent',
      employee: pickDisplay(employeeRuntime.agentId),
      task: pickDisplay(cfg.agentId),
      source: resolveConfigSource(cfg.agentId, employeeRuntime.agentId)
    },
    {
      label: 'Policy',
      employee: '-',
      task: pickDisplay(cfg.policyId),
      source: String(cfg.policyId || '').trim() ? '任务覆盖' : '未配置'
    },
    {
      label: 'Tool Scope',
      employee: normalizeTools(employeeRuntime.toolScope).join(', ') || '-',
      task: toolScope.join(', ') || '-',
      source: resolveToolScopeSource(cfg.toolScope, employeeRuntime.toolScope)
    },
    {
      label: 'System Prompt',
      employee: employeeRuntime.systemPrompt ? '[configured]' : '-',
      task: cfg.systemPrompt ? '[configured]' : '-',
      source: resolveConfigSource(cfg.systemPrompt ? 'configured' : '', employeeRuntime.systemPrompt ? 'configured' : '')
    },
    {
      label: 'Extra Prompt',
      employee: '-',
      task: cfg.extraSystemPrompt ? '[configured]' : '-',
      source: hasTaskExtraPrompt ? '任务覆盖' : '未配置'
    }
  ];
  const compareTable = `
    <div style="margin-top:8px;">
      <div class="toolbar-note">配置对比（员工默认 vs 任务实际）</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>项</th><th>员工默认</th><th>任务实际</th><th>来源</th></tr>
          </thead>
          <tbody>
            ${compareRows.map((row) => `
              <tr>
                <td>${escapeHtml(row.label)}</td>
                <td>${escapeHtml(row.employee)}</td>
                <td>${escapeHtml(row.task)}</td>
                <td>${escapeHtml(row.source)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return `<div class="overview-item">${items.map((line) => escapeHtml(line)).join('</div><div class="overview-item">')}</div>${compareTable}`;
}

function resolveGrowthInsights(task) {
  const logs = Array.isArray(task.logs) ? task.logs : [];
  const plan = task && task.childAgentPlan && typeof task.childAgentPlan === 'object'
    ? task.childAgentPlan
    : { planned: false, reasons: [] };
  const childReasonLabels = mapReasonLabels(plan.reasons, CHILD_AGENT_REASON_LABELS);
  const skillCreated = logs.filter((event) => event.type === 'skill.auto.created');
  const skillSkipped = logs.filter((event) => event.type === 'skill.sedimentation.skipped');
  const latestSkip = skillSkipped.length ? skillSkipped[skillSkipped.length - 1] : null;
  const skipReason = latestSkip && latestSkip.payload ? latestSkip.payload.reason : null;
  const skipCapability = latestSkip && latestSkip.payload ? latestSkip.payload.capability : null;
  const skipReasonLabel = skipReason
    ? (SKILL_SKIP_REASON_LABELS[skipReason] || String(skipReason))
    : null;
  return {
    childPlanned: Boolean(plan.planned),
    childReasons: childReasonLabels,
    skillCreatedCount: skillCreated.length,
    skillSkippedCount: skillSkipped.length,
    skillSkipReasonLabel: skipReasonLabel,
    skillSkipCapability: skipCapability
  };
}

function renderDetail(task) {
  const runtime = task.runtime || { taskId: null, source: 'openclaw', events: [] };
  const runtimeConfig = taskRuntimeConfig(task);
  const skillSearch = task.skillSearch && typeof task.skillSearch === 'object' ? task.skillSearch : null;
  const growth = resolveGrowthInsights(task);
  const lines = [];
  lines.push('【成长策略解读】');
  lines.push(`子Agent计划：${growth.childPlanned ? '已触发创建' : '未触发创建'}`);
  lines.push(`子Agent触发条件：${growth.childReasons.length ? growth.childReasons.join('、') : '无'}`);
  if (growth.skillCreatedCount > 0) {
    lines.push(`Skill沉淀：已沉淀 ${growth.skillCreatedCount} 次`);
  } else if (growth.skillSkippedCount > 0) {
    const capabilityText = growth.skillSkipCapability ? `（能力：${growth.skillSkipCapability}）` : '';
    lines.push(`Skill沉淀：暂未沉淀${capabilityText}`);
    lines.push(`Skill未沉淀原因：${growth.skillSkipReasonLabel || '暂无'}`);
  } else {
    lines.push('Skill沉淀：当前任务未产生沉淀记录');
  }
  lines.push('');
  lines.push('【任务详情】');
  lines.push(`taskId: ${task.id}`);
  lines.push(`status: ${task.status}`);
  lines.push(`employee: ${task.employeeName} (${task.employeeId})`);
  lines.push(`goal: ${task.goal}`);
  lines.push(`runtime.source: ${runtime.source || 'openclaw'}`);
  lines.push(`runtime.taskId: ${runtime.taskId || '-'}`);
  lines.push(`runtime.events: ${Array.isArray(runtime.events) ? runtime.events.length : 0}`);
  lines.push(`runtime.agentId: ${runtimeConfig.agentId || '-'}`);
  lines.push(`runtime.policyId: ${runtimeConfig.policyId || '-'}`);
  lines.push(`runtime.toolScope: ${(Array.isArray(runtimeConfig.toolScope) ? runtimeConfig.toolScope : []).join(', ') || '-'}`);
  lines.push(`runtime.systemPrompt: ${runtimeConfig.systemPrompt ? '[configured]' : '-'}`);
  lines.push(`runtime.extraSystemPrompt: ${runtimeConfig.extraSystemPrompt ? '[configured]' : '-'}`);
  lines.push('');
  lines.push('【技能搜索】');
  if (skillSearch) {
    const topSkills = Array.isArray(skillSearch.top) && skillSearch.top.length
      ? skillSearch.top.map((item) => `${item.name}(${item.score})`).join(', ')
      : '-';
    lines.push(`skillSearch.trigger: ${skillSearch.trigger || '-'}`);
    lines.push(`skillSearch.query: ${skillSearch.query || '-'}`);
    lines.push(`skillSearch.keywords: ${Array.isArray(skillSearch.keywords) ? skillSearch.keywords.join(', ') : '-'}`);
    lines.push(`skillSearch.usedFindSkills: ${skillSearch.usedFindSkills ? 'yes' : 'no'}`);
    lines.push(`skillSearch.topSkills: ${topSkills}`);
  } else {
    lines.push('skillSearch: -');
  }
  lines.push(`lastError: ${task.lastError ? JSON.stringify(task.lastError) : '-'}`);
  lines.push('');
  lines.push('【ReAct轨迹】');
  const reactTrace = Array.isArray(task.reactTrace) ? task.reactTrace : [];
  if (reactTrace.length) {
    const latest = reactTrace.slice(-20);
    for (const entry of latest) {
      const round = Number(entry.round || 1);
      const phase = String(entry.phase || 'observe');
      const detail = entry.detail && typeof entry.detail === 'object'
        ? JSON.stringify(entry.detail)
        : '{}';
      lines.push(`[round:${round}] ${phase} -> ${detail}`);
    }
  } else {
    lines.push('reactTrace: -');
  }
  lines.push('');
  lines.push('--- full payload ---');
  const fullPayload = sanitizeTaskPayloadForDisplay(task || {});
  lines.push(JSON.stringify(fullPayload, null, 2));
  return lines.join('\n');
}

function sanitizeTaskPayloadForDisplay(task = {}) {
  const fullPayload = JSON.parse(JSON.stringify(task || {}));
  if (fullPayload.runtimeConfig && typeof fullPayload.runtimeConfig === 'object') {
    delete fullPayload.runtimeConfig.sessionKey;
  }
  if (fullPayload.openclaw && typeof fullPayload.openclaw === 'object') {
    delete fullPayload.openclaw.sessionKey;
  }
  if (fullPayload.employee && fullPayload.employee.runtimeProfile && typeof fullPayload.employee.runtimeProfile === 'object') {
    delete fullPayload.employee.runtimeProfile.sessionKey;
  }
  if (fullPayload.employee && fullPayload.employee.openclawProfile && typeof fullPayload.employee.openclawProfile === 'object') {
    delete fullPayload.employee.openclawProfile.sessionKey;
  }
  return fullPayload;
}

function renderEmpty(message) {
  document.getElementById('rows').innerHTML = `<tr><td colspan="10" class="empty">${escapeHtml(message)}</td></tr>`;
}

function readFilters() {
  const agentNode = document.getElementById('filterAgent');
  const policyNode = document.getElementById('filterPolicy');
  const toolNode = document.getElementById('filterTool');
  return {
    agent: agentNode ? String(agentNode.value || 'all') : 'all',
    policy: policyNode ? String(policyNode.value || 'all') : 'all',
    tool: toolNode ? String(toolNode.value || 'all') : 'all'
  };
}

function applyFilters(rows, filters) {
  return rows.filter((task) => {
    const matchAgent = filters.agent === 'all' || getTaskAgent(task) === filters.agent;
    const matchPolicy = filters.policy === 'all' || getTaskPolicy(task) === filters.policy;
    const matchTool = filters.tool === 'all' || getTaskTools(task).includes(filters.tool);
    return matchAgent && matchPolicy && matchTool;
  });
}

function setSelectOptions(id, values, selected) {
  const node = document.getElementById(id);
  if (!node) return;
  const options = ['all', ...values];
  node.innerHTML = options
    .map((value) => {
      const label = value === 'all'
        ? (id === 'filterAgent' ? 'Agent：全部' : id === 'filterPolicy' ? 'Policy：全部' : 'Tool：全部')
        : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  node.value = options.includes(selected) ? selected : 'all';
}

function syncFilterOptions(rows) {
  const previous = readFilters();
  const agents = Array.from(new Set(rows.map((task) => getTaskAgent(task)))).sort();
  const policies = Array.from(new Set(rows.map((task) => getTaskPolicy(task)))).sort();
  const tools = Array.from(new Set(rows.flatMap((task) => getTaskTools(task)))).sort();
  setSelectOptions('filterAgent', agents, previous.agent);
  setSelectOptions('filterPolicy', policies, previous.policy);
  setSelectOptions('filterTool', tools, previous.tool);
}

function renderRows(rows) {
  const filtered = applyFilters(rows, readFilters());
  if (!filtered.length) {
    renderEmpty('当前筛选条件下暂无任务');
    return;
  }
  document.getElementById('rows').innerHTML = filtered
    .map((task) => `
      <tr>
        <td>${escapeHtml(shortId(task.id))}</td>
        <td>${escapeHtml(task.employeeName || '-')}</td>
        <td>${escapeHtml(task.goal || '-')}</td>
        <td>${escapeHtml(task.status || '-')}</td>
        <td>${task.iteration ?? 0}</td>
        <td>${escapeHtml(runtimeLabel(task))}</td>
        <td>${runtimeRouteCell(task)}</td>
        <td>${runtimeEventCount(task)}</td>
        <td>${growthSummaryCell(task)}</td>
        <td><button data-id="${escapeHtml(task.id)}">详情</button></td>
      </tr>
    `)
    .join('');

  document.querySelectorAll('#rows button[data-id]').forEach((button) => {
    button.onclick = async () => {
      const detail = await api(`/api/admin/tasks/${button.dataset.id}`);
      const summary = document.getElementById('taskDetailSummary');
      if (summary) summary.innerHTML = renderRuntimeSummary(detail);
      document.getElementById('detail').textContent = renderDetail(detail);
      const title = document.getElementById('taskDrawerTitle');
      if (title) title.textContent = `任务详情 · ${shortId(detail.id)}`;
      setDrawerVisibility(true);
    };
  });
}

function setDrawerVisibility(open) {
  drawerOpen = Boolean(open);
  const drawer = document.getElementById('taskDetailDrawer');
  const mask = document.getElementById('taskDrawerMask');
  if (!drawer || !mask) return;
  drawer.classList.toggle('hidden', !drawerOpen);
  mask.classList.toggle('hidden', !drawerOpen);
  drawer.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
  mask.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
}

async function load() {
  try {
    const rows = await api('/api/admin/tasks');
    if (!Array.isArray(rows) || !rows.length) {
      renderEmpty('暂无任务数据');
      setText('taskCount', '0');
      setText('runningCount', '0');
      setText('runtimeBoundCount', '0');
      return;
    }

    currentTasks = rows.slice();
    const running = rows.filter((x) => String(x.status || '').toLowerCase().includes('running')).length;
    const runtimeBound = rows.filter((x) => x.runtime && x.runtime.taskId).length;
    setText('taskCount', String(rows.length));
    setText('runningCount', String(running));
    setText('runtimeBoundCount', String(runtimeBound));
    syncFilterOptions(rows);
    renderRows(rows);
  } catch (error) {
    renderEmpty(`加载失败：${error.message}`);
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  const closeBtn = document.getElementById('closeTaskDrawer');
  const mask = document.getElementById('taskDrawerMask');
  const filterNodes = ['filterAgent', 'filterPolicy', 'filterTool']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (closeBtn) closeBtn.onclick = () => setDrawerVisibility(false);
  if (mask) mask.onclick = () => setDrawerVisibility(false);
  filterNodes.forEach((node) => {
    node.addEventListener('change', () => renderRows(currentTasks));
  });
  await load();
  setInterval(load, 2500);
})();
