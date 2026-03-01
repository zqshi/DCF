async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    throw new Error(body.error || 'request failed');
  }
  return res.json();
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function shortId(value) {
  const s = String(value || '');
  return s ? s.slice(0, 8) : '-';
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function isNotFoundError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase();
  return message.includes('not found') || message.includes('404');
}

function resolveLegacyFindingsVisible(rows, supported = true) {
  return Boolean(supported && Array.isArray(rows) && rows.length);
}

const state = {
  cases: [],
  selectedCaseId: null,
  caseRowsSignature: ''
};
let currentSession = null;

function canAccess(permission) {
  const user = currentSession && currentSession.user ? currentSession.user : null;
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const compat = {
    'admin.oss.action.approve-case': ['admin.oss.write'],
    'admin.oss.action.deploy': ['admin.oss.write'],
    'admin.oss.action.verify': ['admin.oss.write'],
    'admin.oss.action.rollback': ['admin.oss.write']
  };
  if (perms.includes('*') || perms.includes(permission)) return true;
  const fallback = compat[String(permission || '')] || [];
  return fallback.some((item) => perms.includes(item));
}

function applyActionAcl(root = document) {
  if (typeof window.adminApplyActionAclForRoot === 'function') {
    window.adminApplyActionAclForRoot(root);
  }
}

function statusTag(status) {
  const value = String(status || '');
  const map = {
    identified: '已识别',
    researching: '检索评估中',
    pending_approval: '待用户确认',
    approved_introduce: '已确认引入',
    approved_build: '已确认自建',
    deploying: '执行中',
    completed: '已完成',
    rejected: '已拒绝',
    rolled_back: '已回滚'
  };
  return map[value] || value.replaceAll('_', ' ');
}

function gapTypeText(value) {
  const raw = String(value || '');
  if (raw === 'infra_missing') return '基础设施能力缺口';
  if (raw === 'product_missing') return '产品能力缺口';
  if (raw === 'capability_missing') return '技能能力缺口';
  return raw || '-';
}

function rationaleText(value) {
  const raw = String(value || '').trim();
  const map = {
    no_gap_signal: '当前任务未检测到明确能力缺口',
    heuristic_gap_detected: '系统根据失败信号识别到能力缺口',
    repeated_multi_project_demand: '同类需求近期重复出现，建议自建',
    top_candidate_fit_and_fast_introduction: '已有匹配度较高的开源方案，落地更快',
    no_strong_candidate_yet: '暂未发现足够可靠的候选方案'
  };
  if (map[raw]) return map[raw];
  if (raw.startsWith('top_candidate_fit:')) {
    return `已发现匹配度较高的候选方案：${raw.replace('top_candidate_fit:', '')}`;
  }
  if (raw.startsWith('hard_gate_blocked:')) {
    return `风险门禁未通过：${raw.replace('hard_gate_blocked:', '')}`;
  }
  if (raw.startsWith('pipeline_failed:')) {
    return `流程执行失败：${raw.replace('pipeline_failed:', '')}`;
  }
  if (!raw) return '-';
  return '系统检测到当前能力不足，需通过检索补齐可用方案';
}

function retrievalNecessityText(item) {
  const gapType = String((item && item.gapType) || '');
  if (gapType === 'infra_missing') {
    return '当前问题涉及基础设施能力缺口，若不检索可用方案将持续影响任务交付稳定性。';
  }
  if (gapType === 'product_missing') {
    return '当前问题涉及产品能力缺口，检索可复用方案可显著缩短落地周期并降低试错成本。';
  }
  if (gapType === 'capability_missing') {
    return '当前问题涉及技能能力缺口，检索是为快速找到可验证方案，避免重复建设与效率损失。';
  }
  return '当前能力无法稳定覆盖该任务场景，需要先检索候选方案再决定执行路径。';
}

