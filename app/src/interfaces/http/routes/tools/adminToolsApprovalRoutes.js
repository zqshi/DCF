const { resolveMcpPath, withToolErrorMapping } = require('./common');

async function handleAdminToolsApprovalRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    currentSession,
    toolUC,
    addAuditEvent
  } = context;

  if (url.pathname === '/api/admin/tools/pending' && req.method === 'GET') {
    json(res, 200, toolUC.listPendingMcpServices());
    return true;
  }

  if (!url.pathname.startsWith('/api/admin/tools/mcp-services/') || req.method !== 'POST') {
    return false;
  }

  const { serviceId, action } = resolveMcpPath(url.pathname);
  if (!['approve', 'reject', 'rollback', 'resubmit'].includes(action)) {
    return false;
  }

  await withToolErrorMapping(async () => {
    const session = currentSession(req);
    const toStatus = action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : action === 'rollback'
          ? 'rollback'
          : 'pending';
    const changed = toolUC.changeMcpServiceRegistrationStatus(serviceId, toStatus, {
      actor: session ? session.user.username : 'unknown',
      role: session ? session.user.role : ''
    });
    addAuditEvent('admin.tools.mcp.status_changed', req, session, {
      serviceId: changed.service.id,
      fromStatus: changed.fromStatus,
      toStatus: changed.toStatus,
      updatedBy: session ? session.user.username : 'unknown',
      updatedByRole: session ? session.user.role : '',
      audit_action: `tools.mcp.${action}`,
      audit_resource: `mcp:${changed.service.id}`,
      audit_result: 'succeeded'
    });
    json(res, 200, changed.service);
  });
  return true;
}

module.exports = {
  handleAdminToolsApprovalRoutes
};
