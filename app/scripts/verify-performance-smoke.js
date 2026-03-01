#!/usr/bin/env node
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');
const { TaskUseCases } = require('../src/application/usecases/TaskUseCases');

function parseArgs(argv = process.argv.slice(2)) {
  let tasks = Number(process.env.PERF_SMOKE_TASKS || 120);
  let maxMs = Number(process.env.PERF_SMOKE_MAX_MS || 8000);
  for (const arg of argv) {
    if (arg.startsWith('--tasks=')) tasks = Number(arg.slice('--tasks='.length));
    if (arg.startsWith('--max-ms=')) maxMs = Number(arg.slice('--max-ms='.length));
  }
  if (!Number.isFinite(tasks) || tasks <= 0) tasks = 120;
  if (!Number.isFinite(maxMs) || maxMs <= 0) maxMs = 8000;
  return { tasks: Math.floor(tasks), maxMs: Math.floor(maxMs) };
}

async function main() {
  const { tasks, maxMs } = parseArgs();
  const store = new InMemoryStore();
  const employeeUC = new EmployeeUseCases(store);
  const taskUC = new TaskUseCases(store);

  const employee = employeeUC.create({
    employeeCode: 'EMP-PERF-001',
    name: 'Perf Checker',
    email: 'perf@example.com',
    creator: 'qa-perf',
    department: 'Ops',
    role: 'Operator'
  });

  const startedAt = Date.now();
  for (let i = 0; i < tasks; i += 1) {
    taskUC.create({
      employeeId: employee.id,
      goal: `perf smoke task #${i + 1}`
    });
  }
  await taskUC.tick();
  const elapsedMs = Date.now() - startedAt;

  if (elapsedMs > maxMs) {
    console.error(JSON.stringify({
      ok: false,
      reason: 'perf-smoke-threshold-exceeded',
      elapsedMs,
      maxMs,
      tasks
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    elapsedMs,
    maxMs,
    tasks,
    events: store.events.length,
    succeededTasks: store.metrics.succeededTasks,
    failedTasks: store.metrics.failedTasks
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
