function rewriteApiV1Request(rawUrl = '/', res) {
  const sourceUrl = String(rawUrl || '/');
  const queryIndex = sourceUrl.indexOf('?');
  const pathOnly = queryIndex >= 0 ? sourceUrl.slice(0, queryIndex) : sourceUrl;
  const queryOnly = queryIndex >= 0 ? sourceUrl.slice(queryIndex) : '';

  if (pathOnly === '/api/v1' || pathOnly.startsWith('/api/v1/')) {
    const rewrittenPath = pathOnly === '/api/v1' ? '/api' : `/api${pathOnly.slice('/api/v1'.length)}`;
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('X-API-Version', 'v1');
    }
    return {
      rewritten: true,
      url: `${rewrittenPath}${queryOnly}`
    };
  }

  return {
    rewritten: false,
    url: sourceUrl
  };
}

module.exports = {
  rewriteApiV1Request
};
