const { execFile } = require('child_process');
const { resolveOpenClawCliInvocation } = require('./openclawCli');

function isEnabled(value) {
  return String(value || '').trim() === '1';
}

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function isProduction(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function parseList(raw) {
  return Array.from(new Set(
    String(raw || '')
      .split(',')
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

function parseExecutionEngine(env = process.env) {
  const engine = String(env.EXECUTION_ENGINE || 'auto').trim().toLowerCase();
  if (engine === 'openclaw') return 'openclaw';
  if (engine === 'self_hosted' || engine === 'self-hosted') return 'openclaw';
  if (engine === 'skills_runtime' || engine === 'skills-runtime') return 'openclaw';
  return 'auto';
}

function ensureLlmStartupReadiness(env = process.env) {
  const strictLlm = isEnabled(env.REQUIRE_LLM_RESPONSE);
  if (!strictLlm) return;

  const hasDirectLlmKey = hasValue(env.OPENAI_API_KEY) || hasValue(env.LLM_API_KEY);
  const hasRuntimeBridge = hasValue(env.OPENCLAW_BASE_URL)
    && (hasValue(env.OPENCLAW_API_KEY) || hasValue(env.OPENCLAW_GATEWAY_TOKEN));

  if (hasDirectLlmKey || hasRuntimeBridge) return;

  throw new Error(
    'REQUIRE_LLM_RESPONSE=1 but no model credentials found. ' +
    'Set OPENAI_API_KEY/LLM_API_KEY, or configure OPENCLAW_BASE_URL with OPENCLAW_API_KEY (or OPENCLAW_GATEWAY_TOKEN).'
  );
}

function ensureOpenClawSecurityReadiness(env = process.env) {
  const engine = parseExecutionEngine(env);
  if (!['openclaw', 'auto'].includes(engine)) return;

  const baseUrl = String(env.OPENCLAW_BASE_URL || '').trim();
  if (!baseUrl) {
    if (engine === 'openclaw') throw new Error('EXECUTION_ENGINE=openclaw requires OPENCLAW_BASE_URL');
    return;
  }

  let parsed = null;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('OPENCLAW_BASE_URL must be a valid URL');
  }

  const host = String(parsed.hostname || '').trim().toLowerCase();
  const scheme = String(parsed.protocol || '').replace(':', '').toLowerCase();
  const allowedHosts = parseList(env.OPENCLAW_ALLOWED_HOSTS || '*');
  if (allowedHosts.length > 0 && !allowedHosts.includes('*') && !allowedHosts.includes(host)) {
    throw new Error(`OPENCLAW_BASE_URL host is not in OPENCLAW_ALLOWED_HOSTS: ${host}`);
  }

  const requireAuth = String(env.OPENCLAW_REQUIRE_AUTH || '0').trim() !== '0';
  const hasAuth = hasValue(env.OPENCLAW_API_KEY) || hasValue(env.OPENCLAW_GATEWAY_TOKEN) || hasValue(env.OPENCLAW_API_KEY_FILE);
  if (requireAuth && !hasAuth) {
    throw new Error('OpenClaw auth required: set OPENCLAW_API_KEY, OPENCLAW_GATEWAY_TOKEN or OPENCLAW_API_KEY_FILE');
  }

  if (isProduction(env)) {
    const isLoopback = host === '127.0.0.1' || host === 'localhost';
    if (!isLoopback && scheme !== 'https') {
      throw new Error('Production OpenClaw bridge requires HTTPS for non-loopback OPENCLAW_BASE_URL');
    }
    if (!hasValue(env.OPENCLAW_SANDBOX_PROFILE)) {
      throw new Error('Production OpenClaw bridge requires OPENCLAW_SANDBOX_PROFILE');
    }
    const mode = String(env.OPENCLAW_SANDBOX_PROFILE || '').trim().toLowerCase();
    if (!['strict', 'hardened'].includes(mode)) {
      throw new Error('OPENCLAW_SANDBOX_PROFILE must be strict or hardened in production');
    }
  }
}

function ensureProductionStartupReadiness(env = process.env) {
  if (!isProduction(env)) return;

  if (String(env.DB_DRIVER || '').trim().toLowerCase() === 'memory') {
    throw new Error('NODE_ENV=production forbids DB_DRIVER=memory. Use sqlite or postgres.');
  }

  if (!hasValue(env.AUTH_PASSWORD_PEPPER)) {
    throw new Error('NODE_ENV=production requires AUTH_PASSWORD_PEPPER for password hashing hardening.');
  }

  const corsAllowOrigin = String(env.CORS_ALLOW_ORIGIN || '').trim();
  if (!corsAllowOrigin || corsAllowOrigin === '*') {
    throw new Error('NODE_ENV=production requires explicit CORS_ALLOW_ORIGIN (wildcard is forbidden).');
  }
}

function parseSkillsListPaths(env = process.env) {
  const raw = String(
    env.OPENCLAW_SKILLS_LIST_PATHS
    || env.OPENCLAW_SKILLS_LIST_PATH
    || '/api/skills,/api/v1/skills,/skills'
  );
  const paths = raw
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('/') ? item : `/${item}`));
  return paths.length ? Array.from(new Set(paths)) : ['/api/skills'];
}

function extractSkillItems(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.skills)) return body.skills;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data)) return body.data;
  if (body.data && typeof body.data === 'object') {
    if (Array.isArray(body.data.skills)) return body.data.skills;
    if (Array.isArray(body.data.items)) return body.data.items;
  }
  return [];
}

