function normalizeText(value) {
  return String(value || '').trim();
}

class KnowledgeUseCases {
  constructor(store, gateway) {
    this.store = store;
    this.gateway = gateway;
  }

  ensureCollections() {
    if (!Array.isArray(this.store.knowledgeAssets)) this.store.knowledgeAssets = [];
  }

  findEmployeeKnowledgeBase(employeeId) {
    const normalized = normalizeText(employeeId);
    if (!normalized) return null;
    return this.store.knowledgeAssets.find((item) => (
      item
      && item.assetType === 'knowledge_base'
      && item.employeeId === normalized
      && String(item.lifecycleStatus || 'active') !== 'retired'
    )) || null;
  }

  async ensureKnowledgeBase(input = {}) {
    this.ensureCollections();
    const employeeId = normalizeText(input.employeeId);
    const taskId = normalizeText(input.taskId);
    const traceId = normalizeText(input.traceId);
    const existing = this.findEmployeeKnowledgeBase(employeeId);
    if (existing && existing.externalId) return existing;

    const createdAt = new Date().toISOString();
    const kbName = normalizeText(input.knowledgeBaseName)
      || `DCF ${normalizeText(input.department) || 'General'} ${normalizeText(input.role) || 'Employee'} KB`;
    const kbDescription = normalizeText(input.knowledgeBaseDescription)
      || `DCF managed KB for employee ${employeeId || 'unknown'}`;
    const remote = await this.gateway.createKnowledgeBase({
      name: kbName,
      description: kbDescription,
      traceId
    });
    const remoteData = remote && typeof remote === 'object' ? (remote.data || {}) : {};
    const externalId = normalizeText(remoteData.id);
    if (!externalId) {
      const error = new Error('weknora createKnowledgeBase returned empty id');
      error.statusCode = 502;
      throw error;
    }

    const asset = {
      id: `knowledge-asset-kb-${Date.now()}-${Math.random()}`,
      assetType: 'knowledge_base',
      externalId,
      employeeId: employeeId || null,
      taskId: taskId || null,
      traceId: traceId || null,
      title: normalizeText(remoteData.name) || kbName,
      summary: normalizeText(remoteData.description) || kbDescription,
      sourceType: 'weknora',
      qualityScore: null,
      reviewStatus: 'approved',
      reviewedAt: createdAt,
      reviewedBy: 'system',
      lifecycleStatus: 'active',
      createdAt,
      updatedAt: createdAt
    };
    this.store.knowledgeAssets.unshift(asset);
    this.store.knowledgeAssets = this.store.knowledgeAssets.slice(0, 5000);
    this.store.addEvent('knowledge.base.created', {
      traceId: traceId || null,
      taskId: taskId || null,
      employeeId: employeeId || null,
      knowledgeBaseId: externalId,
      title: asset.title
    });
    return asset;
  }

  async ingestManual(input = {}) {
    this.ensureCollections();
    const title = normalizeText(input.title);
    const content = normalizeText(input.content);
    const employeeId = normalizeText(input.employeeId);
    const taskId = normalizeText(input.taskId);
    const traceId = normalizeText(input.traceId);
    if (!title) {
      const error = new Error('title is required');
      error.statusCode = 400;
      throw error;
    }
    if (!content) {
      const error = new Error('content is required');
      error.statusCode = 400;
      throw error;
    }

    const kbAsset = await this.ensureKnowledgeBase({
      employeeId,
      taskId,
      traceId,
      knowledgeBaseName: input.knowledgeBaseName,
      knowledgeBaseDescription: input.knowledgeBaseDescription,
      department: input.department,
      role: input.role
    });

    const remote = await this.gateway.createManualKnowledge({
      knowledgeBaseId: kbAsset.externalId,
      title,
      content,
      status: normalizeText(input.status) || 'publish',
      traceId
    });
    const remoteData = remote && typeof remote === 'object' ? (remote.data || {}) : {};
    const knowledgeId = normalizeText(remoteData.id);
    if (!knowledgeId) {
      const error = new Error('weknora createManualKnowledge returned empty id');
      error.statusCode = 502;
      throw error;
    }

    const now = new Date().toISOString();
    const asset = {
      id: `knowledge-asset-doc-${Date.now()}-${Math.random()}`,
      assetType: 'knowledge_item',
      externalId: knowledgeId,
      knowledgeBaseId: kbAsset.externalId,
      employeeId: employeeId || null,
      taskId: taskId || null,
      traceId: traceId || null,
      title: normalizeText(remoteData.title) || title,
      summary: normalizeText(remoteData.description) || '',
      sourceType: 'manual',
      qualityScore: Number.isFinite(Number(input.qualityScore)) ? Number(input.qualityScore) : null,
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewedBy: null,
      lifecycleStatus: 'active',
      metadata: {
        parseStatus: normalizeText(remoteData.parse_status),
        enableStatus: normalizeText(remoteData.enable_status)
      },
      createdAt: now,
      updatedAt: now,
      curatedBy: normalizeText(input.curatedBy || input.actorUserId) || null
    };
    this.store.knowledgeAssets.unshift(asset);
    this.store.knowledgeAssets = this.store.knowledgeAssets.slice(0, 5000);

    this.store.addEvent('knowledge.ingest.completed', {
      traceId: traceId || null,
      taskId: taskId || null,
      employeeId: employeeId || null,
      knowledgeBaseId: kbAsset.externalId,
      knowledgeId,
      title: asset.title,
      sourceType: asset.sourceType
    });

    return {
      knowledgeBaseId: kbAsset.externalId,
      asset
    };
  }

