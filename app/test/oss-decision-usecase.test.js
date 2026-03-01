const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { OssDecisionUseCases } = require('../src/application/usecases/OssDecisionUseCases');

function fakeRepo(name, stars, updatedAt, description = '') {
  return {
    full_name: name,
    html_url: `https://github.com/${name}`,
    stargazers_count: stars,
    updated_at: updatedAt,
    description,
    license: { spdx_id: 'MIT' }
  };
}

test('oss decision usecase auto creates decision case and evaluation artifacts', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss', creator: 'u-oss-1', department: 'Ops', role: 'Operator' });
  const task = {
    id: 'task-oss-1',
    employeeId: employee.id,
    goal: '部署日志采集基础设施',
    iteration: 1
  };
  const uc = new OssDecisionUseCases(store, {
    async searchRepositories() {
      return [
        fakeRepo('a/better-observability', 2000, new Date().toISOString(), 'observability for infra'),
        fakeRepo('a/legacy-agent', 20, '2022-01-01T00:00:00.000Z', 'old package')
      ];
    }
  });

  const created = await uc.inferAndHandle(task, employee, {
    status: 'failed',
    corrected: true,
    source: 'runtime',
    error: { severity: 'P2', message: 'infrastructure component unavailable' }
  });

  assert.ok(created);
  assert.equal(store.ossCases.length, 1);
  assert.equal(store.ossCases[0].taskId, task.id);
  assert.ok(['introduce_oss', 'build_in_house', 'defer'].includes(store.ossCases[0].recommendation));
  assert.ok(store.ossCandidateEvaluations.length >= 1);
  const topCandidate = store.ossCandidateEvaluations[0];
  assert.equal(typeof topCandidate.repoDescription, 'string');
  assert.equal(typeof topCandidate.stars, 'number');
  assert.ok(['active', 'stable', 'aging', 'stale'].includes(String(topCandidate.maintenanceStatus)));
  assert.equal(store.ossBuildVsBuyAssessments.length, 1);
  assert.ok(store.ossFindings.length >= 1);
  assert.equal(created.evaluation.schemaVersion, 'oss_evaluation_result.v1');
  assert.equal(created.evaluation.consistency.ok, true);
});

test('oss decision hard gate blocks introduction when top candidate license is incompatible', async () => {
  const store = new InMemoryStore();
  store.ossGovernancePolicy = {
    mode: 'assist',
    decisionEngine: 'llm',
    fallbackToManualWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'system'
  };
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-Lic', creator: 'u-oss-lic', department: 'Ops', role: 'Operator' });
  const uc = new OssDecisionUseCases(store, {
    async searchRepositories() {
      return [{
        full_name: 'org/gpl-tooling',
        html_url: 'https://github.com/org/gpl-tooling',
        stargazers_count: 2500,
        updated_at: new Date().toISOString(),
        description: 'ops infra toolkit',
        license: { spdx_id: 'GPL-3.0' }
      }];
    }
  });
  const caseItem = await uc.inferAndHandle({
    id: 'task-oss-hard-gate',
    employeeId: employee.id,
    goal: '部署日志采集基础设施',
    iteration: 1
  }, employee, {
    status: 'failed',
    corrected: true,
    source: 'runtime',
    error: { severity: 'P2', message: 'component unavailable' }
  });

  assert.ok(caseItem);
  assert.equal(caseItem.recommendation, 'defer');
  assert.match(String(caseItem.rationale || ''), /hard_gate_blocked/);
  assert.ok(store.events.some((ev) => ev.type === 'oss.hard_gate.blocked'));
});

test('oss decision usecase skips case creation when no gap inferred', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-2', creator: 'u-oss-2', department: 'Ops', role: 'Operator' });
  const task = {
    id: 'task-oss-2',
    employeeId: employee.id,
    goal: '输出周报',
    iteration: 1
  };
  const uc = new OssDecisionUseCases(store, {
    async searchRepositories() {
      return [];
    }
  });
  const created = await uc.inferAndHandle(task, employee, {
    status: 'succeeded',
    corrected: false,
    source: 'runtime',
    error: null
  });
  assert.equal(created, null);
  assert.equal(store.ossCases.length, 0);
});

