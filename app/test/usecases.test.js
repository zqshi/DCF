const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');
const { DEFAULT_ATOMIC_CAPABILITIES } = require('../src/domain/entities/Employee');

test('create employee and task flow', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);

  const e = euc.create({ name: 'Ops-1', creator: 'u-alice', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Handle request' });

  assert.equal(store.employees.length, 1);
  assert.equal(store.tasks.length, 1);
  assert.equal(t.status, 'pending');
  assert.equal(t.conversationId, 'default');
  assert.ok(t.traceId);
  assert.equal(t.taskId, t.id);
  assert.equal(t.llmConfig.model, null);
  assert.equal(t.llmConfig.thinkingLevel, 'medium');
  for (const capability of DEFAULT_ATOMIC_CAPABILITIES) {
    assert.ok(e.capabilities.includes(capability));
  }
});

test('create employee auto-generates employee code and runtime defaults', () => {
  const store = new InMemoryStore();
  store.strategyCenter = {
    ...(store.strategyCenter || {}),
    defaultToolScope: ['read', 'search', 'test'],
    defaultSkillScope: ['general', 'ops']
  };
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({
    name: 'Ops-AutoRuntime',
    creator: 'u-auto-runtime',
    department: 'Ops',
    role: 'Operator'
  });

  assert.match(String(employee.employeeCode || ''), /^DE-\d{4}$/);
  assert.match(String((employee.runtimeProfile || {}).agentId || ''), /^dcf-agent-\d{4}$/);
  assert.match(String((employee.openclawProfile || {}).agentId || ''), /^dcf-agent-\d{4}$/);
  assert.equal((employee.runtimeProfile || {}).agentId, (employee.openclawProfile || {}).agentId);
  assert.equal(String((employee.openclawProfile || {}).systemPrompt || '').includes('你是 DCF 平台内的企业级数字员工执行体'), true);
  assert.equal(String((employee.openclawProfile || {}).systemPrompt || '').includes('【系统声明：独立人格行为范式】'), true);
  assert.equal(String((employee.openclawProfile || {}).systemPrompt || '').includes('Ops-AutoRuntime'), true);
  assert.equal(String((employee.openclawProfile || {}).systemPrompt || '').includes('Ops'), true);
  assert.equal(String((employee.openclawProfile || {}).systemPrompt || '').includes('Operator'), true);
  assert.equal(Array.isArray((employee.runtimeProfile || {}).toolScope), true);
  assert.equal((employee.runtimeProfile || {}).toolScope.includes('bash'), true);
  assert.equal((employee.runtimeProfile || {}).toolScope.includes('read'), true);
  assert.equal((employee.runtimeProfile || {}).toolScope.includes('search'), true);
  assert.equal(Array.isArray(employee.defaultSkillScope), true);
  assert.equal(employee.defaultSkillScope.includes('general'), true);
});

test('task keeps conversation id for multi-turn chat threading', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-2', creator: 'u-cindy', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Build report', conversationId: 'thread-abc' });
  assert.equal(t.conversationId, 'thread-abc');
});

test('task react trace records plan/act/observe/reflect entries during execution', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-React-1', creator: 'u-react', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Summarize weekly operations status' });
  await tuc.tick();
  assert.equal(Array.isArray(t.reactTrace), true);
  assert.equal(t.reactTrace.length > 0, true);
  const phases = new Set(t.reactTrace.map((item) => String(item.phase || '')));
  assert.equal(phases.has('plan'), true);
  assert.equal(phases.has('act') || phases.has('observe') || phases.has('reflect'), true);
});

test('runtime-required task fails when execution runtime is unavailable', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store, null, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '这段回复不应被使用';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Runtime-Required', creator: 'u-rr', department: 'Ops', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: '请执行真实发送',
    llmConfig: {
      requireRuntimeExecution: true
    }
  });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'runtime-required');
  assert.match(String((t.lastError || {}).message || ''), /Runtime execution required/i);
});

test('runtime-required task does not fallback to llm-direct after runtime failure', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const mockExecutionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: { severity: 'P2', message: 'runtime provider timeout' },
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-1',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, mockExecutionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '模型兜底回复';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Runtime-Strict', creator: 'u-rs', department: 'Ops', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: '同步今日运营汇总',
    llmConfig: {
      requireRuntimeExecution: true
    }
  });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'openclaw');
  assert.notEqual((t.runtime || {}).source, 'llm-direct');
});

test('runtime billing failure is rewritten to user-friendly assistant message', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: {
          severity: 'P2',
          message: 'HTTP 400: Access denied, please make sure your account is in good standing. For details, see: https://help.aliyun.com/zh/model-studio/error-code#overdue-payment'
        },
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-billing-denied',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '不应触发兜底';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Billing', creator: 'u-billing', department: 'Ops', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: '执行模型任务',
    llmConfig: {
      requireRuntimeExecution: true
    }
  });

  await tuc.tick();

  assert.equal(t.status, 'failed');
  const assistantMessage = (store.messages || []).find((m) => m.taskId === t.id && String(m.role || '').toLowerCase() === 'assistant');
  assert.ok(assistantMessage);
  assert.match(String(assistantMessage.content || ''), /模型服务当前不可用/);
  assert.equal(String(assistantMessage.content || '').includes('HTTP 400'), false);
});

test('runtime network failure is rewritten to connectivity guidance', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: {
          severity: 'P2',
          message: 'LLM response unavailable: /v1/chat/completions network_error:ECONNREFUSED'
        },
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-network-failure',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '不应触发兜底';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Network', creator: 'u-network', department: 'Ops', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: '执行模型任务',
    llmConfig: {
      requireRuntimeExecution: true
    }
  });

  await tuc.tick();

  assert.equal(t.status, 'failed');
  const assistantMessage = (store.messages || []).find((m) => m.taskId === t.id && String(m.role || '').toLowerCase() === 'assistant');
  assert.ok(assistantMessage);
  assert.match(String(assistantMessage.content || ''), /网络不可达或响应超时/);
  assert.match(String(assistantMessage.content || ''), /OPENAI_BASE_URL/);
});

