const test = require('node:test');
const assert = require('node:assert/strict');
const { WebRetrievalGateway } = require('../src/infrastructure/integrations/WebRetrievalGateway');

test('web retrieval gateway reads RSS feed from homepage alternate links', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://tisi.org/') {
      return {
        ok: true,
        status: 200,
        text: async () => '<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head><body></body></html>'
      };
    }
    if (String(url) === 'https://tisi.org/rss.xml') {
      return {
        ok: true,
        status: 200,
        text: async () => [
          '<?xml version="1.0"?>',
          '<rss><channel>',
          '<item><title>AI Agent 发布</title><link>https://tisi.org/p/1</link><description>桌面Agent能力</description><pubDate>Tue, 24 Feb 2026 10:00:00 GMT</pubDate></item>',
          '<item><title>其他主题</title><link>https://tisi.org/p/2</link><description>weekly finance report</description><pubDate>Tue, 24 Feb 2026 09:00:00 GMT</pubDate></item>',
          '</channel></rss>'
        ].join('')
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const gateway = new WebRetrievalGateway({ maxItems: 10, timeoutMs: 3000 });
    const result = await gateway.retrieveLatest({
      sourceUrl: 'https://tisi.org/',
      topic: 'AI',
      category: 'agent'
    });
    assert.equal(result.mode, 'feed');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].url, 'https://tisi.org/p/1');
    assert.equal(calls.includes('https://tisi.org/rss.xml'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
