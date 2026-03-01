const fs = require('fs');
const path = require('path');

function resolveCorsAllowOrigin(env = process.env) {
  const raw = String(env.CORS_ALLOW_ORIGIN || '').trim();
  return raw || '*';
}

function buildCorsHeaders(env = process.env) {
  return {
    'Access-Control-Allow-Origin': resolveCorsAllowOrigin(env),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...buildCorsHeaders()
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(v.join('=') || '');
  }
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const maxAge = opts.maxAge || 0;
  const path = opts.path || '/';
  const sameSite = opts.sameSite || 'Lax';
  const httpOnly = opts.httpOnly !== false;
  const secure = opts.secure === true;
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge >= 0) cookie += `; Max-Age=${Math.floor(maxAge / 1000)}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', existing.concat(cookie));
  } else {
    res.setHeader('Set-Cookie', [existing, cookie]);
  }
}

function clearCookie(res, name, opts = {}) {
  setCookie(res, name, '', { ...opts, maxAge: 0 });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    const limit = Number(process.env.MAX_BODY_BYTES || 12 * 1024 * 1024);
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limit) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const limit = Number(process.env.MAX_BINARY_BODY_BYTES || 64 * 1024 * 1024);
    req.on('data', (chunk) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(piece);
      total += piece.length;
      if (total > limit) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks, total));
    });
    req.on('error', reject);
  });
}

function serveStatic(publicDir, req, res) {
  const rawUrl = String(req.url || '/');
  const cleanUrl = rawUrl.split('?')[0].split('#')[0];
  let filePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
  filePath = path.normalize(filePath).replace(/^\.+/, '');
  const abs = path.join(publicDir, filePath);
  if (!abs.startsWith(publicDir)) return json(res, 404, { error: 'Not Found' });
  fs.readFile(abs, (err, content) => {
    if (err) return json(res, 404, { error: 'Not Found' });
    const ext = path.extname(abs);
    const contentType = ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.css'
        ? 'text/css; charset=utf-8'
        : ext === '.js'
          ? 'application/javascript; charset=utf-8'
          : 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache'
    });
    res.end(content);
  });
}

module.exports = {
  json,
  parseBody,
  parseBinaryBody,
  serveStatic,
  parseCookies,
  setCookie,
  clearCookie,
  buildCorsHeaders,
  resolveCorsAllowOrigin
};