test('task usecase integrates auto oss decision pipeline without manual intervention', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-3', creator: 'u-oss-3', department: 'Ops', role: 'Operator' });
  const ossDecisionUC = new OssDecisionUseCases(store, {
    async searchRepositories() {
      return [fakeRepo('org/tooling-kit', 1200, new Date().toISOString(), 'toolkit')];
    }
  });
  const executionGateway = {
    isEnabled() { return true; },
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        corrected: false,
        source: 'runtime',
        error: { severity: 'P2', message: 'missing sdk component' },
        children: [],
        skills: [],
        knowledge: [],
        runtimeTaskId: 'rt-1',
        runtimeEvents: []
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { ossDecisionUseCases: ossDecisionUC });
  tuc.create({ employeeId: employee.id, goal: '集成第三方SDK并部署' });

  await tuc.tick();

  assert.ok(store.ossCases.length >= 1);
  assert.ok(store.ossCandidateEvaluations.length >= 1);
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.identified'));
});

test('oss decision state machine supports approve deploy verify and rollback', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-4', creator: 'u-oss-4', department: 'Ops', role: 'Operator' });
  const uc = new OssDecisionUseCases(store, {
    async searchRepositories() {
      return [fakeRepo('org/fit-project', 3200, new Date().toISOString(), 'ops infra toolkit')];
    }
  });

  const caseItem = uc.createCase({
    id: 'task-oss-4',
    goal: '部署任务编排基础设施',
    iteration: 1
  }, employee, {
    gapType: 'infra_missing',
    gapSummary: '缺少编排基础设施',
    demandFingerprint: 'ops:orchestration',
    confidence: 0.9,
    rationale: 'gap inferred'
  });
  caseItem.status = 'pending_approval';

  const approved = uc.approveCase(caseItem.id, { decision: 'introduce_oss', note: 'approved by admin' }, {
    userId: 'u-admin-1',
    role: 'super_admin'
  });
  assert.equal(approved.status, 'approved_introduce');

  const deploying = uc.deployCase(caseItem.id, { userId: 'u-admin-1', role: 'super_admin' });
  assert.equal(deploying.status, 'deploying');

  const verified = uc.verifyCase(caseItem.id, { note: 'deployment verified' }, { userId: 'u-admin-1', role: 'super_admin' });
  assert.equal(verified.status, 'completed');

  const rolledBack = uc.rollbackCase(caseItem.id, { reason: 'post-verify rollback drill' }, { userId: 'u-admin-1', role: 'super_admin' });
  assert.equal(rolledBack.status, 'rolled_back');

  const reviewed = uc.reviewCase(caseItem.id, {
    lifecycleStatus: 'active'
  }, { userId: 'u-admin-1', role: 'super_admin' });
  assert.equal(reviewed.review.lifecycleStatus, 'active');
  assert.ok(reviewed.review.nextReviewAt);

  const retired = uc.retireCase(caseItem.id, {
    reason: 'no longer needed'
  }, { userId: 'u-admin-1', role: 'super_admin' });
  assert.equal(retired.review.lifecycleStatus, 'retired');
  assert.equal(retired.review.retireReason, 'no longer needed');
});

test('oss decision policy proposes decision and waits for user confirmation in IM', async () => {
  const store = new InMemoryStore();
  store.ossGovernancePolicy = {
    mode: 'model_driven',
    decisionEngine: 'llm',
    fallbackToManualWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'system'
  };
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-5', creator: 'u-oss-5', department: 'Ops', role: 'Operator' });
  store.tasks.push({
    id: 'task-oss-auto-1',
    employeeId: employee.id,
    goal: '集成可观测组件',
    riskLevel: 'L2',
    iteration: 1
  });
  const uc = new OssDecisionUseCases(
    store,
    {
      async searchRepositories() {
        return [fakeRepo('org/fit-observability', 4200, new Date().toISOString(), 'obs stack')];
      }
    },
    {
      dialogueGateway: {
        isEnabled() { return true; },
        async generateReply(input) {
          if (String(input.goal || '').includes('输出字段')) {
            return '{"decision":"introduce_oss","autoDeploy":true,"autoVerify":true,"reason":"model_full_auto"}';
          }
          return '';
        }
      }
    }
  );

  const created = await uc.inferAndHandle({
    id: 'task-oss-auto-1',
    employeeId: employee.id,
    goal: '集成可观测组件',
    iteration: 1
  }, employee, {
    status: 'failed',
    corrected: true,
    source: 'runtime',
    error: { severity: 'P2', message: 'missing observability sdk' }
  });

  assert.ok(created);
  assert.equal(store.ossCases[0].status, 'pending_approval');
  assert.equal(store.ossCases[0].recommendation, 'introduce_oss');
  assert.equal(store.ossCases[0].autonomyDecision.decision, 'introduce_oss');
  assert.equal(store.ossCases[0].autonomyDecision.status, 'proposed_for_user_confirmation');
  assert.equal(store.ossCases[0].userConfirmation.required, true);
  assert.equal(store.ossCases[0].userConfirmation.status, 'pending');
  assert.equal(String(store.ossCases[0].autonomyDecision.reason).includes('model_full_auto'), true);
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.auto.proposed'));
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.user_confirmation.required'));
});

