const http = require('http');
const fs = require('fs');
const path = require('path');
const { json, parseBody, parseBinaryBody, serveStatic, parseCookies, setCookie, clearCookie, buildCorsHeaders } = require('../../shared/http');
const {
  NAV_ITEMS,
  API_ACL_RULES,
  API_MATRIX_EXTRA_RULES,
  PAGE_ACL,
  ACTION_ACL,
  resolveApiPermission,
  resolvePagePermission
} = require('../../shared/adminAcl');
const { rewriteApiV1Request } = require('./apiVersioning');
const { startRuntimeLoops } = require('./runtimeLoopScheduler');
const { handleAuthRoutes } = require('./routes/authRoutes');
const { handleFrontRoutes } = require('./routes/frontRoutes');
const { handleAdminCoreRoutes } = require('./routes/adminCoreRoutes');
const { handleRegistryRoutes } = require('./routes/registryRoutes');
const { handleObservabilityRoutes } = require('./routes/observabilityRoutes');
const { handleStaticRoutes } = require('./routes/staticRoutes');
const { createStoreFromEnv } = require('../../infrastructure/repositories/StoreFactory');
const { GitHubSearchGateway } = require('../../infrastructure/integrations/GitHubSearchGateway');
const { ExecutionGateway } = require('../../infrastructure/integrations/ExecutionGateway');
const { EnterpriseSystemGateway } = require('../../infrastructure/integrations/EnterpriseSystemGateway');
const { LlmDialogueGateway } = require('../../infrastructure/integrations/LlmDialogueGateway');
const { McpServiceHealthGateway } = require('../../infrastructure/integrations/McpServiceHealthGateway');
const { SsoBridgeGateway } = require('../../infrastructure/integrations/SsoBridgeGateway');
const { KnowledgeSsoBridgeGateway } = require('../../infrastructure/integrations/KnowledgeSsoBridgeGateway');
const { SkillBundleArchiveGateway } = require('../../infrastructure/integrations/SkillBundleArchiveGateway');
const { WeKnoraGateway } = require('../../infrastructure/integrations/WeKnoraGateway');
const { WebRetrievalGateway } = require('../../infrastructure/integrations/WebRetrievalGateway');
const { EmployeeUseCases } = require('../../application/usecases/EmployeeUseCases');
const { ConversationUseCases } = require('../../application/usecases/ConversationUseCases');
const { MessageUseCases } = require('../../application/usecases/MessageUseCases');
const { TaskUseCases } = require('../../application/usecases/TaskUseCases');
const { FrontDispatchUseCases } = require('../../application/usecases/FrontDispatchUseCases');
const { SkillUseCases } = require('../../application/usecases/SkillUseCases');
const { ToolUseCases } = require('../../application/usecases/ToolUseCases');
const { OssUseCases } = require('../../application/usecases/OssUseCases');
const { KnowledgeUseCases } = require('../../application/usecases/KnowledgeUseCases');
const { KnowledgeSedimentationUseCases } = require('../../application/usecases/KnowledgeSedimentationUseCases');
const { SubscriptionUseCases } = require('../../application/usecases/SubscriptionUseCases');
const { OssDecisionUseCases } = require('../../application/usecases/OssDecisionUseCases');
const { AdminUseCases } = require('../../application/usecases/AdminUseCases');
const { BootstrapUseCases } = require('../../application/usecases/BootstrapUseCases');
const { AuthUseCases } = require('../../application/usecases/AuthUseCases');
const { handleAdminToolsRoutes } = require('./routes/adminToolsRoutes');
const { buildHttpAuditPayload } = require('./auditLog');
const { logger } = require('../../shared/logger');
const { createRateLimiter } = require('../../shared/rateLimiter');

function captureLoopError(store, loopName, error) {
  const message = String((error && error.message) || error || 'unknown background loop error');
  logger.error('background loop error', { loopName, error: message });
  if (!store || typeof store.addEvent !== 'function') return;
  try {
    store.addEvent('runtime.loop.error', {
      traceId: null,
      taskId: null,
      employeeId: null,
      loopName: String(loopName || 'unknown'),
      message: message.slice(0, 500)
    });
  } catch {}
}

