const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');

function makeAccessContext() {
  return {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-a'
  };
}

test('employee create provisions dedicated runtime workspace when enabled', () => {
  const store = new InMemoryStore();
  const calls = [];
  const employeeUC = new EmployeeUseCases(store, {
    runtimeProvisioningEnabled: true,
    runtimeWorkspaceRoot: '/tmp/dcf-runtime-workspaces',
    runtimeAgentStateRoot: '/tmp/dcf-runtime-agents',
    runtimeBaseUrlTemplate: 'http://127.0.0.1:3900/{tenantId}/{accountId}/{employeeId}',
    provisioningGateway: {
      provisionEmployeeRuntimeSync(input) {
        calls.push(input);
        return {
          agentId: input.agentId,
          workspacePath: input.workspacePath,
          agentDir: input.agentDir
        };
      }
    }
  });

  const created = employeeUC.create({
    name: 'Ops-Provisioned',
    department: 'Ops',
    role: 'Operator'
  }, makeAccessContext());

  assert.equal(store.employees.length, 1);
  assert.equal(calls.length, 1);
  assert.equal((created.runtimeProfile || {}).provisionStatus, 'ready');
  assert.equal((created.openclawProfile || {}).provisionStatus, 'ready');
  assert.equal(((created.runtimeProfile || {}).runtimeBaseUrl || '').includes('/tenant-a/account-a/'), true);
  assert.ok(String((created.runtimeProfile || {}).workspacePath || '').includes('/tmp/dcf-runtime-workspaces/tenant-a/account-a/'));
  assert.ok(String((created.runtimeProfile || {}).agentDir || '').includes('/tmp/dcf-runtime-agents/tenant-a/account-a/'));
});

test('employee create aborts when runtime provisioning fails', () => {
  const store = new InMemoryStore();
  const employeeUC = new EmployeeUseCases(store, {
    runtimeProvisioningEnabled: true,
    provisioningGateway: {
      provisionEmployeeRuntimeSync() {
        throw new Error('provision failed');
      }
    }
  });

  assert.throws(() => {
    employeeUC.create({
      name: 'Ops-Provision-Failed',
      department: 'Ops',
      role: 'Operator'
    }, makeAccessContext());
  }, /provision failed/i);

  assert.equal(store.employees.length, 0);
});

test('employee runtime files can be listed/read/updated via usecase', () => {
  const store = new InMemoryStore();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-employee-runtime-'));
  const workspaceRoot = path.join(tmpRoot, 'workspaces');
  const agentRoot = path.join(tmpRoot, 'agents');
  const employeeUC = new EmployeeUseCases(store, {
    runtimeProvisioningEnabled: true,
    runtimeWorkspaceRoot: workspaceRoot,
    runtimeAgentStateRoot: agentRoot,
    provisioningGateway: {
      provisionEmployeeRuntimeSync(input) {
        fs.mkdirSync(input.workspacePath, { recursive: true });
        fs.mkdirSync(input.agentDir, { recursive: true });
        fs.writeFileSync(path.join(input.workspacePath, 'AGENTS.md'), '# AGENTS\n', 'utf8');
        fs.writeFileSync(path.join(input.workspacePath, 'SOUL.md'), '# SOUL\n', 'utf8');
        fs.writeFileSync(path.join(input.workspacePath, 'TOOLS.md'), '# TOOLS\n', 'utf8');
        fs.writeFileSync(path.join(input.workspacePath, 'USER.md'), '# USER\n', 'utf8');
        return {
          agentId: input.agentId,
          workspacePath: input.workspacePath,
          agentDir: input.agentDir
        };
      }
    }
  });

  const created = employeeUC.create({
    name: 'Ops-Runtime-Files',
    department: 'Ops',
    role: 'Operator'
  }, makeAccessContext());

  const listed = employeeUC.listRuntimeFiles(created.id, makeAccessContext());
  assert.equal(listed.files.some((item) => item.name === 'AGENTS.md' && item.exists), true);

  const before = employeeUC.getRuntimeFile(created.id, 'AGENTS.md', makeAccessContext());
  assert.equal(String(before.content || '').includes('# AGENTS'), true);

  const updated = employeeUC.updateRuntimeFile(created.id, 'AGENTS.md', '# AGENTS\n\nupdated\n', 'admin', makeAccessContext());
  assert.equal(String(updated.content || '').includes('updated'), true);

  const after = employeeUC.getRuntimeFile(created.id, 'AGENTS.md', makeAccessContext());
  assert.equal(String(after.content || '').includes('updated'), true);
});