function scenarioExplanationText(item) {
  if (!item || typeof item !== 'object') return '-';
  const gapSummary = String(item.gapSummary || '').trim();
  const reason = rationaleText(item.rationale);
  const confidence = Number(item.confidence || 0);
  const confidenceText = Number.isFinite(confidence) && confidence > 0
    ? `系统判断置信度 ${Math.round(confidence * 100)}%。`
    : '';
  const necessity = retrievalNecessityText(item);
  if (gapSummary && reason && reason !== '-') {
    return `触发场景：${gapSummary}。触发原因：${reason}。检索必要性：${necessity}${confidenceText}`.trim();
  }
  if (gapSummary) return `触发场景：${gapSummary}。检索必要性：${necessity}${confidenceText}`.trim();
  if (reason && reason !== '-') return `触发原因：${reason}。检索必要性：${necessity}${confidenceText}`.trim();
  return `检索必要性：${necessity}${confidenceText}`.trim();
}

function retrievalStatusText(item) {
  const evaluation = item && item.evaluation && typeof item.evaluation === 'object' ? item.evaluation : null;
  const candidateRows = Array.isArray(item && item.candidateEvaluations) ? item.candidateEvaluations : [];
  const count = Math.max(
    Number((evaluation && evaluation.candidateCount) || 0),
    candidateRows.length
  );
  if (!evaluation && count <= 0) return '未记录到检索结果';
  const hardGatePassed = evaluation && evaluation.hardGate && evaluation.hardGate.passed === true;
  const topCandidate = candidateRows[0] || null;
  const topHardGatePassed = topCandidate && topCandidate.hardGate ? topCandidate.hardGate.passed === true : null;
  if (count <= 0) return '已发起检索，未找到可用候选方案';
  if (hardGatePassed === false || topHardGatePassed === false) return `已发起检索，找到 ${count} 个候选，但门禁未通过`;
  return `已发起检索，找到 ${count} 个候选`;
}

function recommendationRationaleText(item) {
  if (!item || typeof item !== 'object') return '-';
  const recommendation = String(item.recommendation || '').trim();
  const evaluation = item.evaluation && typeof item.evaluation === 'object' ? item.evaluation : null;
  const candidateRows = Array.isArray(item.candidateEvaluations) ? item.candidateEvaluations : [];
  const topCandidate = candidateRows[0] || null;
  const hardGatePassed = evaluation && evaluation.hardGate ? evaluation.hardGate.passed === true : null;
  const topHardGatePassed = topCandidate && topCandidate.hardGate ? topCandidate.hardGate.passed === true : null;
  const candidateCount = Math.max(
    Number((evaluation && evaluation.candidateCount) || 0),
    candidateRows.length
  );
  const topScore = topCandidate ? Number(topCandidate.scoreTotal || 0) : 0;
  if (recommendation === 'defer') {
    if (candidateCount <= 0) return '已完成检索，但未找到可直接落地的候选方案，因此建议暂缓。';
    if (hardGatePassed === false || topHardGatePassed === false) {
      return '已完成检索，虽然存在候选项目，但未通过安全/合规门禁，因此建议暂缓。';
    }
    if (topScore >= 75) {
      return '已完成检索，存在高匹配候选，但当前治理策略或证据不足，暂不直接推进。';
    }
    return '已完成检索，但当前证据不足以支持引入或自建，建议暂缓并继续观察。';
  }
  if (recommendation === 'introduce_oss') {
    return '已完成检索，候选方案匹配度和可落地性较高，建议引入。';
  }
  if (recommendation === 'build_in_house') {
    return '已完成检索，同类需求重复且长期性强，建议内部自建。';
  }
  return rationaleText(item.rationale);
}

function buildVsBuyRationaleText(value) {
  const raw = String(value || '').trim();
  const map = {
    multiple_projects_share_same_demand_fingerprint: '近 30 天内同类需求在多个任务中重复出现，长期看自建更稳妥。',
    top_candidate_fit_and_fast_introduction: '已发现匹配度较高且落地周期短的方案，优先引入更高效。',
    no_strong_candidate_yet: '当前未发现足够可靠的候选方案，建议先观望并补充评估。'
  };
  if (map[raw]) return map[raw];
  return raw || '-';
}

function recommendationText(value) {
  if (value === 'introduce_oss') return '引入开源';
  if (value === 'build_in_house') return '自建';
  if (value === 'defer') return '暂缓';
  return value || '-';
}

