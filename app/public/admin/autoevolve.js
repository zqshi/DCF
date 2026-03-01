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

function renderRuns(items = []) {
  const el = document.getElementById('runList');
  el.innerHTML = items.map((item) => {
    const id = String(item.id || '');
    return `<div class="overview-item">
      <strong>${id}</strong> · ${item.status || '-'}<br/>
      <small>base=${item.baseVersionId || '-'} · gain=${Number((item.quality || {}).scoreGain || 0)}</small>
      <div>
        <button data-promote="${id}">推广</button>
        <button data-revert="${id}">回退Run</button>
      </div>
    </div>`;
  }).join('') || '<div class="overview-item">暂无演进记录</div>';
}

async function loadRuns() {
  setStatus('加载中...');
  const runs = await requestJson('/api/admin/autoevolve/runs');
  renderRuns(runs);
  setStatus('已加载');
}

async function createRun() {
  setStatus('创建中...');
  await requestJson('/api/admin/autoevolve/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  await loadRuns();
  setStatus('创建成功');
}

async function promoteRun(runId) {
  setStatus('推广中...');
  await requestJson('/api/admin/autoevolve/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId })
  });
  await loadRuns();
  setStatus('推广成功');
}

async function revertRun(runId) {
  setStatus('回退中...');
  await requestJson('/api/admin/autoevolve/revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId })
  });
  await loadRuns();
  setStatus('回退成功');
}

(async () => {
  try {
    if (window.__adminReady) await window.__adminReady;
    await loadRuns();
    document.getElementById('createRunBtn').addEventListener('click', () => {
      createRun().catch((error) => setStatus(`创建失败：${error.message}`));
    });
    document.getElementById('runList').addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const promote = target.getAttribute('data-promote');
      const revert = target.getAttribute('data-revert');
      if (promote) {
        promoteRun(promote).catch((error) => setStatus(`推广失败：${error.message}`));
      } else if (revert) {
        revertRun(revert).catch((error) => setStatus(`回退失败：${error.message}`));
      }
    });
  } catch (error) {
    setStatus(`加载失败：${error.message}`);
  }
})();
