async function handleSystemManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    buildRuntimeStatusPayload,
    adminUC,
    bootstrapUC,
    handleAdminToolsRoutes,
    toolUC,
    store,
    addAuditEvent
  } = context;

  if (url.pathname === '/api/admin/runtime-status' && req.method === 'GET') {
    json(res, 200, buildRuntimeStatusPayload());
    return true;
  }
  if (url.pathname === '/api/admin/runtime/shadow-diffs' && req.method === 'GET') {
    json(res, 200, adminUC.listRuntimeShadowDiffs({
      taskId: url.searchParams.get('taskId') || '',
      employeeId: url.searchParams.get('employeeId') || '',
      targetEngine: url.searchParams.get('targetEngine') || '',
      page: url.searchParams.get('page') || '1',
      pageSize: url.searchParams.get('pageSize') || '20'
    }));
    return true;
  }
  if (url.pathname === '/api/admin/runtime/shadow-policy' && req.method === 'GET') {
    json(res, 200, adminUC.getRuntimeShadowPolicy());
    return true;
  }
  if (url.pathname === '/api/admin/runtime/shadow-policy' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const updated = adminUC.updateRuntimeShadowPolicy(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.shadow_policy.updated', req, session, {
      enabled: updated.enabled,
      targetEngine: updated.targetEngine,
      updatedBy: updated.updatedBy,
      audit_module: 'runtime',
      audit_page: '/admin/runtime.html',
      audit_action: 'runtime.shadow_policy.update',
      audit_resource: 'runtime:shadow_policy',
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname === '/api/admin/overview' && req.method === 'GET') {
    const runtime = buildRuntimeStatusPayload();
    json(res, 200, adminUC.getOverview({
      runtimeEnabled: runtime.runtimeEnabled,
      dialogueEnabled: runtime.llm && runtime.llm.dialogueEnabled,
      bootstrap: runtime.bootstrap || {},
      queue: runtime.queue || {}
    }));
    return true;
  }
  if (url.pathname === '/api/admin/runtime/retrieval-policy' && req.method === 'GET') {
    json(res, 200, adminUC.getRetrievalPolicy());
    return true;
  }
  if (url.pathname === '/api/admin/runtime/retrieval-policy' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const updated = adminUC.updateRetrievalPolicy(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.retrieval_policy.updated', req, session, {
      mode: updated.mode,
      updatedBy: updated.updatedBy,
      audit_module: 'runtime',
      audit_page: '/admin/runtime.html',
      audit_action: 'runtime.retrieval_policy.update',
      audit_resource: 'runtime:retrieval_policy',
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname === '/api/admin/runtime/skill-sedimentation-policy' && req.method === 'GET') {
    json(res, 200, adminUC.getSkillSedimentationPolicy());
    return true;
  }
  if (url.pathname === '/api/admin/runtime/skill-sedimentation-policy' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const updated = adminUC.updateSkillSedimentationPolicy(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.skill_sedimentation_policy.updated', req, session, {
      mode: updated.mode,
      promotionMode: updated.promotionMode,
      updatedBy: updated.updatedBy,
      audit_module: 'runtime',
      audit_page: '/admin/runtime.html',
      audit_action: 'runtime.skill_sedimentation_policy.update',
      audit_resource: 'runtime:skill_sedimentation_policy',
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname === '/api/admin/runtime/knowledge-sedimentation-policy' && req.method === 'GET') {
    json(res, 200, adminUC.getKnowledgeSedimentationPolicy());
    return true;
  }
  if (url.pathname === '/api/admin/runtime/knowledge-sedimentation-policy' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const updated = adminUC.updateKnowledgeSedimentationPolicy(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.knowledge_sedimentation_policy.updated', req, session, {
      mode: updated.mode,
      promotionMode: updated.promotionMode,
      updatedBy: updated.updatedBy,
      audit_module: 'runtime',
      audit_page: '/admin/runtime.html',
      audit_action: 'runtime.knowledge_sedimentation_policy.update',
      audit_resource: 'runtime:knowledge_sedimentation_policy',
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname === '/api/admin/strategy-center' && req.method === 'GET') {
    json(res, 200, adminUC.getStrategyCenter());
    return true;
  }
  if (url.pathname === '/api/admin/strategy-center' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const updated = adminUC.updateStrategyCenter(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.strategy_center.updated', req, session, {
      updatedBy: updated.updatedBy,
      audit_module: 'runtime',
      audit_page: '/admin/strategy-center.html',
      audit_action: 'runtime.strategy_center.update',
      audit_resource: 'runtime:strategy_center',
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname === '/api/admin/prompt-center' && req.method === 'GET') {
    json(res, 200, adminUC.getPromptCenter());
    return true;
  }
  if (url.pathname === '/api/admin/prompt-center' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const updated = adminUC.updatePromptCenter(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.prompt_center.updated', req, session, {
      updatedBy: updated.updatedBy,
      audit_module: 'runtime',
      audit_page: '/admin/strategy-center.html',
      audit_action: 'runtime.prompt_center.update',
      audit_resource: 'runtime:prompt_center',
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
    return true;
  }
  if (url.pathname === '/api/admin/prompt-center/compile' && req.method === 'POST') {
    const body = await parseBody(req);
    json(res, 200, adminUC.compilePrompt(body));
    return true;
  }
  if (url.pathname === '/api/admin/prompt-versions' && req.method === 'GET') {
    json(res, 200, {
      activeVersionId: adminUC.getPromptCenter().activeVersionId,
      items: adminUC.listPromptVersions(url.searchParams.get('limit') || '50')
    });
    return true;
  }
  if (url.pathname === '/api/admin/prompt-versions/publish' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const created = adminUC.publishPromptVersion(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.prompt_version.published', req, session, {
      promptVersionId: created.id,
      source: created.source,
      audit_module: 'runtime',
      audit_page: '/admin/strategy-center.html',
      audit_action: 'runtime.prompt_version.publish',
      audit_resource: `runtime:prompt_version:${created.id}`,
      audit_result: 'succeeded'
    });
    json(res, 201, created);
    return true;
  }
  if (url.pathname === '/api/admin/prompt-versions/approve' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const approved = adminUC.approvePromptVersion(body.versionId, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.prompt_version.approved', req, session, {
      promptVersionId: approved.id,
      audit_module: 'runtime',
      audit_page: '/admin/strategy-center.html',
      audit_action: 'runtime.prompt_version.approve',
      audit_resource: `runtime:prompt_version:${approved.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, approved);
    return true;
  }
  if (url.pathname === '/api/admin/prompt-versions/rollback' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const restored = adminUC.rollbackPromptVersion(body.versionId, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.prompt_version.rolled_back', req, session, {
      promptVersionId: restored.id,
      audit_module: 'runtime',
      audit_page: '/admin/strategy-center.html',
      audit_action: 'runtime.prompt_version.rollback',
      audit_resource: `runtime:prompt_version:${restored.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, restored);
    return true;
  }
  if (url.pathname === '/api/admin/autoevolve/runs' && req.method === 'GET') {
    json(res, 200, adminUC.listAutoevolveRuns(url.searchParams.get('limit') || '50'));
    return true;
  }
  if (url.pathname === '/api/admin/autoevolve/run' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const run = adminUC.createAutoevolveRun(body, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.autoevolve.run.created', req, session, {
      runId: run.id,
      audit_module: 'runtime',
      audit_page: '/admin/autoevolve.html',
      audit_action: 'runtime.autoevolve.run',
      audit_resource: `runtime:autoevolve:${run.id}`,
      audit_result: 'succeeded'
    });
    json(res, 201, run);
    return true;
  }
  if (url.pathname === '/api/admin/autoevolve/promote' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const result = adminUC.promoteAutoevolveRun(body.runId, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.autoevolve.run.promoted', req, session, {
      runId: result.run.id,
      promptVersionId: result.version.id,
      audit_module: 'runtime',
      audit_page: '/admin/autoevolve.html',
      audit_action: 'runtime.autoevolve.promote',
      audit_resource: `runtime:autoevolve:${result.run.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, result);
    return true;
  }
  if (url.pathname === '/api/admin/autoevolve/revert' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const run = adminUC.revertAutoevolveRun(body.runId, {
      userId: session ? session.user.id : 'unknown'
    });
    addAuditEvent('admin.runtime.autoevolve.run.reverted', req, session, {
      runId: run.id,
      audit_module: 'runtime',
      audit_page: '/admin/autoevolve.html',
      audit_action: 'runtime.autoevolve.revert',
      audit_resource: `runtime:autoevolve:${run.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, run);
    return true;
  }
  if (url.pathname === '/api/admin/bootstrap-status' && req.method === 'GET') {
    json(res, 200, bootstrapUC.getStatus());
    return true;
  }
  if (url.pathname === '/api/admin/bootstrap/run-cycle' && req.method === 'POST') {
    json(res, 200, bootstrapUC.runCycle());
    return true;
  }

  if (await handleAdminToolsRoutes({
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    toolUC,
    adminUC,
    store,
    addAuditEvent,
    buildRuntimeStatusPayload
  })) return true;

  if (url.pathname === '/api/admin/logs' && req.method === 'GET') {
    json(res, 200, adminUC.listLogs({
      taskId: url.searchParams.get('taskId') || '',
      employeeId: url.searchParams.get('employeeId') || ''
    }));
    return true;
  }
  if (url.pathname === '/api/admin/audit-status' && req.method === 'GET') {
    json(res, 200, {
      chain: store.verifyAuditChain(),
      anchorChain: store.verifyAnchorChain(),
      anchor: store.verifyLatestAnchor(),
      latestAnchor: store.auditAnchors[0] || null
    });
    return true;
  }
  if (url.pathname === '/api/admin/audit-anchor' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    const created = store.createAuditAnchor(session ? session.user.id : 'unknown', body.note || '');
    addAuditEvent('audit.anchor.requested', req, session, {
      anchorId: created.id,
      note: created.note || '',
      audit_action: 'audit.anchor.create',
      audit_resource: `anchor:${created.id}`,
      audit_result: 'succeeded'
    });
    json(res, 201, created);
    return true;
  }

  return false;
}

module.exports = {
  handleSystemManagementRoutes
};
