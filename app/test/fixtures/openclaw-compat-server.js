const http = require('http');

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function createCompatServer() {
  return http.createServer((req, res) => {
    return json(res, 410, {
      error: 'openclaw-compat is deprecated and disabled',
      action: 'use direct OpenClaw runtime contract endpoint',
      endpoint: req.url || '/',
      method: req.method || 'GET'
    });
  });
}

module.exports = { createCompatServer };