test('tick auto requeues stale running task and continues execution', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'recovered by auto requeue',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-requeue-1',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    runningAutoRequeueStaleMs: 1000
  });
  const e = euc.create({ name: 'Ops-Stale-Running', creator: 'u-requeue', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '继续执行卡住任务' });
  t.status = 'running';
  t.updatedAt = new Date(Date.now() - 5000).toISOString();

  await tuc.tick();

  assert.equal(t.status, 'succeeded');
  assert.equal(t.autoRequeueCount, 1);
  assert.equal(store.events.some((event) => (
    event.type === 'task.requeued'
    && (event.payload || {}).taskId === t.id
    && (event.payload || {}).reason === 'running_stale_auto_requeue'
  )), true);
});

test('tick keeps fresh running task untouched to avoid duplicate concurrent execution', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  let executeCalls = 0;
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      executeCalls += 1;
      return {
        status: 'succeeded',
        result: 'should not run',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-fresh-running-1',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    runningAutoRequeueStaleMs: 10 * 1000
  });
  const e = euc.create({ name: 'Ops-Fresh-Running', creator: 'u-fresh', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '仍在执行中，不应重入队' });
  t.status = 'running';
  t.updatedAt = new Date().toISOString();

  await tuc.tick();

  assert.equal(t.status, 'running');
  assert.equal(executeCalls, 0);
  assert.equal(store.events.some((event) => (
    event.type === 'task.requeued'
    && (event.payload || {}).taskId === t.id
    && (event.payload || {}).reason === 'running_stale_auto_requeue'
  )), false);
});

test('front task derives runtime session key from conversation id', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Front-Session', creator: 'u-front-session', department: 'Ops', role: 'Operator' });

  const task = tuc.create({
    employeeId: e.id,
    goal: 'Handle front conversation',
    conversationId: 'conv-001',
    requestChannel: 'front'
  });

  assert.equal(task.runtimeConfig.sessionKey, `agent:${e.runtimeProfile.agentId}:conv:conv-001`);
  assert.equal(task.openclaw.sessionKey, `agent:${e.openclawProfile.agentId}:conv:conv-001`);
});

test('front task keeps explicit session key override', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Front-Override', creator: 'u-front-override', department: 'Ops', role: 'Operator' });

  const task = tuc.create({
    employeeId: e.id,
    goal: 'Handle front conversation with explicit key',
    conversationId: 'conv-002',
    requestChannel: 'front',
    openclaw: {
      sessionKey: 'agent:custom:fixed-key'
    }
  });

  assert.equal(task.runtimeConfig.sessionKey, 'agent:custom:fixed-key');
  assert.equal(task.openclaw.sessionKey, 'agent:custom:fixed-key');
});

test('non-front task keeps employee default session key', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({
    name: 'Ops-Api-Session',
    creator: 'u-api-session',
    department: 'Ops',
    role: 'Operator',
    openclawProfile: {
      agentId: 'ops-agent-fixed',
      sessionKey: 'agent:ops-agent-fixed:main'
    }
  });

  const task = tuc.create({
    employeeId: e.id,
    goal: 'Run api task',
    conversationId: 'conv-003',
    requestChannel: 'api'
  });

  assert.equal(task.runtimeConfig.sessionKey, 'agent:ops-agent-fixed:main');
  assert.equal(task.openclaw.sessionKey, 'agent:ops-agent-fixed:main');
});

test('one creator can only create one parent employee', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);

  euc.create({ name: 'Parent-1', creator: 'u-bob', department: 'Ops', role: 'Operator' });
  assert.throws(
    () => euc.create({ name: 'Parent-2', creator: 'u-bob', department: 'Ops', role: 'Operator' }),
    /only create one parent digital employee/
  );
});

test('access-scoped creator cannot bypass one-parent limit by spoofing creator field', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const accessContext = {
    tenantId: 'tenant-default',
    accountId: 'account-default',
    actorUserId: 'u-sso-actor-1'
  };

  euc.create({
    name: 'Parent-Scoped-1',
    creator: 'fake-creator-a',
    department: 'Ops',
    role: 'Operator'
  }, accessContext);

  assert.throws(() => euc.create({
    name: 'Parent-Scoped-2',
    creator: 'fake-creator-b',
    department: 'Ops',
    role: 'Operator'
  }, accessContext), /only create one parent digital employee/);
});

test('high-risk task requires manual approval before execution', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);

  const e = euc.create({ name: 'Ops-3', creator: 'u-r1', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Deploy prod change', riskLevel: 'L4' });
  await tuc.tick();
  assert.equal(t.status, 'validating');

  tuc.approve(t.id, 'u-approver-1', 'risk accepted', 'ops_admin');
  assert.equal(t.status, 'validating');
  tuc.approve(t.id, 'u-approver-2', 'second approval', 'auditor');
  await tuc.tick();
  assert.ok(['succeeded', 'failed', 'pending'].includes(t.status));
});

test('high-risk task needs role-diverse approvals including governance role', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);

  const e = euc.create({ name: 'Ops-4', creator: 'u-r2', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Critical change', riskLevel: 'L4' });
  await tuc.tick();
  tuc.approve(t.id, 'u-a1', 'first', 'ops_admin');
  tuc.approve(t.id, 'u-a2', 'second', 'ops_admin');
  assert.equal(t.status, 'validating');
});

test('approval policy can be configured per risk level by employee settings', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({
    name: 'Ops-Policy',
    creator: 'u-policy',
    department: 'Ops',
    role: 'Operator',
    approvalPolicy: {
      byRisk: {
        L3: { requiredApprovals: 1, requiredAnyRoles: ['ops_admin'], distinctRoles: false }
      }
    }
  });
  const t = tuc.create({ employeeId: e.id, goal: 'L3 controlled action', riskLevel: 'L3' });
  await tuc.tick();
  assert.equal(t.status, 'validating');
  tuc.approve(t.id, 'u-ops', 'approved', 'ops_admin');
  assert.equal(t.status, 'approved');
});

test('employee policy and approval policy can be updated after onboarding', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Policy', creator: 'u-policy2', department: 'Ops', role: 'Operator' });

  euc.updateJobPolicy(e.id, {
    allow: ['Handle incident triage'],
    deny: ['Direct production schema change'],
    kpi: ['SLA>=99%'],
    escalationRule: 'Escalate to owner in 10m',
    shutdownRule: 'Immediate stop on data leakage'
  }, 'u-admin');
  euc.updateApprovalPolicy(e.id, {
    byRisk: {
      L2: { requiredApprovals: 1, requiredAnyRoles: ['ops_admin'], distinctRoles: false }
    }
  }, 'u-admin');

  const t = tuc.create({ employeeId: e.id, goal: 'L2 task with policy', riskLevel: 'L2' });
  assert.equal(t.requiresApproval, true);
  assert.equal(t.approval.requiredApprovals, 1);
  assert.equal(t.approval.requiredAnyRoles.includes('ops_admin'), true);
  assert.equal(e.jobPolicy.allow.length, 1);
});

