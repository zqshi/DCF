const { randomUUID, createHash } = require('crypto');
const { URL } = require('url');
const { normalizeAccessContext, matchAccessScope, matchActorScope } = require('../../shared/tenantAccess');

function normalizeText(value, limit = 200) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['active', 'paused'].includes(v)) return v;
  return 'active';
}

function normalizeSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('sourceUrl must be http or https');
  }
  return parsed.toString();
}

function buildDefaultConversationId(employeeId) {
  return `sub-${String(employeeId || '').trim() || 'default'}`;
}

function hashItem(item) {
  const key = `${item.url || ''}|${item.title || ''}|${item.publishedAt || ''}`;
  return createHash('sha1').update(key).digest('hex');
}

class SubscriptionUseCases {
  constructor(store, retrievalGateway, options = {}) {
    this.store = store;
    this.retrievalGateway = retrievalGateway;
    this.dialogueGateway = options.dialogueGateway || null;
    this.runLock = false;
  }

  ensureCollections() {
    if (!Array.isArray(this.store.subscriptions)) this.store.subscriptions = [];
    if (!Array.isArray(this.store.retrievalRuns)) this.store.retrievalRuns = [];
    if (!Array.isArray(this.store.briefingDeliveries)) this.store.briefingDeliveries = [];
    if (!Array.isArray(this.store.messages)) this.store.messages = [];
    if (!Array.isArray(this.store.conversations)) this.store.conversations = [];
  }

  resolveEmployee(employeeId, accessContext = null) {
    const id = normalizeText(employeeId, 100);
    if (!id) throw new Error('employeeId is required');
    const employee = this.store.employees.find((item) => item.id === id);
    if (!employee) throw new Error('employee not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (ctx && (!matchAccessScope(employee, ctx) || !matchActorScope(employee, ctx, { strict: true }))) {
      throw new Error('employee not found');
    }
    return { employee, ctx };
  }

  resolveDefaultEmployeeForActor(accessContext = null, actor = {}) {
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    const actorUserId = normalizeText(actor.actorUserId || (ctx && ctx.actorUserId) || '', 120);
    const actorUsername = normalizeText(actor.actorUsername || actor.creator || '', 120);
    const list = this.store.employees.filter((employee) => {
      if (ctx && !matchAccessScope(employee, ctx)) return false;
      if (ctx && !matchActorScope(employee, ctx, { strict: true })) return false;
      return true;
    });
    const byActorUserId = actorUserId
      ? list.find((employee) => String(employee.actorUserId || '') === actorUserId)
      : null;
    if (byActorUserId) return { employee: byActorUserId, ctx };
    const byCreator = actorUsername
      ? list.find((employee) => String(employee.creator || '') === actorUsername)
      : null;
    if (byCreator) return { employee: byCreator, ctx };
    const error = new Error('未找到当前账号创建的数字员工，请先创建数字员工');
    error.statusCode = 400;
    throw error;
  }

