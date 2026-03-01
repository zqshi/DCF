function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function pickString(source, keys = []) {
  for (const key of keys) {
    const value = source[key];
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function hasNonEmptyValue(values = []) {
  return values.some((item) => String(item || '').trim().length > 0);
}

function firstFiniteNumber(values = []) {
  for (const item of values) {
    const value = Number(item);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function detectRuntimeTaskId(outcome = {}, runtimeEvents = []) {
  const direct = String(outcome.runtimeTaskId || '').trim();
  if (direct) return direct;
  for (const runtimeEvent of runtimeEvents) {
    const fromEvent = String((runtimeEvent && runtimeEvent.taskId) || '').trim();
    if (fromEvent) return fromEvent;
    const payload = asObject(runtimeEvent && runtimeEvent.payload);
    const details = asObject(payload.details);
    const fromPayload = String(payload.taskId || payload.task_id || details.taskId || details.task_id || '').trim();
    if (fromPayload) return fromPayload;
  }
  return null;
}

function normalizeRuntimeEventExtra(runtimeEvent = {}) {
  const payload = asObject(runtimeEvent && runtimeEvent.payload);
  const toolName = pickString(payload, ['toolName', 'tool', 'tool_name', 'name']) || null;
  const action = pickString(payload, ['action', 'phase', 'stage', 'event', 'operation']) || null;
  const message = pickString(payload, ['message', 'result', 'summary', 'reason']) || null;
  const details = asObject(payload.details);
  const chunkIndex = details && Number.isFinite(Number(details.chunkIndex)) ? Number(details.chunkIndex) : null;
  const done = details && typeof details.done === 'boolean' ? details.done : null;
  return {
    runtimeToolName: toolName ? String(toolName).slice(0, 80) : null,
    runtimeAction: action ? String(action).slice(0, 80) : null,
    runtimeMessage: message ? String(message).slice(0, 200) : null,
    runtimeDetails: details,
    runtimeChunkIndex: chunkIndex,
    runtimeDone: done
  };
}

function detectRuntimeExecutionEvidence(task, outcome = {}) {
  const runtimeEvents = Array.isArray(outcome.runtimeEvents) ? outcome.runtimeEvents : [];
  const source = String(outcome.source || 'unknown');
  const runtimeTaskId = detectRuntimeTaskId(outcome, runtimeEvents);
  const goal = String((task && task.goal) || '').toLowerCase();
  const shellIntent = [
    '下载', '文件夹', '扫描', '目录', 'shell', 'bash', 'terminal', 'scan', 'folder', 'downloads'
  ].some((keyword) => goal.includes(keyword));
  const deliveryIntent = [
    '邮件', '邮箱', 'email', 'mail', '通知', '消息', 'message',
    '钉钉', 'dingtalk', '电话', 'call', '短信', 'sms'
  ].some((keyword) => goal.includes(keyword));

  let shellEventCount = 0;
  let commandCount = 0;
  let exitCodeCount = 0;
  let outputCount = 0;
  let deliveryEventCount = 0;
  let deliverySuccessCount = 0;
  let deliveryReceiptCount = 0;

  for (const runtimeEvent of runtimeEvents) {
    const payload = asObject(runtimeEvent && runtimeEvent.payload);
    const details = asObject(payload.details);
    const toolName = pickString(payload, ['toolName', 'tool', 'tool_name', 'name']).toLowerCase();
    const eventType = String((runtimeEvent && runtimeEvent.type) || '').toLowerCase();
    const isShell = ['bash', 'shell', 'terminal', 'sh', 'zsh'].some((keyword) => toolName.includes(keyword))
      || eventType.includes('shell')
      || eventType.includes('bash');
    if (!isShell) continue;
    shellEventCount += 1;
    if (hasNonEmptyValue([
      details.command, details.cmd, details.commandLine, details.command_line, details.script,
      payload.command, payload.cmd, payload.commandLine, payload.command_line
    ]) || (Array.isArray(details.argv) && details.argv.length > 0)) {
      commandCount += 1;
    }
    if (firstFiniteNumber([
      details.exitCode, details.exit_code, details.code,
      payload.exitCode, payload.exit_code, payload.code
    ]) !== null) {
      exitCodeCount += 1;
    }
    if (hasNonEmptyValue([
      details.stdout, details.stderr, details.output, details.result,
      payload.stdout, payload.stderr, payload.output, payload.result, payload.message
    ])) {
      outputCount += 1;
    }
  }

  for (const runtimeEvent of runtimeEvents) {
    const payload = asObject(runtimeEvent && runtimeEvent.payload);
    const details = asObject(payload.details);
    const toolName = pickString(payload, ['toolName', 'tool', 'tool_name', 'name']).toLowerCase();
    const action = pickString(payload, ['action', 'phase', 'stage', 'event', 'operation']).toLowerCase();
    const status = pickString(payload, ['status', 'state']).toLowerCase()
      || pickString(details, ['status', 'state']).toLowerCase();
    const eventType = String((runtimeEvent && runtimeEvent.type) || '').toLowerCase();
    const resultText = String(payload.result || payload.message || payload.summary || '').toLowerCase();
    const isDeliveryTool = [
      'email', 'mail', 'smtp', 'message', 'notify', 'notification',
      'dingtalk', 'ding', 'im', 'sms', 'call', 'phone', 'voice'
    ].some((keyword) => toolName.includes(keyword))
      || ['email', 'mail', 'sms', 'phone', 'call', 'notify', 'message'].some((keyword) => eventType.includes(keyword));
    if (!isDeliveryTool) continue;
    deliveryEventCount += 1;

    const hasSuccessSignal = (
      payload.success === true
      || payload.ok === true
      || details.success === true
      || details.ok === true
      || action.includes('success')
      || action.includes('sent')
      || action.includes('deliver')
      || action.includes('done')
      || status.includes('success')
      || status.includes('sent')
      || status.includes('delivered')
      || status.includes('ok')
      || status.includes('done')
      || eventType.includes('succeeded')
      || resultText.includes('messageid')
      || resultText.includes('requestid')
    );
    if (hasSuccessSignal) deliverySuccessCount += 1;

    const receipt = [
      payload.messageId,
      payload.message_id,
      payload.requestId,
      payload.request_id,
      payload.providerRequestId,
      payload.provider_request_id,
      payload.callId,
      payload.call_id,
      payload.deliveryId,
      payload.delivery_id,
      details.messageId,
      details.message_id,
      details.requestId,
      details.request_id,
      details.providerRequestId,
      details.provider_request_id,
      details.callId,
      details.call_id,
      details.deliveryId,
      details.delivery_id
    ].some((item) => String(item || '').trim().length > 0);
    if (receipt) deliveryReceiptCount += 1;
  }

  const hasStrongShellEvidence = Boolean(runtimeTaskId) && shellEventCount > 0 && (commandCount > 0 || exitCodeCount > 0 || outputCount > 0);
  const hasStrongDeliveryEvidence = Boolean(runtimeTaskId)
    && deliveryEventCount > 0
    && deliverySuccessCount > 0
    && deliveryReceiptCount > 0;
  let verdict = 'simulated_or_unproven';
  if (hasStrongShellEvidence || hasStrongDeliveryEvidence) verdict = 'confirmed';
  else if (!runtimeTaskId && runtimeEvents.length === 0) verdict = 'not_executed';

  return {
    verdict,
    source,
    runtimeTaskId,
    shellIntent,
    shellEventCount,
    commandCount,
    exitCodeCount,
    outputCount,
    deliveryIntent,
    deliveryEventCount,
    deliverySuccessCount,
    deliveryReceiptCount
  };
}

module.exports = {
  normalizeRuntimeEventExtra,
  detectRuntimeExecutionEvidence
};