test('task creation enforces risk boundary when maxRiskLevel is configured', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Boundary', creator: 'u-boundary', department: 'Ops', role: 'Operator' });
  euc.updateJobPolicy(e.id, { maxRiskLevel: 'L2' }, 'u-admin');

  assert.throws(() => tuc.create({
    employeeId: e.id,
    goal: 'Need elevated change',
    riskLevel: 'L3'
  }), /risk level exceeds employee policy boundary/);
});

test('sensitive task intents are auto-escalated to L4 with approval required', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Sensitive', creator: 'u-sensitive', department: 'Ops', role: 'Operator' });

  const t = tuc.create({
    employeeId: e.id,
    goal: '请导出全部凭证并发送到外部邮箱'
  });

  assert.equal(t.riskLevel, 'L4');
  assert.equal(t.requiresApproval, true);
  assert.equal(Array.isArray((t.governance || {}).riskReasons), true);
  assert.equal((t.governance || {}).riskReasons.length > 0, true);

  const classifiedEvent = store.events.find((event) => event.type === 'task.risk.classified');
  assert.ok(classifiedEvent);
  assert.equal(classifiedEvent.payload.task_id, t.id);
  assert.equal(classifiedEvent.payload.employee_id, e.id);
  assert.equal(classifiedEvent.payload.effectiveRiskLevel, 'L4');
  assert.equal(classifiedEvent.payload.sensitive, true);
});

test('non-sensitive task keeps default risk profile and auto-approval path', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Normal', creator: 'u-normal', department: 'Ops', role: 'Operator' });

  const t = tuc.create({
    employeeId: e.id,
    goal: '整理客户沟通纪要并输出本周摘要'
  });

  assert.equal(t.riskLevel, 'L2');
  assert.equal(t.requiresApproval, false);
  assert.equal((t.approval || {}).approved, true);
});

test('task creation rejects mismatched permission ticket department and role', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Ticket', creator: 'u-ticket', department: 'Ops', role: 'Operator' });

  assert.throws(() => tuc.create({
    employeeId: e.id,
    goal: 'Use external action',
    permissionTicket: { department: 'Finance', role: 'Operator' }
  }), /department mismatch/);

  assert.throws(() => tuc.create({
    employeeId: e.id,
    goal: 'Use external action',
    permissionTicket: { department: 'Ops', role: 'Auditor' }
  }), /role mismatch/);
});

test('employee profile can be partially updated with governance-safe validation', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const e = euc.create({ name: 'Ops-Profile', creator: 'u-profile', department: 'Ops', role: 'Operator' });

  const updated = euc.updateProfile(e.id, {
    name: 'Ops-Profile-2',
    department: 'Operation Excellence',
    role: 'Lead Operator',
    riskLevel: 'L3',
    status: 'paused',
    openclawProfile: {
      sessionKey: 'agent:ops-agent-a:thread-001',
      systemPrompt: '你是运营数字员工，优先输出可执行步骤。',
      toolScope: ['bash', 'read']
    },
    retrievalPolicy: {
      mode: 'idle'
    }
  }, 'u-admin');

  assert.equal(updated.name, 'Ops-Profile-2');
  assert.equal(updated.email, e.email);
  assert.equal(updated.department, 'Operation Excellence');
  assert.equal(updated.role, 'Lead Operator');
  assert.equal(updated.riskLevel, 'L3');
  assert.equal(updated.status, 'paused');
  assert.match(String(updated.openclawProfile.agentId || ''), /^dcf-agent-\d{4}$/);
  assert.deepEqual(updated.openclawProfile.toolScope, ['bash', 'read']);
  assert.equal(updated.retrievalPolicy.mode, 'idle');
  const profileEvent = store.events.find((event) => event.type === 'employee.profile.updated');
  assert.ok(profileEvent);
  assert.ok(Array.isArray((profileEvent.payload || {}).updatedFields));
});

test('employee profile rejects invalid risk level and empty required fields', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const e = euc.create({ name: 'Ops-Profile-Guard', creator: 'u-profile-guard', department: 'Ops', role: 'Operator' });

  assert.throws(() => euc.updateProfile(e.id, { riskLevel: 'L8' }, 'u-admin'), /riskLevel/);
  assert.throws(() => euc.updateProfile(e.id, { name: '' }, 'u-admin'), /name is required/);
  assert.throws(() => euc.updateProfile(e.id, { email: 'new@dcf.local' }, 'u-admin'), /email is immutable/);
  assert.throws(() => euc.updateProfile(e.id, { retrievalPolicy: { mode: 'invalid' } }, 'u-admin'), /retrievalPolicy/);
});

test('employee profile rejects changing existing openclaw agentId', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const e = euc.create({
    name: 'Ops-Agent-Immutable',
    creator: 'u-agent-immutable',
    department: 'Ops',
    role: 'Operator',
    openclawProfile: {
      agentId: 'ops-agent-fixed',
      toolScope: ['read']
    }
  });

  assert.throws(() => euc.updateProfile(e.id, {
    openclawProfile: {
      agentId: 'ops-agent-new',
      toolScope: ['read', 'bash']
    }
  }, 'u-admin'), /openclawProfile\.agentId is immutable/);
});

test('employee usecases backfill runtimeProfile alias for legacy records', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const legacy = {
    id: 'emp-legacy-1',
    creator: 'u-legacy',
    agentType: 'parent',
    tenantId: 'tenant-default',
    accountId: 'account-default',
    name: 'Legacy',
    department: 'Ops',
    role: 'Operator',
    riskLevel: 'L2',
    status: 'active',
    openclawProfile: {
      agentId: 'legacy-agent',
      systemPrompt: 'legacy prompt',
      toolScope: ['read'],
      sessionKey: null
    }
  };
  store.employees.push(legacy);
  const row = euc.getById('emp-legacy-1');
  assert.equal((row.runtimeProfile || {}).agentId, 'legacy-agent');
  assert.equal((row.openclawProfile || {}).agentId, 'legacy-agent');
  const list = euc.list();
  assert.equal((list[0].runtimeProfile || {}).agentId, 'legacy-agent');
});

