const { createHash } = require('crypto');

function resolveRegistryTokens() {
  return String(process.env.REGISTRY_API_KEYS || '')
    .split(',')
    .map((x) => String(x || '').trim())
    .filter(Boolean);
}

function parseRegistryToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-registry-token'] || '').trim();
}

function requireRegistryAccess(req, res, json) {
  const allowedTokens = resolveRegistryTokens();
  if (!allowedTokens.length) {
    json(res, 503, { error: 'external registry is disabled' });
    return null;
  }
  const token = parseRegistryToken(req);
  if (!token || !allowedTokens.includes(token)) {
    json(res, 401, { error: 'invalid registry token' });
    return null;
  }
  const registrantId = String(req.headers['x-registrant-id'] || '').trim();
  const sourceSystem = String(req.headers['x-source-system'] || '').trim() || 'external-system';
  const tokenRef = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return {
    registrantId: registrantId || `registry-${tokenRef}`,
    sourceSystem
  };
}

async function handleRegistryRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    toolUC,
    skillUC,
    store
  } = context;

  if (url.pathname === '/api/registry/tools/register' && req.method === 'POST') {
    const registry = requireRegistryAccess(req, res, json);
    if (!registry) return true;
    const body = await parseBody(req);
    const created = toolUC.createMcpService({
      ...body,
      enabled: false,
      registrationStatus: 'pending',
      registrationSource: registry.sourceSystem,
      registrant: registry.registrantId
    }, {
      actor: `registry:${registry.registrantId}`
    });
    store.addEvent('registry.tool.registered', {
      serviceId: created.id,
      sourceSystem: registry.sourceSystem,
      registrantId: registry.registrantId,
      registrationStatus: created.registrationStatus,
      enabled: created.enabled
    });
    json(res, 202, created);
    return true;
  }

  if (url.pathname === '/api/registry/skills/register' && req.method === 'POST') {
    const registry = requireRegistryAccess(req, res, json);
    if (!registry) return true;
    const body = await parseBody(req);
    const proposed = skillUC.propose({
      ...body,
      source: body.source || `external-registry:${registry.sourceSystem}`,
      status: 'pending',
      note: body.note || `registered by ${registry.registrantId}`
    }, {
      userId: registry.registrantId,
      role: 'external_registry'
    });
    store.addEvent('registry.skill.registered', {
      skillId: proposed.id,
      sourceSystem: registry.sourceSystem,
      registrantId: registry.registrantId,
      skillType: proposed.type,
      registrationStatus: proposed.status
    });
    json(res, 202, proposed);
    return true;
  }

  return false;
}

module.exports = {
  handleRegistryRoutes,
  parseRegistryToken,
  requireRegistryAccess,
  resolveRegistryTokens
};
