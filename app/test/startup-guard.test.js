const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureLlmStartupReadiness,
  ensureOpenClawSecurityReadiness,
  ensureProductionStartupReadiness,
  ensureOpenClawRuntimeReadiness
} = require('../src/shared/startupGuards');

test('startup guard allows non-strict mode without llm credentials', () => {
  assert.doesNotThrow(() => ensureLlmStartupReadiness({
    REQUIRE_LLM_RESPONSE: '0'
  }));
});

test('startup guard rejects strict mode when no llm credentials exist', () => {
  assert.throws(
    () => ensureLlmStartupReadiness({
      REQUIRE_LLM_RESPONSE: '1'
    }),
    /REQUIRE_LLM_RESPONSE=1 but no model credentials found/
  );
});

test('startup guard allows strict mode with direct llm key or runtime bridge', () => {
  assert.doesNotThrow(() => ensureLlmStartupReadiness({
    REQUIRE_LLM_RESPONSE: '1',
    OPENAI_API_KEY: 'sk-test'
  }));

  assert.doesNotThrow(() => ensureLlmStartupReadiness({
    REQUIRE_LLM_RESPONSE: '1',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    OPENCLAW_API_KEY: 'runtime-token'
  }));
});

test('production startup guard is no-op outside production', () => {
  assert.doesNotThrow(() => ensureProductionStartupReadiness({
    NODE_ENV: 'development',
    DB_DRIVER: 'memory'
  }));
});

test('production startup guard rejects memory db driver', () => {
  assert.throws(
    () => ensureProductionStartupReadiness({
      NODE_ENV: 'production',
      DB_DRIVER: 'memory',
      AUTH_PASSWORD_PEPPER: 'pepper-1',
      CORS_ALLOW_ORIGIN: 'https://admin.example.com'
    }),
    /forbids DB_DRIVER=memory/
  );
});

test('production startup guard requires password pepper', () => {
  assert.throws(
    () => ensureProductionStartupReadiness({
      NODE_ENV: 'production',
      DB_DRIVER: 'sqlite',
      CORS_ALLOW_ORIGIN: 'https://admin.example.com'
    }),
    /requires AUTH_PASSWORD_PEPPER/
  );
});

test('production startup guard passes with persistent db and pepper', () => {
  assert.doesNotThrow(() => ensureProductionStartupReadiness({
    NODE_ENV: 'production',
    DB_DRIVER: 'postgres',
    AUTH_PASSWORD_PEPPER: 'pepper-1',
    CORS_ALLOW_ORIGIN: 'https://admin.example.com'
  }));
});

test('production startup guard rejects wildcard cors origin', () => {
  assert.throws(
    () => ensureProductionStartupReadiness({
      NODE_ENV: 'production',
      DB_DRIVER: 'sqlite',
      AUTH_PASSWORD_PEPPER: 'pepper-1',
      CORS_ALLOW_ORIGIN: '*'
    }),
    /requires explicit CORS_ALLOW_ORIGIN/
  );
});

test('openclaw guard treats self-hosted alias as openclaw and requires base url', () => {
  assert.throws(() => ensureOpenClawSecurityReadiness({
    EXECUTION_ENGINE: 'self_hosted'
  }), /requires OPENCLAW_BASE_URL/);
});

test('openclaw guard treats skills runtime alias as openclaw and validates URL', () => {
  assert.throws(() => ensureOpenClawSecurityReadiness({
    EXECUTION_ENGINE: 'skills_runtime',
    OPENCLAW_BASE_URL: 'not-a-valid-url'
  }), /must be a valid URL/);
});

test('openclaw guard validates host allowlist and auth', () => {
  assert.throws(
    () => ensureOpenClawSecurityReadiness({
      EXECUTION_ENGINE: 'openclaw',
      OPENCLAW_BASE_URL: 'http://10.0.0.1:18789',
      OPENCLAW_ALLOWED_HOSTS: '127.0.0.1,localhost',
      OPENCLAW_REQUIRE_AUTH: '1',
      OPENCLAW_API_KEY: 'token'
    }),
    /host is not in OPENCLAW_ALLOWED_HOSTS/
  );

  assert.throws(
    () => ensureOpenClawSecurityReadiness({
      EXECUTION_ENGINE: 'openclaw',
      OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
      OPENCLAW_ALLOWED_HOSTS: '127.0.0.1,localhost',
      OPENCLAW_REQUIRE_AUTH: '1'
    }),
    /OpenClaw auth required/
  );
});

test('openclaw guard does not require auth when OPENCLAW_REQUIRE_AUTH is unset', () => {
  assert.doesNotThrow(() => ensureOpenClawSecurityReadiness({
    EXECUTION_ENGINE: 'openclaw',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    OPENCLAW_ALLOWED_HOSTS: '127.0.0.1,localhost'
  }));
});

test('openclaw guard allows wildcard host allowlist for broad runtime connectivity', () => {
  assert.doesNotThrow(() => ensureOpenClawSecurityReadiness({
    EXECUTION_ENGINE: 'openclaw',
    OPENCLAW_BASE_URL: 'https://openclaw.public.example.com',
    OPENCLAW_ALLOWED_HOSTS: '*',
    OPENCLAW_REQUIRE_AUTH: '1',
    OPENCLAW_API_KEY: 'token'
  }));
});