test('oss decision policy still requires user confirmation even when auto deploy disabled', async () => {
  const store = new InMemoryStore();
  store.ossGovernancePolicy = {
    mode: 'model_driven',
    decisionEngine: 'llm',
    fallbackToManualWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'system'
  };
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-6', creator: 'u-oss-6', department: 'Ops', role: 'Operator' });
  store.tasks.push({
    id: 'task-oss-auto-2',
    employeeId: employee.id,
    goal: '接入审计基础设施',
    riskLevel: 'L4',
    iteration: 1
  });
  const uc = new OssDecisionUseCases(
    store,
    {
      async searchRepositories() {
        return [fakeRepo('org/audit-kit', 5200, new Date().toISOString(), 'audit stack')];
      }
    },
    {
      dialogueGateway: {
        isEnabled() { return true; },
        async generateReply(input) {
          if (String(input.goal || '').includes('输出字段')) {
            return '{"decision":"introduce_oss","autoDeploy":false,"autoVerify":false,"reason":"model_manual_deploy"}';
          }
          return '';
        }
      }
    }
  );

  const created = await uc.inferAndHandle({
    id: 'task-oss-auto-2',
    employeeId: employee.id,
    goal: '接入审计基础设施',
    iteration: 1
  }, employee, {
    status: 'failed',
    corrected: true,
    source: 'runtime',
    error: { severity: 'P2', message: 'missing audit sdk' }
  });

  assert.ok(created);
  assert.equal(store.ossCases[0].status, 'pending_approval');
  assert.equal(store.ossCases[0].autonomyDecision.decision, 'introduce_oss');
  assert.equal(store.ossCases[0].autonomyDecision.status, 'proposed_for_user_confirmation');
  assert.equal(store.ossCases[0].userConfirmation.status, 'pending');
  assert.equal(String(store.ossCases[0].autonomyDecision.reason).includes('model_manual_deploy'), true);
  assert.equal(store.events.some((ev) => ev.type === 'oss.deploy.auto.started'), false);
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.user_confirmation.required'));
});

test('user can confirm or reject oss case from IM flow', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-7', creator: 'u-oss-7', department: 'Ops', role: 'Operator' });
  const uc = new OssDecisionUseCases(store, { async searchRepositories() { return []; } });
  const caseItem = uc.createCase({
    id: 'task-oss-user-confirm',
    goal: '引入日志网关',
    iteration: 1
  }, employee, {
    gapType: 'capability_missing',
    gapSummary: '缺少日志能力',
    demandFingerprint: 'ops:log',
    confidence: 0.9,
    rationale: 'top_candidate_fit:org/log-gateway'
  });
  caseItem.status = 'pending_approval';
  caseItem.recommendation = 'introduce_oss';
  uc.requestUserConfirmation(caseItem, { id: caseItem.taskId }, { id: caseItem.employeeId }, 'test');
  assert.equal(caseItem.userConfirmation.status, 'pending');

  const confirmed = uc.confirmCaseByUser(caseItem.id, { confirm: true, note: '同意推进' }, {
    userId: 'u-front-1',
    role: 'front_user'
  });
  assert.equal(confirmed.status, 'approved_introduce');
  assert.equal(confirmed.userConfirmation.status, 'confirmed');
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.user.confirmed'));

  const caseItem2 = uc.createCase({
    id: 'task-oss-user-reject',
    goal: '引入权限中间件',
    iteration: 1
  }, employee, {
    gapType: 'capability_missing',
    gapSummary: '缺少权限能力',
    demandFingerprint: 'ops:auth',
    confidence: 0.9,
    rationale: 'top_candidate_fit:org/auth-kit'
  });
  caseItem2.status = 'pending_approval';
  caseItem2.recommendation = 'introduce_oss';
  uc.requestUserConfirmation(caseItem2, { id: caseItem2.taskId }, { id: caseItem2.employeeId }, 'test');
  const rejected = uc.confirmCaseByUser(caseItem2.id, { confirm: false, note: '暂不引入' }, {
    userId: 'u-front-1',
    role: 'front_user'
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.userConfirmation.status, 'rejected');
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.user.rejected'));
});

