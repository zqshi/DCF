const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, routePath, options = {}) {
  const res = await fetch(`${base}${routePath}`, options);
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

test('admin skills routes support name/source search and manual employee link', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');

    const imported = await requestJson(base, '/api/admin/skills/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({
        mode: 'merge',
        skills: [
          { name: 'ops-watch-skill', type: 'general', source: 'archive_bundle' },
          { name: 'finance-watch-skill', type: 'domain', domain: 'finance', source: 'manual_entry' }
        ]
      })
    });
    assert.equal(imported.status, 200);

    const bySource = await requestJson(base, '/api/admin/skills?source=archive_bundle', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(bySource.status, 200);
    assert.equal(Array.isArray(bySource.body), true);
    assert.equal(bySource.body.some((item) => item.name === 'ops-watch-skill'), true);
    assert.equal(bySource.body.some((item) => item.name === 'finance-watch-skill'), false);

    const bySourcePartial = await requestJson(base, '/api/admin/skills?source=archive', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(bySourcePartial.status, 200);
    assert.equal(Array.isArray(bySourcePartial.body), true);
    assert.equal(bySourcePartial.body.some((item) => item.name === 'ops-watch-skill'), false);

    const byName = await requestJson(base, '/api/admin/skills?name=watch-skill', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(byName.status, 200);
    assert.equal(Array.isArray(byName.body), true);
    assert.equal(byName.body.some((item) => item.name === 'ops-watch-skill'), true);
    assert.equal(byName.body.some((item) => item.name === 'finance-watch-skill'), true);

    let employeeList = await requestJson(base, '/api/admin/skills/employees', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(employeeList.status, 200);
    assert.equal(Array.isArray(employeeList.body), true);

    if (!employeeList.body.length) {
      const createdEmployee = await requestJson(base, '/api/front/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: skillCookie
        },
        body: JSON.stringify({
          name: 'Skill-Link-Target',
          department: 'Ops',
          role: 'Operator',
          creator: 'u-skill-link-route'
        })
      });
      assert.equal(createdEmployee.status, 201);

      employeeList = await requestJson(base, '/api/admin/skills/employees', {
        method: 'GET',
        headers: { Cookie: skillCookie }
      });
      assert.equal(employeeList.status, 200);
      assert.equal(Array.isArray(employeeList.body), true);
    }
    assert.ok(employeeList.body.length > 0);

    const targetEmployee = employeeList.body[0];
    const targetSkill = bySource.body.find((item) => item.name === 'ops-watch-skill');
    assert.ok(targetEmployee && targetEmployee.id);
    assert.ok(targetSkill && targetSkill.id);

    const linked = await requestJson(base, `/api/admin/skills/${encodeURIComponent(targetSkill.id)}/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ employeeId: targetEmployee.id })
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.skillId, targetSkill.id);
    assert.equal(linked.body.linkedSkillIds.includes(targetSkill.id), true);

    const byEmployee = await requestJson(base, `/api/admin/skills?employeeId=${encodeURIComponent(targetEmployee.id)}`, {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(byEmployee.status, 200);
    assert.equal(Array.isArray(byEmployee.body), true);
    assert.equal(byEmployee.body.some((item) => item.id === targetSkill.id), true);

    const detail = await requestJson(base, `/api/admin/skills/${encodeURIComponent(targetSkill.id)}`, {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(detail.status, 200);
    assert.equal(Array.isArray(detail.body.linkedEmployees), true);
    assert.equal(detail.body.linkedEmployees.some((item) => item.id === targetEmployee.id), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin skills route can preload essential skill catalog', async () => {
  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const synced = await requestJson(base, '/api/admin/skills/preload-essential', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.total, 4);

    const listed = await requestJson(base, '/api/admin/skills', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body), true);
    assert.equal(listed.body.some((item) => item.name === 'find-skills'), true);
    assert.equal(listed.body.some((item) => item.name === 'tavily-search'), true);
    assert.equal(listed.body.some((item) => item.name === 'multi-search-engine'), true);
    assert.equal(listed.body.some((item) => item.name === 'office-automation'), true);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('admin skills route syncs runtime skills into admin catalog', async () => {
  const originalEnv = {
    OPENCLAW_BASE_URL: process.env.OPENCLAW_BASE_URL,
    OPENCLAW_REQUIRE_AUTH: process.env.OPENCLAW_REQUIRE_AUTH,
    OPENCLAW_SKILLS_LIST_PATH: process.env.OPENCLAW_SKILLS_LIST_PATH,
    SKILL_RUNTIME_SYNC_INTERVAL_MS: process.env.SKILL_RUNTIME_SYNC_INTERVAL_MS
  };
  let runtimeListCalls = 0;
  const runtimeServer = http.createServer((req, res) => {
    if (req.method === 'GET' && String(req.url || '').startsWith('/api/skills')) {
      runtimeListCalls += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        items: [
          { slug: 'runtime-mail-assistant', status: 'ready', description: 'mail helper' },
          ...(runtimeListCalls === 1
            ? [{ slug: 'runtime-risk-review', status: 'ready', type: 'domain', domain: 'ops' }]
            : [])
        ]
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => runtimeServer.listen(0, '127.0.0.1', resolve));
  const runtimeAddress = runtimeServer.address();
  process.env.OPENCLAW_BASE_URL = `http://127.0.0.1:${runtimeAddress.port}`;
  process.env.OPENCLAW_REQUIRE_AUTH = '0';
  process.env.OPENCLAW_SKILLS_LIST_PATH = '/api/skills';
  process.env.SKILL_RUNTIME_SYNC_INTERVAL_MS = '1';

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const skillCookie = await loginAndCookie(base, 'skill', 'skill123');
    const synced = await requestJson(base, '/api/admin/skills/sync-runtime', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({})
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.accepted, 2);

    const listed = await requestJson(base, '/api/admin/skills?source=runtime:openclaw', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(listed.status, 200);
    assert.equal(Array.isArray(listed.body), true);
    assert.equal(listed.body.some((item) => item.name === 'runtime-mail-assistant'), true);
    assert.equal(listed.body.some((item) => item.name === 'runtime-risk-review'), true);

    const pruned = await requestJson(base, '/api/admin/skills/sync-runtime', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: skillCookie
      },
      body: JSON.stringify({ pruneMissing: true })
    });
    assert.equal(pruned.status, 200);
    assert.equal(pruned.body.pruned >= 1, true);

    const listedAfterPrune = await requestJson(base, '/api/admin/skills?source=runtime:openclaw', {
      method: 'GET',
      headers: { Cookie: skillCookie }
    });
    assert.equal(listedAfterPrune.status, 200);
    assert.equal(listedAfterPrune.body.some((item) => item.name === 'runtime-mail-assistant'), true);
    assert.equal(listedAfterPrune.body.some((item) => item.name === 'runtime-risk-review'), false);
  } finally {
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => runtimeServer.close((error) => (error ? reject(error) : resolve())));
    process.env.OPENCLAW_BASE_URL = originalEnv.OPENCLAW_BASE_URL;
    process.env.OPENCLAW_REQUIRE_AUTH = originalEnv.OPENCLAW_REQUIRE_AUTH;
    process.env.OPENCLAW_SKILLS_LIST_PATH = originalEnv.OPENCLAW_SKILLS_LIST_PATH;
    process.env.SKILL_RUNTIME_SYNC_INTERVAL_MS = originalEnv.SKILL_RUNTIME_SYNC_INTERVAL_MS;
  }
});
