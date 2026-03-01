async function api(path, options) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

let currentSkillMap = new Map();
let currentSkillId = '';
let drawerOpen = false;
let skillPolicyDrawerOpen = false;
const rawJsonExpandedBySkillId = new Map();
const managerInfoExpandedBySkillId = new Map();
const selectedResourcePathBySkillId = new Map();
let currentDetailDigest = '';
let currentSession = null;
let canUseDebugMode = false;
let canDeleteSkill = false;
let canUnlinkEmployee = false;
let employeeCandidates = [];
let employeeCandidatesLoaded = false;
let employeeCandidatesError = '';
let skillPolicyDirty = false;
let lastSkillPolicySnapshot = null;
let skillPolicyOverridesDraft = [];
let skillPolicyToastTimer = null;
let canWriteSkills = false;
let canWriteRuntime = false;
const SKILL_SOURCE_LABELS = {
  preloaded: '预置技能',
  manual: '手动创建',
  archive_bundle: '压缩包导入',
  manual_entry: '人工录入',
  proposal: '技能提案',
  auto: '自动生成',
  auto_sedimentation: '自动沉淀'
};

function sedimentationModeLabel(mode) {
  if (mode === 'hybrid') return '平衡（先AI再规则）';
  if (mode === 'model_driven') return 'AI优先';
  if (mode === 'rules') return '规则优先';
  return mode || '-';
}

function sedimentationModeExplain(mode) {
  if (mode === 'hybrid') return '先让 AI 判断，AI 不稳时再用规则兜底，质量和效率更平衡。';
  if (mode === 'model_driven') return '主要依赖 AI 判断，适合追求覆盖面和灵活性。';
  if (mode === 'rules') return '只按规则沉淀，更稳定，适合强调稳妥的场景。';
  return '未识别策略方式，建议使用“平衡（先AI再规则）”。';
}

function setSkillPolicyModeExplain(mode) {
  setText('skillPolicyModeExplain', `策略说明：${sedimentationModeExplain(String(mode || 'hybrid'))}`);
}

function normalizeSkillPolicyOverride(item, index = 0) {
  const row = item && typeof item === 'object' ? item : {};
  const scope = row.scope && typeof row.scope === 'object' ? row.scope : {};
  const mode = String(row.mode || 'hybrid').trim().toLowerCase();
  const minConfidenceRaw = Number(row.minConfidence);
  const minRepeatedRaw = Number(row.minRepeatedSuccessForFallback);
  return {
    id: String(row.id || `scope-${index + 1}`).trim(),
    scope: {
      tenantId: String(scope.tenantId || '').trim(),
      accountId: String(scope.accountId || '').trim(),
      department: String(scope.department || '').trim(),
      role: String(scope.role || '').trim(),
      employeeId: String(scope.employeeId || '').trim()
    },
    mode: ['rules', 'model_driven', 'hybrid'].includes(mode) ? mode : 'hybrid',
    minConfidence: Number.isFinite(minConfidenceRaw) ? Math.max(0, Math.min(1, minConfidenceRaw)) : 0.7,
    fallbackToRulesWhenModelUnavailable: row.fallbackToRulesWhenModelUnavailable !== false,
    minRepeatedSuccessForFallback: Number.isFinite(minRepeatedRaw) ? Math.max(1, Math.round(minRepeatedRaw)) : 2
  };
}

function normalizeSkillPolicyOverrides(overrides) {
  if (!Array.isArray(overrides)) return [];
  return overrides.map((item, index) => normalizeSkillPolicyOverride(item, index));
}

function hasSkillPolicyOverrideScope(scope) {
  const s = scope && typeof scope === 'object' ? scope : {};
  return Boolean(
    String(s.tenantId || '').trim()
    || String(s.accountId || '').trim()
    || String(s.department || '').trim()
    || String(s.role || '').trim()
    || String(s.employeeId || '').trim()
  );
}

function syncSkillPolicyOverridesJson() {
  const node = document.getElementById('skillPolicyOverridesJson');
  if (!node) return;
  node.value = JSON.stringify(skillPolicyOverridesDraft, null, 2);
}

function renderSkillPolicyOverridesEditor() {
  const listNode = document.getElementById('skillPolicyOverridesList');
  if (!listNode) return;
  if (!skillPolicyOverridesDraft.length) {
    listNode.innerHTML = '<div class="empty">暂无覆盖规则，默认使用全局策略。</div>';
    syncSkillPolicyOverridesJson();
    return;
  }
  listNode.innerHTML = skillPolicyOverridesDraft.map((item, index) => `
    <div class="skill-detail-card skill-policy-override-card" data-override-index="${index}">
      <div class="skill-policy-override-head">
        <strong>覆盖规则 #${index + 1}</strong>
        <button type="button" data-override-remove="${index}">删除</button>
      </div>
      <div class="policy-grid skill-policy-override-grid">
        <label>规则ID</label>
        <input class="admin-input" type="text" data-override-index="${index}" data-override-field="id" value="${escapeHtml(item.id)}" placeholder="例如 ops-role-scope" />
        <label>模式</label>
        <select class="admin-select" data-override-index="${index}" data-override-field="mode">
          <option value="hybrid" ${item.mode === 'hybrid' ? 'selected' : ''}>平衡（先AI再规则）</option>
          <option value="model_driven" ${item.mode === 'model_driven' ? 'selected' : ''}>AI优先</option>
          <option value="rules" ${item.mode === 'rules' ? 'selected' : ''}>规则优先</option>
        </select>
        <label>AI把握度阈值 (0-1)</label>
        <input class="admin-input" type="number" min="0" max="1" step="0.01" data-override-index="${index}" data-override-field="minConfidence" value="${escapeHtml(item.minConfidence)}" />
        <label>历史成功达到 N 次后才允许自动沉淀</label>
        <input class="admin-input" type="number" min="1" step="1" data-override-index="${index}" data-override-field="minRepeatedSuccessForFallback" value="${escapeHtml(item.minRepeatedSuccessForFallback)}" />
        <label>AI暂不可用时，是否规则兜底</label>
        <select class="admin-select" data-override-index="${index}" data-override-field="fallbackToRulesWhenModelUnavailable">
          <option value="true" ${item.fallbackToRulesWhenModelUnavailable ? 'selected' : ''}>开启</option>
          <option value="false" ${item.fallbackToRulesWhenModelUnavailable ? '' : 'selected'}>关闭</option>
        </select>
        <label>部门</label>
        <input class="admin-input" type="text" data-override-index="${index}" data-override-scope-field="department" value="${escapeHtml(item.scope.department)}" placeholder="例如 OPS" />
        <label>角色</label>
        <input class="admin-input" type="text" data-override-index="${index}" data-override-scope-field="role" value="${escapeHtml(item.scope.role)}" placeholder="例如 Operator" />
        <label>员工ID</label>
        <input class="admin-input" type="text" data-override-index="${index}" data-override-scope-field="employeeId" value="${escapeHtml(item.scope.employeeId)}" placeholder="例如 emp-001" />
        <label>租户ID（可选）</label>
        <input class="admin-input" type="text" data-override-index="${index}" data-override-scope-field="tenantId" value="${escapeHtml(item.scope.tenantId)}" />
        <label>账号ID（可选）</label>
        <input class="admin-input" type="text" data-override-index="${index}" data-override-scope-field="accountId" value="${escapeHtml(item.scope.accountId)}" />
      </div>
    </div>
  `).join('');
  syncSkillPolicyOverridesJson();
}

