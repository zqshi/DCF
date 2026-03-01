const { resolveMcpPath, withToolErrorMapping } = require('./common');

async function handleAdminToolsAssetsRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    toolUC,
    addAuditEvent
  } = context;

  if ((url.pathname === '/api/admin/tools' || url.pathname === '/api/admin/tools/mcp-services' || url.pathname === '/api/admin/tools/mcp-services/') && req.method === 'GET') {
    json(res, 200, toolUC.listMcpServices());
    return true;
  }

  if (url.pathname === '/api/admin/tools/mcp-services' && req.method === 'POST') {
    await withToolErrorMapping(async () => {
      const body = await parseBody(req);
      const session = currentSession(req);
      const created = toolUC.createMcpService(body, {
        actor: session ? session.user.username : 'unknown'
      });
      addAuditEvent('admin.tools.mcp.created', req, session, {
        serviceId: created.id,
        enabled: created.enabled,
        updatedBy: created.updatedBy,
        audit_action: 'tools.mcp.create',
        audit_resource: `mcp:${created.id}`,
        audit_result: 'succeeded'
      });
      json(res, 201, created);
    });
    return true;
  }

  if (!url.pathname.startsWith('/api/admin/tools/mcp-services/') || req.method !== 'POST') {
    return false;
  }

  const { serviceId, action } = resolveMcpPath(url.pathname);
  if (['approve', 'reject', 'rollback', 'resubmit'].includes(action)) {
    return false;
  }

  await withToolErrorMapping(async () => {
    const body = await parseBody(req);
    const session = currentSession(req);

    if (action === 'delete') {
      const removed = toolUC.deleteMcpService(serviceId);
      addAuditEvent('admin.tools.mcp.deleted', req, session, {
        serviceId: removed.id,
        updatedBy: session ? session.user.username : 'unknown',
        audit_action: 'tools.mcp.delete',
        audit_resource: `mcp:${removed.id}`,
        audit_result: 'succeeded'
      });
      json(res, 200, removed);
      return;
    }

    if (action === 'check-health') {
      const checked = await toolUC.checkMcpServiceHealth(serviceId);
      addAuditEvent('admin.tools.mcp.health_checked', req, session, {
        serviceId: checked.id,
        healthStatus: checked.health ? checked.health.status : 'unknown',
        httpStatus: checked.health ? checked.health.httpStatus : null,
        updatedBy: session ? session.user.username : 'unknown',
        audit_action: 'tools.mcp.check_health',
        audit_resource: `mcp:${checked.id}`,
        audit_result: checked.health && checked.health.status === 'healthy' ? 'succeeded' : 'failed'
      });
      json(res, 200, checked);
      return;
    }

    const updated = toolUC.updateMcpService(serviceId, body, {
      actor: session ? session.user.username : 'unknown'
    });
    addAuditEvent('admin.tools.mcp.updated', req, session, {
      serviceId: updated.id,
      enabled: updated.enabled,
      updatedBy: updated.updatedBy,
      audit_action: 'tools.mcp.update',
      audit_resource: `mcp:${updated.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, updated);
  });
  return true;
}

module.exports = {
  handleAdminToolsAssetsRoutes
};
