const { createHash } = require('crypto');
const { InMemoryStore } = require('./InMemoryStore');
const { logger } = require('../../shared/logger');

const TABLES = [
  'employees',
  'conversations',
  'messages',
  'tasks',
  'skills',
  'events',
  'research_queue',
  'oss_findings',
  'oss_cases',
  'oss_candidate_evaluations',
  'oss_build_vs_buy_assessments',
  'knowledge_assets',
  'knowledge_candidates',
  'knowledge_review_queue',
  'subscriptions',
  'retrieval_runs',
  'briefing_deliveries',
  'audit_anchors',
  'mcp_services',
  'prompt_versions',
  'autoevolve_runs'
];

class PostgresSnapshotStore extends InMemoryStore {
  constructor(connectionString) {
    super();
    this.driver = 'postgres';
    this.connectionString = connectionString;
    this.timer = null;
    this.pool = null;
    this.persistInFlight = false;
    this.lastPersistOk = true;
    this.lastRowHashes = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
    this.lastMetricsHash = '';
  }

  async init() {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: this.connectionString,
      max: Number(process.env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    this.pool.on('error', (err) => {
      logger.error('postgres pool background error', { error: err.message });
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS research_queue (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_findings (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_cases (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_candidate_evaluations (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_build_vs_buy_assessments (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_assets (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_candidates (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_review_queue (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS retrieval_runs (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS briefing_deliveries (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_anchors (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_services (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS prompt_versions (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS autoevolve_runs (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS singleton_state (key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics (name TEXT PRIMARY KEY, value DOUBLE PRECISION NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
    `);

    this.employees = await this.readRows('employees');
    this.conversations = await this.readRows('conversations');
    this.messages = await this.readRows('messages');
    this.tasks = await this.readRows('tasks');
    this.skills = await this.readRows('skills');
    this.events = await this.readRows('events');
    this.researchQueue = await this.readRows('research_queue');
    this.ossFindings = await this.readRows('oss_findings');
    this.ossCases = await this.readRows('oss_cases');
    this.ossCandidateEvaluations = await this.readRows('oss_candidate_evaluations');
    this.ossBuildVsBuyAssessments = await this.readRows('oss_build_vs_buy_assessments');
    this.knowledgeAssets = await this.readRows('knowledge_assets');
    this.knowledgeCandidates = await this.readRows('knowledge_candidates');
    this.knowledgeReviewQueue = await this.readRows('knowledge_review_queue');
    this.subscriptions = await this.readRows('subscriptions');
    this.retrievalRuns = await this.readRows('retrieval_runs');
    this.briefingDeliveries = await this.readRows('briefing_deliveries');
    this.auditAnchors = await this.readRows('audit_anchors');
    this.mcpServices = await this.readRows('mcp_services');
    this.promptVersions = await this.readRows('prompt_versions');
    this.autoevolveRuns = await this.readRows('autoevolve_runs');
    await this.loadSingletonState();
    this.metrics = await this.readMetrics();

    this.bootstrapHashes();
  }

  rowHash(value) {
    return createHash('sha1').update(JSON.stringify(value)).digest('hex');
  }

  stableId(item, table) {
    if (!item.id) item.id = `${table}-${Date.now()}-${Math.random()}`;
    return item.id;
  }

  async readRows(table) {
    const rs = await this.pool.query(`SELECT payload FROM ${table} ORDER BY updated_at ASC`);
    return rs.rows.map((r) => r.payload);
  }

  async readMetrics() {
    const rs = await this.pool.query('SELECT name, value FROM metrics');
    if (!rs.rows.length) return this.metrics;
    const result = { ...this.metrics };
    for (const r of rs.rows) {
      const name = String(r.name || '');
      const value = Number(r.value || 0);
      if (name.includes('.')) {
        const [head, ...tail] = name.split('.');
        const key = tail.join('.');
        if (!head || !key) continue;
        if (!result[head] || typeof result[head] !== 'object') result[head] = {};
        result[head][key] = value;
        continue;
      }
      result[name] = value;
    }
    return result;
  }

  async loadSingletonState() {
    const SINGLETON_KEYS = [
      'bootstrap', 'retrievalPolicy', 'ossGovernancePolicy',
      'skillSedimentationPolicy', 'knowledgeSedimentationPolicy',
      'strategyCenter', 'promptCenter'
    ];
    try {
      const rs = await this.pool.query('SELECT key, payload FROM singleton_state');
      for (const r of rs.rows) {
        const key = String(r.key || '');
        if (SINGLETON_KEYS.includes(key)) {
          this[key] = r.payload;
        }
      }
    } catch {}
  }

  async persistSingletonState(client) {
    const SINGLETON_KEYS = [
      'bootstrap', 'retrievalPolicy', 'ossGovernancePolicy',
      'skillSedimentationPolicy', 'knowledgeSedimentationPolicy',
      'strategyCenter', 'promptCenter'
    ];
    const now = new Date().toISOString();
    for (const key of SINGLETON_KEYS) {
      if (this[key] != null) {
        await client.query(
          `INSERT INTO singleton_state (key, payload, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload, updated_at=EXCLUDED.updated_at`,
          [key, JSON.stringify(this[key]), now]
        );
      }
    }
  }

  flattenMetrics() {
    const flat = {};
    for (const [name, value] of Object.entries(this.metrics || {})) {
      if (value && typeof value === 'object') {
        for (const [subKey, subValue] of Object.entries(value)) {
          flat[`${name}.${subKey}`] = Number(subValue || 0);
        }
        continue;
      }
      flat[name] = Number(value || 0);
    }
    return flat;
  }

  bootstrapHashes() {
    for (const table of TABLES) {
      const arr = table === 'research_queue' ? this.researchQueue :
        table === 'oss_findings' ? this.ossFindings :
          table === 'oss_cases' ? this.ossCases :
            table === 'oss_candidate_evaluations' ? this.ossCandidateEvaluations :
              table === 'oss_build_vs_buy_assessments' ? this.ossBuildVsBuyAssessments :
                table === 'knowledge_assets' ? this.knowledgeAssets :
                  table === 'knowledge_candidates' ? this.knowledgeCandidates :
                    table === 'knowledge_review_queue' ? this.knowledgeReviewQueue :
                  table === 'subscriptions' ? this.subscriptions :
                    table === 'retrieval_runs' ? this.retrievalRuns :
                      table === 'briefing_deliveries' ? this.briefingDeliveries :
          table === 'audit_anchors' ? this.auditAnchors :
          table === 'mcp_services' ? this.mcpServices :
            table === 'prompt_versions' ? this.promptVersions :
              table === 'autoevolve_runs' ? this.autoevolveRuns :
          this[table];
      const map = new Map();
      for (const item of arr) map.set(this.stableId(item, table), this.rowHash(item));
      this.lastRowHashes[table] = map;
    }
    this.lastMetricsHash = this.rowHash(this.metrics);
  }

  async persistTable(client, table, items) {
    const prev = this.lastRowHashes[table] || new Map();
    const curr = new Map();

    for (const item of items) {
      const id = this.stableId(item, table);
      const h = this.rowHash(item);
      curr.set(id, h);
      if (prev.get(id) !== h) {
        await client.query(
          `INSERT INTO ${table} (id, payload, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()`,
          [id, JSON.stringify(item)]
        );
      }
    }

    for (const oldId of prev.keys()) {
      if (!curr.has(oldId)) {
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [oldId]);
      }
    }

    this.lastRowHashes[table] = curr;
  }

  async persistMetrics(client) {
    const currentHash = this.rowHash(this.metrics);
    if (currentHash === this.lastMetricsHash) return;

    const rs = await client.query('SELECT name FROM metrics');
    const existing = new Set(rs.rows.map((r) => r.name));

    const flatMetrics = this.flattenMetrics();
    for (const [name, value] of Object.entries(flatMetrics)) {
      await client.query(
        `INSERT INTO metrics (name, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
        [name, Number(value || 0)]
      );
      existing.delete(name);
    }

    for (const oldName of existing) {
      await client.query('DELETE FROM metrics WHERE name = $1', [oldName]);
    }

    this.lastMetricsHash = currentHash;
  }

  async persist() {
    if (this.persistInFlight) return;
    this.persistInFlight = true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.persistTable(client, 'employees', this.employees);
      await this.persistTable(client, 'conversations', this.conversations);
      await this.persistTable(client, 'messages', this.messages);
      await this.persistTable(client, 'tasks', this.tasks);
      await this.persistTable(client, 'skills', this.skills);
      await this.persistTable(client, 'events', this.events);
      await this.persistTable(client, 'research_queue', this.researchQueue);
      await this.persistTable(client, 'oss_findings', this.ossFindings);
      await this.persistTable(client, 'oss_cases', this.ossCases);
      await this.persistTable(client, 'oss_candidate_evaluations', this.ossCandidateEvaluations);
      await this.persistTable(client, 'oss_build_vs_buy_assessments', this.ossBuildVsBuyAssessments);
      await this.persistTable(client, 'knowledge_assets', this.knowledgeAssets);
      await this.persistTable(client, 'knowledge_candidates', this.knowledgeCandidates);
      await this.persistTable(client, 'knowledge_review_queue', this.knowledgeReviewQueue);
      await this.persistTable(client, 'subscriptions', this.subscriptions);
      await this.persistTable(client, 'retrieval_runs', this.retrievalRuns);
      await this.persistTable(client, 'briefing_deliveries', this.briefingDeliveries);
      await this.persistTable(client, 'audit_anchors', this.auditAnchors);
      await this.persistTable(client, 'mcp_services', this.mcpServices);
      await this.persistTable(client, 'prompt_versions', this.promptVersions);
      await this.persistTable(client, 'autoevolve_runs', this.autoevolveRuns);
      await this.persistSingletonState(client);
      await this.persistMetrics(client);
      await client.query('COMMIT');
      this.lastPersistOk = true;
    } catch (error) {
      this.lastPersistOk = false;
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
      this.persistInFlight = false;
    }
  }

  startAutoPersist(intervalMs = 1000) {
    this.timer = setInterval(() => this.persist().catch((err) => {
      logger.error('auto-persist failed', { error: err.message });
    }), intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    try { await this.persist(); } catch {}
    await this.pool.end();
  }
}

module.exports = { PostgresSnapshotStore };
