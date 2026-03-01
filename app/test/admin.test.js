const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { AdminUseCases } = require('../src/application/usecases/AdminUseCases');

test('admin employee detail includes base fields and auto growth fields', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const auc = new AdminUseCases(store);

  const e = euc.create({ name: 'HR-1', email: 'hr1@dcf.local', creator: 'alice', department: 'HR', role: 'Specialist' });
  tuc.create({ employeeId: e.id, goal: '处理入职单' });
  await tuc.tick();
  await tuc.tick();

  const detail = auc.getEmployeeDetail(e.id);
  assert.equal(detail.email, 'hr1@dcf.local');
  assert.equal(detail.creator, 'alice');
  assert.equal(detail.department, 'HR');
  assert.ok(Array.isArray(detail.childAgents));
  assert.ok(Array.isArray(detail.logs));
  assert.ok(Array.isArray(detail.linkedSkillIds));
});

test('admin employee detail includes execution, governance and growth summary', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const auc = new AdminUseCases(store);

  const employee = euc.create({
    name: 'Ops-1',
    email: 'ops1@dcf.local',
    creator: 'owner',
    department: 'Operations',
    role: 'Dispatcher',
    openclawProfile: {
      agentId: 'ops-agent',
      systemPrompt: '你是运营数字员工。',
      toolScope: ['bash', 'read']
    }
  });

  tuc.create({
    employeeId: employee.id,
    goal: '处理工单并同步系统',
    riskLevel: 'L2',
    openclaw: { policyId: 'policy-ops-l2', toolScope: ['bash', 'read', 'write'] }
  });
  tuc.create({
    employeeId: employee.id,
    goal: '高风险审批任务',
    riskLevel: 'L4',
    openclaw: { policyId: 'policy-ops-l4', extraSystemPrompt: '输出审批前风险清单。' }
  });
  await tuc.tick();
  await tuc.tick();

  const detail = auc.getEmployeeDetail(employee.id);
  assert.ok(detail.summary);
  assert.ok(detail.summary.tasks);
  assert.ok(detail.summary.governance);
  assert.ok(detail.summary.growth);
  assert.ok(detail.summary.runtime);
  assert.equal(detail.summary.tasks.total, 2);
  assert.ok(detail.summary.tasks.byStatus);
  assert.ok(detail.summary.tasks.byRisk);
  assert.ok(typeof detail.summary.tasks.successRate === 'number');
  assert.ok(typeof detail.summary.governance.auditEventCount === 'number');
  assert.ok(Array.isArray(detail.summary.governance.recentRiskEvents));
  assert.ok(typeof detail.summary.growth.capabilityCount === 'number');
  assert.ok(typeof detail.summary.growth.knowledgeCount === 'number');
  assert.equal(detail.summary.runtime.runtimeBoundCount >= 1, true);
  assert.equal(Array.isArray(detail.summary.runtime.byAgentId), true);
  assert.equal(Array.isArray(detail.summary.runtime.byPolicyId), true);
  assert.equal(Array.isArray(detail.summary.runtime.byToolScope), true);
  assert.ok(detail.summary.runtime.retrievalPolicy);
  assert.ok(detail.summary.runtime.effectiveRetrievalMode);
  assert.equal(typeof detail.summary.runtime.effectiveRetrievalMode.mode, 'string');
});

test('admin listEmployees supports keyword, department and role filters', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const auc = new AdminUseCases(store);

  euc.create({ name: '运维一号', email: 'ops1@dcf.local', creator: 'creator-ops-1', department: 'Ops', role: 'Dispatcher' });
  euc.create({ name: '运维二号', email: 'ops2@dcf.local', creator: 'creator-ops-2', department: 'Ops', role: 'Analyst' });
  euc.create({ name: '财务专员', email: 'fin1@dcf.local', creator: 'creator-fin-1', department: 'Finance', role: 'Dispatcher' });

  const byKeyword = auc.listEmployees({ keyword: '财务' });
  assert.equal(byKeyword.length, 1);
  assert.equal(byKeyword[0].department, 'Finance');

  const byDepartment = auc.listEmployees({ department: 'Ops' });
  assert.equal(byDepartment.length, 2);

  const byRole = auc.listEmployees({ role: 'Dispatcher' });
  assert.equal(byRole.length, 2);

  const combined = auc.listEmployees({ keyword: '运维', department: 'Ops', role: 'Analyst' });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].name, '运维二号');
});

