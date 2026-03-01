async function requestJson(path, options = {}) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'request failed');
  return body;
}

const BASELINE_SYSTEM_PROMPT = `你是 DCF 平台内的企业级数字员工执行体。你的首要目标不是“回答”，而是“在可治理前提下稳定交付业务结果”。

# 一、身份与职责
1. 你是受治理约束的执行单元，必须遵守平台规则、审批策略与审计要求。
2. 你的输出对象主要是业务人员，表达要清晰、简洁、可执行。
3. 不得暴露底层实现品牌、内部链路细节或不必要的技术术语。

# 二、核心原则
1. 结果正确优先于速度，速度优先于形式完整。
2. 证据优先于结论：结论必须能被过程记录与证据支持。
3. 高风险动作先校验权限与审批，未满足则阻断并说明原因。
4. 信息不足时先澄清，不对关键事实做猜测。
5. 每次执行都要可追溯、可复盘、可回滚。

# 三、治理与安全边界
1. 对外部写入、系统变更、潜在破坏性动作默认谨慎。
2. 若命中高风险且审批链不足：停止执行，返回阻断原因与所需审批条件。
3. 若执行失败：优先输出“失败事实、影响范围、建议补救动作”。
4. 不绕过策略，不伪造结果，不隐瞒不确定性。

# 四、执行流程（强制）
按以下最小流程组织行为：
1. 理解目标：明确业务目标、约束、验收标准。
2. 风险评估：判断风险等级与审批需求。
3. 计划动作：给出最小可执行步骤。
4. 执行动作：仅执行当前授权范围内动作。
5. 结果归档：输出结果、证据、未决事项、下一步建议。

# 五、输出规范
默认采用以下结构：
1. 结论（1-2 句）
2. 关键依据（最多 3 条）
3. 建议动作（立即/短期）
4. 风险与前置条件（如有）

# 六、审计字段要求
涉及任务执行时，必须确保链路中可关联以下字段：
- trace_id
- task_id
- employee_id

# 七、工程约束（平台标准）
1. 遵循 DDD-lite 分层边界，不跨层越权。
2. 新行为遵循 TDD 思路：先定义预期，再执行，再验证。
3. 变更必须可回滚，且不破坏现有接口兼容。

# 八、持续演化要求
1. 允许在运行中学习高频模式，但不得突破本 Prompt 的治理边界。
2. 任何策略偏移必须通过平台治理流程沉淀，不得私自固化。
3. 始终将“可控、可审计、可恢复”作为演化前提。`;

let promptCenterCache = null;
let toastTimer = null;

function escapeHtml(input) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizePromptText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function isLegacyPrompt(content) {
  const text = normalizePromptText(content);
  if (!text) return false;
  const hasLoop = /Plan\s*->\s*Act\s*->\s*Observe\s*->\s*Reflect\s*->\s*Loop/i.test(text);
  if (!hasLoop) return false;
  const hasOutputShape = /假设\s*、\s*动作\s*、\s*证据\s*、\s*判断\s*、\s*下一步/.test(text);
  const hasApprovalGate = /高风险动作?.{0,20}审批策略/.test(text);
  return hasOutputShape || hasApprovalGate;
}

function setStrategyStatus(text) {
  const el = document.getElementById('strategyStatusText');
  if (el) el.textContent = String(text || '');
}

function setPromptStatus(text) {
  const el = document.getElementById('promptStatusText');
  if (el) el.textContent = String(text || '');
}

function setPromptRollbackStatus(text) {
  const el = document.getElementById('promptRollbackStatus');
  if (el) el.textContent = String(text || '');
}

function showToast(message, tone = 'info') {
  const el = document.getElementById('strategyToast');
  const text = String(message || '').trim();
  if (!el || !text) return;
  el.textContent = text;
  el.classList.remove('hidden', 'error');
  if (tone === 'error') el.classList.add('error');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('error');
    toastTimer = null;
  }, 2200);
}

function formatTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function renderPromptVersions(items = [], activeVersionId = null) {
  const node = document.getElementById('promptVersionRows');
  if (!node) return;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    node.innerHTML = '<tr><td colspan="6" class="empty">暂无可回滚版本</td></tr>';
    return;
  }
  node.innerHTML = rows.slice(0, 20).map((row) => {
    const id = String(row.id || '');
    const isActive = String(activeVersionId || '') === id;
    return `
      <tr>
        <td>${escapeHtml(id || '-')}</td>
        <td>${escapeHtml(row.name || '-')}</td>
        <td>${escapeHtml(row.status || '-')}</td>
        <td>${escapeHtml(row.source || '-')}</td>
        <td>${escapeHtml(formatTime(row.createdAt))}</td>
        <td>
          <button data-action="rollback-version" data-version-id="${escapeHtml(id)}" ${isActive ? 'disabled' : ''}>
            ${isActive ? '当前生效' : '回滚到此版本'}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function refreshGovernanceSwitchHint() {
  const publishNeedApproval = Boolean(document.getElementById('promptPublishRequiresApproval').checked);
  const blockHighRisk = Boolean(document.getElementById('blockOnHighRiskWithoutApproval').checked);
  const node = document.getElementById('governanceSwitchHint');
  if (!node) return;
  if (publishNeedApproval && blockHighRisk) {
    node.textContent = '当前为稳健模式：提示词发布先审批，高风险任务无审批即阻断。';
    node.style.color = '#136140';
    return;
  }
  if (!publishNeedApproval && !blockHighRisk) {
    node.textContent = '当前为宽松模式：发布不审批且高风险不阻断，请确认仅用于受控环境。';
    node.style.color = '#932727';
    return;
  }
  node.textContent = '当前为混合模式：建议结合审计日志观察一段周期后再决定是否切换稳健模式。';
  node.style.color = '#915f0e';
}

function applyStrategyForm(data = {}) {
  document.getElementById('maxLoopSteps').value = Number(data.maxLoopSteps || 5);
  document.getElementById('maxTaskRuntimeMs').value = Number(data.maxTaskRuntimeMs || 120000);
  document.getElementById('retryLimit').value = Number(data.retryLimit || 2);
  document.getElementById('retryBackoffMs').value = Number(data.retryBackoffMs || 3000);
  document.getElementById('promptPublishRequiresApproval').checked = Boolean(data.promptPublishRequiresApproval === true);
  document.getElementById('blockOnHighRiskWithoutApproval').checked = Boolean(data.blockOnHighRiskWithoutApproval);
  refreshGovernanceSwitchHint();
}

function readStrategyForm() {
  return {
    maxLoopSteps: Number(document.getElementById('maxLoopSteps').value || 5),
    maxTaskRuntimeMs: Number(document.getElementById('maxTaskRuntimeMs').value || 120000),
    retryLimit: Number(document.getElementById('retryLimit').value || 2),
    retryBackoffMs: Number(document.getElementById('retryBackoffMs').value || 3000),
    promptPublishRequiresApproval: document.getElementById('promptPublishRequiresApproval').checked,
    blockOnHighRiskWithoutApproval: document.getElementById('blockOnHighRiskWithoutApproval').checked
  };
}

function applyPromptCenter(center = {}) {
  promptCenterCache = center;
  const layers = center.layers || {};
  const platform = layers.platform || {};
  const existing = String(platform.content || '');
  if (existing.trim() && !isLegacyPrompt(existing)) {
    document.getElementById('platformContent').value = existing;
    return { upgraded: false, reason: 'normal' };
  }
  document.getElementById('platformContent').value = BASELINE_SYSTEM_PROMPT;
  const reason = existing.trim() ? 'legacy' : 'empty';
  setPromptStatus(reason === 'legacy'
    ? '检测到旧版简化 Prompt，已自动升级为完整基准 Prompt。'
    : '平台层为空，已自动写入完整基准 Prompt。');
  return { upgraded: true, reason };
}

function ensureBaselinePromptVisible() {
  const node = document.getElementById('platformContent');
  if (!node) return;
  const current = String(node.value || '');
  if (current.trim()) return;
  node.value = BASELINE_SYSTEM_PROMPT;
  setPromptStatus('已自动显示完整基准 Prompt。');
}

async function persistBaselinePromptUpgradeIfNeeded() {
  const base = promptCenterCache || {};
  const layers = base.layers && typeof base.layers === 'object' ? base.layers : {};
  const currentPlatform = layers.platform && typeof layers.platform === 'object' ? layers.platform : {};
  const nextLayers = {
    ...layers,
    platform: {
      ...currentPlatform,
      content: BASELINE_SYSTEM_PROMPT
    }
  };
  try {
    const updated = await requestJson('/api/admin/prompt-center', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layers: nextLayers })
    });
    promptCenterCache = updated;
    setPromptStatus('');
  } catch {
    setPromptStatus('已升级为完整基准 Prompt，请点击“保存基准 Prompt”完成持久化。');
  }
}

async function loadStrategy() {
  setStrategyStatus('加载中...');
  const data = await requestJson('/api/admin/strategy-center');
  applyStrategyForm(data);
  setStrategyStatus(`已加载，更新人：${data.updatedBy || 'system'}`);
}

async function saveStrategy() {
  setStrategyStatus('保存中...');
  const data = await requestJson('/api/admin/strategy-center', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(readStrategyForm())
  });
  applyStrategyForm(data);
  setStrategyStatus(`已保存：${data.updatedAt || ''}`);
}

async function loadPromptCenter() {
  setPromptStatus('加载中...');
  const [center, versions] = await Promise.all([
    requestJson('/api/admin/prompt-center'),
    requestJson('/api/admin/prompt-versions')
  ]);
  const result = applyPromptCenter(center) || { upgraded: false };
  if (result.upgraded) {
    await persistBaselinePromptUpgradeIfNeeded();
  }
  ensureBaselinePromptVisible();
  const activeVersionId = String(versions.activeVersionId || '');
  document.getElementById('activeVersion').textContent = `active: ${activeVersionId || '-'}`;
  renderPromptVersions(versions.items || [], activeVersionId);
  if (!result.upgraded) setPromptStatus('');
}

async function loadPromptVersions() {
  setPromptRollbackStatus('版本加载中...');
  const versions = await requestJson('/api/admin/prompt-versions');
  const activeVersionId = String(versions.activeVersionId || '');
  document.getElementById('activeVersion').textContent = `active: ${activeVersionId || '-'}`;
  renderPromptVersions(versions.items || [], activeVersionId);
  setPromptRollbackStatus('');
}

async function publishPromptVersion(name = '') {
  const versionName = String(name || '').trim() || `Baseline ${new Date().toISOString().slice(0, 19)}`;
  return requestJson('/api/admin/prompt-versions/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: versionName,
      source: 'manual',
      compileContext: {}
    })
  });
}

async function rollbackPromptVersion(versionId) {
  const id = String(versionId || '').trim();
  if (!id) return;
  const confirmed = window.confirm(`确认回滚到版本 ${id} 吗？`);
  if (!confirmed) return;
  setPromptRollbackStatus(`回滚中：${id}`);
  await requestJson('/api/admin/prompt-versions/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId: id })
  });
  await loadPromptCenter();
  setPromptRollbackStatus(`已回滚到版本：${id}`);
}

async function savePromptCenter() {
  const base = promptCenterCache || {};
  const layers = base.layers && typeof base.layers === 'object' ? base.layers : {};
  const currentPlatform = layers.platform && typeof layers.platform === 'object' ? layers.platform : {};
  const currentContent = normalizePromptText(String(currentPlatform.content || ''));
  const nextContent = normalizePromptText(String(document.getElementById('platformContent').value || ''));
  if (!nextContent) {
    showToast('基准 Prompt 不能为空', 'error');
    return;
  }
  if (currentContent === nextContent) {
    showToast('未检测到变更，无需保存');
    return;
  }
  const nextLayers = {
    ...layers,
    platform: {
      ...(layers.platform || {}),
      content: nextContent
    }
  };

  setPromptStatus('保存中...');
  await requestJson('/api/admin/prompt-center', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layers: nextLayers })
  });
  await publishPromptVersion();

  await loadPromptCenter();
  setPromptStatus('基准 Prompt 已保存');
}

function bindEvents() {
  ['promptPublishRequiresApproval', 'blockOnHighRiskWithoutApproval'].forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.addEventListener('change', () => refreshGovernanceSwitchHint());
  });

  document.getElementById('saveStrategyBtn').addEventListener('click', () => {
    saveStrategy().catch((error) => setStrategyStatus(`保存失败：${error.message}`));
  });

  document.getElementById('savePromptCenterBtn').addEventListener('click', () => {
    savePromptCenter().catch((error) => setPromptStatus(`保存失败：${error.message}`));
  });

  const versionRows = document.getElementById('promptVersionRows');
  if (versionRows) {
    versionRows.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.getAttribute('data-action');
      if (action !== 'rollback-version') return;
      const versionId = target.getAttribute('data-version-id') || '';
      rollbackPromptVersion(versionId).catch((error) => setPromptRollbackStatus(`回滚失败：${error.message}`));
    });
  }
}

(async () => {
  try {
    if (window.__adminReady) await window.__adminReady;
    bindEvents();
    await Promise.all([loadStrategy(), loadPromptCenter()]);
    ensureBaselinePromptVisible();
  } catch (error) {
    setStrategyStatus(`加载失败：${error.message}`);
    setPromptStatus(`加载失败：${error.message}`);
  }
})();
