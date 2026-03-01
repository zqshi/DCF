const { createHash } = require('crypto');
const { InMemoryStore } = require('./InMemoryStore');

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

class SqliteSnapshotStore extends InMemoryStore {
  constructor(dbPath) {
    super();
    this.driver = 'sqlite';
    this.dbPath = dbPath;
    this.timer = null;
    this.db = null;
    this.lastRowHashes = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
    this.lastMetricsHash = '';
  }

  init() {
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_queue (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_findings (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_cases (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_candidate_evaluations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oss_build_vs_buy_assessments (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_assets (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_candidates (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_review_queue (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS retrieval_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS briefing_deliveries (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_anchors (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_services (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompt_versions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS autoevolve_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS singleton_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metrics (name TEXT PRIMARY KEY, value REAL NOT NULL, updated_at TEXT NOT NULL);
    `);

    this.employees = this.readRows('employees');
    this.conversations = this.readRows('conversations');
    this.messages = this.readRows('messages');
    this.tasks = this.readRows('tasks');
    this.skills = this.readRows('skills');
    this.events = this.readRows('events');
    this.researchQueue = this.readRows('research_queue');
    this.ossFindings = this.readRows('oss_findings');
    this.ossCases = this.readRows('oss_cases');
    this.ossCandidateEvaluations = this.readRows('oss_candidate_evaluations');
    this.ossBuildVsBuyAssessments = this.readRows('oss_build_vs_buy_assessments');
    this.knowledgeAssets = this.readRows('knowledge_assets');
    this.knowledgeCandidates = this.readRows('knowledge_candidates');
    this.knowledgeReviewQueue = this.readRows('knowledge_review_queue');
    this.subscriptions = this.readRows('subscriptions');
    this.retrievalRuns = this.readRows('retrieval_runs');
    this.briefingDeliveries = this.readRows('briefing_deliveries');
    this.auditAnchors = this.readRows('audit_anchors');
    this.mcpServices = this.readRows('mcp_services');
    this.promptVersions = this.readRows('prompt_versions');
    this.autoevolveRuns = this.readRows('autoevolve_runs');
    this.loadSingletonState();
    this.metrics = this.readMetrics();

    this.bootstrapHashes();
  }

  rowHash(value) {
    return createHash('sha1').update(JSON.stringify(value)).digest('hex');
  }

  stableId(item, table) {
    if (!item.id) item.id = `${table}-${Date.now()}-${Math.random()}`;
    return item.id;
  }

  readRows(table) {
    const rows = this.db.prepare(`SELECT payload FROM ${table} ORDER BY updated_at ASC`).all();
    return rows.map((r) => JSON.parse(r.payload));
  }

  readMetrics() {
    const rows = this.db.prepare('SELECT name, value FROM metrics').all();
    if (!rows.length) return this.metrics;
    const result = { ...this.metrics };
    for (const r of rows) {
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

  loadSingletonState() {
    const SINGLETON_KEYS = [
      'bootstrap', 'retrievalPolicy', 'ossGovernancePolicy',
      'skillSedimentationPolicy', 'knowledgeSedimentationPolicy',
      'strategyCenter', 'promptCenter'
    ];
    try {
      const rows = this.db.prepare('SELECT key, payload FROM singleton_state').all();
      for (const r of rows) {
        const key = String(r.key || '');
        if (SINGLETON_KEYS.includes(key)) {
          try { this[key] = JSON.parse(r.payload); } catch {}
        }
      }
    } catch {}
  }

  persistSingletonState() {
    const SINGLETON_KEYS = [
      'bootstrap', 'retrievalPolicy', 'ossGovernancePolicy',
      'skillSedimentationPolicy', 'knowledgeSedimentationPolicy',
      'strategyCenter', 'promptCenter'
    ];
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO singleton_state (key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `);
    for (const key of SINGLETON_KEYS) {
      if (this[key] != null) {
        upsert.run(key, JSON.stringify(this[key]), now);
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

  persistTable(table, items) {
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO ${table} (id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `);
    const del = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);

    const prev = this.lastRowHashes[table] || new Map();
    const curr = new Map();

    for (const item of items) {
      const id = this.stableId(item, table);
      const h = this.rowHash(item);
      curr.set(id, h);
      if (prev.get(id) !== h) {
        upsert.run(id, JSON.stringify(item), now);
      }
    }

    for (const oldId of prev.keys()) {
      if (!curr.has(oldId)) del.run(oldId);
    }

    this.lastRowHashes[table] = curr;
  }

  persistMetrics() {
    const currentHash = this.rowHash(this.metrics);
    if (currentHash === this.lastMetricsHash) return;

    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO metrics (name, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `);
    const del = this.db.prepare('DELETE FROM metrics WHERE name = ?');

    const existingRows = this.db.prepare('SELECT name FROM metrics').all();
    const existing = new Set(existingRows.map((r) => r.name));

    const flatMetrics = this.flattenMetrics();
    for (const [name, value] of Object.entries(flatMetrics)) {
      upsert.run(name, Number(value || 0), now);
      existing.delete(name);
    }

    for (const oldName of existing) del.run(oldName);
    this.lastMetricsHash = currentHash;
  }

  persist() {
    const tx = this.db.transaction(() => {
      this.persistTable('employees', this.employees);
      this.persistTable('conversations', this.conversations);
      this.persistTable('messages', this.messages);
      this.persistTable('tasks', this.tasks);
      this.persistTable('skills', this.skills);
      this.persistTable('events', this.events);
      this.persistTable('research_queue', this.researchQueue);
      this.persistTable('oss_findings', this.ossFindings);
      this.persistTable('oss_cases', this.ossCases);
      this.persistTable('oss_candidate_evaluations', this.ossCandidateEvaluations);
      this.persistTable('oss_build_vs_buy_assessments', this.ossBuildVsBuyAssessments);
      this.persistTable('knowledge_assets', this.knowledgeAssets);
      this.persistTable('knowledge_candidates', this.knowledgeCandidates);
      this.persistTable('knowledge_review_queue', this.knowledgeReviewQueue);
      this.persistTable('subscriptions', this.subscriptions);
      this.persistTable('retrieval_runs', this.retrievalRuns);
      this.persistTable('briefing_deliveries', this.briefingDeliveries);
      this.persistTable('audit_anchors', this.auditAnchors);
      this.persistTable('mcp_services', this.mcpServices);
      this.persistTable('prompt_versions', this.promptVersions);
      this.persistTable('autoevolve_runs', this.autoevolveRuns);
      this.persistSingletonState();
      this.persistMetrics();
    });
    tx();
  }

  startAutoPersist(intervalMs = 1000) {
    this.timer = setInterval(() => this.persist(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.persist();
    this.db.close();
  }
}

module.exports = { SqliteSnapshotStore };
