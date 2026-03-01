const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenClawGateway } = require('../src/infrastructure/integrations/OpenClawGateway');

test('openclaw gateway lists installed skills with fallback paths', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/api/skills?status=ready')) {
      return { ok: false, status: 404, async json() { return {}; } };
    }
    if (String(url).includes('/api/v1/skills?status=ready')) {
      return {
        ok: true,
        async json() {
          return {
            items: [
              { slug: 'find-skills', status: 'ready', description: 'finder' },
              { slug: 'ops-risk-review', status: 'ready', type: 'domain', domain: 'ops' }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({
      baseUrl: 'http://127.0.0.1:3001',
      requireAuth: false,
      skillsListPaths: '/api/skills,/api/v1/skills'
    });
    const listed = await gw.listInstalledSkills({ status: 'ready' });
    assert.equal(listed.enabled, true);
    assert.equal(listed.items.length, 2);
    assert.equal(listed.items[0].slug, 'find-skills');
    assert.equal(listed.items[0].type, '');
    assert.equal(listed.items[0].version, '');
    assert.equal(listed.items[0].title, '');
    assert.equal(listed.items[1].type, 'domain');
    assert.equal(listed.items[1].domain, 'ops');
    assert.equal(listed.items[1].raw.slug, 'ops-risk-review');
    assert.equal(calls.some((x) => x.url.includes('/api/skills?status=ready')), true);
    assert.equal(calls.some((x) => x.url.includes('/api/v1/skills?status=ready')), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway maps runtime skill command to cli', async () => {
  const calls = [];
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: false,
    commandRunner: async (bin, args) => {
      calls.push({ bin, args });
      return { ok: true, exitCode: 0, stdout: 'ok', stderr: '', error: '' };
    }
  });
  const install = await gw.runtimeSkillCommand('install', { slug: 'find-skills' });
  const search = await gw.runtimeSkillCommand('search', { query: 'excel' });
  const check = await gw.runtimeSkillCommand('check', {});
  assert.equal(install.ok, true);
  assert.equal(search.ok, true);
  assert.equal(check.ok, true);
  assert.equal(calls[0].bin, 'npx');
  assert.equal(calls[0].args.join(' '), 'clawhub@latest install find-skills');
  assert.equal(calls[1].bin, 'openclaw');
  assert.equal(calls[1].args.join(' '), 'skills search excel');
  assert.equal(calls[2].bin, 'npx');
  assert.equal(calls[2].args.join(' '), 'skills check');
});