function isReadySkill(item) {
  const row = item && typeof item === 'object' ? item : {};
  const slug = String(row.slug || row.name || row.id || row.skillSlug || '').trim().toLowerCase();
  const status = String(row.status || row.state || 'ready').trim().toLowerCase();
  return {
    slug,
    ready: !status || ['ready', 'active', 'enabled'].includes(status)
  };
}

function parseReadySkillsFromCliOutput(raw = '') {
  const text = String(raw || '');
  const readySkills = new Set();
  const tableRow = /[|│]\s*✓\s*ready\s*[|│]\s*[^|│]*?\s([a-z0-9][a-z0-9._-]*)\s*[|│]/ig;
  let match = tableRow.exec(text);
  while (match) {
    const slug = String(match[1] || '').trim().toLowerCase();
    if (slug) readySkills.add(slug);
    match = tableRow.exec(text);
  }
  const countMatch = text.match(/Skills\s*\((\d+)\s*\/\s*\d+\s*ready\)/i);
  const readyCount = countMatch ? Number(countMatch[1]) : 0;
  return {
    readySkills: Array.from(readySkills),
    readyCount: Number.isFinite(readyCount) ? readyCount : 0
  };
}

function defaultCliRunner(bin, args = [], options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 60000) || 60000);
  return new Promise((resolve) => {
    execFile(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env
    }, (error, stdout, stderr) => {
      const exitCode = error && Number.isFinite(Number(error.code)) ? Number(error.code) : 0;
      resolve({
        ok: !error,
        exitCode,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error ? String(error.message || 'cli failed') : ''
      });
    });
  });
}

async function probeReadySkillsViaCli(env = process.env, options = {}) {
  const runCli = options.runCliCommand || defaultCliRunner;
  const invocation = resolveOpenClawCliInvocation(env, options);
  const listArgs = []
    .concat(Array.isArray(invocation.argsPrefix) ? invocation.argsPrefix : [])
    .concat(['skills', 'list']);
  const list = await runCli(invocation.bin, listArgs, { timeoutMs: 60000 });
  if (!list || !list.ok) {
    return {
      ok: false,
      reason: String((list && (list.error || list.stderr)) || 'cli list failed').slice(0, 300)
    };
  }
  const output = `${String(list.stdout || '')}\n${String(list.stderr || '')}`;
  const parsed = parseReadySkillsFromCliOutput(output);
  if (!parsed.readySkills.includes('find-skills')) {
    const infoArgs = []
      .concat(Array.isArray(invocation.argsPrefix) ? invocation.argsPrefix : [])
      .concat(['skills', 'info', 'find-skills']);
    const info = await runCli(invocation.bin, infoArgs, { timeoutMs: 60000 });
    const infoText = `${String((info && info.stdout) || '')}\n${String((info && info.stderr) || '')}`.toLowerCase();
    const findSkillsReady = Boolean(info && info.ok && infoText.includes('find-skills') && infoText.includes('ready'));
    if (findSkillsReady) parsed.readySkills.push('find-skills');
  }
  return {
    ok: true,
    readyCount: parsed.readyCount,
    readySkills: parsed.readySkills
  };
}

