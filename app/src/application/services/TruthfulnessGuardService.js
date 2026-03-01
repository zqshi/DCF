function normalizeText(value) {
  return String(value || '').trim();
}

function hasExternalCompletionClaim(text = '') {
  const source = normalizeText(text);
  if (!source) return false;
  const patterns = [
    /已(经)?发(送)?(邮件|消息|通知|短信)/i,
    /(邮件|消息|通知|短信)已(经)?发出/i,
    /我(已|已经)?(给你|给您|帮你|帮您)?发了(邮件|消息|通知|短信)/i,
    /已(经)?(打了|拨打了?)(电话|钉钉|语音)/i,
    /我(已|已经)?(给你|给您|帮你|帮您)?打(了)?(电话|钉钉|语音)/i,
    /(已经|已)?处理好(了)?/i,
    /(已经|已)?安排(好了|完成)/i
  ];
  return patterns.some((pattern) => pattern.test(source));
}

function gatherReceiptFromRuntimeEvents(events = []) {
  const receipts = [];
  for (const event of events) {
    const payload = event && typeof event.payload === 'object' && event.payload ? event.payload : {};
    const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
    const candidates = [
      payload.messageId,
      payload.requestId,
      payload.providerRequestId,
      payload.callId,
      payload.deliveryId,
      details.messageId,
      details.requestId,
      details.providerRequestId,
      details.callId,
      details.deliveryId
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    for (const item of candidates) {
      if (!receipts.includes(item)) receipts.push(item);
    }
  }
  return receipts;
}

function hasVerifiedExternalEvidence(task = {}) {
  const runtime = task && typeof task.runtime === 'object' ? task.runtime : {};
  const evidence = runtime && typeof runtime.evidence === 'object' ? runtime.evidence : {};
  if (String(evidence.verdict || '') === 'confirmed' && Number(evidence.deliveryReceiptCount || 0) > 0) {
    return true;
  }
  const runtimeEvents = Array.isArray(runtime.events) ? runtime.events : [];
  return gatherReceiptFromRuntimeEvents(runtimeEvents).length > 0;
}

function buildNaturalCautionReply(task = {}) {
  const runtime = task && typeof task.runtime === 'object' ? task.runtime : {};
  const runtimeTaskId = String(runtime.taskId || '').trim();
  const batch = runtimeTaskId ? `（执行批次 ${runtimeTaskId.slice(0, 8)}）` : '';
  return [
    `我先同步真实进度：我还没有拿到外部动作成功回执${batch}，现在不能确认“已发送/已拨打”。`,
    '为保证结果真实，我先和你确认目标联系方式，然后立即执行并把回执编号发给你。'
  ].join('');
}

function enforceAssistantTruth(task = {}, text = '') {
  const source = normalizeText(text);
  if (!source) return { content: '', rewritten: false, reason: '' };
  if (!hasExternalCompletionClaim(source)) return { content: source, rewritten: false, reason: '' };
  if (hasVerifiedExternalEvidence(task)) return { content: source, rewritten: false, reason: '' };
  return {
    content: buildNaturalCautionReply(task),
    rewritten: true,
    reason: 'external_completion_claim_without_receipt'
  };
}

module.exports = {
  enforceAssistantTruth,
  hasExternalCompletionClaim,
  hasVerifiedExternalEvidence,
  gatherReceiptFromRuntimeEvents
};
