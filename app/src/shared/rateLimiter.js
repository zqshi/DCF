/**
 * Token-bucket rate limiter — per IP, zero dependencies.
 */

class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;
    this.refillRate = refillRate; // tokens per ms
    this.buckets = new Map();
  }

  _getBucket(key) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  consume(key) {
    const bucket = this._getBucket(key);
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    const waitMs = Math.ceil((1 - bucket.tokens) / this.refillRate);
    return { allowed: false, retryAfterMs: waitMs };
  }

  // Periodic cleanup of stale entries
  prune(maxAgeMs = 300000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) this.buckets.delete(key);
    }
  }
}

function createRateLimiter(rpm) {
  const capacity = Math.max(1, Number(rpm) || 60);
  const refillRate = capacity / 60000; // tokens per ms
  const bucket = new TokenBucket(capacity, refillRate);

  // Prune stale entries every 5 minutes
  const pruneTimer = setInterval(() => bucket.prune(), 300000);
  pruneTimer.unref();

  return function rateLimitMiddleware(req, res) {
    const ip = req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : (req.socket && req.socket.remoteAddress) || 'unknown';

    const result = bucket.consume(ip);
    if (result.allowed) return false; // not rate-limited

    const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(retryAfterSec)
    });
    res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: retryAfterSec }));
    return true; // handled, caller should return
  };
}

module.exports = { TokenBucket, createRateLimiter };
