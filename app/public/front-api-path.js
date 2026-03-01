(function registerFrontApiPathHelpers(globalScope) {
  function normalizePathname(pathname) {
    const raw = String(pathname || '').trim();
    if (!raw) return '/';
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  function inferFrontMountPrefix(pathname) {
    const current = normalizePathname(pathname);
    const frontMatch = current.match(/^(.*)\/front(?:-login)?\.html$/);
    if (frontMatch) return frontMatch[1] || '';
    const htmlMatch = current.match(/^(.*)\/[^/]+\.html$/);
    if (htmlMatch) return htmlMatch[1] || '';
    if (current !== '/' && current.endsWith('/')) return current.slice(0, -1);
    return '';
  }

  function isLoopbackHost(hostname) {
    const value = String(hostname || '').trim().toLowerCase();
    return value === '127.0.0.1' || value === 'localhost';
  }

  function buildLocalPortFallbackOrigins(locationLike) {
    const location = locationLike || {};
    const hostname = String(location.hostname || '').trim();
    if (!isLoopbackHost(hostname)) return [];
    const protocol = String(location.protocol || 'http:').trim() || 'http:';
    const port = String(location.port || '').trim();
    const preferredPorts = ['8092', '8091'];
    return preferredPorts
      .filter((candidate) => candidate !== port)
      .map((candidate) => `${protocol}//${hostname}:${candidate}`);
  }

  function buildFrontApiCandidates(path, pathname, locationLike) {
    const target = String(path || '').trim();
    if (!target) return [''];
    if (!target.startsWith('/api/')) return [target];
    const mountPrefix = inferFrontMountPrefix(pathname);
    const v1Path = `/api/v1${target.slice('/api'.length)}`;
    const candidates = [
      target,
      v1Path
    ];
    if (mountPrefix) {
      candidates.push(`${mountPrefix}${target}`);
      candidates.push(`${mountPrefix}${v1Path}`);
    }
    const fallbackOrigins = buildLocalPortFallbackOrigins(locationLike);
    for (const origin of fallbackOrigins) {
      for (const relative of candidates.slice()) {
        if (String(relative || '').startsWith('/')) {
          candidates.push(`${origin}${relative}`);
        }
      }
    }
    return Array.from(new Set(candidates));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildFrontApiCandidates,
      inferFrontMountPrefix,
      buildLocalPortFallbackOrigins
    };
    return;
  }
  globalScope.buildFrontApiCandidates = buildFrontApiCandidates;
})(typeof globalThis !== 'undefined' ? globalThis : window);