test('task usecases backfill runtimeConfig alias for legacy records', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({
    name: 'Legacy Task Employee',
    creator: 'u-legacy-task',
    department: 'Ops',
    role: 'Operator'
  });

  store.tasks.push({
    id: 'task-legacy-runtime-1',
    taskId: 'task-legacy-runtime-1',
    traceId: 'trace-legacy-runtime-1',
    employeeId: employee.id,
    tenantId: employee.tenantId,
    accountId: employee.accountId,
    employeeName: employee.name,
    conversationId: 'legacy-conv',
    goal: 'legacy runtime task',
    status: 'pending',
    openclaw: {
      agentId: 'legacy-task-agent',
      policyId: 'legacy-task-policy',
      toolScope: ['read']
    }
  });

  const detail = tuc.getTask('task-legacy-runtime-1');
  assert.equal((detail.runtimeConfig || {}).agentId, 'legacy-task-agent');
  assert.equal((detail.openclaw || {}).agentId, 'legacy-task-agent');

  const list = tuc.list();
  assert.equal((list[0].runtimeConfig || {}).policyId, 'legacy-task-policy');
  assert.equal((list[0].runtimeConfig || {}).policyId, (list[0].openclaw || {}).policyId);
});

test('employee policy optimization generates llm-friendly prompt from natural language governance input', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const e = euc.create({ name: 'Ops-Policy-Optimize', creator: 'u-policy-opt', department: 'Ops', role: 'Operator' });
  euc.updateJobPolicy(e.id, {
    allow: ['处理运营工单', '输出复盘报告'],
    deny: ['直接变更生产数据库'],
    escalationRule: '连续失败2次必须升级值班经理',
    shutdownRule: '触发数据泄露立即停机'
  }, 'u-admin');
  euc.updateApprovalPolicy(e.id, {
    byRisk: {
      L4: { requiredApprovals: 2, requiredAnyRoles: ['auditor', 'super_admin'], distinctRoles: true }
    }
  }, 'u-admin');

  const optimized = euc.optimizePolicyForLlm(e.id, {
    narrative: '优先保证合规和审计完整性，回答要给出下一步。'
  }, 'u-admin');

  assert.equal(optimized.source, 'rule-based');
  assert.equal(typeof optimized.optimizedPrompt, 'string');
  assert.equal(optimized.optimizedPrompt.includes('执行边界（必须遵守）'), true);
  assert.equal(optimized.optimizedPrompt.includes('禁止边界（Deny）'), true);
  assert.equal(optimized.optimizedPrompt.includes('连续失败2次必须升级值班经理'), true);
  assert.equal(optimized.optimizedPrompt.includes('管理员补充说明（自然语言）'), true);
  assert.equal(store.events.some((event) => event.type === 'employee.policy.optimized'), true);
});

test('task keeps llm config from request and exposes it for execution adapters', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-LLM', creator: 'u-llm', department: 'Ops', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: 'Model tuned task',
    llmConfig: {
      model: 'anthropic/claude-opus-4-6',
      thinkingLevel: 'high',
      toolPolicy: 'aggressive'
    }
  });
  assert.equal(t.llmConfig.model, 'anthropic/claude-opus-4-6');
  assert.equal(t.llmConfig.thinkingLevel, 'high');
  assert.equal(t.llmConfig.toolPolicy, 'aggressive');
});

test('task defaults llm model from configured model list when request does not specify model', () => {
  const prevFrontModels = process.env.FRONT_LLM_MODELS;
  const prevLlmModel = process.env.LLM_MODEL;
  process.env.FRONT_LLM_MODELS = 'deepseek-chat,gpt-4.1-mini';
  process.env.LLM_MODEL = 'fallback-model';
  try {
    const store = new InMemoryStore();
    const euc = new EmployeeUseCases(store);
    const tuc = new TaskUseCases(store);
    const e = euc.create({ name: 'Ops-LLM-Default', creator: 'u-llm-default', department: 'Ops', role: 'Operator' });
    const t = tuc.create({
      employeeId: e.id,
      goal: 'Model default task'
    });
    assert.equal(t.llmConfig.model, 'deepseek-chat');
  } finally {
    if (typeof prevFrontModels === 'undefined') delete process.env.FRONT_LLM_MODELS;
    else process.env.FRONT_LLM_MODELS = prevFrontModels;
    if (typeof prevLlmModel === 'undefined') delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = prevLlmModel;
  }
});

test('employee openclaw profile is persisted and inherited by created tasks', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({
    name: 'Ops-OpenClaw',
    creator: 'u-openclaw',
    department: 'Ops',
    role: 'Operator',
    openclawProfile: {
      agentId: 'finance-agent',
      systemPrompt: '你是财务数字员工，优先保证账务准确。',
      toolScope: ['bash', 'read', 'write']
    }
  });
  const task = tuc.create({
    employeeId: employee.id,
    goal: '对账并输出差异清单',
    openclaw: {
      extraSystemPrompt: '输出中必须包含异常原因分类。',
      policyId: 'policy-finance-l2'
    }
  });

  assert.equal(employee.openclawProfile.agentId, 'finance-agent');
  assert.equal(employee.openclawProfile.systemPrompt.includes('财务数字员工'), true);
  assert.deepEqual(
    employee.openclawProfile.toolScope.slice().sort(),
    ['bash', 'read', 'search', 'test', 'write'].sort()
  );
  assert.equal(task.openclaw.agentId, 'finance-agent');
  assert.equal(task.openclaw.policyId, 'policy-finance-l2');
  assert.equal(task.openclaw.extraSystemPrompt.includes('异常原因分类'), true);
  assert.deepEqual(
    task.openclaw.toolScope.slice().sort(),
    ['bash', 'read', 'search', 'test', 'write'].sort()
  );
});

test('task runtime config inherits workspace and agentDir from employee profile', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({
    name: 'Ops-Runtime-Isolation',
    creator: 'u-runtime-isolation',
    department: 'Ops',
    role: 'Operator'
  });
  employee.runtimeProfile = {
    ...(employee.runtimeProfile || {}),
    runtimeBaseUrl: 'http://127.0.0.1:19001',
    workspacePath: '/tmp/runtime/workspaces/ops-runtime-isolation',
    agentDir: '/tmp/runtime/agents/ops-runtime-isolation'
  };
  employee.openclawProfile = employee.runtimeProfile;

  const task = tuc.create({
    employeeId: employee.id,
    goal: '验证任务执行隔离上下文继承'
  });

  assert.equal(task.openclaw.runtimeBaseUrl, 'http://127.0.0.1:19001');
  assert.equal(task.openclaw.workspacePath, '/tmp/runtime/workspaces/ops-runtime-isolation');
  assert.equal(task.openclaw.agentDir, '/tmp/runtime/agents/ops-runtime-isolation');
});

