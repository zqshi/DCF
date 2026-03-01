async function handleTaskManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    adminUC,
    taskUC
  } = context;

  if (url.pathname === '/api/admin/tasks' && req.method === 'GET') {
    json(res, 200, adminUC.listTasks());
    return true;
  }
  if (url.pathname === '/api/admin/tasks/approve' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    json(res, 200, taskUC.approve(
      body.taskId,
      session ? session.user.id : 'unknown',
      body.note || '',
      session ? session.user.role : ''
    ));
    return true;
  }
  if (url.pathname === '/api/admin/tasks/rollback' && req.method === 'POST') {
    const body = await parseBody(req);
    const session = currentSession(req);
    json(res, 200, taskUC.rollback(body.taskId, body.reason || 'manual rollback', {
      userId: session ? session.user.id : null,
      role: session ? session.user.role : null
    }));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/tasks/') && url.pathname.endsWith('/retry-compensation') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const taskId = parts[3];
    const body = await parseBody(req);
    const session = currentSession(req);
    json(res, 200, taskUC.retryCompensation(taskId, {
      userId: session ? session.user.id : null,
      role: session ? session.user.role : null,
      reason: body.reason || 'manual retry compensation'
    }));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/tasks/') && url.pathname.endsWith('/rollback-report') && req.method === 'GET') {
    const parts = url.pathname.split('/').filter(Boolean);
    json(res, 200, adminUC.getRollbackReport({ taskId: parts[3] }));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/tasks/') && url.pathname.endsWith('/rollback-package') && req.method === 'GET') {
    const parts = url.pathname.split('/').filter(Boolean);
    json(res, 200, adminUC.getRollbackPackage({ taskId: parts[3] }));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/tasks/') && req.method === 'GET') {
    json(res, 200, adminUC.getTaskDetail(url.pathname.split('/')[4]));
    return true;
  }

  return false;
}

module.exports = {
  handleTaskManagementRoutes
};