  resolveSubscription(subscriptionId, accessContext = null) {
    this.ensureCollections();
    const id = normalizeText(subscriptionId, 120);
    if (!id) throw new Error('subscriptionId is required');
    const found = this.store.subscriptions.find((item) => item.id === id);
    if (!found) throw new Error('subscription not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (ctx && !matchAccessScope(found, ctx)) throw new Error('subscription not found');
    if (ctx) {
      const directMatched = matchActorScope(found, ctx, { fields: ['actorUserId', 'createdBy'], strict: true });
      if (!directMatched) {
        const employee = this.store.employees.find((item) => item.id === found.employeeId);
        if (!employee || !matchActorScope(employee, ctx, { strict: true })) throw new Error('subscription not found');
      }
    }
    return { found, ctx };
  }

  create(input = {}, accessContext = null) {
    this.ensureCollections();
    const hasEmployeeId = normalizeText(input.employeeId || '', 100).length > 0;
    const { employee, ctx } = hasEmployeeId
      ? this.resolveEmployee(input.employeeId, accessContext)
      : this.resolveDefaultEmployeeForActor(accessContext, {
        actorUserId: input.actorUserId || '',
        actorUsername: input.actorUsername || ''
      });
    const topic = normalizeText(input.topic || input.query || '', 120);
    if (!topic) throw new Error('topic is required');
    const sourceUrl = normalizeSourceUrl(input.sourceUrl || '');
    if (!sourceUrl) throw new Error('sourceUrl is required');

    const intervalMinutesRaw = Number(input.intervalMinutes || input.scheduleMinutes || 60);
    const intervalMinutes = Number.isFinite(intervalMinutesRaw)
      ? Math.min(1440, Math.max(5, Math.round(intervalMinutesRaw)))
      : 60;

    const now = new Date().toISOString();
    const subscription = {
      id: `sub-${randomUUID()}`,
      employeeId: employee.id,
      tenantId: ctx ? ctx.tenantId : employee.tenantId,
      accountId: ctx ? ctx.accountId : employee.accountId,
      actorUserId: normalizeText((ctx && ctx.actorUserId) || employee.actorUserId || input.actorUserId || '', 80) || null,
      conversationId: normalizeText(input.conversationId || '', 120) || buildDefaultConversationId(employee.id),
      sourceUrl,
      topic,
      category: normalizeText(input.category || 'general', 80) || 'general',
      intervalMinutes,
      ruleText: normalizeText(input.ruleText || '', 1000) || null,
      ruleSummary: normalizeText(input.ruleSummary || '', 300) || null,
      status: normalizeStatus(input.status || 'active'),
      latestItemHashes: [],
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      nextRunAt: now,
      createdBy: normalizeText((ctx && ctx.actorUserId) || input.actorUserId || 'system', 80)
    };

    this.store.subscriptions.unshift(subscription);
    this.store.subscriptions = this.store.subscriptions.slice(0, 2000);

    this.store.addEvent('subscription.created', {
      traceId: null,
      taskId: null,
      employeeId: subscription.employeeId,
      tenantId: subscription.tenantId,
      accountId: subscription.accountId,
      actorUserId: subscription.createdBy,
      subscriptionId: subscription.id,
      sourceUrl: subscription.sourceUrl,
      topic: subscription.topic,
      category: subscription.category,
      intervalMinutes: subscription.intervalMinutes
    });

    return subscription;
  }

  parseIntervalMinutes(text) {
    const raw = String(text || '').toLowerCase();
    const minute = raw.match(/每\s*(\d{1,4})\s*分(钟)?/);
    if (minute) return Math.max(5, Math.min(1440, Number(minute[1])));
    const hour = raw.match(/每\s*(\d{1,3})\s*小?时/);
    if (hour) return Math.max(5, Math.min(1440, Number(hour[1]) * 60));
    if (/每天|每日/.test(raw)) return 24 * 60;
    if (/每周|每星期/.test(raw)) return 7 * 24 * 60;
    return 60;
  }

  inferTopicFromText(text) {
    const raw = String(text || '').trim();
    if (!raw) return 'AI';
    const about = raw.match(/关于([^，。,.；;\n]{2,40})/);
    if (about && about[1]) return normalizeText(about[1], 120);
    const topic = raw.match(/(AI|人工智能|大模型|Agent|智能体|机器学习|深度学习)/i);
    if (topic && topic[1]) return normalizeText(topic[1], 120);
    return normalizeText(raw, 120);
  }

  inferCategoryFromText(text) {
    const raw = String(text || '').toLowerCase();
    if (/ai|人工智能|大模型|agent|智能体/.test(raw)) return 'ai';
    if (/安全|合规|风控/.test(raw)) return 'security';
    if (/金融|财经|投资/.test(raw)) return 'finance';
    return 'general';
  }

  extractSourceUrl(text) {
    const raw = String(text || '');
    const matched = raw.match(/https?:\/\/[^\s，。,\n]+/i);
    if (matched && matched[0]) return normalizeSourceUrl(matched[0]);
    return '';
  }

  async inferRuleByLlm(text) {
    if (!this.dialogueGateway || typeof this.dialogueGateway.reply !== 'function') return null;
    const prompt = [
      '你是订阅规则解析器。将用户输入解析成JSON，不要输出额外文本。',
      'JSON schema: {"sourceUrl":"string","topic":"string","category":"string","intervalMinutes":number,"ruleSummary":"string"}',
      'ruleSummary 使用中文一句话，不超过60字。',
      `用户输入: ${String(text || '').trim()}`
    ].join('\n');
    try {
      const reply = await this.dialogueGateway.reply([
        { role: 'system', content: '你只输出JSON。' },
        { role: 'user', content: prompt }
      ]);
      const content = String((reply && reply.content) || '').trim();
      if (!content) return null;
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async inferManageIntentByLlm(text) {
    if (!this.dialogueGateway || typeof this.dialogueGateway.reply !== 'function') return null;
    const prompt = [
      '你是订阅管理意图解析器。输出JSON，不要输出额外文本。',
      'JSON schema: {"action":"create|update|pause|resume|unknown","targetHint":"string","sourceUrl":"string","topic":"string","category":"string","intervalMinutes":number,"ruleSummary":"string"}',
      `用户输入: ${String(text || '').trim()}`
    ].join('\n');
    try {
      const reply = await this.dialogueGateway.reply([
        { role: 'system', content: '你只输出JSON。' },
        { role: 'user', content: prompt }
      ]);
      const content = String((reply && reply.content) || '').trim();
      if (!content) return null;
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async inferSubscriptionRule(input = {}) {
    const text = normalizeText(input.text || input.prompt || '', 2000);
    if (!text) {
      const error = new Error('text is required');
      error.statusCode = 400;
      throw error;
    }
    const llm = await this.inferRuleByLlm(text);
    const sourceUrl = normalizeSourceUrl(
      (llm && llm.sourceUrl) || input.sourceUrl || this.extractSourceUrl(text) || ''
    );
    if (!sourceUrl) {
      const error = new Error('无法从自然语言中识别订阅网址，请在描述里包含 https:// 开头的网址');
      error.statusCode = 400;
      throw error;
    }
    const intervalMinutesRaw = Number((llm && llm.intervalMinutes) || 0);
    const intervalMinutes = Number.isFinite(intervalMinutesRaw) && intervalMinutesRaw > 0
      ? Math.max(5, Math.min(1440, Math.round(intervalMinutesRaw)))
      : this.parseIntervalMinutes(text);
    const topic = normalizeText((llm && llm.topic) || input.topic || this.inferTopicFromText(text), 120) || 'AI';
    const category = normalizeText((llm && llm.category) || this.inferCategoryFromText(text), 80) || 'general';
    const ruleSummary = normalizeText(
      (llm && llm.ruleSummary)
      || `订阅 ${sourceUrl} 与 ${topic} 相关内容，每 ${intervalMinutes} 分钟抓取一次。`,
      300
    );
    return {
      sourceUrl,
      topic,
      category,
      intervalMinutes,
      ruleText: text,
      ruleSummary
    };
  }

  async createFromNaturalLanguage(input = {}, accessContext = null) {
    const inferred = await this.inferSubscriptionRule(input);
    const created = this.create({
      employeeId: input.employeeId,
      conversationId: input.conversationId || '',
      sourceUrl: inferred.sourceUrl,
      topic: inferred.topic,
      category: inferred.category,
      intervalMinutes: inferred.intervalMinutes,
      ruleText: inferred.ruleText,
      ruleSummary: inferred.ruleSummary,
      actorUserId: input.actorUserId || '',
      actorUsername: input.actorUsername || ''
    }, accessContext);
    const deliverConfirmation = input.deliverConfirmation !== false;
    if (deliverConfirmation) {
      const conversationId = normalizeText(input.conversationId || '', 120) || created.conversationId;
      const now = new Date().toISOString();
      this.ensureConversation({ ...created, conversationId });
      this.store.messages.push({
        id: `msg-${randomUUID()}`,
        employeeId: created.employeeId,
        tenantId: created.tenantId,
        accountId: created.accountId,
        conversationId,
        taskId: null,
        role: 'assistant',
        content: `已根据你的描述创建订阅：${inferred.ruleSummary}\n来源：${created.sourceUrl}\n主题：${created.topic}\n频率：每 ${created.intervalMinutes} 分钟`,
        createdAt: now,
        updatedAt: now,
        meta: {
          type: 'subscription_created',
          subscriptionId: created.id
        }
      });
    }
    return {
      inferred,
      subscription: created
    };
  }

  inferActionFromText(text, llm = null) {
    const llmAction = normalizeText((llm && llm.action) || '', 20).toLowerCase();
    if (['create', 'update', 'pause', 'resume'].includes(llmAction)) return llmAction;
    const raw = String(text || '').toLowerCase();
    if (/(暂停|停止|停掉|先停)/.test(raw)) return 'pause';
    if (/(恢复|继续|重启|重新开启|重新订阅)/.test(raw)) return 'resume';
    if (/(修改|调整|改成|改为|更新|变更|改一下|改下|改一改|改)/.test(raw)) return 'update';
    if (/(订阅|关注|跟踪|推送|简报)/.test(raw)) return 'create';
    return 'unknown';
  }

  parseTargetHint(text, llm = null) {
    const llmHint = normalizeText((llm && llm.targetHint) || '', 200);
    if (llmHint) return llmHint;
    return normalizeText(String(text || ''), 2000);
  }

  extractIntervalMinutesFromText(text, llm = null) {
    const llmInterval = Number(llm && llm.intervalMinutes);
    if (Number.isFinite(llmInterval) && llmInterval > 0) {
      return Math.max(5, Math.min(1440, Math.round(llmInterval)));
    }
    const raw = String(text || '');
    if (/(每\s*\d+\s*(分|分钟|小时)|每天|每日|每周|每星期)/.test(raw)) {
      return this.parseIntervalMinutes(raw);
    }
    return null;
  }

  extractTopicForUpdate(text, llm = null) {
    const llmTopic = normalizeText((llm && llm.topic) || '', 120);
    if (llmTopic) return llmTopic;
    const raw = String(text || '').trim();
    const m = raw.match(/(?:主题|关注|改为|改成)\s*[:：]?\s*([^，。,.；;\n]{2,60})/);
    if (m && m[1]) return normalizeText(m[1], 120);
    return '';
  }

  scopedSubscriptions(accessContext, actor = {}) {
    const { employee } = this.resolveDefaultEmployeeForActor(accessContext, actor);
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    const scoped = this.list(ctx).filter((item) => item.employeeId === employee.id);
    return { employee, scoped };
  }

  findSubscriptionByHint(hint, scoped = []) {
    const text = String(hint || '').trim().toLowerCase();
    if (!text) return null;
    const url = this.extractSourceUrl(text);
    if (url) {
      const byUrl = scoped.find((item) => String(item.sourceUrl || '').toLowerCase() === String(url).toLowerCase());
      if (byUrl) return byUrl;
    }
    const topicMatch = scoped.find((item) => text.includes(String(item.topic || '').toLowerCase()));
    if (topicMatch) return topicMatch;
    const idLike = text.match(/sub-[a-f0-9-]{8,}/i);
    if (idLike) {
      const byId = scoped.find((item) => item.id === idLike[0]);
      if (byId) return byId;
    }
    return null;
  }

  appendAssistantMessage(subscription, conversationId, content, meta = {}) {
    const now = new Date().toISOString();
    this.ensureConversation({
      ...subscription,
      conversationId: normalizeText(conversationId || '', 120) || subscription.conversationId
    });
    this.store.messages.push({
      id: `msg-${randomUUID()}`,
      employeeId: subscription.employeeId,
      tenantId: subscription.tenantId,
      accountId: subscription.accountId,
      conversationId: normalizeText(conversationId || '', 120) || subscription.conversationId,
      taskId: null,
      role: 'assistant',
      content: normalizeText(content || '', 12000),
      createdAt: now,
      updatedAt: now,
      meta
    });
  }

  update(subscriptionId, input = {}, accessContext = null) {
    const { found } = this.resolveSubscription(subscriptionId, accessContext);
    const next = {};
    if (Object.prototype.hasOwnProperty.call(input, 'sourceUrl')) {
      next.sourceUrl = normalizeSourceUrl(input.sourceUrl || '');
      if (!next.sourceUrl) throw new Error('sourceUrl is required');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'topic')) {
      next.topic = normalizeText(input.topic || '', 120);
      if (!next.topic) throw new Error('topic is required');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'category')) {
      next.category = normalizeText(input.category || 'general', 80) || 'general';
    }
    if (Object.prototype.hasOwnProperty.call(input, 'intervalMinutes')) {
      const n = Number(input.intervalMinutes);
      if (!Number.isFinite(n) || n <= 0) throw new Error('intervalMinutes must be positive');
      next.intervalMinutes = Math.max(5, Math.min(1440, Math.round(n)));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'ruleText')) {
      next.ruleText = normalizeText(input.ruleText || '', 1000) || null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'ruleSummary')) {
      next.ruleSummary = normalizeText(input.ruleSummary || '', 300) || null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'status')) {
      next.status = normalizeStatus(input.status);
    }
    Object.assign(found, next);
    found.updatedAt = new Date().toISOString();
    found.nextRunAt = new Date().toISOString();
    this.store.addEvent('subscription.updated', {
      traceId: null,
      taskId: null,
      employeeId: found.employeeId,
      tenantId: found.tenantId,
      accountId: found.accountId,
      subscriptionId: found.id,
      updatedFields: Object.keys(next)
    });
    return found;
  }