function updateStats(cases) {
  const pending = cases.filter((x) => x.status === 'pending_approval').length;
  const completed = cases.filter((x) => x.status === 'completed').length;
  setText('caseCount', String(cases.length));
  setText('pendingCount', String(pending));
  setText('completedCount', String(completed));
  setText('latestCaseTime', cases[0] ? formatTime(cases[0].updatedAt || cases[0].createdAt) : '-');
}

function inlineDetailMarkup() {
  return `
    <div id="detailStatus" class="toolbar-note" style="margin-bottom:8px;">加载详情中...</div>
    <div class="table-wrap" style="margin-bottom:8px;">
      <table>
        <tbody>
          <tr><th style="width:120px;">案例ID</th><td id="detailCaseId">-</td></tr>
          <tr><th>任务ID</th><td id="detailTaskId">-</td></tr>
          <tr><th>员工ID</th><td id="detailEmployeeId">-</td></tr>
          <tr><th>问题类型</th><td id="detailGap">-</td></tr>
          <tr><th>场景说明</th><td id="detailScenario">-</td></tr>
          <tr><th>检索状态</th><td id="detailRetrievalStatus">-</td></tr>
          <tr><th>IM确认状态</th><td id="detailUserConfirmation">-</td></tr>
          <tr><th>下一步</th><td id="detailNextAction">-</td></tr>
          <tr><th>需求标识</th><td id="detailFingerprint">-</td></tr>
          <tr><th>建议动作</th><td id="detailRecommendation">-</td></tr>
          <tr><th>建议原因</th><td id="detailRationale">-</td></tr>
        </tbody>
      </table>
    </div>
    <div class="toolbar-note" style="margin-bottom:10px;">
      本页面用于检索与决策记录追踪。需要确认时，系统会在 IM 中主动通知业务用户处理。
    </div>
    <div class="row-actions" style="margin-bottom:10px;">
      <button id="approveIntroduceBtn" type="button" data-required-permission="admin.oss.action.approve-case">批准引入开源</button>
      <button id="approveBuildBtn" type="button" data-required-permission="admin.oss.action.approve-case">批准内部自建</button>
      <button id="rejectBtn" type="button" data-required-permission="admin.oss.action.approve-case">驳回方案</button>
      <button id="deployBtn" type="button" data-required-permission="admin.oss.action.deploy">执行部署</button>
      <button id="verifyBtn" type="button" data-required-permission="admin.oss.action.verify">验收确认</button>
      <button id="rollbackBtn" type="button" data-required-permission="admin.oss.action.rollback">执行回滚</button>
    </div>
    <h4 style="margin:8px 0;">候选评估</h4>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>开源项目</th>
            <th>项目特点</th>
            <th>维护情况</th>
            <th>匹配分</th>
            <th>结论</th>
            <th>风险</th>
          </tr>
        </thead>
        <tbody id="candidateRows">
          <tr><td colspan="6" class="empty">暂无</td></tr>
        </tbody>
      </table>
    </div>
    <h4 style="margin:8px 0;">方案对比（引入 vs 自建）</h4>
    <div class="table-wrap">
      <table>
        <tbody id="buildVsBuyRows">
          <tr><td class="empty">暂无评估</td></tr>
        </tbody>
      </table>
    </div>
    <h4 style="margin:8px 0;">处理轨迹</h4>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>事件</th>
            <th>说明</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody id="caseLogRows">
          <tr><td colspan="3" class="empty">暂无轨迹</td></tr>
        </tbody>
      </table>
    </div>
    <h4 style="margin:8px 0;">自动决策说明</h4>
    <div class="table-wrap">
      <table>
        <tbody id="autonomyDecisionRows">
          <tr><td class="empty">暂无自治决策</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderCaseRows(cases) {
  const tbody = document.getElementById('caseRows');
  if (!cases.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无案例</td></tr>';
    return;
  }
  let html = '';
  cases.forEach((item) => {
    const selected = item.id === state.selectedCaseId ? ' style="background:#f0f6ff;"' : '';
    html += `
      <tr data-case-id="${item.id}"${selected}>
        <td>${shortId(item.id)}</td>
        <td>${shortId(item.taskId)}</td>
        <td>${gapTypeText(item.gapType)}</td>
        <td>${statusTag(item.status)}</td>
        <td>${recommendationText(item.recommendation)}</td>
        <td>${formatTime(item.updatedAt || item.createdAt)}</td>
      </tr>
    `;
    if (item.id === state.selectedCaseId) {
      html += `
        <tr data-case-detail-row="${item.id}">
          <td colspan="6">
            <div class="card" style="margin:8px 0 0;padding:12px;">
              ${inlineDetailMarkup()}
            </div>
          </td>
        </tr>
      `;
    }
  });
  tbody.innerHTML = html;
  applyActionAcl(tbody);

  tbody.querySelectorAll('tr[data-case-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      const caseId = row.getAttribute('data-case-id');
      state.selectedCaseId = state.selectedCaseId === caseId ? null : caseId;
      renderCaseRows(state.cases);
      if (state.selectedCaseId) {
        await renderCaseDetail();
      }
    });
  });
}

function buildCaseRowsSignature(cases, selectedCaseId) {
  const normalizedCases = Array.isArray(cases) ? cases : [];
  return JSON.stringify({
    selectedCaseId: selectedCaseId || null,
    rows: normalizedCases.map((item) => ({
      id: item.id || '',
      taskId: item.taskId || '',
      gapType: item.gapType || '',
      status: item.status || '',
      recommendation: item.recommendation || '',
      updatedAt: item.updatedAt || '',
      createdAt: item.createdAt || ''
    }))
  });
}

function renderCandidateRows(rows) {
  const tbody = document.getElementById('candidateRows');
  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无</td></tr>';
    return;
  }
  const hintText = (value) => {
    if (value === 'fit') return '可直接采用';
    if (value === 'partial_fit') return '部分匹配';
    if (value === 'not_fit') return '不建议采用';
    return value || '-';
  };
  const maintenanceText = (item) => {
    const status = String(item.maintenanceStatus || '');
    const statusMap = {
      active: '活跃维护',
      stable: '稳定维护',
      aging: '维护趋缓',
      stale: '长期未维护'
    };
    const updatedAt = formatTime(item.updatedAt);
    const ageDays = Number(item.updateAgeDays || 0);
    const ageText = Number.isFinite(ageDays) && ageDays > 0 ? `${ageDays} 天前更新` : '更新信息未知';
    return `${statusMap[status] || '维护状态未知'} / ${ageText} / 最近更新时间 ${updatedAt}`;
  };
  const featureText = (item) => {
    const description = String(item.repoDescription || '').trim() || '暂无项目简介';
    const license = String(item.licenseSpdx || 'UNKNOWN');
    const stars = Number(item.stars || 0);
    return `${description} / 许可证 ${license} / 社区热度 ${stars} stars`;
  };
  const riskText = (item) => {
    const risks = Array.isArray(item.risks) ? item.risks : [];
    if (!risks.length) return '未发现明显风险';
    const map = {
      license_unknown: '许可证信息不完整',
      stale_maintenance: '维护活跃度较低'
    };
    const translated = risks.map((risk) => map[risk] || risk).join('，');
    const hardRisk = item && item.hardGate && item.hardGate.riskLevel ? `（综合风险：${item.hardGate.riskLevel}）` : '';
    return `${translated}${hardRisk}`;
  };
  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td><a href="${item.repoUrl}" target="_blank" rel="noreferrer">${item.repoFullName}</a></td>
      <td>${featureText(item)}</td>
      <td>${maintenanceText(item)}</td>
      <td>${item.scoreTotal}</td>
      <td>${hintText(item.decisionHint)}</td>
      <td>${riskText(item)}</td>
    </tr>
  `).join('');
}