function updateSkillPolicyOverrideField(index, field, value) {
  const row = skillPolicyOverridesDraft[index];
  if (!row) return;
  if (field === 'id') {
    row.id = String(value || '').trim();
  } else if (field === 'mode') {
    row.mode = ['rules', 'model_driven', 'hybrid'].includes(String(value || '').trim()) ? String(value).trim() : 'hybrid';
  } else if (field === 'minConfidence') {
    const parsed = Number(value);
    row.minConfidence = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.7;
  } else if (field === 'minRepeatedSuccessForFallback') {
    const parsed = Number(value);
    row.minRepeatedSuccessForFallback = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 2;
  } else if (field === 'fallbackToRulesWhenModelUnavailable') {
    row.fallbackToRulesWhenModelUnavailable = String(value || 'true') !== 'false';
  }
  syncSkillPolicyOverridesJson();
}

function updateSkillPolicyOverrideScopeField(index, field, value) {
  const row = skillPolicyOverridesDraft[index];
  if (!row) return;
  row.scope = row.scope && typeof row.scope === 'object' ? row.scope : {};
  row.scope[field] = String(value || '').trim();
  syncSkillPolicyOverridesJson();
}

function buildSkillPolicyOverridesPayload() {
  return skillPolicyOverridesDraft.map((item, index) => normalizeSkillPolicyOverride(item, index));
}

function validateSkillPolicyOverrides(overrides) {
  for (let i = 0; i < overrides.length; i += 1) {
    const row = overrides[i];
    if (!hasSkillPolicyOverrideScope(row.scope)) {
      return `保存失败：覆盖规则 #${i + 1} 未填写范围（至少填写部门/角色/员工ID/租户ID/账号ID之一）`;
    }
  }
  return '';
}

function renderSkillPolicyEffectivePreview() {
  const node = document.getElementById('skillPolicyEffectivePreview');
  if (!node) return;
  const mode = String((document.getElementById('skillPolicyModeSelect') || {}).value || 'hybrid');
  const minConfidenceNode = document.getElementById('skillPolicyMinConfidence');
  const minRepeatedNode = document.getElementById('skillPolicyMinRepeated');
  const fallbackNode = document.getElementById('skillPolicyFallback');
  const minConfidence = Number(minConfidenceNode ? minConfidenceNode.value : 0.7);
  const minRepeatedRaw = Number(minRepeatedNode ? minRepeatedNode.value : 2);
  const minRepeated = Number.isFinite(minRepeatedRaw) ? Math.max(1, Math.round(minRepeatedRaw)) : 2;
  const effectiveRepeated = Math.max(2, minRepeated);
  const fallbackEnabled = fallbackNode ? String(fallbackNode.value || 'true') !== 'false' : true;
  const fallbackText = fallbackEnabled ? '开启' : '关闭';
  const validOverrides = skillPolicyOverridesDraft.filter((item) => hasSkillPolicyOverrideScope(item.scope)).length;
  node.textContent = [
    `当前策略：${sedimentationModeLabel(mode)}`,
    `AI把握度阈值：${Number.isFinite(minConfidence) ? minConfidence.toFixed(2) : '0.70'}`,
    `规则兜底门槛：至少 ${effectiveRepeated} 次成功`,
    `AI不可用时规则兜底：${fallbackText}`,
    `覆盖规则生效数：${validOverrides}/${skillPolicyOverridesDraft.length}`
  ].join(' | ');
}

function renderSkillPolicyRuleConfigSummary() {
  const mode = String((document.getElementById('skillPolicyModeSelect') || {}).value || 'hybrid');
  const minRepeatedNode = document.getElementById('skillPolicyMinRepeated');
  const minConfidenceNode = document.getElementById('skillPolicyMinConfidence');
  const fallbackNode = document.getElementById('skillPolicyFallback');
  const summaryNode = document.getElementById('skillPolicyRuleSummary');
  const listNode = document.getElementById('skillPolicyRuleList');
  const minRepeatedRaw = Number(minRepeatedNode ? minRepeatedNode.value : 2);
  const minRepeated = Number.isFinite(minRepeatedRaw) ? Math.max(1, Math.round(minRepeatedRaw)) : 2;
  const effectiveRepeated = Math.max(2, minRepeated);
  const minConfidence = Number(minConfidenceNode ? minConfidenceNode.value : 0.7);
  const fallbackEnabled = fallbackNode ? String(fallbackNode.value || 'true') !== 'false' : true;
  const fallbackText = fallbackEnabled ? '开启' : '关闭';
  const overrideCount = Array.isArray(skillPolicyOverridesDraft) ? skillPolicyOverridesDraft.length : 0;

  if (summaryNode) {
    if (mode === 'rules') {
      summaryNode.textContent = `当前是“规则优先”：只按规则沉淀；达到 ${effectiveRepeated} 次成功后才允许沉淀；已配置覆盖规则 ${overrideCount} 条。`;
    } else if (mode === 'hybrid') {
      summaryNode.textContent = `当前是“平衡策略”：先由 AI 判断（阈值 ${Number.isFinite(minConfidence) ? minConfidence.toFixed(2) : '0.70'}），AI 不稳时可规则兜底（${fallbackText}，门槛 ${effectiveRepeated} 次）；覆盖规则 ${overrideCount} 条。`;
    } else {
      summaryNode.textContent = `当前是“AI优先”：默认不走规则；仅在允许兜底（${fallbackText}）且达到 ${effectiveRepeated} 次成功时使用规则；覆盖规则 ${overrideCount} 条。`;
    }
  }

  if (listNode) {
    listNode.innerHTML = [
      '<li>系统固定规则：同类任务只有“成功”才会累计次数。</li>',
      '<li>系统固定规则：最少成功次数最低按 2 次计算（不会低于 2）。</li>',
      `<li>你可调整：规则兜底前最少成功次数（当前填 ${minRepeated}，实际按 ${effectiveRepeated} 生效）。</li>`,
      `<li>你可调整：AI 暂不可用时是否启用规则兜底（当前 ${fallbackText}）。</li>`,
      '<li>你可调整：分层覆盖策略（按租户/部门/角色/员工定制不同门槛）。</li>'
    ].join('');
  }
  renderSkillPolicyEffectivePreview();
}

function applySkillPolicyModeSpecificFieldState(mode) {
  const isRules = String(mode || 'hybrid') === 'rules';
  const repeatedLabel = document.getElementById('skillPolicyMinRepeatedLabel');
  const confidenceNode = document.getElementById('skillPolicyMinConfidence');
  const fallbackNode = document.getElementById('skillPolicyFallback');
  const hintNode = document.getElementById('skillPolicyHint');
  if (repeatedLabel) {
    repeatedLabel.textContent = '同类任务历史成功达到 N 次后，才允许自动沉淀';
  }
  if (hintNode) {
    hintNode.textContent = isRules
      ? '建议：先用 2-5 次；值越大越稳，沉淀会更慢。'
      : '建议：先用默认值；沉淀太多就提高 AI 阈值，沉淀太少就适度降低。';
  }
  if (confidenceNode) {
    confidenceNode.disabled = isRules;
    confidenceNode.title = isRules ? '规则优先时不使用 AI 阈值。' : '';
  }
  if (fallbackNode) {
    fallbackNode.disabled = isRules;
    fallbackNode.title = isRules ? '规则优先时默认按规则执行。' : '';
  }
  renderSkillPolicyRuleConfigSummary();
}

function setSkillPolicyStatus(message, isError = false) {
  const node = document.getElementById('skillPolicyToast');
  if (!node) return;
  const text = String(message || '').trim();
  if (!text) {
    node.textContent = '';
    node.classList.add('hidden');
    node.classList.remove('error');
    if (skillPolicyToastTimer) {
      clearTimeout(skillPolicyToastTimer);
      skillPolicyToastTimer = null;
    }
    return;
  }
  node.textContent = text;
  node.classList.toggle('error', Boolean(isError));
  node.classList.remove('hidden');
  if (skillPolicyToastTimer) clearTimeout(skillPolicyToastTimer);
  skillPolicyToastTimer = setTimeout(() => {
    node.classList.add('hidden');
    node.classList.remove('error');
    skillPolicyToastTimer = null;
  }, isError ? 3000 : 2200);
}