  async manageFromNaturalLanguage(input = {}, accessContext = null) {
    this.ensureCollections();
    const text = normalizeText(input.text || input.prompt || '', 2000);
    if (!text) {
      const error = new Error('text is required');
      error.statusCode = 400;
      throw error;
    }
    const actor = {
      actorUserId: input.actorUserId || '',
      actorUsername: input.actorUsername || ''
    };
    const { scoped } = this.scopedSubscriptions(accessContext, actor);
    const llm = await this.inferManageIntentByLlm(text);
    const action = this.inferActionFromText(text, llm);
    const conversationId = normalizeText(input.conversationId || '', 120) || '';

    if (action === 'create') {
      return this.createFromNaturalLanguage(input, accessContext);
    }

    const explicitId = normalizeText(input.subscriptionId || '', 120);
    const target = explicitId
      ? this.resolveSubscription(explicitId, accessContext).found
      : this.findSubscriptionByHint(this.parseTargetHint(text, llm), scoped);

    if (!target) {
      const { employee } = this.resolveDefaultEmployeeForActor(accessContext, actor);
      const pseudo = {
        employeeId: employee.id,
        tenantId: employee.tenantId,
        accountId: employee.accountId,
        topic: '订阅助手',
        conversationId: conversationId || buildDefaultConversationId(employee.id)
      };
      const content = scoped.length === 0
        ? '当前没有可修改的订阅。你可以先说“帮我订阅 https://... 每2小时推送AI简报”。'
        : '我没能准确定位你要修改的订阅，请补充订阅网址或主题名称，我再帮你修改。';
      if (input.deliverConfirmation !== false) {
        this.appendAssistantMessage(pseudo, conversationId, content, { type: 'subscription_clarification' });
      }
      return {
        status: 'needs_clarification',
        action,
        subscription: null,
        message: content
      };
    }

    if (action === 'pause') {
      const updated = this.pause(target.id, { reason: 'nl_manage' }, accessContext);
      if (input.deliverConfirmation !== false) {
        this.appendAssistantMessage(updated, conversationId, `已暂停订阅：${updated.topic}（${updated.sourceUrl}）`, {
          type: 'subscription_updated',
          action,
          subscriptionId: updated.id
        });
      }
      return { status: 'updated', action, subscription: updated };
    }

    if (action === 'resume') {
      const updated = this.resume(target.id, accessContext);
      if (input.deliverConfirmation !== false) {
        this.appendAssistantMessage(updated, conversationId, `已恢复订阅：${updated.topic}（${updated.sourceUrl}）`, {
          type: 'subscription_updated',
          action,
          subscriptionId: updated.id
        });
      }
      return { status: 'updated', action, subscription: updated };
    }

    if (action === 'update') {
      const sourceUrl = this.extractSourceUrl(text) || normalizeText((llm && llm.sourceUrl) || '', 200);
      const topic = this.extractTopicForUpdate(text, llm);
      const category = normalizeText((llm && llm.category) || '', 80);
      const intervalMinutes = this.extractIntervalMinutesFromText(text, llm);
      if (!sourceUrl && !topic && !intervalMinutes && !category) {
        const content = `我找到了订阅“${target.topic}”，但没识别出你要改什么。可说：改为每3小时、主题改为AI安全、或网址改为https://...`;
        if (input.deliverConfirmation !== false) {
          this.appendAssistantMessage(target, conversationId, content, { type: 'subscription_clarification' });
        }
        return {
          status: 'needs_clarification',
          action,
          subscription: target,
          message: content
        };
      }
      const updated = this.update(target.id, {
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(topic ? { topic } : {}),
        ...(category ? { category } : {}),
        ...(intervalMinutes ? { intervalMinutes } : {}),
        ruleText: text,
        ruleSummary: normalizeText((llm && llm.ruleSummary) || `按自然语言修改：${text}`, 300)
      }, accessContext);
      if (input.deliverConfirmation !== false) {
        this.appendAssistantMessage(updated, conversationId, `已更新订阅：${updated.ruleSummary || updated.topic}。当前频率每 ${updated.intervalMinutes} 分钟。`, {
          type: 'subscription_updated',
          action,
          subscriptionId: updated.id
        });
      }
      return { status: 'updated', action, subscription: updated };
    }

    const content = '我不确定你是要创建、修改、暂停还是恢复订阅。你可以说“修改 tisi 订阅为每3小时”或“暂停 tisi 订阅”。';
    if (input.deliverConfirmation !== false) {
      this.appendAssistantMessage(target, conversationId, content, { type: 'subscription_clarification' });
    }
    return {
      status: 'needs_clarification',
      action: 'unknown',
      subscription: target,
      message: content
    };
  }

