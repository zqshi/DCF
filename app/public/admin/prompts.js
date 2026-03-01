async function requestJson(path, options = {}) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'request failed');
  return body;
}

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = String(text || '');
}

let promptCenterCache = null;

function applyPromptCenter(center = {}) {
  promptCenterCache = center;
  const layers = center.layers || {};
  const platform = layers.platform || {};
  document.getElementById('platformContent').value = String(platform.content || '');
}

function renderVersions(payload = {}) {
  const list = document.getElementById('versionList');
  const activeVersionId = String(payload.activeVersionId || '');
  const items = Array.isArray(payload.items) ? payload.items : [];
  document.getElementById('activeVersion').textContent = `active: ${activeVersionId || '-'}`;
  list.innerHTML = items.map((item) => {
    const id = String(item.id || '');
    const active = id === activeVersionId ? '（生效中）' : '';
    const status = String(item.status || '');
    const approveBtn = status === 'pending_approval'
      ? `<button data-approve="${id}">审批通过</button>`
      : '';
    return `<div class="overview-item">
      <strong>${id}</strong> ${active}<br/>
      <small>${item.name || ''} · ${item.source || ''} · ${item.createdAt || ''} · ${status}</small>
      <div>${approveBtn} <button data-rollback="${id}">回滚到此版本</button></div>
    </div>`;
  }).join('') || '<div class="overview-item">暂无版本</div>';
}

async function loadAll() {
  setStatus('加载中...');
  const [center, compiled, versions] = await Promise.all([
    requestJson('/api/admin/prompt-center'),
    requestJson('/api/admin/prompt-center/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }),
    requestJson('/api/admin/prompt-versions')
  ]);
  applyPromptCenter(center);
  document.getElementById('compiledText').value = String(compiled.content || '');
  renderVersions(versions);
  setStatus('已加载');
}

function upsertLayer(map = {}, id, content) {
  const key = String(id || '').trim();
  if (!key) return map;
  const next = { ...(map || {}) };
  next[key] = {
    id: key,
    content: String(content || '').trim()
  };
  return next;
}

async function saveCenter() {
  if (!promptCenterCache) await loadAll();
  const base = promptCenterCache || {};
  const layers = base.layers || {};
  const nextLayers = {
    ...layers,
    platform: {
      ...(layers.platform || {}),
      content: String(document.getElementById('platformContent').value || '')
    },
    roleTemplates: upsertLayer(
      layers.roleTemplates || {},
      document.getElementById('roleKey').value,
      document.getElementById('roleContent').value
    ),
    tenantPolicies: upsertLayer(
      layers.tenantPolicies || {},
      document.getElementById('tenantKey').value,
      document.getElementById('tenantContent').value
    ),
    userProfiles: upsertLayer(
      layers.userProfiles || {},
      document.getElementById('userKey').value,
      document.getElementById('userContent').value
    )
  };
  setStatus('保存中...');
  await requestJson('/api/admin/prompt-center', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layers: nextLayers })
  });
  await loadAll();
  setStatus('层级已保存');
}

async function publish() {
  setStatus('发布中...');
  await requestJson('/api/admin/prompt-versions/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Manual ${new Date().toISOString()}`
    })
  });
  await loadAll();
  setStatus('发布成功');
}

async function rollback(versionId) {
  setStatus('回滚中...');
  await requestJson('/api/admin/prompt-versions/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId })
  });
  await loadAll();
  setStatus('回滚成功');
}

async function approve(versionId) {
  setStatus('审批中...');
  await requestJson('/api/admin/prompt-versions/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId })
  });
  await loadAll();
  setStatus('审批成功');
}

(async () => {
  try {
    if (window.__adminReady) await window.__adminReady;
    await loadAll();
    document.getElementById('compileBtn').addEventListener('click', () => {
      loadAll().catch((error) => setStatus(`刷新失败：${error.message}`));
    });
    document.getElementById('saveCenterBtn').addEventListener('click', () => {
      saveCenter().catch((error) => setStatus(`保存失败：${error.message}`));
    });
    document.getElementById('publishBtn').addEventListener('click', () => {
      publish().catch((error) => setStatus(`发布失败：${error.message}`));
    });
    document.getElementById('versionList').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const versionId = target.getAttribute('data-rollback');
      const approveId = target.getAttribute('data-approve');
      if (approveId) {
        approve(approveId).catch((error) => setStatus(`审批失败：${error.message}`));
        return;
      }
      if (!versionId) return;
      rollback(versionId).catch((error) => setStatus(`回滚失败：${error.message}`));
    });
  } catch (error) {
    setStatus(`加载失败：${error.message}`);
  }
})();