function renderBuildVsBuyRow(row) {
  const tbody = document.getElementById('buildVsBuyRows');
  if (!row) {
    tbody.innerHTML = '<tr><td class="empty">暂无评估</td></tr>';
    return;
  }
  tbody.innerHTML = `
    <tr><th style="width:140px;">30天需求次数</th><td>${row.demandCount30d}</td></tr>
    <tr><th>预计自建周期</th><td>${row.estimatedBuildWeeks} 周</td></tr>
    <tr><th>预计引入周期</th><td>${row.estimatedIntroduceDays} 天</td></tr>
    <tr><th>维护成本</th><td>${row.maintenanceCostLevel}</td></tr>
    <tr><th>建议</th><td>${recommendationText(row.recommendation)}</td></tr>
    <tr><th>理由</th><td>${buildVsBuyRationaleText(row.rationale)}</td></tr>
  `;
}

function applyActionButtons(caseItem) {
  const btn = (id) => document.getElementById(id);
  const status = String(caseItem.status || '');
  const approveIntroduceBtn = btn('approveIntroduceBtn');
  const approveBuildBtn = btn('approveBuildBtn');
  const rejectBtn = btn('rejectBtn');
  const deployBtn = btn('deployBtn');
  const verifyBtn = btn('verifyBtn');
  const rollbackBtn = btn('rollbackBtn');
  if (!approveIntroduceBtn || !approveBuildBtn || !rejectBtn || !deployBtn || !verifyBtn || !rollbackBtn) return;
  approveIntroduceBtn.disabled = !canAccess('admin.oss.action.approve-case') || !['pending_approval', 'completed'].includes(status);
  approveBuildBtn.disabled = !canAccess('admin.oss.action.approve-case') || !['pending_approval', 'completed'].includes(status);
  rejectBtn.disabled = !canAccess('admin.oss.action.approve-case') || !['pending_approval', 'completed'].includes(status);
  deployBtn.disabled = !canAccess('admin.oss.action.deploy') || !['approved_introduce', 'approved_build'].includes(status);
  verifyBtn.disabled = !canAccess('admin.oss.action.verify') || status !== 'deploying';
  rollbackBtn.disabled = !canAccess('admin.oss.action.rollback') || !['pending_approval', 'approved_introduce', 'approved_build', 'deploying', 'completed'].includes(status);
}