  list(accessContext = null) {
    this.ensureCollections();
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    const rows = ctx
      ? this.store.subscriptions.filter((item) => (
        matchAccessScope(item, ctx)
        && matchActorScope(item, ctx, { fields: ['actorUserId', 'createdBy'], strict: true })
      ))
      : this.store.subscriptions;
    return rows
      .slice()
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }

  listRuns(subscriptionId, accessContext = null, limit = 30) {
    this.ensureCollections();
    const { found } = this.resolveSubscription(subscriptionId, accessContext);
    const max = Math.min(200, Math.max(1, Number(limit || 30) || 30));
    return this.store.retrievalRuns
      .filter((item) => item.subscriptionId === found.id)
      .slice()
      .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())
      .slice(0, max);
  }

  pause(subscriptionId, input = {}, accessContext = null) {
    const { found } = this.resolveSubscription(subscriptionId, accessContext);
    const now = new Date().toISOString();
    found.status = 'paused';
    found.updatedAt = now;
    found.lastPauseReason = normalizeText(input.reason || '', 300) || null;
    this.store.addEvent('subscription.paused', {
      traceId: null,
      taskId: null,
      employeeId: found.employeeId,
      tenantId: found.tenantId,
      accountId: found.accountId,
      subscriptionId: found.id,
      reason: found.lastPauseReason
    });
    return found;
  }

  resume(subscriptionId, accessContext = null) {
    const { found } = this.resolveSubscription(subscriptionId, accessContext);
    const now = new Date().toISOString();
    found.status = 'active';
    found.updatedAt = now;
    found.nextRunAt = now;
    this.store.addEvent('subscription.resumed', {
      traceId: null,
      taskId: null,
      employeeId: found.employeeId,
      tenantId: found.tenantId,
      accountId: found.accountId,
      subscriptionId: found.id
    });
    return found;
  }

  ensureConversation(subscription) {
    const existing = this.store.conversations.find((item) => item.id === subscription.conversationId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const conversation = {
      id: subscription.conversationId,
      employeeId: subscription.employeeId,
      tenantId: subscription.tenantId,
      accountId: subscription.accountId,
      title: `订阅简报：${subscription.topic}`.slice(0, 80),
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      lastTaskId: null
    };
    this.store.conversations.push(conversation);
    return conversation;
  }

  buildBriefing(subscription, freshItems = [], retrievalResult = {}) {
    const timestamp = normalizeText(retrievalResult.fetchedAt || new Date().toISOString(), 40);
    const header = `💡 AI 信息简报\n主题：${subscription.topic}\n来源站点：${subscription.sourceUrl}\n抓取时间：${timestamp}`;
    const focus = freshItems.slice(0, 5).map((item, index) => {
      const published = item.publishedAt ? `（${item.publishedAt}）` : '';
      const snippet = normalizeText(item.snippet || '', 140);
      return `${index + 1}. ${item.title} ${published}\n   ${item.url}${snippet ? `\n   摘要：${snippet}` : ''}`;
    }).join('\n');
    const evidence = `\n\n证据来源（${freshItems.length}）:\n${freshItems.map((item) => `- ${item.url}`).join('\n')}`;
    return `${header}\n\n焦点解读：\n${focus || '暂无新增条目'}${evidence}`;
  }

  createRunRecord(subscription, actorUserId = 'system') {
    const now = new Date().toISOString();
    const run = {
      id: `retrieval-run-${randomUUID()}`,
      subscriptionId: subscription.id,
      employeeId: subscription.employeeId,
      tenantId: subscription.tenantId,
      accountId: subscription.accountId,
      actorUserId: normalizeText(actorUserId || 'system', 80),
      status: 'running',
      sourceUrl: subscription.sourceUrl,
      topic: subscription.topic,
      category: subscription.category,
      startedAt: now,
      finishedAt: null,
      fetchedAt: null,
      newItems: 0,
      totalItems: 0,
      evidence: [],
      error: null
    };
    this.store.retrievalRuns.unshift(run);
    this.store.retrievalRuns = this.store.retrievalRuns.slice(0, 5000);
    return run;
  }

  completeRun(run, fields = {}) {
    const finishedAt = new Date().toISOString();
    Object.assign(run, {
      ...fields,
      finishedAt
    });
    return run;
  }

  markNextRun(subscription, now = Date.now()) {
    const next = new Date(now + (subscription.intervalMinutes * 60 * 1000)).toISOString();
    subscription.lastCheckedAt = new Date(now).toISOString();
    subscription.nextRunAt = next;
    subscription.updatedAt = new Date(now).toISOString();
  }

  async runSubscriptionNow(subscriptionId, options = {}) {
    this.ensureCollections();
    const { found } = this.resolveSubscription(subscriptionId, options.accessContext || null);
    if (found.status !== 'active') {
      const error = new Error('subscription is not active');
      error.statusCode = 400;
      throw error;
    }
    return this.executeSingle(found, options);
  }

  async executeSingle(subscription, options = {}) {
    const nowTs = Date.now();
    const run = this.createRunRecord(subscription, options.actorUserId || 'system');
    try {
      const retrieval = await this.retrievalGateway.retrieveLatest({
        sourceUrl: subscription.sourceUrl,
        topic: subscription.topic,
        category: subscription.category,
        traceId: options.traceId || null
      });
      const items = Array.isArray(retrieval.items) ? retrieval.items : [];
      const seenHashes = new Set(Array.isArray(subscription.latestItemHashes) ? subscription.latestItemHashes : []);
      const freshItems = items.filter((item) => {
        const h = hashItem(item || {});
        if (seenHashes.has(h)) return false;
        seenHashes.add(h);
        return true;
      });

      subscription.latestItemHashes = Array.from(seenHashes).slice(-1000);
      this.markNextRun(subscription, nowTs);

      if (freshItems.length === 0) {
        this.completeRun(run, {
          status: 'no_new_items',
          fetchedAt: retrieval.fetchedAt || new Date().toISOString(),
          totalItems: items.length,
          newItems: 0,
          evidence: items.slice(0, 10).map((item) => ({ title: item.title, url: item.url, publishedAt: item.publishedAt || null }))
        });
        this.store.addEvent('subscription.retrieval.completed', {
          traceId: options.traceId || null,
          taskId: null,
          employeeId: subscription.employeeId,
          tenantId: subscription.tenantId,
          accountId: subscription.accountId,
          subscriptionId: subscription.id,
          runId: run.id,
          status: run.status,
          newItems: 0,
          totalItems: items.length
        });
        return run;
      }

      const content = this.buildBriefing(subscription, freshItems, retrieval);
      const conversation = this.ensureConversation(subscription);
      const message = {
        id: `msg-${randomUUID()}`,
        employeeId: subscription.employeeId,
        tenantId: subscription.tenantId,
        accountId: subscription.accountId,
        conversationId: conversation.id,
        taskId: null,
        role: 'assistant',
        content: content.slice(0, 12000),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        meta: {
          type: 'subscription_briefing',
          subscriptionId: subscription.id,
          runId: run.id,
          sourceUrl: subscription.sourceUrl,
          topic: subscription.topic,
          evidence: freshItems.slice(0, 10).map((item) => ({
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt || null
          }))
        }
      };
      this.store.messages.push(message);
      conversation.lastMessageAt = message.createdAt;
      conversation.updatedAt = message.updatedAt;

      const delivery = {
        id: `delivery-${randomUUID()}`,
        runId: run.id,
        subscriptionId: subscription.id,
        employeeId: subscription.employeeId,
        tenantId: subscription.tenantId,
        accountId: subscription.accountId,
        conversationId: conversation.id,
        messageId: message.id,
        deliveredAt: message.createdAt,
        channel: 'conversation_message'
      };
      this.store.briefingDeliveries.unshift(delivery);
      this.store.briefingDeliveries = this.store.briefingDeliveries.slice(0, 5000);

      this.completeRun(run, {
        status: 'delivered',
        fetchedAt: retrieval.fetchedAt || new Date().toISOString(),
        totalItems: items.length,
        newItems: freshItems.length,
        evidence: freshItems.slice(0, 10).map((item) => ({ title: item.title, url: item.url, publishedAt: item.publishedAt || null }))
      });

      this.store.addEvent('subscription.retrieval.completed', {
        traceId: options.traceId || null,
        taskId: null,
        employeeId: subscription.employeeId,
        tenantId: subscription.tenantId,
        accountId: subscription.accountId,
        subscriptionId: subscription.id,
        runId: run.id,
        status: run.status,
        newItems: freshItems.length,
        totalItems: items.length,
        conversationId: conversation.id
      });

      return run;
    } catch (error) {
      this.markNextRun(subscription, nowTs);
      this.completeRun(run, {
        status: 'failed',
        error: normalizeText(error && error.message ? error.message : 'unknown error', 500)
      });
      this.store.addEvent('subscription.retrieval.failed', {
        traceId: options.traceId || null,
        taskId: null,
        employeeId: subscription.employeeId,
        tenantId: subscription.tenantId,
        accountId: subscription.accountId,
        subscriptionId: subscription.id,
        runId: run.id,
        error: run.error
      });
      return run;
    }
  }

  async runDueSubscriptions(options = {}) {
    this.ensureCollections();
    if (this.runLock) return { processed: 0, delivered: 0, failed: 0, skipped: true };
    this.runLock = true;
    try {
      const now = Date.now();
      const due = this.store.subscriptions.filter((item) => {
        if (!item || item.status !== 'active') return false;
        const next = new Date(item.nextRunAt || 0).getTime();
        return Number.isFinite(next) ? next <= now : true;
      });
      let delivered = 0;
      let failed = 0;
      for (const subscription of due) {
        const run = await this.executeSingle(subscription, {
          actorUserId: options.actorUserId || 'system',
          traceId: options.traceId || null
        });
        if (run.status === 'delivered') delivered += 1;
        if (run.status === 'failed') failed += 1;
      }
      return {
        processed: due.length,
        delivered,
        failed,
        skipped: false
      };
    } finally {
      this.runLock = false;
    }
  }
}

module.exports = {
  SubscriptionUseCases
};