function parseCommaList(input) {
  return String(input || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function addUniqueModel(models, model) {
  const value = String(model || '').trim();
  if (!value || models.includes(value)) return;
  models.push(value);
}

function isOpenClawAliasModel(model) {
  return /^openclaw:/i.test(String(model || '').trim());
}

function readOpenClawConfiguredModel() {
  const projectRoot = path.join(__dirname, '..', '..', '..', '..');
  const configPath = String(process.env.OPENCLAW_CONFIG_PATH || '')
    .trim() || path.join(projectRoot, 'runtime', 'openclaw', '.openclaw-state', 'dcf-openclaw.json');
  try {
    if (!fs.existsSync(configPath)) return '';
    const raw = fs.readFileSync(configPath, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      return String(
        (((parsed || {}).plugins || {}).entries || {})['dcf-runtime']?.config?.responseModel || ''
      ).trim();
    } catch {
      // Allow reading JSON5/object-literal style configs used by local OpenClaw bootstrap.
      const match = raw.match(/responseModel\s*:\s*["']([^"']+)["']/);
      return String((match && match[1]) || '').trim();
    }
  } catch {
    return '';
  }
}

function resolveFrontConfiguredModels(dialogueGateway) {
  const models = [];
  const aliasModels = [];
  for (const model of parseCommaList(process.env.FRONT_LLM_MODELS || process.env.OPENAI_MODELS || process.env.LLM_MODELS)) {
    if (isOpenClawAliasModel(model)) addUniqueModel(aliasModels, model);
    else addUniqueModel(models, model);
  }
  const directModels = [
    process.env.OPENAI_MODEL,
    process.env.LLM_MODEL,
    process.env.OPENCLAW_MODEL,
    process.env.OPENCLAW_RESPONSE_MODEL,
    readOpenClawConfiguredModel(),
    dialogueGateway && dialogueGateway.model
  ];
  for (const model of directModels) {
    if (isOpenClawAliasModel(model)) addUniqueModel(aliasModels, model);
    else addUniqueModel(models, model);
  }
  // Prefer actual provider models (e.g. deepseek-chat) and avoid exposing gateway alias models.
  if (models.length === 0 && aliasModels.length > 0) {
    addUniqueModel(models, process.env.LLM_MODEL || process.env.OPENAI_MODEL);
  }
  addUniqueModel(models, 'gpt-4.1-mini');
  return models;
}

async function createApp() {
  const { store, driver, close } = await createStoreFromEnv();
  if (store && typeof store.syncEventSeq === 'function') store.syncEventSeq();
  const executionGateway = new ExecutionGateway({
    skillsRuntimeOptions: {
      getAvailableSkills: () => (Array.isArray(store.skills) ? store.skills : [])
    }
  });
  const enterpriseGateway = new EnterpriseSystemGateway();
  const dialogueGateway = new LlmDialogueGateway();
  const runtimeProvisioningEnabled = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test'
    ? false
    : ['1', 'true', 'on', 'yes'].includes(
      String(
        process.env.EMPLOYEE_RUNTIME_PROVISIONING_ENABLED
        || '0'
      ).trim().toLowerCase()
    );
  const employeeUC = new EmployeeUseCases(store, {
    dialogueGateway,
    runtimeProvisioningEnabled,
    provisioningGateway: executionGateway.openclawRuntime
  });
  const conversationUC = new ConversationUseCases(store);
  const messageUC = new MessageUseCases(store);
  const ossDecisionUC = new OssDecisionUseCases(store, new GitHubSearchGateway(), { dialogueGateway });
  const knowledgeUC = new KnowledgeUseCases(store, new WeKnoraGateway());
  const knowledgeSedimentationUC = new KnowledgeSedimentationUseCases(store, knowledgeUC, {
    dialogueGateway
  });
  const recoveryChainEnabled = String(
    process.env.TASK_RECOVERY_CHAIN_ENABLED || (process.env.NODE_ENV === 'test' ? '1' : '0')
  ).trim() === '1';
  const taskUC = new TaskUseCases(store, executionGateway, enterpriseGateway, {
    dialogueGateway,
    ossDecisionUseCases: ossDecisionUC,
    knowledgeSedimentationUseCases: knowledgeSedimentationUC,
    shadowPolicyProvider: () => adminUC.getRuntimeShadowPolicy(),
    recoveryChainEnabled,
    employeeUseCases: employeeUC
  });
  const skillUC = new SkillUseCases(store, {
    bundleImporter: new SkillBundleArchiveGateway()
  });
  const toolUC = new ToolUseCases(store, {
    healthGateway: new McpServiceHealthGateway()
  });
  const ossUC = new OssUseCases(store, new GitHubSearchGateway());
  const subscriptionUC = new SubscriptionUseCases(store, new WebRetrievalGateway(), {
    dialogueGateway
  });
  const adminUC = new AdminUseCases(store);
  const bootstrapUC = new BootstrapUseCases(store);
  const authUC = new AuthUseCases();
  const frontDispatchUC = new FrontDispatchUseCases({
    store,
    employeeUC,
    conversationUC,
    messageUC,
    taskUC,
    dialogueGateway
  });
  const ssoGateway = new SsoBridgeGateway();
  const knowledgeSsoBridgeGateway = new KnowledgeSsoBridgeGateway();
  const publicDir = path.join(__dirname, '..', '..', '..', 'public');
  const authCookieName = 'dcf_admin_session';
  const secureCookie = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const pageLabelByPath = NAV_ITEMS.reduce((acc, item) => {
    if (!item || !item.path) return acc;
    if (!acc[item.path]) acc[item.path] = item.label || item.path;
    return acc;
  }, {});

  const framework = {
    name: 'Digital Employee OS Bootstrap',
    engines: {
      execution: (() => {
        if (!executionGateway.isEnabled()) return 'Execution Runtime (required, unavailable)';
        const label = executionGateway.providerLabel();
        if (label === 'skills-runtime') return 'Skills Runtime (integrated)';
        if (label === 'self-hosted-runtime') return 'Self-hosted Runtime (integrated)';
        return 'Managed Runtime (integrated)';
      })(),
      orchestration: 'AgentScope (adapter-ready)',
      enterpriseIntegration: enterpriseGateway.isEnabled() ? 'EnterpriseSystemGateway (enabled)' : 'EnterpriseSystemGateway (disabled)'
    },
    architecture: 'DDD-lite + TDD',
    storage: driver,
    productSurfaces: ['front-stage', 'back-office'],
    loop: 'task -> evaluate -> correct -> skillize -> rerun',
    status: 'running'
  };
  const frontConfiguredModels = resolveFrontConfiguredModels(dialogueGateway);

  const stopRuntimeLoops = startRuntimeLoops({
    taskUC,
    ossUC,
    subscriptionUC,
    bootstrapUC,
    store,
    captureLoopError
  });

  function currentSession(req) {
    const cookies = parseCookies(req);
    return authUC.getSession(cookies[authCookieName] || '');
  }

  function requireAdminAuth(req, res, permission) {
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '未登录或会话已过期' });
      return null;
    }
    if (permission && !authUC.canAccess(session.user, permission)) {
      json(res, 403, { error: '无权限访问该资源', permission });
      return null;
    }
    return session;
  }

  function allowedFrontApprovalRoles(user) {
    if (!user || !user.role) return [];
    if (user.role === 'super_admin') return ['ops_admin', 'auditor'];
    if (user.role === 'ops_owner' || user.role === 'ops_admin') return ['ops_admin'];
    if (user.role === 'auditor') return ['auditor'];
    return [];
  }

  function allowedFrontRejectRoles(user) {
    if (!user || !user.role) return [];
    if (user.role === 'super_admin') return ['ops_admin'];
    if (user.role === 'ops_owner' || user.role === 'ops_admin') return ['ops_admin'];
    return [];
  }

  function buildRuntimeStatusPayload() {
    const bootstrap = bootstrapUC.getStatus();
    const retrievalPolicy = adminUC.getRetrievalPolicy();
    const skillSedimentationPolicy = adminUC.getSkillSedimentationPolicy();
    const knowledgeSedimentationPolicy = adminUC.getKnowledgeSedimentationPolicy();
    const retrievalMetrics = (store.metrics && store.metrics.retrieval && typeof store.metrics.retrieval === 'object')
      ? store.metrics.retrieval
      : {
        busyDecisions: 0,
        idleDecisions: 0,
        internalTools: 0,
        platformContext: 0,
        externalSearch: 0,
        skippedExternal: 0,
        queuedExternal: 0
      };
    const sedimentMetrics = (store.metrics && store.metrics.skillSedimentation && typeof store.metrics.skillSedimentation === 'object')
      ? store.metrics.skillSedimentation
      : {
        directCreated: 0,
        proposalCreated: 0,
        skipped: 0
      };
    const knowledgeSedimentMetrics = (store.metrics && store.metrics.knowledgeSedimentation && typeof store.metrics.knowledgeSedimentation === 'object')
      ? store.metrics.knowledgeSedimentation
      : {
        autoPublished: 0,
        queuedForReview: 0,
        rejected: 0,
        reviewedApproved: 0,
        reviewedRejected: 0,
        skippedDisabled: 0,
        deduplicated: 0
      };
    const shadowPolicy = adminUC.getRuntimeShadowPolicy();
    const shadowEvents = Array.isArray(store.events)
      ? store.events.filter((event) => String((event && event.type) || '').startsWith('runtime.shadow.'))
      : [];
    const shadowCompared = shadowEvents.filter((event) => String((event && event.type) || '') === 'runtime.shadow.compared');
    const shadowSkipped = shadowEvents.filter((event) => String((event && event.type) || '') === 'runtime.shadow.skipped');
    const shadowFailed = shadowEvents.filter((event) => String((event && event.type) || '') === 'runtime.shadow.failed');
    const shadowAvgScore = shadowCompared.length > 0
      ? Number((
        shadowCompared.reduce((sum, event) => {
          const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
          const overall = Number((((payload.diff || {}).scores || {}).overall) || 0);
          return sum + (Number.isFinite(overall) ? overall : 0);
        }, 0) / shadowCompared.length
      ).toFixed(3))
      : 0;
    return {
      storage: driver,
      runtimeEnabled: executionGateway.isEnabled(),
      runtimeProvider: executionGateway.providerLabel(),
      recoveryChainEnabled: taskUC.isRecoveryChainEnabled(),
      bootstrap: {
        phase: bootstrap.phase,
        mode: bootstrap.mode,
        cycleCount: bootstrap.cycleCount,
        stagnantCycles: bootstrap.stagnantCycles,
        manualReviewRequired: bootstrap.manualReviewRequired
      },
      queue: {
        researchQueued: store.researchQueue.filter((x) => x.status === 'queued').length,
        researchDone: store.researchQueue.filter((x) => x.status === 'done').length
      },
      counters: {
        employees: store.employees.length,
        conversations: Array.isArray(store.conversations) ? store.conversations.length : 0,
        messages: Array.isArray(store.messages) ? store.messages.length : 0,
        tasks: store.tasks.length,
        skills: store.skills.length,
        findings: store.ossFindings.length,
        events: store.events.length,
        knowledgeCandidates: Array.isArray(store.knowledgeCandidates) ? store.knowledgeCandidates.length : 0,
        knowledgeReviewQueue: Array.isArray(store.knowledgeReviewQueue) ? store.knowledgeReviewQueue.length : 0
      },
      llm: {
        dialogueEnabled: dialogueGateway.isEnabled(),
        model: dialogueGateway.model || null
      },
      retrievalPolicy,
      skillSedimentationPolicy,
      knowledgeSedimentationPolicy,
      retrieval: retrievalMetrics,
      skillSedimentationMetrics: sedimentMetrics,
      knowledgeSedimentationMetrics: knowledgeSedimentMetrics,
      runtimeShadow: {
        enabled: shadowPolicy.enabled,
        targetEngine: shadowPolicy.targetEngine,
        allowTenants: shadowPolicy.allowTenants,
        allowRoles: shadowPolicy.allowRoles,
        comparedCount: shadowCompared.length,
        skippedCount: shadowSkipped.length,
        failedCount: shadowFailed.length,
        averageOverallScore: shadowAvgScore
      },
      now: new Date().toISOString()
    };
  }

  function buildPermissionMatrix(permissions = []) {
    const matrixApiRules = [...API_ACL_RULES, ...API_MATRIX_EXTRA_RULES];
    const permissionSet = new Set(
      Array.isArray(permissions)
        ? permissions.map((x) => String(x || '').trim()).filter(Boolean)
        : []
    );
    for (const item of PAGE_ACL) {
      if (item && item.permission) permissionSet.add(String(item.permission));
    }
    for (const item of matrixApiRules) {
      if (item && item.permission) permissionSet.add(String(item.permission));
    }
    for (const item of ACTION_ACL) {
      if (item && item.permission) permissionSet.add(String(item.permission));
    }
    const permissionList = Array.from(permissionSet)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return permissionList.map((permission) => {
      const pages = PAGE_ACL
        .filter((item) => item.permission === permission)
        .map((item) => ({
          path: item.path,
          label: pageLabelByPath[item.path] || item.path
        }));
      const apis = matrixApiRules
        .filter((item) => item.permission === permission)
        .map((item) => ({
          method: item.method,
          path: item.exact || item.prefix || item.template || '',
          match: item.exact ? 'exact' : (item.prefix ? 'prefix' : 'template')
        }));
      const actions = ACTION_ACL
        .filter((item) => item.permission === permission)
        .map((item) => ({
          id: item.id,
          label: item.label,
          page: item.page,
          scope: item.scope,
          risk: item.risk
        }));
      return { permission, pages, apis, actions };
    });
  }

  function addAuditEvent(eventType, req, session, payload = {}) {
    if (!store || typeof store.addEvent !== 'function') return null;
    return store.addEvent(eventType, buildHttpAuditPayload({
      req,
      session,
      eventType,
      payload
    }));
  }

  const rateLimitRpm = Number(process.env.API_RATE_LIMIT_RPM) || 60;
  const checkRateLimit = createRateLimiter(rateLimitRpm);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...buildCorsHeaders()
      });
      return res.end();
    }

    // Rate limit — skip health probes to avoid K8s false-positive restarts
    if (!req.url.startsWith('/api/health')) {
      if (checkRateLimit(req, res)) return;
    }

    const rewritten = rewriteApiV1Request(req.url, res);
    if (rewritten.rewritten) req.url = rewritten.url;
    const url = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (await handleAuthRoutes({
        req,
        res,
        url,
        json,
        parseBody,
        currentSession,
        setCookie,
        clearCookie,
        authCookieName,
        secureCookie,
        authUC,
        ssoGateway,
        knowledgeSsoBridgeGateway,
        store,
        addAuditEvent,
        navItems: NAV_ITEMS
      })) return;

      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          now: new Date().toISOString()
        });
      }
      if (url.pathname === '/api/health/ready' && req.method === 'GET') {
        const checks = { runtime: false, postgres: false, lastPersist: true };
        checks.runtime = Boolean(executionGateway && typeof executionGateway.isEnabled === 'function' && executionGateway.isEnabled());
        if (store && store.driver === 'postgres') {
          try {
            await store.pool.query('SELECT 1');
            checks.postgres = true;
          } catch { checks.postgres = false; }
          checks.lastPersist = store.lastPersistOk !== false;
        } else {
          checks.postgres = true; // non-postgres driver, skip
        }
        const ready = checks.runtime && checks.postgres && checks.lastPersist;
        return json(res, ready ? 200 : 503, {
          ok: ready,
          now: new Date().toISOString(),
          checks,
          runtimeProvider: executionGateway.providerLabel()
        });
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/api/framework' && req.method === 'GET') return json(res, 200, framework);

      if (await handleRegistryRoutes({
        req,
        res,
        url,
        json,
        parseBody,
        toolUC,
        skillUC,
        store,
        addAuditEvent
      })) return;

      if (url.pathname.startsWith('/api/admin/')) {
        const permission = resolveApiPermission(url.pathname, req.method);
        if (!permission) return json(res, 404, { error: 'Not Found' });
        const session = requireAdminAuth(req, res, permission);
        if (!session) return;
      }

      if (await handleAdminCoreRoutes({
        req,
        res,
        url,
        json,
        parseBody,
        parseBinaryBody,
        currentSession,
        buildPermissionMatrix,
        buildRuntimeStatusPayload,
        authUC,
        adminUC,
        bootstrapUC,
        employeeUC,
        skillUC,
        taskUC,
        ossDecisionUC,
        knowledgeUC,
        knowledgeSedimentationUC,
        subscriptionUC,
        toolUC,
        executionGateway,
        store,
        addAuditEvent,
        handleAdminToolsRoutes
      })) return;

      if (await handleObservabilityRoutes({
        req,
        res,
        url,
        json,
        store,
        executionGateway
      })) return;

      if (await handleFrontRoutes({
        req,
        res,
        url,
        json,
        parseBody,
        currentSession,
        allowedFrontApprovalRoles,
        allowedFrontRejectRoles,
        frontConfiguredModels,
        employeeUC,
        conversationUC,
      messageUC,
      taskUC,
      frontDispatchUC,
      skillUC,
        ossUC,
        ossDecisionUC,
        knowledgeUC,
        subscriptionUC
      })) return;

      if (await handleStaticRoutes({
        req,
        res,
        url,
        json,
        serveStatic,
        publicDir,
        currentSession,
        resolvePagePermission,
        authUC
      })) return;
    } catch (error) {
      const status = Number(error.statusCode || 0) || (error.message.includes('not found') ? 404 : 400);
      return json(res, status, {
        error: error.message,
        ...(error && error.code ? { code: error.code } : {})
      });
    }
  });

  server.shutdown = async () => {
    stopRuntimeLoops();
    if (store && typeof store.stop === 'function') {
      try { await store.stop(); } catch {}
    }
    await close();
  };

  return server;
}

module.exports = { createApp, captureLoopError };