  resolveKnowledgeBaseId(input = {}) {
    const explicit = normalizeText(input.knowledgeBaseId);
    if (explicit) return explicit;
    const byEmployee = this.findEmployeeKnowledgeBase(input.employeeId);
    return byEmployee ? byEmployee.externalId : '';
  }

  async search(input = {}) {
    this.ensureCollections();
    const query = normalizeText(input.query);
    if (!query) {
      const error = new Error('query is required');
      error.statusCode = 400;
      throw error;
    }
    const knowledgeBaseId = this.resolveKnowledgeBaseId(input);
    if (!knowledgeBaseId) {
      const error = new Error('knowledgeBaseId is required');
      error.statusCode = 400;
      throw error;
    }
    const remote = await this.gateway.searchKnowledge({
      query,
      knowledgeBaseId,
      traceId: input.traceId
    });
    const rows = Array.isArray(remote && remote.data) ? remote.data : [];
    const items = rows.map((row) => ({
      id: normalizeText(row.id),
      knowledgeId: normalizeText(row.knowledge_id),
      knowledgeTitle: normalizeText(row.knowledge_title),
      content: normalizeText(row.content),
      score: Number(row.score || 0)
    }));
    this.store.addEvent('knowledge.search.completed', {
      traceId: normalizeText(input.traceId) || null,
      taskId: normalizeText(input.taskId) || null,
      employeeId: normalizeText(input.employeeId) || null,
      query,
      knowledgeBaseId,
      hitCount: items.length
    });
    return {
      knowledgeBaseId,
      query,
      items
    };
  }

  listAssets(filters = {}) {
    this.ensureCollections();
    const employeeId = normalizeText(filters.employeeId);
    const reviewStatus = normalizeText(filters.reviewStatus);
    const assetType = normalizeText(filters.assetType);
    return this.store.knowledgeAssets.filter((item) => {
      if (employeeId && item.employeeId !== employeeId) return false;
      if (reviewStatus && item.reviewStatus !== reviewStatus) return false;
      if (assetType && item.assetType !== assetType) return false;
      return true;
    });
  }

  reviewAsset(assetId, input = {}, actor = {}) {
    this.ensureCollections();
    const id = normalizeText(assetId);
    const found = this.store.knowledgeAssets.find((item) => item.id === id);
    if (!found) {
      const error = new Error('knowledge asset not found');
      error.statusCode = 404;
      throw error;
    }
    const reviewStatus = normalizeText(input.reviewStatus || input.status).toLowerCase();
    if (!['approved', 'rejected', 'pending'].includes(reviewStatus)) {
      const error = new Error('reviewStatus must be one of approved|rejected|pending');
      error.statusCode = 400;
      throw error;
    }
    const qualityScoreRaw = Number(input.qualityScore);
    if (Number.isFinite(qualityScoreRaw) && (qualityScoreRaw < 0 || qualityScoreRaw > 100)) {
      const error = new Error('qualityScore must be between 0 and 100');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    found.reviewStatus = reviewStatus;
    found.reviewedAt = now;
    found.reviewedBy = normalizeText(actor.userId || actor.actorId || 'system');
    if (Number.isFinite(qualityScoreRaw)) found.qualityScore = Number(qualityScoreRaw);
    if (Object.prototype.hasOwnProperty.call(input, 'lifecycleStatus')) {
      const lifecycleStatus = normalizeText(input.lifecycleStatus).toLowerCase();
      if (['active', 'retired'].includes(lifecycleStatus)) found.lifecycleStatus = lifecycleStatus;
    }
    found.updatedAt = now;
    this.store.addEvent('knowledge.asset.reviewed', {
      traceId: found.traceId || null,
      taskId: found.taskId || null,
      employeeId: found.employeeId || null,
      assetId: found.id,
      reviewStatus,
      qualityScore: found.qualityScore,
      actorId: found.reviewedBy
    });
    return found;
  }
}

module.exports = { KnowledgeUseCases };