test('oss decision policy can skip user confirmation for safe introduction', async () => {
  const store = new InMemoryStore();
  store.ossGovernancePolicy = {
    mode: 'model_driven',
    decisionEngine: 'llm',
    fallbackToManualWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'system'
  };
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-8', creator: 'u-oss-8', department: 'Ops', role: 'Operator' });
  store.tasks.push({
    id: 'task-oss-auto-safe-1',
    employeeId: employee.id,
    goal: '集成稳定日志组件',
    riskLevel: 'L2',
    iteration: 1
  });
  const uc = new OssDecisionUseCases(
    store,
    {
      async searchRepositories() {
        return [fakeRepo('org/stable-log-kit', 8200, new Date().toISOString(), 'stable logs')];
      }
    },
    {
      dialogueGateway: {
        isEnabled() { return true; },
        async generateReply(input) {
          if (String(input.goal || '').includes('输出字段')) {
            return '{"decision":"introduce_oss","requiresUserConfirmation":false,"autoDeploy":false,"autoVerify":false,"reason":"safe_introduction_no_confirmation"}';
          }
          return '';
        }
      }
    }
  );

  const created = await uc.inferAndHandle({
    id: 'task-oss-auto-safe-1',
    employeeId: employee.id,
    goal: '集成稳定日志组件',
    iteration: 1
  }, employee, {
    status: 'failed',
    corrected: true,
    source: 'runtime',
    error: { severity: 'P2', message: 'missing logging sdk' }
  });

  assert.ok(created);
  assert.equal(store.ossCases[0].status, 'approved_introduce');
  assert.equal(store.ossCases[0].recommendation, 'introduce_oss');
  assert.equal(store.ossCases[0].autonomyDecision.status, 'auto_execute_without_user_confirmation');
  assert.equal(store.events.some((ev) => ev.type === 'oss.case.user_confirmation.required'), false);
  assert.ok(store.events.some((ev) => ev.type === 'oss.case.auto.approved'));
});

test('model-driven governance throws error when model is unavailable instead of auto-defer', async () => {
  const store = new InMemoryStore();
  store.ossGovernancePolicy = {
    mode: 'model_driven',
    decisionEngine: 'llm',
    fallbackToManualWhenModelUnavailable: true,
    updatedAt: null,
    updatedBy: 'system'
  };
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Oss-9', creator: 'u-oss-9', department: 'Ops', role: 'Operator' });
  const uc = new OssDecisionUseCases(store, {
    async searchRepositories() {
      return [fakeRepo('org/tool-safe', 1800, new Date().toISOString(), 'safe tool')];
    }
  }, {
    dialogueGateway: {
      isEnabled() { return false; },
      async generateReply() { return ''; }
    }
  });

  const created = await uc.inferAndHandle({
    id: 'task-oss-model-down',
    employeeId: employee.id,
    goal: '接入日志能力',
    iteration: 1
  }, employee, {
    status: 'failed',
    corrected: true,
    source: 'runtime',
    error: { severity: 'P2', message: 'missing logging sdk' }
  });

  assert.ok(created);
  assert.equal(created.status, 'rolled_back');
  assert.match(String(created.rationale || ''), /pipeline_failed:oss governance model unavailable/);
  assert.equal(store.events.some((ev) => ev.type === 'oss.case.auto.deferred'), false);
});
