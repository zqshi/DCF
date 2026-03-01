function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutSlash = raw.replace(/\/+$/, '');
  if (withoutSlash.endsWith('/api/v1')) return withoutSlash;
  return `${withoutSlash}/api/v1`;
}

class WeKnoraGateway {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.WEKNORA_BASE_URL || '');
    this.apiKey = String(options.apiKey || process.env.WEKNORA_API_KEY || '').trim();
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.WEKNORA_TIMEOUT_MS || 10000));
  }

  isEnabled() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  ensureEnabled() {
    if (this.isEnabled()) return;
    const error = new Error('weknora integration is not configured');
    error.statusCode = 503;
    error.code = 'WEKNORA_UNAVAILABLE';
    throw error;
  }

  async request(path, options = {}) {
    this.ensureEnabled();
    const url = `${this.baseUrl}${path}`;
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      'X-API-Key': this.apiKey,
      ...(options.contentType ? { 'Content-Type': options.contentType } : {})
    };
    if (options.traceId) headers['X-Request-ID'] = String(options.traceId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: options.body || undefined,
        signal: controller.signal
      });
      const text = await res.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      if (!res.ok) {
        const message = String(
          (payload && payload.error && payload.error.message)
          || (payload && payload.message)
          || `weknora request failed: ${res.status}`
        );
        const error = new Error(message);
        error.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
        error.code = 'WEKNORA_REQUEST_FAILED';
        error.details = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`weknora request timeout after ${this.timeoutMs}ms`);
        timeoutError.statusCode = 504;
        timeoutError.code = 'WEKNORA_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async createKnowledgeBase(input = {}) {
    const body = JSON.stringify({
      name: String(input.name || '').trim(),
      description: String(input.description || '').trim()
    });
    return this.request('/knowledge-bases', {
      method: 'POST',
      contentType: 'application/json',
      body,
      traceId: input.traceId
    });
  }

  async createManualKnowledge(input = {}) {
    const kbId = String(input.knowledgeBaseId || '').trim();
    if (!kbId) {
      const error = new Error('knowledgeBaseId is required');
      error.statusCode = 400;
      throw error;
    }
    const body = JSON.stringify({
      title: String(input.title || '').trim(),
      content: String(input.content || '').trim(),
      status: String(input.status || 'publish').trim() || 'publish'
    });
    return this.request(`/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/manual`, {
      method: 'POST',
      contentType: 'application/json',
      body,
      traceId: input.traceId
    });
  }

  async searchKnowledge(input = {}) {
    const query = String(input.query || '').trim();
    if (!query) {
      const error = new Error('query is required');
      error.statusCode = 400;
      throw error;
    }
    const payload = {
      query
    };
    const knowledgeBaseId = String(input.knowledgeBaseId || '').trim();
    if (knowledgeBaseId) payload.knowledge_base_id = knowledgeBaseId;
    if (Array.isArray(input.knowledgeBaseIds) && input.knowledgeBaseIds.length) {
      payload.knowledge_base_ids = input.knowledgeBaseIds.map((x) => String(x || '').trim()).filter(Boolean);
    }
    return this.request('/knowledge-search', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify(payload),
      traceId: input.traceId
    });
  }
}

module.exports = { WeKnoraGateway, normalizeBaseUrl };
