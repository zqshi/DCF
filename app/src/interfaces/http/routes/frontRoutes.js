const { resolveSessionAccessContext } = require('../../../shared/tenantAccess');

function resolveKnowledgeEntryConfig() {
  const mode = String(process.env.FRONT_KNOWLEDGE_ENTRY_MODE || 'external').trim().toLowerCase();
  const externalMode = mode === 'external';
  const configuredExternalUrl = String(process.env.WEKNORA_WEB_URL || '').trim();
  const entryUrl = externalMode
    ? (configuredExternalUrl || 'http://127.0.0.1:19080')
    : '/platform/knowledge-bases';
  const entryEnabled = String(process.env.FRONT_KNOWLEDGE_ENTRY_ENABLED || '1').trim() !== '0' && entryUrl.length > 0;
  const bridgeEnabled = externalMode && String(process.env.KNOWLEDGE_SSO_BRIDGE_ENABLED || '').trim() === '1'
    && String(process.env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET || '').trim().length > 0
    && entryUrl.length > 0;
  return {
    mode,
    externalMode,
    enabled: entryEnabled,
    entryUrl,
    useSsoBridge: bridgeEnabled
  };
}

async function probeKnowledgeEntryAvailability(entryUrl) {
  const raw = String(entryUrl || '').trim();
  if (!raw) {
    return { available: false, reason: '外部知识库地址未配置' };
  }
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { available: false, reason: '外部知识库地址格式错误' };
  }
  const healthUrl = new URL('/health', target.origin).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      return { available: false, reason: `知识库健康检查失败 (${response.status})`, healthUrl };
    }
    return { available: true, healthUrl };
  } catch {
    return { available: false, reason: '知识库服务未启动或网络不可达', healthUrl };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleFrontRoutes(context) {
  const {
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
  } = context;

  function requireFrontAccessContext() {
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '前台接口需要登录' });
      return null;
    }
    try {
      return resolveSessionAccessContext(req, session, { required: true, requireBinding: true });
    } catch (error) {
      json(res, 403, { error: error.message });
      return null;
    }
  }

  if (url.pathname === '/api/front/employees' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, employeeUC.list(accessContext));
    return true;
  }
  if (url.pathname === '/api/front/models' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, Array.isArray(frontConfiguredModels) ? frontConfiguredModels : []);
    return true;
  }
  if (url.pathname === '/api/front/employees' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 201, await employeeUC.create(await parseBody(req), accessContext));
    return true;
  }
  if (url.pathname === '/api/front/conversations' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const employeeId = String(url.searchParams.get('employeeId') || '').trim();
    if (!employeeId) {
      json(res, 400, { error: 'employeeId is required' });
      return true;
    }
    json(res, 200, conversationUC.listByEmployee(employeeId, accessContext));
    return true;
  }
  if (url.pathname === '/api/front/conversations' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 201, conversationUC.create(await parseBody(req), accessContext));
    return true;
  }
  if (url.pathname.startsWith('/api/front/conversations/') && url.pathname.endsWith('/pin') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const conversationId = url.pathname.split('/')[4];
    json(res, 200, conversationUC.setPinned(conversationId, true, accessContext));
    return true;
  }
  if (url.pathname.startsWith('/api/front/conversations/') && url.pathname.endsWith('/unpin') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const conversationId = url.pathname.split('/')[4];
    json(res, 200, conversationUC.setPinned(conversationId, false, accessContext));
    return true;
  }
  if (url.pathname.startsWith('/api/front/conversations/') && url.pathname.endsWith('/delete') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const conversationId = url.pathname.split('/')[4];
    json(res, 200, conversationUC.delete(conversationId, accessContext));
    return true;
  }
  if (url.pathname.startsWith('/api/front/conversations/') && req.method === 'DELETE') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const conversationId = url.pathname.split('/')[4];
    json(res, 200, conversationUC.delete(conversationId, accessContext));
    return true;
  }
  if (url.pathname === '/api/front/messages' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const employeeId = String(url.searchParams.get('employeeId') || '').trim();
    const conversationId = String(url.searchParams.get('conversationId') || '').trim();
    if (!employeeId) {
      json(res, 400, { error: 'employeeId is required' });
      return true;
    }
    if (!conversationId) {
      json(res, 400, { error: 'conversationId is required' });
      return true;
    }
    json(res, 200, messageUC.listByConversation({ employeeId, conversationId }, accessContext));
    return true;
  }
  if (url.pathname === '/api/front/tasks' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const body = await parseBody(req);
    const session = currentSession(req);
    json(res, 201, taskUC.create({
      ...body,
      llmConfig: {
        ...((body && body.llmConfig && typeof body.llmConfig === 'object') ? body.llmConfig : {}),
        requireRealLlm: true
      },
      requestedByUserId: session && session.user ? session.user.id : 'unknown',
      requestedByRole: session && session.user ? session.user.role : 'front_user',
      requestChannel: 'front'
    }, accessContext));
    return true;
  }
  if (url.pathname === '/api/front/dispatch' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const body = await parseBody(req);
    const session = currentSession(req);
    try {
      const payload = await frontDispatchUC.dispatch(body, accessContext, {
        userId: session && session.user ? session.user.id : 'unknown',
        role: session && session.user ? session.user.role : 'front_user'
      });
      json(res, 200, payload);
    } catch (error) {
      const message = String(error && error.message ? error.message : 'dispatch failed');
      json(res, 400, { error: message });
    }
    return true;
  }
  if (url.pathname === '/api/front/tasks' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, taskUC.list(accessContext));
    return true;
  }

  if (url.pathname.startsWith('/api/front/tasks/') && url.pathname.endsWith('/approve') && req.method === 'POST') {
    const body = await parseBody(req);
    const taskId = url.pathname.split('/')[4];
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '审批需要登录管理账号' });
      return true;
    }
    const allowedRoles = allowedFrontApprovalRoles(session.user);
    if (!allowedRoles.length) {
      json(res, 403, { error: '当前角色无审批权限' });
      return true;
    }
    const requestedRole = String(body.approverRole || '').trim();
    const approverRole = requestedRole || allowedRoles[0];
    if (!allowedRoles.includes(approverRole)) {
      json(res, 403, { error: `当前账号不可使用审批角色: ${approverRole}` });
      return true;
    }
    json(res, 200, taskUC.approve(
      taskId,
      body.approverId || session.user.id,
      body.note || 'front approval',
      approverRole,
      accessContext
    ));
    return true;
  }

  if (url.pathname.startsWith('/api/front/tasks/') && url.pathname.endsWith('/reject') && req.method === 'POST') {
    const body = await parseBody(req);
    const taskId = url.pathname.split('/')[4];
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '驳回需要登录管理账号' });
      return true;
    }
    const allowedRoles = allowedFrontRejectRoles(session.user);
    if (!allowedRoles.length) {
      json(res, 403, { error: '当前角色无驳回权限' });
      return true;
    }
    json(res, 200, taskUC.rollback(taskId, body.reason || 'front reject rollback', {
      userId: session.user.id,
      role: session.user.role
    }, accessContext));
    return true;
  }

  if (url.pathname === '/api/skills' && req.method === 'GET') {
    const type = url.searchParams.get('type') || undefined;
    const status = url.searchParams.get('status') || undefined;
    json(res, 200, skillUC.list({ type, status }));
    return true;
  }

  if (url.pathname === '/api/skills/find' && req.method === 'GET') {
    json(res, 200, skillUC.search({
      q: url.searchParams.get('q') || '',
      type: url.searchParams.get('type') || '',
      status: url.searchParams.get('status') || '',
      limit: url.searchParams.get('limit') || ''
    }));
    return true;
  }

  if (url.pathname === '/api/skills/link' && req.method === 'POST') {
    json(res, 200, skillUC.linkToEmployee(await parseBody(req)));
    return true;
  }

  if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/run') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, taskUC.run(url.pathname.split('/')[3], accessContext));
    return true;
  }
  if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/abort') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, await taskUC.abort(url.pathname.split('/')[3], accessContext));
    return true;
  }
  if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/rollback') && req.method === 'POST') {
    const body = await parseBody(req);
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, taskUC.rollback(url.pathname.split('/')[3], body.reason || 'api rollback', {}, accessContext));
    return true;
  }

  if (url.pathname === '/api/oss/search' && req.method === 'GET') {
    const query = url.searchParams.get('q');
    const goal = url.searchParams.get('goal') || '';
    json(res, 200, await ossUC.search(query, goal));
    return true;
  }

  if (url.pathname === '/api/front/knowledge/ingest' && req.method === 'POST') {
    if (!requireFrontAccessContext()) return true;
    const body = await parseBody(req);
    const session = currentSession(req);
    json(res, 201, await knowledgeUC.ingestManual({
      employeeId: body.employeeId || '',
      taskId: body.taskId || '',
      traceId: body.traceId || '',
      title: body.title || '',
      content: body.content || '',
      status: body.status || 'publish',
      qualityScore: body.qualityScore,
      curatedBy: body.curatedBy || '',
      actorUserId: session && session.user ? session.user.id : 'unknown'
    }));
    return true;
  }

  if (url.pathname === '/api/front/knowledge/search' && req.method === 'POST') {
    if (!requireFrontAccessContext()) return true;
    const body = await parseBody(req);
    json(res, 200, await knowledgeUC.search({
      employeeId: body.employeeId || '',
      taskId: body.taskId || '',
      traceId: body.traceId || '',
      query: body.query || '',
      knowledgeBaseId: body.knowledgeBaseId || ''
    }));
    return true;
  }

  if (url.pathname === '/api/front/subscriptions' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    json(res, 200, subscriptionUC.list(accessContext));
    return true;
  }

  if (url.pathname === '/api/front/subscriptions' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const body = await parseBody(req);
    json(res, 201, subscriptionUC.create({
      employeeId: body.employeeId || '',
      conversationId: body.conversationId || '',
      sourceUrl: body.sourceUrl || '',
      topic: body.topic || body.query || '',
      category: body.category || 'general',
      intervalMinutes: body.intervalMinutes
    }, accessContext));
    return true;
  }

  if (url.pathname === '/api/front/subscriptions/nl' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const session = currentSession(req);
    const body = await parseBody(req);
    json(res, 201, await subscriptionUC.createFromNaturalLanguage({
      employeeId: body.employeeId || '',
      conversationId: body.conversationId || '',
      text: body.text || body.prompt || '',
      sourceUrl: body.sourceUrl || '',
      topic: body.topic || '',
      actorUserId: session && session.user ? session.user.id : 'unknown',
      actorUsername: session && session.user ? session.user.username : '',
      deliverConfirmation: body.deliverConfirmation !== false
    }, accessContext));
    return true;
  }

  if (url.pathname === '/api/front/subscriptions/nl/manage' && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const session = currentSession(req);
    const body = await parseBody(req);
    json(res, 200, await subscriptionUC.manageFromNaturalLanguage({
      subscriptionId: body.subscriptionId || '',
      conversationId: body.conversationId || '',
      text: body.text || body.prompt || '',
      actorUserId: session && session.user ? session.user.id : 'unknown',
      actorUsername: session && session.user ? session.user.username : '',
      deliverConfirmation: body.deliverConfirmation !== false
    }, accessContext));
    return true;
  }

  if (url.pathname.startsWith('/api/front/subscriptions/') && url.pathname.endsWith('/pause') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const body = await parseBody(req);
    const subscriptionId = url.pathname.split('/')[4];
    json(res, 200, subscriptionUC.pause(subscriptionId, {
      reason: body.reason || ''
    }, accessContext));
    return true;
  }

  if (/^\/api\/front\/subscriptions\/[^/]+$/.test(url.pathname) && req.method === 'PUT') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const body = await parseBody(req);
    const subscriptionId = url.pathname.split('/')[4];
    json(res, 200, subscriptionUC.update(subscriptionId, {
      ...(Object.prototype.hasOwnProperty.call(body, 'sourceUrl') ? { sourceUrl: body.sourceUrl } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'topic') ? { topic: body.topic } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'category') ? { category: body.category } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'intervalMinutes') ? { intervalMinutes: body.intervalMinutes } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'ruleText') ? { ruleText: body.ruleText } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'ruleSummary') ? { ruleSummary: body.ruleSummary } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'status') ? { status: body.status } : {})
    }, accessContext));
    return true;
  }

  if (url.pathname.startsWith('/api/front/subscriptions/') && url.pathname.endsWith('/resume') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const subscriptionId = url.pathname.split('/')[4];
    json(res, 200, subscriptionUC.resume(subscriptionId, accessContext));
    return true;
  }

  if (url.pathname.startsWith('/api/front/subscriptions/') && url.pathname.endsWith('/run') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const session = currentSession(req);
    const subscriptionId = url.pathname.split('/')[4];
    json(res, 200, await subscriptionUC.runSubscriptionNow(subscriptionId, {
      accessContext,
      actorUserId: session && session.user ? session.user.id : 'unknown'
    }));
    return true;
  }

  if (url.pathname.startsWith('/api/front/subscriptions/') && url.pathname.endsWith('/runs') && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const subscriptionId = url.pathname.split('/')[4];
    json(res, 200, subscriptionUC.listRuns(
      subscriptionId,
      accessContext,
      Number(url.searchParams.get('limit') || 30)
    ));
    return true;
  }

  if (url.pathname === '/api/front/knowledge/assets' && req.method === 'GET') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const visibleEmployees = employeeUC.list(accessContext);
    const visibleEmployeeIds = new Set(visibleEmployees.map((item) => item.id));
    const requestedEmployeeId = String(url.searchParams.get('employeeId') || '').trim();
    if (requestedEmployeeId && !visibleEmployeeIds.has(requestedEmployeeId)) {
      json(res, 403, { error: '无权查看该员工沉淀信息' });
      return true;
    }
    const rows = knowledgeUC.listAssets({
      employeeId: requestedEmployeeId || ''
    }).filter((item) => (
      !item.employeeId || visibleEmployeeIds.has(item.employeeId)
    ));
    json(res, 200, rows);
    return true;
  }

  if (url.pathname === '/api/front/knowledge/config' && req.method === 'GET') {
    const config = resolveKnowledgeEntryConfig();
    json(res, 200, {
      enabled: config.enabled,
      entryUrl: config.entryUrl,
      useSsoBridge: config.useSsoBridge
    });
    return true;
  }

  if (url.pathname === '/api/front/knowledge/probe' && req.method === 'GET') {
    const config = resolveKnowledgeEntryConfig();
    const entry = String(config.entryUrl || '').trim();
    if (!entry) {
      json(res, 503, { available: false, error: '外部知识库地址未配置' });
      return true;
    }
    if (!config.externalMode) {
      json(res, 200, {
        available: true,
        entryUrl: entry,
        useSsoBridge: false
      });
      return true;
    }
    const result = await probeKnowledgeEntryAvailability(entry);
    if (!result.available) {
      json(res, 503, {
        available: false,
        error: result.reason,
        entryUrl: entry,
        healthUrl: result.healthUrl || ''
      });
      return true;
    }
    json(res, 200, {
      available: true,
      entryUrl: entry,
      useSsoBridge: config.useSsoBridge
    });
    return true;
  }

  if (url.pathname.startsWith('/api/front/oss-cases/') && url.pathname.endsWith('/confirm') && req.method === 'POST') {
    const accessContext = requireFrontAccessContext();
    if (!accessContext) return true;
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '确认需要登录' });
      return true;
    }
    const body = await parseBody(req);
    const caseId = url.pathname.split('/').filter(Boolean)[3];
    const caseItem = ossDecisionUC.getCaseById(caseId);
    const visibleTasks = taskUC.list(accessContext);
    const canAccess = visibleTasks.some((item) => item && item.id === caseItem.taskId);
    if (!canAccess) {
      json(res, 403, { error: '无权确认该记录' });
      return true;
    }
    const actor = {
      userId: session.user && session.user.id ? session.user.id : 'front-user',
      role: session.user && session.user.role ? session.user.role : 'front_user'
    };
    json(res, 200, ossDecisionUC.confirmCaseByUser(caseId, body, actor));
    return true;
  }

  return false;
}

module.exports = {
  handleFrontRoutes
};
