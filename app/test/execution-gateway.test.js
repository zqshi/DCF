const test = require('node:test');
const assert = require('node:assert/strict');
const { ExecutionGateway } = require('../src/infrastructure/integrations/ExecutionGateway');

function runtimeStub(name, enabled = true) {
  return {
    name,
    isEnabled() {
      return enabled;
    },
    async executeTask() {
      return {
        status: 'succeeded',
        result: `${name}-ok`,
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: `${name}-task`,
        runtimeEvents: [],
        source: name
      };
    },
    async listInstalledSkills() {
      return {
        source: name,
        enabled: true,
        items: [{ slug: `${name}-skill`, status: 'ready' }]
      };
    },
    async runtimeSkillCommand(action, input) {
      return {
        ok: true,
        source: name,
        action,
        input
      };
    }
  };
}

test('execution gateway enforces openclaw runtime when engine=self_hosted', async () => {
  const gateway = new ExecutionGateway({
    engine: 'self_hosted',
    openclawRuntime: runtimeStub('openclaw', true),
    selfHostedRuntime: runtimeStub('self-hosted', true),
    skillsRuntime: runtimeStub('skills-runtime', false)
  });

  assert.equal(gateway.isEnabled(), true);
  assert.equal(gateway.providerLabel(), 'managed-runtime');
  const result = await gateway.executeTask({ id: 't1' }, { id: 'e1' });
  assert.equal(result.source, 'openclaw');
});

test('execution gateway selects openclaw runtime when engine=openclaw', async () => {
  const gateway = new ExecutionGateway({
    engine: 'openclaw',
    openclawRuntime: runtimeStub('openclaw', true),
    selfHostedRuntime: runtimeStub('self-hosted', true),
    skillsRuntime: runtimeStub('skills-runtime', false)
  });

  assert.equal(gateway.isEnabled(), true);
  assert.equal(gateway.providerLabel(), 'managed-runtime');
  const result = await gateway.executeTask({ id: 't2' }, { id: 'e2' });
  assert.equal(result.source, 'openclaw');
});

test('execution gateway reports unavailable when openclaw is unavailable even if others are enabled', async () => {
  const gateway = new ExecutionGateway({
    engine: 'auto',
    openclawRuntime: runtimeStub('openclaw', false),
    selfHostedRuntime: runtimeStub('self-hosted', true),
    skillsRuntime: runtimeStub('skills-runtime', false)
  });

  assert.equal(gateway.isEnabled(), false);
  assert.equal(gateway.providerLabel(), 'runtime-unavailable');
  const result = await gateway.executeTask({ id: 't3' }, { id: 'e3' });
  assert.equal(result, null);
});

test('execution gateway reports unavailable when no runtime is enabled', async () => {
  const gateway = new ExecutionGateway({
    engine: 'auto',
    openclawRuntime: runtimeStub('openclaw', false),
    selfHostedRuntime: runtimeStub('self-hosted', false),
    skillsRuntime: runtimeStub('skills-runtime', false)
  });

  assert.equal(gateway.isEnabled(), false);
  assert.equal(gateway.providerLabel(), 'runtime-unavailable');
  const result = await gateway.executeTask({ id: 't4' }, { id: 'e4' });
  assert.equal(result, null);
});

test('execution gateway enforces openclaw runtime when engine=skills_runtime', async () => {
  const gateway = new ExecutionGateway({
    engine: 'skills_runtime',
    openclawRuntime: runtimeStub('openclaw', true),
    selfHostedRuntime: runtimeStub('self-hosted', true),
    skillsRuntime: runtimeStub('skills-runtime', true)
  });

  assert.equal(gateway.isEnabled(), true);
  assert.equal(gateway.providerLabel(), 'managed-runtime');
  const result = await gateway.executeTask({ id: 't5' }, { id: 'e5' });
  assert.equal(result.source, 'openclaw');
});

test('execution gateway auto mode prefers openclaw runtime when enabled', async () => {
  const gateway = new ExecutionGateway({
    engine: 'auto',
    openclawRuntime: runtimeStub('openclaw', true),
    selfHostedRuntime: runtimeStub('self-hosted', true),
    skillsRuntime: runtimeStub('skills-runtime', true)
  });

  assert.equal(gateway.providerLabel(), 'managed-runtime');
  const result = await gateway.executeTask({ id: 't6' }, { id: 'e6' });
  assert.equal(result.source, 'openclaw');
});

test('execution gateway can execute explicitly with target engine', async () => {
  const gateway = new ExecutionGateway({
    engine: 'auto',
    openclawRuntime: runtimeStub('openclaw', true),
    selfHostedRuntime: runtimeStub('self-hosted', true),
    skillsRuntime: runtimeStub('skills-runtime', true)
  });
  const result = await gateway.executeTaskWithEngine({ id: 't7' }, { id: 'e7' }, 'openclaw');
  assert.equal(result.source, 'openclaw');
});

test('execution gateway defaults to openclaw runtime', async () => {
  const envBackup = process.env.EXECUTION_ENGINE;
  delete process.env.EXECUTION_ENGINE;
  try {
    const gateway = new ExecutionGateway({
      openclawRuntime: runtimeStub('openclaw', true),
      selfHostedRuntime: runtimeStub('self-hosted', true),
      skillsRuntime: runtimeStub('skills-runtime', true)
    });
    assert.equal(gateway.providerLabel(), 'managed-runtime');
    const result = await gateway.executeTask({ id: 't8' }, { id: 'e8' });
    assert.equal(result.source, 'openclaw');
  } finally {
    process.env.EXECUTION_ENGINE = envBackup;
  }
});

test('execution gateway delegates runtime skill listing to active runtime', async () => {
  const gateway = new ExecutionGateway({
    engine: 'openclaw',
    openclawRuntime: runtimeStub('openclaw', true)
  });
  const listed = await gateway.listInstalledSkills({ status: 'ready' });
  assert.equal(listed.enabled, true);
  assert.equal(Array.isArray(listed.items), true);
  assert.equal(listed.items[0].slug, 'openclaw-skill');
});

test('execution gateway delegates runtime skill command to active runtime', async () => {
  const gateway = new ExecutionGateway({
    engine: 'openclaw',
    openclawRuntime: runtimeStub('openclaw', true)
  });
  const result = await gateway.runtimeSkillCommand('install', { slug: 'find-skills' });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'openclaw');
  assert.equal(result.action, 'install');
  assert.equal(result.input.slug, 'find-skills');
});
