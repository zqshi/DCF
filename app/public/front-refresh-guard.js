(function registerFrontRefreshGuard(globalScope) {
  function createRequestGuard() {
    let latestIssued = 0;
    return {
      issue() {
        latestIssued += 1;
        return latestIssued;
      },
      isCurrent(token) {
        return Number(token) === latestIssued;
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRequestGuard };
    return;
  }
  globalScope.createRequestGuard = createRequestGuard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