test('task requests runtime tool permission and resumes after approval', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask(task) {
      const scope = (((task || {}).openclaw || {}).toolScope || []).map((item) => String(item || ''));
      if (scope.includes('bash')) {
        return {
          status: 'succeeded',
          result: 'bash task done',
          error: null,
          corrected: false,
          children: [],
          skills: [],
          knowledge: [],
          researchQuery: null,
          runtimeTaskId: 'rt-bash-granted',
          runtimeEvents: [],
          source: 'openclaw'
        };
      }
      return {
        status: 'failed',
        result: null,
        error: {
          severity: 'P2',
          message: 'tool bash permission denied'
        },
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-bash-denied',
        runtimeEvents: [{
          id: 'evt-tool-denied',
          type: 'task.tool.denied',
          at: new Date().toISOString(),
          payload: {
            toolName: 'bash',
            action: 'permission_denied',
            message: 'missing permission'
          }
        }],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '已完成 bash 目录扫描并整理摘要。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Permission', creator: 'u-perm', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '扫描下载目录并输出摘要' });

  await tuc.tick();
  assert.equal(t.status, 'validating');
  assert.equal((t.runtimePermission || {}).status, 'requested');
  assert.equal((t.runtimePermission || {}).tool, 'bash');

  tuc.approve(t.id, 'u-ops-1', 'grant bash for this employee', 'ops_admin');
  assert.equal(t.status, 'pending');
  assert.equal((t.runtimePermission || {}).status, 'granted');
  assert.equal(Array.isArray((e.openclawProfile || {}).toolScope), true);
  assert.deepEqual(
    e.openclawProfile.toolScope.slice().sort(),
    ['bash', 'read', 'search', 'test'].sort()
  );

  await tuc.tick();
  assert.equal(t.status, 'succeeded');
  assert.deepEqual(
    t.openclaw.toolScope.slice().sort(),
    ['bash', 'read', 'search', 'test'].sort()
  );

  const requested = store.events.find((event) => event.type === 'permission.requested');
  const granted = store.events.find((event) => event.type === 'permission.granted');
  assert.ok(requested);
  assert.ok(granted);
});

test('task fails when runtime returns echoed gateway result', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask(task) {
      return {
        status: 'succeeded',
        result: task.goal,
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-echo',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway: null });
  const e = euc.create({ name: 'Ops-Echo', creator: 'u-echo', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你能做什么？' });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.match(String((t.lastError || {}).message || ''), /Runtime result unavailable/i);
});

test('task fails when echoed runtime result cannot be replaced by llm reply', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask(task) {
      return {
        status: 'succeeded',
        result: task.goal,
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-echo-2',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway: null });
  const e = euc.create({ name: 'Ops-Echo2', creator: 'u-echo2', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你能做什么？' });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.equal(t.result, null);
  assert.match(String(t.lastError && t.lastError.message || ''), /Runtime result unavailable/);
});

test('task fails when runtime gateway returns no execution outcome', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return null;
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: null,
    requireLlmResponse: true
  });
  const e = euc.create({ name: 'Ops-Strict', creator: 'u-strict', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '给我今日摘要' });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'runtime-required');
  assert.match(String((t.lastError || {}).message || ''), /no outcome/i);
});

test('task fails when runtime gateway is disabled and llm gateway unavailable', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => false,
    async executeTask() {
      return null;
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway: null });
  const e = euc.create({ name: 'Ops-Local', creator: 'u-local', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你能做什么？' });
  await tuc.tick();

  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'runtime-required');
  assert.equal(((t.runtime || {}).evidence || {}).verdict, 'not_executed');
  assert.match(String(t.lastError && t.lastError.message || ''), /Runtime execution required/i);
});

test('task fails when runtime gateway is disabled even if llm gateway is enabled', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => false,
    async executeTask() {
      return null;
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return '已收到，我将先拆解任务，再给可执行交付清单。';
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const e = euc.create({ name: 'Ops-Llm-Direct', creator: 'u-llm-direct', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你是谁？' });
  await tuc.tick();

  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'runtime-required');
  assert.match(String(t.lastError && t.lastError.message || ''), /Runtime execution required/i);
});

test('task fails in strict llm mode when runtime returns deterministic fallback text', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'Delivered by deterministic fallback (provider unavailable): summarize today ops.',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-fallback-text',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: null,
    requireLlmResponse: true
  });
  const e = euc.create({ name: 'Ops-Strict-Fallback', creator: 'u-strict-fallback', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'summarize today ops.' });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.match(String(t.lastError && t.lastError.message || ''), /Runtime result unavailable/);
});

test('task fails when runtime returns synthetic text and llm is unavailable', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '已通过自主执行引擎完成任务：你是谁？。 输出包含执行步骤、结果摘要与后续建议，可直接进入下一轮自举优化。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-synthetic-cn',
        runtimeEvents: [],
        source: 'self-hosted'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: null,
    requireLlmResponse: false
  });
  const e = euc.create({ name: '客服数字员工', creator: 'u-humanized', department: 'Ops', role: '客服专员' });
  const t = tuc.create({ employeeId: e.id, goal: '你是谁？' });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.match(String((t.lastError || {}).message || ''), /Runtime result unavailable/);
});

test('task requires real llm reply when llmConfig.requireRealLlm=true', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '收到，这个任务我已经执行完成：你是谁？',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-require-real-llm',
        runtimeEvents: [],
        source: 'self-hosted'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: null
  });
  const e = euc.create({ name: 'LLM-Strict', creator: 'u-llm-strict', department: 'Ops', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: '你是谁？',
    llmConfig: {
      requireRealLlm: true
    }
  });
  await tuc.tick();
  assert.equal(t.status, 'failed');
  assert.match(String((t.lastError || {}).message || ''), /Runtime result unavailable/);
});

test('task pipeline does not block onboarding-style wording by content guard', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '看起来我们还处于初识阶段。Hey. I just came online. Who am I? Who are you?',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-follow-up-2',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: null,
    requireLlmResponse: false
  });
  const e = euc.create({ name: '连续成长员工', creator: 'u-growth-1', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'follow-up', conversationId: 'conv-growth-b' });
  await tuc.tick();
  assert.equal(t.status, 'succeeded');
  assert.match(String(t.result || ''), /just came online/i);
});

