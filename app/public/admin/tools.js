async function api(path, options) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(text);
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
  const node = document.getElementById('toolsStatus');
  if (!node) return;
  node.textContent = message || '';
  node.style.color = isError ? '#932727' : '#5e6f8e';
}

function resolveErrorMessage(error, fallback) {
  const raw = String(error && error.message ? error.message : '');
  if (raw.includes('Not Found') || raw.includes('404')) {
    return '后端接口不存在（可能仍在旧版本）。请执行 ./stop.sh && ./start.sh 重启后台后刷新页面。';
  }
  return fallback ? `${fallback}：${raw || '未知错误'}` : (raw || '未知错误');
}

let currentSession = null;

function canAccess(permission) {
  const user = currentSession && currentSession.user ? currentSession.user : null;
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const compat = {
    'admin.tools.action.create-service': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.update-service': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.delete-service': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.check-health': ['admin.tools.assets.write', 'admin.tools.write']
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

function renderRows(rows = []) {
  const body = document.getElementById('mcpRows');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">暂无 MCP 服务</td></tr>';
    return;
  }
  body.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.name || '-')}</td>
      <td>${escapeHtml(item.transport || '-')}</td>
      <td><span class="mono">${escapeHtml(item.endpoint || '-')}</span></td>
      <td>${item.enabled ? '<span class="badge ok">启用</span>' : '<span class="badge">停用</span>'}</td>
      <td>
        ${item.updatedAt ? escapeHtml(new Date(item.updatedAt).toLocaleString()) : '-'}
        ${item.health ? `<div class="toolbar-note" style="margin-top:6px;">探活：${escapeHtml(item.health.status || '-')} · ${item.health.latencyMs || 0}ms</div>` : ''}
      </td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="toggle-mcp-btn" data-required-permission="admin.tools.action.update-service" data-service-id="${escapeHtml(item.id || '')}" data-enabled="${item.enabled ? '1' : '0'}" ${canAccess('admin.tools.action.update-service') ? '' : 'disabled'}>${item.enabled ? '停用' : '启用'}</button>
        <button class="edit-mcp-btn" data-required-permission="admin.tools.action.update-service" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.update-service') ? '' : 'disabled'}>编辑</button>
        <button class="health-mcp-btn" data-required-permission="admin.tools.action.check-health" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.check-health') ? '' : 'disabled'}>探活</button>
        <button class="delete-mcp-btn" data-required-permission="admin.tools.action.delete-service" data-service-id="${escapeHtml(item.id || '')}" ${canAccess('admin.tools.action.delete-service') ? '' : 'disabled'}>删除</button>
      </td>
    </tr>
  `).join('');
  applyActionAcl(body);
}

let currentRows = [];
let editingServiceId = '';

function findService(serviceId) {
  return currentRows.find((x) => String(x.id || '') === String(serviceId || '')) || null;
}

function setEditorVisible(visible) {
  const drawer = document.getElementById('mcpEditorDrawer');
  const mask = document.getElementById('mcpDrawerMask');
  const open = Boolean(visible);
  if (drawer) {
    drawer.classList.toggle('hidden', !open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (mask) {
    mask.classList.toggle('hidden', !open);
    mask.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (open) {
    const firstInput = document.getElementById('mcpNameInput');
    if (firstInput) firstInput.focus();
  }
}

function isEditorVisible() {
  const drawer = document.getElementById('mcpEditorDrawer');
  return Boolean(drawer) && !drawer.classList.contains('hidden');
}

function fillEditor(service) {
  const title = document.getElementById('mcpEditorTitle');
  const name = document.getElementById('mcpNameInput');
  const transport = document.getElementById('mcpTransportInput');
  const endpoint = document.getElementById('mcpEndpointInput');
  const description = document.getElementById('mcpDescriptionInput');
  const enabled = document.getElementById('mcpEnabledInput');
  if (!name || !transport || !endpoint || !description || !enabled || !title) return;
  if (!service) {
    editingServiceId = '';
    title.textContent = '新增 MCP 服务';
    name.value = '';
    transport.value = 'http';
    endpoint.value = '';
    description.value = '';
    enabled.checked = true;
    return;
  }
  editingServiceId = String(service.id || '');
  title.textContent = `编辑 MCP 服务 · ${service.name || service.id || '-'}`;
  name.value = String(service.name || '');
  transport.value = String(service.transport || 'http');
  endpoint.value = String(service.endpoint || '');
  description.value = String(service.description || '');
  enabled.checked = Boolean(service.enabled);
}

function readEditorPayload() {
  const name = document.getElementById('mcpNameInput');
  const transport = document.getElementById('mcpTransportInput');
  const endpoint = document.getElementById('mcpEndpointInput');
  const description = document.getElementById('mcpDescriptionInput');
  const enabled = document.getElementById('mcpEnabledInput');
  const payload = {
    name: name ? String(name.value || '').trim() : '',
    transport: transport ? String(transport.value || 'http').trim() : 'http',
    endpoint: endpoint ? String(endpoint.value || '').trim() : '',
    description: description ? String(description.value || '').trim() : '',
    enabled: enabled ? Boolean(enabled.checked) : true
  };
  if (!payload.name) throw new Error('服务名称不能为空');
  if (!payload.endpoint) throw new Error('服务地址不能为空');
  return payload;
}

async function load() {
  try {
    const rows = await api('/api/admin/tools/mcp-services');
    const list = Array.isArray(rows) ? rows : [];
    currentRows = list;
    const enabled = list.filter((x) => Boolean(x.enabled)).length;
    setText('mcpTotal', list.length);
    setText('mcpEnabled', enabled);
    setText('mcpDisabled', Math.max(0, list.length - enabled));
    renderRows(list);
  } catch (error) {
    renderRows([]);
    renderStatus(resolveErrorMessage(error, '加载失败'), true);
  }
}

function bindEvents() {
  const body = document.getElementById('mcpRows');
  if (!body) return;
  const createBtn = document.getElementById('createMcpBtn');
  const cancelBtn = document.getElementById('mcpCancelBtn');
  const saveBtn = document.getElementById('mcpSaveBtn');
  const closeBtn = document.getElementById('closeMcpDrawerBtn');
  const drawerMask = document.getElementById('mcpDrawerMask');

  if (createBtn) {
    createBtn.disabled = !canAccess('admin.tools.action.create-service');
    createBtn.addEventListener('click', () => {
      if (!canAccess('admin.tools.action.create-service')) return;
      fillEditor(null);
      setEditorVisible(true);
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      setEditorVisible(false);
      fillEditor(null);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      setEditorVisible(false);
      fillEditor(null);
    });
  }
  if (drawerMask) {
    drawerMask.addEventListener('click', () => {
      setEditorVisible(false);
      fillEditor(null);
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isEditorVisible()) return;
    setEditorVisible(false);
    fillEditor(null);
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        const payload = readEditorPayload();
        if (editingServiceId && !canAccess('admin.tools.action.update-service')) {
          throw new Error('无权限编辑工具服务');
        }
        if (!editingServiceId && !canAccess('admin.tools.action.create-service')) {
          throw new Error('无权限创建工具服务');
        }
        if (editingServiceId) {
          await api(`/api/admin/tools/mcp-services/${encodeURIComponent(editingServiceId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          renderStatus(`已更新服务：${editingServiceId}`);
        } else {
          await api('/api/admin/tools/mcp-services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          renderStatus(`已新增服务：${payload.name}`);
        }
        setEditorVisible(false);
        fillEditor(null);
        await load();
      } catch (error) {
        renderStatus(resolveErrorMessage(error, '保存失败'), true);
      }
    });
  }

  body.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const editBtn = target.closest('.edit-mcp-btn');
    if (editBtn) {
      if (!canAccess('admin.tools.action.update-service')) {
        renderStatus('无权限编辑工具服务', true);
        return;
      }
      const serviceId = editBtn.getAttribute('data-service-id');
      if (!serviceId) return;
      const service = findService(serviceId);
      if (!service) {
        renderStatus('未找到目标服务，请刷新后重试', true);
        return;
      }
      fillEditor(service);
      setEditorVisible(true);
      return;
    }

    const healthBtn = target.closest('.health-mcp-btn');
    if (healthBtn) {
      if (!canAccess('admin.tools.action.check-health')) {
        renderStatus('无权限执行探活', true);
        return;
      }
      const serviceId = healthBtn.getAttribute('data-service-id');
      if (!serviceId) return;
      healthBtn.setAttribute('disabled', 'disabled');
      try {
        const result = await api(`/api/admin/tools/mcp-services/${encodeURIComponent(serviceId)}/check-health`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const status = result && result.health ? result.health.status : 'unknown';
        renderStatus(`探活完成：${serviceId} -> ${status}`);
        await load();
      } catch (error) {
        renderStatus(resolveErrorMessage(error, '探活失败'), true);
      } finally {
        healthBtn.removeAttribute('disabled');
      }
      return;
    }

    const deleteBtn = target.closest('.delete-mcp-btn');
    if (deleteBtn) {
      if (!canAccess('admin.tools.action.delete-service')) {
        renderStatus('无权限删除工具服务', true);
        return;
      }
      const serviceId = deleteBtn.getAttribute('data-service-id');
      if (!serviceId) return;
      const ok = window.confirm(`确认删除 MCP 服务：${serviceId}？`);
      if (!ok) return;
      deleteBtn.setAttribute('disabled', 'disabled');
      try {
        await api(`/api/admin/tools/mcp-services/${encodeURIComponent(serviceId)}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        renderStatus(`已删除服务：${serviceId}`);
        if (editingServiceId === serviceId) {
          setEditorVisible(false);
          fillEditor(null);
        }
        await load();
      } catch (error) {
        renderStatus(resolveErrorMessage(error, '删除失败'), true);
      } finally {
        deleteBtn.removeAttribute('disabled');
      }
      return;
    }

    const button = target.closest('.toggle-mcp-btn');
    if (!button) return;
    const serviceId = button.getAttribute('data-service-id');
    const enabled = button.getAttribute('data-enabled') === '1';
    if (!serviceId) return;
    if (!canAccess('admin.tools.action.update-service')) {
      renderStatus('无权限编辑工具服务', true);
      return;
    }
    button.setAttribute('disabled', 'disabled');
    try {
      await api(`/api/admin/tools/mcp-services/${encodeURIComponent(serviceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled })
      });
      renderStatus(`服务 ${enabled ? '已停用' : '已启用'}：${serviceId}`);
      await load();
    } catch (error) {
      renderStatus(resolveErrorMessage(error, '操作失败'), true);
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
