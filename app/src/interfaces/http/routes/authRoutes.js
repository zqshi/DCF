async function handleAuthRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    currentSession,
    setCookie,
    clearCookie,
    authCookieName,
    secureCookie,
    authUC,
    ssoGateway,
    knowledgeSsoBridgeGateway,
    addAuditEvent,
    navItems
  } = context;

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseBody(req);
    try {
      const login = authUC.login(body.username, body.password);
      setCookie(res, authCookieName, login.token, {
        path: '/',
        maxAge: authUC.sessionTtlMs,
        httpOnly: true,
        sameSite: 'Lax',
        secure: secureCookie
      });
      addAuditEvent('auth.login.succeeded', req, null, {
        actorUserId: login.user.id,
        actor_name: login.user.username,
        actor_role: login.user.role,
        username: body.username,
        userId: login.user.id,
        role: login.user.role,
        audit_page: '/admin/login.html',
        audit_action: 'login',
        audit_resource: `user:${login.user.id}`,
        audit_result: 'succeeded'
      });
      json(res, 200, { ok: true, user: login.user, expiresAt: login.expiresAt });
    } catch (error) {
      addAuditEvent('auth.login.failed', req, null, {
        actor_name: body.username || 'unknown',
        actor_role: 'unknown',
        username: body.username || '',
        reason: error.message,
        audit_page: '/admin/login.html',
        audit_action: 'login',
        audit_resource: `username:${body.username || ''}`,
        audit_result: 'failed'
      });
      json(res, 401, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const session = currentSession(req);
    if (session) {
      authUC.logout(session.token);
      addAuditEvent('auth.logout', req, session, {
        userId: session.user.id,
        username: session.user.username,
        role: session.user.role,
        audit_page: '/admin/login.html',
        audit_action: 'logout',
        audit_resource: `user:${session.user.id}`,
        audit_result: 'succeeded'
      });
    }
    clearCookie(res, authCookieName, {
      path: '/',
      sameSite: 'Lax',
      httpOnly: true,
      secure: secureCookie
    });
    json(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const session = currentSession(req);
    if (!session) {
      json(res, 200, { authenticated: false });
      return true;
    }
    json(res, 200, {
      authenticated: true,
      user: session.user,
      expiresAt: session.expiresAt,
      remainingSeconds: Math.ceil((session.remainingMs || 0) / 1000)
    });
    return true;
  }

  if (url.pathname === '/api/auth/renew' && req.method === 'POST') {
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '未登录或会话已过期' });
      return true;
    }
    setCookie(res, authCookieName, session.token, {
      path: '/',
      maxAge: authUC.sessionTtlMs,
      httpOnly: true,
      sameSite: 'Lax'
    });
    json(res, 200, {
      ok: true,
      expiresAt: session.expiresAt,
      remainingSeconds: Math.ceil((session.remainingMs || 0) / 1000)
    });
    return true;
  }

  if (url.pathname === '/api/auth/acl' && req.method === 'GET') {
    json(res, 200, { navItems });
    return true;
  }

  if (url.pathname === '/api/auth/sso/capabilities' && req.method === 'GET') {
    json(res, 200, ssoGateway.capabilities());
    return true;
  }

  if (url.pathname === '/api/auth/sso/authorize' && req.method === 'GET') {
    try {
      const payload = ssoGateway.buildAuthorizeUrl({
        redirectUri: url.searchParams.get('redirectUri') || '',
        scope: url.searchParams.get('scope') || '',
        state: url.searchParams.get('state') || '',
        nonce: url.searchParams.get('nonce') || ''
      });
      json(res, 200, payload);
    } catch (error) {
      json(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/auth/sso/callback' && req.method === 'GET') {
    try {
      const payload = ssoGateway.handleCallback({
        code: url.searchParams.get('code') || '',
        state: url.searchParams.get('state') || '',
        error: url.searchParams.get('error') || '',
        error_description: url.searchParams.get('error_description') || ''
      });
      json(res, 200, payload);
    } catch (error) {
      json(res, Number(error.statusCode || 0) || 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/auth/sso/token-exchange' && req.method === 'POST') {
    const body = await parseBody(req);
    try {
      const identity = await ssoGateway.exchangeCodeForIdentity(req, {
        code: body.code || '',
        username: body.username || '',
        tenantId: body.tenantId || '',
        accountId: body.accountId || '',
        redirectUri: body.redirectUri || ''
      });
      const login = authUC.loginViaSso({
        ...identity,
        authMethod: 'sso-token-exchange'
      });
      setCookie(res, authCookieName, login.token, {
        path: '/',
        maxAge: authUC.sessionTtlMs,
        httpOnly: true,
        sameSite: 'Lax',
        secure: secureCookie
      });
      addAuditEvent('auth.sso.token_exchange.login.succeeded', req, null, {
        actorUserId: login.user.id,
        actor_name: login.user.username,
        actor_role: login.user.role,
        username: login.user.username,
        userId: login.user.id,
        role: login.user.role,
        audit_page: '/admin/login.html',
        audit_action: 'sso.token_exchange.login',
        audit_resource: `user:${login.user.id}`,
        audit_result: 'succeeded'
      });
      json(res, 200, { ok: true, user: login.user, expiresAt: login.expiresAt, authMethod: login.authMethod });
    } catch (error) {
      addAuditEvent('auth.sso.token_exchange.login.failed', req, null, {
        actor_name: body.username || 'unknown',
        actor_role: 'unknown',
        username: body.username || '',
        reason: error.message,
        audit_page: '/admin/login.html',
        audit_action: 'sso.token_exchange.login',
        audit_resource: `username:${body.username || ''}`,
        audit_result: 'failed'
      });
      json(res, Number(error.statusCode || 0) || 401, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/auth/sso/bridge-login' && req.method === 'POST') {
    let bridgeAllowed = false;
    try {
      bridgeAllowed = ssoGateway.verifyBridgeToken(req);
    } catch (error) {
      json(res, 400, { error: error.message });
      return true;
    }
    if (!bridgeAllowed) {
      json(res, 403, { error: 'invalid sso bridge token' });
      return true;
    }
    const body = await parseBody(req);
    try {
      const login = authUC.loginViaSso({
        username: body.username,
        tenantId: body.tenantId,
        accountId: body.accountId
      });
      setCookie(res, authCookieName, login.token, {
        path: '/',
        maxAge: authUC.sessionTtlMs,
        httpOnly: true,
        sameSite: 'Lax',
        secure: secureCookie
      });
      addAuditEvent('auth.sso.login.succeeded', req, null, {
        actorUserId: login.user.id,
        actor_name: login.user.username,
        actor_role: login.user.role,
        username: login.user.username,
        userId: login.user.id,
        role: login.user.role,
        audit_page: '/admin/login.html',
        audit_action: 'sso.bridge.login',
        audit_resource: `user:${login.user.id}`,
        audit_result: 'succeeded'
      });
      json(res, 200, { ok: true, user: login.user, expiresAt: login.expiresAt, authMethod: login.authMethod });
    } catch (error) {
      addAuditEvent('auth.sso.login.failed', req, null, {
        actor_name: body.username || 'unknown',
        actor_role: 'unknown',
        username: body.username || '',
        reason: error.message,
        audit_page: '/admin/login.html',
        audit_action: 'sso.bridge.login',
        audit_resource: `username:${body.username || ''}`,
        audit_result: 'failed'
      });
      json(res, 401, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/auth/sso/knowledge-bridge-url' && req.method === 'GET') {
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '未登录或会话已过期' });
      return true;
    }
    const redirect = String(url.searchParams.get('redirect') || '').trim();
    if (!knowledgeSsoBridgeGateway || !knowledgeSsoBridgeGateway.isEnabled()) {
      json(res, 503, { error: 'knowledge sso bridge is not configured' });
      return true;
    }
    try {
      const targetUrl = knowledgeSsoBridgeGateway.buildLoginUrl(session.user, redirect);
      json(res, 200, { url: targetUrl });
    } catch (error) {
      json(res, 400, { error: error.message || 'failed to build knowledge bridge url' });
    }
    return true;
  }

  if (url.pathname === '/api/auth/sso/knowledge-bridge-login' && req.method === 'GET') {
    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: '未登录或会话已过期' });
      return true;
    }
    const redirect = String(url.searchParams.get('redirect') || '').trim();
    if (!knowledgeSsoBridgeGateway || !knowledgeSsoBridgeGateway.isEnabled()) {
      json(res, 503, { error: 'knowledge sso bridge is not configured' });
      return true;
    }
    try {
      const targetUrl = knowledgeSsoBridgeGateway.buildLoginUrl(session.user, redirect);
      res.writeHead(302, { Location: targetUrl });
      res.end();
    } catch (error) {
      json(res, 400, { error: error.message || 'failed to build knowledge bridge url' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleAuthRoutes
};
