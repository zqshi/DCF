const { randomUUID } = require('crypto');
const { normalizeAccessContext, matchAccessScope, matchActorScope } = require('../../shared/tenantAccess');

class MessageUseCases {
  constructor(store) {
    this.store = store;
  }

  ensureMessageStore() {
    if (!Array.isArray(this.store.messages)) this.store.messages = [];
    return this.store.messages;
  }

  getScopedEmployee(employeeId, accessContext = null) {
    const employee = this.store.employees.find((item) => item.id === employeeId);
    if (!employee) throw new Error('employee not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (ctx && (!matchAccessScope(employee, ctx) || !matchActorScope(employee, ctx, { strict: true }))) {
      throw new Error('employee not found');
    }
    return employee;
  }

  listByConversation(input = {}, accessContext = null) {
    const employeeId = String(input.employeeId || '').trim();
    const conversationId = String(input.conversationId || '').trim();
    if (!employeeId) throw new Error('employeeId is required');
    if (!conversationId) throw new Error('conversationId is required');
    this.getScopedEmployee(employeeId, accessContext);
    return this.ensureMessageStore()
      .filter((item) => item.employeeId === employeeId && item.conversationId === conversationId)
      .slice()
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }

  create(input = {}, accessContext = null) {
    const employeeId = String(input.employeeId || '').trim();
    const conversationId = String(input.conversationId || '').trim();
    const role = String(input.role || '').trim().toLowerCase();
    const content = String(input.content || '');
    if (!employeeId) throw new Error('employeeId is required');
    if (!conversationId) throw new Error('conversationId is required');
    if (!['user', 'assistant', 'system'].includes(role)) throw new Error('role must be user|assistant|system');
    if (!content.trim()) throw new Error('content is required');

    const { ctx } = (() => {
      const employee = this.store.employees.find((item) => item.id === employeeId);
      if (!employee) throw new Error('employee not found');
      const c = normalizeAccessContext(accessContext || {}, { required: false });
      if (c && (!matchAccessScope(employee, c) || !matchActorScope(employee, c, { strict: true }))) {
        throw new Error('employee not found');
      }
      return { employee, ctx: c };
    })();

    const conversation = Array.isArray(this.store.conversations)
      ? this.store.conversations.find((item) => item.id === conversationId && item.employeeId === employeeId && item.isDeleted !== true)
      : null;
    if (!conversation) throw new Error('conversation not found');
    if (ctx && !matchAccessScope(conversation, ctx)) throw new Error('conversation not found');

    const now = new Date().toISOString();
    const message = {
      id: String(input.id || `msg-${randomUUID()}`),
      employeeId,
      tenantId: conversation.tenantId || null,
      accountId: conversation.accountId || null,
      actorUserId: String(conversation.actorUserId || '').trim() || null,
      conversationId,
      taskId: String(input.taskId || '').trim() || null,
      role,
      content: content.slice(0, 12000),
      createdAt: now,
      updatedAt: now,
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
    };
    this.ensureMessageStore().push(message);

    conversation.updatedAt = now;
    conversation.lastMessageAt = now;
    if (message.taskId) conversation.lastTaskId = message.taskId;

    this.store.addEvent('message.created', {
      traceId: null,
      taskId: message.taskId,
      employeeId: message.employeeId,
      tenantId: message.tenantId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      role: message.role
    });
    return message;
  }
}

module.exports = { MessageUseCases };
