function inferDeniedToolName(outcome = {}) {
  const events = Array.isArray(outcome.runtimeEvents) ? outcome.runtimeEvents : [];
  for (const event of events) {
    const payload = event && typeof event.payload === 'object' && event.payload ? event.payload : {};
    const action = String(payload.action || payload.phase || '').toLowerCase();
    const message = String(payload.message || payload.result || payload.reason || '').toLowerCase();
    const type = String(event && event.type ? event.type : '').toLowerCase();
    const hasDeniedSignal = (
      action.includes('deny')
      || action.includes('forbid')
      || action.includes('unauthor')
      || message.includes('permission')
      || message.includes('not allowed')
      || type.includes('deny')
    );
    if (!hasDeniedSignal) continue;
    const tool = String(payload.toolName || payload.tool || payload.name || '').trim().toLowerCase();
    if (tool) return tool;
  }
  const errorMessage = String((outcome.error && outcome.error.message) || '').toLowerCase();
  const match = errorMessage.match(/\btool\s+([a-z0-9._-]+)\b/i);
  if (match && match[1]) return String(match[1]).trim().toLowerCase();
  return null;
}

function extractPermissionDeniedRequest(outcome = {}) {
  if (!outcome || String(outcome.status || '') !== 'failed') return null;
  const errorMessage = String((outcome.error && outcome.error.message) || '').toLowerCase();
  const deniedByErrorText = (
    errorMessage.includes('permission denied')
    || errorMessage.includes('not allowed')
    || errorMessage.includes('unauthorized')
    || errorMessage.includes('forbidden')
  );
  const deniedTool = inferDeniedToolName(outcome);
  if (!deniedByErrorText && !deniedTool) return null;
  return {
    tool: deniedTool || 'unknown',
    reason: String((outcome.error && outcome.error.message) || 'runtime tool permission denied').slice(0, 500)
  };
}

module.exports = {
  inferDeniedToolName,
  extractPermissionDeniedRequest
};