function confirmationStatusText(caseItem) {
  const recommendation = String((caseItem && caseItem.recommendation) || '');
  const confirmation = caseItem && caseItem.userConfirmation && typeof caseItem.userConfirmation === 'object'
    ? caseItem.userConfirmation
    : null;
  if (!confirmation || confirmation.required !== true) {
    if (recommendation === 'defer') return '当前建议为暂缓，不触发确认';
    return '无需确认';
  }
  const status = String(confirmation.status || '').trim();
  if (status === 'pending') return '待确认（已通过 IM 发起）';
  if (status === 'confirmed') return `已确认（${formatTime(confirmation.confirmedAt)}）`;
  if (status === 'rejected') return `已拒绝（${formatTime(confirmation.confirmedAt)}）`;
  return status || '处理中';
}

function nextActionText(caseItem) {
  const status = String((caseItem && caseItem.status) || '');
  if (status === 'pending_approval') return '等待业务用户在 IM 中确认建议。';
  if (status === 'approved_introduce' || status === 'approved_build') return '确认已完成，可进入执行阶段。';
  if (status === 'deploying') return '执行中，等待验收结果。';
  if (status === 'completed') return '已完成，保留记录用于复盘。';
  if (status === 'rejected') return '建议已拒绝，可根据新信息重新发起检索。';
  if (status === 'rolled_back') return '流程已回滚，等待后续决策。';
  return '查看记录并等待系统后续推进。';
}

function decisionActionText(value) {
  const raw = String(value || '').trim();
  const map = {
    introduce_oss: '建议引入开源方案',
    build_in_house: '建议内部自建',
    reject: '建议拒绝当前方案',
    defer: '建议暂缓决策'
  };
  return map[raw] || raw || '-';
}

function decisionStatusText(value) {
  const raw = String(value || '').trim();
  const map = {
    proposed: '已提出建议',
    proposed_for_user_confirmation: '已发起用户确认',
    auto_execute_without_user_confirmation: '已自动执行（无需用户确认）',
    approved: '已通过',
    rejected: '已拒绝',
    deferred: '已暂缓',
    deploying: '执行中',
    completed: '已完成'
  };
  return map[raw] || raw || '-';
}

function governanceModeText(value) {
  const raw = String(value || '').trim();
  if (raw === 'model_driven') return '模型驱动';
  if (raw === 'assist') return '辅助决策';
  return raw || '-';
}

