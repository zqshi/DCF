#!/usr/bin/env node
const path = require('path');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { AuthUseCases } = require('../src/application/usecases/AuthUseCases');
const { analyzeLayerBoundaries } = require('./verify-layer-boundaries');

function parseArgs(argv = process.argv.slice(2)) {
  let profile = String(process.env.VERIFY_PROFILE || 'baseline').trim().toLowerCase();
  for (const arg of argv) {
    if (arg === '--production') profile = 'production';
    if (arg.startsWith('--profile=')) {
      profile = String(arg.slice('--profile='.length) || '').trim().toLowerCase() || profile;
    }
  }
  if (!['baseline', 'production'].includes(profile)) {
    throw new Error(`unsupported profile: ${profile}. expected baseline|production`);
  }
  return { profile };
}

function assertAuditFieldsAndTransitions() {
  const store = new InMemoryStore();
  const employeeUC = new EmployeeUseCases(store);
  const taskUC = new TaskUseCases(store);
  const employee = employeeUC.create({
    employeeCode: 'EMP-GATE-001',
    name: 'Gate Checker',
    email: 'gate@example.com',
    creator: 'qa-owner',
    department: 'Ops',
    role: 'Operator'
  });
  const task = taskUC.create({
    employeeId: employee.id,
    goal: 'Verify gate transitions',
    traceId: 'trace-gate-check-001'
  });
  return taskUC.tick().then(() => {
    const related = store.events
      .filter((ev) => (ev.payload || {}).task_id === task.id)
      .slice()
      .reverse();

    const missingAuditFields = related
      .filter((ev) => ev.type.startsWith('task.'))
      .filter((ev) => {
        const p = ev.payload || {};
        return !p.trace_id || !p.task_id || !p.employee_id;
      });
    if (missingAuditFields.length) {
      throw new Error(`audit fields missing in ${missingAuditFields.length} task event(s)`);
    }

    const mustHave = new Set(['task.created', 'task.validating', 'task.running']);
    for (const event of related) {
      mustHave.delete(event.type);
    }
    if (mustHave.size > 0) {
      throw new Error(`required task events missing: ${Array.from(mustHave).join(', ')}`);
    }

    const eventToStatus = {
      'task.validating': 'validating',
      'task.approval.required': 'validating',
      'task.approved': 'approved',
      'task.running': 'running',
      'task.succeeded': 'succeeded',
      'task.failed': 'failed',
      'task.rolled_back': 'rolled_back',
      'task.requeued': 'pending'
    };
    const allowed = {
      pending: new Set(['validating', 'approved']),
      validating: new Set(['approved', 'failed', 'rolled_back', 'validating']),
      approved: new Set(['running', 'rolled_back', 'failed']),
      running: new Set(['succeeded', 'failed', 'rolled_back', 'pending']),
      failed: new Set(['rolled_back', 'pending']),
      succeeded: new Set([]),
      rolled_back: new Set([])
    };
    let current = 'pending';
    const transitions = [];
    for (const event of related) {
      const next = eventToStatus[event.type];
      if (!next) continue;
      transitions.push(`${current}->${next}`);
      if (!allowed[current] || !allowed[current].has(next)) {
        throw new Error(`illegal state transition detected: ${current} -> ${next}`);
      }
      current = next;
    }
    return {
      taskId: task.id,
      finalStatus: current,
      transitions
    };
  });
}

function assertProductionAuthHealth(health) {
  if (!health.healthy) {
    throw new Error('auth health check failed for production profile');
  }
  if (health.strictMode !== true) {
    throw new Error('production profile requires strict auth mode (AUTH_REQUIRE_EXTERNAL_USERS=1)');
  }
  if (health.forbidDemoUsers !== true) {
    throw new Error('production profile requires demo-user blocking (AUTH_FORBID_DEMO_USERS=1)');
  }
  if (health.userSource === 'default-demo') {
    throw new Error('production profile requires external users source (AUTH_USERS_FILE or AUTH_USERS_JSON)');
  }
  if (Array.isArray(health.demoUsers) && health.demoUsers.length > 0) {
    throw new Error(`production profile found demo users: ${health.demoUsers.join(', ')}`);
  }
  if (Number(health.legacyPasswordHashUsers || 0) > 0) {
    throw new Error('production profile requires scrypt password hashes (legacy hashes detected)');
  }
}

function assertProductionEnvHardening(env = process.env) {
  if (!String(env.AUTH_PASSWORD_PEPPER || '').trim()) {
    throw new Error('production profile requires AUTH_PASSWORD_PEPPER');
  }
  if (String(env.DB_DRIVER || '').trim().toLowerCase() === 'memory') {
    throw new Error('production profile forbids DB_DRIVER=memory');
  }
  const corsAllowOrigin = String(env.CORS_ALLOW_ORIGIN || '').trim();
  if (!corsAllowOrigin || corsAllowOrigin === '*') {
    throw new Error('production profile requires explicit CORS_ALLOW_ORIGIN (wildcard is forbidden)');
  }
}

function assertLayerBoundaryCompliance() {
  const root = path.resolve(__dirname, '..');
  const report = analyzeLayerBoundaries(root);
  if (!report.ok) {
    throw new Error(`layer boundary violations detected: ${JSON.stringify(report.violations)}`);
  }
  return {
    checkedFiles: report.checkedFiles
  };
}

async function main() {
  const { profile } = parseArgs();
  const productionProfile = profile === 'production';
  const gates = [];

  let auditAndState;
  let authHealth;
  let layerBoundary;
  try {
    layerBoundary = assertLayerBoundaryCompliance();
    gates.push({ gate: 'layer-boundary', ok: true, ...layerBoundary });
  } catch (error) {
    gates.push({ gate: 'layer-boundary', ok: false, message: error.message });
    console.error(JSON.stringify({ ok: false, profile, gates, failedGate: 'layer-boundary' }, null, 2));
    process.exit(1);
  }
  try {
    auditAndState = await assertAuditFieldsAndTransitions();
    gates.push({ gate: 'audit-fields-and-state-machine', ok: true });
  } catch (error) {
    gates.push({ gate: 'audit-fields-and-state-machine', ok: false, message: error.message });
    console.error(JSON.stringify({ ok: false, profile, gates, failedGate: 'audit-fields-and-state-machine' }, null, 2));
    process.exit(1);
  }

  try {
    const auth = new AuthUseCases(productionProfile ? { nodeEnv: 'production' } : {});
    authHealth = auth.getHealthStatus();
    if (productionProfile) {
      assertProductionAuthHealth(authHealth);
    }
    gates.push({ gate: 'auth-health', ok: true, health: authHealth });
  } catch (error) {
    gates.push({ gate: 'auth-health', ok: false, message: error.message });
    console.error(JSON.stringify({ ok: false, profile, gates, failedGate: 'auth-health' }, null, 2));
    process.exit(1);
  }

  if (productionProfile) {
    try {
      assertProductionEnvHardening(process.env);
      gates.push({ gate: 'production-env-hardening', ok: true });
    } catch (error) {
      gates.push({ gate: 'production-env-hardening', ok: false, message: error.message });
      console.error(JSON.stringify({ ok: false, profile, gates, failedGate: 'production-env-hardening' }, null, 2));
      process.exit(1);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    profile,
    gates,
    note: 'Run `npm test` and `npm run drill:p1-rollback` separately as required production gates.',
    auditAndState,
    authHealth
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
