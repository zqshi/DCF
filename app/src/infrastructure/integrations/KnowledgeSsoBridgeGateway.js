const { createHmac, randomUUID } = require('node:crypto');

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function joinUrl(base, pathWithQuery) {
  const root = String(base || '').trim().replace(/\/+$/, '');
  const suffix = String(pathWithQuery || '').trim();
  if (!root) return suffix || '';
  if (!suffix) return root;
  if (suffix.startsWith('/')) return `${root}${suffix}`;
  return `${root}/${suffix}`;
}

function resolveUrl(base, pathWithQuery) {
  const rawBase = String(base || '').trim();
  const rawPath = String(pathWithQuery || '').trim();
  if (!rawBase) return rawPath;
  if (!rawPath) return rawBase;
  try {
    return new URL(rawPath, rawBase).toString();
  } catch {
    return joinUrl(rawBase, rawPath);
  }
}

class KnowledgeSsoBridgeGateway {
  constructor(env = process.env) {
    this.enabled = String(env.KNOWLEDGE_SSO_BRIDGE_ENABLED || '').trim() === '1';
    this.sharedSecret = String(env.KNOWLEDGE_SSO_BRIDGE_SHARED_SECRET || '').trim();
    this.weknoraWebUrl = String(env.WEKNORA_WEB_URL || '').trim().replace(/\/+$/, '');
    this.weknoraLoginPath = String(env.KNOWLEDGE_SSO_BRIDGE_LOGIN_PATH || '/login').trim() || '/login';
    this.ticketTtlSeconds = Math.max(30, Number(env.KNOWLEDGE_SSO_BRIDGE_TTL_SECONDS || 120));
    this.issuer = String(env.KNOWLEDGE_SSO_BRIDGE_ISSUER || 'dcf').trim() || 'dcf';
    this.audience = String(env.KNOWLEDGE_SSO_BRIDGE_AUDIENCE || 'weknora').trim() || 'weknora';
    this.defaultRedirect = String(env.KNOWLEDGE_SSO_BRIDGE_REDIRECT_PATH || '/platform/knowledge-bases').trim() || '/platform/knowledge-bases';
  }

  isEnabled() {
    return Boolean(this.enabled && this.sharedSecret && this.weknoraWebUrl);
  }

  sign(payloadSegment) {
    return createHmac('sha256', this.sharedSecret).update(payloadSegment).digest('base64url');
  }

  buildTicket(user = {}) {
    const username = String(user.username || '').trim();
    if (!username) throw new Error('knowledge sso bridge requires username');
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.issuer,
      aud: this.audience,
      iat: now,
      exp: now + this.ticketTtlSeconds,
      jti: randomUUID(),
      username,
      email: String(user.email || `${username}@dcf.local`).trim(),
      displayName: String(user.displayName || username).trim(),
      userId: String(user.id || '').trim(),
      tenantId: String(user.tenantId || '').trim(),
      accountId: String(user.accountId || '').trim()
    };
    const payloadSegment = base64UrlEncode(JSON.stringify(payload));
    return `${payloadSegment}.${this.sign(payloadSegment)}`;
  }

  buildLoginUrl(user = {}, redirectPath = '') {
    const ticket = this.buildTicket(user);
    const redirect = String(redirectPath || this.defaultRedirect).trim() || this.defaultRedirect;
    const query = new URLSearchParams({
      bridge_ticket: ticket,
      redirect
    });
    return resolveUrl(this.weknoraWebUrl, `${this.weknoraLoginPath}?${query.toString()}`);
  }
}

module.exports = {
  KnowledgeSsoBridgeGateway
};
