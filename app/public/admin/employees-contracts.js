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
    setText('employeeCount', list.length);
    setText('allowConfiguredCount', list.filter((x) => Array.isArray((x.jobPolicy || {}).allow) && x.jobPolicy.allow.length > 0).length);
    setText('l4PolicyCount', list.filter((x) => Number((((x.approvalPolicy || {}).byRisk || {}).L4 || {}).requiredApprovals || 0) > 0).length);

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无员工</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((employee) => {
      const policy = employee.jobPolicy || {};
      const approval = ((employee.approvalPolicy || {}).byRisk || {}).L4 || {};
      const roles = Array.isArray(approval.requiredAnyRoles) ? approval.requiredAnyRoles.join(', ') : '-';
      return `
        <tr>
          <td class="mono">${escapeHtml(employee.employeeCode || '-')}</td>
          <td>${escapeHtml(employee.name || '-')}</td>
          <td>${escapeHtml(`${employee.department || '-'} / ${employee.role || '-'}`)}</td>
          <td>${escapeHtml(employee.riskLevel || '-')}</td>
          <td>${Array.isArray(policy.allow) ? policy.allow.length : 0}</td>
          <td>${Array.isArray(policy.deny) ? policy.deny.length : 0}</td>
          <td>${Number(approval.requiredApprovals || 0)}</td>
          <td>${escapeHtml(roles || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">加载失败：${escapeHtml(error.message)}</td></tr>`;
  }
}

(async () => {
  if (window.__adminReady) await window.__adminReady;
  await load();
  setInterval(load, 2500);
})();