function decisionReasonText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw === 'model_unavailable') return '模型不可用，流程执行失败，请排查后重试。';
  if (raw === 'model_driven_decision') return '系统基于当前上下文自动给出建议。';
  return rationaleText(raw);
}

function autonomySummary(decision = {}) {
  const action = decisionActionText(decision.decision);
  const status = decisionStatusText(decision.status);
  const deploy = decision.autoDeploy ? '自动部署：是' : '自动部署：否';
  const verify = decision.autoVerify ? '自动验收：是' : '自动验收：否';
  return `${action}；当前状态：${status}；${deploy}，${verify}。`;
}

async function postCaseAction(action, payload = {}) {
  if (!state.selectedCaseId) return;
  await api(`/api/admin/oss-cases/${encodeURIComponent(state.selectedCaseId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await load();
}

function bindActions() {
  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'approveIntroduceBtn') {
      if (!canAccess('admin.oss.action.approve-case')) return;
      const note = window.prompt('审批备注（可选）', '') || '';
      await postCaseAction('approve', { decision: 'introduce_oss', note });
    }
    if (target.id === 'approveBuildBtn') {
      if (!canAccess('admin.oss.action.approve-case')) return;
      const note = window.prompt('审批备注（可选）', '') || '';
      await postCaseAction('approve', { decision: 'build_in_house', note });
    }
    if (target.id === 'rejectBtn') {
      if (!canAccess('admin.oss.action.approve-case')) return;
      const reason = window.prompt('驳回原因', '') || 'manual reject';
      await postCaseAction('approve', { decision: 'reject', reason });
    }
    if (target.id === 'deployBtn') {
      if (!canAccess('admin.oss.action.deploy')) return;
      await postCaseAction('deploy', {});
    }
    if (target.id === 'verifyBtn') {
      if (!canAccess('admin.oss.action.verify')) return;
      const note = window.prompt('验收说明（可选）', '') || '';
      await postCaseAction('verify', { note });
    }
    if (target.id === 'rollbackBtn') {
      if (!canAccess('admin.oss.action.rollback')) return;
      const reason = window.prompt('回滚原因', '') || 'manual rollback';
      await postCaseAction('rollback', { reason });
    }
  });
}

function renderCaseLogs(logs) {
  const tbody = document.getElementById('caseLogRows');
  if (!Array.isArray(logs) || !logs.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">暂无轨迹</td></tr>';
    return;
  }
  tbody.innerHTML = logs.slice(0, 20).map((log) => {
    const payload = log && log.payload && typeof log.payload === 'object' ? log.payload : {};
    const note = payload.reason || payload.recommendation || payload.policyMode || payload.actorId || '-';
    return `
      <tr>
        <td>${log.type || '-'}</td>
        <td>${String(note)}</td>
        <td>${formatTime(log.at)}</td>
      </tr>
    `;
  }).join('');
}

function renderAutonomyDecision(decision) {
  const tbody = document.getElementById('autonomyDecisionRows');
  if (!decision || typeof decision !== 'object') {
    tbody.innerHTML = '<tr><td class="empty">暂无自治决策</td></tr>';
    return;
  }
  const summary = autonomySummary(decision);
  tbody.innerHTML = `
    <tr><th style="width:160px;">决策摘要</th><td>${summary}</td></tr>
    <tr><th>决策引擎</th><td>${decision.engine || 'llm'}</td></tr>
    <tr><th>治理模式</th><td>${governanceModeText(decision.mode)}</td></tr>
    <tr><th>决策动作</th><td>${decisionActionText(decision.decision)}</td></tr>
    <tr><th>自动部署</th><td>${decision.autoDeploy ? '是' : '否'}</td></tr>
    <tr><th>自动验收</th><td>${decision.autoVerify ? '是' : '否'}</td></tr>
    <tr><th>阶段状态</th><td>${decisionStatusText(decision.status)}</td></tr>
    <tr><th>解释依据</th><td>${decisionReasonText(decision.reason)}</td></tr>
    <tr><th>决策时间</th><td>${formatTime(decision.at)}</td></tr>
  `;
}

async function renderCaseDetail() {
  if (!state.selectedCaseId) {
    return;
  }
  let item;
  try {
    item = await api(`/api/admin/oss-cases/${encodeURIComponent(state.selectedCaseId)}`);
  } catch (error) {
    if (isNotFoundError(error)) {
      state.selectedCaseId = state.cases[0] ? state.cases[0].id : null;
      renderCaseRows(state.cases);
      if (state.selectedCaseId) {
        return renderCaseDetail();
      }
      return;
    }
    throw error;
  }
  setText('detailCaseId', item.id || '-');
  setText('detailTaskId', item.taskId || '-');
  setText('detailEmployeeId', item.employeeId || '-');
  setText('detailGap', `${gapTypeText(item.gapType)} / ${item.gapSummary || '-'}`);
  setText('detailScenario', scenarioExplanationText(item));
  setText('detailRetrievalStatus', retrievalStatusText(item));
  setText('detailUserConfirmation', confirmationStatusText(item));
  setText('detailNextAction', nextActionText(item));
  setText('detailFingerprint', item.demandFingerprint || '-');
  setText('detailRecommendation', recommendationText(item.recommendation));
  setText('detailRationale', recommendationRationaleText(item));
  setText('detailStatus', `当前状态：${statusTag(item.status)}`);
  renderCandidateRows(item.candidateEvaluations || []);
  renderBuildVsBuyRow(item.buildVsBuy || null);
  renderCaseLogs(item.logs || []);
  renderAutonomyDecision(item.autonomyDecision || null);
  applyActionButtons(item);
  applyActionAcl(document.getElementById('caseRows'));
}

function renderLegacyFindings(rows, supported = true) {
  const card = document.getElementById('legacyFindingsCard');
  const tbody = document.getElementById('findingRows');
  const visible = resolveLegacyFindingsVisible(rows, supported);
  if (card) card.style.display = visible ? '' : 'none';
  if (!visible) {
    return;
  }
  tbody.innerHTML = rows.map((f) => `
    <tr>
      <td>${shortId(f.taskId)}</td>
      <td>${shortId(f.employeeId)}</td>
      <td>${f.query || '-'}</td>
      <td>${f.candidates && f.candidates[0] ? f.candidates[0].name : '-'}</td>
      <td>${formatTime(f.createdAt)}</td>
    </tr>
  `).join('');
}

async function loadLegacyFindings() {
  try {
    const findings = await api('/api/admin/oss-findings');
    return {
      supported: true,
      rows: Array.isArray(findings) ? findings : []
    };
  } catch (error) {
    if (isNotFoundError(error)) return { supported: false, rows: [] };
    throw error;
  }
}

async function load() {
  try {
    const [cases, findings] = await Promise.all([
      api('/api/admin/oss-cases'),
      loadLegacyFindings()
    ]);
    state.cases = Array.isArray(cases) ? cases : [];
    if (state.selectedCaseId && !state.cases.some((x) => x.id === state.selectedCaseId)) {
      state.selectedCaseId = null;
    }
    updateStats(state.cases);
    const caseRowsSignature = buildCaseRowsSignature(state.cases, state.selectedCaseId);
    if (caseRowsSignature !== state.caseRowsSignature) {
      renderCaseRows(state.cases);
      state.caseRowsSignature = caseRowsSignature;
    }
    if (state.selectedCaseId) {
      await renderCaseDetail();
    }
    renderLegacyFindings(findings.rows, findings.supported);
  } catch (error) {
    const message = isNotFoundError(error) ? '暂无可用记录' : `加载失败：${error.message}`;
    document.getElementById('caseRows').innerHTML = `<tr><td colspan="6" class="empty">${message}</td></tr>`;
    renderLegacyFindings([], false);
  }
}

async function init() {
  if (window.__adminReady) await window.__adminReady;
  try {
    currentSession = await api('/api/auth/me');
  } catch {
    currentSession = null;
  }
  bindActions();
  await load();
  setInterval(load, 3000);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isNotFoundError,
    resolveLegacyFindingsVisible,
    buildCaseRowsSignature,
    scenarioExplanationText,
    buildVsBuyRationaleText,
    autonomySummary,
    retrievalStatusText,
    recommendationRationaleText
  };
}
