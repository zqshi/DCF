const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenClawGateway } = require('../src/infrastructure/integrations/OpenClawGateway');
const { RuntimeErrorCodes } = require('../src/shared/runtime/RuntimeErrorCodes');

function mkTask() {
  return {
    id: 'task-1',
    goal: 'finish report',
    riskLevel: 'L2',
    iteration: 1,
    conversationId: 'thread-1',
    llmConfig: {
      model: 'anthropic/claude-opus-4-6',
      thinkingLevel: 'high',
      toolPolicy: 'balanced'
    },
    openclaw: {
      agentId: 'ops-agent',
      extraSystemPrompt: '优先输出可执行步骤。',
      toolScope: ['bash', 'read', 'write'],
      policyId: 'policy-ops-l2'
    },
    attachments: [{
      type: 'image',
      name: 'capture.png',
      mimeType: 'image/png',
      content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    }]
  };
}

function mkEmployee() {
  return {
    id: 'emp-1',
    employeeCode: 'DE-0001',
    role: 'Operator',
    department: 'OPS'
  };
}

test('openclaw gateway uses hardened timeout defaults', () => {
  const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
  assert.equal(gw.timeoutMs, 15000);
  assert.equal(gw.runtimePollIntervalMs, 500);
  assert.equal(gw.runtimeMaxPolls, 300);
});

test('openclaw gateway defaults to unrestricted auth and omits sandbox header when unset', () => {
  const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001' });
  const headers = gw.securityHeaders();
  assert.equal(gw.requireAuth, false);
  assert.equal(Object.prototype.hasOwnProperty.call(headers, 'X-OpenClaw-Sandbox-Profile'), false);
});

test('openclaw gateway runtime skill commands support OPENCLAW_CLI_ENTRY invocation', async () => {
  const calls = [];
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: false,
    openclawCliEntry: '/tmp/openclaw.mjs',
    commandRunner: async (bin, args) => {
      calls.push({ bin, args });
      return { ok: true, exitCode: 0, stdout: 'ok', stderr: '', error: '' };
    }
  });

  const out = await gw.runtimeSkillCommand('info', { slug: 'find-skills' });
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, process.execPath);
  assert.deepEqual(calls[0].args, ['/tmp/openclaw.mjs', 'skills', 'info', 'find-skills']);
});

test('openclaw gateway can provision a dedicated agent workspace synchronously', () => {
  const calls = [];
  const tmpWorkspace = `/tmp/dcf-openclaw-workspace-${Date.now()}`;
  const tmpAgentDir = `/tmp/dcf-openclaw-agent-${Date.now()}`;
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: false,
    commandRunnerSync: (bin, args) => {
      calls.push({ bin, args });
      return { ok: true, exitCode: 0, stdout: 'ok', stderr: '', error: '' };
    }
  });

  const out = gw.provisionEmployeeRuntimeSync({
    agentId: 'dcf-emp-0001',
    workspacePath: tmpWorkspace,
    agentDir: tmpAgentDir
  });

  assert.equal(out.agentId, 'dcf-emp-0001');
  assert.equal(String(out.workspacePath || '').includes(tmpWorkspace), true);
  assert.equal(String(out.agentDir || '').includes(tmpAgentDir), true);
  assert.equal(Array.isArray(out.files), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes('agents'), true);
  assert.equal(calls[0].args.includes('add'), true);
});

test('openclaw gateway runtime file APIs read and write workspace docs', () => {
  const workspace = `/tmp/dcf-openclaw-files-${Date.now()}`;
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: false,
    commandRunnerSync: () => ({ ok: true, exitCode: 0, stdout: 'ok', stderr: '', error: '' })
  });
  gw.provisionEmployeeRuntimeSync({
    agentId: 'dcf-emp-files-0001',
    workspacePath: workspace,
    agentDir: `${workspace}-agent`
  });

  const list = gw.listEmployeeRuntimeFilesSync({ workspacePath: workspace });
  assert.equal(Array.isArray(list.files), true);
  assert.equal(list.files.some((item) => item.name === 'AGENTS.md'), true);

  const write = gw.writeEmployeeRuntimeFileSync({
    workspacePath: workspace,
    fileName: 'AGENTS.md',
    content: '# AGENTS\n\nmanaged by test\n'
  });
  assert.equal(String(write.content || '').includes('managed by test'), true);

  const read = gw.readEmployeeRuntimeFileSync({
    workspacePath: workspace,
    fileName: 'AGENTS.md'
  });
  assert.equal(String(read.content || '').includes('managed by test'), true);
});

