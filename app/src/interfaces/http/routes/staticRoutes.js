async function handleStaticRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    serveStatic,
    publicDir,
    currentSession,
    resolvePagePermission,
    authUC
  } = context;

  if (url.pathname === '/') req.url = '/front.html';
  if (url.pathname === '/admin.html') req.url = '/admin/index.html';
  if (url.pathname === '/admin' || url.pathname === '/admin/') req.url = '/admin/index.html';
  const protectedFrontPages = new Set(['/front.html']);
  const isFrontHtml = protectedFrontPages.has(url.pathname);
  if (isFrontHtml) {
    const session = currentSession(req);
    if (!session) {
      const next = encodeURIComponent(url.pathname);
      res.writeHead(302, { Location: `/front-login.html?next=${next}` });
      res.end();
      return true;
    }
  }

  const isAdminHtml = url.pathname.startsWith('/admin/') && (url.pathname.endsWith('.html') || url.pathname === '/admin/');
  if (isAdminHtml && !url.pathname.startsWith('/admin/login')) {
    const session = currentSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/admin/login.html' });
      res.end();
      return true;
    }
    const pagePermission = resolvePagePermission(url.pathname === '/admin/' ? '/admin/index.html' : url.pathname);
    if (pagePermission && !authUC.canAccess(session.user, pagePermission)) {
      res.writeHead(302, { Location: '/admin/index.html' });
      res.end();
      return true;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    json(res, 404, { error: 'Not Found' });
    return true;
  }

  serveStatic(publicDir, req, res);
  return true;
}

module.exports = {
  handleStaticRoutes
};
