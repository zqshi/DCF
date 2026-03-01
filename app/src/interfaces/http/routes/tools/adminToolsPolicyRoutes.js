const { withToolErrorMapping } = require('./common');

async function handleAdminToolsPolicyRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    adminUC,
    buildRuntimeStatusPayload
  } = context;

  if (url.pathname === '/api/admin/tools/retrieval-policy' && req.method === 'GET') {
    json(res, 200, adminUC.getRetrievalPolicy());
    return true;
  }

  if (url.pathname === '/api/admin/tools/retrieval-policy' && req.method === 'POST') {
    await withToolErrorMapping(async () => {
      const session = currentSession(req);
      const body = await parseBody(req);
      json(res, 200, adminUC.updateRetrievalPolicy(body, {
        userId: session ? session.user.id : 'unknown'
      }));
    });
    return true;
  }

  if (url.pathname === '/api/admin/tools/retrieval-metrics' && req.method === 'GET') {
    const runtime = buildRuntimeStatusPayload();
    json(res, 200, {
      retrievalPolicy: runtime.retrievalPolicy,
      retrieval: runtime.retrieval,
      now: runtime.now
    });
    return true;
  }

  return false;
}

module.exports = {
  handleAdminToolsPolicyRoutes
};
