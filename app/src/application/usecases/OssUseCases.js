const { evaluateRepos } = require('../../domain/services/OssEvaluationService');

class OssUseCases {
  constructor(store, gateway) {
    this.store = store;
    this.gateway = gateway;
  }

  async search(query, goal) {
    if (!query) throw new Error('query is required');
    const repos = await this.gateway.searchRepositories(query);
    return evaluateRepos(repos, goal);
  }

  async processQueuedResearch(limit = 2) {
    const queued = this.store.researchQueue.filter((q) => q.status === 'queued').slice(0, limit);
    for (const item of queued) {
      item.status = 'running';
      try {
        const results = await this.search(item.query, item.goal);
        const top = results.slice(0, 5);
        const finding = {
          id: `${item.id}-finding`,
          employeeId: item.employeeId,
          taskId: item.taskId,
          query: item.query,
          candidates: top,
          createdAt: new Date().toISOString()
        };
        this.store.ossFindings.unshift(finding);
        this.store.ossFindings = this.store.ossFindings.slice(0, 300);
        item.status = 'done';
        this.store.addEvent('oss.research.done', {
          taskId: item.taskId,
          employeeId: item.employeeId,
          topRepo: top[0] ? top[0].name : null
        });
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
        this.store.addEvent('oss.research.failed', { taskId: item.taskId, employeeId: item.employeeId, error: error.message });
      }
    }
  }
}

module.exports = { OssUseCases };