test('task runtime events include conversation id through normalized event payload', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-conv',
        runtimeEvents: [{
          id: 'evt-1',
          type: 'task.running',
          at: new Date().toISOString(),
          payload: { message: 'running' }
        }],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '目录扫描已完成，关键文件和风险点已整理。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Conversation', creator: 'u-conv', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'Track conv id', conversationId: 'thread-xyz' });
  await tuc.tick();

  const runtimeEvent = store.events.find((event) => event.type === 'runtime.raw.event');
  assert.ok(runtimeEvent);
  assert.equal((runtimeEvent.payload || {}).conversation_id, 'thread-xyz');
});

test('task emits shadow compare event when runtime shadow is enabled', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'primary done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-primary',
        runtimeEvents: [],
        source: 'openclaw'
      };
    },
    async executeTaskWithEngine(task, employee, engine) {
      assert.equal(engine, 'openclaw');
      return {
        status: 'succeeded',
        result: 'shadow done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-shadow',
        runtimeEvents: [],
        source: 'self-hosted'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    shadowCompareEnabled: true,
    shadowCompareTarget: 'openclaw'
  });
  const e = euc.create({ name: 'Ops-Shadow', creator: 'u-shadow', department: 'Ops', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: 'compare runtime result' });
  await tuc.tick();
  const shadow = store.events.find((event) => event.type === 'runtime.shadow.compared');
  assert.ok(shadow);
  assert.equal((shadow.payload || {}).targetEngine, 'openclaw');
  assert.equal((shadow.payload || {}).primary.status, 'succeeded');
  assert.equal((shadow.payload || {}).shadow.status, 'succeeded');
  assert.equal((shadow.payload || {}).diff.statusMatch, true);
});

test('task skips shadow compare when role policy blocks', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'primary done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-primary',
        runtimeEvents: [],
        source: 'openclaw'
      };
    },
    async executeTaskWithEngine() {
      throw new Error('should not execute shadow');
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    shadowCompareEnabled: true,
    shadowCompareTarget: 'openclaw',
    shadowAllowTenants: 'tenant-a',
    shadowAllowRoles: 'auditor'
  });
  const e = euc.create({
    name: 'Ops-Shadow-Blocked',
    creator: 'u-shadow-blocked',
    tenantId: 'tenant-a',
    department: 'Ops',
    role: 'Operator'
  });
  tuc.create({ employeeId: e.id, goal: 'compare runtime result' });
  await tuc.tick();
  const skipped = store.events.find((event) => event.type === 'runtime.shadow.skipped');
  assert.ok(skipped);
  assert.equal((skipped.payload || {}).reason, 'role_not_allowed');
});

test('task uses shadow policy provider and can compare without env toggle', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'primary done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-primary',
        runtimeEvents: [],
        source: 'openclaw'
      };
    },
    async executeTaskWithEngine(task, employee, engine) {
      assert.equal(engine, 'openclaw');
      return {
        status: 'succeeded',
        result: 'shadow done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-shadow',
        runtimeEvents: [],
        source: 'self-hosted'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    shadowCompareEnabled: false,
    shadowPolicyProvider: () => ({
      enabled: true,
      targetEngine: 'openclaw',
      allowTenants: ['*'],
      allowRoles: ['*']
    })
  });
  const e = euc.create({ name: 'Ops-Shadow-Dynamic', creator: 'u-shadow-dyn', department: 'Ops', role: 'Operator' });
  tuc.create({ employeeId: e.id, goal: 'compare runtime result by dynamic policy' });
  await tuc.tick();
  const shadow = store.events.find((event) => event.type === 'runtime.shadow.compared');
  assert.ok(shadow);
  assert.equal((shadow.payload || {}).targetEngine, 'openclaw');
});

test('task fails when runtime returns synthesis payload validation error', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'failed',
        result: null,
        error: {
          severity: 'P2',
          message: 'batch 1/1: LLM synthesis returned invalid payload: missing projectDetection.projectName/productName'
        },
        corrected: true,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-invalid-payload',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway: null });
  const e = euc.create({ name: 'Ops-InvalidPayload', creator: 'u-invalid', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你是谁？' });
  await tuc.tick();

  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'openclaw');
  assert.match(String((t.lastError || {}).message || ''), /invalid payload/i);
});

test('task runtime evidence marks shell request as not executed when runtime is unavailable', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => false,
    async executeTask() {
      return null;
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '我已经给你发了邮件，也给你打过电话了。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-NoShell', creator: 'u-noshell', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '扫描下载目录' });
  await tuc.tick();

  assert.equal(t.status, 'failed');
  assert.equal((t.runtime || {}).source, 'runtime-required');
  assert.equal(((t.runtime || {}).evidence || {}).verdict, 'not_executed');
  assert.equal(((t.runtime || {}).evidence || {}).shellIntent, true);
});

test('task runtime evidence marks shell execution as confirmed with command signals', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'scan done',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-shell-1',
        runtimeEvents: [{
          id: 'evt-shell-1',
          type: 'task.tool.called',
          at: new Date().toISOString(),
          payload: {
            toolName: 'bash',
            action: 'execute',
            details: {
              command: 'ls -la ~/Downloads',
              exitCode: 0
            }
          }
        }],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '目录扫描已完成，关键文件和风险点已整理。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Shell', creator: 'u-shell', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '扫描下载目录' });
  await tuc.tick();

  assert.equal(t.status, 'succeeded');
  assert.equal((t.runtime || {}).taskId, 'rt-shell-1');
  assert.equal(((t.runtime || {}).evidence || {}).verdict, 'confirmed');
  assert.equal(((t.runtime || {}).evidence || {}).commandCount, 1);
  assert.equal(((t.runtime || {}).evidence || {}).exitCodeCount, 1);
});

