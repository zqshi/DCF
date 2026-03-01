const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('front login page supports sso entry', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public', 'front-login.html');
  const jsFile = path.resolve(__dirname, '..', 'public', 'front-login.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');

  assert.equal(html.includes('id="ssoLoginForm"'), true);
  assert.equal(html.includes('id="ssoUsername"'), true);
  assert.equal(html.includes('id="ssoPassword"'), true);
  assert.equal(html.includes('id="ssoBridgeToken"'), true);
  assert.equal(html.includes('id="ssoAuthorizeBtn"'), true);
  assert.equal(html.includes('id="frontBrandLogo"'), true);
  assert.equal(html.includes('id="frontBrandName"'), true);
  assert.equal(html.includes('id="frontBrandSlogan"'), true);
  assert.equal(html.includes('<h1>登录</h1>'), true);
  assert.equal(html.includes('推荐优先使用企业授权登录；联调阶段可使用桥接模式。'), false);
  assert.equal(html.includes('admin / admin123'), true);
  assert.equal(html.includes('ops / ops123'), false);
  assert.equal(js.includes('/api/auth/sso/bridge-login'), true);
  assert.equal(js.includes('/api/auth/login'), true);
  assert.equal(js.includes('/api/auth/sso/authorize'), true);
  assert.equal(js.includes('brandPrimary'), true);
  assert.equal(js.includes("root.style.setProperty('--brand-1'"), true);
});

test('front stage shows current account avatar and logout action', () => {
  const htmlFile = path.resolve(__dirname, '..', 'public', 'front.html');
  const jsFile = path.resolve(__dirname, '..', 'public', 'front.js');
  const html = fs.readFileSync(htmlFile, 'utf8');
  const js = fs.readFileSync(jsFile, 'utf8');

  assert.equal(html.includes('id="frontUserAvatar"'), true);
  assert.equal(html.includes('id="frontUserToggle"'), true);
  assert.equal(html.includes('id="frontUserAccount"'), true);
  assert.equal(html.includes('id="frontLogoutBtn"'), true);
  assert.equal(html.includes('id="frontAdminEntry"'), true);
  assert.equal(html.includes('target="_blank"'), true);
  assert.equal(html.includes('name="email"'), false);
  assert.equal(html.includes('id="employeeRoleInput"'), true);
  assert.equal(html.includes('name="role" placeholder="默认带出创建人岗位（自动补“实习生”），可修改" required'), true);
  assert.equal(html.includes('<title>员工工作台</title>'), true);
  assert.equal(html.includes('<h1>员工</h1>'), true);
  assert.equal(html.includes('>创建员工<'), true);
  assert.equal(html.includes('>发送<'), true);
  assert.equal(html.includes('发送指令'), false);
  assert.equal(html.includes('创建数字员工'), false);
  assert.equal(js.includes('/api/auth/logout'), true);
  assert.equal(js.includes('/front-login.html'), true);
  assert.equal(js.includes('hasAdminConsoleAccess'), true);
  assert.equal(js.includes('function resolveCreatorPosition()'), true);
  assert.equal(js.includes('normalized.endsWith("实习生") ? normalized : `${normalized}实习生`'), true);
  assert.equal(js.includes('const roleInput = document.getElementById("employeeRoleInput");'), true);
  assert.equal(js.includes('role: String(raw.role || resolveCreatorPosition() || "").trim()'), true);
  assert.equal(js.includes('showMsg("已发送")'), true);
  assert.equal(js.includes('showMsg("指令已发送")'), false);
  assert.equal(js.includes('showMsg("请先创建员工", true)'), true);
  assert.equal(js.includes('showMsg("请先创建数字员工", true)'), false);
  assert.equal(js.includes('email: String(raw.email || "").trim()'), false);
  assert.equal(js.includes('/api/auth/sso/knowledge-bridge-login'), true);
  assert.equal(js.includes('/api/auth/sso/knowledge-bridge-url'), true);
  assert.equal(js.includes('/api/front/knowledge/probe'), true);
  assert.equal(js.includes('请先启动 Docker 与 WeKnora'), false);
  assert.equal(js.includes('showMsg(message, true);'), true);
  assert.equal(js.includes('window.open("", "_blank")'), true);
  assert.equal(js.includes('btn.classList.toggle("is-disabled", !enabled);'), true);
  assert.equal(js.includes('const enabled = entryUrl.length > 0;'), true);
  assert.equal(js.includes('btn.removeAttribute("aria-disabled");'), true);
  assert.equal(js.includes('btn.setAttribute("aria-disabled", "true");'), true);
});

test('weknora bridge runtime config keeps chinese default brand and stable bridge guard', () => {
  const configFile = path.resolve(__dirname, '..', 'vendor', 'WeKnora', 'frontend', 'public', 'config.js');
  const config = fs.readFileSync(configFile, 'utf8');

  assert.equal(config.includes('savedLocale === "en-US"'), true);
  assert.equal(config.includes('localStorage.setItem("locale", "zh-CN")'), true);
  assert.equal(config.includes('dcf_weknora_bridge_busy_since'), true);
  assert.equal(config.includes('new MutationObserver'), true);
  assert.equal(config.includes('document.title = "知识库"'), true);
  assert.equal(config.includes('function dcfFaviconDataUri()'), true);
  assert.equal(config.includes('dcf-brand-title'), true);
  assert.equal(config.includes('DIGITAL CREW FACTORY'), true);
  assert.equal(config.includes('function removeExternalMenuEntries()'), true);
  assert.equal(config.includes('API文档'), true);
  assert.equal(config.includes('官方网站'), true);
  assert.equal(config.includes('GitHub'), true);
});
