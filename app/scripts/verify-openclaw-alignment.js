#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ensureOpenClawSecurityReadiness } = require('../src/shared/startupGuards');
const { createTask } = require('../src/domain/entities/Task');
const { processTaskTick } = require('../src/application/services/TaskTickService');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { AdminUseCases } = require('../src/application/usecases/AdminUseCases');
const { SkillUseCases } = require('../src/application/usecases/SkillUseCases');

function readAppFile(relativePath) {
  const filePath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(filePath, 'utf8');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyStartupGateWired() {
  const source = readAppFile('src/server.js');
  expect(
    source.includes('await ensureOpenClawRuntimeReadiness(process.env);'),
    'startup must enforce ensureOpenClawRuntimeReadiness(process.env)'
  );
}

function verifyEngineAliasMapping() {
  let okSelfHosted = false;
  let okSkillsRuntime = false;
  try {
    ensureOpenClawSecurityReadiness({
      EXECUTION_ENGINE: 'self_hosted',
      OPENCLAW_BASE_URL: ''
    });
  } catch (error) {
    okSelfHosted = String(error && error.message).includes('requires OPENCLAW_BASE_URL');
  }
  try {
    ensureOpenClawSecurityReadiness({
      EXECUTION_ENGINE: 'skills_runtime',
      OPENCLAW_BASE_URL: ''
    });
  } catch (error) {
    okSkillsRuntime = String(error && error.message).includes('requires OPENCLAW_BASE_URL');
  }
  expect(okSelfHosted, 'EXECUTION_ENGINE=self_hosted must map to openclaw readiness behavior');
  expect(okSkillsRuntime, 'EXECUTION_ENGINE=skills_runtime must map to openclaw readiness behavior');
}

function verifyHealthRouteSemantics() {
  const source = readAppFile('src/interfaces/http/createApp.js');
  expect(
    source.includes('return json(res, runtimeEnabled ? 200 : 503, {'),
    '/api/health must return 503 when runtime is unavailable'
  );
  expect(
    source.includes('ok: runtimeEnabled,'),
    '/api/health response.ok must mirror runtimeEnabled'
  );
}

function verifyTaskRuntimeDefaults() {
  const employee = {
    id: 'emp-align-1',
    tenantId: 'tenant-align',
    accountId: 'acct-align',
    name: 'Alignment Checker',
    riskLevel: 'L2',
    approvalPolicy: { byRisk: {} }
  };
  const task = createTask(employee, { goal: 'alignment-check' });
  expect(task.runtime && task.runtime.source === 'openclaw', 'new task runtime.source default must be openclaw');
}

async function verifyTaskTickFallbackSource() {
  const employee = {
    id: 'emp-align-2',
    tenantId: 'tenant-align',
    accountId: 'acct-align',
    name: 'Tick Checker',
    riskLevel: 'L2',
    approvalPolicy: { byRisk: {} },
    knowledge: []
  };
  const task = createTask(employee, { goal: 'tick-source-check' });
  const events = [];
  const ctx = {
    store: {
      employees: [employee],
      metrics: {
        failedTasks: 0,
        recurrenceErrors: 0,
        succeededTasks: 0,
        skillReused: 0,
        p1Incidents: 0
      },
      addEvent(type, payload) {
        events.push({ type, payload });
      }
    },
    prepareTask(nextTask) {
      nextTask.status = 'approved';
    },
    emitRuntimeToolCatalog() {},
    eventPayload(nextTask, _employee, extra = {}) {
      return {
        trace_id: nextTask.traceId,
        task_id: nextTask.id,
        employee_id: nextTask.employeeId,
        ...extra
      };
    },
    executeTask() {
      return Promise.resolve({ status: 'succeeded', result: 'ok' });
    },
    resolveNaturalResult(_task, _employee, result) {
      return Promise.resolve(result);
    },
    applyExternalChildren() {},
    normalizeExternalSkills() {},
    autoSkillize() {
      return Promise.resolve();
    },
    recordAssistantMessageForTask() {}
  };

  await processTaskTick(ctx, task);
  expect(task.runtime && task.runtime.source === 'openclaw', 'task tick fallback runtime source must be openclaw');
  expect(events.some((item) => item.type === 'task.succeeded'), 'task tick should complete success path in alignment check');
}

function verifyRuntimeShadowPolicyConstraint() {
  const store = new InMemoryStore();
  const adminUC = new AdminUseCases(store);
  const current = adminUC.getRuntimeShadowPolicy();
  expect(current.targetEngine === 'openclaw', 'runtime shadow policy default targetEngine must be openclaw');

  let blocked = false;
  try {
    adminUC.updateRuntimeShadowPolicy({
      enabled: true,
      targetEngine: 'local',
      allowTenants: '*',
      allowRoles: '*'
    }, { userId: 'alignment-bot' });
  } catch (error) {
    blocked = Number(error && error.statusCode) === 400;
  }
  expect(blocked, 'runtime shadow policy must reject non-openclaw target engines');
}

function verifyRuntimeSkillDetailsSync() {
  const store = new InMemoryStore();
  const skillUC = new SkillUseCases(store);
  const result = skillUC.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    onlyReady: true,
    items: [{
      slug: 'runtime-skill',
      type: 'general',
      status: 'ready',
      prompt: 'runtime prompt',
      skillMarkdown: '# Runtime Skill',
      resources: { references: [{ path: 'https://example.com/runtime-skill', name: 'Runtime Skill Doc' }] }
    }]
  });
  expect(result.accepted >= 1, 'runtime skill sync must accept ready runtime skills');
  const synced = store.skills.find((item) => item.name === 'runtime-skill');
  expect(Boolean(synced), 'runtime skill must be imported into local catalog');
  const structure = (synced && synced.structure && typeof synced.structure === 'object') ? synced.structure : {};
  expect(String(structure.prompt || '') === 'runtime prompt', 'runtime skill prompt must be preserved');
  expect(String(structure.skillMarkdown || '') === '# Runtime Skill', 'runtime skillMarkdown must be preserved');
  expect(
    structure.resources
      && Array.isArray(structure.resources.references)
      && structure.resources.references.length === 1
      && String((structure.resources.references[0] || {}).path || '') === 'https://example.com/runtime-skill',
    'runtime skill resources declaration must be preserved'
  );
}

function verifyUiRuntimeSourceDefaults() {
  const front = readAppFile('public/front.js');
  const adminTasks = readAppFile('public/admin/tasks.js');
  expect(
    front.includes('|| "openclaw"'),
    'front UI must default runtime source display to openclaw'
  );
  expect(
    adminTasks.includes("source: 'openclaw'"),
    'admin task UI must default runtime source display to openclaw'
  );
}

async function main() {
  const checks = [];
  const run = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, message: String((error && error.message) || error) });
      throw error;
    }
  };

  try {
    await run('startup-runtime-readiness-gate', verifyStartupGateWired);
    await run('engine-alias-mapping-openclaw', verifyEngineAliasMapping);
    await run('health-route-semantics', verifyHealthRouteSemantics);
    await run('task-runtime-default-source', verifyTaskRuntimeDefaults);
    await run('task-tick-fallback-source', verifyTaskTickFallbackSource);
    await run('runtime-shadow-policy-constraint', verifyRuntimeShadowPolicyConstraint);
    await run('runtime-skill-detail-sync', verifyRuntimeSkillDetailsSync);
    await run('ui-runtime-source-defaults', verifyUiRuntimeSourceDefaults);
  } catch {
    console.error(JSON.stringify({ ok: false, checks }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    checks: [],
    error: String((error && error.message) || error)
  }, null, 2));
  process.exit(1);
});