function normalizeSkillPolicy(policy) {
  const p = policy && typeof policy === 'object' ? policy : {};
  const mode = String(p.mode || 'hybrid');
  const minConfidence = Number(p.minConfidence);
  const minRepeated = Number(p.minRepeatedSuccessForFallback);
  return {
    mode,
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : 0.7,
    minRepeatedSuccessForFallback: Number.isFinite(minRepeated) ? minRepeated : 2,
    fallbackToRulesWhenModelUnavailable: p.fallbackToRulesWhenModelUnavailable !== false,
    overridesCount: Array.isArray(p.overrides) ? p.overrides.length : 0
  };
}

function setSkillPolicyDiff(text) {
  const node = document.getElementById('skillPolicyDiff');
  if (!node) return;
  node.textContent = String(text || '');
}

function diffSkillPolicy(before, after) {
  const prev = normalizeSkillPolicy(before);
  const next = normalizeSkillPolicy(after);
  const changes = [];
  if (prev.mode !== next.mode) changes.push(`模式：${sedimentationModeLabel(prev.mode)} -> ${sedimentationModeLabel(next.mode)}`);
  if (prev.minConfidence !== next.minConfidence) changes.push(`最低置信度：${prev.minConfidence.toFixed(2)} -> ${next.minConfidence.toFixed(2)}`);
  if (prev.minRepeatedSuccessForFallback !== next.minRepeatedSuccessForFallback) {
    changes.push(`最少成功次数：${prev.minRepeatedSuccessForFallback} -> ${next.minRepeatedSuccessForFallback}`);
  }
  if (prev.fallbackToRulesWhenModelUnavailable !== next.fallbackToRulesWhenModelUnavailable) {
    changes.push(`模型不可用回退：${prev.fallbackToRulesWhenModelUnavailable ? '开启' : '关闭'} -> ${next.fallbackToRulesWhenModelUnavailable ? '开启' : '关闭'}`);
  }
  if (prev.overridesCount !== next.overridesCount) changes.push(`覆盖策略数量：${prev.overridesCount} -> ${next.overridesCount}`);
  return changes;
}

function setSkillPolicyForm(policy) {
  const p = normalizeSkillPolicy(policy);
  const modeNode = document.getElementById('skillPolicyModeSelect');
  const confidenceNode = document.getElementById('skillPolicyMinConfidence');
  const repeatedNode = document.getElementById('skillPolicyMinRepeated');
  const fallbackNode = document.getElementById('skillPolicyFallback');
  if (modeNode) modeNode.value = p.mode;
  if (confidenceNode) confidenceNode.value = String(p.minConfidence);
  if (repeatedNode) repeatedNode.value = String(p.minRepeatedSuccessForFallback);
  if (fallbackNode) fallbackNode.value = p.fallbackToRulesWhenModelUnavailable ? 'true' : 'false';
  skillPolicyOverridesDraft = normalizeSkillPolicyOverrides(policy && Array.isArray(policy.overrides) ? policy.overrides : []);
  renderSkillPolicyOverridesEditor();
  setSkillPolicyModeExplain(p.mode);
  applySkillPolicyModeSpecificFieldState(p.mode);
  renderSkillPolicyRuleConfigSummary();
}

async function loadSkillSedimentationPolicy() {
  try {
    const policy = await api('/api/admin/runtime/skill-sedimentation-policy');
    if (!skillPolicyDirty) setSkillPolicyForm(policy);
    lastSkillPolicySnapshot = normalizeSkillPolicy(policy);
    if (!skillPolicyDirty) {
      setSkillPolicyStatus('');
      setSkillPolicyDiff('');
    }
  } catch (error) {
    setSkillPolicyStatus(`策略加载失败：${String(error && error.message ? error.message : 'request failed')}`, true);
  }
}

function readFilters() {
  const sourceNode = document.getElementById('filterSkillSource');
  const nameNode = document.getElementById('filterSkillName');
  const employeeNode = document.getElementById('filterSkillEmployee');
  return {
    source: String(sourceNode && sourceNode.value ? sourceNode.value : '').trim(),
    name: String(nameNode && nameNode.value ? nameNode.value : '').trim(),
    employeeId: String(employeeNode && employeeNode.value ? employeeNode.value : '').trim()
  };
}

function buildSkillListUrl() {
  const filters = readFilters();
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.name) params.set('name', filters.name);
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  const query = params.toString();
  return query ? `/api/admin/skills?${query}` : '/api/admin/skills';
}

function formatSkillSourceLabel(source) {
  const value = String(source || '').trim();
  if (!value) return '-';
  const key = value.toLowerCase();
  return SKILL_SOURCE_LABELS[key] || value;
}

