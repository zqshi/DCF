const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

function createEmployee(store) {
  const employee = {
    id: 'emp-orch-1',
    employeeCode: 'DE-9999',
    agentType: 'parent',
    parentEmployeeId: null,
    name: 'Orch Tester',
    tenantId: 'tenant-1',
    accountId: 'account-1',
    creator: 'u-orch',
    department: 'OPS',
    role: 'Operator',
    riskLevel: 'L2',
    jobPolicy: {
      allow: [],
      deny: [],
      strictAllow: false,
      allowedDepartments: [],
      allowedRoles: [],
      maxRiskLevel: null,
      kpi: [],
      escalationRule: '',
      shutdownRule: ''
    },
    approvalPolicy: {
      byRisk: {
        L1: { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false },
        L2: { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false },
        L3: { requiredApprovals: 0, requiredAnyRoles: [], distinctRoles: false },
        L4: { requiredApprovals: 2, requiredAnyRoles: ['auditor', 'super_admin'], distinctRoles: true }
      }
    },
    openclawProfile: {
      agentId: 'dcf-agent-9999',
      systemPrompt: 'test',
      toolScope: [],
      sessionKey: null
    },
    retrievalPolicy: { mode: 'inherit' },
    status: 'active',
    knowledge: [],
    capabilities: ['general-ops'],
    childAgents: [],
    linkedSkillIds: [],
    createdAt: new Date().toISOString()
  };
  store.employees.push(employee);
  return employee;
}

test('task create emits orchestration routes when v2 enabled', () => {
  const previous = process.env.AGENT_ORCHESTRATION_V2_ENABLED;
  process.env.AGENT_ORCHESTRATION_V2_ENABLED = '1';

  const store = new InMemoryStore();
  const employee = createEmployee(store);
  const taskUC = new TaskUseCases(store, null, null, {});

  const task = taskUC.create({
    employeeId: employee.id,
    goal: '并行处理巡检、复盘和报告'
  });

  assert.ok(Array.isArray(task.subAgentRoutes));
  assert.equal(task.subAgentRoutes.length, 3);
  assert.ok(store.events.some((item) => item.type === 'agent.route.decided'));

  process.env.AGENT_ORCHESTRATION_V2_ENABLED = previous;
});
