function normalizeIntentText(input = '') {
  return String(input || '');
}

const SUPPORTED_ATTACHMENT_MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
const SUPPORTED_ATTACHMENT_MIME_SET = new Set(Object.values(SUPPORTED_ATTACHMENT_MIME_BY_EXT));

function attachmentExtFromName(name = '') {
  const raw = String(name || '').trim().toLowerCase();
  const index = raw.lastIndexOf('.');
  if (index <= 0 || index === raw.length - 1) return '';
  return raw.slice(index + 1);
}

function normalizeAttachmentMimeType(mimeType = '', name = '') {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_ATTACHMENT_MIME_SET.has(normalized)) return normalized;
  return SUPPORTED_ATTACHMENT_MIME_BY_EXT[attachmentExtFromName(name)] || '';
}

function inferAttachmentType(mimeType = '') {
  return String(mimeType || '').startsWith('image/') ? 'image' : 'file';
}

function normalizeDispatchAttachments(input) {
  const list = Array.isArray(input) ? input : [];
  const normalized = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim();
    const mimeType = normalizeAttachmentMimeType(item.mimeType, name);
    if (!mimeType) continue;
    const content = String(item.content || '').trim();
    if (!content) continue;
    normalized.push({
      type: inferAttachmentType(mimeType),
      name: name.slice(0, 120) || null,
      mimeType: mimeType.slice(0, 120),
      content: content.slice(0, 2_000_000)
    });
    if (normalized.length >= 6) break;
  }
  return normalized;
}

class FrontDispatchUseCases {
  constructor(options = {}) {
    this.store = options.store;
    this.employeeUC = options.employeeUC;
    this.conversationUC = options.conversationUC;
    this.messageUC = options.messageUC;
    this.taskUC = options.taskUC;
  }

  ensureConversation(employeeId, conversationId, accessContext) {
    const id = String(conversationId || '').trim();
    if (id) return id;
    const created = this.conversationUC.create({
      employeeId,
      title: '新会话'
    }, accessContext);
    return created.id;
  }

  async dispatch(input = {}, accessContext = null, actor = {}) {
    const employeeId = String(input.employeeId || '').trim();
    const text = normalizeIntentText(input.text || input.goal || '');
    if (!employeeId) throw new Error('employeeId is required');
    if (!text.trim()) throw new Error('text is required');
    this.employeeUC.getById(employeeId, accessContext);
    const conversationId = this.ensureConversation(employeeId, input.conversationId, accessContext);
    const llmConfig = input.llmConfig && typeof input.llmConfig === 'object' ? input.llmConfig : {};
    const attachments = normalizeDispatchAttachments(input.attachments);
    const task = this.taskUC.create({
      employeeId,
      conversationId,
      goal: text,
      attachments,
      riskLevel: String(input.riskLevel || 'L2').toUpperCase(),
      llmConfig: {
        ...llmConfig,
        requireRealLlm: true,
        requireRuntimeExecution: true
      },
      requestedByUserId: String(actor.userId || '').trim() || 'unknown',
      requestedByRole: String(actor.role || '').trim() || 'front_user',
      requestChannel: 'front'
    }, accessContext);
    return {
      mode: 'action',
      intent: 'action',
      conversationId,
      employeeId,
      reason: 'unified_runtime_dispatch',
      task
    };
  }
}

module.exports = {
  FrontDispatchUseCases
};