function renderSourceFilterOptions(rows = []) {
  const sourceNode = document.getElementById('filterSkillSource');
  if (!sourceNode) return;
  const currentValue = String(sourceNode.value || '').trim();
  const sourceSet = new Set();
  for (const row of rows) {
    const source = String((row && row.source) || '').trim();
    if (source) sourceSet.add(source);
  }
  if (currentValue) sourceSet.add(currentValue);
  const values = Array.from(sourceSet).sort((a, b) => a.localeCompare(b));
  sourceNode.innerHTML = `
    <option value="">全部来源</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(formatSkillSourceLabel(value))}</option>`).join('')}
  `;
  sourceNode.value = currentValue;
}

function renderEmployeeFilterOptions() {
  const employeeNode = document.getElementById('filterSkillEmployee');
  if (!employeeNode) return;
  const currentValue = String(employeeNode.value || '').trim();
  employeeNode.innerHTML = `
    <option value="">全部数字员工</option>
    ${employeeCandidates.map((employee) => {
    const value = String(employee.id || '').trim();
    const label = [employee.name || employee.employeeCode || employee.id, employee.department, employee.role]
      .filter(Boolean)
      .join(' / ');
    return `<option value="${escapeHtml(value)}">${escapeHtml(label || value || '-')}</option>`;
  }).join('')}
  `;
  employeeNode.value = currentValue;
}

async function loadEmployeeCandidates() {
  try {
    const rows = await api('/api/admin/skills/employees');
    employeeCandidates = Array.isArray(rows) ? rows : [];
    employeeCandidatesLoaded = true;
    employeeCandidatesError = '';
  } catch (error) {
    employeeCandidates = [];
    employeeCandidatesLoaded = false;
    employeeCandidatesError = String((error && error.message) || 'request failed');
  }
  renderEmployeeFilterOptions();
}

function renderLinkEmployeeSection(detail, linkedEmployees) {
  const linkedSet = new Set(linkedEmployees.map((item) => String(item.id || '')));
  const candidates = employeeCandidates.filter((item) => !linkedSet.has(String(item.id || '')));
  const optionsHtml = candidates
    .map((employee) => {
      const label = [employee.name || employee.employeeCode || employee.id, employee.department, employee.role]
        .filter(Boolean)
        .join(' / ');
      return `<option value="${escapeHtml(employee.id || '')}">${escapeHtml(label || employee.id || '-')}</option>`;
    })
    .join('');
  const selectorHtml = candidates.length
    ? `<select class="admin-select" data-link-employee-select>
        <option value="">请选择数字员工</option>
        ${optionsHtml}
      </select>`
    : `<div class="empty">${employeeCandidatesLoaded ? '暂无可关联员工（可能已全部关联）' : `员工列表不可用：${escapeHtml(employeeCandidatesError || '加载中')}`}</div>`;
  return `
    <div class="skill-detail-card">
      <h4>手动关联数字员工能力</h4>
      <div class="toolbar-note">将当前技能手动关联到指定数字员工。</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
        ${selectorHtml}
        <button type="button" data-link-employee-btn data-link-skill-id="${escapeHtml(detail.id || '')}" data-required-permission="admin.skills.write" ${candidates.length ? '' : 'disabled'}>关联</button>
      </div>
    </div>
  `;
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function applyActionAcl(root) {
  if (typeof window.adminApplyActionAclForRoot === 'function') {
    window.adminApplyActionAclForRoot(root || document);
  }
}

function renderEmpty(message) {
  document.getElementById('rows').innerHTML = `<tr><td colspan="5" class="empty">${message}</td></tr>`;
}

function escapeHtml(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderStatus(message, isError = false) {
  const node = document.getElementById('importStatus');
  if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? '#932727' : '#5e6f8e';
}

function canAccess(permission) {
  const user = currentSession && currentSession.user ? currentSession.user : null;
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const compat = {
    'admin.skills.action.debug-toggle': ['admin.skills.debug'],
    'admin.skills.action.unlink-employee': ['admin.skills.delete'],
    'admin.skills.action.delete': ['admin.skills.delete'],
    'admin.skills.debug': ['admin.skills.action.debug-toggle'],
    'admin.skills.delete': ['admin.skills.action.unlink-employee', 'admin.skills.action.delete']
  };
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const fallback = compat[String(permission || '')] || [];
  return fallback.some((item) => perms.includes(item));
}

function setDrawerVisibility(open) {
  drawerOpen = Boolean(open);
  const drawer = document.getElementById('skillDetailDrawer');
  const mask = document.getElementById('skillDrawerMask');
  if (!drawer || !mask) return;
  drawer.classList.toggle('hidden', !drawerOpen);
  mask.classList.toggle('hidden', !drawerOpen);
  drawer.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
  mask.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
}

function setSkillPolicyDrawerVisibility(open) {
  skillPolicyDrawerOpen = Boolean(open);
  const drawer = document.getElementById('skillPolicyDrawer');
  const mask = document.getElementById('skillPolicyDrawerMask');
  if (!drawer || !mask) return;
  drawer.classList.toggle('hidden', !skillPolicyDrawerOpen);
  mask.classList.toggle('hidden', !skillPolicyDrawerOpen);
  drawer.setAttribute('aria-hidden', skillPolicyDrawerOpen ? 'false' : 'true');
  mask.setAttribute('aria-hidden', skillPolicyDrawerOpen ? 'false' : 'true');
}

function buildDetailDigest(detail) {
  try {
    return JSON.stringify(detail || {});
  } catch {
    return String(Date.now());
  }
}

function sanitizeHref(url) {
  const value = String(url || '').trim();
  if (!value) return '#';
  const lower = value.toLowerCase();
  if (lower.startsWith('javascript:')) return '#';
  return value;
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => (
    `<a href="${escapeHtml(sanitizeHref(href))}" target="_blank" rel="noopener noreferrer">${label}</a>`
  ));
  return html;
}

function renderMarkdownDocument(markdown) {
  const lines = String(markdown || '').replaceAll('\r\n', '\n').split('\n');
  if (!lines.length || !lines.some((line) => line.trim())) return '<div class="empty">暂无 SKILL.md 内容</div>';
  let i = 0;
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines = [];
  const blocks = [];

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    blocks.push(`<pre class="mono skill-markdown-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    inCodeBlock = false;
    codeLang = '';
    codeLines = [];
  };

  const collectParagraph = (startIndex) => {
    const paragraph = [];
    let cursor = startIndex;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const trimmed = line.trim();
      if (!trimmed) break;
      if (/^#{1,6}\s+/.test(trimmed)) break;
      if (/^```/.test(trimmed)) break;
      if (/^>\s?/.test(trimmed)) break;
      if (/^[-*]\s+/.test(trimmed)) break;
      if (/^\d+\.\s+/.test(trimmed)) break;
      paragraph.push(trimmed);
      cursor += 1;
    }
    return {
      next: cursor,
      html: paragraph.length ? `<p>${renderInlineMarkdown(paragraph.join(' '))}</p>` : ''
    };
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (inCodeBlock) {
      if (/^```/.test(trimmed)) {
        flushCodeBlock();
      } else {
        codeLines.push(raw);
      }
      i += 1;
      continue;
    }
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (/^```/.test(trimmed)) {
      inCodeBlock = true;
      codeLang = trimmed.replace(/^```/, '').trim();
      if (codeLang) blocks.push(`<div class="skill-markdown-code-lang">${escapeHtml(codeLang)}</div>`);
      i += 1;
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(`<blockquote>${renderInlineMarkdown(quote.join(' '))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ol>`);
      continue;
    }
    const paragraph = collectParagraph(i);
    if (paragraph.html) blocks.push(paragraph.html);
    i = paragraph.next > i ? paragraph.next : i + 1;
  }
  flushCodeBlock();
  return `<div class="skill-markdown">${blocks.join('')}</div>`;
}

function normalizeResourceGroups(rawResources) {
  const empty = {
    scripts: [],
    templates: [],
    references: [],
    assets: [],
    examples: [],
    tools: [],
    others: []
  };
  if (!rawResources || typeof rawResources !== 'object') return empty;
  const groups = { ...empty };
  const normalizeItem = (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') return { path: entry };
    if (typeof entry !== 'object') return null;
    return {
      name: String(entry.name || '').trim(),
      path: String(entry.path || '').trim(),
      description: String(entry.description || '').trim(),
      command: String(entry.command || '').trim(),
      entry: String(entry.entry || '').trim(),
      content: typeof entry.content === 'string' ? entry.content : '',
      contentType: String(entry.contentType || '').trim(),
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0
    };
  };
  for (const key of Object.keys(groups)) {
    groups[key] = Array.isArray(rawResources[key]) ? rawResources[key].map(normalizeItem).filter(Boolean) : [];
  }
  return groups;
}

function flattenResourceList(resources) {
  const groups = [
    { key: 'scripts', label: '脚本 Scripts' },
    { key: 'templates', label: '模板 Templates' },
    { key: 'references', label: '参考资料 References' },
    { key: 'assets', label: '素材 Assets' },
    { key: 'examples', label: '示例 Examples' },
    { key: 'tools', label: '工具 Tools' },
    { key: 'others', label: '其他 Others' }
  ];
  const out = [];
  for (const group of groups) {
    const list = Array.isArray(resources[group.key]) ? resources[group.key] : [];
    for (const item of list) out.push({ ...item, groupLabel: group.label, groupKey: group.key });
  }
  return out;
}

function renderResourceViewer(resource) {
  if (!resource) return '<div class="empty">点击左侧资源查看内容</div>';
  if (!resource.content) {
    return `<div class="empty">该资源暂无可预览文本内容（可能是二进制或未包含内容）</div>`;
  }
  const lowerPath = String(resource.path || '').toLowerCase();
  if (lowerPath.endsWith('.md') || String(resource.contentType || '').toLowerCase() === 'text/markdown') {
    return renderMarkdownDocument(resource.content);
  }
  return `<pre class="mono skill-resource-pre">${escapeHtml(resource.content)}</pre>`;
}

