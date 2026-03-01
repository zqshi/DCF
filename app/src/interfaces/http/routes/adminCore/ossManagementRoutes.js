async function handleOssManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    adminUC,
    ossDecisionUC
  } = context;

  if (url.pathname === '/api/admin/oss-findings' && req.method === 'GET') {
    json(res, 200, adminUC.listOssFindings());
    return true;
  }
  if (url.pathname === '/api/admin/oss-cases' && req.method === 'GET') {
    json(res, 200, adminUC.listOssCases({
      status: url.searchParams.get('status') || '',
      risk: url.searchParams.get('risk') || '',
      evidenceComplete: url.searchParams.get('evidenceComplete') || '',
      from: url.searchParams.get('from') || '',
      to: url.searchParams.get('to') || ''
    }));
    return true;
  }
  if (url.pathname === '/api/admin/oss-governance-policy' && req.method === 'GET') {
    json(res, 200, adminUC.getOssGovernancePolicy());
    return true;
  }
  if (url.pathname === '/api/admin/oss-governance-policy' && req.method === 'POST') {
    const session = currentSession(req);
    const body = await parseBody(req);
    json(res, 200, adminUC.updateOssGovernancePolicy(body, {
      userId: session ? session.user.id : 'unknown'
    }));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/oss-cases/') && req.method === 'GET') {
    const parts = url.pathname.split('/').filter(Boolean);
    json(res, 200, adminUC.getOssCaseDetail(parts[3]));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/oss-cases/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const caseId = parts[3];
    const action = parts[4] || '';
    const body = await parseBody(req);
    const session = currentSession(req);
    const actor = {
      userId: session ? session.user.id : 'unknown',
      role: session ? session.user.role : ''
    };
    if (action === 'approve') {
      json(res, 200, ossDecisionUC.approveCase(caseId, body, actor));
      return true;
    }
    if (action === 'deploy') {
      json(res, 200, ossDecisionUC.deployCase(caseId, actor));
      return true;
    }
    if (action === 'verify') {
      json(res, 200, ossDecisionUC.verifyCase(caseId, body, actor));
      return true;
    }
    if (action === 'rollback') {
      json(res, 200, ossDecisionUC.rollbackCase(caseId, body, actor));
      return true;
    }
    if (action === 'review') {
      json(res, 200, ossDecisionUC.reviewCase(caseId, body, actor));
      return true;
    }
    if (action === 'retire') {
      json(res, 200, ossDecisionUC.retireCase(caseId, body, actor));
      return true;
    }
  }

  return false;
}

module.exports = {
  handleOssManagementRoutes
};
