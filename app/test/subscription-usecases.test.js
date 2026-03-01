const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { SubscriptionUseCases } = require('../src/application/usecases/SubscriptionUseCases');

test('subscription usecase creates subscription, runs retrieval, and delivers briefing message with evidence', async () => {
  const store = new InMemoryStore();
  store.employees.push({
    id: 'emp-1',
    employeeCode: 'DE-0001',
    name: '订阅测试员工',
    actorUserId: 'user-a',
    tenantId: 'tenant-a',
    accountId: 'account-a'
  });

  const gateway = {
    async retrieveLatest(input = {}) {
      return {
        fetchedAt: '2026-02-25T03:00:00.000Z',
        sourceUrl: input.sourceUrl,
        items: [
          {
            id: 'i-1',
            title: 'AI Agent 周报：桌面执行能力升级',
            url: 'https://tisi.org/post/ai-agent-weekly',
            publishedAt: '2026-02-24T08:00:00.000Z',
            snippet: '聚焦桌面Agent与自动化工作流。'
          }
        ]
      };
    }
  };

  const uc = new SubscriptionUseCases(store, gateway);

  const subscription = uc.create({
    employeeId: 'emp-1',
    sourceUrl: 'https://tisi.org/',
    topic: 'AI',
    category: 'ai',
    intervalMinutes: 60
  }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-a'
  });

  const result = await uc.runSubscriptionNow(subscription.id, {
    actorUserId: 'user-a'
  });

  assert.equal(result.status, 'delivered');
  assert.equal(store.retrievalRuns.length, 1);
  assert.equal(store.briefingDeliveries.length, 1);
  assert.equal(store.messages.length, 1);
  assert.match(store.messages[0].content, /来源/);
  assert.match(store.messages[0].content, /https:\/\/tisi.org\/post\/ai-agent-weekly/);

  const second = await uc.runSubscriptionNow(subscription.id, {
    actorUserId: 'user-a'
  });
  assert.equal(second.status, 'no_new_items');
  assert.equal(store.briefingDeliveries.length, 1);
});

test('subscription usecase enforces tenant/account isolation for listing', () => {
  const store = new InMemoryStore();
  store.employees.push({
    id: 'emp-2',
    employeeCode: 'DE-0002',
    name: '租户测试员工',
    actorUserId: 'user-a',
    tenantId: 'tenant-a',
    accountId: 'account-a'
  });
  const uc = new SubscriptionUseCases(store, {
    async retrieveLatest() {
      return { fetchedAt: new Date().toISOString(), sourceUrl: 'https://tisi.org', items: [] };
    }
  });

  uc.create({
    employeeId: 'emp-2',
    sourceUrl: 'https://tisi.org/',
    topic: 'AI',
    category: 'ai',
    intervalMinutes: 120
  }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-a'
  });

  const own = uc.list({ tenantId: 'tenant-a', accountId: 'account-a' });
  const other = uc.list({ tenantId: 'tenant-b', accountId: 'account-b' });
  assert.equal(own.length, 1);
  assert.equal(other.length, 0);
});

test('subscription usecase infers rules from natural language and creates subscription', async () => {
  const store = new InMemoryStore();
  store.employees.push({
    id: 'emp-3',
    employeeCode: 'DE-0003',
    name: '自然语言订阅员工',
    creator: 'nl_owner',
    actorUserId: 'user-actor-3',
    tenantId: 'tenant-a',
    accountId: 'account-a'
  });
  const uc = new SubscriptionUseCases(store, {
    async retrieveLatest() {
      return { fetchedAt: new Date().toISOString(), sourceUrl: 'https://tisi.org/', items: [] };
    }
  });

  const result = await uc.createFromNaturalLanguage({
    text: '帮我订阅 https://tisi.org/ 最新AI资讯，每2小时推送一次摘要'
  }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-actor-3'
  });

  assert.equal(result.subscription.employeeId, 'emp-3');
  assert.equal(result.subscription.sourceUrl, 'https://tisi.org/');
  assert.equal(result.subscription.topic.toLowerCase().includes('ai') || result.subscription.topic.includes('人工智能'), true);
  assert.equal(result.subscription.intervalMinutes, 120);
  assert.match(String(result.subscription.ruleSummary || ''), /订阅|抓取/);
});

test('subscription usecase can modify existing subscription by natural language', async () => {
  const store = new InMemoryStore();
  store.employees.push({
    id: 'emp-4',
    employeeCode: 'DE-0004',
    name: '修改订阅员工',
    creator: 'owner_4',
    actorUserId: 'user-actor-4',
    tenantId: 'tenant-a',
    accountId: 'account-a'
  });
  const uc = new SubscriptionUseCases(store, {
    async retrieveLatest() {
      return { fetchedAt: new Date().toISOString(), sourceUrl: 'https://tisi.org/', items: [] };
    }
  });
  const created = uc.create({
    sourceUrl: 'https://tisi.org/',
    topic: 'AI',
    intervalMinutes: 60,
    actorUserId: 'user-actor-4'
  }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-actor-4'
  });

  const updated = await uc.manageFromNaturalLanguage({
    text: '把 tisi 的 AI 订阅改为每3小时推送',
    actorUserId: 'user-actor-4',
    deliverConfirmation: true
  }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-actor-4'
  });

  assert.equal(updated.status, 'updated');
  assert.equal(updated.subscription.id, created.id);
  assert.equal(updated.subscription.intervalMinutes, 180);
  assert.ok(store.messages.some((x) => String(((x || {}).meta || {}).type || '') === 'subscription_updated'));
});

test('subscription usecase returns clarification message when update intent lacks target', async () => {
  const store = new InMemoryStore();
  store.employees.push({
    id: 'emp-5',
    employeeCode: 'DE-0005',
    name: '澄清订阅员工',
    creator: 'owner_5',
    actorUserId: 'user-actor-5',
    tenantId: 'tenant-a',
    accountId: 'account-a'
  });
  const uc = new SubscriptionUseCases(store, {
    async retrieveLatest() {
      return { fetchedAt: new Date().toISOString(), sourceUrl: 'https://tisi.org/', items: [] };
    }
  });

  const result = await uc.manageFromNaturalLanguage({
    text: '把我的订阅改一下',
    actorUserId: 'user-actor-5',
    deliverConfirmation: true
  }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
    actorUserId: 'user-actor-5'
  });

  assert.equal(result.status, 'needs_clarification');
  assert.match(String(result.message || ''), /没有可修改|补充/);
  assert.ok(store.messages.some((x) => String(((x || {}).meta || {}).type || '') === 'subscription_clarification'));
});