test('admin overview snapshot includes delivery, governance and asset buckets', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);

  store.tasks = [
    { id: 't1', status: 'pending', riskLevel: 'L2', requiresApproval: false },
    { id: 't2', status: 'running', riskLevel: 'L2', requiresApproval: false },
    { id: 't3', status: 'succeeded', riskLevel: 'L1', requiresApproval: false },
    { id: 't4', status: 'failed', riskLevel: 'L4', requiresApproval: true, lastError: { severity: 'P1' } },
    { id: 't5', status: 'validating', riskLevel: 'L4', requiresApproval: true },
    { id: 't6', status: 'approved', riskLevel: 'L3', requiresApproval: true },
    { id: 't7', status: 'rolled_back', riskLevel: 'L2', rollback: { reason: 'manual' } },
    { id: 't8', status: 'aborted', riskLevel: 'L2', compensation: { status: 'queued' } }
  ];
  store.skills = [{ id: 's1', type: 'general' }, { id: 's2', type: 'domain' }];
  store.employees = [{ id: 'e1' }, { id: 'e2' }];
  store.ossFindings = [{ id: 'f1' }];
  store.researchQueue = [{ id: 'q1', status: 'queued' }, { id: 'q2', status: 'done' }];
  store.metrics = {
    totalTasks: 8,
    succeededTasks: 1,
    failedTasks: 1,
    recurrenceErrors: 2,
    skillReused: 4,
    p1Incidents: 1,
    retrieval: {
      busyDecisions: 0,
      idleDecisions: 0,
      internalTools: 0,
      platformContext: 0,
      externalSearch: 0,
      skippedExternal: 0,
      queuedExternal: 0
    },
    skillSedimentation: {
      directCreated: 1,
      proposalCreated: 2,
      skipped: 3
    }
  };

  const overview = auc.getOverview({
    runtimeEnabled: true,
    dialogueEnabled: true,
    bootstrap: { phase: 'exploring', cycleCount: 3, manualReviewRequired: true },
    queue: { researchQueued: 1, researchDone: 1 }
  });

  assert.equal(overview.delivery.totalTasks, 8);
  assert.equal(overview.delivery.inProgressTasks, 4);
  assert.equal(overview.delivery.successRate, 13);
  assert.equal(overview.governance.waitingApprovalTasks, 1);
  assert.equal(overview.governance.rollbackTasks, 1);
  assert.equal(overview.governance.compensationPendingTasks, 1);
  assert.equal(overview.governance.p1Incidents, 1);
  assert.equal(overview.assets.skillsTotal, 2);
  assert.equal(overview.assets.skillReused, 4);
  assert.equal(overview.assets.findingsTotal, 1);
  assert.equal(overview.runtime.manualReviewRequired, true);
  assert.equal(Array.isArray(overview.focus), true);
  assert.equal(overview.focus.length >= 3, true);
});

test('admin runtime shadow diffs supports filtering and pagination', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  store.events = [
    {
      id: 'ev-shadow-1',
      type: 'runtime.shadow.compared',
      payload: {
        task_id: 'task-1',
        employee_id: 'emp-1',
        targetEngine: 'openclaw',
        diff: { scores: { overall: 0.9 } }
      }
    },
    {
      id: 'ev-shadow-2',
      type: 'runtime.shadow.compared',
      payload: {
        task_id: 'task-2',
        employee_id: 'emp-2',
        targetEngine: 'openclaw',
        diff: { scores: { overall: 0.5 } }
      }
    },
    {
      id: 'ev-other',
      type: 'runtime.raw.event',
      payload: { task_id: 'task-2', employee_id: 'emp-2' }
    }
  ];

  const filtered = auc.listRuntimeShadowDiffs({ taskId: 'task-1', page: 1, pageSize: 10 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].id, 'ev-shadow-1');

  const paged = auc.listRuntimeShadowDiffs({ targetEngine: 'openclaw', page: 2, pageSize: 1 });
  assert.equal(paged.total, 2);
  assert.equal(paged.items.length, 1);
  assert.equal(paged.items[0].id, 'ev-shadow-2');
});

test('admin usecases backfill runtime aliases for legacy employee and task records', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  const employeeId = 'emp-legacy-admin';
  store.employees.push({
    id: employeeId,
    employeeCode: 'DE-9999',
    name: 'Legacy Admin',
    department: 'Ops',
    role: 'Operator',
    creator: 'legacy',
    linkedSkillIds: [],
    childAgents: [],
    capabilities: [],
    knowledge: [],
    openclawProfile: {
      agentId: 'legacy-admin-agent',
      systemPrompt: 'legacy prompt',
      toolScope: ['read']
    }
  });
  store.tasks.push({
    id: 'task-legacy-admin',
    employeeId,
    goal: 'legacy task',
    status: 'pending',
    riskLevel: 'L2',
    createdAt: new Date().toISOString(),
    openclaw: {
      agentId: 'legacy-admin-agent',
      policyId: 'legacy-policy',
      toolScope: ['read']
    }
  });

  const detail = auc.getEmployeeDetail(employeeId);
  assert.equal((detail.runtimeProfile || {}).agentId, 'legacy-admin-agent');
  assert.equal((detail.openclawProfile || {}).agentId, 'legacy-admin-agent');
  assert.equal((detail.relatedTasks[0].runtimeConfig || {}).policyId, 'legacy-policy');
  assert.equal((detail.relatedTasks[0].openclaw || {}).policyId, 'legacy-policy');

  const taskDetail = auc.getTaskDetail('task-legacy-admin');
  assert.equal((taskDetail.runtimeConfig || {}).policyId, 'legacy-policy');
  assert.equal((taskDetail.openclaw || {}).policyId, 'legacy-policy');
  assert.equal((taskDetail.employee.runtimeProfile || {}).agentId, 'legacy-admin-agent');
});

test('admin listTasks returns runtimeConfig alias while preserving openclaw compatibility', () => {
  const store = new InMemoryStore();
  const auc = new AdminUseCases(store);
  store.tasks.push({
    id: 'task-runtime-alias',
    employeeId: 'emp-1',
    goal: 'alias check',
    status: 'pending',
    createdAt: new Date().toISOString(),
    openclaw: {
      agentId: 'alias-agent',
      policyId: 'alias-policy',
      toolScope: ['read']
    }
  });
  const rows = auc.listTasks();
  assert.equal((rows[0].runtimeConfig || {}).agentId, 'alias-agent');
  assert.equal((rows[0].openclaw || {}).agentId, 'alias-agent');
});