function renderResourceGroups(structure, skillId) {
  const resources = normalizeResourceGroups((structure && structure.resources) || {});
  const flat = flattenResourceList(resources);
  if (!flat.length) return '<div class="empty">暂无资源声明（脚本/模板/参考等）</div>';
  const selected = selectedResourcePathBySkillId.get(skillId) || (flat[0] && flat[0].path) || '';
  const selectedResource = flat.find((x) => x.path === selected) || flat[0];
  return `
    <div class="skill-resource-layout">
      <div class="skill-resource-list">
        ${flat.map((item) => {
    const isActive = selectedResource && item.path === selectedResource.path;
    return `
            <button type="button" class="skill-resource-item${isActive ? ' active' : ''}" data-skill-resource-path="${escapeHtml(item.path)}">
              <span class="skill-resource-item-name">${escapeHtml(item.name || item.path || '-')}</span>
              <span class="skill-resource-item-meta">${escapeHtml(item.groupLabel)} · ${escapeHtml(item.path || '-')}</span>
            </button>
          `;
  }).join('')}
      </div>
      <div class="skill-resource-viewer">
        <div class="skill-resource-viewer-head">${escapeHtml(selectedResource.path || '-')}</div>
        ${renderResourceViewer(selectedResource)}
      </div>
    </div>
  `;
}