async function ensureOpenClawRuntimeReadiness(env = process.env, options = {}) {
  const engine = parseExecutionEngine(env);
  if (!['openclaw', 'auto'].includes(engine)) return;
  const strictStartup = String(env.OPENCLAW_RUNTIME_STRICT_STARTUP || '1').trim() !== '0';
  if (!strictStartup) return;

  const baseUrl = String(env.OPENCLAW_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('OpenClaw runtime readiness check requires OPENCLAW_BASE_URL');
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is not available for runtime readiness check');
  const sleepImpl = options.sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retriesRaw = Number(env.OPENCLAW_RUNTIME_READINESS_RETRIES || 6);
  const delayRaw = Number(env.OPENCLAW_RUNTIME_READINESS_RETRY_DELAY_MS || 800);
  const maxAttempts = Number.isFinite(retriesRaw) && retriesRaw > 0 ? Math.floor(retriesRaw) : 1;
  const retryDelayMs = Number.isFinite(delayRaw) && delayRaw >= 0 ? Math.floor(delayRaw) : 0;

  const headers = {};
  const apiKey = String(env.OPENCLAW_API_KEY || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const gatewayToken = String(env.OPENCLAW_GATEWAY_TOKEN || '').trim();
  if (!apiKey && gatewayToken) headers['X-Gateway-Token'] = gatewayToken;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const healthRes = await fetchImpl(`${baseUrl}/health`, { method: 'GET', headers });
      if (!healthRes || !healthRes.ok) {
        const status = healthRes && Number.isFinite(Number(healthRes.status)) ? Number(healthRes.status) : 'network_error';
        throw new Error(`OpenClaw runtime readiness check failed at /health (${status})`);
      }

      const skillsListPaths = parseSkillsListPaths(env);
      const requireFindSkills = String(env.OPENCLAW_REQUIRE_FIND_SKILLS || '1').trim() !== '0';
      let readySkills = [];
      let lastStatus = 0;
      for (const skillPath of skillsListPaths) {
        const query = skillPath.includes('?') ? '&status=ready' : '?status=ready';
        const res = await fetchImpl(`${baseUrl}${skillPath}${query}`, { method: 'GET', headers });
        if (!res || !res.ok) {
          lastStatus = Number(res && res.status) || 0;
          continue;
        }
        const contentType = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
        if (contentType.includes('text/html')) continue;
        const body = await res.json().catch(() => ({}));
        readySkills = extractSkillItems(body)
          .map((item) => isReadySkill(item))
          .filter((item) => item.slug && item.ready);
        break;
      }

      if (!readySkills.length) {
        const cliProbe = await probeReadySkillsViaCli(env, options);
        if (cliProbe.ok && Number(cliProbe.readyCount || 0) > 0) {
          readySkills = Array.from(new Set(
            (cliProbe.readySkills || [])
              .map((slug) => String(slug || '').trim().toLowerCase())
              .filter(Boolean)
          )).map((slug) => ({ slug, ready: true }));
        }
      }

      if (!readySkills.length) {
        const runtimeHealthRes = await fetchImpl(`${baseUrl}/runtime/health`, { method: 'GET', headers }).catch(() => null);
        if (runtimeHealthRes && runtimeHealthRes.ok) {
          const runtimeHealth = await runtimeHealthRes.json().catch(() => ({}));
          if (runtimeHealth && runtimeHealth.ok && runtimeHealth.service) {
            return;
          }
        }
        throw new Error(
          `OpenClaw runtime readiness check failed: no ready skills discovered from catalog paths (${lastStatus || 'network_error'})`
        );
      }
      if (requireFindSkills && !readySkills.some((item) => item.slug === 'find-skills')) {
        const runtimeHealthRes = await fetchImpl(`${baseUrl}/runtime/health`, { method: 'GET', headers }).catch(() => null);
        if (runtimeHealthRes && runtimeHealthRes.ok) {
          const runtimeHealth = await runtimeHealthRes.json().catch(() => ({}));
          if (runtimeHealth && runtimeHealth.ok && runtimeHealth.service) {
            return;
          }
        }
        throw new Error('OpenClaw runtime readiness check failed: required ready skill "find-skills" is missing');
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      if (retryDelayMs > 0) await sleepImpl(retryDelayMs);
    }
  }
  if (lastError) {
    throw new Error(`${String(lastError.message || lastError)} (after ${maxAttempts} attempts)`);
  }
}

module.exports = {
  ensureLlmStartupReadiness,
  ensureOpenClawSecurityReadiness,
  ensureProductionStartupReadiness,
  ensureOpenClawRuntimeReadiness
};
