async function api(path, options) {
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

function renderStatus(message, isError = false) {
  const node = document.getElementById('toolsApprovalStatus');
  if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? '#932727' : '#5e6f8e';
}

function resolveErrorMessage(error, fallback) {
  const raw = String(error && error.message ? error.message : '');
  return fallback ? `${fallback}：${raw || '未知错误'}` : (raw || '未知错误');
}

let currentSession = null;

function canAccess(permission) {
  const user = currentSession && currentSession.user ? currentSession.user : null;
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const compat = {
    'admin.tools.action.approve-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.tools.action.reject-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.tools.action.rollback-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.tools.action.resubmit-service': ['admin.tools.approval.write', 'admin.tools.write']
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

function renderRegistrationBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'approved') return '<span class="badge ok">approved</span>';
  if (s === 'rejected') return '<span class="badge">rejected</span>';
  if (s === 'rollback') return '<span class="badge">rollback</span>';
  return '<span class="badge warn">pending</span>';
}

function renderPendingRows(rows = []) {
  const body = document.getElementById('pendingRows');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">暂无待审批注册</td></tr>';
    return;
  }
  body.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.name || '-')}</td>
      <td>${escapeHtml(item.registrationSource || '-')}</td>
      <td>${escapeHtml(item.registrant || '-')}</td>
      <td>${renderRegistrationBadge(item.registrationStatus)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="approve-mcp-btn" data-required-permission="admin.tools.action.approve-service" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.approve-service') ? '' : 'disabled'}>批准</button>
        <button class="reject-mcp-btn" data-required-permission="admin.tools.action.reject-service" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.reject-service') ? '' : 'disabled'}>驳回</button>
        <button class="rollback-mcp-btn" data-required-permission="admin.tools.action.rollback-service" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.rollback-service') ? '' : 'disabled'}>回滚</button>
        <button class="resubmit-mcp-btn" data-required-permission="admin.tools.action.resubmit-service" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.resubmit-service') ? '' : 'disabled'}>转待审</button>
      </td>
    </tr>
  `).join('');
  applyActionAcl(body);
}

async function load() {
  try {
    const rows = await api('/api/admin/tools/pending');
    renderPendingRows(Array.isArray(rows) ? rows : []);
  } catch (error) {
    renderPendingRows([]);
    renderStatus(resolveErrorMessage(error, '加载失败'), true);
  }
}

function bindEvents() {
  const pendingBody = document.getElementById('pendingRows');
  if (!pendingBody) return;
  pendingBody.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button) return;
    const serviceId = button.getAttribute('data-service-id');
    if (!serviceId) return;

    let action = '';
    let permission = '';
    if (button.classList.contains('approve-mcp-btn')) action = 'approve';
    if (action === 'approve') permission = 'admin.tools.action.approve-service';
    if (button.classList.contains('reject-mcp-btn')) action = 'reject';
    if (action === 'reject') permission = 'admin.tools.action.reject-service';
    if (button.classList.contains('rollback-mcp-btn')) action = 'rollback';
    if (action === 'rollback') permission = 'admin.tools.action.rollback-service';
    if (button.classList.contains('resubmit-mcp-btn')) action = 'resubmit';
    if (action === 'resubmit') permission = 'admin.tools.action.resubmit-service';
    if (!action) return;
    if (!canAccess(permission)) {
      renderStatus('无权限执行该审批动作', true);
      return;
    }

    button.setAttribute('disabled', 'disabled');
    try {
      await api(`/api/admin/tools/mcp-services/${encodeURIComponent(serviceId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      renderStatus(`已执行 ${action}：${serviceId}`);
      await load();
    } catch (error) {
      renderStatus(resolveErrorMessage(error, '审批失败'), true);
    } finally {
      button.removeAttribute('disabled');
    }
  });
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  try {
    currentSession = await api('/api/auth/me');
  } catch {
    currentSession = null;
  }
  bindEvents();
  await load();
})();
