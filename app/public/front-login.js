(function () {
  const USERNAME_KEY = 'front-login:last-username';
  const BRANDING_KEY = 'front-login:branding';
  let redirectingToFallback = false;

  function resolveFallbackFrontLoginUrl() {
    if (typeof buildFrontApiCandidates !== 'function') return '';
    try {
      const candidates = buildFrontApiCandidates('/api/auth/me', window.location.pathname, window.location);
      const absolute = candidates.find((item) => /^https?:\/\//i.test(String(item || '')));
      if (!absolute) return '';
      const origin = new URL(absolute).origin;
      if (!origin || origin === window.location.origin) return '';
      return `${origin}/front-login.html${window.location.search || ''}`;
    } catch {
      return '';
    }
  }

  function redirectToFallbackIfNeeded() {
    if (redirectingToFallback) return false;
    const fallbackUrl = resolveFallbackFrontLoginUrl();
    if (!fallbackUrl) return false;
    redirectingToFallback = true;
    window.location.replace(fallbackUrl);
    return true;
  }

  async function api(path, options) {
    const candidates = typeof buildFrontApiCandidates === 'function'
      ? buildFrontApiCandidates(path, window.location.pathname, window.location)
      : [path];
    const requestOptions = { headers: { 'Content-Type': 'application/json' }, ...options };
    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const requestPath = candidates[index];
      try {
        const res = await fetch(requestPath, requestOptions);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'SSO 登录失败');
        return body;
      } catch (error) {
        lastError = error;
        const hasFallback = index < candidates.length - 1;
        if (hasFallback) continue;
      }
    }
    if (redirectToFallbackIfNeeded()) {
      throw new Error('当前登录地址未连接后端，正在切换到可用地址...');
    }
    throw lastError || new Error('SSO 登录失败');
  }

  const form = document.getElementById('ssoLoginForm');
  const errorEl = document.getElementById('ssoError');
  const authorizeBtn = document.getElementById('ssoAuthorizeBtn');
  const bridgeBtn = document.getElementById('ssoBridgeLoginBtn');
  const usernameInput = document.getElementById('ssoUsername');
  const passwordInput = document.getElementById('ssoPassword');
  const bridgeTokenInput = document.getElementById('ssoBridgeToken');
  const capabilitiesEl = document.getElementById('capabilities');
  const tabBridge = document.getElementById('tabBridge');
  const tabAuthorize = document.getElementById('tabAuthorize');
  const bridgePanel = document.getElementById('bridgePanel');
  const authorizePanel = document.getElementById('authorizePanel');
  const next = new URLSearchParams(window.location.search).get('next') || '/front.html';
  let currentMode = 'bridge';
  let bridgeLoginEnabled = false;

  function safeColor(input, fallback) {
    const value = String(input || '').trim();
    if (!value) return fallback;
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
    return fallback;
  }

  function readBrandingQuery() {
    const query = new URLSearchParams(window.location.search);
    const hasBranding = ['brandName', 'brandSlogan', 'brandLogo', 'brandPrimary', 'brandSecondary', 'brandAccent']
      .some((key) => String(query.get(key) || '').trim() !== '');
    if (!hasBranding) return null;
    return {
      brandName: String(query.get('brandName') || '').trim(),
      brandSlogan: String(query.get('brandSlogan') || '').trim(),
      brandLogo: String(query.get('brandLogo') || '').trim(),
      brandPrimary: safeColor(query.get('brandPrimary'), '#0f7f6d'),
      brandSecondary: safeColor(query.get('brandSecondary'), '#0a6357'),
      brandAccent: safeColor(query.get('brandAccent'), '#2f75ff')
    };
  }

  function loadBranding() {
    const fromQuery = readBrandingQuery();
    if (fromQuery) {
      localStorage.setItem(BRANDING_KEY, JSON.stringify(fromQuery));
      return fromQuery;
    }
    try {
      const raw = localStorage.getItem(BRANDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function applyBranding() {
    const branding = loadBranding();
    if (!branding) return;

    const root = document.documentElement;
    root.style.setProperty('--brand-1', safeColor(branding.brandPrimary, '#0f7f6d'));
    root.style.setProperty('--brand-2', safeColor(branding.brandSecondary, '#0a6357'));
    root.style.setProperty('--accent-1', safeColor(branding.brandAccent, '#2f75ff'));

    const brandNameNode = document.getElementById('frontBrandName');
    const brandSloganNode = document.getElementById('frontBrandSlogan');
    const brandLogoNode = document.getElementById('frontBrandLogo');
    const brandLogoFallbackNode = document.getElementById('frontBrandLogoFallback');

    const brandName = String(branding.brandName || '').trim();
    const brandSlogan = String(branding.brandSlogan || '').trim();
    const brandLogo = String(branding.brandLogo || '').trim();

    if (brandName && brandNameNode) brandNameNode.textContent = brandName;
    if (brandSlogan && brandSloganNode) brandSloganNode.textContent = brandSlogan;
    if (brandLogo && brandLogoNode && brandLogoFallbackNode) {
      brandLogoNode.src = brandLogo;
      brandLogoNode.style.display = 'block';
      brandLogoFallbackNode.style.display = 'none';
    } else if (brandName && brandLogoFallbackNode) {
      brandLogoFallbackNode.textContent = brandName.slice(0, 4).toUpperCase();
    }
  }

  function showError(message) {
    errorEl.textContent = String(message || '');
  }

  function setLoading(button, loading, text) {
    if (!button) return;
    if (loading) {
      button.dataset.originText = button.textContent || '';
      button.dataset.loading = '1';
      button.textContent = text || '处理中...';
      button.disabled = true;
      return;
    }
    button.dataset.loading = '0';
    button.disabled = false;
    if (button.dataset.originText) button.textContent = button.dataset.originText;
    if (button === bridgeBtn) updateBridgeSubmitState();
  }

  function setMode(mode) {
    currentMode = mode === 'authorize' ? 'authorize' : 'bridge';
    const isAuthorize = currentMode === 'authorize';
    tabBridge.classList.toggle('active', !isAuthorize);
    tabAuthorize.classList.toggle('active', isAuthorize);
    bridgePanel.classList.toggle('hidden', isAuthorize);
    authorizePanel.classList.toggle('hidden', !isAuthorize);
  }

  function resolveBridgeToken() {
    const query = new URLSearchParams(window.location.search);
    const fromQuery = String(query.get('bridgeToken') || '').trim();
    if (fromQuery) return fromQuery;
    return String(bridgeTokenInput.value || '').trim();
  }

  function updateBridgeSubmitState() {
    if (!bridgeBtn) return;
    if (bridgeBtn.dataset.loading === '1') return;
    const username = String(usernameInput.value || '').trim();
    const password = String(passwordInput.value || '').trim();
    const bridgeToken = resolveBridgeToken();
    const canUsePassword = Boolean(username && password);
    const canUseBridge = Boolean(username && bridgeToken && bridgeLoginEnabled);
    bridgeBtn.disabled = !(canUsePassword || canUseBridge);
    if (!username) {
      bridgeBtn.title = '请输入员工账号';
      return;
    }
    if (password) {
      bridgeBtn.title = '';
      return;
    }
    if (bridgeToken && !bridgeLoginEnabled) {
      bridgeBtn.title = '当前环境未开启桥接登录';
      return;
    }
    bridgeBtn.title = '请输入密码，或在桥接模式下提供 Bridge Token';
  }

  async function loadSsoCapabilities() {
    try {
      const caps = await api('/api/auth/sso/capabilities');
      const canAuthorize = caps && caps.enabled && caps.authorizeConfigured;
      const canBridge = caps && caps.enabled && caps.bridgeLoginEnabled;
      bridgeLoginEnabled = Boolean(canBridge);
      authorizeBtn.disabled = !canAuthorize;
      authorizeBtn.title = canAuthorize ? '' : '当前环境未配置企业 SSO 授权地址';
      updateBridgeSubmitState();

      const capsText = [];
      if (caps && caps.provider) capsText.push(`SSO 提供方: ${caps.provider}`);
      capsText.push(canAuthorize ? '企业授权已配置' : '企业授权未配置');
      capsText.push(canBridge ? '桥接登录已启用' : '桥接登录未启用');
      capabilitiesEl.innerHTML = capsText.map((text) => `<span class="cap">${text}</span>`).join('');
      if (canAuthorize) setMode('authorize');
    } catch {
      bridgeLoginEnabled = false;
      authorizeBtn.disabled = true;
      authorizeBtn.title = '无法获取 SSO 能力配置';
      updateBridgeSubmitState();
      capabilitiesEl.innerHTML = '<span class="cap">无法读取 SSO 能力配置</span>';
    }
  }

  function hydrateFromCache() {
    const query = new URLSearchParams(window.location.search);
    const byQuery = String(query.get('username') || '').trim();
    const byCache = String(localStorage.getItem(USERNAME_KEY) || '').trim();
    const username = byQuery || byCache;
    if (username) usernameInput.value = username;
    const token = String(query.get('bridgeToken') || '').trim();
    if (token) bridgeTokenInput.value = token;
    updateBridgeSubmitState();
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (currentMode !== 'bridge') {
      setMode('bridge');
    }
    showError('');
    const username = String(usernameInput.value || '').trim();
    const password = String(passwordInput.value || '').trim();
    const bridgeToken = resolveBridgeToken();
    if (!username) {
      showError('请输入员工账号');
      return;
    }
    if (!password && !bridgeToken) {
      showError('请输入账号密码');
      return;
    }
    try {
      setLoading(bridgeBtn, true, '登录中...');
      if (password) {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
      } else {
        if (!bridgeLoginEnabled) {
          throw new Error('当前环境未开启桥接登录，请改用账号密码登录');
        }
        await api('/api/auth/sso/bridge-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sso-bridge-token': bridgeToken
          },
          body: JSON.stringify({ username })
        });
      }
      localStorage.setItem(USERNAME_KEY, username);
      window.location.href = next;
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(bridgeBtn, false);
    }
  };

  usernameInput.addEventListener('input', updateBridgeSubmitState);
  passwordInput.addEventListener('input', updateBridgeSubmitState);
  bridgeTokenInput.addEventListener('input', updateBridgeSubmitState);

  authorizeBtn.onclick = async () => {
    setMode('authorize');
    showError('');
    try {
      setLoading(authorizeBtn, true, '跳转中...');
      const redirectUri = `${window.location.origin}/front-login.html`;
      const payload = await api(`/api/auth/sso/authorize?redirectUri=${encodeURIComponent(redirectUri)}`);
      if (!payload || !payload.authorizeUrl) {
        throw new Error('企业 SSO 授权地址不可用');
      }
      const username = String(usernameInput.value || '').trim();
      if (username) localStorage.setItem(USERNAME_KEY, username);
      window.location.href = payload.authorizeUrl;
    } catch (error) {
      showError(error.message);
      setLoading(authorizeBtn, false);
    }
  };

  tabBridge.onclick = () => setMode('bridge');
  tabAuthorize.onclick = () => setMode('authorize');
  applyBranding();
  hydrateFromCache();
  updateBridgeSubmitState();
  loadSsoCapabilities();
})();
