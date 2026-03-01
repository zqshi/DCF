async function handleEmployeeManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    adminUC,
    employeeUC
  } = context;
  const resolveSessionAccessContext = (session) => {
    const user = session && session.user && typeof session.user === 'object' ? session.user : null;
    if (!user) return null;
    const tenantId = String(user.tenantId || '').trim();
    const accountId = String(user.accountId || '').trim();
    if (!tenantId || !accountId) return null;
    return {
      tenantId,
      accountId,
      actorUserId: null
    };
  };

  if (url.pathname === '/api/admin/employees' && req.method === 'GET') {
    json(res, 200, adminUC.listEmployees({
      keyword: url.searchParams.get('keyword') || url.searchParams.get('q') || '',
      department: url.searchParams.get('department') || '',
      role: url.searchParams.get('role') || ''
    }));
    return true;
  }
  if (url.pathname === '/api/admin/employees/retrieval-policy/rollout' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    json(res, 200, employeeUC.rolloutRetrievalPolicy({
      mode: body.mode,
      filters: body.filters || {}
    }, session ? session.user.id : 'unknown'));
    return true;
  }
  if (url.pathname === '/api/admin/employees/retrieval-policy/rollback' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    json(res, 200, employeeUC.rollbackRetrievalPolicy({
      reason: body.reason || '',
      filters: body.filters || {}
    }, session ? session.user.id : 'unknown'));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/employees/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const employeeId = parts[3];
    const action = parts[4];
    const session = currentSession(req);
    const accessContext = resolveSessionAccessContext(session);
    const body = await parseBody(req);
    if (action === 'policy') {
      json(res, 200, employeeUC.updateJobPolicy(employeeId, body.jobPolicy || body, session ? session.user.id : 'unknown', accessContext));
      return true;
    }
    if (action === 'approval-policy') {
      json(res, 200, employeeUC.updateApprovalPolicy(employeeId, body.approvalPolicy || body, session ? session.user.id : 'unknown', accessContext));
      return true;
    }
    if (action === 'policy-optimize') {
      json(res, 200, employeeUC.optimizePolicyForLlm(employeeId, body, session ? session.user.id : 'unknown', accessContext));
      return true;
    }
    if (action === 'profile') {
      json(res, 200, employeeUC.updateProfile(employeeId, body.profile || body, session ? session.user.id : 'unknown', accessContext));
      return true;
    }
    if (action === 'runtime-provision') {
      json(res, 200, await employeeUC.provisionRuntime(employeeId, session ? session.user.id : 'unknown', accessContext));
      return true;
    }
  }
  if (url.pathname.startsWith('/api/admin/employees/') && req.method === 'PUT') {
    const parts = url.pathname.split('/').filter(Boolean);
    const employeeId = parts[3];
    const section = parts[4];
    const fileName = parts[5] ? decodeURIComponent(parts[5]) : '';
    if (section === 'runtime-files' && fileName) {
      const session = currentSession(req);
      const accessContext = resolveSessionAccessContext(session);
      const body = await parseBody(req);
      json(res, 200, employeeUC.updateRuntimeFile(employeeId, fileName, body.content || '', session ? session.user.id : 'unknown', accessContext));
      return true;
    }
  }
  if (url.pathname.startsWith('/api/admin/employees/') && req.method === 'GET') {
    const parts = url.pathname.split('/').filter(Boolean);
    const employeeId = parts[3];
    const session = currentSession(req);
    const accessContext = resolveSessionAccessContext(session);
    if (parts.length === 5 && parts[4] === 'runtime-files') {
      json(res, 200, employeeUC.listRuntimeFiles(employeeId, accessContext));
      return true;
    }
    if (parts.length === 6 && parts[4] === 'runtime-files') {
      json(res, 200, employeeUC.getRuntimeFile(employeeId, decodeURIComponent(parts[5]), accessContext));
      return true;
    }
    if (parts.length === 5 && parts[4] === 'logs') {
      json(res, 200, adminUC.getEmployeeLogs(employeeId));
      return true;
    }
    json(res, 200, adminUC.getEmployeeDetail(employeeId));
    return true;
  }

  return false;
}

module.exports = {
  handleEmployeeManagementRoutes
};
