const test = require('node:test');
const assert = require('node:assert/strict');
const { LlmDialogueGateway } = require('../src/infrastructure/integrations/LlmDialogueGateway');

test('llm dialogue gateway is disabled without api key', () => {
  const gw = new LlmDialogueGateway({ apiKey: '' });
  assert.equal(gw.isEnabled(), false);
});

test('llm dialogue gateway calls responses api and returns text', async () => {
  const originalFetch = global.fetch;
  let called = 0;
  global.fetch = async (url, options = {}) => {
    called += 1;
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body || '{}');
    assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal(String(body.input || '').includes('【系统声明：独立人格行为范式】'), true);
    assert.equal(String(body.input || '').includes('真实性约束'), true);
    assert.equal(String(body.input || '').includes('禁止编造已完成事实'), true);
    return {
      ok: true,
      async json() {
        return { output_text: '我先给你结论，再补关键依据。' };
      }
    };
  };

  try {
    const gw = new LlmDialogueGateway({ apiKey: 'sk-test', timeoutMs: 2000 });
    const text = await gw.generateReply({ goal: '请汇总今日异常' });
    assert.equal(called, 1);
    assert.equal(text, '我先给你结论，再补关键依据。');
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway returns empty on non-ok response', async () => {
  const originalFetch = global.fetch;
  let count = 0;
  global.fetch = async (url) => {
    count += 1;
    if (String(url).endsWith('/v1/responses')) {
      return {
        ok: false,
        status: 401,
        async json() {
          return { error: { message: 'bad key' } };
        }
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return {};
      }
    };
  };
  try {
    const gw = new LlmDialogueGateway({ apiKey: 'sk-test' });
    const text = await gw.generateReply({ goal: 'x' });
    assert.equal(count >= 1, true);
    assert.equal(text, '');
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway does not fallback to chat completions', async () => {
  const originalFetch = global.fetch;
  let called = 0;
  global.fetch = async (url) => {
    called += 1;
    if (String(url).endsWith('/v1/responses')) {
      return {
        ok: false,
        status: 404,
        async json() {
          return {};
        }
      };
    }
    if (String(url).endsWith('/v1/chat/completions')) {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: '我会先给结论，再补执行清单。'
                }
              }
            ]
          };
        }
      };
    }
    return { ok: false, status: 500, async json() { return {}; } };
  };
  try {
    const gw = new LlmDialogueGateway({ apiKey: 'sk-test' });
    const text = await gw.generateReply({ goal: 'x' });
    assert.equal(called, 1);
    assert.equal(text, '');
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway normalizes baseUrl ending with /v1', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(String(url), 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses');
    return {
      ok: true,
      async json() {
        return { output_text: 'ok' };
      }
    };
  };
  try {
    const gw = new LlmDialogueGateway({
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    });
    const text = await gw.generateReply({ goal: 'x' });
    assert.equal(text, 'ok');
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway includes network error details for diagnostics', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  try {
    const gw = new LlmDialogueGateway({
      apiKey: 'sk-test',
      baseUrl: 'http://127.0.0.1:9999'
    });
    const text = await gw.generateReply({ goal: 'x' });
    assert.equal(text, '');
    assert.match(String(gw.lastError || ''), /network_error:ECONNREFUSED/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway retries once on timeout before failing over', async () => {
  const originalFetch = global.fetch;
  let responsesCalls = 0;
  global.fetch = async (url) => {
    if (String(url).endsWith('/v1/responses')) {
      responsesCalls += 1;
      if (responsesCalls === 1) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        async json() {
          return { output_text: '重试后成功' };
        }
      };
    }
    return { ok: false, status: 500, async json() { return {}; } };
  };

  try {
    const gw = new LlmDialogueGateway({ apiKey: 'sk-test' });
    const text = await gw.generateReply({ goal: 'x' });
    assert.equal(responsesCalls, 2);
    assert.equal(text, '重试后成功');
    assert.equal(gw.lastError, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway includes conversation history in prompt', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body || '{}');
    const prompt = String(body.input || '');
    assert.equal(prompt.includes('当前会话消息历史'), true);
    assert.equal(prompt.includes('消息#1 user: 第一轮提问'), true);
    assert.equal(prompt.includes('消息#2 assistant: 第一轮回答'), true);
    return {
      ok: true,
      async json() {
        return { output_text: 'ok' };
      }
    };
  };
  try {
    const gw = new LlmDialogueGateway({ apiKey: 'sk-test' });
    const text = await gw.generateReply({
      goal: '继续追问',
      history: [
        { role: 'user', content: '第一轮提问' },
        { role: 'assistant', content: '第一轮回答' }
      ]
    });
    assert.equal(text, 'ok');
  } finally {
    global.fetch = originalFetch;
  }
});

test('llm dialogue gateway follows user language for english goal', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body || '{}');
    const prompt = String(body.input || '');
    assert.equal(prompt.includes('Language rule: reply in English by default'), true);
    return {
      ok: true,
      async json() {
        return { output_text: 'I will summarize key exceptions first.' };
      }
    };
  };
  try {
    const gw = new LlmDialogueGateway({ apiKey: 'sk-test' });
    const text = await gw.generateReply({ goal: 'Please summarize today incidents' });
    assert.equal(text, 'I will summarize key exceptions first.');
  } finally {
    global.fetch = originalFetch;
  }
});
