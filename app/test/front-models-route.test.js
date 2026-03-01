const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/interfaces/http/createApp');

async function requestJson(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function loginAndCookie(base, username, password) {
  const login = await requestJson(base, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('front models endpoint requires auth and returns configured model list', async () => {
  const oldFrontModels = process.env.FRONT_LLM_MODELS;
  const oldOpenAiModel = process.env.OPENAI_MODEL;
  process.env.FRONT_LLM_MODELS = 'anthropic/claude-opus-4-6, openai/gpt-4.1-mini';
  process.env.OPENAI_MODEL = 'openai/gpt-4.1-mini';

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const unauthorized = await requestJson(base, '/api/front/models');
    assert.equal(unauthorized.status, 401);

    const cookie = await loginAndCookie(base, 'admin', 'admin123');
    const models = await requestJson(base, '/api/front/models', {
      headers: { Cookie: cookie }
    });
    assert.equal(models.status, 200);
    assert.equal(Array.isArray(models.body), true);
    assert.equal(models.body.includes('anthropic/claude-opus-4-6'), true);
    assert.equal(models.body.includes('openai/gpt-4.1-mini'), true);
  } finally {
    if (typeof oldFrontModels === 'undefined') delete process.env.FRONT_LLM_MODELS;
    else process.env.FRONT_LLM_MODELS = oldFrontModels;
    if (typeof oldOpenAiModel === 'undefined') delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = oldOpenAiModel;
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('front models endpoint reads responseModel from object-literal openclaw config', async () => {
  const oldFrontModels = process.env.FRONT_LLM_MODELS;
  const oldOpenAiModel = process.env.OPENAI_MODEL;
  const oldLlmModel = process.env.LLM_MODEL;
  const oldOpenClawConfig = process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.FRONT_LLM_MODELS;
  delete process.env.OPENAI_MODEL;
  process.env.LLM_MODEL = 'deepseek-chat';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-front-models-'));
  const configPath = path.join(tempDir, 'openclaw.json');
  fs.writeFileSync(configPath, `{
  plugins: {
    entries: {
      "dcf-runtime": {
        config: {
          responseModel: "openclaw:main"
        }
      }
    }
  }
}`, 'utf8');
  process.env.OPENCLAW_CONFIG_PATH = configPath;

  const server = await createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const cookie = await loginAndCookie(base, 'admin', 'admin123');
    const models = await requestJson(base, '/api/front/models', {
      headers: { Cookie: cookie }
    });
    assert.equal(models.status, 200);
    assert.equal(Array.isArray(models.body), true);
    assert.equal(models.body.includes('deepseek-chat'), true);
    assert.equal(models.body.includes('openclaw:main'), false);
  } finally {
    if (typeof oldFrontModels === 'undefined') delete process.env.FRONT_LLM_MODELS;
    else process.env.FRONT_LLM_MODELS = oldFrontModels;
    if (typeof oldOpenAiModel === 'undefined') delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = oldOpenAiModel;
    if (typeof oldLlmModel === 'undefined') delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = oldLlmModel;
    if (typeof oldOpenClawConfig === 'undefined') delete process.env.OPENCLAW_CONFIG_PATH;
    else process.env.OPENCLAW_CONFIG_PATH = oldOpenClawConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
    await server.shutdown();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
