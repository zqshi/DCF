const test = require('node:test');
const assert = require('node:assert/strict');
const { handleEmployeeManagementRoutes } = require('../src/interfaces/http/routes/adminCore/employeeManagementRoutes');

function createContext(pathname, method, body = {}) {
  const calls = [];
  const ucCalls = [];
  return {
    calls,
    ucCalls,
    context: {
      req: { headers: {} },
      res: {},
      url: new URL(`http://127.0.0.1${pathname}`),
      json(_res, status, payload) {
        calls.push({ status, payload });
      },
      async parseBody() {
        return body;
      },
      currentSession() {
        return {
          user: {
            id: 'admin-user',
            tenantId: 'tenant-default',
            accountId: 'account-default'
          }
        };
      },
      adminUC: {},
      employeeUC: {
        listRuntimeFiles(employeeId, accessContext) {
          ucCalls.push({ method: 'listRuntimeFiles', employeeId, accessContext });
          return { employeeId, files: [] };
        },
        getRuntimeFile(employeeId, fileName, accessContext) {
          ucCalls.push({ method: 'getRuntimeFile', employeeId, fileName, accessContext });
          return { employeeId, fileName, content: '# AGENTS.md' };
        },
        updateRuntimeFile(employeeId, fileName, content, actorId, accessContext) {
          ucCalls.push({ method: 'updateRuntimeFile', employeeId, fileName, content, actorId, accessContext });
          return { employeeId, fileName, content, actorId };
        },
        provisionRuntime(employeeId, actorId, accessContext) {
          ucCalls.push({ method: 'provisionRuntime', employeeId, actorId, accessContext });
          return { employeeId, actorId, status: 'ready' };
        }
      }
    }
  };
}

test('admin route supports runtime files list endpoint', async () => {
  const { calls, ucCalls, context } = createContext('/api/admin/employees/emp-1/runtime-files', 'GET');
  context.req.method = 'GET';
  const handled = await handleEmployeeManagementRoutes(context);
  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].payload.employeeId, 'emp-1');
  assert.deepEqual(ucCalls[0].accessContext, {
    tenantId: 'tenant-default',
    accountId: 'account-default',
    actorUserId: null
  });
});

test('admin route supports runtime file read endpoint', async () => {
  const { calls, ucCalls, context } = createContext('/api/admin/employees/emp-1/runtime-files/AGENTS.md', 'GET');
  context.req.method = 'GET';
  const handled = await handleEmployeeManagementRoutes(context);
  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].payload.fileName, 'AGENTS.md');
  assert.deepEqual(ucCalls[0].accessContext, {
    tenantId: 'tenant-default',
    accountId: 'account-default',
    actorUserId: null
  });
});

test('admin route supports runtime file update endpoint', async () => {
  const { calls, ucCalls, context } = createContext('/api/admin/employees/emp-1/runtime-files/AGENTS.md', 'PUT', {
    content: '# AGENTS.md\n\nupdated'
  });
  context.req.method = 'PUT';
  const handled = await handleEmployeeManagementRoutes(context);
  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].payload.fileName, 'AGENTS.md');
  assert.equal(String(calls[0].payload.content || '').includes('updated'), true);
  assert.deepEqual(ucCalls[0].accessContext, {
    tenantId: 'tenant-default',
    accountId: 'account-default',
    actorUserId: null
  });
});

test('admin route supports runtime reprovision endpoint', async () => {
  const { calls, ucCalls, context } = createContext('/api/admin/employees/emp-1/runtime-provision', 'POST', {});
  context.req.method = 'POST';
  const handled = await handleEmployeeManagementRoutes(context);
  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.equal(calls[0].payload.status, 'ready');
  assert.deepEqual(ucCalls[0].accessContext, {
    tenantId: 'tenant-default',
    accountId: 'account-default',
    actorUserId: null
  });
});
