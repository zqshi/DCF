(function () {
  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '登录失败');
    return body;
  }

  const tabBridge = document.getElementById('tabBridge');
  const tabAuthorize = document.getElementById('tabAuthorize');
  const bridgeForm = document.getElementById('bridgeLoginForm');
  const authorizePanel = document.getElementById('authorizePanel');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const tokenInput = document.getElementById('ssoBridgeToken');
  const loginBtn = document.getElementById('bridgeLoginBtn');
  const ssoAuthorizeBtn = document.getElementById('ssoAuthorizeBtn');
  const capsNode = document.getElementById('ssoCapabilities');
  const errorEl = document.getElementById('error');
  const next = new URLSearchParams(window.location.search).get('next') || '/admin/index.html';
  let mode = 'bridge';

  function showError(message) {
    errorEl.textContent = String(message || '');
  }

  function setMode(nextMode) {
    mode = nextMode === 'authorize' ? 'authorize' : 'bridge';
    const isAuthorize = mode === 'authorize';
    tabBridge.classList.toggle('active', !isAuthorize);
    tabAuthorize.classList.toggle('active', isAuthorize);
    bridgeForm.classList.toggle('hidden', isAuthorize);
    authorizePanel.classList.toggle('hidden', !isAuthorize);
    showError('');
  }

  function setLoading(btn, loading, text) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originText = btn.textContent || '';
      btn.textContent = text || '处理中...';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    if (btn.dataset.originText) btn.textContent = btn.dataset.originText;
  }

  async function loadSsoCapabilities() {
    try {
      const caps = await api('/api/auth/sso/capabilities');
      const canBridge = caps && caps.enabled && caps.bridgeLoginEnabled;
      const canAuthorize = caps && caps.enabled && caps.authorizeConfigured;
      const items = [];
      if (caps && caps.provider) items.push(`SSO 提供方: ${caps.provider}`);
      items.push(canBridge ? '桥接登录已启用' : '桥接登录未启用');
      items.push(canAuthorize ? '企业授权已配置' : '企业授权未配置');
      capsNode.innerHTML = items.map((text) => `<span class="cap">${text}</span>`).join('');
      ssoAuthorizeBtn.disabled = !canAuthorize;
      ssoAuthorizeBtn.title = canAuthorize ? '' : '当前环境未配置企业 SSO 授权地址';
    } catch {
      capsNode.innerHTML = '<span class="cap">无法读取 SSO 能力配置</span>';
      ssoAuthorizeBtn.disabled = true;
      ssoAuthorizeBtn.title = '无法读取 SSO 能力配置';
    }
  }

  bridgeForm.onsubmit = async (event) => {
    event.preventDefault();
    showError('');
    const username = String(usernameInput.value || '').trim();
    const password = String(passwordInput.value || '').trim();
    const bridgeToken = String(tokenInput.value || '').trim();

    if (!username) return showError('请输入账号');
    try {
      setLoading(loginBtn, true, '登录中...');
      // Testing path: local account/password login first; fallback to bridge token login.
      if (password) {
        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
      } else if (bridgeToken) {
        await api('/api/auth/sso/bridge-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sso-bridge-token': bridgeToken
          },
          body: JSON.stringify({ username })
        });
      } else {
        throw new Error('请输入密码，或填写 SSO Bridge Token 使用桥接登录');
      }
      window.location.href = next;
    } catch (error) {
      showError(error.message);
    } finally {
      setLoading(loginBtn, false);
    }
  };

  ssoAuthorizeBtn.onclick = async () => {
    showError('');
    try {
      setLoading(ssoAuthorizeBtn, true, '跳转中...');
      const redirectUri = `${window.location.origin}/admin/login.html`;
      const payload = await api(`/api/auth/sso/authorize?redirectUri=${encodeURIComponent(redirectUri)}`);
      if (!payload || !payload.authorizeUrl) throw new Error('企业 SSO 授权地址不可用');
      window.location.href = payload.authorizeUrl;
    } catch (error) {
      showError(error.message);
      setLoading(ssoAuthorizeBtn, false);
    }
  };

  tabBridge.onclick = () => setMode('bridge');
  tabAuthorize.onclick = () => setMode('authorize');
  setMode(mode);
  loadSsoCapabilities();
})();