function renderTextList(items = []) {
  const list = Array.isArray(items)
    ? items.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!list.length) return '<div class="empty">暂无</div>';
  return `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function isDefaultGeneratedStructure(structure = {}, name = '') {
  const skillName = String(name || '').trim();
  const summary = String(structure.summary || '').trim();
  const prompt = String(structure.prompt || '').trim();
  const trigger = Array.isArray(structure.trigger) ? structure.trigger.map((x) => String(x || '').trim()) : [];
  const steps = Array.isArray(structure.steps) ? structure.steps.map((x) => String(x || '').trim()) : [];
  const inputs = Array.isArray(structure.inputs) ? structure.inputs.map((x) => String(x || '').trim()) : [];
  const outputs = Array.isArray(structure.outputs) ? structure.outputs.map((x) => String(x || '').trim()) : [];
  const resources = normalizeResourceGroups(structure.resources || {});
  const hasResources = flattenResourceList(resources).length > 0;
  const expectedSummary = skillName ? `${skillName} 的标准化执行技能` : '';
  const expectedTrigger = skillName ? [skillName] : [];
  const expectedSteps = [
    skillName ? `理解任务目标：${skillName}` : '',
    '执行任务步骤并记录关键输出',
    '复盘并更新可复用经验'
  ].filter(Boolean);
  const expectedInputs = ['任务目标', '上下文信息'];
  const expectedOutputs = ['执行结果', '复盘结论'];
  return (
    Boolean(expectedSummary)
    && summary === expectedSummary
    && prompt === ''
    && trigger.join('|') === expectedTrigger.join('|')
    && steps.join('|') === expectedSteps.join('|')
    && inputs.join('|') === expectedInputs.join('|')
    && outputs.join('|') === expectedOutputs.join('|')
    && !hasResources
  );
}

function renderStructuredDefinition(structure = {}, detail = {}) {
  const source = String((detail && detail.source) || '').toLowerCase();
  const runtimeMeta = detail && detail.runtimeMeta && typeof detail.runtimeMeta === 'object'
    ? detail.runtimeMeta
    : {};
  const inference = runtimeMeta.platformInference && typeof runtimeMeta.platformInference === 'object'
    ? runtimeMeta.platformInference
    : {};
  if (source.startsWith('runtime:') && inference.descriptionInferred && isDefaultGeneratedStructure(structure, detail.name)) {
    return '';
  }
  const summary = String(structure.summary || '').trim();
  const prompt = String(structure.prompt || '').trim();
  return `
    <div class="skill-detail-card">
      <h4>结构化定义</h4>
      <div><strong>Summary</strong></div>
      <div class="toolbar-note">${escapeHtml(summary || '暂无')}</div>
      <div style="margin-top:8px;"><strong>Prompt</strong></div>
      ${prompt ? `<pre class="mono skill-detail-pre">${escapeHtml(prompt)}</pre>` : '<div class="empty">暂无</div>'}
      <div style="margin-top:8px;"><strong>Trigger</strong></div>
      ${renderTextList(structure.trigger)}
      <div style="margin-top:8px;"><strong>Steps</strong></div>
      ${renderTextList(structure.steps)}
      <div style="margin-top:8px;"><strong>Inputs</strong></div>
      ${renderTextList(structure.inputs)}
      <div style="margin-top:8px;"><strong>Outputs</strong></div>
      ${renderTextList(structure.outputs)}
    </div>
  `;
}

function renderProposalDetail(proposal = {}) {
  if (!proposal || typeof proposal !== 'object') return '';
  const history = Array.isArray(proposal.history) ? proposal.history : [];
  const evaluation = proposal.evaluation && typeof proposal.evaluation === 'object' ? proposal.evaluation : {};
  const evidence = Array.isArray(evaluation.evidence) ? evaluation.evidence : [];
  const hardGate = evaluation.hardGate && typeof evaluation.hardGate === 'object' ? evaluation.hardGate : {};
  const hardGateReasons = Array.isArray(hardGate.reasons) ? hardGate.reasons : [];
  return `
    <div class="skill-detail-card">
      <h4>提案与审批</h4>
      <div class="skill-detail-meta">
        <div><span>提案人</span><strong>${escapeHtml(proposal.proposedBy || '-')}</strong></div>
        <div><span>提案时间</span><strong>${proposal.proposedAt ? escapeHtml(new Date(proposal.proposedAt).toLocaleString()) : '-'}</strong></div>
        <div><span>决策引擎</span><strong>${escapeHtml(proposal.decisionEngine || '-')}</strong></div>
        <div><span>置信度</span><strong>${Number.isFinite(Number(proposal.confidence)) ? Number(proposal.confidence).toFixed(2) : '-'}</strong></div>
        <div><span>证据条数</span><strong>${evidence.length}</strong></div>
        <div><span>硬门禁</span><strong>${hardGate.passed === false ? '未通过' : '通过'}</strong></div>
      </div>
      ${hardGateReasons.length ? `<div class="toolbar-note">硬门禁原因：${escapeHtml(hardGateReasons.join('；'))}</div>` : ''}
      <div style="margin-top:8px;"><strong>状态流转记录</strong></div>
      ${history.length ? `<ul>${history.map((row) => {
    const from = row.from == null ? '-' : String(row.from);
    const to = row.to == null ? '-' : String(row.to);
    const actor = String(row.actorId || '-');
    const at = row.at ? new Date(row.at).toLocaleString() : '-';
    const note = String(row.note || '').trim();
    return `<li>${escapeHtml(`${from} -> ${to} | ${actor} | ${at}${note ? ` | ${note}` : ''}`)}</li>`;
  }).join('')}</ul>` : '<div class="empty">暂无</div>'}
    </div>
  `;
}

function renderRuntimeTruth(detail = {}) {
  const source = String(detail.source || '').toLowerCase();
  if (!source.startsWith('runtime:')) return '';
  const runtimeMeta = detail && detail.runtimeMeta && typeof detail.runtimeMeta === 'object'
    ? detail.runtimeMeta
    : {};
  const runtime = runtimeMeta.runtime && typeof runtimeMeta.runtime === 'object'
    ? runtimeMeta.runtime
    : {};
  const inference = runtimeMeta.platformInference && typeof runtimeMeta.platformInference === 'object'
    ? runtimeMeta.platformInference
    : {};
  const runtimeRows = [
    ['slug', runtime.slug],
    ['title', runtime.title],
    ['status', runtime.status],
    ['type', runtime.type],
    ['domain', runtime.domain],
    ['version', runtime.version],
    ['description', runtime.description]
  ];
  const inferenceRows = [
    ['typeInferred', inference.typeInferred],
    ['domainInferred', inference.domainInferred],
    ['versionInferred', inference.versionInferred],
    ['descriptionInferred', inference.descriptionInferred],
    ['platformStatus', inference.platformStatus]
  ];
  return `
    <div class="skill-detail-card">
      <h4>运行态真实返回（Runtime Truth）</h4>
      <div class="toolbar-note">以下内容按运行态原样展示；平台推断字段会单独标注。</div>
      <div style="margin-top:8px;"><strong>运行态原始字段</strong></div>
      <ul>
        ${runtimeRows.map(([key, value]) => `<li>${escapeHtml(String(key))}: ${escapeHtml(String(value == null || value === '' ? '(missing)' : value))}</li>`).join('')}
      </ul>
      <div style="margin-top:8px;"><strong>平台推断字段</strong></div>
      <ul>
        ${inferenceRows.map(([key, value]) => `<li>${escapeHtml(String(key))}: ${escapeHtml(String(value == null || value === '' ? '(missing)' : value))}</li>`).join('')}
      </ul>
      <details>
        <summary>运行态原始 JSON</summary>
        <pre class="mono skill-detail-pre">${escapeHtml(JSON.stringify(runtime.raw || {}, null, 2))}</pre>
      </details>
    </div>
  `;
}

function openDetail(detail, options = {}) {
  const force = Boolean(options.force);
  const body = document.getElementById('skillDrawerBody');
  const title = document.getElementById('skillDrawerTitle');
  if (!body || !title) return;
  const incomingSkillId = String((detail && detail.id) || '');
  const nextDetailDigest = buildDetailDigest(detail);
  if (!force && drawerOpen && incomingSkillId && incomingSkillId === currentSkillId && nextDetailDigest === currentDetailDigest) return;
  const existingRawDetails = document.getElementById('skillRawJsonDetails');
  const existingManagerDetails = document.getElementById('skillManagerDetails');
  const prevScrollTop = body.scrollTop;
  if (existingRawDetails && currentSkillId) {
    rawJsonExpandedBySkillId.set(currentSkillId, Boolean(existingRawDetails.open));
  }
  if (existingManagerDetails && currentSkillId) {
    managerInfoExpandedBySkillId.set(currentSkillId, Boolean(existingManagerDetails.open));
  }
  const linkedEmployees = Array.isArray(detail.linkedEmployees) ? detail.linkedEmployees : [];
  const structure = detail && detail.structure && typeof detail.structure === 'object' ? detail.structure : {};
  const linkedEmployeesHtml = linkedEmployees.length
    ? `<ul>${linkedEmployees.map((employee) => `
        <li>
          <strong>${escapeHtml(employee.name || employee.employeeCode || employee.id || '-')}</strong>
          <span class="skill-linked-employee-meta">${escapeHtml([employee.department, employee.role].filter(Boolean).join(' / ') || '未填写部门/角色')}</span>
          ${canUnlinkEmployee ? `<button type="button" class="btn-link" data-unlink-employee-id="${escapeHtml(employee.id || '')}" data-required-permission="admin.skills.action.unlink-employee">解除关联</button>` : ''}
        </li>
      `).join('')}</ul>`
    : '<div class="empty">暂无关联员工</div>';
  const markdownSource = String(structure.skillMarkdown || '').trim();
  const skillMarkdownHtml = markdownSource ? renderMarkdownDocument(markdownSource) : '<div class="empty">该技能未上传 SKILL.md 全量内容</div>';
  const isRawJsonExpanded = rawJsonExpandedBySkillId.get(incomingSkillId) === true;
  const isManagerInfoExpanded = managerInfoExpandedBySkillId.get(incomingSkillId) === true;
  const proposal = detail && detail.proposal && typeof detail.proposal === 'object' ? detail.proposal : null;
  const hasManagerSection = Boolean(
    proposal
    || linkedEmployees.length
    || canDeleteSkill
    || canWriteSkills
  );
  title.textContent = `技能详情 · ${escapeHtml(detail.name || detail.id || '-')}`;
  body.innerHTML = `
    <div class="skill-detail-meta">
      <div><span>技能名称</span><strong>${escapeHtml(detail.name || '-')}</strong></div>
      <div><span>技能ID</span><strong>${escapeHtml(detail.id || '-')}</strong></div>
      <div><span>状态</span><strong>${escapeHtml(detail.status || '-')}</strong></div>
      <div><span>版本</span><strong>${escapeHtml(detail.version || '-')}</strong></div>
      <div><span>来源</span><strong>${escapeHtml(detail.source || '-')}</strong></div>
    </div>
    <div class="skill-detail-description">${escapeHtml(detail.description || '暂无描述')}</div>
    <div class="skill-detail-card">
      <h4>SKILL.md（全量）</h4>
      ${skillMarkdownHtml}
    </div>
    ${renderRuntimeTruth(detail)}
    <div class="skill-detail-card">
      <h4>资源声明（点击查看）</h4>
      ${renderResourceGroups(structure, incomingSkillId)}
    </div>
    ${hasManagerSection ? `<details id="skillManagerDetails" class="skill-detail-card" ${isManagerInfoExpanded ? 'open' : ''}>
      <summary>管理信息（可选）</summary>
      ${proposal ? renderProposalDetail(proposal) : ''}
      <div class="skill-detail-card">
        <h4>关联员工</h4>
        ${linkedEmployeesHtml}
      </div>
      ${renderLinkEmployeeSection(detail, linkedEmployees)}
      ${canDeleteSkill ? `<div class="skill-detail-card">
        <h4>高权限操作</h4>
        <div class="toolbar-note">删除技能前需无关联员工；若存在关联请先点击“解除关联”。</div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">
          <button type="button" class="primary" data-delete-skill-id="${escapeHtml(detail.id || '')}" data-required-permission="admin.skills.action.delete" ${linkedEmployees.length ? 'disabled' : ''}>删除技能</button>
        </div>
      </div>` : ''}
      <details id="skillRawJsonDetails" class="skill-raw-json" ${isRawJsonExpanded ? 'open' : ''}>
        <summary>查看原始 JSON</summary>
        <pre class="mono skill-detail-pre">${escapeHtml(JSON.stringify(detail, null, 2))}</pre>
      </details>
    </details>` : `<details id="skillRawJsonDetails" class="skill-raw-json" ${isRawJsonExpanded ? 'open' : ''}>
      <summary>查看原始 JSON</summary>
      <pre class="mono skill-detail-pre">${escapeHtml(JSON.stringify(detail, null, 2))}</pre>
    </details>`}
  `;
  currentSkillId = incomingSkillId;
  currentDetailDigest = nextDetailDigest;
  body.scrollTop = prevScrollTop;
  const rawJsonDetailsNode = document.getElementById('skillRawJsonDetails');
  if (rawJsonDetailsNode) {
    rawJsonDetailsNode.addEventListener('toggle', () => {
      if (!currentSkillId) return;
      rawJsonExpandedBySkillId.set(currentSkillId, Boolean(rawJsonDetailsNode.open));
    });
  }
  const managerDetailsNode = document.getElementById('skillManagerDetails');
  if (managerDetailsNode) {
    managerDetailsNode.addEventListener('toggle', () => {
      if (!currentSkillId) return;
      managerInfoExpandedBySkillId.set(currentSkillId, Boolean(managerDetailsNode.open));
    });
  }
  body.querySelectorAll('[data-skill-resource-path]').forEach((node) => {
    node.addEventListener('click', () => {
      const path = node.getAttribute('data-skill-resource-path') || '';
      if (!path || !currentSkillId) return;
      selectedResourcePathBySkillId.set(currentSkillId, path);
      openDetail(detail, { force: true });
    });
  });
  body.querySelectorAll('[data-unlink-employee-id]').forEach((node) => {
    node.addEventListener('click', async () => {
      const employeeId = String(node.getAttribute('data-unlink-employee-id') || '').trim();
      if (!employeeId || !currentSkillId) return;
      const skillLabel = String(detail.name || currentSkillId).trim() || currentSkillId;
      const employeeLabel = String(node.closest('li') && node.closest('li').querySelector('strong')
        ? node.closest('li').querySelector('strong').textContent
        : employeeId).trim() || employeeId;
      const confirmed = window.confirm(`确认解除技能 ${skillLabel} 与员工 ${employeeLabel} 的关联吗？`);
      if (!confirmed) return;
      const second = window.prompt(`请输入员工ID进行二次确认：${employeeId}`, '');
      if (String(second || '').trim() !== employeeId) {
        renderStatus('二次确认未通过，已取消解除关联', true);
        return;
      }
      try {
        await api(`/api/admin/skills/${encodeURIComponent(currentSkillId)}/unlink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId })
        });
        renderStatus('已解除关联员工');
        await load();
        const refreshed = await api(`/api/admin/skills/${encodeURIComponent(currentSkillId)}`);
        openDetail(refreshed, { force: true });
      } catch (error) {
        renderStatus(`解除关联失败：${error.message}`, true);
      }
    });
  });
  const linkBtn = body.querySelector('[data-link-employee-btn]');
  if (linkBtn) {
    linkBtn.addEventListener('click', async () => {
      const skillId = String(linkBtn.getAttribute('data-link-skill-id') || '').trim();
      const select = body.querySelector('[data-link-employee-select]');
      const employeeId = String(select && select.value ? select.value : '').trim();
      if (!skillId || !employeeId) {
        renderStatus('请先选择要关联的数字员工', true);
        return;
      }
      try {
        await api(`/api/admin/skills/${encodeURIComponent(skillId)}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId })
        });
        renderStatus('已手动关联数字员工能力');
        await loadEmployeeCandidates();
        await load();
        const refreshed = await api(`/api/admin/skills/${encodeURIComponent(skillId)}`);
        openDetail(refreshed, { force: true });
      } catch (error) {
        renderStatus(`手动关联失败：${error.message}`, true);
      }
    });
  }
  const deleteBtn = body.querySelector('[data-delete-skill-id]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const skillName = String(detail.name || '').trim();
      const skillId = String(detail.id || '').trim();
      if (!skillId) return;
      const confirmed = window.confirm(`确认删除技能 ${skillName || skillId} 吗？此操作不可恢复。`);
      if (!confirmed) return;
      const second = window.prompt(`请输入技能名称进行二次确认：${skillName}`, '');
      if (String(second || '').trim() !== skillName) {
        renderStatus('二次确认未通过，已取消删除', true);
        return;
      }
      try {
        await api(`/api/admin/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
        renderStatus(`技能 ${skillName || skillId} 已删除`);
        setDrawerVisibility(false);
        currentSkillId = '';
        await load();
      } catch (error) {
        renderStatus(`删除失败：${error.message}`, true);
      }
    });
  }
  applyActionAcl(body);
  setDrawerVisibility(true);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function load() {
  try {
    const rows = await api(buildSkillListUrl());
    renderSourceFilterOptions(rows);
    if (!Array.isArray(rows) || !rows.length) {
      currentSkillMap = new Map();
      renderEmpty('暂无技能数据');
      setText('skillCount', '0');
      setText('generalCount', '0');
      setText('domainCount', '0');
      currentSkillId = '';
      setDrawerVisibility(false);
      return;
    }
    currentSkillMap = new Map(rows.map((s) => [String(s.id || ''), s]));

    const general = rows.filter((x) => x.type === 'general').length;
    const domain = rows.filter((x) => x.type === 'domain').length;
    setText('skillCount', String(rows.length));
    setText('generalCount', String(general));
    setText('domainCount', String(domain));

    document.getElementById('rows').innerHTML = rows
      .map((s) => `
        <tr>
          <td><button type="button" class="btn-link skill-view-btn" data-skill-id="${escapeHtml(s.id || '')}">${escapeHtml(s.name || '-')}</button></td>
          <td>${escapeHtml(s.type || '-')}</td>
          <td>${escapeHtml(s.domain || '-')}</td>
          <td>${escapeHtml(formatSkillSourceLabel(s.source))}</td>
          <td>${s.createdAt ? escapeHtml(new Date(s.createdAt).toLocaleString()) : '-'}</td>
        </tr>
      `)
      .join('');

    if (drawerOpen) {
      if (!currentSkillId || !currentSkillMap.has(currentSkillId)) {
        currentSkillId = '';
        setDrawerVisibility(false);
      } else {
        try {
          const detail = await api(`/api/admin/skills/${encodeURIComponent(currentSkillId)}`);
          openDetail(detail);
        } catch {
          openDetail(currentSkillMap.get(currentSkillId));
        }
      }
    }
  } catch (error) {
    renderEmpty(`加载失败：${error.message}`);
  }
}

function bindEvents() {
  const rows = document.getElementById('rows');
  const closeDrawerBtn = document.getElementById('closeSkillDrawer');
  const drawerMask = document.getElementById('skillDrawerMask');
  const openSkillPolicyDrawerBtn = document.getElementById('openSkillPolicyDrawerBtn');
  const closeSkillPolicyDrawerBtn = document.getElementById('closeSkillPolicyDrawer');
  const skillPolicyDrawerMask = document.getElementById('skillPolicyDrawerMask');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const filterSkillSource = document.getElementById('filterSkillSource');
  const filterSkillName = document.getElementById('filterSkillName');
  const filterSkillEmployee = document.getElementById('filterSkillEmployee');
  const policyModeNode = document.getElementById('skillPolicyModeSelect');
  const policyConfidenceNode = document.getElementById('skillPolicyMinConfidence');
  const policyRepeatedNode = document.getElementById('skillPolicyMinRepeated');
  const policyFallbackNode = document.getElementById('skillPolicyFallback');
  const addSkillPolicyOverrideBtn = document.getElementById('addSkillPolicyOverrideBtn');
  const skillPolicyOverridesList = document.getElementById('skillPolicyOverridesList');
  const savePolicyBtn = document.getElementById('saveSkillPolicyBtn');

  const markSkillPolicyDirty = () => {
    skillPolicyDirty = true;
  };
  if (policyModeNode) {
    policyModeNode.addEventListener('change', () => {
      markSkillPolicyDirty();
      setSkillPolicyModeExplain(policyModeNode.value);
      applySkillPolicyModeSpecificFieldState(policyModeNode.value);
    });
  }
  if (policyConfidenceNode) policyConfidenceNode.addEventListener('input', markSkillPolicyDirty);
  if (policyConfidenceNode) {
    policyConfidenceNode.addEventListener('input', renderSkillPolicyRuleConfigSummary);
  }
  if (policyRepeatedNode) {
    policyRepeatedNode.addEventListener('input', markSkillPolicyDirty);
    policyRepeatedNode.addEventListener('input', renderSkillPolicyRuleConfigSummary);
  }
  if (policyFallbackNode) {
    policyFallbackNode.addEventListener('change', markSkillPolicyDirty);
    policyFallbackNode.addEventListener('change', renderSkillPolicyRuleConfigSummary);
  }
  if (addSkillPolicyOverrideBtn) {
    addSkillPolicyOverrideBtn.addEventListener('click', () => {
      skillPolicyOverridesDraft.push(normalizeSkillPolicyOverride({}, skillPolicyOverridesDraft.length));
      markSkillPolicyDirty();
      renderSkillPolicyOverridesEditor();
      renderSkillPolicyRuleConfigSummary();
    });
  }
  if (skillPolicyOverridesList) {
    skillPolicyOverridesList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const removeIndexText = target.getAttribute('data-override-remove');
      if (removeIndexText == null) return;
      const removeIndex = Number(removeIndexText);
      if (!Number.isInteger(removeIndex) || removeIndex < 0 || removeIndex >= skillPolicyOverridesDraft.length) return;
      skillPolicyOverridesDraft.splice(removeIndex, 1);
      markSkillPolicyDirty();
      renderSkillPolicyOverridesEditor();
      renderSkillPolicyRuleConfigSummary();
    });
    const syncOverrideField = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const indexRaw = target.getAttribute('data-override-index');
      if (indexRaw == null) return;
      const index = Number(indexRaw);
      if (!Number.isInteger(index) || index < 0 || index >= skillPolicyOverridesDraft.length) return;
      const field = target.getAttribute('data-override-field');
      const scopeField = target.getAttribute('data-override-scope-field');
      if (!field && !scopeField) return;
      const value = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
        ? target.value
        : '';
      if (field) updateSkillPolicyOverrideField(index, field, value);
      if (scopeField) updateSkillPolicyOverrideScopeField(index, scopeField, value);
      markSkillPolicyDirty();
      renderSkillPolicyRuleConfigSummary();
    };
    skillPolicyOverridesList.addEventListener('input', syncOverrideField);
    skillPolicyOverridesList.addEventListener('change', syncOverrideField);
  }
  if (savePolicyBtn) {
    savePolicyBtn.addEventListener('click', async () => {
      if (!canWriteRuntime) {
        setSkillPolicyStatus('当前账号没有运行策略写入权限（admin.runtime.write）', true);
        return;
      }
      const payload = {
        mode: policyModeNode ? String(policyModeNode.value || 'hybrid') : 'hybrid',
        minConfidence: Number(policyConfidenceNode ? policyConfidenceNode.value : 0.7),
        minRepeatedSuccessForFallback: Number(policyRepeatedNode ? policyRepeatedNode.value : 2),
        fallbackToRulesWhenModelUnavailable: policyFallbackNode ? String(policyFallbackNode.value || 'true') !== 'false' : true,
        overrides: buildSkillPolicyOverridesPayload()
      };
      const overridesValidationMessage = validateSkillPolicyOverrides(payload.overrides);
      if (overridesValidationMessage) {
        setSkillPolicyStatus(overridesValidationMessage, true);
        return;
      }

      savePolicyBtn.setAttribute('disabled', 'disabled');
      try {
        const updated = await api('/api/admin/runtime/skill-sedimentation-policy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const changes = diffSkillPolicy(lastSkillPolicySnapshot, updated);
        skillPolicyDirty = false;
        setSkillPolicyForm(updated);
        setSkillPolicyStatus(`保存成功：${new Date().toLocaleString()}`);
        setSkillPolicyDiff(changes.length ? `变更摘要：${changes.join('；')}` : '变更摘要：未检测到配置变化。');
        lastSkillPolicySnapshot = normalizeSkillPolicy(updated);
      } catch (error) {
        setSkillPolicyStatus(`保存失败：${String(error && error.message ? error.message : 'unknown')}`, true);
      } finally {
        savePolicyBtn.removeAttribute('disabled');
      }
    });
  }

  if (rows) {
    rows.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest('.skill-view-btn');
      if (!trigger) return;
      const skillId = trigger.getAttribute('data-skill-id');
      if (!skillId) return;
      try {
        const detail = await api(`/api/admin/skills/${encodeURIComponent(skillId)}`);
        openDetail(detail, { force: true });
      } catch (error) {
        try {
          const local = currentSkillMap.get(String(skillId));
          if (local) {
            openDetail(local, { force: true });
            renderStatus('详情接口不可用，已展示本地缓存', true);
            return;
          }
        } catch {}
        renderStatus(`详情加载失败：${error.message}`, true);
      }
    });
  }

  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', () => setDrawerVisibility(false));
  if (drawerMask) drawerMask.addEventListener('click', () => setDrawerVisibility(false));
  if (openSkillPolicyDrawerBtn) openSkillPolicyDrawerBtn.addEventListener('click', () => setSkillPolicyDrawerVisibility(true));
  if (closeSkillPolicyDrawerBtn) closeSkillPolicyDrawerBtn.addEventListener('click', () => setSkillPolicyDrawerVisibility(false));
  if (skillPolicyDrawerMask) skillPolicyDrawerMask.addEventListener('click', () => setSkillPolicyDrawerVisibility(false));

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        let data;
        try {
          data = await api('/api/admin/skills/export');
        } catch (error) {
          if (String(error.message || '').includes('Not Found')) {
            const skills = await api('/api/admin/skills');
            data = {
              schemaVersion: 'skills.export.v1',
              exportedAt: new Date().toISOString(),
              count: Array.isArray(skills) ? skills.length : 0,
              skills: Array.isArray(skills) ? skills : []
            };
          } else {
            throw error;
          }
        }
        const stamp = new Date().toISOString().replaceAll(':', '-');
        downloadJson(`skills-export-${stamp}.json`, data);
        renderStatus('导出成功');
      } catch (error) {
        renderStatus(`导出失败：${error.message}`, true);
      }
    });
  }

  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => {
      if (!canWriteSkills) {
        renderStatus('当前账号没有技能写入权限（admin.skills.write）', true);
        return;
      }
      importFile.click();
    });
    importFile.addEventListener('change', async () => {
      if (!canWriteSkills) {
        renderStatus('当前账号没有技能写入权限（admin.skills.write）', true);
        importFile.value = '';
        return;
      }
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      try {
        const isZip = String(file.name || '').toLowerCase().endsWith('.zip')
          || String(file.type || '').toLowerCase().includes('zip');
        let result;
        if (isZip) {
          const bundleName = encodeURIComponent(file.name || 'skill-bundle.zip');
          result = await api(`/api/admin/skills/import?mode=merge&bundleName=${bundleName}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/zip'
            },
            body: file
          });
        } else {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const payload = Array.isArray(parsed) ? { mode: 'merge', skills: parsed } : parsed;
          result = await api('/api/admin/skills/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }
        const archiveInfo = result && result.archive && result.archive.fileName
          ? `, bundle=${result.archive.fileName}, bundleSkills=${result.archive.skillCount || 0}`
          : '';
        renderStatus(`导入完成：created=${result.created || 0}, updated=${result.updated || 0}, invalid=${(result.invalid || []).length}${archiveInfo}`);
        await load();
      } catch (error) {
        renderStatus(`导入失败：${error.message}`, true);
      } finally {
        importFile.value = '';
      }
    });
  }

  let filterDebounceTimer = null;
  const scheduleLoad = () => {
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
      load().catch(() => {});
    }, 200);
  };
  const onFilterInput = () => {
    load().catch(() => {});
  };
  if (filterSkillName) filterSkillName.addEventListener('input', scheduleLoad);
  if (filterSkillSource) filterSkillSource.addEventListener('change', onFilterInput);
  if (filterSkillEmployee) filterSkillEmployee.addEventListener('change', onFilterInput);
  applyActionAcl(document);
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  try {
    currentSession = await api('/api/auth/me');
  } catch {
    currentSession = null;
  }
  canUseDebugMode = canAccess('admin.skills.action.debug-toggle');
  canDeleteSkill = canAccess('admin.skills.action.delete');
  canUnlinkEmployee = canAccess('admin.skills.action.unlink-employee');
  canWriteSkills = canAccess('admin.skills.write');
  canWriteRuntime = canAccess('admin.runtime.write');
  await loadEmployeeCandidates();
  bindEvents();
  await loadSkillSedimentationPolicy();
  await load();
  setInterval(loadSkillSedimentationPolicy, 5000);
  setInterval(load, 2500);
})();
