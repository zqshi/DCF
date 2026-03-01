function resolveMcpPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  return {
    serviceId: decodeURIComponent(parts[4] || ''),
    action: parts[5] || ''
  };
}

function mapToolRouteError(error) {
  if (!error || typeof error !== 'object') return error;
  if (Number(error.statusCode || 0) > 0) return error;

  const message = String(error.message || '').toLowerCase();
  if (message.includes('not found')) {
    error.statusCode = 404;
    if (!error.code) error.code = 'TOOL_NOT_FOUND';
    return error;
  }
  if (message.includes('is required')) {
    error.statusCode = 400;
    if (!error.code) error.code = 'TOOL_VALIDATION_ERROR';
    return error;
  }
  if (message.includes('unsupported registration status') || message.includes('invalid tool status transition')) {
    error.statusCode = 400;
    if (!error.code) error.code = 'TOOL_STATUS_ERROR';
    return error;
  }
  if (message.includes('already exists')) {
    error.statusCode = 400;
    if (!error.code) error.code = 'TOOL_DUPLICATE';
    return error;
  }

  return error;
}

async function withToolErrorMapping(operation) {
  try {
    return await operation();
  } catch (error) {
    throw mapToolRouteError(error);
  }
}

module.exports = {
  resolveMcpPath,
  withToolErrorMapping
};
