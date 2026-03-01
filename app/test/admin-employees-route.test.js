const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function loginAndCookie(base, username, password) {
  const login = await requestJson(base, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('admin employees route supports keyword, department and role filters', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const createEmployee = async (payload) => {
      const created = await requestJson(base, '/api/front/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: opsCookie
        },
        body: JSON.stringify(payload)
      });
      assert.equal(created.status, 201);
      return created.body;
    };

    await createEmployee({ creator: `route-filter-u1-${runId}`, name: `财务助手-${runId}`, department: 'Finance', role: 'Analyst' });
    await createEmployee({ creator: `route-filter-u2-${runId}`, name: `运营调度员-${runId}`, department: 'Ops', role: 'Dispatcher' });
    await createEmployee({ creator: `route-filter-u3-${runId}`, name: `运营分析员-${runId}`, department: 'Ops', role: 'Analyst' });

    const byKeyword = await requestJson(base, `/api/admin/employees?keyword=${encodeURIComponent(`财务助手-${runId}`)}`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(byKeyword.status, 200);
    assert.equal(byKeyword.body.length, 1);
    assert.equal(byKeyword.body[0].department, 'Finance');

    const byDepartmentAndRole = await requestJson(
      base,
      `/api/admin/employees?department=Ops&role=Analyst&keyword=${encodeURIComponent(`运营分析员-${runId}`)}`,
      {
      method: 'GET',
      headers: { Cookie: adminCookie }
      }
    );
    assert.equal(byDepartmentAndRole.status, 200);
    assert.equal(byDepartmentAndRole.body.length, 1);
    assert.equal(byDepartmentAndRole.body[0].name, `运营分析员-${runId}`);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin employees route supports policy optimize endpoint', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const created = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({
        creator: `route-policy-opt-${runId}`,
        name: '政策优化测试员工',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(created.status, 201);

    const optimized = await requestJson(base, `/api/admin/employees/${created.body.id}/policy-optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        narrative: '优先保证合规，输出必须包含风险点和下一步建议。',
        jobPolicy: {
          allow: ['处理运营工单'],
          deny: ['越权外发敏感数据']
        }
      })
    });
    assert.equal(optimized.status, 200);
    assert.equal(optimized.body.employeeId, created.body.id);
    assert.equal(String(optimized.body.optimizedPrompt || '').includes('执行边界（必须遵守）'), true);
    assert.equal(String(optimized.body.optimizedPrompt || '').includes('管理员补充说明（自然语言）'), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin employee detail route returns runtime aliases for employee and related tasks', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const created = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({
        creator: `route-runtime-alias-${runId}`,
        name: '运行时别名测试员工',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(created.status, 201);

    const task = await requestJson(base, '/api/front/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({
        employeeId: created.body.id,
        goal: '验证 runtime alias',
        conversationId: `route-runtime-alias-conv-${runId}`,
        runtimeConfig: {
          policyId: 'policy-runtime-alias',
          toolScope: ['read']
        }
      })
    });
    assert.equal(task.status, 201);

    const detail = await requestJson(base, `/api/admin/employees/${created.body.id}`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(detail.status, 200);
    assert.equal(((detail.body.runtimeProfile || {}).agentId || '').length > 0, true);
    assert.equal((detail.body.runtimeProfile || {}).agentId, (detail.body.openclawProfile || {}).agentId);
    assert.equal(Array.isArray(detail.body.relatedTasks), true);
    assert.equal((detail.body.relatedTasks[0].runtimeConfig || {}).policyId, 'policy-runtime-alias');
    assert.equal((detail.body.relatedTasks[0].runtimeConfig || {}).policyId, (detail.body.relatedTasks[0].openclaw || {}).policyId);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin runtime file update route is reachable through acl guard', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const opsCookie = await loginAndCookie(base, 'ops', 'ops123');
    const adminCookie = await loginAndCookie(base, 'admin', 'admin123');

    const created = await requestJson(base, '/api/front/employees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: opsCookie
      },
      body: JSON.stringify({
        creator: `route-runtime-file-${runId}`,
        name: '运行时文件路由可达性员工',
        department: 'Ops',
        role: 'Operator'
      })
    });
    assert.equal(created.status, 201);

    const updated = await requestJson(base, `/api/admin/employees/${created.body.id}/runtime-files/AGENTS.md`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({ content: '# AGENTS.md\n\nreachability-check\n' })
    });
    assert.notEqual(updated.status, 404);
    assert.notEqual(updated.status, 403);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
