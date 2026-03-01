const { NAV_ITEMS } = require('../../shared/adminAcl');

const navByPath = new Map(
  (Array.isArray(NAV_ITEMS) ? NAV_ITEMS : [])
    .map((item) => [String(item && item.path || ''), item])
);

function requestIp(req) {
  const forwarded = String((req && req.headers && req.headers['x-forwarded-for']) || '').trim();
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req && req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function requestPath(req) {
  try {
    return new URL(String((req && req.url) || '/'), 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function inferModule(eventType = '', pathname = '', payload = {}) {
  if (payload.audit_module) return String(payload.audit_module);
  const pagePath = inferPagePath(pathname, payload);
  const navItem = navByPath.get(pagePath);
  if (navItem && navItem.group) return String(navItem.group);
  const type = String(eventType || '');
  if (type.startsWith('auth.')) return '权限管理';
  if (type.startsWith('admin.tools.')) return '工具管理';
  if (type.startsWith('audit.')) return '资产审计';
  if (pathname.startsWith('/api/admin/auth')) return '权限管理';
  if (pathname.startsWith('/api/admin/tools')) return '工具管理';
  if (pathname.startsWith('/api/admin/audit')) return '资产审计';
  return '系统';
}

function inferPagePath(pathname = '', payload = {}) {
  if (payload.audit_page_path) return String(payload.audit_page_path);
  if (payload.audit_page) {
    const explicit = String(payload.audit_page);
    if (explicit.startsWith('/admin/')) return explicit;
  }
  if (pathname.startsWith('/api/admin/auth')) return '/admin/auth-members.html';
  if (pathname.startsWith('/api/admin/tools')) return '/admin/tools.html';
  if (pathname.startsWith('/api/admin/audit')) return '/admin/logs-admin.html';
  if (pathname.startsWith('/api/admin/runtime/')) return '/admin/runtime.html';
  if (pathname.startsWith('/api/auth/')) return '/admin/login.html';
  return pathname || '/';
}

function inferPage(pathname = '', payload = {}) {
  if (payload.audit_page) {
    const explicit = String(payload.audit_page);
    if (!explicit.startsWith('/admin/')) return explicit;
  }
  const pagePath = inferPagePath(pathname, payload);
  const navItem = navByPath.get(pagePath);
  if (navItem && navItem.label) return String(navItem.label);
  return pagePath;
}

function inferAction(eventType = '', payload = {}) {
  if (payload.audit_action) return String(payload.audit_action);
  if (payload.action) return String(payload.action);
  return String(eventType || 'unknown');
}

function inferResource(payload = {}) {
  if (payload.audit_resource) return String(payload.audit_resource);
  if (payload.resource) return String(payload.resource);
  if (payload.serviceId) return `mcp:${payload.serviceId}`;
  if (payload.userId) return `user:${payload.userId}`;
  if (payload.role) return `role:${payload.role}`;
  if (payload.anchorId) return `anchor:${payload.anchorId}`;
  return null;
}

function buildHttpAuditPayload(params = {}) {
  const req = params.req || null;
  const session = params.session || null;
  const eventType = String(params.eventType || '');
  const payload = params.payload && typeof params.payload === 'object' ? params.payload : {};
  const pathname = requestPath(req);
  const actor = session && session.user ? session.user : null;
  const result = payload.audit_result || payload.result || (eventType.endsWith('.failed') ? 'failed' : 'succeeded');

  return {
    ...payload,
    actor_id: payload.actor_id || payload.actorUserId || (actor ? actor.id : 'unknown'),
    actor_name: payload.actor_name || payload.updatedBy || payload.username || (actor ? actor.username : 'unknown'),
    actor_role: payload.actor_role || payload.actorRole || (actor ? actor.role : 'unknown'),
    ip: payload.ip || requestIp(req),
    audit_module: inferModule(eventType, pathname, payload),
    audit_page: inferPage(pathname, payload),
    audit_page_path: inferPagePath(pathname, payload),
    audit_action: inferAction(eventType, payload),
    audit_resource: inferResource(payload),
    audit_result: String(result),
    request_path: pathname,
    request_method: String((req && req.method) || 'UNKNOWN')
  };
}

module.exports = {
  buildHttpAuditPayload
};