test('assistant completion claim is rewritten when external delivery has no receipt evidence', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '我已经给你发了邮件，也给你打过电话了。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-msg-plain',
        runtimeEvents: [{
          id: 'evt-msg-plain',
          type: 'task.tool.called',
          at: new Date().toISOString(),
          payload: {
            toolName: 'email',
            action: 'execute',
            details: {
              channel: 'smtp'
            }
          }
        }],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '我已经给你发了邮件，也给你打过电话了。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Truth-Guard', creator: 'u-truth', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '请把配置文档发邮件并电话通知我' });
  await tuc.tick();

  assert.equal(t.status, 'succeeded');
  assert.equal((t.runtime || {}).taskId, 'rt-msg-plain');
  assert.equal(((t.runtime || {}).evidence || {}).deliveryReceiptCount, 0);
  assert.equal(String(t.result || '').includes('我还没有拿到外部动作成功回执'), true);
  assert.equal(String(t.result || '').includes('我已经给你发了邮件'), false);
  assert.equal(store.events.some((event) => event.type === 'assistant.claim.rewritten'), true);
});

test('assistant completion claim is preserved when delivery receipt evidence exists', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '我已经把邮件发出，且刚刚电话确认过。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-msg-proof',
        runtimeEvents: [{
          id: 'evt-msg-proof-1',
          type: 'task.tool.called',
          at: new Date().toISOString(),
          payload: {
            toolName: 'email',
            action: 'sent',
            status: 'success',
            details: {
              messageId: 'mail-123'
            }
          }
        }, {
          id: 'evt-msg-proof-2',
          type: 'task.tool.called',
          at: new Date().toISOString(),
          payload: {
            toolName: 'phone',
            action: 'sent',
            status: 'success',
            details: {
              callId: 'call-456'
            }
          }
        }],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '我已经把邮件发出，且刚刚电话确认过。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Truth-Proof', creator: 'u-proof', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '请发邮件并电话通知我' });
  await tuc.tick();

  assert.equal(t.status, 'succeeded');
  assert.equal(((t.runtime || {}).evidence || {}).deliveryReceiptCount >= 2, true);
  assert.equal(String(t.result || '').includes('我已经把邮件发出'), true);
  assert.equal(store.events.some((event) => event.type === 'assistant.claim.rewritten'), false);
});

test('assistant response does not inject fixed runtime-claim rewrite template', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: '我是LogB，刚才已经通过自建引擎处理了你的身份查询，结果已生成。',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-runtime-claim',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const dialogueGateway = {
    isEnabled: () => true,
    async generateReply() {
      return '我是LogB，刚才已经通过自建引擎处理了你的身份查询，结果已生成。';
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, { dialogueGateway });
  const e = euc.create({ name: 'LogB', creator: 'u-logb', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: '你是谁？' });
  await tuc.tick();

  assert.equal(t.status, 'succeeded');
  assert.equal(String(t.result || '').includes('刚才已经收到并处理了你的问题'), false);
  assert.equal(store.events.some((event) => (
    event.type === 'assistant.claim.rewritten'
    && String((event.payload || {}).reason || '') === 'runtime_implementation_claim_without_user_request'
  )), false);
});

test('child agent is created only for complex task', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Child', creator: 'u-child', department: 'Ops', role: 'Operator' });

  const simpleTask = tuc.create({ employeeId: e.id, goal: '查询' });
  assert.equal(simpleTask.id ? true : false, true);
  assert.equal(e.childAgents.length, 0);

  const complexTask = tuc.create({ employeeId: e.id, goal: '先整理今日报表并输出复盘方案' });
  assert.equal(complexTask.id ? true : false, true);
  assert.equal(e.childAgents.length, 1);
  const createdEvents = store.events.filter((event) => event.type === 'task.created');
  const simpleEvent = createdEvents.find((event) => (event.payload || {}).taskId === simpleTask.id);
  const complexEvent = createdEvents.find((event) => (event.payload || {}).taskId === complexTask.id);
  assert.equal(Boolean(simpleEvent && simpleEvent.payload && simpleEvent.payload.childAgentPlanned), false);
  assert.equal(Boolean(complexEvent && complexEvent.payload && complexEvent.payload.childAgentPlanned), true);
  assert.deepEqual((simpleTask.childAgentPlan || {}).reasons || [], []);
  assert.ok(Array.isArray((complexTask.childAgentPlan || {}).reasons));
  assert.ok((complexTask.childAgentPlan || {}).reasons.length >= 1);
  assert.ok(Array.isArray((complexEvent.payload || {}).childAgentReasons));
  assert.ok(((complexEvent.payload || {}).childAgentReasons || []).length >= 1);
});

test('skill sedimentation skip event is emitted before repeated success threshold', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    async executeTask() {
      return {
        status: 'succeeded',
        result: 'runtime ok',
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId: 'rt-sediment-1',
        runtimeEvents: [],
        source: 'openclaw'
      };
    }
  };
  const tuc = new TaskUseCases(store, executionGateway, null, {
    dialogueGateway: {
      isEnabled: () => true,
      async generateReply() {
        return '任务处理完成，已进入复盘和技能沉淀判断。';
      }
    }
  });
  const e = euc.create({ name: 'Ops-Sediment', creator: 'u-sediment', department: 'Ops', role: 'Operator' });
  const t = tuc.create({ employeeId: e.id, goal: 'AAAAA' });
  await tuc.tick();

  const skipped = store.events.find((event) => (
    event.type === 'skill.sedimentation.skipped'
    && (event.payload || {}).taskId === t.id
  ));
  assert.ok(skipped);
  assert.equal((skipped.payload || {}).reason, 'model_confidence_too_low');
});

test('external write action must reject duplicated idempotency key', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-ERP', creator: 'u-erp', department: 'Finance', role: 'Operator' });

  const first = tuc.create({
    employeeId: e.id,
    goal: 'Create ERP invoice',
    externalWrite: {
      system: 'erp',
      operation: 'invoice.create',
      resource: 'invoice',
      idempotencyKey: 'erp-invoice-001'
    }
  });
  assert.equal(first.externalWrite.idempotencyKey, 'erp-invoice-001');

  assert.throws(
    () => tuc.create({
      employeeId: e.id,
      goal: 'Create ERP invoice duplicate',
      externalWrite: {
        system: 'erp',
        operation: 'invoice.create',
        resource: 'invoice',
        idempotencyKey: 'erp-invoice-001'
      }
    }),
    /idempotency key already exists/i
  );
});