test('openclaw gateway treats existing agent as idempotent when cli returns message on stdout', () => {
  const workspace = `/tmp/dcf-openclaw-existing-${Date.now()}`;
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: false,
    commandRunnerSync: () => ({
      ok: false,
      exitCode: 1,
      stdout: 'agent already exists',
      stderr: '',
      error: 'non-zero exit'
    })
  });

  const out = gw.provisionEmployeeRuntimeSync({
    agentId: 'dcf-emp-existing-0001',
    workspacePath: workspace,
    agentDir: `${workspace}-agent`
  });
  assert.equal(out.agentId, 'dcf-emp-existing-0001');
  assert.equal(Array.isArray(out.files), true);
  assert.equal(out.files.length > 0, true);
});

test('openclaw gateway prefers runtime contract paths', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let submitBody = null;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      submitBody = JSON.parse(options.body || '{}');
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-1') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-1', status: 'succeeded', result: 'runtime-ok' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-1/events') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return [{ id: 'ev-1', type: 'task.running' }, { id: 'ev-2', type: 'task.succeeded' }];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'succeeded');
    assert.equal(result.result, 'runtime-ok');
    assert.equal(result.runtimeTaskId, 'rt-1');
    assert.equal(result.runtimeEvents.length, 3);
    assert.equal(submitBody.llmConfig.model, 'anthropic/claude-opus-4-6');
    assert.equal(submitBody.llmConfig.thinkingLevel, 'high');
    assert.equal(submitBody.agentId, 'ops-agent');
    assert.equal(String(submitBody.extraSystemPrompt || '').includes('优先输出可执行步骤。'), true);
    assert.equal(String(submitBody.extraSystemPrompt || '').includes('Language rule: reply in English by default'), true);
    assert.deepEqual(submitBody.toolScope, ['bash', 'read', 'write']);
    assert.equal(submitBody.policyId, 'policy-ops-l2');
    assert.equal(Array.isArray(submitBody.attachments), true);
    assert.equal(submitBody.attachments.length, 1);
    assert.equal(submitBody.attachments[0].type, 'image');
    const runtimeSubmitCall = calls.find((c) => c.url.endsWith('/runtime/tasks') && c.method === 'POST');
    assert.equal(runtimeSubmitCall.headers['X-Contract-Version'], 'v1');
    assert.equal(calls.some((c) => c.url.endsWith('/api/tasks/execute')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway forwards conversation history in runtime command', async () => {
  const originalFetch = global.fetch;
  let submitBody = null;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      submitBody = JSON.parse(options.body || '{}');
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-history-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-history-1') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-history-1', status: 'succeeded', result: 'ok' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-history-1/events') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return [];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
    const task = mkTask();
    task.dialogueContext = {
      history: [
        { role: 'user', content: '第一轮问题：请先总结异常来源。' },
        { role: 'assistant', content: '第一轮回复：我已整理异常来源。' }
      ]
    };
    const result = await gw.executeTask(task, mkEmployee());
    assert.equal(result.status, 'succeeded');
    assert.ok(Array.isArray(submitBody.conversationHistory));
    assert.equal(submitBody.conversationHistory.length, 2);
    assert.equal(String(submitBody.extraSystemPrompt || '').includes('同一会话最近消息'), true);
    assert.equal(String(submitBody.extraSystemPrompt || '').includes('第一轮问题'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway forwards employee runtime isolation context to payload and headers', async () => {
  const originalFetch = global.fetch;
  let submitBody = null;
  let submitHeaders = {};
  let submitUrl = '';
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      submitUrl = String(url);
      submitBody = JSON.parse(options.body || '{}');
      submitHeaders = options.headers || {};
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-routing-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-routing-1') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-routing-1', status: 'succeeded', result: 'ok' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-routing-1/events') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return [];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
    const task = mkTask();
    const employee = {
      ...mkEmployee(),
      runtimeProfile: {
        agentId: 'ops-agent-iso',
        runtimeBaseUrl: 'http://127.0.0.1:39001',
        workspacePath: '/tmp/openclaw/workspaces/emp-1',
        agentDir: '/tmp/openclaw/agents/emp-1'
      }
    };
    task.runtimeConfig = {
      ...task.runtimeConfig,
      agentId: 'ops-agent-iso'
    };
    const result = await gw.executeTask(task, employee);
    assert.equal(result.status, 'succeeded');
    assert.equal(submitUrl.startsWith('http://127.0.0.1:39001/'), true);
    assert.equal(submitBody.agentId, 'ops-agent-iso');
    assert.equal(submitBody.runtimeBaseUrl, 'http://127.0.0.1:39001');
    assert.equal(submitBody.workspacePath, '/tmp/openclaw/workspaces/emp-1');
    assert.equal(submitBody.agentDir, '/tmp/openclaw/agents/emp-1');
    assert.equal(submitHeaders['X-OpenClaw-Agent-Id'], 'ops-agent-iso');
    assert.equal(submitHeaders['X-OpenClaw-Workspace-Path'], '/tmp/openclaw/workspaces/emp-1');
    assert.equal(submitHeaders['X-OpenClaw-Agent-Dir'], '/tmp/openclaw/agents/emp-1');
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway fails fast when runtime contract unavailable in auto mode', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let legacyBody = null;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      return { ok: false, status: 404, async json() { return {}; } };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'failed');
    assert.match(String((result.error || {}).message || ''), /no execution outcome/i);
    assert.equal(calls.some((c) => c.url.endsWith('/runtime/tasks')), true);
    assert.equal(calls.some((c) => c.url.endsWith('/api/tasks/execute')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway polls runtime status and emits incremental runtime events', async () => {
  const originalFetch = global.fetch;
  const seenRuntimeEventIds = [];
  let statusCall = 0;
  let eventsCall = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-live-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-live-1') && (options.method || 'GET') === 'GET') {
      statusCall += 1;
      if (statusCall < 3) {
        return {
          ok: true,
          async json() {
            return { taskId: 'rt-live-1', status: 'running', result: null };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-live-1', status: 'succeeded', result: 'live-ok' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-live-1/events') && (options.method || 'GET') === 'GET') {
      eventsCall += 1;
      const bodies = [
        [{ id: 'ev-1', type: 'task.running' }],
        [{ id: 'ev-1', type: 'task.running' }, { id: 'ev-2', type: 'task.tool.called' }],
        [{ id: 'ev-1', type: 'task.running' }, { id: 'ev-2', type: 'task.tool.called' }, { id: 'ev-3', type: 'task.succeeded' }]
      ];
      return {
        ok: true,
        async json() {
          return bodies[Math.min(eventsCall - 1, bodies.length - 1)];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({
      baseUrl: 'http://127.0.0.1:3001',
      requireAuth: false,
      runtimePollIntervalMs: 0,
      runtimeMaxPolls: 5
    });
    const result = await gw.executeTask(mkTask(), mkEmployee(), {
      onRuntimeEvent(runtimeEvent) {
        seenRuntimeEventIds.push(runtimeEvent.id);
      }
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.result, 'live-ok');
    assert.equal(seenRuntimeEventIds.length, 4);
    assert.equal(seenRuntimeEventIds.slice(1).join(','), 'ev-1,ev-2,ev-3');
    assert.equal(result.runtimeEvents.length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway preserves aborted runtime status', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-abort-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-abort-1') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return {
            taskId: 'rt-abort-1',
            status: 'aborted',
            lastError: { severity: 'P2', message: 'This operation was aborted' }
          };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-abort-1/events') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return [{ id: 'ev-abort-1', type: 'task.aborted' }];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };
  try {
    const gw = new OpenClawGateway({
      baseUrl: 'http://127.0.0.1:3001',
      requireAuth: false,
      runtimePollIntervalMs: 0,
      runtimeMaxPolls: 2
    });
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'aborted');
    assert.equal(result.corrected, false);
    assert.equal(result.error.message, 'This operation was aborted');
    assert.equal(result.runtimeTaskId, 'rt-abort-1');
    assert.equal(result.runtimeEvents.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway enriches runtime events with audit fields', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-audit-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-audit-1') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-audit-1', status: 'succeeded', result: 'audit-ok' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-audit-1/events') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return [{ id: 'ev-audit-1', type: 'task.running', payload: {} }];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };
  try {
    const task = mkTask();
    task.traceId = 'trace-rt-audit';
    const employee = mkEmployee();
    employee.id = 'emp-audit';
    const gw = new OpenClawGateway({
      baseUrl: 'http://127.0.0.1:3001',
      requireAuth: false,
      runtimePollIntervalMs: 0,
      runtimeMaxPolls: 2
    });
    const result = await gw.executeTask(task, employee);
    assert.equal(result.status, 'succeeded');
    const runtimeEvent = result.runtimeEvents.find((item) => item.id === 'ev-audit-1');
    assert.equal(Boolean(runtimeEvent), true);
    assert.equal(runtimeEvent.payload.trace_id, 'trace-rt-audit');
    assert.equal(runtimeEvent.payload.task_id, 'rt-audit-1');
    assert.equal(runtimeEvent.payload.employee_id, 'emp-audit');
    assert.equal(typeof runtimeEvent.payload.timestamp, 'string');
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway sends configured contract version header', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-v2' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-v2') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-v2', status: 'succeeded', result: 'ok-v2' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-v2/events') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return [];
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', contractVersion: 'v2', requireAuth: false });
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'succeeded');
    const runtimeCalls = calls.filter((c) => c.url.includes('/runtime/tasks'));
    assert.equal(runtimeCalls.length >= 2, true);
    assert.equal(runtimeCalls.every((c) => c.headers['X-Contract-Version'] === 'v2'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway does not fallback to legacy when contract version mismatches', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      return {
        ok: false,
        status: 409,
        async json() {
          return {
            code: RuntimeErrorCodes.CONTRACT_VERSION_MISMATCH,
            expected: 'v1',
            actual: 'v2'
          };
        }
      };
    }
    throw new Error(`unexpected call: ${url}`);
  };

  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', contractVersion: 'v2', requireAuth: false });
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'failed');
    assert.equal(result.corrected, false);
    assert.equal(String(result.error && result.error.message || '').includes('version mismatch'), true);
    assert.equal(calls.some((c) => c.url.endsWith('/api/tasks/execute')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway returns failed outcome on transport error', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('fetch failed');
  };
  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'failed');
    assert.match(String((result.error || {}).message || ''), /fetch failed/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway enforces auth when required', async () => {
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: true,
    apiKey: '',
    gatewayToken: ''
  });
  await assert.rejects(
    () => gw.executeTask(mkTask(), mkEmployee()),
    /OpenClaw auth is required/
  );
});

test('openclaw gateway rejects host outside allowed list', async () => {
  const gw = new OpenClawGateway({
    baseUrl: 'http://10.10.10.10:3001',
    requireAuth: false,
    allowedHosts: '127.0.0.1,localhost'
  });
  await assert.rejects(
    () => gw.executeTask(mkTask(), mkEmployee()),
    /host is not allowed/
  );
});

test('openclaw gateway accepts wildcard host allowlist', async () => {
  const gw = new OpenClawGateway({
    baseUrl: 'https://runtime.public.example.com',
    requireAuth: false,
    allowedHosts: '*'
  });
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('fetch failed');
  };
  try {
    const result = await gw.executeTask(mkTask(), mkEmployee());
    assert.equal(result.status, 'failed');
    assert.match(String((result.error || {}).message || ''), /fetch failed/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway sanitizes tool scope using allow and deny lists', async () => {
  const originalFetch = global.fetch;
  let submitBody = null;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/runtime/tasks') && (options.method || 'GET') === 'POST') {
      submitBody = JSON.parse(options.body || '{}');
      return {
        ok: true,
        async json() {
          return { accepted: true, runtimeTaskId: 'rt-safe-1' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-safe-1') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        async json() {
          return { taskId: 'rt-safe-1', status: 'succeeded', result: 'safe-ok' };
        }
      };
    }
    if (String(url).endsWith('/runtime/tasks/rt-safe-1/events') && (options.method || 'GET') === 'GET') {
      return { ok: true, async json() { return []; } };
    }
    throw new Error(`unexpected call: ${url}`);
  };
  try {
    const gw = new OpenClawGateway({
      baseUrl: 'http://127.0.0.1:3001',
      requireAuth: false,
      allowedTools: 'read,write,search,test',
      deniedTools: 'browser,bash'
    });
    const task = mkTask();
    task.openclaw.toolScope = ['read', 'browser', 'bash', 'test'];
    const result = await gw.executeTask(task, mkEmployee());
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(submitBody.toolScope, ['read', 'test']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway enforces policyId for L4 tasks', async () => {
  const gw = new OpenClawGateway({
    baseUrl: 'http://127.0.0.1:3001',
    requireAuth: false,
    enforcePolicyForL4: true
  });
  const task = mkTask();
  task.riskLevel = 'L4';
  task.openclaw.policyId = '';
  await assert.rejects(
    () => gw.executeTask(task, mkEmployee()),
    /L4 task requires openclaw policyId/
  );
});

test('openclaw gateway abortTask calls runtime abort endpoint', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/runtime/tasks/rt-abort-path/abort') && (options.method || 'GET') === 'POST') {
      return { ok: true, async json() { return { ok: true, status: 'aborted' }; } };
    }
    throw new Error(`unexpected call: ${url}`);
  };
  try {
    const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
    const task = mkTask();
    task.runtime = { taskId: 'rt-abort-path', source: 'openclaw', events: [] };
    const result = await gw.abortTask(task, mkEmployee());
    assert.equal(result.ok, true);
    assert.equal(result.status, 'aborted');
    assert.equal(calls.some((item) => item.url.endsWith('/runtime/tasks/rt-abort-path/abort')), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('openclaw gateway abortTask fails when runtime task id is missing', async () => {
  const gw = new OpenClawGateway({ baseUrl: 'http://127.0.0.1:3001', requireAuth: false });
  const result = await gw.abortTask(mkTask(), mkEmployee());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RUNTIME_TASK_ID_MISSING');
});
