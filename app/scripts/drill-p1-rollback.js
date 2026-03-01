#!/usr/bin/env node
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

async function main() {
  const store = new InMemoryStore();
  const employeeUC = new EmployeeUseCases(store);
  const executionGateway = {
    isEnabled: () => true,
    executeTask: async () => ({
      status: 'failed',
      result: null,
      error: {
        code: 'COMPLIANCE_DRILL_P1',
        message: 'P1 rollback drill',
        severity: 'P1'
      },
      source: 'drill'
    })
  };
  const taskUC = new TaskUseCases(store, executionGateway);

  const employee = employeeUC.create({
    employeeCode: 'EMP-DRILL-001',
    name: 'Rollback Drill Employee',
    email: 'drill@example.com',
    creator: 'qa-owner',
    department: 'Governance',
    role: 'Risk Analyst'
  });
  const task = taskUC.create({
    employeeId: employee.id,
    goal: 'Trigger P1 rollback drill',
    riskLevel: 'L2',
    traceId: 'trace-drill-p1'
  });
  await taskUC.tick();

  const updatedTask = store.tasks.find((x) => x.id === task.id);
  const events = store.events.filter((x) => (x.payload || {}).task_id === task.id);
  const rollbackTriggered = events.some((x) => x.type === 'task.rollback.triggered');
  const rolledBack = events.some((x) => x.type === 'task.rolled_back');
  const passed = Boolean(
    updatedTask
    && updatedTask.status === 'rolled_back'
    && updatedTask.rollback
    && updatedTask.rollback.mode === 'auto'
    && rollbackTriggered
    && rolledBack
  );

  const summary = {
    ok: passed,
    taskId: task.id,
    finalStatus: updatedTask ? updatedTask.status : null,
    rollbackMode: updatedTask && updatedTask.rollback ? updatedTask.rollback.mode : null,
    events: events.map((x) => x.type)
  };

  if (!passed) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