test('rollback queues compensation task for external write action', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const e = euc.create({ name: 'Ops-Comp', creator: 'u-comp', department: 'Finance', role: 'Operator' });

  const t = tuc.create({
    employeeId: e.id,
    goal: 'Update ERP payment status',
    externalWrite: {
      system: 'erp',
      operation: 'payment.update',
      resource: 'payment',
      idempotencyKey: 'erp-payment-7788',
      compensation: {
        action: 'payment.revert'
      }
    }
  });

  tuc.rollback(t.id, 'manual rollback drill', { userId: 'u-ops-1', role: 'ops_admin' });
  assert.equal(t.status, 'rolled_back');
  assert.ok(t.compensation);
  assert.equal(t.compensation.status, 'queued');
  assert.equal(t.compensation.action, 'payment.revert');

  const compensationQueued = store.events.find((event) => (
    event.type === 'integration.compensation.queued'
    && (event.payload || {}).task_id === t.id
  ));
  assert.ok(compensationQueued);
});

test('manual rollback is rejected when recovery chain is disabled', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store, null, null, {
    recoveryChainEnabled: false
  });
  const e = euc.create({ name: 'Ops-Disabled', creator: 'u-disabled', department: 'Finance', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: 'Attempt rollback when disabled'
  });
  assert.throws(
    () => tuc.rollback(t.id, 'manual rollback drill'),
    /task recovery chain is disabled/i
  );
});

test('queued compensation can be executed by enterprise gateway', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const enterpriseGateway = {
    isEnabled: () => true,
    executeCompensation: async ({ compensation, task }) => ({
      status: 'succeeded',
      result: {
        referenceId: `${task.id}-comp-ok`,
        action: compensation.action
      }
    })
  };
  const tuc = new TaskUseCases(store, null, enterpriseGateway);
  const e = euc.create({ name: 'Ops-CompExec', creator: 'u-comp-exec', department: 'Finance', role: 'Operator' });

  const t = tuc.create({
    employeeId: e.id,
    goal: 'Create external write then rollback',
    externalWrite: {
      system: 'erp',
      operation: 'invoice.create',
      idempotencyKey: 'erp-invoice-comp-exec-1',
      compensation: {
        action: 'invoice.cancel'
      }
    }
  });
  tuc.rollback(t.id, 'manual rollback');
  assert.equal(t.compensation.status, 'queued');

  await tuc.processCompensations();
  assert.equal(t.compensation.status, 'succeeded');
  assert.ok(t.compensation.result);

  const compensationDone = store.events.find((event) => (
    event.type === 'integration.compensation.succeeded'
    && (event.payload || {}).task_id === t.id
  ));
  assert.ok(compensationDone);
});

test('compensation retries then moves to dead letter after max attempts', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const enterpriseGateway = {
    isEnabled: () => true,
    executeCompensation: async () => ({
      status: 'failed',
      error: { message: 'erp temporary unavailable' }
    })
  };
  const tuc = new TaskUseCases(store, null, enterpriseGateway, {
    compensationMaxAttempts: 2,
    compensationBackoffMs: 1
  });
  const e = euc.create({ name: 'Ops-CompDLQ', creator: 'u-comp-dlq', department: 'Finance', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: 'Create external write and fail compensation',
    externalWrite: {
      system: 'erp',
      operation: 'invoice.create',
      idempotencyKey: 'erp-invoice-comp-dlq-1',
      compensation: { action: 'invoice.cancel' }
    }
  });
  tuc.rollback(t.id, 'rollback for dead letter test');

  await tuc.processCompensations();
  assert.equal(t.compensation.status, 'queued');
  assert.equal(t.compensation.attempts, 1);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await tuc.processCompensations();
  assert.equal(t.compensation.status, 'dead_letter');
  assert.ok(t.compensation.deadLetterAt);

  const deadLetterEvent = store.events.find((event) => (
    event.type === 'integration.compensation.dead_lettered'
    && (event.payload || {}).task_id === t.id
  ));
  assert.ok(deadLetterEvent);
});

test('admin manual retry can requeue dead-letter compensation', async () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  let shouldSucceed = false;
  const enterpriseGateway = {
    isEnabled: () => true,
    executeCompensation: async () => (
      shouldSucceed
        ? { status: 'succeeded', result: { referenceId: 'comp-ok' } }
        : { status: 'failed', error: { message: 'still failing' } }
    )
  };
  const tuc = new TaskUseCases(store, null, enterpriseGateway, {
    compensationMaxAttempts: 1,
    compensationBackoffMs: 1
  });
  const e = euc.create({ name: 'Ops-CompRetry', creator: 'u-comp-retry', department: 'Finance', role: 'Operator' });
  const t = tuc.create({
    employeeId: e.id,
    goal: 'manual retry compensation',
    externalWrite: {
      system: 'erp',
      operation: 'payment.update',
      idempotencyKey: 'erp-payment-retry-1',
      compensation: { action: 'payment.revert' }
    }
  });
  tuc.rollback(t.id, 'rollback for retry');
  await tuc.processCompensations();
  assert.equal(t.compensation.status, 'dead_letter');

  const retried = tuc.retryCompensation(t.id, { userId: 'u-ops-1', role: 'ops_admin' });
  assert.equal(retried.compensation.status, 'queued');
  shouldSucceed = true;
  await tuc.processCompensations();
  assert.equal(t.compensation.status, 'succeeded');
});

test('task create stores conversation history for runtime context', () => {
  const store = new InMemoryStore();
  const euc = new EmployeeUseCases(store);
  const tuc = new TaskUseCases(store);
  const employee = euc.create({
    name: 'Ops-History',
    creator: 'u-history',
    department: 'Ops',
    role: 'Operator'
  });

  const first = tuc.create({
    employeeId: employee.id,
    goal: '第一轮：先总结昨日异常',
    conversationId: 'conv-history-1',
    requestChannel: 'front'
  });
  tuc.appendMessage({
    employeeId: employee.id,
    conversationId: 'conv-history-1',
    taskId: first.id,
    role: 'assistant',
    content: '第一轮回复：我已按模块整理异常。'
  });

  const second = tuc.create({
    employeeId: employee.id,
    goal: '第二轮：继续，给出今天优先级',
    conversationId: 'conv-history-1',
    requestChannel: 'front'
  });

  assert.ok(second.dialogueContext);
  assert.ok(Array.isArray(second.dialogueContext.history));
  assert.equal(second.dialogueContext.history.length >= 3, true);
  assert.equal(second.dialogueContext.history.some((item) => (
    item.role === 'assistant' && String(item.content).includes('第一轮回复')
  )), true);
  assert.equal(second.dialogueContext.history.some((item) => (
    item.role === 'user' && String(item.content).includes('第二轮：继续')
  )), true);
});
