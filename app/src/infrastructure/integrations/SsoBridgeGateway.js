const { randomUUID } = require('crypto');

class SsoBridgeGateway {
  constructor(env = process.env) {
    this.nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
    this.enabled = String(env.AUTH_SSO_ENABLED || '').trim() === '1';
    this.provider = String(env.AUTH_SSO_PROVIDER || '').trim() || 'external-sso';
    this.authorizeUrl = String(env.AUTH_SSO_AUTHORIZE_URL || '').trim();
    this.clientId = String(env.AUTH_SSO_CLIENT_ID || '').trim();
    this.defaultScope = String(env.AUTH_SSO_SCOPE || 'openid profile email').trim();
    this.tokenExchangeUrl = String(env.AUTH_SSO_TOKEN_EXCHANGE_URL || '').trim();
    this.clientSecret = String(env.AUTH_SSO_CLIENT_SECRET || '').trim();
    this.timeoutMs = Math.max(1000, Number(env.AUTH_SSO_TIMEOUT_MS || 10000));
    this.bridgeToken = String(env.AUTH_SSO_BRIDGE_TOKEN || '').trim();
    this.bridgeAllow = String(env.AUTH_SSO_BRIDGE_ALLOW || '').trim() === '1';
  }

  isEnabled() {
    return this.enabled;
  }

  capabilities() {
    return {
      enabled: this.enabled,
      provider: this.provider,
      mode: 'bridge-reserved',
      authorizeConfigured: Boolean(this.authorizeUrl && this.clientId),
      tokenExchangeConfigured: Boolean(this.tokenExchangeUrl),
      bridgeLoginConfigured: Boolean(this.bridgeToken),
      bridgeLoginEnabled: this.bridgeAllow && Boolean(this.bridgeToken),
      callbackImplemented: this.enabled,
      tokenExchangeImplemented: this.enabled && (
        Boolean(this.tokenExchangeUrl)
        || (this.bridgeAllow && Boolean(this.bridgeToken))
      ),
      requires: [
        'AUTH_SSO_ENABLED=1',
        'AUTH_SSO_PROVIDER',
        'AUTH_SSO_AUTHORIZE_URL',
        'AUTH_SSO_CLIENT_ID',
        'AUTH_SSO_TOKEN_EXCHANGE_URL (or bridge mode)',
        'AUTH_SSO_BRIDGE_TOKEN',
        'AUTH_SSO_BRIDGE_ALLOW=1 (bridge mode only, recommended non-production)'
      ]
    };
  }

  ensureEnabled() {
    if (this.enabled) return;
    throw new Error('sso bridge is disabled');
  }

  buildAuthorizeUrl(input = {}) {
    this.ensureEnabled();
    if (!this.authorizeUrl || !this.clientId) {
      throw new Error('sso authorize config missing');
    }
    const redirectUri = String(input.redirectUri || '').trim();
    if (!redirectUri) throw new Error('redirectUri is required');
    const state = String(input.state || randomUUID()).trim();
    const scope = String(input.scope || this.defaultScope).trim() || this.defaultScope;
    const nonce = String(input.nonce || randomUUID()).trim();
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope,
      state,
      nonce
    });
    return {
      provider: this.provider,
      authorizeUrl: `${this.authorizeUrl}${this.authorizeUrl.includes('?') ? '&' : '?'}${params.toString()}`,
      state,
      nonce
    };
  }

  verifyBridgeToken(req) {
    this.ensureEnabled();
    if (!this.bridgeAllow) throw new Error('sso bridge login is disabled');
    if (!this.bridgeToken) throw new Error('sso bridge token is not configured');
    const got = String(req.headers['x-sso-bridge-token'] || '').trim();
    return got && got === this.bridgeToken;
  }

  handleCallback(query = {}) {
    this.ensureEnabled();
    const code = String(query.code || '').trim();
    const state = String(query.state || '').trim();
    const error = String(query.error || '').trim();
    const errorDescription = String(query.error_description || query.errorDescription || '').trim();
    if (error) {
      const details = errorDescription ? `${error}: ${errorDescription}` : error;
      throw new Error(`sso callback failed: ${details}`);
    }
    if (!code) throw new Error('code is required');
    return {
      ok: true,
      provider: this.provider,
      code,
      state: state || null,
      exchangeRequired: true,
      tokenExchangeMode: this.tokenExchangeUrl ? 'idp-token-exchange' : 'bridge-token-exchange',
      tokenExchangeEndpoint: '/api/auth/sso/token-exchange'
    };
  }

  normalizeIdentity(input = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const username = String(
      src.username
      || src.preferred_username
      || src.user_name
      || src.login
      || src.email
      || ''
    ).trim();
    const tenantId = String(src.tenantId || src.tenant_id || '').trim();
    const accountId = String(src.accountId || src.account_id || '').trim();
    return {
      username,
      tenantId: tenantId || null,
      accountId: accountId || null
    };
  }

  async exchangeCodeForIdentity(req, input = {}) {
    this.ensureEnabled();
    const code = String(input.code || '').trim();
    if (!code) throw new Error('code is required for token exchange');

    if (this.tokenExchangeUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const payload = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.clientId
      });
      const redirectUri = String(input.redirectUri || '').trim();
      if (redirectUri) payload.set('redirect_uri', redirectUri);
      if (this.clientSecret) payload.set('client_secret', this.clientSecret);

      try {
        const response = await fetch(this.tokenExchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: payload.toString(),
          signal: controller.signal
        });
        const text = await response.text();
        let json = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = {};
        }
        if (!response.ok) {
          const message = String(json.error_description || json.error || `token exchange failed: ${response.status}`);
          throw new Error(message);
        }
        const identity = this.normalizeIdentity(json);
        if (!identity.username) throw new Error('token exchange response missing username');
        return identity;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(`sso token exchange timeout after ${this.timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    // Bridge fallback mode for local or staged integration without direct IdP connection.
    if (!this.verifyBridgeToken(req)) {
      const error = new Error('invalid sso bridge token');
      error.statusCode = 403;
      throw error;
    }
    const identity = this.normalizeIdentity(input);
    if (!identity.username) throw new Error('username is required for bridge token exchange');
    return identity;
  }
}

module.exports = {
  SsoBridgeGateway
};