test('openclaw guard enforces production TLS and sandbox profile', () => {
  assert.throws(
    () => ensureOpenClawSecurityReadiness({
      NODE_ENV: 'production',
      EXECUTION_ENGINE: 'openclaw',
      OPENCLAW_BASE_URL: 'http://openclaw.internal.example.com',
      OPENCLAW_ALLOWED_HOSTS: 'openclaw.internal.example.com',
      OPENCLAW_REQUIRE_AUTH: '1',
      OPENCLAW_API_KEY: 'token',
      OPENCLAW_SANDBOX_PROFILE: 'strict'
    }),
    /requires HTTPS/
  );

  assert.throws(
    () => ensureOpenClawSecurityReadiness({
      NODE_ENV: 'production',
      EXECUTION_ENGINE: 'openclaw',
      OPENCLAW_BASE_URL: 'https://openclaw.internal.example.com',
      OPENCLAW_ALLOWED_HOSTS: 'openclaw.internal.example.com',
      OPENCLAW_REQUIRE_AUTH: '1',
      OPENCLAW_API_KEY: 'token',
      OPENCLAW_SANDBOX_PROFILE: 'standard'
    }),
    /must be strict or hardened/
  );

  assert.doesNotThrow(() => ensureOpenClawSecurityReadiness({
    NODE_ENV: 'production',
    EXECUTION_ENGINE: 'openclaw',
    OPENCLAW_BASE_URL: 'https://openclaw.internal.example.com',
    OPENCLAW_ALLOWED_HOSTS: 'openclaw.internal.example.com',
    OPENCLAW_REQUIRE_AUTH: '1',
    OPENCLAW_API_KEY: 'token',
    OPENCLAW_SANDBOX_PROFILE: 'hardened'
  }));
});

test('openclaw runtime readiness validates health + ready catalog + find-skills', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/health')) {
      return { ok: true, status: 200 };
    }
    if (String(url).includes('/api/skills?status=ready')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            items: [
              { slug: 'find-skills', status: 'ready' },
              { slug: 'office-automation', status: 'ready' }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected: ${url}`);
  };
  await assert.doesNotReject(() => ensureOpenClawRuntimeReadiness({
    EXECUTION_ENGINE: 'openclaw',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    OPENCLAW_API_KEY: 'token',
    OPENCLAW_SKILLS_LIST_PATHS: '/api/skills'
  }, { fetchImpl }));
  assert.equal(calls.some((item) => item.endsWith('/health')), true);
  assert.equal(calls.some((item) => item.includes('/api/skills?status=ready')), true);
});

test('openclaw runtime readiness rejects missing required find-skills', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) return { ok: true, status: 200 };
    return {
      ok: true,
      status: 200,
      async json() {
        return { items: [{ slug: 'office-automation', status: 'ready' }] };
      }
    };
  };
  await assert.rejects(
    () => ensureOpenClawRuntimeReadiness({
      EXECUTION_ENGINE: 'openclaw',
      OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
      OPENCLAW_API_KEY: 'token',
      OPENCLAW_SKILLS_LIST_PATHS: '/api/skills',
      OPENCLAW_REQUIRE_FIND_SKILLS: '1'
    }, { fetchImpl }),
    /required ready skill "find-skills" is missing/
  );
});

test('openclaw runtime readiness falls back to cli probe when http catalog is unavailable', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) return { ok: true, status: 200 };
    return {
      ok: true,
      status: 200,
      async json() {
        return '<html>control ui</html>';
      }
    };
  };
  const runCliCommand = async () => ({
    ok: true,
    exitCode: 0,
    stdout: [
      'Skills (2/50 ready)',
      '│ ✓ ready   │ find-skills      │ desc │ source │',
      '│ ✓ ready   │ weather          │ desc │ source │'
    ].join('\n'),
    stderr: '',
    error: ''
  });
  await assert.doesNotReject(() => ensureOpenClawRuntimeReadiness({
    EXECUTION_ENGINE: 'openclaw',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    OPENCLAW_API_KEY: 'token',
    OPENCLAW_SKILLS_LIST_PATHS: '/api/skills',
    OPENCLAW_REQUIRE_FIND_SKILLS: '1'
  }, { fetchImpl, runCliCommand }));
});

test('openclaw runtime readiness retries transient health failures before succeeding', async () => {
  let healthCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) {
      healthCalls += 1;
      if (healthCalls === 1) throw new Error('fetch failed');
      return { ok: true, status: 200 };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { items: [{ slug: 'find-skills', status: 'ready' }] };
      }
    };
  };
  const sleepImpl = async () => {};
  await assert.doesNotReject(() => ensureOpenClawRuntimeReadiness({
    EXECUTION_ENGINE: 'openclaw',
    OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
    OPENCLAW_API_KEY: 'token',
    OPENCLAW_SKILLS_LIST_PATHS: '/api/skills',
    OPENCLAW_RUNTIME_READINESS_RETRIES: '3',
    OPENCLAW_RUNTIME_READINESS_RETRY_DELAY_MS: '1'
  }, { fetchImpl, sleepImpl }));
  assert.equal(healthCalls, 2);
});

test('openclaw runtime readiness fails after retry budget is exhausted', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/health')) throw new Error('fetch failed');
    return { ok: false, status: 503 };
  };
  const sleepImpl = async () => {};
  await assert.rejects(
    () => ensureOpenClawRuntimeReadiness({
      EXECUTION_ENGINE: 'openclaw',
      OPENCLAW_BASE_URL: 'http://127.0.0.1:18789',
      OPENCLAW_API_KEY: 'token',
      OPENCLAW_RUNTIME_READINESS_RETRIES: '2',
      OPENCLAW_RUNTIME_READINESS_RETRY_DELAY_MS: '1'
    }, { fetchImpl, sleepImpl }),
    /after 2 attempts/
  );
});
