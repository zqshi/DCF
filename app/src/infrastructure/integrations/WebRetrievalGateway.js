const { URL } = require('url');

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('sourceUrl must be http or https');
  }
  return parsed.toString();
}

function stripTags(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseDateLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function resolveUrl(base, maybeRelative) {
  const raw = String(maybeRelative || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, base).toString();
  } catch {
    return '';
  }
}

function buildKeywords(input = {}) {
  const terms = [];
  const topic = String(input.topic || '').trim();
  const category = String(input.category || '').trim();
  if (topic) terms.push(...topic.split(/[\s,，;；]+/));
  if (category) terms.push(...category.split(/[\s,，;；]+/));
  const normalized = terms.map((x) => x.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(normalized));
}

function scoreItem(item, keywords = []) {
  if (!keywords.length) return 1;
  const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) score += 1;
  }
  return score;
}

function parseRssLike(xml, baseUrl) {
  const items = [];
  const rssItems = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const rawItem of rssItems) {
    const title = decodeHtml(((rawItem.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim());
    const link = decodeHtml(((rawItem.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '').trim());
    const description = decodeHtml(stripTags(((rawItem.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '')));
    const pubDate = parseDateLike(((rawItem.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || ''));
    const url = resolveUrl(baseUrl, link);
    if (!title || !url) continue;
    items.push({
      id: url,
      title: title.slice(0, 200),
      url,
      publishedAt: pubDate,
      snippet: description.slice(0, 300)
    });
  }

  if (items.length > 0) return items;

  const atomEntries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const rawEntry of atomEntries) {
    const title = decodeHtml(stripTags(((rawEntry.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')));
    const direct = rawEntry.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
    const contentLink = direct ? direct[1] : '';
    const summary = decodeHtml(stripTags(((rawEntry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || '')));
    const updated = parseDateLike(
      ((rawEntry.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]
      || (rawEntry.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]
      || '')
    );
    const url = resolveUrl(baseUrl, contentLink);
    if (!title || !url) continue;
    items.push({
      id: url,
      title: title.slice(0, 200),
      url,
      publishedAt: updated,
      snippet: summary.slice(0, 300)
    });
  }

  return items;
}

function parseHtmlLinks(html, baseUrl) {
  const items = [];
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let matched = regex.exec(html);
  while (matched) {
    const href = String(matched[1] || '').trim();
    const title = decodeHtml(stripTags(matched[2] || ''));
    const url = resolveUrl(baseUrl, href);
    if (title && url && !/^javascript:/i.test(href)) {
      items.push({
        id: url,
        title: title.slice(0, 200),
        url,
        publishedAt: null,
        snippet: ''
      });
    }
    matched = regex.exec(html);
  }
  return items;
}

class WebRetrievalGateway {
  constructor(options = {}) {
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.RETRIEVAL_FETCH_TIMEOUT_MS || 10000));
    this.maxItems = Math.max(1, Number(options.maxItems || process.env.RETRIEVAL_MAX_ITEMS || 12));
  }

  async fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'dcf-retrieval-bot/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      const text = await res.text();
      if (!res.ok) {
        const error = new Error(`retrieval request failed: ${res.status}`);
        error.statusCode = 502;
        throw error;
      }
      return text;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        const timeoutError = new Error(`retrieval request timeout after ${this.timeoutMs}ms`);
        timeoutError.statusCode = 504;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  findFeedLinks(html, baseUrl) {
    const links = [];
    const regex = /<link[^>]*>/gi;
    let matched = regex.exec(html);
    while (matched) {
      const tag = matched[0] || '';
      const type = ((tag.match(/type=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
      const rel = ((tag.match(/rel=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
      if (!rel.includes('alternate')) {
        matched = regex.exec(html);
        continue;
      }
      if (!(type.includes('rss') || type.includes('atom') || type.includes('xml'))) {
        matched = regex.exec(html);
        continue;
      }
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1] || '';
      const resolved = resolveUrl(baseUrl, href);
      if (resolved) links.push(resolved);
      matched = regex.exec(html);
    }
    return Array.from(new Set(links));
  }

  filterAndRank(items, input = {}) {
    const keywords = buildKeywords(input);
    const ranked = items
      .map((item) => ({ item, score: scoreItem(item, keywords) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        const aTime = new Date(a.item.publishedAt || 0).getTime();
        const bTime = new Date(b.item.publishedAt || 0).getTime();
        if (b.score !== a.score) return b.score - a.score;
        return bTime - aTime;
      })
      .map((entry) => entry.item);

    if (ranked.length > 0) return ranked.slice(0, this.maxItems);

    return items
      .slice()
      .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
      .slice(0, this.maxItems);
  }

  async retrieveLatest(input = {}) {
    const sourceUrl = normalizeUrl(input.sourceUrl || '');
    if (!sourceUrl) throw new Error('sourceUrl is required');

    const fetchedAt = new Date().toISOString();
    const homepage = await this.fetchText(sourceUrl);
    const feedLinks = this.findFeedLinks(homepage, sourceUrl);

    let items = [];
    let mode = 'html';

    for (const feedUrl of feedLinks) {
      try {
        const xml = await this.fetchText(feedUrl);
        const parsed = parseRssLike(xml, feedUrl);
        if (parsed.length) {
          items = parsed;
          mode = 'feed';
          break;
        }
      } catch {
        // Ignore single feed endpoint failures and continue fallback.
      }
    }

    if (!items.length) {
      items = parseHtmlLinks(homepage, sourceUrl);
      mode = 'html';
    }

    const unique = [];
    const seen = new Set();
    for (const item of items) {
      const key = item.url || item.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    const selected = this.filterAndRank(unique, input);
    return {
      fetchedAt,
      sourceUrl,
      mode,
      items: selected
    };
  }
}

module.exports = {
  WebRetrievalGateway,
  normalizeUrl
};
