async function api(path, options = {}) {
  if (window.adminApi) return window.adminApi(path, options);
  const res = await fetch(path, options);
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

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

async function load() {
  const tbody = document.getElementById('rows');
  try {
    const employees = await api('/api/admin/employees');
    const list = Array.isArray(employees) ? employees : [];

    if (!list.length) {
      setText('capabilityTotal', 0);
      setText('knowledgeTotal', 0);
      setText('skillTotal', 0);
      tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无员工</td></tr>';
      return;
    }

    let capabilityTotal = 0;
    let knowledgeTotal = 0;
    let skillTotal = 0;

    tbody.innerHTML = list.map((employee) => {
      const capabilities = Array.isArray(employee.capabilities) ? employee.capabilities : [];
      const knowledge = Array.isArray(employee.knowledge) ? employee.knowledge : [];
      const skills = Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds : [];
      const childAgents = Array.isArray(employee.childAgents) ? employee.childAgents : [];
      const activeChildren = childAgents.filter((x) => String(x.status || '') === 'active');
      capabilityTotal += capabilities.length;
      knowledgeTotal += knowledge.length;
      skillTotal += skills.length;
      return `
        <tr>
          <td class="mono">${escapeHtml(employee.employeeCode || '-')}</td>
          <td>${escapeHtml(employee.name || '-')}</td>
          <td>${capabilities.length}</td>
          <td>${knowledge.length}</td>
          <td>${skills.length}</td>
          <td>${childAgents.length}</td>
          <td>${activeChildren.length}</td>
        </tr>
      `;
    }).join('');

    setText('capabilityTotal', capabilityTotal);
    setText('knowledgeTotal', knowledgeTotal);
    setText('skillTotal', skillTotal);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">加载失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  await load();
  setInterval(load, 2500);
})();
