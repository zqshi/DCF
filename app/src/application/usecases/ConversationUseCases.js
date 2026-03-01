const { randomUUID } = require('crypto');
const { normalizeAccessContext, matchAccessScope, matchActorScope } = require('../../shared/tenantAccess');

function normalizeTitle(value, fallback = '新会话') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.slice(0, 80);
}

function sortConversations(items = []) {
  return items
    .slice()
    .sort((a, b) => {
      const aPinned = a && a.isPinned === true;
      const bPinned = b && b.isPinned === true;
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      if (aPinned && bPinned) {
        const pinnedDelta = new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0);
        if (pinnedDelta !== 0) return pinnedDelta;
      }
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
}

class ConversationUseCases {
  constructor(store, options = {}) {
    this.store = store;
    this.softDeleteRetentionDays = this.resolveSoftDeleteRetentionDays(options.softDeleteRetentionDays);
  }

  resolveSoftDeleteRetentionDays(input) {
    const raw = Number(input ?? process.env.CONVERSATION_SOFT_DELETE_RETENTION_DAYS ?? 30);
    if (!Number.isFinite(raw)) return 30;
    return Math.max(0, Math.min(3650, raw));
  }

  ensureConversationStore() {
    if (!Array.isArray(this.store.conversations)) this.store.conversations = [];
    return this.store.conversations;
  }

  purgeExpiredSoftDeleted() {
    const nowMs = Date.now();
    const conversations = this.ensureConversationStore();
    const purgedIds = [];
    this.store.conversations = conversations.filter((item) => {
      const deleted = item && item.isDeleted === true;
      if (!deleted) return true;
      const purgeAtMs = new Date(item.deletedPurgeAt || 0).getTime();
      if (!Number.isFinite(purgeAtMs) || purgeAtMs > nowMs) return true;
      purgedIds.push(item.id);
      return false;
    });
    if (purgedIds.length && Array.isArray(this.store.messages)) {
      const idSet = new Set(purgedIds);
      this.store.messages = this.store.messages.filter((item) => !idSet.has(item.conversationId));
    }
    if (purgedIds.length) {
      this.store.addEvent('conversation.deleted.purged', {
        traceId: null,
        taskId: null,
        employeeId: null,
        count: purgedIds.length
      });
    }
  }

  getScopedEmployee(employeeId, accessContext = null) {
    const employee = this.store.employees.find((item) => item.id === employeeId);
    if (!employee) throw new Error('employee not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (ctx && (!matchAccessScope(employee, ctx) || !matchActorScope(employee, ctx, { strict: true }))) {
      throw new Error('employee not found');
    }
    return { employee, ctx };
  }

  listByEmployee(employeeId, accessContext = null) {
    this.purgeExpiredSoftDeleted();
    const { employee } = this.getScopedEmployee(employeeId, accessContext);
    return sortConversations(this.ensureConversationStore().filter((item) => item.employeeId === employee.id && item.isDeleted !== true));
  }

  create(input = {}, accessContext = null) {
    const employeeId = String(input.employeeId || '').trim();
    if (!employeeId) throw new Error('employeeId is required');
    const { employee, ctx } = this.getScopedEmployee(employeeId, accessContext);
    const tenantId = ctx ? ctx.tenantId : employee.tenantId;
    const accountId = ctx ? ctx.accountId : employee.accountId;
    const now = new Date().toISOString();
    const conversation = {
      id: `conv-${randomUUID()}`,
      employeeId: employee.id,
      tenantId,
      accountId,
      actorUserId: String(employee.actorUserId || (ctx && ctx.actorUserId) || '').trim() || null,
      title: normalizeTitle(input.title, '新会话'),
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      pinnedAt: null,
      isDeleted: false,
      deletedAt: null,
      deletedPurgeAt: null,
      lastMessageAt: null,
      lastTaskId: null
    };
    this.ensureConversationStore().push(conversation);
    this.store.addEvent('conversation.created', {
      traceId: null,
      taskId: null,
      employeeId: employee.id,
      tenantId,
      accountId,
      conversationId: conversation.id,
      title: conversation.title
    });
    return conversation;
  }

  getScopedConversation(conversationId, accessContext = null) {
    this.purgeExpiredSoftDeleted();
    const id = String(conversationId || '').trim();
    if (!id) throw new Error('conversationId is required');
    const conversation = this.ensureConversationStore().find((item) => item.id === id);
    if (!conversation || conversation.isDeleted === true) throw new Error('conversation not found');
    const ctx = normalizeAccessContext(accessContext || {}, { required: false });
    if (ctx && !matchAccessScope(conversation, ctx)) throw new Error('conversation not found');
    if (ctx) {
      const directMatched = matchActorScope(conversation, ctx, { strict: true });
      if (!directMatched) {
        const employee = this.store.employees.find((item) => item.id === conversation.employeeId);
        if (!employee || !matchActorScope(employee, ctx, { strict: true })) throw new Error('conversation not found');
      }
    }
    return { conversation, ctx };
  }

  setPinned(conversationId, pinned, accessContext = null) {
    const { conversation, ctx } = this.getScopedConversation(conversationId, accessContext);
    const now = new Date().toISOString();
    conversation.isPinned = pinned === true;
    conversation.pinnedAt = conversation.isPinned ? now : null;
    conversation.updatedAt = now;
    this.store.addEvent(conversation.isPinned ? 'conversation.pinned' : 'conversation.unpinned', {
      traceId: null,
      taskId: null,
      employeeId: conversation.employeeId,
      tenantId: ctx ? ctx.tenantId : conversation.tenantId,
      accountId: ctx ? ctx.accountId : conversation.accountId,
      conversationId: conversation.id,
      pinned: conversation.isPinned
    });
    return conversation;
  }

  delete(conversationId, accessContext = null) {
    const { conversation, ctx } = this.getScopedConversation(conversationId, accessContext);
    const now = new Date();
    const nowIso = now.toISOString();
    const purgeAt = new Date(now.getTime() + (this.softDeleteRetentionDays * 24 * 60 * 60 * 1000)).toISOString();
    conversation.isDeleted = true;
    conversation.deletedAt = nowIso;
    conversation.deletedPurgeAt = purgeAt;
    conversation.isPinned = false;
    conversation.pinnedAt = null;
    conversation.updatedAt = nowIso;
    this.store.addEvent('conversation.deleted', {
      traceId: null,
      taskId: null,
      employeeId: conversation.employeeId,
      tenantId: ctx ? ctx.tenantId : conversation.tenantId,
      accountId: ctx ? ctx.accountId : conversation.accountId,
      conversationId: conversation.id,
      deleteMode: 'soft',
      purgeAfterAt: purgeAt
    });
    return { deleted: true, id: conversation.id, mode: 'soft', purgeAfterAt: purgeAt };
  }
}

module.exports = { ConversationUseCases };
