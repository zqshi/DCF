function normalizeScopedId(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${fieldName} is required`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,63}$/.test(raw)) {
    throw new Error(`${fieldName} format is invalid`);
  }
  return raw;
}

function normalizeAccessContext(input = {}, options = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const required = options.required !== false;
  const hasTenant = Object.prototype.hasOwnProperty.call(src, 'tenantId');
  const hasAccount = Object.prototype.hasOwnProperty.call(src, 'accountId');

  if (!hasTenant && !hasAccount && !required) return null;

  return {
    tenantId: normalizeScopedId(src.tenantId, 'tenantId'),
    accountId: normalizeScopedId(src.accountId, 'accountId'),
    actorUserId: src.actorUserId ? normalizeScopedId(src.actorUserId, 'actorUserId') : null,
    actorRole: String(src.actorRole || '').trim() || null
  };
}

function resolveFrontAccessContext(req, options = {}) {
  const required = options.required !== false;
  const tenantId = req.headers['x-tenant-id'];
  const accountId = req.headers['x-account-id'];
  const actorUserId = req.headers['x-actor-user-id'] || req.headers['x-user-id'] || null;
  return normalizeAccessContext({ tenantId, accountId, actorUserId }, { required });
}

function resolveSessionAccessContext(req, session, options = {}) {
  const required = options.required !== false;
  const requireBinding = options.requireBinding !== false;
  const current = session && session.user ? session.user : null;
  if (!current) {
    if (required) throw new Error('authentication is required');
    return null;
  }

  const tenantId = String(current.tenantId || '').trim();
  const accountId = String(current.accountId || '').trim();
  if (requireBinding && (!tenantId || !accountId)) {
    throw new Error('current session is not bound to tenant/account');
  }

  // Defense in depth: if caller passes tenant/account headers, they must match session scope.
  const headerTenant = String(req.headers['x-tenant-id'] || '').trim();
  const headerAccount = String(req.headers['x-account-id'] || '').trim();
  if (headerTenant && tenantId && headerTenant !== tenantId) throw new Error('tenant scope mismatch');
  if (headerAccount && accountId && headerAccount !== accountId) throw new Error('account scope mismatch');

  return normalizeAccessContext({
    tenantId,
    accountId,
    actorUserId: current.id || null,
    actorRole: current.role || null
  }, { required });
}

function matchAccessScope(entity = {}, accessContext = null) {
  if (!accessContext) return true;
  return String(entity.tenantId || '') === String(accessContext.tenantId || '')
    && String(entity.accountId || '') === String(accessContext.accountId || '');
}

function matchActorScope(entity = {}, accessContext = null, options = {}) {
  if (!accessContext) return true;
  const actorUserId = String(accessContext.actorUserId || '').trim();
  if (!actorUserId) return true;
  const fields = Array.isArray(options.fields) && options.fields.length > 0
    ? options.fields
    : ['actorUserId'];
  for (const field of fields) {
    const value = String(entity && entity[field] ? entity[field] : '').trim();
    if (!value) continue;
    return value === actorUserId;
  }
  return options.strict === true ? false : true;
}

module.exports = {
  normalizeAccessContext,
  resolveFrontAccessContext,
  resolveSessionAccessContext,
  matchAccessScope,
  matchActorScope
};
