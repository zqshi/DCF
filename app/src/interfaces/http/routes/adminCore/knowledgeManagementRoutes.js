async function handleKnowledgeManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    knowledgeUC,
    knowledgeSedimentationUC
  } = context;

  if (url.pathname === '/api/admin/knowledge-assets' && req.method === 'GET') {
    json(res, 200, knowledgeUC.listAssets({
      employeeId: url.searchParams.get('employeeId') || '',
      reviewStatus: url.searchParams.get('reviewStatus') || '',
      assetType: url.searchParams.get('assetType') || ''
    }));
    return true;
  }

  if (url.pathname.startsWith('/api/admin/knowledge-assets/') && url.pathname.endsWith('/review') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const assetId = parts[3];
    const body = await parseBody(req);
    const session = currentSession(req);
    json(res, 200, knowledgeUC.reviewAsset(assetId, body, {
      userId: session && session.user ? session.user.id : 'unknown',
      role: session && session.user ? session.user.role : ''
    }));
    return true;
  }

  if (url.pathname === '/api/admin/knowledge-candidates' && req.method === 'GET') {
    if (!knowledgeSedimentationUC) {
      json(res, 200, []);
      return true;
    }
    json(res, 200, knowledgeSedimentationUC.listCandidates({
      employeeId: url.searchParams.get('employeeId') || '',
      status: url.searchParams.get('status') || ''
    }));
    return true;
  }

  if (url.pathname.startsWith('/api/admin/knowledge-candidates/') && url.pathname.endsWith('/review') && req.method === 'POST') {
    if (!knowledgeSedimentationUC) {
      json(res, 503, { error: 'knowledge sedimentation is unavailable' });
      return true;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const candidateId = parts[3];
    const body = await parseBody(req);
    const session = currentSession(req);
    json(res, 200, await knowledgeSedimentationUC.reviewCandidate(candidateId, body, {
      userId: session && session.user ? session.user.id : 'unknown',
      role: session && session.user ? session.user.role : ''
    }));
    return true;
  }

  return false;
}

module.exports = {
  handleKnowledgeManagementRoutes
};
